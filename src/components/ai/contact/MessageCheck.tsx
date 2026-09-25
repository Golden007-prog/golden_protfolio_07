'use client';

import { useRef, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { useAiJson } from '@/components/ai/useAiJson';
import { Button } from '@/components/ui/Button';
import { hashText, sessionGet, sessionSet } from '@/lib/ai/clientCache';
import { MESSAGE_MIN, normalizeCheck, ruleCheck, type CheckMissing, type CheckRequest, type CheckResponse, type CheckResult } from '@/lib/ai/draft';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';

const ENDPOINT = '/api/ai/draft';
const CACHE_FEATURE = 'draft-check';

const MISSING_COPY: Record<CheckMissing, string> = {
  role: 'What you would like him for: the role, project or collaboration',
  timeline: 'Your timeline, even a rough one',
  'how to reach you': 'How and when you would like a reply',
};

type Intent = { id: 'research' | 'fulltime' | 'freelance'; label: string };

type Shown = { forMessage: string; result: CheckResult; source: 'ai' | 'rules' };

type Props = {
  message: string;
  /** The form's topic chip. */
  intent: Intent['id'] | null;
  intents: readonly Intent[];
  onIntent: (id: Intent['id']) => void;
  className?: string;
};

/**
 * "Check my message" (#233): an optional look before sending. The route answers
 * enums only (what is missing, a likely topic, whether the message is really a
 * question the site already answers), shown as a gentle checklist, a topic chip
 * the visitor may accept, and the availability line with "Send anyway". When the
 * AI check isn't available a keyword check stands in. It never blocks Send: the
 * submit button works while a check is pending or after it failed. A result is
 * shown only while the message is unchanged since it was checked.
 */
export function MessageCheck({ message, intent, intents, onIntent, className }: Props) {
  const json = useAiJson<CheckResponse>(ENDPOINT);
  const [shown, setShown] = useState<Shown | null>(null);
  const [said, setSaid] = useState('');
  const run = useRef(0);

  const ready = message.trim().length >= MESSAGE_MIN;
  const pending = json.status === 'loading';
  const current = shown && shown.forMessage === message ? shown : null;

  const check = async () => {
    if (!ready) return;
    run.current += 1;
    const id = run.current;
    const text = message;
    setSaid('');
    const key = await hashText(text);
    const cached = normalizeCheck(sessionGet(CACHE_FEATURE, key));
    let next: Shown;
    if (cached) next = { forMessage: text, result: cached, source: 'ai' };
    else {
      const body: CheckRequest = { mode: 'check', message: text };
      const result = normalizeCheck(await json.run(body));
      if (run.current !== id) return;
      if (result) {
        sessionSet(CACHE_FEATURE, key, result);
        next = { forMessage: text, result, source: 'ai' };
      } else next = { forMessage: text, result: ruleCheck(text), source: 'rules' };
    }
    if (run.current !== id) return;
    setShown(next);
    const n = next.result.missing.length;
    setSaid(
      next.result.question === 'availability'
        ? 'Check done. The site already answers this question; the answer is below the button.'
        : n
          ? `Check done: ${n} ${n === 1 ? 'thing' : 'things'} you might add.`
          : 'Check done: nothing obvious is missing.',
    );
  };

  const suggestion = current && current.result.suggestedIntent !== 'none' ? intents.find((i) => i.id === current.result.suggestedIntent) : undefined;

  return (
    <div className={cn('space-y-3', className)} data-message-check="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AIButton
          variant="ghost"
          size="md"
          pending={pending}
          loadingLabel="Checking…"
          disabled={!ready}
          onClick={() => void check()}
          data-check-run=""
        >
          Check my message
        </AIButton>
        <p className="min-w-0 flex-1 basis-48 text-xs leading-5 text-text-muted">Optional. It never stops you sending.</p>
      </div>

      {current ? (
        <div className="ai-check rounded-2xl border border-hairline bg-surface-tint p-4" data-check-result={current.source}>
          {current.result.question === 'availability' ? (
            <div className="mb-4 border-b border-hairline pb-4" data-check-answer="">
              <p className="text-sm leading-6 text-text-secondary">
                The site already answers this. Oikantik is open to:{' '}
                <span className="font-medium text-text-primary" data-check-open-to="">
                  {SITE.availability.openTo}
                </span>
              </p>
              <Button type="submit" variant="secondary" size="md" className="mt-3" data-check-send="">
                Send anyway
              </Button>
            </div>
          ) : null}

          {current.result.missing.length ? (
            <>
              <p className="text-sm font-medium leading-6 text-text-secondary">You might add:</p>
              <ul className="mt-2 space-y-2" data-check-list="">
                {current.result.missing.map((m) => (
                  <li key={m} className="flex items-start gap-2 text-sm leading-6 text-text-secondary" data-check-item={m}>
                    <Circle aria-hidden="true" className="mt-1.5 size-3 shrink-0 text-text-muted" />
                    {MISSING_COPY[m]}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="flex items-start gap-2 text-sm leading-6 text-text-secondary" data-check-complete="">
              <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-success" />
              Nothing obvious is missing. Send it when you are ready.
            </p>
          )}

          {suggestion ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <p className="text-sm leading-6 text-text-secondary">It reads like:</p>
              <button
                type="button"
                aria-pressed={intent === suggestion.id}
                onClick={() => onIntent(suggestion.id)}
                data-check-intent={suggestion.id}
                className={cn(
                  'tap-safe gap-2 rounded-full border px-4 text-sm ring-focus transition-colors',
                  intent === suggestion.id
                    ? 'border-violet-bright bg-violet text-white'
                    : 'border-glass-border bg-glass-fill text-text-secondary hover:border-glass-border-strong hover:text-text-primary',
                )}
              >
                {intent === suggestion.id ? <Check aria-hidden="true" className="size-3.5" /> : null}
                {intent === suggestion.id ? `Topic: ${suggestion.label}` : `Use topic: ${suggestion.label}`}
              </button>
            </div>
          ) : null}

          <div className="mt-4">
            {current.source === 'ai' ? (
              <AIDisclosure compact />
            ) : (
              <p className="text-xs leading-5 text-text-muted" data-check-rules="">
                A quick keyword check, not AI: the AI check isn&apos;t available right now.
              </p>
            )}
          </div>
        </div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" data-check-status="">
        {said}
      </p>
    </div>
  );
}
