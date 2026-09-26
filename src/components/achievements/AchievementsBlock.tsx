'use client';

import { FolderOpen, Rocket, Users } from 'lucide-react';
import { Reveal, Stagger, StaggerItem } from '@/components/motion';
import { CoreforgeButton } from '@/components/coreforge/CoreforgeLink';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { smoothScrollTo } from '@/contexts/LenisContext';
import raw from '@/data/achievements.json';
import { getProjectBySlug } from '@/data/projects';
import { ACHIEVEMENT_KIND_LABEL, allAchievements, parseAchievements, type Achievement, type AchievementKind } from '@/lib/achievements';
import { isCoreforgeUrl } from '@/lib/coreforge/links';
import { emit } from '@/lib/events';
import { cn } from '@/utils/cn';
import { formatYearMonth } from '@/utils/dates';

// Parsed once; a bad edit (a named teammate, an unexplained percentage) fails the build.
const ACHIEVEMENTS: readonly Achievement[] = allAchievements(parseAchievements(raw));

/** Each kind keeps one text-safe token, so the badge reads in both themes. */
const KIND_TONE: Readonly<Record<AchievementKind, string>> = {
  finalist: 'text-amber-text',
  founder: 'text-violet-bright',
  build: 'text-cyan-text',
  submission: 'text-text-secondary',
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function openProject(slug: string) {
  emit('project:open', { slug });
  smoothScrollTo('projects', { focus: false });
}

function AchievementCard({ item }: { item: Achievement }) {
  const titleId = `achievement-${item.id}-title`;
  const project = getProjectBySlug(item.project);
  const organizers = item.organizers ?? [];

  return (
    <GlassCard
      as="article"
      spotlight
      aria-labelledby={titleId}
      data-achievement={item.id}
      data-kind={item.kind}
      className="flex h-full flex-col p-6 md:p-7"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          data-achievement-kind=""
          className={cn(
            'inline-flex items-center rounded-full border border-glass-border bg-surface-tint px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em]',
            KIND_TONE[item.kind],
          )}
        >
          {ACHIEVEMENT_KIND_LABEL[item.kind]}
        </span>
        <time dateTime={item.date} className="font-mono text-xs text-text-muted">
          {formatYearMonth(item.date)}
        </time>
      </div>

      <h4 id={titleId} className="mt-3 font-display text-lg font-semibold leading-snug text-balance text-text-primary [overflow-wrap:anywhere] md:text-xl">
        {item.title}
      </h4>

      {organizers.length > 0 || item.team ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {organizers.length > 0 ? (
            <span className="font-medium text-violet-bright">
              <span className="sr-only">Run by </span>
              {organizers.join(' · ')}
            </span>
          ) : null}
          {item.team ? (
            <span data-achievement-team="" className="inline-flex items-center gap-1.5 text-text-muted">
              <Users aria-hidden="true" className="size-3.5 shrink-0" />
              {capitalise(item.team)}
            </span>
          ) : null}
        </p>
      ) : null}

      <p className="mt-3 text-sm leading-relaxed text-text-muted">{item.summary}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        {project ? (
          <Button
            variant="secondary"
            size="sm"
            data-achievement-project={project.slug}
            aria-label={`Open project: ${project.name}`}
            leadingIcon={<FolderOpen aria-hidden="true" className="size-3.5 shrink-0" />}
            onClick={() => openProject(project.slug)}
          >
            Open project
          </Button>
        ) : null}
        {item.links.map((link) =>
          isCoreforgeUrl(link.url) ? (
            <CoreforgeButton
              key={link.url}
              path={link.url}
              placement={`achievement-${item.id}`}
              data={{ 'data-achievement-link': '' }}
              variant="outline"
              size="sm"
              arrow={false}
              aria-label={`${link.label}: ${item.title}`}
            >
              {link.label}
            </CoreforgeButton>
          ) : (
          <Button
            key={link.url}
            href={link.url}
            variant="outline"
            size="sm"
            cursor="open"
            data-achievement-link=""
            aria-label={`${link.label}: ${item.title}`}
          >
            {link.label}
          </Button>
          ),
        )}
      </div>
    </GlassCard>
  );
}

/**
 * Hackathon results, submissions and launches, newest first, each in his own
 * public words (achievements.json). Nothing here states a rank, prize or figure
 * the posts did not; teammates appear only as 'team of two'.
 */
export function AchievementsBlock({ className }: { className?: string }) {
  if (ACHIEVEMENTS.length === 0) return null;
  return (
    <section aria-labelledby="achievements-title" data-achievements="" className={className}>
      <Reveal className="mb-6 flex items-center gap-3 md:mb-8">
        <LottieIcon
          name="rocket"
          play="once"
          loop={false}
          className="flex size-8 shrink-0 items-center justify-center text-cyan-text"
          fallback={<Rocket aria-hidden="true" className="size-5" />}
        />
        <h3 id="achievements-title" className="font-mono text-eyebrow uppercase text-cyan-text">
          Hackathons &amp; launches
        </h3>
      </Reveal>
      <Stagger as="ol" className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {ACHIEVEMENTS.map((item) => (
          <StaggerItem as="li" key={item.id} className="min-w-0">
            <AchievementCard item={item} />
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}
