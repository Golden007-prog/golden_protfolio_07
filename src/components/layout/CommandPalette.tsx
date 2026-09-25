'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  ArrowRight,
  AtSign,
  Code2,
  Copy,
  Download,
  FileText,
  FolderGit2,
  Github,
  Hash,
  Keyboard,
  Linkedin,
  Monitor,
  Moon,
  Pause,
  Play,
  Search,
  SearchX,
  Sparkles,
  Sun,
  Waves,
} from 'lucide-react';
import profile from '@/data/profile.json';
import projects from '@/data/projects.json';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { toggleReducedMotion } from '@/components/shared/MotionToggle';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSingleKeyShortcuts } from '@/hooks/useHotkeys';
import { setPaused, useMotionPrefs, usePaused } from '@/hooks/useMotionPrefs';
import { track } from '@/lib/analytics';
import { emit } from '@/lib/events';
import { safeStorage } from '@/lib/safeStorage';
import { SECTIONS, SITE, slugify } from '@/lib/site';
import { setUrlHash } from '@/lib/urlState';
import { cn } from '@/utils/cn';

type GroupName = 'Recent' | 'Sections' | 'Projects' | 'Skills' | 'Links' | 'Actions';

type Item = {
  id: string;
  group: Exclude<GroupName, 'Recent'>;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  run: () => void;
};

type Group = { name: GroupName; items: Item[] };

const RECENT_KEY = 'ob-palette-recent';
const RECENT_MAX = 5;
const GROUP_ORDER: Exclude<GroupName, 'Recent'>[] = ['Sections', 'Projects', 'Skills', 'Links', 'Actions'];

const SKILLS: { name: string; category: string }[] = Object.entries(profile.skills as Record<string, string[]>).flatMap(
  ([category, names]) => names.map((name) => ({ name, category })),
);

