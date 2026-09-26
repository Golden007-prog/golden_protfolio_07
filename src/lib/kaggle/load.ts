/*
 * Fetches the Kaggle section's data. The environment and fetch are injected, so
 * node --test can prove the credential rules and scripts/kaggle/snapshot.mjs can
 * reuse it; client.server.ts is the only app entry point and passes process.env.
 *
 * Credential rules:
 *   - KAGGLE_API_TOKEN (Bearer) first, then KAGGLE_USERNAME + KAGGLE_KEY (Basic).
 *   - A token is introspected and used only while it is active and belongs to USERNAME.
 *   - Credentials go only to IntrospectToken (in the body) and ListCompetitions
 *     (in the header). Profile, badges, writeups and visibility checks are always
 *     anonymous, so nothing private can come back from them.
 *   - Nothing here logs. Failure reasons are fixed strings plus HTTP status or an
 *     error name, never a message or a header, and a result that still contains
 *     a credential is discarded for the snapshot.
 *
 * Caching: every request here is cache: 'no-store'. client.server.ts caches the
 * whole successful load as one unit, so fetchedAt and each rank's as-of date are
 * stored with the data they describe, and a failed or short-lived reply (an MCP
 * isError, a revoked token) is never cached.
 */
import {
  API_BASE,
  FETCH_TIMEOUT_MS,
  LIVE_PUBLIC_WITHOUT_TOKEN,
  MAX_VISIBILITY_CHECKS,
  MCP_URL,
  USERNAME,
} from './config.ts';
import {
  fromSnapshot,
  isoDay,
  mergeWithSnapshot,
  normalizeBadges,
  normalizeCompetitions,
  normalizeProfile,
  normalizeWriteups,
  parseMcpToolResult,
  profileHidesBadges,
  urlSlug,
  type Selection,
} from './normalize.ts';
import type { KaggleCompetition, KaggleData } from './types.ts';

export type KaggleEnv = Readonly<Record<string, string | undefined>>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type Credentials = { bearer?: string; basic?: { username: string; key: string } };

function credentialsFrom(env: KaggleEnv): Credentials {
  const bearer = env.KAGGLE_API_TOKEN?.trim();
  const username = env.KAGGLE_USERNAME?.trim();
  const key = env.KAGGLE_KEY?.trim();
  return {
    ...(bearer ? { bearer } : {}),
    ...(username && key ? { basic: { username, key } } : {}),
  };
}

/** True when a token, or a legacy username + key pair, is configured. Says nothing about validity. */
export function hasCredentials(env: KaggleEnv): boolean {
  const c = credentialsFrom(env);
  return Boolean(c.bearer || c.basic);
}

function basicHeader(username: string, key: string): string {
  return `Basic ${btoa(`${username}:${key}`)}`;
}

// Every string that must never appear in output. Very short values are skipped:
// they cannot be real credentials and would match ordinary text.
function secretsOf(env: KaggleEnv): string[] {
  const c = credentialsFrom(env);
  const out = [env.KAGGLE_API_TOKEN, env.KAGGLE_KEY, c.bearer, c.basic?.key];
  if (c.basic) {
    try {
      out.push(basicHeader(c.basic.username, c.basic.key).slice(6));
    } catch {
      // btoa rejects non-Latin-1 input; such a key is never sent either.
    }
  }
  return out.filter((s): s is string => typeof s === 'string' && s.trim().length >= 8).map((s) => s.trim());
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------- */

type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (reason: string): Outcome<never> => ({ ok: false, reason });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type PostOptions = { authorization?: string; accept?: string; headers?: Record<string, string> };

async function postText(f: FetchLike, url: string, body: unknown, opts: PostOptions = {}): Promise<Outcome<{ status: number; text: string }>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: opts.accept ?? 'application/json',
    'User-Agent': 'basuoikantik.in-kaggle-section',
    ...opts.headers,
  };
  if (opts.authorization) headers.Authorization = opts.authorization;
  try {
    const res = await f(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    return ok({ status: res.status, text: res.ok ? await res.text() : '' });
  } catch (err) {
    return fail(err instanceof Error && err.name ? err.name : 'network error');
  }
}

/** A JSON RPC reply. Non-2xx, a non-JSON body or a JSON error object is a failure. */
async function postJson(f: FetchLike, url: string, body: unknown, opts?: PostOptions): Promise<Outcome<Record<string, unknown>>> {
  const r = await postText(f, url, body, opts);
  if (!r.ok) return r;
  if (r.value.status < 200 || r.value.status >= 300) return fail(`HTTP ${r.value.status}`);
  let json: unknown;
  try {
    json = JSON.parse(r.value.text);
  } catch {
    return fail('not JSON');
  }
  if (!isRecord(json)) return fail('unexpected reply');
  if (json.error !== undefined) return fail('error reply');
  return ok(json);
}

const rpc = (service: string, method: string) => `${API_BASE}/${service}/${method}`;

/* ---------------------------------------------------------------------------
 * Calls
 * ------------------------------------------------------------------------- */

