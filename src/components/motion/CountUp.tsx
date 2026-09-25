'use client';

import { useEffect, useMemo, useRef } from 'react';
import { getMotionPrefs, subscribeMotionPrefs } from '../../hooks/useMotionPrefs';
import { useRenderCount } from '../../lib/devRenderCount';
import { cn } from '../../utils/cn';

export type CountUpProps = {
  value: number;
  from?: number;
  /** Seconds. */
  duration?: number;
  prefix?: string;
  suffix?: string;
  format?: Intl.NumberFormatOptions;
  /** Rolling digit columns instead of a counting number. */
  odometer?: boolean;
  className?: string;
};

// Fixed so the server and every browser print the same string.
const LOCALE = 'en-US';
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const COLUMN_STAGGER = 0.06;

function decimalsOf(n: number): number {
  const s = String(n);
  const dot = s.indexOf('.');
  return dot === -1 || s.includes('e') ? 0 : s.length - dot - 1;
}

function easeOutExpo(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/**
 * A number that counts up when it scrolls into view. The server HTML and the
 * sr-only copy always hold the final value; the animation writes textContent (or
 * column transforms) directly, so the component commits exactly once. Motion
 * preferences are read outside React for the same reason.
 */
export function CountUp({
  value,
  from = 0,
  duration = 1.6,
  prefix = '',
  suffix = '',
  format,
  odometer = false,
  className,
}: CountUpProps) {
  useRenderCount('CountUp');
  const ref = useRef<HTMLSpanElement>(null);
  const formatKey = JSON.stringify(format ?? null);

  // format is compared by value, so an inline options object does not rebuild the formatter.
  const fmt = useMemo(() => {
    const decimals = decimalsOf(value);
    const opts: Intl.NumberFormatOptions = (JSON.parse(formatKey) as Intl.NumberFormatOptions | null) ?? {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    };
    const nf = new Intl.NumberFormat(LOCALE, opts);
    return (n: number) => `${prefix}${nf.format(n)}${suffix}`;
  }, [value, prefix, suffix, formatKey]);

  const finalText = fmt(value);

  useEffect(() => {
    const root = ref.current;
    if (!root || from === value || typeof IntersectionObserver === 'undefined') return;
    const columns = odometer ? Array.from(root.querySelectorAll<HTMLElement>('[data-odo-col]')) : [];
    const finalDigits = columns.map((col) => Number(col.dataset.odoCol));
    const fromDigits = (() => {
      const raw = fmt(from).replace(/\D/g, '').slice(-columns.length);
      return raw.padStart(columns.length, '0').split('').map(Number);
    })();

    let raf = 0;
    let prepared = false;
    let done = false;

    const placeColumns = (digits: number[], transition: boolean) => {
      columns.forEach((col, i) => {
        col.style.transition = transition
          ? `transform ${duration}s var(--ease-out-expo) ${(columns.length - 1 - i) * COLUMN_STAGGER}s`
          : 'none';
        col.style.transform = `translateY(${-digits[i] * 10}%)`;
      });
    };
    const prepare = () => {
      prepared = true;
      if (odometer) placeColumns(fromDigits, false);
      else root.textContent = fmt(from);
    };
    const settle = () => {
      done = true;
      cancelAnimationFrame(raf);
      if (odometer) placeColumns(finalDigits, false);
      else root.textContent = finalText;
    };
    const run = () => {
      if (!prepared) prepare();
      if (odometer) {
        // Two frames so the start position is painted before the transition begins.
        raf = requestAnimationFrame(() => {
          raf = requestAnimationFrame(() => {
            done = true;
            placeColumns(finalDigits, true);
          });
        });
        return;
      }
      const start = performance.now();
      const total = duration * 1000;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / total);
        if (t >= 1) {
          settle();
          return;
        }
        root.textContent = fmt(from + (value - from) * easeOutExpo(t));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    if (getMotionPrefs().reduce) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry || done) return;
        if (getMotionPrefs().reduce) {
          if (prepared) settle();
          io.disconnect();
          return;
        }
        if (entry.isIntersecting) {
          io.disconnect();
          run();
        } else if (!prepared) {
          // Offscreen, so resetting to the start value is invisible.
          prepare();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(root);
    const unsubscribe = subscribeMotionPrefs(() => {
      if (getMotionPrefs().reduce && prepared && !done) {
        io.disconnect();
        settle();
      }
    });

    return () => {
      io.disconnect();
      unsubscribe();
      cancelAnimationFrame(raf);
      if (prepared) {
        if (odometer) placeColumns(finalDigits, false);
        else root.textContent = finalText;
      }
    };
  }, [value, from, duration, odometer, fmt, finalText]);

  return (
    <span className={cn('tabular-nums', className)}>
      <span className="sr-only">{finalText}</span>
      {odometer ? (
        <span ref={ref} aria-hidden="true" className="inline-flex leading-[1.1]">
          {Array.from(finalText).map((ch, i) =>
            /\d/.test(ch) ? (
              <span key={i} className="relative inline-block h-[1.1em] overflow-clip align-bottom">
                <span
                  data-odo-col={ch}
                  className="block"
                  style={{ transform: `translateY(${-Number(ch) * 10}%)` }}
                >
                  {DIGITS.map((d) => (
                    <span key={d} className="block h-[1.1em]">
                      {d}
                    </span>
                  ))}
                </span>
              </span>
            ) : (
              <span key={i} className="whitespace-pre">
                {ch}
              </span>
            ),
          )}
        </span>
      ) : (
        <span ref={ref} aria-hidden="true">
          {finalText}
        </span>
      )}
    </span>
  );
}
