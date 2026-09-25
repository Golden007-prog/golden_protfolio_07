import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runScramble, scrambleFrame, type FrameScheduler } from './scramble.ts';

const ROLE = 'Data Pipeline Builder';

/** Asserts `frame` could be a decode frame of `text`: same length, spaces in place. */
function assertFrameOf(frame: string, text: string) {
  assert.equal(frame.length, text.length, JSON.stringify(frame));
  for (let i = 0; i < text.length; i++) {
    assert.equal(frame[i] === ' ', text[i] === ' ', `space mismatch at ${i} in ${JSON.stringify(frame)}`);
  }
}

/**
 * A scheduler that runs queued frames on demand with the given timestamps, the
 * way the browser stamps each callback with the time its frame began.
 */
function manualFrames() {
  let next = 1;
  const queue = new Map<number, (now: number) => void>();
  const scheduler: FrameScheduler = {
    request: (cb) => {
      queue.set(next, cb);
      return next++;
    },
    cancel: (id) => void queue.delete(id),
  };
  const frame = (now: number) => {
    const due = [...queue.values()];
    queue.clear();
    for (const cb of due) cb(now);
    return due.length;
  };
  return { scheduler, frame, pending: () => queue.size };
}

test('scrambleFrame keeps the length and the spaces for any progress', () => {
  for (const progress of [-Infinity, -1, -0.2, -0.0001, 0, 0.01, 0.5, 0.999, 1, 1.5, Infinity, Number.NaN]) {
    const frame = scrambleFrame(ROLE, progress, '#%&');
    assertFrameOf(frame, ROLE);
  }
});

test('scrambleFrame settles left to right', () => {
  assert.equal(scrambleFrame('ab cd', 0, '#'), '## ##');
  assert.equal(scrambleFrame('ab cd', -0.5, '#'), '## ##');
  assert.equal(scrambleFrame('ab cd', 0.4, '#'), 'ab ##');
  assert.equal(scrambleFrame('ab cd', 0.8, '#'), 'ab c#');
  assert.equal(scrambleFrame('ab cd', 1, '#'), 'ab cd');
  assert.equal(scrambleFrame('ab cd', 7, '#'), 'ab cd');
  assert.equal(scrambleFrame('ab cd', Number.NaN, '#'), '## ##');
});

test('a frame stamped before the decode started never writes a longer line', () => {
  // The browser stamps a frame with the time it began, which can come before a
  // performance.now() read taken later in that frame. Before the fix this made
  // progress negative and wrote ~2x the text, which wrapped the hero role line.
  const { scheduler, frame } = manualFrames();
  const writes: string[] = [];
  const began = performance.now() - 112;
  runScramble((s) => writes.push(s), ROLE, 600, '#', scheduler);
  for (let t = began; frame(t) > 0; t += 16);
  assert.ok(writes.length > 30, `expected a frame-by-frame decode, got ${writes.length} writes`);
  for (const w of writes) assertFrameOf(w, ROLE);
  assert.equal(writes[0], scrambleFrame(ROLE, 0, '#'));
  assert.equal(writes.at(-1), ROLE);
});

test('the decode runs from the first frame for `duration`, then stops', () => {
  const { scheduler, frame, pending } = manualFrames();
  const writes: string[] = [];
  runScramble((s) => writes.push(s), 'ab cd', 600, '#', scheduler);
  frame(5000);
  frame(5300);
  frame(5600);
  assert.deepEqual(writes, ['## ##', 'ab ##', 'ab cd']);
  assert.equal(pending(), 0);
});

test('stopping cancels the next frame', () => {
  const { scheduler, frame, pending } = manualFrames();
  const writes: string[] = [];
  const stop = runScramble((s) => writes.push(s), ROLE, 600, '#', scheduler);
  frame(100);
  stop();
  assert.equal(pending(), 0);
  assert.equal(frame(116), 0);
  assert.equal(writes.length, 1);
});
