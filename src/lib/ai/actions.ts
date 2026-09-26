import type { AiAction, AiTarget } from './protocol.ts';
import type { SectionId } from '../site.ts';
import { slugify } from '../slug.ts';

/*
 * Where an AI target points, and what the action runner does about it. Pure, so
 * the mapping is tested without a browser: useAiActionRunner only executes the
 * plan planAction() returns. The URL keys a plan may write are fixed here.
 */

export const KNOWN_SECTIONS: readonly SectionId[] = ['about', 'skills', 'projects', 'experience', 'certifications', 'philosophy', 'contact'];

/** The projects namespace, which AI surfaces write only through the runner's filter action. */
export const PROJECT_FILTER_PARAMS = ['q', 'cat', 'tech', 'live'] as const;
export type ProjectFilterParam = (typeof PROJECT_FILTER_PARAMS)[number];

/** Every URL key the runner may set: ?project (through project:open), ?skill and the filters. */
export const RUNNER_PARAMS: readonly string[] = ['project', 'skill', ...PROJECT_FILTER_PARAMS];

const FILTER_PHRASE_MAX = 160;

export type IndexAnchor = {
  attr: 'data-exp-index' | 'data-edu-index' | 'data-reading-index' | 'data-tenet-index';
  value: string;
};

export type AiPlan =
  | { do: 'project'; slug: string }
  | { do: 'skill'; slug: string; name: string }
  | { do: 'scroll'; section: SectionId; anchor: IndexAnchor | null }
  | { do: 'filter'; patch: Record<ProjectFilterParam, string | null> }
  | { do: 'prefill'; detail: { subject?: string; message: string } }
  | { do: 'cv' }
  | { do: 'vcard' }
  | { do: 'copyEmail' }
  | { do: 'none' };

type CaseStudies = ReadonlySet<string> | readonly string[];

const hasSlug = (set: CaseStudies, slug: string) => (Array.isArray(set) ? set.includes(slug) : (set as ReadonlySet<string>).has(slug));
const isIndex = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const isSection = (id: unknown): id is SectionId => typeof id === 'string' && (KNOWN_SECTIONS as readonly string[]).includes(id);
const cleanSlug = (s: unknown) => (typeof s === 'string' ? slugify(s) : '');

/** The section a target lives in. */
export function sectionOf(t: AiTarget): SectionId | null {
  switch (t.kind) {
    case 'project':
      return 'projects';
    case 'skill':
      return 'skills';
    case 'section':
      return isSection(t.id) ? t.id : null;
    // Education and the reading list render inside the Experience section.
    case 'experience':
    case 'education':
    case 'reading':
      return 'experience';
    case 'tenet':
      return 'philosophy';
    case 'cv':
      return 'about';
    case 'contact':
      return 'contact';
    default:
      return null;
  }
}

/** The [data-*-index] element inside the section, when the target is one entry of a list. */
export function anchorOf(t: AiTarget): IndexAnchor | null {
  const attr =
    t.kind === 'experience'
      ? 'data-exp-index'
      : t.kind === 'education'
        ? 'data-edu-index'
        : t.kind === 'reading'
          ? 'data-reading-index'
          : t.kind === 'tenet'
            ? 'data-tenet-index'
            : null;
  if (!attr || !('index' in t) || !isIndex(t.index)) return null;
  return { attr, value: String(t.index) };
}

/**
 * A link to the target from any page. The case studies (the only slugs with a
 * /projects/<slug> page) get their page; every other project opens its dialog on '/'.
 */
export function targetHref(t: AiTarget, caseStudySlugs: CaseStudies): string {
  switch (t.kind) {
    case 'project': {
      const slug = cleanSlug(t.slug);
      if (!slug) return '/#projects';
      return hasSlug(caseStudySlugs, slug) ? `/projects/${slug}` : `/?project=${slug}`;
    }
    case 'skill': {
      const slug = cleanSlug(t.name);
      return slug ? `/?skill=${slug}` : '/#skills';
    }
    case 'cv':
      return '/cv';
    default: {
      const section = sectionOf(t);
      return section ? `/#${section}` : '/';
    }
  }
}

function isAction(x: AiTarget | AiAction): x is AiAction {
  return x.kind === 'open' || x.kind === 'filter' || x.kind === 'prefill' || x.kind === 'vcard' || x.kind === 'copyEmail';
}

function planTarget(t: AiTarget): AiPlan {
  switch (t.kind) {
    case 'project': {
      const slug = cleanSlug(t.slug);
      return slug ? { do: 'project', slug } : { do: 'none' };
    }
    case 'skill': {
      const slug = cleanSlug(t.name);
      return slug ? { do: 'skill', slug, name: t.name.trim() } : { do: 'none' };
    }
    case 'cv':
      return { do: 'cv' };
    default: {
      const section = sectionOf(t);
      if (!section) return { do: 'none' };
      const anchor = anchorOf(t);
      // An index target with a malformed index is not a target at all.
      if ('index' in t && !anchor) return { do: 'none' };
      return { do: 'scroll', section, anchor };
    }
  }
}

const trimmed = (s: unknown, max: number): string | null => {
  if (typeof s !== 'string') return null;
  const v = s.replace(/\s+/g, ' ').trim().slice(0, max);
  return v || null;
};

/** What the runner will do for a target or action. Malformed input plans 'none'. */
export function planAction(x: AiTarget | AiAction): AiPlan {
  if (!x || typeof x !== 'object' || typeof x.kind !== 'string') return { do: 'none' };
  if (!isAction(x)) return planTarget(x);
  switch (x.kind) {
    case 'open':
      return x.target && typeof x.target === 'object' && !isAction(x.target as AiTarget | AiAction)
        ? planTarget(x.target)
        : { do: 'none' };
    case 'filter':
      // A filter replaces the whole set, so the grid shows exactly what was asked for.
      return {
        do: 'filter',
        patch: {
          q: trimmed(x.q, FILTER_PHRASE_MAX),
          cat: trimmed(x.cat, FILTER_PHRASE_MAX),
          tech: trimmed(x.tech, FILTER_PHRASE_MAX),
          live: x.live === true ? '1' : null,
        },
      };
    case 'prefill': {
      const message = typeof x.message === 'string' ? x.message.trim() : '';
      if (!message) return { do: 'none' };
      const subject = trimmed(x.subject, 200);
      return { do: 'prefill', detail: subject ? { subject, message } : { message } };
    }
    case 'vcard':
      return { do: 'vcard' };
    case 'copyEmail':
      return { do: 'copyEmail' };
    default:
      return { do: 'none' };
  }
}

/**
 * The polite announcement after a plan runs. Empty when something else already
 * speaks: a dialog announces its own title and the copy flow raises a toast.
 */
export function announcementFor(plan: AiPlan, sectionLabel: (id: SectionId) => string): string {
  switch (plan.do) {
    case 'scroll':
      return `Moved to ${sectionLabel(plan.section)}`;
    case 'filter': {
      const { q, cat, tech, live } = plan.patch;
      const parts = [tech, cat, q ? `“${q}”` : null, live ? 'live demos' : null].filter(Boolean);
      return parts.length ? `Projects filtered by ${parts.join(', ')}` : 'Project filters cleared';
    }
    case 'prefill':
      return 'Draft added to the contact form. Nothing has been sent.';
    case 'cv':
      return 'Downloading the CV';
    case 'vcard':
      return 'Downloading the contact card';
    default:
      return '';
  }
}
