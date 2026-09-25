'use client';

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check, Sparkles, Square, Undo2 } from 'lucide-react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AIErrorState } from '@/components/ai/AIErrorState';
import { AiThinking } from '@/components/ai/AiThinking';
import { fallbackFromResponse, recordOutcome, sessionGate } from '@/components/ai/useAiStream';
import { Button } from '@/components/ui/Button';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { track } from '@/lib/analytics';
import { AI_CLIENT_TIMEOUT_MS } from '@/lib/ai/config';
import {
  DRAFT_COUNT_KEY,
  DRAFT_LENGTHS,
  DRAFT_LENGTH_IDS,
  DRAFT_SESSION_CAP,
  DRAFT_TONES,
  NOTES_MAX,
  fitDraft,
  splitSubject,
  templateDraft,
  type DraftIntent,
  type DraftLength,
  type DraftRequest,
  type DraftTone,
} from '@/lib/ai/draft';
import type { AiFallbackReason, AiFrame } from '@/lib/ai/protocol';
import { createNdjsonDecoder } from '@/lib/ai/stream';
import { duration, ease } from '@/lib/motion';
import { safeStorage } from '@/lib/safeStorage';
import { cn } from '@/utils/cn';

const ENDPOINT = '/api/ai/draft';
const UNDO_MAX = 10;

export type DraftFields = { message: string; subject: string | null };

type Phase =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  | { kind: 'streaming' }
  | { kind: 'stopped' }
  | { kind: 'done'; source: 'ai' | 'template'; model?: string; dropped: number }
  | { kind: 'fallback'; reason: AiFallbackReason; retryAfterSec?: number };

