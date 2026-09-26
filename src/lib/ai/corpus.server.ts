import 'server-only';
import achievementsRaw from '@/data/achievements.json';
import certificationsRaw from '@/data/certifications.json';
import githubFacts from '@/data/github-facts.json';
import liveSnapshot from '@/data/live-snapshot.json';
import profile from '@/data/profile.json';
import { hasCaseStudy, PROJECTS } from '@/data/projects';
import reading from '@/data/reading.json';
import { SITE_COPY } from '@/data/site-copy';
import skillsIndex from '@/data/skills-index.json';
import tools from '@/data/tools.json';
import vectorFile from '@/data/ai-vectors.json';
import { parseAchievements } from '@/lib/achievements';
import { parseCertifications } from '@/lib/certifications';
import { KNOWN_SECTIONS } from './actions';
import { AI_EMBED_BUDGET_MS } from './config';
import { buildCorpus, corpusHash, entities, type Chunk, type CorpusLiveSnapshot, type Entities } from './corpus';
import { aiEmbed, type Deadline } from './gemini.server';
import { Lru, normalizeQuestion } from './lru';
import type { RetrievalHit } from './protocol';
import { buildBm25, decodeVec, hybrid, meanVector, type Bm25Index, type EncodedVec } from './retrieval';
import type { KnownTargets } from './sanitize';

/*
 * The server's grounding corpus, built once per instance from the same data and
 * code as scripts/ai/build-corpus.mjs, so live data refreshed at build time is
 * current. Vectors come from src/data/ai-vectors.json and are used only for
 * chunks whose hash still matches; the rest are searched lexically. That file is
 * imported only here, behind 'server-only', so it never reaches a client bundle.
 */

type VectorFile = { model: string | null; dims: number; entries: Record<string, { hash: string } & EncodedVec> };

export type Corpus = {
  chunks: Chunk[];
  byId: Map<string, Chunk>;
  index: Bm25Index<Chunk>;
  /** Chunk vectors whose hash matches the current chunk, or null without any. */
  vectors: Map<string, Float32Array> | null;
  /** The embedding model the vectors were made with; queries must use the same one. */
  vectorModel: string | null;
  /** Per-project centroid of its chunk vectors (meanVector). */
  projectVecs: Map<string, Float32Array>;
  entities: Entities;
  hash: string;
  /** Everything validTarget() accepts. */
  known: KnownTargets;
  /** Slugs with a /projects/<slug> page, for targetHref. */
  caseStudySlugs: string[];
};

let memo: Corpus | null = null;

function loadVectors(chunks: readonly Chunk[]): { vectors: Map<string, Float32Array> | null; model: string | null } {
  const file = vectorFile as unknown as VectorFile;
  if (!file?.model || !file.entries) return { vectors: null, model: null };
  const vectors = new Map<string, Float32Array>();
  for (const c of chunks) {
    const e = file.entries[c.id];
    if (!e || e.hash !== c.hash) continue;
    const v = decodeVec(e);
    if (v.length === file.dims) vectors.set(c.id, v);
  }
  return vectors.size ? { vectors, model: file.model } : { vectors: null, model: null };
}

export function getCorpus(): Corpus {
  if (memo) return memo;
  const certifications = parseCertifications(certificationsRaw);
  const achievements = parseAchievements(achievementsRaw);
  const chunks = buildCorpus({
    profile,
    projects: PROJECTS,
    githubFacts,
    reading,
    tools,
    skillsIndex,
    liveSnapshot: liveSnapshot as CorpusLiveSnapshot,
    siteCopy: SITE_COPY,
    certifications,
    achievements,
  });
  const { vectors, model } = loadVectors(chunks);
  const projectVecs = new Map<string, Float32Array>();
  if (vectors) {
    for (const p of PROJECTS) {
      const own = chunks.filter((c) => c.id.startsWith(`project:${p.slug}#`)).map((c) => vectors.get(c.id));
      const mean = meanVector(own.filter((v): v is Float32Array => Boolean(v)));
      if (mean.length) projectVecs.set(p.slug, mean);
    }
  }
  const skills = [...new Set([...Object.values(profile.skills).flat(), ...skillsIndex.map((s) => s.name)])];
  memo = {
    chunks,
    byId: new Map(chunks.map((c) => [c.id, c])),
    index: buildBm25(chunks),
    vectors,
    vectorModel: model,
    projectVecs,
    entities: entities({ profile, projects: PROJECTS, skills: skillsIndex, reading, certifications, achievements }),
    hash: corpusHash(chunks),
    known: {
      slugs: PROJECTS.map((p) => p.slug),
      skills,
      sections: KNOWN_SECTIONS,
      expCount: profile.experience.length,
      eduCount: profile.education.length,
      readingCount: reading.length,
      tenetCount: SITE_COPY.philosophy.length,
      categories: [...new Set(PROJECTS.map((p) => p.category))],
    },
    caseStudySlugs: PROJECTS.filter(hasCaseStudy).map((p) => p.slug),
  };
  return memo;
}

// Repeated questions (suggested prompts, the palette) reuse their embedding.
const queryVecs = new Lru<Float32Array>(200, 600_000);

/** The query embedding within AI_EMBED_BUDGET_MS, or null (retrieval then goes lexical). */
async function embedQuery(query: string, model: string, dl: Pick<Deadline, 'signal'>): Promise<Float32Array | null> {
  const key = `${model}␟${normalizeQuestion(query)}`;
  const cached = queryVecs.get(key);
  if (cached) return cached;
  const signal = AbortSignal.any([dl.signal, AbortSignal.timeout(AI_EMBED_BUDGET_MS)]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), AI_EMBED_BUDGET_MS);
  });
  try {
    const out = await Promise.race([aiEmbed([query], 'query', { model, dl: { signal } }), late]);
    const vec = out?.[0] ?? null;
    if (vec) queryVecs.set(key, vec);
    return vec;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hybrid retrieval when chunk vectors exist, `embed` is on and the query embeds
 * within its budget; BM25 alone otherwise. `mode` says which one ran.
 */
export async function retrieve(
  query: string,
  opts: { k?: number; filter?: (c: Chunk) => boolean; dl: Pick<Deadline, 'signal'>; embed?: boolean },
): Promise<{ hits: RetrievalHit[]; mode: 'hybrid' | 'lexical' }> {
  const c = getCorpus();
  const k = opts.k ?? 8;
  const queryVec = opts.embed !== false && c.vectors && c.vectorModel ? await embedQuery(query, c.vectorModel, opts.dl) : null;
  const hits = hybrid({
    index: c.index,
    vectors: queryVec ? c.vectors : null,
    queryVec,
    query,
    k,
    filter: opts.filter,
  });
  return { hits, mode: queryVec ? 'hybrid' : 'lexical' };
}
