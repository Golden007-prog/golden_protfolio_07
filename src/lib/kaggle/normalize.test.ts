import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FEATURED_BADGES } from './config.ts';
import {
  coerceSnapshot,
  excerptFrom,
  fromSnapshot,
  isActive,
  kaggleUrl,
  mergeWithSnapshot,
  normalizeBadges,
  normalizeCompetitions,
  normalizeProfile,
  normalizeWriteups,
  parseMcpToolResult,
  rankLabel,
  resplit,
  selectWriteups,
  sortBadges,
  splitCompetitions,
} from './normalize.ts';
import type { KaggleCompetition, KaggleData, KaggleWriteup } from './types.ts';

// Real anonymous replies captured on 2026-09-26 (bodies trimmed).
const text = (file: string) => readFileSync(new URL(`./__fixtures__/${file}`, import.meta.url), 'utf8');
const json = (file: string) => JSON.parse(text(file));
const clone = <T>(v: T): T => structuredClone(v);

const MCP_PROFILE = parseMcpToolResult(text('mcp-get-user-profile.sse'));
const USER_SEARCH = json('list-entities-user.json');
const WRITEUP_SEARCH = json('list-entities-writeups.json');
const SNAPSHOT: KaggleData = coerceSnapshot(JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8')));

const CAPTURE = new Date('2026-09-26T02:30:00Z');

test('the MCP reply parses from SSE, and tool errors or JSON-RPC errors give null', () => {
  assert.equal((MCP_PROFILE as { user_name: string }).user_name, 'oikantikbasu007');
  const sse = (body: object) => `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  assert.equal(
    parseMcpToolResult(sse({ result: { content: [{ type: 'text', text: 'Unauthenticated' }], isError: true }, id: 1, jsonrpc: '2.0' })),
    null,
  );
  assert.equal(parseMcpToolResult(sse({ error: { code: -32601, message: 'nope' }, id: 1, jsonrpc: '2.0' })), null);
  assert.equal(parseMcpToolResult('<html>Kaggle</html>'), null);
  const plain = JSON.stringify({ result: { content: [{ type: 'text', text: '{"a":1}' }] }, id: 1, jsonrpc: '2.0' });
  assert.deepEqual(parseMcpToolResult(plain), { a: 1 });
});

test('the profile keeps tiers and points, never rank_out_of', () => {
  const p = normalizeProfile(MCP_PROFILE, USER_SEARCH);
  assert.ok(p);
  assert.equal(p.displayName, 'Oikantik Basu');
  assert.equal(p.url, 'https://www.kaggle.com/oikantikbasu007');
  assert.equal(p.joined, '2025-08-10');
  assert.equal(p.competitionPoints, 265);
  assert.equal(p.overallTier, 'Contributor');
  assert.match(p.avatar ?? '', /^https:\/\/storage\.googleapis\.com\/kaggle-avatars\/images\//);
  assert.deepEqual(p.tiers, [
    { category: 'Competitions', tier: 'Contributor' },
    { category: 'Datasets', tier: 'Contributor' },
    { category: 'Notebooks', tier: 'Contributor' },
  ]);
  const serialised = JSON.stringify(p);
  for (const population of ['217542', '11794', '60651']) assert.ok(!serialised.includes(population));
});

test('another account is never taken for the owner', () => {
  const other = { ...(MCP_PROFILE as object), user_name: 'oikantikbasu' };
  const search = clone(USER_SEARCH);
  search.documents[0].ownerUser.userName = 'oikantikbasu';
  assert.equal(normalizeProfile(other, search), null);
  assert.equal(normalizeBadges(other), null);
});

test('progression opt-out hides tiers', () => {
  const p = normalizeProfile({ ...(MCP_PROFILE as object), progression_opt_out: true }, USER_SEARCH);
  assert.deepEqual(p?.tiers, []);
  assert.equal(p?.overallTier, undefined);
  const merged = mergeWithSnapshot({ profile: p, badges: null, writeups: null, competitions: null }, SNAPSHOT, { now: CAPTURE });
  assert.deepEqual(merged.profile.tiers, []);
  assert.equal(merged.profile.overallTier, undefined);
  assert.equal(merged.profile.competitionPoints, undefined);
});

test('all 18 badges come through with https images; featured ones lead in config order', () => {
  const badges = normalizeBadges(MCP_PROFILE);
  assert.ok(badges);
  assert.equal(badges.length, 18);
  for (const b of badges) assert.match(b.image, /^https:\/\//, b.name);
  const sorted = sortBadges(badges);
  assert.deepEqual(
    sorted.filter((b) => b.featured).map((b) => b.name),
    [...FEATURED_BADGES],
  );
  assert.deepEqual(
    sorted.slice(0, FEATURED_BADGES.length).map((b) => b.name),
    [...FEATURED_BADGES],
  );
  const rest = sorted.slice(FEATURED_BADGES.length).map((b) => b.achieved);
  assert.deepEqual(rest, [...rest].sort().reverse());
});

test('both public writeups normalise with clean URLs, dates and a prose excerpt', () => {
  const writeups = normalizeWriteups(WRITEUP_SEARCH);
  assert.ok(writeups);
  assert.equal(writeups.length, 2);
  const urbancare = writeups.find((w) => w.title.startsWith('UrbanCare'));
  assert.deepEqual(
    { ...urbancare, excerpt: undefined },
    {
      title: 'UrbanCare AI: A Multimodal Clinical Copilot for Real-Time Hospital Intelligence',
      subtitle: 'A real-time hospital AI system combining vision, voice, and medical reasoning for collaborative patient care',
      type: 'Hackathon project',
      competition: 'The MedGemma Impact Challenge',
      competitionUrl: 'https://www.kaggle.com/competitions/med-gemma-impact-challenge',
      url: 'https://www.kaggle.com/competitions/med-gemma-impact-challenge/writeups/urbancare-ai-a-multimodal-clinical-copilot-for-re',
      published: '2026-02-24',
      excerpt: undefined,
      votes: 0,
    },
  );
  // The template's form fields ('Project name', the team member's name) are skipped.
  assert.match(urbancare?.excerpt ?? '', /^Modern healthcare systems impose/);
  const tunix = writeups.find((w) => w.url.endsWith('/new-writeup-1767949274949'));
  assert.equal(tunix?.published, '2026-01-09');
  assert.match(tunix?.excerpt ?? '', /^In critical domains like mathematics/);
});

test('private, draft, template, foreign and off-site writeups are dropped; co-written ones are kept', () => {
  const base = WRITEUP_SEARCH.documents[0];
  const variant = (mutate: (d: typeof base) => void, id: number) => {
    const d = clone(base);
    d.id = id;
    d.discussionDocument.newCommentUrl = `/competitions/med-gemma-impact-challenge/writeups/variant-${id}#1`;
    mutate(d);
    return d;
  };
  const docs = [
    variant((d) => (d.isPrivate = true), 1),
    variant((d) => (d.discussionDocument.writeUpMetadata.contentState = 'DRAFT'), 2),
    variant((d) => delete d.discussionDocument.writeUpMetadata.contentState, 3),
    variant((d) => (d.discussionDocument.writeUpMetadata.template = true), 4),
    variant((d) => {
      d.ownerUser.userName = 'someone-else';
      d.discussionDocument.writeUpMetadata.collaborators = [{ userName: 'someone-else' }];
    }, 5),
    variant((d) => (d.documentType = 'COMPETITION'), 6),
    variant((d) => delete d.discussionDocument.writeUpMetadata, 7),
    variant((d) => (d.discussionDocument.newCommentUrl = 'https://evil.example/competitions/x/writeups/y'), 8),
    variant((d) => (d.discussionDocument.newCommentUrl = '/competitions/x/discussion/123'), 9),
    variant((d) => {
      d.ownerUser.userName = 'teammate';
      d.discussionDocument.writeUpMetadata.collaborators = [{ userName: 'teammate' }, { userName: 'OikantikBasu007' }];
    }, 10),
  ];
  const out = normalizeWriteups({ documents: docs });
  assert.deepEqual(
    out?.map((w) => w.url.split('/').pop()),
    ['variant-10'],
  );
});

