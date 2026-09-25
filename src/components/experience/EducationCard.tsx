'use client';

import { GraduationCap } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { cn } from '@/utils/cn';
import { expectedLabel, formatYearMonth } from '@/utils/dates';
import { useReferenceMonth } from './TimelineCard';

export type Education = {
  institution: string;
  degree: string;
  start: string;
  end: string | null;
  status: string;
};

type Props = { education: readonly Education[]; className?: string };

/**
 * The degrees, as plain facts. A degree that has not finished yet shows when it
 * is expected (from its end month) instead of its free-text status; a finished
 * one shows its status (the CGPA).
 */
export function EducationCard({ education, className }: Props) {
  const reference = useReferenceMonth();

  return (
    <GlassCard as="section" strong aria-labelledby="education-title" data-education="" className={cn('p-6 md:p-10', className)}>
      <div className="mb-6 flex items-center gap-3">
        <LottieIcon
          name="calendar"
          play="once"
          loop={false}
          className="flex size-8 shrink-0 items-center justify-center text-cyan-text"
          fallback={<GraduationCap aria-hidden="true" className="size-5" />}
        />
        <h3 id="education-title" className="font-mono text-eyebrow uppercase text-cyan-text">
          Education
        </h3>
      </div>

      <ul className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {education.map((edu) => {
          const expected = expectedLabel(edu.end, reference);
          return (
            <li key={edu.institution} className="min-w-0 border-l-2 border-violet-bright/40 pl-5">
              <p className="font-display text-lg font-semibold text-text-primary">{edu.degree}</p>
              <p className="mt-0.5 text-sm text-violet-bright">{edu.institution}</p>
              <p className="mt-2 font-mono text-xs text-text-muted">
                <time dateTime={edu.start}>{formatYearMonth(edu.start)}</time>
                <span aria-hidden="true"> – </span>
                <span className="sr-only"> to </span>
                {edu.end ? <time dateTime={edu.end}>{formatYearMonth(edu.end)}</time> : 'Present'}
              </p>
              <p data-education-status="" className="mt-2 text-sm font-medium text-cyan-text">
                {expected ?? edu.status}
              </p>
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
