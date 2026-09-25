'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Crosshair } from 'lucide-react';
import { AIButton } from '@/components/ai/AIButton';
import { AIErrorState } from '@/components/ai/AIErrorState';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiJson } from '@/components/ai/useAiJson';
import { AI_LIMITS } from '@/lib/ai/config';
import type { EvidenceClass } from '@/lib/ai/protocol';
import { cn } from '@/utils/cn';

/*
 * The embedding space explorer on /ai. It loads public/ai/projection.json (2D
 * PCA of the corpus embeddings, points and labels only) once the section comes
 * near the viewport; it sends nothing to /api/ai until a visitor presses 'Plot
 * my question', which makes exactly one /api/ai/retrieve call and draws lines
 * to the chunks it returned.
 *
 * Keyboard: Tab reaches the map once; arrow keys move to the nearest point in
 * that direction, Home and End jump to the first and last. A sortable table
 * carries the same points for screen readers.
 */

export type MapPoint = { id: string; label: string; cls: EvidenceClass; x: number; y: number };
type Projection = { model: string | null; explained: number[]; points: MapPoint[] };
type Hit = { id: string; label: string; score: number; cosine: number | null; bm25: number };
type RetrieveResponse = { mode: 'hybrid' | 'lexical'; hits: Hit[] };
type Load = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; data: Projection };

export const PROJECTION_URL = '/ai/projection.json';

const CLASSES: { cls: EvidenceClass; label: string }[] = [
  { cls: 'self', label: 'Self: his own work' },
  { cls: 'reference', label: 'Reference: what a technology is' },
  { cls: 'live', label: 'Live: dated snapshots' },
];

function parseProjection(x: unknown): Projection | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as { model?: unknown; explained?: unknown; points?: unknown };
  if (!Array.isArray(o.points)) return null;
  const points = o.points.filter(
    (p): p is MapPoint =>
      !!p &&
      typeof p === 'object' &&
      typeof (p as MapPoint).id === 'string' &&
      typeof (p as MapPoint).label === 'string' &&
      ((p as MapPoint).cls === 'self' || (p as MapPoint).cls === 'reference' || (p as MapPoint).cls === 'live') &&
      Number.isFinite((p as MapPoint).x) &&
      Number.isFinite((p as MapPoint).y),
  );
  return {
    model: typeof o.model === 'string' ? o.model : null,
    explained: Array.isArray(o.explained) ? o.explained.filter((n): n is number => typeof n === 'number') : [],
    points,
  };
}

