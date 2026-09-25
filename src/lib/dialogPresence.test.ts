import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDialogPresence } from './dialogPresence.ts';

/** A scheduler the test flushes by hand, standing in for "after the next paint". */
function manualSchedule() {
  const queue = new Set<() => void>();
  return {
    schedule(fn: () => void) {
      queue.add(fn);
      return () => {
        queue.delete(fn);
      };
    },
    flush() {
      const fns = Array.from(queue);
      queue.clear();
      for (const fn of fns) fn();
    },
    get size() {
      return queue.size;
    },
  };
}

test('opening publishes only after the scheduled flush, not inside the call', () => {
  const clock = manualSchedule();
  const presence = createDialogPresence(clock.schedule);
  let calls = 0;
  presence.subscribe(() => calls++);

  const release = presence.hold();
  assert.equal(presence.isOpen(), false, 'still closed until the paint');
  assert.equal(calls, 0);
  clock.flush();
  assert.equal(presence.isOpen(), true);
  assert.equal(calls, 1);

  release();
  assert.equal(presence.isOpen(), true, 'still open until the paint');
  clock.flush();
  assert.equal(presence.isOpen(), false);
  assert.equal(calls, 2);
});

test('stacked dialogs stay open until the last one closes', () => {
  const clock = manualSchedule();
  const presence = createDialogPresence(clock.schedule);
  const a = presence.hold();
  const b = presence.hold();
  assert.equal(clock.size, 1, 'one publish per frame, however many changes');
  clock.flush();
  a();
  clock.flush();
  assert.equal(presence.isOpen(), true);
  b();
  clock.flush();
  assert.equal(presence.isOpen(), false);
});

test('an open and close inside one frame notify nobody; a release is idempotent', () => {
  const clock = manualSchedule();
  const presence = createDialogPresence(clock.schedule);
  let calls = 0;
  presence.subscribe(() => calls++);
  const release = presence.hold();
  release();
  release();
  clock.flush();
  assert.equal(calls, 0);
  assert.equal(presence.isOpen(), false);

  const again = presence.hold();
  clock.flush();
  assert.equal(presence.isOpen(), true, 'the double release did not drive the count below zero');
  again();
  clock.flush();
  assert.equal(presence.isOpen(), false);
});

test('unsubscribed listeners are not called', () => {
  const clock = manualSchedule();
  const presence = createDialogPresence(clock.schedule);
  let calls = 0;
  const off = presence.subscribe(() => calls++);
  off();
  presence.hold();
  clock.flush();
  assert.equal(calls, 0);
  assert.equal(presence.isOpen(), true);
});
