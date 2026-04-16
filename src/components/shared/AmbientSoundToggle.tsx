import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';

const STORAGE_KEY = 'ob-ambient-on';

export function AmbientSoundToggle() {
  const [on, setOn] = useState(false);
  const [supported, setSupported] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const oscRefs = useRef<OscillatorNode[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) {
      setSupported(false);
      return;
    }
    const pref = localStorage.getItem(STORAGE_KEY);
    if (pref === '1') {
      // Don't auto-start — browsers require user gesture; we just remember intent
    }
  }, []);

  const start = () => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const master = ctx.createGain();
      master.gain.setValueAtTime(0, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 1.2);
      master.connect(ctx.destination);

      const freqs = [110, 164.81, 220]; // A2, E3, A3 — gentle chord
      const oscs: OscillatorNode[] = [];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'sine' : 'triangle';
        osc.frequency.value = f;
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 0.1 + i * 0.05;
        lfoGain.gain.value = 0.4;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        osc.connect(master);
        osc.start();
        lfo.start();
        oscs.push(osc);
      });
      ctxRef.current = ctx;
      gainRef.current = master;
      oscRefs.current = oscs;
    } catch {
      setSupported(false);
    }
  };

  const stop = () => {
    const ctx = ctxRef.current;
    const master = gainRef.current;
    if (!ctx || !master) return;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    setTimeout(() => {
      oscRefs.current.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      });
      ctx.close().catch(() => {});
      ctxRef.current = null;
      gainRef.current = null;
      oscRefs.current = [];
    }, 900);
  };

  const toggle = () => {
    if (on) {
      stop();
      setOn(false);
      localStorage.setItem(STORAGE_KEY, '0');
    } else {
      start();
      setOn(true);
      localStorage.setItem(STORAGE_KEY, '1');
    }
  };

  useEffect(() => {
    return () => {
      if (ctxRef.current) {
        oscRefs.current.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* ignore */
          }
        });
        ctxRef.current.close().catch(() => {});
      }
    };
  }, []);

  if (!supported) return null;

  return (
    <motion.button
      onClick={toggle}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.8, duration: 0.5 }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={on ? 'Mute ambient sound' : 'Play ambient sound'}
      aria-pressed={on}
      className={`fixed bottom-6 right-24 z-40 w-11 h-11 rounded-full glass-strong flex items-center justify-center text-text-muted hover:text-violet-bright transition-colors ${on ? 'ring-1 ring-violet-bright/40' : ''}`}
    >
      {on ? <Volume2 size={16} /> : <VolumeX size={16} />}
    </motion.button>
  );
}