test('a search reply with no documents is an empty list; a non-reply is null', () => {
  assert.deepEqual(normalizeWriteups({ totalDocuments: 0 }), []);
  assert.equal(normalizeWriteups({ error: { code: 500 } }), null);
  assert.equal(normalizeWriteups('nope'), null);
});

test('min-votes and hide config select writeups', () => {
  const w = (slug: string, votes?: number): KaggleWriteup => ({
    title: slug,
    subtitle: '',
    type: 'Hackathon project',
    competition: '',
    competitionUrl: '',
    url: `https://www.kaggle.com/competitions/c/writeups/${slug}`,
    published: '2026-01-01',
    ...(votes === undefined ? {} : { votes }),
  });
  const all = [w('a', 0), w('b', 3), w('c'), w('d', 10)];
  assert.deepEqual(
    selectWriteups(all, { minVotes: 3, hide: [] }).map((x) => x.title),
    ['b', 'c', 'd'],
  );
  assert.deepEqual(
    selectWriteups(all, { minVotes: 0, hide: ['B', 'https://www.kaggle.com/competitions/c/writeups/d'] }).map((x) => x.title),
    ['a', 'c'],
  );
  assert.equal(selectWriteups(all).length, 4);
  const hidden = fromSnapshot(SNAPSHOT, CAPTURE, { hide: ['new-writeup-1767949274949'] });
  assert.equal(hidden.writeups.length, 1);
  assert.equal(hidden.past.find((c) => c.url.endsWith('/google-tunix-hackathon'))?.hasWriteup, undefined);
});

