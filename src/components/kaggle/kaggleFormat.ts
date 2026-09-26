/*
 * Pure helpers behind the Kaggle section: ordering, grouping and the labels for
 * dates, ranks and deadlines. Nothing here invents a number; every label is built
 * from a field the Kaggle API or the snapshot supplied, and a rank without a team
 * count or an as-of date gets no label at all.
 *
 * Structural types, relative .ts imports and no JSON, so node --test runs it
 * directly. Labels use fixed English month names and en-US digit grouping, so the
 * server and every browser print the same string.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type BadgeLike = { name: string; achieved?: string | null; featured?: boolean | null };
export type WriteupLike = { published?: string | null; project?: string | null; competitionUrl?: string | null };
export type CompetitionLike = { url: string; deadline?: string | null; active?: boolean | null; hasWriteup?: boolean | null };

/**
 * Epoch ms for 'YYYY-MM-DD' (UTC midnight) or a full ISO timestamp; null for
 * anything else, including impossible dates such as 2026-02-31.
 */
export function parseDay(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const m = DATE_ONLY.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** '2026-09-26' or an ISO timestamp -> '26 Sep 2026', read in UTC; null for bad input. */
export function formatDay(value: string | null | undefined): string | null {
  const t = parseDay(value);
  if (t === null) return null;
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 3908 -> '3,908'. */
export function formatCount(n: number): string {
  return NUMBER.format(n);
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

const isPositiveInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/**
 * 'Rank 183 of 3,908 teams · as of 26 Sep 2026'. A rank is a live leaderboard
 * position, so it is only shown with the field size and the date it was read;
 * missing either (or a rank outside the field) gives null and no rank is shown.
 */
export function rankLabel(
  rank: number | null | undefined,
  teams: number | null | undefined,
  asOf: string | null | undefined,
): string | null {
  if (!isPositiveInt(rank) || !isPositiveInt(teams) || rank > teams) return null;
  const day = formatDay(asOf);
  if (!day) return null;
  return `Rank ${formatCount(rank)} of ${plural(teams, 'team', 'teams')} · as of ${day}`;
}

/**
 * When entries close, in epoch ms. Kaggle deadlines fall at 23:59 UTC, so a bare
 * date means the end of that day rather than its first minute.
 */
export function deadlineMs(deadline: string | null | undefined): number | null {
  const t = parseDay(deadline);
  if (t === null) return null;
  return DATE_ONLY.test(String(deadline).trim()) ? t + DAY - MINUTE : t;
}

export type Countdown = { label: string; closed: boolean; soon: boolean };

/**
 * 'Closes in 3 days', 'Closes in 5 hours', or 'Closed' once the deadline has
 * passed. `soon` marks the last three days. Whole units round down, so the label
 * never promises more time than is left.
 */
export function countdown(deadline: string | null | undefined, now: number): Countdown | null {
  const end = deadlineMs(deadline);
  if (end === null || !Number.isFinite(now)) return null;
  const left = end - now;
  if (left <= 0) return { label: 'Closed', closed: true, soon: false };
  if (left < HOUR) return { label: 'Closes within the hour', closed: false, soon: true };
  if (left < DAY) return { label: `Closes in ${plural(Math.floor(left / HOUR), 'hour', 'hours')}`, closed: false, soon: true };
  const days = Math.floor(left / DAY);
  return { label: `Closes in ${plural(days, 'day', 'days')}`, closed: false, soon: days <= 3 };
}

/**
 * How long ago `iso` was, for 'Updated … · live from Kaggle': 'just now',
 * '5 minutes ago', '3 hours ago', '2 days ago', and past 30 days the date itself.
 * A timestamp slightly in the future (clock skew) reads as 'just now'.
 */
export function relativeTime(iso: string | null | undefined, now: number): string | null {
  const t = parseDay(iso);
  if (t === null || !Number.isFinite(now)) return null;
  const ago = now - t;
  if (ago < MINUTE) return 'just now';
  if (ago < HOUR) return `${plural(Math.floor(ago / MINUTE), 'minute', 'minutes')} ago`;
  if (ago < DAY) return `${plural(Math.floor(ago / HOUR), 'hour', 'hours')} ago`;
  if (ago < 30 * DAY) return `${plural(Math.floor(ago / DAY), 'day', 'days')} ago`;
  return formatDay(iso);
}

/** Newest first; undated entries last, in their original order. */
export function sortWriteups<T extends WriteupLike>(list: readonly T[]): T[] {
  return list
    .map((w, i) => ({ w, i, t: parseDay(w.published) }))
    .sort((a, b) => {
      if (a.t === null || b.t === null) return a.t === b.t ? a.i - b.i : a.t === null ? 1 : -1;
      return b.t - a.t || a.i - b.i;
    })
    .map((x) => x.w);
}

/**
 * Featured badges first, in the order they arrive (the owner's chosen order, see
 * FEATURED_BADGES in src/lib/kaggle/config.ts); then the rest, newest first, then by name.
 */
export function sortBadges<T extends BadgeLike>(list: readonly T[]): T[] {
  return list
    .map((b, i) => ({ b, i, t: parseDay(b.achieved) ?? -Infinity }))
    .sort((a, b) => {
      const featured = Number(Boolean(b.b.featured)) - Number(Boolean(a.b.featured));
      if (featured) return featured;
      if (a.b.featured) return a.i - b.i;
      if (a.t !== b.t) return b.t - a.t;
      return a.b.name.localeCompare(b.b.name, 'en') || a.i - b.i;
    })
    .map((x) => x.b);
}

/**
 * Active entries (soonest deadline first) and past ones (most recent first).
 * `reference` is the moment the data was read, not the visitor's clock, so the
 * server and the browser always put a competition in the same group; the live
 * countdown on each card is what reflects the visitor's own time.
 */
export function splitCompetitions<T extends CompetitionLike>(
  list: readonly T[],
  reference: number | null,
): { active: T[]; past: T[] } {
  const active: T[] = [];
  const past: T[] = [];
  for (const c of list) {
    const end = deadlineMs(c.deadline);
    const open = c.active === true && (reference === null || end === null || end > reference);
    (open ? active : past).push(c);
  }
  const at = (c: T) => deadlineMs(c.deadline);
  active.sort((a, b) => (at(a) ?? Infinity) - (at(b) ?? Infinity));
  past.sort((a, b) => (at(b) ?? -Infinity) - (at(a) ?? -Infinity));
  return { active, past };
}

function normalizeUrl(url: string | null | undefined): string {
  return typeof url === 'string' ? url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase() : '';
}

/** True when the competition is flagged as written up or a listed writeup belongs to it. */
export function hasWriteup(competition: CompetitionLike, writeups: readonly WriteupLike[]): boolean {
  if (competition.hasWriteup === true) return true;
  const url = normalizeUrl(competition.url);
  return url !== '' && writeups.some((w) => normalizeUrl(w.competitionUrl) === url);
}

/** The writeup linked to a project on this site (its slug), for case studies and project cards. */
export function writeupForProject<T extends WriteupLike>(writeups: readonly T[], slug: string): T | null {
  return writeups.find((w) => typeof w.project === 'string' && w.project === slug) ?? null;
}

/** Up to two initials for a badge whose image failed: 'Code Submitter' -> 'CS', '7 Day Login Streak' -> '7D'. */
export function badgeInitials(name: string): string {
  const words = name.split(/[\s-]+/).filter((w) => /[A-Za-z0-9]/.test(w));
  return words
    .slice(0, 2)
    .map((w) => (/[A-Za-z0-9]/.exec(w)?.[0] ?? '').toUpperCase())
    .join('');
}

function parseUrl(url: string | null | undefined): URL | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    return new URL(url.trim());
  } catch {
    return null;
  }
}

/** The URL itself when it is an https link on kaggle.com, else null: live data only ever links to Kaggle. */
export function kaggleHref(url: string | null | undefined): string | null {
  const u = parseUrl(url);
  return u && u.protocol === 'https:' && /(^|\.)kaggle\.com$/i.test(u.hostname) ? String(url).trim() : null;
}

/** The URL itself when it is https, else null (badge art and avatars live on Google storage hosts). */
export function httpsSrc(url: string | null | undefined): string | null {
  const u = parseUrl(url);
  return u && u.protocol === 'https:' ? String(url).trim() : null;
}
