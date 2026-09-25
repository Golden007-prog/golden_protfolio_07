'use client';

import Link from 'next/link';
import { MessageCircle, Square } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AIErrorState } from '@/components/ai/AIErrorState';
import { AiThinking } from '@/components/ai/AiThinking';
import { CitationChips } from '@/components/ai/CitationChips';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { StreamingText } from '@/components/ai/StreamingText';
import { SuggestedPrompts } from '@/components/ai/SuggestedPrompts';
import { useAiActionRunner } from '@/components/ai/useAiActionRunner';
import { useAiStream } from '@/components/ai/useAiStream';
import { Button } from '@/components/ui/Button';
import { getProjectBySlug } from '@/data/projects';
import { useMotionPrefs } from '@/hooks/useMotionPrefs';
import { openAssistant } from '@/lib/ai/bus';
import { AI_LIMITS } from '@/lib/ai/config';
import { projectQuickAnswer, projectStarters, type ProjectSource } from '@/lib/ai/prompts/projects';
import type { AiSource } from '@/lib/ai/protocol';
import { track } from '@/lib/analytics';

function QuickAnswer({ project, question }: { project: ProjectSource; question: string }) {
  const a = projectQuickAnswer(project, question);
  return (
    <div className="flex flex-col gap-2" data-quick-answer="">
      <SourceBadge source="rules" className="self-start" />
      <p className="text-sm leading-relaxed text-text-secondary">{a.text}</p>
      <p className="text-xs text-text-muted">
        Quoted from the {a.source.toLowerCase()} of {project.name} on this page.
      </p>
    </div>
  );
}

/**
 * 'Ask about this project' on /projects/<slug> (#201), where there is no dock.
 * Streams /api/ai/ask scoped to the project, with the answer's sources and the
 * AI disclosure. It never calls on mount. When the AI cannot answer it quotes the
 * page's own write-up instead and links to the full assistant on the home page.
 */
