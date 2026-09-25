/*
 * The AI wire protocol shared by routes, hooks and components. Types only: no
 * runtime import and no zod, so importing it adds nothing to a client bundle.
 */
import type { SectionId } from '@/lib/site';

export type AiFallbackReason =
  | 'disabled'
  | 'no-key'
  | 'feature-off'
  | 'rate-limited'
  | 'bot'
  | 'origin'
  | 'bad-request'
  | 'too-long'
  | 'quota'
  | 'upstream'
  | 'timeout'
  | 'safety'
  | 'unverified'
  | 'low-relevance';

/** Every failure path answers HTTP 200 with this body; the client falls back to a non-AI path. */
export type AiFallback = { mode: 'fallback'; reason: AiFallbackReason; retryAfterSec?: number };

export type AiTarget =
  | { kind: 'project'; slug: string }
  | { kind: 'skill'; name: string }
  | { kind: 'section'; id: SectionId }
  | { kind: 'experience'; index: number }
  | { kind: 'education'; index: number }
  | { kind: 'reading'; index: number }
  | { kind: 'tenet'; index: number }
  | { kind: 'cv' }
  | { kind: 'contact' };

export type AiAction =
  | { kind: 'open'; target: AiTarget }
  | { kind: 'filter'; cat?: string; tech?: string; live?: boolean; q?: string }
  | { kind: 'prefill'; subject?: string; message: string }
  | { kind: 'cv' }
  | { kind: 'vcard' }
  | { kind: 'copyEmail' };

/** 'self' is evidence; 'reference' describes a technology, never his use of it; 'live' is dated. */
export type EvidenceClass = 'self' | 'reference' | 'live';

export type AiSource = {
  id: string;
  label: string;
  cls: EvidenceClass;
  target: AiTarget;
  quote?: string;
  asOf?: string;
};

export type AskScope = { project: string } | { skill: string } | { experience: number } | { section: SectionId };

export type AskRequest = {
  question: string;
  /** The visitor's own earlier questions only. There is deliberately no model turn. */
  history?: string[];
  prevCited?: string[];
  scope?: AskScope;
  tools?: boolean;
  lang?: string;
};

export type AskOpenRequest = { question?: string; scope?: AskScope; send?: boolean };

export type FitOpenRequest = { jd?: string };

export type RetrievalHit = { id: string; bm25: number; cosine: number | null; rank: number; score: number };

export type AiUsage = { input: number; output: number; thoughts?: number };

export type AiToolCall = { name: string; args: Record<string, unknown> };

export type AiFrame =
  | {
      type: 'meta';
      model: string;
      feature: string;
      sources: AiSource[];
      retrieval?: RetrievalHit[];
      mode: 'hybrid' | 'lexical' | 'full';
      /** A replay from the answer cache; the Details panel says so. */
      cached?: boolean;
    }
  /** Verified sentences only. */
  | { type: 'delta'; text: string }
  | { type: 'tool'; call: AiToolCall }
  | {
      type: 'done';
      finishReason: string;
      cited: string[];
      dropped: number;
      degraded: boolean;
      usage?: AiUsage;
      followUps?: string[];
      lang?: string;
      alt?: { en: string };
    }
  | { type: 'error'; reason: AiFallbackReason };

/** GET /api/ai/health. The only source clients use for model names and tier. */
export type AiHealth = {
  enabled: boolean;
  configured: boolean;
  fake: boolean;
  tier: 'free' | 'paid' | 'unknown';
  models: { primary: string; fallback: string };
  cooling: string[];
  /** Present only under the fake model, for tests. */
  fakeStats?: AiFakeStats;
};

export type AiFakeStats = {
  /** Model attempts per model id, including ones that failed with a fake 429. */
  calls: Record<string, number>;
  /** Chunks pulled from fake streams. It stops rising once a client aborts. */
  pulls: number;
  embeds: number;
};
