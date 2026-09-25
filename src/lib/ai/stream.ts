import type { AiFallback, AiFallbackReason, AiFrame, AiSource, AiToolCall } from './protocol.ts';

/*
 * Client side of the NDJSON wire format: one JSON frame per line. Parsing is
 * defensive (the network can cut a frame anywhere, and a malformed line must not
 * kill the answer), and the reducer is the whole state machine behind useAiStream.
 */

export type MetaFrame = Extract<AiFrame, { type: 'meta' }>;
export type DeltaFrame = Extract<AiFrame, { type: 'delta' }>;
export type ToolFrame = Extract<AiFrame, { type: 'tool' }>;
export type DoneFrame = Extract<AiFrame, { type: 'done' }>;
export type ErrorFrame = Extract<AiFrame, { type: 'error' }>;

// A Record, not an array, so tsc fails here when protocol.ts gains a reason.
const REASONS: Record<AiFallbackReason, true> = {
  disabled: true,
  'no-key': true,
  'feature-off': true,
  'rate-limited': true,
  bot: true,
  origin: true,
  'bad-request': true,
  'too-long': true,
  quota: true,
  upstream: true,
  timeout: true,
  safety: true,
  unverified: true,
  'low-relevance': true,
};

export function isFallbackReason(x: unknown): x is AiFallbackReason {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(REASONS, x);
}

/** An unknown reason from a newer server still means "no answer": treat it as upstream. */
export function toFallbackReason(x: unknown): AiFallbackReason {
  return isFallbackReason(x) ? x : 'upstream';
}

/** The always-200 JSON body every AI route answers with when it can't answer. */
export function isFallbackBody(x: unknown): x is AiFallback {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.mode !== 'fallback' || !isFallbackReason(o.reason)) return false;
  return o.retryAfterSec === undefined || (typeof o.retryAfterSec === 'number' && o.retryAfterSec >= 0);
}

/* ---- frame validation ---- */

const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function asSource(x: unknown): AiSource | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.label) || !isStr(x.cls) || !isObj(x.target)) return null;
  return x as unknown as AiSource;
}

/** One parsed line to a typed frame, or null when it isn't a frame this client understands. */
export function asFrame(x: unknown): AiFrame | null {
  if (!isObj(x)) return null;
  switch (x.type) {
    case 'meta': {
      if (!isStr(x.model) || !isStr(x.feature) || !Array.isArray(x.sources)) return null;
      const mode = x.mode === 'hybrid' || x.mode === 'lexical' || x.mode === 'full' ? x.mode : 'lexical';
      const sources = x.sources.map(asSource).filter((s): s is AiSource => s !== null);
      return { ...(x as unknown as MetaFrame), mode, sources };
    }
    case 'delta':
      return isStr(x.text) ? { type: 'delta', text: x.text } : null;
    case 'tool': {
      const call = x.call;
      if (!isObj(call) || !isStr(call.name) || !isObj(call.args)) return null;
      return { type: 'tool', call: { name: call.name, args: call.args } as AiToolCall };
    }
    case 'done': {
      const cited = Array.isArray(x.cited) ? x.cited.filter(isStr) : [];
      const followUps = Array.isArray(x.followUps) ? x.followUps.filter(isStr) : undefined;
      return {
        ...(x as unknown as DoneFrame),
        finishReason: isStr(x.finishReason) ? x.finishReason : 'STOP',
        cited,
        dropped: isNum(x.dropped) ? x.dropped : 0,
        degraded: x.degraded === true,
        ...(followUps ? { followUps } : {}),
      };
    }
    case 'error':
      return { type: 'error', reason: toFallbackReason(x.reason) };
    default:
      return null;
  }
}

/* ---- NDJSON ---- */

// A line this long is not a frame this site sends; dropping it bounds memory.
const MAX_CARRY = 256 * 1024;

/**
 * Splits decoded text into frames. `carry` is the unterminated tail from the
 * previous call; pass the returned carry to the next one. At the end of the
 * stream call parseNdjson('\n', carry) so a final line without a newline counts.
 * Blank lines, CRLF endings and malformed lines are skipped (counted in `bad`).
 */
export function parseNdjson(chunk: string, carry: string): { frames: AiFrame[]; carry: string; bad: number } {
  const lines = (carry + chunk).split('\n');
  let rest = lines.pop() ?? '';
  const frames: AiFrame[] = [];
  let bad = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      bad += 1;
      continue;
    }
    const frame = asFrame(parsed);
    if (frame) frames.push(frame);
    else bad += 1;
  }
  if (rest.length > MAX_CARRY) {
    rest = '';
    bad += 1;
  }
  return { frames, carry: rest, bad };
}

