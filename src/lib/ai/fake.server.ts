import 'server-only';
import { AI_MODELS } from './config.server';
import type { AiFakeStats } from './protocol';

/*
 * The deterministic fake model behind AI_FAKE_MODEL=1 (never on Vercel). It mimics
 * the three SDK calls the app makes, so Playwright drives the real guard,
 * retrieval, packing, sentence filter and NDJSON path through `next start` with
 * no key. It has no network access of any kind.
 *
 * Marker strings anywhere in the request contents pick an adversarial fixture:
 *   __canary_split   leaks the system prompt's canary, split across two chunks
 *   __md_split       a markdown link split across chunks
 *   __foreign_email  a plain-text email that is not on the site
 *   __uncited_cert   an uncited 'AWS certified' sentence
 *   __429            a 429 (RetryInfo 5s) from the primary model only
 *   __503            a 503 from the primary model only
 *   __safety         a prompt blocked for SAFETY
 *   __slow           60 chunks, 250ms apart, for client-abort tests
 *   __timeout        never answers, so the request deadline fires
 *   __tool           a call to the first declared function
 * Structured calls (responseJsonSchema) get a minimal instance of the schema.
 */

export const FAKE_RETRY_DELAY = '5s';
const CHUNK_DELAY_MS = 8;
const SLOW_CHUNKS = 60;
const SLOW_DELAY_MS = 250;

type FakePart = {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args: Record<string, unknown> };
};

type FakeCandidate = { content: { role: 'model'; parts: FakePart[] }; finishReason?: string; index: 0 };

type FakeUsage = { promptTokenCount: number; candidatesTokenCount: number; thoughtsTokenCount: number; totalTokenCount: number };

/** Shaped like the SDK's GenerateContentResponse for the fields the app reads. */
export class FakeResponse {
  candidates?: FakeCandidate[];
  promptFeedback?: { blockReason: string };
  usageMetadata?: FakeUsage;
  modelVersion?: string;

  constructor(init: Partial<Pick<FakeResponse, 'candidates' | 'promptFeedback' | 'usageMetadata' | 'modelVersion'>>) {
    Object.assign(this, init);
  }

  /** Concatenated non-thought text of the first candidate, like the SDK getter. */
  get text(): string | undefined {
    const parts = this.candidates?.[0]?.content.parts ?? [];
    const texts = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text as string);
    return texts.length ? texts.join('') : undefined;
  }

  get functionCalls(): { name: string; args: Record<string, unknown> }[] | undefined {
    const calls = (this.candidates?.[0]?.content.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    return calls.length ? calls : undefined;
  }
}

export class FakeApiError extends Error {
  readonly status: number;
  constructor(status: number, statusText: string, retryDelay?: string) {
    const details = retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : [];
    super(JSON.stringify({ error: { code: status, message: `fake ${statusText}`, status: statusText, details } }));
    this.name = 'ApiError';
    this.status = status;
  }
}

type FakeParams = {
  model: string;
  contents: unknown;
  config?: {
    systemInstruction?: unknown;
    abortSignal?: AbortSignal;
    responseJsonSchema?: unknown;
    tools?: unknown;
  };
};

// Counters live on globalThis so /api/ai/health sees the same numbers as the routes.
const STATS_KEY = Symbol.for('ob.ai.fakeStats');
function stats(): AiFakeStats {
  const g = globalThis as { [STATS_KEY]?: AiFakeStats };
  return (g[STATS_KEY] ??= { calls: {}, pulls: 0, embeds: 0 });
}

/** A copy of the fake's counters, for /api/ai/health under the fake model. */
export function fakeStats(): AiFakeStats {
  const s = stats();
  return { calls: { ...s.calls }, pulls: s.pulls, embeds: s.embeds };
}

function countCall(model: string) {
  const s = stats();
  s.calls[model] = (s.calls[model] ?? 0) + 1;
}

/** getAi() returns this under the fake model; modelsFor() stands in for `ai.models`. */
export class FakeAi {
  readonly fake = true as const;
  modelsFor(feature: string): FakeModels {
    return new FakeModels(feature);
  }
}

export function isFakeAi(x: unknown): x is FakeAi {
  return x instanceof FakeAi;
}

