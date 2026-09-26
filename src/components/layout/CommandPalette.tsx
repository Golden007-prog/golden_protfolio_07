'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ArrowRight,
  AtSign,
  BadgeCheck,
  BookOpenText,
  Code2,
  Copy,
  Download,
  FileText,
  FolderGit2,
  Github,
  Hash,
  Keyboard,
  Languages,
  Linkedin,
  Map as MapIcon,
  MessageCircleQuestionMark,
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
import type { SectionToolsRequest } from '@/components/ai/discovery/SectionTools';
import { useAiActionRunner } from '@/components/ai/useAiActionRunner';
import { CERTS, KIND_LABEL } from '@/components/certifications/data';
import { revealCredential } from '@/components/certifications/reveal';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { toggleReducedMotion } from '@/components/shared/MotionToggle';
import { Dialog } from '@/components/ui/Dialog';
import { useToast } from '@/components/ui/Toast';
import { smoothScrollTo } from '@/contexts/LenisContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSingleKeyShortcuts } from '@/hooks/useHotkeys';
import { setPaused, useMotionPrefs, usePaused } from '@/hooks/useMotionPrefs';
import { sectionOf } from '@/lib/ai/actions';
import { openAssistant } from '@/lib/ai/bus';
import { AI_LIMITS } from '@/lib/ai/config';
import type { AiTarget } from '@/lib/ai/protocol';
import { isFallbackBody } from '@/lib/ai/stream';
import { track } from '@/lib/analytics';
import { emit } from '@/lib/events';
import { safeStorage } from '@/lib/safeStorage';
import { SECTIONS, SITE, slugify } from '@/lib/site';
import { setUrlHash } from '@/lib/urlState';
import { cn } from '@/utils/cn';

type GroupName = 'Recent' | 'Sections' | 'Projects' | 'Skills' | 'Credentials' | 'Links' | 'Actions' | 'By meaning';

type Item = {
  id: string;
  group: Exclude<GroupName, 'Recent' | 'By meaning'>;
  label: string;
  hint?: string;
  keywords?: string;
  icon: ReactNode;
  run: () => void;
  /** 0..1 similarity, shown as a small bar ('By meaning' rows only). */
  score?: number;
  /** Query-specific rows (Ask AI) never enter Recent. */
  transient?: boolean;
};

type Group = { name: GroupName; items: Item[] };


const RECENT_KEY = 'ob-palette-recent';
const RECENT_MAX = 5;
const GROUP_ORDER: Exclude<GroupName, 'Recent' | 'By meaning'>[] = ['Sections', 'Projects', 'Skills', 'Credentials', 'Links', 'Actions'];
/** Long lists that would bury everything else: they appear once there is a query. */
const QUERY_ONLY: ReadonlySet<GroupName> = new Set(['Skills', 'Credentials']);
/**
 * Groups that match on a substring only. Thirty-seven long course titles hold
 * almost any short query as a scattered subsequence ('tutor' in 'Introduction to
 * Model Context Protocol'), which would bury the real matches under badges.
 */
const SUBSTRING_ONLY: ReadonlySet<GroupName> = new Set(['Credentials']);
/** fuzzyScore's floor for a substring match (a scattered subsequence scores far below it). */
const SUBSTRING_SCORE = 500;
const ASK_ID = 'action:ask-ai';

/* Semantic matches: asked for only when the lexical search is thin. */
const SEMANTIC_MIN_CHARS = 3;
const SEMANTIC_BELOW = 3;
const SEMANTIC_SETTLE_MS = 400;
const SEMANTIC_TIMEOUT_MS = 8000;
const SEMANTIC_MAX = 5;

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

/* ---- 'By meaning': POST /api/ai/retrieve, once per settled query, cached for the page's life ---- */

type SemanticHit = { id: string; label: string; target: AiTarget; score: number; cosine: number | null; bm25: number };

/** Normalised query -> hits, or null when retrieval failed (the group is then omitted). */
const semanticCache = new Map<string, SemanticHit[] | null>();

const semanticKey = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, AI_LIMITS.retrieveQuery);

function isHit(x: unknown): x is SemanticHit {
  if (!x || typeof x !== 'object') return false;
  const h = x as Partial<SemanticHit>;
  return typeof h.id === 'string' && typeof h.label === 'string' && !!h.target && typeof h.target === 'object' && typeof h.bm25 === 'number';
}

