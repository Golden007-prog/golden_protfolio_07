/**
 * Month-precision dates as stored in profile.json ('YYYY-MM', or null for an open
 * end). Pure and locale-free: labels use fixed English month names so the server
 * and every browser print the same string.
 */

export type YearMonth = { year: number; month: number };
export type LabelStyle = 'short' | 'long';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function parseYearMonth(value: string | null | undefined): YearMonth | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function index(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The calendar month of `date` in the runtime's local time zone, as 'YYYY-MM'. */
export function toYearMonth(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/** 'YYYY-MM' of an ISO timestamp, read in UTC (so it matches on the server and the client). */
export function isoToYearMonth(iso: string | null | undefined): string | null {
  const d = parseIso(iso);
  return d ? `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}` : null;
}

/** -1, 0 or 1; null when either side is not a 'YYYY-MM' string. */
export function compareYearMonth(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const x = parseYearMonth(a);
  const y = parseYearMonth(b);
  if (!x || !y) return null;
  const d = index(x) - index(y);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/**
 * Months from start to end counting both end months, the way LinkedIn does:
 * Mar 2025 to Jun 2025 is 4. Null for bad input or an end before the start.
 */
export function monthsBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const a = parseYearMonth(start);
  const b = parseYearMonth(end);
  if (!a || !b) return null;
  const n = index(b) - index(a) + 1;
  return n > 0 ? n : null;
}

/** 16 -> '1 yr 4 mos' (short) or '1 year 4 months' (long). '' below one month. */
export function formatDuration(months: number, style: LabelStyle = 'short'): string {
  if (!Number.isFinite(months) || months < 1) return '';
  const whole = Math.floor(months);
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  const parts: string[] = [];
  if (years) parts.push(style === 'short' ? `${years} yr${years > 1 ? 's' : ''}` : `${years} year${years > 1 ? 's' : ''}`);
  if (rest) parts.push(style === 'short' ? `${rest} mo${rest > 1 ? 's' : ''}` : `${rest} month${rest > 1 ? 's' : ''}`);
  return parts.join(' ');
}

/**
 * Duration of a role. An open end (null) runs to `now` ('YYYY-MM'); without a
 * `now` an open role has no duration yet.
 */
export function durationLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  now: string | null,
  style: LabelStyle = 'short',
): string | null {
  const until = end ?? now;
  const n = monthsBetween(start, until);
  return n ? formatDuration(n, style) : null;
}

/** '2025-03' -> 'Mar 2025' (short) or 'March 2025' (long); '' for bad input. */
export function formatYearMonth(value: string | null | undefined, style: LabelStyle = 'short'): string {
  const ym = parseYearMonth(value);
  if (!ym) return '';
  return `${(style === 'short' ? MONTHS_SHORT : MONTHS_LONG)[ym.month - 1]} ${ym.year}`;
}

/**
 * 'Expected Feb 2027' while `end` is still after `reference` ('YYYY-MM'),
 * otherwise null: a finished item shows its own status instead.
 */
export function expectedLabel(end: string | null | undefined, reference: string | null): string | null {
  if (compareYearMonth(end, reference) !== 1) return null;
  return `Expected ${formatYearMonth(end)}`;
}

function parseIso(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || !iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** '2026-09-25T10:00:00Z' -> 'Sep 25, 2026', in UTC; null for bad input. */
export function formatIsoDate(iso: string | null | undefined): string | null {
  const d = parseIso(iso);
  if (!d) return null;
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The UTC year of an ISO timestamp; null for bad input. */
export function isoYear(iso: string | null | undefined): number | null {
  return parseIso(iso)?.getUTCFullYear() ?? null;
}
