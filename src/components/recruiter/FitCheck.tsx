'use client';

import { useEffect, useId, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { MessageCircle, X } from 'lucide-react';
import achievementsRaw from '@/data/achievements.json';
import certificationsRaw from '@/data/certifications.json';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AIErrorState } from '@/components/ai/AIErrorState';
import { AiNotice } from '@/components/ai/AiNotice';
import { AiThinking } from '@/components/ai/AiThinking';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiActionRunner } from '@/components/ai/useAiActionRunner';
import { useAiJson } from '@/components/ai/useAiJson';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { openAssistant } from '@/lib/ai/bus';
import { clearAiSession, hashText, sessionGet, sessionSet } from '@/lib/ai/clientCache';
import {
  askAboutFact,
  buildMatrix,
  checkFitResponse,
  computeBand,
  factKindOf,
  factRow,
  factRowsFromJd,
  filterTechFor,
  focusSkillFor,
  isFactRequirement,
  lexicalHits,
  nextStage,
  normalizeJd,
  NOT_A_JD,
  rankProjectsByOverlap,
  roleFromJd,
  summaryText,
  type Band,
  type ExtractResponse,
  type FactRow,
  type FitData,
  type FitEvidence,
  type FitResponse,
  type FitRow,
  type FitView,
  type LexicalHit,
  type Requirement,
  type SiteLinks,
  type TopProject,
} from '@/lib/ai/fit';
import type { AiAction, AiFallbackReason, AiTarget } from '@/lib/ai/protocol';
import { parseAchievements } from '@/lib/achievements';
import { track } from '@/lib/analytics';
import { parseCertifications } from '@/lib/certifications';
import { emit } from '@/lib/events';
import { SITE } from '@/lib/site';
import { cn } from '@/utils/cn';
import { formatIsoDate, toYearMonth } from '@/utils/dates';
import { FitExport } from './FitExport';
import { FitHandoffs } from './FitHandoffs';
import { FitRowsTable } from './FitRow';
import { JdInput } from './JdInput';
import { RequirementChips } from './RequirementChips';
import { ScreeningQuestions, type QuestionItem } from './ScreeningQuestions';
import { SkillsMatrix } from './SkillsMatrix';
import { TopProjects } from './TopProjects';

// With the credentials and hackathon results, so cert: and achievement: evidence ids pass plausibleId.
const DATA: FitData = {
  profile,
  projects: PROJECTS,
  certifications: parseCertifications(certificationsRaw),
  achievements: parseAchievements(achievementsRaw),
};
const LINKS: SiteLinks = { url: SITE.url, cvUrl: `${SITE.url}${SITE.cvShortPath}`, builtAt: formatIsoDate(process.env.NEXT_PUBLIC_BUILD_TIME) };
const MATCH_STEP = `Matching against ${PROJECTS.length} projects and ${profile.experience.length} roles…`;
// After the sheet closes (scroll lock released), so the runner's scroll lands.
const AFTER_CLOSE_MS = 80;

type Extracted = Extract<ExtractResponse, { isJobDescription: true }>;
type Phase = 'idle' | 'extracting' | 'refused' | 'review' | 'matching' | 'done' | 'lexical';
type Note = { kind: 'fallback'; source: 'extract' | 'fit' } | { kind: 'unverified' } | { kind: 'stopped' } | null;

type State = {
  phase: Phase;
  /** The normalised JD the results belong to. */
  jd: string | null;
  lexical: LexicalHit[];
  jdFacts: FactRow[];
  extract: Extracted | null;
  requirements: Requirement[];
  fit: FitResponse | null;
  note: Note;
  /** Skeleton rows while a step runs: the requirement count once known. */
  expected: number;
};

type Action =
  | { type: 'submit'; jd: string; lexical: LexicalHit[]; jdFacts: FactRow[] }
  | { type: 'extracting' }
  | { type: 'refused' }
  | { type: 'extracted'; extract: Extracted; review: boolean }
  | { type: 'requirements'; requirements: Requirement[] }
  | { type: 'matching'; expected: number }
  | { type: 'matched'; fit: FitResponse }
  | { type: 'lexical'; note: Note }
  | { type: 'clear' };

