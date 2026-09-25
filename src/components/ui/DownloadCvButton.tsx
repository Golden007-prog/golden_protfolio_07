'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { track } from '@/lib/analytics';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

export type DownloadCvButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  label?: string;
  /** Shows 'PDF · 75 KB' inside the button. */
  showMeta?: boolean;
  /** Adds a 'View' link that opens the PDF in a new tab. */
  showView?: boolean;
  magnetic?: boolean;
  className?: string;
};

/**
 * A plain same-origin <a download>, which saves as Oikantik-Basu-CV.pdf in iOS
 * Safari and in the LinkedIn and Gmail in-app browsers, where blob downloads fail.
 * The download-arrow animation plays after each click.
 */
export function DownloadCvButton({
  variant = 'primary',
  size = 'md',
  label = 'Download CV',
  showMeta = false,
  showView = false,
  magnetic = false,
  className,
}: DownloadCvButtonProps) {
  const [clicks, setClicks] = useState(0);

  const icon =
    clicks > 0 ? (
      <LottieIcon
        key={clicks}
        name="download"
        play="once"
        loop={false}
        lazy={false}
        className="-my-1 block size-6 shrink-0"
        fallback={<Download aria-hidden="true" className="size-4" />}
      />
    ) : (
      <Download aria-hidden="true" className="size-4 shrink-0" />
    );

  const download = (
    <Button
      href={SITE.cvPath}
      download={SITE.cvFileName}
      variant={variant}
      size={size}
      magnetic={magnetic}
      cursor="download"
      leadingIcon={icon}
      data-cv-download=""
      onClick={() => {
        track('cv_download');
        setClicks((n) => n + 1);
      }}
      className={showView ? undefined : className}
    >
      <span>{label}</span>
      {showMeta ? <span className="font-mono text-xs font-normal opacity-80">{SITE.cvMeta}</span> : null}
    </Button>
  );

  if (!showView) return download;

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      {download}
      <Button
        href={SITE.cvPath}
        external
        variant="ghost"
        size={size}
        cursor="view"
        onClick={() => track('cv_view')}
      >
        View<span className="sr-only"> CV</span>
      </Button>
    </span>
  );
}
