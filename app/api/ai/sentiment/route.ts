import { z } from 'zod';
import { AI_LIMITS } from '@/lib/ai/config';
import { aiGenerate, deadline, isFallback } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { newCanary } from '@/lib/ai/prompts/base';
import { sentimentSystem, sentimentUserTurn, sentimentVerdictSchema } from '@/lib/ai/prompts/sentiment';
import { fallback, logAi } from '@/lib/ai/respond.server';
import { finalizeVerdict, type SentimentResponse } from '@/lib/ai/spans';

export const maxDuration = 30;

// The text is not trimmed or otherwise changed: span offsets must index the
// exact string the visitor's browser holds.
const bodySchema = z.strictObject({
  text: z
    .string()
    .max(AI_LIMITS.sentimentText)
    .refine((s) => s.trim().length > 0, { message: 'empty' }),
});

/**
 * POST /api/ai/sentiment {text} -> SentimentResponse. The skills section's
 * opt-in "Compare with Gemini": a cheap-tier structured verdict whose every
 * span is checked against the text (kept, relocated by exact match, or
 * dropped) before it leaves the server. Anything that cannot be trusted
 * answers the usual 200 fallback body, and the browser lexicon's result stands.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'sentiment', { schema: bodySchema });
  if (!g.ok) return g.res;
  const { text } = g.body;
  const dl = deadline(req.signal);
  const canary = newCanary();

  try {
    const result = await aiGenerate({
      feature: 'sentiment',
      system: sentimentSystem(canary),
      contents: [{ role: 'user', parts: [{ text: sentimentUserTurn(text) }] }],
      schema: sentimentVerdictSchema,
      dl,
    });
    if (isFallback(result)) {
      logAi({ feature: 'sentiment', ms: Date.now() - started, reason: result.reason });
      return fallback(result.reason, result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : undefined);
    }

    const checked = finalizeVerdict(text, result.data, { canary });
    if (!checked) {
      logAi({ feature: 'sentiment', model: result.model, ms: Date.now() - started, usage: result.usage, reason: 'unverified' });
      return fallback('unverified');
    }

    logAi({ feature: 'sentiment', model: result.model, ms: Date.now() - started, usage: result.usage, dropped: checked.dropped });
    const body: SentimentResponse = { ...checked.verdict, model: result.model, dropped: checked.dropped };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] sentiment failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'sentiment', ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
