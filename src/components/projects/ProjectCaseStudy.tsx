'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, type PanInfo, type Variants } from 'framer-motion';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  Captions,
  ExternalLink,
  GitCompare,
  Github,
  Layers,
  Lightbulb,
  MessagesSquare,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Target,
  TrendingUp,
  Wrench,
} from 'lucide-react';
import { Suspense, useContext, useEffect, useId, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { revealVariants } from '@/components/motion/Reveal';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { PROJECTS, githubFacts, hasCaseStudy, relatedTo, sharedTech, type Project } from '@/data/projects';
import { useDeviceCapability } from '@/hooks/useDeviceCapability';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { openAssistant } from '@/lib/ai/bus';
import type { CaseStudyAi } from '@/lib/ai/prompts/projects';
import type { Provenance } from '@/lib/ai/reviewGate';
import { track } from '@/lib/analytics';
import { stagger, staggerContainer } from '@/lib/motion';
import { cn } from '@/utils/cn';
import { mediaLayoutId, ProjectImage, titleLayoutId } from './ProjectImage';
import { CaseStudyHostContext, useProjectsAi } from './projectsAi';

// Re-exported for existing importers; the grid imports './projectsAi' directly so
// this module (the dialog's content) can load as its own chunk.
export { CaseStudyHostContext, loadProjectsAi, useProjectsAi } from './projectsAi';

const EMPTY_AI: CaseStudyAi = { levels: [], questions: null, compare: {}, alt: {}, demo: null, neighbours: [] };

const renderNothing = () => null;
const LevelSwitch = dynamic(() => import('@/components/ai/projects/LevelSwitch').then((m) => m.LevelSwitch, () => renderNothing));
const CompareTable = dynamic(() => import('@/components/ai/projects/CompareTable').then((m) => m.CompareTable, () => renderNothing));
const AskQuestions = dynamic(() => import('@/components/ai/projects/AskQuestions').then((m) => m.AskQuestions, () => renderNothing));
const SemanticNeighbours = dynamic(() =>
  import('@/components/ai/projects/RelatedWork').then((m) => m.SemanticNeighbours, () => renderNothing),
);

const STARS: Readonly<Record<string, number>> = Object.fromEntries(PROJECTS.map((p) => [p.slug, githubFacts(p.slug)?.stars ?? p.stars]));

export type ProjectCaseStudyProps = {
  project: Project;
  /** 'modal': h2 title and h3 sections inside the dialog. 'page': h1 and h2 on /projects/<slug>. */
  variant: 'modal' | 'page';
  titleId: string;
  /** Absolute link that Share copies or hands to the share sheet. */
  shareUrl: string;
  /** Shared-element ids so the card's image and title morph into the hero. */
  morph?: boolean;
  /** Seconds before the sections cascade in (after the morph, in the dialog). */
  delay?: number;
  /** Touch swipe on the hero steps through projects. */
  onSwipe?: (dir: 1 | -1) => void;
  /** Dialog: open a related project in place. Page: related items are links. */
  onSelectProject?: (slug: string) => void;
  /** Dialog: close and filter the grid by a tech family. Page: chips link to /?tech=. */
  onSelectTech?: (family: string) => void;
  /** The dialog's scroller, for the table of contents; the page scrolls the window. */
  scrollContainer?: RefObject<HTMLElement | null>;
  /** AI extras selected on the server (the static page). Without it the dialog loads them. */
  ai?: CaseStudyAi;
};

type SectionKey =
  | 'levels'
  | 'problem'
  | 'approach'
  | 'overview'
  | 'how'
  | 'outcomes'
  | 'challenges'
  | 'lessons'
  | 'questions'
  | 'glance'
  | 'compare'
  | 'related';

type Section = { key: SectionKey; toc: string; heading: string; icon: ReactNode; body: ReactNode };

const MONTH_YEAR = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const INSTANT: Variants = { hidden: {}, visible: {} };
// Stars and forks only read as a signal once they are worth mentioning.
const MIN_SOCIAL_COUNT = 5;
const SWIPE_DISTANCE = 80;
const SWIPE_VELOCITY = 500;
const icon = (Icon: typeof Target) => <Icon aria-hidden="true" className="size-3.5" />;

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse rounded-xl border border-hairline bg-surface-tint p-4 text-center">
      <dt className="mt-1 text-[11px] uppercase tracking-wider text-text-muted">{label}</dt>
      <dd className="bg-gradient-to-br from-violet-bright to-cyan-bright bg-clip-text font-display text-lg font-bold break-words text-transparent sm:text-2xl">
        {value}
      </dd>
    </div>
  );
}

