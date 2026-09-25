import { z } from 'zod';
import { AI_LIMITS } from '@/lib/ai/config';
import { verifyQuestions, type Question, type QuestionsResponse } from '@/lib/ai/fit';
import { getCorpus } from '@/lib/ai/corpus.server';
import { aiGenerate, deadline, isFallback } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { newCanary } from '@/lib/ai/prompts/base';
import { questionsSystem, questionsUserTurn } from '@/lib/ai/prompts/fit';
import { redact } from '@/lib/ai/redact';
import { fallback, logAi } from '@/lib/ai/respond.server';

export const maxDuration = 30;

const ID = /^[a-z]+:[\w#.-]+$/;

const bodySchema = z.strictObject({
  items: z
    .array(
      z.strictObject({
        requirement: z.string().trim().min(1).max(AI_LIMITS.requirement),
        ids: z.array(z.string().max(120).regex(ID)).min(1).max(3),
      }),
    )
    .min(1)
    .max(AI_LIMITS.jdRequirements),
});

const modelSchema = z.object({
  questions: z.array(z.object({ question: z.string(), id: z.string() })).max(8),
});

/**
 * POST /api/ai/jd-questions {items:[{requirement, ids}]} -> {questions}. The
 * client sends only the evidenced rows' requirement texts and evidence ids; the
 * server re-reads those chunks itself ('self' chunks only), so a client cannot
 * put words in the prompt's context. Up to five questions come back, each tied
 * to one sent id and passing the tripwire against that chunk.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'jd-questions', { schema: bodySchema });
  if (!g.ok) return g.res;
  const dl = deadline(req.signal);

  try {
    const corpus = getCorpus();
    const sent = new Map<string, string>();
    const items: { requirement: string; ids: string[] }[] = [];
    for (const it of g.body.items) {
      const ids = it.ids.filter((id) => corpus.byId.get(id)?.cls === 'self');
      if (!ids.length) continue;
      for (const id of ids) sent.set(id, corpus.byId.get(id)!.text);
      items.push({ requirement: redact(it.requirement).text, ids });
    }
    if (!items.length) {
      logAi({ feature: 'jd-questions', ms: Date.now() - started, reason: 'low-relevance' });
      return fallback('low-relevance');
    }

    const context = [...sent].map(([id, text]) => `[c:${id}] ${corpus.byId.get(id)?.title ?? id}\n${text}`).join('\n\n');
    const out = await aiGenerate<{ questions: Question[] }>({
      feature: 'jd-questions',
      system: questionsSystem({ context, canary: newCanary() }),
      contents: [{ role: 'user', parts: [{ text: questionsUserTurn(items) }] }],
      schema: modelSchema,
      dl,
    });
    if (isFallback(out)) {
      logAi({ feature: 'jd-questions', ms: Date.now() - started, reason: out.reason });
      return fallback(out.reason, out.retryAfterSec ? { retryAfterSec: out.retryAfterSec } : undefined);
    }

    const all = out.data?.questions ?? [];
    const kept = verifyQuestions(all, sent, corpus.entities);
    const dropped = all.length - kept.length;
    if (!kept.length) {
      logAi({ feature: 'jd-questions', model: out.model, ms: Date.now() - started, usage: out.usage, dropped, reason: 'unverified' });
      return fallback('unverified');
    }
    logAi({ feature: 'jd-questions', model: out.model, ms: Date.now() - started, usage: out.usage, dropped });
    const body: QuestionsResponse = { questions: kept.map((q) => ({ ...q, label: corpus.byId.get(q.id)?.label ?? q.id })) };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] jd-questions failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'jd-questions', ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
