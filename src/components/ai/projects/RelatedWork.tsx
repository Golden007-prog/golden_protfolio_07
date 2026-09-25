'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AiThinking } from '@/components/ai/AiThinking';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiJson } from '@/components/ai/useAiJson';
import { ProjectImage } from '@/components/projects/ProjectImage';
import { PROJECTS, getProjectBySlug, type Project, type ProjectFilter } from '@/data/projects';
import type { AiTarget } from '@/lib/ai/protocol';
import { filterQuery, looseRank } from '@/lib/ai/projectFilters';
import { cn } from '@/utils/cn';

/** The part of POST /api/ai/retrieve's answer this reads. */
type RetrieveBody = { mode: 'hybrid' | 'lexical'; hits: { id: string; target: AiTarget }[] };

const LIMIT = 3;

function projectsOf(body: RetrieveBody | null): Project[] {
  const out: Project[] = [];
  for (const h of body?.hits ?? []) {
    if (h.target?.kind !== 'project') continue;
    const p = getProjectBySlug(h.target.slug);
    if (p && !out.includes(p)) out.push(p);
    if (out.length >= LIMIT) break;
  }
  return out;
}

type Props = {
  filter: ProjectFilter;
  /** Opens a project's dialog. */
  onOpen: (slug: string) => void;
  className?: string;
};

/**
 * The empty grid's 'Find related work with AI' (#203). It asks /api/ai/retrieve
 * (semantic when vectors and a key exist, BM25 otherwise) for the three closest
 * projects to the current filters and shows them captioned with their own
 * taglines, so no text is generated. If the route cannot be reached, a looser
 * word match runs in the browser. It never touches the URL.
 */
export function RelatedWorkFinder({ filter, onOpen, className }: Props) {
  const query = filterQuery(filter);
  const search = useAiJson<RetrieveBody>('/api/ai/retrieve');
  const failed = search.status === 'fallback';
  const results = useMemo(
    () => (failed ? looseRank(PROJECTS, query, LIMIT) : projectsOf(search.data)),
    [failed, query, search.data],
  );
  const semantic = !failed && search.data?.mode === 'hybrid';
  const settled = search.status === 'done' || failed;

  if (!query) return null;

  return (
    <div className={cn('flex w-full max-w-3xl flex-col items-center gap-4', className)} data-ai-related="">
      {search.status === 'idle' ? (
        <AIButton onClick={() => void search.run({ query, k: LIMIT, scope: 'projects' })}>Find related work with AI</AIButton>
      ) : null}
      {search.status === 'loading' ? <AiThinking step="Looking for related projects…" /> : null}

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {settled ? (results.length ? `${results.length} related ${results.length === 1 ? 'project' : 'projects'} found` : 'Nothing related found') : ''}
      </p>

      {settled && results.length === 0 ? <p className="text-sm text-text-muted">Nothing on this site is close to that.</p> : null}

      {settled && results.length > 0 ? (
        <>
          <ul className="grid w-full gap-3 text-left sm:grid-cols-3" aria-label="Related projects">
            {results.map((p) => (
              <li key={p.slug}>
                <button
                  type="button"
                  onClick={() => onOpen(p.slug)}
                  data-related-slug={p.slug}
                  data-cursor="open"
                  className="flex h-full w-full flex-col gap-2 rounded-xl border border-hairline bg-surface-tint p-2 text-left ring-focus transition-colors hover:border-violet-bright"
                >
                  <ProjectImage project={p} sizes="(min-width: 640px) 240px, 100vw" className="aspect-[16/10] w-full rounded-lg" />
                  <span className="px-1 text-sm font-medium text-text-primary">{p.name}</span>
                  <span className="px-1 pb-1 text-xs leading-relaxed text-text-muted">{p.tagline}</span>
                </button>
              </li>
            ))}
          </ul>
          {semantic ? (
            <AIDisclosure note="Ranked by meaning with Gemini embeddings. Captions are the projects’ own taglines." />
          ) : (
            <SourceBadge source="rules" />
          )}
        </>
      ) : null}
    </div>
  );
}

/** 'shared tech: 2 · semantic: 0.82' under a case study's related project (#204). */
export function NeighbourCaption({ shared, cosine, className }: { shared: number; cosine: number; className?: string }) {
  return (
    <span className={cn('px-1 pb-1 font-mono text-[11px] tabular-nums text-text-muted', className)} data-neighbour-score={cosine.toFixed(2)}>
      shared tech: {shared} · semantic: {cosine.toFixed(2)}
    </span>
  );
}

type NeighboursProps = {
  items: readonly { slug: string; cosine: number; shared: number }[];
  /** Dialog: open in place. Without it (the case-study page) the items are links. */
  onSelectProject?: (slug: string) => void;
  /** Where a link goes: the case-study page or the home-page dialog. */
  hrefFor: (slug: string) => string;
};

const CARD =
  'flex h-full w-full flex-col gap-1.5 rounded-xl border border-hairline bg-surface-tint p-2 text-left ring-focus transition-colors hover:border-violet-bright';

/**
 * A case study's related work ranked by precomputed embedding similarity (#204),
 * each captioned with how many tech families it shares and its cosine score.
 * Only rendered when the store has neighbours, which needs ai-vectors.json.
 */
export function SemanticNeighbours({ items, onSelectProject, hrefFor }: NeighboursProps) {
  const rows = items.flatMap((n) => {
    const p = getProjectBySlug(n.slug);
    return p ? [{ ...n, p }] : [];
  });
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-3" data-ai-neighbours="">
      <ul className="grid gap-3 sm:grid-cols-3">
        {rows.map(({ p, shared, cosine }) => {
          const inner = (
            <>
              <ProjectImage project={p} sizes="(min-width: 640px) 240px, 100vw" className="aspect-[16/10] w-full rounded-lg" />
              <span className="px-1 text-sm font-medium text-text-primary">{p.name}</span>
              <span className="px-1 text-xs text-text-muted">{p.category}</span>
              <NeighbourCaption shared={shared} cosine={cosine} />
            </>
          );
          return (
            <li key={p.slug}>
              {onSelectProject ? (
                <button type="button" className={CARD} onClick={() => onSelectProject(p.slug)}>
                  {inner}
                </button>
              ) : (
                <Link className={CARD} href={hrefFor(p.slug)}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <AIDisclosure note="Ranked by meaning with Gemini embeddings of each write-up. Semantic is cosine similarity; 1 would be identical." />
    </div>
  );
}

export default RelatedWorkFinder;
