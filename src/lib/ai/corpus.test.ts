import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SITE_COPY } from '../../data/site-copy.ts';
import { parseAchievements } from '../achievements.ts';
import { certificationGroups, formatIssued, parseCertifications } from '../certifications.ts';
import { containsPrice } from '../coreforge/copy-guard.ts';
import { COREFORGE_CORPUS } from '../coreforge/corpus.ts';
import { buildCorpus, corpusHash, CORE_CARD_IDS, entities, inFullContext, stableHash, type CorpusSources } from './corpus.ts';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));
const load = (): CorpusSources => ({
  profile: read('profile.json'),
  projects: read('projects.json'),
  githubFacts: read('github-facts.json'),
  reading: read('reading.json'),
  tools: read('tools.json'),
  skillsIndex: read('skills-index.json'),
  liveSnapshot: read('live-snapshot.json'),
  siteCopy: SITE_COPY,
  certifications: parseCertifications(read('certifications.json')),
  achievements: parseAchievements(read('achievements.json')),
  coreforge: COREFORGE_CORPUS,
  kaggle: JSON.parse(readFileSync(new URL('../kaggle/snapshot.json', import.meta.url), 'utf8')),
});

const src = load();
const chunks = buildCorpus(src);
const byId = new Map(chunks.map((c) => [c.id, c]));

test('ids are unique and stable across two builds', () => {
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
  const again = buildCorpus(load());
  assert.deepEqual(
    again.map((c) => [c.id, c.hash]),
    chunks.map((c) => [c.id, c.hash]),
  );
  assert.equal(corpusHash(again), corpusHash(chunks));
});

