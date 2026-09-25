'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight, MessageSquare, PenLine, Send, Sparkles, X } from 'lucide-react';
import profile from '@/data/profile.json';
import projects from '@/data/projects.json';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { emit } from '@/lib/events';
import { duration, ease } from '@/lib/motion';
import { slugify } from '@/lib/slug';
import { answer as ask, isMultiSentence, STARTERS, type AskAnswer, type AskData } from '@/utils/askme';

type Msg = { id: number; from: 'bot' | 'user'; text: string; answer?: AskAnswer };
type Project = (typeof projects)[number];

const DATA: AskData = { profile, projects };
const BY_SLUG = new Map<string, Project>(projects.map((p) => [slugify(p.name), p]));

const GREETING: Msg = {
  id: 0,
  from: 'bot',
  text: "Hi, I'm Oikantik's portfolio assistant. Ask about projects, skills, or how to work together.",
};

const Q_PHONE = '(max-width: 639.98px)';
// Chips and links inside answers: 36px under a mouse, 44px on touch (tap-safe-sm).
const CHIP =
  'tap-safe-sm inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-fill px-3 text-xs font-medium text-text-secondary ring-focus transition-colors hover:border-glass-border-strong hover:text-text-primary';

function renderInline(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block">
      {line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
        j % 2 === 1 ? (
          <strong key={j} className="font-semibold text-text-primary">
            {part}
          </strong>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </span>
  ));
}

