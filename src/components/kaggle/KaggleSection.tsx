'use client';

import { useId, useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Award, ChevronDown, History, NotebookPen, PenLine, Timer, Trophy } from 'lucide-react';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { CountUp, Reveal, Stagger, StaggerItem } from '@/components/motion';
import { GlassCard } from '@/components/shared/GlassCard';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Button } from '@/components/ui/Button';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import type { KaggleCompetition, KaggleData, KaggleSource } from '@/lib/kaggle/types';
import { duration, ease, stagger } from '@/lib/motion';
import { cn } from '@/utils/cn';
import { KaggleBadgeArt } from './KaggleBadgeArt';
import { KaggleWriteupCard } from './KaggleWriteupCard';
import {
  countdown,
  formatCount,
  formatDay,
  hasWriteup,
  httpsSrc,
  kaggleHref,
  parseDay,
  rankLabel,
  relativeTime,
  sortBadges,
  sortWriteups,
  splitCompetitions,
} from './kaggleFormat';
import { useNow } from './useNow';

export type KaggleSectionProps = {
  data: KaggleData;
  /** Section id, also the prefix of the h2 id (`${id}-title`). */
  id?: string;
  className?: string;
};

/** Badges shown before 'Show all': the featured ones plus the newest, two full rows at sm and lg. */
const INITIAL_BADGES = 6;

const CHIP = 'rounded-full border border-glass-border bg-surface-tint px-3 py-1 text-xs';

/**
 * The Kaggle section: profile and tiers, headline counts, the competitions that
 * are open right now (with a live countdown and, where Kaggle reports one, a
 * dated rank), published writeups newest first, earned badges, and a collapsible
 * history of past entries. It renders whatever `data` holds, so a writeup
 * published on Kaggle appears here as soon as the live data refreshes.
 */
export function KaggleSection({ data, id = 'kaggle', className }: KaggleSectionProps) {
  const writeups = useMemo(() => sortWriteups(data.writeups.filter((w) => kaggleHref(w.url))), [data.writeups]);
  const badges = useMemo(() => sortBadges(data.badges), [data.badges]);
  // Grouped by the time the data was read, so server and browser agree at hydration. After
  // that, the visitor's clock can only move a competition whose deadline has passed into
  // the past list, which matters when a stale snapshot is served.
  const now = useNow();
  const { active, past } = useMemo(() => {
    const read = parseDay(data.fetchedAt);
    const reference = now !== null && (read === null || now > read) ? now : read;
    return splitCompetitions([...data.active, ...data.past], reference);
  }, [data.active, data.past, data.fetchedAt, now]);

  return (
    <SectionWrapper id={id} className={cn('kaggle', className)}>
      <SectionHeading
        kicker="Kaggle"
        title="On *Kaggle*."
        subtitle="What I'm competing in right now, the writeups I've published and the badges I've earned, read from Kaggle and limited to what is public."
      />

      <Reveal>
        <ProfileCard
          data={data}
          stats={[
            { key: 'badges', label: 'Badges earned', value: badges.length },
            { key: 'writeups', label: 'Writeups published', value: writeups.length },
            { key: 'competitions', label: 'Competitions entered', value: active.length + past.length },
          ]}
        />
      </Reveal>

      <div className="mt-16" data-kaggle-active-list="">
        <SubHeading
          id={`${id}-active-title`}
          icon={
            <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
              {active.length > 0 ? <span className="absolute inset-0 animate-ping rounded-full bg-success/60" /> : null}
              <span className={cn('relative size-2.5 rounded-full', active.length > 0 ? 'bg-success' : 'bg-text-dim')} />
            </span>
          }
        >
          Currently competing
        </SubHeading>
        {active.length > 0 ? (
          <Stagger className="mt-6">
            <ul role="list" aria-labelledby={`${id}-active-title`} className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {active.map((c) => (
                <StaggerItem as="li" key={c.url} className="min-w-0">
                  <ActiveCard competition={c} />
                </StaggerItem>
              ))}
            </ul>
          </Stagger>
        ) : (
          <p className="mt-6 text-sm text-text-muted">
            {past.length > 0 ? 'No open competition right now; past entries are in the history below.' : 'No open competition right now.'}
          </p>
        )}
      </div>

      {writeups.length > 0 ? (
        <div className="mt-16" data-kaggle-writeups="">
          <SubHeading id={`${id}-writeups-title`} icon={<NotebookPen aria-hidden="true" className="size-6 shrink-0 text-cyan-text" />}>
            Writeups
          </SubHeading>
          <Stagger className="mt-6">
            <ul role="list" aria-labelledby={`${id}-writeups-title`} className="grid gap-6 lg:grid-cols-2">
              {writeups.map((w) => (
                <StaggerItem as="li" key={w.url} className="min-w-0">
                  <KaggleWriteupCard writeup={w} headingLevel="h4" />
                </StaggerItem>
              ))}
            </ul>
          </Stagger>
        </div>
      ) : null}

      {badges.length > 0 ? <BadgeGrid badges={badges} titleId={`${id}-badges-title`} /> : null}

      {past.length > 0 ? <CompetitionHistory past={past} data={data} titleId={`${id}-history-title`} /> : null}
    </SectionWrapper>
  );
}

