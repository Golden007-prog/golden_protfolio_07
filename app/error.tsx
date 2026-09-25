'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';

type Props = { error: Error & { digest?: string }; retry: () => void };

/*
 * Every route's first load carries the root error boundary, so its designed view
 * (card, Lottie, buttons) loads only when an error actually happens. If that chunk
 * cannot load either (often the very failure being reported), the plain view
 * below stands in: it needs nothing but the stylesheet.
 */
function PlainError({ error, retry }: Props) {
  return (
    <main id="main" className="section-shell flex min-h-[80svh] items-center">
      <section aria-labelledby="error-title" className="glass-strong mx-auto w-full max-w-xl p-6 sm:p-10">
        <h1 id="error-title" tabIndex={-1} className="text-h2 text-text-primary">
          Something went wrong
        </h1>
        <p className="mt-4 max-w-[60ch] text-text-secondary">
          This part of the page failed to load. Trying again usually fixes it; if it doesn&rsquo;t, the home page is one
          click away.
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
          {/* A full load on purpose: the client router may be what broke. */}
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
  );
}

const RouteErrorView = dynamic<Props>(() => import('@/components/shared/RouteErrorView').catch(() => PlainError), {
  loading: () => null,
});

export default function RouteError(props: Props) {
  const { error } = props;
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <RouteErrorView {...props} />;
}
