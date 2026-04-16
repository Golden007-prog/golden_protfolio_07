import { Fragment, type ReactNode } from 'react';

function renderTitle(title: ReactNode) {
  if (typeof title !== 'string') return title;
  const parts = title.split(/(\*[^*]+\*)/).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('*') && part.endsWith('*')) {
          return (
            <span
              key={i}
              className="italic bg-gradient-to-r from-violet-bright via-pink to-cyan-bright bg-clip-text text-transparent"
            >
              {part.slice(1, -1)}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export function SectionHeading({ kicker, title, subtitle }: { kicker?: string; title: ReactNode; subtitle?: string }) {
  return (
    <header className="mb-16 max-w-3xl">
      {kicker && (
        <p className="font-mono text-xs tracking-[0.3em] uppercase text-cyan-bright/80 mb-4">
          {kicker}
        </p>
      )}
      <h2 className="font-display font-bold text-text-primary text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-[-0.02em]">
        {renderTitle(title)}
      </h2>
      {subtitle && (
        <p className="mt-6 text-lg md:text-xl text-text-muted max-w-2xl leading-relaxed">
          {subtitle}
        </p>
      )}
    </header>
  );
}
