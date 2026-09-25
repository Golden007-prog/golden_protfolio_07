import type { Content, FunctionDeclaration } from '@google/genai';
import { z } from 'zod';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import { AI_BUDGETS } from '@/lib/ai/config';
import { AI_MODELS } from '@/lib/ai/config.server';
import { packContext, passesGate, scopeFilter, type PackedContext } from '@/lib/ai/context';
import { getCorpus, retrieve, type Corpus } from '@/lib/ai/corpus.server';
import { keepAllowed } from '@/lib/ai/citations';
import { createFollowupSplitter, keepFollowups, parseFollowups, type FollowupNames } from '@/lib/ai/followups';
import { aiGenerate, aiStream, deadline, isFallback, textOf, usageOf, type AiStreamResult, type Deadline } from '@/lib/ai/gemini.server';
import { guard } from '@/lib/ai/guard.server';
import { cacheable, cacheKey, Lru } from '@/lib/ai/lru';
import { askUserTurn, buildAskSystem } from '@/lib/ai/prompts/ask';
import { newCanary, type Lang } from '@/lib/ai/prompts/base';
import type { AiFallbackReason, AiFrame, AiUsage, AskScope, RetrievalHit } from '@/lib/ai/protocol';
import { fallback, logAi, ndjson } from '@/lib/ai/respond.server';
import { rrf, tokenize } from '@/lib/ai/retrieval';
import { cleanText, scrubContacts } from '@/lib/ai/sanitize';
import { askRequestSchema } from '@/lib/ai/schemas';
import { detectScript, isNonLatinLang, localCheck, splitSentences } from '@/lib/ai/script';
import { createSentenceFilter } from '@/lib/ai/streamFilter';
import { toolDataFrom, toolDeclarations, validateToolCall, wantsNavigation } from '@/lib/ai/tools';
import { SECTIONS } from '@/lib/site';

export const maxDuration = 30;

/*
 * POST /api/ai/ask: the grounded concierge answer.
 *   1. guard('ask'), then the answer cache (only for requests with nothing
 *      visitor-specific in them, see lru.cacheable);
 *   2. retrieval over the question, and over the question plus the visitor's
 *      last questions and the scope's name, inside the scope;
 *   3. the relevance gate: no 'self' chunk above it answers 'low-relevance'
 *      without calling the model;
 *   4. packContext (scope anchors and the last answer's citations pinned);
 *   5. the system prompt (base honesty rules + prompts/ask.ts);
 *   6. aiStream on the chat tier, with the navigator's declarations only when
 *      the client asked for tools and the question reads as navigation;
 *   7. every sentence through the sentence filter before it leaves.
 * Frames: meta, verified deltas (and at most one validated tool call), done.
 * Questions in a non-Latin script get a buffered {en, local} answer instead: en
 * is filtered, local is shown only when it keeps en's numbers and names.
 */

const TOOL_DATA = toolDataFrom({
  sections: SECTIONS,
  projects: PROJECTS,
  skills: profile.skills,
});
const TOOL_DECLS = toolDeclarations(TOOL_DATA) as FunctionDeclaration[];

const FOLLOWUP_NAMES: FollowupNames = {
  projects: PROJECTS.map((p) => p.name),
  skills: TOOL_DATA.skills,
  companies: profile.experience.map((e) => e.company),
  sections: SECTIONS.map((s) => s.label),
};

const localSchema = z.object({
  en: z.string().max(4000),
  local: z.string().max(6000),
  lang: z.string().max(12),
});

type CachedAnswer = { model: string; frames: AiFrame[] };
// Per instance; keyed by the question, the scope, the configured models and the corpus hash.
const answers = new Lru<CachedAnswer>(200, 600_000);

