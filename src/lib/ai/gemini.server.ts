import 'server-only';
import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Models,
  type Part,
  type SafetySetting,
} from '@google/genai';
import { z, type ZodType } from 'zod';
import { AI_BUDGETS, AI_DEADLINE_MS, type AiFeature } from './config';
import { AI_MODELS, aiApiKey, aiMode, coolDown, coolingFor, isCooling, isFake, modelOrder } from './config.server';
import { FakeAi, isFakeAi } from './fake.server';
import { classifyStatus, nextAttemptBudget, retryDelayMs, thinkingFor } from './modelPolicy';
import type { AiFallback, AiFallbackReason, AiUsage } from './protocol';

/*
 * The server's only door to Gemini. One request deadline bounds every attempt; the
 * second model is tried only after a 429 or 503 with at least 8s left; a timeout
 * is never retried, because an aborted call is still billed. SDK retries stay off
 * (no retryOptions). Nothing here logs prompts, visitor text or the key.
 */

type ModelCalls = Pick<Models, 'generateContent' | 'generateContentStream' | 'embedContent'>;

let client: GoogleGenAI | null = null;
let fakeClient: FakeAi | null = null;

/** The SDK client, the fake under AI_FAKE_MODEL, or null without a key. */
export function getAi(): GoogleGenAI | FakeAi | null {
  if (isFake()) return (fakeClient ??= new FakeAi());
  const apiKey = aiApiKey();
  if (!apiKey) return null;
  // The key is passed explicitly: the SDK only auto-reads GOOGLE_API_KEY or GEMINI_API_KEY.
  return (client ??= new GoogleGenAI({ apiKey }));
}

function modelsOf(ai: GoogleGenAI | FakeAi, feature: AiFeature): ModelCalls {
  return isFakeAi(ai) ? (ai.modelsFor(feature) as unknown as ModelCalls) : ai.models;
}

export type Deadline = {
  signal: AbortSignal;
  remaining(): number;
  /** True once the timer (not the client) ended the request. */
  timedOut(): boolean;
};

/** One deadline per request: the client's disconnect or `ms`, whichever comes first. */
export function deadline(reqSignal?: AbortSignal | null, ms: number = AI_DEADLINE_MS): Deadline {
  const start = Date.now();
  const timer = AbortSignal.timeout(ms);
  const signal = reqSignal ? AbortSignal.any([reqSignal, timer]) : timer;
  return {
    signal,
    remaining: () => Math.max(0, ms - (Date.now() - start)),
    timedOut: () => timer.aborted,
  };
}

/** Thrown from a stream after its first chunk; respond.server's ndjson() turns it into an error frame. */
export class AiError extends Error {
  readonly reason: AiFallbackReason;
  constructor(reason: AiFallbackReason) {
    super(`ai: ${reason}`);
    this.name = 'AiError';
    this.reason = reason;
  }
}

export function isFallback(x: unknown): x is AiFallback {
  return typeof x === 'object' && x !== null && (x as { mode?: unknown }).mode === 'fallback';
}

function fb(reason: AiFallbackReason, retryAfterSec?: number): AiFallback {
  return retryAfterSec ? { mode: 'fallback', reason, retryAfterSec } : { mode: 'fallback', reason };
}

// The Gemini 3 default is Off, so every call sets these explicitly.
const SAFETY: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));

const SAFETY_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

function baseConfig(feature: AiFeature, model: string, system: string, signal: AbortSignal): GenerateContentConfig {
  return {
    systemInstruction: system,
    maxOutputTokens: AI_BUDGETS[feature].maxOutputTokens,
    thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingFor(model)] },
    safetySettings: SAFETY,
    automaticFunctionCalling: { disable: true },
    abortSignal: signal,
  };
}

/** Pre-flight shared by aiStream and aiGenerate: kill switches, key, and the models to try. */
function prepare(feature: AiFeature): { ai: GoogleGenAI | FakeAi; order: string[] } | AiFallback {
  const mode = aiMode(feature);
  if (typeof mode === 'object') return fb(mode.off);
  const ai = getAi();
  if (!ai) return fb('no-key');
  const tier = AI_BUDGETS[feature].tier;
  return { ai, order: modelOrder(tier === 'chat' ? 'chat' : 'cheap') };
}

type AttemptOutcome = { retry: boolean; fallback: AiFallback };

function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

