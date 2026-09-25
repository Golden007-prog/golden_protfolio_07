import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createNdjsonDecoder,
  initialStreamState,
  isFallbackBody,
  parseNdjson,
  streamReducer,
  type AiStreamEvent,
  type AiStreamState,
} from './stream.ts';
import { BLOCK_STREAK, createAiSession, SOFT_CAP, TRANSIENT_BLOCK_MS } from './circuit.ts';
import type { AiFrame } from './protocol.ts';

const meta = {
  type: 'meta',
  model: 'fake',
  feature: 'ask',
  mode: 'lexical',
  sources: [{ id: 'exp:0', label: 'Experience', cls: 'self', target: { kind: 'experience', index: 0 } }],
};
const line = (x: unknown) => `${JSON.stringify(x)}\n`;

/* ---- NDJSON ---- */

test('frames split across chunk boundaries reassemble', () => {
  const wire = line(meta) + line({ type: 'delta', text: 'He built UrbanCare AI. ' }) + line({ type: 'done', cited: [], dropped: 0, degraded: false, finishReason: 'STOP' });
  for (let cut = 1; cut < wire.length; cut += 7) {
    const a = parseNdjson(wire.slice(0, cut), '');
    const b = parseNdjson(wire.slice(cut), a.carry);
    const end = parseNdjson('\n', b.carry);
    const types = [...a.frames, ...b.frames, ...end.frames].map((f) => f.type);
    assert.deepEqual(types, ['meta', 'delta', 'done'], `cut at ${cut}`);
  }
});

test('multi-byte UTF-8 split between network chunks survives the byte decoder', () => {
  const text = 'Vyapar-Gyan — दुकान ₹ 86% ✓';
  const bytes = new TextEncoder().encode(line({ type: 'delta', text }));
  // Cut inside every multi-byte sequence in turn.
  for (let cut = 1; cut < bytes.length; cut += 1) {
    const dec = createNdjsonDecoder();
    const frames: AiFrame[] = [...dec.push(bytes.slice(0, cut)), ...dec.push(bytes.slice(cut)), ...dec.end()];
    assert.equal(frames.length, 1, `cut at ${cut}`);
    assert.deepEqual(frames[0], { type: 'delta', text });
  }
});

test('blank lines, CRLF and malformed lines are skipped, not fatal', () => {
  const wire = `\n\r\n${line(meta).replace('\n', '\r\n')}not json\n{"type":"mystery"}\n\n${line({ type: 'delta', text: 'ok' })}`;
  const r = parseNdjson(wire, '');
  assert.deepEqual(
    r.frames.map((f) => f.type),
    ['meta', 'delta'],
  );
  assert.equal(r.bad, 2);
  assert.equal(r.carry, '');
});

test('a trailing partial frame waits in carry, and a final unterminated frame still counts', () => {
  const r = parseNdjson(`${line({ type: 'delta', text: 'a' })}{"type":"delta","te`, '');
  assert.equal(r.frames.length, 1);
  assert.equal(r.carry, '{"type":"delta","te');
  const r2 = parseNdjson('xt":"b"}', r.carry);
  assert.equal(r2.frames.length, 0);
  const end = parseNdjson('\n', r2.carry);
  assert.deepEqual(end.frames, [{ type: 'delta', text: 'b' }]);
  // A cut-off last line is dropped rather than half-parsed.
  assert.deepEqual(parseNdjson('\n', '{"type":"delta","te').frames, []);
});

test('frames are validated: an error frame with an unknown reason becomes upstream, bad sources are dropped', () => {
  const r = parseNdjson(
    line({ type: 'error', reason: 'kaboom' }) +
      line({ ...meta, sources: [...meta.sources, { id: 3 }, 'x'] }) +
      line({ type: 'tool', call: { name: 'openProject', args: 'nope' } }),
    '',
  );
  assert.deepEqual(r.frames[0], { type: 'error', reason: 'upstream' });
  assert.equal(r.frames[1]?.type === 'meta' && r.frames[1].sources.length, 1);
  assert.equal(r.frames.length, 2);
});

test('isFallbackBody accepts only the fallback contract', () => {
  assert.equal(isFallbackBody({ mode: 'fallback', reason: 'quota' }), true);
  assert.equal(isFallbackBody({ mode: 'fallback', reason: 'rate-limited', retryAfterSec: 30 }), true);
  assert.equal(isFallbackBody({ mode: 'fallback', reason: 'made-up' }), false);
  assert.equal(isFallbackBody({ mode: 'lexical', hits: [] }), false);
  assert.equal(isFallbackBody({ mode: 'fallback', reason: 'quota', retryAfterSec: -1 }), false);
  assert.equal(isFallbackBody(null), false);
  assert.equal(isFallbackBody('fallback'), false);
});

/* ---- reducer ---- */

function run(events: AiStreamEvent[], from: AiStreamState = initialStreamState): AiStreamState {
  return events.reduce(streamReducer, from);
}

const frames = (at: number, ...fs: unknown[]): AiStreamEvent => ({
  type: 'frames',
  at,
  frames: parseNdjson(fs.map(line).join(''), '').frames,
});

