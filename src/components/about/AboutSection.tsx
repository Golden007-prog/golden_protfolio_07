'use client';

import dynamic from 'next/dynamic';
import { Contact, Mail, Phone } from 'lucide-react';
import { SectionWrapper } from '@/components/layout/SectionWrapper';
import { Reveal, Stagger, StaggerItem } from '@/components/motion';
import { GlassCard } from '@/components/shared/GlassCard';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import profile from '@/data/profile.json';
import projects from '@/data/projects.json';
import { track } from '@/lib/analytics';
import { SITE } from '@/lib/site';
import { techFamily } from '@/lib/tech';
import { useKaggleData } from '@/components/kaggle/KaggleDataContext';
import { AtAGlance } from './AtAGlance';
import { PortraitPanel } from './PortraitPanel';
import { ScrubText } from './ScrubText';
import { StatCard } from './StatCard';

// Counted from the data files, never typed in. profile.stats.yearsExperience (3) is
// left out until the owner confirms it: the listed roles add up to about 1.5 years.
const STATS = [
  { value: projects.length, label: 'Public projects' },
  { value: new Set(Object.values(profile.skills).flat()).size, label: 'Skills listed' },
  { value: Object.keys(profile.skills).length, label: 'Skill domains' },
  { value: new Set(projects.flatMap((p) => p.techStack.map(techFamily))).size, label: 'Technologies in projects' },
];

// Server-rendered in its own chunk, so the badge art code stays out of the first load.
const KaggleBadgeStrip = dynamic(() => import('@/components/kaggle/KaggleBadgeStrip').then((m) => m.KaggleBadgeStrip));

const LINK =
  'inline-flex min-h-11 min-w-0 items-center rounded text-left text-text-primary ring-focus transition-colors [overflow-wrap:anywhere] hover:text-violet-bright';

export function AboutSection() {
  const kaggle = useKaggleData();
  return (
    <SectionWrapper id="about">
      <SectionHeading sectionId="about" title="The story behind the *stack*." className="mb-10 md:mb-16" />

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-5 lg:gap-8">
        <Reveal className="lg:col-span-3">
          <AtAGlance />
        </Reveal>
        <Reveal delay={0.1} className="lg:order-first lg:col-span-2">
          <PortraitPanel />
        </Reveal>
      </div>

      <Reveal className="mt-6 lg:mt-8">
        <GlassCard strong className="p-6 md:p-10">
          <ScrubText text={profile.about} className="text-lg leading-relaxed text-text-primary md:text-xl" />

          <dl data-contact-block="" className="mt-8 grid grid-cols-1 gap-x-8 gap-y-5 border-t border-hairline pt-6 sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim">Email</dt>
              <dd className="mt-1 flex min-w-0 items-center gap-2">
                <a href={SITE.mailtoHref} data-contact-email="" className={LINK}>
                  <Mail aria-hidden="true" className="mr-2 size-4 shrink-0 text-text-muted" />
                  <span className="min-w-0">{SITE.email}</span>
                </a>
                <CopyButton value={SITE.email} label="Copy email address" toastMessage="Email address copied" iconOnly size="sm" className="shrink-0" />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim">Phone</dt>
              <dd className="mt-1 flex min-w-0 items-center gap-2">
                <a href={SITE.phoneHref} data-contact-phone="" className={LINK}>
                  <Phone aria-hidden="true" className="mr-2 size-4 shrink-0 text-text-muted" />
                  <span className="min-w-0">{SITE.phone}</span>
                </a>
                <CopyButton value={SITE.phone} label="Copy phone number" toastMessage="Phone number copied" iconOnly size="sm" className="shrink-0" />
              </dd>
            </div>
          </dl>

          <div className="mt-6">
            <Button
              href={SITE.vcardPath}
              download
              variant="outline"
              size="sm"
              leadingIcon={<Contact aria-hidden="true" className="size-4 shrink-0" />}
              onClick={() => track('vcard_download')}
            >
              Save contact
            </Button>
          </div>
        </GlassCard>
      </Reveal>

      <Stagger as="ul" className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((s) => (
          <StaggerItem as="li" key={s.label}>
            <StatCard value={s.value} label={s.label} />
          </StaggerItem>
        ))}
      </Stagger>

      {kaggle ? (
        <Reveal className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.2em] text-text-dim">On Kaggle</p>
          <KaggleBadgeStrip data={kaggle} moreHref="#kaggle" />
        </Reveal>
      ) : null}
    </SectionWrapper>
  );
}
