'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, type PanInfo, type TargetAndTransition } from 'framer-motion';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useHydrated } from '@/hooks/useHydrated';
import { useScrollLock } from '@/hooks/useScrollLock';
import { afterNextPaint } from '@/lib/afterPaint';
import { holdDialogPresence } from '@/lib/dialogPresence';
import { duration, ease } from '@/lib/motion';
import { cn } from '@/utils/cn';

export type DialogVariant = 'modal' | 'sheet' | 'fullscreen' | 'palette';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  /** Accessible name when there is no visible title to point labelledBy at. */
  ariaLabel?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  variant?: DialogVariant;
  /** Classes for the fixed overlay root. */
  className?: string;
  /** Classes for the panel (role=dialog); merged over the variant's defaults. */
  panelClassName?: string;
  /** Shared-element id, so the panel can grow out of the element that opened it. */
  layoutId?: string;
  /**
   * Arm the focus trap, inert background and scroll lock after the opening frame
   * has painted, and release them after the closing frame has painted. Inerting
   * <body>'s children restyles the whole page (about 100 ms on a slow phone), so
   * this keeps that work out of the tap's next paint. Only for a full-screen
   * surface: its overlay catches every tap from the first frame, so the frame
   * before the trap arms leaves nothing reachable by pointer.
   */
  deferTrap?: boolean;
  /**
   * Called after a close, once focus is back on the opener and the page is
   * scrollable again (with deferTrap, a frame or so after `open` goes false).
   */
  onReleased?: () => void;
};

type Motion = { initial: TargetAndTransition; animate: TargetAndTransition; exit: TargetAndTransition };

const enter = { duration: duration.base, ease: ease.out };
const leave = { duration: 0.22, ease: ease.in };

// Transforms drop out under reduced motion (MotionConfig), leaving the opacity fades.
const MOTION: Record<DialogVariant, Motion> = {
  modal: {
    initial: { opacity: 0, scale: 0.96, y: 12 },
    animate: { opacity: 1, scale: 1, y: 0, transition: enter },
    exit: { opacity: 0, scale: 0.98, y: 8, transition: leave },
  },
  sheet: {
    initial: { opacity: 0, y: '100%' },
    animate: { opacity: 1, y: 0, transition: { ...enter, opacity: { duration: duration.quick } } },
    exit: { opacity: 0, y: '100%', transition: { ...leave, opacity: { duration: 0.2, delay: 0.1 } } },
  },
  fullscreen: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: enter },
    exit: { opacity: 0, y: 8, transition: leave },
  },
  palette: {
    initial: { opacity: 0, scale: 0.98, y: -8 },
    animate: { opacity: 1, scale: 1, y: 0, transition: { ...enter, duration: 0.28 } },
    exit: { opacity: 0, scale: 0.98, transition: { ...leave, duration: 0.16 } },
  },
};

const SCROLLER = 'overflow-y-auto overscroll-contain';

const PANEL: Record<DialogVariant, string> = {
  modal:
    'relative w-full max-w-lg rounded-2xl border border-glass-border bg-bg-surface text-text-primary shadow-[var(--app-glass-shadow-strong)] ring-focus',
  sheet: `relative flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-3xl border border-b-0 border-glass-border bg-bg-surface pb-[env(safe-area-inset-bottom)] text-text-primary shadow-[var(--app-glass-shadow-strong)] ring-focus`,
  fullscreen: `absolute inset-0 bg-bg-base text-text-primary ${SCROLLER} ring-focus`,
  palette: `relative flex max-h-[min(72dvh,40rem)] w-full max-w-xl flex-col rounded-2xl border border-glass-border-strong bg-bg-surface text-text-primary shadow-[var(--app-glass-shadow-strong)] ${SCROLLER} ring-focus`,
};

// Most recently opened first to receive Escape.
const openStack: object[] = [];

/**
 * Accessible dialog: portal, focus trap with an inert background, a Lenis-aware
 * scroll lock and Escape. A backdrop click closes it only when the press and the
 * release both land outside the panel, so a text selection dragged out of the
 * panel never dismisses it. The scroller carries data-lenis-prevent and
 * data-dialog-scroller. While open it counts in dialogPresence, which pauses the
 * hero's WebGL loop underneath.
 */
