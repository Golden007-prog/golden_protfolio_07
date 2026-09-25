'use client';

import type { ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { useReferenceMonth } from '@/components/experience/TimelineCard';
import { GlassCard } from '@/components/shared/GlassCard';
import { Button } from '@/components/ui/Button';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { LocalTime } from '@/components/ui/LocalTime';
import { SocialLinks } from '@/components/ui/SocialLinks';
import profile from '@/data/profile.json';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';
import { expectedLabel } from '@/utils/dates';

// 'Data Science & Gen AI Developer | Multi-Agent Systems | ...': the first part is the title, the rest are focus areas.
const [ROLE_TITLE, ...FOCUS_AREAS] = SITE.headline.split('|').map((s) => s.trim()).filter(Boolean);
const CURRENT = profile.experience.find((e) => e.end === null) ?? null;
const DEGREE = profile.education.find((e) => e.end !== null && /master/i.test(e.degree)) ?? null;

type Props = { className?: string };

/**
 * The recruiter summary at the top of About: who, where, availability, and the
 * three actions (CV, email, profiles). Every string comes from profile.json via SITE.
 */
export function AtAGlance({ className }: Props) {
  const reference = useReferenceMonth();
  const expected = DEGREE ? expectedLabel(DEGREE.end, reference) : null;

  const facts: { term: string; detail: ReactNode }[] = [
    { term: 'Based in', detail: <LocalTime showOffset className="text-sm" /> },
    { term: 'Open to', detail: SITE.availability.openTo },
    { term: 'Focus', detail: SITE.availability.focus },
  ];
  if (CURRENT) facts.push({ term: 'Current program', detail: `${CURRENT.role} · ${CURRENT.company}` });
  if (DEGREE) facts.push({ term: 'Education', detail: expected ? `${DEGREE.degree} · ${expected}` : DEGREE.degree });

  return (
    <GlassCard
      as="section"
      strong
      aria-labelledby="about-glance-title"
      data-at-a-glance=""
      className={cn('flex h-full flex-col gap-6 p-6 md:p-8', className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
          <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
          <span className="relative size-2.5 rounded-full bg-success" />
        </span>
        <span data-currently="" className="font-mono text-[11px] font-medium uppercase tracking-[0.3em] text-success">
          Currently
        </span>
        <span className="text-sm font-medium text-text-primary">{SITE.availability.status}</span>
      </div>

      <div>
        <h3 id="about-glance-title" className="font-display text-h3 font-semibold text-balance text-text-primary">
          {ROLE_TITLE}
        </h3>
        {FOCUS_AREAS.length > 0 && (
          <ul aria-label="Specialities" className="mt-3 flex flex-wrap gap-2">
            {FOCUS_AREAS.map((area) => (
              <li
                key={area}
                className="rounded-full border border-glass-border bg-surface-tint px-3 py-1 text-xs font-medium text-text-secondary"
              >
                {area}
              </li>
            ))}
          </ul>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {facts.map(({ term, detail }) => (
          <div key={term} className="min-w-0">
            <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim">{term}</dt>
            <dd className="mt-1 text-sm text-text-primary [overflow-wrap:anywhere]">{detail}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto flex flex-wrap items-center gap-3">
        <DownloadCvButton showMeta />
        <Button href={SITE.mailtoHref} variant="secondary" cursor="open" leadingIcon={<Mail aria-hidden="true" className="size-4 shrink-0" />}>
          Email me
        </Button>
        <SocialLinks />
      </div>
    </GlassCard>
  );
}
