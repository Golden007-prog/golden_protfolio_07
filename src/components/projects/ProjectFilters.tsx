'use client';

import { motion } from 'framer-motion';
import { Radio, Search, Sparkles, X } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { FALLBACK_COPY } from '@/components/ai/AIErrorState';
import { AiThinking } from '@/components/ai/AiThinking';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiActionRunner } from '@/components/ai/useAiActionRunner';
import { useAiJson } from '@/components/ai/useAiJson';
import { Button } from '@/components/ui/Button';
import { CATEGORIES, PROJECTS, allTech, filterProjects, type ProjectFilter, type TechFacet } from '@/data/projects';
import { hashText, sessionGet, sessionSet } from '@/lib/ai/clientCache';
import {
  readingChips,
  readingMatches,
  shouldAskAi,
  toFilterAction,
  validateFilters,
  withoutKey,
  type FilterReading,
  type FilterVocab,
  type ProjectFiltersResponse,
  type ReadingKey,
} from '@/lib/ai/projectFilters';
import { track } from '@/lib/analytics';
import { spring } from '@/lib/motion';
import { readUrl, setUrlParams } from '@/lib/urlState';
import { cn } from '@/utils/cn';

const MAX_TECH_FACETS = 10;

const VOCAB: FilterVocab = { categories: CATEGORIES, techs: allTech().map((t) => t.name) };
const FEATURE = 'project-filters';

/**
 * Resolves once the throttled ?q write from typing has reached history (or after
 * 600ms), so the entry pushed before an AI reading holds the full text search.
 */
function settleUrl(): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const pending = readUrl().params.toString();
      const committed = new URLSearchParams(window.location.search).toString();
      if (pending === committed || Date.now() - started > 600) resolve();
      else window.setTimeout(check, 50);
    };
    check();
  });
}

type Props = {
  filter: ProjectFilter;
  /** Projects left after every filter. */
  shown: number;
  /** id of the grid the controls filter. */
  controls: string;
};

/** Removes every projects filter from the URL (the hash and ?project stay). */
export function clearProjectFilters(): void {
  setUrlParams({ q: null, cat: null, tech: null, live: null });
}

export function isFiltering(f: ProjectFilter): boolean {
  return Boolean(f.q || f.cat || f.tech || f.live);
}

function Pill({
  pressed,
  onClick,
  count,
  group,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  /** layoutId of the sliding active background, one per group. */
  group: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'relative isolate inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm ring-focus transition-colors duration-200',
        pressed
          ? 'border-transparent text-white'
          : 'border-glass-border-strong bg-glass-fill text-text-secondary hover:border-violet-bright hover:text-text-primary',
      )}
    >
      {pressed ? (
        <motion.span
          aria-hidden="true"
          layoutId={group}
          transition={spring.ui}
          className="absolute inset-0 -z-[1] rounded-full bg-violet"
        />
      ) : null}
      <span>{children}</span>
      {count !== undefined ? (
        <span className={cn('font-mono text-xs tabular-nums', pressed ? 'text-white' : 'text-text-muted')}>
          <span className="sr-only">, </span>
          {count}
          <span className="sr-only"> {count === 1 ? 'project' : 'projects'}</span>
        </span>
      ) : null}
    </button>
  );
}

/**
 * Search, category, technology and live-demo filters. All state lives in the URL
 * (?q ?cat ?tech ?live) through urlState, which merges writes and keeps the hash,
 * so a filtered view is a shareable link and the static page needs no Suspense.
 */
