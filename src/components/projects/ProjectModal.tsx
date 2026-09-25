'use client';

import { AnimatePresence, motion, useScroll, type Variants } from 'framer-motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { PROJECTS, type Project } from '@/data/projects';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { useRenderCount } from '@/lib/devRenderCount';
import { duration, ease } from '@/lib/motion';
import { ProjectCaseStudy } from './ProjectCaseStudy';

type Props = {
  /** The project to show; undefined closes the dialog. */
  project: Project | undefined;
  /** The grid's current order after filtering; prev/next stay inside it. */
  list: readonly Project[];
  /** The card the dialog was opened from, which morphs into the hero. */
  morphSlug: string | null;
  onClose: () => void;
  onNavigate: (slug: string) => void;
  onSelectTech: (family: string) => void;
};

type Step = 1 | -1;

// Slides in the travel direction; reduced motion drops x, leaving a crossfade.
const SLIDE: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 48 }),
  center: { opacity: 1, x: 0, transition: { duration: duration.base, ease: ease.out } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -48, transition: { duration: 0.2, ease: ease.in } }),
};

const pad = (n: number) => String(n).padStart(2, '0');

const titleIdFor = (slug: string) => `project-dialog-title-${slug}`;

/**
 * The project dialog on ui/Dialog (focus trap, inert page, scroll lock, Escape,
 * selection-safe backdrop). It keeps the last project while it animates out, and
 * steps through the filtered grid with the chevrons, the arrow keys or a swipe.
 */
export function ProjectModal({ project, list, morphSlug, onClose, onNavigate, onSelectTech }: Props) {
  useRenderCount('ProjectModal');
  const [last, setLast] = useState(project);
  if (project && project !== last) setLast(project);
  const current = project ?? last;
  const closeRef = useRef<HTMLElement>(null);

  return (
    <Dialog
      open={Boolean(project)}
      onClose={onClose}
      labelledBy={current ? titleIdFor(current.slug) : undefined}
      initialFocusRef={closeRef}
      panelClassName="max-w-5xl overflow-clip"
    >
      {current ? (
        <ModalBody
          project={current}
          list={list}
          morphSlug={morphSlug}
          closeRef={closeRef}
          onClose={onClose}
          onNavigate={onNavigate}
          onSelectTech={onSelectTech}
        />
      ) : null}
    </Dialog>
  );
}

function ModalBody({
  project,
  list,
  morphSlug,
  closeRef,
  onClose,
  onNavigate,
  onSelectTech,
}: Omit<Props, 'project'> & { project: Project; closeRef: RefObject<HTMLElement | null> }) {
  const { reduce } = useMotionPrefs();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const focusTitle = useRef(false);
  const [dir, setDir] = useState<number>(0);
  // Only the project the dialog opened on morphs; later ones slide.
  const [morphFor] = useState(morphSlug);
  const [moved, setMoved] = useState(false);

  // Dialog's modal variant scrolls an outer wrapper; the progress bar and the
  // table of contents follow that element.
  useLayoutEffect(() => {
    scrollerRef.current = rootRef.current?.closest<HTMLElement>('[data-dialog-scroller]') ?? rootRef.current;
  }, []);
  const { scrollYProgress } = useScroll({ container: scrollerRef });

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 });
    if (focusTitle.current) {
      focusTitle.current = false;
      document.getElementById(titleIdFor(project.slug))?.focus({ preventScroll: true });
    }
  }, [project.slug]);

  const nav = list.some((p) => p.slug === project.slug) ? list : PROJECTS;
  const index = Math.max(0, nav.findIndex((p) => p.slug === project.slug));
  const count = nav.length;

  const goTo = (slug: string, step: Step) => {
    setDir(step);
    setMoved(true);
    onNavigate(slug);
  };
  const go = (step: Step) => {
    if (count < 2) return;
    goTo(nav[(index + step + count) % count].slug, step);
  };

  useHotkeys({ arrowleft: () => go(-1), arrowright: () => go(1) }, { enabled: count > 1 });

  const morph = !reduce && !moved && project.slug === morphFor;
  const shareUrl = `${window.location.origin}/?project=${project.slug}`;

  return (
    <div ref={rootRef} className="relative">
      <div className="sticky top-0 z-20 h-0">
        <motion.div
          aria-hidden="true"
          data-project-progress=""
          className="absolute inset-x-0 top-0 h-0.5 origin-left bg-[linear-gradient(90deg,var(--app-violet-bright),var(--app-cyan-bright))]"
          style={{ scaleX: scrollYProgress }}
        />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 p-3 sm:p-4">
          {count > 1 ? (
            <div className="flex items-center gap-1 rounded-full border border-glass-border bg-bg-surface/85 p-1 backdrop-blur-md">
              <Button variant="icon" aria-label="Previous project" onClick={() => go(-1)} className="border-transparent bg-transparent">
                <ChevronLeft aria-hidden="true" className="size-5" />
              </Button>
              <span className="min-w-14 text-center font-mono text-xs tabular-nums text-text-secondary" data-project-counter="">
                {pad(index + 1)} / {pad(count)}
              </span>
              <Button variant="icon" aria-label="Next project" onClick={() => go(1)} className="border-transparent bg-transparent">
                <ChevronRight aria-hidden="true" className="size-5" />
              </Button>
            </div>
          ) : (
            <span />
          )}
          <Button
            ref={closeRef}
            variant="icon"
            aria-label="Close"
            onClick={onClose}
            className="bg-bg-surface/85 backdrop-blur-md"
          >
            <X aria-hidden="true" className="size-5" />
          </Button>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {moved ? `${project.name}, project ${index + 1} of ${count}` : ''}
      </p>

      <div className="relative">
        <AnimatePresence mode="popLayout" custom={dir}>
          {/* The first project arrives with the dialog (and the morph), so only later ones slide in. */}
          <motion.div
            key={project.slug}
            custom={dir}
            variants={SLIDE}
            initial={moved ? 'enter' : false}
            animate="center"
            exit="exit"
          >
            <ProjectCaseStudy
              project={project}
              variant="modal"
              titleId={titleIdFor(project.slug)}
              shareUrl={shareUrl}
              morph={morph}
              delay={morph ? duration.base : 0.12}
              onSwipe={count > 1 ? go : undefined}
              onSelectProject={(slug) => {
                focusTitle.current = true;
                goTo(slug, 1);
              }}
              onSelectTech={onSelectTech}
              scrollContainer={scrollerRef}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
