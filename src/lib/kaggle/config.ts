/*
 * Owner-editable settings for the Kaggle section. Changes apply in both live and
 * snapshot mode after a redeploy. JSON-free and import-free so node --test and
 * scripts/kaggle/snapshot.mjs can load it.
 */

/** The only Kaggle account shown. The older empty @oikantikbasu account is ignored. */
export const USERNAME = 'oikantikbasu007';

/** Seconds between refreshes of the live data (6 hours). */
export const REVALIDATE_SECONDS = 21600;

/**
 * Next.js cache tag on the cached live read (client.server.ts). To show a newly
 * published writeup on the very next request, expire it outright:
 * revalidateTag('kaggle', { expire: 0 }) from a Route Handler, or
 * updateTag('kaggle') from a Server Action. revalidateTag('kaggle', 'max') only
 * marks it stale, so the next visitor still gets the old data while the refresh
 * runs in the background.
 */
export const CACHE_TAG = 'kaggle';

/**
 * After a failed live read, serve the snapshot without retrying Kaggle for this
 * long (per server instance). Failures are never written to the cache, so the
 * next read after this window tries Kaggle again.
 */
export const RETRY_AFTER_FAILURE_SECONDS = 300;

/** Per-request timeout. */
export const FETCH_TIMEOUT_MS = 6000;

/**
 * Show only writeups with at least this many upvotes. 0 shows every public,
 * published writeup, so a new one appears on the next refresh.
 */
export const WRITEUP_MIN_VOTES = 0;

/** Writeups never shown: the last path segment of the writeup URL, e.g. 'new-writeup-1767949274949'. */
export const HIDE_WRITEUPS: readonly string[] = [];

/** Badges marked featured, in display order, by their exact Kaggle name. */
export const FEATURED_BADGES: readonly string[] = [
  '5-Day AI Agents Intensive Course with Google',
  'Research Competitor',
  'Code Submitter',
  'Competitor',
];

/**
 * Profile, tiers, badges and public writeups are readable from Kaggle without
 * any credentials; only live competition ranks need a token. false keeps the
 * site on snapshot.json until KAGGLE_API_TOKEN (or KAGGLE_USERNAME + KAGGLE_KEY)
 * is set. true fetches the public parts live even without one, and competitions
 * then come from the snapshot with their original 'as of' dates.
 */
export const LIVE_PUBLIC_WITHOUT_TOKEN = false;

/** Upper bound on anonymous public-visibility checks for competitions the snapshot does not know. */
export const MAX_VISIBILITY_CHECKS = 20;

export const KAGGLE_ORIGIN = 'https://www.kaggle.com';
export const API_BASE = 'https://api.kaggle.com/v1';
export const MCP_URL = 'https://www.kaggle.com/mcp';
