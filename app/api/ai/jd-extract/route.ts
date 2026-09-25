import { z } from 'zod';
import { AI_LIMITS } from '@/lib/ai/config';
import { JD_BODY_BYTES, REQ_CATEGORIES, REQ_KINDS, runExtract, type ExtractModelOut } from '@/lib/ai/fit';
import { aiGenerate, deadline, isFallback } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { newCanary } from '@/lib/ai/prompts/base';
import { extractSystem, extractUserTurn } from '@/lib/ai/prompts/fit';
import type { AiUsage } from '@/lib/ai/protocol';
import { fallback, logAi } from '@/lib/ai/respond.server';

export const maxDuration = 30;

const bodySchema = z.strictObject({
  jd: z.string().trim().min(1).max(AI_LIMITS.jd),
});

// Strings are left unbounded here and capped in runExtract: a reply one character
// over a limit is still usable, and a failed parse would throw the whole answer away.
const modelSchema = z.object({
  isJobDescription: z.boolean(),
  language: z.string(),
  title: z.string().optional(),
  requirements: z
    .array(
      z.object({
        text: z.string(),
        kind: z.enum(REQ_KINDS),
        category: z.enum(REQ_CATEGORIES),
        gloss: z.string().optional(),
      }),
    )
    .max(AI_LIMITS.jdRequirements),
});

/**
 * POST /api/ai/jd-extract {jd} -> {isJobDescription, language, title,
 * requirements[<=12], redacted} or the refusal {isJobDescription:false, message}.
 * Paste-only intake: the JD is redacted (emails, phones, credentialed URLs) and
 * capped at 8,000 characters before the cheap-tier call. Nothing is stored.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'jd-extract', { schema: bodySchema, maxBytes: JD_BODY_BYTES });
  if (!g.ok) return g.res;
  const dl = deadline(req.signal);
  let model: string | undefined;
  let usage: AiUsage | undefined;

  try {
    const res = await runExtract(g.body.jd, {
      generate: async (text) => {
        const out = await aiGenerate<ExtractModelOut>({
          feature: 'jd-extract',
          system: extractSystem(newCanary()),
          contents: [{ role: 'user', parts: [{ text: extractUserTurn(text) }] }],
          schema: modelSchema,
          dl,
        });
        if (isFallback(out)) return out;
        model = out.model;
        usage = out.usage;
        return { data: out.data };
      },
    });
    if (isFallback(res)) {
      logAi({ feature: 'jd-extract', model, ms: Date.now() - started, reason: res.reason, usage });
      return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
    }
    logAi({ feature: 'jd-extract', model, ms: Date.now() - started, usage });
    return Response.json(res, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] jd-extract failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'jd-extract', model, ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
