/*
 * Retrieval over the grounding corpus: BM25, int8 vector codec, cosine, reciprocal
 * rank fusion, and hybrid() which fuses the two and degrades to BM25 alone when
 * there are no vectors. meanVector() is the one per-project vector implementation
 * (jd-fit, project neighbours and the explorer all call it).
 *
 * Pure: relative .ts imports, no JSON, usable from routes, scripts and node --test.
 */
import type { EvidenceClass, RetrievalHit } from './protocol.ts';
import { techFamily } from '../tech.ts';

/* ---------------------------------------------------------------------------
 * Tokenizer
 * ------------------------------------------------------------------------- */

/**
 * Tech names whose lower-case form is a different technology. They keep their
 * case as tokens, exactly as tech.ts keeps them apart as families: techFamily
 * ('ReAct') is 'ReAct' and never 'React', so 'ReAct agents' must not match a
 * React 19 stack. Everything else is case-folded ('urbancare' finds UrbanCare).
 */
export const CASE_SENSITIVE_TERMS: ReadonlySet<string> = new Set(['ReAct']);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'him', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my', 'of',
  'on', 'or', 'our', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'to', 'tell', 'us', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'whom', 'why', 'will', 'with',
  'would', 'you', 'your', 'about', 'any', 'some', 'show', 'please',
]);

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Search tokens: case-folded and lightly stemmed words, plus the tech family of names like 'MedGemma' ('gemma'). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.normalize('NFKC').matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = m[0];
    if (CASE_SENSITIVE_TERMS.has(word)) {
      out.push(word);
      continue;
    }
    const lower = word.toLowerCase();
    if (STOPWORDS.has(lower) || (lower.length < 2 && !/\d/.test(lower))) continue;
    const token = /^\d/.test(lower) ? lower : stem(lower);
    out.push(token);
    const family = techFamily(word);
    if (family !== word) {
      for (const f of family.split(/\s+/)) {
        const t = f.toLowerCase();
        if (t && t !== token && !STOPWORDS.has(t)) out.push(t);
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * BM25
 * ------------------------------------------------------------------------- */

export type IndexDoc = { id: string; title: string; text: string; cls: EvidenceClass };

export type Bm25Index<C extends IndexDoc = IndexDoc> = {
  docs: readonly C[];
  tf: Map<string, number>[];
  len: number[];
  avgLen: number;
  df: Map<string, number>;
};

const K1 = 1.2;
const B = 0.75;

export function buildBm25<C extends IndexDoc>(chunks: readonly C[]): Bm25Index<C> {
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const c of chunks) {
    const tokens = [...tokenize(c.title), ...tokenize(c.text)];
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const t of counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(counts);
    len.push(tokens.length);
  }
  const avgLen = len.length ? len.reduce((a, b) => a + b, 0) / len.length : 0;
  return { docs: chunks, tf, len, avgLen, df };
}

function idf(index: Bm25Index<IndexDoc>, term: string): number {
  const n = index.docs.length;
  const d = index.df.get(term) ?? 0;
  return Math.log(1 + (n - d + 0.5) / (d + 0.5));
}

export type Bm25Hit = { id: string; score: number; /** score over the best score this query could reach, 0..1 */ norm: number };

/**
 * Top-k documents for `q`, best first; ties keep corpus order. `norm` divides by
 * the score a document matching every query term would reach, with terms absent
 * from the corpus counted at full weight, so an off-topic question scores low.
 */
export function bm25<C extends IndexDoc>(index: Bm25Index<C>, q: string, k: number, filter?: (c: C) => boolean): Bm25Hit[] {
  const terms = [...new Set(tokenize(q))];
  if (!terms.length || !index.docs.length) return [];
  const weights = terms.map((t) => idf(index as Bm25Index<IndexDoc>, t));
  const ceiling = weights.reduce((a, w) => a + w * (K1 + 1), 0);
  const scored: { i: number; score: number }[] = [];
  index.docs.forEach((doc, i) => {
    if (filter && !filter(doc)) return;
    let score = 0;
    const counts = index.tf[i];
    const norm = 1 - B + (B * index.len[i]) / (index.avgLen || 1);
    terms.forEach((t, j) => {
      const f = counts.get(t);
      if (f) score += (weights[j] * f * (K1 + 1)) / (f + K1 * norm);
    });
    if (score > 0) scored.push({ i, score });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, Math.max(0, k)).map(({ i, score }) => ({
    id: index.docs[i].id,
    score: round(score),
    norm: round(Math.min(1, score / (ceiling || 1))),
  }));
}

function round(n: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/* ---------------------------------------------------------------------------
 * Vectors
 * ------------------------------------------------------------------------- */

export type EncodedVec = { s: number; v: string };

/** Symmetric int8 quantisation: s = max|x| / 127, v = base64 of the int8 values. */
export function encodeVec(vec: Float32Array): EncodedVec {
  let max = 0;
  for (const x of vec) max = Math.max(max, Math.abs(x));
  const s = max > 0 ? max / 127 : 1;
  let bin = '';
  for (const x of vec) {
    const q = Math.max(-127, Math.min(127, Math.round(x / s)));
    bin += String.fromCharCode(q & 0xff);
  }
  return { s, v: btoa(bin) };
}

export function decodeVec(e: EncodedVec): Float32Array {
  const bin = atob(e.v);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const b = bin.charCodeAt(i);
    out[i] = (b > 127 ? b - 256 : b) * e.s;
  }
  return out;
}

/** Cosine similarity; 0 for mismatched lengths or a zero vector. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * The unit-length mean of vectors of one length (others are skipped); an empty
 * Float32Array when there is nothing to average. The single implementation of a
 * per-project vector.
 */
export function meanVector(vecs: readonly Float32Array[]): Float32Array {
  const first = vecs.find((v) => v.length > 0);
  if (!first) return new Float32Array(0);
  const out = new Float32Array(first.length);
  let n = 0;
  for (const v of vecs) {
    if (v.length !== first.length) continue;
    for (let i = 0; i < v.length; i++) out[i] += v[i];
    n += 1;
  }
  let norm = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] /= n;
    norm += out[i] * out[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/* ---------------------------------------------------------------------------
 * Fusion
 * ------------------------------------------------------------------------- */

/**
 * Reciprocal rank fusion: score(id) = Σ 1 / (k + rank). Ties break on the best
 * single rank, then the id, so the order never depends on Map iteration.
 */
export function rrf(lists: readonly (readonly string[])[], k = 60): { id: string; score: number }[] {
  const acc = new Map<string, { score: number; best: number }>();
  for (const list of lists) {
    list.forEach((id, i) => {
      const rank = i + 1;
      const cur = acc.get(id) ?? { score: 0, best: Infinity };
      cur.score += 1 / (k + rank);
      cur.best = Math.min(cur.best, rank);
      acc.set(id, cur);
    });
  }
  return [...acc.entries()]
    .sort(([ia, a], [ib, b]) => b.score - a.score || a.best - b.best || (ia < ib ? -1 : ia > ib ? 1 : 0))
    .map(([id, v]) => ({ id, score: round(v.score, 6) }));
}

/**
 * BM25 fused with cosine similarity when both the chunk vectors and a query
 * vector exist; BM25 alone otherwise. `bm25` on each hit is the normalised lexical
 * score (0..1), `cosine` is null without vectors, `score` is the fused RRF score.
 */
export function hybrid<C extends IndexDoc>(opts: {
  index: Bm25Index<C>;
  vectors?: ReadonlyMap<string, Float32Array> | null;
  queryVec?: Float32Array | null;
  query: string;
  k: number;
  filter?: (c: C) => boolean;
}): RetrievalHit[] {
  const { index, vectors, queryVec, query, k, filter } = opts;
  const pool = Math.max(k * 3, 24);
  const lexical = bm25(index, query, pool, filter);
  const lexNorm = new Map(lexical.map((h) => [h.id, h.norm]));
  const lists: string[][] = [lexical.map((h) => h.id)];

  const cos = new Map<string, number>();
  if (vectors && vectors.size && queryVec && queryVec.length) {
    for (const doc of index.docs) {
      if (filter && !filter(doc)) continue;
      const v = vectors.get(doc.id);
      if (v) cos.set(doc.id, round(cosine(queryVec, v)));
    }
    lists.push(
      [...cos.entries()]
        .sort(([ia, a], [ib, b]) => b - a || (ia < ib ? -1 : 1))
        .slice(0, pool)
        .map(([id]) => id),
    );
  }

  return rrf(lists)
    .slice(0, Math.max(0, k))
    .map((f, i) => ({
      id: f.id,
      bm25: lexNorm.get(f.id) ?? 0,
      cosine: cos.size ? (cos.get(f.id) ?? null) : null,
      rank: i + 1,
      score: f.score,
    }));
}

/**
 * Default relevance-gate thresholds: a hit passes on either signal.
 *
 * cosine was calibrated on 2026-09-25 against gemini-embedding-2 (768 dims) over the
 * committed corpus: the best 'self' chunk scored 0.641-0.844 for 41 on-site
 * questions (the 36 in evals/retrieval.jsonl plus visitor phrasings) and
 * 0.529-0.624 for off-site ones (weather, recipes, trivia, gibberish). 0.63 sits
 * between the two. Re-measure after re-embedding with another model.
 */
export const GATE = { lexical: 0.2, cosine: 0.63 } as const;

export type GateThreshold = number | { lexical: number; cosine: number };

/** Whether one hit clears the gate (a bare number applies to both signals). */
export function relevant(hit: Pick<RetrievalHit, 'bm25' | 'cosine'>, threshold: GateThreshold = GATE): boolean {
  const t = typeof threshold === 'number' ? { lexical: threshold, cosine: threshold } : threshold;
  return hit.bm25 >= t.lexical || (hit.cosine !== null && hit.cosine >= t.cosine);
}
