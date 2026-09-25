'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { lazy, useEffect, useMemo, useState } from 'react';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { Reveal } from '@/components/motion';
import { BackgroundVideo } from '@/components/shared/BackgroundVideo';
import { Deferred3D } from '@/components/shared/Deferred3D';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Button } from '@/components/ui/Button';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { duration, ease } from '@/lib/motion';
import { preloadable } from '@/lib/preloadable';
import { ACCENT_MAP, CATEGORIES, findSkill, SKILLS } from '@/lib/skills';
import { SentimentDemo } from './SentimentDemo';
import { SkillCard } from './SkillCard';
import { SkillConstellation } from './SkillConstellation';
import { SkillFilterBar } from './SkillFilterBar';
import { SkillFocusProvider, useSkillActions, useSkillFocus, useSkillList, useSkillMode, useSkillModal } from './SkillFocusContext';

// The label font is ready before the sphere mounts, so its labels never suspend it.
const SkillSphere = lazy(() =>
  import('./SkillSphere').then(async (m) => {
    await m.preloadLabels();
    return m;
  }),
);
// The constellation stays over the sphere until the sphere has drawn a full frame.
const SPHERE_HANDOFF = { ready: '.skills-sphere[data-drawn]' };

// The skill dialog (and its AI extras) loads when the section comes near or a
// ?skill link opens it, never with the page. Once loaded, the first open renders in
// the click's own commit instead of suspending.
const SkillModal = preloadable(() => import('./SkillModal').then((m) => m.SkillModal));
// A ?skill link opens the dialog on arrival: fetch it while the page hydrates.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('skill')) SkillModal.preload().catch(() => {});
const WARM_MARGIN = '800px 0px';

/** Mounts the dialog from the first open on, so it can play its exit and later opens are instant. */
function SkillModalHost() {
  const { skill } = useSkillModal();
  const [wanted, setWanted] = useState(false);
  if (skill && !wanted) setWanted(true);

  // Warmed when the browser goes idle after load too, so a first open never waits on the network.
  useEffect(() => {
    if (wanted) return;
    const load = () => void SkillModal.preload().catch(() => {});
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(load, 2000);
    return () => window.clearTimeout(t);
  }, [wanted]);

  useEffect(() => {
    const el = document.getElementById('skills');
    if (wanted || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        SkillModal.preload().catch(() => {});
      },
      { rootMargin: WARM_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [wanted]);

  return wanted ? <SkillModal /> : null;
}

const SUBTITLE = {
  sphere: "Spin it, or tap a node to lock it center-stage. Every one is something I've shipped production code with.",
  constellation: "Tap a node to open it. Every one is something I've shipped production code with.",
};

const CARD_ENTER = { duration: duration.base, ease: ease.out };

/** Polite announcement of the node locked on the sphere or constellation. */
function SelectionAnnouncer() {
  const { selected } = useSkillFocus();
  const [text, setText] = useState('');
  useEffect(() => {
    const skill = findSkill(selected);
    // Deferred a tick so the button's own name is read first.
    const t = window.setTimeout(() => setText(skill ? `${skill.name} selected, ${skill.category}` : ''), 120);
    return () => window.clearTimeout(t);
  }, [selected]);
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only" data-skills-selection="">
      {text}
    </p>
  );
}

function ReleaseChip() {
  const { selected } = useSkillFocus();
  const { select } = useSkillActions();
  return (
    <div className="mt-3 flex min-h-11 justify-center">
      {selected ? (
        <Button variant="secondary" size="md" onClick={() => select(null)} className="font-mono text-[11px] uppercase tracking-[0.2em]">
          {selected} · release
        </Button>
      ) : null}
    </div>
  );
}

function SkillStage() {
  return (
    <div className="lg:sticky lg:top-28">
      <div className="mx-auto aspect-square w-full max-w-[min(420px,88vw)] lg:max-w-none">
        <Deferred3D
          id="skills"
          focusKey="data-node"
          handoff={SPHERE_HANDOFF}
          fallback={<SkillConstellation />}
          className="relative h-full w-full"
        >
          <SkillSphere />
        </Deferred3D>
      </div>
      <ReleaseChip />
      <SelectionAnnouncer />
    </div>
  );
}

function SkillGrid() {
  const { filter, query, visible } = useSkillList();
  const { setQuery } = useSkillActions();
  const { reduce } = useMotionPrefs();

  const groups = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        total: SKILLS.filter((s) => s.category === category).length,
        skills: visible.filter((s) => s.category === category),
      })).filter((g) => g.skills.length > 0),
    [visible],
  );

  if (groups.length === 0) {
    const q = query.trim();
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-hairline bg-surface-tint px-6 py-10 text-center" data-skills-empty="">
        <LottieIcon name="emptySearch" play="once" loop={false} className="block size-28" fallback={null} />
        <p className="text-sm text-text-secondary">
          No skills match “{q}”{filter === 'All' ? '' : ` in ${filter}`}.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
          Clear search
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {groups.map((g) => (
          <motion.div
            key={g.category}
            layout={reduce ? false : 'position'}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: CARD_ENTER }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2, ease: ease.in } }}
          >
            <SkillCard
              category={g.category}
              skills={g.skills}
              total={g.total}
              accent={ACCENT_MAP[g.category] ?? 'violet'}
              query={query}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * The subtitle says what the stage can do: spin the sphere, or tap the constellation.
 * Both lines share one grid cell and the inactive one is only invisible, so the
 * box keeps the taller line's height and nothing below moves when the sphere mounts.
 */
