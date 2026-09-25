'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useIntro } from '@/contexts/IntroContext';
import { useSmoothScrollTo } from '@/contexts/LenisContext';
import { resolveProject, type Project } from '@/data/projects';
import { useHydrated } from '@/hooks/useHydrated';
import { track } from '@/lib/analytics';
import { useAppEvent } from '@/lib/events';
import { setUrlParams, useUrlParam } from '@/lib/urlState';

export type ProjectDeepLink = {
  /** The project named by ?project=, once the page has hydrated and the intro is over. */
  project: Project | undefined;
  /** Opens a project as a new history entry, so Back closes it. */
  open: (slug: string) => void;
  /** Swaps the open project in place (dialog prev/next), without a new history entry. */
  navigate: (slug: string) => void;
  /** Closes the dialog; `then` runs once the URL no longer names a project. */
  close: (then?: () => void) => void;
};

/**
 * ?project=<slug> is the single source of truth for the project dialog. Opening
 * pushes a history entry and closing pops it, so the Back button closes the
 * dialog; a link that arrives with ?project= waits for the intro, lands the page
 * on the grid behind the dialog, then opens it. Also answers 'project:open'
 * events from the rest of the app (command palette, chat).
 */
export function useProjectDeepLink(): ProjectDeepLink {
  const param = useUrlParam('project');
  const hydrated = useHydrated();
  const { done } = useIntro();
  const scrollTo = useSmoothScrollTo();
  const pushed = useRef(false);
  const landed = useRef(false);
  const restoration = useRef<ScrollRestoration | null>(null);
  // Read at call time, so open() keeps one identity and memoised cards do not re-render.
  const paramRef = useRef(param);
  useEffect(() => {
    paramRef.current = param;
  });

  const ready = hydrated && done;
  const resolved = resolveProject(param);
  const project = ready ? resolved : undefined;

  // ?project=urbancare becomes the canonical slug; an unknown slug is dropped.
  useEffect(() => {
    if (!ready || param === null) return;
    if (!resolved) setUrlParams({ project: null });
    else if (resolved.slug !== param) setUrlParams({ project: resolved.slug });
  }, [ready, param, resolved]);

  useEffect(() => {
    if (!ready || landed.current) return;
    landed.current = true;
    if (!resolved) return;
    scrollTo('projects', { immediate: true, focus: false });
    track('project_open', { slug: resolved.slug, source: 'link' });
  }, [ready, resolved, scrollTo]);

  // Back/forward moves to an entry this hook did not push.
  useEffect(() => {
    const onPop = () => {
      pushed.current = false;
      const previous = restoration.current;
      if (!previous) return;
      restoration.current = null;
      // popstate fires before the browser restores scroll, so wait it out.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.history.scrollRestoration = previous;
        }),
      );
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const open = useCallback((slug: string) => {
    const current = paramRef.current;
    if (current === slug) return;
    const push = current === null;
    if (push) {
      // Back returns to the grid exactly where it was. Chromium's automatic
      // restoration uses an older offset for this entry and jumps the page, so
      // the grid's entry (and the one pushed from it) restore manually until popped.
      restoration.current = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
      pushed.current = true;
    }
    setUrlParams({ project: slug }, { push });
    paramRef.current = slug;
    track('project_open', { slug, source: 'card' });
  }, []);

  const navigate = useCallback((slug: string) => {
    setUrlParams({ project: slug });
    track('project_open', { slug, source: 'dialog' });
  }, []);

  const close = useCallback((then?: () => void) => {
    if (pushed.current) {
      pushed.current = false;
      // urlState's own popstate listener runs first, so `then` sees the popped URL.
      if (then) window.addEventListener('popstate', () => then(), { once: true });
      window.history.back();
      return;
    }
    setUrlParams({ project: null });
    then?.();
  }, []);

  useAppEvent('project:open', ({ slug }) => {
    const target = resolveProject(slug);
    if (!target) return;
    scrollTo('projects', { immediate: true, focus: false });
    open(target.slug);
  });

  return { project, open, navigate, close };
}
