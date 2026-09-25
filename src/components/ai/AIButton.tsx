'use client';

import { forwardRef } from 'react';
import { Sparkles } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/Button';

export type AIButtonProps = ButtonProps & {
  /** A request is running: spinner, aria-busy and the loading label. */
  pending?: boolean;
};

/**
 * The one entry point for AI actions: a Button with the sparkle mark, so a
 * visitor can tell at a glance which controls send text to Gemini.
 */
export const AIButton = forwardRef<HTMLElement, AIButtonProps>(function AIButton(
  { pending = false, status, loadingLabel = 'Thinking…', leadingIcon, variant = 'secondary', ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      {...(rest as ButtonProps)}
      variant={variant}
      status={pending ? 'loading' : status}
      loadingLabel={loadingLabel}
      leadingIcon={
        leadingIcon ?? (
          <Sparkles aria-hidden="true" className={variant === 'primary' ? 'size-4 shrink-0' : 'size-4 shrink-0 text-cyan-text'} />
        )
      }
      data-ai-button=""
    />
  );
});