function MiniProject({ slug, onShow }: { slug: string; onShow: (slug: string) => void }) {
  const p = BY_SLUG.get(slug);
  const [imgOk, setImgOk] = useState(true);
  if (!p) return null;
  return (
    <div data-ask-project={slug} className="flex gap-3 rounded-xl border border-glass-border bg-glass-fill p-2">
      {imgOk && p.thumbnail ? (
        // Thumbnails are a mix of local and GitHub-hosted files, shown at 64px; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.thumbnail}
          alt=""
          width={64}
          height={48}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="h-12 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span aria-hidden="true" className="h-12 w-16 shrink-0 rounded-lg bg-heat-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-5 text-text-primary">{p.name}</p>
        <p className="line-clamp-2 text-xs leading-4 text-text-muted">{p.tagline}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onShow(slug)} className={CHIP} data-cursor="open">
            Show in Projects
          </button>
          {p.liveUrl ? (
            <a href={p.liveUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
              Live
              <ArrowUpRight aria-hidden="true" className="size-3" />
              <span className="sr-only"> demo of {p.name} (opens in new tab)</span>
            </a>
          ) : null}
          <a href={p.githubUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
            Code
            <ArrowUpRight aria-hidden="true" className="size-3" />
            <span className="sr-only"> of {p.name} on GitHub (opens in new tab)</span>
          </a>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  msg,
  onShowProject,
  onWrite,
}: {
  msg: Msg;
  onShowProject: (slug: string) => void;
  onWrite: (draft: string) => void;
}) {
  const a = msg.answer;
  const draft = a?.handoff;
  if (msg.from === 'user') {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-violet px-3.5 py-2.5 text-sm leading-relaxed text-white">
          <span className="sr-only">You: </span>
          {msg.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex justify-start" data-ask-answer={a?.intent ?? 'greeting'}>
      <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-glass-border bg-surface-tint px-3.5 py-2.5 text-sm leading-relaxed text-text-secondary">
        <div>{renderInline(msg.text)}</div>
        {a && a.projects.length > 0 ? (
          <div className="mt-2.5 grid gap-2">
            {a.projects.map((slug) => (
              <MiniProject key={slug} slug={slug} onShow={onShowProject} />
            ))}
          </div>
        ) : null}
        {a && (a.actions.length > 0 || draft) ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {a.actions.map((act) =>
              act.kind === 'cv' ? (
                <DownloadCvButton key="cv" variant="secondary" size="sm" />
              ) : (
                <Button key={act.href} href={act.href} external={act.external} variant="secondary" size="sm" cursor="open">
                  {act.label}
                </Button>
              ),
            )}
            {draft ? (
              <Button
                variant="primary"
                size="sm"
                shine={false}
                leadingIcon={<PenLine aria-hidden="true" className="size-3.5" />}
                onClick={() => onWrite(draft)}
                data-ask-handoff=""
              >
                Write to Oikantik
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

type BodyProps = {
  ids: { title: string; subtitle: string; input: string };
  messages: Msg[];
  typing: boolean;
  asked: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: (q: string) => void;
  onClose: () => void;
  onShowProject: (slug: string) => void;
  onWrite: (draft: string) => void;
  logRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
};

function ChatBody({ ids, messages, typing, asked, input, setInput, onSend, onClose, onShowProject, onWrite, logRef, inputRef }: BodyProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSend(input);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--app-violet),var(--app-cyan))] text-white">
          <Sparkles aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={ids.title} className="font-display text-base font-semibold leading-6 tracking-normal text-text-primary">
            Ask Oikantik
          </h2>
          <p id={ids.subtitle} className="text-xs leading-4 text-text-muted" data-ask-subtitle="">
            Quick answers from this site&apos;s data (not an LLM)
          </p>
        </div>
        <Button variant="icon" size="md" aria-label="Close assistant" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation"
        data-lenis-prevent=""
        data-ask-log=""
        className="ask-log min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} onShowProject={onShowProject} onWrite={onWrite} />
        ))}
        {typing ? (
          <div aria-hidden="true" className="flex justify-start" data-ask-typing="">
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
      </div>

      {!asked ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3" data-ask-starters="">
          {STARTERS.map((s) => (
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
          maxLength={200}
          className="tap-safe min-w-0 flex-1 rounded-full border border-glass-border-strong bg-glass-fill px-4 text-base text-text-primary ring-focus placeholder:text-text-muted"
        />
        <Button type="submit" variant="primary" size="md" shine={false} aria-label="Send" disabled={!input.trim()} className="w-11 px-0">
          <Send aria-hidden="true" className="size-4" />
        </Button>
      </form>
    </div>
  );
}

/**
 * The site's quick-answer assistant: a launcher in the floating dock that opens a
 * non-modal panel above it, or a modal bottom sheet below 640px. Answers come from
 * src/utils/askme.ts (rule-based, from this site's own data); project answers
 * carry mini cards, and hire or project answers can hand a draft to the contact form.
 */
export function AskMeBot({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
  const { reduce, finePointer } = useMotionPrefs();
  const isPhone = useMediaQuery(Q_PHONE);
  const [open, setOpenState] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState('');
  const [breathe, setBreathe] = useState(true);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef(new Set<number>());
  const nextId = useRef(1);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  const baseId = useId();
  const ids = { title: `${baseId}-title`, subtitle: `${baseId}-subtitle`, input: `${baseId}-input` };
  const panelId = `${baseId}-panel`;
  const asked = messages.some((m) => m.from === 'user');

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  };

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);

  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (v) setBreathe(false);
    onOpenChangeRef.current?.(v);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) requestAnimationFrame(() => launcherRef.current?.focus({ preventScroll: true }));
  };

  const push = (m: Omit<Msg, 'id'>) => setMessages((list) => [...list, { ...m, id: nextId.current++ }]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || typing) return;
    const a = ask(q, DATA);
    push({ from: 'user', text: q });
    setInput('');
    const reply = { from: 'bot' as const, text: a.text, answer: a };
    // A short beat of "typing" before longer answers only; none under reduced motion.
    if (!reduce && isMultiSentence(a.text)) {
      setTyping(true);
      later(() => {
        setTyping(false);
        push(reply);
      }, 300 + Math.min(150, a.text.length));
    } else {
      push(reply);
    }
  };

  const showProject = (slug: string) => {
    close(false);
    later(() => emit('project:open', { slug }), 60);
  };

  // After the sheet's focus trap has let go, so the contact form can take focus.
  const write = (draft: string) => {
    close(false);
    later(() => emit('contact:prefill', { message: draft }), 60);
  };

  // Newest message in view.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length, typing, open]);

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
      setOpen(false);
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
    };
    update();
    vv.addEventListener('resize', update, { passive: true });
    vv.addEventListener('scroll', update, { passive: true });
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--ask-kb');
      root.style.removeProperty('--ask-vvh');
    };
  }, [open, isPhone]);

  const onPanelKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };

  const body = (
    <ChatBody
      ids={ids}
      messages={messages}
      typing={typing}
      asked={asked}
      input={input}
      setInput={setInput}
      onSend={send}
      onClose={() => close(true)}
      onShowProject={showProject}
      onWrite={write}
      logRef={logRef}
      inputRef={inputRef}
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
        data-ask-launcher=""
        data-breathe={breathe && !reduce ? '' : undefined}
        onAnimationEnd={() => setBreathe(false)}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={open && !isPhone ? onPanelKeyDown : undefined}
        className="ask-launcher grid size-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--app-violet),color-mix(in_oklab,var(--app-violet)_60%,var(--app-violet-bright)))] text-white ring-focus transition-[filter] duration-200 ease-out hover:brightness-110"
      >
        {open ? <X aria-hidden="true" className="size-5" /> : <MessageSquare aria-hidden="true" className="size-5" />}
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
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: duration.base, ease: ease.out } }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.2, ease: ease.in } }}
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
        <div data-ask-sheet="" className="h-full">
          {body}
        </div>
      </Dialog>
    </>
  );
}
