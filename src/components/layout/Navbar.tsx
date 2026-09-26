'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGroup, animate, motion, useMotionValue, useMotionValueEvent, useScroll } from 'framer-motion';
import { Search } from 'lucide-react';
import { MobileMenu, type MenuOrigin } from '@/components/layout/MobileMenu';
import { MotionToggle } from '@/components/shared/MotionToggle';
import { ThemeToggle } from '@/components/shared/ThemeToggle';
import { Button } from '@/components/ui/Button';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useActiveSection } from '@/hooks/useActiveSection';
import { matchesMedia, subscribeMedia, useMediaQuery } from '@/hooks/useMediaQuery';
import { getMotionPrefs } from '@/hooks/useMotionPrefs';
import { useRenderCount } from '@/lib/devRenderCount';
import { ease, spring } from '@/lib/motion';
import { SECTIONS, SITE, sectionHref, type SectionId } from '@/lib/site';
import { setUrlHash } from '@/lib/urlState';
import { cn } from '@/utils/cn';

/** Condensed look after this many px. */
const CONDENSE_AT = 80;
/** Downward scroll faster than this (px/s) tucks the nav away. */
const HIDE_VELOCITY = 900;
const HIDDEN_Y = -120;
const DESKTOP = '(min-width: 768px)';
/**
 * Links that join the bar only from 800px. With all seven sections the bar needs
 * about 765px, more than the 752px it may take at 768px; below 800px Certifications
 * stays one step away through search, the page itself and #certifications.
 */
const WIDE_ONLY: ReadonlySet<SectionId> = new Set(['certifications']);

const noopSubscribe = () => () => {};
function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '');
}

/** 'Ctrl K' on the server and until hydration, then the platform's own modifier. */
function KbdHint() {
  const mac = useSyncExternalStore(noopSubscribe, isMacPlatform, () => false);
  return (
    <kbd className="hidden rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[11px] font-normal text-text-muted lg:inline">
      {mac ? '⌘K' : 'Ctrl K'}
    </kbd>
  );
}

function scrollToSection(e: ReactMouseEvent<HTMLAnchorElement>, id: SectionId) {
  e.preventDefault();
  smoothScrollTo(id);
  setUrlHash(id);
}

