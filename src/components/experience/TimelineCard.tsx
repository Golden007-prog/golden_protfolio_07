import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Briefcase, Calendar, MapPin, ChevronDown } from 'lucide-react';
import { GlassCard } from '../shared/GlassCard';

type Metric = { value: string; label: string };

type Exp = {
  company: string;
  role: string;
  type?: string;
  duration: string;
  location: string;
  description?: string;
  highlights: string[];
  metrics?: Metric[];
};

type Props = { exp: Exp };

export function TimelineCard({ exp }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <GlassCard strong className="p-7 md:p-8" whileHover={{ y: -4 }}>
          <div className="flex items-center gap-2 text-cyan-bright">
            <Briefcase size={14} />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em]">{exp.type ?? exp.role.split(' ').slice(-1)[0]}</span>
          </div>
          <h3 className="mt-3 font-display text-2xl font-semibold">{exp.role}</h3>
          <p className="mt-1 text-violet-bright font-medium">{exp.company}</p>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-text-muted font-mono">
            <span className="flex items-center gap-1.5"><Calendar size={12} /> {exp.duration}</span>
            <span className="flex items-center gap-1.5"><MapPin size={12} /> {exp.location}</span>
          </div>
          <ul className="mt-5 space-y-2.5">
            {exp.highlights.map((h, i) => (
              <li key={i} className="text-sm text-text-secondary leading-relaxed flex gap-3">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-violet-bright shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
          <AnimatePresence initial={false}>
            {expanded && exp.description && (
              <motion.div
                key="desc"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <p className="mt-5 pt-5 border-t border-white/[0.06] text-sm text-text-muted leading-relaxed">
                  {exp.description}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          {exp.description && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-cyan-bright hover:text-cyan transition-colors"
            >
              {expanded ? 'Less' : 'Read more'}
              <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.3 }}>
                <ChevronDown size={12} />
              </motion.span>
            </button>
          )}
          {exp.metrics && exp.metrics.length > 0 && (
            <div className="mt-6 pt-5 border-t border-white/[0.06] grid grid-cols-3 gap-3">
              {exp.metrics.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.15 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  className="text-center"
                >
                  <p className="font-display text-xl md:text-2xl font-bold bg-gradient-to-br from-violet-bright to-cyan-bright bg-clip-text text-transparent leading-tight">
                    {m.value}
                  </p>
                  <p className="mt-1 text-[9px] md:text-[10px] uppercase tracking-wider text-text-dim">
                    {m.label}
                  </p>
                </motion.div>
              ))}
            </div>
        )}
      </GlassCard>
    </motion.div>
  );
}
