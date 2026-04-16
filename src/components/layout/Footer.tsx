import profile from '../../data/profile.json';

export function Footer() {
  return (
    <footer
      className="relative container-padding py-12 border-t border-white/5"
      style={{ zIndex: 40, backgroundColor: '#050508' }}
    >
      <div className="absolute inset-0 -z-10" style={{ backgroundColor: '#050508' }} />
      <div className="mx-auto max-w-[1440px] flex flex-col md:flex-row items-center justify-between gap-6">
        <p className="font-mono text-xs tracking-[0.2em] uppercase text-text-dim">
          © {new Date().getFullYear()} {profile.name} — Crafted with GSAP, R3F & Gemini
        </p>
        <div className="flex items-center gap-5 text-xs font-mono uppercase tracking-wider text-text-muted">
          <a href={profile.links.github} target="_blank" rel="noreferrer" className="hover:text-violet-bright transition-colors">GitHub</a>
          <a href={profile.links.linkedin} target="_blank" rel="noreferrer" className="hover:text-violet-bright transition-colors">LinkedIn</a>
          <a href={profile.links.leetcode} target="_blank" rel="noreferrer" className="hover:text-violet-bright transition-colors">LeetCode</a>
        </div>
      </div>
    </footer>
  );
}
