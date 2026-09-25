/*
 * Exact-text spans. Two jobs share one rule: a phrase counts only where the text
 * actually contains it.
 *
 * - verifySpans() checks the phrases the sentiment model says it weighed against
 *   the visitor's own text. A span is kept where its offsets hold, moved to the
 *   nearest exact occurrence when they don't (models often count code points or
 *   bytes, not UTF-16 units), and dropped when the phrase isn't in the text at
 *   all or would cut a word in half. finalizeVerdict() adds the label, score and
 *   rationale checks, so the route and gen-skills.mjs share one gate.
 * - namesPhrase() and experienceEvidence() find where the site's own text names a
 *   skill, for the skill modal's evidence block and the summaries generated from
 *   it. Matching is case-sensitive except for the first letter, so sentence case
 *   still counts ('semantic chunking' names 'Semantic chunking') while 'React'
 *   never names 'ReAct'.
 *
 * Pure: relative .ts imports only, no JSON, so node --test runs it directly.
 */
import { cleanText, scrubContacts } from './sanitize.ts';

export const VERDICT_LABELS = ['negative', 'neutral', 'positive', 'mixed'] as const;
export type VerdictLabel = (typeof VERDICT_LABELS)[number];

export const SPAN_POLARITIES = ['negative', 'neutral', 'positive'] as const;
export type SpanPolarity = (typeof SPAN_POLARITIES)[number];

export const MAX_SPANS = 8;
export const RATIONALE_MAX = 160;

/** UTF-16 offsets into the analysed text, end exclusive, as JavaScript slices strings. */
export type Span = { text: string; start: number; end: number; polarity: SpanPolarity };

export type GeminiVerdict = { label: VerdictLabel; score: number; rationale: string; aspects: Span[] };

/** POST /api/ai/sentiment success body. */
export type SentimentResponse = GeminiVerdict & {
  model: string;
  /** Model spans that were not in the text and so were not shown. */
  dropped: number;
};

export type LexiconLabel = 'negative' | 'neutral' | 'positive';
export type Agreement = 'agree' | 'differ' | 'disagree';

/* ---------------------------------------------------------------------------
 * Spans
 * ------------------------------------------------------------------------- */

const WORD = /[\p{L}\p{N}]/u;

const isHigh = (cu: number) => cu >= 0xd800 && cu <= 0xdbff;
const isLow = (cu: number) => cu >= 0xdc00 && cu <= 0xdfff;

/** The whole character that ends just before UTF-16 index i. */
function charBefore(s: string, i: number): string {
  if (i <= 0) return '';
  if (i >= 2 && isLow(s.charCodeAt(i - 1)) && isHigh(s.charCodeAt(i - 2))) return s.slice(i - 2, i);
  return s[i - 1] ?? '';
}

/** The whole character that starts at UTF-16 index i. */
function charAt(s: string, i: number): string {
  if (i >= s.length) return '';
  return String.fromCodePoint(s.codePointAt(i) ?? 0);
}

/** A span may not start or end inside a surrogate pair or inside a word. */
function boundaryOk(s: string, start: number, end: number): boolean {
  if (isLow(s.charCodeAt(start)) || (end < s.length && isLow(s.charCodeAt(end)))) return false;
  if (WORD.test(charAt(s, start)) && WORD.test(charBefore(s, start))) return false;
  if (WORD.test(charBefore(s, end)) && WORD.test(charAt(s, end))) return false;
  return true;
}

function occurrences(s: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = s.indexOf(needle); i !== -1; i = s.indexOf(needle, i + 1)) out.push(i);
  return out;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function isPolarity(x: unknown): x is SpanPolarity {
  return typeof x === 'string' && (SPAN_POLARITIES as readonly string[]).includes(x);
}

/**
 * Keeps the spans whose text occurs in `source`, at most MAX_SPANS, sorted by
 * start. Each is placed at the exact occurrence nearest its claimed start (its
 * own offsets when they hold) that respects word boundaries and does not
 * overlap a span already kept; anything else is dropped.
 */
export function verifySpans(source: string, spans: unknown): { kept: Span[]; dropped: number; relocated: number } {
  const list = Array.isArray(spans) ? spans : [];
  if (typeof source !== 'string' || !source) return { kept: [], dropped: list.length, relocated: 0 };

  const kept: Span[] = [];
  let relocated = 0;
  for (const raw of list) {
    if (kept.length >= MAX_SPANS) break;
    if (!isRecord(raw) || typeof raw.text !== 'string' || !isPolarity(raw.polarity)) continue;
    const text = raw.text.trim();
    if (!text || text.length > source.length) continue;

    const lead = raw.text.length - raw.text.trimStart().length;
    const claimed = typeof raw.start === 'number' && Number.isFinite(raw.start) ? raw.start + lead : null;
    const free = occurrences(source, text).filter(
      (at) => boundaryOk(source, at, at + text.length) && !kept.some((k) => at < k.end && k.start < at + text.length),
    );
    if (!free.length) continue;

    const at = claimed === null ? free[0] : free.reduce((best, x) => (Math.abs(x - claimed) < Math.abs(best - claimed) ? x : best));
    if (at !== claimed) relocated += 1;
    kept.push({ text, start: at, end: at + text.length, polarity: raw.polarity });
  }
  kept.sort((a, b) => a.start - b.start);
  return { kept, dropped: list.length - kept.length, relocated };
}

