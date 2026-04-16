import { motion } from 'framer-motion';
import { Code, Laptop, Terminal, Keyboard, GitBranch, Box } from 'lucide-react';

const TOOLS = [
  { icon: Code, label: 'Editor', value: 'VS Code · Cursor' },
  { icon: Laptop, label: 'OS', value: 'macOS · WSL' },
  { icon: Terminal, label: 'Shell', value: 'zsh · oh-my-zsh' },
  { icon: GitBranch, label: 'Dev flow', value: 'GitHub · conventional commits' },
  { icon: Box, label: 'Containers', value: 'Docker · Compose' },
  { icon: Keyboard, label: 'Keyboard', value: 'Keychron K2 · mono' },
];

export function ToolsStrip() {
  return (
    <div className="container-padding mx-auto max-w-[1440px] py-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-15%' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="glass rounded-2xl p-5 md:p-6"
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-bright/80">
            Daily setup
          </span>
          <span className="h-px flex-1 bg-gradient-to-r from-cyan-bright/40 to-transparent" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {TOOLS.map((t, i) => (
            <motion.div
              key={t.label}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
              className="flex items-start gap-3"
            >
              <t.icon size={16} className="text-violet-bright mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-dim">
                  {t.label}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary truncate">{t.value}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
