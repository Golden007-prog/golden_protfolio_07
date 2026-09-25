import { z } from 'zod';
import { AI_LIMITS } from '@/lib/ai/config';
import type { Chunk } from '@/lib/ai/corpus';
import { getCorpus, retrieve } from '@/lib/ai/corpus.server';
import { deadline } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import type { AiTarget } from '@/lib/ai/protocol';
import { fallback, logAi } from '@/lib/ai/respond.server';
import { validTarget } from '@/lib/ai/sanitize';

export const maxDuration = 30;

const bodySchema = z.strictObject({
  query: z.string().trim().min(1).max(AI_LIMITS.retrieveQuery),
  k: z.number().int().min(1).max(10).optional(),
  scope: z.enum(['projects', 'all']).optional(),
});

export type RetrieveHit = {
  id: string;
  label: string;
  target: AiTarget;
  /** Fused rank score (reciprocal rank fusion). */
  score: number;
  /** Cosine similarity, or null in lexical mode. */
  cosine: number | null;
  /** Normalised BM25, 0..1. */
  bm25: number;
};

export type RetrieveResponse = { mode: 'hybrid' | 'lexical'; hits: RetrieveHit[] };

const isProject = (c: Chunk) => c.target.kind === 'project';

/**
 * POST /api/ai/retrieve {query, k?, scope?} -> {mode, hits}. The one semantic
 * search endpoint (command palette, projects empty state, 404 page, explorer).
 * With AI off, no key, or 'retrieve-embed' switched off, the guard reports
 * 'lexical' and this answers from BM25 alone, but the origin check and rate
 * limit still apply. Hits are one per destination, and every target has passed
 * validTarget.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'retrieve', { schema: bodySchema, lexicalOk: true });
  if (!g.ok) return g.res;
  const { query, k = 5, scope = 'all' } = g.body;
  const dl = deadline(req.signal);

  try {
    const corpus = getCorpus();
    const { hits, mode } = await retrieve(query, {
      k: k * 4,
      filter: scope === 'projects' ? isProject : undefined,
      dl,
      embed: g.mode === 'model',
    });

    const seen = new Set<string>();
    const out: RetrieveHit[] = [];
    for (const h of hits) {
      const chunk = corpus.byId.get(h.id);
      const target = chunk ? validTarget(chunk.target, corpus.known) : null;
      if (!chunk || !target) continue;
      const key = JSON.stringify(target);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: h.id, label: chunk.label, target, score: h.score, cosine: h.cosine, bm25: h.bm25 });
      if (out.length >= k) break;
    }

    logAi({
      feature: 'retrieve',
      ...(mode === 'hybrid' && corpus.vectorModel ? { model: corpus.vectorModel } : {}),
      ms: Date.now() - started,
      top: out[0]?.cosine ?? out[0]?.bm25 ?? 0,
    });
    const body: RetrieveResponse = { mode, hits: out };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] retrieve failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'retrieve', ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
