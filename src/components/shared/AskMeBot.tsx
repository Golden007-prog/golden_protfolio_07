'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageSquare, MessageSquarePlus, Send, Sparkles, Square, X } from 'lucide-react';
import profile from '@/data/profile.json';
import projects from '@/data/projects.json';
import conciergeStore from '@/data/ai-generated/concierge.json';
import { useAiHealth } from '@/components/ai/AiNotice';
import { SuggestedPrompts } from '@/components/ai/SuggestedPrompts';
import { useAiActionRunner } from '@/components/ai/useAiActionRunner';
import { useAiStream } from '@/components/ai/useAiStream';
import { AiBubble, BY_SLUG, fallbackNoteText, RuleBubble, type BubbleHandlers } from '@/components/ai/concierge/AiMessage';
import { aiSpoken, ruleSpoken, type SpokenPart } from '@/components/ai/concierge/spoken';
import { CANARY_SHAPE, scrubCanary, useConversation, type AiMsg, type Msg, type RuleNote } from '@/components/ai/concierge/useConversation';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { useToast } from '@/components/ui/Toast';
import { hasCaseStudy, PROJECTS } from '@/data/projects';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { takePending } from '@/lib/ai/bus';
import { aiSession, BLOCK_STREAK, SERVER_SESSION_SNAPSHOT, SOFT_CAP } from '@/lib/ai/circuit';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import { keepFollowups, startersFor, type FollowupNames, type StarterEntries } from '@/lib/ai/followups';
import { LANG_NAMES } from '@/lib/ai/prompts/base';
import type { AiFallbackReason, AiSource, AiToolCall, AskOpenRequest, AskRequest, AskScope } from '@/lib/ai/protocol';
import { langFor, safeLangTag } from '@/lib/ai/script';
import { isTerminal } from '@/lib/ai/stream';
import { stepLabel, toolAction, toolDataFrom, UNDO_PARAMS, validateToolCall, wantsNavigation } from '@/lib/ai/tools';
import { track } from '@/lib/analytics';
import { emit, useAppEvent } from '@/lib/events';
import { duration, ease } from '@/lib/motion';
import { SECTIONS, type SectionId } from '@/lib/site';
import { readUrl, setUrlParams, useUrlParam } from '@/lib/urlState';
import { answer as ask, isMultiSentence, isRefusal, shouldEscalate, STARTERS, type AskAnswer, type AskData } from '@/utils/askme';

const DATA: AskData = { profile, projects };
const QUESTION_MAX = 500;
const Q_PHONE = '(max-width: 639.98px)';
/** Below this visual-viewport height (a phone with its keyboard up) the sheet goes compact. */
const SHORT_VIEWPORT_PX = 420;
const STARTER_STORE = (conciergeStore as { entries?: StarterEntries }).entries ?? {};
const CASE_STUDY_SLUGS: ReadonlySet<string> = new Set(PROJECTS.filter(hasCaseStudy).map((p) => p.slug));
const SKILL_NAMES: readonly string[] = [...new Set(Object.values(profile.skills).flat())];
const TOOL_DATA = toolDataFrom({
  sections: SECTIONS,
  projects: PROJECTS,
  skills: profile.skills,
});
const FOLLOWUP_NAMES: FollowupNames = {
  projects: PROJECTS.map((p) => p.name),
  skills: SKILL_NAMES,
  companies: profile.experience.map((e) => e.company),
  sections: SECTIONS.map((s) => s.label),
};
// Fallbacks that mean the AI is off or out for now: the quick answers carry on.
const RESTING: ReadonlySet<AiFallbackReason> = new Set<AiFallbackReason>(['quota', 'no-key', 'disabled', 'timeout']);
const UNDOABLE: ReadonlySet<string> = new Set(['openProject', 'openSkill', 'setProjectFilters']);
const SAY_DELAY_MS = 60;
// After the status line, so 'Quick answer shown instead' is heard before the answer it introduces.
const SPEAK_DELAY_MS = 150;
// An answer stays in its region at least as long as it takes to read (~15 characters a second).
const SPEAK_MIN_MS = 7000;
const SPEAK_MS_PER_CHAR = 80;

