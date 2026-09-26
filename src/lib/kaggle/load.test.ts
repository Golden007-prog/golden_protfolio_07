import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hasCredentials, loadKaggleData, type FetchLike, type KaggleEnv } from './load.ts';
import { coerceSnapshot, parseMcpToolResult, rankLabel } from './normalize.ts';
import type { KaggleData } from './types.ts';

// Real anonymous replies captured on 2026-09-26 (bodies trimmed). The authenticated
// ListCompetitions reply below is built from the SDK's ApiCompetition field names,
// since no authenticated call was made while writing this.
const fixture = (file: string) => readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8');
const PROFILE_SSE = fixture('mcp-get-user-profile.sse');
const USER_SEARCH = JSON.parse(fixture('list-entities-user.json'));
const WRITEUP_SEARCH = JSON.parse(fixture('list-entities-writeups.json'));
const BIOHUB = JSON.parse(fixture('get-competition-biohub.json'));
const SNAPSHOT: KaggleData = coerceSnapshot(JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8')));

const NOW = new Date('2026-09-27T12:00:00Z');
const TOKEN = 'KGAT_fake_0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const LEGACY_KEY = 'fakelegacykey0123456789abcdef0123';
const LEGACY_BASIC = btoa(`oikantikbasu007:${LEGACY_KEY}`);
const SECRETS = [TOKEN, LEGACY_KEY, LEGACY_BASIC];

const comp = (slug: string, extra: Record<string, unknown>) => ({
  id: 1,
  ref: `https://www.kaggle.com/competitions/${slug}`,
  url: `https://www.kaggle.com/competitions/${slug}`,
  userHasEntered: true,
  ...extra,
});

const ENTERED = {
  competitions: [
    comp('biohub-cell-tracking-during-development', {
      title: 'Biohub - Cell Tracking During Development',
      description: 'Detect and track zebrafish cells through 3D space and time',
      organizationName: 'Biohub',
      category: 'Research',
      deadline: '2026-09-29T23:59:00Z',
      teamCount: 3950,
      userRank: 150,
    }),
    comp('march-machine-learning-mania-2026', {
      title: 'March Machine Learning Mania 2026',
      organizationName: 'Kaggle',
      category: 'Featured',
      deadline: '2026-04-07T16:00:00Z',
      teamCount: 3462,
      userRank: 1049,
    }),
    comp('new-public-comp', { title: 'New Public Comp', category: 'Playground', deadline: '2026-12-31T23:59:00Z', teamCount: 12 }),
    comp('invite-only-class', { title: 'Invite-only class', deadline: '2026-12-31T23:59:00Z', teamCount: 4, userRank: 1 }),
  ],
};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown>; init: RequestInit };
type Reply = { status?: number; body: unknown; type?: string };
type Routes = {
  mcp: () => Reply;
  user: () => Reply;
  writeups: () => Reply;
  introspect: (token: unknown) => Reply;
  list: (authorization: string | undefined) => Reply;
  get: (slug: string) => Reply;
};

const DEFAULT_ROUTES: Routes = {
  mcp: () => ({ body: PROFILE_SSE, type: 'text/event-stream' }),
  user: () => ({ body: USER_SEARCH }),
  writeups: () => ({ body: WRITEUP_SEARCH }),
  introspect: (token) =>
    token === TOKEN
      ? { body: { active: true, clientId: 'x', username: 'oikantikbasu007', userId: 28291918, scope: 'resources.admin:*', exp: 1893456000 } }
      : { body: { active: false } },
  list: (authorization) =>
    authorization === `Bearer ${TOKEN}` || authorization === `Basic ${LEGACY_BASIC}`
      ? { body: ENTERED }
      : { status: 401, body: { error: { code: 401, message: 'Unauthenticated', status: 'UNAUTHENTICATED' } } },
  get: (slug) =>
    slug === 'new-public-comp'
      ? { body: { ...BIOHUB, ref: 'https://www.kaggle.com/competitions/new-public-comp', url: 'https://www.kaggle.com/competitions/new-public-comp' } }
      : { status: 404, body: { error: { code: 404, message: 'Not found', status: 'NOT_FOUND' } } },
};

