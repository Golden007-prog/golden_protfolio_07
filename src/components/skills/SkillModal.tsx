'use client';

import { motion, type PanInfo } from 'framer-motion';
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, FileText, Github, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useReducer, useState, type ReactNode } from 'react';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { emit } from '@/lib/events';
import { SITE } from '@/lib/site';
import { loadSkillDetail, peekSkillDetail, projectsUsing, SKILLS } from '@/lib/skills';
import type { Skill, SkillDetail } from '@/types/skills';
import { useSkillActions, useSkillList, useSkillModal } from './SkillFocusContext';

const TITLE_ID = 'skill-modal-title';
const SWIPE_PX = 80;
const SWIPE_VELOCITY = 500;

type DetailState = { status: 'loading' | 'ready' | 'error'; data?: SkillDetail; retry: () => void };

/** The write-up for `slug`, from the module cache when it has already arrived. */
function useSkillDetail(slug: string | undefined): DetailState {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const data = slug ? peekSkillDetail(slug) : undefined;

  useEffect(() => {
    if (!slug || peekSkillDetail(slug)) return;
    let alive = true;
    loadSkillDetail(slug).then(
      () => alive && rerender(),
      () => alive && setFailed(slug),
    );
    return () => {
      alive = false;
    };
  }, [slug, attempt]);

  const status = data ? 'ready' : failed === slug ? 'error' : 'loading';
  return {
    status,
    data,
    retry: () => {
      setFailed(null);
      setAttempt((n) => n + 1);
    },
  };
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 font-mono text-eyebrow uppercase text-cyan-text">{children}</h3>;
}