const DIRS: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** The closest point in a direction: distance along it, plus twice the sideways offset. */
function nearest(points: readonly MapPoint[], from: number, [dx, dy]: [number, number]): number {
  const p = points[from];
  let best = from;
  let bestScore = Infinity;
  points.forEach((q, i) => {
    if (i === from) return;
    const vx = q.x - p.x;
    const vy = q.y - p.y;
    const along = vx * dx + vy * dy;
    if (along <= 1e-9) return;
    const score = along + 2 * Math.abs(vx * dy - vy * dx);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return best;
}

function Marker({ p, active, onFocus, onHover, refFor, tabIndex }: {
  p: MapPoint;
  active: boolean;
  tabIndex: number;
  onFocus: () => void;
  onHover: () => void;
  refFor: (el: SVGElement | null) => void;
}) {
  const common = {
    ref: refFor,
    role: 'option',
    'aria-selected': active,
    'aria-label': `${p.label}, ${p.cls} evidence, at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`,
    tabIndex,
    'data-point': p.id,
    'data-cls': p.cls,
    className: cn('ai-lab-point', active && 'is-active'),
    onFocus,
    onPointerEnter: onHover,
  } as const;
  const cx = p.x;
  const cy = -p.y;
  const r = 0.022;
  if (p.cls === 'reference') return <rect {...common} x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={0.006} />;
  if (p.cls === 'live') return <polygon {...common} points={`${cx},${cy - r * 1.3} ${cx + r * 1.2},${cy + r} ${cx - r * 1.2},${cy + r}`} />;
  return <circle {...common} cx={cx} cy={cy} r={r} />;
}

type SortKey = 'label' | 'id' | 'cls' | 'x' | 'y';

function PointsTable({ points, onShow, captionId }: { points: readonly MapPoint[]; onShow: (id: string) => void; captionId: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'label', dir: 1 });
  const rows = useMemo(() => {
    const out = [...points];
    out.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return c * sort.dir;
    });
    return out;
  }, [points, sort]);

  const header = (key: SortKey, text: string, numeric = false) => {
    const on = sort.key === key;
    const Icon = !on ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th scope="col" aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('px-2 py-1 font-medium', numeric && 'text-right')}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}
          className="tap-safe-sm ring-focus -mx-1 gap-1 rounded px-1 text-text-secondary hover:text-text-primary"
        >
          {text}
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
        </button>
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table data-map-table="" aria-labelledby={captionId} className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption id={captionId} className="sr-only">
          Every point on the map: {points.length} chunks, with their evidence class and coordinates. Sortable by each column.
        </caption>
        <thead className="border-b border-hairline font-mono text-xs text-text-muted">
          <tr>
            {header('label', 'Label')}
            {header('id', 'Chunk id')}
            {header('cls', 'Class')}
            {header('x', 'x', true)}
            {header('y', 'y', true)}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-b border-hairline last:border-0">
              <th scope="row" className="px-2 py-0.5 font-normal">
                <button
                  type="button"
                  onClick={() => onShow(p.id)}
                  className="tap-safe-sm ring-focus -mx-1 justify-start rounded px-1 text-left text-text-primary hover:text-violet-bright"
                >
                  {p.label}
                  <span className="sr-only"> (show on map)</span>
                </button>
              </th>
              <td className="px-2 font-mono text-xs text-text-muted">{p.id}</td>
              <td className="px-2 text-text-secondary">{p.cls}</td>
              <td className="px-2 text-right font-mono text-xs tabular-nums text-text-secondary">{p.x.toFixed(3)}</td>
              <td className="px-2 text-right font-mono text-xs tabular-nums text-text-secondary">{p.y.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmbeddingMap() {
  const rootRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef(new Map<string, SVGElement>());
  const baseId = useId();
  const [load, setLoad] = useState<Load>({ status: 'idle' });
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  const search = useAiJson<RetrieveResponse>('/api/ai/retrieve');

  // Fetch the static projection only once the section is near the viewport.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let cancelled = false;
    const start = () => {
      setLoad({ status: 'loading' });
      fetch(PROJECTION_URL, { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: unknown) => {
          if (cancelled) return;
          const data = parseProjection(body);
          setLoad(data ? { status: 'ready', data } : { status: 'error' });
        })
        .catch(() => {
          if (!cancelled) setLoad({ status: 'error' });
        });
    };
    if (typeof IntersectionObserver === 'undefined') {
      const t = window.setTimeout(start, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, []);

  const points = useMemo(() => (load.status === 'ready' ? [...load.data.points].sort((a, b) => a.label.localeCompare(b.label)) : []), [load]);
  const indexOf = useMemo(() => new Map(points.map((p, i) => [p.id, i])), [points]);
  const counts = useMemo(() => {
    const c: Record<EvidenceClass, number> = { self: 0, reference: 0, live: 0 };
    for (const p of points) c[p.cls] += 1;
    return c;
  }, [points]);

  const focusPoint = (i: number) => {
    setActive(i);
    const p = points[i];
    if (p) pointRefs.current.get(p.id)?.focus({ preventScroll: false });
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (!points.length) return;
    let next: number | null = null;
    if (Object.hasOwn(DIRS, e.key)) next = nearest(points, active, DIRS[e.key]);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = points.length - 1;
    if (next === null) return;
    e.preventDefault();
    focusPoint(next);
  };

  const showOnMap = (id: string) => {
    const i = indexOf.get(id);
    if (i === undefined) return;
    rootRef.current?.querySelector('[data-map-svg]')?.scrollIntoView({ block: 'nearest' });
    focusPoint(i);
  };

  const plot = () => {
    const q = query.trim().slice(0, AI_LIMITS.retrieveQuery);
    if (!q || search.status === 'loading') return;
    setAsked(q);
    void search.run({ query: q, k: 5, scope: 'all' });
  };

  // The question has no vector of its own on the map: its marker sits at the
  // score-weighted centre of the matches that are on the map.
  const plotted = useMemo(() => {
    if (search.status !== 'done' || !search.data) return null;
    const hits = search.data.hits.slice(0, 5);
    const onMap = hits.map((h) => ({ h, p: points[indexOf.get(h.id) ?? -1] })).filter((x): x is { h: Hit; p: MapPoint } => Boolean(x.p));
    const total = onMap.reduce((n, x) => n + Math.max(x.h.score, 1e-6), 0);
    const centre = onMap.length
      ? {
          x: onMap.reduce((n, x) => n + x.p.x * Math.max(x.h.score, 1e-6), 0) / total,
          y: onMap.reduce((n, x) => n + x.p.y * Math.max(x.h.score, 1e-6), 0) / total,
        }
      : null;
    return { mode: search.data.mode, hits, onMap, centre };
  }, [search.status, search.data, points, indexOf]);

  const shown = hover ?? active;
  const detail = points[shown];
  const legendId = `${baseId}-legend`;
  const liveId = `${baseId}-live`;

  if (load.status !== 'ready') {
    return (
      <div ref={rootRef} data-map="" data-map-state={load.status} className="rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
        <p className="text-sm text-text-muted">{load.status === 'error'
            ? 'The map couldn’t be loaded. Reload the page to try again.'
            : load.status === 'loading'
              ? 'Loading the map…'
              : 'The map loads when this section scrolls into view.'}</p>
      </div>
    );
  }

  if (!points.length) {
    return (
      <div ref={rootRef} data-map="" data-map-state="empty" className="rounded-2xl border border-hairline bg-surface-tint p-5 sm:p-6">
        <p className="font-display text-xl font-semibold text-text-primary">Embeddings not generated yet</p>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-text-secondary">
          The map appears once every chunk of the site has an embedding. Until then, search by meaning runs on keywords alone (BM25), and this
          page has nothing to plot.
        </p>
        <pre
          tabIndex={0}
          role="region"
          aria-label="How to generate the map"
          className="mt-4 overflow-x-auto rounded-xl border border-hairline p-4 font-mono text-xs leading-relaxed text-text-secondary ring-focus"
        >
          {'npm run ai:embed\nnode scripts/ai/project-embeddings.mjs'}
        </pre>
      </div>
    );
  }

  const { data } = load;
  const centre = plotted?.centre ?? null;
  return (
    <div ref={rootRef} data-map="" data-map-state="ready" className="ai-lab-map flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 rounded-2xl border border-hairline bg-surface-tint p-3 sm:p-4">
          <svg
            data-map-svg=""
            viewBox="-1.12 -1.12 2.24 2.24"
            className="mx-auto block aspect-square w-full max-w-[36rem]"
            role="group"
            aria-label="Map of the site’s chunks by meaning"
            aria-describedby={legendId}
            onPointerLeave={() => setHover(null)}
          >
            <line x1={-1.1} y1={0} x2={1.1} y2={0} className="ai-lab-axis" />
            <line x1={0} y1={-1.1} x2={0} y2={1.1} className="ai-lab-axis" />
            {centre
              ? plotted?.onMap.map(({ p }) => (
                  <line key={p.id} x1={centre.x} y1={-centre.y} x2={p.x} y2={-p.y} className="ai-lab-qline" data-query-line={p.id} />
                ))
              : null}
            <g role="listbox" aria-label={`${points.length} chunks. Use the arrow keys to move between them.`} onKeyDown={onKeyDown}>
              {points.map((p, i) => (
                <Marker
                  key={p.id}
                  p={p}
                  active={i === active}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => setActive(i)}
                  onHover={() => setHover(i)}
                  refFor={(el) => {
                    if (el) pointRefs.current.set(p.id, el);
                    else pointRefs.current.delete(p.id);
                  }}
                />
              ))}
            </g>
            {centre ? (
              <g className="ai-lab-qmark" data-query-marker="" aria-hidden="true">
                <circle cx={centre.x} cy={-centre.y} r={0.05} />
                <circle cx={centre.x} cy={-centre.y} r={0.018} className="ai-lab-qdot" />
              </g>
            ) : null}
          </svg>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div id={legendId} className="text-sm text-text-secondary">
            <p className="font-semibold text-text-primary">Chunks of this site, by meaning</p>
            <p className="mt-1 text-text-muted">
              {points.length} chunks projected to two dimensions with PCA
              {data.explained.length === 2 ? ` (${Math.round((data.explained[0] + data.explained[1]) * 100)}% of the variance)` : ''}
              {data.model ? `, from ${data.model} embeddings` : ''}. Nearby points were embedded as similar; the axes have no names.
            </p>
            <ul className="mt-3 flex flex-col gap-1.5">
              {CLASSES.map((c) => (
                <li key={c.cls} className="flex items-center gap-2">
                  <svg viewBox="-1 -1 2 2" aria-hidden="true" className="size-3.5 shrink-0">
                    {c.cls === 'self' ? (
                      <circle r={0.8} className="ai-lab-point" data-cls="self" />
                    ) : c.cls === 'reference' ? (
                      <rect x={-0.75} y={-0.75} width={1.5} height={1.5} className="ai-lab-point" data-cls="reference" />
                    ) : (
                      <polygon points="0,-0.9 0.9,0.75 -0.9,0.75" className="ai-lab-point" data-cls="live" />
                    )}
                  </svg>
                  {c.label} <span className="font-mono text-xs text-text-muted">{counts[c.cls]}</span>
                </li>
              ))}
            </ul>
          </div>

          <div data-map-detail="" className="rounded-xl border border-hairline p-3 text-sm">
            <p className="font-mono text-xs text-text-dim">{hover !== null ? 'Pointing at' : 'Selected'}</p>
            {detail ? (
              <>
                <p className="mt-1 font-semibold text-text-primary [overflow-wrap:anywhere]">{detail.label}</p>
                <p className="font-mono text-xs text-text-muted [overflow-wrap:anywhere]">
                  {detail.id} · {detail.cls}
                </p>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <form
        className="flex flex-col gap-3 rounded-2xl border border-hairline p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          plot();
        }}
      >
        <label htmlFor={`${baseId}-q`} className="text-sm font-semibold text-text-primary">
          Plot a question of your own
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id={`${baseId}-q`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={AI_LIMITS.retrieveQuery}
            placeholder="e.g. agents that plan and review each other"
            className="ring-focus min-h-11 w-full min-w-0 rounded-xl border border-glass-border bg-transparent px-3 text-base text-text-primary placeholder:text-text-muted"
            aria-describedby={`${baseId}-q-note`}
          />
          <AIButton
            type="submit"
            pending={search.status === 'loading'}
            loadingLabel="Plotting…"
            disabled={!query.trim()}
            className="shrink-0 whitespace-nowrap"
            data-map-plot=""
          >
            Plot my question
          </AIButton>
        </div>
        <p id={`${baseId}-q-note`} className="text-xs leading-relaxed text-text-muted">
          One search request per press. When embeddings are on, your question goes to Google’s embedding model; nothing is stored.{' '}
          <a href="#privacy" className="ai-link ring-focus rounded-md">
            Privacy
          </a>
        </p>

        <p id={liveId} role="status" className="sr-only">
          {plotted ? `Plotted “${asked}”: ${plotted.hits.length} matches, ${plotted.onMap.length} on the map.` : ''}
        </p>

        {search.status === 'fallback' && search.fallback ? (
          <AIErrorState reason={search.fallback.reason} retryAfterSec={search.fallback.retryAfterSec} onRetry={plot} announce />
        ) : null}

        {plotted ? (
          <div data-map-hits="" className="text-sm">
            <SourceBadge source={plotted.mode === 'lexical' ? 'rules' : 'ai'} className="mb-2" />
            <p className="flex items-center gap-2 text-text-secondary">
              <Crosshair aria-hidden="true" className="size-4 shrink-0 text-violet-bright" />
              {plotted.mode === 'lexical'
                ? 'Matched by keywords (BM25): embeddings were not used for this question.'
                : 'Matched by keywords and meaning, fused. The marker sits at the score-weighted centre of the matches; your question itself isn’t on the map.'}
            </p>
            {plotted.hits.length ? (
              <ol className="mt-3 flex flex-col gap-1.5">
                {plotted.hits.map((h) => {
                  const onMap = indexOf.has(h.id);
                  return (
                    <li key={h.id} data-map-hit={h.id} className="flex flex-wrap items-baseline gap-x-2">
                      {onMap ? (
                        <button type="button" onClick={() => showOnMap(h.id)} className="tap-safe-sm ring-focus -mx-1 rounded px-1 text-left font-medium text-text-primary hover:text-violet-bright">
                          {h.label}
                        </button>
                      ) : (
                        <span className="font-medium text-text-primary">{h.label}</span>
                      )}
                      <span className="font-mono text-xs text-text-muted">
                        {h.id}
                        {h.cosine !== null ? ` · cosine ${h.cosine.toFixed(2)}` : ''} · BM25 {h.bm25.toFixed(2)}
                        {onMap ? '' : ' · not on the map'}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-2 text-text-muted">No chunk matched that question.</p>
            )}
          </div>
        ) : null}
      </form>

      <details className="ai-lab-details rounded-2xl border border-hairline">
        <summary className="ring-focus flex min-h-11 cursor-pointer items-center rounded-2xl px-5 text-sm font-semibold text-text-primary">
          The same points as a table ({points.length})
        </summary>
        <div className="px-3 pb-4 sm:px-5">
          <PointsTable points={points} onShow={showOnMap} captionId={`${baseId}-caption`} />
        </div>
      </details>
    </div>
  );
}

export default EmbeddingMap;
