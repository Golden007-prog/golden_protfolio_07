'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Briefcase, Calendar, ChevronDown, ExternalLink, MapPin, MessageCircle } from 'lucide-react';
import { CoreforgeButton } from '@/components/coreforge/CoreforgeLink';
import { ExperienceHighlight } from '@/components/coreforge/ExperienceHighlight';
import { FounderBadge } from '@/components/coreforge/FounderBadge';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { useSmoothScrollTo } from '@/contexts/LenisContext';
import profile from '@/data/profile.json';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { openAssistant } from '@/lib/ai/bus';
import { isCoreforgeUrl } from '@/lib/coreforge/links';
import { emit } from '@/lib/events';
import { duration as DURATION, ease } from '@/lib/motion';
import { durationLabel, formatYearMonth, isoToYearMonth, toYearMonth } from '@/utils/dates';

export type Experience = {
  company: string;
  role: string;
  start: string;
  end: string | null;
  /** '' when the source gives none; the row is then left out. */
  location: string;
  description?: string;
  highlights: readonly string[];
  metrics?: readonly { value: string; label: string }[];
  /** Grouped under 'Earlier work' on the timeline. */
  earlier?: boolean;
  /** The venture's own site. */
  url?: string;
};

/** 'goldensdmat.in' from 'https://goldensdmat.in/...'; '' for anything unparsable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

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

/** The role's place in profile.experience: the [data-exp-index] anchor and the assistant's scope. */
export function experienceIndex(exp: Pick<Experience, 'company' | 'start'>): number {
  return profile.experience.findIndex((e) => e.company === exp.company && e.start === exp.start);
}

/**
 * Three starter questions per role, built from its own fields. They are
 * questions, not claims, so nothing here needs review; the answers come from
 * the assistant scoped to this entry alone.
 */
export function roleStarters(exp: Pick<Experience, 'company' | 'metrics'>): string[] {
  const org = exp.company.split('@')[0].replace(/\s+(?:Private Limited|Pvt\.? Ltd\.?|Limited|Ltd\.?)$/i, '').trim();
  const metric = exp.metrics?.[0];
  return [
    `What did he work on at ${org}?`,
    `Which tools and frameworks did he use at ${org}?`,
    metric ? `What is behind "${metric.value} ${metric.label}" at ${org}?` : `What came out of his time at ${org}?`,
  ];
}

/* ---- pieces ---- */

const STARTER =
  'tap-safe w-full justify-start rounded-2xl px-3 py-2 text-left text-sm leading-snug text-text-secondary ring-focus transition-colors hover:bg-surface-tint hover:text-text-primary';

/** 'Ask about this role': three starters that open the assistant scoped to this entry, plus 'your own question'. */
function AskAboutRole({ index, exp }: { index: number; exp: Experience }) {
  const [open, setOpen] = useState(false);
  const starters = roleStarters(exp);
  return (
    <div data-ask-role={index} className="mt-5 border-t border-hairline pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-ask-role-toggle=""
        className="tap-safe ring-focus -ml-2 gap-2 rounded-full px-2 text-sm font-medium text-cyan-text transition-colors hover:text-text-primary"
      >
        <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
        Ask about this role
        <span className="sr-only">: {exp.role}</span>
        <ChevronDown aria-hidden="true" className={`size-3.5 shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <ul aria-label={`Questions about ${exp.role}`} className="mt-2 flex flex-col gap-1">
          {starters.map((question) => (
            <li key={question}>
              <button type="button" data-ask-role-starter="" className={STARTER} onClick={() => openAssistant({ scope: { experience: index }, question, send: true })}>
                {question}
              </button>
            </li>
          ))}
          <li>
            <button type="button" data-ask-role-own="" className={`${STARTER} text-cyan-text`} onClick={() => openAssistant({ scope: { experience: index } })}>
              Ask your own question…
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

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
  const index = experienceIndex(exp);
  const site = exp.url && hostOf(exp.url) ? { href: exp.url, host: hostOf(exp.url) } : null;
  // His own venture: the role keeps its LinkedIn title ('Owner'); the badge and the
  // product capture sit around it, and its site link carries CoreForge's UTM tags.
  const venture = site ? isCoreforgeUrl(site.href) : false;

  return (
    <GlassCard
      as="article"
      strong
      spotlight
      aria-labelledby={titleId}
      data-role-card=""
      data-exp-index={index >= 0 ? index : undefined}
      className="p-6 md:p-8"
    >
      {(kind || current) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {kind && (
            <span className="inline-flex items-center gap-2 font-mono text-eyebrow uppercase text-cyan-text">
              <Briefcase aria-hidden="true" className="size-3.5 shrink-0" />
              {kind}
            </span>
          )}
          {current && <PresentBadge />}
          {venture && <FounderBadge variant="nav" placement="experience-badge" />}
        </div>
      )}

      <h3 id={titleId} className="mt-3 font-display text-h3 font-semibold text-balance text-text-primary">
        {exp.role}
      </h3>
      <p className="mt-1 font-medium text-violet-bright">{exp.company}</p>
      {site && venture ? (
        <CoreforgeButton
          path={site.href}
          placement="experience-site"
          data={{ 'data-role-site': '' }}
          variant="ghost"
          size="sm"
          arrow={false}
          aria-label={`${site.host}, ${exp.company}'s site`}
          className="-ml-3.5 mt-1 font-mono text-xs text-cyan-text"
        >
          {site.host}
        </CoreforgeButton>
      ) : site ? (
        <Button
          href={site.href}
          variant="ghost"
          size="sm"
          ripple={false}
          cursor="open"
          data-role-site=""
          aria-label={`${site.host}, ${exp.company}'s site`}
          trailingIcon={<ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />}
          className="-ml-3.5 mt-1 font-mono text-xs text-cyan-text"
        >
          {site.host}
        </Button>
      ) : null}

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
        {exp.location ? (
          <span className="inline-flex items-center gap-1.5">
            <MapPin aria-hidden="true" className="size-3 shrink-0" />
            {exp.location}
          </span>
        ) : null}
      </div>

      <ul className="mt-5 space-y-2.5">
        {exp.highlights.map((h) => (
          <li key={h} className="flex gap-3 text-sm leading-relaxed text-text-secondary">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-violet-bright" />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      {venture ? <ExperienceHighlight placement="experience-highlight" className="mt-5" /> : null}

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

      {index >= 0 ? <AskAboutRole index={index} exp={exp} /> : null}
    </GlassCard>
  );
}
