'use client';

import { useId, useMemo, useState } from 'react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AIErrorState } from '@/components/ai/AIErrorState';
import { useAiJson } from '@/components/ai/useAiJson';
import { CopyButton } from '@/components/ui/CopyButton';
import { hashText, sessionGet, sessionSet } from '@/lib/ai/clientCache';
import { clientCheckQuestions, type QuestionsResponse } from '@/lib/ai/fit';

export type QuestionItem = { requirement: string; ids: string[]; known: string };

type Props = {
  /** The evidenced rows: requirement text, evidence ids, and the quotes and labels shown for them. */
  items: readonly QuestionItem[];
};

type Shown = QuestionsResponse['questions'];

/**
 * 'What to ask him': five probing questions, each tied to one evidence id, on
 * the cheap tier. Only requirement texts and ids are sent; the server re-reads
 * the chunks and checks each premise. The client drops any question that cites
 * an id it didn't send or a number it wasn't shown.
 */
export function ScreeningQuestions({ items }: Props) {
  const id = useId();
  const api = useAiJson<QuestionsResponse>('/api/ai/jd-questions');
  const [cached, setCached] = useState<Shown | null>(null);
  const body = useMemo(() => ({ items: items.slice(0, 12).map((it) => ({ requirement: it.requirement, ids: it.ids.slice(0, 3) })) }), [items]);
  const sent = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) for (const x of it.ids) m.set(x, `${m.get(x) ?? ''} ${it.known}`);
    return m;
  }, [items]);

  const run = async () => {
    const key = await hashText(JSON.stringify(body));
    const hit = sessionGet<Shown>('jd-questions', key);
    if (hit) {
      setCached(hit);
      return;
    }
    setCached(null);
    const res = await api.run(body);
    if (res) sessionSet('jd-questions', key, res.questions);
  };

  const raw = cached ?? api.data?.questions ?? null;
  const questions = raw ? clientCheckQuestions(raw, sent) : null;
  const all = questions?.map((q, i) => `${i + 1}. ${q.question}`).join('\n') ?? '';

  if (!items.length) return null;
  return (
    <section aria-labelledby={`${id}-title`} data-fit-questions="" className="fit-block">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
        What to ask him
      </h3>
      {questions === null ? (
        <div className="mt-2" data-fit-noprint="">
          <AIButton variant="secondary" size="sm" pending={api.status === 'loading'} loadingLabel="Writing questions…" onClick={run} data-fit-questions-run="">
            Suggest screening questions
          </AIButton>
          {api.status === 'fallback' && api.fallback ? <AIErrorState reason={api.fallback.reason} onRetry={run} className="mt-3" /> : null}
        </div>
      ) : questions.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">No question could be checked against the site this time.</p>
      ) : (
        <>
          <ol className="mt-2 space-y-2 text-sm leading-relaxed text-text-secondary">
            {questions.map((q) => (
              <li key={q.question} data-fit-question={q.id} className="rounded-2xl border border-hairline bg-surface-tint p-3">
                <p className="text-text-primary">{q.question}</p>
                <p className="mt-1 text-xs text-text-muted">Based on: {q.label}</p>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap items-center gap-3" data-fit-noprint="">
            <CopyButton value={all} label="Copy all" copiedLabel="Questions copied" size="sm" variant="secondary" />
            <AIDisclosure compact />
          </div>
        </>
      )}
    </section>
  );
}
