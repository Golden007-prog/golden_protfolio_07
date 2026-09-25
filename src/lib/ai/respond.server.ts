import 'server-only';
import { after } from 'next/server';
import type { AiFeature } from './config';
import type { AiFallbackReason, AiFrame, AiUsage } from './protocol';

const REASONS: ReadonlySet<string> = new Set<AiFallbackReason>([
  'disabled',
  'no-key',
  'feature-off',
  'rate-limited',
  'bot',
  'origin',
  'bad-request',
  'too-long',
  'quota',
  'upstream',
  'timeout',
  'safety',
  'unverified',
  'low-relevance',
]);

const CITE = /\[c:([a-z]+:[\w#.-]+)\]/g;

function reasonOf(err: unknown): AiFallbackReason {
  const reason = (err as { reason?: unknown } | null)?.reason;
  if (typeof reason === 'string' && REASONS.has(reason)) return reason as AiFallbackReason;
  const name = err instanceof Error ? err.name : '';
  return name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'upstream';
}

/**
 * Streams frames as NDJSON. The stream is pull-based (high-water mark 0), so a
 * frame is produced only when the client reads one; cancel() (a closed tab, with
 * supportsCancellation on Vercel) returns the frame iterator and aborts upstream.
 * Deltas are capped at maxChars of visible text: the delta that would cross the
 * cap is dropped whole and a done frame ends the stream. An error after the first
 * byte becomes an error frame.
 */
export function ndjson(
  frames: AsyncIterable<AiFrame>,
  { model, abort, maxChars }: { model: string; abort?: () => void; maxChars: number },
): Response {
  const encoder = new TextEncoder();
  const iterator = frames[Symbol.asyncIterator]();
  const cited = new Set<string>();
  let emitted = 0;
  let closed = false;
  let sentDone = false;

  const line = (frame: AiFrame) => encoder.encode(`${JSON.stringify(frame)}\n`);

  // Abort first: a producer blocked on the upstream call only settles, and so only
  // honours return(), once that call is cut.
  async function stop() {
    closed = true;
    try {
      abort?.();
    } catch {
      /* nothing left to abort */
    }
    try {
      await iterator.return?.();
    } catch {
      /* the producer is already gone */
    }
  }

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (closed) return;
        let next: IteratorResult<AiFrame>;
        try {
          next = await iterator.next();
        } catch (err) {
          if (closed) return;
          closed = true;
          if (!sentDone) controller.enqueue(line({ type: 'error', reason: reasonOf(err) }));
          controller.close();
          try {
            abort?.();
          } catch {
            /* nothing left to abort */
          }
          return;
        }
        if (closed) return;
        if (next.done) {
          closed = true;
          controller.close();
          return;
        }

        const frame = next.value;
        if (frame.type === 'delta') {
          const visible = frame.text.replace(CITE, '').length;
          if (maxChars > 0 && emitted + visible > maxChars) {
            controller.enqueue(line({ type: 'done', finishReason: 'MAX_CHARS', cited: [...cited], dropped: 0, degraded: false }));
            sentDone = true;
            controller.close();
            await stop();
            return;
          }
          emitted += visible;
          for (const m of frame.text.matchAll(CITE)) cited.add(m[1]);
        }
        if (frame.type === 'done') sentDone = true;
        controller.enqueue(line(frame));
      },
      async cancel() {
        await stop();
      },
    },
    { highWaterMark: 0 },
  );

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson',
      // no-transform keeps next start's compression from buffering the stream.
      'cache-control': 'no-store, no-transform',
      'x-ai-model': model,
    },
  });
}

/** Every refusal and failure is HTTP 200 JSON, so browsers log no console error. */
export function fallback(reason: AiFallbackReason, extra?: { retryAfterSec?: number }): Response {
  const retryAfterSec = extra?.retryAfterSec;
  return Response.json(
    retryAfterSec && retryAfterSec > 0 ? { mode: 'fallback', reason, retryAfterSec: Math.ceil(retryAfterSec) } : { mode: 'fallback', reason },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}

export type AiLogEntry = {
  feature: AiFeature;
  model?: string;
  ms: number;
  ttftMs?: number;
  usage?: AiUsage;
  reason?: AiFallbackReason;
  /** Top retrieval score. */
  top?: number;
  /** Sentences the filter dropped. */
  dropped?: number;
  /** BotID throws on this instance so far. */
  botidThrows?: number;
};

/**
 * One privacy-safe log line per request, written after the response. Only the
 * fields below are copied, so a question, job description, draft or IP can never
 * reach the log even if a caller passes a wider object.
 */
export function logAi(entry: AiLogEntry): void {
  const record: Record<string, string | number> = { ai: entry.feature, ms: Math.round(entry.ms) };
  if (entry.model) record.model = entry.model;
  if (typeof entry.ttftMs === 'number') record.ttftMs = Math.round(entry.ttftMs);
  if (entry.usage) {
    record.in = entry.usage.input;
    record.out = entry.usage.output;
    if (typeof entry.usage.thoughts === 'number') record.thoughts = entry.usage.thoughts;
  }
  if (entry.reason && REASONS.has(entry.reason)) record.reason = entry.reason;
  if (typeof entry.top === 'number' && Number.isFinite(entry.top)) record.top = Math.round(entry.top * 1000) / 1000;
  if (typeof entry.dropped === 'number') record.dropped = entry.dropped;
  if (typeof entry.botidThrows === 'number') record.botidThrows = entry.botidThrows;

  const text = `[ai] ${JSON.stringify(record)}`;
  try {
    after(() => console.info(text));
  } catch {
    // Outside a request scope (a script or a test) after() throws; log inline.
    console.info(text);
  }
}
