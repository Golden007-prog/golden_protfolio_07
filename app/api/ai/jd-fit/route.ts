import { z } from 'zod';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import { AI_EMBED_BUDGET_MS, AI_LIMITS } from '@/lib/ai/config';
import { packContext } from '@/lib/ai/context';
import { getCorpus, type Corpus } from '@/lib/ai/corpus.server';
import {
  cleanRequirements,
  isFactRequirement,
  JD_BODY_BYTES,
  lexicalEvidenceFor,
  rankProjectsByOverlap,
  REQ_CATEGORIES,
  REQ_KINDS,
  verifyFitRows,
  vocabulary,
  withLabels,
  type FitData,
  type FitResponse,
  type ModelFitRow,
  type TopProject,
} from '@/lib/ai/fit';
import { aiEmbed, aiGenerate, deadline, isFallback, type Deadline } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { newCanary } from '@/lib/ai/prompts/base';
import { fitSystem, fitUserTurn } from '@/lib/ai/prompts/fit';
import { redact } from '@/lib/ai/redact';
import { cosine } from '@/lib/ai/retrieval';
import { quoteOk } from '@/lib/ai/verify';
import { fallback, logAi } from '@/lib/ai/respond.server';

export const maxDuration = 30;

const requirementSchema = z.strictObject({
  text: z.string().trim().min(1).max(AI_LIMITS.requirement),
  kind: z.enum(REQ_KINDS),
  category: z.enum(REQ_CATEGORIES).optional(),
  gloss: z.string().trim().max(AI_LIMITS.requirement).optional(),
});

const bodySchema = z.strictObject({
  jd: z.string().trim().min(1).max(AI_LIMITS.jd),
  requirements: z.array(requirementSchema).min(1).max(AI_LIMITS.jdRequirements),
});

const modelSchema = z.object({
  rows: z
    .array(
      z.object({
        index: z.number().int().min(0).max(AI_LIMITS.jdRequirements - 1),
        status: z.enum(['evidenced', 'adjacent', 'not-listed']),
        evidence: z.array(z.object({ id: z.string(), quote: z.string() })).max(3),
        synonym: z.string().optional(),
      }),
    )
    .max(AI_LIMITS.jdRequirements),
  projects: z.array(z.object({ slug: z.string(), quote: z.string() })).max(3),
});
type ModelOut = { rows: ModelFitRow[]; projects: { slug: string; quote: string }[] };

const DATA: FitData = { profile, projects: PROJECTS };
const VOCAB = vocabulary(DATA);
const EMBED_MIN_CHARS = 200;
// The embedding model reads about 2,048 tokens; the head of a JD carries the role.
const EMBED_MAX_CHARS = 6000;

/**
 * Projects for this JD: cosine similarity between one JD embedding and each
 * project's centroid, or lexical tech overlap when the JD is short, there are no
 * vectors, or the embedding misses its budget.
 */
async function rankProjects(jd: string, corpus: Corpus, dl: Deadline): Promise<{ projects: TopProject[]; by: FitResponse['rankedBy'] }> {
  if (jd.length >= EMBED_MIN_CHARS && corpus.vectorModel && corpus.projectVecs.size > 0) {
    const signal = AbortSignal.any([dl.signal, AbortSignal.timeout(AI_EMBED_BUDGET_MS)]);
    const vecs = await aiEmbed([redact(jd).text.slice(0, EMBED_MAX_CHARS)], 'query', { model: corpus.vectorModel, dl: { signal } }).catch(() => null);
    const q = vecs?.[0];
    if (q) {
      const ranked = [...corpus.projectVecs].map(([slug, v]) => ({ slug, score: cosine(q, v) })).sort((a, b) => b.score - a.score);
      return { projects: ranked.slice(0, 3).map((r) => ({ slug: r.slug, quote: null, id: null })), by: 'embedding' };
    }
  }
  const lexical = rankProjectsByOverlap(jd, PROJECTS).slice(0, 3);
  return { projects: lexical.map((r) => ({ slug: r.slug, quote: null, id: null, overlap: r.overlap })), by: 'lexical' };
}

