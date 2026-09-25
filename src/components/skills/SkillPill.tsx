'use client';

import { motion, type Variants } from 'framer-motion';
import { REDUCED_TRANSITION } from '@/components/motion/Reveal';
import { Tooltip } from '@/components/ui/Tooltip';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { spring } from '@/lib/motion';
import { highlightParts, loadSkillDetail, PROJECT_COUNTS } from '@/lib/skills';
import { cn } from '@/utils/cn';
import type { Skill, SkillAccent } from '@/types/skills';
import { useSkillActions } from './SkillFocusContext';

const ACCENT: Record<SkillAccent, string> = {
  violet: 'border-violet-bright/45 group-hover:border-violet-bright group-hover:bg-violet/10',
  cyan: 'border-cyan-bright/45 group-hover:border-cyan-bright group-hover:bg-cyan/10',
  amber: 'border-amber/50 group-hover:border-amber group-hover:bg-amber/10',
  pink: 'border-pink/45 group-hover:border-pink group-hover:bg-pink/10',
};

// Each pill rises into place on a UI spring, cascaded by its card's list.
const ITEM: Record<'motion' | 'reduced', Variants> = {
  motion: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: spring.ui } },
  reduced: { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: REDUCED_TRANSITION } },
};

type Props = { skill: Skill; query: string };

/**
 * A skill in a card. Mouse hover or keyboard focus shows its one-line definition
 * (never on touch, so a tap goes straight to the modal) and centres its node on
 * the sphere. The border and the label carry layoutIds the modal panel and title
 * share, so the modal grows out of the pill that opened it.
 */
export function SkillPill({ skill, query }: Props) {
  const { open, hover } = useSkillActions();
  const { reduce } = useMotionPrefs();
  const count = PROJECT_COUNTS[skill.name] ?? 0;
  const warm = () => void loadSkillDetail(skill.slug).catch(() => {});

  const tip = (
    <span className="block">
      <strong className="font-semibold text-text-primary">{skill.term}</strong>
      {skill.def}
      <span className="mt-2 block font-mono text-eyebrow uppercase text-cyan-text">Click to learn more</span>
    </span>
  );

  return (
    <motion.li data-reveal="" variants={reduce ? ITEM.reduced : ITEM.motion}>
      <Tooltip content={tip} maxWidth={288} delay={250}>
        <button
          type="button"
          aria-haspopup="dialog"
          data-skill-pill={skill.slug}
          data-cursor="open"
          onClick={(e) => open(skill.name, { opener: e.currentTarget, morph: true })}
          onPointerEnter={(e) => {
            if (e.pointerType !== 'mouse') return;
            hover(skill.name);
            warm();
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse') hover(null);
          }}
          onFocus={() => {
            hover(skill.name);
            warm();
          }}
          onBlur={() => hover(null)}
          className="group relative tap-safe-sm rounded-full px-3 text-xs text-text-secondary ring-focus transition-colors hover:text-text-primary"
        >
          <motion.span
            aria-hidden="true"
            layoutId={reduce ? undefined : `skill-panel-${skill.slug}`}
            className={cn(
              'absolute inset-x-0 inset-y-0.5 rounded-full border bg-surface-tint transition-colors duration-300 any-pointer-coarse:inset-y-1.5',
              ACCENT[skill.accent],
            )}
          />
          <motion.span layoutId={reduce ? undefined : `skill-title-${skill.slug}`} className="relative whitespace-nowrap">
            {highlightParts(skill.name, query).map((part, i) =>
              part.match ? (
                <mark key={i} className="rounded-sm bg-amber/25 px-px text-text-primary">
                  {part.text}
                </mark>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </motion.span>
          {count > 0 ? (
            <span className="relative ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-glass-border-strong bg-bg-surface px-1 font-mono text-[10px] leading-none text-text-secondary">
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">, used in {count === 1 ? '1 project' : `${count} projects`}</span>
            </span>
          ) : null}
        </button>
      </Tooltip>
    </motion.li>
  );
}