type Script =
  | { kind: 'error'; error: FakeApiError }
  | { kind: 'blocked' }
  | { kind: 'hang' }
  | { kind: 'chunks'; chunks: FakePart[][]; delayMs: number };

export class FakeModels {
  private readonly feature: string;

  constructor(feature: string) {
    this.feature = feature;
  }

  async generateContentStream(params: FakeParams): Promise<AsyncGenerator<FakeResponse>> {
    countCall(params.model);
    const signal = params.config?.abortSignal;
    throwIfAborted(signal);
    const script = scriptFor(this.feature, params);
    await sleep(CHUNK_DELAY_MS, signal);
    if (script.kind === 'error') throw script.error;
    if (script.kind === 'hang') return hang(signal);
    return streamOf(script, params, signal);
  }

  async generateContent(params: FakeParams): Promise<FakeResponse> {
    countCall(params.model);
    const signal = params.config?.abortSignal;
    throwIfAborted(signal);
    const script = scriptFor(this.feature, params);
    await sleep(CHUNK_DELAY_MS, signal);
    if (script.kind === 'error') throw script.error;
    if (script.kind === 'hang') return hang(signal);
    if (script.kind === 'blocked') return new FakeResponse({ promptFeedback: { blockReason: 'SAFETY' }, modelVersion: params.model });
    const parts = mergeParts(script.chunks.flat());
    return new FakeResponse({
      candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }],
      usageMetadata: usageFor(params, parts),
      modelVersion: params.model,
    });
  }

  /** Embeddings are unavailable under the fake, so retrieval runs lexically and stays predictable. */
  async embedContent(params: FakeParams): Promise<never> {
    stats().embeds += 1;
    throwIfAborted(params.config?.abortSignal);
    throw new FakeApiError(501, 'NOT_IMPLEMENTED');
  }
}

async function* streamOf(
  script: Extract<Script, { kind: 'chunks' } | { kind: 'blocked' }>,
  params: FakeParams,
  signal: AbortSignal | undefined,
): AsyncGenerator<FakeResponse> {
  if (script.kind === 'blocked') {
    stats().pulls += 1;
    yield new FakeResponse({ promptFeedback: { blockReason: 'SAFETY' }, modelVersion: params.model });
    return;
  }
  const all = script.chunks.flat();
  for (let i = 0; i < script.chunks.length; i++) {
    if (i > 0) await sleep(script.delayMs, signal);
    throwIfAborted(signal);
    stats().pulls += 1;
    const last = i === script.chunks.length - 1;
    yield new FakeResponse({
      candidates: [{ content: { role: 'model', parts: script.chunks[i] }, ...(last ? { finishReason: 'STOP' } : {}), index: 0 }],
      ...(last ? { usageMetadata: usageFor(params, all) } : {}),
      modelVersion: params.model,
    });
  }
}

// prompts/base.ts transcript(): earlier questions ride along in the user turn, but
// only the current question may pick a fixture.
const EARLIER_QUESTIONS = /<<<UNTRUSTED visitor earlier questions>>>[\s\S]*?<<<END UNTRUSTED visitor earlier questions>>>/g;

