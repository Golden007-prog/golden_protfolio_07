/*
 * Pure model policy: thinking level per model, which HTTP failures earn a second
 * model, whether time remains for one, and how long a 429 cools a model down.
 */

export type ThinkingLevelName = 'MINIMAL' | 'LOW';

/** Flash-Lite runs at MINIMAL. Every other model gets LOW: MINIMAL is an error on Flash. */
export function thinkingFor(model: string): ThinkingLevelName {
  return /flash-lite/i.test(model) ? 'MINIMAL' : 'LOW';
}

/** 429 (quota) and 503 (overloaded) may be retried on the other model; nothing else is. */
export function classifyStatus(status: number): 'next' | 'upstream' {
  return status === 429 || status === 503 ? 'next' : 'upstream';
}

/** A second attempt needs this much of the shared deadline left to be worth starting. */
export const MIN_NEXT_ATTEMPT_MS = 8000;

/** Time the next attempt may use, or null when too little of the deadline remains. */
export function nextAttemptBudget(remainingMs: number, featureTimeoutMs: number): number | null {
  if (!Number.isFinite(remainingMs) || remainingMs < MIN_NEXT_ATTEMPT_MS) return null;
  return Math.min(remainingMs, featureTimeoutMs);
}

export const DEFAULT_RETRY_DELAY_MS = 60000;
const MAX_RETRY_DELAY_MS = 15 * 60000;

/**
 * Cooldown after a 429, from Google's RetryInfo ('37s', '1.5s' or {seconds, nanos}).
 * Accepts the bare duration, the error body object, or its JSON string (the SDK's
 * ApiError message). Anything unparseable gives the 60s default.
 */
export function retryDelayMs(errorBody: unknown): number {
  const ms = parseDelay(errorBody);
  if (ms === null || ms <= 0) return DEFAULT_RETRY_DELAY_MS;
  return Math.min(Math.ceil(ms), MAX_RETRY_DELAY_MS);
}

function parseDelay(body: unknown): number | null {
  if (typeof body === 'string') {
    const bare = /^\s*(\d+(?:\.\d+)?)s\s*$/.exec(body);
    if (bare) return Number(bare[1]) * 1000;
    const quoted = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
    if (quoted) return Number(quoted[1]) * 1000;
    const nested = /"retryDelay"\s*:\s*\{[^}]*"seconds"\s*:\s*"?(\d+)"?/.exec(body);
    if (nested) return Number(nested[1]) * 1000;
    return null;
  }
  if (body && typeof body === 'object') {
    const found = findRetryDelay(body, 0);
    if (typeof found === 'string') return parseDelay(found);
    if (found && typeof found === 'object') {
      const seconds = Number((found as { seconds?: unknown }).seconds ?? 0);
      const nanos = Number((found as { nanos?: unknown }).nanos ?? 0);
      const total = seconds * 1000 + nanos / 1e6;
      return Number.isFinite(total) ? total : null;
    }
    // An Error (such as ApiError) carries the body in its message.
    if (body instanceof Error) return parseDelay(body.message);
  }
  return null;
}

function findRetryDelay(node: unknown, depth: number): unknown {
  if (depth > 6 || !node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findRetryDelay(item, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if ('retryDelay' in record) return record.retryDelay;
  for (const value of Object.values(record)) {
    const hit = findRetryDelay(value, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
