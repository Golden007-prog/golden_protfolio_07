'use client';

import { createContext, useEffect, useState } from 'react';
import { PROJECTS, type Project } from '@/data/projects';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import type { CaseStudyAi, InterestView } from '@/lib/ai/prompts/projects';
import type { Store } from '@/lib/ai/reviewGate';

/* ---------------------------------------------------------------------------
 * AI content from src/data/ai-generated/projects.json
 *
 * The store and its selectors load as their own chunk, never with '/': the static
 * case-study page gets its slice from the server as the `ai` prop, and the dialog
 * loads the chunk (usually already warmed by ProjectsSection) when it opens.
 * ------------------------------------------------------------------------- */

type ProjectsAi = {
  select: (p: Project) => CaseStudyAi;
  interests: (slugs: readonly string[]) => InterestView[];
};

type FixtureWindow = Window & { __OB_AI_FIXTURES__?: { projects?: unknown; showUnreviewed?: boolean } };

/**
 * Specs swap in a fixture store (and may simulate the production review flag)
 * through window.__OB_AI_FIXTURES__. Only where drafts show anyway, so a
 * production build never reads it.
 */
function fixture(): { store: unknown; show: boolean } | null {
  if (!SHOW_UNREVIEWED || typeof window === 'undefined') return null;
  const f = (window as FixtureWindow).__OB_AI_FIXTURES__;
  if (!f || !f.projects || typeof f.projects !== 'object') return null;
  return { store: f.projects, show: typeof f.showUnreviewed === 'boolean' ? f.showUnreviewed : SHOW_UNREVIEWED };
}

let loadedAi: ProjectsAi | null = null;
let loadingAi: Promise<ProjectsAi | null> | null = null;

/** Loads the store chunk once; resolves null if it cannot load (the case study then has no AI extras). */
export function loadProjectsAi(): Promise<ProjectsAi | null> {
  if (loadedAi) return Promise.resolve(loadedAi);
  loadingAi ??= Promise.all([import('@/data/ai-generated/projects.json'), import('@/lib/ai/prompts/projects')]).then(
    ([json, mod]) => {
      const f = fixture();
      const store = (f?.store ?? json.default) as Store<unknown>;
      const show = f?.show ?? SHOW_UNREVIEWED;
      loadedAi = {
        select: (p) => mod.selectCaseStudyAi(store, p, PROJECTS, show),
        interests: (slugs) => mod.selectInterests(store, slugs, show),
      };
      return loadedAi;
    },
    () => {
      loadingAi = null;
      return null;
    },
  );
  return loadingAi;
}

/**
 * The loaded store, or null until it has loaded. Null on the server and while
 * hydrating (nothing loads before an effect runs); a later mount after the chunk
 * has loaded starts with it, so a dialog opened then renders its extras at once.
 */
export function useProjectsAi(enabled = true): ProjectsAi | null {
  const [ai, setAi] = useState<ProjectsAi | null>(() => loadedAi);
  useEffect(() => {
    if (!enabled || ai) return;
    let live = true;
    void loadProjectsAi().then((m) => {
      if (live && m) setAi(m);
    });
    return () => {
      live = false;
    };
  }, [enabled, ai]);
  return ai;
}

/** What the grid lets the dialog do: ProjectsSection closes it before handing a project to the assistant. */
export const CaseStudyHostContext = createContext<{ askAbout: (slug: string) => void } | null>(null);

/**
 * The interest chips as app/page.tsx works them out on the server from the same
 * store, so the grid renders them in its first paint. Mounted only once the store
 * chunk arrived, they pushed every section below the grid down by a row.
 */
export const ServerInterestsContext = createContext<readonly InterestView[]>([]);
