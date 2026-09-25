import { aiHealth, assertSafeServer, fakeStats, totalCalls } from './ai-mocks';
import { expect, test } from './helpers';

/*
 * The README's "Before going live" check for the Vercel WAF rule sends bare POSTs
 * to /api/ai/ask and reads any 429 as the rule answering. That only works while
 * the app itself never answers 429 and refuses such a request before the bucket,
 * BotID or the model, so the probe costs nothing. This pins both.
 */

const PROBE_REQUESTS = 25;

test.describe('WAF probe premise (README, Before going live)', () => {
  test.skip(
    ({ viewport, colorScheme, reducedMotion }) => !(viewport?.width === 1440 && colorScheme === 'dark' && reducedMotion !== 'reduce'),
    'API-level check; one project',
  );
  // A deployment may sit behind the rule, where a 429 is the point.
  test.skip(Boolean(process.env.PW_BASE_URL), 'needs the local server, which has no WAF in front of it');

  test('bare POSTs to /api/ai/ask answer HTTP 200 bad-request every time, never 429, with no model work', async ({ request }) => {
    await assertSafeServer(request);
    const fake = (await aiHealth(request)).fake === true;

    const burst = async () => {
      const statuses: number[] = [];
      for (let i = 0; i < PROBE_REQUESTS; i++) {
        // What `curl -X POST <url>` sends: no body, no content type, no Origin.
        const res = await request.fetch('/api/ai/ask', { method: 'POST', failOnStatusCode: false });
        statuses.push(res.status());
        if (res.status() === 200) {
          expect(res.headers()['content-type']).toContain('application/json');
          expect(await res.json()).toEqual({ mode: 'fallback', reason: 'bad-request' });
        }
      }
      expect(statuses, 'the app answered something other than 200, so a 429 in the README probe would not prove the WAF rule').toEqual(
        Array<number>(PROBE_REQUESTS).fill(200),
      );
    };

    if (!fake) {
      await burst();
      return;
    }
    // Other workers share the fake's counters, so retry until a window shows no movement.
    // Probe requests that reached the model would move every window by at least
    // PROBE_REQUESTS; a full 6-worker run can put another spec's call in three
    // windows running, so it gets eight.
    let moved = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await fakeStats(request);
      await burst();
      const after = await fakeStats(request);
      const calls = totalCalls(after) - totalCalls(before);
      const embeds = after.embeds - before.embeds;
      if (calls === 0 && embeds === 0) return;
      moved = `model calls +${calls}, embeds +${embeds}`;
    }
    throw new Error(`the probe's requests reached the model in eight windows running (last: ${moved})`);
  });
});
