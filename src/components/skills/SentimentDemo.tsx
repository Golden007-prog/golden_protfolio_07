import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, RotateCcw } from 'lucide-react';

const POSITIVE = [
  'love', 'great', 'awesome', 'amazing', 'excellent', 'fantastic', 'brilliant',
  'happy', 'good', 'wonderful', 'beautiful', 'perfect', 'best', 'enjoy',
  'delighted', 'thrilled', 'win', 'elegant', 'smooth', 'fast', 'clean',
];
const NEGATIVE = [
  'hate', 'terrible', 'awful', 'bad', 'poor', 'worst', 'horrible',
  'sad', 'angry', 'broken', 'slow', 'buggy', 'ugly', 'frustrating',
  'disappointing', 'mess', 'fail', 'crash', 'laggy', 'confusing', 'painful',
];
const INTENSIFIERS = ['very', 'really', 'extremely', 'super', 'so'];
const NEGATIONS = ['not', "n't", 'never', 'no'];

type Result = { label: 'positive' | 'neutral' | 'negative'; score: number; matches: string[] };

function analyze(text: string): Result {
  if (!text.trim()) return { label: 'neutral', score: 0, matches: [] };
  const tokens = text.toLowerCase().match(/[a-z']+/g) ?? [];
  let score = 0;
  const matches: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1] ?? '';
    const prev2 = tokens[i - 2] ?? '';
    let w = 0;
    if (POSITIVE.includes(t)) w = 1;
    else if (NEGATIVE.includes(t)) w = -1;
    if (w === 0) continue;
    if (INTENSIFIERS.includes(prev) || INTENSIFIERS.includes(prev2)) w *= 1.6;
    if (NEGATIONS.includes(prev) || NEGATIONS.includes(prev2)) w *= -1;
    score += w;
    matches.push(t);
  }
  const normalized = Math.max(-1, Math.min(1, score / Math.max(3, tokens.length / 2)));
  const label: Result['label'] = normalized > 0.12 ? 'positive' : normalized < -0.12 ? 'negative' : 'neutral';
  return { label, score: normalized, matches };
}

const EXAMPLES = [
  'The new RAG pipeline is blazing fast and surprisingly accurate.',
  "That deploy pipeline broke again — really frustrating debug session.",
  'Meeting went okay, nothing to report.',
];

export function SentimentDemo() {
  const [text, setText] = useState(EXAMPLES[0]);
  const result = useMemo(() => analyze(text), [text]);

  const color =
    result.label === 'positive'
      ? 'text-green-400'
      : result.label === 'negative'
      ? 'text-pink-400'
      : 'text-text-muted';

  const pct = Math.round(((result.score + 1) / 2) * 100);

  return (
    <div className="glass-strong rounded-2xl p-6 md:p-8">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Sparkles size={16} className="text-cyan-bright" />
          <div>
            <p className="font-display text-lg font-semibold">Try it — inline sentiment</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
              Tiny lexicon model · runs in your browser · no API
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setText('')}
          className="flex items-center gap-1.5 text-[11px] font-mono text-text-dim hover:text-violet-bright transition-colors"
        >
          <RotateCcw size={12} /> Clear
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Type or paste some text…"
        className="w-full px-4 py-3 rounded-xl bg-glass-fill border border-glass-border-strong text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-violet-bright/70 focus:ring-2 focus:ring-violet-bright/20 resize-none transition-colors"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLES.map((ex, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setText(ex)}
            className="text-[11px] px-2.5 py-1 rounded-full bg-glass-fill border border-glass-border-strong text-text-muted hover:border-cyan-bright/60 hover:text-text-primary transition-colors"
          >
            Example {i + 1}
          </button>
        ))}
      </div>

      <div className="mt-6 grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2 p-4 rounded-xl bg-glass-fill border border-glass-border-strong">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-dim">Polarity</p>
          <div className="mt-3 h-2 rounded-full bg-glass-border overflow-hidden relative">
            <div className="absolute inset-y-0 left-1/2 w-px bg-glass-border-strong" />
            <motion.div
              className={`h-full ${result.score >= 0 ? 'bg-gradient-to-r from-cyan-bright to-green-400' : 'bg-gradient-to-r from-pink-500 to-red-500'}`}
              style={{
                marginLeft: result.score >= 0 ? '50%' : `${pct}%`,
                width: `${Math.abs(result.score) * 50}%`,
              }}
              animate={{
                marginLeft: result.score >= 0 ? '50%' : `${pct}%`,
                width: `${Math.abs(result.score) * 50}%`,
              }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="mt-2 flex justify-between font-mono text-[10px] text-text-dim">
            <span>−1.0 negative</span>
            <span>0 neutral</span>
            <span>+1.0 positive</span>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-glass-fill border border-glass-border-strong flex flex-col items-center justify-center">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-dim">Label</p>
          <p className={`mt-2 font-display text-2xl font-bold capitalize ${color}`}>{result.label}</p>
          <p className="mt-1 font-mono text-[10px] text-text-dim">score {result.score.toFixed(2)}</p>
        </div>
      </div>

      {result.matches.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.matches.map((m, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded text-[10px] font-mono bg-violet/10 border border-violet-bright/20 text-violet-bright"
            >
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
