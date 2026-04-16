import { motion } from 'framer-motion';
import { GraduationCap } from 'lucide-react';
import { SectionWrapper } from '../layout/SectionWrapper';
import { SectionHeading } from '../shared/SectionHeading';
import { ScrollReveal } from '../shared/ScrollReveal';
import { GlassCard } from '../shared/GlassCard';
import { GitHubHeatmap } from '../shared/GitHubHeatmap';
import { LeetCodeHeatmap } from '../shared/LeetCodeHeatmap';
import { ReadingList } from '../shared/ReadingList';
import { TimelineCard } from './TimelineCard';
import profile from '../../data/profile.json';

export function ExperienceSection() {
  return (
    <SectionWrapper id="experience">
      <SectionHeading
        kicker="04 / Experience"
        title="The journey so *far*."
        subtitle="Internships, freelance AI work, and a Master's in progress — all pulling in the same direction."
      />

      <ScrollReveal className="mb-8">
        <GitHubHeatmap />
      </ScrollReveal>

      <ScrollReveal className="mb-16">
        <LeetCodeHeatmap />
      </ScrollReveal>

      <div className="relative">
        <motion.div
          initial={{ scaleY: 0 }}
          whileInView={{ scaleY: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.5, ease: 'easeOut' }}
          style={{ transformOrigin: 'top' }}
          className="absolute left-4 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-violet-bright via-cyan-bright to-transparent"
        />

        <div className="space-y-12 md:space-y-20 pl-12 md:pl-0">
          {profile.experience.map((exp, i) => (
            <div key={`${exp.company}-${i}`} className="relative">
              <span className="absolute -left-12 md:left-1/2 md:-translate-x-1/2 top-6 w-3 h-3 rounded-full bg-violet-bright glow-violet ring-4 ring-bg-base" />
              <TimelineCard exp={exp} side={i % 2 === 0 ? 'left' : 'right'} />
            </div>
          ))}
        </div>
      </div>

      <ScrollReveal className="mt-20">
        <GlassCard strong className="p-8 md:p-10">
          <div className="flex items-center gap-2 text-cyan-bright mb-6">
            <GraduationCap size={16} />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em]">Education</span>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {profile.education.map((edu) => (
              <div key={edu.institution} className="border-l-2 border-violet-bright/40 pl-5">
                <p className="font-display text-lg font-semibold">{edu.degree}</p>
                <p className="text-violet-bright text-sm mt-0.5">{edu.institution}</p>
                <p className="mt-2 font-mono text-xs text-text-muted">{edu.year}</p>
                <p className="mt-1 text-xs text-cyan-bright/80">{edu.status}</p>
              </div>
            ))}
          </div>
        </GlassCard>
      </ScrollReveal>

      <ScrollReveal className="mt-10">
        <ReadingList />
      </ScrollReveal>
    </SectionWrapper>
  );
}
