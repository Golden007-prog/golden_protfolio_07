'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';

// error.json's neutral X sits on a filled disc, so it stays white in the light theme.
const ERROR_COLORS = { light: { '#E2E8F0': '#FFFFFF' } };

/** The route error screen, loaded on demand by app/error.tsx. */
export default function RouteErrorView({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The page under the keyboard user just vanished; put focus somewhere meaningful.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main id="main" className="section-shell flex min-h-[80svh] items-center">
      <GlassCard as="section" strong aria-labelledby="error-title" className="mx-auto w-full max-w-xl p-6 sm:p-10">
        <LottieIcon
          name="error"
          play="once"
          loop={false}
          colors={ERROR_COLORS}
          className="-ml-1 mb-4 flex size-16 items-center justify-center"
          fallback={<CircleAlert aria-hidden="true" className="size-10 text-danger" strokeWidth={1.5} />}
        />
        <h1 id="error-title" ref={headingRef} tabIndex={-1} className="text-h2 text-text-primary">
          Something went wrong
        </h1>
        <p className="mt-4 max-w-[60ch] text-text-secondary">
          This part of the page failed to load. Trying again usually fixes it; if it doesn&rsquo;t, the home page is one
          click away.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-xs text-text-dim">Reference: {error.digest}</p> : null}
        <div className="mt-8 flex flex-wrap gap-3">
          <Button variant="primary" size="lg" onClick={() => retry()}>
            Try again
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </GlassCard>
    </main>
  );
}