/* ---------------------------------------------------------------------------
 * Verdicts
 * ------------------------------------------------------------------------- */

function isLabel(x: unknown): x is VerdictLabel {
  return typeof x === 'string' && (VERDICT_LABELS as readonly string[]).includes(x);
}

const CANARY = /\bcnry-[0-9a-f]{16}\b/;

/** One plain line of at most `max` characters, cut at a word boundary. */
export function tidyRationale(s: unknown, max = RATIONALE_MAX): string {
  const plain = scrubContacts(cleanText(typeof s === 'string' ? s : ''), { urls: [], emails: [] })
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/**
 * The model's structured reply turned into what the page may show, or null when
 * it cannot be trusted: an unknown label, a missing score, a score whose sign
 * contradicts the label, or a rationale that echoes the prompt's canary.
 */
export function finalizeVerdict(
  source: string,
  raw: unknown,
  opts: { canary?: string } = {},
): { verdict: GeminiVerdict; dropped: number; relocated: number } | null {
  if (!isRecord(raw) || !isLabel(raw.label)) return null;
  if (typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null;
  const score = Math.round(Math.max(-1, Math.min(1, raw.score)) * 100) / 100;
  if ((raw.label === 'positive' && score < 0) || (raw.label === 'negative' && score > 0)) return null;

  const original = typeof raw.rationale === 'string' ? raw.rationale : '';
  if (CANARY.test(original) || (opts.canary && original.includes(opts.canary))) return null;
  const rationale = tidyRationale(original);

  const spans = verifySpans(source, raw.aspects);
  return {
    verdict: { label: raw.label, score, rationale, aspects: spans.kept },
    dropped: spans.dropped,
    relocated: spans.relocated,
  };
}

/** Whether a client-side value has the success body's shape. */
export function isSentimentResponse(x: unknown): x is SentimentResponse {
  if (!isRecord(x) || !isLabel(x.label) || typeof x.score !== 'number' || !Number.isFinite(x.score)) return false;
  if (typeof x.rationale !== 'string' || typeof x.model !== 'string' || !Array.isArray(x.aspects)) return false;
  return x.aspects.every(
    (a) =>
      isRecord(a) && typeof a.text === 'string' && Number.isInteger(a.start) && Number.isInteger(a.end) && isPolarity(a.polarity),
  );
}

/**
 * How the lexicon's verdict compares with the model's: the same label agrees,
 * opposite polarities disagree, and anything involving neutral or mixed differs.
 */
export function agreement(lexicon: LexiconLabel, model: VerdictLabel): Agreement {
  if (lexicon === model) return 'agree';
  if ((lexicon === 'positive' && model === 'negative') || (lexicon === 'negative' && model === 'positive')) return 'disagree';
  return 'differ';
}

/* ---------------------------------------------------------------------------
 * Where the site names a skill
 * ------------------------------------------------------------------------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `text` names `phrase` as a whole word or phrase: exact, except that
 * the first letter may differ in case. 'ReAct' never matches 'React', and 'Git'
 * never matches inside 'GitHub'.
 */
export function namesPhrase(text: string, phrase: string): boolean {
  if (typeof text !== 'string' || typeof phrase !== 'string') return false;
  const p = phrase.trim();
  if (!p) return false;
  const first = charAt(p, 0);
  const rest = p.slice(first.length);
  const lower = first.toLowerCase();
  const upper = first.toUpperCase();
  const head = lower === upper ? escapeRe(first) : `(?:${escapeRe(lower)}|${escapeRe(upper)})`;
  return new RegExp(`(?<![\\p{L}\\p{N}])${head}${escapeRe(rest)}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

export type RoleLike = { company: string; role: string; description?: string; highlights?: readonly string[] };
export type RoleEvidence = { index: number; company: string; role: string; lines: string[] };

/** A role description split into sentences. */
export function sentencesOf(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The roles whose highlights or description name `skill`, with up to `maxLines`
 * of those lines each (highlights first), in profile order.
 */
export function experienceEvidence(experience: readonly RoleLike[], skill: string, maxLines = 2): RoleEvidence[] {
  const out: RoleEvidence[] = [];
  experience.forEach((role, index) => {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const line of [...(role.highlights ?? []), ...sentencesOf(role.description)]) {
      if (lines.length >= maxLines) break;
      if (seen.has(line) || !namesPhrase(line, skill)) continue;
      seen.add(line);
      lines.push(line);
    }
    if (lines.length) out.push({ index, company: role.company, role: role.role, lines });
  });
  return out;
}

/** Evidence ids for a skill ('project:<slug>', 'exp:<i>'), sorted, as the summaries store them. */
export function evidenceIds(projectSlugs: readonly string[], roles: readonly Pick<RoleEvidence, 'index'>[]): string[] {
  return [...projectSlugs.map((s) => `project:${s}`), ...roles.map((r) => `exp:${r.index}`)].sort();
}
