'use client';

import { memo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { motion } from 'framer-motion';
import { ExternalLink, Github, Sparkles } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import type { BentoSize, Project } from '@/data/projects';
import { useRenderCount } from '@/lib/devRenderCount';
import { cn } from '@/utils/cn';
import { mediaLayoutId, ProjectImage, titleLayoutId } from './ProjectImage';


type Props = {
  project: Project;
  size?: BentoSize;
  onOpen: (slug: string) => void;
  /** This card's project is showing in the dialog. */
  isOpen?: boolean;
  /** From the section's one capability read. */
  allowVideo: boolean;
  isTouch: boolean;
  /** Shared-element ids for the morph; off under reduced motion. */
  morph: boolean;
};

const SIZES: Record<BentoSize, string> = {
  lead: '(min-width: 1024px) 60vw, 100vw',
  wide: '(min-width: 768px) 50vw, 100vw',
  normal: '(min-width: 1024px) 30vw, (min-width: 768px) 50vw, 100vw',
};

const TECH_SHOWN: Record<BentoSize, number> = { lead: 6, wide: 5, normal: 4 };

export const openButtonId = (slug: string) => `project-open-${slug}`;

/**
 * One project in the grid. The title is a button stretched over the whole card
 * (after:absolute), so the card has one tab stop that opens the dialog, while the
 * Live demo and Code links sit above it (z-10) as separate, real links.
 */
export const ProjectCard = memo(function ProjectCard({
  project,
  size = 'normal',
  onOpen,
  isOpen = false,
  allowVideo,
  isTouch,
  morph,
}: Props) {
  useRenderCount('ProjectCard');
  const cardRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lead = size === 'lead';
  const shownTech = project.techStack.slice(0, TECH_SHOWN[size]);
  const extraTech = project.techStack.length - shownTech.length;

  const open = () => {
    // Commit the untilted card first, so the morph starts from its true rectangle.
    flushSync(() => setPressed(true));
    onOpen(project.slug);
  };

  return (
    <GlassCard
      as="article"
      ref={cardRef}
      strong
      spotlight
      tilt={pressed || isOpen ? false : 4}
      blur="none"
      data-project-card={project.slug}
      aria-labelledby={openButtonId(project.slug)}
      className={cn('project-card group flex h-full flex-col', project.featured && 'featured-card')}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <ProjectImage
        project={project}
        sizes={SIZES[size]}
        loop={isTouch ? 'inView' : 'hover'}
        active={hovered || focused}
        allowVideo={allowVideo}
        reveal
        parallax={lead}
        layoutId={morph ? mediaLayoutId(project.slug) : undefined}
        className={cn('aspect-[16/10] w-full shrink-0', lead && 'lg:aspect-auto lg:min-h-72 lg:flex-1')}
      />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-glass-border bg-bg-surface/90 px-2.5 py-1 font-mono text-[11px] text-text-secondary">
          {project.category} · {project.language}
        </span>
        {project.featured ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-glass-border bg-bg-surface/90 py-1 pl-1.5 pr-2.5 font-mono text-[11px] text-text-primary">
            <LottieIcon
              name="sparkle"
              play="hover"
              loop={false}
              lazy="idle"
              hoverTargetRef={cardRef}
              className="block size-4 shrink-0"
              fallback={<Sparkles aria-hidden="true" className="size-3.5 text-violet-bright" />}
            />
            Featured
          </span>
        ) : null}
      </div>

      <div className={cn('flex flex-1 flex-col p-5 sm:p-6', lead && 'lg:flex-none lg:p-8')}>
        <h3 className={cn('font-display font-semibold text-text-primary', lead ? 'text-h3' : 'text-xl')}>
          <button
            type="button"
            id={openButtonId(project.slug)}
            aria-haspopup="dialog"
            data-cursor="view"
            onClick={open}
            className={cn(
              'text-left outline-none transition-colors duration-300 group-hover:text-violet-bright',
              "after:absolute after:inset-0 after:z-[1] after:rounded-[inherit] after:content-['']",
              'focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus-ring focus-visible:after:outline-solid',
            )}
          >
            <motion.span layoutId={morph ? titleLayoutId(project.slug) : undefined} className="inline-block">
              {project.name}
            </motion.span>
          </button>
        </h3>
        <p className="mt-1.5 text-sm leading-snug text-cyan-text">{project.tagline}</p>

        {lead && project.problem ? (
          <p className="mt-5 hidden border-l-2 border-violet-bright/60 pl-4 text-lead text-text-secondary md:block">
            {project.problem}
          </p>
        ) : null}
        {lead && project.solution ? (
          <p className="mt-3 hidden text-sm leading-relaxed text-text-secondary lg:block">{project.solution}</p>
        ) : null}
        <p className={cn('mt-3 text-sm leading-relaxed text-text-muted', lead ? 'line-clamp-4' : 'line-clamp-3')}>
          {project.shortDescription}
        </p>

        <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Technologies">
          {shownTech.map((t) => (
            <li
              key={t}
              className="rounded-md border border-hairline bg-surface-tint px-2 py-0.5 text-[11px] leading-5 text-text-muted"
            >
              {t}
            </li>
          ))}
          {extraTech > 0 ? (
            <li className="px-1 text-[11px] leading-5 text-text-dim">
              +{extraTech}
              <span className="sr-only"> more</span>
            </li>
          ) : null}
        </ul>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
          {project.liveUrl ? (
            <Button
              href={project.liveUrl}
              size="sm"
              variant="primary"
              cursor="open"
              leadingIcon={<ExternalLink aria-hidden="true" className="size-3.5" />}
              className="z-10"
            >
              Live demo<span className="sr-only"> of {project.name}</span>
            </Button>
          ) : null}
          <Button
            href={project.githubUrl}
            size="sm"
            variant="secondary"
            cursor="open"
            leadingIcon={<Github aria-hidden="true" className="size-3.5" />}
            className="z-10"
          >
            Code<span className="sr-only"> for {project.name}</span>
          </Button>
        </div>
      </div>
    </GlassCard>
  );
});
