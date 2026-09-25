'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiFallbackReason, AiSource, AiUsage, AskRequest, AskScope, RetrievalHit } from '@/lib/ai/protocol';
import { safeStorage } from '@/lib/safeStorage';
import { historyFor, type AskAnswer } from '@/utils/askme';

/* ---- the thread ---- */

export type UserMsg = { id: number; from: 'user'; text: string };

/** Why a rule answer is shown where an AI answer was asked for. */
export type RuleNote = 'resting' | 'nothing' | 'unavailable' | 'uncited' | 'cap' | 'stopped';

export type RuleMsg = {
  id: number;
  from: 'bot';
  kind: 'rules';
  text: string;
  /** Absent only on the greeting. */
  answer?: AskAnswer;
  question?: string;
  note?: RuleNote;
  reason?: AiFallbackReason;
  /** The question was not in English; quick answers are. */
  english?: boolean;
};

export type StepChip = {
  label: string;
  undo: Record<string, string | null> | null;
  undone?: boolean;
};

export type AiMsg = {
  id: number;
  from: 'bot';
  kind: 'ai';
  question: string;
  request: AskRequest;
  rule: AskAnswer;
  /** Verified sentences with their [c:id] markers, in the language shown. */
  text: string;
  status: 'done' | 'stopped';
  sources: AiSource[];
  cited: string[];
  dropped: number;
  degraded: boolean;
  model: string;
  mode: 'hybrid' | 'lexical' | 'full';
  cached: boolean;
  retrieval: RetrievalHit[];
  usage?: AiUsage;
  ttftMs: number | null;
  totalMs: number | null;
  followUps: string[];
  /** A whitelisted lang tag when the answer is not English. */
  lang: string | null;
  /** The verified English, when a translation is shown. */
  en: string | null;
  /** The language asked for, when it wasn't English. */
  requestedLang: string | null;
  step?: StepChip | null;
};

export type Msg = UserMsg | RuleMsg | AiMsg;

export const GREETING: RuleMsg = {
  id: 0,
  from: 'bot',
  kind: 'rules',
  text: "Hi, I'm Oikantik's portfolio assistant. Ask about projects, skills, or how to work together.",
};

type Thread = { v: 1; next: number; messages: Msg[]; scope: AskScope | null };

const THREAD_KEY = 'ob-ask-thread';
const REGEN_KEY = 'ob-ask-regen';
const MAX_MESSAGES = 40;
export const REGEN_CAP = 3;

const EMPTY: Thread = { v: 1, next: 1, messages: [GREETING], scope: null };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function validMsg(m: unknown): m is Msg {
  if (!isObj(m) || typeof m.id !== 'number') return false;
  if (m.from === 'user') return typeof m.text === 'string';
  if (m.from !== 'bot') return false;
  if (m.kind === 'rules') return typeof m.text === 'string';
  return (
    m.kind === 'ai' &&
    typeof m.text === 'string' &&
    typeof m.question === 'string' &&
    isObj(m.rule) &&
    Array.isArray(m.sources) &&
    Array.isArray(m.cited)
  );
}

function load(): Thread {
  const raw = safeStorage.get(THREAD_KEY, 'session');
  if (!raw) return EMPTY;
  try {
    const t = JSON.parse(raw) as Partial<Thread>;
    const messages = Array.isArray(t.messages) ? t.messages.filter(validMsg) : [];
    if (!messages.length) return EMPTY;
    const next = Math.max(typeof t.next === 'number' ? t.next : 1, ...messages.map((m) => m.id + 1));
    return {
      v: 1,
      next,
      messages,
      scope: isObj(t.scope) ? (t.scope as AskScope) : null,
    };
  } catch {
    return EMPTY;
  }
}

function readRegen(): number {
  const n = Number(safeStorage.get(REGEN_KEY, 'session'));
  return Number.isFinite(n) && n > 0 ? Math.min(REGEN_CAP, Math.floor(n)) : 0;
}