export function Dialog({
  open,
  onClose,
  children,
  labelledBy,
  describedBy,
  ariaLabel,
  initialFocusRef,
  variant = 'modal',
  className,
  panelClassName,
  layoutId,
  deferTrap = false,
  onReleased,
}: DialogProps) {
  const hydrated = useHydrated();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedOutside = useRef(false);
  const dragControls = useDragControls();
  const active = open && hydrated;
  // With deferTrap, `armed` follows `active` one painted frame later.
  const [armed, setArmed] = useState(false);
  const held = deferTrap ? armed : active;

  useFocusTrap(rootRef, held, { initialFocusRef, fallbackFocusRef: panelRef });
  useScrollLock(held);

  useEffect(() => {
    if (!deferTrap || armed === active) return;
    return afterNextPaint(() => setArmed(active));
  }, [deferTrap, active, armed]);

  useEffect(() => (active ? holdDialogPresence() : undefined), [active]);

  const onCloseRef = useRef(onClose);
  const onReleasedRef = useRef(onReleased);
  useEffect(() => {
    onCloseRef.current = onClose;
    onReleasedRef.current = onReleased;
  });

  // Every commit runs the trap's and the lock's cleanups before any effect body, so
  // by the time this sees `held` false the page is already handed back. A close
  // before a deferred trap armed releases at once.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (active) {
      wasOpen.current = true;
      return;
    }
    if (held || !wasOpen.current) return;
    wasOpen.current = false;
    onReleasedRef.current?.();
  }, [active, held]);

  useEffect(() => {
    if (!active) return;
    const token = {};
    openStack.push(token);
    // Escape is handled here, not through useHotkeys, because it must also work
    // while focus sits in the dialog's own inputs.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
      if (openStack[openStack.length - 1] !== token) return;
      e.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      openStack.splice(openStack.indexOf(token), 1);
    };
  }, [active]);

  const outsidePanel = (target: EventTarget | null) => {
    const root = rootRef.current;
    // DOM containment, not React bubbling: events from a nested dialog's portal
    // bubble through this component too.
    return target instanceof Node && !!root && root.contains(target) && !panelRef.current?.contains(target);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onCloseRef.current();
  };

  if (!hydrated) return null;

  const m = MOTION[variant];
  const isSheet = variant === 'sheet';
  const panel = (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      tabIndex={-1}
      layoutId={layoutId}
      data-lenis-prevent=""
      data-dialog-scroller={variant === 'fullscreen' || variant === 'palette' ? '' : undefined}
      className={cn(PANEL[variant], panelClassName)}
      initial={m.initial}
      animate={m.animate}
      exit={m.exit}
      drag={isSheet ? 'y' : false}
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.7 }}
      onDragEnd={isSheet ? onDragEnd : undefined}
    >
      {isSheet ? (
        <>
          <div
            aria-hidden="true"
            onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => dragControls.start(e)}
            className="flex h-11 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          >
            <span className="h-1.5 w-10 rounded-full bg-glass-border-strong" />
          </div>
          <div data-dialog-scroller="" data-lenis-prevent="" className={cn('min-h-0 flex-1', SCROLLER)}>
            {children}
          </div>
        </>
      ) : (
        children
      )}
    </motion.div>
  );

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div
          key="dialog"
          ref={rootRef}
          data-dialog-root=""
          data-variant={variant}
          className={cn('fixed inset-0 z-overlay', className)}
          onPointerDown={(e) => {
            pressedOutside.current = outsidePanel(e.target);
          }}
          onClick={(e) => {
            const close = pressedOutside.current && outsidePanel(e.target);
            pressedOutside.current = false;
            if (close) onCloseRef.current();
          }}
        >
          {variant !== 'fullscreen' ? (
            <motion.div
              aria-hidden="true"
              className="glass-keep absolute inset-0 bg-bg-base/75 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: duration.base, ease: ease.out } }}
              exit={{ opacity: 0, transition: { duration: 0.22, ease: ease.in } }}
            />
          ) : null}
          {variant === 'modal' ? (
            <div data-dialog-scroller="" data-lenis-prevent="" className={cn('relative h-full', SCROLLER)}>
              <div className="flex min-h-full items-start justify-center px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:items-center sm:p-8">
                {panel}
              </div>
            </div>
          ) : variant === 'sheet' ? (
            <div className="absolute inset-x-0 bottom-0 flex justify-center">{panel}</div>
          ) : variant === 'palette' ? (
            <div className="absolute inset-0 flex items-start justify-center px-4 pt-[12vh] sm:pt-[14vh]">{panel}</div>
          ) : (
            panel
          )}
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
