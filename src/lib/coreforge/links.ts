/*
 * The one way to link to goldensdmat.in. Every outbound href carries
 * utm_source=basuoikantik.in&utm_medium=portfolio&utm_campaign=<placement>, and every
 * anchor opens in a new tab with rel='noopener' only: no 'noreferrer', so the owner's
 * analytics on goldensdmat.in still see the portfolio as the referrer. That is also
 * why these links must not go through Button's `external` prop, which adds noreferrer.
 *
 * Pure (no '@/' imports), so node --test can import it. The click-tracking half lives
 * in ./track.ts, which needs the analytics module.
 */

export const COREFORGE_ORIGIN = 'https://goldensdmat.in';

/** Hosts cfUrl accepts in an absolute URL. www 308-redirects to the apex, so links use the apex. */
const COREFORGE_HOSTS: readonly string[] = ['goldensdmat.in', 'www.goldensdmat.in'];

/** '/' renders the landing page but ends up on /welcome; linking there directly skips the hop. */
export const COREFORGE_HOME_PATH = '/welcome';

export const COREFORGE_UTM = { source: 'basuoikantik.in', medium: 'portfolio' } as const;

export const COREFORGE_LINK_TARGET = '_blank';
export const COREFORGE_LINK_REL = 'noopener';
/** Sends the portfolio's origin (never its path) even if a page-level policy is stricter. */
export const COREFORGE_REFERRER_POLICY = 'strict-origin-when-cross-origin';

const PLACEMENT_MAX = 64;

/**
 * Where a link sits on the portfolio, e.g. 'hero-badge' or 'projects-card'. It becomes
 * utm_campaign and the analytics `placement` prop, so it is reduced to lower-kebab ASCII:
 * 'Hero Badge' -> 'hero-badge'. Nothing else can survive into the query string.
 */
export function normalizePlacement(placement: string): string {
  const slug = placement
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, PLACEMENT_MAX)
    .replace(/^-+|-+$/g, '');
  return slug || 'unknown';
}

function homeUrl(): URL {
  return new URL(COREFORGE_HOME_PATH, COREFORGE_ORIGIN);
}

/** Resolves `path` on goldensdmat.in. Anything pointing elsewhere falls back to the home page. */
function resolve(path: string): URL {
  let url: URL;
  try {
    url = new URL(path.trim() || '/', `${COREFORGE_ORIGIN}/`);
  } catch {
    return homeUrl();
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !COREFORGE_HOSTS.includes(url.hostname)) {
    return homeUrl();
  }
  const canonical = new URL(`${url.pathname}${url.search}${url.hash}`, COREFORGE_ORIGIN);
  if (canonical.pathname === '/') canonical.pathname = COREFORGE_HOME_PATH;
  return canonical;
}

/**
 * An absolute goldensdmat.in URL for `path` ('/demo', '/news#brain-gym-and-skills', or a
 * full goldensdmat.in URL) with the portfolio's UTM parameters. Existing query parameters
 * and the hash are kept; any utm_* already present is replaced.
 */
export function cfUrl(path: string, placement: string): string {
  const url = resolve(path);
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }
  url.searchParams.set('utm_source', COREFORGE_UTM.source);
  url.searchParams.set('utm_medium', COREFORGE_UTM.medium);
  url.searchParams.set('utm_campaign', normalizePlacement(placement));
  return url.toString();
}

export type CoreforgeLinkAttrs = {
  href: string;
  target: typeof COREFORGE_LINK_TARGET;
  rel: typeof COREFORGE_LINK_REL;
  referrerPolicy: typeof COREFORGE_REFERRER_POLICY;
  /** The normalised placement, for click delegation and e2e assertions. */
  'data-cf-placement': string;
};

/** Anchor attributes for a goldensdmat.in link. Spread onto <a>; add tracking with useCoreforgeLink. */
export function coreforgeLinkAttrs(path: string, placement: string): CoreforgeLinkAttrs {
  return {
    href: cfUrl(path, placement),
    target: COREFORGE_LINK_TARGET,
    rel: COREFORGE_LINK_REL,
    referrerPolicy: COREFORGE_REFERRER_POLICY,
    'data-cf-placement': normalizePlacement(placement),
  };
}

/** True for any link to goldensdmat.in, with or without UTM parameters. */
export function isCoreforgeUrl(href: string): boolean {
  try {
    return COREFORGE_HOSTS.includes(new URL(href).hostname);
  } catch {
    return false;
  }
}