/** A scope from an ask:open request, only when it names something on the site. */
function validScope(s: unknown): AskScope | null {
  if (!s || typeof s !== 'object') return null;
  const x = s as Record<string, unknown>;
  if (typeof x.project === 'string' && BY_SLUG.has(x.project)) return { project: x.project };
  if (typeof x.skill === 'string' && SKILL_NAMES.includes(x.skill)) return { skill: x.skill };
  if (typeof x.experience === 'number' && Number.isInteger(x.experience) && x.experience >= 0 && x.experience < profile.experience.length) {
    return { experience: x.experience };
  }
  if (typeof x.section === 'string' && SECTIONS.some((sec) => sec.id === x.section)) return { section: x.section as SectionId };
  return null;
}

function scopeLabel(scope: AskScope): string {
  if ('project' in scope) return BY_SLUG.get(scope.project)?.name ?? scope.project;
  if ('skill' in scope) return scope.skill;
  if ('experience' in scope) return profile.experience[scope.experience]?.company ?? 'this role';
  return SECTIONS.find((s) => s.id === scope.section)?.label ?? scope.section;
}

function preferredLangs(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
}

type LiveAsk = {
  id: number;
  question: string;
  rule: AskAnswer;
  request: AskRequest;
  lang: string | null;
};

type Snapshot = Pick<ReturnType<typeof useAiStream>, 'status' | 'text' | 'meta' | 'done' | 'tools' | 'fallback' | 'ttftMs' | 'totalMs'>;

