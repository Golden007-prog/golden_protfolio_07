import 'server-only';
import { checkBotId } from 'botid/server';
import type { ZodType } from 'zod';
import { AI_BUDGETS, AI_LIMITS, type AiFeature } from './config';
import { aiDailyBudget, aiMode, isFake } from './config.server';
import { isAllowedOrigin } from './origin';
import type { AiFallbackReason } from './protocol';
import { DailyBudget, TokenBuckets, costFor, evalMultiplier, ipKey } from './rateLimit';
import { fallback, logAi } from './respond.server';

/*
 * The request guard every AI route calls first. Checks run cheapest first, so a
 * refusal never touches the key or the model:
 *   1 POST  2 JSON content type  3 same origin  4 capped body read
 *   5 JSON + zod  6 kill switches  7 BotID (Vercel only)  8 per-IP token bucket
 */

// The fake model is free and every Playwright project shares the loopback
// address, so its buckets are loosened. isFake() is never true on Vercel.
const FAKE_MULTIPLIER = 100;

type GuardState = { mult: number; buckets: TokenBuckets; daily: DailyBudget; botidThrows: number };

// On globalThis so every route bundle in this process spends from the same buckets.
const STATE_KEY = Symbol.for('ob.ai.guard');
function state(): GuardState {
  const g = globalThis as { [STATE_KEY]?: GuardState };
  const mult = evalMultiplier(process.env) * (isFake() ? FAKE_MULTIPLIER : 1);
  const current = g[STATE_KEY];
  if (current && current.mult === mult) return current;
  const next: GuardState = {
    mult,
    buckets: new TokenBuckets({ capacity: 12 * mult, refillPerMin: 6 * mult }),
    daily: current?.daily ?? new DailyBudget({ limit: aiDailyBudget() }),
    botidThrows: current?.botidThrows ?? 0,
  };
  g[STATE_KEY] = next;
  return next;
}

export type GuardOk<T> = {
  ok: true;
  body: T;
  /** The rate-limit key (IPv4, or the IPv6 /64). Never log it. */
  ip: string;
  mode: 'model' | 'lexical';
};
export type GuardFail = { ok: false; res: Response };

export async function guard<T>(
  req: Request,
  feature: AiFeature,
  opts: { schema: ZodType<T>; lexicalOk?: boolean; maxBytes?: number },
): Promise<GuardOk<T> | GuardFail> {
  const started = Date.now();
  const refuse = (reason: AiFallbackReason, retryAfterSec?: number): GuardFail => {
    logAi({ feature, ms: Date.now() - started, reason });
    return { ok: false, res: fallback(reason, retryAfterSec ? { retryAfterSec } : undefined) };
  };

  // 1. Method.
  if (req.method !== 'POST') {
    return {
      ok: false,
      res: Response.json({ mode: 'fallback', reason: 'bad-request' }, { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }),
    };
  }

  // 2. JSON only. A cross-site page cannot send this without a CORS preflight, which it fails.
  const contentType = (req.headers.get('content-type') ?? '').trim().toLowerCase();
  if (!/^application\/json\s*(;|$)/.test(contentType)) return refuse('bad-request');

  // 3. Same origin.
  const onVercel = process.env.VERCEL === '1';
  const originOk = isAllowedOrigin({
    origin: req.headers.get('origin'),
    host: req.headers.get('host'),
    secFetchSite: req.headers.get('sec-fetch-site'),
    onVercel,
  });
  if (!originOk) return refuse('origin');

  // 4. Body, read with a byte cap whatever Content-Length claims.
  const maxBytes = opts.maxBytes ?? AI_LIMITS.bodyBytes;
  const raw = await readCapped(req, maxBytes);
  if (raw === 'too-long') return refuse('too-long');
  if (raw === null) return refuse('bad-request');

  // 5. JSON and the route's schema.
  let json: unknown;
  try {
    json = JSON.parse(raw.text);
  } catch {
    return refuse('bad-request');
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) {
    // Only oversized text or lists are 'too-long'; an out-of-range number is a bad request.
    const tooLong = parsed.error.issues.some((issue) => issue.code === 'too_big' && (issue.origin === 'string' || issue.origin === 'array'));
    return refuse(tooLong ? 'too-long' : 'bad-request');
  }

  // 6. Kill switches.
  const aiState = aiMode(feature);
  let mode: 'model' | 'lexical';
  if (aiState === 'model') mode = 'model';
  else if (opts.lexicalOk) mode = 'lexical';
  else return refuse(typeof aiState === 'object' ? aiState.off : 'feature-off');

  // 7. BotID, only where it can work.
  if (onVercel) {
    const verdict = await botVerdict(feature, started);
    if (verdict) return refuse(verdict);
  }

  // 8. Per-IP bucket (x-real-ip is overwritten by Vercel's edge), then the daily backstop.
  const s = state();
  const ip = ipKey(req.headers.get('x-real-ip'));
  const cost = costFor(feature, raw.bytes);
  const taken = s.buckets.take(ip, cost);
  if (!taken.ok) return refuse('rate-limited', taken.retryAfterSec);
  if (mode === 'model' && !isFake() && !s.daily.take(cost)) return refuse('quota');

  return { ok: true, body: parsed.data, ip, mode };
}

/**
 * A bot is refused. When BotID itself throws, cheap features fail open and heavy
 * ones fail closed. Only the error's name is logged, never headers or message.
 */
async function botVerdict(feature: AiFeature, started: number): Promise<AiFallbackReason | null> {
  try {
    const verdict = await checkBotId();
    return verdict.isBot ? 'bot' : null;
  } catch (err) {
    const s = state();
    s.botidThrows += 1;
    const name = err instanceof Error ? err.name : typeof err;
    console.warn(`[ai] botid threw ${name}`);
    logAi({ feature, ms: Date.now() - started, botidThrows: s.botidThrows });
    return AI_BUDGETS[feature].heavy ? 'bot' : null;
  }
}

/*
 * Past the cap nothing is kept, but a modestly oversized body is still read to its
 * end and dropped: answering with bytes unread makes the server close the socket
 * with a reset, which can destroy the 'too-long' answer before the client reads it
 * (reliably so on Windows). Anything bigger than this is cut off regardless.
 */
const DRAIN_BYTES = 64 * 1024;

async function readCapped(req: Request, maxBytes: number): Promise<{ text: string; bytes: number } | 'too-long' | null> {
  const drainTo = Math.max(DRAIN_BYTES, maxBytes * 2);
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    if (declared <= drainTo) await drain(req.body?.getReader(), drainTo);
    else void req.body?.cancel().catch(() => {});
    return 'too-long';
  }
  if (!req.body) return { text: '', bytes: 0 };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await drain(reader, drainTo - bytes);
        return 'too-long';
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), bytes };
  } catch {
    return null;
  }
}

/** Reads and discards up to `budget` more bytes, then cancels whatever is left. Never throws. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array> | undefined, budget: number): Promise<void> {
  if (!reader) return;
  try {
    while (budget > 0) {
      const { done, value } = await reader.read();
      if (done) return;
      budget -= value.byteLength;
    }
    await reader.cancel();
  } catch {
    /* the client went away */
  }
}
