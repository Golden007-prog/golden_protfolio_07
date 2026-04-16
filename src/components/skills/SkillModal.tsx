import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X, ExternalLink, BookOpen, Github, FileText } from 'lucide-react';
import type { SkillDetail } from '../../types/skills';

type Props = {
  skill: SkillDetail;
  onClose: () => void;
};

export function SkillModal({ skill, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const base = import.meta.env.BASE_URL;
  const heroSrc = skill.heroImage ? `${base}${skill.heroImage.replace(/^\//, '')}` : '';

  const node = (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md overflow-y-auto overscroll-contain"
      role="dialog"
      aria-modal="true"
      aria-label={skill.name}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
        className="fixed top-4 right-4 md:top-6 md:right-6 z-[110] w-11 h-11 rounded-full bg-black/70 backdrop-blur border border-white/[0.15] flex items-center justify-center hover:bg-white/10 transition-colors"
      >
        <X className="w-5 h-5 text-white" />
      </button>
      <div className="flex min-h-full items-start md:items-center justify-center p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-5xl bg-[#0A0A0F] border border-white/[0.08] rounded-2xl shadow-2xl my-auto"
      >
        <div className="relative h-56 md:h-72 overflow-hidden">
          {skill.videoDemo ? (
            <video autoPlay muted loop playsInline className="w-full h-full object-cover">
              <source src={`${base}${skill.videoDemo.replace(/^\//, '')}`} type="video/mp4" />
            </video>
          ) : heroSrc ? (
            <img src={heroSrc} alt={skill.name} loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-violet/30 via-bg-base to-cyan/20" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F]/60 to-transparent" />


          <div className="absolute bottom-6 left-6 md:left-10">
            <p className="text-[10px] uppercase tracking-[0.3em] text-violet-bright font-mono mb-2">
              {skill.category}
            </p>
            <h2 className="text-3xl md:text-5xl font-display font-bold text-text-primary">{skill.name}</h2>
          </div>
        </div>

        <div className="p-6 md:p-10 space-y-8">
          {skill.purpose && (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-3">
                Purpose
              </h3>
              <p className="text-base md:text-lg text-text-secondary leading-relaxed">{skill.purpose}</p>
            </section>
          )}

          {(skill.coreComponents.length > 0 || skill.keyCapabilities.length > 0) && (
            <div className="grid md:grid-cols-2 gap-8">
              {skill.coreComponents.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                    Core Components
                  </h3>
                  <ul className="space-y-2">
                    {skill.coreComponents.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-text-muted">
                        <span className="text-violet-bright mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {skill.keyCapabilities.length > 0 && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                    Key Capabilities
                  </h3>
                  <ul className="space-y-2">
                    {skill.keyCapabilities.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-text-muted">
                        <span className="text-cyan-bright mt-1">•</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          {skill.integrations.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                Integrations
              </h3>
              <div className="flex flex-wrap gap-2">
                {skill.integrations.map((item, i) => (
                  <span
                    key={i}
                    className="px-3 py-1 text-xs rounded-full bg-white/[0.04] border border-white/[0.06] text-text-secondary"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </section>
          )}

          {skill.useCases.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                Real-World Use Cases
              </h3>
              <div className="grid md:grid-cols-3 gap-4">
                {skill.useCases.map((item, i) => (
                  <div key={i} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06]">
                    <p className="text-sm text-text-muted leading-relaxed">{item}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {skill.officialDocs && (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                Documentation
              </h3>
              <a
                href={skill.officialDocs}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet/10 border border-violet-bright/30 text-violet-bright hover:bg-violet/20 transition-colors text-sm"
              >
                <BookOpen className="w-4 h-4" />
                Official Documentation
                <ExternalLink className="w-3 h-3" />
              </a>
            </section>
          )}

          {skill.researchPapers.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                Research Papers
              </h3>
              <div className="space-y-2">
                {skill.researchPapers.map((paper, i) => (
                  <a
                    key={i}
                    href={paper.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-bright/30 hover:bg-white/[0.04] transition-all group"
                  >
                    <FileText className="w-5 h-5 text-violet-bright flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary font-medium group-hover:text-violet-bright transition-colors">
                        {paper.title}
                      </p>
                      {paper.authors && <p className="text-xs text-text-dim mt-1">{paper.authors}</p>}
                    </div>
                    <ExternalLink className="w-4 h-4 text-text-dim group-hover:text-violet-bright flex-shrink-0 mt-0.5" />
                  </a>
                ))}
              </div>
            </section>
          )}

          {skill.relatedRepos.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                Related Projects
              </h3>
              <div className="grid md:grid-cols-2 gap-3">
                {skill.relatedRepos.map((repo, i) => (
                  <a
                    key={i}
                    href={repo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] hover:border-violet-bright/30 hover:bg-white/[0.04] transition-all group"
                  >
                    <Github className="w-5 h-5 text-text-dim flex-shrink-0 mt-0.5 group-hover:text-text-primary transition-colors" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary font-medium truncate group-hover:text-violet-bright transition-colors">
                        {repo.name}
                      </p>
                      <p className="text-xs text-text-dim mt-1 line-clamp-2">{repo.description}</p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {skill.sources.length > 0 && (
            <section className="pt-6 border-t border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-[0.2em] text-text-dim font-mono mb-2">
                Sourced from
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {skill.sources.slice(0, 8).map((src, i) => {
                  let host = src;
                  try { host = new URL(src).hostname; } catch { /* ignore */ }
                  return (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-text-dim hover:text-violet-bright truncate max-w-[220px] transition-colors"
                    >
                      {host}
                    </a>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </motion.div>
      </div>
    </motion.div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
