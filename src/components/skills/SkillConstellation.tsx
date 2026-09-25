'use client';

import { useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import { CATEGORIES, SKILL_NODES } from '@/lib/skills';
import { cn } from '@/utils/cn';
import type { SkillAccent, SkillNode } from '@/types/skills';
import { ALL, useSkillActions, useSkillFocus, useSkillList } from './SkillFocusContext';

const DOT: Record<SkillAccent, string> = {
  violet: 'bg-violet-bright',
  cyan: 'bg-cyan-bright',
  amber: 'bg-amber',
  pink: 'bg-pink',
};

const RING: Record<SkillAccent, string> = {
  violet: 'ring-violet-bright/30',
  cyan: 'ring-cyan-bright/30',
  amber: 'ring-amber/30',
  pink: 'ring-pink/30',
};

const STROKE: Record<SkillAccent, string> = {
  violet: 'stroke-violet-bright',
  cyan: 'stroke-cyan-bright',
  amber: 'stroke-amber',
  pink: 'stroke-pink',
};

type NodeKeyActions = { select: (name: string | null) => void };

/**
 * Keyboard model shared by the constellation and the sphere's hidden node list:
 * one tab stop, arrows (and Home/End) move between nodes, which selects them;
 * Enter or Space opens the focused node (the button's own click); Escape releases.
 */
export function onNodeListKeyDown(
  e: KeyboardEvent<HTMLElement>,
  nodes: readonly SkillNode[],
  index: number,
  { select }: NodeKeyActions,
) {
  const last = nodes.length - 1;
  let next = -1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = last;
  else if (e.key === 'Escape') {
    e.preventDefault();
    select(null);
    return;
  }
  if (next === -1) return;
  e.preventDefault();
  const list = e.currentTarget.closest('[data-node-list]');
  list?.querySelector<HTMLElement>(`[data-node="${nodes[next].slug}"]`)?.focus();
}

/** The roving tab stop: the selected node, else the first. */
export function rovingIndex(nodes: readonly SkillNode[], selected: string | null): number {
  const i = selected ? nodes.findIndex((n) => n.name === selected) : -1;
  return i === -1 ? 0 : i;
}

/**
 * The sphere's nodes flattened to rows of stars, one row per category, for devices
 * that do not get WebGL (reduced motion, Data Saver, small low-power phones) and
 * while the sphere loads. Every star is a button that opens its skill. The drift is
 * CSS, so the reduced-motion and pause switches stop it. A star's data-node slug
 * matches its button in the sphere's hidden list: focus follows it across the
 * swap (Deferred3D focusKey), and the modal finds its opener again by it.
 */
export function SkillConstellation() {
  const { selected, hovered } = useSkillFocus();
  const { filter } = useSkillList();
  const { select, open } = useSkillActions();
  const active = hovered ?? selected;
  const tabStop = rovingIndex(SKILL_NODES, selected);

  const rows = useMemo(
    () =>
      CATEGORIES.map((category) => SKILL_NODES.filter((n) => n.category === category).sort((a, b) => a.x - b.x)).filter(
        (row) => row.length > 0,
      ),
    [],
  );

  return (
    <div className="skills-constellation relative h-full w-full select-none" data-skills-mode="constellation">
      <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
        <ellipse cx="50" cy="50" rx="49" ry="49" className="fill-none stroke-glass-border" strokeWidth="0.3" />
        {rows.map((row) => {
          const dim = filter !== ALL && row[0].category !== filter;
          return (
            <polyline
              key={row[0].category}
              points={row.map((n) => `${n.x * 100},${n.y * 100}`).join(' ')}
              vectorEffect="non-scaling-stroke"
              className={cn('fill-none transition-opacity duration-300', STROKE[row[0].accent], dim ? 'opacity-10' : 'opacity-40')}
              strokeWidth="1"
              strokeDasharray="3 4"
            />
          );
        })}
      </svg>
      <ul aria-label="Skills" data-node-list="" className="absolute inset-0">
        {SKILL_NODES.map((node, i) => {
          const isActive = active === node.name;
          const dim = filter !== ALL && node.category !== filter;
          const pos: CSSProperties = { left: `${node.x * 100}%`, top: `${node.y * 100}%` };
          const drift = { animationDelay: `${(i % 7) * -1.3}s`, animationDuration: `${7 + (i % 5)}s` } as CSSProperties;
          return (
            <li key={node.slug} className="absolute" style={pos}>
              <button
                type="button"
                data-node={node.slug}
                aria-haspopup="dialog"
                aria-label={`${node.name}, ${node.category}`}
                tabIndex={i === tabStop ? 0 : -1}
                onFocus={() => select(node.name)}
                onKeyDown={(e) => onNodeListKeyDown(e, SKILL_NODES, i, { select })}
                onClick={(e) => {
                  select(node.name);
                  open(node.name, { opener: e.currentTarget });
                }}
                className={cn(
                  'group absolute left-0 top-0 flex min-h-11 w-max min-w-11 -translate-x-1/2 -translate-y-[17px] flex-col items-center rounded-2xl px-1 pt-3 ring-focus transition-opacity duration-300',
                  dim && 'opacity-35',
                )}
              >
                <span className="skills-drift flex flex-col items-center" style={drift}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'block rounded-full transition-transform duration-300 group-hover:scale-150',
                      DOT[node.accent],
                      isActive ? cn('size-3.5 ring-4', RING[node.accent]) : 'size-2.5',
                    )}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 max-w-[5.5rem] text-balance text-center text-[11px] font-medium leading-tight transition-colors',
                      isActive ? 'text-text-primary' : 'text-text-secondary group-hover:text-text-primary',
                    )}
                  >
                    {node.name}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
