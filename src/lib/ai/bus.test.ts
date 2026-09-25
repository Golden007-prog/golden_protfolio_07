import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openAssistant, openFit, PENDING_TTL_MS, takePending } from './bus.ts';

test('take returns the pending request and clears it', () => {
  openAssistant({ question: 'What stack?', scope: { project: 'omni-lab' } }, 1000);
  assert.deepEqual(takePending('ask', 1001), { question: 'What stack?', scope: { project: 'omni-lab' } });
  assert.equal(takePending('ask', 1002), null);
});

test('a newer request replaces the pending one', () => {
  openAssistant({ question: 'first' }, 0);
  openAssistant({ question: 'second', send: true }, 1);
  assert.deepEqual(takePending('ask', 2), { question: 'second', send: true });
  assert.equal(takePending('ask', 3), null);
});

test("the 'ask' and 'fit' slots are independent", () => {
  openAssistant({ question: 'Ask me' }, 0);
  openFit({ jd: 'Python, RAG' }, 0);
  assert.deepEqual(takePending('fit', 1), { jd: 'Python, RAG' });
  assert.equal(takePending('fit', 1), null);
  assert.deepEqual(takePending('ask', 1), { question: 'Ask me' });
});

test('an empty request still opens (the slot holds {})', () => {
  openFit(undefined, 0);
  assert.deepEqual(takePending('fit', 0), {});
});

test('a request nobody picked up expires', () => {
  openAssistant({ question: 'stale' }, 0);
  assert.equal(takePending('ask', PENDING_TTL_MS + 1), null);
  // Expired requests are cleared, not kept for later.
  assert.equal(takePending('ask', 1), null);
});

test("the slot holds a copy, so the caller's later edits don't leak in", () => {
  const req = { question: 'original', scope: { project: 'omni-lab' } };
  openAssistant(req, 0);
  req.question = 'mutated';
  req.scope.project = 'mutated';
  assert.deepEqual(takePending('ask', 1), { question: 'original', scope: { project: 'omni-lab' } });
});
