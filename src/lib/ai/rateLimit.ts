import { AI_BUDGETS, type AiFeature } from './config.ts';

/*
 * Best-effort, per-instance abuse limits. Every Fluid instance keeps its own
 * buckets and a deploy resets them, so these only blunt a single noisy client.
 * Nothing in the code holds across instances: that takes the per-model quotas on a
 * dedicated Google key and a Vercel WAF rate-limit rule on /api/ai, both set up by
 * hand outside the repository (README, "Before going live"). Neither is guaranteed
 * to exist.
 */

/** Bucket key for a client address: IPv4 whole, IPv6 cut to its /64 (one host controls a whole /64). */
export function ipKey(ip: string | null | undefined): string {
  let raw = (ip ?? '').split(',')[0].trim().toLowerCase();
  if (!raw) return 'unknown';
  if (raw.startsWith('[')) raw = raw.slice(1, raw.indexOf(']') === -1 ? undefined : raw.indexOf(']'));
  raw = raw.replace(/%.*$/, '');

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is the IPv4 client.
  const mapped = /^[0:]*:ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw;
  if (!raw.includes(':')) return 'unknown';

  const groups = expandIpv6(raw);
  if (!groups) return 'unknown';
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(addr: string): string[] | null {
  let text = addr;
  // An embedded IPv4 tail occupies the last two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, v4.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

type Bucket = { tokens: number; at: number };

export type TakeResult = { ok: boolean; retryAfterSec: number };

/** Token bucket per key: `capacity` burst, refilled at `refillPerMin`, LRU-capped at `maxKeys`. */
export class TokenBuckets {
  readonly capacity: number;
  readonly refillPerMin: number;
  readonly maxKeys: number;
  private readonly buckets = new Map<string, Bucket>();

  constructor({ capacity = 12, refillPerMin = 6, maxKeys = 5000 }: { capacity?: number; refillPerMin?: number; maxKeys?: number } = {}) {
    this.capacity = capacity;
    this.refillPerMin = refillPerMin;
    this.maxKeys = maxKeys;
  }

  take(key: string, cost: number, now: number = Date.now()): TakeResult {
    // A request dearer than a full bucket still gets through once the bucket is full.
    const price = Math.min(Math.max(cost, 0), this.capacity);
    const prev = this.buckets.get(key);
    const elapsedMin = prev ? Math.max(0, now - prev.at) / 60000 : 0;
    const tokens = prev ? Math.min(this.capacity, prev.tokens + elapsedMin * this.refillPerMin) : this.capacity;

    this.buckets.delete(key);
    if (tokens >= price) {
      this.buckets.set(key, { tokens: tokens - price, at: now });
      this.evict();
      return { ok: true, retryAfterSec: 0 };
    }
    this.buckets.set(key, { tokens, at: now });
    this.evict();
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(((price - tokens) / this.refillPerMin) * 60)) };
  }

  get size(): number {
    return this.buckets.size;
  }

  private evict() {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}

/** Base cost plus one token per full 4 KB of request body. */
export function costFor(feature: AiFeature, bytes: number): number {
  return AI_BUDGETS[feature].baseCost + Math.floor(Math.max(0, bytes) / 4096);
}

/** A per-instance ceiling on cost units per UTC day, backing up the per-IP buckets. */
export class DailyBudget {
  readonly limit: number;
  private day = '';
  private spent = 0;

  constructor({ limit = 2000 }: { limit?: number } = {}) {
    this.limit = limit;
  }

  take(cost: number, now: number = Date.now()): boolean {
    const day = new Date(now).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.spent = 0;
    }
    if (this.spent + cost > this.limit) return false;
    this.spent += cost;
    return true;
  }
}

/** The local eval run may spend 5x the bucket. Ignored on Vercel. */
export function evalMultiplier(env: Record<string, string | undefined>): number {
  return env.AI_EVAL === '1' && env.VERCEL !== '1' ? 5 : 1;
}
