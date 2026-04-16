import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitCommit } from 'lucide-react';

type Status = {
  type: 'coding' | 'idle';
  message: string;
  repo: string;
  time: string;
  url: string;
};

const USERNAME = import.meta.env.VITE_GITHUB_USERNAME || 'Golden007-prog';
const CACHE_KEY = 'ob-live-status-v1';
const CACHE_TTL = 5 * 60 * 1000;

function relativeTime(from: Date) {
  const diff = Date.now() - from.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return from.toLocaleDateString();
}

export function LiveStatusBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as { at: number; status: Status };
          if (Date.now() - parsed.at < CACHE_TTL) {
            setStatus(parsed.status);
            return;
          }
        }
        const res = await fetch(
          `https://api.github.com/users/${USERNAME}/events/public?per_page=20`,
        );
        if (!res.ok) return;
        const events = (await res.json()) as Array<{
          type: string;
          repo: { name: string };
          created_at: string;
          payload: { commits?: Array<{ message: string }> };
        }>;
        const push = events.find((e) => e.type === 'PushEvent' && e.payload?.commits?.length);
        if (!push || !alive) return;
        const created = new Date(push.created_at);
        const hoursAgo = (Date.now() - created.getTime()) / 3600000;
        const msg = push.payload.commits?.[0]?.message?.split('\n')[0]?.slice(0, 64) || 'shipping';
        const repo = push.repo.name.split('/')[1] ?? push.repo.name;
        const next: Status = {
          type: hoursAgo < 48 ? 'coding' : 'idle',
          message: msg,
          repo,
          time: relativeTime(created),
          url: `https://github.com/${push.repo.name}`,
        };
        setStatus(next);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), status: next }));
      } catch {
        /* swallow */
      }
    }
    load();
    const interval = setInterval(load, CACHE_TTL);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <AnimatePresence>
      {status && !dismissed && (
        <motion.a
          href={status.url}
          target="_blank"
          rel="noreferrer"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 1.2 }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[data-dismiss]')) {
              e.preventDefault();
              setDismissed(true);
            }
          }}
          className="hidden md:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-40 items-center gap-3 px-4 py-2 rounded-full glass-strong text-xs font-mono hover:border-violet-bright/40 transition-colors group"
          aria-label={`Latest activity: ${status.message}`}
        >
          <span
            className={`w-2 h-2 rounded-full ${status.type === 'coding' ? 'bg-green-400' : 'bg-text-dim'} animate-pulse`}
          />
          <GitCommit size={12} className="text-violet-bright" />
          <span className="text-text-dim">Last push</span>
          <span className="text-violet-bright truncate max-w-[160px]">{status.repo}</span>
          <span className="text-text-muted truncate max-w-[240px] hidden lg:inline">
            "{status.message}"
          </span>
          <span className="text-text-dim">· {status.time}</span>
          <button
            type="button"
            data-dismiss
            aria-label="Dismiss"
            className="ml-1 text-text-dim hover:text-text-primary transition-colors px-1"
          >
            ×
          </button>
        </motion.a>
      )}
    </AnimatePresence>
  );
}
