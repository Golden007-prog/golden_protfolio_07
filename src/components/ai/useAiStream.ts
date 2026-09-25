'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { track } from '@/lib/analytics';
import { aiSession } from '@/lib/ai/circuit';
import { AI_BUDGETS, AI_CLIENT_TIMEOUT_MS, type AiFeature } from '@/lib/ai/config';
import type { AiFallback, AiFallbackReason, AiFrame } from '@/lib/ai/protocol';
import {
  createNdjsonDecoder,
  initialStreamState,
  isFallbackBody,
  streamReducer,
  toFallbackReason,
  type AiStreamState,
  type AiStreamStatus,
} from '@/lib/ai/stream';

export type { AiStreamStatus } from '@/lib/ai/stream';

/** '/api/ai/jd-fit' -> 'jd-fit', when it names a known feature. */
export function featureOf(endpoint: string): AiFeature | null {
  const last = endpoint.split('?')[0]?.replace(/\/+$/, '').split('/').pop() ?? '';
  return Object.prototype.hasOwnProperty.call(AI_BUDGETS, last) ? (last as AiFeature) : null;
}

/** Features that never reach Gemini (lexical retrieval) sit outside the session budget. */
export function usesModel(feature: AiFeature | null): boolean {
  return feature === null || AI_BUDGETS[feature].tier !== 'none';
}

/**
 * Why a call may not be made right now: the session circuit is open after two
 * hard failures, or the tab has used its soft cap. null when the call may go.
 */
export function sessionGate(feature: AiFeature | null): AiFallback | null {
  if (!usesModel(feature)) return null;
  const reason = aiSession.blockReason();
  if (reason) return { mode: 'fallback', reason };
  if (aiSession.overSoftCap()) return { mode: 'fallback', reason: 'rate-limited' };
  return null;
}

/** Records one finished call against the session and reports fallbacks. */
export function recordOutcome(feature: AiFeature | null, outcome: { ok: true } | { ok: false; reason: AiFallbackReason }) {
  if (!usesModel(feature)) return;
  if (outcome.ok) {
    aiSession.recordOk();
    return;
  }
  aiSession.recordFallback(outcome.reason);
  track('ai_fallback', { feature: feature ?? 'unknown', reason: outcome.reason });
}

/** A response that is not the expected success body, mapped to a fallback. */
export async function fallbackFromResponse(res: Response): Promise<AiFallback> {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try {
      const body: unknown = await res.json();
      if (isFallbackBody(body)) return body;
      if (body && typeof body === 'object' && (body as { mode?: unknown }).mode === 'fallback') {
        return { mode: 'fallback', reason: toFallbackReason((body as { reason?: unknown }).reason) };
      }
    } catch {
      /* fall through */
    }
  }
  // Vercel's WAF answers 429 with an HTML page, not our JSON.
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'));
    return Number.isFinite(retry) && retry > 0
      ? { mode: 'fallback', reason: 'rate-limited', retryAfterSec: retry }
      : { mode: 'fallback', reason: 'rate-limited' };
  }
  return { mode: 'fallback', reason: 'upstream' };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export type AiStream = Omit<AiStreamState, 'startedAt'> & {
  status: AiStreamStatus;
  /** Sends one request. Aborts one already running. Never called on mount. */
  start: (body: unknown) => void;
  /** Aborts the request; the partial answer stays with status 'stopped'. */
  stop: () => void;
  reset: () => void;
};

/**
 * Streams an NDJSON AI route. Verified sentences are batched into one render per
 * animation frame; ttftMs and totalMs are measured from start(). Every failure
 * (the route's fallback body, a WAF 429, a network error, the 30s client timeout
 * or a body cut short) ends in status 'fallback' with a reason, so the caller can
 * show its non-AI answer. Nothing is sent while the session circuit is open.
 */