/** Maps an attempt's failure; a 429 also cools the model for Google's RetryInfo delay. */
function classifyFailure(err: unknown, model: string, feature: AiFeature, dl: Deadline): AttemptOutcome {
  if (dl.timedOut()) return { retry: false, fallback: fb('timeout') };
  if (dl.signal.aborted) return { retry: false, fallback: fb('upstream') };
  const status = statusOf(err);
  console.warn(`[ai] ${feature} ${model} failed: ${errName(err)}${status ? ` ${status}` : ''}`);
  if (status === null || classifyStatus(status) === 'upstream') return { retry: false, fallback: fb('upstream') };
  if (status === 429) {
    const ms = retryDelayMs(err);
    coolDown(model, ms);
    return { retry: true, fallback: fb('quota', Math.ceil(ms / 1000)) };
  }
  return { retry: true, fallback: fb('upstream') };
}

/**
 * Walks the model order: skips cooling models, stops when a second attempt would
 * start with under 8s left, and returns the first success or the last failure.
 */
async function withModels<R>(
  feature: AiFeature,
  order: string[],
  dl: Deadline,
  attempt: (model: string) => Promise<R | AiFallback>,
): Promise<R | AiFallback> {
  let last: AiFallback = fb('upstream');
  let attempted = false;
  for (const model of order) {
    if (isCooling(model)) {
      last = fb('quota', coolingFor(model));
      continue;
    }
    if (dl.signal.aborted) return fb(dl.timedOut() ? 'timeout' : 'upstream');
    if (attempted && nextAttemptBudget(dl.remaining(), AI_DEADLINE_MS) === null) break;
    attempted = true;
    try {
      return await attempt(model);
    } catch (err) {
      const outcome = classifyFailure(err, model, feature, dl);
      last = outcome.fallback;
      if (!outcome.retry) return last;
    }
  }
  return last;
}

function isBlocked(res: GenerateContentResponse | undefined): boolean {
  if (!res) return false;
  if (res.promptFeedback?.blockReason) return true;
  const finish = res.candidates?.[0]?.finishReason;
  return typeof finish === 'string' && SAFETY_FINISH.has(finish);
}

/** Non-thought text of the first candidate. */
export function textOf(res: GenerateContentResponse | undefined): string {
  const parts = res?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text as string)
    .join('');
}

export function usageOf(res: GenerateContentResponse | undefined): AiUsage | undefined {
  const u = res?.usageMetadata;
  if (!u) return undefined;
  const usage: AiUsage = { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 };
  if (u.thoughtsTokenCount) usage.thoughts = u.thoughtsTokenCount;
  return usage;
}

export type AiStreamResult = {
  model: string;
  stream: AsyncGenerator<GenerateContentResponse>;
  /** Stops pulling tokens: aborts the upstream call. */
  abort(): void;
  /** Milliseconds from the attempt's start to its first chunk. */
  ttftMs: number;
};

/**
 * Streams one answer. The first chunk is awaited before this resolves, so a quota
 * error, an overloaded model or a blocked prompt still falls back (or moves to the
 * next model) before a single byte reaches the visitor. Errors after that surface
 * from the stream as AiError.
 */
export async function aiStream(opts: {
  feature: AiFeature;
  system: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  dl: Deadline;
}): Promise<AiStreamResult | AiFallback> {
  const ready = prepare(opts.feature);
  if (isFallback(ready)) return ready;
  const models = modelsOf(ready.ai, opts.feature);

  return withModels<AiStreamResult>(opts.feature, ready.order, opts.dl, async (model) => {
    const started = Date.now();
    const ctrl = new AbortController();
    const signal = AbortSignal.any([opts.dl.signal, ctrl.signal]);
    const config = baseConfig(opts.feature, model, opts.system, signal);
    if (opts.tools?.length) config.tools = [{ functionDeclarations: opts.tools }];

    const upstream = await models.generateContentStream({ model, contents: opts.contents, config });
    let first: IteratorResult<GenerateContentResponse>;
    try {
      first = await upstream.next();
    } catch (err) {
      ctrl.abort();
      throw err;
    }
    if (!first.done && isBlocked(first.value)) {
      ctrl.abort();
      void upstream.return(undefined).catch(() => {});
      return fb('safety');
    }
    return {
      model,
      stream: replay(first, upstream, model, opts.feature, opts.dl, ctrl),
      abort: () => ctrl.abort(),
      ttftMs: Date.now() - started,
    };
  });
}

