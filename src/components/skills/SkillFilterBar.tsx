'use client';

import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Magnetic } from '@/components/shared/Magnetic';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { spring } from '@/lib/motion';
import { CATEGORIES, matchesQuery, SKILLS } from '@/lib/skills';
import { cn } from '@/utils/cn';
import { ALL, useSkillActions, useSkillList } from './SkillFocusContext';

const ANNOUNCE_DELAY_MS = 450;

/**
 * Category radiogroup plus a search box. The radios take arrow keys (roving
 * tabindex) and show real counts for the current search; below 640px they scroll
 * sideways with snap points and faded edges. The result count reaches screen
 * readers through a polite live region once typing pauses.
 */
export function SkillFilterBar() {
  const { filter, query, visible } = useSkillList();
  const { setFilter, setQuery } = useSkillActions();
  const { reduce } = useMotionPrefs();
  const searchId = useId();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const options = useMemo(() => {
    const matching = SKILLS.filter((s) => matchesQuery(s, query));
    return [
      { value: ALL, label: 'All', count: matching.length },
      ...CATEGORIES.map((c) => ({ value: c, label: c, count: matching.filter((s) => s.category === c).length })),
    ];
  }, [query]);

  const [announcement, setAnnouncement] = useState('');
  const trimmed = query.trim();
  useEffect(() => {
    const scope = filter === ALL ? '' : ` in ${filter}`;
    const text = trimmed
      ? visible.length === 0
        ? `No skills match “${trimmed}”${scope}`
        : `${visible.length} ${visible.length === 1 ? 'skill matches' : 'skills match'} “${trimmed}”${scope}`
      : `Showing ${visible.length} ${visible.length === 1 ? 'skill' : 'skills'}${scope}`;
    // Silent until the visitor first narrows the list, so page load announces nothing.
    const t = window.setTimeout(
      () => setAnnouncement((prev) => (prev === '' && !trimmed && filter === ALL ? prev : text)),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(t);
  }, [trimmed, filter, visible.length]);

  const onRadioKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = options.length - 1;
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? index === last ? 0 : index + 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? index === 0 ? last : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1;
    if (next === -1) return;
    e.preventDefault();
    setFilter(options[next].value);
    const el = radios.current[next];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  return (
    <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div
        role="radiogroup"
        aria-label="Filter skills by category"
        className="skills-filter-scroller -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-1.5 overflow-x-auto px-5 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {options.map((opt, i) => {
          const checked = filter === opt.value;
          return (
            <Magnetic key={opt.value} strength={0.15} className="shrink-0 snap-start">
              <button
                ref={(el) => {
                  radios.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setFilter(opt.value)}
                onKeyDown={(e) => onRadioKey(e, i)}
                className={cn(
                  'relative tap-safe-sm gap-2 whitespace-nowrap rounded-full px-3.5 font-mono text-xs uppercase tracking-wider ring-focus transition-colors',
                  checked ? 'text-white' : 'text-text-muted hover:text-text-primary',
                )}
              >
                {checked ? (
                  <motion.span
                    aria-hidden="true"
                    layoutId={reduce ? undefined : 'skills-filter-pill'}
                    transition={spring.ui}
                    className="absolute inset-x-0 inset-y-0.5 rounded-full bg-violet any-pointer-coarse:inset-y-1"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 inset-y-0.5 rounded-full border border-glass-border any-pointer-coarse:inset-y-1"
                  />
                )}
                <span className="relative">{opt.label}</span>
                <span className={cn('relative tabular-nums', checked ? 'text-white' : 'text-text-dim')}>
                  <span className="sr-only">, </span>
                  {opt.count}
                  <span className="sr-only"> skills</span>
                </span>
              </button>
            </Magnetic>
          );
        })}
      </div>

      <div className="relative w-full xl:w-64 xl:shrink-0" role="search">
        <label htmlFor={searchId} className="sr-only">
          Search skills
        </label>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-text-dim"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
          placeholder={`Search ${SKILLS.length} skills`}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-11 w-full rounded-full border border-glass-border-strong bg-glass-fill pl-10 pr-11 text-base text-text-primary ring-focus transition-colors placeholder:text-text-dim hover:border-violet-bright/50 focus-visible:border-violet-bright md:text-sm [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
            className="absolute right-0 top-0 tap-safe rounded-full text-text-muted ring-focus hover:text-text-primary"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>

      <p aria-live="polite" aria-atomic="true" className="sr-only" data-skills-count="">
        {announcement}
      </p>
    </div>
  );
}