test('every id follows the documented forms', () => {
  const FORMS = [
    /^profile:(about|availability)$/,
    /^exp:\d+(#[hm]\d+)?$/,
    /^edu:\d+$/,
    /^skills:[a-z0-9-]+$/,
    /^project:[a-z0-9-]+#(tagline|summary|full|problem|solution|lessons|stack)$/,
    /^facts:[a-z0-9-]+$/,
    /^cert:[a-z0-9-]+$/,
    /^achievement:[a-z0-9-]+$/,
    /^reading:\d+$/,
    /^tool:\d+$/,
    /^copy:(philosophy#\d+|roles|hero|contact)$/,
    /^ref:[a-z0-9-]+$/,
    /^coreforge:(overview|features|plans|engineering|numbers|changelog|faq#[a-z0-9-]+)$/,
    /^kaggle:(profile|badges|writeup-[a-z0-9-]+|competition-[a-z0-9-]+)$/,
    /^live:(leetcode|github)$/,
  ];
  for (const c of chunks) assert.ok(FORMS.some((re) => re.test(c.id)), `unexpected id ${c.id}`);
  // The citation id pattern the routes accept.
  for (const c of chunks) assert.match(c.id, /^[a-z]+:[\w#.-]+$/);
});

test('no chunk carries the withheld stats or the phone number', () => {
  for (const c of chunks) {
    const all = `${c.title}\n${c.label}\n${c.text}`;
    for (const banned of ['yearsExperience', '+91', '7001124396', 'projectsShipped']) {
      assert.ok(!all.includes(banned), `${c.id} contains ${banned}`);
    }
  }
});

test('every ref: chunk is reference and untrusted; live chunks are live, untrusted and dated', () => {
  const refs = chunks.filter((c) => c.id.startsWith('ref:'));
  assert.equal(refs.length, src.skillsIndex.length);
  for (const c of refs) {
    assert.equal(c.cls, 'reference', c.id);
    assert.equal(c.untrusted, true, c.id);
    assert.match(c.text, /not of Oikantik's use of it/);
  }
  for (const c of chunks.filter((x) => x.id.startsWith('live:'))) {
    assert.equal(c.cls, 'live', c.id);
    assert.equal(c.untrusted, true, c.id);
    assert.match(c.asOf ?? '', /^\d{4}-\d{2}-\d{2}$/, c.id);
  }
  for (const c of chunks.filter((x) => x.cls === 'self')) assert.equal(c.untrusted, false, c.id);
});

test('live:github keeps only the repo and date, never the commit message or URL', () => {
  const push = src.liveSnapshot?.github?.latestPush;
  const c = byId.get('live:github');
  assert.ok(push && c);
  assert.ok(c.text.includes(push.repo));
  assert.ok(push.message && !c.text.includes(push.message), 'commit message leaked');
  assert.ok(!/https?:\/\//.test(c.text), 'URL leaked');
});

test('live:leetcode calls the streak the longest run, never a current streak', () => {
  // userCalendar.streak is LeetCode's max streak; the heatmap labels it that way too.
  const live = load();
  live.liveSnapshot = { ...live.liveSnapshot, leetcode: { ...live.liveSnapshot!.leetcode!, streak: 13 } };
  const c = buildCorpus(live).find((x) => x.id === 'live:leetcode');
  assert.ok(c);
  assert.match(c.text, /longest streak 13 days \(not a current streak\)/);
  assert.doesNotMatch(c.text.replace('not a current streak', ''), /current(ly)? streak/i);

  const committed = read('ai-corpus.json') as { chunks: { id: string; text: string }[] };
  const saved = committed.chunks.find((x) => x.id === 'live:leetcode');
  assert.ok(saved, 'committed corpus has no live:leetcode chunk');
  assert.doesNotMatch(saved.text.replace('not a current streak', ''), /current(ly)? streak/i, 'rerun npm run ai:corpus');
});

// jd-fit packs every 'self' chunk ('full' mode) except the retrieval-only product
// and badge detail, so this bounds its prompt at about 12K tokens. It was 40K until
// the credentials (37, each with its verify URL) and the hackathon results joined.
test('full-mode self text stays under 50K characters', () => {
  const total = chunks.filter(inFullContext).reduce((n, c) => n + c.text.length, 0);
  assert.ok(total < 50_000, `full-mode self text is ${total} chars`);
  // The retrieval-only chunks still exist for retrieval.
  assert.ok(chunks.some((c) => c.cls === 'self' && !inFullContext(c)));
  assert.ok(inFullContext(byId.get('coreforge:overview')!));
  assert.ok(inFullContext(byId.get('kaggle:profile')!));
});

test('the core card exists and states the education status honestly', () => {
  for (const id of CORE_CARD_IDS) assert.ok(byId.has(id), id);
  assert.match(byId.get('edu:0')!.text, /In progress/);
  assert.match(byId.get('edu:0')!.text, /Not yet completed/);
  assert.match(byId.get('edu:1')!.text, /CGPA: 8\.22/);
  const about = byId.get('profile:about')!.text;
  assert.match(about, new RegExp(`Credentials listed on this site, ${src.certifications!.items.length} in all`));
  assert.match(about, /20 course-completion badges from Anthropic on Claude Academy \(course badges, not certifications\)/);
  assert.match(about, /No other certifications are listed\./);
  assert.doesNotMatch(about, /No certifications are listed/);
  assert.equal(byId.get('exp:1')!.target.kind, 'experience');
  assert.match(byId.get('exp:1')!.text, /Mindrift/);
});

test('project chunks cover every project and leave out media paths', () => {
  for (const p of src.projects) {
    assert.ok(byId.has(`project:${p.slug}#tagline`), p.slug);
    assert.ok(byId.has(`project:${p.slug}#stack`), p.slug);
  }
  for (const c of chunks) assert.ok(!/\/images\/|\/videos\/|\.webp|\.mp4/.test(c.text), `${c.id} carries a media path`);
});

test('a tagline edit changes the stable hash; a live-data change does not', () => {
  const edited = load();
  edited.projects = edited.projects.map((p, i) => (i === 0 ? { ...p, tagline: `${p.tagline} v2` } : p));
  assert.notEqual(stableHash(buildCorpus(edited)), stableHash(chunks));

  const live = load();
  live.liveSnapshot = { ...live.liveSnapshot, leetcode: { ...live.liveSnapshot!.leetcode!, totalSolved: 999 } };
  assert.equal(stableHash(buildCorpus(live)), stableHash(chunks));
  assert.notEqual(corpusHash(buildCorpus(live)), corpusHash(chunks));
});

test('entities lists the real employers, schools, degrees and allow-lists', () => {
  const e = entities({
    profile: src.profile,
    projects: src.projects,
    skills: src.skillsIndex,
    reading: src.reading,
    certifications: src.certifications,
    achievements: src.achievements,
  });
  assert.deepEqual(e.companies, [
    'iHUB DivyaSampark @ IIT Roorkee',
    'Mindrift',
    'Unified Mentor Private Limited',
    "GOLDEN's Coreforge",
    'Alignerr',
    'Outlier',
    'Telangana Desam Leader',
    'K.pop Merchandise',
  ]);
  assert.equal(e.institutions.length, 2);
  assert.deepEqual(e.inProgress, ["Master's in Data Science (Online MDS)"]);
  assert.equal(e.certifications.length, src.certifications!.items.length);
  assert.deepEqual(
    e.certifications.find((c) => c.title === 'AI Fundamentals'),
    { title: 'AI Fundamentals', issuer: 'Google', platform: 'Coursera', kind: 'course-certificate' },
  );
  for (const c of src.certifications!.items) assert.ok(e.allowUrls.includes(c.url), c.url);
  for (const a of src.achievements!.items) for (const l of a.links) assert.ok(e.allowUrls.includes(l.url), l.url);
  assert.ok(e.allowUrls.includes('https://goldensdmat.in'));
  assert.equal(e.projectNames.length, src.projects.length);
  assert.ok(e.skills.includes('ReAct'));
  assert.ok(e.tech.includes('React'));
  assert.ok(e.allowUrls.includes('https://github.com/Golden007-prog/UrbanCare-AI'));
  assert.ok(e.allowUrls.includes('https://basuoikantik.in'));
  assert.deepEqual(e.allowEmails, ['basuoikantik@gmail.com']);
  assert.ok(!e.allowUrls.some((u) => u.includes('7001124396')));
});

test('every credential sits in exactly one cert: chunk with its issuer, platform, date and verify URL', () => {
  const certs = src.certifications!;
  const certChunks = chunks.filter((c) => c.id.startsWith('cert:'));
  assert.deepEqual(
    certChunks.map((c) => c.id),
    certificationGroups(certs).map((g) => `cert:${g.id}`),
  );
  for (const c of certChunks) {
    assert.equal(c.cls, 'self', c.id);
    assert.equal(c.untrusted, false, c.id);
    assert.deepEqual(c.target, { kind: 'section', id: 'certifications' }, c.id);
  }
  for (const item of certs.items) {
    const holders = certChunks.filter((c) => c.text.includes(`${item.title} (`) || c.text.includes(`${item.title}:`));
    assert.equal(holders.length, 1, item.title);
    const [c] = holders;
    for (const part of [item.issuer, item.platform, item.url, formatIssued(item.issued)]) assert.ok(c.text.includes(part), `${item.title}: ${part}`);
  }
  // Counts come from the data, and the badges keep their kind.
  assert.match(byId.get('cert:claude-academy')!.text, /20 course-completion badges \(course badges, not certifications\) from Anthropic on Claude Academy/);
  assert.match(
    byId.get('cert:google-ai-professional-certificate')!.text,
    /professional certificate from Google on Coursera, issued Sep 2026 .* made up of 7 course certificates/,
  );
  assert.match(byId.get('cert:coursera')!.text, /not part of the Google AI Professional Certificate/);
  // The Michigan credential is the course, never the specialization LinkedIn names.
  for (const c of chunks) assert.doesNotMatch(c.text, /Statistics with Python Specialization/, c.id);
});

test('each hackathon result is one self chunk, worded as the post words it', () => {
  const results = chunks.filter((c) => c.id.startsWith('achievement:'));
  assert.equal(results.length, src.achievements!.items.length);
  for (const a of src.achievements!.items) {
    const c = byId.get(`achievement:${a.id}`);
    assert.ok(c, a.id);
    assert.equal(c.cls, 'self');
    assert.ok(c.text.includes(a.summary.replace(/\s+/g, ' ').trim()), a.id);
    for (const l of a.links) assert.ok(c.text.includes(l.url), `${a.id}: ${l.url}`);
    const linked = Boolean(a.project && src.projects.some((p) => p.slug === a.project));
    assert.deepEqual(c.target, linked ? { kind: 'project', slug: a.project } : { kind: 'section', id: 'experience' }, a.id);
    assert.doesNotMatch(c.text, /%/, a.id);
  }
  assert.match(byId.get('achievement:ai-for-bharat-finalist')!.text, /Top 36 Finalist .* As a team of two\./);
  // Only the finalist entry says finalist; nothing says won, winner, prize or award.
  assert.deepEqual(
    results.filter((c) => /finalist/i.test(c.text)).map((c) => c.id),
    ['achievement:ai-for-bharat-finalist'],
  );
  for (const c of results) assert.doesNotMatch(c.text, /\b(?:won|winner|prize|award)/i, c.id);
});

test('the new roles are chunks, and the Coreforge role carries its site', () => {
  src.profile.experience.forEach((_, i) => assert.ok(byId.has(`exp:${i}`), `exp:${i}`));
  assert.match(byId.get('exp:3')!.text, /^Owner at GOLDEN's Coreforge \(Jul 2026 - Present\).* Website: https:\/\/goldensdmat\.in\.$/);
  // K.pop Merchandise lists no location, so none is invented.
  assert.match(byId.get('exp:7')!.text, /^Freelance WordPress Developer at K\.pop Merchandise \(Jan 2021 - Feb 2022\)\. Built/);
});

test('without credential data the About chunk still says none are listed', () => {
  const bare = load();
  delete bare.certifications;
  delete bare.achievements;
  const built = buildCorpus(bare);
  assert.match(built.find((c) => c.id === 'profile:about')!.text, /No certifications are listed on this site\./);
  assert.ok(!built.some((c) => c.id.startsWith('cert:') || c.id.startsWith('achievement:')));
});

test('duplicate ids throw instead of making citations ambiguous', () => {
  const dup = load();
  dup.projects = [...dup.projects, dup.projects[0]];
  assert.throws(() => buildCorpus(dup), /Duplicate corpus id/);
});

test('CoreForge chunks are his own evidence, carry the disclaimer and never a price', () => {
  const cf = chunks.filter((c) => c.id.startsWith('coreforge:'));
  assert.ok(cf.length >= 6);
  for (const c of cf) {
    assert.equal(c.cls, 'self', c.id);
    assert.deepEqual(c.target, { kind: 'section', id: 'coreforge' }, c.id);
    assert.equal(containsPrice(c.text), false, c.id);
    assert.match(c.text, /Not affiliated with g\.a\.s\.t\., TestDaF-Institut, APS, or the DAAD\./, c.id);
  }
  assert.doesNotMatch(byId.get('coreforge:features')!.text, /Real exam timing \(Pro plan\)/);
  assert.match(byId.get('coreforge:overview')!.text, /Not affiliated with g\.a\.s\.t\., TestDaF-Institut, APS, or the DAAD\./);
  // His LinkedIn title stays 'Owner'; 'founder' comes from his headline and the venture's own footer.
  assert.match(byId.get('coreforge:overview')!.text, /LinkedIn title for the role is Owner/);
});

test('Kaggle chunks: profile, badges and writeups are evidence; every rank is dated and out of N teams', () => {
  const kg = chunks.filter((c) => c.id.startsWith('kaggle:'));
  const snapshot = src.kaggle!;
  assert.equal(kg.filter((c) => c.id.startsWith('kaggle:writeup-')).length, snapshot.writeups.length);
  assert.equal(kg.filter((c) => c.id.startsWith('kaggle:competition-')).length, snapshot.active.length + snapshot.past.length);
  for (const c of kg) {
    if (c.id.startsWith('kaggle:competition-')) {
      assert.equal(c.cls, 'live', c.id);
      assert.equal(c.untrusted, true, c.id);
      assert.match(c.asOf ?? '', /^\d{4}-\d{2}-\d{2}$/, c.id);
    } else {
      assert.equal(c.cls, 'self', c.id);
    }
    for (const m of c.text.matchAll(/rank:? (\d+)/gi)) {
      assert.match(c.text.slice(m.index), /^rank:? \d+ of \d+ teams, as of \d{4}-\d{2}-\d{2}/i, c.id);
    }
  }
  const urbancare = kg.find((c) => c.id.startsWith('kaggle:writeup-urbancare'));
  assert.deepEqual(urbancare?.target, { kind: 'project', slug: 'urbancare-ai' });
  const allow = entities({ profile: src.profile, projects: src.projects, kaggle: snapshot }).allowUrls;
  assert.ok(allow.includes(snapshot.profile.url));
  for (const w of snapshot.writeups) assert.ok(allow.includes(w.url), w.url);
});