function ExternalLinkRow({ href, icon, title, meta }: { href: string; icon: ReactNode; title: string; meta?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-h-11 items-start gap-3 rounded-xl border border-hairline bg-surface-tint p-4 ring-focus transition-colors hover:border-violet-bright/40"
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-violet-bright">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text-primary transition-colors group-hover:text-violet-bright">
          {title}
        </span>
        {meta ? <span className="mt-1 block text-xs text-text-muted">{meta}</span> : null}
      </span>
      <ExternalLink aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-dim" />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-sm leading-relaxed text-text-secondary">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-violet-bright" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DetailBody({ detail }: { detail: SkillDetail }) {
  return (
    <>
      {detail.purpose ? (
        <section>
          <Heading>Purpose</Heading>
          <p className="text-base leading-relaxed text-text-secondary md:text-lg">{detail.purpose}</p>
        </section>
      ) : null}

      {detail.coreComponents || detail.keyCapabilities ? (
        <div className="grid gap-8 md:grid-cols-2">
          {detail.coreComponents ? (
            <section>
              <Heading>Core components</Heading>
              <BulletList items={detail.coreComponents} />
            </section>
          ) : null}
          {detail.keyCapabilities ? (
            <section>
              <Heading>Key capabilities</Heading>
              <BulletList items={detail.keyCapabilities} />
            </section>
          ) : null}
        </div>
      ) : null}

      {detail.integrations ? (
        <section>
          <Heading>Integrations</Heading>
          <ul className="flex flex-wrap gap-2">
            {detail.integrations.map((item) => (
              <li key={item} className="rounded-full border border-hairline bg-surface-tint px-3 py-1 text-xs text-text-secondary">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.useCases ? (
        <section>
          <Heading>Real-world use cases</Heading>
          <ul className="grid gap-3 md:grid-cols-3">
            {detail.useCases.map((item) => (
              <li key={item} className="rounded-xl border border-hairline bg-surface-tint p-4 text-sm leading-relaxed text-text-secondary">
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.officialDocs ? (
        <section>
          <Heading>Documentation</Heading>
          <Button href={detail.officialDocs} variant="outline" size="sm" leadingIcon={<BookOpen aria-hidden="true" className="size-4" />}>
            Official documentation
          </Button>
        </section>
      ) : null}

      {detail.researchPapers ? (
        <section>
          <Heading>Research papers</Heading>
          <ul className="space-y-2">
            {detail.researchPapers.map((paper) => (
              <li key={paper.url}>
                <ExternalLinkRow
                  href={paper.url}
                  icon={<FileText className="size-5" />}
                  title={paper.title}
                  meta={paper.authors}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {detail.sources ? (
        <section className="border-t border-hairline pt-6">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">Sourced from</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {detail.sources.map((src) => {
              let host = src;
              try {
                host = new URL(src).hostname;
              } catch {
                /* keep the raw string */
              }
              return (
                <li key={src}>
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-xs text-text-muted ring-focus hover:text-violet-bright"
                  >
                    {host}
                    <span className="sr-only"> (opens in new tab)</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function UsedIn({ skill, onOpenProject }: { skill: Skill; onOpenProject: (slug: string) => void }) {
  const projects = projectsUsing(skill.name);
  if (projects.length === 0) return null;
  return (
    <section data-skill-projects="">
      <Heading>Used in projects</Heading>
      <ul className="grid gap-3 md:grid-cols-2">
        {projects.map((p) => (
          <li key={p.slug} className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-tint p-4">
            <div>
              <p className="text-sm font-semibold text-text-primary">{p.name}</p>
              {p.tagline ? <p className="mt-1 text-xs leading-relaxed text-text-muted">{p.tagline}</p> : null}
            </div>
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" cursor="open" onClick={() => onOpenProject(p.slug)}>
                Open project
              </Button>
              {p.githubUrl ? (
                <Button
                  href={p.githubUrl}
                  size="sm"
                  variant="icon"
                  aria-label={`${p.name} on GitHub`}
                  leadingIcon={<Github aria-hidden="true" className="size-4" />}
                />
              ) : null}
              {p.liveUrl ? (
                <Button
                  href={p.liveUrl}
                  size="sm"
                  variant="icon"
                  aria-label={`${p.name} live demo`}
                  leadingIcon={<ExternalLink aria-hidden="true" className="size-4" />}
                />
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The one skill dialog. It follows ?skill=<slug>, loads the write-up on demand
 * (skeleton, then content, or a retry), and pages through the skills the filter
 * currently shows with the arrow buttons, ←/→ or a sideways swipe on touch.
 */
export function SkillModal() {
  const { skill, morph } = useSkillModal();
  const { close, navigate, takeOpener, open } = useSkillActions();
  const { visible } = useSkillList();
  const { reduce, finePointer } = useMotionPrefs();

  // Keep the last skill on screen while the dialog plays its exit.
  const [shown, setShown] = useState<Skill | undefined>(skill);
  if (skill && skill !== shown) setShown(skill);
  const current = skill ?? shown;

  const order = current && visible.some((s) => s.slug === current.slug) ? visible : SKILLS;
  const index = current ? order.findIndex((s) => s.slug === current.slug) : -1;
  const prev = index >= 0 ? order[(index - 1 + order.length) % order.length] : undefined;
  const next = index >= 0 ? order[(index + 1) % order.length] : undefined;
  const canPage = order.length > 1;

  // The shown skill, so the content holds still while the dialog fades out.
  const detail = useSkillDetail(current?.slug);

  // Warm the neighbours so paging feels instant.
  useEffect(() => {
    if (!skill || detail.status !== 'ready') return;
    for (const s of [prev, next]) if (s) void loadSkillDetail(s.slug).catch(() => {});
  }, [skill, detail.status, prev, next]);

  // The dialog's focus trap restores focus only to an element that had it; Safari
  // never focuses a clicked button, so hand focus back to the opener explicitly.
  const isOpen = Boolean(skill);
  useEffect(() => {
    if (isOpen) return;
    const el = takeOpener();
    if (!el) return;
    const frame = requestAnimationFrame(() => {
      if (el.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, takeOpener]);

  useHotkeys(
    {
      arrowleft: () => prev && navigate(prev.slug),
      arrowright: () => next && navigate(next.slug),
    },
    { enabled: isOpen && canPage },
  );

  const openProject = (slug: string) => {
    close();
    // After the dialog releases its focus trap, so the project dialog can take it.
    requestAnimationFrame(() => emit('project:open', { slug }));
  };

  const onSwipe = (_: unknown, info: PanInfo) => {
    if (!canPage) return;
    if ((info.offset.x < -SWIPE_PX || info.velocity.x < -SWIPE_VELOCITY) && next) navigate(next.slug);
    else if ((info.offset.x > SWIPE_PX || info.velocity.x > SWIPE_VELOCITY) && prev) navigate(prev.slug);
  };

  const morphing = !reduce && current && morph === current.slug;
  const siblings = current ? SKILLS.filter((s) => s.category === current.category && s.slug !== current.slug) : [];
  const shareUrl = current ? `${SITE.url}/?skill=${current.slug}` : SITE.url;

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      labelledBy={TITLE_ID}
      layoutId={morphing ? `skill-panel-${current.slug}` : undefined}
      panelClassName="max-w-5xl overflow-clip"
    >
      {current ? (
        <div data-skill-modal={current.slug}>
          <div className="relative h-48 sm:h-60 md:h-72">
            {current.heroImage ? (
              <Image
                key={current.slug}
                src={current.heroImage}
                alt=""
                fill
                sizes="(min-width: 1024px) 1024px, 100vw"
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-violet/30 via-bg-base to-cyan/20" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-bg-surface via-bg-surface/70 to-transparent" />
            <div className="absolute right-3 top-3 flex items-center gap-2 sm:right-4 sm:top-4">
              <CopyButton value={shareUrl} label="Copy link" copiedLabel="Link copied" iconOnly size="md" />
              <Button variant="icon" size="md" aria-label="Close" onClick={close} leadingIcon={<X aria-hidden="true" className="size-5" />} />
            </div>
            <div className="absolute inset-x-5 bottom-5 md:inset-x-10">
              <p className="mb-2 font-mono text-eyebrow uppercase text-cyan-text">{current.category}</p>
              <motion.h2
                id={TITLE_ID}
                layoutId={morphing ? `skill-title-${current.slug}` : undefined}
                className="w-fit font-display text-3xl font-bold text-text-primary md:text-5xl"
              >
                {current.name}
              </motion.h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3 md:px-10">
            <p className="text-sm leading-relaxed text-text-secondary">
              <strong className="font-semibold text-text-primary">{current.term}</strong>
              {current.def}
            </p>
            {canPage && prev && next ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="icon"
                  size="md"
                  aria-label={`Previous skill: ${prev.name}`}
                  onClick={() => navigate(prev.slug)}
                  leadingIcon={<ChevronLeft aria-hidden="true" className="size-5" />}
                />
                <p className="min-w-14 text-center font-mono text-xs tabular-nums text-text-muted" aria-live="polite" data-skill-counter="">
                  <span className="sr-only">Skill </span>
                  {index + 1}
                  <span aria-hidden="true"> / </span>
                  <span className="sr-only"> of </span>
                  {order.length}
                </p>
                <Button
                  variant="icon"
                  size="md"
                  aria-label={`Next skill: ${next.name}`}
                  onClick={() => navigate(next.slug)}
                  leadingIcon={<ChevronRight aria-hidden="true" className="size-5" />}
                />
              </div>
            ) : null}
          </div>

          <motion.div
            key={current.slug}
            drag={!finePointer && canPage ? 'x' : false}
            dragDirectionLock
            dragSnapToOrigin
            dragElastic={0.18}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={onSwipe}
            className="space-y-10 p-5 md:p-10"
          >
            {detail.status === 'ready' && detail.data ? (
              <DetailBody detail={detail.data} />
            ) : detail.status === 'error' ? (
              <div role="alert" className="flex flex-col items-start gap-4 rounded-xl border border-hairline bg-surface-tint p-5">
                <p className="text-sm text-text-secondary">The details for {current.name} did not load.</p>
                <Button variant="secondary" size="sm" onClick={detail.retry}>
                  Try again
                </Button>
              </div>
            ) : (
              <div className="space-y-6" data-skill-loading="">
                <LottieIcon name="dots" className="block h-6 w-12" fallback={null} />
                <Skeleton lines={4} />
                <Skeleton variant="grid" rows={1} cols={2} />
              </div>
            )}

            <UsedIn skill={current} onOpenProject={openProject} />

            {siblings.length > 0 ? (
              <section>
                <Heading>More in {current.category}</Heading>
                <ul className="flex flex-wrap gap-2">
                  {siblings.map((s) => (
                    <li key={s.slug}>
                      <button
                        type="button"
                        onClick={() => (skill ? navigate(s.slug) : open(s.name))}
                        className="tap-safe-sm rounded-full border border-glass-border-strong bg-glass-fill px-3 text-xs text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary"
                      >
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </Dialog>
  );
}
