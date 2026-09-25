'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Search } from 'lucide-react';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiJson } from '@/components/ai/useAiJson';
import { Button } from '@/components/ui/Button';
import { useHydrated } from '@/hooks/useHydrated';
import { targetHref } from '@/lib/ai/actions';
import type { AiTarget } from '@/lib/ai/protocol';
import { pathQuery, suggestForPath, type SuggestCatalog } from '@/lib/ai/tour';

type Hit = { id: string; label: string; target: AiTarget; score: number; cosine: number | null; bm25: number };
type RetrieveBody = { mode: 'hybrid' | 'lexical'; hits: Hit[] };

type Props = {
  catalog: SuggestCatalog;
  /** Slugs with a /projects/<slug> page; the rest open as '/?project=<slug>'. */
  caseStudySlugs: readonly string[];
};

/**
 * 'Looking for something?' on the 404 page, a small client island (the page has
 * no dock). It fuzzy-matches the requested path against project slugs and
 * section ids with no request, so '/projects/urbancare' offers
 * '/projects/urbancare-ai'. Only 'Find it' calls /api/ai/retrieve, which still
 * answers lexically with AI off; a failure leaves the offline suggestions.
 */
export function NotFoundSuggest({ catalog, caseStudySlugs }: Props) {
  const hydrated = useHydrated();
  const pathname = usePathname();
  // The page is prerendered once for every missing path, so the path is read only after hydration.
  const path = hydrated ? pathname : '';
  const suggestions = useMemo(() => (path ? suggestForPath(path, catalog) : []), [path, catalog]);
  const query = useMemo(() => pathQuery(path), [path]);
  const search = useAiJson<RetrieveBody>('/api/ai/retrieve');
  const [asked, setAsked] = useState(false);
  const spent = asked && (search.status === 'done' || search.status === 'fallback');
  const buttonRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const wasSpent = useRef(false);

  // 'Find it' runs once, so it disables itself when the search settles; the results
  // take the focus it held, or it would fall to <body>.
  useLayoutEffect(() => {
    if (spent && !wasSpent.current) {
      const active = document.activeElement;
      if (!active || active === document.body || active === buttonRef.current) resultsRef.current?.focus({ preventScroll: true });
    }
    wasSpent.current = spent;
  });

  const found = useMemo(() => {
    if (search.status !== 'done' || !search.data) return [];
    const seen = new Set(suggestions.map((s) => s.href));
    const out: { href: string; label: string }[] = [];
    for (const h of search.data.hits ?? []) {
      const href = targetHref(h.target, caseStudySlugs);
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({ href, label: h.label });
    }
    return out.slice(0, 5);
  }, [search.status, search.data, suggestions, caseStudySlugs]);

  const findIt = () => {
    if (!query || asked) return;
    setAsked(true);
    void search.run({ query, k: 5, scope: 'all' });
  };

  return (
    <section aria-labelledby="not-found-suggest-title" className="mt-8 rounded-2xl border border-hairline bg-surface-tint p-4 sm:p-6" data-not-found-suggest="">
      <h2 id="not-found-suggest-title" className="font-display text-lg font-semibold text-text-primary">
        Looking for something?
      </h2>
      <p className="mt-1 break-all text-sm text-text-muted">
        You asked for <code className="font-mono text-text-secondary" data-requested-path="">{path || '…'}</code>
      </p>

      {suggestions.length ? (
        <>
          <p className="mt-4 text-sm text-text-secondary">Did you mean</p>
          <ul className="mt-2 flex flex-col gap-1" data-suggestions="">
            {suggestions.map((s) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className="tap-safe ring-focus w-full justify-between gap-3 rounded-lg px-3 text-sm text-text-primary transition-colors hover:bg-surface-tint"
                >
                  <span className="min-w-0 truncate">
                    {s.label}
                    <span className="ml-2 font-mono text-xs text-text-muted">{s.href}</span>
                  </span>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          ref={buttonRef}
          variant="secondary"
          onClick={findIt}
          disabled={!query || spent}
          status={search.status === 'loading' ? 'loading' : 'idle'}
          loadingLabel="Searching…"
          leadingIcon={<Search aria-hidden="true" className="size-4" />}
          data-find-it=""
        >
          Find it
        </Button>
        {search.status === 'done' ? (
          <span className="text-xs text-text-muted">{search.data?.mode === 'hybrid' ? 'Matched by meaning and keywords' : 'Matched by keywords'}</span>
        ) : null}
      </div>

      <div ref={resultsRef} tabIndex={-1} aria-live="polite" className="mt-3 rounded-lg ring-focus" data-find-results="">
        {search.status === 'done' ? (
          found.length ? (
            <>
              <ul className="flex flex-col gap-1" data-found="">
                {found.map((f) => (
                  <li key={f.href}>
                    <Link
                      href={f.href}
                      className="tap-safe ring-focus w-full justify-between gap-3 rounded-lg px-3 text-sm text-text-primary transition-colors hover:bg-surface-tint"
                    >
                      <span className="min-w-0 truncate">{f.label}</span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
              <SourceBadge source="rules" className="mt-2" />
            </>
          ) : (
            <p className="text-sm text-text-muted">Nothing on this site matches that address. Try a section below.</p>
          )
        ) : search.status === 'fallback' ? (
          <p className="text-sm text-text-muted" data-find-failed="">
            Search isn&rsquo;t available right now. The sections below cover everything on the site.
          </p>
        ) : null}
      </div>
    </section>
  );
}