test('a full answer: submitted, streaming, done, with ttft and total', () => {
  const s = run([
    { type: 'start', at: 100 },
    frames(150, meta),
    frames(400, { type: 'delta', text: 'One. ' }),
    frames(600, { type: 'delta', text: 'Two.' }),
    frames(900, { type: 'done', cited: ['exp:0'], dropped: 0, degraded: false, finishReason: 'STOP' }),
  ]);
  assert.equal(s.status, 'done');
  assert.equal(s.text, 'One. Two.');
  assert.equal(s.meta?.sources[0]?.id, 'exp:0');
  assert.deepEqual(s.done?.cited, ['exp:0']);
  assert.equal(s.ttftMs, 300);
  assert.equal(s.totalMs, 800);
});

test('stop() gives stopped, keeps the partial text and ignores later frames', () => {
  const s = run([
    { type: 'start', at: 0 },
    frames(10, meta, { type: 'delta', text: 'Partial. ' }),
    { type: 'stop', at: 50 },
    frames(60, { type: 'delta', text: 'Late.' }, { type: 'done', cited: [], dropped: 0, degraded: false, finishReason: 'STOP' }),
    { type: 'end', at: 70 },
  ]);
  assert.equal(s.status, 'stopped');
  assert.equal(s.text, 'Partial. ');
  assert.equal(s.done, null);
  assert.equal(s.totalMs, 50);
});

test('an error frame after text is a fallback that keeps the text', () => {
  const s = run([{ type: 'start', at: 0 }, frames(5, { type: 'delta', text: 'Half. ' }, { type: 'error', reason: 'timeout' })]);
  assert.equal(s.status, 'fallback');
  assert.equal(s.fallback?.reason, 'timeout');
  assert.equal(s.text, 'Half. ');
});

test('a body that ends without done is an upstream fallback; after done, end changes nothing', () => {
  assert.equal(run([{ type: 'start', at: 0 }, frames(1, meta), { type: 'end', at: 2 }]).fallback?.reason, 'upstream');
  const done = run([
    { type: 'start', at: 0 },
    frames(1, { type: 'done', cited: [], dropped: 0, degraded: true, finishReason: 'STOP' }),
    { type: 'end', at: 2 },
  ]);
  assert.equal(done.status, 'done');
  assert.equal(done.done?.degraded, true);
});

test('a fallback body before any frame, and start() resets a finished answer', () => {
  const fb = run([{ type: 'start', at: 0 }, { type: 'fallback', at: 3, fallback: { mode: 'fallback', reason: 'quota' } }]);
  assert.equal(fb.status, 'fallback');
  assert.equal(fb.fallback?.reason, 'quota');
  const again = run([{ type: 'start', at: 10 }], fb);
  assert.equal(again.status, 'submitted');
  assert.equal(again.fallback, null);
  assert.equal(run([{ type: 'reset' }], again).status, 'idle');
  // Stop with nothing running is a no-op.
  assert.equal(run([{ type: 'stop', at: 1 }]).status, 'idle');
});

/* ---- circuit breaker (circuit.ts) ---- */

test('two consecutive hard fallbacks block the session', () => {
  const s = createAiSession();
  s.recordFallback('quota', 0);
  assert.equal(s.blocked(1), false);
  s.recordFallback('upstream', 1);
  assert.equal(BLOCK_STREAK, 2);
  assert.equal(s.blocked(2), true);
  assert.equal(s.blockReason(2), 'upstream');
});

test('recordOk resets the streak', () => {
  const s = createAiSession();
  s.recordFallback('quota', 0);
  s.recordOk();
  s.recordFallback('quota', 1);
  assert.equal(s.blocked(2), false);
});

test('soft failures neither count nor reset', () => {
  const s = createAiSession();
  s.recordFallback('no-key', 0);
  s.recordFallback('low-relevance', 1);
  s.recordFallback('rate-limited', 2);
  s.recordFallback('timeout', 3);
  assert.equal(s.blocked(4), false);
  s.recordFallback('disabled', 5);
  assert.equal(s.blocked(6), true);
});

test('quota and upstream blocks lift after the cooldown; disabled and no-key last the session', () => {
  const t = createAiSession();
  t.recordFallback('quota', 0);
  t.recordFallback('quota', 0);
  assert.equal(t.blocked(TRANSIENT_BLOCK_MS - 1), true);
  assert.equal(t.blocked(TRANSIENT_BLOCK_MS + 1), false);
  const p = createAiSession();
  p.recordFallback('no-key', 0);
  p.recordFallback('no-key', 0);
  assert.equal(p.blocked(Number.MAX_SAFE_INTEGER), true);
});

test('the soft cap counts answers and notifies subscribers', () => {
  const s = createAiSession({ softCap: 3 });
  let calls = 0;
  const off = s.subscribe(() => {
    calls += 1;
  });
  const before = s.snapshot();
  s.recordOk();
  s.recordOk();
  assert.notEqual(s.snapshot(), before);
  assert.equal(s.remaining(), 1);
  assert.equal(s.overSoftCap(), false);
  s.recordOk();
  assert.equal(s.overSoftCap(), true);
  assert.equal(s.count(), 3);
  off();
  s.reset();
  assert.equal(calls, 3);
  assert.equal(s.count(), 0);
  assert.equal(SOFT_CAP, 20);
});