function mockKaggle(overrides: Partial<Routes> = {}) {
  const routes = { ...DEFAULT_ROUTES, ...overrides };
  const calls: Call[] = [];
  const f: FetchLike = async (url, init = {}) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    calls.push({ url, headers, body, init });
    let reply: Reply;
    if (url === 'https://www.kaggle.com/mcp') reply = routes.mcp();
    else if (url.endsWith('/search.SearchApiService/ListEntities')) {
      const types = (body.filters as { documentTypes: string[] }).documentTypes;
      reply = types.includes('USER') ? routes.user() : routes.writeups();
    } else if (url.endsWith('/security.OAuthService/IntrospectToken')) reply = routes.introspect(body.token);
    else if (url.endsWith('/competitions.CompetitionApiService/ListCompetitions')) reply = routes.list(headers.authorization);
    else if (url.endsWith('/competitions.CompetitionApiService/GetCompetition')) reply = routes.get(String(body.competitionName));
    else reply = { status: 404, body: '<html>Kaggle</html>', type: 'text/html' };
    const payload = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return new Response(payload, { status: reply.status ?? 200, headers: { 'Content-Type': reply.type ?? 'application/json' } });
  };
  return { f, calls };
}

const sse = (payload: object) =>
  `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: false }, id: 1, jsonrpc: '2.0' })}\n\n`;

const run = (env: KaggleEnv, f: FetchLike, extra: { publicWithoutToken?: boolean } = {}) =>
  loadKaggleData({ env, fetch: f, now: NOW, snapshot: SNAPSHOT, publicWithoutToken: false, ...extra });

function assertNoSecrets(value: unknown) {
  const serialised = JSON.stringify(value);
  for (const s of SECRETS) assert.ok(!serialised.includes(s), 'a credential leaked into the result');
}

const slugs = (d: KaggleData) => [...d.active, ...d.past].map((c) => c.url.split('/').pop());
const callsTo = (calls: Call[], method: string) => calls.filter((c) => c.url.endsWith(`/${method}`));

test('with no credentials it serves the snapshot and makes no request at all', async () => {
  const { f, calls } = mockKaggle();
  assert.equal(hasCredentials({}), false);
  assert.equal(hasCredentials({ KAGGLE_USERNAME: 'oikantikbasu007' }), false);
  assert.equal(hasCredentials({ KAGGLE_API_TOKEN: '  ' }), false);
  const r = await run({}, f);
  assert.equal(calls.length, 0);
  assert.equal(r.data.source, 'snapshot');
  assert.equal(r.data.fetchedAt, '2026-09-26T02:30:00Z');
  assert.deepEqual(r.failures, []);
  assert.equal(r.usedCredentials, false);
});

test('a valid token reads live data; only ListCompetitions carries it as a header', async () => {
  const { f, calls } = mockKaggle();
  const r = await run({ KAGGLE_API_TOKEN: TOKEN }, f);
  assert.deepEqual(r.failures, []);
  assert.equal(r.usedCredentials, true);
  assert.equal(r.data.source, 'live');
  assert.equal(r.data.fetchedAt, NOW.toISOString());
  assert.equal(r.data.badges.length, 18);
  assert.equal(r.data.writeups.length, 2);
  assert.equal(r.data.profile.competitionPoints, 265);

  const biohub = r.data.active.find((c) => c.title.startsWith('Biohub'));
  assert.equal(biohub?.host, 'Biohub');
  assert.equal(biohub && rankLabel(biohub), 'Rank 150 of 3,950 teams, as of 27 Sep 2026');
  assert.equal(biohub?.summary, 'Detect and track zebrafish cells through 3D space and time (code competition).');
  // Known competitions skip the visibility check; the new public one passes it; the invite-only one is dropped.
  assert.deepEqual(slugs(r.data).sort(), ['biohub-cell-tracking-during-development', 'march-machine-learning-mania-2026', 'new-public-comp']);
  assert.deepEqual(
    callsTo(calls, 'GetCompetition').map((c) => c.body.competitionName).sort(),
    ['invite-only-class', 'new-public-comp'],
  );

  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    // client.server.ts caches the whole read as one unit; single requests are never cached.
    assert.equal(call.init.cache, 'no-store');
    assert.equal((call.init as { next?: unknown }).next, undefined);
    assert.ok(call.init.signal instanceof AbortSignal);
    const listing = call.url.endsWith('/ListCompetitions');
    assert.equal(call.headers.authorization, listing ? `Bearer ${TOKEN}` : undefined, call.url);
    const bodyHasToken = JSON.stringify(call.body).includes(TOKEN);
    assert.equal(bodyHasToken, call.url.endsWith('/IntrospectToken'), call.url);
  }
  assertNoSecrets(r);
});

test('legacy KAGGLE_USERNAME + KAGGLE_KEY use Basic auth and are never echoed', async () => {
  const { f, calls } = mockKaggle();
  const r = await run({ KAGGLE_USERNAME: 'oikantikbasu007', KAGGLE_KEY: LEGACY_KEY }, f);
  assert.equal(r.data.source, 'live');
  assert.equal(callsTo(calls, 'IntrospectToken').length, 0);
  assert.deepEqual(
    callsTo(calls, 'ListCompetitions').map((c) => c.headers.authorization),
    [`Basic ${LEGACY_BASIC}`],
  );
  assertNoSecrets(r);
});

