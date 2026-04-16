import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Github } from 'lucide-react';

type Day = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };
type Data = { total: { lastYear: number }; contributions: Day[] };

const USERNAME = import.meta.env.VITE_GITHUB_USERNAME || 'Golden007-prog';
const CACHE_KEY = 'ob-gh-heatmap-v1';
const CACHE_TTL = 6 * 60 * 60 * 1000;

const LEVEL_COLORS = [
  'bg-white/[0.04]',
  'bg-violet/30',
  'bg-violet/55',
  'bg-violet-bright/75',
  'bg-violet-bright',
];

export function GitHubHeatmap() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { at: number; data: Data };
          if (Date.now() - parsed.at < CACHE_TTL) {
            setData(parsed.data);
            return;
          }
        }
        const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${USERNAME}?y=last`);
        if (!res.ok) throw new Error('fetch failed');
        const json = (await res.json()) as Data;
        if (!alive) return;
        setData(json);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: json }));
      } catch {
        if (alive) setError(true);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  if (error || !data) {
    return (
      <div className="glass-strong rounded-2xl p-6 md:p-8 text-center text-sm text-text-dim">
        {error ? 'GitHub activity unavailable right now.' : 'Loading activity…'}
      </div>
    );
  }

  const weeks: Day[][] = [];
  const days = data.contributions;
  if (days.length === 0) return null;
  const firstDow = new Date(days[0].date).getUTCDay();
  let week: Day[] = Array(firstDow).fill({ date: '', count: 0, level: 0 });
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push(week);

  return (
    <div className="glass-strong rounded-2xl p-6 md:p-8">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Github size={16} className="text-violet-bright" />
          <div>
            <p className="font-display text-lg font-semibold">Live from GitHub</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
              {data.total.lastYear} contributions · last year
            </p>
          </div>
        </div>
        <a
          href={`https://github.com/${USERNAME}`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-mono text-cyan-bright hover:text-cyan transition-colors"
        >
          @{USERNAME} →
        </a>
      </div>

      <div className="overflow-x-auto scrollbar-none -mx-2 px-2">
        <div className="flex gap-[3px] min-w-fit">
          {weeks.map((w, wi) => (
            <div key={wi} className="flex flex-col gap-[3px]">
              {Array.from({ length: 7 }).map((_, di) => {
                const day = w[di];
                if (!day || !day.date) {
                  return <span key={di} className="w-[10px] h-[10px] md:w-3 md:h-3 rounded-[2px]" />;
                }
                return (
                  <motion.span
                    key={di}
                    initial={{ opacity: 0, scale: 0.6 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.3, delay: Math.min(wi * 0.01 + di * 0.005, 0.6) }}
                    title={`${day.count} commits on ${day.date}`}
                    className={`w-[10px] h-[10px] md:w-3 md:h-3 rounded-[2px] ${LEVEL_COLORS[day.level]}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 text-[10px] font-mono text-text-dim">
        <span>Less</span>
        {LEVEL_COLORS.map((c, i) => (
          <span key={i} className={`w-2.5 h-2.5 rounded-[2px] ${c}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