/** A one-line reason must be a verbatim quote from that project's own chunks. */
function projectReason(slug: string, quote: string | undefined, corpus: Corpus): { quote: string; id: string } | null {
  if (!quote?.trim()) return null;
  for (const c of corpus.chunks) {
    if (c.id.startsWith(`project:${slug}#`) && quoteOk(quote, c.text)) return { quote: quote.trim(), id: c.id };
  }
  return null;
}

/**
 * POST /api/ai/jd-fit {jd, requirements} -> FitResponse. One chat-tier call over
 * the full self corpus; years, location, visa and other logistics requirements
 * never reach it (facts.ts answers them on the client). Rows are verified before
 * they leave: unknown ids and non-verbatim quotes drop a row, an 'evidenced'
 * quote that doesn't name the requirement is downgraded, and more than 30%
 * dropped answers 'unverified'. The band is computed on the client from the rows.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'jd-fit', { schema: bodySchema, maxBytes: JD_BODY_BYTES });
  if (!g.ok) return g.res;
  const dl = deadline(req.signal);

  try {
    const corpus = getCorpus();
    const requirements = cleanRequirements(g.body.requirements).map((r) => ({
      ...r,
      text: redact(r.text).text,
      ...(r.gloss ? { gloss: redact(r.gloss).text } : {}),
    }));
    const matchable = requirements.filter((r) => !isFactRequirement(r));
    const ranked = await rankProjects(g.body.jd, corpus, dl);

    if (matchable.length === 0) {
      logAi({ feature: 'jd-fit', ms: Date.now() - started });
      const body: FitResponse = { rows: [], projects: ranked.projects, rankedBy: ranked.by, dropped: 0, model: null };
      return Response.json(body, { headers: { 'cache-control': 'no-store' } });
    }

    const packed = packContext({ chunks: corpus.chunks, byId: corpus.byId, hits: [], mode: 'full' });
    const names = ranked.projects.map((p) => ({ slug: p.slug, name: PROJECTS.find((x) => x.slug === p.slug)?.name ?? p.slug }));
    const out = await aiGenerate<ModelOut>({
      feature: 'jd-fit',
      system: fitSystem({ context: packed.text, canary: newCanary() }),
      contents: [{ role: 'user', parts: [{ text: fitUserTurn(matchable, names) }] }],
      schema: modelSchema,
      dl,
    });
    if (isFallback(out)) {
      logAi({ feature: 'jd-fit', ms: Date.now() - started, reason: out.reason });
      return fallback(out.reason, out.retryAfterSec ? { retryAfterSec: out.retryAfterSec } : undefined);
    }
    const data = out.data ?? { rows: [], projects: [] };

    const verified = verifyFitRows({
      rows: data.rows,
      requirements: matchable,
      facts: packed.facts,
      entities: corpus.entities,
      vocab: VOCAB,
      lexical: (r) => lexicalEvidenceFor(r, DATA, VOCAB),
    });
    if (verified.discarded) {
      logAi({ feature: 'jd-fit', model: out.model, ms: Date.now() - started, usage: out.usage, dropped: verified.dropped, reason: 'unverified' });
      return fallback('unverified');
    }

    const reasons = new Map(data.projects.map((p) => [p.slug, p.quote]));
    const body: FitResponse = {
      rows: verified.rows.map((r) => ({ ...r, evidence: withLabels(r.evidence, corpus.byId, corpus.known) })),
      projects: ranked.projects.map((p) => {
        const reason = projectReason(p.slug, reasons.get(p.slug), corpus);
        return { ...p, quote: reason?.quote ?? null, id: reason?.id ?? null };
      }),
      rankedBy: ranked.by,
      dropped: verified.dropped,
      model: out.model,
    };
    logAi({ feature: 'jd-fit', model: out.model, ms: Date.now() - started, usage: out.usage, dropped: verified.dropped });
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] jd-fit failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'jd-fit', ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
