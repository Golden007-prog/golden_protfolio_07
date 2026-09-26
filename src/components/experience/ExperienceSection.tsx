'use client';

import { AchievementsBlock } from '@/components/achievements/AchievementsBlock';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { Reveal } from '@/components/motion';
import { GitHubHeatmap } from '@/components/shared/GitHubHeatmap';
import { LazyMount } from '@/components/shared/LazyMount';
import { LeetCodeHeatmap } from '@/components/shared/LeetCodeHeatmap';
import { ReadingList } from '@/components/shared/ReadingList';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Skeleton } from '@/components/ui/Skeleton';
import profile from '@/data/profile.json';
import { compareYearMonth } from '@/utils/dates';
import { EducationCard } from './EducationCard';
import { TimelineCard, type Experience } from './TimelineCard';
import { TimelineSpine, type SpineItem } from './TimelineSpine';

const SKILLS: readonly string[] = Object.values(profile.skills).flat();
const EXPERIENCE: readonly Experience[] = profile.experience;

// Newest start first, on screen only: profile.experience keeps its order, because
// each card's [data-exp-index] and the assistant's exp:<i> scope are array indices.
// Array.prototype.sort is stable, so roles that start in the same month keep file order.
const BY_START: readonly Experience[] = [...EXPERIENCE].sort(
  (a, b) => compareYearMonth(b.start, a.start) ?? 0,
);

const toItem = (exp: Experience): SpineItem => ({
  key: `${exp.company}-${exp.start}`,
  content: <TimelineCard exp={exp} skills={SKILLS} />,
});

const ROLES: readonly SpineItem[] = BY_START.filter((e) => !e.earlier).map(toItem);
const EARLIER: readonly SpineItem[] = BY_START.filter((e) => e.earlier).map(toItem);

/**
 * Story first: the timeline (earlier roles folded under a disclosure), the
 * hackathons and launches, education, then the live activity heatmaps, which
 * mount (and start their third-party fetches) only when scrolled near.
 */
export function ExperienceSection() {
  return (
    <SectionWrapper id="experience">
      <SectionHeading
        sectionId="experience"
        title="The journey so *far*."
        subtitle="Internships, freelance AI work, and a Master's in progress — all pulling in the same direction."
      />

      <TimelineSpine items={ROLES} earlier={EARLIER.length > 0 ? { label: 'Earlier work', items: EARLIER } : undefined} />

      <AchievementsBlock className="mt-16 md:mt-20" />

      <Reveal className="mt-16 md:mt-20">
        <EducationCard education={profile.education} />
      </Reveal>

      <div className="mt-16 grid grid-cols-1 gap-8 md:mt-20">
        <LazyMount
          rootMargin="400px"
          className="story-heat-slot story-heat-slot--github min-w-0"
          placeholder={<Skeleton variant="block" className="story-heat-skeleton" />}
        >
          <GitHubHeatmap />
        </LazyMount>
        <LazyMount
          rootMargin="400px"
          className="story-heat-slot story-heat-slot--leetcode min-w-0"
          placeholder={<Skeleton variant="block" className="story-heat-skeleton" />}
        >
          <LeetCodeHeatmap />
        </LazyMount>
      </div>

      <Reveal className="mt-10">
        <ReadingList />
      </Reveal>
    </SectionWrapper>
  );
}
