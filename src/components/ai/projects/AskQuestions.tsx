'use client';

import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { CopyButton } from '@/components/ui/CopyButton';
import type { QuestionItem } from '@/lib/ai/prompts/projects';
import type { Provenance } from '@/lib/ai/reviewGate';
import { cn } from '@/utils/cn';

type Props = {
  projectName: string;
  items: readonly QuestionItem[];
  provenance: Provenance;
  className?: string;
};

/** The list as plain text for Copy all: numbered, one question per line. */
export function questionsText(projectName: string, items: readonly QuestionItem[]): string {
  return [`Questions to ask about ${projectName}:`, ...items.map((q, i) => `${i + 1}. ${q.text}`)].join('\n');
}

/**
 * 'Good questions to ask' (#206): three to five interview questions per featured
 * project, each shown with the quote its premise rests on. A native
 * details/summary, so it opens and closes without JavaScript on the static page.
 */
export function AskQuestions({ projectName, items, provenance, className }: Props) {
  return (
    <details className={cn('ai-questions group rounded-xl border border-hairline bg-surface-tint', className)} data-ai-questions="">
      <summary className="ai-questions-summary ring-focus">
        <span>
          {items.length} questions an interviewer could ask about {projectName}
        </span>
      </summary>
      <div className="flex flex-col gap-4 px-4 pb-4 md:px-5 md:pb-5">
        <ol className="flex flex-col gap-3">
          {items.map((q, i) => (
            <li key={q.text} className="flex gap-3" data-question="">
              <span aria-hidden="true" className="mt-0.5 font-mono text-xs tabular-nums text-cyan-text">
                {String(i + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-relaxed text-text-primary">{q.text}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  Based on: <q>{q.evidence[0]?.quote}</q>
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <CopyButton value={questionsText(projectName, items)} label="Copy all" copiedLabel="Copied" toastMessage="Questions copied" />
          <p className="text-xs text-text-muted" data-ai-provenance="">
            {provenance}
          </p>
        </div>
        <AIDisclosure compact />
      </div>
    </details>
  );
}

export default AskQuestions;
