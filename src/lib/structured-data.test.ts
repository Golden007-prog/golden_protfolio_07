import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { allAchievements, parseAchievements } from './achievements.ts';
import { allCertifications, isAllowedCredentialUrl, parseCertifications } from './certifications.ts';
import { COREFORGE_ORG_ID, PORTFOLIO_PERSON_ID } from './coreforge/jsonld.ts';
import { buildSiteGraph, foundedOrganizations, serializeJsonLd } from './structured-data.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-LD nodes are open-ended records */

const load = (p: string) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const profile = load('profile.json');
const projects = load('projects.json');
const CERTS = parseCertifications(load('certifications.json'));
const ACH = parseAchievements(load('achievements.json'));
const SITE = 'https://www.basuoikantik.in';

const graph = buildSiteGraph({
  siteUrl: SITE,
  profile,
  projects,
  caseStudyPath: () => null,
  credentials: allCertifications(CERTS),
  achievements: allAchievements(ACH),
  now: new Date('2026-09-26T00:00:00Z'),
});
const parsed = JSON.parse(serializeJsonLd(graph));
const nodes = parsed['@graph'] as Record<string, any>[];
const person = nodes.find((n) => n['@type'] === 'Person')!;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('the serialized graph round-trips and carries no raw "<"', () => {
  const s = serializeJsonLd(graph);
  assert.equal(s.includes('<'), false);
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(graph)));
});

test('the person, the site and every project are described', () => {
  assert.equal(person.name, profile.name);
  assert.equal(person.address.addressLocality, profile.location.split(',')[0]);
  assert.ok(person.sameAs.includes(profile.links.github));
  assert.equal(nodes.find((n) => n['@type'] === 'WebSite')!.url, SITE);
  assert.equal(nodes.find((n) => n['@type'] === 'ItemList')!.itemListElement.length, projects.length);
  // The Coreforge site is his company's, not one of his own profiles.
  assert.ok(!person.sameAs.some((u: string) => u.includes('goldensdmat')));
});

test('one credential per data item, every field from the data, newest first', () => {
  const items = CERTS.items;
  assert.equal(person.hasCredential.length, items.length);
  const ids = new Set<string>();
  for (const node of person.hasCredential) {
    const c = items.find((x) => `${SITE}/#credential-${x.id}` === node['@id']);
    assert.ok(c, node['@id']);
    ids.add(node['@id']);
    assert.equal(node['@type'], 'EducationalOccupationalCredential');
    assert.equal(node.name, c.title);
    assert.equal(node.credentialCategory, c.kind === 'course-completion-badge' ? 'badge' : 'certificate');
    assert.deepEqual(node.recognizedBy, { '@type': 'Organization', name: c.issuer });
    assert.equal(node.url, c.url);
    assert.ok(isAllowedCredentialUrl(node.url));
    assert.equal(node.dateCreated, c.issued);
    assert.match(node.description, new RegExp(`on ${escape(c.platform)}$`));
    if (c.kind === 'course-completion-badge') assert.match(node.description, /^Course completion badge on /);
  }
  assert.equal(ids.size, items.length);
  const newest = items.map((c) => c.issued).sort().at(-1);
  assert.equal(person.hasCredential[0].dateCreated, newest);
});

test('the Google courses point at the professional certificate, and nothing else has isPartOf', () => {
  const lead = person.hasCredential.find((n: any) => n.name === 'Google AI Professional Certificate');
  assert.ok(lead);
  const parts = person.hasCredential.filter((n: any) => n.isPartOf);
  assert.equal(parts.length, CERTS.items.filter((c) => c.partOf).length);
  for (const p of parts) assert.deepEqual(p.isPartOf, { '@id': lead['@id'] });
});

test('the award is only the finalist title, verbatim, and nothing claims a win', () => {
  assert.deepEqual(person.award, ['Top 36 Finalist — AI for Bharat Hackathon']);
  assert.equal(/\bwinner\b|\bwon\b|\bprize\b|\brank(ed)?\b/i.test(JSON.stringify(parsed)), false);
});

test("GOLDEN's Coreforge is an Organization he founded, from the data, sharing the Coreforge @id", () => {
  const orgs = nodes.filter((n) => n['@type'] === 'Organization');
  assert.equal(orgs.length, 1);
  const [o] = orgs;
  assert.equal(o.name, "GOLDEN's Coreforge");
  assert.equal(o.url, 'https://goldensdmat.in');
  assert.deepEqual(o.founder, { '@id': `${SITE}/#person` });
  assert.equal(o.foundingDate, '2026-07');
  assert.equal(o.description, ACH.items.find((a) => a.kind === 'founder')!.summary);
  assert.equal(o['@id'], COREFORGE_ORG_ID);
  assert.equal(PORTFOLIO_PERSON_ID, `${SITE}/#person`);
});

test('nothing private or withheld reaches the graph', () => {
  const text = JSON.stringify(parsed);
  for (const bad of ['GOLDEN_karaoke', 'DMAT_Core_Module', 'Bruhdeutschland', 'pingpen', 'Cast-Screen', 'admission', 'ID card', 'yearsExperience', 'impression', 'follower']) {
    assert.equal(text.toLowerCase().includes(bad.toLowerCase()), false, bad);
  }
  // Private repos by exact path segment (test-challenger-07 is public).
  for (const repo of ['test-chal', 'test1', 'desktop-tutorial']) {
    assert.equal(new RegExp(`/${repo}(?:["/]|$)`, 'i').test(text), false, repo);
  }
  // The Michigan credential is a single course, never the specialization.
  assert.equal(/Specialization/.test(text), false);
});

test('without credentials or achievements the graph is as before', () => {
  const g = buildSiteGraph({ siteUrl: SITE, profile, projects, caseStudyPath: () => null });
  const bare = g['@graph'] as Record<string, unknown>[];
  assert.equal('hasCredential' in bare[0], false);
  assert.equal('award' in bare[0], false);
  assert.equal(bare.length, 3);
});

test('a founder entry with no matching role is dropped, and www. still matches', () => {
  const founder = (url: string) => [{ title: 't', date: '2026-01', kind: 'founder' as const, summary: 's', links: [{ url }] }];
  assert.deepEqual(foundedOrganizations('x#person', [{ company: 'A', url: 'https://a.example' }], founder('https://b.example')), []);
  assert.equal(foundedOrganizations('x#person', [{ company: 'A', url: 'https://a.example' }], founder('https://www.a.example/')).length, 1);
});