const EMPTY: State = { phase: 'idle', jd: null, lexical: [], jdFacts: [], extract: null, requirements: [], fit: null, note: null, expected: 0 };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'submit':
      return { ...EMPTY, jd: a.jd, lexical: a.lexical, jdFacts: a.jdFacts, phase: 'extracting', expected: 2 };
    case 'extracting':
      return { ...s, phase: 'extracting' };
    case 'refused':
      return { ...s, phase: 'refused' };
    case 'extracted':
      return { ...s, extract: a.extract, requirements: a.extract.requirements, phase: a.review ? 'review' : s.phase };
    case 'requirements':
      return { ...s, requirements: a.requirements };
    case 'matching':
      return { ...s, phase: 'matching', expected: a.expected, fit: null, note: null };
    case 'matched':
      return { ...s, phase: 'done', fit: a.fit, note: null };
    case 'lexical':
      return { ...s, phase: 'lexical', note: a.note };
    case 'clear':
      return EMPTY;
  }
}

const NO_ROWS: FitRow[] = [];

const BAND_TONE: Record<Band, string> = { Strong: 'text-success', Partial: 'text-amber-text', Limited: 'text-text-secondary' };

/** Requirement-derived fact rows, topped up with any fact kind only the raw JD mentions. */
function mergeFacts(fromReqs: FactRow[], fromJd: FactRow[]): FactRow[] {
  const kinds = new Set(fromReqs.map((f) => f.fact));
  return [...fromReqs, ...fromJd.filter((f) => !kinds.has(f.fact))];
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** A JD handed over through openFit({jd}). */
  initialJd?: string;
  /** Bumps with every open request, so a new initialJd replaces the text. */
  requestSeq: number;
};

/**
 * The recruiter fit check: a modal on desktop, a sheet below 640px that follows
 * the visual viewport. On submit the exact keyword matches render at once (no
 * AI); then extraction (cheap tier), optional chip review, and matching (chat
 * tier) run, each cached per tab by a SHA-256 of the normalised JD. Every
 * failure path leaves the keyword table and the fact rows in place.
 */
