'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { LottieIcon, preloadLottie } from '@/components/shared/LottieIcon';
import { Button, STATUS_LOTTIE_CLASS, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { track } from '@/lib/analytics';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

export type CopyButtonProps = {
  value: string;
  /** Visible label (or the aria-label when iconOnly). */
  label: string;
  copiedLabel?: string;
  /** When set, also shows a toast with this title. */
  toastMessage?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string;
  onCopied?: () => void;
};

const RESET_MS = 2000;

// The check is a neutral stroke on a violet disc; the default light map would
// darken both, so the check stays white there.
const COPY_CHECK_COLORS = { light: { '#E2E8F0': '#FFFFFF' } };

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies `value` to the clipboard with a check-mark flourish and a polite
 * announcement. Where the Clipboard API is refused (http, old in-app browsers)
 * it shows the text in a selected read-only field so it can be copied by hand.
 */
export function CopyButton({
  value,
  label,
  copiedLabel = 'Copied',
  toastMessage,
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  className,
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<number | undefined>(undefined);
  const { toast } = useToast();
  const inputId = useId();

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  useEffect(() => {
    if (!manual) return;
    const input = inputRef.current;
    input?.focus();
    input?.select();
  }, [manual]);

  const succeed = () => {
    setCopied(true);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), RESET_MS);
    if (toastMessage) toast({ title: toastMessage, tone: 'success' });
    if (value === SITE.email) track('copy_email');
    onCopied?.();
  };

  const copy = async () => {
    if (await writeClipboard(value)) {
      setManual(false);
      succeed();
    } else {
      setManual(true);
    }
  };

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', manual && 'w-full', className)}>
      <Button
        variant={iconOnly ? 'icon' : variant}
        size={size}
        cursor="copy"
        status={copied ? 'success' : 'idle'}
        successLabel={copiedLabel}
        statusIcons={{
          success: (
            <LottieIcon
              name="copyCheck"
              play="once"
              loop={false}
              lazy={false}
              colors={COPY_CHECK_COLORS}
              className={STATUS_LOTTIE_CLASS}
              fallback={<Check aria-hidden="true" className="size-4" />}
            />
          ),
        }}
        // Stays set while copied: Button shows the check in its place, and the hidden
        // resting icon and label hold the button at its resting width.
        leadingIcon={<Copy aria-hidden="true" className="size-4 shrink-0" />}
        aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
        data-copy-button=""
        onPointerEnter={() => preloadLottie('copyCheck')}
        onFocus={() => preloadLottie('copyCheck')}
        onClick={copy}
      >
        {iconOnly ? null : label}
      </Button>
      {manual ? (
        <span className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
          <label htmlFor={inputId} className="text-xs text-text-muted">
            Copy manually
          </label>
          <input
            id={inputId}
            ref={inputRef}
            readOnly
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            className="tap-safe w-full min-w-0 rounded-xl border border-glass-border-strong bg-glass-fill px-3 font-mono text-sm text-text-primary ring-focus"
          />
        </span>
      ) : null}
    </span>
  );
}
