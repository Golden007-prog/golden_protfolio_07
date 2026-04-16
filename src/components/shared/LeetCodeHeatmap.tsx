import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Code2 } from 'lucide-react';

type Stats = {
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  ranking: number;
  acceptanceRate: number;
};

type CalendarDay = { date: string; count: number; level: 0 | 1 | 2 | 3 | 4 };

const USERNAME = 'oikantik007';
const STATS_ENDPOINT = `https://leetcode-stats-api.herokuapp.com/${USERNAME}`;
const CALENDAR_ENDPOINT = `https://alfa-leetcode-api.onrender.com/userProfileCalendar?username=${USERNAME}`;
const CACHE_KEY = 'ob-leetcode-heatmap-v1';
const CACHE_TTL = 6 * 60 * 60 * 1000;

const LEVEL_COLORS = [
  'bg-white/[0.04]',
  'bg-amber/25',
  'bg-amber/50',
  'bg-amber/75',
  'bg-amber',
];

function bucketLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

function buildCalendar(submissionCalendarJson: string): CalendarDay[] {
  let raw: Record<string, number> = {};
  try {
    raw = JSON.parse(submissionCalendarJson);
  } catch {
    return [];
  }
  const counts = new Map<string, number>();
  for (const [ts, c] of Object.entries(raw)) {
    const d = new Date(Number(ts) * 1000);
    const key = d.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + (c as number));
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 364);

  const days: CalendarDay[] = [];
  for (let d = new Date(start); d <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const count = counts.get(key) || 0;
    days.push({ date: key, count, level: bucketLevel(count) });
  }
  return days;
}

export function LeetCodeHeatmap() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState<CalendarDay[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as {
            at: number;
            stats: Stats;
            days: CalendarDay[];
          };
          if (Date.now() - parsed.at < CACHE_TTL) {
            setStats(parsed.stats);
            setDays(parsed.days);
            return;
          }
        }

        const [statsRes, calRes] = await Promise.allSettled([
          fetch(STATS_ENDPOINT).then((r) => (r.ok ? r.json() : Promise.reject())),
          fetch(CALENDAR_ENDPOINT).then((r) => (r.ok ? r.json() : Promise.reject())),
        ]);

        let nextStats: Stats | null = null;
        let nextDays: CalendarDay[] = [];

        if (statsRes.status === 'fulfilled') {
          const s = statsRes.value;
          nextStats = {
            totalSolved: s.totalSolved ?? 0,
            easySolved: s.easySolved ?? 0,
            mediumSolved: s.mediumSolved ?? 0,
            hardSolved: s.hardSolved ?? 0,
            ranking: s.ranking ?? 0,
            acceptanceRate: s.acceptanceRate ?? 0,
          };
        }

        if (calRes.status === 'fulfilled') {
          const cal = calRes.value;
          const raw =
            cal?.data?.matchedUser?.userCalendar?.submissionCalendar ??
            cal?.submissionCalendar ??
            '';
          if (raw) nextDays = buildCalendar(raw);
        }

        if (!alive) return;

        if (!nextStats && !nextDays.length) {
          setError(true);
          return;
        }

        setStats(nextStats);
        setDays(nextDays);
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ at: Date.now(), stats: nextStats, days: nextDays }),
        );
      } catch {
        if (alive) setError(true);
      }
    }
    load();
    return () => {
      alive = false;
    };
  }, []);

  const weeks = useMemo<CalendarDay[][]>(() => {
    if (!days || !days.length) return [];
    const result: CalendarDay[][] = [];
    const firstDow = new Date(days[0].date).getUTCDay();
    let week: CalendarDay[] = Array(firstDow).fill({ date: '', count: 0, level: 0 });
    for (const d of days) {
      week.push(d);
      if (week.length === 7) {
        result.push(week);
        week = [];
      }
    }
    if (week.length) result.push(week);
    return result;
  }, [days]);

  const totalLastYear = useMemo(
    () => (days ? days.reduce((s, d) => s + (d.count || 0), 0) : 0),
    [days],
  );

  if (error) {
    return (
      <div className="glass-strong rounded-2xl p-6 md:p-8 text-center text-sm text-text-dim">
        LeetCode stats unavailable right now.
      </div>
    );
  }

  if (!stats && !days) {
    return (
      <div className="glass-strong rounded-2xl p-6 md:p-8 text-center text-sm text-text-dim">
        Loading LeetCode…
      </div>
    );
  }

  return (
    <div className="glass-strong rounded-2xl p-6 md:p-8">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Code2 size={16} className="text-amber" />
          <div>
            <p className="font-display text-lg font-semibold">Live from LeetCode</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
              {stats ? `${stats.totalSolved} solved` : `${totalLastYear} submissions`} · last year
            </p>
          </div>
        </div>
        <a
          href={`https://leetcode.com/u/${USERNAME}/`}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] font-mono text-amber hover:text-amber/70 transition-colors"
        >
          @{USERNAME} →
        </a>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
          <Stat label="Total" value={stats.totalSolved} tone="violet" />
          <Stat label="Easy" value={stats.easySolved} tone="cyan" />
          <Stat label="Medium" value={stats.mediumSolved} tone="amber" />
          <Stat label="Hard" value={stats.hardSolved} tone="pink" />
        </div>
      )}

      {weeks.length > 0 && (
        <div className="overflow-x-auto scrollbar-none -mx-2 px-2">
          <div className="flex gap-[3px] min-w-fit">
            {weeks.map((w, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }).map((_, di) => {
                  const day = w[di];
                  if (!day || !day.date) {
                    return (
                      <span
                        key={di}
                        className="w-[10px] h-[10px] md:w-3 md:h-3 rounded-[2px]"
                      />
                    );
                  }
                  return (
                    <motion.span
                      key={di}
                      initial={{ opacity: 0, scale: 0.6 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{
                        duration: 0.3,
                        delay: Math.min(wi * 0.01 + di * 0.005, 0.6),
                      }}
                      title={`${day.count} submission${day.count === 1 ? '' : 's'} on ${day.date}`}
                      className={`w-[10px] h-[10px] md:w-3 md:h-3 rounded-[2px] ${LEVEL_COLORS[day.level]}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 text-[10px] font-mono text-text-dim">
        {stats && stats.ranking > 0 ? (
          <span>
            Global rank <span className="text-amber">#{stats.ranking.toLocaleString()}</span>
            {stats.acceptanceRate > 0 && (
              <> · Acceptance {stats.acceptanceRate.toFixed(1)}%</>
            )}
          </span>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-2">
          <span>Less</span>
          {LEVEL_COLORS.map((c, i) => (
            <span key={i} className={`w-2.5 h-2.5 rounded-[2px] ${c}`} />
          ))}
          <span>More</span>
        </span>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'violet' | 'cyan' | 'amber' | 'pink';
}) {
  const colorMap: Record<string, string> = {
    violet: 'text-violet-bright border-violet-bright/25',
    cyan: 'text-cyan-bright border-cyan-bright/25',
    amber: 'text-amber border-amber/30',
    pink: 'text-pink border-pink/25',
  };
  return (
    <div
      className={`rounded-xl border ${colorMap[tone]} bg-white/[0.02] px-3 py-2.5`}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-text-dim">
        {label}
      </p>
      <p className={`font-display text-2xl font-bold mt-1 ${colorMap[tone].split(' ')[0]}`}>
        {value}
      </p>
    </div>
  );
}