function SkillsHeading() {
  const { sphereLive } = useSkillMode();
  return (
    <SectionHeading
      sectionId="skills"
      title="Tools in the *arsenal*."
      subtitle={
        <span className="grid">
          <span className={sphereLive ? '[grid-area:1/1]' : 'invisible [grid-area:1/1]'}>{SUBTITLE.sphere}</span>
          <span className={sphereLive ? 'invisible [grid-area:1/1]' : '[grid-area:1/1]'}>{SUBTITLE.constellation}</span>
        </span>
      }
    />
  );
}

/** Full-bleed behind the whole section, not just the content column. */
const SKILLS_BACKGROUND = (
  <>
    <BackgroundVideo
      variant="dark"
      src="/videos/skills-bg.mp4"
      poster="/images/skills-bg.webp"
      className="dark-only pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-25"
    />
    <div
      className="light-only pointer-events-none absolute inset-0 -z-10 overflow-clip"
      style={{
        maskImage: 'radial-gradient(ellipse 85% 75% at 50% 50%, #000 35%, rgb(0 0 0 / 0.35) 70%, transparent 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse 85% 75% at 50% 50%, #000 35%, rgb(0 0 0 / 0.35) 70%, transparent 100%)',
      }}
    >
      <BackgroundVideo
        variant="light"
        src="/videos/skills-bg-light.mp4"
        className="h-full w-full object-cover opacity-40"
        style={{ filter: 'saturate(0.75) brightness(1.02)' }}
      />
    </div>
    <div className="light-only pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/50 via-transparent to-bg-base/70" />
    <div
      className="dark-only pointer-events-none absolute inset-0 -z-10 opacity-20 mix-blend-screen"
      style={{ backgroundImage: 'url(/images/skills-neural.webp)', backgroundSize: 'cover', backgroundPosition: 'center' }}
    />
    <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/70 via-transparent to-bg-base/90" />
  </>
);

function SkillsBody() {
  return (
    <SectionWrapper id="skills" background={SKILLS_BACKGROUND}>
      <SkillsHeading />

      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-5 lg:gap-8">
        <div className="lg:col-span-2 lg:self-stretch">
          <SkillStage />
        </div>
        <div className="lg:col-span-3">
          <SkillFilterBar />
          <SkillGrid />
        </div>
      </div>

      <Reveal className="mt-16">
        <SentimentDemo />
      </Reveal>

      <SkillModalHost />
    </SectionWrapper>
  );
}

export function SkillsSection() {
  return (
    <SkillFocusProvider>
      <SkillsBody />
    </SkillFocusProvider>
  );
}
