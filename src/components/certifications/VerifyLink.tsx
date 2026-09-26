'use client';

import { useRef, useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import type { Certification } from '@/lib/certifications';
import { cn } from '@/utils/cn';

type Props = {
  cert: Pick<Certification, 'id' | 'title' | 'platform' | 'url'>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

/**
 * 'Verify', opening the issuer's own page for this credential in a new tab. Its
 * name says what it verifies and where ('Verify Claude 101 on Claude Academy').
 * A small sparkle plays beside the check on hover or focus; the player mounts on
 * the first hover, so a grid of 37 links never builds 37 players up front, and
 * under reduced motion it never mounts at all.
 */
export function VerifyLink({ cert, variant = 'outline', size = 'sm', className }: Props) {
  const ref = useRef<HTMLElement>(null);
  const { reduce } = useMotionPrefs();
  const [armed, setArmed] = useState(false);
  const arm = () => {
    if (!armed && !reduce) setArmed(true);
  };

  return (
    <Button
      ref={ref}
      href={cert.url}
      external
      variant={variant}
      size={size}
      cursor="open"
      ripple={false}
      aria-label={`Verify ${cert.title} on ${cert.platform}`}
      data-verify-link={cert.id}
      onPointerEnter={arm}
      onFocus={arm}
      className={cn('shrink-0', className)}
      leadingIcon={
        <span aria-hidden="true" className="relative inline-flex size-4 shrink-0">
          <BadgeCheck className="size-4" />
          {armed && !reduce ? (
            <LottieIcon
              name="sparkle"
              play="hover"
              loop={false}
              lazy={false}
              hoverTargetRef={ref}
              className="pointer-events-none absolute -right-3 -top-3 block size-5"
            />
          ) : null}
        </span>
      }
    >
      Verify
    </Button>
  );
}