/** A related project's link from the case-study page: its own page, or the home-page dialog. */
function caseStudyHref(slug: string): string {
  const p = PROJECTS.find((x) => x.slug === slug);
  return p && hasCaseStudy(p) ? `/projects/${slug}` : `/?project=${slug}`;
}

const CHIP =
  'inline-flex min-h-11 items-center gap-2 rounded-full border border-glass-border-strong bg-glass-fill px-4 text-sm text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary';

function ShareProject({ project, url }: { project: Project; url: string }) {
  const { isTouch } = useDeviceCapability();
  // The OS share sheet on touch devices; a copy button (with a manual field fallback) elsewhere.
  const native = isTouch && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  if (native) {
    return (
      <Button
        variant="secondary"
        leadingIcon={<Share2 aria-hidden="true" className="size-4" />}
        onClick={async () => {
          try {
            await navigator.share({ title: project.name, text: project.tagline, url });
            track('share_project', { slug: project.slug, method: 'native' });
          } catch {
            /* dismissed */
          }
        }}
      >
        Share
      </Button>
    );
  }
  return (
    <CopyButton
      value={url}
      label="Copy link"
      copiedLabel="Link copied"
      onCopied={() => track('share_project', { slug: project.slug, method: 'copy' })}
    />
  );
}

/**
 * 'Describe this demo' (#207): the reviewed description of a demo loop. It is
 * visible whenever loops are off; while one plays it stays available to screen
 * readers and keyboard users (the loop itself is aria-hidden) and shows on focus.
 */
function DescribeDemo({ text, provenance, visible }: { text: string; provenance: Provenance; visible: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={cn('mt-4', !visible && 'ai-sr-until-focus')} data-ai-demo="">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        leadingIcon={<Captions aria-hidden="true" className="size-4" />}
        className="-ml-3"
      >
        {open ? 'Hide the demo description' : 'Describe this demo'}
      </Button>
      <div id={id} hidden={!open} className="mt-2 max-w-2xl rounded-xl border border-hairline bg-surface-tint p-4">
        <p className="text-sm leading-relaxed text-text-secondary">{text}</p>
        <p className="mt-2 text-xs text-text-muted" data-ai-provenance="">
          {provenance}
        </p>
        <AIDisclosure compact className="mt-2" />
      </div>
    </div>
  );
}

/**
 * A project's full write-up, shared by the dialog and the static case-study page:
 * hero, actions, a table of contents listing only the sections this project has,
 * the sections, repository facts from the build-time github-facts.json, and
 * related work. Sections cascade in once the hero has settled.
 */
