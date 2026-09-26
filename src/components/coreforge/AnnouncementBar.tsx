'use client';

import { useState, useSyncExternalStore, type FocusEvent } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, X } from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import { duration, ease } from '@/lib/motion';
import { safeStorage } from '@/lib/safeStorage';
import { ANNOUNCEMENT, CTA } from '@/lib/coreforge/section-copy';
import { useCoreforgeLink } from '@/lib/coreforge/track';
import { cn } from '@/utils/cn';

/** Bump the suffix to show a new announcement to people who dismissed this one. */
export const ANNOUNCEMENT_STORAGE_KEY = 'cf-announce-v1';

/** The venture page is already all CoreForge, so the bar stays off there. */
export const ANNOUNCEMENT_HIDDEN_PATHS: readonly string[] = ['/ventures/coreforge'];

/** The floating strip steps aside once the page scrolls past this many pixels. */
const SCROLL_HIDE_PX = 160;

// ---------- dismissal store: one key, shared by every mounted bar and every tab ----------

const dismissListeners = new Set<() => void>();

function subscribeDismissed(fn: () => void): () => void {
  dismissListeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === ANNOUNCEMENT_STORAGE_KEY) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    dismissListeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

const readDismissed = () => safeStorage.get(ANNOUNCEMENT_STORAGE_KEY) === '1';

function dismiss() {
  safeStorage.set(ANNOUNCEMENT_STORAGE_KEY, '1');
  dismissListeners.forEach((fn) => fn());
}

// ---------- near-top store for the floating variant ----------

function subscribeScroll(fn: () => void): () => void {
  window.addEventListener('scroll', fn, { passive: true });
  return () => window.removeEventListener('scroll', fn);
}

const readNearTop = () => window.scrollY < SCROLL_HIDE_PX;

type Props = {
  /**
   * 'floating' (default): a fixed strip docked just under the floating navbar, shown
   * near the top of the page only (or while it holds focus), so it never shifts layout.
   * It renders from the sm breakpoint up; phones get nothing unless the layout also
   * mounts the 'bar' variant (e.g. inside an sm:hidden wrapper). 'bar': a full-width strip
   * in normal flow, for a layout that reserves the top of the page for it.
   */
  variant?: 'floating' | 'bar';
  className?: string;
};

/**
 * 'From my startup: CoreForge — free dMAT practice for German Master’s applicants ·
 * Unofficial dMAT practice tool · Try 10 free questions'. Dismissal persists (safeStorage) across visits and tabs. The server
 * renders the in-flow bar (so it never pops in), and the client removes it for anyone
 * who dismissed it; the floating strip only appears after hydration since it is fixed.
 * Enter and exit are opacity plus 8px of travel, which MotionConfig reduces to opacity.
 */
export function AnnouncementBar({ variant = 'floating', className }: Props) {
  const pathname = usePathname();
  const hydrated = useHydrated();
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => false);
  const nearTop = useSyncExternalStore(subscribeScroll, readNearTop, () => true);
  const link = useCoreforgeLink(CTA.demo.path, `announcement-${variant}`);
  // While focus is inside the floating strip it stays mounted even past SCROLL_HIDE_PX,
  // so a keyboard or screen-reader user never has the focused control pulled away.
  const [hasFocus, setHasFocus] = useState(false);

  const hiddenHere = ANNOUNCEMENT_HIDDEN_PATHS.some((p) => pathname === p || pathname?.startsWith(`${p}/`));
  const show =
    !hiddenHere && !dismissed && (variant === 'bar' || (hydrated && (nearTop || hasFocus)));

  const onFocusIn = () => setHasFocus(true);
  const onFocusOut = (e: FocusEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHasFocus(false);
  };

  const onDismiss = () => {
    dismiss();
    // The button is about to unmount; hand focus to the page rather than to <body>.
    document.getElementById('main')?.focus({ preventScroll: true });
  };

  const content = (
    <>
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug">
        <span className="inline-flex items-center gap-2 font-semibold text-(--cf-berry-text)">
          <span aria-hidden="true" className="cf-pulse-dot" />
          {ANNOUNCEMENT.lead}
        </span>
        <span className="text-text-secondary">{ANNOUNCEMENT.body}</span>
        <span className="text-xs text-text-muted">
          <span aria-hidden="true">· </span>
          {ANNOUNCEMENT.disclaimer}
        </span>
        <span aria-hidden="true" className="hidden text-text-dim sm:inline">
          ·
        </span>
        <a
          {...link}
          data-cursor="open"
          className="inline-flex min-h-11 items-center gap-1 rounded-sm font-semibold text-text-primary underline decoration-(--cf-berry-border) underline-offset-4 ring-focus hover:decoration-current"
        >
          {ANNOUNCEMENT.cta}
          <ArrowUpRight aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={ANNOUNCEMENT.dismissLabel}
        data-cf-dismiss=""
        className="tap-safe grid shrink-0 place-items-center rounded-full text-text-muted ring-focus transition-colors hover:bg-surface-tint hover:text-text-primary"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </>
  );

  if (variant === 'bar') {
    if (!show) return null;
    return (
      <aside
        aria-label="Announcement"
        data-cf-announcement="bar"
        className={cn('cf-announce-bar relative z-30 w-full', className)}
      >
        <div className="container-padding mx-auto flex max-w-[1440px] items-center gap-2 py-1">{content}</div>
      </aside>
    );
  }

  return (
    <AnimatePresence>
      {show ? (
        <motion.aside
          key="cf-announcement"
          aria-label="Announcement"
          data-cf-announcement="floating"
          onFocus={onFocusIn}
          onBlur={onFocusOut}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } }}
          exit={{ opacity: 0, y: -8, transition: { duration: duration.quick, ease: ease.in } }}
          className={cn(
            // Hidden below sm: wrapped to three lines it would cover the hero on a phone.
            // Mount the in-flow 'bar' variant for small screens instead.
            'cf-announce fixed inset-x-0 top-20 z-dock mx-auto hidden w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full py-1 pr-1 pl-4 backdrop-blur-md sm:flex',
            className,
          )}
        >
          {content}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

export default AnnouncementBar;
