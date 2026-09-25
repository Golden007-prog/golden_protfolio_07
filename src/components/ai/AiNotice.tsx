'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useHydrated } from '@/hooks/useHydrated';
import type { AiFeature } from '@/lib/ai/config';
import type { AiHealth } from '@/lib/ai/protocol';
import { safeStorage } from '@/lib/safeStorage';
import { cn } from '@/utils/cn';

/* ---- /api/ai/health, once per page ---- */

let healthRequest: Promise<AiHealth | null> | null = null;
let healthValue: AiHealth | null = null;

function isHealth(x: unknown): x is AiHealth {
  if (!x || typeof x !== 'object') return false;
  const o = x as Partial<AiHealth>;
  return typeof o.enabled === 'boolean' && (o.tier === 'free' || o.tier === 'paid' || o.tier === 'unknown');
}

/**
 * The server's own view of the AI stack (enabled, tier, active models). One GET
 * per page, shared by every caller; a failure resolves null and may be retried.
 * Call it only after a visitor opens an AI surface: pages make no /api/ai
 * request on load.
 */
export function fetchAiHealth(): Promise<AiHealth | null> {
  if (healthValue) return Promise.resolve(healthValue);
  healthRequest ??= fetch('/api/ai/health', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: unknown) => {
      healthValue = isHealth(body) ? body : null;
      if (!healthValue) healthRequest = null;
      return healthValue;
    })
    .catch(() => {
      healthRequest = null;
      return null;
    });
  return healthRequest;
}

/** fetchAiHealth() as state; null until it answers. Fetches nothing while `enabled` is false. */
export function useAiHealth(enabled = true): AiHealth | null {
  const [health, setHealth] = useState<AiHealth | null>(healthValue);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void fetchAiHealth().then((h) => {
      if (alive && h) setHealth(h);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);
  return health ?? healthValue;
}

/* ---- the notice ---- */

export const NOTICE_KEY = 'ob-ai-notice';

// Free-tier (and unknown-tier) wording errs toward the stricter terms.
const FREE_COPY =
  "Your text is sent to Google's Gemini API. This site stores none of it. On the free tier Google may use it to improve its products; don't paste confidential details.";
// Checked against ai.google.dev/gemini-api/terms (last modified 2026-04-28): on
// Paid Services Google doesn't use prompts or responses to improve its products
// and logs them for a limited period only to detect Prohibited Use Policy violations.
const PAID_COPY =
  "Your text is sent to Google's Gemini API. This site stores none of it. On the paid tier Google doesn't use it to improve its products and logs it for a limited time, only to detect abuse. Don't paste confidential details.";

type Props = {
  feature: AiFeature;
  /** Extra lines for this feature, under the data notice. */
  children?: ReactNode;
  /**
   * Runs on 'Got it', just before the notice unmounts. Required: the pressed button
   * goes with the notice, so this must move focus somewhere sensible (the field the
   * notice sits over) or it falls to <body>.
   */
  onDismiss: () => void;
  className?: string;
};

/**
 * What happens to text a visitor types into an AI feature, in the wording that
 * matches the tier /api/ai/health reports. Shown until the visitor dismisses it
 * once ('Got it', remembered in local storage). Render it inside a surface the
 * visitor opened, never on page load: it asks /api/ai/health for the tier.
 */
export function AiNotice({ feature, children, onDismiss, className }: Props) {
  const hydrated = useHydrated();
  const [dismissed, setDismissed] = useState(false);
  const hidden = !hydrated || dismissed || safeStorage.get(NOTICE_KEY) === '1';
  const health = useAiHealth(!hidden);
  if (hidden) return null;

  const copy = health?.tier === 'paid' ? PAID_COPY : FREE_COPY;
  return (
    <div
      role="note"
      aria-label="How your text is handled"
      data-ai-notice={feature}
      className={cn('rounded-2xl border border-hairline bg-surface-tint p-4 text-[13px] leading-relaxed text-text-secondary', className)}
    >
      <p className="flex items-start gap-2 text-text-secondary">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-text" />
        <span>{copy}</span>
      </p>
      {children ? <div className="mt-2">{children}</div> : null}
      <Button
        variant="secondary"
        size="md"
        className="mt-3"
        onClick={() => {
          safeStorage.set(NOTICE_KEY, '1');
          onDismiss();
          setDismissed(true);
        }}
      >
        Got it
      </Button>
    </div>
  );
}
