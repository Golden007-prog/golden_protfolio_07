'use client';

import { useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, Languages, PenLine } from 'lucide-react';
import projects from '@/data/projects.json';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { FALLBACK_COPY } from '@/components/ai/AIErrorState';
import { AiThinking } from '@/components/ai/AiThinking';
import { CitationChips } from '@/components/ai/CitationChips';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { StreamingText } from '@/components/ai/StreamingText';
import { LottieIcon } from '@/components/shared/LottieIcon';
import { Button } from '@/components/ui/Button';
import { DownloadCvButton } from '@/components/ui/DownloadCvButton';
import { LANG_NAMES, type Lang } from '@/lib/ai/prompts/base';
import type { AiSource } from '@/lib/ai/protocol';
import { safeLangTag } from '@/lib/ai/script';
import { slugify } from '@/lib/slug';
import { isRefusal, type AskAnswer } from '@/utils/askme';
import { AnswerActions, answerMarkdown } from './AnswerActions';
import { AnswerDetails } from './AnswerDetails';
import type { AiMsg, RuleMsg, RuleNote } from './useConversation';

type Project = (typeof projects)[number];
export const BY_SLUG = new Map<string, Project>(projects.map((p) => [slugify(p.name), p]));

// Chips and links inside answers: 36px under a mouse, 44px on touch (tap-safe-sm).
const CHIP =
  'tap-safe-sm inline-flex items-center gap-1 rounded-full border border-glass-border bg-glass-fill px-3 text-xs font-medium text-text-secondary ring-focus transition-colors hover:border-glass-border-strong hover:text-text-primary';
const BUBBLE =
  'max-w-[92%] min-w-0 rounded-2xl rounded-bl-md border border-glass-border bg-surface-tint px-3.5 py-2.5 text-sm leading-relaxed text-text-secondary';

export function renderInline(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <span key={i} className="block">
      {line.split(/\*\*(.+?)\*\*/g).map((part, j) =>
        j % 2 === 1 ? (
          <strong key={j} className="font-semibold text-text-primary">
            {part}
          </strong>
        ) : (
          <span key={j}>{part}</span>
        ),
      )}
    </span>
  ));
}

