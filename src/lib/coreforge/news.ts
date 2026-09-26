/*
 * The goldensdmat.in news hub, read from its RSS 2.0 feed (goldensdmat.in/news.xml).
 *
 * parseCoreforgeNews is a pure, dependency-free parser: feed text in, items out.
 * An item survives only with a title, a parseable pubDate and a link on
 * goldensdmat.in, so nothing from the feed can put an off-site or javascript: URL
 * into an href. promotableCoreforgeNews then drops any item whose title quotes a
 * price (the feed keeps a superseded launch-price entry), any item dated after today,
 * and any deadline-style item (tagged 'dates', 'registration' or 'critical') whose
 * date has passed, so a placement never advertises a closed window.
 *
 * fetchCoreforgeNews is the server-side helper: 5 s budget, and [] on any failure,
 * so a page that lists news simply renders nothing when the feed is down.
 * No '@/' imports, so node --test can import this file.
 */
import { containsPrice } from './copy-guard.ts';

export type CoreforgeNewsItem = {
  /** The feed's guid, or the link when there is none. Stable, for React keys. */
  id: string;
  title: string;
  /** Absolute https://goldensdmat.in URL, without tracking parameters (wrap it in cfUrl). */
  link: string;
  /** YYYY-MM-DD in UTC. */
  date: string;
  /** Lower-case feed categories, e.g. 'dmat', 'platform', 'critical'. */
  categories: string[];
};

export const COREFORGE_RSS_URL = 'https://goldensdmat.in/news.xml';
export const COREFORGE_NEWS_TIMEOUT_MS = 5000;
/** Six hours: the feed changes a few times a month. */
export const COREFORGE_NEWS_REVALIDATE_SECONDS = 21600;

const FEED_HOSTS: readonly string[] = ['goldensdmat.in', 'www.goldensdmat.in'];
const MAX_FEED_CHARS = 1_000_000;
const MAX_TITLE_CHARS = 200;

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/** Text content of an element body: CDATA kept verbatim, entities decoded, tags dropped, whitespace collapsed. */
function textOf(raw: string): string {
  let out = '';
  let rest = raw;
  for (;;) {
    const start = rest.indexOf('<![CDATA[');
    if (start === -1) {
      out += decodeEntities(rest.replace(/<[^>]*>/g, ''));
      break;
    }
    out += decodeEntities(rest.slice(0, start).replace(/<[^>]*>/g, ''));
    const end = rest.indexOf(']]>', start + 9);
    if (end === -1) {
      out += rest.slice(start + 9);
      break;
    }
    out += rest.slice(start + 9, end);
    rest = rest.slice(end + 3);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function childTexts(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  return [...block.matchAll(re)].map((m) => textOf(m[1] ?? ''));
}

function feedLink(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !FEED_HOSTS.includes(url.hostname)) return null;
  return `https://goldensdmat.in${url.pathname}${url.search}${url.hash}`;
}

function isoDay(raw: string): string | null {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Items from an RSS 2.0 document, newest first. Malformed or off-site items are skipped. */
export function parseCoreforgeNews(xml: string): CoreforgeNewsItem[] {
  if (xml.length > MAX_FEED_CHARS) return [];
  const items: CoreforgeNewsItem[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1] ?? '';
    const title = (childTexts(block, 'title')[0] ?? '').slice(0, MAX_TITLE_CHARS).trim();
    const link = feedLink(childTexts(block, 'link')[0] ?? '');
    const date = isoDay(childTexts(block, 'pubDate')[0] ?? '');
    if (!title || !link || !date) continue;
    const id = childTexts(block, 'guid')[0] || link;
    if (seen.has(id)) continue;
    seen.add(id);
    const categories = childTexts(block, 'category')
      .map((c) => c.toLowerCase())
      .filter(Boolean);
    items.push({ id, title, link, date, categories });
  }
  // Stable sort: same-day items keep the feed's order.
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Categories whose items announce a date or a window; they go stale once their day passes. */
export const TIME_BOUND_CATEGORIES: readonly string[] = ['dates', 'registration', 'critical'];

const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * True when an item may still be promoted on `now`'s UTC day: not post-dated, and not a
 * deadline-style item whose day is already over. Undated input never gets this far
 * (the parser drops it).
 */
export function isTimelyCoreforgeNews(item: CoreforgeNewsItem, now: Date = new Date()): boolean {
  const today = utcDay(now);
  if (item.date > today) return false;
  if (item.date < today && item.categories.some((c) => TIME_BOUND_CATEGORIES.includes(c))) return false;
  return true;
}

/**
 * Items safe to show in promotional placements on `now`'s day: none that quotes a
 * price, none dated in the future and no deadline-style item whose date has passed.
 */
export function promotableCoreforgeNews(items: readonly CoreforgeNewsItem[], now: Date = new Date()): CoreforgeNewsItem[] {
  return items.filter((item) => !containsPrice(item.title) && isTimelyCoreforgeNews(item, now));
}

type NewsFetchInit = RequestInit & { next?: { revalidate?: number } };
type NewsFetch = (url: string, init?: NewsFetchInit) => Promise<Response>;

export type FetchCoreforgeNewsOptions = {
  /** Most items to return. Default 6. */
  limit?: number;
  /** Whole budget, headers and body. Default 5000 ms. */
  timeoutMs?: number;
  /** Next.js data-cache lifetime. Default six hours. */
  revalidate?: number;
  /** For tests. Default: the global fetch. */
  fetchImpl?: NewsFetch;
  /** The day the items must be timely for. Default: now. */
  now?: Date;
};

/**
 * The latest promotable news items (filtered for the day the call runs, so a
 * statically rendered page should revalidate at least daily), or [] when the feed is unreachable, slow, not
 * OK, oversized or unparseable. Never throws. Meant for Server Components and route
 * handlers, where Next caches it for `revalidate` seconds.
 */
export async function fetchCoreforgeNews({
  limit = 6,
  timeoutMs = COREFORGE_NEWS_TIMEOUT_MS,
  revalidate = COREFORGE_NEWS_REVALIDATE_SECONDS,
  fetchImpl,
  now,
}: FetchCoreforgeNewsOptions = {}): Promise<CoreforgeNewsItem[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const doFetch: NewsFetch = fetchImpl ?? ((url, init) => fetch(url, init));
  const read = (async () => {
    const res = await doFetch(COREFORGE_RSS_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' },
      next: { revalidate },
    });
    if (!res.ok) return null;
    return res.text();
  })().catch(() => null);
  try {
    const xml = await Promise.race([read, deadline]);
    if (typeof xml !== 'string') return [];
    return promotableCoreforgeNews(parseCoreforgeNews(xml), now ?? new Date()).slice(0, Math.max(0, limit));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
