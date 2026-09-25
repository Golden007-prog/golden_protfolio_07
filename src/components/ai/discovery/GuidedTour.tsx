'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, X } from 'lucide-react';
import store from '@/data/ai-generated/discovery.json';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import { CONTACT_COPY, PHILOSOPHY, SECTION_COPY } from '@/data/site-copy';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AiNotice } from '@/components/ai/AiNotice';
import { ReadAloud } from '@/components/ai/ReadAloud';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiJson } from '@/components/ai/useAiJson';
import { announce, spotlight } from '@/components/ai/useAiActionRunner';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { AI_LIMITS, SHOW_UNREVIEWED } from '@/lib/ai/config';
import { visible, type Store } from '@/lib/ai/reviewGate';
import {
  defaultStops,
  GOAL_PRESETS,
  normalizeStops,
  presetFor,
  tourCatalogOf,
  tourDataOf,
  tourKey,
  tourLine,
  type DiscoveryInputs,
  type GoalPresetId,
  type TourStopView,
  type TourTarget,
} from '@/lib/ai/tour';
import { track } from '@/lib/analytics';
import { duration, ease } from '@/lib/motion';
import { SECTIONS } from '@/lib/site';
import { findTarget } from '@/lib/urlState';

/*
 * 'Show me around': a goal picker, then a pill above the dock that walks the page
 * stop by stop. The goal chips use stop orders precomputed by gen-discovery.mjs
 * (or a built-in order until they exist) and make no request. A typed goal asks
 * POST /api/ai/tour for an order of stop ids only; every word the pill shows
 * comes from the site's data through tourLine().
 */

const INPUTS: DiscoveryInputs = {
  profile,
  projects: PROJECTS,
  sections: SECTIONS,
  sectionCopy: SECTION_COPY,
  tenets: PHILOSOPHY,
  contact: CONTACT_COPY,
};
const CATALOG = tourCatalogOf(INPUTS);
const DATA = tourDataOf(INPUTS);
const FEATURED = PROJECTS.filter((p) => p.featured).map((p) => p.slug);
const STORE = store as unknown as Store<unknown>;

type TourSource = 'ai' | 'rules';
type Tour = { stops: TourStopView[]; source: TourSource; note?: string };
type TourResponse = { stops: string[]; model: string };

const views = (ids: readonly string[]) => ids.map((id) => tourLine(id, DATA)).filter((s): s is TourStopView => s !== null);

/** A chip's stops: the precomputed order when it is present and still valid, else the built-in one. */
function presetTour(id: GoalPresetId): { stops: TourStopView[]; source: TourSource } {
  const entry = STORE.entries?.[tourKey(id)];
  const stored = entry && visible(entry, SHOW_UNREVIEWED) ? normalizeStops((entry.value as { stops?: unknown } | null)?.stops, CATALOG) : null;
  return stored ? { stops: views(stored), source: 'ai' } : { stops: views(defaultStops(id, CATALOG, FEATURED)), source: 'rules' };
}

