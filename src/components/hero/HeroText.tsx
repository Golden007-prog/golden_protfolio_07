import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { GradientText } from '../shared/GradientText';
import profile from '../../data/profile.json';

const ROLES = [
  'Applied AI/ML Analyst',
  'Data Science Graduate',
  'LLM & NLP Engineer',
  'Prompt Engineer',
  'Data Pipeline Builder',
];

function useTypewriter(words: string[], speed = 70, pause = 1400) {
  const [i, setI] = useState(0);
  const [text, setText] = useState('');
  const [del, setDel] = useState(false);

  useEffect(() => {
    const target = words[i % words.length];
    const done = text === target;
    const empty = text === '';
    const wait = del ? speed / 2 : done ? pause : speed;
    const t = setTimeout(() => {
      if (done && !del) setDel(true);
      else if (empty && del) { setDel(false); setI((v) => v + 1); }
      else setText(del ? target.slice(0, text.length - 1) : target.slice(0, text.length + 1));
    }, wait);
    return () => clearTimeout(t);
  }, [text, del, i, words, speed, pause]);

  return text;
}

export function HeroText() {
  const role = useTypewriter(ROLES);
  return (
    <div className="relative z-10 flex flex-col justify-center h-full">
      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.8 }}
        className="font-mono text-xs tracking-[0.4em] uppercase text-cyan-bright/80 mb-6"
      >
        {profile.location} · Available for hire
      </motion.p>

      <motion.h1
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 1, ease: [0.16, 1, 0.3, 1] }}
        className="font-display font-black leading-[0.95] tracking-[-0.035em] text-[clamp(3rem,11vw,9rem)]"
      >
        <GradientText>Oikantik</GradientText>
        <br />
        <span className="text-outline">Basu.</span>
      </motion.h1>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.6 }}
        className="mt-6 font-mono text-base md:text-xl text-text-secondary"
      >
        <span className="text-text-muted">&gt;_</span>{' '}
        <span className="text-violet-bright">{role}</span>
        <span className="typing-cursor" />
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1, duration: 0.8 }}
        className="mt-8 max-w-xl text-base md:text-lg text-text-muted leading-relaxed"
      >
        {profile.headline}. Shipping production ML, LLM agents, and cinematic UIs from Bengaluru.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.3, duration: 0.8 }}
        className="mt-10 flex flex-wrap items-center gap-4"
      >
        <a
          href="#projects"
          className="glass px-7 py-3.5 text-sm font-medium text-text-primary hover:border-violet-bright/60 hover:glow-violet transition-all"
        >
          View Projects →
        </a>
        <a
          href="#contact"
          className="px-7 py-3.5 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors"
        >
          Get in touch
        </a>
      </motion.div>
    </div>
  );
}
