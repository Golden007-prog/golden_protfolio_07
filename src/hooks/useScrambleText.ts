'use client';

import { useEffect, type RefObject } from 'react';
import { runScramble } from './scramble';
import { useMotionPrefs } from './useMotionPrefs';

const DEFAULT_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=<>/';

type Options = {
  /** Milliseconds for the full decode. Default 700. */
  duration?: number;
  /** When false the final text is written without a decode. Default true. */
  trigger?: boolean;
  charset?: string;
};

/**
 * Decodes `text` into ref.current.textContent left to right in rAF, without React
 * state, so the owning component never re-renders per frame. Paused or reduced
 * motion writes the final text straight away.
 */
export function useScrambleText(ref: RefObject<HTMLElement | null>, text: string, opts: Options = {}): void {
  const { duration = 700, trigger = true, charset = DEFAULT_CHARSET } = opts;
  const { paused } = useMotionPrefs();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (paused || !trigger || duration <= 0 || !charset) {
      el.textContent = text;
      return;
    }
    const stop = runScramble(
      (frame) => {
        el.textContent = frame;
      },
      text,
      duration,
      charset,
    );
    return () => {
      stop();
      el.textContent = text;
    };
  }, [ref, text, duration, trigger, charset, paused]);
}