export function ProjectFilters({ filter, shown, controls }: Props) {
  const searchId = useId();
  const hintId = useId();
  const reader = useAiJson<ProjectFiltersResponse>(`/api/ai/${FEATURE}`);
  const runAction = useAiActionRunner();
  const [understood, setUnderstood] = useState<{ phrase: string; reading: FilterReading } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reading = understood && readingMatches(understood.reading, filter) ? understood : null;
  const fallbackNote =
    reader.status === 'fallback' && reader.fallback
      ? `${FALLBACK_COPY[reader.fallback.reason]?.text ?? ''} Showing a text search for your words instead.`.trim()
      : null;
  const showHint = shouldAskAi(filter.q, shown) && reader.status !== 'loading' && !reading;

  // A new history entry first, so Back returns to the filters as they were.
  const apply = async (next: FilterReading, phrase: string) => {
    await settleUrl();
    setUrlParams({}, { push: true });
    runAction(toFilterAction(next));
    setUnderstood({ phrase, reading: next });
  };

  // Enter only, never per keystroke. A failure leaves the phrase as today's text search.
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const phrase = filter.q.replace(/\s+/g, ' ').trim();
    if (!shouldAskAi(phrase, shown) || reader.status === 'loading') return;
    setNote(null);
    const key = await hashText(phrase.toLowerCase());
    const cached = sessionGet<FilterReading>(FEATURE, key);
    const hit = cached && validateFilters(cached, VOCAB, phrase);
    if (hit) {
      await apply(hit, phrase);
      return;
    }
    // On a fallback the hook's own state carries the reason; see `fallbackNote`.
    const res = await reader.run({ phrase });
    if (!res) return;
    const next = validateFilters(res.reading, VOCAB, phrase);
    if (!next) {
      setNote('The AI couldn’t turn that into filters, so this is a text search for your words.');
      return;
    }
    sessionSet(FEATURE, key, next);
    track('ai_ask', { feature: FEATURE });
    await apply(next, phrase);
  };

  const removeChip = (key: ReadingKey) => {
    if (!reading) return;
    const next = withoutKey(reading.reading, key);
    runAction(toFilterAction(next));
    setUnderstood(readingChips(next).length ? { phrase: reading.phrase, reading: next } : null);
  };

  const categories = useMemo(() => {
    const pool = filterProjects(PROJECTS, filter, 'cat');
    return CATEGORIES.map((name) => ({ name, count: pool.filter((p) => p.category === name).length }));
  }, [filter]);
  const allCount = useMemo(() => filterProjects(PROJECTS, filter, 'cat').length, [filter]);

  const techs = useMemo(() => {
    const facets: TechFacet[] = allTech(filterProjects(PROJECTS, filter, 'tech'))
      .filter((f) => f.count > 1)
      .slice(0, MAX_TECH_FACETS);
    if (filter.tech && !facets.some((f) => f.name === filter.tech)) {
      const count = filterProjects(PROJECTS, filter).length;
      facets.unshift({ name: filter.tech, count });
    }
    return facets;
  }, [filter]);

  const liveCount = useMemo(() => filterProjects(PROJECTS, filter, 'live').filter((p) => p.liveUrl).length, [filter]);
  const active = isFiltering(filter);

  return (
    <div className="mb-10 flex flex-col gap-4 md:mb-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <form role="search" onSubmit={onSubmit} className="relative min-w-0 sm:w-80" data-projects-search="">
          <label htmlFor={searchId} className="sr-only">
            Search projects
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            id={searchId}
            type="search"
            value={filter.q}
            onChange={(e) => {
              setNote(null);
              if (reader.status === 'fallback') reader.abort();
              setUrlParams({ q: e.target.value || null });
            }}
            placeholder="Search name, tech or topic"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            maxLength={160}
            aria-controls={controls}
            aria-describedby={showHint ? hintId : undefined}
            className="h-11 w-full rounded-full border border-glass-border-strong bg-glass-fill pl-11 pr-4 text-sm text-text-primary ring-focus transition-colors placeholder:text-text-muted hover:border-violet-bright"
          />
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <Pill
            pressed={filter.live}
            onClick={() => setUrlParams({ live: filter.live ? null : '1' })}
            count={liveCount}
            group="projects-live-pill"
          >
            <span className="inline-flex items-center gap-2">
              <Radio aria-hidden="true" className="size-4" />
              Live demo only
            </span>
          </Pill>
          {active ? (
            <Button variant="ghost" size="sm" onClick={clearProjectFilters} leadingIcon={<X aria-hidden="true" className="size-4" />}>
              Clear filters
            </Button>
          ) : null}
        </div>
        <p className="font-mono text-xs text-text-muted sm:ml-auto" aria-hidden="true">
          {shown} / {PROJECTS.length}
        </p>
      </div>

      <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
        <Pill pressed={!filter.cat} onClick={() => setUrlParams({ cat: null })} count={allCount} group="projects-cat-pill">
          All
        </Pill>
        {categories.map((c) => (
          <Pill
            key={c.name}
            pressed={filter.cat === c.name}
            onClick={() => setUrlParams({ cat: filter.cat === c.name ? null : c.name })}
            count={c.count}
            group="projects-cat-pill"
          >
            {c.name}
          </Pill>
        ))}
      </div>

      <div
        role="group"
        aria-label="Filter by technology"
        className="-m-1 flex gap-2 overflow-x-auto p-1 scrollbar-none sm:flex-wrap sm:overflow-visible"
      >
        {techs.map((t) => (
          <Pill
            key={t.name}
            pressed={filter.tech === t.name}
            onClick={() => setUrlParams({ tech: filter.tech === t.name ? null : t.name })}
            count={t.count}
            group="projects-tech-pill"
          >
            {t.name}
          </Pill>
        ))}
      </div>

      {reader.status === 'loading' ? (
        <AiThinking step="Reading your search…" />
      ) : showHint ? (
        <p id={hintId} className="flex items-center gap-2 text-xs text-text-muted" data-ai-filter-hint="">
          <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
          Press Enter to let AI turn this into filters.
        </p>
      ) : null}

      {note || fallbackNote ? (
        <p role="status" className="text-xs text-text-muted" data-ai-filter-note="">
          {note ?? fallbackNote}
        </p>
      ) : null}

      {reading ? (
        <div className="flex flex-wrap items-center gap-2" data-ai-understood="">
          <p className="flex items-center gap-1.5 text-xs text-text-muted">
            <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
            <span>
              AI understood <q className="text-text-secondary">{reading.phrase}</q> as
            </span>
          </p>
          <ul className="flex flex-wrap gap-2" aria-label="AI reading of your search">
            {readingChips(reading.reading).map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => removeChip(c.key)}
                  aria-label={`Remove ${c.name}`}
                  data-understood={c.key}
                  className="tap-safe gap-1.5 rounded-full border border-glass-border-strong bg-glass-fill px-3 text-xs text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary"
                >
                  {c.label}
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <SourceBadge source="ai" />
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite" aria-atomic="true" data-projects-status="">
        {shown} {shown === 1 ? 'project' : 'projects'}
      </p>
    </div>
  );
}
