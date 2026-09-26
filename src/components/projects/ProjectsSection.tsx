'use client';

import dynamic from 'next/dynamic';
import { AnimatePresence, motion } from 'framer-motion';
import { SearchX } from 'lucide-react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { InterestChips } from '@/components/ai/projects/InterestChips';
import { CoreforgeProjectCard } from '@/components/coreforge/CoreforgeProjectCard';
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
  type BentoSlot,
  type Project,
  type ProjectFilter,
} from '@/data/projects';
import { useDeviceCapability } from '@/hooks/useDeviceCapability';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { useProjectDeepLink } from '@/hooks/useProjectDeepLink';
import { openAssistant } from '@/lib/ai/bus';
import type { InterestId } from '@/lib/ai/prompts/projects';
import { filterQuery } from '@/lib/ai/projectFilters';
import { useRenderCount } from '@/lib/devRenderCount';
import { preloadable } from '@/lib/preloadable';
import { ease, stagger } from '@/lib/motion';
import { setUrlParams, useUrlParam } from '@/lib/urlState';
import { cn } from '@/utils/cn';
import { openButtonId, ProjectCard } from './ProjectCard';
import { clearProjectFilters, ProjectFilters } from './ProjectFilters';
import { CaseStudyHostContext, ServerInterestsContext, useProjectsAi } from './projectsAi';

// The dialog and the whole case study load when the grid comes near (or a link
// opens a project), never with the page: most visits never open one. Once loaded,
// the first open renders in the click's own commit instead of suspending.
const ProjectModal = preloadable(() => import('./ProjectModal').then((m) => m.ProjectModal));
// A ?project link opens the dialog on arrival: fetch it while the page hydrates.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('project')) ProjectModal.preload().catch(() => {});

const GRID_ID = 'projects-grid';

// Only the empty grid shows it, so it is its own chunk.
const RelatedWorkFinder = dynamic(
  () => import('@/components/ai/projects/RelatedWork').then((m) => m.RelatedWorkFinder, () => () => null),
  { ssr: false },
);

// The store chunk (interest rankings, and everything the dialog shows) starts
// loading while the grid is still this far below the viewport.
const WARM_MARGIN = '1200px 0px';

/** `items` with the ranked slugs first, in rank order; the rest keep their order. */
function byRank(items: readonly Project[], order: readonly string[]): Project[] {
  const rank = new Map(order.map((slug, i) => [slug, i]));
  return items
    .map((p, i) => ({ p, r: rank.get(p.slug) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.p);
}

/**
 * The bento footprint for a ranked list: the same rows as bentoLayout, but the
 * order is kept (bentoLayout moves featured work forward), so the top match leads.
 */
function rankedLayout(items: readonly Project[]): BentoSlot[] {
  const n = items.length;
  if (n <= 2 || n === 4) return items.map((project) => ({ project, size: 'wide' }));
  const rest = n - 3;
  let pairs = -1;
  for (let a = 0; 2 * a <= rest; a++) {
    if ((rest - 2 * a) % 3 === 0) {
      pairs = a;
      break;
    }
  }
  return items.map((project, i): BentoSlot => {
    if (i === 0) return { project, size: 'lead' };
    if (i < 3) return { project, size: 'normal' };
    return { project, size: pairs < 0 || i - 3 < 2 * pairs ? 'wide' : 'normal' };
  });
}

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

  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const el = document.getElementById('projects');
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          io.disconnect();
          setWarm(true);
        }
      },
      { rootMargin: WARM_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const projectsAi = useProjectsAi(warm);
  useEffect(() => {
    if (warm) ProjectModal.preload().catch(() => {});
  }, [warm]);
  // Warmed when the browser goes idle after load as well, so a first open from anywhere
  // (a card, the palette, the assistant) does not wait on the network.
  useEffect(() => {
    const load = () => void ProjectModal.preload().catch(() => {});
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = window.setTimeout(load, 2000);
    return () => window.clearTimeout(t);
  }, []);
  const serverInterests = useContext(ServerInterestsContext);
  // The loaded store agrees with the server's list; it differs only under a spec's fixture store.
  const interests = useMemo(() => projectsAi?.interests(PROJECTS.map((p) => p.slug)) ?? serverInterests, [projectsAi, serverInterests]);
  const [interestId, setInterestId] = useState<InterestId | null>(null);
  const interest = interests.find((i) => i.id === interestId) ?? null;

  const shown = useMemo(() => {
    const matched = filterProjects(PROJECTS, filter);
    return interest ? byRank(matched, interest.order) : matched;
  }, [filter, interest]);
  const slots = useMemo(() => (interest ? rankedLayout(shown) : bentoLayout(shown)), [shown, interest]);
  const order = useMemo(() => slots.map((s) => s.project), [slots]);

  // The section's one capability read, handed to every card.
  const { allowVideo, isTouch } = useDeviceCapability();
  const { reduce, lite, paused } = useMotionPrefs();
  const deep = useProjectDeepLink();
  const scrollTo = useSmoothScrollTo();
  const [morphSlug, setMorphSlug] = useState<string | null>(null);
  const openSlug = deep.project?.slug ?? null;
  // Mounted from the first open on, so it can play its exit and later opens are instant.
  const [modalWanted, setModalWanted] = useState(false);
  if (openSlug && !modalWanted) setModalWanted(true);

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

  // The assistant cannot sit on top of the dialog's focus trap: close it, wait for
  // it to leave the page, then hand the project to the assistant as its scope.
  const askAbout = useCallback(
    (slug: string) =>
      closeProject(() => {
        const started = Date.now();
        const handOff = () => {
          if (document.querySelector('[data-dialog-root]') && Date.now() - started < 1500) requestAnimationFrame(handOff);
          else openAssistant({ scope: { project: slug } });
        };
        requestAnimationFrame(handOff);
      }),
    [closeProject],
  );
  const host = useMemo(() => ({ askAbout }), [askAbout]);

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

      {interests.length ? (
        <InterestChips interests={interests} active={interest?.id ?? null} onChange={setInterestId} controls={GRID_ID} className="-mt-4 mb-8 md:-mt-6" />
      ) : null}

      {/*
        Each card reveals on its own rather than through a parent variant: a parent
        that turns 'visible' after a filter change would re-animate the cards that
        are exiting and strand them on screen.
      */}
      {/* The venture leads the unfiltered grid as one full-width featured row; it is not a
          project in projects.json, so filters and interest ranking leave it out. */}
      {!filter.q && !filter.cat && !filter.tech && !filter.live && !interest ? (
        <Reveal className="mb-5 md:mb-6">
          <CoreforgeProjectCard ventureHref="/ventures/coreforge" />
        </Reveal>
      ) : null}

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
          <RelatedWorkFinder key={filterQuery(filter)} filter={filter} onOpen={handleOpen} className="mt-4" />
        </div>
      ) : null}

      {modalWanted ? (
        <CaseStudyHostContext.Provider value={host}>
          <ProjectModal
            project={deep.project}
            list={order}
            morphSlug={morphSlug}
            onClose={handleClose}
            onNavigate={navigate}
            onSelectTech={handleTech}
          />
        </CaseStudyHostContext.Provider>
      ) : null}
    </SectionWrapper>
  );
}
