import { GlassCard } from '../shared/GlassCard';
import { SkillPill } from './SkillPill';
import skillsData from '../../data/skills-detailed.json';
import type { SkillDetail } from '../../types/skills';

type Props = { category: string; items: string[]; accent: 'violet' | 'cyan' | 'amber' | 'pink' };

const ACCENT_LABEL: Record<Props['accent'], string> = {
  violet: 'text-violet-bright',
  cyan: 'text-cyan-bright',
  amber: 'text-amber',
  pink: 'text-pink',
};

const details = skillsData as SkillDetail[];

export function SkillCard({ category, items, accent }: Props) {
  return (
    <GlassCard
      strong
      className="p-6 h-full group cursor-default"
      whileHover={{ y: -6, rotateX: -2, rotateY: 2 }}
      style={{ transformPerspective: 1000 }}
    >
      <p className={`font-mono text-[10px] uppercase tracking-[0.3em] ${ACCENT_LABEL[accent]}`}>
        {category}
      </p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {items.map((name, i) => {
          const detail = details.find((d) => d.name === name);
          return (
            <li key={name}>
              <SkillPill name={name} detail={detail} accent={accent} delay={i * 0.04} />
            </li>
          );
        })}
      </ul>
    </GlassCard>
  );
}
