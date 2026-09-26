'use client';

import { ArrowDown, BadgeCheck } from 'lucide-react';
import { COUNTS } from './data';

/**
 * The About card's credentials fact: the verified count, linking down to the
 * section. Its own chunk (AtAGlance loads it with next/dynamic), so the
 * credentials data stays out of the first-load bundle and is shared with the
 * section's chunk. A plain fragment link: LenisContext glides it and sets the hash.
 */
export function CertificationsFact() {
  return (
    <a
      href="#certifications"
      data-glance-certifications=""
      className="group/cert ring-focus -my-3 inline-flex min-h-11 items-center gap-1.5 rounded-full text-sm font-medium text-text-primary transition-colors hover:text-violet-bright"
    >
      <BadgeCheck aria-hidden="true" className="size-4 shrink-0 text-cyan-text" />
      <span className="underline decoration-glass-border-strong decoration-1 underline-offset-4 group-hover/cert:decoration-current">
        {COUNTS.total} verified credentials
      </span>
      <ArrowDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted transition-transform duration-200 group-hover/cert:translate-y-0.5" />
    </a>
  );
}
