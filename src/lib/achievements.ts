/*
 * Hackathon results, submissions and launches from src/data/achievements.json,
 * each one a claim Oikantik made publicly in his own posts. Rules the data keeps,
 * and parseAchievements enforces where it can:
 *   - no ranks, prizes or numbers beyond what he posted;
 *   - PULSE's demo figures come from a scripted simulation, so a percentage is
 *     refused unless the same text says 'scripted simulation';
 *   - teammates are never named: a team entry says 'team of two'.
 *
 * Pure (the data is passed in) so node --test can run it; relative .ts imports
 * for the same reason. Components parse the JSON once:
 *   import raw from '@/data/achievements.json';
 *   const ACHIEVEMENTS = parseAchievements(raw);
 */
import { compareYearMonth, parseYearMonth } from '../utils/dates.ts';

export const ACHIEVEMENT_KINDS = ['finalist', 'submission', 'build', 'founder'] as const;
export type AchievementKind = (typeof ACHIEVEMENT_KINDS)[number];

export const ACHIEVEMENT_KIND_LABEL: Readonly<Record<AchievementKind, string>> = {
  finalist: 'Finalist',
  submission: 'Submission',
  build: 'Build',
  founder: 'Founder',
};

export type AchievementLink = { label: string; url: string };

export type Achievement = {
  /** Kebab slug, unique. */
  id: string;
  title: string;
  /** Who ran the event, as the post names them. */
  organizers?: readonly string[];
  /** 'YYYY-MM'. */
  date: string;
  kind: AchievementKind;
  /** Slug of the project on this site, when it has one. */
  project?: string;
  /** 'team of two'; absent for solo work. Never a name. */
  team?: string;
  summary: string;
  links: readonly AchievementLink[];
};

export type AchievementData = { items: readonly Achievement[] };

const TEAM = /^team of (?:two|three|four|five|six)$/;
const SIMULATED = /scripted simulation/i;

function isString(x: unknown): x is string {
  return typeof x === 'string' && x.trim() !== '';
}

function isHttpsUrl(x: unknown): boolean {
  if (!isString(x)) return false;
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
}

function fail(msg: string): never {
  throw new Error(`achievements.json: ${msg}`);
}

/**
 * The JSON import checked and typed. Throws on the first problem, so a bad edit
 * fails the build instead of shipping.
 */
export function parseAchievements(raw: unknown): AchievementData {
  if (!raw || typeof raw !== 'object') fail('not an object');
  const { items } = raw as { items?: unknown };
  if (!Array.isArray(items)) fail('items must be an array');

  const out: Achievement[] = [];
  const ids = new Set<string>();
  for (const [i, x] of (items as unknown[]).entries()) {
    const a = (x ?? {}) as Record<string, unknown>;
    const at = `items[${i}]`;
    for (const key of ['id', 'title', 'date', 'kind', 'summary'] as const) {
      if (!isString(a[key])) fail(`${at}.${key} is missing`);
    }
    const id = a.id as string;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${at}.id '${id}' is not a kebab slug`);
    if (ids.has(id)) fail(`${at}.id '${id}' is not unique`);
    ids.add(id);
    if (!parseYearMonth(a.date as string) || (a.date as string).trim() !== a.date) fail(`${at}.date '${String(a.date)}' is not YYYY-MM`);
    if (!(ACHIEVEMENT_KINDS as readonly string[]).includes(a.kind as string)) fail(`${at}.kind '${String(a.kind)}' is unknown`);
    if (a.organizers !== undefined && !(Array.isArray(a.organizers) && a.organizers.every(isString))) fail(`${at}.organizers must list names`);
    if (a.project !== undefined && !(isString(a.project) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.project))) fail(`${at}.project must be a slug`);
    if (a.team !== undefined && !(isString(a.team) && TEAM.test(a.team))) fail(`${at}.team must read 'team of two' and never name anyone`);
    if (!Array.isArray(a.links) || a.links.length === 0) fail(`${at}.links must hold at least one link`);
    for (const [j, l] of (a.links as unknown[]).entries()) {
      const link = (l ?? {}) as Record<string, unknown>;
      if (!isString(link.label) || !isHttpsUrl(link.url)) fail(`${at}.links[${j}] needs a label and an https url`);
    }
    const text = `${a.title as string} ${a.summary as string}`;
    if (/%/.test(text) && !SIMULATED.test(text)) fail(`${at} states a percentage without saying it is from a scripted simulation`);

    const item: Achievement = {
      id,
      title: a.title as string,
      date: a.date as string,
      kind: a.kind as AchievementKind,
      summary: a.summary as string,
      links: (a.links as Record<string, string>[]).map((l) => ({ label: l.label, url: l.url })),
    };
    if (a.organizers !== undefined) item.organizers = a.organizers as string[];
    if (a.project !== undefined) item.project = a.project as string;
    if (a.team !== undefined) item.team = a.team as string;
    out.push(item);
  }
  return { items: out };
}

/** Newest first; entries from the same month keep file order. */
export function allAchievements(data: AchievementData): Achievement[] {
  return [...data.items].sort((a, b) => compareYearMonth(b.date, a.date) ?? 0);
}

export function achievementsByKind(data: AchievementData, kind: AchievementKind): Achievement[] {
  return allAchievements(data).filter((a) => a.kind === kind);
}

/** The entries tied to one project, for its card or case study. */
export function achievementsForProject(data: AchievementData, slug: string): Achievement[] {
  return allAchievements(data).filter((a) => a.project === slug);
}

/** Project slugs the data refers to that `known` does not contain. */
export function unknownProjects(data: AchievementData, known: readonly string[]): string[] {
  const have = new Set(known);
  return [...new Set(data.items.flatMap((a) => (a.project && !have.has(a.project) ? [a.project] : [])))];
}
