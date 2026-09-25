'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, Calendar, ChevronDown, MapPin } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { useSmoothScrollTo } from '@/contexts/LenisContext';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { emit } from '@/lib/events';
import { duration as DURATION, ease } from '@/lib/motion';
import { durationLabel, formatYearMonth, isoToYearMonth, toYearMonth } from '@/utils/dates';

export type Experience = {
  company: string;
  role: string;
  start: string;
  end: string | null;
  location: string;
  description?: string;
  highlights: readonly string[];
  metrics?: readonly { value: string; label: string }[];
};

type Props = {
  exp: Experience;
  /** Every skill name in profile.json; the ones named verbatim in the description become chips. */
  skills: readonly string[];
};

/* ---- the month used for open-ended durations ---- */

const BUILD_MONTH = isoToYearMonth(process.env.NEXT_PUBLIC_BUILD_TIME);
const noopSubscribe = () => () => {};
const clientMonth = () => toYearMonth(new Date());
const serverMonth = () => BUILD_MONTH;

/**
 * The current month as 'YYYY-MM'. The server and the hydration pass both use the
 * build month (inlined at build time), so the markup always matches whatever the
 * visitor's clock says; the visitor's own month takes over right after.
 */
export function useReferenceMonth(): string | null {
  return useSyncExternalStore(noopSubscribe, clientMonth, serverMonth);
}

/* ---- pure helpers ---- */

/** Program, Internship or Freelance, from the role title alone; null when it names none. */
export function kindOf(role: string): string | null {
  if (/\bintern(ship)?\b/i.test(role)) return 'Internship';
  if (/\bfreelance\b/i.test(role)) return 'Freelance';
  if (/\bprogram(me)?\b/i.test(role)) return 'Program';
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Skill names that occur verbatim in `text`, case-sensitive and on word edges
 * ('ReAct' never matches 'React', 'SQL' matches 'SQL-based'), in reading order.
 */
export function skillsInText(text: string, terms: readonly string[]): string[] {
  const hits: { term: string; at: number }[] = [];
  for (const term of new Set(terms)) {
    const m = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`).exec(text);
    if (m) hits.push({ term, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.term);
}

/* ---- pieces ---- */

function PresentBadge() {
  return (
    <span
      data-present-badge=""
      className="inline-flex items-center gap-1.5 rounded-full border border-glass-border bg-surface-tint py-0.5 pl-1.5 pr-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-success"
    >
      {/* The three dots fill only the middle ~39% x 9% of dots.json's 1341x1212 canvas, so
          the player is drawn at 58px and cropped to the dots. */}
      <span className="relative block h-2.5 w-6 shrink-0 overflow-clip">
        <LottieIcon
          name="dots"
          play="auto"
          className="absolute left-1/2 top-1/2 flex h-[52px] w-[58px] -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          fallback={<span className="block size-2 rounded-full bg-success" />}
        />
      </span>
      Present
    </span>
  );
}

function SkillChips({ terms, labelId }: { terms: string[]; labelId: string }) {
  const scrollTo = useSmoothScrollTo();
  if (terms.length === 0) return null;
  return (
    <div className="mt-5">
      <p id={labelId} className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
        Skills used<span className="sr-only"> (each opens it in the Skills section)</span>
      </p>
      <ul aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
        {terms.map((term) => (
          <li key={term} className="min-w-0 max-w-full">
            <Button
              variant="outline"
              size="sm"
              ripple={false}
              data-skill-chip={term}
              className="max-w-full [overflow-wrap:anywhere]"
              onClick={() => {
                emit('skill:focus', { name: term });
                scrollTo('skills');
              }}
            >
              {term}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One role on the timeline: an <article> named by its title, with machine-readable
 * dates, a duration, the skills it names, and an expandable description.
 */
export function TimelineCard({ exp, skills }: Props) {
  const { reduce } = useMotionPrefs();
  const now = useReferenceMonth();
  const [expanded, setExpanded] = useState(false);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const regionId = `${baseId}-details`;

  const kind = kindOf(exp.role);
  const current = exp.end === null;
  const short = durationLabel(exp.start, exp.end, now);
  const long = durationLabel(exp.start, exp.end, now, 'long');
  const terms = exp.description ? skillsInText(exp.description, skills) : [];

  return (
    <GlassCard as="article" strong spotlight aria-labelledby={titleId} data-role-card="" className="p-6 md:p-8">
      {(kind || current) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {kind && (
            <span className="inline-flex items-center gap-2 font-mono text-eyebrow uppercase text-cyan-text">
              <Briefcase aria-hidden="true" className="size-3.5 shrink-0" />
              {kind}
            </span>
          )}
          {current && <PresentBadge />}
        </div>
      )}

      <h3 id={titleId} className="mt-3 font-display text-h3 font-semibold text-balance text-text-primary">
        {exp.role}
      </h3>
      <p className="mt-1 font-medium text-violet-bright">{exp.company}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Calendar aria-hidden="true" className="size-3 shrink-0" />
          <time dateTime={exp.start}>{formatYearMonth(exp.start)}</time>
          <span aria-hidden="true">–</span>
          <span className="sr-only">to</span>
          {exp.end ? <time dateTime={exp.end}>{formatYearMonth(exp.end)}</time> : <span>Present</span>}
        </span>
        {short && (
          <span data-duration="" className="rounded-full border border-hairline bg-surface-tint px-2 py-0.5 text-text-secondary">
            <span aria-hidden="true">{short}</span>
            <span className="sr-only">{long}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <MapPin aria-hidden="true" className="size-3 shrink-0" />
          {exp.location}
        </span>
      </div>

      <ul className="mt-5 space-y-2.5">
        {exp.highlights.map((h) => (
          <li key={h} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-violet-bright" />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      <SkillChips terms={terms} labelId={`${baseId}-skills`} />

      {exp.description && (
        <>
          <motion.div
            id={regionId}
            initial={false}
            animate={expanded ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { duration: DURATION.base, ease: ease.out }}
            inert={!expanded}
            className="overflow-clip"
          >
            <p className="mt-5 border-t border-hairline pt-5 text-sm leading-relaxed text-text-muted">{exp.description}</p>
          </motion.div>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={regionId}
            onClick={() => setExpanded((v) => !v)}
            className="tap-safe ring-focus -ml-2 mt-3 gap-1.5 rounded-full px-2 font-mono text-[11px] uppercase tracking-wider text-cyan-text transition-colors hover:text-text-primary"
          >
            {expanded ? 'Less' : 'Read more'}
            <span className="sr-only"> about {exp.role}</span>
            <ChevronDown
              aria-hidden="true"
              className="size-3 transition-transform duration-300"
              style={{ transform: expanded ? 'rotate(180deg)' : undefined }}
            />
          </button>
        </>
      )}

      {exp.metrics && exp.metrics.length > 0 && (
        <ul aria-label="In numbers" className="mt-5 flex flex-wrap gap-2 border-t border-hairline pt-5">
          {exp.metrics.map((m) => (
            <li
              key={`${m.value}-${m.label}`}
              data-metric-chip=""
              className="min-w-0 max-w-full rounded-full border border-glass-border bg-surface-tint px-3 py-1 text-xs [overflow-wrap:anywhere]"
            >
              <span className="font-semibold text-text-primary">{m.value}</span>{' '}
              <span className="text-text-muted">{m.label}</span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