/* ---- pieces ---- */

function SubHeading({ id, icon, children }: { id: string; icon: ReactNode; children: ReactNode }) {
  return (
    <h3 id={id} className="flex items-center gap-3 font-display text-h3 font-semibold text-balance text-text-primary">
      {icon}
      {children}
    </h3>
  );
}

type Stat = { key: string; label: string; value: number };

function ProfileCard({ data, stats }: { data: KaggleData; stats: Stat[] }) {
  const { profile } = data;
  const profileHref = kaggleHref(profile.url);
  const avatar = httpsSrc(profile.avatar);
  const joined = formatDay(profile.joined);
  const tiers = profile.tiers.filter((t) => t.category && t.tier);

  return (
    <GlassCard strong data-kaggle-profile="" className="p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- a 56px avatar on Kaggle's storage host; decorative, the name sits beside it
          <img
            src={avatar}
            alt=""
            width={56}
            height={56}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-14 shrink-0 rounded-full border border-glass-border object-cover"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-semibold text-text-primary">{profile.displayName}</p>
          <p className="mt-1 font-mono text-xs text-text-muted [overflow-wrap:anywhere]">
            @{profile.userName}
            {joined ? (
              <>
                {' · '}Joined <time dateTime={profile.joined}>{joined}</time>
              </>
            ) : null}
          </p>
        </div>
        {profileHref ? (
          <Button
            href={profileHref}
            variant="secondary"
            cursor="open"
            data-kaggle-profile-link=""
            aria-label={`View Kaggle profile of ${profile.displayName}`}
            trailingIcon={<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}
          >
            View Kaggle profile
          </Button>
        ) : null}
      </div>

      {tiers.length > 0 || profile.overallTier ? (
        <ul role="list" aria-label="Kaggle tiers" className="mt-6 flex flex-wrap gap-2">
          {profile.overallTier ? (
            <li data-kaggle-tier="overall" className={cn(CHIP, 'inline-flex items-center gap-1.5 border-glass-border-strong')}>
              <Award aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
              <span className="text-text-muted">Overall</span>
              <span className="font-semibold text-text-primary">{profile.overallTier}</span>
            </li>
          ) : null}
          {tiers.map((t) => (
            <li key={t.category} data-kaggle-tier={t.category} className={cn(CHIP, 'inline-flex items-center gap-1.5')}>
              <span className="text-text-muted">{t.category}</span>
              <span className="font-semibold text-text-primary">{t.tier}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-hairline pt-6">
        {stats.map((s) => (
          <div key={s.key} className="flex min-w-0 flex-col-reverse gap-1">
            <dt className="text-xs leading-snug text-text-muted hyphens-auto [overflow-wrap:anywhere]">{s.label}</dt>
            <dd
              data-kaggle-stat={s.key}
              data-value={s.value}
              className="font-display text-3xl font-semibold leading-none text-text-primary md:text-4xl"
            >
              <CountUp value={s.value} />
            </dd>
          </div>
        ))}
      </dl>

      <SourceLine source={data.source} fetchedAt={data.fetchedAt} />
    </GlassCard>
  );
}

function SourceLine({ source, fetchedAt }: { source: KaggleSource; fetchedAt: string }) {
  const now = useNow();
  const day = formatDay(fetchedAt);
  const live = source === 'live';
  // The relative time needs the visitor's clock, so the server prints the date instead.
  const when = live && now !== null ? (relativeTime(fetchedAt, now) ?? day) : day;

  return (
    <p data-kaggle-source={source} className="mt-6 flex items-center gap-2 font-mono text-xs text-text-dim">
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', live ? 'bg-success' : 'bg-text-dim')} />
      {live ? (
        when ? (
          <span>
            Updated <time dateTime={fetchedAt}>{when}</time> · live from Kaggle
          </span>
        ) : (
          <span>Live from Kaggle</span>
        )
      ) : when ? (
        <span>
          Snapshot from <time dateTime={fetchedAt}>{when}</time>
        </span>
      ) : (
        <span>Snapshot of Kaggle data</span>
      )}
    </p>
  );
}

function Countdown({ deadline }: { deadline: string }) {
  const now = useNow();
  const left = now === null ? null : countdown(deadline, now);
  const day = formatDay(deadline);
  // Before hydration the date stands in, so the chip keeps its place.
  const text = left?.label ?? (day ? `Closes ${day}` : null);
  if (!text) return null;

  return (
    <p
      data-countdown=""
      data-closed={left?.closed ? '' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-xs font-medium',
        left?.soon ? 'text-amber-text' : left?.closed ? 'text-text-dim' : 'text-cyan-text',
      )}
    >
      <Timer aria-hidden="true" className="size-3.5 shrink-0" />
      {text}
    </p>
  );
}

function RankLine({ competition }: { competition: KaggleCompetition }) {
  const label = rankLabel(competition.userRank, competition.teams, competition.rankAsOf);
  if (!label) return null;
  return (
    <p
      data-kaggle-rank=""
      className="inline-flex max-w-full items-start gap-2 rounded-lg border border-glass-border bg-surface-tint px-3 py-2 text-xs font-medium text-text-primary"
    >
      <Trophy aria-hidden="true" className="mt-px size-3.5 shrink-0 text-amber-text" />
      <span className="min-w-0">{label}</span>
    </p>
  );
}

function ActiveCard({ competition: c }: { competition: KaggleCompetition }) {
  const titleId = `${useId()}-competition`;
  const href = kaggleHref(c.url);
  const deadline = formatDay(c.deadline);
  const ranked = rankLabel(c.userRank, c.teams, c.rankAsOf) !== null;

  return (
    <GlassCard as="article" interactive aria-labelledby={titleId} data-kaggle-active="" className="flex h-full flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {c.category ? <span className={cn(CHIP, 'text-text-secondary')}>{c.category}</span> : <span />}
        <Countdown deadline={c.deadline} />
      </div>

      <h4 id={titleId} className="mt-4 font-display text-lg font-semibold leading-snug text-balance text-text-primary">
        {c.title}
      </h4>
      {c.host ? <p className="mt-1 text-sm text-text-muted">Hosted by {c.host}</p> : null}
      {c.summary ? <p className="mt-3 text-sm leading-relaxed text-text-secondary">{c.summary}</p> : null}

      <div className="mt-4 flex flex-col items-start gap-2">
        {deadline ? (
          <p className="font-mono text-xs text-text-muted">
            Deadline <time dateTime={c.deadline}>{deadline}</time>
          </p>
        ) : null}
        {ranked ? (
          <RankLine competition={c} />
        ) : c.teams > 0 ? (
          <p className="font-mono text-xs text-text-muted">{formatCount(c.teams)} teams on the leaderboard</p>
        ) : null}
      </div>

      {href ? (
        <div className="mt-auto pt-6">
          <Button
            href={href}
            variant="secondary"
            cursor="open"
            aria-label={`View competition: ${c.title} on Kaggle`}
            trailingIcon={<ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />}
          >
            View competition
          </Button>
        </div>
      ) : null}
    </GlassCard>
  );
}

function BadgeGrid({ badges, titleId }: { badges: KaggleData['badges']; titleId: string }) {
  const [showAll, setShowAll] = useState(false);
  const listId = `${useId()}-badges`;
  const collapsible = badges.length > INITIAL_BADGES;

  return (
    <div className="mt-16" data-kaggle-badges="">
      <SubHeading id={titleId} icon={<Award aria-hidden="true" className="size-6 shrink-0 text-cyan-text" />}>
        Badges
      </SubHeading>
      <Stagger className="mt-6" stagger={stagger.micro}>
        <ul role="list" id={listId} aria-labelledby={titleId} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b, i) => {
            const earned = formatDay(b.achieved);
            return (
              <StaggerItem
                as="li"
                key={`${b.name}-${b.achieved}`}
                className={cn('min-w-0', collapsible && !showAll && i >= INITIAL_BADGES && 'hidden')}
              >
                <div
                  data-kaggle-badge=""
                  data-featured={b.featured ? '' : undefined}
                  className="kaggle-badge flex h-full items-start gap-4 rounded-2xl border border-glass-border bg-surface-tint p-4"
                >
                  <KaggleBadgeArt badge={b} size={56} decorative />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-text-primary [overflow-wrap:anywhere]">{b.name}</p>
                    {earned ? (
                      <p className="mt-1 font-mono text-xs text-text-dim">
                        Earned <time dateTime={b.achieved}>{earned}</time>
                      </p>
                    ) : null}
                    {b.description ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">{b.description}</p>
                    ) : null}
                  </div>
                </div>
              </StaggerItem>
            );
          })}
        </ul>
      </Stagger>
      {collapsible ? (
        <Button
          variant="secondary"
          className="mt-6"
          aria-expanded={showAll}
          aria-controls={listId}
          data-kaggle-badges-toggle=""
          onClick={() => setShowAll((v) => !v)}
          trailingIcon={
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform duration-300"
              style={{ transform: showAll ? 'rotate(180deg)' : undefined }}
            />
          }
        >
          {showAll ? 'Show fewer badges' : `Show all ${formatCount(badges.length)} badges`}
        </Button>
      ) : null}
    </div>
  );
}