async function mcpUserProfile(f: FetchLike): Promise<Outcome<unknown>> {
  const r = await postText(
    f,
    MCP_URL,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_user_profile', arguments: { request: { userName: USERNAME } } },
    },
    { accept: 'application/json, text/event-stream', headers: { 'MCP-Protocol-Version': '2025-06-18' } },
  );
  if (!r.ok) return r;
  if (r.value.status < 200 || r.value.status >= 300) return fail(`HTTP ${r.value.status}`);
  const payload = parseMcpToolResult(r.value.text);
  return isRecord(payload) ? ok(payload) : fail('tool error');
}

function searchUser(f: FetchLike) {
  return postJson(f, rpc('search.SearchApiService', 'ListEntities'), {
    filters: { query: USERNAME, documentTypes: ['USER'] },
    pageSize: 5,
  });
}

function searchWriteups(f: FetchLike) {
  return postJson(f, rpc('search.SearchApiService', 'ListEntities'), {
    filters: {
      query: USERNAME,
      documentTypes: ['TOPIC'],
      discussionFilters: { writeUpInclusionType: 'WRITE_UP_INCLUSION_TYPE_ONLY' },
    },
    canonicalOrderBy: 'LIST_SEARCH_CONTENT_ORDER_BY_DATE_CREATED',
    pageSize: 50,
  });
}

/** The Authorization header to use, after the owner guard. */
async function authorize(f: FetchLike, creds: Credentials, now: Date): Promise<Outcome<string>> {
  let reason = 'no credentials';
  if (creds.bearer) {
    const r = await postJson(f, rpc('security.OAuthService', 'IntrospectToken'), { token: creds.bearer });
    if (r.ok) {
      const { active, username, exp } = r.value;
      const expired = typeof exp === 'number' && exp * 1000 <= now.getTime();
      if (active === true && typeof username === 'string' && username.toLowerCase() === USERNAME && !expired) {
        return ok(`Bearer ${creds.bearer}`);
      }
      reason = `token: inactive, expired or not @${USERNAME}`;
    } else {
      reason = `token check: ${r.reason}`;
    }
  }
  if (creds.basic) {
    if (creds.basic.username.toLowerCase() !== USERNAME) return fail(`KAGGLE_USERNAME is not ${USERNAME}`);
    try {
      return ok(basicHeader(creds.basic.username, creds.basic.key));
    } catch {
      return fail('KAGGLE_KEY is not plain ASCII');
    }
  }
  return fail(reason);
}

const MAX_PAGES = 3;

async function enteredCompetitions(f: FetchLike, authorization: string): Promise<Outcome<unknown[]>> {
  const all: unknown[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await postJson(
      f,
      rpc('competitions.CompetitionApiService', 'ListCompetitions'),
      {
        group: 'COMPETITION_LIST_TAB_ENTERED',
        sortBy: 'COMPETITION_SORT_BY_LATEST_DEADLINE',
        pageSize: 50,
        ...(pageToken ? { pageToken } : {}),
      },
      { authorization },
    );
    if (!r.ok) return r;
    all.push(...(Array.isArray(r.value.competitions) ? r.value.competitions : []));
    pageToken = typeof r.value.nextPageToken === 'string' ? r.value.nextPageToken : '';
    if (!pageToken) break;
  }
  return ok(all);
}

/**
 * Keeps a competition the snapshot does not already know only when an anonymous
 * GetCompetition returns it: the entered list comes from an authenticated call
 * and has no privacy field. A 4xx answer drops it; a network error or 5xx fails.
 */
