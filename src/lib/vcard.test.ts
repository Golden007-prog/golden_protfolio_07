import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVCard, escapeText, foldLine, normalizePhone } from './vcard.ts';

// The same values app/contact.vcf/route.ts reads from profile.json and SITE.
const PROFILE = {
  name: 'Oikantik Basu',
  email: 'basuoikantik@gmail.com',
  phone: '+91 7001124396',
  title: 'Data Science & Gen AI Developer',
  locality: 'Bengaluru',
  country: 'India',
  urls: [
    'https://www.basuoikantik.in',
    'https://github.com/Golden007-prog',
    'https://linkedin.com/in/oikantik-basu-b13919278',
    'https://leetcode.com/oikantik007',
  ],
};

/** Unfolds continuation lines, then maps NAME(;params) -> value for single-valued properties. */
function parse(card: string): { lines: string[]; props: Map<string, string[]> } {
  const unfolded = card.replace(/\r\n[ \t]/g, '');
  const lines = unfolded.split('\r\n').filter(Boolean);
  const props = new Map<string, string[]>();
  for (const line of lines) {
    const colon = line.indexOf(':');
    const name = line.slice(0, colon).split(';')[0];
    props.set(name, [...(props.get(name) ?? []), line.slice(colon + 1)]);
  }
  return { lines, props };
}

test('every physical line ends in CRLF and there are no bare LFs', () => {
  const card = buildVCard(PROFILE);
  assert.ok(card.endsWith('\r\n'));
  assert.equal(card.replace(/\r\n/g, '').includes('\n'), false);
  assert.equal(card.replace(/\r\n/g, '').includes('\r'), false);
});

test('starts and ends as a vCard 3.0', () => {
  const { lines } = parse(buildVCard(PROFILE));
  assert.equal(lines[0], 'BEGIN:VCARD');
  assert.equal(lines[1], 'VERSION:3.0');
  assert.equal(lines.at(-1), 'END:VCARD');
});

test('FN is the full name and N splits family;given', () => {
  const { props } = parse(buildVCard(PROFILE));
  assert.deepEqual(props.get('FN'), ['Oikantik Basu']);
  assert.deepEqual(props.get('N'), ['Basu;Oikantik;;;']);
});

test('TEL has no spaces and keeps the country code', () => {
  const { props } = parse(buildVCard(PROFILE));
  assert.deepEqual(props.get('TEL'), ['+917001124396']);
  assert.equal(normalizePhone('+91 70011-24396'), '+917001124396');
  assert.equal(normalizePhone('(700) 112 4396'), '7001124396');
});

test('EMAIL, TITLE, ADR locality and every URL are present', () => {
  const { props } = parse(buildVCard(PROFILE));
  assert.deepEqual(props.get('EMAIL'), ['basuoikantik@gmail.com']);
  assert.deepEqual(props.get('TITLE'), ['Data Science & Gen AI Developer']);
  const adr = props.get('ADR')?.[0].split(';');
  assert.equal(adr?.length, 7);
  assert.equal(adr?.[3], 'Bengaluru');
  assert.equal(adr?.[6], 'India');
  assert.deepEqual(props.get('URL'), PROFILE.urls);
});

test('text values escape commas, semicolons, backslashes and newlines', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const { props } = parse(buildVCard({ name: 'Ada Lovelace', title: 'Analyst, Engines; Notes' }));
  assert.deepEqual(props.get('TITLE'), ['Analyst\\, Engines\\; Notes']);
});

test('long lines fold at 75 octets without splitting a UTF-8 character', () => {
  const long = `TITLE:${'Ω'.repeat(60)}`;
  const folded = foldLine(long);
  const encoder = new TextEncoder();
  for (const piece of folded.split('\r\n')) assert.ok(encoder.encode(piece).length <= 75, piece);
  assert.equal(folded.replace(/\r\n /g, ''), long);
  assert.equal(foldLine('SHORT:line'), 'SHORT:line');
});

test('optional fields are omitted when absent', () => {
  const { props } = parse(buildVCard({ name: 'Solo' }));
  assert.deepEqual(props.get('N'), [';Solo;;;']);
  assert.equal(props.has('TEL'), false);
  assert.equal(props.has('ADR'), false);
  assert.equal(props.has('URL'), false);
});