test('a rank is labelled with its team count and date, or not at all', () => {
  assert.equal(rankLabel({ userRank: 183, teams: 3908, rankAsOf: '2026-09-26' }), 'Rank 183 of 3,908 teams, as of 26 Sep 2026');
  assert.equal(rankLabel({ userRank: 183, teams: 0, rankAsOf: '2026-09-26' }), null);
  assert.equal(rankLabel({ userRank: 183, teams: 3908 }), null);
  assert.equal(rankLabel({ userRank: 4000, teams: 3908, rankAsOf: '2026-09-26' }), null);
  assert.equal(rankLabel({ userRank: 0, teams: 3908, rankAsOf: '2026-09-26' }), null);
  assert.equal(rankLabel({ teams: 3908, rankAsOf: '2026-09-26' }), null);

  const now = new Date('2026-09-27T10:00:00Z');
  const comps = normalizeCompetitions(
    {
      competitions: [
        { title: 'A', url: 'https://www.kaggle.com/competitions/a', deadline: '2026-10-01T23:59:00Z', teamCount: 100, userRank: 7 },
        { title: 'B', ref: 'b', deadline: '2026-10-01T23:59:00Z', userRank: 7 },
        { title: 'C', ref: 'c', deadline: '2026-10-01T23:59:00Z', teamCount: 5, userRank: 7 },
        { title: 'D', ref: 'd', deadline: '2026-10-01T23:59:00Z', teamCount: '50', userRank: '3' },
        { title: 'E', ref: 'e', deadline: 'soon', teamCount: 5 },
        { title: 'F', url: 'https://evil.example/competitions/f', deadline: '2026-10-01T23:59:00Z', teamCount: 5 },
      ],
    },
    { now },
  );
  assert.deepEqual(
    comps?.map((c) => [c.title, c.userRank, c.teams, c.rankAsOf]),
    [
      ['A', 7, 100, '2026-09-27'],
      ['B', undefined, 0, undefined],
      ['C', undefined, 5, undefined],
      ['D', 3, 50, '2026-09-27'],
    ],
  );
  assert.equal(comps?.[1].url, 'https://www.kaggle.com/competitions/b');
});

test('competitions split into active and past by the deadline against now', () => {
  const at = (iso: string) => new Date(iso);
  assert.equal(isActive('2026-09-29', at('2026-09-29T23:00:00Z')), true);
  assert.equal(isActive('2026-09-29', at('2026-09-30T00:00:00Z')), false);
  assert.equal(isActive('2026-09-29T23:59:00Z', at('2026-09-30T00:00:00Z')), false);
  assert.equal(isActive('not a date', at('2026-01-01T00:00:00Z')), false);

  const atCapture = fromSnapshot(SNAPSHOT, CAPTURE);
  assert.deepEqual(
    atCapture.active.map((c) => c.url.split('/').pop()),
    ['biohub-cell-tracking-during-development', 'gemma-4-developer-agent-paper', 'gemma-4-developer-agent'],
  );
  assert.equal(atCapture.past.length, 10);
  const pastDeadlines = atCapture.past.map((c) => c.deadline);
  assert.deepEqual(pastDeadlines, [...pastDeadlines].sort().reverse());

  const later = fromSnapshot(SNAPSHOT, at('2026-10-01T00:00:00Z'));
  assert.equal(later.active.length, 2);
  const biohub = later.past[0];
  assert.equal(biohub.title, 'Biohub - Cell Tracking During Development');
  assert.equal(biohub.active, false);
  assert.equal(rankLabel(biohub), 'Rank 183 of 3,908 teams, as of 26 Sep 2026');

  const mixed: KaggleCompetition[] = [
    { title: 'x', url: 'https://www.kaggle.com/competitions/x', host: '', category: '', deadline: '2026-12-01T00:00:00.000Z', teams: 1, active: false },
    { title: 'y', url: 'https://www.kaggle.com/competitions/y', host: '', category: '', deadline: '2026-10-01', teams: 1, active: false },
  ];
  assert.deepEqual(
    splitCompetitions(mixed, CAPTURE).active.map((c) => c.title),
    ['y', 'x'],
  );
});

