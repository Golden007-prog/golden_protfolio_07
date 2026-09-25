import { track as vercelTrack } from '@vercel/analytics';

type SiteTrackEvent =
  | 'cv_download'
  | 'cv_view'
  | 'contact_submit'
  | 'project_open'
  | 'skill_open'
  | 'theme_toggle'
  | 'palette_open'
  | 'copy_email'
  | 'vcard_download'
  | 'share_project'
  | 'web_vital';

export type AiTrackEvent =
  | 'ai_ask'
  | 'ai_fallback'
  | 'ai_feedback'
  | 'ai_tool'
  | 'ai_cite_click'
  | 'ai_fit_run'
  | 'ai_brief_view'
  | 'ai_draft_insert'
  | 'ai_handoff'
  | 'ai_voice'
  | 'ai_read_aloud'
  | 'ai_tour';

export type TrackEvent = SiteTrackEvent | AiTrackEvent;

/**
 * Props for ai_* events: only feature, reason, model, intent and counts (keys
 * named 'count' or ending in 'Count'). A question, job description, draft or
 * message has no key to travel under, so tsc rejects it.
 */
export type AiTrackProps = {
  feature?: string;
  reason?: string;
  model?: string;
  intent?: string;
} & { [K in 'count' | `${string}Count`]?: number };

type Props = Record<string, string | number | boolean>;

// Only Vercel deployments serve /_vercel/insights; elsewhere the queue would never drain.
const ENABLED = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

export function track(event: AiTrackEvent, props?: AiTrackProps): void;
export function track(event: SiteTrackEvent, props?: Props): void;
export function track(event: TrackEvent, props?: Props | AiTrackProps): void {
  if (!ENABLED || typeof window === 'undefined') return;
  try {
    vercelTrack(event, props);
  } catch {
    /* analytics must never break an interaction */
  }
}
