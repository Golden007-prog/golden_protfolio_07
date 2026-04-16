import { AnimatePresence, motion } from 'framer-motion';
import { X, Github, ExternalLink, Target, Wrench, Sparkles, Star } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from './ProjectCard';

type Props = { project: Project | null; onClose: () => void };

export function ProjectModal({ project, onClose }: Props) {
  useEffect(() => {
    if (!project) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [project, onClose]);

  if (typeof document === 'undefined') return null;

  const base = import.meta.env.BASE_URL;
  const body = (
    <AnimatePresence>
      {project && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md overflow-y-auto overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-label={project.name}
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
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, y: 40, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-5xl bg-[#0A0A0F] border border-white/[0.08] rounded-2xl shadow-2xl my-auto overflow-hidden"
            >
              <div className="relative h-56 md:h-72 overflow-hidden">
                <img
                  src={project.thumbnail.startsWith('/') ? base + project.thumbnail.slice(1) : project.thumbnail}
                  alt={project.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0F] via-[#0A0A0F]/60 to-transparent" />
                <div className="absolute bottom-6 left-6 md:left-10">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-violet-bright font-mono mb-2">
                    {project.category}
                    {project.featured && <span className="ml-3 text-cyan-bright">· Featured</span>}
                  </p>
                  <h2 className="text-3xl md:text-5xl font-display font-bold text-text-primary">{project.name}</h2>
                  <p className="mt-2 font-mono text-sm text-text-muted">{project.tagline}</p>
                </div>
              </div>

              <div className="p-6 md:p-10 space-y-8">
                <div className="flex flex-wrap gap-2">
                  {project.techStack.map((t) => (
                    <span key={t} className="px-3 py-1 text-xs rounded-full bg-violet/10 border border-violet-bright/20 text-violet-bright">
                      {t}
                    </span>
                  ))}
                </div>

                <section>
                  <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-3">
                    <Target size={12} /> What I built
                  </h3>
                  <p className="text-base md:text-lg text-text-secondary leading-relaxed">{project.shortDescription}</p>
                </section>

                {project.fullDescription && project.fullDescription !== project.shortDescription && (
                  <section>
                    <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-3">
                      <Wrench size={12} /> How it works
                    </h3>
                    <p className="text-base text-text-secondary leading-relaxed">{project.fullDescription}</p>
                  </section>
                )}

                <section>
                  <h3 className="flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                    <Sparkles size={12} /> At a glance
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Metric value={project.techStack.length.toString()} label="Stack deps" />
                    <Metric value={project.topics.length.toString()} label="Domain tags" />
                    <Metric value={project.language} label="Primary lang" />
                    <Metric
                      value={project.stars > 0 ? `${project.stars}★` : (project.liveUrl ? 'Live' : 'OSS')}
                      label={project.stars > 0 ? 'GitHub stars' : 'Status'}
                      icon={project.stars > 0 ? <Star size={12} /> : undefined}
                    />
                  </div>
                </section>

                {project.topics.length > 0 && (
                  <section>
                    <h3 className="text-[10px] uppercase tracking-[0.25em] text-violet-bright font-mono mb-4">
                      Domains
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {project.topics.map((t) => (
                        <span key={t} className="px-3 py-1 text-xs rounded-full bg-white/[0.04] border border-white/[0.06] text-text-secondary">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                <section className="flex flex-wrap gap-3 pt-4 border-t border-white/[0.06]">
                  <a
                    href={project.githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.08] text-sm text-text-secondary hover:border-violet-bright/60 hover:text-text-primary transition-all"
                  >
                    <Github size={14} /> View Code
                  </a>
                  {project.liveUrl && (
                    <a
                      href={project.liveUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-violet to-violet-bright text-white text-sm hover:from-violet-bright hover:to-cyan-bright hover:shadow-[0_0_40px_rgba(168,85,247,0.4)] transition-all"
                    >
                      <ExternalLink size={14} /> Live Demo
                    </a>
                  )}
                </section>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(body, document.body);
}

function Metric({ value, label, icon }: { value: string; label: string; icon?: React.ReactNode }) {
  return (
    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] text-center">
      <p className="flex items-center justify-center gap-1.5 text-2xl md:text-3xl font-display font-bold bg-gradient-to-br from-violet-bright to-cyan-bright bg-clip-text text-transparent">
        {icon}
        {value}
      </p>
      <p className="text-[10px] text-text-dim uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}
