import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import server from 'react-dom/server';
import { preloadable } from './preloadable.ts';

type Props = { label: string };

function Label({ label }: Props) {
  return createElement('p', null, label);
}

test('concurrent preloads share one load and settle on the component', async () => {
  let calls = 0;
  const Lazy = preloadable<Props>(async () => {
    calls++;
    return Label;
  });
  assert.equal(Lazy.loaded(), false);
  const [a, b] = await Promise.all([Lazy.preload(), Lazy.preload()]);
  assert.equal(calls, 1);
  assert.equal(a, Label);
  assert.equal(b, Label);
  assert.equal(Lazy.loaded(), true);
  assert.equal(await Lazy.preload(), Label);
  assert.equal(calls, 1);
});

test('a failed load rejects, stays unloaded and is tried again on the next preload', async () => {
  let calls = 0;
  const Lazy = preloadable<Props>(async () => {
    calls++;
    if (calls === 1) throw new Error('chunk failed');
    return Label;
  });
  await assert.rejects(Lazy.preload(), /chunk failed/);
  assert.equal(Lazy.loaded(), false);
  assert.equal(await Lazy.preload(), Label);
  assert.equal(calls, 2);
  assert.equal(Lazy.loaded(), true);
});

test('renders nothing on the server, like next/dynamic with ssr: false', async () => {
  const Lazy = preloadable<Props>(async () => Label);
  await Lazy.preload();
  assert.equal(server.renderToString(createElement(Lazy, { label: 'hello' })), '');
});
