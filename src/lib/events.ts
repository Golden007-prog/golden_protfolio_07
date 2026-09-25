import { useEffect, useRef } from 'react';
import type { AskOpenRequest, FitOpenRequest } from './ai/protocol';

export type AppEvents = {
  'project:open': { slug: string };
  'skill:open': { name: string };
  'skill:focus': { name: string };
  'contact:prefill': { message?: string; subject?: string };
  'contact:status': { status: 'idle' | 'typing' | 'sending' | 'success' | 'error' };
  /** Consumed only by AskMeBot (via the bus.ts pending slot). */
  'ask:open': AskOpenRequest;
  /** Consumed only by FitCheckTrigger (via the bus.ts pending slot). */
  'fit:open': FitOpenRequest;
};

const PREFIX = 'ob:';

/** Fires a typed app event on window. Safe to call on the server (no-op). */
export function emit<K extends keyof AppEvents>(type: K, detail: AppEvents[K]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREFIX + type, { detail }));
}

/** Listens for a typed app event for the life of the component. The handler may change freely. */
export function useAppEvent<K extends keyof AppEvents>(type: K, handler: (d: AppEvents[K]) => void): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    const listener = (e: Event) => handlerRef.current((e as CustomEvent<AppEvents[K]>).detail);
    window.addEventListener(PREFIX + type, listener);
    return () => window.removeEventListener(PREFIX + type, listener);
  }, [type]);
}
