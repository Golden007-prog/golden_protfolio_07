import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { bannedPhrase, faithful } from '../../../scripts/ai/lib.mjs';
import { provenance, PROVENANCE, visible, visibleEntries, type Store, type StoreEntry } from './reviewGate.ts';

const REVIEW = fileURLToPath(new URL('../../../scripts/ai/review.mjs', import.meta.url));

function entry(claimBearing: boolean, reviewed: boolean): StoreEntry<string> {
  return { hash: 'h', model: 'gemini-3.5-flash-lite', generatedAt: '2026-09-25T00:00:00.000Z', reviewed, claimBearing, value: 'v' };
}

test('visible() over the claimBearing × reviewed × flag matrix', () => {
  const cases: [claimBearing: boolean, reviewed: boolean, show: boolean, expected: boolean][] = [
    [true, false, false, false], // production hides an unreviewed claim
    [true, false, true, true], // preview and local show the draft
    [true, true, false, true],
    [true, true, true, true],
    [false, false, false, true],
    [false, false, true, true],
    [false, true, false, true],
    [false, true, true, true],
  ];
  for (const [claimBearing, reviewed, show, expected] of cases) {
    assert.equal(visible(entry(claimBearing, reviewed), show), expected, JSON.stringify({ claimBearing, reviewed, show }));
  }
  assert.equal(visible(null, true), false);
});

test('provenance names who stands behind the text', () => {
  assert.equal(provenance(entry(true, false)), 'Draft · not yet reviewed');
  assert.equal(provenance(entry(true, true)), 'AI-written · reviewed by Oikantik');
  assert.equal(provenance(entry(false, false)), "AI-written from this site's content");
  assert.equal(provenance(entry(false, true)), PROVENANCE.reviewed);
});

test('visibleEntries filters a store for the production flag', () => {
  const store: Store<string> = { version: 1, entries: { a: entry(true, false), b: entry(true, true), c: entry(false, false) } };
  assert.deepEqual(Object.keys(visibleEntries(store, false)), ['b', 'c']);
  assert.deepEqual(Object.keys(visibleEntries(store, true)), ['a', 'b', 'c']);
  assert.deepEqual(visibleEntries(undefined, true), {});
});

test('approving a fixture entry with the review CLI makes it visible under the production flag', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-review-'));
  try {
    const file = join(dir, 'skills.json');
    writeFileSync(file, JSON.stringify({ version: 1, entries: { LangChain: entry(true, false), FAISS: entry(true, false) } }));
    const readStore = () => JSON.parse(readFileSync(file, 'utf8')) as Store<string>;
    assert.equal(visible(readStore().entries.LangChain, false), false, 'hidden in production before review');

    const list = spawnSync(process.execPath, [REVIEW, '--dir', dir, '--list'], { encoding: 'utf8' });
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /skills: 2 entries · 2 claim-bearing · 0 reviewed · 2 awaiting review/);
    assert.match(list.stdout, /pending skills:LangChain/);

    const approve = spawnSync(process.execPath, [REVIEW, '--dir', dir, '--approve', 'skills:LangChain'], { encoding: 'utf8' });
    assert.equal(approve.status, 0, approve.stderr);
    const approved = readStore().entries.LangChain;
    assert.equal(approved.reviewed, true);
    assert.match(approved.reviewedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(visible(approved, false), true, 'visible in production after review');
    assert.equal(provenance(approved), 'AI-written · reviewed by Oikantik');

    const reject = spawnSync(process.execPath, [REVIEW, '--dir', dir, '--reject', 'skills:FAISS'], { encoding: 'utf8' });
    assert.equal(reject.status, 0, reject.stderr);
    assert.equal(readStore().entries.FAISS, undefined, 'rejecting deletes the entry');

    const missing = spawnSync(process.execPath, [REVIEW, '--dir', dir, '--approve', 'skills:Nope'], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generator checks: an added '99%' and an absent 'architected' are rejected", () => {
  const source = 'Trained seven models including XGBoost (86% accuracy, 0.83 ROC-AUC). Architecting multi-agent systems.';
  const ents = { companies: ['Mindrift'], institutions: [], skills: ['XGBoost'], tech: ['Flask'] };
  assert.equal(faithful('XGBoost reached 86% accuracy.', source, ents), null);
  assert.equal(faithful('XGBoost reached 99% accuracy.', source, ents), 'number:99');
  assert.equal(faithful('Deployed with Flask.', source, ents), 'name:Flask');
  assert.equal(faithful('Built for Mindrift.', source, ents), 'name:Mindrift');
  assert.equal(bannedPhrase('He architected a multi-agent system.', source), 'architected');
  assert.equal(bannedPhrase('A senior engineer.', source), 'senior');
  assert.equal(bannedPhrase('He trains models.', source), null);
});
