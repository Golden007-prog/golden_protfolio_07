'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { SearchX } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Reveal } from '@/components/motion';
import { REVEAL_MARGIN, revealVariants } from '@/components/motion/Reveal';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Button } from '@/components/ui/Button';
import { useSmoothScrollTo } from '@/contexts/LenisContext';
import {
  CATEGORIES,
  PROJECTS,
  allTech,
  bentoLayout,
  countWord,
  filterProjects,
  type BentoSize,
  type ProjectFilter,
} from '@/data/projects';
import { useDeviceCapability } from '@/hooks/useDeviceCapability';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { useProjectDeepLink } from '@/hooks/useProjectDeepLink';
import { useRenderCount } from '@/lib/devRenderCount';
import { ease, stagger } from '@/lib/motion';
import { setUrlParams, useUrlParam } from '@/lib/urlState';
import { cn } from '@/utils/cn';
import { openButtonId, ProjectCard } from './ProjectCard';
import { clearProjectFilters, ProjectFilters } from './ProjectFilters';
import { ProjectModal } from './ProjectModal';

const GRID_ID = 'projects-grid';

// lg is a 6-column grid: lead 4x2, wide 3, normal 2. md is 2 columns with the lead full width.
const SPAN: Record<BentoSize, string> = {
  lead: 'md:col-span-2 lg:col-span-4 lg:row-span-2',
  wide: 'lg:col-span-3',
  normal: 'lg:col-span-2',
};

const EXIT = { opacity: 0, scale: 0.96, transition: { duration: 0.2, ease: ease.in } };

function matchName(value: string | null, names: readonly string[]): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return names.find((n) => n.toLowerCase() === lower) ?? value;
}

const TECH_NAMES = allTech().map((t) => t.name);

export function ProjectsSection() {
  useRenderCount('ProjectsSection');
  const q = useUrlParam('q') ?? '';
  const catParam = useUrlParam('cat');
  const techParam = useUrlParam('tech');
  const live = useUrlParam('live') === '1';
  const filter = useMemo<ProjectFilter>(
    () => ({ q, cat: matchName(catParam, CATEGORIES), tech: matchName(techParam, TECH_NAMES), live }),
    [q, catParam, techParam, live],
  );

  const shown = useMemo(() => filterProjects(PROJECTS, filter), [filter]);
  const slots = useMemo(() => bentoLayout(shown), [shown]);
  const order = useMemo(() => slots.map((s) => s.project), [slots]);

  // The section's one capability read, handed to every card.
  const { allowVideo, isTouch } = useDeviceCapability();
  const { reduce, lite, paused } = useMotionPrefs();
  const deep = useProjectDeepLink();
  const scrollTo = useSmoothScrollTo();
  const [morphSlug, setMorphSlug] = useState<string | null>(null);
  const openSlug = deep.project?.slug ?? null;

  // Cards in one row of three cascade left to right.
  const reveal = useMemo(() => {
    const byColumn = [0, 1, 2].map((c) => revealVariants('fade-up', reduce, c * stagger.card, lite));
    return (i: number) => byColumn[i % 3];
  }, [reduce, lite]);

  const { open: openProject, close: closeProject, navigate } = deep;

  const handleOpen = useCallback(
    (slug: string) => {
      setMorphSlug(slug);
      openProject(slug);
    },
    [openProject],
  );

  // A dialog opened from a link has no opener to hand focus back to; use its card.
  const handleClose = useCallback(() => {
    const slug = openSlug;
    closeProject(() =>
      requestAnimationFrame(() => {
        const active = document.activeElement;
        // Focus still inside the exiting dialog is about to be lost with it.
        if (!slug || (active && active !== document.body && !active.closest('[data-dialog-root]'))) return;
        document.getElementById(openButtonId(slug))?.focus({ preventScroll: true });
      }),
    );
  }, [closeProject, openSlug]);

  const handleTech = useCallback(
    (family: string) =>
      closeProject(() => {
        setUrlParams({ tech: family, q: null, cat: null, live: null });
        requestAnimationFrame(() => scrollTo('projects'));
      }),
    [closeProject, scrollTo],
  );

  return (
    <SectionWrapper id="projects">
      <SectionHeading
        title="Things I've *built*."
        subtitle={`From mechanistic-interpretability clinical AI to serverless voice commerce — ${countWord(PROJECTS.length)} shipped projects.`}
      />

      <Reveal>
        <ProjectFilters filter={filter} shown={shown.length} controls={GRID_ID} />
      </Reveal>

      {/*
        Each card reveals on its own rather than through a parent variant: a parent
        that turns 'visible' after a filter change would re-animate the cards that
        are exiting and strand them on screen.
      */}
      <ul id={GRID_ID} className="relative grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6 lg:grid-flow-dense lg:grid-cols-6">
        <AnimatePresence mode="popLayout">
          {slots.map(({ project, size }, i) => (
            <motion.li
              key={project.slug}
              layout
              variants={reveal(i)}
              initial="hidden"
              animate={reduce ? 'visible' : undefined}
              whileInView={reduce ? undefined : 'visible'}
              viewport={{ once: true, margin: REVEAL_MARGIN }}
              exit={EXIT}
              data-reveal=""
              className={cn('min-w-0', SPAN[size])}
            >
              <ProjectCard
                project={project}
                size={size}
                onOpen={handleOpen}
                isOpen={openSlug === project.slug}
                allowVideo={allowVideo && !paused}
                isTouch={isTouch}
                morph={!reduce}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center" data-projects-empty="">
          <LottieIcon
            name="emptySearch"
            play="once"
            loop={false}
            className="block size-32"
            fallback={<SearchX aria-hidden="true" className="size-12 text-text-muted" />}
          />
          <p className="text-lead text-text-secondary">No projects match those filters.</p>
          <Button variant="secondary" onClick={clearProjectFilters}>
            Clear filters
          </Button>
        </div>
      ) : null}

      <ProjectModal
        project={deep.project}
        list={order}
        morphSlug={morphSlug}
        onClose={handleClose}
        onNavigate={navigate}
        onSelectTech={handleTech}
      />
    </SectionWrapper>
  );
}
