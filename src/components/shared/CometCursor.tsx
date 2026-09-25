'use client';

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUpRight, Copy, MoveHorizontal } from 'lucide-react';
import { useThemeTokens } from '@/hooks/useThemeTokens';
import { pointer, subscribePointer, usePointerTracking } from '@/lib/pointerStore';

type Mode = 'default' | 'hover' | 'view' | 'open' | 'copy' | 'download' | 'drag' | 'hide';

const CONTEXT_MODES = new Set<Mode>(['view', 'open', 'copy', 'download', 'drag', 'hide']);
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), iframe';
const INTERACTIVE = 'a[href], button, [role="button"], summary, label, [tabindex]:not([tabindex="-1"])';

const IDLE_MS = 1200;
const MAX_TRAIL = 28;
const MIN_DIST = 1.5;

type TrailPoint = { x: number; y: number; life: number };

function modeFor(target: EventTarget | null): Mode {
  if (!(target instanceof Element)) return 'default';
  // Text entry keeps the native I-beam (index.css never hides it there); frames draw their own cursor.
  if (target.closest(TEXT_ENTRY)) return 'hide';
  const tagged = target.closest<HTMLElement>('[data-cursor]')?.dataset.cursor as Mode | undefined;
  if (tagged && CONTEXT_MODES.has(tagged)) return tagged;
  return target.closest(INTERACTIVE) ? 'hover' : 'default';
}

/**
 * Comet cursor for fine hover pointers (App mounts it only there, never under
 * reduced motion or forced colours). It reads the shared pointer store, draws
 * only while the pointer moves or the tail is fading (the rAF loop stops after
 * 1.2s idle), and reflects the hovered [data-cursor] as a contextual ring. The
 * native cursor is hidden only once the comet has drawn (html.has-custom-cursor).
 */
export default function CometCursor() {
  usePointerTracking();
  const tokens = useThemeTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const colors = useRef({ base: tokens.violetBright, hover: tokens.cyanBright });

  useEffect(() => {
    colors.current = { base: tokens.violetBright, hover: tokens.cyanBright };
  }, [tokens.violetBright, tokens.cyanBright]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const headEl = headRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !headEl || !ctx) return;
    const root = document.documentElement;

    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const head = { x: pointer.x, y: pointer.y };
    const trail: TrailPoint[] = [];
    let mode: Mode = 'default';
    let started = false;
    let raf = 0;
    let running = false;
    let lastMove = 0;
    let lastFrame = 0;

    const setMode = (next: Mode) => {
      if (next === mode) return;
      mode = next;
      headEl.dataset.mode = next;
    };

    // data-running mirrors the loop, so tests can see it stop when idle.
    const setRunning = (on: boolean) => {
      running = on;
      headEl.toggleAttribute('data-running', on);
    };

    const teardown = () => {
      setRunning(false);
      cancelAnimationFrame(raf);
      root.classList.remove('has-custom-cursor');
      headEl.removeAttribute('data-visible');
    };

    const draw = (now: number) => {
      const dt = lastFrame ? Math.min(64, now - lastFrame) : 16.7;
      lastFrame = now;
      // Frame-rate independent follow (0.22 per 60Hz frame).
      const k = 1 - Math.pow(1 - 0.22, dt / 16.7);
      head.x += (pointer.x - head.x) * k;
      head.y += (pointer.y - head.y) * k;

      const last = trail[trail.length - 1];
      if (!last || (head.x - last.x) ** 2 + (head.y - last.y) ** 2 >= MIN_DIST * MIN_DIST) {
        trail.push({ x: head.x, y: head.y, life: 1 });
      }
      while (trail.length > MAX_TRAIL) trail.shift();
      const decay = Math.pow(0.92, dt / 16.7);
      for (const p of trail) p.life *= decay;
      while (trail.length && trail[0].life < 0.05) trail.shift();

      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      if (mode !== 'hide' && trail.length > 1) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = mode === 'default' ? colors.current.base : colors.current.hover;
        for (let i = 0; i < trail.length - 1; i++) {
          const t = i / (trail.length - 1);
          ctx.globalAlpha = t * trail[i].life * 0.85;
          ctx.lineWidth = 0.6 + t * 4.5;
          ctx.beginPath();
          ctx.moveTo(trail[i].x, trail[i].y);
          ctx.lineTo(trail[i + 1].x, trail[i + 1].y);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      headEl.style.transform = `translate3d(${head.x}px, ${head.y}px, 0) translate(-50%, -50%)`;
    };

    const tick = (now: number) => {
      try {
        draw(now);
      } catch {
        teardown();
        return;
      }
      const settled = Math.abs(pointer.x - head.x) < 0.3 && Math.abs(pointer.y - head.y) < 0.3;
      if (now - lastMove > IDLE_MS && trail.length === 0 && settled) {
        setRunning(false);
        lastFrame = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const wake = () => {
      lastMove = performance.now();
      if (running) return;
      setRunning(true);
      raf = requestAnimationFrame(tick);
    };

    const unsubscribe = subscribePointer(() => {
      if (!pointer.active) {
        headEl.removeAttribute('data-visible');
        return;
      }
      if (!started) {
        started = true;
        head.x = pointer.x;
        head.y = pointer.y;
        headEl.style.transform = `translate3d(${head.x}px, ${head.y}px, 0) translate(-50%, -50%)`;
        root.classList.add('has-custom-cursor');
      }
      headEl.setAttribute('data-visible', '');
      wake();
    });

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      setMode(modeFor(e.target));
    };

    document.addEventListener('pointerover', onOver, { passive: true });
    window.addEventListener('resize', resize);
    return () => {
      unsubscribe();
      document.removeEventListener('pointerover', onOver);
      window.removeEventListener('resize', resize);
      teardown();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" className="comet-canvas size-full" />
      <div ref={headRef} aria-hidden="true" className="comet-head" data-mode="default" data-comet="">
        <span className="comet-label" data-for="view">
          View
        </span>
        <span className="comet-label" data-for="drag">
          <MoveHorizontal className="size-3.5" />
          Drag
        </span>
        <span className="comet-label" data-for="open">
          <ArrowUpRight className="size-4" />
        </span>
        <span className="comet-label" data-for="copy">
          <Copy className="size-3.5" />
        </span>
        <span className="comet-label" data-for="download">
          <ArrowDown className="size-4" />
        </span>
      </div>
    </>
  );
}
