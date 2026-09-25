import 'server-only';
import type { AiFeature } from './config';
import type { AiHealth } from './protocol';

/*
 * Server-only AI configuration: model ids, kill switches, the key and the
 * per-instance model cooldowns. Model id strings live here and nowhere else in
 * the app. Env is read on each call, so a local server restarted with other
 * settings needs no rebuild (Vercel only applies env changes after a redeploy).
 */

const DEFAULT_PRIMARY = 'gemini-3.8-flash';
const DEFAULT_FALLBACK = 'gemini-3.5-flash-lite';
const EMBED_CANDIDATES = ['gemini-embedding-2', 'gemini-embedding-2-preview'] as const;

// A bare model id. Rejects a pasted key (health echoes these ids) and '-latest'
// aliases, which can silently change model under a deployed prompt.
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/i;

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function modelFromEnv(name: 'AI_MODEL_PRIMARY' | 'AI_MODEL_FALLBACK', fallback: string): string {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (MODEL_ID.test(value) && !/^aiza/i.test(value) && !/-latest$/i.test(value)) return value;
  warnOnce(name, `[ai] ${name} is not a pinned model id; using ${fallback}`);
  return fallback;
}

export type AiModels = {
  primary: string;
  fallback: string;
  embedCandidates: readonly string[];
  embedDims: number;
};

export const AI_MODELS: AiModels = {
  get primary() {
    return modelFromEnv('AI_MODEL_PRIMARY', DEFAULT_PRIMARY);
  },
  get fallback() {
    return modelFromEnv('AI_MODEL_FALLBACK', DEFAULT_FALLBACK);
  },
  embedCandidates: EMBED_CANDIDATES,
  embedDims: 768,
};

/** Model order for a feature: chat tries primary first, cheap tries the lite model first. */
export function modelOrder(tier: 'chat' | 'cheap'): string[] {
  const { primary, fallback } = AI_MODELS;
  const order = tier === 'chat' ? [primary, fallback] : [fallback, primary];
  return order.filter((m, i) => order.indexOf(m) === i);
}

/** The fake model: AI_FAKE_MODEL=1, and never on Vercel. */
export function isFake(): boolean {
  if (process.env.AI_FAKE_MODEL !== '1') return false;
  if (process.env.VERCEL === '1') {
    warnOnce('fake', '[ai] AI_FAKE_MODEL is ignored on Vercel');
    return false;
  }
  return true;
}

/** The Gemini key, for gemini.server.ts only. Never log, echo or serialise it. */
export function aiApiKey(): string | undefined {
  return process.env.GOOGLE_AI_API_KEY?.trim() || undefined;
}

function isConfigured(): boolean {
  return isFake() || Boolean(aiApiKey());
}

function isEnabled(): boolean {
  return process.env.AI_ENABLED !== '0';
}

function featuresOff(): Set<string> {
  return new Set(
    (process.env.AI_FEATURES_OFF ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export type AiOffReason = 'disabled' | 'no-key' | 'feature-off';
export type AiMode = 'model' | 'lexical' | { off: AiOffReason };

/**
 * Whether a feature may call the model. Retrieval never switches fully off: when
 * AI is off, the key is missing or 'retrieve-embed' is listed, it runs on BM25.
 */
export function aiMode(feature: AiFeature): AiMode {
  const off: AiOffReason | null = !isEnabled()
    ? 'disabled'
    : featuresOff().has(feature)
      ? 'feature-off'
      : !isConfigured()
        ? 'no-key'
        : null;
  if (feature === 'retrieve') return off || featuresOff().has('retrieve-embed') ? 'lexical' : 'model';
  return off ? { off } : 'model';
}

export function aiTier(): 'free' | 'paid' | 'unknown' {
  const tier = process.env.AI_TIER?.trim().toLowerCase();
  return tier === 'free' || tier === 'paid' ? tier : 'unknown';
}

/** Per-instance ceiling on cost units per UTC day (AI_DAILY_BUDGET, default 2000). */
export function aiDailyBudget(): number {
  const n = Number(process.env.AI_DAILY_BUDGET);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2000;
}

// Cooldowns live on globalThis so every route bundle in this process shares them.
const COOLDOWN_KEY = Symbol.for('ob.ai.cooldowns');
function cooldowns(): Map<string, number> {
  const g = globalThis as { [COOLDOWN_KEY]?: Map<string, number> };
  return (g[COOLDOWN_KEY] ??= new Map());
}

/** After a 429 every later request on this instance skips the model until `ms` passes. */
export function coolDown(model: string, ms: number, now: number = Date.now()): void {
  cooldowns().set(model, now + ms);
}

export function isCooling(model: string, now: number = Date.now()): boolean {
  const until = cooldowns().get(model);
  if (until === undefined) return false;
  if (until > now) return true;
  cooldowns().delete(model);
  return false;
}

/** Seconds until the model is usable again (0 when it is not cooling). */
export function coolingFor(model: string, now: number = Date.now()): number {
  const until = cooldowns().get(model);
  return until && until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function coolingModels(now: number = Date.now()): string[] {
  return [...cooldowns().keys()].filter((m) => isCooling(m, now));
}

/** What /api/ai/health reports. It never contains the key. */
export function aiState(): Omit<AiHealth, 'fakeStats'> {
  const { primary, fallback } = AI_MODELS;
  return {
    enabled: isEnabled(),
    configured: isConfigured(),
    fake: isFake(),
    tier: aiTier(),
    models: { primary, fallback },
    cooling: coolingModels(),
  };
}