function readRecent(): string[] {
  try {
    const v: unknown = JSON.parse(safeStorage.get(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string) {
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  safeStorage.set(RECENT_KEY, JSON.stringify(next));
}

/**
 * Fuzzy score: a substring beats a scattered subsequence, and matches at word
 * starts and in unbroken runs score higher. 0 means no match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const t = text.toLowerCase();
  if (!q) return 1;
  const at = t.indexOf(q);
  if (at !== -1) {
    const wordStart = at === 0 || /[^a-z0-9]/.test(t[at - 1]);
    return 1000 + (wordStart ? 200 : 0) - at * 2 - t.length * 0.1;
  }
  let from = 0;
  let run = 0;
  let total = 0;
  for (const ch of q.replace(/ /g, '')) {
    const found = t.indexOf(ch, from);
    if (found === -1) return 0;
    run = found === from ? run + 1 : 0;
    const wordStart = found === 0 || /[^a-z0-9]/.test(t[found - 1]);
    total += 10 + run * 5 + (wordStart ? 15 : 0) - Math.min(found - from, 10);
    from = found + 1;
  }
  return Math.max(1, total);
}

function afterClose(fn: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

type Props = {
  open: boolean;
  onClose: () => void;
  onShowShortcuts?: () => void;
};

/** Command palette (Dialog 'palette'): a combobox over a grouped listbox with aria-activedescendant. */
export function CommandPalette({ open, onClose, onShowShortcuts }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onClose={onClose} variant="palette" ariaLabel="Command palette" initialFocusRef={inputRef}>
      <PaletteBody inputRef={inputRef} onClose={onClose} onShowShortcuts={onShowShortcuts} />
    </Dialog>
  );
}

function PaletteBody({
  inputRef,
  onClose,
  onShowShortcuts,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
  onShowShortcuts?: () => void;
}) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Read once per opening: the body mounts each time the palette opens.
  const [recent] = useState(readRecent);

  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const { reduce } = useMotionPrefs();
  const paused = usePaused();
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();
  const { toast } = useToast();

  useEffect(() => {
    track('palette_open');
  }, []);

  const items = useMemo<Item[]>(() => {
    const icon = (Icon: typeof Search) => <Icon aria-hidden="true" className="size-4" />;
    const list: Item[] = [];

    for (const s of SECTIONS) {
      list.push({
        id: `section:${s.id}`,
        group: 'Sections',
        label: s.label,
        hint: s.index,
        keywords: s.id,
        icon: icon(Hash),
        run: () => {
          smoothScrollTo(s.id);
          setUrlHash(s.id);
        },
      });
    }

    for (const p of projects) {
      const slug = slugify(p.name);
      list.push({
        id: `project:${slug}`,
        group: 'Projects',
        label: p.name,
        hint: p.tagline,
        keywords: `${p.category} ${p.techStack.join(' ')}`,
        icon: icon(FolderGit2),
        run: () => {
          emit('project:open', { slug });
          smoothScrollTo('projects', { focus: false });
        },
      });
    }

    for (const s of SKILLS) {
      list.push({
        id: `skill:${slugify(s.name)}`,
        group: 'Skills',
        label: s.name,
        hint: s.category,
        icon: icon(Sparkles),
        run: () => {
          emit('skill:open', { name: s.name });
          smoothScrollTo('skills', { focus: false });
        },
      });
    }

    list.push(
      { id: 'link:github', group: 'Links', label: 'GitHub', hint: 'Opens in a new tab', icon: icon(Github), run: () => openExternal(SITE.links.github) },
      { id: 'link:linkedin', group: 'Links', label: 'LinkedIn', hint: 'Opens in a new tab', icon: icon(Linkedin), run: () => openExternal(SITE.links.linkedin) },
      { id: 'link:leetcode', group: 'Links', label: 'LeetCode', hint: 'Opens in a new tab', icon: icon(Code2), run: () => openExternal(SITE.links.leetcode) },
      {
        id: 'link:copy-email',
        group: 'Links',
        label: 'Copy email address',
        hint: SITE.email,
        keywords: 'mail contact',
        icon: icon(Copy),
        run: () => {
          track('copy_email');
          const done = () => toast({ title: 'Email copied', description: SITE.email, tone: 'success' });
          const failed = () => toast({ title: 'Copy it from here', description: SITE.email, tone: 'info', duration: 8000 });
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(SITE.email).then(done, failed);
          else failed();
        },
      },
      {
        id: 'link:email',
        group: 'Links',
        label: 'Write an email',
        hint: SITE.email,
        keywords: 'mail contact',
        icon: icon(AtSign),
        run: () => {
          window.location.href = SITE.mailtoHref;
        },
      },
      {
        id: 'link:cv',
        group: 'Links',
        label: 'Download CV',
        hint: SITE.cvMeta,
        keywords: 'resume pdf',
        icon: icon(Download),
        run: () => {
          track('cv_download');
          const a = document.createElement('a');
          a.href = SITE.cvPath;
          a.download = SITE.cvFileName;
          document.body.appendChild(a);
          a.click();
          a.remove();
        },
      },
      {
        id: 'link:cv-view',
        group: 'Links',
        label: 'View CV',
        hint: 'Opens in a new tab',
        keywords: 'resume pdf',
        icon: icon(FileText),
        run: () => {
          track('cv_view');
          openExternal(SITE.cvPath);
        },
      },
    );

    const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    list.push({
      id: 'action:theme',
      group: 'Actions',
      label: `Switch to ${nextTheme} theme`,
      keywords: 'theme dark light colour color mode',
      icon: icon(nextTheme === 'light' ? Sun : Moon),
      run: () => {
        track('theme_toggle', { to: nextTheme });
        toggleTheme();
      },
    });
    if (theme !== 'system') {
      list.push({
        id: 'action:theme-system',
        group: 'Actions',
        label: 'Follow the system theme',
        keywords: 'theme auto os',
        icon: icon(Monitor),
        run: () => {
          track('theme_toggle', { to: 'system' });
          setTheme('system');
        },
      });
    }
    list.push(
      {
        id: 'action:reduce-motion',
        group: 'Actions',
        label: reduce ? 'Turn reduced motion off' : 'Reduce motion',
        keywords: 'animation accessibility a11y',
        icon: icon(Waves),
        run: () => toggleReducedMotion(!reduce),
      },
      {
        id: 'action:pause',
        group: 'Actions',
        label: paused ? 'Resume motion' : 'Pause motion',
        keywords: 'animation video marquee stop',
        icon: icon(paused ? Play : Pause),
        run: () => setPaused(!paused),
      },
      {
        id: 'action:single-keys',
        group: 'Actions',
        label: singleKeys ? 'Turn single-key shortcuts off' : 'Turn single-key shortcuts on',
        keywords: 'keyboard hotkeys speech',
        icon: icon(Keyboard),
        run: () => setSingleKeys(!singleKeys),
      },
    );
    if (onShowShortcuts) {
      list.push({
        id: 'action:shortcuts',
        group: 'Actions',
        label: 'Show keyboard shortcuts',
        keywords: 'keys hotkeys help',
        icon: icon(Keyboard),
        run: onShowShortcuts,
      });
    }
    return list;
  }, [theme, resolvedTheme, reduce, paused, singleKeys, setSingleKeys, setTheme, toggleTheme, toast, onShowShortcuts]);

  const groups = useMemo<Group[]>(() => {
    const q = query.trim();
    if (!q) {
      const byId = new Map(items.map((i) => [i.id, i]));
      const recentItems = recent.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
      const out: Group[] = recentItems.length ? [{ name: 'Recent', items: recentItems }] : [];
      // Fifty skills would bury everything else: they appear once there is a query.
      for (const name of GROUP_ORDER) {
        if (name === 'Skills') continue;
        out.push({ name, items: items.filter((i) => i.group === name && !recent.includes(i.id)) });
      }
      return out.filter((g) => g.items.length > 0);
    }
    const scored = items
      .map((item) => ({
        item,
        score: Math.max(fuzzyScore(q, item.label), item.keywords ? fuzzyScore(q, item.keywords) * 0.6 : 0),
      }))
      .filter((r) => r.score > 0);
    const out: (Group & { best: number })[] = [];
    for (const name of GROUP_ORDER) {
      const inGroup = scored.filter((r) => r.item.group === name).sort((a, b) => b.score - a.score);
      if (inGroup.length) out.push({ name, items: inGroup.slice(0, 8).map((r) => r.item), best: inGroup[0].score });
    }
    // The group holding the best match leads, so Enter takes it.
    return out.sort((a, b) => b.best - a.best);
  }, [items, query, recent]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Index of each group's first option in the flat list.
  const starts = useMemo(() => groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.items.length, 0)), [groups]);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const runItem = (item: Item) => {
    pushRecent(item.id);
    onClose();
    afterClose(item.run);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      const item = flat[current];
      if (!item || e.nativeEvent.isComposing) return;
      e.preventDefault();
      runItem(item);
    } else if (e.key === 'Escape' && query) {
      // First Escape clears the query; the dialog closes on the next.
      e.preventDefault();
      setQuery('');
      setActive(0);
    } else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-command-palette="">
      {/* The input always holds focus here, so the row's border is its focus indicator. */}
      <div className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 transition-colors focus-within:border-violet-bright">
        <Search aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? optionId(current) : undefined}
          aria-label="Search sections, projects, skills and actions"
          placeholder="Search sections, projects, skills…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-[15px]"
        />
        <kbd className="hidden shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[11px] text-text-muted sm:inline">Esc</kbd>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Results"
        data-lenis-prevent=""
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
      >
        {flat.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <LottieIcon
              name="emptySearch"
              play="once"
              loop={false}
              className="block size-20"
              fallback={<SearchX aria-hidden="true" className="size-8 text-text-muted" />}
            />
            <p className="text-sm text-text-secondary">No matches for “{query.trim()}”</p>
            <p className="text-[13px] text-text-muted">Try a section, a project or a skill.</p>
          </div>
        ) : (
          groups.map((g, gi) => (
            <div key={g.name} role="group" aria-label={g.name} className="mb-2 last:mb-0">
              <div aria-hidden="true" className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
                {g.name}
              </div>
              {g.items.map((item, j) => {
                const i = starts[gi] + j;
                const selected = i === current;
                return (
                  <div
                    key={`${g.name}-${item.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    data-index={i}
                    onPointerMove={() => {
                      if (!selected) setActive(i);
                    }}
                    onClick={() => runItem(item)}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm',
                      selected ? 'bg-surface-tint text-text-primary' : 'text-text-secondary',
                    )}
                  >
                    <span className={cn('shrink-0', selected ? 'text-violet-bright' : 'text-text-muted')}>{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.hint ? <span className="block truncate text-[13px] text-text-muted">{item.hint}</span> : null}
                    </span>
                    {selected ? <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-text-muted" /> : null}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-hairline px-4 py-2.5 text-[12px] text-text-muted">
        <span aria-live="polite" aria-atomic="true">
          {query.trim() ? `${flat.length} ${flat.length === 1 ? 'result' : 'results'}` : ''}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">
          ↑ ↓ to move · Enter to open · Esc to close
        </span>
      </div>
    </div>
  );
}
