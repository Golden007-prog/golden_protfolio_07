/*
 * Live GitHub and LeetCode data: the shared response types, the upstream fetchers
 * used by /api/github, /api/leetcode and scripts/snapshot-live-data.mjs, and a
 * tiny client store the widgets read through useSyncExternalStore.
 *
 * No React, no JSON imports and only relative .ts imports, so the Node snapshot
 * script can load this file directly and route handlers can import it too.
 * Browsers only ever talk to our own /api routes.
 */
import { calendarFromTimestamps, normalizeDays, type Day } from '../utils/contributionStats.ts';

export type LatestPush = { repo: string; url: string; message?: string; createdAt: string };

export type GitHubLive = {
  contributions: { total: number; days: Day[] };
  latestPush: LatestPush | null;
  /** Some or all of it came from the build-time snapshot. */
  stale?: boolean;
  /** When this response was built (ISO). */
  fetchedAt?: string;
  /** When the snapshot behind a stale response was taken (ISO). */
  snapshotAt?: string;
};

export type LeetCodeLive = {
  username: string;
  totalSolved: number;
  easy: number;
  medium: number;
  hard: number;
  /** Global ranking; 0 when unknown. */
  ranking: number;
  /** LeetCode's calendar streak (its longest run of active days). */
  streak: number;
  totalActiveDays: number;
  /** Submissions per UTC day, keyed 'YYYY-MM-DD'. */
  calendar: Record<string, number>;
  stale?: boolean;
  fetchedAt?: string;
  snapshotAt?: string;
};

export type LiveSnapshot = {
  generatedAt: string | null;
  github: GitHubLive | null;
  leetcode: LeetCodeLive | null;
};

/* ---------------------------------------------------------------------------
 * Upstream fetchers (server and build script)
 * ------------------------------------------------------------------------- */

export const UPSTREAM_TIMEOUT_MS = 8000;
export const REVALIDATE_SECONDS = 600;

// leetcode.com rejects GraphQL calls that do not look like its own site.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

type FetchInit = RequestInit & { next?: { revalidate?: number } };

async function getJson(url: string, init: FetchInit = {}): Promise<unknown> {
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

function githubHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'basuoikantik.in-live-data',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** A year of contribution days from jogruber's public API. Null when it fails. */
export async function fetchContributions(user: string): Promise<GitHubLive['contributions'] | null> {
  const json = await getJson(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=last`, {
    headers: { Accept: 'application/json' },
  });
  if (!isRecord(json)) return null;
  const days = normalizeDays(json.contributions);
  if (days.length === 0) return null;
  const total = isRecord(json.total) ? num(json.total.lastYear) : 0;
  return { total: total || days.reduce((n, d) => n + d.count, 0), days };
}

/**
 * The newest public push. Events no longer embed commits, so the message comes
 * from the head commit. `undefined` means GitHub could not be reached; `null`
 * means there is no recent push.
 */
export async function fetchLatestPush(user: string, token?: string): Promise<LatestPush | null | undefined> {
  const headers = githubHeaders(token);
  const events = await getJson(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=30`, { headers });
  if (!Array.isArray(events)) return undefined;
  const push = events.find(
    (e): e is Record<string, unknown> => isRecord(e) && e.type === 'PushEvent' && isRecord(e.repo) && isRecord(e.payload),
  );
  if (!push) return null;
  const fullName = String((push.repo as Record<string, unknown>).name ?? '');
  const payload = push.payload as Record<string, unknown>;
  const sha = typeof payload.head === 'string' ? payload.head : '';
  const createdAt = typeof push.created_at === 'string' ? push.created_at : '';
  if (!fullName || !createdAt) return null;

  let message: string | undefined;
  let url = `https://github.com/${fullName}`;
  const embedded = Array.isArray(payload.commits) ? payload.commits.find(isRecord) : undefined;
  if (embedded && typeof embedded.message === 'string') message = embedded.message;
  if (sha) {
    url = `https://github.com/${fullName}/commit/${sha}`;
    if (!message) {
      const commit = await getJson(`https://api.github.com/repos/${fullName}/commits/${sha}`, { headers });
      if (isRecord(commit) && isRecord(commit.commit) && typeof commit.commit.message === 'string') {
        message = commit.commit.message;
      }
    }
  }
  const firstLine = message?.split('\n')[0]?.trim();
  return {
    repo: fullName.split('/')[1] ?? fullName,
    url,
    ...(firstLine ? { message: firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine } : {}),
    createdAt,
  };
}

const LEETCODE_QUERY = `query userProfile($username: String!) {
  matchedUser(username: $username) {
    submitStatsGlobal { acSubmissionNum { difficulty count } }
    profile { ranking }
    userCalendar { streak totalActiveDays submissionCalendar }
  }
}`;

function solvedFrom(list: unknown): { total: number; easy: number; medium: number; hard: number } | null {
  if (!Array.isArray(list)) return null;
  const by = (d: string) => num(list.find((x) => isRecord(x) && x.difficulty === d)?.count);
  const out = { total: by('All'), easy: by('Easy'), medium: by('Medium'), hard: by('Hard') };
  return out.total > 0 || out.easy + out.medium + out.hard > 0 ? out : null;
}

/** LeetCode's own GraphQL endpoint. Cloudflare often challenges datacenter IPs, so this can fail. */
async function leetcodeGraphql(user: string): Promise<LeetCodeLive | null> {
  const json = await getJson('https://leetcode.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: 'https://leetcode.com',
      Referer: `https://leetcode.com/${user}/`,
      'User-Agent': BROWSER_UA,
    },
    body: JSON.stringify({ query: LEETCODE_QUERY, variables: { username: user } }),
  });
  const u = isRecord(json) && isRecord(json.data) && isRecord(json.data.matchedUser) ? json.data.matchedUser : null;
  if (!u) return null;
  const solved = solvedFrom(isRecord(u.submitStatsGlobal) ? u.submitStatsGlobal.acSubmissionNum : null);
  if (!solved) return null;
  const cal = isRecord(u.userCalendar) ? u.userCalendar : {};
  return {
    username: user,
    totalSolved: solved.total || solved.easy + solved.medium + solved.hard,
    easy: solved.easy,
    medium: solved.medium,
    hard: solved.hard,
    ranking: isRecord(u.profile) ? num(u.profile.ranking) : 0,
    streak: num(cal.streak),
    totalActiveDays: num(cal.totalActiveDays),
    calendar: calendarFromTimestamps(cal.submissionCalendar),
  };
}