/**
 * Byte-level wrapper: a streaming TextDecoder keeps a multi-byte character that
 * straddles two network chunks intact before the text reaches parseNdjson.
 */
export function createNdjsonDecoder(): { push(bytes: Uint8Array): AiFrame[]; end(): AiFrame[] } {
  const decoder = new TextDecoder();
  let carry = '';
  return {
    push(bytes) {
      const r = parseNdjson(decoder.decode(bytes, { stream: true }), carry);
      carry = r.carry;
      return r.frames;
    },
    end() {
      const r = parseNdjson(`${decoder.decode()}\n`, carry);
      carry = '';
      return r.frames;
    },
  };
}

/* ---- the useAiStream state machine ---- */

export type AiStreamStatus = 'idle' | 'submitted' | 'streaming' | 'done' | 'fallback' | 'stopped';

export type AiStreamState = {
  status: AiStreamStatus;
  /** Verified sentences so far, citation markers included. */
  text: string;
  meta: MetaFrame | null;
  done: DoneFrame | null;
  tools: AiToolCall[];
  fallback: AiFallback | null;
  /** performance.now() at start(). */
  startedAt: number | null;
  /** Start to the first verified sentence. */
  ttftMs: number | null;
  /** Start to done, fallback or stop. */
  totalMs: number | null;
};

export type AiStreamEvent =
  | { type: 'start'; at: number }
  /** A batch of frames; `at` is when the first of them arrived. */
  | { type: 'frames'; frames: AiFrame[]; at: number }
  | { type: 'fallback'; fallback: AiFallback; at: number }
  | { type: 'stop'; at: number }
  /** The body ended. Without a done frame first, the answer was cut short. */
  | { type: 'end'; at: number }
  | { type: 'reset' };

export const initialStreamState: AiStreamState = Object.freeze({
  status: 'idle',
  text: '',
  meta: null,
  done: null,
  tools: [],
  fallback: null,
  startedAt: null,
  ttftMs: null,
  totalMs: null,
}) as AiStreamState;

export function isTerminal(status: AiStreamStatus): boolean {
  return status === 'done' || status === 'fallback' || status === 'stopped';
}

const isRunning = (s: AiStreamState) => s.status === 'submitted' || s.status === 'streaming';

function elapsed(s: AiStreamState, at: number): number | null {
  return s.startedAt === null ? null : Math.max(0, Math.round(at - s.startedAt));
}

function applyFrame(s: AiStreamState, f: AiFrame, at: number): AiStreamState {
  switch (f.type) {
    case 'meta':
      return { ...s, status: 'streaming', meta: f };
    case 'delta':
      return {
        ...s,
        status: 'streaming',
        text: s.text + f.text,
        ttftMs: s.ttftMs ?? (f.text ? elapsed(s, at) : null),
      };
    case 'tool':
      return { ...s, status: 'streaming', tools: [...s.tools, f.call] };
    case 'done':
      return { ...s, status: 'done', done: f, totalMs: elapsed(s, at) };
    case 'error':
      return { ...s, status: 'fallback', fallback: { mode: 'fallback', reason: f.reason }, totalMs: elapsed(s, at) };
  }
}

export function streamReducer(state: AiStreamState, event: AiStreamEvent): AiStreamState {
  switch (event.type) {
    case 'reset':
      return initialStreamState;
    case 'start':
      return { ...initialStreamState, status: 'submitted', startedAt: event.at };
    case 'frames': {
      let s = state;
      for (const f of event.frames) {
        // Anything after done, an error frame or Stop belongs to an answer that is over.
        if (!isRunning(s)) break;
        s = applyFrame(s, f, event.at);
      }
      return s;
    }
    case 'fallback':
      if (!isRunning(state)) return state;
      return { ...state, status: 'fallback', fallback: event.fallback, totalMs: elapsed(state, event.at) };
    case 'stop':
      if (!isRunning(state)) return state;
      return { ...state, status: 'stopped', totalMs: elapsed(state, event.at) };
    case 'end':
      if (!isRunning(state)) return state;
      return {
        ...state,
        status: 'fallback',
        fallback: { mode: 'fallback', reason: 'upstream' },
        totalMs: elapsed(state, event.at),
      };
  }
}