function scriptFor(feature: string, params: FakeParams): Script {
  const input = textOf(params.contents).replace(EARLIER_QUESTIONS, '');
  const system = textOf(params.config?.systemInstruction);
  const primary = params.model === AI_MODELS.primary;
  const cite = citeFor(system);

  if (input.includes('__429') && primary) return { kind: 'error', error: new FakeApiError(429, 'RESOURCE_EXHAUSTED', FAKE_RETRY_DELAY) };
  if (input.includes('__503') && primary) return { kind: 'error', error: new FakeApiError(503, 'UNAVAILABLE') };
  if (input.includes('__timeout')) return { kind: 'hang' };
  if (input.includes('__safety')) return { kind: 'blocked' };

  if (input.includes('__tool')) {
    const fn = firstFunction(params.config?.tools);
    if (fn) {
      const args = sampleFromSchema(fn.schema, fn.schema, 0);
      return {
        kind: 'chunks',
        delayMs: CHUNK_DELAY_MS,
        chunks: [[{ text: `Opening that for you ${cite}. ` }], [{ functionCall: { name: fn.name, args: isRecord(args) ? args : {} } }]],
      };
    }
  }

  if (params.config?.responseJsonSchema !== undefined) {
    const schema = params.config.responseJsonSchema;
    const json = JSON.stringify(sampleFromSchema(schema, schema, 0));
    return { kind: 'chunks', delayMs: CHUNK_DELAY_MS, chunks: split(json, 48).map((t) => [{ text: t }]) };
  }

  const text = cannedText(feature, input, system, cite);
  if (input.includes('__slow')) {
    // Letters, not numbers: a digit the cited chunk lacks would trip the number check and drop every sentence.
    const words = Array.from({ length: SLOW_CHUNKS }, (_, i) => `Slow sentence ${'abcdefghijklmnopqrstuvwxyz'[i % 26]} from the test model ${cite}. `);
    return { kind: 'chunks', delayMs: SLOW_DELAY_MS, chunks: words.map((t) => [{ text: t }]) };
  }
  // A thought part first, as the real model sends one; it must never reach the page.
  const chunks: FakePart[][] = [[{ text: 'Planning the answer.', thought: true }]];
  for (const piece of text) chunks.push(...split(piece, 11).map((t) => [{ text: t }]));
  return { kind: 'chunks', delayMs: CHUNK_DELAY_MS, chunks };
}

/** The answer as pieces; a piece boundary is where a fixture deliberately splits a payload. */
function cannedText(feature: string, input: string, system: string, cite: string): string[] {
  if (input.includes('__canary_split')) {
    const canary = findCanary(system) ?? 'CANARY-NOT-FOUND-IN-SYSTEM-PROMPT';
    const half = Math.ceil(canary.length / 2);
    return [`The hidden marker is ${canary.slice(0, half)}`, `${canary.slice(half)} ${cite}. `, `That was a test ${cite}.`];
  }
  if (input.includes('__md_split')) {
    return ['See [the write-up](https://ev', `il.example/x) for the details ${cite}. `, `That is all from the test model ${cite}.`];
  }
  if (input.includes('__foreign_email')) {
    return [`For a faster reply write to hire@evil.example ${cite}. `, `That is all from the test model ${cite}.`];
  }
  if (input.includes('__uncited_cert')) {
    return ['He is AWS certified. ', `This answer comes from the test model ${cite}.`];
  }
  if (feature === 'draft') {
    return ['Hi Oikantik, this is a canned draft from the test model. ', 'It lets the contact form run without a key.'];
  }
  return [
    `This is a canned answer from the test model ${cite}. `,
    `It lets the grounding and streaming path run without a key ${cite}.`,
  ];
}