type BodyProps = {
  ids: { title: string; subtitle: string; input: string };
  messages: Msg[];
  live: AiMsg | null;
  liveThinking: boolean;
  liveTool: boolean;
  freshId: number | null;
  typing: boolean;
  asked: boolean;
  busy: boolean;
  input: string;
  setInput: (v: string) => void;
  starters: readonly string[];
  followUps: readonly string[];
  scope: AskScope | null;
  onClearScope: () => void;
  status: { tone: 'ready' | 'resting' | 'idle'; label: string };
  capNote: string | null;
  canHandOff: boolean;
  onHandOff: () => void;
  onSend: (q: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onClose: () => void;
  regenLeft: number;
  handlers: BubbleHandlers;
  announcement: string;
  spoken: readonly SpokenPart[] | null;
  logRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  submitRef: RefObject<HTMLElement | null>;
};

function ChatBody({
  onSend,
  input,
  messages,
  status,
  ids,
  onNewChat,
  asked,
  scope,
  onClose,
  logRef,
  busy,
  freshId,
  regenLeft,
  handlers,
  live,
  liveThinking,
  liveTool,
  typing,
  canHandOff,
  onHandOff,
  starters,
  followUps,
  capNote,
  onClearScope,
  inputRef,
  submitRef,
  setInput,
  onStop,
  announcement,
  spoken,
}: BodyProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(input);
  };
  const lastAi = [...messages].reverse().find((m): m is AiMsg => m.from === 'bot' && m.kind === 'ai');
  const latestId = messages[messages.length - 1]?.id;
  const dotClass = status.tone === 'ready' ? 'text-success' : status.tone === 'resting' ? 'text-amber-text' : 'text-text-muted';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline py-2 pl-4 pr-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--app-violet),var(--app-cyan))] text-white">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={ids.title}
            className="flex items-center gap-2 font-display text-base font-semibold leading-6 tracking-normal text-text-primary"
          >
            Ask Oikantik
            <span data-ask-status={status.tone} title={status.label} className={`inline-flex ${dotClass}`}>
              <span aria-hidden="true" className="ask-status-dot size-2 rounded-full bg-current" />
              <span className="sr-only">{status.label}</span>
            </span>
          </h2>
          <p id={ids.subtitle} className="text-xs leading-4 text-text-muted" data-ask-subtitle="">
            Answers from this site&apos;s data · AI-assisted for open questions
          </p>
        </div>
        <Button variant="icon" size="md" aria-label="New chat" onClick={onNewChat} disabled={!asked && !scope} data-ask-new="">
          <MessageSquarePlus aria-hidden="true" className="size-4" />
        </Button>
        <Button variant="icon" size="md" aria-label="Close assistant" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div
        ref={logRef}
        data-lenis-prevent=""
        data-ask-log=""
        aria-busy={busy || undefined}
        className="ask-log min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        {/* Finished bubbles only: a streaming answer joins the log once it completes.
            Silent (role=log is otherwise polite): an added bubble would be read with every chip, link and
            button in it. Each message's words are spoken once through [data-ask-speak] instead.
            tabIndex -1: focus lands here when a pressed control goes away and a coarse pointer rules out the field. */}
        <div
          role="log"
          aria-live="off"
          aria-label="Conversation"
          aria-busy={busy || undefined}
          tabIndex={-1}
          className="space-y-3 rounded-xl ring-focus"
        >
          {messages.map((m) =>
            m.from === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet px-3.5 py-2.5 text-sm leading-relaxed text-white [overflow-wrap:anywhere]">
                  <span className="sr-only">You: </span>
                  {m.text}
                </p>
              </div>
            ) : m.kind === 'ai' ? (
              <AiBubble
                key={m.id}
                msg={m}
                latest={m.id === latestId && m.id === lastAi?.id}
                fresh={m.id === freshId}
                regenLeft={busy ? 0 : regenLeft}
                handlers={handlers}
              />
            ) : (
              <RuleBubble key={m.id} msg={m} handlers={handlers} />
            ),
          )}
        </div>
        {live ? (
          <div className="mt-3" data-ask-live="">
            <AiBubble msg={live} streaming thinking={liveThinking} toolPending={liveTool} regenLeft={0} handlers={handlers} />
          </div>
        ) : null}
        {typing ? (
          <div aria-hidden="true" className="mt-3 flex justify-start" data-ask-typing="">
            <span className="rounded-2xl rounded-bl-md border border-glass-border bg-surface-tint px-2 py-1">
              <LottieIcon
                name="typing"
                play="auto"
                loop
                lazy={false}
                className="block h-6 w-12"
                fallback={<span className="block px-2 font-mono text-sm leading-6 text-text-muted">…</span>}
              />
            </span>
          </div>
        ) : null}
        {canHandOff ? (
          <div className="mt-3 flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={onHandOff}
              leadingIcon={
                <LottieIcon
                  name="send"
                  play="once"
                  lazy={false}
                  className="block size-4"
                  fallback={<Send aria-hidden="true" className="size-3.5" />}
                />
              }
              data-ask-handoff-all=""
            >
              Write to Oikantik with these questions
            </Button>
          </div>
        ) : null}
      </div>

      {!asked ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3" data-ask-starters="">
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSend(s)}
              className="tap-safe rounded-full border border-glass-border bg-glass-fill px-4 text-sm text-text-secondary ring-focus transition-colors hover:border-glass-border-strong hover:text-text-primary"
            >
              {s}
            </button>
          ))}
          <DownloadCvButton variant="secondary" size="md" className="text-sm" />
        </div>
      ) : followUps.length && !busy ? (
        <SuggestedPrompts prompts={followUps} onPick={onSend} label="Suggested follow-up questions" className="px-4 pb-3" />
      ) : null}

      {scope || capNote ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2 text-xs text-text-muted">
          {scope ? (
            <span
              data-ask-scope=""
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-glass-border bg-glass-fill pl-3 text-text-secondary"
            >
              <span className="truncate">About: {scopeLabel(scope)}</span>
              <Button
                variant="icon"
                size="sm"
                aria-label={`Remove scope: ${scopeLabel(scope)}`}
                onClick={onClearScope}
                data-ask-scope-clear=""
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </span>
          ) : null}
          {capNote ? <span data-ask-cap="">{capNote}</span> : null}
        </div>
      ) : null}

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-hairline p-3">
        <label htmlFor={ids.input} className="sr-only">
          Ask a question
        </label>
        <input
          id={ids.input}
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={QUESTION_MAX}
          className="tap-safe min-w-0 flex-1 rounded-full border border-glass-border-strong bg-glass-fill px-4 text-base text-text-primary ring-focus placeholder:text-text-muted"
        />
        {/* One node for Send and Stop, so a focused button survives the swap. */}
        <Button
          ref={submitRef}
          type={busy ? 'button' : 'submit'}
          variant={busy ? 'secondary' : 'primary'}
          size="md"
          shine={false}
          aria-label={busy ? 'Stop' : 'Send'}
          onClick={busy ? onStop : undefined}
          disabled={!busy && !input.trim()}
          className="w-11 px-0"
          data-ask-stop={busy ? '' : undefined}
        >
          {busy ? <Square aria-hidden="true" className="size-3.5 fill-current" /> : <Send aria-hidden="true" className="size-4" />}
        </Button>
      </form>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-ask-announce="">
        {announcement}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-ask-speak="">
        {spoken?.map((part, i) => (
          <Fragment key={i}>
            {i > 0 ? ' ' : null}
            <span lang={part.lang}>{part.text}</span>
          </Fragment>
        ))}
      </p>
    </div>
  );
}

