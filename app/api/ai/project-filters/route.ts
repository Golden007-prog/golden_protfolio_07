import { z } from 'zod';
import { CATEGORIES, allTech } from '@/data/projects';
import { AI_LIMITS } from '@/lib/ai/config';
import { aiGenerate, deadline, isFallback } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { filterSystem } from '@/lib/ai/prompts/projects';
import { untrusted } from '@/lib/ai/prompts/base';
import { FILTER_Q_MAX, validateFilters, type FilterVocab, type ProjectFiltersResponse } from '@/lib/ai/projectFilters';
import { fallback, logAi } from '@/lib/ai/respond.server';

export const maxDuration = 30;

const VOCAB: FilterVocab = { categories: CATEGORIES, techs: allTech().map((t) => t.name) };

const bodySchema = z.strictObject({
  phrase: z.string().trim().min(1).max(AI_LIMITS.filterPhrase),
});

const asEnum = (xs: readonly string[]) => xs as [string, ...string[]];

// Enum-constrained, so the model can only answer with names the grid knows;
// validateFilters() checks the reading again either way.
const readingSchema = z.object({
  cat: z.enum(asEnum(VOCAB.categories)).optional(),
  tech: z.enum(asEnum(VOCAB.techs)).optional(),
  live: z.boolean().optional(),
  q: z.string().max(FILTER_Q_MAX).optional(),
});

const SYSTEM = filterSystem({ categories: VOCAB.categories, techs: VOCAB.techs, qMax: FILTER_Q_MAX });

/**
 * POST /api/ai/project-filters {phrase} -> {mode:'model', model, reading}. The
 * cheap tier reads a search phrase ('live AI projects using Gemini') as projects
 * filters. The answer is only ever a filter; anything else is a fallback, and
 * the client then keeps the phrase as a plain text search.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'project-filters', { schema: bodySchema });
  if (!g.ok) return g.res;
  const { phrase } = g.body;
  const dl = deadline(req.signal);

  try {
    const res = await aiGenerate({
      feature: 'project-filters',
      system: SYSTEM,
      contents: [{ role: 'user', parts: [{ text: untrusted('visitor search phrase', phrase) }] }],
      schema: readingSchema,
      dl,
    });
    if (isFallback(res)) {
      logAi({ feature: 'project-filters', ms: Date.now() - started, reason: res.reason });
      return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
    }

    const reading = validateFilters(res.data, VOCAB, phrase);
    if (!reading) {
      logAi({ feature: 'project-filters', model: res.model, ms: Date.now() - started, usage: res.usage, reason: 'low-relevance' });
      return fallback('low-relevance');
    }

    logAi({ feature: 'project-filters', model: res.model, ms: Date.now() - started, usage: res.usage });
    const body: ProjectFiltersResponse = { mode: 'model', model: res.model, reading };
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    console.warn(`[ai] project-filters failed: ${err instanceof Error ? err.name : typeof err}`);
    logAi({ feature: 'project-filters', ms: Date.now() - started, reason: 'upstream' });
    return fallback('upstream');
  }
}