const CITE = /\[c:([a-z]+:[\w#.-]+)\]/g;

function scopeName(scope: AskScope | undefined): { label: string; hint: string } | null {
  if (!scope) return null;
  if ('project' in scope) {
    const p = PROJECTS.find((x) => x.slug === scope.project);
    return p ? { label: `the "${p.name}" project`, hint: p.name } : null;
  }
  if ('skill' in scope) return { label: `the skill "${scope.skill}"`, hint: scope.skill };
  if ('experience' in scope) {
    const e = profile.experience[scope.experience];
    return e
      ? {
          label: `his "${e.role}" role at ${e.company}`,
          hint: `${e.role} ${e.company}`,
        }
      : null;
  }
  const s = SECTIONS.find((x) => x.id === scope.section);
  return s ? { label: `the ${s.label} section of the site`, hint: s.label } : null;
}

/** Hits from several queries fused into one ranking; each id keeps its first scores. */
function fuse(lists: RetrievalHit[][], k: number): RetrievalHit[] {
  const first = new Map<string, RetrievalHit>();
  for (const list of lists) for (const h of list) if (!first.has(h.id)) first.set(h.id, h);
  return rrf(lists.map((l) => l.map((h) => h.id)))
    .slice(0, k)
    .map((f, i) => ({ ...first.get(f.id)!, rank: i + 1, score: f.score }));
}

/**
 * The question's search terms that the site's text contains, when they are at
 * least half of its terms, else null. BM25's normalised score counts every term
 * the corpus lacks at full weight, so a reference number or a stray token pulls
 * an on-topic question under the gate; this query gates on the terms the site
 * can answer to.
 */
function onSiteTerms(question: string, df: ReadonlyMap<string, number>): string | null {
  const terms = tokenize(question);
  const known = terms.filter((t) => df.has(t));
  return terms.length > 0 && known.length * 2 >= terms.length ? known.join(' ') : null;
}

// A question about him (the rule answers speak as him, so visitors say 'you' too).
// It needs no search term to be on topic: the core card is always in context and
// the model says when the site doesn't cover it.
const ABOUT_HIM = /\b(?:he|his|him|himself|he['’]s|oikantik|basu|you|your|yours|yourself)\b/i;

function canaryIn(text: string, canary: string): boolean {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return key(text).includes(key(canary));
}

function filterFor(corpus: Corpus, packed: PackedContext, canary: string) {
  return createSentenceFilter({
    allowed: packed.allowed,
    facts: packed.facts,
    entities: corpus.entities,
    canary,
    allow: {
      urls: corpus.entities.allowUrls,
      emails: corpus.entities.allowEmails,
      phones: [],
    },
  });
}

type Ctx = {
  started: number;
  corpus: Corpus;
  packed: PackedContext;
  canary: string;
  meta: Extract<AiFrame, { type: 'meta' }>;
  lang: Lang | null;
  tools: boolean;
  cacheAs: string | null;
  top: number;
};

export async function POST(req: Request) {
  const started = Date.now();
  const g = await guard(req, 'ask', { schema: askRequestSchema });
  if (!g.ok) return g.res;
  const body = g.body;
  const question = body.question;
  const lang = (body.lang ?? null) as Lang | null;
  const dl = deadline(req.signal);

  try {
    const corpus = getCorpus();
    const cacheAs = cacheable(body)
      ? cacheKey({
          feature: 'ask',
          question,
          scope: body.scope,
          model: `${AI_MODELS.primary}+${AI_MODELS.fallback}`,
          corpusHash: corpus.hash,
        })
      : null;
    const hit = cacheAs ? answers.get(cacheAs) : undefined;
    if (hit) {
      logAi({ feature: 'ask', model: hit.model, ms: Date.now() - started });
      return ndjson(replay(hit.frames, true), {
        model: hit.model,
        maxChars: AI_BUDGETS.ask.maxChars,
      });
    }

    // 2. Retrieval, inside the scope.
    const scope = body.scope;
    const named = scopeName(scope);
    const filter = scope ? scopeFilter(scope, { projects: PROJECTS, profile }) : undefined;
    const context = [...(body.history ?? []).slice(-2), named?.hint ?? ''].filter(Boolean).join(' ');
    const queries = context ? [question, `${question} ${context}`] : [question];
    const results = await Promise.all(queries.map((q) => retrieve(q, { k: 8, filter, dl, embed: true })));
    const hits = fuse(
      results.map((r) => r.hits),
      10,
    );
    const mode = results.some((r) => r.mode === 'hybrid') ? 'hybrid' : 'lexical';
    const top = Math.max(0, ...hits.map((h) => h.cosine ?? h.bm25));

    // 3. The relevance gate. BM25 cannot read a question in another language, so
    // without a query embedding such a question goes on to the model, whose
    // answer is filtered like any other.
    const foreign = isNonLatinLang(lang) || (lang !== null && lang !== 'en') || !['latin', 'other'].includes(detectScript(question));
    let gateOk = results.some((r) => passesGate(r.hits, corpus.byId)) || (foreign && mode === 'lexical') || ABOUT_HIM.test(question);
    if (!gateOk) {
      const terms = onSiteTerms(question, corpus.index.df);
      if (terms) gateOk = passesGate((await retrieve(terms, { k: 8, filter, dl, embed: false })).hits, corpus.byId);
    }
    if (!gateOk) {
      logAi({
        feature: 'ask',
        ms: Date.now() - started,
        reason: 'low-relevance',
        top,
      });
      return fallback('low-relevance');
    }

    // 4-5. Context and prompt.
    const packed = packContext({
      chunks: corpus.chunks,
      byId: corpus.byId,
      hits,
      scope,
      prevCited: body.prevCited,
      mode: 'retrieval',
      filter,
    });
    const canary = newCanary();
    const tools = body.tools === true && wantsNavigation(question);
    const contents: Content[] = [
      {
        role: 'user',
        parts: [
          {
            text: askUserTurn(question, {
              history: body.history,
              scopeLabel: named?.label,
            }),
          },
        ],
      },
    ];
    const meta: Ctx['meta'] = {
      type: 'meta',
      model: '',
      feature: 'ask',
      sources: packed.sources,
      retrieval: hits,
      mode,
    };
    const ctx: Ctx = {
      started,
      corpus,
      packed,
      canary,
      meta,
      lang,
      tools,
      cacheAs,
      top,
    };

    if (isNonLatinLang(lang)) return await buffered(ctx, contents, dl);

    // 6. Stream.
    const system = buildAskSystem({
      context: packed.text,
      canary,
      lang,
      tools,
    });
    const res = await aiStream({
      feature: 'ask',
      system,
      contents,
      tools: tools ? TOOL_DECLS : undefined,
      dl,
    });
    if (isFallback(res)) {
      logAi({
        feature: 'ask',
        ms: Date.now() - started,
        reason: res.reason,
        top,
      });
      return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
    }
    meta.model = res.model;
    return ndjson(streamed(ctx, res), {
      model: res.model,
      abort: res.abort,
      maxChars: AI_BUDGETS.ask.maxChars,
    });
  } catch (err) {
    console.warn(`[ai] ask failed: ${err instanceof Error ? err.name : typeof err}`);
    const reason = dl.timedOut() ? 'timeout' : 'upstream';
    logAi({ feature: 'ask', ms: Date.now() - started, reason });
    return fallback(reason);
  }
}

/** Frames from memory. A cached answer's meta says so (an extra field the client reads for its Details panel). */
async function* replay(frames: readonly AiFrame[], cached = false): AsyncGenerator<AiFrame> {
  for (const [i, f] of frames.entries()) yield cached && i === 0 && f.type === 'meta' ? ({ ...f, cached: true } as AiFrame) : f;
}

/** 7. The live answer: every sentence passes the filter before it is framed. */
async function* streamed(ctx: Ctx, res: AiStreamResult): AsyncGenerator<AiFrame> {
  const { corpus, packed, canary, meta, lang, tools } = ctx;
  const filter = filterFor(corpus, packed, canary);
  const splitter = createFollowupSplitter();
  // Outside English the filter's claim detection is weaker, so an uncited sentence is withheld.
  const strict = lang !== null && lang !== 'en';
  const frames: AiFrame[] = [meta];
  const shown = new Set<string>();
  let usage: AiUsage | undefined;
  let finishReason = 'STOP';
  let blocked = false;
  let toolSent = false;
  let withheld = 0;
  let dropped = 0;
  let failure: AiFallbackReason | null = null;

  const release = (sentences: string[]): AiFrame[] => {
    const out: AiFrame[] = [];
    for (const s of sentences) {
      const ids = [...s.matchAll(CITE)].map((m) => m[1]);
      if (strict && ids.length === 0 && /[\p{L}\p{N}]/u.test(s)) {
        withheld += 1;
        continue;
      }
      for (const id of ids) shown.add(id);
      out.push({ type: 'delta', text: s });
    }
    return out;
  };

  try {
    yield meta;
    for await (const chunk of res.stream) {
      usage = usageOf(chunk) ?? usage;
      const finish = chunk.candidates?.[0]?.finishReason;
      if (finish) finishReason = String(finish);

      const text = textOf(chunk);
      if (text) {
        const forward = splitter.push(text);
        if (forward) {
          const r = filter.push(forward);
          if (r.blocked) {
            blocked = true;
            break;
          }
          for (const f of release(r.emit)) {
            frames.push(f);
            yield f;
          }
        }
      }

      if (tools && !toolSent) {
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          if (!part.functionCall) continue;
          const call = validateToolCall(
            {
              name: part.functionCall.name,
              args: part.functionCall.args ?? {},
            },
            TOOL_DATA,
          );
          if (!call) continue;
          toolSent = true;
          const f: AiFrame = { type: 'tool', call };
          frames.push(f);
          yield f;
          break;
        }
      }
    }

    let followUps: string[] = [];
    if (!blocked) {
      const tail = splitter.end();
      if (tail.text) {
        const r = filter.push(tail.text);
        if (r.blocked) blocked = true;
        else
          for (const f of release(r.emit)) {
            frames.push(f);
            yield f;
          }
      }
      followUps = keepFollowups(parseFollowups(tail.raw), FOLLOWUP_NAMES);
    }
    const end = filter.end();
    if (end.blocked) blocked = true;
    if (!blocked) {
      for (const f of release(end.emit)) {
        frames.push(f);
        yield f;
      }
    }
    dropped = end.dropped + withheld;
    const total = end.kept + end.dropped;
    const degraded = blocked || end.degraded || (total > 0 && dropped / total > 0.3);
    const done: AiFrame = {
      type: 'done',
      finishReason: blocked ? 'BLOCKED' : finishReason,
      cited: blocked ? [] : [...shown],
      dropped,
      degraded,
      ...(usage ? { usage } : {}),
      ...(!blocked && followUps.length ? { followUps } : {}),
      ...(lang && lang !== 'en' ? { lang } : {}),
    };
    // Reaching here means every delta was accepted (the character cap never cut in).
    if (ctx.cacheAs && !degraded && !toolSent && /^STOP$/i.test(finishReason)) {
      answers.set(ctx.cacheAs, { model: res.model, frames: [...frames, done] });
    }
    yield done;
  } catch (err) {
    // respond.server turns this into the error frame; only the reason is kept for the log.
    const reason = (err as { reason?: unknown } | null)?.reason;
    failure = typeof reason === 'string' ? (reason as AiFallbackReason) : 'upstream';
    throw err;
  } finally {
    logAi({
      feature: 'ask',
      model: res.model,
      ms: Date.now() - ctx.started,
      ttftMs: res.ttftMs,
      usage,
      top: ctx.top,
      dropped,
      ...(failure ? { reason: failure } : {}),
    });
  }
}

/** Non-Latin scripts: one buffered {en, local} answer, checked before anything is framed. */
async function buffered(ctx: Ctx, contents: Content[], dl: Deadline): Promise<Response> {
  const { corpus, packed, canary, meta, lang } = ctx;
  const system = buildAskSystem({
    context: packed.text,
    canary,
    lang,
    json: true,
  });
  const res = await aiGenerate({
    feature: 'ask',
    system,
    contents,
    schema: localSchema,
    dl,
  });
  if (isFallback(res)) {
    logAi({
      feature: 'ask',
      ms: Date.now() - ctx.started,
      reason: res.reason,
      top: ctx.top,
    });
    return fallback(res.reason, res.retryAfterSec ? { retryAfterSec: res.retryAfterSec } : undefined);
  }
  meta.model = res.model;
  const data = res.data!;
  const filter = filterFor(corpus, packed, canary);
  const pushed = filter.push(data.en);
  const end = filter.end();
  const blocked = Boolean(pushed.blocked || end.blocked);
  const en = blocked ? '' : [...pushed.emit, ...end.emit].join('').trim();

  const allow = {
    urls: corpus.entities.allowUrls,
    emails: corpus.entities.allowEmails,
    phones: [],
  };
  const localClean = keepAllowed(scrubContacts(cleanText(data.local), allow), packed.allowed).text.trim();
  // A translation of a sentence the filter dropped would slip through, so any drop means English only.
  const localOk =
    Boolean(en) && end.dropped === 0 && !end.degraded && !canaryIn(localClean, canary) && localCheck(en, localClean, corpus.entities).ok;

  const shownText = localOk ? localClean : en;
  const frames: AiFrame[] = [
    meta,
    ...splitSentences(shownText).map((text): AiFrame => ({
      type: 'delta',
      text,
    })),
  ];
  const cited = [...new Set([...en.matchAll(CITE)].map((m) => m[1]))];
  frames.push({
    type: 'done',
    finishReason: blocked ? 'BLOCKED' : res.finishReason,
    cited,
    dropped: end.dropped,
    degraded: blocked || end.degraded,
    ...(res.usage ? { usage: res.usage } : {}),
    ...(localOk && lang ? { lang, alt: { en } } : {}),
  });
  logAi({
    feature: 'ask',
    model: res.model,
    ms: Date.now() - ctx.started,
    usage: res.usage,
    top: ctx.top,
    dropped: end.dropped,
  });
  return ndjson(replay(frames), {
    model: res.model,
    maxChars: AI_BUDGETS.ask.maxChars,
  });
}
