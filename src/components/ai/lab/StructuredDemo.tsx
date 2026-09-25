import { CheckCircle2, XCircle } from 'lucide-react';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { provenance, visibleEntries, type Store, type StoreEntry } from '@/lib/ai/reviewGate';
import { formatIsoDate } from '@/utils/dates';

/*
 * The recorded structured-output demo: three fixed inputs from the site's own
 * data, each run once through Gemini structured extraction by
 * scripts/ai/gen-lab.mjs. Every pane renders from src/data/ai-generated/lab.json,
 * so the demo makes no request. Server component; each pane is a labelled,
 * focusable region so keyboard users can scroll it.
 */

export type LabParse = { success: true; data: unknown } | { success: false; issues: { path: string; message: string }[] };

export type LabDemo = {
  title: string;
  source: string;
  task: string;
  input: string;
  schema: unknown;
  zodChecks: string[];
  raw: string | null;
  parse: LabParse;
};

const ORDER = ['citation', 'glossary', 'note-tag'];

function isDemo(v: unknown): v is LabDemo {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<LabDemo>;
  return (
    typeof o.title === 'string' &&
    typeof o.input === 'string' &&
    typeof o.task === 'string' &&
    typeof o.source === 'string' &&
    Array.isArray(o.zodChecks) &&
    (o.raw === null || typeof o.raw === 'string') &&
    !!o.parse &&
    typeof o.parse.success === 'boolean'
  );
}

/** The store's demos that may render, in a fixed order. */
export function labDemos(store: unknown, showUnreviewed: boolean): [string, StoreEntry<LabDemo>][] {
  const entries = visibleEntries(store as Store<unknown>, showUnreviewed);
  return Object.entries(entries)
    .filter((e): e is [string, StoreEntry<LabDemo>] => isDemo(e[1].value))
    .sort(([a], [b]) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
}

function Pane({ id, title, children, tone }: { id: string; title: string; children: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h4 id={id} className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        {title}
        {tone === 'ok' ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            <CheckCircle2 aria-hidden="true" className="size-3.5" /> passed
          </span>
        ) : tone === 'bad' ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-danger">
            <XCircle aria-hidden="true" className="size-3.5" /> failed
          </span>
        ) : null}
      </h4>
      <pre
        tabIndex={0}
        role="region"
        aria-labelledby={id}
        data-demo-pane=""
        className="ai-lab-pre ring-focus max-h-80 overflow-auto rounded-xl border border-hairline p-3 font-mono text-xs leading-relaxed text-text-secondary"
      >
        {children}
      </pre>
    </div>
  );
}

export function StructuredDemo({ demos }: { demos: [string, StoreEntry<LabDemo>][] }) {
  if (!demos.length) {
    return (
      <div data-demo-empty="" className="rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
        <p className="font-display text-xl font-semibold text-text-primary">No recorded demo yet</p>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-text-secondary">
          The three extractions are recorded once, with the owner’s key, and committed. Until then there is nothing to show, and this page
          never calls a model to fill the gap.
        </p>
        <pre
          tabIndex={0}
          role="region"
          aria-label="How to record the demo"
          className="mt-4 overflow-x-auto rounded-xl border border-hairline p-4 font-mono text-xs text-text-secondary ring-focus"
        >
          node --env-file-if-exists=.env scripts/ai/gen-lab.mjs
        </pre>
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-6">
      {demos.map(([key, entry]) => {
        const d = entry.value;
        const base = `demo-${key}`;
        const result = d.parse.success ? { success: true, data: d.parse.data } : { success: false, issues: d.parse.issues };
        return (
          <li key={key}>
            <article data-demo={key} aria-labelledby={`${base}-title`} className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
              <header className="flex flex-col gap-2">
                <h3 id={`${base}-title`} className="font-display text-xl font-semibold text-text-primary">
                  {d.title}
                </h3>
                <p className="text-sm text-text-secondary">{d.task}</p>
                <p className="text-sm text-text-muted">
                  Input, from <code className="font-mono text-xs">{d.source}</code>:
                </p>
                <blockquote className="border-l-2 border-violet-bright pl-3 text-sm leading-relaxed text-text-primary [overflow-wrap:anywhere]">
                  {d.input}
                </blockquote>
              </header>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Pane id={`${base}-schema`} title="1. JSON Schema sent">
                  {JSON.stringify(d.schema, null, 2)}
                </Pane>
                <Pane id={`${base}-raw`} title="2. Raw model reply">
                  {d.raw ?? '(no reply text: it was not valid JSON)'}
                </Pane>
                <Pane id={`${base}-parse`} title="3. zod safeParse result" tone={d.parse.success ? 'ok' : 'bad'}>
                  {JSON.stringify(result, null, 2)}
                </Pane>
              </div>

              <div className="text-sm text-text-secondary">
                <p className="font-semibold text-text-primary">What zod checks on the reply</p>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 marker:text-text-dim">
                  {d.zodChecks.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>

              <footer className="flex flex-col gap-2 border-t border-hairline pt-4">
                <p className="font-mono text-xs text-text-muted">
                  Recorded {formatIsoDate(entry.generatedAt) ?? entry.generatedAt} · {provenance(entry)}
                </p>
                <AIDisclosure model={entry.model} />
              </footer>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
