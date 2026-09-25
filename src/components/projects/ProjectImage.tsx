'use client';

import Image, { type StaticImageData } from 'next/image';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Parallax } from '@/components/motion';
import { Reveal } from '@/components/motion/Reveal';
import type { Project } from '@/data/projects';
import { cn } from '@/utils/cn';
import bruhworkingNexusflow from '../../../public/images/projects/bruhworking-nexusflow/cover.webp';
import contentStoryteller from '../../../public/images/projects/content-storyteller/cover.webp';
import drugsSideEffectsAnalysis from '../../../public/images/projects/drugs-side-effects-analysis/cover.webp';
import ibmHrAttritionPrediction from '../../../public/images/projects/ibm-hr-attrition-prediction/cover.webp';
import mcqTechChallenge from '../../../public/images/projects/mcq-tech-challenge/cover.webp';
import netflixContentAnalytics from '../../../public/images/projects/netflix-content-analytics/cover.webp';
import omniLab from '../../../public/images/projects/omni-lab/cover.webp';
import tcsStockForecasting from '../../../public/images/projects/tcs-stock-forecasting/cover.webp';
import urbancareAi from '../../../public/images/projects/urbancare-ai/cover.webp';
import vyaparGyan from '../../../public/images/projects/vyapar-gyan/cover.webp';

// Static imports give next/image the intrinsic size and a build-time blur placeholder.
// Keep in step with scripts/fetch-project-media.mjs.
const STILLS: Readonly<Record<string, StaticImageData>> = {
  'urbancare-ai': urbancareAi,
  'bruhworking-nexusflow': bruhworkingNexusflow,
  'vyapar-gyan': vyaparGyan,
  'omni-lab': omniLab,
  'content-storyteller': contentStoryteller,
  'tcs-stock-forecasting': tcsStockForecasting,
  'drugs-side-effects-analysis': drugsSideEffectsAnalysis,
  'ibm-hr-attrition-prediction': ibmHrAttritionPrediction,
  'netflix-content-analytics': netflixContentAnalytics,
  'mcq-tech-challenge': mcqTechChallenge,
};

const IN_VIEW_RATIO = 0.6;

/** Shared-element ids for the card-to-dialog morph. */
export const mediaLayoutId = (slug: string) => `project-media-${slug}`;
export const titleLayoutId = (slug: string) => `project-title-${slug}`;

export type ProjectImageProps = {
  project: Pick<Project, 'slug' | 'thumbnail' | 'fallbackThumbnail' | 'demoVideo'>;
  /** next/image sizes for the frame this sits in. */
  sizes: string;
  alt?: string;
  priority?: boolean;
  /**
   * When the demo loop plays. 'hover': while `active` (the card is hovered or
   * focused). 'inView': while at least 60% visible (touch, and the dialog hero).
   */
  loop?: 'hover' | 'inView' | 'none';
  active?: boolean;
  /**
   * From the caller's one capability read: false on Save-Data, slow networks, small
   * screens, reduced motion and while the pause toggle is on.
   */
  allowVideo?: boolean;
  /** One clip-path reveal the first time the frame scrolls into view. */
  reveal?: boolean;
  /** A gentle scroll drift; Parallax turns itself off on lite devices and under reduce. */
  parallax?: boolean;
  /** Shared-element id for the card-to-dialog morph. */
  layoutId?: string;
  /**
   * Generated alt text for the still and the fallback artwork, passed only once
   * it may show (reviewed, or a draft off production; see selectCaseStudyAi).
   * The image keeps `alt` for whichever of the two has none.
   */
  aiAlt?: { still?: string; fallback?: string };
  className?: string;
};

function posterFor(video: string): string {
  return video.replace(/[^/]+\.mp4$/, 'poster.webp');
}

/**
 * A project's still, visible at rest, through next/image (srcset, AVIF/WebP, lazy,
 * blur-up). A failed still swaps to the generated fallback artwork. The demo loop
 * mounts only on intent and only where video is allowed, so Save-Data never
 * downloads a byte of it; it fades in once frames are actually playing.
 */
export function ProjectImage({
  project,
  sizes,
  alt = '',
  priority = false,
  loop = 'none',
  active = false,
  allowVideo = false,
  reveal = false,
  parallax = false,
  layoutId,
  aiAlt,
  className,
}: ProjectImageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [inView, setInView] = useState(false);
  const [intent, setIntent] = useState(false);
  const [playing, setPlaying] = useState(false);

  const canLoop = Boolean(project.demoVideo) && loop !== 'none' && allowVideo;
  const wantsPlay = canLoop && (loop === 'hover' ? active : inView);
  // The first sign of intent mounts the video; it then stays mounted, paused, so a
  // second hover resumes instantly.
  if (wantsPlay && !intent) setIntent(true);

  useEffect(() => {
    if (!canLoop || loop !== 'inView') return;
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setInView(Boolean(entry && entry.intersectionRatio >= IN_VIEW_RATIO)), {
      threshold: [0, IN_VIEW_RATIO],
    });
    io.observe(el);
    return () => io.disconnect();
  }, [canLoop, loop]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (wantsPlay) {
      video.play().catch(() => {
        /* autoplay refused or the element went away; the still stays */
      });
    } else {
      video.pause();
    }
  }, [wantsPlay, intent]);

  const still = STILLS[project.slug];
  const src = failed || !still ? project.fallbackThumbnail : still;
  const generated = src === still ? aiAlt?.still : aiAlt?.fallback;
  const image = (
    <Image
      src={src}
      alt={generated || alt}
      data-alt-source={generated ? 'ai' : undefined}
      fill
      sizes={sizes}
      priority={priority}
      placeholder={src === still ? 'blur' : 'empty'}
      onError={() => setFailed(true)}
      className="project-zoom object-cover"
    />
  );

  const media = (
    <>
      {parallax ? (
        <Parallax speed={0.05} className="absolute inset-x-0 -top-[6%] h-[112%]">
          {image}
        </Parallax>
      ) : (
        image
      )}
      {canLoop && intent && project.demoVideo ? (
        <video
          ref={videoRef}
          src={project.demoVideo}
          poster={posterFor(project.demoVideo)}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className={cn(
            'project-zoom absolute inset-0 size-full object-cover transition-opacity duration-500',
            playing && wantsPlay ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
    </>
  );

  return (
    <motion.div
      ref={frameRef}
      layoutId={layoutId}
      data-project-media={project.slug}
      data-fallback={src === still ? undefined : ''}
      className={cn('relative overflow-clip bg-surface-tint', className)}
    >
      {reveal ? (
        <Reveal variant="clip-up" className="absolute inset-0">
          {media}
        </Reveal>
      ) : (
        <div className="absolute inset-0">{media}</div>
      )}
    </motion.div>
  );
}
