import { Suspense, lazy, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SectionWrapper } from '../layout/SectionWrapper';
import { SectionHeading } from '../shared/SectionHeading';
import { ScrollReveal } from '../shared/ScrollReveal';
import { SkillCard } from './SkillCard';
import { SentimentDemo } from './SentimentDemo';
import profile from '../../data/profile.json';

const SkillSphere = lazy(() => import('./SkillSphere').then((m) => ({ default: m.SkillSphere })));

const ACCENT_MAP: Record<string, 'violet' | 'cyan' | 'amber' | 'pink'> = {
  'GenAI & LLMs': 'violet',
  'Agentic AI': 'cyan',
  'Data Science & ML': 'amber',
  'Analytics & Viz': 'pink',
  'Infrastructure': 'violet',
};

export function SkillsSection() {
  const base = import.meta.env.BASE_URL;
  const categories = Object.entries(profile.skills);
  const [filter, setFilter] = useState<string>('All');
  const filtered = filter === 'All' ? categories : categories.filter(([c]) => c === filter);
  return (
    <SectionWrapper id="skills">
      <video
        autoPlay muted loop playsInline preload="metadata"
        poster={`${base}images/skills-bg.webp`}
        aria-hidden="true"
        className="absolute inset-0 -z-10 w-full h-full object-cover opacity-25 pointer-events-none"
      >
        <source src={`${base}videos/skills-bg.mp4`} type="video/mp4" />
      </video>
      <div
        className="absolute inset-0 -z-10 opacity-20 pointer-events-none mix-blend-screen"
        style={{ backgroundImage: `url(${base}images/skills-neural.webp)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-bg-base/70 via-transparent to-bg-base/90 pointer-events-none" />
      <SectionHeading
        kicker="02 / Skills"
        title="Tools in the *arsenal*."
        subtitle="Spin it, or tap a node to lock it center-stage. Every one is something I've shipped production code with."
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
        <ScrollReveal className="lg:col-span-2 h-[500px] sticky top-28">
          <Suspense fallback={<div className="glass w-full h-full animate-pulse" />}>
            <SkillSphere />
          </Suspense>
        </ScrollReveal>

        <div className="lg:col-span-3">
          <div className="flex flex-wrap gap-2 mb-5">
            {['All', ...categories.map(([c]) => c)].map((c) => {
              const active = filter === c;
              return (
                <button
                  key={c}
                  onClick={() => setFilter(c)}
                  className={`relative px-3.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider transition-colors ${active ? 'text-white' : 'text-text-muted hover:text-text-primary'}`}
                >
                  {active && (
                    <motion.span
                      layoutId="skills-filter-pill"
                      className="absolute inset-0 rounded-full bg-gradient-to-r from-violet to-violet-bright shadow-[0_0_18px_rgba(168,85,247,0.35)]"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative z-10">{c}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filtered.map(([cat, items], i) => (
                <motion.div
                  key={cat}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10, scale: 0.97 }}
                  transition={{ duration: 0.4, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
                >
                  <SkillCard category={cat} items={items as string[]} accent={ACCENT_MAP[cat] ?? 'violet'} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ScrollReveal className="mt-16">
        <SentimentDemo />
      </ScrollReveal>
    </SectionWrapper>
  );
}
