/*
 * A tiny lexicon sentiment model for the in-browser demo. Pure and dependency-free,
 * so node --test can run it directly.
 *
 * Each lexicon word scores ±1. A negator up to three words earlier in the same
 * clause flips and damps it (×-0.75, as in VADER); an intensifier up to two words
 * earlier multiplies it by 1.6. Clauses end at punctuation and at 'but'.
 */

export type Polarity = 'positive' | 'neutral' | 'negative';

export type SentimentHit = {
  /** The word as typed. */
  word: string;
  /** UTF-16 offsets into the analysed text. */
  start: number;
  end: number;
  /** Lexicon polarity before modifiers. */
  base: 1 | -1;
  /** Contribution to the raw score after modifiers. */
  weight: number;
  negated: boolean;
  intensified: boolean;
};

export type SentimentResult = {
  label: Polarity;
  /** Normalised to [-1, 1]. */
  score: number;
  hits: SentimentHit[];
  words: number;
};

export const NEGATION_FACTOR = -0.75;
export const INTENSIFIER_FACTOR = 1.6;
const NEGATION_WINDOW = 3;
const INTENSIFIER_WINDOW = 2;
const LABEL_THRESHOLD = 0.12;

const POSITIVE = new Set([
  'love', 'great', 'awesome', 'amazing', 'excellent', 'fantastic', 'brilliant', 'happy', 'good', 'better',
  'wonderful', 'beautiful', 'perfect', 'best', 'enjoy', 'delighted', 'thrilled', 'win', 'elegant', 'smooth',
  'fast', 'clean', 'accurate', 'reliable', 'robust', 'helpful', 'useful', 'easy', 'intuitive', 'impressive',
  'nice', 'fun', 'solid', 'stable',
]);

const NEGATIVE = new Set([
  'hate', 'terrible', 'awful', 'bad', 'poor', 'worst', 'worse', 'horrible', 'sad', 'angry', 'broken', 'slow',
  'buggy', 'bug', 'ugly', 'frustrating', 'frustrated', 'disappointing', 'disappointed', 'mess', 'messy', 'fail',
  'failure', 'crash', 'laggy', 'lag', 'confusing', 'confused', 'painful', 'annoying', 'annoyed', 'useless',
  'unreliable', 'unstable', 'flaky', 'error',
]);

/** Inflections the suffix rules cannot reach. */
const IRREGULAR: Record<string, string> = { broke: 'broken' };

const NEGATORS = new Set([
  'not', 'no', 'never', 'none', 'nothing', 'nobody', 'nowhere', 'neither', 'nor', 'without', 'cannot', 'hardly',
  'barely',
  // Contractions typed without the apostrophe.
  'dont', 'doesnt', 'didnt', 'isnt', 'arent', 'wasnt', 'werent', 'cant', 'couldnt', 'wont', 'wouldnt',
  'shouldnt', 'havent', 'hasnt', 'hadnt', 'aint', 'neednt', 'mustnt',
]);

const INTENSIFIERS = new Set([
  'very', 'really', 'extremely', 'super', 'so', 'incredibly', 'absolutely', 'totally', 'truly', 'highly',
  'insanely', 'seriously', 'blazing',
]);

const CLAUSE_BREAKS = new Set(['but']);

// Curly and prime apostrophes are single UTF-16 units, so offsets survive the swap.
const APOSTROPHES = /[‘’ʼ′＇]/g;

export function normalizeQuotes(text: string): string {
  return text.replace(APOSTROPHES, "'");
}

function isNegator(word: string): boolean {
  return NEGATORS.has(word) || word.endsWith("n't");
}

function polarityOf(word: string): 1 | -1 | 0 {
  if (POSITIVE.has(word)) return 1;
  if (NEGATIVE.has(word)) return -1;
  return 0;
}

/** Candidate base forms for an inflected word: 'loving' -> love, 'crashes' -> crash, 'happily' -> happy. */
function stems(word: string): string[] {
  const out: string[] = [];
  const irregular = IRREGULAR[word];
  if (irregular) out.push(irregular);
  if (/(?:ied|ies|ily)$/.test(word)) out.push(`${word.slice(0, -3)}y`);
  for (const suffix of ['ing', 'ed', 'es', 's', 'ly', 'er', 'est']) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 3) continue;
    const base = word.slice(0, -suffix.length);
    out.push(base, `${base}e`);
    // stopping -> stop, laggy is already a lexicon word
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) out.push(base.slice(0, -1));
  }
  return out;
}

/** Lexicon polarity of one lower-case word, trying its stems when the word itself is unknown. */
export function lookup(word: string): 1 | -1 | 0 {
  const w = normalizeQuotes(word).toLowerCase();
  const direct = polarityOf(w);
  if (direct) return direct;
  for (const stem of stems(w)) {
    const p = polarityOf(stem);
    if (p) return p;
  }
  return 0;
}

type Token = { word: string; lower: string; start: number; end: number; clause: number };

const TOKEN = /[A-Za-z]+(?:'[A-Za-z]+)*|[.!?;:,–—]/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let clause = 0;
  for (const m of normalizeQuotes(text).matchAll(TOKEN)) {
    const raw = m[0];
    const start = m.index ?? 0;
    if (!/[A-Za-z]/.test(raw)) {
      clause++;
      continue;
    }
    const lower = raw.toLowerCase();
    if (CLAUSE_BREAKS.has(lower)) {
      clause++;
      continue;
    }
    tokens.push({ word: text.slice(start, start + raw.length), lower, start, end: start + raw.length, clause });
  }
  return tokens;
}

function hasBefore(tokens: Token[], i: number, window: number, test: (w: string) => boolean): boolean {
  for (let j = i - 1; j >= Math.max(0, i - window); j--) {
    if (tokens[j].clause !== tokens[i].clause) return false;
    if (test(tokens[j].lower)) return true;
  }
  return false;
}

export function analyze(text: string): SentimentResult {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { label: 'neutral', score: 0, hits: [], words: 0 };

  let raw = 0;
  const hits: SentimentHit[] = [];
  tokens.forEach((t, i) => {
    const base = lookup(t.lower);
    if (!base) return;
    const intensified = hasBefore(tokens, i, INTENSIFIER_WINDOW, (w) => INTENSIFIERS.has(w));
    const negated = hasBefore(tokens, i, NEGATION_WINDOW, isNegator);
    let weight: number = base;
    if (intensified) weight *= INTENSIFIER_FACTOR;
    if (negated) weight *= NEGATION_FACTOR;
    raw += weight;
    hits.push({ word: t.word, start: t.start, end: t.end, base, weight, negated, intensified });
  });

  const score = Math.max(-1, Math.min(1, raw / Math.max(3, tokens.length / 2)));
  const label: Polarity = score > LABEL_THRESHOLD ? 'positive' : score < -LABEL_THRESHOLD ? 'negative' : 'neutral';
  return { label, score, hits, words: tokens.length };
}
