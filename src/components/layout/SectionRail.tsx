'use client';

import { smoothScrollTo } from '@/contexts/LenisContext';
import { useActiveSection } from '@/hooks/useActiveSection';
import { SECTIONS } from '@/lib/site';
import { setUrlHash } from '@/lib/urlState';
import { cn } from '@/utils/cn';

/**
 * Chapter rail (lg and up): one tick per section that grows on the active one.
 * Sits in the right gutter and only appears once the hero has scrolled away.
 * Width changes are CSS transitions, so reduced motion makes them instant.
 */
export function SectionRail() {
  const active = useActiveSection();

  return (
    <nav
      aria-label="Chapters"
      data-section-rail=""
      data-visible={active ? '' : undefined}
      className="section-rail fixed right-3 top-1/2 z-40 hidden -translate-y-1/2 flex-col items-end lg:flex xl:right-5"
    >
      <ol className="flex flex-col">
        {SECTIONS.map(({ id, label, index }) => {
          const isActive = active === id;
          return (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-label={`${index} ${label}`}
                aria-current={isActive ? 'location' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  smoothScrollTo(id);
                  setUrlHash(id);
                }}
                className="group/tick tap-safe relative justify-end gap-2 rounded-full pr-1 ring-focus"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none font-mono text-[11px] tabular-nums transition-[opacity,color] duration-300',
                    isActive
                      ? 'text-text-primary opacity-100'
                      : 'text-text-muted opacity-0 group-hover/tick:opacity-100 group-focus-visible/tick:opacity-100',
                  )}
                >
                  {index}
                  <span className="ml-1.5 font-body">{label}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'block h-px w-6 origin-right rounded-full transition-[scale,background-color] duration-500 ease-[var(--ease-out-expo)]',
                    isActive ? 'scale-x-150 bg-violet-bright' : 'bg-text-dim group-hover/tick:bg-text-secondary',
                  )}
                />
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
