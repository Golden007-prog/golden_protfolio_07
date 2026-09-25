'use client';

import type { ReactNode } from 'react';
import { CloudOff, Coffee, Hourglass, SearchX, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { aiSession } from '@/lib/ai/circuit';
import type { AiFallbackReason } from '@/lib/ai/protocol';
import { cn } from '@/utils/cn';

type Copy = { text: string; icon: typeof Coffee; retry: boolean };

const RESTING: Copy = { text: 'AI is resting for today, quick answers still work.', icon: Coffee, retry: false };
const RELOAD: Copy = { text: "That request couldn't be sent. Reload the page and try again.", icon: CloudOff, retry: false };

/** Calm copy for every fallback reason. Never alarming, never a red toast. */
export const FALLBACK_COPY: Record<AiFallbackReason, Copy> = {
  quota: RESTING,
  'no-key': RESTING,
  disabled: RESTING,
  'feature-off': { text: 'This AI feature is switched off right now. Everything else on the site still works.', icon: Coffee, retry: false },
  timeout: { text: 'The AI took too long to answer. Quick answers still work.', icon: Hourglass, retry: true },
  upstream: { text: "The AI service didn't answer. Quick answers still work.", icon: CloudOff, retry: true },
  'rate-limited': { text: "That's a lot of questions in a short time.", icon: Hourglass, retry: true },
  'low-relevance': { text: 'Nothing on this site covers that.', icon: SearchX, retry: false },
  unverified: {
    text: "The answer couldn't be checked against the site, so it isn't shown.",
    icon: ShieldQuestion,
    retry: true,
  },
  safety: { text: "That's not something this assistant can answer.", icon: ShieldQuestion, retry: false },
  'too-long': { text: 'That is longer than this can take. Try a shorter version.', icon: CloudOff, retry: false },
  'bad-request': RELOAD,
  origin: RELOAD,
  bot: { text: "This browser couldn't be verified. Reload the page and try again.", icon: CloudOff, retry: false },
};

type Props = {
  reason: AiFallbackReason;
  /** Shown only for reasons worth retrying, and never while the session circuit is open. */
  onRetry?: () => void;
  retryAfterSec?: number;
  /** Speak the message through a polite region (default). Off when the surrounding UI announces it. */
  announce?: boolean;
  /** A handoff or the non-AI answer, shown under the message. */
  children?: ReactNode;
  className?: string;
};

export function AIErrorState({ reason, onRetry, retryAfterSec, announce = true, children, className }: Props) {
  const copy = FALLBACK_COPY[reason] ?? FALLBACK_COPY.upstream;
  const Icon = copy.icon;
  const wait = reason === 'rate-limited' && retryAfterSec ? Math.ceil(retryAfterSec) : 0;
  const canRetry = Boolean(onRetry) && copy.retry && !aiSession.blocked();
  return (
    <div
      data-ai-error={reason}
      className={cn('rounded-2xl border border-hairline bg-surface-tint p-4 text-sm leading-relaxed text-text-secondary', className)}
    >
      {/* Only the message is live, so a rule answer passed as children isn't read out with it. */}
      <p role={announce ? 'status' : undefined} className="flex items-start gap-2 text-text-secondary">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
        <span>
          {copy.text}
          {reason === 'rate-limited' ? (wait ? ` Try again in about ${wait} ${wait === 1 ? 'second' : 'seconds'}.` : ' Give it a minute.') : null}
        </span>
      </p>
      {children ? <div className="mt-3">{children}</div> : null}
      {canRetry ? (
        <Button variant="ghost" size="md" className="-mb-2 -ml-3 mt-1" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