export function MiniProject({ slug, onShow }: { slug: string; onShow: (slug: string) => void }) {
  const p = BY_SLUG.get(slug);
  const [imgOk, setImgOk] = useState(true);
  if (!p) return null;
  return (
    <div data-ask-project={slug} className="flex gap-3 rounded-xl border border-glass-border bg-glass-fill p-2">
      {imgOk && p.thumbnail ? (
        // Thumbnails are a mix of local and GitHub-hosted files, shown at 64px; next/image adds nothing here.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.thumbnail}
          alt=""
          width={64}
          height={48}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgOk(false)}
          className="h-12 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span aria-hidden="true" className="h-12 w-16 shrink-0 rounded-lg bg-heat-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-5 text-text-primary">{p.name}</p>
        <p className="line-clamp-2 text-xs leading-4 text-text-muted">{p.tagline}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onShow(slug)} className={CHIP} data-cursor="open">
            Show in Projects
          </button>
          {p.liveUrl ? (
            <a href={p.liveUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
              Live
              <ArrowUpRight aria-hidden="true" className="size-3" />
              <span className="sr-only"> demo of {p.name} (opens in new tab)</span>
            </a>
          ) : null}
          <a href={p.githubUrl} target="_blank" rel="noopener noreferrer" className={CHIP}>
            Code
            <ArrowUpRight aria-hidden="true" className="size-3" />
            <span className="sr-only"> of {p.name} on GitHub (opens in new tab)</span>
          </a>
        </div>
      </div>
    </div>
  );
}

export type BubbleHandlers = {
  onShowProject: (slug: string) => void;
  onWrite: (draft: string) => void;
  onCite: (source: AiSource) => void;
  onUndo: (id: number) => void;
  onRegenerate: (msg: AiMsg) => void;
  caseStudySlugs: ReadonlySet<string>;
};

/**
 * A rule answer's body: its text, project cards, and its links, CV and
 * handoff. The links only ever come from the rule engine (askme.ts), never
 * from model output.
 */
export function RuleAnswerBody({
  answer,
  text,
  handlers,
}: {
  answer?: AskAnswer;
  text: string;
  handlers: Pick<BubbleHandlers, 'onShowProject' | 'onWrite'>;
}) {
  const draft = answer?.handoff;
  return (
    <>
      <div>{renderInline(text)}</div>
      {answer && answer.projects.length > 0 ? (
        <div className="mt-2.5 grid gap-2">
          {answer.projects.map((slug) => (
            <MiniProject key={slug} slug={slug} onShow={handlers.onShowProject} />
          ))}
        </div>
      ) : null}
      {answer && (answer.actions.length > 0 || draft) ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {answer.actions.map((act) =>
            act.kind === 'cv' ? (
              <DownloadCvButton key="cv" variant="secondary" size="sm" />
            ) : (
              <Button key={act.href} href={act.href} external={act.external} variant="secondary" size="sm" cursor="open">
                {act.label}
              </Button>
            ),
          )}
          {draft ? (
            <Button
              variant="primary"
              size="sm"
              shine={false}
              leadingIcon={<PenLine aria-hidden="true" className="size-3.5" />}
              onClick={() => handlers.onWrite(draft)}
              data-ask-handoff=""
            >
              Write to Oikantik
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

const NOTE_TEXT: Record<Exclude<RuleNote, 'unavailable'>, string> = {
  resting: FALLBACK_COPY.quota.text,
  nothing: FALLBACK_COPY['low-relevance'].text,
  uncited: "The AI answer couldn't be tied to this site's content, so here is the quick answer instead.",
  cap: "That's all the AI answers for this visit. Quick answers still work.",
  stopped: 'Stopped before an answer arrived. Here is the quick answer.',
};

function FallbackNote({ note, reason }: Pick<RuleMsg, 'note' | 'reason'>) {
  if (!note) return null;
  const copy = note === 'unavailable' ? FALLBACK_COPY[reason ?? 'upstream'] : null;
  const text = copy
    ? `${copy.text}${reason === 'rate-limited' ? ' Give it a minute.' : ''}`
    : NOTE_TEXT[note as Exclude<RuleNote, 'unavailable'>];
  const Icon = (copy ?? FALLBACK_COPY[note === 'nothing' ? 'low-relevance' : 'quota']).icon;
  return (
    <p
      data-ask-note={note}
      className="mb-2 flex items-start gap-2 rounded-xl border border-hairline bg-glass-fill px-3 py-2 text-xs leading-relaxed text-text-secondary"
    >
      <span className="mt-px grid size-4 shrink-0 place-items-center text-text-muted">
        <LottieIcon
          name="error"
          play="once"
          lazy={false}
          className="block size-4"
          fallback={<Icon aria-hidden="true" className="size-4" />}
        />
      </span>
      <span>{text}</span>
    </p>
  );
}

/** A rule-engine bubble: the greeting, a quick answer, or the quick answer shown after an AI fallback. */
export function RuleBubble({ msg, handlers }: { msg: RuleMsg; handlers: BubbleHandlers }) {
  const a = msg.answer;
  const nothing = msg.note === 'nothing' && (!a || a.intent === 'fallback');
  return (
    <div className="flex justify-start" data-ask-answer={a?.intent ?? 'greeting'} data-source="rules" data-note={msg.note}>
      <div className={BUBBLE}>
        <SourceBadge source="rules" className="mb-2" />
        <FallbackNote note={msg.note} reason={msg.reason} />
        {nothing ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="basis-full">You can ask Oikantik directly; the question goes into the contact form for you to send.</p>
            <Button
              variant="primary"
              size="sm"
              shine={false}
              leadingIcon={<PenLine aria-hidden="true" className="size-3.5" />}
              onClick={() =>
                handlers.onWrite(
                  msg.question ? `Hi Oikantik, I have a question: ${msg.question}` : "Hi Oikantik, I'd like to ask you something.",
                )
              }
              data-ask-handoff=""
            >
              Write to Oikantik
            </Button>
          </div>
        ) : (
          <RuleAnswerBody answer={a} text={msg.text} handlers={handlers} />
        )}
        {msg.english ? <p className="mt-2 text-xs text-text-muted">Quick answers are in English.</p> : null}
      </div>
    </div>
  );
}

type AiProps = {
  msg: AiMsg;
  /** Rendered from the live stream, outside the log. */
  streaming?: boolean;
  /** Waiting for the first sentence. */
  thinking?: boolean;
  /** A tool call arrived and has not run yet. */
  toolPending?: boolean;
  /** The newest answer: Regenerate and the completion flourish live here. */
  latest?: boolean;
  /** Committed during this visit to the panel (not restored from the session). */
  fresh?: boolean;
  regenLeft: number;
  handlers: BubbleHandlers;
};

/** An AI answer: verified sentences with numbered source chips, and everything that lets a visitor check it. */
export function AiBubble({
  msg,
  streaming = false,
  thinking = false,
  toolPending = false,
  latest = false,
  fresh = false,
  regenLeft,
  handlers,
}: AiProps) {
  const [english, setEnglish] = useState(false);
  const [quickShown, setQuickShown] = useState(false);
  const lang = safeLangTag(msg.lang);
  const shown = english && msg.en ? msg.en : msg.text;
  const shownLang = english || !lang ? undefined : lang;
  const requested = safeLangTag(msg.requestedLang);
  const langName = (l: Lang) => LANG_NAMES[l];
  const settled = !streaming;
  const projectSlugs = settled
    ? [
        ...new Set(
          msg.sources
            .filter((s) => msg.cited.includes(s.id) && s.target.kind === 'project')
            .map((s) => (s.target as { slug: string }).slug),
        ),
      ]
        .filter((slug) => BY_SLUG.has(slug))
        .slice(0, 3)
    : [];
  const plain = shown
    .replace(/\[c:[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div
      className="flex justify-start"
      data-ask-answer="ai"
      data-source={msg.cached ? 'cache' : 'ai'}
      data-status={streaming ? 'streaming' : msg.status}
      data-degraded={msg.degraded ? '' : undefined}
    >
      <div className={BUBBLE}>
        <div className="mb-2 flex items-center gap-2">
          <SourceBadge source={msg.cached ? 'cache' : 'ai'} />
          {fresh && latest && settled && msg.status === 'done' ? (
            <LottieIcon name="sparkle" play="once" lazy={false} className="block size-5" fallback={null} />
          ) : null}
        </div>

        {thinking ? <AiThinking /> : null}
        {shown ? (
          <StreamingText
            text={shown}
            streaming={streaming}
            sources={msg.sources}
            onCite={handlers.onCite}
            announce={false}
            lang={shownLang}
          />
        ) : null}
        {toolPending ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-text-muted">
            <LottieIcon
              name="dots"
              play="auto"
              loop
              lazy={false}
              className="block h-4 w-8"
              fallback={
                <span className="ai-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              }
            />
            <span>Working on it…</span>
          </p>
        ) : null}

        {settled && msg.status === 'stopped' ? (
          <p data-ask-stopped="" className="mt-2 text-xs text-text-muted">
            Stopped. The answer above is incomplete.
          </p>
        ) : null}
        {settled && requested && !lang && msg.text ? (
          <p className="mt-2 text-xs text-text-muted">
            Shown in English: the {langName(requested)} version couldn&apos;t be checked against it.
          </p>
        ) : null}
        {settled && lang && msg.en ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1"
            leadingIcon={<Languages aria-hidden="true" className="size-3.5" />}
            aria-pressed={english}
            onClick={() => setEnglish((v) => !v)}
            data-ask-english=""
          >
            Show in English
          </Button>
        ) : null}

        {msg.step ? (
          <p
            data-ask-step=""
            className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-glass-fill px-3 py-1 text-xs text-text-secondary"
          >
            <Check aria-hidden="true" className="size-3.5 shrink-0 text-cyan-text" />
            <span>{msg.step.label}</span>
            {msg.step.undo && !msg.step.undone ? (
              <Button variant="ghost" size="sm" className="-my-1" onClick={() => handlers.onUndo(msg.id)} data-ask-undo="">
                Undo
              </Button>
            ) : msg.step.undone ? (
              <span className="text-text-muted">Undone</span>
            ) : null}
          </p>
        ) : null}

        {settled && msg.degraded ? (
          <div className="mt-2" data-ask-degraded="">
            <p className="mb-2 rounded-xl border border-hairline bg-glass-fill px-3 py-2 text-xs text-text-secondary">
              Some statements couldn&apos;t be checked against the site and were removed.
            </p>
            <RuleAnswerBody answer={msg.rule} text={msg.rule.text} handlers={handlers} />
          </div>
        ) : null}

        {projectSlugs.length ? (
          <div className="mt-2.5 grid gap-2">
            {projectSlugs.map((slug) => (
              <MiniProject key={slug} slug={slug} onShow={handlers.onShowProject} />
            ))}
          </div>
        ) : null}

        {settled && shown && msg.cited.length === 0 && isRefusal(shown) ? (
          <Button
            variant="primary"
            size="sm"
            shine={false}
            className="mt-2"
            leadingIcon={<PenLine aria-hidden="true" className="size-3.5" />}
            onClick={() => handlers.onWrite(`Hi Oikantik, I have a question: ${msg.question}`)}
            data-ask-handoff=""
          >
            Write to Oikantik
          </Button>
        ) : null}

        {settled ? (
          <>
            <CitationChips sources={msg.sources} cited={msg.cited} onOpen={handlers.onCite} text={shown} />
            <AIDisclosure compact className="mt-3" />
            {shown ? (
              <AnswerActions
                markdown={answerMarkdown(shown, msg.sources, handlers.caseStudySlugs)}
                model={msg.model}
                onWrong={() =>
                  handlers.onWrite(
                    `The site assistant's answer looked wrong.\n\nMy question: ${msg.question}\n\nIts answer: ${plain || '(no answer text)'}\n\nWhat's wrong: `.slice(
                      0,
                      2000,
                    ),
                  )
                }
                onRegenerate={latest && regenLeft > 0 ? () => handlers.onRegenerate(msg) : undefined}
                regenLeft={regenLeft}
                quickShown={quickShown}
                onToggleQuick={() => setQuickShown((v) => !v)}
              />
            ) : null}
            {quickShown ? (
              <div className="mt-2 rounded-xl border border-hairline bg-glass-fill px-3 py-2" data-ask-quick-answer="">
                <SourceBadge source="rules" className="mb-2" />
                <RuleAnswerBody answer={msg.rule} text={msg.rule.text} handlers={handlers} />
              </div>
            ) : null}
            <AnswerDetails
              model={msg.model}
              route={msg.cached ? 'cache' : 'RAG'}
              mode={msg.mode}
              ttftMs={msg.ttftMs}
              totalMs={msg.totalMs}
              usage={msg.usage}
              retrieval={msg.retrieval}
              sources={msg.sources}
              cited={msg.cited}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
