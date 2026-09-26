'use client';

import { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import achievementsRaw from '@/data/achievements.json';
import certificationsRaw from '@/data/certifications.json';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { AiNotice } from '@/components/ai/AiNotice';
import { useAiJson } from '@/components/ai/useAiJson';
import { hashText, sessionGet, sessionSet } from '@/lib/ai/clientCache';
import { AI_LIMITS } from '@/lib/ai/config';
import { nearestLens, plausibleId, type BriefResponse, type FitData, type FitEvidence, type LensId } from '@/lib/ai/fit';
import type { AiTarget } from '@/lib/ai/protocol';
import { parseAchievements } from '@/lib/achievements';
import { track } from '@/lib/analytics';
import { parseCertifications } from '@/lib/certifications';
import { cn } from '@/utils/cn';

// With the credentials and hackathon results, so cert: and achievement: evidence ids pass plausibleId.
const DATA: FitData = {
  profile,
  projects: PROJECTS,
  certifications: parseCertifications(certificationsRaw),
  achievements: parseAchievements(achievementsRaw),
};
const NAME = new Map(PROJECTS.map((p) => [p.slug, p.name]));

/** The client's second look: claims citing ids the site cannot have are dropped; mostly dropped reads as discarded. */
function clientCheck(res: BriefResponse): BriefResponse | null {
  const claims = (res.claims ?? []).filter((c) => c.evidence?.length && c.evidence.every((e) => plausibleId(e.id, DATA)));
  const total = res.claims?.length ?? 0;
  if (!claims.length || (total > 0 && (total - claims.length) / total > 0.3)) return null;
  return { ...res, claims, projects: (res.projects ?? []).filter((s) => NAME.has(s)).slice(0, 3) };
}

const CHIP =
  'tap-safe min-w-0 max-w-full justify-start gap-1.5 rounded-full border border-glass-border bg-glass-fill px-3 text-left text-xs text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary';

type Props = {
  /** The preset lenses on show; a discarded brief falls back to the nearest one. */
  available: readonly LensId[];
  onLens: (id: LensId) => void;
  /** Runs a target after the pitch closes. */
  onOpen: (target: AiTarget) => void;
};

/**
 * 'I'm hiring for: ___' (up to 80 characters) on the chat tier. Buffered JSON,
 * never streamed: every claim is verified on the server before any renders, and
 * checked again here. A discarded or failed brief shows the nearest preset lens.
 */
export function RoleBrief({ available, onLens, onOpen }: Props) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [shown, setShown] = useState<BriefResponse | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const api = useAiJson<BriefResponse>('/api/ai/brief');

  const submit = async () => {
    const t = title.replace(/\s+/g, ' ').trim().slice(0, AI_LIMITS.title);
    if (t.length < 2 || api.status === 'loading') return;
    setAsked(t);
    setNote(null);
    setShown(null);
    const key = await hashText(t.toLowerCase());
    const hit = sessionGet<BriefResponse>('brief', key);
    if (hit) {
      setShown(hit);
      return;
    }
    const res = await api.run({ title: t });
    const checked = res ? clientCheck(res) : null;
    if (checked) {
      sessionSet('brief', key, checked);
      setShown(checked);
      track('ai_brief_view', { feature: 'brief', count: checked.claims.length });
      return;
    }
    const lens = nearestLens(t, available);
    if (lens) onLens(lens);
    setNote(
      lens
        ? `A brief for “${t}” couldn't be verified against the site, so the closest ready-made pitch is shown above.`
        : `A brief for “${t}” couldn't be verified against the site.`,
    );
  };

  const cite = (e: FitEvidence) => e.target && onOpen(e.target);

  return (
    <section aria-labelledby={`${id}-title`} data-role-brief="" className="rounded-2xl border border-hairline p-4">
      <h3 id={`${id}-title`} className="m-0">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="tap-safe -my-2 w-full justify-between gap-2 rounded-xl text-left text-sm font-semibold text-text-primary ring-focus"
          data-role-brief-toggle=""
        >
          Hiring for a different role?
          <ChevronDown aria-hidden="true" className={cn('size-4 shrink-0 transition-transform duration-300', expanded && 'rotate-180')} />
        </button>
      </h3>
      {expanded ? (
        <div className="mt-3 flex flex-col gap-3">
          {asked === null ? <AiNotice feature="brief" onDismiss={() => inputRef.current?.focus()} /> : null}
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <label htmlFor={`${id}-role`} className="basis-full text-sm text-text-secondary">
              I&apos;m hiring for:
            </label>
            <input
              ref={inputRef}
              id={`${id}-role`}
              value={title}
              maxLength={AI_LIMITS.title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Applied AI engineer, evaluation"
              data-role-brief-input=""
              className="min-h-11 min-w-0 flex-1 basis-56 rounded-full border border-glass-border bg-surface-tint px-4 text-sm text-text-primary ring-focus placeholder:text-text-muted"
            />
            <AIButton type="submit" variant="secondary" pending={api.status === 'loading'} loadingLabel="Checking…" disabled={title.trim().length < 2} data-role-brief-run="">
              Write a brief
            </AIButton>
          </form>

          {note ? (
            <p role="status" data-role-brief-fallback="" className="text-sm text-text-muted">
              {note}
            </p>
          ) : null}

          {shown ? (
            <div data-role-brief-result="" className="flex flex-col gap-3">
              <p className="text-xs text-text-muted">For “{asked}”, only sentences verified against the site:</p>
              <ul className="flex flex-col gap-2">
                {shown.claims.map((c) => (
                  <li key={c.text} data-role-brief-claim="" className="text-sm leading-relaxed text-text-primary">
                    {c.text}
                    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                      {c.evidence.map((e) => (
                        <button key={e.id} type="button" onClick={() => cite(e)} className={CHIP} data-cite-id={e.id}>
                          <span className="sr-only">Source: </span>
                          {e.label ?? e.id}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {shown.projects.length ? (
                <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  Projects:
                  {shown.projects.map((slug) => (
                    <button key={slug} type="button" onClick={() => onOpen({ kind: 'project', slug })} className={CHIP}>
                      {NAME.get(slug)}
                    </button>
                  ))}
                </p>
              ) : null}
              <AIDisclosure compact />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
