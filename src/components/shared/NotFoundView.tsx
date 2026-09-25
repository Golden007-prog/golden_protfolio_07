'use client';

import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { NotFoundSuggest } from '@/components/ai/discovery/NotFoundSuggest';
import { Footer } from '@/components/layout/Footer';
import { SubpageHeader } from '@/components/layout/SubpageHeader';
import { Reveal } from '@/components/motion/Reveal';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import type { SuggestCatalog } from '@/lib/ai/tour';
import { SECTIONS, sectionHref } from '@/lib/site';

// Any path other than '/' makes sectionHref return '/#id'.
const NOT_HOME = '/404';

/** The 404 screen, loaded on demand by app/not-found.tsx. */
export default function NotFoundView({ catalog, caseStudySlugs }: { catalog: SuggestCatalog; caseStudySlugs: readonly string[] }) {
  return (
    <>
      <SubpageHeader />
      <main id="main" tabIndex={-1} className="section-shell flex min-h-[70svh] items-center">
        <Reveal className="mx-auto w-full max-w-2xl">
          <GlassCard as="section" strong aria-labelledby="not-found-title" className="p-6 sm:p-10">
            <LottieIcon
              name="emptySearch"
              play="once"
              loop={false}
              className="-ml-2 mb-4 flex size-24 items-center justify-center"
              fallback={<SearchX aria-hidden="true" className="size-12 text-violet-bright" strokeWidth={1.5} />}
            />
            <p className="mb-2 font-mono text-xs text-text-muted">Error 404</p>
            <h1 id="not-found-title" className="text-h2 text-text-primary">
              This page doesn&rsquo;t exist
            </h1>
            <p className="mt-4 max-w-[60ch] text-text-secondary">
              The link may be out of date, or the address may have a typo. Everything on this site lives on the home page.
            </p>
            <NotFoundSuggest catalog={catalog} caseStudySlugs={caseStudySlugs} />
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="primary" size="lg">
                <Link href="/">Back to home</Link>
              </Button>
            </div>

            <nav aria-labelledby="not-found-sections" className="mt-10 border-t border-hairline pt-6">
              <h2 id="not-found-sections" className="font-mono text-xs font-normal tracking-normal text-text-muted">
                Or jump to a section
              </h2>
              <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={sectionHref(s.id, NOT_HOME)}
                      className="tap-safe ring-focus w-full justify-start gap-3 rounded-lg px-3 text-sm text-text-secondary transition-colors hover:bg-surface-tint hover:text-text-primary"
                    >
                      <span className="font-mono text-xs text-text-dim">{s.index}</span>
                      {s.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </GlassCard>
        </Reveal>
      </main>
      <Footer />
    </>
  );
}