async function fetchSemantic(query: string, signal: AbortSignal): Promise<SemanticHit[] | null> {
  try {
    const res = await fetch('/api/ai/retrieve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, k: 6, scope: 'all' }),
      signal,
      cache: 'no-store',
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    const body: unknown = await res.json();
    if (isFallbackBody(body) || !body || typeof body !== 'object') return null;
    const hits = (body as { hits?: unknown }).hits;
    return Array.isArray(hits) ? hits.filter(isHit) : null;
  } catch {
    return null;
  }
}

/**
 * Semantic hits for `query` once it has settled for 400ms (or on flush(), for
 * Enter). A query already asked is answered from memory; a newer query aborts
 * an older request still in flight. A failure or a timeout is remembered too,
 * and simply omits the group.
 */
function useSemantic(query: string, wanted: boolean) {
  const key = semanticKey(query);
  const active = wanted && key.length >= SEMANTIC_MIN_CHARS;
  // Rendered state; the controller itself lives in a ref, read only in callbacks.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const inflight = useRef<{ key: string; ac: AbortController } | null>(null);

  const fire = useCallback((k: string) => {
    if (semanticCache.has(k) || inflight.current?.key === k) return;
    inflight.current?.ac.abort();
    const ac = new AbortController();
    inflight.current = { key: k, ac };
    setPendingKey(k);
    const timer = window.setTimeout(() => ac.abort(), SEMANTIC_TIMEOUT_MS);
    void fetchSemantic(k, ac.signal).then((hits) => {
      window.clearTimeout(timer);
      // Superseded by a newer query, or the palette closed: not an answer.
      if (inflight.current?.ac !== ac) return;
      inflight.current = null;
      semanticCache.set(k, hits);
      setPendingKey((p) => (p === k ? null : p));
    });
  }, []);

  useEffect(() => {
    if (!active || semanticCache.has(key)) return;
    const t = window.setTimeout(() => fire(key), SEMANTIC_SETTLE_MS);
    return () => window.clearTimeout(t);
  }, [active, key, fire]);

  useEffect(
    () => () => {
      const current = inflight.current;
      inflight.current = null;
      current?.ac.abort();
    },
    [],
  );

  const cached = active && semanticCache.has(key);
  return {
    hits: active ? (semanticCache.get(key) ?? null) : null,
    loading: active && pendingKey === key,
    /** True while a request for this query is still to be sent. */
    due: active && !cached && pendingKey !== key,
    flush: () => {
      if (active) fire(key);
    },
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  onShowShortcuts?: () => void;
  /** 'Show me around': opens the guided tour's goal picker. */
  onStartTour?: () => void;
  /** 'Explain this section simply' / 'Read this section in …'. */
  onSectionTools?: (request: SectionToolsRequest) => void;
};

/** Command palette (Dialog 'palette'): a combobox over a grouped listbox with aria-activedescendant. */
export function CommandPalette({ open, onClose, onShowShortcuts, onStartTour, onSectionTools }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onClose={onClose} variant="palette" ariaLabel="Command palette" initialFocusRef={inputRef}>
      <PaletteBody
        inputRef={inputRef}
        onClose={onClose}
        onShowShortcuts={onShowShortcuts}
        onStartTour={onStartTour}
        onSectionTools={onSectionTools}
      />
    </Dialog>
  );
}

function PaletteBody({
  inputRef,
  onClose,
  onShowShortcuts,
  onStartTour,
  onSectionTools,
}: Omit<Props, 'open'> & { inputRef: RefObject<HTMLInputElement | null> }) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  // The highlighted row by id, so a 'By meaning' group arriving late never moves the highlight.
  const [activeId, setActiveId] = useState<string | null>(null);
  // Read once per opening: the body mounts each time the palette opens.
  const [recent] = useState(readRecent);

  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();
  const { reduce } = useMotionPrefs();
  const paused = usePaused();
  const [singleKeys, setSingleKeys] = useSingleKeyShortcuts();
  const { toast } = useToast();
  const runTarget = useAiActionRunner();

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

    // The section clears a filter hiding the card and opens what folds it away before scrolling there.
    for (const c of CERTS.items) {
      list.push({
        id: `cert:${c.id}`,
        group: 'Credentials',
        label: c.title,
        hint: `${KIND_LABEL[c.kind]} · ${c.issuer} · ${c.platform}`,
        keywords: `certification certificate credential badge ${c.issuer} ${c.platform}`,
        icon: icon(BadgeCheck),
        run: () => revealCredential(c.id),
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

    if (onStartTour) {
      list.push({
        id: 'action:tour',
        group: 'Actions',
        label: 'Show me around',
        hint: 'A short guided tour',
        keywords: 'tour guide walkthrough overview highlights',
        icon: icon(MapIcon),
        run: onStartTour,
      });
    }
    if (onSectionTools) {
      list.push(
        {
          id: 'action:explain',
          group: 'Actions',
          label: 'Explain this section simply',
          hint: 'Plain-English version, with Listen',
          keywords: 'plain english simplify eli5 read aloud listen',
          icon: icon(BookOpenText),
          run: () => onSectionTools('simple'),
        },
        {
          id: 'action:translate',
          group: 'Actions',
          label: 'Read this section in …',
          hint: 'हिन्दी · বাংলা · Español',
          keywords: 'translate translation language hindi bengali bangla spanish espanol',
          icon: icon(Languages),
          run: () => onSectionTools('translate'),
        },
      );
    }

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
  }, [theme, resolvedTheme, reduce, paused, singleKeys, setSingleKeys, setTheme, toggleTheme, toast, onShowShortcuts, onStartTour, onSectionTools]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // The lexical search, before semantic matches and the Ask AI row join it.
  const lexical = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const recentItems = recent.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
      const out: Group[] = recentItems.length ? [{ name: 'Recent', items: recentItems }] : [];
      for (const name of GROUP_ORDER) {
        if (QUERY_ONLY.has(name)) continue;
        out.push({ name, items: items.filter((i) => i.group === name && !recent.includes(i.id)) });
      }
      return { groups: out.filter((g) => g.items.length > 0), count: 0 };
    }
    const scored = items
      .map((item) => ({
        item,
        score: Math.max(fuzzyScore(q, item.label), item.keywords ? fuzzyScore(q, item.keywords) * 0.6 : 0),
      }))
      .filter((r) => r.score > 0 && (!SUBSTRING_ONLY.has(r.item.group) || r.score >= SUBSTRING_SCORE * 0.6));
    const out: (Group & { best: number })[] = [];
    for (const name of GROUP_ORDER) {
      const inGroup = scored.filter((r) => r.item.group === name).sort((a, b) => b.score - a.score);
      if (inGroup.length) out.push({ name, items: inGroup.slice(0, 8).map((r) => r.item), best: inGroup[0].score });
    }
    // The group holding the best match leads, so Enter takes it.
    return { groups: out.sort((a, b) => b.best - a.best).map(({ name, items: groupItems }) => ({ name, items: groupItems })), count: scored.length };
  }, [items, byId, query, recent]);

  const q = query.trim();
  const semantic = useSemantic(q, lexical.count < SEMANTIC_BELOW);

  const meaningItems = useMemo<Item[]>(() => {
    if (!semantic.hits?.length) return [];
    const shown = new Set(lexical.groups.flatMap((g) => g.items.map((i) => i.id)));
    const out: Item[] = [];
    for (const h of semantic.hits) {
      const base = itemForTarget(h.target, byId);
      const id = base?.id ?? `meaning:${h.id}`;
      if (shown.has(id) || out.some((i) => i.id === id)) continue;
      const value = Math.max(0, Math.min(1, h.cosine ?? h.bm25));
      out.push(
        base
          ? { ...base, score: value }
          : {
              id,
              group: 'Sections',
              label: h.label,
              hint: sectionLabelOf(h.target),
              icon: <Hash aria-hidden="true" className="size-4" />,
              run: () => runTarget(h.target),
              score: value,
              // No row of its own to come back to, so it never enters Recent.
              transient: true,
            },
      );
      if (out.length >= SEMANTIC_MAX) break;
    }
    return out;
  }, [semantic.hits, lexical.groups, byId, runTarget]);

  const groups = useMemo<Group[]>(() => {
    if (!q) return lexical.groups;
    const out: Group[] = lexical.groups.map((g) => ({ ...g, items: [...g.items] }));
    if (meaningItems.length) out.push({ name: 'By meaning', items: meaningItems });
    const question = q.slice(0, AI_LIMITS.question);
    const ask: Item = {
      id: ASK_ID,
      group: 'Actions',
      label: `Ask AI: “${question}”`,
      hint: 'Opens the assistant with this question',
      icon: <MessageCircleQuestionMark aria-hidden="true" className="size-4" />,
      transient: true,
      run: () => openAssistant({ question, send: true }),
    };
    const actions = out.find((g) => g.name === 'Actions');
    if (actions) actions.items.push(ask);
    else out.push({ name: 'Actions', items: [ask] });
    return out;
  }, [q, lexical.groups, meaningItems]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Index of each group's first option in the flat list.
  const starts = useMemo(() => groups.map((_, gi) => groups.slice(0, gi).reduce((n, g) => n + g.items.length, 0)), [groups]);
  const found = activeId ? flat.findIndex((i) => i.id === activeId) : -1;
  const current = found >= 0 ? found : 0;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const noMatches = Boolean(q) && lexical.count === 0 && meaningItems.length === 0;

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const runItem = (item: Item) => {
    if (!item.transient) pushRecent(item.id);
    onClose();
    afterClose(item.run);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveId(flat[(current + step + flat.length) % flat.length].id);
    } else if (e.key === 'Enter') {
      const item = flat[current];
      if (!item || e.nativeEvent.isComposing) return;
      e.preventDefault();
      // 'Ask AI' is highlighted only because nothing else matched (not chosen with the
      // arrows) and the meaning search is still pending: the first Enter searches by
      // meaning now instead of waiting.
      if (item.id === ASK_ID && activeId === null && semantic.due) {
        semantic.flush();
        return;
      }
      runItem(item);
    } else if (e.key === 'Escape' && query) {
      // First Escape clears the query; the dialog closes on the next.
      e.preventDefault();
      setQuery('');
      setActiveId(null);
    } else if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onClose();
    }
  };

  const status = !q
    ? ''
    : semantic.loading
      ? 'Searching by meaning…'
      : lexical.count + meaningItems.length === 0
        ? 'No matches. Ask AI is available.'
        : `${lexical.count + meaningItems.length} ${lexical.count + meaningItems.length === 1 ? 'result' : 'results'}`;

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
            setActiveId(null);
          }}
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted sm:text-[15px]"
        />
        <kbd className="hidden shrink-0 rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[11px] text-text-muted sm:inline">Esc</kbd>
      </div>

      <div data-lenis-prevent="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {noMatches ? (
          <div className="flex flex-col items-center gap-2 px-6 pb-4 pt-8 text-center" data-palette-empty="">
            <LottieIcon
              name="emptySearch"
              play="once"
              loop={false}
              className="block size-20"
              fallback={<SearchX aria-hidden="true" className="size-8 text-text-muted" />}
            />
            <p className="text-sm text-text-secondary">No matches for “{q}”</p>
            <p className="text-[13px] text-text-muted">{semantic.loading ? 'Searching by meaning…' : 'Ask the AI assistant instead:'}</p>
          </div>
        ) : null}

        {/* Only options and their groups live in the listbox, so the combobox pattern stays valid. */}
        <div ref={listRef} id={listId} role="listbox" aria-label="Results">
          {groups.map((g, gi) => (
            <div key={g.name} role="group" aria-label={g.name} className="mb-2 last:mb-0" data-palette-group={g.name}>
              <div aria-hidden="true" className="px-3 pb-1 pt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
                {g.name}
              </div>
              {g.items.map((item, j) => {
                const i = starts[gi] + j;
                const selected = i === current;
                const pct = item.score !== undefined ? Math.round(item.score * 100) : null;
                return (
                  <div
                    key={`${g.name}-${item.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    data-index={i}
                    data-item-id={item.id}
                    onPointerMove={() => {
                      if (!selected) setActiveId(item.id);
                    }}
                    onClick={() => runItem(item)}
                    className={cn(
                      'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm',
                      selected ? 'bg-surface-tint text-text-primary' : 'text-text-secondary',
                      item.id === ASK_ID && 'palette-ask',
                    )}
                  >
                    <span className={cn('shrink-0', selected || item.id === ASK_ID ? 'text-violet-bright' : 'text-text-muted')}>{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.label}</span>
                      {item.hint ? <span className="block truncate text-[13px] text-text-muted">{item.hint}</span> : null}
                    </span>
                    {pct !== null ? (
                      <span className="flex w-10 shrink-0 items-center" data-semantic-score={item.score!.toFixed(2)}>
                        <span aria-hidden="true" className="palette-score block h-1 w-full overflow-clip rounded-full bg-glass-border-strong">
                          <span className="block h-full rounded-full bg-violet-bright" style={{ width: `${Math.max(pct, 6)}%` }} />
                        </span>
                        <span className="sr-only">, {pct}% match</span>
                      </span>
                    ) : null}
                    {selected ? <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-text-muted" /> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-hairline px-4 py-2.5 text-[12px] text-text-muted">
        <span aria-live="polite" aria-atomic="true" data-palette-status="">
          {status}
        </span>
        <span aria-hidden="true" className="hidden sm:inline">
          ↑ ↓ to move · Enter to open · Esc to close
        </span>
      </div>
    </div>
  );
}

/** The palette's own row for a retrieval target, so a meaning match opens exactly like a typed one. */
function itemForTarget(t: AiTarget, byId: Map<string, Item>): Item | undefined {
  switch (t.kind) {
    case 'project':
      return byId.get(`project:${t.slug}`);
    case 'skill':
      return byId.get(`skill:${slugify(t.name)}`);
    case 'section':
      return byId.get(`section:${t.id}`);
    default:
      return undefined;
  }
}

function sectionLabelOf(t: AiTarget): string | undefined {
  const id = sectionOf(t);
  return id ? SECTIONS.find((s) => s.id === id)?.label : undefined;
}
