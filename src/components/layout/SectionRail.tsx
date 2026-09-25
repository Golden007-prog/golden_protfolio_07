'use client';

import { smoothScrollTo } from '@/contexts/LenisContext';
import { useActiveSection } from '@/hooks/useActiveSection';
import { SECTIONS } from '@/lib/site';
import { setUrlHash } from '@/lib/urlState';
import { cn } from '@/utils/cn';

/**
 * Chapter rail (lg and up): one tick per section that grows on the active one.
 * Only appears once the hero has scrolled away. Width changes are CSS
 * transitions, so reduced motion makes them instant.
 *
 * Each link box is just the 44px tick, which fits inside section-shell's side
 * padding (80px at lg, 96px at xl), so the rail never covers or takes clicks
 * from the content column. Labels are out of flow for the same reason. They
 * show on hover and focus, and the active label only stays up from 1800px,
 * where the gutter beside SectionWrapper's 1440px column is wide enough to
 * hold it.
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
      <ol className="flex flex-col items-end">
        {SECTIONS.map(({ id, label, index }) => {
          const isActive = active === id;
          return (
            <li key={id} className="flex">
              <a
                href={`#${id}`}
                aria-label={`${index} ${label}`}
                aria-current={isActive ? 'location' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  smoothScrollTo(id);
                  setUrlHash(id);
                }}
                className="group/tick tap-safe relative justify-end rounded-full pr-1 ring-focus"
              >
                <span
                  aria-hidden="true"
                  data-rail-label=""
                  className={cn(
                    'pointer-events-none absolute right-full top-1/2 mr-1 -translate-y-1/2 whitespace-nowrap rounded-full bg-bg-base/85 px-2 py-0.5 font-mono text-[11px] tabular-nums opacity-0 transition-[opacity,color] duration-300 group-hover/tick:opacity-100 group-focus-visible/tick:opacity-100',
                    isActive ? 'text-text-primary min-[1800px]:opacity-100' : 'text-text-muted',
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
