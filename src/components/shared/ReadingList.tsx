import { motion } from 'framer-motion';
import { BookOpen, FileText, ArrowUpRight } from 'lucide-react';
import reading from '../../data/reading.json';

type Item = {
  title: string;
  authors: string;
  year: string;
  kind: 'paper' | 'book';
  tag: string;
  note: string;
  url: string;
};

export function ReadingList() {
  const items = reading as Item[];
  return (
    <div className="glass-strong rounded-2xl p-6 md:p-8">
      <div className="flex items-center gap-3 mb-6">
        <BookOpen size={16} className="text-cyan-bright" />
        <div>
          <p className="font-display text-lg font-semibold">What I'm reading</p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
            Papers and books that shape how I build
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-3 auto-rows-fr">
        {items.map((item, i) => (
          <motion.a
            key={item.title}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -3 }}
            className="group flex flex-col h-full p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-bright/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
                {item.kind === 'paper' ? (
                  <FileText size={11} className="text-violet-bright" />
                ) : (
                  <BookOpen size={11} className="text-cyan-bright" />
                )}
                <span className="text-text-dim">{item.tag} · {item.year}</span>
              </div>
              <ArrowUpRight size={14} className="text-text-dim group-hover:text-violet-bright transition-colors shrink-0" />
            </div>
            <p className="mt-2 text-sm font-semibold text-text-primary group-hover:text-violet-bright transition-colors leading-snug">
              {item.title}
            </p>
            <p className="mt-0.5 text-[11px] text-text-dim">{item.authors}</p>
            <p className="mt-2 text-xs text-text-muted leading-relaxed flex-1">{item.note}</p>
          </motion.a>
        ))}
      </div>
    </div>
  );
}
