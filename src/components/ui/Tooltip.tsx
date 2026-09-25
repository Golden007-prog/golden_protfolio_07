'use client';

import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import { ease } from '@/lib/motion';
import { useComposedRefs } from '@/components/ui/Slot';

export type TooltipProps = {
  content: ReactNode;
  /** One element that can hold a ref and focus (a button, a link, ...). */
  children: ReactElement;
  placement?: 'top' | 'bottom';
  /** Hover delay in ms. Keyboard focus opens at once. */
  delay?: number;
  /** Lets the pointer move into the tooltip (for links inside it). */
  interactive?: boolean;
  disabled?: boolean;
  maxWidth?: number;
};

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  'aria-describedby'?: string;
  onPointerEnter?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onFocus?: (e: ReactFocusEvent<HTMLElement>) => void;
  onBlur?: (e: ReactFocusEvent<HTMLElement>) => void;
};

const EDGE = 8;
const GAP = 8;
// A focus this soon after a touch or pen press came from that press, not the keyboard.
const TOUCH_FOCUS_WINDOW = 800;

function isFocusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/**
 * A description bubble for mouse hover (after `delay`) and keyboard focus, never
 * for touch. It flips above/below to fit and stays 8px inside the viewport, is
 * wired to the trigger with aria-describedby, and closes on Escape.
 */
export function Tooltip({
  content,
  children,
  placement = 'top',
  delay = 300,
  interactive = false,
  disabled = false,
  maxWidth = 240,
}: TooltipProps) {
  const hydrated = useHydrated();
  const descId = `${useId()}-tip`;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const touchedAt = useRef(0);

  const child = children as ReactElement<TriggerProps>;
  const ref = useComposedRefs<HTMLElement>(triggerRef, child.props.ref);

  const clearTimers = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };
  const show = (after: number) => {
    clearTimers();
    if (after <= 0) setOpen(true);
    else openTimer.current = window.setTimeout(() => setOpen(true), after);
  };
  const hide = (after = 0) => {
    clearTimers();
    if (after <= 0) setOpen(false);
    else closeTimer.current = window.setTimeout(() => setOpen(false), after);
  };

  useEffect(() => () => clearTimers(), []);

  // Position before paint and follow scrolling and resizing while open.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const tip = tipRef.current;
      if (!trigger || !tip) return;
      const t = trigger.getBoundingClientRect();
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const fitsAbove = t.top - GAP - h >= EDGE;
      const fitsBelow = t.bottom + GAP + h <= vh - EDGE;
      const side = placement === 'top' ? (fitsAbove || !fitsBelow ? 'top' : 'bottom') : fitsBelow || !fitsAbove ? 'bottom' : 'top';
      const top = side === 'top' ? t.top - GAP - h : t.bottom + GAP;
      const left = Math.min(Math.max(t.left + t.width / 2 - w / 2, EDGE), Math.max(EDGE, vw - w - EDGE));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(Math.max(EDGE, top))}px`;
      tip.style.transformOrigin = `${Math.round(t.left + t.width / 2 - left)}px ${side === 'top' ? '100%' : '0%'}`;
      tip.dataset.side = side;
    };
    place();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Handled here so an Escape meant for the tooltip does not also close a dialog.
      e.preventDefault();
      hide();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('keydown', onKeyDown, true);
    };
    // hide only touches refs and state setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement]);

  if (disabled) return children;

  const describedBy = [child.props['aria-describedby'], hydrated ? descId : undefined].filter(Boolean).join(' ') || undefined;

  const trigger = cloneElement(child, {
    ref,
    'aria-describedby': describedBy,
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      child.props.onPointerEnter?.(e);
      if (e.pointerType === 'mouse') show(delay);
    },
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => {
      child.props.onPointerLeave?.(e);
      if (e.pointerType === 'mouse') hide(interactive ? 120 : 0);
    },
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      child.props.onPointerDown?.(e);
      if (e.pointerType !== 'mouse') touchedAt.current = Date.now();
      hide();
    },
    onFocus: (e: ReactFocusEvent<HTMLElement>) => {
      child.props.onFocus?.(e);
      if (Date.now() - touchedAt.current < TOUCH_FOCUS_WINDOW) return;
      if (isFocusVisible(e.currentTarget)) show(0);
    },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => {
      child.props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {hydrated
        ? createPortal(
            <>
              <span id={descId} hidden>
                {content}
              </span>
              <AnimatePresence>
                {open ? (
                  <motion.div
                    ref={tipRef}
                    role="tooltip"
                    aria-hidden={interactive ? undefined : true}
                    data-tooltip=""
                    className={`glass-strong glass-keep fixed left-0 top-0 z-toast w-max px-3 py-2 text-[13px] leading-snug text-text-secondary ${
                      interactive ? '' : 'pointer-events-none'
                    }`}
                    style={{ maxWidth: `min(${maxWidth}px, calc(100vw - ${EDGE * 2}px))`, borderRadius: '0.75rem' }}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1, transition: { duration: 0.12, ease: ease.out } }}
                    exit={{ opacity: 0, transition: { duration: 0.08, ease: ease.in } }}
                    onPointerEnter={interactive ? () => clearTimers() : undefined}
                    onPointerLeave={interactive ? () => hide() : undefined}
                  >
                    {content}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
