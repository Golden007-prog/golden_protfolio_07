import { useMemo } from 'react';

const COLORS = [
  'rgba(168, 85, 247, 0.55)',
  'rgba(34, 211, 238, 0.45)',
  'rgba(236, 72, 153, 0.40)',
];

export function BokehParticles({ count = 14 }: { count?: number }) {
  const dots = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const size = 6 + Math.random() * 22;
      const left = Math.random() * 100;
      const dx = (Math.random() - 0.5) * 120;
      const duration = 18 + Math.random() * 22;
      const delay = -Math.random() * duration;
      const color = COLORS[i % COLORS.length];
      return {
        key: i,
        style: {
          width: `${size}px`,
          height: `${size}px`,
          left: `${left}%`,
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          animationDuration: `${duration}s`,
          animationDelay: `${delay}s`,
          '--dx': `${dx}px`,
        } as React.CSSProperties,
      };
    });
  }, [count]);

  return (
    <div className="bokeh" aria-hidden="true">
      {dots.map((d) => (
        <span key={d.key} style={d.style} />
      ))}
    </div>
  );
}