/** Runs after a dialog has released its focus trap and scroll lock (two frames). */
function afterClose(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

type Props = {
  /** The goal picker is open. */
  pickerOpen: boolean;
  onClosePicker: () => void;
};

export function GuidedTour({ pickerOpen, onClosePicker }: Props) {
  const [tour, setTour] = useState<Tour | null>(null);
  // Bumped per start, so starting again from the palette restarts the pill at stop 1.
  const [run, setRun] = useState(0);

  const start = useCallback(
    (next: Tour, intent: string) => {
      onClosePicker();
      afterClose(() => {
        track('ai_tour', { intent, count: next.stops.length });
        setTour(next);
        setRun((n) => n + 1);
      });
    },
    [onClosePicker],
  );

  return (
    <>
      <TourPicker open={pickerOpen} onClose={onClosePicker} onStart={start} />
      {/* 'wait': a restarted tour mounts only after the old pill has gone, so their --ai-lift never overlap. */}
      <AnimatePresence mode="wait">{tour ? <TourPill key={run} tour={tour} onExit={() => setTour(null)} /> : null}</AnimatePresence>
    </>
  );
}

/* ---------------------------------------------------------------------------
 * The goal picker
 * ------------------------------------------------------------------------- */

function TourPicker({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (tour: Tour, intent: string) => void }) {
  const wide = useMediaQuery('(min-width: 640px)');
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const inputId = `${id}-goal`;
  const firstChip = useRef<HTMLElement>(null);
  const goalRef = useRef<HTMLInputElement>(null);
  const [goal, setGoal] = useState('');
  const plan = useAiJson<TourResponse>('/api/ai/tour');
  // Cleared on close, so a request the visitor walked away from starts nothing.
  const wanted = useRef(0);

  const close = () => {
    wanted.current += 1;
    plan.abort();
    onClose();
  };

  const choose = (preset: GoalPresetId) => {
    wanted.current += 1;
    plan.abort();
    onStart(presetTour(preset), preset);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = goal.trim().slice(0, AI_LIMITS.tourGoal);
    if (!text || plan.status === 'loading') return;
    const ticket = (wanted.current += 1);
    const res = await plan.run({ goal: text });
    if (ticket !== wanted.current) return;
    const stops = res ? normalizeStops(res.stops, CATALOG) : null;
    if (stops) {
      onStart({ stops: views(stops), source: 'ai' }, 'custom');
      return;
    }
    // No key, quota, a refusal or an unusable plan: the closest chip, and say so.
    const preset = presetFor(text);
    const label = GOAL_PRESETS.find((p) => p.id === preset)?.label ?? 'Quick look';
    onStart({ ...presetTour(preset), note: `A custom tour isn't available right now, so this is the ${label} tour.` }, 'fallback');
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      variant={wide ? 'modal' : 'sheet'}
      labelledBy={titleId}
      describedBy={descId}
      initialFocusRef={firstChip}
      panelClassName="max-w-lg"
    >
      <div className="p-6 sm:p-8" data-tour-picker="">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="font-display text-2xl font-semibold tracking-tight text-text-primary">
              Show me around
            </h2>
            <p id={descId} className="mt-2 text-sm leading-relaxed text-text-muted">
              Pick what you&rsquo;re here for. The tour moves from section to section; Esc ends it.
            </p>
          </div>
          <Button variant="icon" aria-label="Close" onClick={close} className="-mr-2 -mt-2 shrink-0">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Tour goals">
          {GOAL_PRESETS.map((p, i) => (
            <li key={p.id}>
              <Button ref={i === 0 ? firstChip : undefined} variant="secondary" onClick={() => choose(p.id)} data-tour-goal={p.id}>
                {p.label}
              </Button>
            </li>
          ))}
        </ul>

        <form onSubmit={submit} className="mt-8 border-t border-hairline pt-6" data-tour-custom="">
          <label htmlFor={inputId} className="text-sm font-medium text-text-primary">
            Or say what you&rsquo;re after
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              ref={goalRef}
              id={inputId}
              type="text"
              value={goal}
              maxLength={AI_LIMITS.tourGoal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. hiring for an LLM agents role"
              autoComplete="off"
              aria-describedby={`${inputId}-count`}
              className="h-11 min-w-0 flex-1 rounded-xl border border-glass-border bg-surface-tint px-3 text-base text-text-primary placeholder:text-text-muted ring-focus"
            />
            <AIButton type="submit" pending={plan.status === 'loading'} loadingLabel="Planning…" disabled={!goal.trim()}>
              Plan my tour
            </AIButton>
          </div>
          <p id={`${inputId}-count`} className="mt-1 text-right text-xs tabular-nums text-text-muted">
            {goal.length}/{AI_LIMITS.tourGoal}
          </p>
          {/* Only once a goal is typed: it asks /api/ai/health for the tier, and a chip tour must make no request. */}
          {goal.trim() ? <AiNotice feature="tour" className="mt-3" onDismiss={() => goalRef.current?.focus()} /> : null}
          <AIDisclosure compact className="mt-3" />
        </form>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------
 * The pill
 * ------------------------------------------------------------------------- */

// ProjectCard's openButtonId(); duplicated so this chunk never pulls in the grid.
const cardButtonId = (slug: string) => `project-open-${slug}`;

function headingOf(section: HTMLElement): HTMLElement {
  return document.getElementById(`${section.id}-title`) ?? section.querySelector<HTMLElement>('h2') ?? section;
}

/** Where a stop lands and what it rings: the card or role when the page shows one, else its section. */
function placeOf(t: TourTarget): { scrollTo: HTMLElement; mark: HTMLElement } | null {
  if (t.kind === 'section') {
    const s = findTarget(t.id);
    return s ? { scrollTo: s, mark: headingOf(s) } : null;
  }
  if (t.kind === 'project') {
    const button = document.getElementById(cardButtonId(t.slug));
    const card = button?.closest<HTMLElement>('[aria-labelledby], article, li') ?? null;
    if (card && card.getClientRects().length > 0) return { scrollTo: card, mark: card };
    const s = findTarget('projects');
    return s ? { scrollTo: s, mark: headingOf(s) } : null;
  }
  const s = findTarget('experience');
  if (!s) return null;
  const entry = s.querySelector<HTMLElement>(`[data-exp-index="${t.index}"]`);
  return entry ? { scrollTo: entry, mark: entry } : { scrollTo: s, mark: headingOf(s) };
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';

/** Focuses `el` where it is, making it programmatically focusable first when it isn't. */
function focusHere(el: HTMLElement): boolean {
  if (!el.matches(FOCUSABLE)) el.tabIndex = -1;
  el.focus({ preventScroll: true });
  return document.activeElement === el;
}

/** Where focus lands when the tour ends on `t`: a project card's open button, else what the stop rings. */
function focusTargetOf(t: TourTarget): HTMLElement | null {
  if (t.kind === 'project') {
    const button = document.getElementById(cardButtonId(t.slug));
    if (button && button.getClientRects().length > 0) return button;
  }
  return placeOf(t)?.mark ?? null;
}

function TourPill({ tour, onExit }: { tour: Tour; onExit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const total = tour.stops.length;
  const stop = tour.stops[Math.min(index, total - 1)];
  const last = index >= total - 1;

  // Move to each stop: an instant jump under reduced motion (smoothScrollTo reads the preference).
  useEffect(() => {
    const place = placeOf(stop.target);
    if (place) {
      smoothScrollTo(place.scrollTo, { focus: false });
      spotlight(place.mark);
    }
    announce(`Stop ${index + 1} of ${total}: ${stop.title}`);
  }, [stop, index, total]);

  // Keyboard users land on Next once the picker has handed focus back.
  useEffect(() => {
    const t = window.setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(t);
  }, []);

  // Sit above the dock even when it lifts over the footer, and lift toasts above the pill.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    let frame = 0;
    let dock: HTMLElement | null = null;
    let watched: HTMLElement | null = null;
    const styles = new MutationObserver(() => schedule());
    const measure = () => {
      frame = 0;
      dock = dock?.isConnected ? dock : document.querySelector<HTMLElement>('[data-dock]');
      if (dock && dock !== watched) {
        styles.disconnect();
        styles.observe(dock, { attributes: true, attributeFilter: ['style'] });
        watched = dock;
      }
      const lift = dock ? parseFloat(dock.style.getPropertyValue('--dock-lift')) || 0 : 0;
      el.style.setProperty('--tour-dock-lift', `${lift}px`);
      root.style.setProperty('--ai-lift', `${Math.ceil(el.offsetHeight) + 8 + lift}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const size = new ResizeObserver(schedule);
    size.observe(el);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      size.disconnect();
      styles.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      root.style.removeProperty('--ai-lift');
    };
  }, []);

  /**
   * Finish, Exit tour and Esc unmount the pill. When it holds focus, focus goes to the
   * stop the tour ended on, where the visitor now is, so the next Tab carries on from
   * there instead of from the top of the page. (Not back to the opener: the palette
   * and the picker have both closed, and it is usually far up the page by now.)
   */
  const handBack = useCallback(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !ref.current?.contains(active)) return;
    const here = focusTargetOf(stop.target) ?? document.getElementById('main');
    if (here) focusHere(here);
  }, [stop]);

  const exit = useCallback(() => {
    announce('Tour ended');
    handBack();
    onExit();
  }, [handBack, onExit]);

  useHotkeys({ escape: exit });

  const next = () => {
    if (last) {
      announce('That was the last stop. Tour finished.');
      handBack();
      onExit();
      return;
    }
    setIndex((i) => Math.min(i + 1, total - 1));
  };

  return (
    <motion.div
      ref={ref}
      role="region"
      aria-label="Guided tour"
      data-tour-pill=""
      data-tour-index={index}
      className="tour-pill z-dock"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.out } }}
      exit={{ opacity: 0, y: 8, transition: { duration: 0.22, ease: ease.in } }}
    >
      <div className="glass-strong rounded-2xl p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
          <span data-tour-count="" className="font-mono tabular-nums">
            Stop {index + 1} of {total}
          </span>
          <SourceBadge source={tour.source === 'ai' ? 'ai' : 'rules'} />
        </div>
        <div key={stop.id} className="tour-stop mt-1 min-w-0">
          <p className="truncate font-display text-base font-semibold text-text-primary" data-tour-title="">
            {stop.title}
          </p>
          {stop.line ? <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-text-secondary">{stop.line}</p> : null}
        </div>
        {tour.note ? (
          <p className="mt-1 text-xs text-text-muted" data-tour-note="">
            {tour.note}
          </p>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <ReadAloud key={stop.id} text={`${stop.title}. ${stop.line}`} caption={false} className="min-w-0" />
          <div className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            ref={nextRef}
            variant="primary"
            size="md"
            onClick={next}
            trailingIcon={last ? <Check aria-hidden="true" className="size-4" /> : <ArrowRight aria-hidden="true" className="size-4" />}
            data-tour-next=""
          >
            {last ? 'Finish' : 'Next'}
          </Button>
          <Button variant="icon" aria-label="Exit tour" onClick={exit} data-tour-exit="">
            <X aria-hidden="true" className="size-4" />
          </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
