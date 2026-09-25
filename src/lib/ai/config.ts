/*
 * Client-safe AI configuration: feature ids, input caps and per-feature budgets.
 * It reads no server env, so client components and pure tests may import it.
 * Model ids and kill switches live in config.server.ts.
 */

export type AiFeature =
  | 'ask'
  | 'retrieve'
  | 'tour'
  | 'project-filters'
  | 'sentiment'
  | 'jd-extract'
  | 'jd-fit'
  | 'jd-questions'
  | 'brief'
  | 'draft';

export const AI_FEATURES: readonly AiFeature[] = [
  'ask',
  'retrieve',
  'tour',
  'project-filters',
  'sentiment',
  'jd-extract',
  'jd-fit',
  'jd-questions',
  'brief',
  'draft',
];

/** Input caps in characters, except bodyBytes (the guard's streamed read cap). */
export const AI_LIMITS = {
  question: 500,
  historyTurns: 6,
  historyChars: 2000,
  prevCited: 12,
  jd: 8000,
  jdRequirements: 12,
  requirement: 200,
  draftInput: 300,
  title: 80,
  tourGoal: 120,
  sentimentText: 280,
  retrieveQuery: 200,
  filterPhrase: 160,
  bodyBytes: 16384,
} as const;

export type AiTier = 'chat' | 'cheap' | 'none';

export type AiBudget = {
  tier: AiTier;
  /** Thinking tokens count against this. */
  maxOutputTokens: number;
  /** Cap on characters a stream may emit before it is ended with a done frame. */
  maxChars: number;
  /** Token-bucket cost before the per-4KB input surcharge. */
  baseCost: number;
  /** Heavy features fail closed when BotID cannot decide. */
  heavy: boolean;
};

// Where no character cap is specified, 4 characters per output token is a
// ceiling the model cannot reach, so the cap only stops a runaway stream.
export const AI_BUDGETS: Record<AiFeature, AiBudget> = {
  ask: { tier: 'chat', maxOutputTokens: 1536, maxChars: 1800, baseCost: 1, heavy: false },
  retrieve: { tier: 'none', maxOutputTokens: 0, maxChars: 0, baseCost: 1, heavy: false },
  tour: { tier: 'cheap', maxOutputTokens: 256, maxChars: 1024, baseCost: 1, heavy: false },
  'project-filters': { tier: 'cheap', maxOutputTokens: 256, maxChars: 1024, baseCost: 1, heavy: false },
  sentiment: { tier: 'cheap', maxOutputTokens: 384, maxChars: 1536, baseCost: 1, heavy: false },
  draft: { tier: 'cheap', maxOutputTokens: 768, maxChars: 1500, baseCost: 1, heavy: false },
  'jd-extract': { tier: 'cheap', maxOutputTokens: 1024, maxChars: 4096, baseCost: 2, heavy: true },
  'jd-fit': { tier: 'chat', maxOutputTokens: 4096, maxChars: 16384, baseCost: 4, heavy: true },
  'jd-questions': { tier: 'cheap', maxOutputTokens: 768, maxChars: 3072, baseCost: 2, heavy: true },
  brief: { tier: 'chat', maxOutputTokens: 1536, maxChars: 6144, baseCost: 3, heavy: true },
};

/** One server deadline shared by every model attempt in a request (maxDuration is 30s). */
export const AI_DEADLINE_MS = 25000;
/** Longer than the server deadline, so the server's own error frame arrives first. */
export const AI_CLIENT_TIMEOUT_MS = 30000;
/** Time a query embedding may take before retrieval goes lexical. */
export const AI_EMBED_BUDGET_MS = 1500;

/**
 * Build flag: show unreviewed claim-bearing precomputed entries. next.config sets
 * it to '1' everywhere except production.
 */
export const SHOW_UNREVIEWED = process.env.NEXT_PUBLIC_AI_SHOW_UNREVIEWED === '1';
