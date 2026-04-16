import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, X, Send, Sparkles } from 'lucide-react';
import profile from '../../data/profile.json';
import projects from '../../data/projects.json';

type Msg = { from: 'bot' | 'user'; text: string; actions?: Array<{ label: string; url: string }> };

type SkillMap = Record<string, string[]>;

const STARTERS = [
  'What do you work on?',
  'Show me your best projects',
  'What tech do you use?',
  'How do I hire you?',
];

function formatExperience() {
  return profile.experience
    .map((e) => `· ${e.role} @ ${e.company} (${e.duration}) — ${e.highlights[0]}`)
    .join('\n');
}

function topProjects(n = 3) {
  return (projects as Array<{ name: string; tagline: string; featured: boolean; githubUrl: string; liveUrl: string | null }>)
    .filter((p) => p.featured)
    .slice(0, n);
}

function searchProjects(q: string) {
  const lc = q.toLowerCase();
  return (projects as Array<{ name: string; tagline: string; shortDescription: string; techStack: string[]; topics: string[]; githubUrl: string; liveUrl: string | null }>)
    .map((p) => {
      const hay = `${p.name} ${p.tagline} ${p.shortDescription} ${p.techStack.join(' ')} ${p.topics.join(' ')}`.toLowerCase();
      const score = lc.split(/\s+/).filter(Boolean).reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.p);
}

function matchSkill(q: string): string | null {
  const lc = q.toLowerCase();
  const skills = profile.skills as SkillMap;
  for (const [cat, list] of Object.entries(skills)) {
    for (const s of list) {
      if (lc.includes(s.toLowerCase())) return `${s} — in **${cat}**. I've used it in production workflows; ask about a specific project.`;
    }
  }
  return null;
}

function answer(q: string): Msg {
  const lc = q.toLowerCase().trim();
  if (!lc) return { from: 'bot', text: "Ask me anything about Oikantik's work, projects, or skills." };

  if (/(hire|work with|contact|email|reach)/.test(lc)) {
    return {
      from: 'bot',
      text: `Easiest way: drop a note at **${profile.email}** or use the contact form below. Open to AI/ML engineering roles and consulting.`,
      actions: [
        { label: 'Email', url: `mailto:${profile.email}` },
        { label: 'LinkedIn', url: profile.links.linkedin },
      ],
    };
  }

  if (/(resume|cv|download)/.test(lc)) {
    const base = import.meta.env.BASE_URL;
    return { from: 'bot', text: 'Here is my CV.', actions: [{ label: 'Download CV', url: `${base}oikantik_basu_u.pdf` }] };
  }

  if (/(about|who are you|yourself|background|bio)/.test(lc)) {
    return { from: 'bot', text: profile.about.slice(0, 320) + '…' };
  }

  if (/(experience|job|work history|role|company|companies)/.test(lc)) {
    return { from: 'bot', text: formatExperience() };
  }

  if (/(education|degree|college|university|study)/.test(lc)) {
    return {
      from: 'bot',
      text: profile.education.map((e) => `· ${e.degree} — ${e.institution} (${e.year}) · ${e.status}`).join('\n'),
    };
  }

  if (/(stack|tech|tools|language|framework)/.test(lc)) {
    const skills = profile.skills as SkillMap;
    return {
      from: 'bot',
      text: Object.entries(skills)
        .map(([cat, list]) => `**${cat}:** ${list.slice(0, 6).join(', ')}`)
        .join('\n'),
    };
  }

  if (/(best|top|featured|favorite|highlight) (project|work)/.test(lc) || /(show|list) (me )?(projects?|work)/.test(lc)) {
    const top = topProjects();
    return {
      from: 'bot',
      text: top.map((p) => `· **${p.name}** — ${p.tagline}`).join('\n'),
      actions: top.map((p) => ({ label: p.name, url: p.liveUrl || p.githubUrl })),
    };
  }

  if (/(project|built|made|created|shipped)/.test(lc)) {
    const results = searchProjects(lc);
    if (results.length) {
      return {
        from: 'bot',
        text: results.map((p) => `· **${p.name}** — ${p.tagline}`).join('\n'),
        actions: results.map((p) => ({ label: p.name, url: p.liveUrl || p.githubUrl })),
      };
    }
  }

  const skillHit = matchSkill(lc);
  if (skillHit) return { from: 'bot', text: skillHit };

  // Last resort: try project search regardless of keyword
  const results = searchProjects(lc);
  if (results.length) {
    return {
      from: 'bot',
      text: `Here's what matched:\n${results.map((p) => `· **${p.name}** — ${p.tagline}`).join('\n')}`,
      actions: results.map((p) => ({ label: p.name, url: p.liveUrl || p.githubUrl })),
    };
  }

  return {
    from: 'bot',
    text: "I didn't catch that. Try asking about **projects**, **tech stack**, **experience**, or how to **hire** me.",
  };
}

function renderInline(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const parts = line.split(/\*\*(.+?)\*\*/g);
    return (
      <span key={i} className="block">
        {parts.map((p, j) => (j % 2 === 1 ? <strong key={j} className="text-violet-bright">{p}</strong> : <span key={j}>{p}</span>))}
      </span>
    );
  });
}

export function AskMeBot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([
    { from: 'bot', text: `Hey — I'm Oikantik's portfolio assistant. Ask about projects, skills, or how to work together.` },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const starters = useMemo(() => STARTERS, []);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  const send = (text?: string) => {
    const q = (text ?? input).trim();
    if (!q) return;
    setMessages((m) => [...m, { from: 'user', text: q }]);
    setInput('');
    setTimeout(() => setMessages((m) => [...m, answer(q)]), 280);
  };

  return (
    <>
      <motion.button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1.5, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-violet to-violet-bright shadow-[0_8px_32px_rgba(124,58,237,0.5)] flex items-center justify-center text-white hover:shadow-[0_12px_40px_rgba(168,85,247,0.6)] transition-shadow"
      >
        <AnimatePresence mode="wait">
          {open ? (
            <motion.span key="x" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <X size={22} />
            </motion.span>
          ) : (
            <motion.span key="msg" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}>
              <MessageSquare size={22} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-24 right-6 z-40 w-[calc(100vw-3rem)] max-w-sm h-[520px] max-h-[calc(100vh-8rem)] glass-strong rounded-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet to-cyan-bright flex items-center justify-center">
                <Sparkles size={14} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary">Ask Oikantik</p>
                <p className="text-[10px] font-mono text-text-dim">Portfolio assistant · beta</p>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      m.from === 'user'
                        ? 'bg-gradient-to-br from-violet to-violet-bright text-white'
                        : 'bg-white/[0.04] border border-white/[0.06] text-text-secondary'
                    }`}
                  >
                    <div className="whitespace-pre-wrap">{renderInline(m.text)}</div>
                    {m.actions && m.actions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.actions.map((a) => (
                          <a
                            key={a.label}
                            href={a.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] px-2 py-1 rounded-full bg-violet-bright/20 border border-violet-bright/30 text-violet-bright hover:bg-violet-bright/30 transition-colors"
                          >
                            {a.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {messages.length <= 2 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1.5">
                {starters.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] text-text-muted hover:border-violet-bright/40 hover:text-text-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-center gap-2 p-3 border-t border-white/[0.06]"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-full px-4 py-2 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-violet-bright/50"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={!input.trim()}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-violet to-violet-bright text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-shadow"
              >
                <Send size={14} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
