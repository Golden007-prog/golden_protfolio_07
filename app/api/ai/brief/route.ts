import { z } from 'zod';
import { PROJECTS } from '@/data/projects';
import { AI_LIMITS } from '@/lib/ai/config';
import { packContext, passesGate } from '@/lib/ai/context';
import { getCorpus, retrieve } from '@/lib/ai/corpus.server';
import { verifyBrief, withLabels, type BriefModelOut, type BriefResponse } from '@/lib/ai/fit';
import { aiGenerate, deadline, isFallback } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { newCanary } from '@/lib/ai/prompts/base';
import { briefSystem, briefUserTurn } from '@/lib/ai/prompts/brief';
import { redact } from '@/lib/ai/redact';
import { fallback, logAi } from '@/lib/ai/respond.server';

export const maxDuration = 30;

const bodySchema = z.strictObject({
  title: z.string().trim().min(2).max(AI_LIMITS.title),
});

const modelSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string(),
        evidence: z.array(z.object({ id: z.string(), quote: z.string() })).max(3),
      }),
    )
    .max(6),
  projects: z.array(z.string()).max(3),
});

const SLUGS = PROJECTS.map((p) => p.slug);

/**
 * POST /api/ai/brief {title<=80} -> BriefResponse. Buffered, never streamed:
 * every claim passes verifyClaims before any of it is sent, because a sentence
 * already on screen couldn't be taken back. A title the site has nothing on
 * answers 'low-relevance', and a mostly unverifiable answer 'unverified'; the
 * client shows the nearest preset lens for both.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'brief', { schema: bodySchema });
  if (!g.ok) return g.res;
  const dl = deadline(req.signal);

  try {
    const corpus = getCorpus();
    const title = redact(g.body.title).text;
    const { hits } = await retrieve(title, { k: 16, dl, filter: (c) => c.cls === 'self', embed: g.mode === 'model' });
    if (!passesGate(hits, corpus.byId)) {
      logAi({ feature: 'brief', ms: Date.now() - started, reason: 'low-relevance', top: hits[0]?.bm25 ?? 0 });
      return fallback('low-relevance');
    }

    const packed = packContext({ chunks: corpus.chunks, byId: corpus.byId, hits, mode: 'retrieval', budgetTokens: 2500 });
    // Reference and live chunks may inform wording but are never evidence of his work.
    const facts = new Map([...packed.facts].filter(([id]) => corpus.byId.get(id)?.cls === 'self'));
    const out = await aiGenerate<BriefModelOut>({
      feature: 'brief',
      system: briefSystem({ context: packed.text, canary: newCanary() }),
      contents: [{ role: 'user', parts: [{ text: briefUserTurn(title) }] }],
      schema: modelSchema,
      dl,
    });
    if (isFallback(out)) {
      logAi({ feature: 'brief', ms: Date.now() - started, reason: out.reason });
      return fallback(out.reason, out.retryAfterSec ? { retryAfterSec: out.retryAfterSec } : undefined);
    }

    const v = verifyBrief(out.data ?? { claims: [], projects: [] }, facts, corpus.entities, SLUGS);
    if (v.discarded) {
      logAi({ feature: 'brief', model: out.model, ms: Date.now() - started, usage: out.usage, dropped: v.dropped, reason: 'unverified' });
      return fallback('unverified');
    }
    logAi({ feature: 'brief', model: out.model, ms: Date.now() - started, usage: out.usage, dropped: v.dropped });
    const body: BriefResponse = {
      claims: v.claims.map((c) => ({ text: c.text, evidence: withLabels(c.evidence, corpus.byId, corpus.known) })),
      projects: v.projects,
      dropped: v.dropped,
      model: out.model,
    };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] brief failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'brief', ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
