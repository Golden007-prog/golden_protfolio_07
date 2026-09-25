'use client';

import { useId } from 'react';
import { CircleCheck, CircleDashed, CircleMinus, MessageCircleQuestion } from 'lucide-react';
import { NOT_STATED, type FactRow, type FitEvidence, type FitRow as FitRowData } from '@/lib/ai/fit';
import { cn } from '@/utils/cn';

const STATUS = {
  evidenced: { label: 'Evidenced', icon: CircleCheck, tone: 'text-success' },
  adjacent: { label: 'Adjacent', icon: CircleDashed, tone: 'text-amber-text' },
  'not-listed': { label: 'Not listed on this site', icon: CircleMinus, tone: 'text-text-muted' },
} as const;

const CHIP =
  'tap-safe min-w-0 max-w-full justify-start gap-1.5 rounded-2xl border border-glass-border bg-glass-fill px-3 py-1.5 text-left text-[13px] leading-snug text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary';

function KindBadge({ kind }: { kind: FitRowData['kind'] }) {
  return (
    <span
      className={cn(
        'mr-2 inline-block rounded-full px-2 py-0.5 align-[1px] font-mono text-[10px] font-semibold uppercase tracking-wider',
        kind === 'must' ? 'bg-surface-tint text-cyan-text' : 'border border-hairline text-text-muted',
      )}
    >
      {kind === 'must' ? 'Must' : 'Nice'}
    </span>
  );
}

function EvidenceChip({ e, onOpen }: { e: FitEvidence; onOpen: (e: FitEvidence) => void }) {
  return (
    <button type="button" data-fit-evidence={e.id} data-cursor="open" onClick={() => onOpen(e)} className={CHIP}>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="text-text-primary">“{e.quote}”</span>
        <span className="text-text-muted"> · {e.label ?? e.id}</span>
      </span>
    </button>
  );
}

/** One matched requirement: plain status, verbatim evidence, and any AI mapping labelled as such. */
function MatchRow({ row, onEvidence }: { row: FitRowData; onEvidence: (e: FitEvidence) => void }) {
  const s = STATUS[row.status];
  const Icon = s.icon;
  const closest = row.status === 'not-listed' && row.evidence.length > 0;
  return (
    <tr role="row" data-fit-row={row.status} data-fit-source={row.source}>
      <th role="rowheader" scope="row" className="fit-cell fit-cell--req">
        <KindBadge kind={row.kind} />
        <span className="[overflow-wrap:anywhere]">{row.requirement}</span>
      </th>
      <td role="cell" data-label="On the site" className="fit-cell">
        <span className={cn('inline-flex items-center gap-1.5 font-medium', s.tone)}>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {s.label}
        </span>
        {row.synonym ? (
          <span data-fit-synonym="" className="mt-1 block text-xs text-text-muted">
            as <span className="text-text-secondary">{row.synonym}</span> · mapped by AI
          </span>
        ) : null}
        {row.source === 'lexical' && row.status === 'evidenced' ? <span className="mt-1 block text-xs text-text-muted">exact keyword match</span> : null}
      </td>
      <td role="cell" data-label="Evidence" className="fit-cell">
        {closest ? (
          <p className="mb-1.5 text-xs text-text-muted">
            Closest on the site <span className="rounded-full border border-hairline px-1.5 py-px text-[10px] uppercase tracking-wider text-amber-text">Adjacent</span>
          </p>
        ) : null}
        {row.evidence.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {row.evidence.map((e) => (
              <li key={e.id} className="min-w-0 max-w-full">
                <EvidenceChip e={e} onOpen={onEvidence} />
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

/** A years, education or logistics row, answered from the site's facts, never by the model. */
function FactLine({ row, onAsk }: { row: FactRow; onAsk: (row: FactRow) => void }) {
  const stated = row.answer !== null;
  return (
    <tr role="row" data-fit-fact={row.fact}>
      <th role="rowheader" scope="row" className="fit-cell fit-cell--req">
        <KindBadge kind={row.kind} />
        <span className="[overflow-wrap:anywhere]">{row.requirement}</span>
      </th>
      <td role="cell" data-label="On the site" className="fit-cell">
        <span className={cn('font-medium', stated ? 'text-text-secondary' : 'text-text-muted')}>{stated ? 'From the site’s facts' : NOT_STATED}</span>
      </td>
      <td role="cell" data-label="Evidence" className="fit-cell">
        {stated ? (
          <div className="text-[13px] leading-relaxed text-text-secondary">
            <p>{row.answer}</p>
            {row.lines.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {row.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <button type="button" data-fit-ask-fact={row.fact} onClick={() => onAsk(row)} className={cn(CHIP, 'text-text-primary')} data-fit-noprint="">
            <MessageCircleQuestion aria-hidden="true" className="size-4 shrink-0 text-cyan-text" />
            Ask him
          </button>
        )}
      </td>
    </tr>
  );
}

type Props = {
  rows: readonly FitRowData[];
  facts: readonly FactRow[];
  onEvidence: (e: FitEvidence) => void;
  onAskFact: (row: FactRow) => void;
  caption: string;
};

/**
 * The requirement-by-requirement table. Below 640px each row stacks into a card
 * (ai-recruiter.css); explicit roles keep it a table for screen readers.
 */
export function FitRowsTable({ rows, facts, onEvidence, onAskFact, caption }: Props) {
  const id = useId();
  if (!rows.length && !facts.length) return null;
  return (
    <table role="table" aria-labelledby={`${id}-cap`} data-fit-table="" className="fit-table w-full text-sm">
      <caption id={`${id}-cap`} className="sr-only">
        {caption}
      </caption>
      <thead className="fit-thead">
        <tr role="row">
          <th role="columnheader" scope="col" className="fit-cell fit-head">
            Requirement
          </th>
          <th role="columnheader" scope="col" className="fit-cell fit-head">
            On the site
          </th>
          <th role="columnheader" scope="col" className="fit-cell fit-head">
            Evidence
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <MatchRow key={`${r.requirement}-${i}`} row={r} onEvidence={onEvidence} />
        ))}
        {facts.map((f) => (
          <FactLine key={`${f.fact}-${f.requirement}`} row={f} onAsk={onAskFact} />
        ))}
      </tbody>
    </table>
  );
}
