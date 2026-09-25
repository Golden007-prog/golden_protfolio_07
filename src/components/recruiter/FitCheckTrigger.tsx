'use client';

import { createContext, useCallback, useContext, useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Quote } from 'lucide-react';
import { AIButton } from '@/components/ai/AIButton';
import { Button } from '@/components/ui/Button';
import { useInView } from '@/hooks/useInView';
import { takePending } from '@/lib/ai/bus';
import type { LensId } from '@/lib/ai/fit';
import type { FitOpenRequest } from '@/lib/ai/protocol';
import { track } from '@/lib/analytics';
import { preloadable } from '@/lib/preloadable';
import { useAppEvent } from '@/lib/events';
import { useUrlParam } from '@/lib/urlState';
import { cn } from '@/utils/cn';

/*
 * The only recruiter code on the first load of '/': two buttons, a lens-chip
 * slot and the open state they share. The fit sheet and the lens pitches are
 * separate chunks, fetched on the first open (the pitch chunk is warmed when About
 * nears the viewport) or for a ?lens link. Once a chunk is in, its dialog renders
 * in the opening commit instead of suspending.
 */

const FitCheck = preloadable(() => import('./FitCheck').then((m) => m.FitCheck));
const RoleLens = preloadable(() => import('./RoleLens').then((m) => m.RoleLens));

/* ---- the pitch dialog's state, shared with the lazy RoleLens ---- */

export type PitchState = { open: boolean; lens: LensId | null; loaded: boolean };

const INITIAL: PitchState = { open: false, lens: null, loaded: false };
let pitch: PitchState = INITIAL;
const listeners = new Set<() => void>();

function setPitch(next: PitchState) {
  pitch = next;
  listeners.forEach((fn) => fn());
}

/** Opens the 30-second pitch, on a given lens or the first one the data backs. */
export function openPitch(lens: LensId | null = null): void {
  setPitch({ open: true, lens, loaded: true });
}

export function closePitch(): void {
  setPitch({ ...pitch, open: false });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePitchState(): PitchState {
  return useSyncExternalStore(
    subscribe,
    () => pitch,
    () => INITIAL,
  );
}

/* ---- the entry points ---- */

/**
 * 'Check fit against your JD' and '30-second pitch' for AtAGlance's action row.
 * Also the one consumer of 'fit:open' (the palette, the mobile menu, a case
 * study), including a request queued before this mounted.
 */
export function FitCheckTrigger() {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ jd?: string; seq: number } | null>(null);

  const show = useCallback((req: FitOpenRequest | null) => {
    const apply = () => {
      setRequest((r) => ({ jd: req?.jd, seq: (r?.seq ?? 0) + 1 }));
      setOpen(true);
    };
    // Opened once the sheet's chunk is in: a suspended first render would sit blank
    // for up to 300ms after the chunk landed (React's Suspense retry throttle).
    if (FitCheck.loaded()) apply();
    else FitCheck.preload().then(apply, apply);
  }, []);

  // openFit() also fills the pending slot; drain it so a later mount doesn't reopen the sheet.
  useAppEvent('fit:open', (detail) => show(takePending('fit') ?? detail ?? {}));
  useEffect(() => {
    // bus.ts keeps a request made before this mounted; drain it once the page is interactive.
    const t = window.setTimeout(() => {
      const req = takePending('fit');
      if (req) show(req);
    }, 0);
    return () => window.clearTimeout(t);
  }, [show]);

  const preload = () => void FitCheck.preload().catch(() => {});

  return (
    <>
      <AIButton variant="outline" aria-haspopup="dialog" data-fit-trigger="" onClick={() => show(null)} onPointerEnter={preload} onFocus={preload}>
        Check fit against your JD
      </AIButton>
      <Button
        variant="ghost"
        aria-haspopup="dialog"
        data-pitch-trigger=""
        leadingIcon={<Quote aria-hidden="true" className="size-4 shrink-0" />}
        onClick={() => openPitch(null)}
      >
        30-second pitch
      </Button>
      {request ? <FitCheck open={open} onClose={() => setOpen(false)} initialJd={request.jd} requestSeq={request.seq} /> : null}
    </>
  );
}

/** A lens pitch the store lets this build show, as app/page.tsx works it out on the server. */
export type LensChip = { id: LensId; label: string };

/**
 * The visible lenses, decided on the server (the store and its review flags never
 * ship with the page), so the chips render in the first paint: mounted late, they
 * pushed everything below them down as About scrolled in.
 */
export const LensChipsContext = createContext<readonly LensChip[]>([]);

/**
 * Where the lens chips render. The pitch dialog (the precomputed pitches) is a
 * separate chunk: warmed when About nears the viewport or a chip is pointed at,
 * mounted on '30-second pitch', a chip, or a ?lens link.
 */
export function LensSlot({ className }: { className?: string }) {
  const chips = useContext(LensChipsContext);
  const chipsId = useId();
  const state = usePitchState();
  const param = useUrlParam('lens');
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '600px 0px', threshold: 0 });
  const [mounted, setMounted] = useState(false);
  // Once mounted it stays mounted, so a closing pitch can play its exit.
  if (!mounted && (state.loaded || param !== null)) setMounted(true);
  useEffect(() => {
    if (inView) RoleLens.preload().catch(() => {});
  }, [inView]);
  const warm = () => void RoleLens.preload().catch(() => {});

  return (
    <div ref={ref} data-lens-slot="" className={cn('min-w-0', className)}>
      {chips.length ? (
        <div data-lens-chips="" className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span id={chipsId} className="text-xs font-medium text-text-muted">
            30-second pitch for
          </span>
          <ul aria-labelledby={chipsId} className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={chip.id}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  data-lens-chip={chip.id}
                  onPointerEnter={warm}
                  onFocus={warm}
                  onClick={() => {
                    track('ai_brief_view', { feature: 'brief', intent: chip.id });
                    openPitch(chip.id);
                  }}
                  className="tap-safe rounded-full border border-glass-border bg-surface-tint px-4 text-xs font-medium text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary"
                >
                  {chip.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {mounted ? <RoleLens /> : null}
    </div>
  );
}