function CompetitionHistory({ past, data, titleId }: { past: KaggleCompetition[]; data: KaggleData; titleId: string }) {
  const [open, setOpen] = useState(false);
  const { reduce } = useMotionPrefs();
  const regionId = `${useId()}-history`;

  return (
    <div className="mt-16" data-kaggle-history="">
      <h3 id={titleId} className="font-display text-h3 font-semibold text-text-primary">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          data-kaggle-history-toggle=""
          onClick={() => setOpen((v) => !v)}
          className="tap-safe ring-focus -ml-2 max-w-full justify-start gap-3 rounded-2xl px-2 py-1 text-left transition-colors hover:text-violet-bright"
        >
          <History aria-hidden="true" className="size-6 shrink-0 text-cyan-text" />
          <span className="min-w-0">Competition history</span>
          <span className="inline-flex shrink-0 items-center gap-2">
            <span className={cn(CHIP, 'py-0.5 font-mono font-normal text-text-muted')}>
              {formatCount(past.length)}
              <span className="sr-only"> past entries</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-5 shrink-0 text-text-muted transition-transform duration-300"
              style={{ transform: open ? 'rotate(180deg)' : undefined }}
            />
          </span>
        </button>
      </h3>

      <motion.div
        id={regionId}
        role="region"
        aria-labelledby={titleId}
        initial={false}
        animate={open ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
        transition={reduce ? { duration: 0 } : { duration: duration.base, ease: ease.out }}
        inert={!open}
        className="overflow-clip"
      >
        {/* The gap lives inside the clipped box: a margin on the list would collapse through the
            0-height wrapper, leaving a stray gap when closed and skewing the height animation. */}
        <div className="pt-6">
          <ol className="ml-1.5 space-y-6 border-l border-hairline pl-6">
            {past.map((c) => (
              <PastEntry key={c.url} competition={c} written={hasWriteup(c, data.writeups)} />
            ))}
          </ol>
        </div>
      </motion.div>
    </div>
  );
}

function PastEntry({ competition: c, written }: { competition: KaggleCompetition; written: boolean }) {
  const href = kaggleHref(c.url);
  const closed = formatDay(c.deadline);
  const where = [c.host, c.category].filter(Boolean).join(' · ');

  return (
    <li data-kaggle-past="" className="relative">
      <span
        aria-hidden="true"
        className="absolute top-[18px] -left-[28.5px] size-2 rounded-full border border-glass-border-strong bg-bg-base"
      />
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          data-cursor="open"
          className="ring-focus inline-flex min-h-11 items-start gap-1.5 rounded-md py-2.5 font-medium leading-6 text-text-primary transition-colors hover:text-violet-bright [overflow-wrap:anywhere]"
        >
          {c.title}
          <ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-text-muted" />
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ) : (
        <p className="py-2.5 font-medium leading-6 text-text-primary">{c.title}</p>
      )}
      <div className="space-y-1 text-xs text-text-muted">
        {where ? <p className="font-mono">{where}</p> : null}
        {closed || c.teams > 0 ? (
          <p className="font-mono">
            {closed ? (
              <>
                Closed <time dateTime={c.deadline}>{closed}</time>
              </>
            ) : null}
            {closed && c.teams > 0 ? ' · ' : null}
            {c.teams > 0 ? `${formatCount(c.teams)} teams` : null}
          </p>
        ) : null}
      </div>
      {(written || rankLabel(c.userRank, c.teams, c.rankAsOf)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <RankLine competition={c} />
          {written ? (
            <span className={cn(CHIP, 'inline-flex items-center gap-1.5 text-cyan-text')}>
              <PenLine aria-hidden="true" className="size-3.5 shrink-0" />
              Writeup published
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}