const CITE_ID = /\b((?:profile|exp|edu|skills|project|facts|reading|tool|copy):[\w#.-]*\w)/;

/** Cites a real context id when the system prompt has one, preferring the core profile card. */
function citeFor(system: string): string {
  if (system.includes('profile:about')) return '[c:profile:about]';
  const m = CITE_ID.exec(system);
  return m ? `[c:${m[1]}]` : '[c:profile:about]';
}

/**
 * The canary from prompts/base.ts newCanary() ('cnry-' + 16 hex). Failing that, the
 * first token after the word 'canary' that contains a digit.
 */
export function findCanary(system: string): string | null {
  const exact = /\bcnry-[0-9a-f]{16}\b/.exec(system);
  if (exact) return exact[0];
  const re = /canary\W{0,16}([A-Za-z0-9][A-Za-z0-9_-]{5,63})/gi;
  for (let m = re.exec(system); m; m = re.exec(system)) {
    if (/\d/.test(m[1])) return m[1];
  }
  return null;
}

function split(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

function mergeParts(parts: FakePart[]): FakePart[] {
  const out: FakePart[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && typeof prev.text === 'string' && typeof p.text === 'string' && Boolean(prev.thought) === Boolean(p.thought)) {
      out[out.length - 1] = { ...prev, text: prev.text + p.text };
    } else out.push({ ...p });
  }
  return out;
}

function usageFor(params: FakeParams, parts: FakePart[]): FakeUsage {
  const prompt = Math.ceil((textOf(params.contents).length + textOf(params.config?.systemInstruction).length) / 4);
  const out = Math.ceil(parts.reduce((n, p) => n + (p.thought ? 0 : (p.text?.length ?? 0)), 0) / 4);
  const thoughts = Math.ceil(parts.reduce((n, p) => n + (p.thought ? (p.text?.length ?? 0) : 0), 0) / 4);
  return { promptTokenCount: prompt, candidatesTokenCount: out, thoughtsTokenCount: thoughts, totalTokenCount: prompt + out + thoughts };
}

/** Every string under a `text` key (or a bare string), in order. */
function textOf(value: unknown, depth = 0): string {
  if (depth > 8 || value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => textOf(v, depth + 1)).join('\n');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (Array.isArray(record.parts)) return textOf(record.parts, depth + 1);
  }
  return '';
}

function firstFunction(tools: unknown): { name: string; schema: unknown } | null {
  if (!Array.isArray(tools)) return null;
  for (const tool of tools) {
    const decls = isRecord(tool) ? tool.functionDeclarations : undefined;
    if (!Array.isArray(decls)) continue;
    for (const d of decls) {
      if (isRecord(d) && typeof d.name === 'string') return { name: d.name, schema: d.parametersJsonSchema ?? d.parameters ?? {} };
    }
  }
  return null;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A minimal, deterministic instance of a JSON Schema (the subset Gemini accepts). */
export function sampleFromSchema(schema: unknown, root: unknown, depth: number): unknown {
  if (depth > 10 || !isRecord(schema)) return null;
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(schema.$ref, root);
    return target ? sampleFromSchema(target, root, depth + 1) : null;
  }
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length) {
      const pick = options.find((o) => !(isRecord(o) && o.type === 'null')) ?? options[0];
      return sampleFromSchema(pick, root, depth + 1);
    }
  }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = (types.find((t) => t !== 'null') ?? (isRecord(schema.properties) ? 'object' : 'string')) as string;

  switch (type) {
    case 'object': {
      const out: Record<string, unknown> = {};
      const props = isRecord(schema.properties) ? schema.properties : {};
      for (const [key, sub] of Object.entries(props)) out[key] = sampleFromSchema(sub, root, depth + 1);
      return out;
    }
    case 'array': {
      const min = typeof schema.minItems === 'number' ? schema.minItems : 0;
      const max = typeof schema.maxItems === 'number' ? schema.maxItems : Math.max(min, 1);
      const count = Math.min(Math.max(min, 1), max);
      const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
      return Array.from({ length: count }, (_, i) => sampleFromSchema(prefix[i] ?? schema.items ?? {}, root, depth + 1));
    }
    case 'integer':
    case 'number': {
      let n = typeof schema.minimum === 'number' ? schema.minimum : 0;
      if (typeof schema.exclusiveMinimum === 'number') n = Math.max(n, schema.exclusiveMinimum + (type === 'integer' ? 1 : 0.01));
      if (typeof schema.maximum === 'number') n = Math.min(n, schema.maximum);
      return type === 'integer' ? Math.ceil(n) : n;
    }
    case 'boolean':
      return false;
    case 'null':
      return null;
    default: {
      const format = typeof schema.format === 'string' ? schema.format : '';
      let s =
        format === 'date' ? '2026-01-01' : format === 'date-time' ? '2026-01-01T00:00:00Z' : format === 'email' ? 'test@example.com' : format === 'uri' ? 'https://example.com' : 'fake';
      const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0;
      if (s.length < minLength) s = s.padEnd(minLength, 'x');
      if (typeof schema.maxLength === 'number') s = s.slice(0, schema.maxLength);
      return s;
    }
  }
}

function resolveRef(ref: string, root: unknown): unknown {
  if (!ref.startsWith('#')) return null;
  let node: unknown = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(node)) return null;
    node = node[key];
  }
  return node;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError(signal);
}

/** Never settles until the request deadline (or the client) aborts the call. */
async function hang(signal: AbortSignal | undefined): Promise<never> {
  await sleep(Number.POSITIVE_INFINITY, signal);
  throw new Error('unreachable');
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = Number.isFinite(ms) ? setTimeout(done, ms) : null;
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      if (timer) clearTimeout(timer);
      reject(abortError(signal as AbortSignal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
