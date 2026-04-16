import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { SectionWrapper } from '../layout/SectionWrapper';
import { SectionHeading } from './SectionHeading';
import { GlassCard } from './GlassCard';

const TENETS = [
  {
    n: '01',
    title: 'Ship the boring version first.',
    body: 'A working end-to-end pipeline beats a half-finished clever one. Prove the wire, then tune the signal.',
  },
  {
    n: '02',
    title: 'Evals before vibes.',
    body: 'If you can’t measure it, you’re guessing. Every LLM feature gets a scored test set before it gets a UI.',
  },
  {
    n: '03',
    title: 'Small models, sharp prompts.',
    body: 'Most production problems don’t need a frontier model — they need a well-indexed retrieval layer and crisp instructions.',
  },
  {
    n: '04',
    title: 'Observability is a feature.',
    body: 'Traces, token counts, latency histograms, cost dashboards. The team that can see the system can fix the system.',
  },
  {
    n: '05',
    title: 'Data > architecture.',
    body: 'A clean, labeled, deduped dataset beats a fancy model. Spend the weekend on the CSVs, not the ConvNet.',
  },
  {
    n: '06',
    title: 'Write the docs you wish existed.',
    body: 'Half of engineering is unblocking the next person — usually future you. README first, commit second.',
  },
];

export function PhilosophySection() {
  return (
    <SectionWrapper id="philosophy">
      <SectionHeading
        kicker="05 / Principles"
        title="How I *build*."
        subtitle="Six working beliefs I return to — earned from production LLM systems, not from reading about them."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {TENETS.map((t, i) => (
          <motion.div
            key={t.n}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10%' }}
            transition={{ duration: 0.55, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
          >
            <GlassCard strong className="p-6 md:p-7 h-full relative group overflow-hidden">
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br from-violet-bright/20 to-cyan-bright/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                  <span className="font-mono text-[10px] uppercase tracking-[0.3em] bg-gradient-to-r from-violet-bright to-cyan-bright bg-clip-text text-transparent">
                    {t.n}
                  </span>
                  <Sparkles size={12} className="text-violet-bright/60" />
                </div>
                <h3 className="font-display text-lg md:text-xl font-semibold text-text-primary leading-snug">
                  {t.title}
                </h3>
                <p className="mt-3 text-sm text-text-muted leading-relaxed">{t.body}</p>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </SectionWrapper>
  );
}
