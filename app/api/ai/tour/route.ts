import { z } from 'zod';
import { PROJECTS } from '@/data/projects';
import profile from '@/data/profile.json';
import { CONTACT_COPY, PHILOSOPHY, SECTION_COPY } from '@/data/site-copy';
import { AI_LIMITS } from '@/lib/ai/config';
import { aiGenerate, deadline, isFallback } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { tourSystem, tourUser } from '@/lib/ai/prompts/tour';
import { fallback, logAi } from '@/lib/ai/respond.server';
import { normalizeStops, stopIds, stopViews, tourCatalogOf, TOUR_MAX, TOUR_MIN, type DiscoveryInputs } from '@/lib/ai/tour';
import { SECTIONS } from '@/lib/site';

export const maxDuration = 30;

const INPUTS: DiscoveryInputs = {
  profile,
  projects: PROJECTS,
  sections: SECTIONS,
  sectionCopy: SECTION_COPY,
  tenets: PHILOSOPHY,
  contact: CONTACT_COPY,
};
const CATALOG = tourCatalogOf(INPUTS);
const IDS = stopIds(CATALOG) as [string, ...string[]];
const SYSTEM = tourSystem(stopViews(INPUTS));

const bodySchema = z.strictObject({
  goal: z.string().trim().min(1).max(AI_LIMITS.tourGoal),
});

// Ids from a closed enum and nothing else: no field can carry free text, so the
// route is useless as a general-purpose model endpoint.
const planSchema = z.object({
  stops: z.array(z.enum(IDS)).min(TOUR_MIN).max(TOUR_MAX),
});

export type TourResponse = { stops: string[]; model: string };

/**
 * POST /api/ai/tour {goal} -> {stops, model}. Orders 4 to 6 stops for a typed
 * visitor goal on the cheap tier (256 output tokens). The client writes each
 * stop's line from the site's data (tourLine), so nothing the model returns is
 * shown as text. Any failure, or a list normalizeStops rejects, answers the
 * usual HTTP 200 fallback and the client runs the closest preset instead.
 */
export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'tour', { schema: bodySchema });
  if (!g.ok) return g.res;
  const dl = deadline(req.signal);

  const res = await aiGenerate({
    feature: 'tour',
    system: SYSTEM,
    contents: [{ role: 'user', parts: [{ text: tourUser(g.body.goal) }] }],
    schema: planSchema,
    dl,
  });
  if (isFallback(res)) {
    logAi({ feature: 'tour', ms: Date.now() - started, reason: res.reason });
    return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
  }

  const stops = normalizeStops(res.data?.stops, CATALOG);
  logAi({ feature: 'tour', model: res.model, ms: Date.now() - started, usage: res.usage, ...(stops ? {} : { reason: 'unverified' as const }) });
  if (!stops) return fallback('unverified');

  const body: TourResponse = { stops, model: res.model };
  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
