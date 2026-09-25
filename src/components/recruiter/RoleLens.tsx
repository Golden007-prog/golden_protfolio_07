'use client';

import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import recruiterStore from '@/data/ai-generated/recruiter.json';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { CitationChips } from '@/components/ai/CitationChips';
import { SourceBadge } from '@/components/ai/SourceBadge';
import { useAiActionRunner } from '@/components/ai/useAiActionRunner';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { Dialog } from '@/components/ui/Dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import { AUDIENCE_LABEL, dataPitch, LENS_AUDIENCES, LENSES, lensParam, visibleLenses, type LensAudience, type LensId, type LensStore } from '@/lib/ai/fit';
import type { AiSource, AiTarget } from '@/lib/ai/protocol';
import { provenance } from '@/lib/ai/reviewGate';
import { slugify } from '@/lib/slug';
import { setUrlParams, useUrlParam } from '@/lib/urlState';
import { cn } from '@/utils/cn';
import { toYearMonth } from '@/utils/dates';
import { closePitch, openPitch, usePitchState } from './FitCheckTrigger';
import { RoleBrief } from './RoleBrief';

// Read only here, in this lazy chunk, so the pitches never weigh on the first load of '/'.
const STORE = recruiterStore as unknown as LensStore;
const NAME = new Map(PROJECTS.map((p) => [p.slug, p.name]));
const CATEGORY_BY_SLUG = new Map(Object.keys(profile.skills).map((c) => [slugify(c), c]));
// After the pitch closes (scroll lock released), so the runner's scroll lands.
const AFTER_CLOSE_MS = 80;

/** A pitch citation as a source chip: label and target come from the site's own data. */
function sourceFor(id: string): AiSource | null {
  let m = /^exp:(\d+)/.exec(id);
  if (m) {
    const e = profile.experience[Number(m[1])];
    return e ? { id, label: `${e.company} · ${e.role}`, cls: 'self', target: { kind: 'experience', index: Number(m[1]) } } : null;
  }
  m = /^edu:(\d+)$/.exec(id);
  if (m) {
    const e = profile.education[Number(m[1])];
    return e ? { id, label: e.degree, cls: 'self', target: { kind: 'education', index: Number(m[1]) } } : null;
  }
  m = /^skills:([a-z0-9-]+)$/.exec(id);
  if (m) {
    const category = CATEGORY_BY_SLUG.get(m[1]);
    return category ? { id, label: `Skills · ${category}`, cls: 'self', target: { kind: 'section', id: 'skills' } } : null;
  }
  if (id === 'profile:availability') return { id, label: 'Availability', cls: 'self', target: { kind: 'section', id: 'about' } };
  if (id === 'profile:about') return { id, label: 'About', cls: 'self', target: { kind: 'section', id: 'about' } };
  m = /^project:([a-z0-9-]+)#/.exec(id);
  if (m && NAME.has(m[1])) return { id, label: NAME.get(m[1])!, cls: 'self', target: { kind: 'project', slug: m[1] } };
  return null;
}