/** The section links: their own component, so an active-section change never re-renders Navbar. */
function NavLinks({ pathname }: { pathname: string }) {
  const onHome = pathname === '/';
  const active = useActiveSection();
  const [ink, setInk] = useState<SectionId | null>(null);

  return (
    <LayoutGroup id="nav-links">
      <ul className="hidden items-center md:flex" onPointerLeave={() => setInk(null)}>
        {SECTIONS.map(({ id, label }) => {
          const isActive = onHome && active === id;
          return (
            <li key={id} className={WIDE_ONLY.has(id) ? 'max-[799.98px]:hidden' : undefined}>
              <Link
                href={sectionHref(id, pathname)}
                aria-current={isActive ? 'location' : undefined}
                onClick={onHome ? (e) => scrollToSection(e, id) : undefined}
                onPointerEnter={() => setInk(id)}
                onFocus={() => setInk(id)}
                onBlur={() => setInk(null)}
                className={cn(
                  'tap-safe-sm relative rounded-full px-2 text-[13px] font-medium ring-focus transition-colors lg:px-3.5 lg:text-sm',
                  isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {ink === id ? (
                  <motion.span layoutId="nav-ink" aria-hidden="true" className="absolute inset-0 rounded-full bg-surface-tint" transition={spring.ui} />
                ) : null}
                <span className="relative">{label}</span>
                {isActive ? (
                  <motion.span
                    layoutId="nav-active"
                    aria-hidden="true"
                    className="absolute inset-x-3 bottom-1 h-px rounded-full bg-gradient-to-r from-violet-bright to-cyan-bright"
                    transition={spring.layout}
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </LayoutGroup>
  );
}

type Props = {
  /** Opens the command palette (App owns it, so the palette code stays out of the first chunk). */
  onOpenPalette?: () => void;
};

/**
 * Floating glass nav. Scroll-driven changes (progress bar, condensing, hiding on
 * fast downward scroll) go through motion values and data attributes, so
 * scrolling never re-renders it.
 */
export function Navbar({ onOpenPalette }: Props) {
  useRenderCount('Navbar');
  const pathname = usePathname();
  const onHome = pathname === '/';
  const navRef = useRef<HTMLElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const { scrollY, scrollYProgress } = useScroll();
  const navY = useMotionValue(0);
  const shown = useRef({ scrolled: false, hidden: false, lastY: 0, menuOpen: false });

  const [menu, setMenu] = useState<{ open: boolean; origin: MenuOrigin | null }>({ open: false, origin: null });
  const isDesktop = useMediaQuery(DESKTOP);
  const menuOpen = menu.open && !isDesktop;

  useEffect(() => {
    shown.current.menuOpen = menuOpen;
  }, [menuOpen]);

  // The menu is a phone layout: reaching 768px closes it and frees the page.
  useEffect(
    () =>
      subscribeMedia(DESKTOP, () => {
        if (matchesMedia(DESKTOP)) setMenu((m) => (m.open ? { ...m, open: false } : m));
      }),
    [],
  );

  const setHidden = (hidden: boolean) => {
    const s = shown.current;
    if (s.hidden === hidden) return;
    // Under reduced motion the nav simply stays put.
    if (hidden && getMotionPrefs().reduce) return;
    s.hidden = hidden;
    navRef.current?.toggleAttribute('data-hidden', hidden);
    animate(navY, hidden ? HIDDEN_Y : 0, hidden ? { duration: 0.28, ease: ease.in } : spring.ui);
  };

  const applyScroll = (y: number) => {
    const s = shown.current;
    const scrolled = y > CONDENSE_AT;
    if (scrolled !== s.scrolled) {
      s.scrolled = scrolled;
      navRef.current?.toggleAttribute('data-scrolled', scrolled);
    }
    const delta = y - s.lastY;
    s.lastY = y;
    const hasFocus = navRef.current?.contains(document.activeElement) ?? false;
    if (y < CONDENSE_AT || s.menuOpen || hasFocus) setHidden(false);
    else if (delta > 0 && scrollY.getVelocity() > HIDE_VELOCITY) setHidden(true);
    else if (delta < -2) setHidden(false);
  };

  useMotionValueEvent(scrollY, 'change', applyScroll);

  // A reload mid-page starts condensed.
  useEffect(() => {
    const y = window.scrollY;
    shown.current.lastY = y;
    if (y > CONDENSE_AT) {
      shown.current.scrolled = true;
      navRef.current?.setAttribute('data-scrolled', '');
    }
  }, []);

  const openMenu = () => {
    const r = burgerRef.current?.getBoundingClientRect();
    setMenu({ open: true, origin: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null });
  };
  const closeMenu = () => setMenu((m) => ({ ...m, open: false }));

  const goHome = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!onHome) return;
    e.preventDefault();
    smoothScrollTo(0, { focus: false });
    setUrlHash(null);
  };

  return (
    <>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-nav h-0.5 origin-left bg-gradient-to-r from-violet via-violet-bright to-cyan-bright"
        style={{ scaleX: scrollYProgress }}
      />

      <motion.nav
        ref={navRef}
        id="site-nav"
        aria-label="Main"
        initial={false}
        style={{ y: navY }}
        onFocusCapture={() => setHidden(false)}
        className={cn(
          'glass glass-keep fixed inset-x-0 top-3 z-nav mx-auto flex w-fit max-w-[calc(100vw_-_1rem)] items-center gap-1 rounded-full p-1.5 sm:top-4 md:gap-0.5 lg:gap-1',
          'transition-[background-color,border-color,box-shadow] duration-300',
          'data-scrolled:border-glass-border-strong data-scrolled:bg-glass-fill-strong data-scrolled:shadow-[var(--app-glass-shadow-strong)]',
        )}
      >
        <Link
          href="/"
          onClick={goHome}
          aria-label={`${SITE.name}, home`}
          className="tap-safe rounded-full px-3 font-display text-sm font-bold tracking-wide text-text-primary ring-focus"
        >
          OB<span className="text-violet-bright">.</span>
        </Link>

        <NavLinks pathname={pathname} />

        {onOpenPalette ? (
          <span className="hidden md:inline-flex">
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenPalette}
              aria-label="Search the site"
              aria-keyshortcuts="Control+K Meta+K /"
              data-palette-trigger=""
              leadingIcon={<Search aria-hidden="true" className="size-4 shrink-0" />}
              className="px-2.5"
            >
              <KbdHint />
            </Button>
          </span>
        ) : null}

        {/* Resume stays in the bar at every width: 'CV' where the links leave little room. */}
        <span className="inline-flex md:hidden lg:inline-flex">
          <DownloadCvButton size="sm" label="Resume" />
        </span>
        <span className="hidden md:inline-flex lg:hidden">
          <DownloadCvButton size="sm" label="CV" />
        </span>

        <ThemeToggle />
        <span className="hidden md:inline-flex">
          <MotionToggle />
        </span>

        <Button
          ref={burgerRef}
          variant="icon"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={openMenu}
          className="size-11 md:hidden"
        >
          <span className="burger">
            <span />
            <span />
            <span />
          </span>
        </Button>
      </motion.nav>

      <MobileMenu open={menuOpen} onClose={closeMenu} origin={menu.origin} />
    </>
  );
}