test('the committed snapshot is valid, public and self-consistent', () => {
  const raw = JSON.parse(readFileSync(new URL('./snapshot.json', import.meta.url), 'utf8'));
  assert.deepEqual(coerceSnapshot(raw), raw);
  assert.equal(SNAPSHOT.source, 'snapshot');
  assert.equal(SNAPSHOT.fetchedAt, '2026-09-26T02:30:00Z');
  assert.equal(SNAPSHOT.badges.length, 18);
  assert.equal(SNAPSHOT.writeups.length, 2);
  assert.equal(SNAPSHOT.active.length + SNAPSHOT.past.length, 13);
  assert.deepEqual(
    SNAPSHOT.badges.filter((b) => b.featured).map((b) => b.name),
    [...FEATURED_BADGES],
  );
  const serialised = JSON.stringify(raw);
  assert.ok(!serialised.includes('rank_out_of'));
  assert.ok(!/"oikantikbasu"/.test(serialised), 'the old account never appears');
  for (const c of [...SNAPSHOT.active, ...SNAPSHOT.past]) {
    assert.match(c.url, /^https:\/\/www\.kaggle\.com\/competitions\/[a-z0-9-]+$/);
    if (c.userRank !== undefined) assert.ok(rankLabel(c), c.title);
  }
  for (const w of SNAPSHOT.writeups) assert.match(w.url, /^https:\/\/www\.kaggle\.com\/competitions\/[a-z0-9-]+\/writeups\//);
  assert.deepEqual(
    [...SNAPSHOT.active, ...SNAPSHOT.past].filter((c) => c.hasWriteup).map((c) => c.title),
    ['The MedGemma Impact Challenge', 'Google Tunix Hack - Train a model to show its work'],
  );
});

test('coerceSnapshot drops malformed entries and ranks without a date', () => {
  const data = coerceSnapshot({
    fetchedAt: 'yesterday',
    profile: { userName: 'someone-else', displayName: 'X' },
    badges: [{ name: 'Ok', achieved: '2026-01-01', image: 'http://insecure.example/b.svg' }, { description: 'no name' }],
    writeups: [{ title: 'Off site', url: 'https://example.com/writeups/x', published: '2026-01-01' }],
    active: [{ title: 'R', url: 'https://www.kaggle.com/competitions/r', deadline: '2026-12-01', teams: 10, userRank: 2 }],
    past: 'nope',
  });
  assert.equal(data.fetchedAt, '');
  assert.equal(data.profile.displayName, '');
  assert.deepEqual(
    data.badges.map((b) => [b.name, b.image]),
    [['Ok', '']],
  );
  assert.deepEqual(data.writeups, []);
  assert.equal(data.active[0].userRank, undefined);
  assert.deepEqual(data.past, []);
});

test('live data wins; the snapshot fills gaps and keeps curated text; ranks are never borrowed', () => {
  const liveWriteups = normalizeWriteups(WRITEUP_SEARCH) ?? [];
  const fresh: KaggleWriteup = {
    title: 'A brand new writeup',
    subtitle: 'Fresh',
    type: 'Competition solution',
    competition: 'Biohub - Cell Tracking During Development',
    competitionUrl: 'https://www.kaggle.com/competitions/biohub-cell-tracking-during-development',
    url: 'https://www.kaggle.com/competitions/biohub-cell-tracking-during-development/writeups/new-one',
    published: '2026-09-30',
    excerpt: 'Derived from the body.',
    votes: 2,
  };
  const biohubLive: KaggleCompetition = {
    title: 'Biohub - Cell Tracking During Development',
    url: 'https://www.kaggle.com/competitions/biohub-cell-tracking-during-development',
    host: '',
    category: 'Research',
    deadline: '2026-09-29T23:59:00.000Z',
    teams: 3950,
    active: true,
  };
  const now = new Date('2026-09-28T00:00:00Z');
  const merged = mergeWithSnapshot(
    {
      profile: { userName: 'oikantikbasu007', displayName: 'Oikantik Basu', joined: '2025-08-10' },
      badges: null,
      writeups: [...liveWriteups, fresh],
      competitions: [biohubLive],
    },
    SNAPSHOT,
    { now },
  );
  assert.equal(merged.source, 'live');
  assert.equal(merged.fetchedAt, now.toISOString());
  // Profile gaps come from the snapshot.
  assert.equal(merged.profile.avatar, SNAPSHOT.profile.avatar);
  assert.deepEqual(merged.profile.tiers, SNAPSHOT.profile.tiers);
  assert.equal(merged.profile.competitionPoints, 265);
  // Badges were not fetched, so the snapshot's are used.
  assert.equal(merged.badges.length, 18);
  // The new writeup leads; known ones keep their live verbatim excerpt and the curated project link.
  assert.equal(merged.writeups[0].title, 'A brand new writeup');
  assert.equal(merged.writeups[0].excerpt, 'Derived from the body.');
  const urbancare = merged.writeups.find((w) => w.project);
  assert.equal(urbancare?.project, 'urbancare-ai');
  assert.equal(urbancare?.excerpt, liveWriteups.find((w) => w.url === urbancare?.url)?.excerpt);
  // Snapshot excerpts are verbatim too: each is exactly what excerptFrom yields for that writeup's body.
  for (const w of SNAPSHOT.writeups) {
    assert.equal(w.excerpt, liveWriteups.find((l) => l.url === w.url)?.excerpt, w.title);
  }
  // Live competition: host filled from the snapshot, team count live, rank not borrowed.
  assert.equal(merged.active.length, 1);
  const biohub = merged.active[0];
  assert.equal(biohub.host, 'Biohub');
  assert.equal(biohub.teams, 3950);
  assert.equal(biohub.userRank, undefined);
  assert.equal(biohub.summary, 'Detect and track zebrafish cells through 3D space and time (code competition).');
  assert.equal(biohub.hasWriteup, true);

  // A live card is dated by the live read, so a team count Kaggle omitted is not filled from an older snapshot.
  const noTeams = mergeWithSnapshot(
    { profile: null, badges: null, writeups: null, competitions: [{ ...biohubLive, teams: 0 }] },
    SNAPSHOT,
    { now },
  );
  assert.equal(noTeams.active[0].teams, 0);
  assert.equal(noTeams.active[0].host, 'Biohub');

  const noComps = mergeWithSnapshot({ profile: null, badges: null, writeups: null, competitions: null }, SNAPSHOT, { now: CAPTURE });
  assert.deepEqual(noComps.active, fromSnapshot(SNAPSHOT, CAPTURE).active);
  assert.deepEqual(noComps.profile, SNAPSHOT.profile);
});

test('resplit moves a competition that closed since a cached read into past, keeping the read time', () => {
  const read = fromSnapshot(SNAPSHOT, CAPTURE);
  const later = resplit(read, new Date('2026-10-01T00:00:00Z'));
  assert.equal(later.fetchedAt, read.fetchedAt);
  assert.ok(!later.active.some((c) => c.title.startsWith('Biohub')));
  assert.ok(later.past.some((c) => c.title.startsWith('Biohub')));
  assert.deepEqual(later.writeups, read.writeups);
  assert.deepEqual(resplit(read, CAPTURE), read);
});

test('links stay on Kaggle and excerpts stay verbatim', () => {
  assert.equal(kaggleUrl('/competitions/a/writeups/b#123'), 'https://www.kaggle.com/competitions/a/writeups/b');
  assert.equal(kaggleUrl('https://kaggle.com/x/?q=1'), 'https://www.kaggle.com/x');
  assert.equal(kaggleUrl('http://www.kaggle.com/x'), '');
  assert.equal(kaggleUrl('https://www.kaggle.com.evil.example/x'), '');
  assert.equal(kaggleUrl('javascript:alert(1)'), '');
  assert.equal(excerptFrom('### Heading\n\nShort label\n\n'), undefined);
  const long = `${'word '.repeat(80)}end.`;
  const cut = excerptFrom(long) ?? '';
  assert.ok(cut.length <= 220 && cut.endsWith('…'));
  assert.equal(excerptFrom('See [the notebook](https://www.kaggle.com/code/x) for the **full** training loop and evaluation details.'), 'See the notebook for the full training loop and evaluation details.');
});
