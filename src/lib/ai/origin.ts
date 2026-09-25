/*
 * Strict same-origin rule for the AI routes. Browsers always send Origin on a
 * cross-origin or JSON POST, so a missing Origin means a non-browser client and is
 * refused. There is deliberately no *.vercel.app wildcard: previews sit behind
 * Vercel Authentication, and a suffix match would be spoofable. The site never
 * emits Access-Control-Allow-Origin.
 */

export const SITE_HOSTS: readonly string[] = ['basuoikantik.in', 'www.basuoikantik.in'];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export type OriginInput = {
  origin: string | null | undefined;
  /** The request's own Host header. */
  host: string | null | undefined;
  secFetchSite: string | null | undefined;
  onVercel: boolean;
};

export function isAllowedOrigin({ origin, host, secFetchSite, onVercel }: OriginInput): boolean {
  if (secFetchSite?.trim().toLowerCase() === 'cross-site') return false;
  if (!origin || origin === 'null') return false;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;

  const originHost = url.host.toLowerCase();
  const ownHost = host?.trim().toLowerCase();
  if (ownHost && originHost === ownHost) return true;
  if (url.protocol === 'https:' && SITE_HOSTS.includes(originHost)) return true;
  if (!onVercel && LOOPBACK.has(url.hostname.toLowerCase())) return true;
  return false;
}
