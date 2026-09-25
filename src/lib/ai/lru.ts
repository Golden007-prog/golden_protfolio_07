/*
 * The per-instance answer cache, built so a forged request cannot change what
 * another visitor receives. Only requests with nothing visitor-specific in them
 * are cacheable (no history, no prior citations, English, no tools), the key
 * binds the feature, the normalised question, the scope, the model and the corpus
 * hash, and callers store an answer only after it finished undegraded.
 *
 * Pure: type-only imports, so node --test runs it directly.
 */
import type { AiFeature } from './config.ts';
import type { AskRequest, AskScope } from './protocol.ts';

type Entry<V> = { value: V; at: number };

/** Least-recently-used map with a time-to-live; `now` is injectable for tests. */
export class Lru<V> {
  private readonly map = new Map<string, Entry<V>>();
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(max = 200, ttlMs = 600_000, now: () => number = Date.now) {
    this.max = Math.max(1, max);
    this.ttlMs = ttlMs;
    this.now = now;
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

/** True only for a request with no history, no prior citations, English or no lang, and no tools. */
export function cacheable(req: Pick<AskRequest, 'history' | 'prevCited' | 'lang' | 'tools'>): boolean {
  if (Array.isArray(req.history) ? req.history.length > 0 : req.history !== undefined) return false;
  if (Array.isArray(req.prevCited) ? req.prevCited.length > 0 : req.prevCited !== undefined) return false;
  if (req.tools) return false;
  const lang = typeof req.lang === 'string' ? req.lang.trim() : req.lang;
  return lang === undefined || lang === '' || lang === null || /^en(?:-[A-Za-z0-9]{1,8})*$/i.test(lang);
}

/** Case, spacing and trailing punctuation do not make a different question. */
export function normalizeQuestion(q: string): string {
  return q
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s?!.。？！]+$/u, '');
}

function scopeKey(scope: AskScope | null | undefined): string {
  if (!scope) return '-';
  const rec = scope as Record<string, unknown>;
  return JSON.stringify(Object.keys(rec).sort().map((k) => [k, rec[k]]));
}

export function cacheKey(opts: {
  feature: AiFeature | string;
  question: string;
  scope?: AskScope | null;
  model: string;
  corpusHash: string;
}): string {
  return [opts.feature, opts.model, opts.corpusHash, scopeKey(opts.scope), normalizeQuestion(opts.question)].join('␟');
}