export function FitCheck({ open, onClose, initialJd, requestSeq }: Props) {
  const titleId = useId();
  const wide = useMediaQuery('(min-width: 640px)');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const runRef = useRef(0);
  const runner = useAiActionRunner();
  const extractApi = useAiJson<ExtractResponse>('/api/ai/jd-extract');
  const fitApi = useAiJson<FitResponse>('/api/ai/jd-fit');

  const [state, dispatch] = useReducer(reducer, EMPTY);
  const [text, setText] = useState(initialJd ?? '');
  const [seenSeq, setSeenSeq] = useState(requestSeq);
  const [skipReview, setSkipReview] = useState(false);
  const [said, setSaid] = useState<{ text: string; seq: number } | null>(null);

  // A new openFit({jd}) replaces the text; reopening without one keeps the last check.
  if (seenSeq !== requestSeq) {
    setSeenSeq(requestSeq);
    if (initialJd) setText(initialJd);
  }

  const say = (message: string) => setSaid((prev) => ({ text: message, seq: (prev?.seq ?? 0) + 1 }));
  const busy = state.phase === 'extracting' || state.phase === 'matching';
  const today = toYearMonth(new Date());

  /* ---- the sheet follows the visual viewport, so the on-screen keyboard never hides it ---- */
  useEffect(() => {
    if (!open || wide) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const panel = bodyRef.current?.closest<HTMLElement>('[role="dialog"]');
        if (!panel) return;
        const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        panel.style.setProperty('--fit-kb', `${Math.round(keyboard)}px`);
        panel.style.setProperty('--fit-vvh', `${Math.round(vv.height)}px`);
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
    };
  }, [open, wide]);

  /* ---- the flow ---- */

  const lexicalSummary = (n: number) => (n === 1 ? '1 exact keyword match shown' : `${n} exact keyword matches shown`);

  const finishLexical = (note: Note, lexicalCount: number, lead: string) => {
    dispatch({ type: 'lexical', note });
    say(`${lead} ${lexicalSummary(lexicalCount)}.`);
  };

  const runMatch = async (run: number, jd: string, requirements: Requirement[], lexicalCount: number) => {
    const live = () => runRef.current === run;
    const key = await hashText(`${jd}\n${JSON.stringify(requirements)}`);
    if (!live()) return;
    let fit = sessionGet<FitResponse>('jd-fit', key);
    if (!fit) {
      dispatch({ type: 'matching', expected: Math.max(1, requirements.filter((r) => !isFactRequirement(r)).length) });
      const res = await fitApi.run({ jd, requirements });
      if (!live()) return;
      if (!res) return finishLexical({ kind: 'fallback', source: 'fit' }, lexicalCount, 'AI matching is unavailable.');
      const checked = checkFitResponse(res, DATA);
      if (checked.discarded) return finishLexical({ kind: 'unverified' }, lexicalCount, "The AI's matches couldn't be verified.");
      fit = checked.res;
      sessionSet('jd-fit', key, fit);
    }
    dispatch({ type: 'matched', fit });
    const band = computeBand(fit.rows);
    track('ai_fit_run', { feature: 'jd-fit', count: requirements.length, model: fit.model ?? 'none' });
    say(band ? `${band.band} match: ${summaryText(band.counts)}.` : `Checked ${requirements.length} requirements against the site's facts.`);
  };

  const submit = async () => {
    const jd = normalizeJd(text);
    if (!jd || busy) {
      textareaRef.current?.focus();
      return;
    }
    const run = ++runRef.current;
    const live = () => runRef.current === run;
    const lexical = lexicalHits(jd, DATA);
    dispatch({ type: 'submit', jd, lexical, jdFacts: factRowsFromJd(jd, profile, today) });

    const key = await hashText(jd);
    if (!live()) return;
    let extracted = sessionGet<ExtractResponse>('jd-extract', key);
    if (!extracted) {
      const res = await extractApi.run({ jd });
      if (!live()) return;
      if (!res) return finishLexical({ kind: 'fallback', source: 'extract' }, lexical.length, 'AI matching is unavailable.');
      extracted = res;
      sessionSet('jd-extract', key, res);
    }
    const stage = nextStage(extracted, skipReview);
    if (stage === 'refused' || !extracted.isJobDescription) {
      dispatch({ type: 'refused' });
      say(`${NOT_A_JD}.`);
      return;
    }
    dispatch({ type: 'extracted', extract: extracted, review: stage === 'review' });
    if (stage === 'review') {
      say(`${extracted.requirements.length} requirements found. Review them, then match.`);
      return;
    }
    await runMatch(run, jd, extracted.requirements, lexical.length);
  };

  const match = () => {
    if (!state.jd || busy || !state.requirements.length) return;
    const run = ++runRef.current;
    void runMatch(run, state.jd, state.requirements, state.lexical.length);
  };

  const stop = () => {
    runRef.current += 1;
    extractApi.abort();
    fitApi.abort();
    finishLexical({ kind: 'stopped' }, state.lexical.length, 'Check stopped.');
  };

  const clear = () => {
    runRef.current += 1;
    extractApi.abort();
    fitApi.abort();
    clearAiSession();
    setText('');
    dispatch({ type: 'clear' });
    say('Cleared. Nothing from this check is kept in this tab.');
    textareaRef.current?.focus();
  };

  // Esc (and a backdrop tap) first stops a running check; the next one closes.
  const requestClose = () => {
    if (busy) stop();
    else onClose();
  };

  const closeThen = (fn: () => void) => {
    if (busy) stop();
    onClose();
    window.setTimeout(fn, AFTER_CLOSE_MS);
  };
  const go = (x: AiTarget | AiAction) => closeThen(() => runner(x));

  /* ---- what the results show ---- */

  const aiDone = state.phase === 'done' && state.fit !== null;
  const rows = aiDone && state.fit ? state.fit.rows : NO_ROWS;
  const role = state.extract?.title ?? (state.jd ? roleFromJd(state.jd) : null);
  const reqFacts = useMemo(() => state.requirements.filter((r) => factKindOf(r) !== null).map((r) => factRow(r, profile, today)), [state.requirements, today]);
  const facts = aiDone || state.phase === 'review' ? mergeFacts(reqFacts, state.jdFacts) : state.jdFacts;
  const matrix = useMemo(() => buildMatrix(state.lexical, rows, DATA), [state.lexical, rows]);
  const topProjects: TopProject[] = useMemo(() => {
    if (aiDone) return state.fit!.projects;
    return state.jd ? rankProjectsByOverlap(state.jd, PROJECTS).slice(0, 3).map((p) => ({ slug: p.slug, quote: null, id: null, overlap: p.overlap })) : [];
  }, [aiDone, state.fit, state.jd]);
  const band = aiDone ? computeBand(rows) : null;

  const view: FitView = {
    mode: aiDone ? 'ai' : 'lexical',
    role,
    rows,
    facts,
    lexical: state.lexical,
    projects: topProjects.map((p) => ({ slug: p.slug, name: PROJECTS.find((x) => x.slug === p.slug)?.name ?? p.slug, quote: p.quote })),
    band,
  };

  const questionItems: QuestionItem[] = aiDone
    ? rows
        .filter((r) => r.status === 'evidenced' && r.evidence.length)
        .map((r) => ({ requirement: r.requirement, ids: r.evidence.map((e) => e.id), known: [r.requirement, ...r.evidence.flatMap((e) => [e.quote, e.label ?? ''])].join(' ') }))
    : state.lexical.map((h) => ({ requirement: h.term, ids: h.evidence.map((e) => e.id), known: [h.term, ...h.evidence.flatMap((e) => [e.quote, e.label ?? ''])].join(' ') }));

  const showMatches = filterTechFor(view, DATA) || focusSkillFor(view)
    ? () => {
        const tech = filterTechFor(view, DATA);
        const skill = focusSkillFor(view);
        closeThen(() => {
          if (tech) runner({ kind: 'filter', tech });
          if (skill) emit('skill:focus', { name: skill });
        });
      }
    : null;

  const noteReason: AiFallbackReason | null =
    state.note?.kind === 'fallback' ? ((state.note.source === 'extract' ? extractApi.fallback : fitApi.fallback)?.reason ?? 'upstream') : state.note?.kind === 'unverified' ? 'unverified' : null;
  const retryable = noteReason === 'timeout' || noteReason === 'upstream' || noteReason === 'rate-limited' || noteReason === 'unverified';
  const retry = () => {
    if (state.note?.kind === 'fallback' && state.note.source === 'extract') void submit();
    else match();
  };

  const onEvidence = (e: FitEvidence) => {
    if (e.target) go(e.target);
  };

  let status: ReactNode = null;
  if (state.phase === 'extracting') status = <AiThinking step="Reading the JD…" />;
  else if (state.phase === 'matching') status = <AiThinking step={MATCH_STEP} />;
  else if (state.phase === 'review') status = <p className="text-sm text-text-secondary">Review the requirements below, then match them against the site.</p>;
  else if (aiDone)
    status = band ? (
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-text-secondary" data-fit-band={band.band}>
        <span className={cn('font-display text-lg font-semibold', BAND_TONE[band.band])}>{band.band} match</span>
        <span>{summaryText(band.counts)}</span>
        <span className="text-xs text-text-muted">Computed from the rows; must-haves count double.</span>
      </p>
    ) : (
      <p className="text-sm text-text-secondary">Every requirement here is answered from the site&apos;s facts.</p>
    );
  else if (state.phase === 'lexical')
    status = (
      <p className="flex flex-wrap items-center gap-2 text-sm text-text-secondary" data-fit-lexical-note={state.note?.kind ?? ''}>
        <SourceBadge source="rules" />
        {state.note?.kind === 'stopped'
          ? 'Stopped. Showing exact keyword matches.'
          : state.note?.kind === 'unverified'
            ? "Showing exact keyword matches; the AI's matches couldn't be verified."
            : "Showing exact keyword matches; the AI check isn't available right now."}
      </p>
    );

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      labelledBy={titleId}
      initialFocusRef={textareaRef}
      variant={wide ? 'modal' : 'sheet'}
      panelClassName={cn(
        'fit-panel',
        wide ? 'max-w-3xl' : 'fit-sheet mb-[var(--fit-kb,0px)] max-h-[min(92dvh,calc(var(--fit-vvh,100dvh)_-_12px))]',
      )}
    >
      <div ref={bodyRef} data-fit-report="" className="flex flex-col gap-5 p-5 sm:p-7">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-h3 font-semibold text-text-primary">
              Check fit against your JD
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">
              Every match cites text on this site. Gaps are shown as gaps. Years, location and logistics come from the site&apos;s own facts.
            </p>
          </div>
          <Button variant="icon" aria-label="Close" onClick={() => closeThen(() => {})} data-fit-noprint="" className="-mr-2 -mt-1 shrink-0">
            <X aria-hidden="true" className="size-5" />
          </Button>
        </header>

        {state.jd === null ? <AiNotice feature="jd-extract" onDismiss={() => textareaRef.current?.focus()} /> : null}

        <JdInput
          value={text}
          onChange={setText}
          onSubmit={() => void submit()}
          busy={busy}
          skipReview={skipReview}
          onSkipReview={setSkipReview}
          onClear={clear}
          textareaRef={textareaRef}
        />

        {state.phase === 'refused' ? (
          <div data-fit-refused="" className="rounded-2xl border border-hairline bg-surface-tint p-4 text-sm text-text-secondary">
            <p className="text-text-primary">{NOT_A_JD}.</p>
            <p className="mt-1">Paste a role&apos;s description to check fit, or ask the site&apos;s assistant a question instead.</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              leadingIcon={<MessageCircle aria-hidden="true" className="size-4 shrink-0" />}
              onClick={() => closeThen(() => openAssistant({}))}
              data-fit-ask-assistant=""
            >
              Ask the assistant
            </Button>
          </div>
        ) : state.jd !== null ? (
          <section role="region" aria-label="Fit results" aria-busy={busy} data-fit-results={state.phase} className="flex flex-col gap-5">
            <div className="flex min-h-11 items-center">{status}</div>

            <SkillsMatrix rows={matrix} title={matrix.some((m) => m.mappedByAi) ? 'Skills matrix' : 'Exact keyword matches (no AI)'} onSkill={(name) => go({ kind: 'skill', name })} />

            {!aiDone && state.jdFacts.length && state.phase !== 'review' ? (
              <div className="fit-block">
                <h3 className="text-sm font-semibold text-text-primary">From the site&apos;s facts</h3>
                <FitRowsTable rows={[]} facts={state.jdFacts} onEvidence={onEvidence} onAskFact={(row) => go({ kind: 'prefill', ...askAboutFact(row, role) })} caption="Years, education and logistics, answered from the site's facts" />
              </div>
            ) : null}

            <div data-fit-slot="">
              {state.phase === 'review' ? (
                <div className="flex flex-col gap-5">
                  <RequirementChips
                    requirements={state.requirements}
                    onChange={(requirements) => dispatch({ type: 'requirements', requirements })}
                    onMatch={match}
                    busy={busy}
                    language={state.extract && !/^en\b/.test(state.extract.language) ? state.extract.language : null}
                  />
                  {facts.length ? (
                    <FitRowsTable rows={[]} facts={facts} onEvidence={onEvidence} onAskFact={(row) => go({ kind: 'prefill', ...askAboutFact(row, role) })} caption="Years, education and logistics, answered from the site's facts" />
                  ) : null}
                </div>
              ) : busy ? (
                <div aria-hidden="true" data-fit-skeleton={state.expected} className="flex flex-col gap-2">
                  {Array.from({ length: state.expected }, (_, i) => (
                    <div key={i} className="fit-skeleton-row" />
                  ))}
                </div>
              ) : aiDone ? (
                <div className="flex flex-col gap-5">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-text-primary">Requirement by requirement</h3>
                      <AIDisclosure compact />
                    </div>
                    <FitRowsTable rows={rows} facts={facts} onEvidence={onEvidence} onAskFact={(row) => go({ kind: 'prefill', ...askAboutFact(row, role) })} caption="Each requirement checked against the site" />
                  </div>
                  <TopProjects projects={topProjects} rankedBy={state.fit!.rankedBy} onShow={(slug) => go({ kind: 'project', slug })} />
                </div>
              ) : state.phase === 'lexical' ? (
                <div className="flex flex-col gap-5">
                  {retryable && noteReason ? (
                    <AIErrorState reason={noteReason} onRetry={retry} announce={false}>
                      {noteReason === 'unverified' ? <p className="text-text-muted">Couldn&apos;t verify the AI&apos;s matches against the site, so only exact keyword matches are shown.</p> : null}
                    </AIErrorState>
                  ) : null}
                  <TopProjects projects={topProjects} rankedBy="lexical" onShow={(slug) => go({ kind: 'project', slug })} />
                </div>
              ) : null}
            </div>

            {state.phase === 'done' || state.phase === 'lexical' ? (
              <>
                <ScreeningQuestions key={state.jd} items={questionItems} />
                <FitHandoffs view={view} links={LINKS} onPrefill={(detail) => go({ kind: 'prefill', ...detail })} onShowMatches={showMatches} />
                <FitExport view={view} links={LINKS} />
                <p className="text-xs text-text-muted">
                  Checked against site data built {LINKS.builtAt ?? 'recently'} · {LINKS.url.replace(/^https:\/\//, '')} · CV at {SITE.cvShortPath}
                </p>
              </>
            ) : null}
          </section>
        ) : null}

        <div data-fit-announcer="" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
          {said ? <span key={said.seq}>{said.text}</span> : null}
        </div>
      </div>
    </Dialog>
  );
}
