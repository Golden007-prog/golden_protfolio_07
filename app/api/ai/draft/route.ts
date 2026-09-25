import { z } from 'zod';
import profile from '@/data/profile.json';
import { AI_BUDGETS } from '@/lib/ai/config';
import { getCorpus } from '@/lib/ai/corpus.server';
import {
  CHECK_INTENTS,
  CHECK_MISSING,
  CHECK_QUESTIONS,
  DRAFT_INTENTS,
  DRAFT_LENGTH_IDS,
  DRAFT_TONE_IDS,
  MESSAGE_MAX,
  MESSAGE_MIN,
  NOTES_MAX,
  createDraftFilter,
  normalizeCheck,
  type CheckResponse,
} from '@/lib/ai/draft';
import { aiGenerate, aiStream, deadline, isFallback, textOf, usageOf, type AiStreamResult } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { newCanary } from '@/lib/ai/prompts/base';
import { checkSystem, checkUserTurn, draftSystem, draftUserTurn } from '@/lib/ai/prompts/draft';
import type { AiFrame, AiUsage } from '@/lib/ai/protocol';
import { redact } from '@/lib/ai/redact';
import { fallback, logAi, ndjson } from '@/lib/ai/respond.server';

export const maxDuration = 30;

const draftBody = z.strictObject({
  mode: z.literal('draft'),
  notes: z.string().max(NOTES_MAX),
  intent: z.enum(DRAFT_INTENTS),
  tone: z.enum(DRAFT_TONE_IDS),
  length: z.enum(DRAFT_LENGTH_IDS),
});

const checkBody = z.strictObject({
  mode: z.literal('check'),
  message: z.string().trim().min(MESSAGE_MIN).max(MESSAGE_MAX),
});

const bodySchema = z.discriminatedUnion('mode', [draftBody, checkBody]);

// Structured output for the check: enums only, so the route cannot be used to
// generate free text.
const checkSchema = z.object({
  missing: z.array(z.enum(CHECK_MISSING)).max(CHECK_MISSING.length),
  suggestedIntent: z.enum(CHECK_INTENTS),
  question: z.enum(CHECK_QUESTIONS),
});

const SAFETY_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

/**
 * POST /api/ai/draft, the contact form's writing help, on the cheap tier.
 * - {mode:'draft', notes ≤300, intent, tone, length} streams NDJSON: a meta
 *   frame, the draft one checked sentence at a time (see createDraftFilter),
 *   then done. It never sends anything anywhere.
 * - {mode:'check', message} answers JSON {mode:'check', missing, suggestedIntent,
 *   question}: enums only.
 * Notes and messages are redacted (emails, phones, credential URLs) before they
 * reach Gemini, and are never logged. Every failure is the 200 fallback body.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'draft', { schema: bodySchema });
  if (!g.ok) return g.res;
  const dl = deadline(req.signal);
  const canary = newCanary();

  if (g.body.mode === 'check') {
    const res = await aiGenerate({
      feature: 'draft',
      system: checkSystem({ canary }),
      contents: [{ role: 'user', parts: [{ text: checkUserTurn(redact(g.body.message).text) }] }],
      schema: checkSchema,
      dl,
    });
    if (isFallback(res)) {
      logAi({ feature: 'draft', ms: Date.now() - started, reason: res.reason });
      return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
    }
    const result = normalizeCheck(res.data);
    if (!result) {
      logAi({ feature: 'draft', model: res.model, ms: Date.now() - started, usage: res.usage, reason: 'unverified' });
      return fallback('unverified');
    }
    logAi({ feature: 'draft', model: res.model, ms: Date.now() - started, usage: res.usage });
    const body: CheckResponse = { mode: 'check', ...result };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  }

  const { intent, tone, length } = g.body;
  const notes = redact(g.body.notes).text.trim();
  const corpus = getCorpus();
  const { entities } = corpus;

  const res = await aiStream({
    feature: 'draft',
    system: draftSystem({ tone, length, intent, canary, ctx: { projectNames: entities.projectNames, openTo: profile.availability.openTo } }),
    contents: [{ role: 'user', parts: [{ text: draftUserTurn(notes) }] }],
    dl,
  });
  if (isFallback(res)) {
    logAi({ feature: 'draft', ms: Date.now() - started, reason: res.reason });
    return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
  }
  const upstream: AiStreamResult = res;

  const filter = createDraftFilter({
    length,
    notes,
    projectNames: entities.projectNames,
    knownNames: [...entities.tech, ...entities.skills, ...entities.companies, ...entities.institutions],
    companies: entities.companies,
    facts: [profile.availability.openTo],
    canary,
  });

  async function* frames(): AsyncGenerator<AiFrame> {
    let usage: AiUsage | undefined;
    let finishReason = 'STOP';
    let ttftMs: number | undefined;
    const log = (extra: { reason?: 'safety' | 'unverified'; dropped?: number } = {}) =>
      logAi({ feature: 'draft', model: upstream.model, ms: Date.now() - started, ttftMs, usage, ...extra });

    yield { type: 'meta', model: upstream.model, feature: 'draft', sources: [], mode: 'full' };
    for await (const chunk of upstream.stream) {
      usage = usageOf(chunk) ?? usage;
      const finish = chunk.candidates?.[0]?.finishReason;
      if (finish) finishReason = finish;
      if (finish && SAFETY_FINISH.has(finish)) {
        log({ reason: 'safety' });
        yield { type: 'error', reason: 'safety' };
        return;
      }
      const text = textOf(chunk);
      if (!text) continue;
      const step = filter.push(text);
      if (step.blocked) {
        log({ reason: 'unverified' });
        yield { type: 'error', reason: 'unverified' };
        return;
      }
      for (const piece of step.emit) {
        ttftMs ??= Date.now() - started;
        yield { type: 'delta', text: piece };
      }
      // At the length cap: stop reading, which aborts the upstream call.
      if (filter.full()) break;
    }
    const end = filter.end();
    for (const piece of end.emit) yield { type: 'delta', text: piece };
    if (end.kept === 0) {
      log({ reason: 'unverified', dropped: end.dropped });
      yield { type: 'error', reason: 'unverified' };
      return;
    }
    log({ dropped: end.dropped });
    yield {
      type: 'done',
      finishReason: end.truncated ? 'MAX_CHARS' : finishReason,
      cited: [],
      dropped: end.dropped,
      degraded: end.degraded,
      ...(usage ? { usage } : {}),
    };
  }

  return ndjson(frames(), { model: upstream.model, abort: upstream.abort, maxChars: AI_BUDGETS.draft.maxChars });
}