async function* replay(
  first: IteratorResult<GenerateContentResponse>,
  rest: AsyncGenerator<GenerateContentResponse>,
  model: string,
  feature: AiFeature,
  dl: Deadline,
  ctrl: AbortController,
): AsyncGenerator<GenerateContentResponse> {
  try {
    if (first.done) return;
    yield first.value;
    while (true) {
      const next = await rest.next();
      if (next.done) return;
      yield next.value;
    }
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (dl.timedOut()) throw new AiError('timeout');
    const status = statusOf(err);
    if (status === 429) coolDown(model, retryDelayMs(err));
    if (!dl.signal.aborted && !ctrl.signal.aborted) {
      console.warn(`[ai] ${feature} ${model} stream failed: ${errName(err)}${status ? ` ${status}` : ''}`);
    }
    throw new AiError(status === 429 ? 'quota' : 'upstream');
  } finally {
    // Also runs when the consumer stops early (iterator.return()), so a closed tab
    // stops the upstream call instead of leaving tokens streaming into nothing.
    ctrl.abort();
    void rest.return(undefined).catch(() => {});
  }
}

export type AiGenerateResult<T> = {
  model: string;
  text: string;
  data?: T;
  usage?: AiUsage;
  finishReason: string;
};

/** Gemini's structured output takes plain JSON Schema; this is the one conversion. */
export function toResponseSchema(schema: ZodType): unknown {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
}

/**
 * One non-streamed call. With a schema the model is asked for JSON matching it and
 * the reply must pass safeParse; a reply that does not is 'unverified', with no
 * repair retry.
 */
export async function aiGenerate<T>(opts: {
  feature: AiFeature;
  system: string;
  contents: Content[];
  parts?: Part[];
  schema?: ZodType<T>;
  dl: Deadline;
}): Promise<AiGenerateResult<T> | AiFallback> {
  const ready = prepare(opts.feature);
  if (isFallback(ready)) return ready;
  const models = modelsOf(ready.ai, opts.feature);
  const jsonSchema = opts.schema ? toResponseSchema(opts.schema) : undefined;
  const contents = withParts(opts.contents, opts.parts);

  return withModels<AiGenerateResult<T>>(opts.feature, ready.order, opts.dl, async (model) => {
    const config = baseConfig(opts.feature, model, opts.system, opts.dl.signal);
    if (jsonSchema !== undefined) {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = jsonSchema;
    }
    const res = await models.generateContent({ model, contents, config });
    if (isBlocked(res)) return fb('safety');

    const text = textOf(res);
    const result: AiGenerateResult<T> = {
      model,
      text,
      usage: usageOf(res),
      finishReason: res.candidates?.[0]?.finishReason ?? 'STOP',
    };
    if (!opts.schema) return result;

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return fb('unverified');
    }
    const parsed = opts.schema.safeParse(json);
    if (!parsed.success) return fb('unverified');
    return { ...result, data: parsed.data };
  });
}

function withParts(contents: Content[], parts: Part[] | undefined): Content[] {
  if (!parts?.length) return contents;
  const copy = contents.map((c) => ({ ...c, parts: [...(c.parts ?? [])] }));
  for (let i = copy.length - 1; i >= 0; i--) {
    if ((copy[i].role ?? 'user') === 'user') {
      copy[i].parts = [...(copy[i].parts ?? []), ...parts];
      return copy;
    }
  }
  return [...copy, { role: 'user', parts }];
}

const QUERY_PREFIX = 'task: search result | query: ';

/**
 * Embeds each text as its own Content (a plain string list would return one
 * aggregated vector). Task instructions go in prompt prefixes; taskType is never
 * sent. Returns null on any failure, so retrieval simply goes lexical.
 */
export async function aiEmbed(
  texts: string[],
  kind: 'query' | 'document',
  opts: { model: string; titles?: (string | undefined)[]; dl: Pick<Deadline, 'signal'> },
): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  if (aiMode('retrieve') !== 'model') return null;
  const ai = getAi();
  if (!ai || isCooling(opts.model) || opts.dl.signal.aborted) return null;

  const contents: Content[] = texts.map((text, i) => ({
    parts: [{ text: kind === 'query' ? `${QUERY_PREFIX}${text}` : `title: ${opts.titles?.[i]?.trim() || 'none'} | text: ${text}` }],
  }));
  try {
    const res = await modelsOf(ai, 'retrieve').embedContent({
      model: opts.model,
      contents,
      config: { outputDimensionality: AI_MODELS.embedDims, abortSignal: opts.dl.signal },
    });
    const vectors = (res.embeddings ?? []).map((e) => Float32Array.from(e.values ?? []));
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== AI_MODELS.embedDims)) return null;
    return vectors;
  } catch (err) {
    const status = statusOf(err);
    if (status === 429) coolDown(opts.model, retryDelayMs(err));
    if (!opts.dl.signal.aborted && !isFakeAi(ai)) console.warn(`[ai] embed ${opts.model} failed: ${errName(err)}${status ? ` ${status}` : ''}`);
    return null;
  }
}
