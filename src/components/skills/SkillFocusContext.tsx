'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useIntro } from '@/contexts/IntroContext';
import { getMotionPrefs } from '@/hooks/useMotionPrefs';
import { track } from '@/lib/analytics';
import { useAppEvent } from '@/lib/events';
import { findSkill, matchesQuery, SKILLS } from '@/lib/skills';
import { setUrlParams, useUrlParam } from '@/lib/urlState';
import type { Skill } from '@/types/skills';

export const ALL = 'All';

type OpenOptions = {
  /** Gets focus back when the modal closes (Safari never focuses a clicked button). */
  opener?: HTMLElement | null;
  /** Grow the modal out of the pill (shared layoutIds). */
  morph?: boolean;
};

type Actions = {
  select: (name: string | null) => void;
  hover: (name: string | null) => void;
  setFilter: (category: string) => void;
  setQuery: (q: string) => void;
  open: (name: string, opts?: OpenOptions) => void;
  close: () => void;
  /** Moves the open modal to another skill. */
  navigate: (slug: string) => void;
  setSphereLive: (live: boolean) => void;
  /** The element to refocus when the modal closes. */
  takeOpener: () => HTMLElement | null;
};

type List = {
  filter: string;
  query: string;
  /** The skills the filter and search let through, in page order. */
  visible: readonly Skill[];
};

type Focus = {
  /** Node locked centre-stage on the sphere or constellation. */
  selected: string | null;
  /** Pill under a mouse or keyboard focus. */
  hovered: string | null;
};

type Mode = {
  /** The WebGL sphere is showing (otherwise the constellation is). */
  sphereLive: boolean;
};

type ModalState = {
  skill: Skill | undefined;
  /** Slug whose pill the open modal grew out of. */
  morph: string | null;
};

const ActionsContext = createContext<Actions | null>(null);
const ListContext = createContext<List | null>(null);
const FocusContext = createContext<Focus | null>(null);
const ModalContext = createContext<ModalState | null>(null);
const ModeContext = createContext<Mode | null>(null);

function need<T>(value: T | null, hook: string): T {
  if (!value) throw new Error(`${hook} must be used inside <SkillFocusProvider>`);
  return value;
}

export const useSkillActions = () => need(useContext(ActionsContext), 'useSkillActions');
export const useSkillList = () => need(useContext(ListContext), 'useSkillList');
export const useSkillFocus = () => need(useContext(FocusContext), 'useSkillFocus');
export const useSkillModal = () => need(useContext(ModalContext), 'useSkillModal');
export const useSkillMode = () => need(useContext(ModeContext), 'useSkillMode');

/**
 * One source of truth for the skills section: the category filter, the search,
 * the node locked on the sphere, the hovered pill and the single SkillModal. The
 * open skill lives in ?skill=<slug> (through urlState) and opens only once the
 * intro has finished. Split into several contexts so a hover does not re-render
 * the pill grid.
 */
export function SkillFocusProvider({ children }: { children: ReactNode }) {
  const [filter, setFilterState] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [sphereLive, setSphereLive] = useState(false);
  const [morph, setMorph] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const { done } = useIntro();
  const param = useUrlParam('skill');
  const skill = done ? findSkill(param) : undefined;

  const setFilter = useCallback((category: string) => {
    setFilterState(category);
    setHovered(null);
  }, []);

  const open = useCallback((name: string, opts: OpenOptions = {}) => {
    const target = findSkill(name);
    if (!target) return;
    opener.current = opts.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setMorph(opts.morph && !getMotionPrefs().reduce ? target.slug : null);
    setUrlParams({ skill: target.slug });
    track('skill_open', { skill: target.name });
  }, []);

  const actions = useMemo<Actions>(
    () => ({
      select: setSelected,
      hover: setHovered,
      setFilter,
      setQuery,
      open,
      close: () => setUrlParams({ skill: null }),
      navigate: (slug: string) => {
        setMorph(null);
        setUrlParams({ skill: slug });
      },
      setSphereLive,
      takeOpener: () => {
        const el = opener.current;
        opener.current = null;
        return el;
      },
    }),
    [open, setFilter],
  );

  // Other sections (the sentiment demo, the command palette) open or spotlight a skill by name.
  useAppEvent('skill:open', ({ name }) => open(name));
  useAppEvent('skill:focus', ({ name }) => {
    const target = findSkill(name);
    if (!target) return;
    if (filter !== ALL && filter !== target.category) setFilterState(ALL);
    setSelected(target.name);
  });

  const visible = useMemo(
    () => SKILLS.filter((s) => (filter === ALL || s.category === filter) && matchesQuery(s, query)),
    [filter, query],
  );
  const list = useMemo<List>(() => ({ filter, query, visible }), [filter, query, visible]);
  const focus = useMemo<Focus>(() => ({ selected, hovered }), [selected, hovered]);
  const mode = useMemo<Mode>(() => ({ sphereLive }), [sphereLive]);
  const modal = useMemo<ModalState>(() => ({ skill, morph }), [skill, morph]);

  return (
    <ActionsContext.Provider value={actions}>
      <ListContext.Provider value={list}>
        <FocusContext.Provider value={focus}>
          <ModalContext.Provider value={modal}>
            <ModeContext.Provider value={mode}>{children}</ModeContext.Provider>
          </ModalContext.Provider>
        </FocusContext.Provider>
      </ListContext.Provider>
    </ActionsContext.Provider>
  );
}