/**
 * The site's concierge: a launcher in the floating dock that opens a non-modal
 * panel above it, or a modal bottom sheet below 640px.
 *
 * Rule first: every question gets askme.answer() at once. Its deterministic
 * answers (a project, hiring, the CV, links, roles, education, a skill) render
 * with no AI call; open-ended, 'about' and unmatched questions, navigation
 * requests and scoped questions go to /api/ai/ask, and any failure shows the
 * rule answer already computed. Every bubble says which one answered.
 *
 * AI answers stream outside the log, which is silent; a screen reader hears each
 * finished answer once, as plain text without its controls (spoken.ts). They
 * arrive as verified sentences with source chips, and
 * carry the disclosure, Markdown copy, feedback, Regenerate, the quick answer and
 * a Details panel. A tool call runs through the action runner with an Undo. The
 * thread lives in the session area; requests carry only the visitor's questions
 * and the last answer's citation ids.
 */
export function AskMeBot({
  onOpenChange,
  onBusyChange,
}: {
  onOpenChange?: (open: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { reduce, finePointer } = useMotionPrefs();
  const isPhone = useMediaQuery(Q_PHONE);
  const [open, setOpenState] = useState(false);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [breathe, setBreathe] = useState(true);
  const [live, setLive] = useState<LiveAsk | null>(null);
  const [freshId, setFreshId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [spoken, setSpoken] = useState<readonly SpokenPart[] | null>(null);
  const [healthWanted, setHealthWanted] = useState(false);

  const conv = useConversation();
  const stream = useAiStream('/api/ai/ask');
  const runAction = useAiActionRunner();
  const { toast } = useToast();
  const health = useAiHealth(healthWanted);
  const session = useSyncExternalStore(aiSession.subscribe, aiSession.snapshot, () => SERVER_SESSION_SNAPSHOT);
  const activeSection = useActiveSection();
  const openProject = useUrlParam('project');

  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLElement>(null);
  const timers = useRef(new Set<number>());
  const speakSeq = useRef(0);
  const onOpenChangeRef = useRef(onOpenChange);
  const onBusyChangeRef = useRef(onBusyChange);
  const streamRef = useRef<Snapshot>(stream);
  const messagesRef = useRef(conv.messages);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
    onBusyChangeRef.current = onBusyChange;
    streamRef.current = stream;
    messagesRef.current = conv.messages;
  });

  const baseId = useId();
  const ids = {
    title: `${baseId}-title`,
    subtitle: `${baseId}-subtitle`,
    input: `${baseId}-input`,
  };
  const panelId = `${baseId}-panel`;
  const asked = conv.messages.some((m) => m.from === 'user');
  const busy = live !== null;

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  useEffect(() => {
    onBusyChangeRef.current?.(busy);
  }, [busy]);

  /** One polite status line: 'Stopped', 'Quick answer shown instead'. Never the answer itself. */
  const say = useCallback(
    (text: string) => {
      setAnnouncement('');
      later(() => setAnnouncement(text), SAY_DELAY_MS);
      later(() => setAnnouncement((cur) => (cur === text ? '' : cur)), 7000);
    },
    [later],
  );

  /**
   * A message's words as plain text, once, when it joins the log; after any status line said with it.
   * speak([]) silences one still waiting to be spoken.
   */
  const speak = useCallback(
    (parts: readonly SpokenPart[]) => {
      const seq = ++speakSeq.current;
      setSpoken(null);
      if (!parts.length) return;
      const chars = parts.reduce((n, p) => n + p.text.length, 0);
      later(() => {
        if (speakSeq.current === seq) setSpoken(parts);
      }, SPEAK_DELAY_MS);
      later(() => setSpoken((cur) => (cur === parts ? null : cur)), SPEAK_DELAY_MS + Math.max(SPEAK_MIN_MS, chars * SPEAK_MS_PER_CHAR));
    },
    [later],
  );

  /**
   * Call before a change that removes or disables the focused control (a starter, a
   * follow-up, Send, Stop, Regenerate, Undo, the scope chip), or focus falls to <body>.
   * It goes to the field under a fine pointer, else to the conversation, so no
   * on-screen keyboard rises.
   */
  const holdFocus = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === inputRef.current || !el.closest('[data-ask-panel], [data-ask-sheet]')) return;
    const target = finePointer ? inputRef.current : logRef.current?.querySelector<HTMLElement>('[role="log"]');
    target?.focus({ preventScroll: true });
  };

  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (v) setBreathe(false);
    onOpenChangeRef.current?.(v);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  };

  /** Phones close the sheet first, so the page underneath can scroll and take focus. */
  const onPage = (fn: () => void) => {
    if (isPhone && open) {
      close(false);
      later(fn, 120);
    } else fn();
  };

  const pushRule = (
    rule: AskAnswer,
    extra: {
      question?: string;
      note?: RuleNote;
      reason?: AiFallbackReason;
      english?: boolean;
    } = {},
  ) => {
    conv.add({
      from: 'bot',
      kind: 'rules',
      text: rule.text,
      answer: rule,
      ...extra,
    });
    speak(
      ruleSpoken({
        text: rule.text,
        intent: rule.intent,
        note: extra.note,
        noteText: fallbackNoteText(extra.note, extra.reason),
        english: extra.english,
      }),
    );
  };

  /* ---- a tool call: run it, keep a step chip, offer Undo ---- */

  const undoStep = (id: number) => {
    const m = messagesRef.current.find((x): x is AiMsg => x.id === id && x.from === 'bot' && x.kind === 'ai');
    const undo = m?.step?.undo;
    if (!m || !undo || m.step?.undone) return;
    holdFocus();
    setUrlParams(undo);
    conv.update(id, (x) => (x.from === 'bot' && x.kind === 'ai' && x.step ? { ...x, step: { ...x.step, undone: true } } : x));
    say('Undone');
  };

  const runTool = (call: AiToolCall, id: number) => {
    const action = toolAction(call);
    if (!action) return;
    const params = readUrl().params;
    const undo = UNDOABLE.has(call.name) ? Object.fromEntries(UNDO_PARAMS.map((k) => [k, params.get(k)])) : null;
    const label = stepLabel(call, TOOL_DATA);
    conv.update(id, (m) => (m.from === 'bot' && m.kind === 'ai' ? { ...m, step: { label, undo } } : m));
    track('ai_tool', { feature: 'ask', intent: call.name });
    onPage(() => {
      runAction(action);
      // The project dialog is modal: the toast region is the one place Undo stays reachable.
      if (undo)
        toast({
          title: label.replace(/…$/, ''),
          tone: 'info',
          duration: 8000,
          action: { label: 'Undo', onClick: () => undoStep(id) },
        });
    });
  };

  /* ---- a settled stream becomes a message ---- */

  const finalize = (l: LiveAsk, s: Snapshot) => {
    // A focused Stop turns back into Send, which is disabled while the field is empty.
    if (document.activeElement === submitRef.current && !input.trim()) holdFocus();
    setLive(null);
    setHealthWanted(true);
    const english = Boolean(l.lang);
    if (s.status === 'fallback') {
      const reason = s.fallback?.reason ?? 'upstream';
      if (reason === 'low-relevance' && l.rule.intent !== 'fallback') {
        // The rules did answer; the site just has nothing more for the model to add.
        pushRule(l.rule, { english });
        return;
      }
      const note: RuleNote = RESTING.has(reason) ? 'resting' : reason === 'low-relevance' ? 'nothing' : 'unavailable';
      pushRule(l.rule, { question: l.question, note, reason, english });
      say(note === 'nothing' ? 'Nothing on this site covers that.' : 'Quick answer shown instead');
      return;
    }
    const raw = s.text;
    const meta = s.meta;
    const done = s.done;
    const sources: AiSource[] = (meta?.sources ?? []).map((src) => ({
      ...src,
      label: scrubCanary(src.label),
    }));
    const known = new Set(sources.map((x) => x.id));
    // A canary-shaped string means the answer leaked instructions: nothing of it is shown.
    const leaked = CANARY_SHAPE.test(raw);
    const inText = [...raw.matchAll(/\[c:([a-z]+:[\w#.-]+)\]/g)].map((m) => m[1]);
    const cited = leaked ? [] : [...new Set(done ? done.cited : inText)].filter((id) => known.has(id));
    const call = s.status === 'done' && !leaked ? (s.tools.map((t) => validateToolCall(t, TOOL_DATA)).find(Boolean) ?? null) : null;

    if (s.status === 'stopped' && !raw.trim()) {
      pushRule(l.rule, { question: l.question, note: 'stopped', english });
      say('Stopped');
      return;
    }
    if (s.status === 'done' && !leaked && !call && !done?.degraded && cited.length === 0 && !isRefusal(raw)) {
      pushRule(l.rule, { question: l.question, note: 'uncited', english });
      say('Quick answer shown instead');
      return;
    }
    const lang = safeLangTag(done?.lang);
    const id = conv.add({
      from: 'bot',
      kind: 'ai',
      question: l.question,
      request: l.request,
      rule: l.rule,
      text: leaked ? '' : raw,
      status: s.status === 'stopped' ? 'stopped' : 'done',
      sources,
      cited,
      dropped: done?.dropped ?? 0,
      degraded: leaked || Boolean(done?.degraded),
      model: scrubCanary(meta?.model ?? ''),
      mode: meta?.mode ?? 'lexical',
      cached: Boolean((meta as { cached?: unknown } | null)?.cached === true),
      retrieval: meta?.retrieval ?? [],
      usage: done?.usage,
      ttftMs: s.ttftMs,
      totalMs: s.totalMs,
      followUps: leaked ? [] : keepFollowups(done?.followUps ?? [], FOLLOWUP_NAMES),
      lang,
      en: lang && typeof done?.alt?.en === 'string' ? done.alt.en : null,
      requestedLang: l.lang,
      step: null,
    });
    setFreshId(id);
    if (call) runTool(call, id);
    if (s.status === 'stopped') say('Stopped');
    const requested = safeLangTag(l.lang);
    speak(
      aiSpoken({
        text: leaked ? '' : raw,
        lang,
        stopped: s.status === 'stopped',
        degraded: leaked || Boolean(done?.degraded),
        ruleText: l.rule.text,
        englishFrom: requested && !lang ? LANG_NAMES[requested] : null,
      }),
    );
  };

  const finalizeRef = useRef(finalize);
  useEffect(() => {
    finalizeRef.current = finalize;
  });

  useEffect(() => {
    if (!live || !isTerminal(stream.status)) return;
    let cancelled = false;
    // After this commit: the settled stream is read from the ref, then committed once.
    queueMicrotask(() => {
      if (!cancelled) finalizeRef.current(live, streamRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [live, stream.status]);

  /* ---- sending ---- */

  const startAi = (question: string, rule: AskAnswer, request: AskRequest, lang: string | null) => {
    setLive({ id: -Date.now(), question, rule, request, lang });
    track('ai_ask', { feature: 'ask', intent: rule.intent });
    stream.start(request);
  };

  /** `scopeNow` is a scope set in this same tick (ask:open), before the re-render that would carry it here. */
  const send = (text: string, scopeNow?: AskScope) => {
    const q = text.trim().slice(0, QUESTION_MAX);
    if (!q || typing || live) return;
    const rule = ask(q, DATA);
    const prior = conv.questions;
    const scope = scopeNow ?? conv.scope;
    const lang = langFor(q, preferredLangs());
    const english = Boolean(lang && lang !== 'en');
    holdFocus();
    conv.add({ from: 'user', text: q });
    setInput('');

    if (!shouldEscalate(q, rule, { scoped: Boolean(scope), foreign: english })) {
      // A short beat of "typing" before longer answers only; none under reduced motion.
      if (!reduce && isMultiSentence(rule.text)) {
        setTyping(true);
        later(
          () => {
            setTyping(false);
            pushRule(rule, { english });
          },
          300 + Math.min(150, rule.text.length),
        );
      } else pushRule(rule, { english });
      return;
    }

    // The circuit is open, the visit's AI answers are spent, or the server has AI off: no request.
    const blocked = aiSession.blockReason();
    if (blocked || (health && (!health.enabled || !health.configured))) {
      pushRule(rule, {
        question: q,
        note: 'resting',
        reason: blocked ?? 'disabled',
        english,
      });
      say('Quick answer shown instead');
      return;
    }
    if (aiSession.overSoftCap()) {
      pushRule(rule, { question: q, note: 'cap', english });
      say('Quick answer shown instead');
      return;
    }

    const request: AskRequest = {
      question: q,
      ...conv.context(prior),
      ...(scope ? { scope } : {}),
      ...(shouldOfferTools(q, rule) ? { tools: true } : {}),
      ...(lang && lang !== 'en' ? { lang } : {}),
    };
    startAi(q, rule, request, english ? lang : null);
  };

  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const stop = () => {
    if (live) stream.stop();
  };

  const regenerate = (msg: AiMsg) => {
    if (live || typing || !conv.takeRegen()) return;
    holdFocus();
    conv.remove(msg.id);
    const prevCited = msg.cited.length ? msg.cited.slice(0, 12) : msg.request.prevCited;
    startAi(msg.question, msg.rule, { ...msg.request, ...(prevCited?.length ? { prevCited } : {}) }, msg.requestedLang);
  };

  const newChat = () => {
    if (live) stream.reset();
    setLive(null);
    setTyping(false);
    setFreshId(null);
    conv.clear();
    speak([]);
    say('New chat started');
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };

  const showProject = (slug: string) => {
    close(false);
    later(() => emit('project:open', { slug }), 60);
  };

  // After the sheet's focus trap has let go, so the contact form can take focus.
  const write = (draft: string) => {
    close(false);
    track('ai_handoff', { feature: 'ask' });
    later(() => emit('contact:prefill', { message: draft }), 60);
  };

  const handOffQuestions = () => {
    close(false);
    track('ai_handoff', { feature: 'ask', count: conv.questions.length });
    const message = conv.questions.map((q) => `- ${q}`).join('\n');
    later(() => emit('contact:prefill', { message }), 60);
  };

  const openSource = (s: AiSource) => {
    track('ai_cite_click', { feature: 'ask', intent: s.target.kind });
    onPage(() => runAction(s.target));
  };

  const handlers: BubbleHandlers = {
    onShowProject: showProject,
    onWrite: write,
    onCite: openSource,
    onUndo: undoStep,
    onRegenerate: regenerate,
    caseStudySlugs: CASE_STUDY_SLUGS,
  };

  /* ---- ask:open from the rest of the site, including before the dock mounted ---- */

  const openFrom = (req: AskOpenRequest) => {
    const scope = validScope(req.scope);
    if (scope) conv.setScope(scope);
    setOpen(true);
    const q = typeof req.question === 'string' ? req.question.trim().slice(0, QUESTION_MAX) : '';
    if (!q) return;
    // The scope goes along explicitly: the send can run before the re-render that sets it.
    if (req.send) later(() => sendRef.current(q, scope ?? undefined), 0);
    else setInput(q);
  };
  const openFromRef = useRef(openFrom);
  useEffect(() => {
    openFromRef.current = openFrom;
  });

  useAppEvent('ask:open', (detail) => openFromRef.current(takePending('ask') ?? detail));
  useEffect(() => {
    const t = window.setTimeout(() => {
      const req = takePending('ask');
      if (req) openFromRef.current(req);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  /* ---- panel behaviour ---- */

  // Newest message in view.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conv.messages.length, typing, open, live, stream.text.length]);

  // Desktop: focus the field on open (fine pointers only, so no keyboard pops up).
  useEffect(() => {
    if (open && !isPhone && finePointer) inputRef.current?.focus({ preventScroll: true });
  }, [open, isPhone, finePointer]);

  // Desktop panel is non-modal: a press anywhere else closes it.
  useEffect(() => {
    if (!open || isPhone) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || launcherRef.current?.contains(t)) return;
      // Presses inside another overlay (a project dialog, a toast) leave the panel alone.
      if ((t as Element).closest?.('[data-dialog-root], [data-toast-region]')) return;
      setOpenState(false);
      onOpenChangeRef.current?.(false);
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, isPhone]);

  // Phone sheet: follow the on-screen keyboard through the visual viewport.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !isPhone || !vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--ask-kb', `${Math.round(kb)}px`);
      root.style.setProperty('--ask-vvh', `${Math.round(vv.height)}px`);
      // A raised keyboard leaves ~300px: ai-concierge.css compacts the sheet so the field stays in view.
      root.toggleAttribute('data-ask-short', vv.height < SHORT_VIEWPORT_PX);
    };
    update();
    vv.addEventListener('resize', update, { passive: true });
    vv.addEventListener('scroll', update, { passive: true });
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--ask-kb');
      root.style.removeProperty('--ask-vvh');
      root.removeAttribute('data-ask-short');
    };
  }, [open, isPhone]);

  // Esc: the first press stops a running answer, the next one closes the panel.
  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (live) stop();
    else close(true);
  };

  // The sheet's Dialog closes on Escape unless the event was handled here first.
  const onSheetKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing || !live) return;
    e.preventDefault();
    stop();
  };

  /* ---- derived view ---- */

  const liveMsg: AiMsg | null = live
    ? {
        id: live.id,
        from: 'bot',
        kind: 'ai',
        question: live.question,
        request: live.request,
        rule: live.rule,
        text: scrubCanary(stream.text),
        status: 'done',
        sources: (stream.meta?.sources ?? []).map((src) => ({ ...src, label: scrubCanary(src.label) })),
        cited: [],
        dropped: 0,
        degraded: false,
        model: '',
        mode: stream.meta?.mode ?? 'lexical',
        cached: false,
        retrieval: [],
        ttftMs: null,
        totalMs: null,
        followUps: [],
        lang: null,
        en: null,
        requestedLang: live.lang,
        step: null,
      }
    : null;

  const last = conv.messages[conv.messages.length - 1];
  const followUps = last && last.from === 'bot' && last.kind === 'ai' ? last.followUps : [];
  const starters = startersFor({
    entries: STARTER_STORE,
    showUnreviewed: SHOW_UNREVIEWED,
    project: openProject,
    section: activeSection,
    fallback: STARTERS,
  });

  const resting = session.streak >= BLOCK_STREAK || Boolean(health && (!health.enabled || !health.configured));
  const status: BodyProps['status'] = resting
    ? { tone: 'resting', label: 'AI is resting; quick answers still work' }
    : session.count > 0 || (health?.enabled && health.configured)
      ? { tone: 'ready', label: 'AI available for open questions' }
      : { tone: 'idle', label: 'Quick answers ready; AI for open questions' };
  const left = Math.max(0, SOFT_CAP - session.count);
  const capNote =
    session.count >= SOFT_CAP - 2
      ? left > 0
        ? `${left} AI ${left === 1 ? 'answer' : 'answers'} left in this visit`
        : 'AI answers are used up for this visit; quick answers still work'
      : null;

  const body = (
    <ChatBody
      ids={ids}
      messages={conv.messages}
      live={liveMsg}
      liveThinking={Boolean(live) && !stream.text}
      liveTool={Boolean(live) && stream.tools.length > 0}
      freshId={freshId}
      typing={typing}
      asked={asked}
      busy={busy}
      input={input}
      setInput={setInput}
      starters={starters}
      followUps={followUps}
      scope={conv.scope}
      onClearScope={() => {
        holdFocus();
        conv.setScope(null);
      }}
      status={status}
      capNote={capNote}
      canHandOff={conv.questions.length >= 2 && !busy && !typing}
      onHandOff={handOffQuestions}
      onSend={send}
      onStop={stop}
      onNewChat={newChat}
      onClose={() => close(true)}
      regenLeft={conv.regenLeft}
      handlers={handlers}
      announcement={announcement}
      spoken={spoken}
      logRef={logRef}
      inputRef={inputRef}
      submitRef={submitRef}
    />
  );

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        aria-label="Ask Oikantik"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !isPhone ? panelId : undefined}
        aria-busy={busy || undefined}
        data-ask-launcher=""
        data-busy={busy ? '' : undefined}
        data-breathe={breathe && !reduce ? '' : undefined}
        onAnimationEnd={() => setBreathe(false)}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={open && !isPhone ? onPanelKeyDown : undefined}
        className="ask-launcher relative grid size-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--app-violet),color-mix(in_oklab,var(--app-violet)_60%,var(--app-violet-bright)))] text-white ring-focus transition-[filter] duration-200 ease-out hover:brightness-110"
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <MessageSquare aria-hidden="true" className="size-5" />}
        {busy && !open ? <span aria-hidden="true" className="ask-launcher-busy" /> : null}
      </button>

      <AnimatePresence>
        {open && !isPhone ? (
          <motion.div
            key="ask-panel"
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-labelledby={ids.title}
            aria-describedby={ids.subtitle}
            data-ask-panel=""
            onKeyDown={onPanelKeyDown}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: duration.base, ease: ease.out },
            }}
            exit={{
              opacity: 0,
              y: 8,
              scale: 0.98,
              transition: { duration: 0.2, ease: ease.in },
            }}
            style={{ transformOrigin: '100% 100%' }}
            className="ask-panel glass-strong glass-keep flex flex-col overflow-clip"
          >
            {body}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Dialog
        open={open && isPhone}
        onClose={() => close(true)}
        variant="sheet"
        labelledBy={ids.title}
        describedBy={ids.subtitle}
        panelClassName="ask-sheet"
      >
        <div data-ask-sheet="" className="h-full" onKeyDown={onSheetKeyDown}>
          {body}
        </div>
      </Dialog>
    </>
  );
}

/** Declarations cost about 500 input tokens, so they go only with a navigation request the rules can't carry out. */
function shouldOfferTools(question: string, rule: AskAnswer): boolean {
  return rule.intent !== 'cv' && wantsNavigation(question);
}
