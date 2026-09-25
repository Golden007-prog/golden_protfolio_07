'use client';

import { useCallback, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, useDragControls, type PanInfo } from 'framer-motion';
import { BriefcaseBusiness, Sparkles } from 'lucide-react';
import { MotionToggle } from '@/components/shared/MotionToggle';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { SocialLinks } from '@/components/ui/SocialLinks';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { openAssistant, openFit } from '@/lib/ai/bus';
import { ease } from '@/lib/motion';
import { SECTIONS, SITE, sectionHref, type SectionId } from '@/lib/site';
import { setUrlHash } from '@/lib/urlState';

export type MenuOrigin = { x: number; y: number };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Viewport centre of the burger: the iris opens from (and closes into) it. */
  origin: MenuOrigin | null;
};

/**
 * Full-screen phone menu on Dialog: focus trap, inert page (the dock included),
 * scroll lock and Escape come from Dialog. It opens as an iris from the burger,
 * the numbered links rise through masks 50ms apart, and a pull down on the
 * header dismisses it. Navbar closes it when the viewport reaches 768px.
 *
 * deferTrap keeps the whole-page restyle of inerting (and un-inerting) out of the
 * tap that opens or closes the menu; a slow phone paints the iris first.
 */
export function MobileMenu({ open, onClose, origin }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);

  // An action picked in the menu runs once Dialog has handed the page back: focus
  // restored, the page no longer inert and the scroll lock off.
  const closeThen = useCallback(
    (fn: () => void) => {
      pending.current = fn;
      onClose();
    },
    [onClose],
  );
  const onReleased = useCallback(() => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  }, []);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant="fullscreen"
      ariaLabel="Site menu"
      initialFocusRef={closeRef}
      panelClassName="bg-transparent"
      deferTrap
      onReleased={onReleased}
    >
      <MenuSheet origin={origin} onClose={onClose} closeThen={closeThen} closeRef={closeRef} />
    </Dialog>
  );
}

type SheetProps = Omit<Props, 'open'> & {
  /** Closes the menu, then runs `fn` once the page is released. */
  closeThen: (fn: () => void) => void;
  closeRef: RefObject<HTMLButtonElement | null>;
};