/* ---- canary-shaped strings never reach the page ---- */

/** The shape of prompts/base.ts newCanary(). A server leak is blocked there; this is the page's own guard. */
export const CANARY_SHAPE = /cnry-[0-9a-f]{16}/i;

export function scrubCanary(s: string): string {
  return s.replace(new RegExp(CANARY_SHAPE.source, 'gi'), '');
}

/* ---- the hook ---- */

export type Conversation = {
  messages: Msg[];
  scope: AskScope | null;
  /** Everything the visitor asked, in order. */
  questions: string[];
  /** Adds a message; returns its id. */
  add: (m: DistributiveOmit<Msg, 'id'>) => number;
  update: (id: number, fn: (m: Msg) => Msg) => void;
  remove: (id: number) => void;
  setScope: (scope: AskScope | null) => void;
  /** Empties the thread (New chat). */
  clear: () => void;
  /** Request context: the prior questions (6, 2000 chars) and the last answer's citations. */
  context: (priorQuestions: readonly string[]) => Pick<AskRequest, 'history' | 'prevCited'>;
  regenLeft: number;
  /** Spends one Regenerate; false once the session's cap is used. */
  takeRegen: () => boolean;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * The concierge thread, kept in the session area so it survives closing the
 * panel, opening projects and navigating back. It holds the visitor's questions
 * and what was shown; requests are built from the questions and the last
 * answer's citation ids only, never from model text.
 */
export function useConversation(): Conversation {
  const [initial] = useState(load);
  const [messages, setMessages] = useState<Msg[]>(initial.messages);
  const [scope, setScopeState] = useState<AskScope | null>(initial.scope);
  const [regenUsed, setRegenUsed] = useState(readRegen);
  const nextId = useRef(initial.next);

  useEffect(() => {
    const kept = messages.slice(-MAX_MESSAGES);
    if (kept.length === 1 && kept[0].id === GREETING.id && !scope) {
      safeStorage.remove(THREAD_KEY, 'session');
      return;
    }
    const thread: Thread = {
      v: 1,
      next: nextId.current,
      messages: kept,
      scope,
    };
    safeStorage.set(THREAD_KEY, JSON.stringify(thread), 'session');
  }, [messages, scope]);

  const add = useCallback((m: DistributiveOmit<Msg, 'id'>) => {
    const id = nextId.current++;
    setMessages((list) => [...list, { ...m, id } as Msg].slice(-MAX_MESSAGES));
    return id;
  }, []);

  const update = useCallback((id: number, fn: (m: Msg) => Msg) => {
    setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  const remove = useCallback((id: number) => {
    setMessages((list) => list.filter((m) => m.id !== id));
  }, []);

  const clear = useCallback(() => {
    setMessages([GREETING]);
    setScopeState(null);
  }, []);

  const questions = messages.filter((m): m is UserMsg => m.from === 'user').map((m) => m.text);

  const context = useCallback(
    (prior: readonly string[]) => {
      const history = historyFor(prior);
      const lastAi = [...messages].reverse().find((m): m is AiMsg => m.from === 'bot' && m.kind === 'ai');
      const prevCited = (lastAi?.cited ?? []).filter((id) => /^[a-z]+:[\w#.-]+$/.test(id)).slice(0, 12);
      return {
        ...(history.length ? { history } : {}),
        ...(prevCited.length ? { prevCited } : {}),
      };
    },
    [messages],
  );

  const takeRegen = useCallback(() => {
    const used = readRegen();
    if (used >= REGEN_CAP) return false;
    safeStorage.set(REGEN_KEY, String(used + 1), 'session');
    setRegenUsed(used + 1);
    return true;
  }, []);

  return {
    messages,
    scope,
    questions,
    add,
    update,
    remove,
    setScope: setScopeState,
    clear,
    context,
    regenLeft: Math.max(0, REGEN_CAP - regenUsed),
    takeRegen,
  };
}
