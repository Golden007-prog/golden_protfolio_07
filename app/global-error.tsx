'use client';

import { useEffect } from 'react';
import '../src/index.css';
import { SITE } from '@/lib/site';
import { fontVariables } from './fonts';

/*
 * Replaces the root layout when it (or the providers) throws, so it renders
 * its own document and depends on nothing but the stylesheet: plain elements,
 * no providers, no motion or Lottie code that might be what failed.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" data-theme="dark" className={fontVariables}>
      <body>
        <title>{`Something went wrong | ${SITE.name}`}</title>
        <main id="main" className="section-shell flex min-h-svh items-center">
          <section aria-labelledby="global-error-title" className="glass-strong mx-auto w-full max-w-xl p-6 sm:p-10">
            <p className="mb-2 font-mono text-xs text-danger">Error</p>
            <h1 id="global-error-title" className="text-h2 text-text-primary">
              Something went wrong
            </h1>
            <p className="mt-4 max-w-[60ch] text-text-secondary">
              The site hit an unexpected error while loading. Trying again usually fixes it.
            </p>
            {error.digest ? <p className="mt-2 font-mono text-xs text-text-dim">Reference: {error.digest}</p> : null}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="tap-safe ring-focus rounded-full bg-violet px-6 text-sm font-medium text-white transition-shadow hover:glow-violet"
              >
                Try again
              </button>
              {/* A full reload on purpose: the client router may be what broke. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="tap-safe ring-focus rounded-full border border-glass-border-strong px-6 text-sm font-medium text-text-primary transition-colors hover:border-violet-bright"
              >
                Back to home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
