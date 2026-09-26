'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { track } from '@/lib/analytics';
import { COREFORGE_PATHS } from '@/lib/coreforge/facts';
import { cfUrl } from '@/lib/coreforge/links';
import { SHARE_COPY } from '@/lib/coreforge/section-copy';

type Props = {
  /** goldensdmat.in path to share (UTM-tagged with the placement). Ignored when `url` is set. */
  path?: string;
  /** Share this exact URL instead, e.g. the portfolio's own /ventures/coreforge page. */
  url?: string;
  placement?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  label?: string;
  className?: string;
};

type Status = 'idle' | 'loading' | 'success';

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/**
 * Shares CoreForge through the Web Share API where the browser has it, and otherwise
 * copies the link and confirms with a toast. Cancelling the share sheet is not an error.
 */
export function ShareButton({
  path = COREFORGE_PATHS.home,
  url,
  placement = 'share',
  variant = 'secondary',
  size = 'md',
  label = SHARE_COPY.label,
  className,
}: Props) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>('idle');
  const shareUrl = url ?? cfUrl(path, placement);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: SHARE_COPY.copied, description: SHARE_COPY.copiedDescription, tone: 'success' });
      track('share_project', { project: 'coreforge', method: 'copy', placement });
      setStatus('success');
    } catch {
      // No clipboard either (insecure context, permissions): show the link to copy by hand.
      toast({ title: SHARE_COPY.failed, description: shareUrl, tone: 'error', duration: 0 });
      setStatus('idle');
    }
  };

  const onClick = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    const data: ShareData = { title: SHARE_COPY.title, text: SHARE_COPY.text, url: shareUrl };
    if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        track('share_project', { project: 'coreforge', method: 'native', placement });
        setStatus('idle');
        return;
      } catch (e) {
        if (isAbort(e)) {
          setStatus('idle');
          return;
        }
      }
    }
    await copy();
    window.setTimeout(() => setStatus('idle'), 1800);
  };

  return (
    <Button
      variant={variant}
      size={size}
      status={status}
      successLabel={SHARE_COPY.copied}
      onClick={onClick}
      leadingIcon={<Share2 aria-hidden="true" className="size-4 shrink-0" />}
      className={className}
      data-cf-share=""
    >
      {label}
    </Button>
  );
}

export default ShareButton;
