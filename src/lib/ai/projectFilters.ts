import { AI_LIMITS } from './config.ts';
import { techFamily } from '../tech.ts';

/*
 * Natural-language project filters (#202) and the related-work search (#203).
 * The model may only ever produce a filter: the route asks for an enum-constrained
 * reading, and validateFilters() re-checks it against the site's own categories
 * and technologies before anything reaches the URL. `q` may only reuse the
 * visitor's own words, so the model cannot put new text on the page.
 *
 * Pure: relative .ts imports only, no JSON, so node --test runs it directly.
 */

/** The longest free-text part of a reading. */
export const FILTER_Q_MAX = 60;
export const FILTER_PHRASE_MAX = AI_LIMITS.filterPhrase;

export type FilterVocab = { categories: readonly string[]; techs: readonly string[] };

/** What the model understood; every field is one the grid can apply. */
export type FilterReading = { cat: string | null; tech: string | null; live: boolean; q: string | null };

export type ProjectFiltersRequest = { phrase: string };
export type ProjectFiltersResponse = { mode: 'model'; model: string; reading: FilterReading };

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}+#.-]+/u)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ''))
    .filter(Boolean);

function pick(value: unknown, names: readonly string[]): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  return names.find((n) => n.toLowerCase() === v) ?? null;
}

function pickTech(value: unknown, techs: readonly string[]): string | null {
  const exact = pick(value, techs);
  if (exact || typeof value !== 'string') return exact;
  // 'Gemini 2.0 Flash' is a stack entry; the grid filters by its family, 'Gemini'.
  return pick(techFamily(value.trim()), techs);
}

function cleanQ(value: unknown, phrase: string, taken: readonly (string | null)[]): string | null {
  if (typeof value !== 'string') return null;
  const q = value
    .replace(/[\u0000-\u001F\u007F<>{}[\]`"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!q || q.length > FILTER_Q_MAX) return null;
  const own = new Set(words(phrase));
  const qWords = words(q);
  // Only the visitor's own words, so the reading can never add text of its own.
  if (!qWords.length || !qWords.every((w) => own.has(w))) return null;
  if (taken.some((t) => t && t.toLowerCase() === q.toLowerCase())) return null;
  return q;
}

/**
 * The model's reading made safe: a category and technology that exist on the
 * site (a stack entry maps to its family), live only when true, and q only when
 * every word of it is in the phrase. Null when nothing usable is left.
 */
export function validateFilters(raw: unknown, vocab: FilterVocab, phrase: string): FilterReading | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cat = pick(r.cat, vocab.categories);
  const tech = pickTech(r.tech, vocab.techs);
  const live = r.live === true;
  const q = cleanQ(r.q, phrase, [cat, tech]);
  if (!cat && !tech && !live && !q) return null;
  return { cat, tech, live, q };
}

/**
 * Whether Enter should ask the model: a phrase of two words or more, or any
 * search the plain text match found nothing for. One word that already matches
 * stays a free lexical search.
 */
export function shouldAskAi(text: string, lexicalMatches: number): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > FILTER_PHRASE_MAX) return false;
  return words(t).length >= 2 || lexicalMatches === 0;
}

export type ReadingKey = 'cat' | 'tech' | 'live' | 'q';

/** The 'Understood as' chips, one per field the reading sets. */
export function readingChips(r: FilterReading): { key: ReadingKey; label: string; name: string }[] {
  const out: { key: ReadingKey; label: string; name: string }[] = [];
  if (r.cat) out.push({ key: 'cat', label: r.cat, name: `Category ${r.cat}` });
  if (r.tech) out.push({ key: 'tech', label: r.tech, name: `Technology ${r.tech}` });
  if (r.live) out.push({ key: 'live', label: 'Live demo', name: 'Live demo only' });
  if (r.q) out.push({ key: 'q', label: `“${r.q}”`, name: `Text ${r.q}` });
  return out;
}

/** The reading without one field. */
export function withoutKey(r: FilterReading, key: ReadingKey): FilterReading {
  return { ...r, [key]: key === 'live' ? false : null };
}

/** The action-runner filter action for a reading: it replaces all four params. */
export function toFilterAction(r: FilterReading): { kind: 'filter'; cat?: string; tech?: string; live?: boolean; q?: string } {
  return {
    kind: 'filter',
    ...(r.cat ? { cat: r.cat } : {}),
    ...(r.tech ? { tech: r.tech } : {}),
    ...(r.live ? { live: true } : {}),
    ...(r.q ? { q: r.q } : {}),
  };
}

/** True while the grid still shows exactly this reading. */
export function readingMatches(r: FilterReading, f: { q: string; cat: string | null; tech: string | null; live: boolean }): boolean {
  return (r.q ?? '') === f.q && r.cat === f.cat && r.tech === f.tech && r.live === f.live;
}

/* ---------------------------------------------------------------------------
 * #203 Related work for an empty grid
 * ------------------------------------------------------------------------- */

/** The current filters as one search query. */
export function filterQuery(f: { q: string; cat: string | null; tech: string | null; live: boolean }): string {
  return [f.q, f.cat, f.tech, f.live ? 'live demo' : ''].map((s) => (s ?? '').trim()).filter(Boolean).join(' ').slice(0, AI_LIMITS.retrieveQuery);
}

type Rankable = { slug: string; name: string; tagline: string; techStack: readonly string[]; topics: readonly string[]; category: string };

/**
 * A client-side stand-in for /api/ai/retrieve when it cannot be reached: projects
 * ranked by how many query words they contain anywhere (the grid itself needs
 * every word). Words of two letters or fewer are ignored.
 */
export function looseRank<P extends Rankable>(items: readonly P[], query: string, limit = 3): P[] {
  const terms = [...new Set(words(query).filter((w) => w.length > 2))];
  if (!terms.length) return [];
  return items
    .map((p, i) => {
      const text = [p.name, p.tagline, p.category, ...p.techStack, ...p.topics].join(' ').toLowerCase();
      return { p, i, score: terms.filter((t) => text.includes(t)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}
