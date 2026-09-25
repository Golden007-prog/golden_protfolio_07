'use client';

import dynamic from 'next/dynamic';
import { LazyMount } from '@/components/shared/LazyMount';

const renderNothing = () => null;

// next/dynamic with ssr:false has to live in a client module: inside the server
// page it is a build error. A chunk that fails to load leaves the island out.
const InlineAsk = dynamic(() => import('./InlineAsk').then((m) => m.InlineAsk, () => renderNothing), {
  ssr: false,
  loading: () => null,
});

/** Room for the heading, the starters and the question field, so the footer does not jump when it mounts. */
const RESERVED = '15rem';

/**
 * The case-study page's 'Ask about this project' (#201), loaded once the browser
 * is idle after the page, so it costs the static page nothing up front.
 */
export function InlineAskLazy({ slug }: { slug: string }) {
  return (
    <LazyMount when="idle" minHeight={RESERVED} className="border-t border-hairline pt-10">
      <InlineAsk slug={slug} />
    </LazyMount>
  );
}

export default InlineAskLazy;