function MenuSheet({ origin, onClose, closeThen, closeRef }: SheetProps) {
  const pathname = usePathname();
  const router = useRouter();
  const onHome = pathname === '/';
  const active = useActiveSection();
  const { reduce } = useMotionPrefs();
  const dragControls = useDragControls();

  const at = origin ? `${Math.round(origin.x)}px ${Math.round(origin.y)}px` : 'calc(100% - 2.75rem) 2.75rem';

  const go = (e: ReactMouseEvent<HTMLAnchorElement>, id: SectionId) => {
    if (!onHome) {
      onClose();
      return;
    }
    e.preventDefault();
    closeThen(() => {
      smoothScrollTo(id);
      setUrlHash(id);
    });
  };

  const goHome = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!onHome) {
      onClose();
      return;
    }
    e.preventDefault();
    closeThen(() => {
      smoothScrollTo(0, { focus: false });
      setUrlHash(null);
      document.getElementById('main')?.focus({ preventScroll: true });
    });
  };

  // Phones have no palette button and the dock tucks away on scroll, so the menu
  // offers the assistant and the recruiter fit check itself. Both requests go
  // through the bus's pending slots, so an idle-loaded dock or a lazy fit sheet
  // still picks them up.
  const askAi = () => {
    closeThen(() => {
      openAssistant();
      if (!onHome) router.push('/');
    });
  };

  const checkFit = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!onHome) {
      openFit();
      onClose();
      return;
    }
    e.preventDefault();
    closeThen(() => {
      // A jump, not a glide: the fit sheet opens at once and its scroll lock would stop a
      // glide partway, leaving About half in view behind it.
      smoothScrollTo('about', { focus: false, immediate: true });
      setUrlHash('about');
      openFit();
    });
  };

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('a, button')) return;
    dragControls.start(e);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 600) onClose();
  };

  return (
    <motion.div
      id="mobile-menu"
      data-mobile-menu=""
      className="relative flex min-h-full flex-col bg-bg-base"
      initial={{ clipPath: `circle(0px at ${at})` }}
      animate={{ clipPath: `circle(150% at ${at})`, transition: reduce ? { duration: 0 } : { duration: 0.55, ease: ease.curtain } }}
      exit={{ clipPath: `circle(0px at ${at})`, transition: reduce ? { duration: 0 } : { duration: 0.35, ease: ease.inOut } }}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={onDragEnd}
    >
      {/* Pull the header down to dismiss (touch-none: the browser must not claim the gesture as a scroll). */}
      <div className="flex h-[4.25rem] shrink-0 touch-none items-center justify-between px-3 pt-2" onPointerDown={startDrag}>
        <Link
          href="/"
          onClick={goHome}
          aria-label={`${SITE.name}, home`}
          className="tap-safe rounded-full px-3 font-display text-sm font-bold tracking-wide text-text-primary ring-focus"
        >
          OB<span className="text-violet-bright">.</span>
        </Link>
        <span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-glass-border-strong" />
        <Button ref={closeRef} variant="icon" aria-label="Close menu" onClick={onClose} className="size-11">
          <span className="burger" data-open="">
            <span />
            <span />
            <span />
          </span>
        </Button>
      </div>

      <nav aria-label="Sections" className="flex flex-1 flex-col justify-center px-5 py-6">
        <ol className="flex flex-col gap-1">
          {SECTIONS.map(({ id, label, index }, i) => {
            const isActive = onHome && active === id;
            return (
              <li key={id}>
                <Link
                  href={sectionHref(id, pathname)}
                  onClick={(e) => go(e, id)}
                  aria-current={isActive ? 'location' : undefined}
                  className="flex min-h-14 items-center gap-4 rounded-2xl px-2 py-1 ring-focus transition-colors hover:bg-surface-tint"
                >
                  <span className="w-7 shrink-0 font-mono text-xs tabular-nums text-text-muted">{index}</span>
                  <span className="block overflow-clip pb-1">
                    <motion.span
                      className="block font-display text-[clamp(2rem,1.2rem_+_5vw,3.25rem)] font-semibold leading-[1.05] tracking-tight text-text-primary"
                      initial={{ y: '110%' }}
                      animate={{ y: 0, transition: { delay: 0.12 + i * 0.05, duration: 0.5, ease: ease.out } }}
                      exit={{ y: '110%', transition: { duration: 0.2, ease: ease.in } }}
                    >
                      {label}
                    </motion.span>
                  </span>
                  {isActive ? <span aria-hidden="true" className="ml-auto size-2 shrink-0 rounded-full bg-violet-bright" /> : null}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="flex flex-col gap-1 border-t border-hairline px-5 py-3" data-mobile-ai="">
        <button
          type="button"
          onClick={askAi}
          className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-2 text-left text-base text-text-primary ring-focus transition-colors hover:bg-surface-tint"
          data-mobile-ask=""
        >
          <Sparkles aria-hidden="true" className="size-5 shrink-0 text-cyan-text" />
          Ask AI
        </button>
        <Link
          href={sectionHref('about', pathname)}
          onClick={checkFit}
          className="flex min-h-11 w-full items-center gap-3 rounded-2xl px-2 text-base text-text-primary ring-focus transition-colors hover:bg-surface-tint"
          data-mobile-fit=""
        >
          <BriefcaseBusiness aria-hidden="true" className="size-5 shrink-0 text-cyan-text" />
          For recruiters: check job fit
        </Link>
      </div>

      <div className="flex flex-col gap-4 border-t border-hairline px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <DownloadCvButton />
          <CopyButton value={SITE.email} label="Copy email" copiedLabel="Email copied" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SocialLinks />
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle hotkey={false} showCaret={false} menuPlacement="top" />
            <MotionToggle showReduce />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
