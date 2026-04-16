import profile from '../../data/profile.json';

const LAUNCH_DATE = new Date('2026-04-01T00:00:00Z');

function daysSinceLaunch() {
  const ms = Date.now() - LAUNCH_DATE.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function Footer() {
  const days = daysSinceLaunch();
  return (
    <footer
      className="relative container-padding py-12 border-t border-white/5"
      style={{ zIndex: 40, backgroundColor: '#050508' }}
    >
      <div className="absolute inset-0 -z-10" style={{ backgroundColor: '#050508' }} />
      <div className="mx-auto max-w-[1440px] flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center md:items-start gap-1">
          <p className="font-mono text-xs tracking-[0.2em] uppercase text-text-dim">
            © {new Date().getFullYear()} {profile.name} — Crafted with GSAP, R3F & Gemini
          </p>
          <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-text-dim/70">
            Launched {days} {days === 1 ? 'day' : 'days'} ago · v1.0
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs font-mono uppercase tracking-wider text-text-muted">
          <a href={profile.links.github} target="_blank" rel="noreferrer" className="hover:text-violet-bright transition-colors">GitHub</a>
          <a href={profile.links.linkedin} target="_blank" rel="noreferrer" className="hover:text-violet-bright transition-colors">LinkedIn</a>
          <a href={profile.links.leetcode} target="_blank" rel="noreferrer" className="hover:text-violet-bright transition-colors">LeetCode</a>
        </div>
      </div>
    </footer>
  );
}