/** A row of mutually exclusive options with roving focus and arrow keys. */
function Segmented<T extends string>({ label, options, value, onChange, name }: { label: string; options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; name: string }) {
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = options[(i + delta + options.length) % options.length];
    onChange(next.id);
    (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[options.indexOf(next)])?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} data-segmented={name} className="inline-flex max-w-full flex-wrap rounded-3xl border border-glass-border bg-surface-tint p-1">
      {options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={cn(
            'tap-safe rounded-full px-4 text-[13px] font-medium ring-focus transition-colors',
            o.id === value ? 'bg-glass-fill-strong text-text-primary' : 'text-text-muted hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The lens chips in AtAGlance and the 30-second pitch they open. Only lenses
 * the data backs, and only entries reviewGate lets through: reviewed ones, or
 * drafts where drafts are shown. The pitch is precomputed, so opening it sends
 * nothing. With no lens on show it falls back to a pitch built from profile
 * fields alone. ?lens=<id> opens it directly; an unknown id is ignored.
 */
export function RoleLens() {
  const titleId = useId();
  const wide = useMediaQuery('(min-width: 640px)');
  const runner = useAiActionRunner();
  const pitch = usePitchState();
  const rawParam = useUrlParam('lens');
  const param = lensParam(rawParam);
  const [audience, setAudience] = useState<LensAudience>('plain');

  const lenses = useMemo(() => visibleLenses(STORE, SHOW_UNREVIEWED), []);
  const available = useMemo(() => lenses.map((l) => l.def.id), [lenses]);
  const open = pitch.open || param !== null;
  const requested = pitch.open ? pitch.lens : param;
  const activeId = requested && available.includes(requested) ? requested : (available[0] ?? null);
  const active = lenses.find((l) => l.def.id === activeId) ?? null;

  const close = () => {
    closePitch();
    if (rawParam !== null) setUrlParams({ lens: null });
  };
  const go = (target: AiTarget) => {
    close();
    window.setTimeout(() => runner(target), AFTER_CLOSE_MS);
  };

  const sentences = active ? active.entry.value.versions[audience] : null;
  const cited = sentences ? [...new Set(sentences.flatMap((s) => s.cites))] : [];
  const sources = cited.map(sourceFor).filter((s): s is AiSource => s !== null);
  const numberOf = new Map(sources.map((s, i) => [s.id, i + 1]));
  const share = active && typeof window !== 'undefined' ? `${window.location.origin}/?lens=${active.def.id}` : '';

  return (
    <>
      {/* The chips render in LensSlot, from the server's list, so they are there at first paint. */}
      <Dialog open={open} onClose={close} labelledBy={titleId} variant={wide ? 'modal' : 'sheet'} panelClassName={wide ? 'max-w-2xl' : undefined}>
        <div data-lens-pitch={activeId ?? 'data'} className="flex flex-col gap-5 p-5 sm:p-7">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-h3 font-semibold text-text-primary">
                30-second pitch{active ? `: ${active.def.label}` : ''}
              </h2>
              <p className="mt-1 text-sm text-text-muted">Oikantik Basu, in the third person, from this site&apos;s content.</p>
            </div>
            <Button variant="icon" aria-label="Close" onClick={close} className="-mr-2 -mt-1 shrink-0">
              <X aria-hidden="true" className="size-5" />
            </Button>
          </header>

          {active && sentences ? (
            <>
              <div className="flex flex-wrap gap-2">
                {lenses.length > 1 ? (
                  <Segmented
                    name="lens"
                    label="Focus"
                    options={LENSES.filter((l) => available.includes(l.id)).map((l) => ({ id: l.id, label: l.label }))}
                    value={active.def.id}
                    onChange={(id: LensId) => openPitch(id)}
                  />
                ) : null}
                <Segmented name="audience" label="Version" options={LENS_AUDIENCES.map((a) => ({ id: a, label: AUDIENCE_LABEL[a] }))} value={audience} onChange={setAudience} />
              </div>

              <p data-lens-text={audience} className="text-[15px] leading-relaxed text-text-primary">
                {sentences.map((s, i) => (
                  <span key={i}>
                    {s.text}
                    {s.cites.map((c) => {
                      const src = sources.find((x) => x.id === c);
                      const n = numberOf.get(c);
                      return src && n ? (
                        <button key={c} type="button" className="ai-cite" data-cite-id={c} onClick={() => go(src.target)} aria-label={`Source ${n}: ${src.label}`}>
                          <span className="ai-cite-pill" aria-hidden="true">
                            {n}
                          </span>
                        </button>
                      ) : null;
                    })}{' '}
                  </span>
                ))}
              </p>

              <CitationChips sources={sources} cited={cited} onOpen={(s) => go(s.target)} />

              {active.entry.value.projects.length ? (
                <div>
                  <p className="text-xs font-medium text-text-muted">Projects that show it</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {active.entry.value.projects
                      .filter((slug) => NAME.has(slug))
                      .map((slug) => (
                        <li key={slug}>
                          <button
                            type="button"
                            data-lens-project={slug}
                            onClick={() => go({ kind: 'project', slug })}
                            className="tap-safe rounded-full border border-glass-border bg-glass-fill px-4 text-xs font-medium text-text-secondary ring-focus transition-colors hover:border-violet-bright hover:text-text-primary"
                          >
                            {NAME.get(slug)}
                          </button>
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
                <div className="flex flex-col gap-1">
                  <p data-lens-provenance="" className="text-xs text-text-muted">
                    {provenance(active.entry)}
                  </p>
                  <AIDisclosure compact />
                </div>
                <CopyButton value={share} label="Share this pitch" copiedLabel="Link copied" size="sm" variant="secondary" />
              </div>
            </>
          ) : (
            <div data-lens-fallback="" className="flex flex-col gap-3">
              <SourceBadge source="rules" className="self-start" />
              <ul className="flex flex-col gap-1.5 text-[15px] leading-relaxed text-text-primary">
                {dataPitch(profile, toYearMonth(new Date())).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <RoleBrief available={available} onLens={(id) => openPitch(id)} onOpen={go} />
        </div>
      </Dialog>
    </>
  );
}