async function keepPublic(f: FetchLike, comps: KaggleCompetition[], known: ReadonlySet<string>): Promise<Outcome<KaggleCompetition[]>> {
  const unknown = comps.filter((c) => !known.has(urlSlug(c.url)));
  const checked = unknown.slice(0, MAX_VISIBILITY_CHECKS);
  const verdicts = await Promise.all(
    checked.map(async (c): Promise<Outcome<boolean>> => {
      const slug = urlSlug(c.url);
      const r = await postText(f, rpc('competitions.CompetitionApiService', 'GetCompetition'), { competitionName: slug });
      if (!r.ok) return r;
      if (r.value.status >= 500 || r.value.status === 429) return fail(`HTTP ${r.value.status}`);
      if (r.value.status < 200 || r.value.status >= 300) return ok(false);
      try {
        const json: unknown = JSON.parse(r.value.text);
        const ref = isRecord(json) ? String(json.url ?? json.ref ?? '') : '';
        return ok(isRecord(json) && json.error === undefined && urlSlug(ref) === slug);
      } catch {
        return ok(false);
      }
    }),
  );
  const publicSlugs = new Set<string>();
  for (let i = 0; i < checked.length; i++) {
    const v = verdicts[i];
    if (!v.ok) return fail(`visibility check: ${v.reason}`);
    if (v.value) publicSlugs.add(urlSlug(checked[i].url));
  }
  return ok(comps.filter((c) => known.has(urlSlug(c.url)) || publicSlugs.has(urlSlug(c.url))));
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------- */

export type LoadOptions = Selection & {
  env: KaggleEnv;
  snapshot: KaggleData;
  fetch?: FetchLike;
  now?: Date;
  /** Default LIVE_PUBLIC_WITHOUT_TOKEN. */
  publicWithoutToken?: boolean;
};

export type LoadResult = {
  data: KaggleData;
  /** Why live data was not used. Empty when data.source is 'live' or no credentials were set. */
  failures: string[];
  /** A credential passed the owner guard and was used. */
  usedCredentials: boolean;
};

async function load(opts: LoadOptions, now: Date): Promise<LoadResult> {
  const f = opts.fetch ?? fetch;
  const creds = credentialsFrom(opts.env);
  const hasCreds = Boolean(creds.bearer || creds.basic);
  const snapshotOnly: LoadResult = { data: fromSnapshot(opts.snapshot, now, opts), failures: [], usedCredentials: false };
  if (!hasCreds && !(opts.publicWithoutToken ?? LIVE_PUBLIC_WITHOUT_TOKEN)) return snapshotOnly;

  const competitionsCall = hasCreds
    ? authorize(f, creds, now).then(async (auth) => (auth.ok ? enteredCompetitions(f, auth.value) : auth))
    : Promise.resolve(null);
  const [profileR, userR, writeupsR, compsR] = await Promise.all([
    mcpUserProfile(f),
    searchUser(f),
    searchWriteups(f),
    competitionsCall,
  ]);

  const failures: string[] = [];
  if (!profileR.ok) failures.push(`profile: ${profileR.reason}`);
  if (!userR.ok) failures.push(`user search: ${userR.reason}`);
  if (!writeupsR.ok) failures.push(`writeups: ${writeupsR.reason}`);
  if (compsR && !compsR.ok) failures.push(`competitions: ${compsR.reason}`);

  const profile = profileR.ok && userR.ok ? normalizeProfile(profileR.value, userR.value) : null;
  const writeups = writeupsR.ok ? normalizeWriteups(writeupsR.value) : null;
  if (profileR.ok && userR.ok && !profile) failures.push(`profile: @${USERNAME} not found`);
  if (writeupsR.ok && !writeups) failures.push('writeups: unexpected reply');

  let competitions: KaggleCompetition[] | null = null;
  if (compsR?.ok) {
    competitions = normalizeCompetitions({ competitions: compsR.value }, { now, asOf: isoDay(now.toISOString()) });
    const known = new Set([...opts.snapshot.active, ...opts.snapshot.past].map((c) => urlSlug(c.url)));
    const visible = await keepPublic(f, competitions ?? [], known);
    if (visible.ok) competitions = visible.value;
    else failures.push(`competitions: ${visible.reason}`);
  }

  // A reply that parses but empties a list the snapshot fills is far likelier a
  // search-index hiccup or a changed payload shape than real deletions, so it
  // counts as a failure rather than silently hiding published work. Badges the
  // owner positively hid on Kaggle are the one empty list that is respected.
  const badges = profileR.ok ? normalizeBadges(profileR.value) : null;
  if (writeups?.length === 0 && opts.snapshot.writeups.length > 0) failures.push('writeups: empty reply');
  if (badges?.length === 0 && opts.snapshot.badges.length > 0 && !profileHidesBadges(profileR.ok ? profileR.value : null)) {
    failures.push('badges: empty reply');
  }
  if (competitions?.length === 0 && opts.snapshot.active.length + opts.snapshot.past.length > 0) {
    failures.push('competitions: empty reply');
  }

  if (failures.length) return { ...snapshotOnly, failures };

  const data = mergeWithSnapshot(
    { profile, badges, writeups, competitions },
    opts.snapshot,
    { ...opts, now, fetchedAt: now.toISOString(), source: 'live' },
  );
  return { data, failures: [], usedCredentials: compsR !== null };
}

/**
 * Live Kaggle data, or the snapshot when there are no credentials (unless
 * publicWithoutToken) or anything at all fails. Never throws, never logs.
 */
export async function loadKaggleData(opts: LoadOptions): Promise<LoadResult> {
  const now = opts.now ?? new Date();
  const secrets = secretsOf(opts.env);
  const scrub = (s: string) => secrets.reduce((acc, secret) => acc.split(secret).join('[redacted]'), s);
  try {
    const result = await load(opts, now);
    const serialised = JSON.stringify(result.data);
    if (secrets.some((s) => serialised.includes(s))) {
      return { data: fromSnapshot(opts.snapshot, now, opts), failures: ['a credential appeared in the reply'], usedCredentials: false };
    }
    return { ...result, failures: result.failures.map(scrub) };
  } catch (err) {
    const name = err instanceof Error && err.name ? err.name : 'error';
    return { data: fromSnapshot(opts.snapshot, now, opts), failures: [scrub(`unexpected ${name}`)], usedCredentials: false };
  }
}
