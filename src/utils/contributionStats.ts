/*
 * Pure calendar helpers for the GitHub and LeetCode heatmaps and the live-data
 * routes. No imports and no JSON, so `node --test` can load it directly.
 * Dates are 'YYYY-MM-DD' strings read as UTC days, so results never depend on
 * the visitor's time zone.
 */

export type Level = 0 | 1 | 2 | 3 | 4;
export type Day = { date: string; count: number; level: Level };

export type BusiestWeekday = { index: number; name: string; total: number };

export type ContributionSummary = {
  total: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  busiestWeekday: BusiestWeekday | null;
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Epoch ms of a 'YYYY-MM-DD' day at UTC midnight, or NaN. */
export function dayMs(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(dayMs(date)).getUTCDay();
}

/** 'Tue, 3 Mar 2026'. Fixed English names, so server and browser agree. */
export function formatDay(date: string): string {
  const ms = dayMs(date);
  if (Number.isNaN(ms)) return date;
  const d = new Date(ms);
  return `${WEEKDAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** '1 contribution', '12 contributions', '1,204 contributions'. */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** Heat bucket for a raw daily count (LeetCode submissions). */
export function levelFor(count: number): Level {
  if (!(count > 0)) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

function clampLevel(v: unknown, count: number): Level {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : levelFor(count);
  return Math.min(4, Math.max(0, n)) as Level;
}

/**
 * Validates a contributions array (jogruber's shape or our own), drops malformed
 * entries and sorts it oldest first. A missing level is derived from the count.
 */
export function normalizeDays(input: unknown): Day[] {
  if (!Array.isArray(input)) return [];
  const out: Day[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const { date, count, level } = raw as { date?: unknown; count?: unknown; level?: unknown };
    if (typeof date !== 'string' || Number.isNaN(dayMs(date))) continue;
    const c = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
    out.push({ date, count: c, level: c === 0 ? 0 : clampLevel(level, c) });
  }
  return out.sort((a, b) => dayMs(a.date) - dayMs(b.date));
}

/**
 * LeetCode's submissionCalendar ({"<unix seconds>": count}, often as a JSON
 * string) folded into { 'YYYY-MM-DD': count }.
 */
export function calendarFromTimestamps(raw: unknown): Record<string, number> {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const out: Record<string, number> = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [ts, c] of Object.entries(obj as Record<string, unknown>)) {
    const seconds = Number(ts);
    const count = Number(c);
    if (!Number.isFinite(seconds) || !Number.isFinite(count) || count <= 0) continue;
    const key = isoDay(seconds * 1000);
    out[key] = (out[key] ?? 0) + count;
  }
  return out;
}

/** `length` consecutive days ending on `today` ('YYYY-MM-DD'), with counts from the calendar. */
export function lastYearDays(calendar: Readonly<Record<string, number>>, today: string, length = 365): Day[] {
  const end = dayMs(today);
  if (Number.isNaN(end) || length <= 0) return [];
  const days: Day[] = [];
  for (let i = length - 1; i >= 0; i--) {
    const date = isoDay(end - i * DAY_MS);
    const raw = calendar[date];
    const count = typeof raw === 'number' && raw > 0 ? raw : 0;
    days.push({ date, count, level: levelFor(count) });
  }
  return days;
}

/** The longest run of consecutive active days; a gap in the dates breaks a run. */
export function longestStreak(days: readonly Day[]): number {
  let best = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const d of days) {
    const ms = dayMs(d.date);
    if (d.count > 0) {
      run = ms - prev === DAY_MS && run > 0 ? run + 1 : 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
    prev = ms;
  }
  return best;
}

/**
 * Consecutive active days ending on the newest day. An empty newest day (today,
 * before anything was pushed) does not break the streak; an empty yesterday does.
 */
export function currentStreak(days: readonly Day[]): number {
  let i = days.length - 1;
  if (i >= 0 && days[i].count === 0) i--;
  let n = 0;
  let next = Number.NaN;
  while (i >= 0 && days[i].count > 0) {
    const ms = dayMs(days[i].date);
    if (n > 0 && next - ms !== DAY_MS) break;
    n++;
    next = ms;
    i--;
  }
  return n;
}

export function activeDays(days: readonly Day[]): number {
  return days.reduce((n, d) => n + (d.count > 0 ? 1 : 0), 0);
}

export function totalCount(days: readonly Day[]): number {
  return days.reduce((n, d) => n + d.count, 0);
}

/** The weekday with the most activity in total; ties go to the earlier day (Sunday first). Null when idle. */
export function busiestWeekday(days: readonly Day[]): BusiestWeekday | null {
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of days) {
    const wd = weekdayOf(d.date);
    if (!Number.isNaN(wd)) totals[wd] += d.count;
  }
  let index = -1;
  for (let i = 0; i < 7; i++) if (totals[i] > 0 && (index === -1 || totals[i] > totals[index])) index = i;
  return index === -1 ? null : { index, name: WEEKDAYS[index], total: totals[index] };
}

export function summarize(days: readonly Day[]): ContributionSummary {
  return {
    total: totalCount(days),
    activeDays: activeDays(days),
    currentStreak: currentStreak(days),
    longestStreak: longestStreak(days),
    busiestWeekday: busiestWeekday(days),
  };
}

/**
 * Sunday-first week columns, oldest first, as GitHub draws them. The first and
 * last columns are padded with null where the range starts or ends mid-week.
 */
export function toWeeks(days: readonly Day[]): (Day | null)[][] {
  if (days.length === 0) return [];
  const weeks: (Day | null)[][] = [];
  let week: (Day | null)[] = Array.from({ length: weekdayOf(days[0].date) }, () => null);
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

/**
 * Month names over the week columns where a month begins. A label closer than
 * `minGap` columns to the previous one is dropped, so a partial first month
 * never overprints the next.
 */
export function monthLabels(weeks: readonly (readonly (Day | null)[])[], minGap = 3): { col: number; label: string }[] {
  const out: { col: number; label: string }[] = [];
  let prevMonth = -1;
  weeks.forEach((week, col) => {
    const first = week.find((d): d is Day => d !== null);
    if (!first) return;
    const month = new Date(dayMs(first.date)).getUTCMonth();
    if (month === prevMonth) return;
    prevMonth = month;
    const last = out[out.length - 1];
    if (last && col - last.col < minGap) out.pop();
    out.push({ col, label: MONTHS_SHORT[month] });
  });
  return out;
}

/** The last path segment of a profile URL: 'https://leetcode.com/u/name/' -> 'name'. */
export function usernameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] ?? '');
  } catch {
    return '';
  }
}
