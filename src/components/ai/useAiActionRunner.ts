'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { hasCaseStudy, PROJECTS } from '@/data/projects';
import { announcementFor, planAction, targetHref, type AiPlan } from '@/lib/ai/actions';
import type { AiAction, AiTarget } from '@/lib/ai/protocol';
import { track } from '@/lib/analytics';
import { emit } from '@/lib/events';
import { SECTIONS, SITE, type SectionId } from '@/lib/site';
import { findTarget, setUrlHash, setUrlParams } from '@/lib/urlState';

const CASE_STUDY_SLUGS: ReadonlySet<string> = new Set(PROJECTS.filter(hasCaseStudy).map((p) => p.slug));
const sectionLabel = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.label ?? id;

/* ---- one polite live region for the whole app ---- */

let announcer: HTMLElement | null = null;
let clearTimer = 0;

/**
 * Says one short message through a polite live region. The region is created on
 * first use, so pages that never run an AI action carry no extra node.
 */
export function announce(message: string): void {
  if (typeof document === 'undefined' || !message) return;
  if (!announcer || !announcer.isConnected) {
    announcer = document.createElement('div');
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    announcer.setAttribute('data-ai-announcer', '');
    announcer.className = 'sr-only';
    document.body.appendChild(announcer);
  }
  const region = announcer;
  // A modal's focus trap marks every other child of <body> inert, which would silence this.
  if (region.inert) region.inert = false;
  window.clearTimeout(clearTimer);
  region.textContent = '';
  // A fresh node in the next frame makes a repeat of the same message speak again.
  requestAnimationFrame(() => {
    region.textContent = message;
    clearTimer = window.setTimeout(() => {
      region.textContent = '';
    }, 7000);
  });
}

/* ---- one-shot spotlight ---- */

const SPOTLIGHT_MS = 2400;
const spotTimers = new WeakMap<HTMLElement, number>();

/**
 * A brief ring around the element an AI action moved to (a static outline under
 * reduced motion; styles in ai.css). Restarting on the same element replays it.
 */
export function spotlight(el: HTMLElement | null): void {
  if (!el) return;
  window.clearTimeout(spotTimers.get(el));
  el.removeAttribute('data-ai-spotlight');
  // Reading layout restarts the CSS animation when the attribute comes back.
  void el.offsetWidth;
  el.setAttribute('data-ai-spotlight', '');
  spotTimers.set(
    el,
    window.setTimeout(() => {
      el.removeAttribute('data-ai-spotlight');
      spotTimers.delete(el);
    }, SPOTLIGHT_MS),
  );
}

function headingOf(section: HTMLElement): HTMLElement {
  return document.getElementById(`${section.id}-title`) ?? section.querySelector<HTMLElement>('h2') ?? section;
}

/* ---- the existing CV, vCard and email flows ---- */

function download(href: string, fileName: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Toast = ReturnType<typeof useToast>['toast'];

function copyEmail(toast: Toast) {
  track('copy_email');
  const done = () => toast({ title: 'Email copied', description: SITE.email, tone: 'success' });
  const failed = () => toast({ title: 'Copy it from here', description: SITE.email, tone: 'info', duration: 8000 });
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(SITE.email).then(done, failed);
  else failed();
}

function filterQuery(patch: Record<string, string | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(patch)) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `/?${qs}#projects` : '/#projects';
}

type Deps = { push: (href: string) => void; toast: Toast };

function execute(plan: AiPlan, { push, toast }: Deps): void {
  if (plan.do === 'none') return;
  // Everything the runner drives (the project and skill dialogs, the grid, the
  // contact form) lives on the home page; elsewhere it navigates there.
  const home = window.location.pathname === '/';
  const say = announcementFor(plan, sectionLabel);

  switch (plan.do) {
    case 'project':
      if (home) emit('project:open', { slug: plan.slug });
      else push(targetHref({ kind: 'project', slug: plan.slug }, CASE_STUDY_SLUGS));
      return;

    case 'skill':
      if (!home) {
        push(targetHref({ kind: 'skill', name: plan.name }, CASE_STUDY_SLUGS));
        return;
      }
      // The grid sits behind the dialog, so closing it lands on the skill.
      smoothScrollTo('skills', { immediate: true, focus: false });
      setUrlParams({ skill: plan.slug });
      return;

    case 'scroll': {
      if (!home) {
        push(`/#${plan.section}`);
        return;
      }
      const section = findTarget(plan.section);
      if (!section) return;
      const anchor = plan.anchor ? section.querySelector<HTMLElement>(`[${plan.anchor.attr}="${plan.anchor.value}"]`) : null;
      smoothScrollTo(anchor ?? section);
      setUrlHash(plan.section);
      spotlight(anchor ?? headingOf(section));
      announce(say);
      return;
    }

    case 'filter':
      if (!home) {
        push(filterQuery(plan.patch));
        return;
      }
      setUrlParams(plan.patch);
      smoothScrollTo('projects', { focus: false });
      spotlight(findTarget('projects-title'));
      announce(say);
      return;

    case 'prefill': {
      if (!home) {
        push('/#contact');
        return;
      }
      // Fills the form for the visitor to read and send; it never sends.
      emit('contact:prefill', plan.detail);
      smoothScrollTo('contact', { focus: false });
      const contact = findTarget('contact');
      spotlight(contact?.querySelector<HTMLElement>('form') ?? (contact ? headingOf(contact) : null));
      announce(say);
      return;
    }

    case 'cv':
      track('cv_download');
      download(SITE.cvPath, SITE.cvFileName);
      announce(say);
      return;

    case 'vcard':
      track('vcard_download');
      // An empty download name keeps the route's own Content-Disposition file name.
      download(SITE.vcardPath, '');
      announce(say);
      return;

    case 'copyEmail':
      copyEmail(toast);
      return;
  }
}

/**
 * Runs an AI source chip, tool call or suggested action through the site's own
 * mechanics: project:open, ?skill, smooth scroll to a section (and to the
 * [data-*-index] entry when the page has one), the projects filters, the
 * contact prefill (which never sends), and the existing CV, vCard and copy
 * flows. Adds a one-shot spotlight and a polite announcement ('Moved to
 * Experience'). Malformed input does nothing.
 */
export function useAiActionRunner(): (x: AiTarget | AiAction) => void {
  const router = useRouter();
  const { toast } = useToast();
  return useCallback(
    (x: AiTarget | AiAction) => {
      execute(planAction(x), { push: (href) => router.push(href), toast });
    },
    [router, toast],
  );
}
