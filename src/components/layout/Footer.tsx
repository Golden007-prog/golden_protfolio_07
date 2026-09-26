'use client';

import { useId } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUp, Rocket, Sparkles } from 'lucide-react';
import { FooterLine } from '@/components/coreforge/FooterLine';
import { Marquee } from '@/components/motion';
import { toggleReducedMotion } from '@/components/shared/MotionToggle';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { track } from '@/lib/analytics';
import { SECTIONS, SITE, sectionHref } from '@/lib/site';
import { formatIsoDate, isoYear } from '@/utils/dates';

// Inlined at build time (next.config env), so the server HTML and the hydrating
// client read the same values whatever the visitor's clock says.
const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? '';
const UPDATED = formatIsoDate(BUILD_TIME);
const YEAR = isoYear(BUILD_TIME);
const COMMIT = process.env.NEXT_PUBLIC_COMMIT ?? '';
const SHA = /^[0-9a-f]{7,40}$/i.test(COMMIT) ? COMMIT : null;

const HEADING = 'font-mono text-eyebrow uppercase text-text-dim';
const LINK =
  'ring-focus -mx-1 inline-flex min-h-9 items-center gap-2 rounded px-1 text-sm text-text-secondary transition-colors hover:text-text-primary any-pointer-coarse:min-h-11';
const NEW_TAB = <span className="sr-only"> (opens in new tab)</span>;

const ELSEWHERE = [
  { label: 'GitHub', href: SITE.links.github },
  { label: 'LinkedIn', href: SITE.links.linkedin },
  { label: 'LeetCode', href: SITE.links.leetcode },
  { label: 'Source code', href: SITE.repoUrl },
];

/** The in-page 'Reduce motion' setting; the same override the nav's motion toggle writes. */
function ReduceMotionSwitch() {
  const { reduce } = useMotionPrefs();
  const labelId = useId();

  // Off pins full motion when the OS asks for less, else follows the OS again.
  const toggle = () => toggleReducedMotion(!reduce);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={reduce}
      aria-labelledby={labelId}
      data-footer-motion-switch=""
      onClick={toggle}
      className="tap-safe ring-focus gap-3 rounded-full px-3 text-sm text-text-secondary transition-colors hover:text-text-primary"
    >
      <span id={labelId}>Reduce motion</span>
      <span aria-hidden="true" className="story-switch" data-on={reduce ? '' : undefined}>
        <span className="story-switch-thumb" />
      </span>
    </button>
  );
}

/**
 * Site footer (#site-footer): a sitemap that works from any route, contact and CV
 * links, a build stamp from the build itself (never the visitor's clock, which
 * would break hydration), a reduce-motion switch and back to top. The bottom
 * padding keeps every link clear of the floating dock.
 */
export function Footer() {
  const pathname = usePathname() ?? '/';

  const backToTop = () => {
    smoothScrollTo(0);
    document.getElementById('main')?.focus({ preventScroll: true });
  };

  return (
    <footer id="site-footer" className="story-footer relative z-30 border-t border-glass-border bg-bg-footer container-padding pt-16">
      <div className="mx-auto max-w-[1440px]">
        <div aria-hidden="true" data-footer-marquee="" className="mb-14 select-none overflow-x-clip">
          <Marquee speed={30} gap="3rem" pauseOnHover={false}>
            <span className="text-outline font-display text-[clamp(3.5rem,11vw,9rem)] font-bold leading-none tracking-[-0.03em]">
              {SITE.name}
            </span>
            <span className="size-3 shrink-0 rounded-full bg-violet-bright" />
          </Marquee>
        </div>

        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <p className="font-display text-2xl font-semibold text-text-primary">{SITE.name}</p>
            <p className="mt-2 max-w-sm text-sm text-text-muted">{SITE.headline}</p>
            <p className="mt-4 inline-flex items-center gap-2 text-sm text-text-secondary">
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
              {SITE.availability.status}
            </p>
            <FooterLine className="mt-3 max-w-sm" />
          </div>

          <nav aria-labelledby="footer-sitemap" className="lg:col-span-2">
            <h2 id="footer-sitemap" className={HEADING}>
              Sections
            </h2>
            <ul className="mt-3 flex flex-col">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={sectionHref(s.id, pathname)} className={LINK}>
                    <span aria-hidden="true" className="font-mono text-[11px] text-text-dim">
                      {s.index}
                    </span>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="lg:col-span-2">
            <h2 id="footer-elsewhere" className={HEADING}>
              Elsewhere
            </h2>
            <ul aria-labelledby="footer-elsewhere" className="mt-3 flex flex-col">
              <li>
                <Link href="/ai" prefetch={false} className={LINK} data-footer-ai-link="">
                  <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
                  How the AI works
                </Link>
              </li>
              <li>
                <Link href="/ventures/coreforge" prefetch={false} className={LINK} data-footer-venture-link="">
                  <Rocket aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
                  CoreForge, my venture
                </Link>
              </li>
              {ELSEWHERE.map((l) => (
                <li key={l.label}>
                  <a href={l.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {l.label}
                    {NEW_TAB}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-3">
            <h2 id="footer-contact" className={HEADING}>
              Get in touch
            </h2>
            <ul aria-labelledby="footer-contact" className="mt-3 flex flex-col">
              <li>
                <a href={SITE.mailtoHref} className={`${LINK} [overflow-wrap:anywhere]`}>
                  {SITE.email}
                </a>
              </li>
              <li>
                <a href={SITE.phoneHref} className={LINK}>
                  {SITE.phone}
                </a>
              </li>
              <li>
                <a href={SITE.cvPath} download={SITE.cvFileName} className={LINK} onClick={() => track('cv_download')}>
                  Download CV <span className="font-mono text-xs text-text-dim">{SITE.cvMeta}</span>
                </a>
              </li>
              <li>
                <a href={SITE.vcardPath} download className={LINK} onClick={() => track('vcard_download')}>
                  Save contact (vCard)
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-hairline pt-6 md:flex-row md:items-center md:justify-between">
          <p data-build-stamp="" className="font-mono text-xs text-text-muted">
            {YEAR ? `© ${YEAR} ` : '© '}
            {SITE.name} — Crafted with GSAP, R3F &amp; Gemini
            {UPDATED && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="whitespace-nowrap">
                  Updated <time dateTime={BUILD_TIME}>{UPDATED}</time>
                </span>
              </>
            )}
            {SHA && (
              <>
                <span aria-hidden="true"> · </span>
                <a
                  href={`${SITE.repoUrl}/commit/${SHA}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap-safe-sm ring-focus rounded underline decoration-text-dim underline-offset-4 transition-colors hover:text-text-primary"
                >
                  <span className="sr-only">Commit </span>
                  {SHA.slice(0, 7)}
                  {NEW_TAB}
                </a>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ReduceMotionSwitch />
            <button
              type="button"
              onClick={backToTop}
              className="tap-safe ring-focus gap-2 rounded-full border border-glass-border px-4 text-sm text-text-secondary transition-colors hover:border-glass-border-strong hover:text-text-primary"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
              Back to top
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