test('credentials for another account are refused before any authenticated call', async () => {
  const other = mockKaggle();
  const r1 = await run({ KAGGLE_USERNAME: 'oikantikbasu', KAGGLE_KEY: LEGACY_KEY }, other.f);
  assert.equal(r1.data.source, 'snapshot');
  assert.equal(callsTo(other.calls, 'ListCompetitions').length, 0);
  assert.match(r1.failures.join(' '), /KAGGLE_USERNAME/);

  const foreignToken = mockKaggle({ introspect: () => ({ body: { active: true, username: 'someone-else' } }) });
  const r2 = await run({ KAGGLE_API_TOKEN: TOKEN }, foreignToken.f);
  assert.equal(r2.data.source, 'snapshot');
  assert.equal(callsTo(foreignToken.calls, 'ListCompetitions').length, 0);

  const expired = mockKaggle({ introspect: () => ({ body: { active: true, username: 'oikantikbasu007', exp: 1700000000 } }) });
  const r3 = await run({ KAGGLE_API_TOKEN: TOKEN }, expired.f);
  assert.equal(r3.data.source, 'snapshot');
  for (const r of [r1, r2, r3]) assertNoSecrets(r);
});

test('the token wins over the legacy key, and an inactive token falls back to it', async () => {
  const both = { KAGGLE_API_TOKEN: TOKEN, KAGGLE_USERNAME: 'oikantikbasu007', KAGGLE_KEY: LEGACY_KEY };
  const a = mockKaggle();
  await run(both, a.f);
  assert.deepEqual(
    callsTo(a.calls, 'ListCompetitions').map((c) => c.headers.authorization),
    [`Bearer ${TOKEN}`],
  );

  const b = mockKaggle({ introspect: () => ({ body: { active: false } }) });
  const r = await run(both, b.f);
  assert.equal(r.data.source, 'live');
  assert.deepEqual(
    callsTo(b.calls, 'ListCompetitions').map((c) => c.headers.authorization),
    [`Basic ${LEGACY_BASIC}`],
  );
});

test('any failure serves the whole snapshot, with a reason that holds no credential', async () => {
  const cases: [string, Partial<Routes>][] = [
    ['writeups 500', { writeups: () => ({ status: 500, body: { error: { code: 500 } } }) }],
    ['writeups 429', { writeups: () => ({ status: 429, body: 'Too many requests', type: 'text/plain' }) }],
    [
      'profile tool error',
      {
        mcp: () => ({
          body: `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: 'text', text: 'Unauthenticated' }], isError: true }, id: 1, jsonrpc: '2.0' })}\n\n`,
          type: 'text/event-stream',
        }),
      },
    ],
    [
      'owner not in either profile source',
      {
        mcp: () => ({ body: sse({ ...(parseMcpToolResult(PROFILE_SSE) as object), user_name: 'someone-else' }), type: 'text/event-stream' }),
        user: () => ({ body: { documents: [], totalDocuments: 0 } }),
      },
    ],
    ['list 401', { list: () => ({ status: 401, body: { error: { code: 401 } } }) }],
    ['visibility 503', { get: () => ({ status: 503, body: 'down', type: 'text/plain' }) }],
    ['html instead of JSON', { user: () => ({ body: '<html>Kaggle</html>', type: 'text/html' }) }],
    ['writeups: empty search', { writeups: () => ({ body: { documents: [], totalDocuments: 0 } }) }],
    [
      'writeups: documents without writeUpMetadata',
      {
        writeups: () => ({
          body: {
            documents: WRITEUP_SEARCH.documents.map((d: { discussionDocument: Record<string, unknown> }) => {
              const copy = structuredClone(d);
              delete copy.discussionDocument.writeUpMetadata;
              return copy;
            }),
          },
        }),
      },
    ],
    [
      'badges: empty list without a hide setting',
      { mcp: () => ({ body: sse({ ...(parseMcpToolResult(PROFILE_SSE) as object), badges: [] }), type: 'text/event-stream' }) },
    ],
    ['competitions: empty entered list', { list: () => ({ body: { competitions: [] } }) }],
  ];
  for (const [name, routes] of cases) {
    const { f } = mockKaggle(routes);
    const r = await run({ KAGGLE_API_TOKEN: TOKEN }, f);
    assert.equal(r.data.source, 'snapshot', name);
    assert.ok(r.failures.length > 0, name);
    assert.equal(r.usedCredentials, false, name);
    assertNoSecrets(r);
  }

  const base = mockKaggle().f;
  const throwing: FetchLike = async (url, init) => {
    if (url.endsWith('/ListCompetitions')) throw new TypeError(`fetch failed: Authorization: Bearer ${TOKEN}`);
    return base(url, init);
  };
  const r = await loadKaggleData({ env: { KAGGLE_API_TOKEN: TOKEN }, fetch: throwing, now: NOW, snapshot: SNAPSHOT });
  assert.equal(r.data.source, 'snapshot');
  assert.deepEqual(
    r.failures.filter((x) => x.startsWith('competitions')),
    ['competitions: TypeError'],
  );
  assertNoSecrets(r);
});

