/*
 * Scope rules and the context packer. Every scope kind is implemented here once,
 * so no feature package re-implements one:
 *   project:    its own chunks, its GitHub facts, and the skills in its stack
 *               (their reference chunks and the skill lists that name them);
 *   skill:      projects whose techStack matchesTech the exact skill, experience
 *               chunks naming it (exact but for the first letter's case, as the
 *               skill modal cites them; ReAct is still not React),
 *               its skill list, and its ref: chunk, which stays 'reference';
 *   experience: exp:<i> and its highlights and metrics only;
 *   section:    chunks whose target lives in that section.
 *
 * Pure: relative .ts imports only.
 */
import { sectionOf } from './actions.ts';
import { CORE_CARD_IDS, type Chunk } from './corpus.ts';
import { untrusted } from './prompts/base.ts';
import type { AiSource, AskScope, RetrievalHit } from './protocol.ts';
import { GATE, relevant, type GateThreshold } from './retrieval.ts';
import { namesPhrase } from './spans.ts';
import { slugify } from '../slug.ts';
import { matchesTech } from '../tech.ts';

export type ScopeData = {
  projects: readonly { slug: string; techStack: readonly string[] }[];
  profile: { skills: Readonly<Record<string, readonly string[]>> };
};

/** A predicate for the chunks a scope may draw on; everything passes without a scope. */
export function scopeFilter(scope: AskScope | null | undefined, data: ScopeData): (c: Chunk) => boolean {
  if (!scope) return () => true;
  const listed = Object.entries(data.profile.skills);

  if ('project' in scope) {
    const project = data.projects.find((p) => p.slug === scope.project);
    if (!project) return () => false;
    const skills = listed.flatMap(([, list]) => list).filter((s) => matchesTech(project.techStack, s));
    const refs = new Set(skills.map((s) => `ref:${slugify(s)}`));
    const lists = new Set(listed.filter(([, list]) => list.some((s) => skills.includes(s))).map(([cat]) => `skills:${slugify(cat)}`));
    const own = `project:${project.slug}#`;
    return (c) => c.id.startsWith(own) || c.id === `facts:${project.slug}` || refs.has(c.id) || lists.has(c.id);
  }

  if ('skill' in scope) {
    const skill = scope.skill.trim();
    if (!skill) return () => false;
    const slugs = new Set(data.projects.filter((p) => matchesTech(p.techStack, skill)).map((p) => p.slug));
    const ref = `ref:${slugify(skill)}`;
    const lists = new Set(listed.filter(([, list]) => list.includes(skill)).map(([cat]) => `skills:${slugify(cat)}`));
    return (c) => {
      if (c.id === ref || lists.has(c.id)) return true;
      if (c.id.startsWith('exp:')) return namesPhrase(c.text, skill);
      if (c.id.startsWith('project:') || c.id.startsWith('facts:')) {
        return c.target.kind === 'project' && slugs.has(c.target.slug);
      }
      return false;
    };
  }

  if ('experience' in scope) {
    const own = `exp:${scope.experience}`;
    return (c) => c.id === own || c.id.startsWith(`${own}#`);
  }

  if ('section' in scope) {
    return (c) => sectionOf(c.target) === scope.section;
  }

  return () => false;
}

/** The chunks a scoped question always sees, even when retrieval misses them. */
function scopeAnchors(scope: AskScope | null | undefined): string[] {
  if (!scope) return [];
  if ('project' in scope) return [`project:${scope.project}#tagline`, `project:${scope.project}#summary`];
  if ('experience' in scope) return [`exp:${scope.experience}`];
  if ('skill' in scope) return [`ref:${slugify(scope.skill)}`];
  return [];
}

