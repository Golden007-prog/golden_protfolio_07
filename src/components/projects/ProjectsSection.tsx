import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { SectionWrapper } from '../layout/SectionWrapper';
import { SectionHeading } from '../shared/SectionHeading';
import { ScrollReveal } from '../shared/ScrollReveal';
import { ProjectCard, type Project } from './ProjectCard';
import { ProjectModal } from './ProjectModal';
import projectsData from '../../data/projects.json';

const PROJECTS: Project[] = (projectsData as Array<Omit<Project, 'slug'> & { slug?: string }>).map((p) => ({
  ...p,
  slug: p.slug ?? p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
}));

export function ProjectsSection() {
  const categories = useMemo(() => ['All', ...new Set(PROJECTS.map((p) => p.category))], []);
  const [filter, setFilter] = useState('All');
  const [active, setActive] = useState<Project | null>(null);

  const shown = filter === 'All' ? PROJECTS : PROJECTS.filter((p) => p.category === filter);

  return (
    <SectionWrapper id="projects">
      <SectionHeading
        kicker="03 / Projects"
        title="Things I've *built*."
        subtitle="From mechanistic-interpretability clinical AI to serverless voice commerce — ten shipped projects."
      />

      <ScrollReveal className="flex flex-wrap gap-2 mb-10">
        {categories.map((c) => {
          const isActive = filter === c;
          return (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`relative px-4 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider transition-all ${
                isActive
                  ? 'text-white'
                  : 'glass text-text-muted hover:text-text-primary'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="projects-filter-pill"
                  className="absolute inset-0 rounded-full bg-violet-bright border border-violet-bright glow-violet"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
              <span className="relative z-10">{c}</span>
            </button>
          );
        })}
      </ScrollReveal>

      <motion.div
        layout
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
      >
        {shown.map((p, i) => (
          <motion.div
            layout
            key={p.slug}
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: (i % 6) * 0.06 }}
          >
            <ProjectCard project={p} onOpen={setActive} />
          </motion.div>
        ))}
      </motion.div>

      <ProjectModal project={active} onClose={() => setActive(null)} />
    </SectionWrapper>
  );
}