test('an empty list the snapshot fills is a failure, except badges the owner hid', async () => {
  const noWriteups = await run({ KAGGLE_API_TOKEN: TOKEN }, mockKaggle({ writeups: () => ({ body: { documents: [] } }) }).f);
  assert.deepEqual(noWriteups.failures, ['writeups: empty reply']);
  assert.equal(noWriteups.data.writeups.length, 2);

  const hidden = sse({ ...(parseMcpToolResult(PROFILE_SSE) as object), visibility_settings: { show_badges: false } });
  const r = await run({ KAGGLE_API_TOKEN: TOKEN }, mockKaggle({ mcp: () => ({ body: hidden, type: 'text/event-stream' }) }).f);
  assert.deepEqual(r.failures, []);
  assert.equal(r.data.source, 'live');
  assert.deepEqual(r.data.badges, []);
});

test('a reply that echoes a credential is discarded for the snapshot', async () => {
  const echo = mockKaggle({
    list: () => ({ body: { competitions: [comp('biohub-cell-tracking-during-development', { title: `Biohub ${TOKEN}`, deadline: '2026-09-29T23:59:00Z', teamCount: 10 })] } }),
  });
  const r = await run({ KAGGLE_API_TOKEN: TOKEN }, echo.f);
  assert.equal(r.data.source, 'snapshot');
  assert.deepEqual(r.failures, ['a credential appeared in the reply']);
  assertNoSecrets(r);
});

test('a newly published writeup shows up first on the next refresh', async () => {
  const doc = structuredClone(WRITEUP_SEARCH.documents[0]);
  doc.id = 700001;
  doc.title = 'Tracking Zebrafish Cells with a Transformer';
  doc.createTime = '2026-09-27T08:00:00.1234567Z';
  doc.votes = 4;
  doc.discussionDocument.newCommentUrl = '/competitions/biohub-cell-tracking-during-development/writeups/tracking-zebrafish-cells#1';
  doc.discussionDocument.writeUpMetadata.type = 'COMPETITION_SOLUTION';
  doc.discussionDocument.writeUpMetadata.competitionInfo = {
    competitionTitle: 'Biohub - Cell Tracking During Development',
    competitionUrl: '/competitions/biohub-cell-tracking-during-development',
    competitionId: 136605,
  };
  const draft = structuredClone(doc);
  draft.discussionDocument.newCommentUrl = '/competitions/biohub-cell-tracking-during-development/writeups/unfinished#2';
  draft.discussionDocument.writeUpMetadata.contentState = 'DRAFT';
  const { f } = mockKaggle({ writeups: () => ({ body: { documents: [...WRITEUP_SEARCH.documents, doc, draft] } }) });
  const r = await run({ KAGGLE_API_TOKEN: TOKEN }, f);
  assert.equal(r.data.writeups.length, 3);
  assert.deepEqual(
    { title: r.data.writeups[0].title, type: r.data.writeups[0].type, published: r.data.writeups[0].published },
    { title: 'Tracking Zebrafish Cells with a Transformer', type: 'Competition solution', published: '2026-09-27' },
  );
  assert.equal(r.data.active.find((c) => c.title.startsWith('Biohub'))?.hasWriteup, true);
});

test('publicWithoutToken reads the public parts anonymously and keeps snapshot competitions', async () => {
  const { f, calls } = mockKaggle();
  const r = await run({}, f, { publicWithoutToken: true });
  assert.equal(r.data.source, 'live');
  assert.equal(r.usedCredentials, false);
  assert.deepEqual(calls.map((c) => c.url.split('/').pop()).sort(), ['ListEntities', 'ListEntities', 'mcp']);
  for (const c of calls) assert.equal(c.headers.authorization, undefined);
  const biohub = r.data.active.find((c) => c.title.startsWith('Biohub'));
  assert.equal(biohub && rankLabel(biohub), 'Rank 183 of 3,908 teams, as of 26 Sep 2026');
});