/** Rough token count: about four characters per token for this English corpus. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function block(c: Chunk): string {
  if (!c.untrusted) return `[c:${c.id}] ${c.title}\n${c.text}`;
  const note =
    c.cls === 'reference'
      ? 'reference: describes the technology in general, not his use of it'
      : `live data${c.asOf ? ` as of ${c.asOf}` : ''}`;
  return untrusted(`c:${c.id} (${c.cls})`, `[c:${c.id}] ${c.title} (${note})\n${c.text}`);
}

function source(c: Chunk): AiSource {
  const s: AiSource = { id: c.id, label: c.label, cls: c.cls, target: c.target };
  if (c.asOf) s.asOf = c.asOf;
  return s;
}

/** [r0, r1, r2, r3, r4] -> [r0, r2, r4, r3, r1]: the strongest chunks sit first and last. */
function edgesFirst<T>(ranked: readonly T[]): T[] {
  const front: T[] = [];
  const back: T[] = [];
  ranked.forEach((x, i) => (i % 2 === 0 ? front : back).push(x));
  return [...front, ...back.reverse()];
}

export type PackedContext = {
  text: string;
  sources: AiSource[];
  /** The only citation ids an answer may use. */
  allowed: Set<string>;
  /** id -> chunk text, for the tripwire. */
  facts: Map<string, string>;
};

/**
 * The CONTEXT block for a prompt.
 * - 'retrieval': the core card, then the scope's anchor chunks, the prior answer's
 *   citations that still exist, and the hits in rank order, filled to about
 *   budgetTokens and arranged so the strongest sit first and last. Untrusted
 *   chunks are wrapped as data. `filter` (usually scopeFilter) drops hits outside
 *   the scope.
 * - 'full' (jd-fit): every 'self' chunk in corpus order, no budget.
 */
export function packContext(opts: {
  chunks: readonly Chunk[];
  byId: ReadonlyMap<string, Chunk>;
  hits: readonly Pick<RetrievalHit, 'id'>[];
  scope?: AskScope | null;
  prevCited?: readonly string[];
  mode: 'retrieval' | 'full';
  budgetTokens?: number;
  filter?: (c: Chunk) => boolean;
}): PackedContext {
  const { byId, mode } = opts;
  const budget = opts.budgetTokens ?? 3000;
  let chosen: Chunk[];

  if (mode === 'full') {
    chosen = opts.chunks.filter((c) => c.cls === 'self');
  } else {
    const core = CORE_CARD_IDS.map((id) => byId.get(id)).filter((c): c is Chunk => Boolean(c));
    const coreIds = new Set(core.map((c) => c.id));
    let used = core.reduce((n, c) => n + estimateTokens(block(c)) + 1, 0);

    const pinned = [...scopeAnchors(opts.scope), ...(opts.prevCited ?? [])];
    const ranked: Chunk[] = [];
    const seen = new Set(coreIds);
    const take = (id: string, pinnedChunk: boolean) => {
      const c = byId.get(id);
      if (!c || seen.has(id)) return;
      if (!pinnedChunk && opts.filter && !opts.filter(c)) return;
      const cost = estimateTokens(block(c)) + 1;
      if (used + cost > budget) return;
      seen.add(id);
      used += cost;
      ranked.push(c);
    };
    for (const id of pinned) take(id, true);
    for (const h of opts.hits) take(h.id, false);
    chosen = [...core, ...edgesFirst(ranked)];
  }

  return {
    text: chosen.map(block).join('\n\n'),
    sources: chosen.map(source),
    allowed: new Set(chosen.map((c) => c.id)),
    facts: new Map(chosen.map((c) => [c.id, c.text])),
  };
}

/** True when a 'self' chunk is among the hits and clears the threshold; reference and live hits never count. */
export function passesGate(
  hits: readonly Pick<RetrievalHit, 'id' | 'bm25' | 'cosine'>[],
  byId: ReadonlyMap<string, Pick<Chunk, 'cls'>>,
  threshold: GateThreshold = GATE,
): boolean {
  return hits.some((h) => byId.get(h.id)?.cls === 'self' && relevant(h, threshold));
}
