/*
 * BotID Basic for the AI routes. Only on Vercel builds: guard() checks BotID only
 * there, and off Vercel the challenge script cannot load, which would reject every
 * AI request made through the patched fetch.
 *
 * Imported on demand, so no other build carries the client, and on Vercel it stays
 * out of every page's first chunk. The first AI request is a click away, long after
 * this resolves.
 */
if (process.env.NEXT_PUBLIC_VERCEL_ENV) {
  import('botid/client/core')
    .then(({ initBotId }) => initBotId({ protect: [{ path: '/api/ai/*', method: 'POST' }] }))
    .catch(() => {
      // Without BotID, cheap AI features still answer and heavy ones fall back.
    });
}