function draftsUsed(): number {
  const n = Number(safeStorage.get(DRAFT_COUNT_KEY, 'session'));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

const FIELD =
  'w-full rounded-xl border border-glass-border-strong bg-glass-fill px-4 py-3 text-base text-text-primary ring-focus transition-colors placeholder:text-text-muted hover:border-violet-bright/50 focus:border-violet-bright';
const SUBLABEL = 'text-sm font-medium leading-6 text-text-secondary';

/**
 * A tone or length chip. `inactive` (while a draft streams) is aria-disabled rather
 * than disabled, so a chip pressed to regenerate keeps focus instead of dropping it
 * to <body>; its clicks are ignored meanwhile.
 */
function Chip({
  pressed,
  inactive = false,
  className,
  children,
  onClick,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean; inactive?: boolean }) {
  return (
    <button
      {...rest}
      type="button"
      aria-pressed={pressed}
      aria-disabled={inactive || undefined}
      onClick={inactive ? undefined : onClick}
      className={cn(
        'tap-safe gap-2 rounded-full border px-4 text-sm ring-focus transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
        pressed
          ? 'border-violet-bright bg-violet text-white'
          : 'border-glass-border bg-glass-fill text-text-secondary hover:border-glass-border-strong hover:text-text-primary',
        className,
      )}
    >
      {pressed ? <Check aria-hidden="true" className="size-3.5" /> : null}
      {children}
    </button>
  );
}

type Props = {
  /** The message field's current value. */
  message: string;
  /** The form's current subject (null or empty when the visitor has none). */
  subject: string | null;
  /** The form's topic chip, or null when none is picked. */
  intent: Exclude<DraftIntent, 'general'> | null;
  intentLabel: string | null;
  /** Writes through the form's own update path, so draft autosave keeps working. */
  onApply: (fields: DraftFields) => void;
  /** True while a draft streams in; the form keeps the message field read-only meanwhile. */
  onBusyChange?: (busy: boolean) => void;
  focusMessage?: () => void;
  /** Extra controls for the toolbar row, such as dictation. */
  tools?: ReactNode;
  className?: string;
};

/**
 * "Help me write this" (#231, #232): the visitor jots up to 300 characters of
 * notes, picks a tone and a length, and a draft streams into the message field
 * one checked sentence at a time. It replaces the field's text, keeps an Undo
 * stack of what was there before each insert, never sends anything, and allows
 * DRAFT_SESSION_CAP drafts per tab. Tone and length chips regenerate an existing
 * draft. When the AI can't answer, a fill-in-the-brackets template stands in.
 */
export function DraftHelper({ message, subject, intent, intentLabel, onApply, onBusyChange, focusMessage, tools, className }: Props) {
  const ids = useId();
  const panelId = `${ids}-panel`;
  const notesId = `${ids}-notes`;
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [tone, setTone] = useState<DraftTone>('warm');
  const [length, setLength] = useState<DraftLength>('note');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [undo, setUndo] = useState<DraftFields[]>([]);
  const [used, setUsed] = useState(0);
  const [said, setSaid] = useState('');
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const runRef = useRef<HTMLElement>(null);
  const { finePointer } = useMotionPrefs();
  const controller = useRef<AbortController | null>(null);
  const runId = useRef(0);
  // Async stream code reads the newest props through this, never a stale render's.
  const latest = useRef({ onApply, onBusyChange });
  useEffect(() => {
    latest.current = { onApply, onBusyChange };
  });
  useEffect(
    () => () => {
      runId.current += 1;
      controller.current?.abort('unmount');
    },
    [],
  );

  const busy = phase.kind === 'waiting' || phase.kind === 'streaming';
  const capReached = used >= DRAFT_SESSION_CAP;
  const topic: DraftIntent = intent ?? 'general';

  const remember = (before: DraftFields) => setUndo((u) => [...u.slice(-(UNDO_MAX - 1)), before]);

  /**
   * Call before a change that removes or disables the focused control in the panel
   * (Try again and the template buttons go with their fallback; the run button rests
   * once the visit's last draft is spent), or focus falls to <body>. Focus goes to
   * `to`, else to the notes under a fine pointer and the panel under a coarse one,
   * so no on-screen keyboard rises.
   */
  const holdFocus = (to?: HTMLElement | null) => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === notesRef.current || !panelRef.current?.contains(el)) return;
    const target = to ?? (finePointer ? notesRef.current : panelRef.current);
    if (target && target !== el) target.focus({ preventScroll: true });
  };
  /** The run button is about to come back disabled: move focus off it if it has it. */
  const releaseRun = () => {
    if (document.activeElement === runRef.current) holdFocus();
  };

  const stream = async (body: DraftRequest, before: DraftFields) => {
    runId.current += 1;
    const id = runId.current;
    controller.current?.abort('superseded');
    controller.current = null;
    const live = () => runId.current === id;
    setSaid('');

    const gated = sessionGate('draft');
    if (gated) {
      setPhase({ kind: 'fallback', reason: gated.reason });
      return;
    }
    const count = draftsUsed() + 1;
    safeStorage.set(DRAFT_COUNT_KEY, String(count), 'session');
    setUsed(count);
    // Stop turns back into a disabled Write draft when this run settles.
    const lastDraft = count >= DRAFT_SESSION_CAP;

    const ac = new AbortController();
    controller.current = ac;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      ac.abort('timeout');
    }, AI_CLIENT_TIMEOUT_MS);
    // The visitor's subject wins; a draft's subject line only fills an empty one.
    const subjectFree = !before.subject?.trim();
    let raw = '';
    let inserted = false;
    let model: string | undefined;
    setPhase({ kind: 'waiting' });
    latest.current.onBusyChange?.(true);

    const show = (final: boolean) => {
      const split = splitSubject(raw, final);
      const text = fitDraft(final ? split.body.trimEnd() : split.body, body.length);
      if (!text) return;
      if (!inserted) {
        inserted = true;
        remember(before);
        setPhase({ kind: 'streaming' });
      }
      latest.current.onApply({ message: text, subject: subjectFree && split.subject ? split.subject : before.subject });
    };
    const settle = (outcome: { ok: true } | { ok: false; reason: AiFallbackReason }) => {
      window.clearTimeout(timer);
      if (controller.current === ac) controller.current = null;
      latest.current.onBusyChange?.(false);
      recordOutcome('draft', outcome);
    };
    // A draft that fails partway is taken back out: no half message is left behind.
    const fail = (reason: AiFallbackReason, retryAfterSec?: number) => {
      if (!live()) return;
      if (inserted) {
        latest.current.onApply(before);
        setUndo((u) => u.slice(0, -1));
      }
      if (lastDraft) releaseRun();
      setPhase(retryAfterSec ? { kind: 'fallback', reason, retryAfterSec } : { kind: 'fallback', reason });
      settle({ ok: false, reason });
    };

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
        cache: 'no-store',
      });
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !type.includes('ndjson') || !res.body) {
        const fb = await fallbackFromResponse(res);
        fail(fb.reason, fb.retryAfterSec);
        return;
      }
      const decoder = createNdjsonDecoder();
      const reader = res.body.getReader();
      let ended = false;
      let dropped = 0;
      let error: AiFallbackReason | null = null;
      const handle = (frames: AiFrame[]) => {
        for (const f of frames) {
          if (ended || error) return;
          if (f.type === 'meta') model = f.model;
          else if (f.type === 'delta') {
            raw += f.text;
            show(false);
          } else if (f.type === 'done') {
            ended = true;
            dropped = f.dropped;
          } else if (f.type === 'error') error = f.reason;
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (!live()) {
          void reader.cancel().catch(() => {});
          return;
        }
        if (done) break;
        if (value) handle(decoder.push(value));
        if (ended || error) break;
      }
      if (!ended && !error) handle(decoder.end());
      void reader.cancel().catch(() => {});
      if (!live()) return;
      if (error) return fail(error);
      if (!ended) return fail('upstream');
      show(true);
      if (!inserted) return fail('unverified');
      if (lastDraft) releaseRun();
      setPhase({ kind: 'done', source: 'ai', model, dropped });
      setSaid('Draft added to your message. Fill in anything in [brackets] before you send.');
      track('ai_draft_insert', { feature: 'draft', intent: body.intent });
      settle({ ok: true });
    } catch {
      fail(timedOut ? 'timeout' : 'upstream');
    } finally {
      window.clearTimeout(timer);
    }
  };

  const generate = (over: { tone?: DraftTone; length?: DraftLength } = {}) => {
    if (draftsUsed() >= DRAFT_SESSION_CAP) {
      releaseRun();
      setUsed(draftsUsed());
      return;
    }
    const body: DraftRequest = {
      mode: 'draft',
      notes: notes.trim().slice(0, NOTES_MAX),
      intent: topic,
      tone: over.tone ?? tone,
      length: over.length ?? length,
    };
    void stream(body, { message, subject });
  };

  const insertTemplate = (over: { tone?: DraftTone; length?: DraftLength } = {}) => {
    const before = { message, subject };
    const text = templateDraft({ notes, intent: topic, tone: over.tone ?? tone, length: over.length ?? length });
    const split = splitSubject(text, true);
    remember(before);
    onApply({ message: split.body, subject: !before.subject?.trim() && split.subject ? split.subject : before.subject });
    setPhase({ kind: 'done', source: 'template', dropped: 0 });
    setSaid('Template added to your message. Replace the [brackets] with your details.');
  };

  /** A template button goes with the fallback it sits in; its [brackets] wait in the message. */
  const pickTemplate = () => {
    const el = document.activeElement;
    if (finePointer && focusMessage && el instanceof HTMLElement && panelRef.current?.contains(el)) focusMessage();
    else holdFocus();
    insertTemplate();
  };

  const stop = () => {
    if (capReached) releaseRun();
    runId.current += 1;
    controller.current?.abort('stop');
    controller.current = null;
    onBusyChange?.(false);
    setPhase({ kind: 'stopped' });
    setSaid('Stopped. What was written so far is in your message.');
  };

  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    if (busy) {
      runId.current += 1;
      controller.current?.abort('undo');
      controller.current = null;
      onBusyChange?.(false);
    }
    onApply(last);
    setUndo(undo.slice(0, -1));
    setPhase({ kind: 'idle' });
    setSaid('Draft undone. Your earlier text is back.');
    // The Undo button goes with the last entry, so focus moves to the message.
    if (undo.length === 1) focusMessage?.();
  };

  // A tone or length change rewrites a draft that is already there.
  const regenerate = (over: { tone?: DraftTone; length?: DraftLength }) => {
    if (phase.kind !== 'done' || busy) return;
    if (phase.source === 'template') insertTemplate(over);
    else if (!capReached) generate(over);
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setUsed(draftsUsed());
    requestAnimationFrame(() => notesRef.current?.focus());
  };

  const left = Math.max(0, DRAFT_SESSION_CAP - used);
  const limit = DRAFT_LENGTHS[length].maxChars;
  const showCount = phase.kind === 'streaming' || phase.kind === 'done' || phase.kind === 'stopped';

  return (
    <div className={cn('mt-3', className)} data-ai-draft="">
      <div className="flex flex-wrap items-center gap-2">
        <AIButton
          variant="ghost"
          size="md"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
          data-draft-toggle=""
        >
          Help me write this
        </AIButton>
        {tools}
      </div>

      {open ? (
        <motion.div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label="Help me write this"
          // Focus lands here when a pressed control goes away and a coarse pointer rules out the notes.
          tabIndex={-1}
          data-draft-panel=""
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: duration.base, ease: ease.out }}
          className="ai-draft-panel mt-3 space-y-4 rounded-2xl border border-hairline bg-surface-tint p-4 ring-focus sm:p-6"
        >
          <div>
            <div className="flex items-baseline justify-between gap-4">
              <label htmlFor={notesId} className={SUBLABEL}>
                Your notes
              </label>
              <span className="font-mono text-xs tabular-nums text-text-muted" data-draft-notes-count="">
                {notes.length} / {NOTES_MAX}
              </span>
            </div>
            <textarea
              ref={notesRef}
              id={notesId}
              name="draft-notes"
              rows={2}
              maxLength={NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy && !capReached) {
                  e.preventDefault();
                  generate();
                }
              }}
              aria-describedby={`${ids}-topic`}
              placeholder="e.g. hiring an LLM engineer, remote, keen to talk next week"
              className={cn(FIELD, 'mt-2 min-h-20 resize-y')}
              data-draft-notes=""
            />
            <p id={`${ids}-topic`} className="mt-2 text-xs leading-5 text-text-muted">
              Topic: {intentLabel ?? 'general'}
              {intentLabel ? null : ' (pick one at the top of the form to focus the draft)'}
            </p>
          </div>

          <div role="group" aria-labelledby={`${ids}-tone`}>
            <p id={`${ids}-tone`} className={SUBLABEL}>
              Tone
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DRAFT_TONES.map((t) => (
                <Chip
                  key={t.id}
                  pressed={tone === t.id}
                  inactive={busy}
                  data-draft-tone={t.id}
                  onClick={() => {
                    if (t.id === tone) return;
                    setTone(t.id);
                    regenerate({ tone: t.id });
                  }}
                >
                  {t.label}
                </Chip>
              ))}
            </div>
          </div>

          <div role="group" aria-labelledby={`${ids}-length`}>
            <p id={`${ids}-length`} className={SUBLABEL}>
              Length
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {DRAFT_LENGTH_IDS.map((id) => (
                <Chip
                  key={id}
                  pressed={length === id}
                  inactive={busy}
                  data-draft-length={id}
                  onClick={() => {
                    if (id === length) return;
                    setLength(id);
                    regenerate({ length: id });
                  }}
                >
                  {DRAFT_LENGTHS[id].label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              {/* One node for Write draft and Stop, so a focused button survives the swap. It
                  carries AIButton's sparkle and data-ai-button only while it sends notes. */}
              <Button
                ref={runRef}
                variant={busy ? 'secondary' : 'primary'}
                size="md"
                disabled={!busy && capReached}
                onClick={busy ? stop : () => generate()}
                leadingIcon={
                  busy ? <Square aria-hidden="true" className="size-3.5 fill-current" /> : <Sparkles aria-hidden="true" className="size-4 shrink-0" />
                }
                data-ai-button={busy ? undefined : ''}
                data-draft-stop={busy ? '' : undefined}
                data-draft-generate={busy ? undefined : ''}
              >
                {busy ? 'Stop' : phase.kind === 'done' && phase.source === 'ai' ? 'Rewrite draft' : 'Write draft'}
              </Button>
              {undo.length ? (
                <Button variant="ghost" size="md" onClick={undoLast} leadingIcon={<Undo2 aria-hidden="true" className="size-4" />} data-draft-undo="">
                  Undo
                </Button>
              ) : null}
              {showCount ? (
                <span className={cn('ml-auto font-mono text-xs tabular-nums', message.length > limit ? 'text-danger' : 'text-text-muted')} data-draft-count="">
                  {message.length.toLocaleString('en-US')} / {limit.toLocaleString('en-US')}
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-5 text-text-muted" data-draft-privacy="">
              Your notes are sent to Google Gemini to draft this.
            </p>
            <p className="text-xs leading-5 text-text-muted" data-draft-left="">
              {capReached
                ? `You've used this visit's ${DRAFT_SESSION_CAP} AI drafts.`
                : `${left} of ${DRAFT_SESSION_CAP} AI drafts left this visit. Nothing is sent until you press Send.`}
            </p>
          </div>

          {phase.kind === 'waiting' ? <AiThinking step="Drafting…" /> : null}

          {phase.kind === 'fallback' ? (
            <AIErrorState
              reason={phase.reason}
              retryAfterSec={phase.retryAfterSec}
              onRetry={
                capReached
                  ? undefined
                  : () => {
                      // Try again goes with this fallback; the run button turns into Stop and takes the focus.
                      holdFocus(runRef.current);
                      generate();
                    }
              }
            >
              <Button variant="secondary" size="md" onClick={pickTemplate} data-draft-template="">
                Use a template instead
              </Button>
            </AIErrorState>
          ) : capReached && phase.kind !== 'done' && !busy ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm leading-6 text-text-secondary">A template still works, or write it your way.</p>
              <Button variant="secondary" size="md" onClick={pickTemplate} data-draft-template="">
                Use a template
              </Button>
            </div>
          ) : null}

          {phase.kind === 'done' && phase.source === 'ai' ? (
            <AIDisclosure
              model={phase.model}
              note={
                phase.dropped
                  ? `${phase.dropped} ${phase.dropped === 1 ? 'sentence was' : 'sentences were'} left out because the site can't back them up. Read it through before you send.`
                  : 'It is your message: read it through before you send.'
              }
            />
          ) : null}
          {phase.kind === 'done' && phase.source === 'template' ? (
            <p className="text-xs leading-5 text-text-muted" data-draft-source="template">
              A template, not AI: replace the [brackets] with your details.
            </p>
          ) : null}
        </motion.div>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite" data-draft-status="">
        {said}
      </p>
    </div>
  );
}
