import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Github, ExternalLink } from 'lucide-react';
import { GlassCard } from '../shared/GlassCard';

export type Project = {
  name: string;
  slug: string;
  shortDescription: string;
  fullDescription: string;
  tagline: string;
  category: string;
  featured: boolean;
  language: string;
  techStack: string[];
  topics: string[];
  githubUrl: string;
  liveUrl: string | null;
  thumbnail: string;
  stars: number;
  demoVideo?: string;
};

type Props = { project: Project; onOpen: (p: Project) => void };

export function ProjectCard({ project, onOpen }: Props) {
  const base = import.meta.env.BASE_URL;
  const thumb = project.thumbnail.startsWith('/') ? base + project.thumbnail.slice(1) : project.thumbnail;
  const [hovered, setHovered] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const onEnter = () => {
    setHovered(true);
    if (project.demoVideo && videoRef.current) {
      videoRef.current.currentTime = 0;
      void videoRef.current.play().catch(() => {});
    }
  };
  const onLeave = () => {
    setHovered(false);
    if (videoRef.current) {
      videoRef.current.pause();
    }
  };

  return (
    <motion.div
      onClick={() => onOpen(project)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(project);
        }
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      whileHover={{ y: -8 }}
      style={{ transformPerspective: 1200 }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${project.name} details`}
      className="text-left w-full group cursor-pointer"
    >
      <GlassCard strong className="overflow-hidden h-full transition-all duration-500 group-hover:border-violet-bright/30 group-hover:shadow-[0_16px_60px_rgba(124,58,237,0.25)]">
        <div className="relative aspect-[16/10] overflow-hidden">
          <img
            src={thumb}
            alt={project.name}
            loading="lazy"
            className={`w-full h-full object-cover transition-all duration-700 ${hovered ? 'opacity-0 scale-110' : 'opacity-80 scale-100'}`}
          />
          {project.demoVideo && (
            <video
              ref={videoRef}
              muted
              loop
              playsInline
              preload="none"
              poster={thumb}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${hovered ? 'opacity-100' : 'opacity-0'}`}
            >
              <source src={project.demoVideo.startsWith('/') ? base + project.demoVideo.slice(1) : project.demoVideo} type="video/mp4" />
            </video>
          )}
          {!project.demoVideo && (
            <div
              className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${hovered ? 'opacity-100' : 'opacity-0'}`}
              style={{
                background:
                  'radial-gradient(circle at 30% 20%, rgba(168,85,247,0.35), transparent 55%), radial-gradient(circle at 70% 80%, rgba(34,211,238,0.25), transparent 55%)',
              }}
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-elevated via-bg-elevated/40 to-transparent" />
          <div className="absolute top-3 left-3 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-full glass text-cyan-bright">
              {project.category}
            </span>
            {project.featured && (
              <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-full bg-violet-bright/20 text-violet-bright border border-violet-bright/40">
                Featured
              </span>
            )}
          </div>
          <ArrowUpRight className="absolute top-3 right-3 text-text-muted group-hover:text-violet-bright transition-colors" size={18} />
        </div>

        <div className="p-5">
          <h3 className="font-display text-xl font-semibold text-text-primary group-hover:text-violet-bright transition-colors">
            {project.name}
          </h3>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-cyan-bright/80">
            {project.tagline}
          </p>
          <p className="mt-3 text-sm text-text-muted line-clamp-3 leading-relaxed">
            {project.shortDescription}
          </p>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {project.techStack.slice(0, 4).map((t) => (
              <span key={t} className="px-2 py-0.5 rounded text-[10px] bg-white/5 text-text-muted border border-white/5">
                {t}
              </span>
            ))}
            {project.techStack.length > 4 && (
              <span className="px-2 py-0.5 text-[10px] text-text-dim">+{project.techStack.length - 4}</span>
            )}
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs">
            {project.liveUrl && (
              <a
                href={project.liveUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-violet-bright to-cyan-bright text-white font-medium text-[11px] hover:shadow-[0_0_20px_rgba(168,85,247,0.45)] transition-shadow"
              >
                <ExternalLink size={11} /> Live Demo
              </a>
            )}
            <a
              href={project.githubUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-white/[0.08] text-text-muted hover:text-text-primary hover:border-white/20 text-[11px] transition-colors"
            >
              <Github size={11} /> Code
            </a>
            <span className="ml-auto font-mono text-[10px] text-text-dim">{project.language}</span>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}
