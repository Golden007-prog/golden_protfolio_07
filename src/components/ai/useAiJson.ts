'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_CLIENT_TIMEOUT_MS } from '@/lib/ai/config';
import type { AiFallback } from '@/lib/ai/protocol';
import { isFallbackBody, toFallbackReason } from '@/lib/ai/stream';
import { fallbackFromResponse, featureOf, recordOutcome, sessionGate } from './useAiStream';

export type AiJsonStatus = 'idle' | 'loading' | 'done' | 'fallback';

export type AiJson<Res> = {
  status: AiJsonStatus;
  data: Res | null;
  fallback: AiFallback | null;
  /** Sends one request (aborting one in flight). Resolves with the data, or null on fallback or abort. */
  run: (body: unknown) => Promise<Res | null>;
  /** Cancels the request in flight and returns to idle. */
  abort: () => void;
};

type State<Res> = { status: AiJsonStatus; data: Res | null; fallback: AiFallback | null };

/**
 * POSTs to a JSON AI route. The same session circuit, soft cap and 30s timeout
 * as useAiStream; the route's fallback body (and a WAF 429) becomes status
 * 'fallback' with a reason. Never called on mount.
 */
export function useAiJson<Res>(endpoint: string): AiJson<Res> {
  const [state, setState] = useState<State<Res>>({ status: 'idle', data: null, fallback: null });
  const controller = useRef<AbortController | null>(null);
  const run = useRef(0);
  const endpointRef = useRef(endpoint);
  useEffect(() => {
    endpointRef.current = endpoint;
  });

  const cancel = useCallback((reason: string) => {
    run.current += 1;
    controller.current?.abort(reason);
    controller.current = null;
  }, []);

  useEffect(() => () => cancel('unmount'), [cancel]);

  const send = useCallback(
    async (body: unknown): Promise<Res | null> => {
      cancel('superseded');
      const id = run.current;
      const url = endpointRef.current;
      const feature = featureOf(url);
      const live = () => run.current === id;

      const gated = sessionGate(feature);
      if (gated) {
        setState({ status: 'fallback', data: null, fallback: gated });
        return null;
      }

      const ac = new AbortController();
      controller.current = ac;
      let timedOut = false;
      const timer = window.setTimeout(() => {
        timedOut = true;
        ac.abort('timeout');
      }, AI_CLIENT_TIMEOUT_MS);
      setState({ status: 'loading', data: null, fallback: null });

      const fail = (fallback: AiFallback): null => {
        if (!live()) return null;
        controller.current = null;
        setState({ status: 'fallback', data: null, fallback });
        recordOutcome(feature, { ok: false, reason: fallback.reason });
        return null;
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
          cache: 'no-store',
        });
        const type = res.headers.get('content-type') ?? '';
        if (!res.ok || !type.includes('application/json')) return fail(await fallbackFromResponse(res));
        const json: unknown = await res.json();
        if (!live()) return null;
        if (isFallbackBody(json)) return fail(json);
        // A reason this client doesn't know yet is still a fallback.
        if (json && typeof json === 'object' && (json as { mode?: unknown }).mode === 'fallback') {
          return fail({ mode: 'fallback', reason: toFallbackReason((json as { reason?: unknown }).reason) });
        }
        controller.current = null;
        setState({ status: 'done', data: json as Res, fallback: null });
        recordOutcome(feature, { ok: true });
        return json as Res;
      } catch {
        return fail({ mode: 'fallback', reason: timedOut ? 'timeout' : 'upstream' });
      } finally {
        window.clearTimeout(timer);
      }
    },
    [cancel],
  );

  const abort = useCallback(() => {
    cancel('abort');
    setState({ status: 'idle', data: null, fallback: null });
  }, [cancel]);

  return { ...state, run: send, abort };
}
