import type { AiFallbackReason } from './protocol.ts';
import { safeStorage } from '../safeStorage.ts';

/*
 * The per-tab AI budget. Two consecutive hard failures (quota, upstream,
 * disabled, no-key) stop every AI call for the session, so a dead key or an
 * exhausted quota costs the visitor one wait instead of one per question, and the
 * rule-based answers take over. A 20-answer soft cap keeps one tab from spending
 * the shared quota. Kept in sessionStorage, so a reload doesn't reset either.
 */

export const BLOCK_STREAK = 2;
export const SOFT_CAP = 20;
/** Quota and upstream failures may clear; the block lifts after this long. */
export const TRANSIENT_BLOCK_MS = 10 * 60_000;

const HARD: ReadonlySet<AiFallbackReason> = new Set<AiFallbackReason>(['quota', 'upstream', 'disabled', 'no-key']);
// A switched-off or keyless server stays that way until a redeploy.
const PERMANENT: ReadonlySet<AiFallbackReason> = new Set<AiFallbackReason>(['disabled', 'no-key']);

export type AiSessionSnapshot = Readonly<{
  /** Consecutive hard failures. */
  streak: number;
  /** The hard failure that set the block. */
  reason: AiFallbackReason | null;
  /** Epoch ms when the block lifts; null for the rest of the session. Only read while streak >= BLOCK_STREAK. */
  until: number | null;
  /** Answers received this session. */
  count: number;
}>;

export type AiSession = {
  recordFallback(reason: AiFallbackReason, now?: number): void;
  recordOk(now?: number): void;
  /** True while calls should not be made. */
  blocked(now?: number): boolean;
  /** Why calls are blocked, for the fallback copy. */
  blockReason(now?: number): AiFallbackReason | null;
  count(): number;
  /** Answers left before the soft cap. */
  remaining(): number;
  overSoftCap(): boolean;
  reset(): void;
  /** For useSyncExternalStore. */
  subscribe(fn: () => void): () => void;
  snapshot(): AiSessionSnapshot;
};

export const SERVER_SESSION_SNAPSHOT: AiSessionSnapshot = Object.freeze({ streak: 0, reason: null, until: null, count: 0 });

function parse(raw: string | null): AiSessionSnapshot | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<AiSessionSnapshot>;
    const streak = typeof o.streak === 'number' && o.streak >= 0 ? Math.floor(o.streak) : 0;
    const count = typeof o.count === 'number' && o.count >= 0 ? Math.floor(o.count) : 0;
    const until = typeof o.until === 'number' ? o.until : null;
    const reason = typeof o.reason === 'string' && HARD.has(o.reason as AiFallbackReason) ? (o.reason as AiFallbackReason) : null;
    return Object.freeze({ streak, reason, until, count });
  } catch {
    return null;
  }
}

export function createAiSession(opts: { storageKey?: string | null; softCap?: number } = {}): AiSession {
  const key = opts.storageKey ?? null;
  const softCap = opts.softCap ?? SOFT_CAP;
  const listeners = new Set<() => void>();
  let state: AiSessionSnapshot | null = null;

  // Read lazily: on the server and in tests there is no storage, and on the client
  // the first read happens after hydration, when a component asks.
  const read = (): AiSessionSnapshot => {
    state ??= (key ? parse(safeStorage.get(key, 'session')) : null) ?? SERVER_SESSION_SNAPSHOT;
    return state;
  };
  const write = (next: AiSessionSnapshot) => {
    state = Object.freeze(next);
    if (key) safeStorage.set(key, JSON.stringify(state), 'session');
    listeners.forEach((fn) => fn());
  };

  const isBlocked = (now: number) => {
    const s = read();
    return s.streak >= BLOCK_STREAK && (s.until === null || now < s.until);
  };

  return {
    recordFallback(reason, now = Date.now()) {
      // Other reasons (a refused question, a rate limit, a timeout) say nothing
      // about whether the service is up, so they neither count nor reset.
      if (!HARD.has(reason)) return;
      const s = read();
      const streak = s.streak + 1;
      write({
        ...s,
        streak,
        reason,
        until: PERMANENT.has(reason) ? null : now + TRANSIENT_BLOCK_MS,
      });
    },
    recordOk() {
      const s = read();
      write({ streak: 0, reason: null, until: null, count: s.count + 1 });
    },
    blocked(now = Date.now()) {
      return isBlocked(now);
    },
    blockReason(now = Date.now()) {
      return isBlocked(now) ? read().reason : null;
    },
    count: () => read().count,
    remaining: () => Math.max(0, softCap - read().count),
    overSoftCap: () => read().count >= softCap,
    reset() {
      write(SERVER_SESSION_SNAPSHOT);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: read,
  };
}

/** The one session every AI hook consults. */
export const aiSession: AiSession = createAiSession({ storageKey: 'ob-ai-session' });
