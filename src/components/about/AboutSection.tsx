import { SectionWrapper } from '../layout/SectionWrapper';
import { SectionHeading } from '../shared/SectionHeading';
import { ScrollReveal } from '../shared/ScrollReveal';
import { GlassCard } from '../shared/GlassCard';
import { StatCard } from './StatCard';
import profile from '../../data/profile.json';

export function AboutSection() {
  const base = import.meta.env.BASE_URL;
  return (
    <SectionWrapper id="about">
      <SectionHeading
        kicker="01 / About"
        title="The story behind the *stack*."
        subtitle={profile.headline}
      />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-stretch">
        <ScrollReveal className="lg:col-span-2 relative rounded-2xl overflow-hidden min-h-[320px]">
          <img
            src={`${base}images/about-workspace.webp`}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <video
            autoPlay muted loop playsInline preload="metadata"
            poster={`${base}images/about-workspace.webp`}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover opacity-55 mix-blend-screen"
          >
            <source src={`${base}videos/about-bg.mp4`} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-br from-bg-base/50 via-violet/10 to-cyan/10" />
          <div className="relative z-10 p-8 h-full flex flex-col justify-end">
            <p className="font-mono text-xs tracking-[0.3em] uppercase text-cyan-bright">
              {profile.location}
            </p>
            <p className="mt-3 text-2xl font-display font-semibold text-text-primary">
              {profile.headline}
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.15} className="lg:col-span-3">
          <GlassCard strong className="p-8 md:p-10 h-full">
            <p className="text-lg md:text-xl leading-relaxed text-text-secondary">
              {profile.about}
            </p>

            <div className="mt-8 grid grid-cols-2 gap-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">Email</p>
                <a href={`mailto:${profile.email}`} className="block mt-1 text-text-primary hover:text-violet-bright transition-colors">
                  {profile.email}
                </a>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-text-dim">Phone</p>
                <p className="mt-1 text-text-primary">{profile.phone}</p>
              </div>
            </div>
          </GlassCard>
        </ScrollReveal>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-10">
        {[
          { value: profile.stats.yearsExperience, suffix: '+', label: 'Years Experience' },
          { value: profile.stats.projectsShipped, suffix: '+', label: 'Projects Shipped' },
          { value: profile.stats.techStack, suffix: '+', label: 'Tech Stack' },
          { value: Object.keys(profile.skills).length, suffix: '', label: 'Skill Domains' },
        ].map((h, i) => (
          <ScrollReveal key={h.label} delay={i * 0.08} y={30}>
            <StatCard value={h.value} suffix={h.suffix} label={h.label} />
          </ScrollReveal>
        ))}
      </div>
    </SectionWrapper>
  );
}