export function useAiStream(endpoint: string): AiStream {
  const [state, dispatch] = useReducer(streamReducer, initialStreamState);
  const controller = useRef<AbortController | null>(null);
  const run = useRef(0);
  const endpointRef = useRef(endpoint);
  useEffect(() => {
    endpointRef.current = endpoint;
  });

  const abortCurrent = useCallback((reason: string) => {
    run.current += 1;
    controller.current?.abort(reason);
    controller.current = null;
  }, []);

  useEffect(() => () => abortCurrent('unmount'), [abortCurrent]);

  const start = useCallback(
    (body: unknown) => {
      abortCurrent('superseded');
      const id = run.current;
      const url = endpointRef.current;
      const feature = featureOf(url);
      const live = () => run.current === id;
      dispatch({ type: 'start', at: now() });

      const gated = sessionGate(feature);
      if (gated) {
        dispatch({ type: 'fallback', fallback: gated, at: now() });
        return;
      }

      const ac = new AbortController();
      controller.current = ac;
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        ac.abort('timeout');
      }, AI_CLIENT_TIMEOUT_MS);

      // Frames wait here for the next animation frame, so a burst of sentences is one render.
      let queue: AiFrame[] = [];
      let queuedAt = 0;
      let raf = 0;
      const flush = () => {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (!queue.length || !live()) return;
        const frames = queue;
        queue = [];
        dispatch({ type: 'frames', frames, at: queuedAt });
      };
      const enqueue = (frames: AiFrame[]) => {
        if (!frames.length) return;
        if (!queue.length) queuedAt = now();
        queue.push(...frames);
        // done and error end the answer: show them at once, even in a background tab.
        if (frames.some((f) => f.type === 'done' || f.type === 'error')) flush();
        else if (!raf) raf = requestAnimationFrame(flush);
      };

      const finish = (outcome: { ok: true } | { ok: false; reason: AiFallbackReason }) => {
        window.clearTimeout(timer);
        if (controller.current === ac) controller.current = null;
        recordOutcome(feature, outcome);
      };

      const fail = (fallback: AiFallback) => {
        flush();
        if (!live()) return;
        dispatch({ type: 'fallback', fallback, at: now() });
        finish({ ok: false, reason: fallback.reason });
      };

      const read = async () => {
        let res: Response;
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: ac.signal,
            cache: 'no-store',
          });
        } catch {
          if (live()) fail({ mode: 'fallback', reason: timedOut ? 'timeout' : 'upstream' });
          return;
        }

        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.includes('ndjson') || !res.body) {
          const fb = await fallbackFromResponse(res);
          if (live()) fail(fb);
          return;
        }

        const decoder = createNdjsonDecoder();
        const reader = res.body.getReader();
        let sawDone = false;
        let errorReason: AiFallbackReason | null = null;
        const note = (frames: AiFrame[]) => {
          for (const f of frames) {
            if (f.type === 'done') sawDone = true;
            else if (f.type === 'error') errorReason ??= f.reason;
          }
          enqueue(frames);
        };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (!live()) {
              void reader.cancel().catch(() => {});
              return;
            }
            if (done) break;
            if (value) note(decoder.push(value));
            if (sawDone || errorReason) break;
          }
          note(decoder.end());
        } catch {
          if (live()) fail({ mode: 'fallback', reason: timedOut ? 'timeout' : 'upstream' });
          return;
        }
        flush();
        if (!live()) return;
        if (sawDone) finish({ ok: true });
        else if (errorReason) finish({ ok: false, reason: errorReason });
        else {
          dispatch({ type: 'end', at: now() });
          finish({ ok: false, reason: 'upstream' });
        }
        // Anything after done is noise; release the connection.
        void reader.cancel().catch(() => {});
      };
      // Every exit (stopped, superseded, unmounted, finished) clears the timeout.
      void read()
        .catch(() => {
          if (live()) fail({ mode: 'fallback', reason: 'upstream' });
        })
        .finally(() => window.clearTimeout(timer));
    },
    [abortCurrent],
  );

  const stop = useCallback(() => {
    abortCurrent('stop');
    dispatch({ type: 'stop', at: now() });
  }, [abortCurrent]);

  const reset = useCallback(() => {
    abortCurrent('reset');
    dispatch({ type: 'reset' });
  }, [abortCurrent]);

  return {
    status: state.status,
    text: state.text,
    meta: state.meta,
    done: state.done,
    tools: state.tools,
    fallback: state.fallback,
    ttftMs: state.ttftMs,
    totalMs: state.totalMs,
    start,
    stop,
    reset,
  };
}
