import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanText, isPhone, PHONE_RE, scrubContacts, validAction, validTarget, type KnownTargets } from './sanitize.ts';

const ALLOW = {
  urls: ['https://basuoikantik.in', 'https://github.com/Golden007-prog', 'https://github.com/Golden007-prog/UrbanCare-AI'],
  emails: ['basuoikantik@gmail.com'],
};

const KNOWN: KnownTargets = {
  slugs: ['urbancare-ai', 'omni-lab'],
  skills: ['ReAct', 'LangChain'],
  sections: ['about', 'skills', 'projects', 'experience', 'philosophy', 'contact'],
  expCount: 3,
  eduCount: 2,
  readingCount: 6,
  tenetCount: 6,
  categories: ['AI/ML', 'Data Science', 'Web App'],
};

test('cleanText strips HTML, scripts and Markdown links but keeps text', () => {
  assert.equal(cleanText('See [the repo](https://evil.example) now'), 'See the repo now');
  assert.equal(cleanText('![logo](https://evil.example/x.png) ok'), 'logo ok');
  assert.equal(cleanText('<b>Bold</b> and <script>alert(1)</script>done'), 'Bold and done');
  assert.equal(cleanText('a <!-- hidden --> b'), 'a b');
  assert.equal(cleanText('zero​width\u0007'), 'zerowidth');
  assert.equal(cleanText('R² > 0.9 & x < y'), 'R² > 0.9 & x < y');
  assert.equal(cleanText('**Bold** stays\nand lines stay'), '**Bold** stays\nand lines stay');
  assert.equal(cleanText('He built it [c:project:omni-lab#summary].'), 'He built it [c:project:omni-lab#summary].');
});

test('scrubContacts removes foreign URLs, emails and phones and keeps allowed ones', () => {
  assert.equal(scrubContacts('Write to hire@evil.example today.', ALLOW), 'Write to today.');
  assert.equal(scrubContacts('Write to basuoikantik@gmail.com.', ALLOW), 'Write to basuoikantik@gmail.com.');
  assert.equal(scrubContacts('Mail mailto:hire@evil.example now', ALLOW), 'Mail now');
  assert.equal(scrubContacts('Visit https://evil.example/path.', ALLOW), 'Visit.');
  assert.equal(scrubContacts('Code: https://github.com/Golden007-prog/UrbanCare-AI.', ALLOW), 'Code: https://github.com/Golden007-prog/UrbanCare-AI.');
  assert.equal(scrubContacts('See https://www.basuoikantik.in/projects/omni-lab', ALLOW), 'See https://www.basuoikantik.in/projects/omni-lab');
  assert.equal(scrubContacts('Fake https://github.com/Golden007-prog.evil.example/x', ALLOW), 'Fake');
  assert.equal(scrubContacts('Call +1 (415) 555-0100 or +91 7001124396.', ALLOW), 'Call or.');
  assert.equal(scrubContacts('Ring 415-555-0100.', ALLOW), 'Ring.');
});

test('numbers that are not phones survive the scrub', () => {
  const text = 'Python 3.12 in 2026, R² 0.999, 86% accuracy, 1470 × 35, dated 2025-09-25, 65+ Lambdas.';
  assert.equal(scrubContacts(text, ALLOW), text);
  for (const n of ['2026', '3.12', '2025-09-25', '0.999']) {
    const m = n.match(PHONE_RE);
    assert.ok(!m || !isPhone(m[0]), n);
  }
});

test('validTarget accepts known targets only and rebuilds them', () => {
  assert.deepEqual(validTarget({ kind: 'project', slug: 'omni-lab', extra: 'x' }, KNOWN), { kind: 'project', slug: 'omni-lab' });
  assert.equal(validTarget({ kind: 'project', slug: 'nope' }, KNOWN), null);
  assert.deepEqual(validTarget({ kind: 'skill', name: 'react' }, KNOWN), { kind: 'skill', name: 'ReAct' });
  assert.deepEqual(validTarget({ kind: 'section', id: 'contact' }, KNOWN), { kind: 'section', id: 'contact' });
  assert.equal(validTarget({ kind: 'section', id: 'hero' }, KNOWN), null);
  assert.deepEqual(validTarget({ kind: 'experience', index: 2 }, KNOWN), { kind: 'experience', index: 2 });
  assert.equal(validTarget({ kind: 'experience', index: 3 }, KNOWN), null);
  assert.equal(validTarget({ kind: 'tenet', index: 1.5 }, KNOWN), null);
  assert.equal(validTarget({ kind: 'reading', index: '1' }, KNOWN), null);
  assert.deepEqual(validTarget({ kind: 'cv' }, KNOWN), { kind: 'cv' });
  for (const bad of [null, undefined, 'project', 42, [], { kind: 'script' }]) assert.equal(validTarget(bad, KNOWN), null);
});

test('validAction caps and cleans fields and rejects unknown kinds', () => {
  assert.deepEqual(validAction({ kind: 'open', target: { kind: 'project', slug: 'urbancare-ai' } }, KNOWN), {
    kind: 'open',
    target: { kind: 'project', slug: 'urbancare-ai' },
  });
  assert.equal(validAction({ kind: 'open', target: { kind: 'project', slug: 'x' } }, KNOWN), null);
  assert.deepEqual(validAction({ kind: 'filter', cat: 'ai/ml', live: true, q: '  voice   ai ' }, KNOWN), {
    kind: 'filter',
    cat: 'AI/ML',
    q: 'voice ai',
    live: true,
  });
  assert.equal(validAction({ kind: 'filter', cat: 'Games' }, KNOWN), null);
  const long = validAction({ kind: 'filter', q: 'x'.repeat(500) }, KNOWN);
  assert.equal(long && long.kind === 'filter' ? long.q?.length : 0, 160);
  assert.deepEqual(validAction({ kind: 'prefill', subject: 'Hi', message: '<b>Hello</b> there' }, KNOWN), {
    kind: 'prefill',
    subject: 'Hi',
    message: 'Hello there',
  });
  assert.equal(validAction({ kind: 'prefill', message: '   ' }, KNOWN), null);
  assert.deepEqual(validAction({ kind: 'vcard' }, KNOWN), { kind: 'vcard' });
  assert.equal(validAction({ kind: 'eval', code: 'x' }, KNOWN), null);
});