const ALFA = 'https://alfa-leetcode-api.onrender.com';

/** The community alfa-leetcode-api mirror, used when leetcode.com refuses us. */
async function leetcodeAlfa(user: string): Promise<LeetCodeLive | null> {
  const u = encodeURIComponent(user);
  const [solvedJson, calendarJson, profileJson] = await Promise.all([
    getJson(`${ALFA}/${u}/solved`),
    getJson(`${ALFA}/${u}/calendar`),
    getJson(`${ALFA}/${u}`),
  ]);
  if (!isRecord(solvedJson)) return null;
  const solved =
    solvedFrom(solvedJson.acSubmissionNum) ??
    (num(solvedJson.solvedProblem) > 0
      ? {
          total: num(solvedJson.solvedProblem),
          easy: num(solvedJson.easySolved),
          medium: num(solvedJson.mediumSolved),
          hard: num(solvedJson.hardSolved),
        }
      : null);
  if (!solved) return null;
  const cal = isRecord(calendarJson) ? calendarJson : {};
  return {
    username: user,
    totalSolved: solved.total || solved.easy + solved.medium + solved.hard,
    easy: solved.easy,
    medium: solved.medium,
    hard: solved.hard,
    ranking: isRecord(profileJson) ? num(profileJson.ranking) : 0,
    streak: num(cal.streak),
    totalActiveDays: num(cal.totalActiveDays),
    calendar: calendarFromTimestamps(cal.submissionCalendar),
  };
}

/** leetcode.com first, then the alfa mirror. Null when both fail. */
export async function fetchLeetCode(user: string): Promise<LeetCodeLive | null> {
  return (await leetcodeGraphql(user)) ?? (await leetcodeAlfa(user));
}

/* ---------------------------------------------------------------------------
 * Client store: one request per kind for the whole page, shared by every widget
 * ------------------------------------------------------------------------- */

export type LiveKind = 'github' | 'leetcode';
type LiveMap = { github: GitHubLive; leetcode: LeetCodeLive };
export type LiveEntry<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null };

export const IDLE_ENTRY: LiveEntry<never> = Object.freeze({ status: 'idle', data: null });

const CLIENT_TIMEOUT_MS = 15000;

const entries: { [K in LiveKind]: LiveEntry<LiveMap[K]> } = { github: IDLE_ENTRY, leetcode: IDLE_ENTRY };
const liveListeners = new Set<() => void>();

function setEntry<K extends LiveKind>(kind: K, next: LiveEntry<LiveMap[K]>) {
  (entries as Record<LiveKind, LiveEntry<unknown>>)[kind] = next;
  liveListeners.forEach((fn) => fn());
}

export function subscribeLive(fn: () => void): () => void {
  liveListeners.add(fn);
  return () => {
    liveListeners.delete(fn);
  };
}

export function getLive<K extends LiveKind>(kind: K): LiveEntry<LiveMap[K]> {
  return entries[kind];
}

function valid(kind: LiveKind, json: unknown): boolean {
  if (!isRecord(json)) return false;
  if (kind === 'github') return isRecord(json.contributions) && Array.isArray(json.contributions.days);
  return typeof json.totalSolved === 'number' && isRecord(json.calendar);
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  if (typeof AbortController === 'undefined') return undefined;
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Starts the request for `kind` unless one is running or done. `retry` re-runs a failed one. */
export function loadLive(kind: LiveKind, opts: { retry?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  const current = entries[kind];
  if (current.status === 'loading' || current.status === 'ready') return;
  if (current.status === 'error' && !opts.retry) return;
  setEntry(kind, { status: 'loading', data: null });
  fetch(`/api/${kind}`, { headers: { Accept: 'application/json' }, signal: timeoutSignal(CLIENT_TIMEOUT_MS) })
    .then((res) => (res.ok ? res.json() : null))
    .then((json: unknown) => {
      if (valid(kind, json)) setEntry(kind, { status: 'ready', data: json as LiveMap[typeof kind] });
      else setEntry(kind, { status: 'error', data: null });
    })
    .catch(() => setEntry(kind, { status: 'error', data: null }));
}
