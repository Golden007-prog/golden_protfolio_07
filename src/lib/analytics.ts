import { track as vercelTrack } from '@vercel/analytics';

export type TrackEvent =
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

// Only Vercel deployments serve /_vercel/insights; elsewhere the queue would never drain.
const ENABLED = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

export function track(event: TrackEvent, props?: Record<string, string | number | boolean>): void {
  if (!ENABLED || typeof window === 'undefined') return;
  try {
    vercelTrack(event, props);
  } catch {
    /* analytics must never break an interaction */
  }
}