export function ProjectCaseStudy({
  project,
  variant,
  titleId,
  shareUrl,
  morph = false,
  delay = 0,
  onSwipe,
  onSelectProject,
  onSelectTech,
  scrollContainer,
  ai: serverAi,
}: ProjectCaseStudyProps) {
  const { reduce, lite, paused } = useMotionPrefs();
  const { allowVideo, isTouch } = useDeviceCapability();
  const host = useContext(CaseStudyHostContext);
  const facts = githubFacts(project.slug);
  const related = useMemo(() => relatedTo(project.slug), [project.slug]);
  const shared = useMemo(() => sharedTech(project), [project]);
  const others = useMemo(() => PROJECTS.filter((p) => p.slug !== project.slug), [project.slug]);
  const loaded = useProjectsAi(!serverAi);
  const ai = useMemo(() => serverAi ?? loaded?.select(project) ?? EMPTY_AI, [serverAi, loaded, project]);
  const page = variant === 'page';
  // In the dialog the extras mount once the AI store arrives, often while it is already
  // open: each gets its own boundary, or its chunk would suspend the dialog's and hide
  // the whole dialog (and drop its focus). The static page renders them inline on the
  // server, where a boundary would stream them behind a script and hide them without JS.
  const extra = (node: ReactNode) => (page ? node : <Suspense fallback={null}>{node}</Suspense>);
  const Title = page ? 'h1' : 'h2';
  const Heading = page ? 'h2' : 'h3';
  const idFor = (key: SectionKey) => `${page ? '' : 'dialog-'}${project.slug}-${key}`;

  const glance: { value: string; label: string }[] = [
    { value: String(project.techStack.length), label: 'Technologies' },
    { value: project.language, label: 'Language' },
  ];
  if (facts?.pushedAt) glance.push({ value: MONTH_YEAR.format(new Date(facts.pushedAt)), label: 'Updated' });
  if (facts?.license) glance.push({ value: facts.license, label: 'Licence' });
  if (facts && facts.stars >= MIN_SOCIAL_COUNT) glance.push({ value: String(facts.stars), label: 'Stars' });
  if (facts && facts.forks >= MIN_SOCIAL_COUNT) glance.push({ value: String(facts.forks), label: 'Forks' });

  const sections: Section[] = [];
  if (ai.levels.length) {
    sections.push({
      key: 'levels',
      toc: 'At your level',
      heading: 'Explain it at your level',
      icon: icon(SlidersHorizontal),
      body: extra(<LevelSwitch levels={ai.levels} />),
    });
  }
  if (project.problem) {
    sections.push({
      key: 'problem',
      toc: 'Problem',
      heading: 'The problem',
      icon: icon(Target),
      body: <p className="text-lead text-text-secondary">{project.problem}</p>,
    });
  }
  if (project.solution) {
    sections.push({
      key: 'approach',
      toc: 'Approach',
      heading: 'My approach',
      icon: icon(Wrench),
      body: <p className="text-base leading-relaxed text-text-secondary">{project.solution}</p>,
    });
  }
  sections.push({
    key: 'overview',
    toc: 'What I built',
    heading: 'What I built',
    icon: icon(Sparkles),
    body: <p className="text-base leading-relaxed text-text-secondary">{project.shortDescription}</p>,
  });
  if (project.fullDescription && project.fullDescription !== project.shortDescription) {
    sections.push({
      key: 'how',
      toc: 'How it works',
      heading: 'How it works',
      icon: icon(Layers),
      body: <p className="text-base leading-relaxed text-text-secondary">{project.fullDescription}</p>,
    });
  }
  if (project.metrics?.length) {
    sections.push({
      key: 'outcomes',
      toc: 'Outcomes',
      heading: 'Outcomes',
      icon: icon(TrendingUp),
      body: (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {project.metrics.map((m) => (
            <Metric key={m.label} value={m.value} label={m.label} />
          ))}
        </dl>
      ),
    });
  }
  if (project.challenges?.length) {
    sections.push({
      key: 'challenges',
      toc: 'Challenges',
      heading: 'Challenges & solutions',
      icon: icon(AlertCircle),
      body: (
        <ul className="space-y-3">
          {project.challenges.map((c) => (
            <li key={c.challenge} className="rounded-xl border border-hairline bg-surface-tint p-4 md:p-5">
              <p className="mb-1.5 text-sm font-medium text-text-primary">{c.challenge}</p>
              <p className="text-sm leading-relaxed text-text-muted">{c.solution}</p>
            </li>
          ))}
        </ul>
      ),
    });
  }
  if (project.lessons) {
    sections.push({
      key: 'lessons',
      toc: 'Lessons',
      heading: "What I'd do differently",
      icon: icon(Lightbulb),
      body: <p className="text-base italic leading-relaxed text-text-muted">{project.lessons}</p>,
    });
  }
  if (ai.questions) {
    sections.push({
      key: 'questions',
      toc: 'Questions to ask',
      heading: 'Good questions to ask',
      icon: icon(MessagesSquare),
      body: extra(<AskQuestions projectName={project.name} items={ai.questions.items} provenance={ai.questions.provenance} />),
    });
  }
  sections.push({
    key: 'glance',
    toc: 'At a glance',
    heading: 'At a glance',
    icon: icon(BookOpen),
    body: (
      <div className="flex flex-col gap-6">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {glance.map((m) => (
            <Metric key={m.label} value={m.value} label={m.label} />
          ))}
        </dl>
        <ul className="flex flex-wrap gap-2" aria-label="Technologies">
          {project.techStack.map((t) => (
            <li key={t} className="rounded-full border border-violet-bright/30 bg-violet/10 px-3 py-1 text-xs text-violet-bright">
              {t}
            </li>
          ))}
        </ul>
        {project.topics.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label="Domains">
            {project.topics.map((t) => (
              <li key={t} className="rounded-full border border-hairline bg-surface-tint px-3 py-1 text-xs text-text-secondary">
                #{t}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    ),
  });
  sections.push({
    key: 'compare',
    toc: 'Compare',
    heading: 'Compare with another project',
    icon: icon(GitCompare),
    body: extra(<CompareTable project={project} others={others} compare={ai.compare} stars={STARS} />),
  });
  if (related.length > 0 || shared.length > 0 || ai.neighbours.length > 0) {
    sections.push({
      key: 'related',
      toc: 'Related work',
      heading: 'Related work',
      icon: icon(ArrowUpRight),
      body: (
        <div className="flex flex-col gap-6">
          {ai.neighbours.length > 0 ? (
            extra(<SemanticNeighbours items={ai.neighbours} onSelectProject={onSelectProject} hrefFor={caseStudyHref} />)
          ) : related.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-3">
              {related.map((r) => {
                const inner = (
                  <>
                    <ProjectImage
                      project={r}
                      sizes="(min-width: 640px) 240px, 100vw"
                      className="aspect-[16/10] w-full rounded-lg"
                    />
                    <span className="px-1 pb-1 text-sm font-medium text-text-primary">{r.name}</span>
                    <span className="px-1 pb-1 text-xs text-text-muted">{r.category}</span>
                  </>
                );
                const cls =
                  'flex h-full w-full flex-col gap-1.5 rounded-xl border border-hairline bg-surface-tint p-2 text-left ring-focus transition-colors hover:border-violet-bright';
                return (
                  <li key={r.slug}>
                    {onSelectProject ? (
                      <button type="button" className={cls} onClick={() => onSelectProject(r.slug)}>
                        {inner}
                      </button>
                    ) : (
                      <Link className={cls} href={hasCaseStudy(r) ? `/projects/${r.slug}` : `/?project=${r.slug}`}>
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {shared.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label="More projects by technology">
              {shared.map((f) => {
                const label = `More with ${f.name} (${f.count})`;
                return (
                  <li key={f.name}>
                    {onSelectTech ? (
                      <button type="button" className={CHIP} onClick={() => onSelectTech(f.name)}>
                        {label}
                      </button>
                    ) : (
                      <Link className={CHIP} href={`/?tech=${encodeURIComponent(f.name)}#projects`}>
                        {label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ),
    });
  }

  const [activeKey, setActiveKey] = useState<SectionKey>(sections[0].key);
  const sectionKeys = sections.map((s) => s.key).join(' ');

  // Highlights the section whose heading most recently crossed the top third.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const keys = sectionKeys.split(' ') as SectionKey[];
    const visible = new Set<SectionKey>();
    const root = scrollContainer?.current ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset.section as SectionKey;
          if (e.isIntersecting) visible.add(key);
          else visible.delete(key);
        }
        const first = keys.find((k) => visible.has(k));
        if (first) setActiveKey(first);
      },
      { root, rootMargin: '-15% 0px -60% 0px' },
    );
    for (const key of keys) {
      const el = document.getElementById(`${page ? '' : 'dialog-'}${project.slug}-${key}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [sectionKeys, scrollContainer, page, project.slug]);

  const jump = (key: SectionKey) => {
    const el = document.getElementById(idFor(key));
    const scroller = scrollContainer?.current;
    if (!el || !scroller) return;
    const top = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72;
    scroller.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    const heading = el.querySelector<HTMLElement>('h2, h3');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    setActiveKey(key);
  };

  const container = useMemo(
    () => (reduce ? INSTANT : staggerContainer(stagger.card, delay)),
    [reduce, delay],
  );
  const item = useMemo(() => revealVariants('fade-up', reduce, 0, lite), [reduce, lite]);

  const swipeable = Boolean(onSwipe) && isTouch && !reduce;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!onSwipe) return;
    if (info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY) onSwipe(1);
    else if (info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY) onSwipe(-1);
  };

  const hero = (
    <ProjectImage
      project={project}
      sizes={page ? '(min-width: 1280px) 1200px, 100vw' : '(min-width: 1024px) 1024px, 100vw'}
      alt={`${project.name} cover`}
      aiAlt={ai.alt}
      priority={page}
      loop="inView"
      allowVideo={allowVideo && !paused}
      layoutId={morph ? mediaLayoutId(project.slug) : undefined}
      className={cn('aspect-[16/10] w-full sm:aspect-[16/9]', page && 'rounded-2xl')}
    />
  );

  return (
    <article aria-labelledby={titleId} data-case-study={project.slug}>
      <header className="relative">
        <div className="relative">
          {swipeable ? (
            <motion.div
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.25}
              dragSnapToOrigin
              onDragEnd={onDragEnd}
              data-cursor="drag"
            >
              {hero}
            </motion.div>
          ) : (
            hero
          )}
          <div
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent',
              page ? 'rounded-2xl from-bg-base via-bg-base/50' : 'from-bg-surface via-bg-surface/50',
            )}
          />
        </div>

        <div className={cn('relative -mt-16 sm:-mt-24', page ? 'px-1 sm:px-8' : 'px-5 sm:px-10')}>
          <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-eyebrow uppercase text-violet-bright">
            <span>{project.category}</span>
            {project.featured ? <span className="text-cyan-text">Featured</span> : null}
          </p>
          <Title
            id={titleId}
            tabIndex={-1}
            className={cn(
              'font-display font-bold text-balance break-words text-text-primary',
              page ? 'text-4xl sm:text-6xl' : 'text-3xl sm:text-5xl',
            )}
          >
            <motion.span layoutId={morph ? titleLayoutId(project.slug) : undefined} className="inline-block">
              {project.name}
            </motion.span>
          </Title>
          <p className="mt-3 max-w-2xl text-lead text-text-secondary">{project.tagline}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              href={project.githubUrl}
              variant="secondary"
              cursor="open"
              leadingIcon={<Github aria-hidden="true" className="size-4" />}
            >
              Source on GitHub
            </Button>
            {project.liveUrl ? (
              <Button
                href={project.liveUrl}
                variant="primary"
                cursor="open"
                leadingIcon={<ExternalLink aria-hidden="true" className="size-4" />}
              >
                Live demo
              </Button>
            ) : null}
            <ShareProject project={project} url={shareUrl} />
            {!page && hasCaseStudy(project) ? (
              <Button asChild variant="ghost" trailingIcon={<ArrowUpRight aria-hidden="true" className="size-4" />}>
                <Link href={`/projects/${project.slug}`}>Full case study</Link>
              </Button>
            ) : null}
            {!page ? (
              <AIButton
                data-ask-project={project.slug}
                onClick={() => {
                  track('ai_handoff', { feature: 'ask', intent: 'project' });
                  if (host) host.askAbout(project.slug);
                  else openAssistant({ scope: { project: project.slug } });
                }}
              >
                Ask about this project
              </AIButton>
            ) : null}
          </div>
          {project.demoVideo && ai.demo ? (
            <DescribeDemo text={ai.demo.text} provenance={ai.demo.provenance} visible={!(allowVideo && !paused)} />
          ) : null}
        </div>
      </header>

      <div
        className={cn(
          'grid gap-10 pb-12 pt-10 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12',
          page ? 'px-1 sm:px-8' : 'px-5 sm:px-10',
        )}
      >
        <nav aria-label="On this page" className="hidden lg:block">
          <div className={cn('sticky', page ? 'top-28' : 'top-20')}>
            <p className="mb-3 font-mono text-eyebrow uppercase text-text-muted">On this page</p>
            <ol className="flex flex-col border-l border-hairline" data-project-toc="">
              {sections.map((s) => {
                const current = s.key === activeKey;
                const cls = cn(
                  '-ml-px flex min-h-9 w-full items-center border-l-2 px-3 text-left text-sm ring-focus transition-colors any-pointer-coarse:min-h-11',
                  current
                    ? 'border-violet-bright text-text-primary'
                    : 'border-transparent text-text-muted hover:text-text-primary',
                );
                return (
                  <li key={s.key}>
                    {page ? (
                      <a href={`#${idFor(s.key)}`} className={cls} aria-current={current ? 'location' : undefined}>
                        {s.toc}
                      </a>
                    ) : (
                      <button
                        type="button"
                        className={cls}
                        aria-current={current ? 'location' : undefined}
                        onClick={() => jump(s.key)}
                      >
                        {s.toc}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </nav>

        <motion.div className="flex min-w-0 flex-col gap-10" variants={container} initial="hidden" animate="visible">
          {sections.map((s) => (
            <motion.section
              key={s.key}
              id={idFor(s.key)}
              data-section={s.key}
              data-reveal=""
              variants={item}
              className={cn(page ? 'scroll-mt-28' : 'scroll-mt-20')}
            >
              <Heading className="mb-3 flex items-center gap-2 font-mono text-eyebrow uppercase text-violet-bright">
                {s.icon}
                {s.heading}
              </Heading>
              {s.body}
            </motion.section>
          ))}
        </motion.div>
      </div>
    </article>
  );
}

