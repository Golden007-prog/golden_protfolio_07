import { useEffect, useRef, useState } from 'react';

interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

export default function CometCursor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const hoveringRef = useRef(false);
  const [hovering, setHovering] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isTouch = window.matchMedia('(hover: none)').matches;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const mouse = { x: 0, y: 0 };
    const head = { x: 0, y: 0 };
    const trail: TrailPoint[] = [];
    let rafId = 0;
    let initialized = false;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_TRAIL = 28;
    const MIN_DIST = 1.5;

    const setPoint = (x: number, y: number) => {
      mouse.x = x;
      mouse.y = y;
      if (!initialized) {
        head.x = x;
        head.y = y;
        initialized = true;
      }
      setVisible(true);
      if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    };

    const handleMove = (e: MouseEvent) => setPoint(e.clientX, e.clientY);
    const handleLeave = () => setVisible(false);
    const handleEnter = () => setVisible(true);

    const handleTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      setPoint(t.clientX, t.clientY);

      const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
      const isInteractive = !!el?.closest(
        'a, button, input, textarea, [role="button"], [data-cursor-hover]',
      );
      hoveringRef.current = isInteractive;
      setHovering(isInteractive);
    };

    const handleTouchEnd = () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => setVisible(false), 450);
      hoveringRef.current = false;
      setHovering(false);
    };

    const handleOver = (e: Event) => {
      const target = e.target as HTMLElement;
      const isInteractive = !!target.closest(
        'a, button, input, textarea, [role="button"], [data-cursor-hover]',
      );
      hoveringRef.current = isInteractive;
      setHovering(isInteractive);
    };

    const animate = () => {
      const spring = 0.22;
      head.x += (mouse.x - head.x) * spring;
      head.y += (mouse.y - head.y) * spring;

      const last = trail[trail.length - 1];
      const dx = last ? head.x - last.x : MIN_DIST + 1;
      const dy = last ? head.y - last.y : MIN_DIST + 1;
      if (dx * dx + dy * dy >= MIN_DIST * MIN_DIST) {
        trail.push({ x: head.x, y: head.y, life: 1 });
      }
      while (trail.length > MAX_TRAIL) trail.shift();
      for (let i = 0; i < trail.length; i++) trail[i].life *= 0.92;
      while (trail.length && trail[0].life < 0.05) trail.shift();

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (trail.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let i = 0; i < trail.length - 1; i++) {
          const p1 = trail[i];
          const p2 = trail[i + 1];
          const t = i / (trail.length - 1);
          const alpha = t * p1.life * 0.85;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineWidth = 0.6 + t * 4.5;
          ctx.strokeStyle = hoveringRef.current
            ? `rgba(34, 211, 238, ${alpha})`
            : `rgba(168, 85, 247, ${alpha})`;
          ctx.stroke();
        }
      }

      if (headRef.current) {
        headRef.current.style.transform = `translate3d(${head.x}px, ${head.y}px, 0) translate(-50%, -50%)`;
      }

      rafId = requestAnimationFrame(animate);
    };

    animate();

    if (isTouch) {
      window.addEventListener('touchstart', handleTouch, { passive: true });
      window.addEventListener('touchmove', handleTouch, { passive: true });
      window.addEventListener('touchend', handleTouchEnd, { passive: true });
      window.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    } else {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseleave', handleLeave);
      window.addEventListener('mouseenter', handleEnter);
      document.addEventListener('mouseover', handleOver);
    }

    return () => {
      cancelAnimationFrame(rafId);
      if (fadeTimer) clearTimeout(fadeTimer);
      window.removeEventListener('resize', resize);
      if (isTouch) {
        window.removeEventListener('touchstart', handleTouch);
        window.removeEventListener('touchmove', handleTouch);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchEnd);
      } else {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseleave', handleLeave);
        window.removeEventListener('mouseenter', handleEnter);
        document.removeEventListener('mouseover', handleOver);
      }
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          zIndex: 99998,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s',
        }}
      />
      <div
        ref={headRef}
        aria-hidden
        className="pointer-events-none fixed top-0 left-0 rounded-full transition-[width,height,background] duration-200"
        style={{
          zIndex: 99999,
          width: hovering ? '18px' : '10px',
          height: hovering ? '18px' : '10px',
          background: hovering ? '#06B6D4' : '#A855F7',
          boxShadow: hovering
            ? '0 0 20px rgba(6, 182, 212, 0.6), 0 0 40px rgba(6, 182, 212, 0.3)'
            : '0 0 15px rgba(168, 85, 247, 0.6), 0 0 30px rgba(168, 85, 247, 0.3)',
          opacity: visible ? 1 : 0,
          willChange: 'transform',
        }}
      />
    </>
  );
}
