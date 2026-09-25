'use client';

import Link from 'next/link';
import { MessageCircle, Square } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
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
  const [draft, setDraft] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const headingId = useId();
  const inputId = useId();
  if (!project) return null;

  const running = stream.status === 'submitted' || stream.status === 'streaming';
  const scope = { project: project.slug };

  const ask = (text: string) => {
    const question = text.replace(/\s+/g, ' ').trim().slice(0, AI_LIMITS.question);
    if (!question || running) return;
    setAsked(question);
    setDraft('');
    stream.start({ question, scope });
    track('ai_ask', { feature: 'ask', intent: 'project' });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
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
    <section aria-labelledby={headingId} className="flex flex-col gap-5" data-inline-ask="">
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
        {running ? (
          <Button variant="secondary" onClick={stream.stop} leadingIcon={<Square aria-hidden="true" className="size-3.5 fill-current" />}>
            Stop
          </Button>
        ) : (
          <AIButton type="submit" disabled={!draft.trim()}>
            Ask
          </AIButton>
        )}
      </form>

      {asked ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-hairline bg-surface-tint p-4 md:p-5" data-inline-answer={stream.status}>
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
