import assert from 'node:assert/strict';
import { test } from 'node:test';
import { containsPrice } from './copy-guard.ts';
import {
  buildCoreforgeApp,
  buildCoreforgeJsonLd,
  buildCoreforgeOrganization,
  COREFORGE_APP_ID,
  COREFORGE_ORG_ID,
  coreforgeFounderLink,
  PORTFOLIO_PERSON_ID,
} from './jsonld.ts';

test('the organization names the founder by reference', () => {
  const org = buildCoreforgeOrganization();
  assert.equal(org['@type'], 'Organization');
  assert.equal(org['@id'], 'https://goldensdmat.in/#organization');
  assert.equal(org.name, "GOLDEN's Coreforge");
  assert.equal(org.url, 'https://goldensdmat.in');
  assert.deepEqual(org.founder, { '@id': 'https://www.basuoikantik.in/#person' });
  assert.match(String(org.disambiguatingDescription), /Not affiliated with g\.a\.s\.t\./);
  assert.deepEqual(buildCoreforgeOrganization({ founderId: 'https://x.test/#me' }).founder, { '@id': 'https://x.test/#me' });
  assert.deepEqual(coreforgeFounderLink(), { worksFor: { '@id': COREFORGE_ORG_ID } });
  assert.equal(PORTFOLIO_PERSON_ID, 'https://www.basuoikantik.in/#person');
});

test('the app offers only the Free plan and claims no ratings', () => {
  const app = buildCoreforgeApp();
  assert.equal(app['@type'], 'WebApplication');
  assert.equal(app['@id'], COREFORGE_APP_ID);
  assert.equal(app.name, 'CoreForge');
  assert.equal(app.applicationCategory, 'EducationalApplication');
  assert.deepEqual(app.publisher, { '@id': COREFORGE_ORG_ID });
  assert.deepEqual(app.offers, {
    '@type': 'Offer',
    name: 'Free plan',
    description: 'Free plan — no card, no expiry',
    url: 'https://goldensdmat.in/pricing',
  });
  const json = JSON.stringify(buildCoreforgeJsonLd());
  assert.ok(!containsPrice(json));
  assert.doesNotMatch(json, /aggregateRating|"review"|ratingValue|"price|priceCurrency|utm_/);
  assert.match(json, /Not affiliated with g\.a\.s\.t\./);
});

test('the standalone document is a schema.org graph of both nodes', () => {
  const doc = buildCoreforgeJsonLd();
  assert.equal(doc['@context'], 'https://schema.org');
  assert.deepEqual(
    doc['@graph'].map((n) => n['@id']),
    [COREFORGE_ORG_ID, COREFORGE_APP_ID],
  );
});