export function InlineAsk({ slug }: { slug: string }) {
  const project = getProjectBySlug(slug);
  const stream = useAiStream('/api/ai/ask');
  const runAction = useAiActionRunner();
  const { finePointer } = useMotionPrefs();
  const [draft, setDraft] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const headingId = useId();
  const inputId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);
  const focusAnswer = useRef(false);
  const wasRunning = useRef(false);
  const running = stream.status === 'submitted' || stream.status === 'streaming';

  /**
   * Call before a change that removes or disables the focused control (a suggested
   * question, Ask, Retry, Stop), or focus falls to <body>. It goes to the field under
   * a fine pointer, else to the answer, so no on-screen keyboard rises.
   */
  const holdFocus = () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === inputRef.current || !sectionRef.current?.contains(el)) return;
    if (finePointer) inputRef.current?.focus({ preventScroll: true });
    else if (answerRef.current) answerRef.current.focus({ preventScroll: true });
    // The first answer mounts in the commit this ask causes.
    else focusAnswer.current = true;
  };

  useLayoutEffect(() => {
    if (focusAnswer.current) {
      focusAnswer.current = false;
      answerRef.current?.focus({ preventScroll: true });
    } else if (wasRunning.current && !running && !draft.trim() && document.activeElement === buttonRef.current) {
      // An answer that settles under a focused Stop turns it back into Ask, disabled while the field is empty.
      holdFocus();
    }
    wasRunning.current = running;
  });

  if (!project) return null;

  const scope = { project: project.slug };

  const ask = (text: string) => {
    const question = text.replace(/\s+/g, ' ').trim().slice(0, AI_LIMITS.question);
    if (!question || running) return;
    holdFocus();
    setAsked(question);
    setDraft('');
    stream.start({ question, scope });
    track('ai_ask', { feature: 'ask', intent: 'project' });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
  };

  const stop = () => {
    holdFocus();
    stream.stop();
  };

  const openSource = (s: AiSource) => {
    track('ai_cite_click', { feature: 'ask' });
    runAction(s.target);
  };

  const sources = stream.meta?.sources ?? [];
  const answered = stream.status === 'streaming' || stream.status === 'done' || stream.status === 'stopped';
  // Every sentence was dropped as unverifiable: the write-up answers instead.
  const empty = stream.status === 'done' && !stream.text.trim();
  const followUps = stream.status === 'done' ? (stream.done?.followUps ?? []).slice(0, 3) : [];

  const handoff = (
    <Button asChild variant="ghost" size="md" className="-ml-3" leadingIcon={<MessageCircle aria-hidden="true" className="size-4" />}>
      <Link
        href="/"
        onClick={() => {
          openAssistant({ scope, ...(asked ? { question: asked } : {}) });
          track('ai_handoff', { feature: 'ask' });
        }}
      >
        Ask the full assistant on the home page
      </Link>
    </Button>
  );

  return (
    <section ref={sectionRef} aria-labelledby={headingId} className="flex flex-col gap-5" data-inline-ask="">
      <div>
        <h2 id={headingId} className="font-display text-2xl font-semibold text-text-primary sm:text-3xl">
          Ask about this project
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
          Answers come only from this site’s write-up of {project.name}, with sources.
        </p>
      </div>

      {!asked ? <SuggestedPrompts prompts={projectStarters(project)} onPick={ask} label="Suggested questions" /> : null}

      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor={inputId} className="text-sm text-text-secondary">
            Your question about {project.name}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={AI_LIMITS.question}
            autoComplete="off"
            enterKeyHint="send"
            placeholder={projectStarters(project)[1]}
            className="h-11 w-full rounded-full border border-glass-border-strong bg-glass-fill px-4 text-sm text-text-primary ring-focus transition-colors placeholder:text-text-muted hover:border-violet-bright"
          />
        </div>
        {/* One node for Ask and Stop, so a focused button survives the swap. */}
        <AIButton
          ref={buttonRef}
          type={running ? 'button' : 'submit'}
          onClick={running ? stop : undefined}
          disabled={!running && !draft.trim()}
          leadingIcon={running ? <Square aria-hidden="true" className="size-3.5 fill-current" /> : undefined}
        >
          {running ? 'Stop' : 'Ask'}
        </AIButton>
      </form>

      {asked ? (
        <div
          ref={answerRef}
          tabIndex={-1}
          className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface-tint p-4 ring-focus md:p-5"
          data-inline-answer={stream.status}
        >
          <p className="text-xs text-text-muted">
            You asked: <span className="text-text-secondary">{asked}</span>
          </p>

          {stream.status === 'submitted' ? <AiThinking /> : null}

          {answered && !empty ? (
            <>
              <StreamingText
                text={stream.text}
                streaming={stream.status === 'streaming'}
                sources={sources}
                onCite={openSource}
                className="text-sm leading-relaxed text-text-primary"
              />
              {stream.status === 'done' && stream.done ? (
                <CitationChips sources={sources} cited={stream.done.cited} text={stream.text} onOpen={openSource} />
              ) : null}
              {stream.done?.degraded ? (
                <div className="flex flex-col gap-3 border-t border-hairline pt-3">
                  <p className="text-xs text-text-muted">Some statements couldn’t be checked against the site and were removed.</p>
                  <QuickAnswer project={project} question={asked} />
                </div>
              ) : null}
              <AIDisclosure model={stream.meta?.model} />
            </>
          ) : null}

          {empty ? (
            <>
              <p className="text-xs text-text-muted">The AI’s answer couldn’t be checked against the site, so here is the write-up instead.</p>
              <QuickAnswer project={project} question={asked} />
            </>
          ) : null}

          {stream.status === 'fallback' && stream.fallback ? (
            <AIErrorState
              reason={stream.fallback.reason}
              retryAfterSec={stream.fallback.retryAfterSec}
              onRetry={() => {
                holdFocus();
                stream.start({ question: asked, scope });
              }}
            >
              <div className="flex flex-col gap-3">
                <QuickAnswer project={project} question={asked} />
                {handoff}
              </div>
            </AIErrorState>
          ) : null}

          {followUps.length ? <SuggestedPrompts prompts={followUps} onPick={ask} label="Follow-up questions" /> : null}
        </div>
      ) : null}

      {stream.status !== 'fallback' ? <div>{handoff}</div> : null}
    </section>
  );
}

export default InlineAsk;
