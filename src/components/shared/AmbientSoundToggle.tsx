'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { useHotkeys } from '@/hooks/useHotkeys';

type Engine = { ctx: AudioContext; master: GainNode };
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

const VOLUME = 0.04;
const FADE_IN_S = 1.2;
const FADE_OUT_S = 0.8;
// A little past the fade-out, so the context suspends only once it is silent.
const SUSPEND_AFTER_MS = 900;
// A2, E3, A3: a quiet open fifth.
const CHORD = [110, 164.81, 220];

const noopSubscribe = () => () => {};
function audioCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
}
const hasAudio = () => Boolean(audioCtor());

function createEngine(): Engine | null {
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    CHORD.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.1 + i * 0.05;
      depth.gain.value = 0.4;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      osc.connect(master);
      osc.start();
      lfo.start();
    });
    return { ctx, master };
  } catch {
    return null;
  }
}

/**
 * A soft ambient drone. One AudioContext is built on the first press and then
 * only faded (gain ramps) and suspended or resumed, never torn down, so rapid
 * on/off/on presses always leave the state the button shows. It suspends while
 * the tab is hidden. 'm' toggles it (a single-key shortcut, so it obeys the
 * shortcut switch). Never starts by itself.
 */
export function AmbientSoundToggle({ className }: { className?: string }) {
  const supported = useSyncExternalStore(noopSubscribe, hasAudio, () => true);
  const [on, setOn] = useState(false);
  const onRef = useRef(false);
  const engineRef = useRef<Engine | null>(null);
  const suspendTimer = useRef<number | undefined>(undefined);

  const fade = (next: boolean) => {
    engineRef.current ??= next ? createEngine() : null;
    const engine = engineRef.current;
    if (!engine) return false;
    const { ctx, master } = engine;
    window.clearTimeout(suspendTimer.current);
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    if (next) {
      void ctx.resume().catch(() => {});
      master.gain.linearRampToValueAtTime(VOLUME, t + FADE_IN_S);
    } else {
      master.gain.linearRampToValueAtTime(0, t + FADE_OUT_S);
      suspendTimer.current = window.setTimeout(() => {
        if (!onRef.current) void ctx.suspend().catch(() => {});
      }, SUSPEND_AFTER_MS);
    }
    return true;
  };

  const toggle = () => {
    const next = !onRef.current;
    if (next && !fade(true)) return;
    if (!next) fade(false);
    onRef.current = next;
    setOn(next);
  };

  useHotkeys({ m: toggle }, { enabled: supported });

  // Hidden tab: silence the context outright; bring it back only if still on.
  useEffect(() => {
    const onVisibility = () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (document.hidden) void engine.ctx.suspend().catch(() => {});
      else if (onRef.current) void engine.ctx.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(suspendTimer.current);
      void engineRef.current?.ctx.close().catch(() => {});
      engineRef.current = null;
    },
    [],
  );

  if (!supported) return null;

  return (
    <Tooltip content={on ? 'Ambient sound: on (M)' : 'Ambient sound: off (M)'}>
      <Button
        variant="icon"
        size="md"
        aria-label="Ambient sound"
        aria-pressed={on}
        aria-keyshortcuts="M"
        data-sound-toggle=""
        data-on={on ? '' : undefined}
        onClick={toggle}
        className={className}
      >
        {on ? (
          <span aria-hidden="true" className="eq flex h-4 items-end gap-[3px]">
            <span className="eq-bar block h-4 w-[3px] rounded-full bg-violet-bright" />
            <span className="eq-bar block h-4 w-[3px] rounded-full bg-violet-bright" />
            <span className="eq-bar block h-4 w-[3px] rounded-full bg-violet-bright" />
          </span>
        ) : (
          <VolumeX aria-hidden="true" className="size-4" />
        )}
      </Button>
    </Tooltip>
  );
}
