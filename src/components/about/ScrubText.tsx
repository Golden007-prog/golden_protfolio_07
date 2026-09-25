'use client';

import { Fragment, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { useMotionValueEvent, useScroll } from 'framer-motion';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { cn } from '@/utils/cn';

type Props = { text: string; className?: string };

/**
 * The words brighten as the paragraph crosses the reading line and are all at full
 * strength once its end reaches 55% of the viewport, so it completes before
 * mid-screen. One scroll value writes --p; each word derives its own opacity from
 * --p and its index --i in CSS (story.css), with a floor of 0.6 so text is always
 * readable, even when someone stops scrolling halfway.
 */
function ScrubWords({ text, className }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 55%'] });

  const write = (p: number) => ref.current?.style.setProperty('--p', p.toFixed(3));
  useMotionValueEvent(scrollYProgress, 'change', write);
  useEffect(() => {
    ref.current?.style.setProperty('--p', scrollYProgress.get().toFixed(3));
  }, [scrollYProgress]);

  return (
    <>
      <p className="sr-only">{text}</p>
      <p
        ref={ref}
        aria-hidden="true"
        data-scrub=""
        className={cn('story-scrub', className)}
        style={{ '--n': words.length } as CSSProperties}
      >
        {words.map((word, i) => (
          <Fragment key={i}>
            <span data-scrub-word="" className="story-scrub-word" style={{ '--i': i } as CSSProperties}>
              {word}
            </span>
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </p>
    </>
  );
}

/**
 * A paragraph that brightens with scroll on desktop, and plain text on phones and
 * other lite devices and under reduced motion. The animated copy is hidden from
 * assistive tech and a single sr-only copy is read instead, so it is announced once.
 */
export function ScrubText({ text, className }: Props) {
  const { reduce, lite } = useMotionPrefs();
  if (reduce || lite) return <p className={className}>{text}</p>;
  return <ScrubWords text={text} className={className} />;
}
