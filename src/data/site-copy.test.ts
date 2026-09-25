import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { copyEntries, PHILOSOPHY, PHILOSOPHY_SOURCE, ROLES, SITE_COPY } from './site-copy.ts';

const ROOT = new URL('../../', import.meta.url);

/**
 * Source text as rendered: JSX entities decoded, JS quote escapes undone and runs
 * of whitespace collapsed, so a line-wrapped JSX paragraph still matches.
 */
function rendered(source: string): string {
  return source
    .replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\(['"])/g, '$1')
    .replace(/\s+/g, ' ');
}

type Entry = { text: string; source: string };

function findDrift(entries: readonly Entry[], read: (path: string) => string): Entry[] {
  const cache = new Map<string, string>();
  return entries.filter(({ text, source }) => {
    if (!cache.has(source)) cache.set(source, rendered(read(source)));
    return !cache.get(source)!.includes(text.replace(/\s+/g, ' '));
  });
}

function readRepoFile(path: string): string {
  return readFileSync(new URL(path, ROOT), 'utf8');
}

test('every copied string still appears verbatim in the component it came from', () => {
  const drift = findDrift(copyEntries(), readRepoFile);
  assert.deepEqual(
    drift.map((d) => `${d.source}: ${JSON.stringify(d.text)}`),
    [],
    'site-copy.ts has drifted from these components; copy the new wording into src/data/site-copy.ts and run npm run ai:corpus',
  );
});

test('a one-word edit in PhilosophySection.tsx is caught and names that file', () => {
  const edited = (path: string) => {
    const text = readRepoFile(path);
    return path === PHILOSOPHY_SOURCE ? text.replace('Evals before vibes.', 'Evals before feelings.') : text;
  };
  const drift = findDrift(copyEntries(), edited);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].source, 'src/components/shared/PhilosophySection.tsx');
  assert.equal(drift[0].text, 'Evals before vibes.');
});

test('the corpus-facing shape carries all six tenets and every role', () => {
  assert.equal(PHILOSOPHY.length, 6);
  assert.deepEqual(
    PHILOSOPHY.map((t) => t.n),
    ['01', '02', '03', '04', '05', '06'],
  );
  assert.equal(ROLES.length, 4);
  assert.equal(SITE_COPY.philosophy, PHILOSOPHY);
  assert.match(SITE_COPY.contact, /I usually reply within a day\./);
});
