'use client';

import { motion, type MotionStyle } from 'framer-motion';
import { useMemo } from 'react';
import { REVEAL_MARGIN } from '@/components/motion/Reveal';
import { GlassCard } from '@/components/shared/GlassCard';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { stagger, staggerContainer } from '@/lib/motion';
import type { Skill, SkillAccent } from '@/types/skills';
import { SkillPill } from './SkillPill';

type Props = {
  category: string;
  skills: readonly Skill[];
  /** Skills in the category before the search narrowed it. */
  total: number;
  accent: SkillAccent;
  query: string;
};

const LABEL: Record<SkillAccent, string> = {
  violet: 'text-violet-bright',
  cyan: 'text-cyan-text',
  amber: 'text-amber-text',
  pink: 'text-pink',
};

// The spotlight that follows a fine pointer takes the category's accent.
const SHEEN: Record<SkillAccent, string> = {
  violet: 'color-mix(in oklab, var(--app-violet-bright) 16%, transparent)',
  cyan: 'color-mix(in oklab, var(--app-cyan-bright) 16%, transparent)',
  amber: 'color-mix(in oklab, var(--app-amber) 16%, transparent)',
  pink: 'color-mix(in oklab, var(--app-pink) 16%, transparent)',
};

const INSTANT = { hidden: {}, visible: {} };

export function SkillCard({ category, skills, total, accent, query }: Props) {
  const { reduce } = useMotionPrefs();
  const list = useMemo(() => (reduce ? INSTANT : staggerContainer(stagger.micro)), [reduce]);
  const titleId = `skills-cat-${accent}-${category.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const style = { '--app-glass-sheen': SHEEN[accent] } as MotionStyle;

  return (
    <GlassCard as="article" strong spotlight aria-labelledby={titleId} className="h-full p-6" style={style}>
      <h3 id={titleId} className="flex items-baseline justify-between gap-3 font-mono text-eyebrow uppercase">
        <span className={LABEL[accent]}>{category}</span>
        <span className="text-text-muted">
          {skills.length === total ? total : `${skills.length} / ${total}`}
          <span className="sr-only"> skills</span>
        </span>
      </h3>
      <motion.ul
        className="mt-4 flex flex-wrap gap-x-2 gap-y-1 any-pointer-coarse:gap-y-0"
        variants={list}
        initial="hidden"
        animate={reduce ? 'visible' : undefined}
        whileInView={reduce ? undefined : 'visible'}
        viewport={{ once: true, margin: REVEAL_MARGIN }}
      >
        {skills.map((skill) => (
          <SkillPill key={skill.slug} skill={skill} query={query} />
        ))}
      </motion.ul>
    </GlassCard>
  );
}
