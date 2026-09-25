'use client';

import { useId, useMemo, useState } from 'react';
import { BookOpenText, Languages, X } from 'lucide-react';
import store from '@/data/ai-generated/discovery.json';
import profile from '@/data/profile.json';
import { CONTACT_COPY, PHILOSOPHY, SECTION_COPY } from '@/data/site-copy';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { ReadAloud } from '@/components/ai/ReadAloud';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import { provenance, visible, type Store, type StoreEntry } from '@/lib/ai/reviewGate';
import {
  blocksText,
  checkBlocks,
  sectionBlocks,
  sectionSourceOf,
  sourceHash,
  TOOL_LANG,
  TOOL_MODES,
  TOOL_NAMES,
  TOOL_SECTIONS,
  TOOL_VOICE,
  toolKey,
  toolSectionFor,
  isToolMode,
  type Block,
  type ToolMode,
  type ToolSection,
} from '@/lib/ai/tour';
import { safeStorage } from '@/lib/safeStorage';
import { SECTIONS } from '@/lib/site';
import { cn } from '@/utils/cn';

/*
 * 'Explain this section simply' and 'Read this section in …': precomputed
 * plain-English, Hindi, Bengali and Spanish versions of About, Experience,
 * Principles and Contact, from src/data/ai-generated/discovery.json. There is no
 * runtime route (one that took client text would be a free translation proxy),
 * so this makes no request at all. A version shows only when the review gate
 * allows it and its hash matches today's original; otherwise the original shows.
 */

const SOURCE = sectionSourceOf({ profile, sectionCopy: SECTION_COPY, tenets: PHILOSOPHY, contact: CONTACT_COPY });
const STORE = store as unknown as Store<unknown>;
const LANG_KEY = 'ob-section-lang';

export type SectionToolsRequest = 'simple' | 'translate';

type Version = { blocks: Block[]; entry: StoreEntry<unknown> };

/** The stored version of a section, when it may show and still matches the original. */
function versionOf(section: ToolSection, mode: ToolMode, original: readonly Block[]): Version | null {
  const entry = STORE.entries?.[toolKey(section, mode)];
  if (!entry || !visible(entry, SHOW_UNREVIEWED)) return null;
  if (entry.hash !== sourceHash(original, mode)) return null;
  // Shape and numbers again, cheaply: a hand-edited store never shows a broken version.
  const checked = checkBlocks(original, (entry.value as { blocks?: unknown } | null)?.blocks, []);
  return typeof checked === 'string' ? null : { blocks: checked, entry };
}

function lastLanguage(): ToolMode {
  const saved = safeStorage.get(LANG_KEY);
  return isToolMode(saved) && saved !== 'simple' ? saved : 'hi';
}

const labelOf = (id: ToolSection) => SECTIONS.find((s) => s.id === id)?.label ?? id;

type Props = { open: boolean; request: SectionToolsRequest; onClose: () => void };

/** A side sheet on wider screens and a bottom sheet on phones. */
export function SectionTools({ open, request, onClose }: Props) {
  const wide = useMediaQuery('(min-width: 640px)');
  const titleId = useId();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      variant={wide ? 'modal' : 'sheet'}
      labelledBy={titleId}
      // ml-auto pushes the modal panel against the right edge: a side sheet with the modal's backdrop and trap.
      panelClassName={wide ? 'ml-auto mr-0 flex max-w-md flex-col sm:min-h-[calc(100dvh-4rem)]' : undefined}
    >
      <ToolsBody titleId={titleId} request={request} onClose={onClose} />
    </Dialog>
  );
}

function ToolsBody({ titleId, request, onClose }: { titleId: string; request: SectionToolsRequest; onClose: () => void }) {
  const active = useActiveSection();
  // Read once per opening: the body mounts each time the sheet opens.
  const [section, setSection] = useState<ToolSection>(() => toolSectionFor(active));
  const [mode, setMode] = useState<ToolMode>(() => (request === 'simple' ? 'simple' : lastLanguage()));
  const [showOriginal, setShowOriginal] = useState(false);

  const original = useMemo(() => sectionBlocks(section, SOURCE), [section]);
  const version = useMemo(() => versionOf(section, mode, original), [section, mode, original]);
  const shownOriginal = showOriginal || !version;
  const blocks = shownOriginal ? original : version.blocks;
  const lang = shownOriginal ? 'en' : TOOL_LANG[mode];
  const voice = shownOriginal ? 'en-IN' : TOOL_VOICE[mode];
  const isTranslation = mode !== 'simple';

  const pickMode = (m: ToolMode) => {
    setMode(m);
    setShowOriginal(false);
    if (m !== 'simple') safeStorage.set(LANG_KEY, m);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6 sm:p-8" data-section-tools="" data-section={section} data-mode={mode}>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs text-text-muted">
            {isTranslation ? <Languages aria-hidden="true" className="size-4 text-cyan-text" /> : <BookOpenText aria-hidden="true" className="size-4 text-cyan-text" />}
            {isTranslation ? 'Read this section in another language' : 'This section, simply'}
          </p>
          <h2 id={titleId} className="mt-1 font-display text-2xl font-semibold tracking-tight text-text-primary">
            {labelOf(section)}
          </h2>
        </div>
        <Button variant="icon" aria-label="Close" onClick={onClose} className="-mr-2 -mt-2 shrink-0">
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div role="group" aria-label="Section" className="flex flex-wrap gap-2">
        {TOOL_SECTIONS.map((id) => (
          <Button
            key={id}
            size="sm"
            variant={id === section ? 'primary' : 'ghost'}
            aria-pressed={id === section}
            onClick={() => {
              setSection(id);
              setShowOriginal(false);
            }}
            data-tool-section={id}
          >
            {labelOf(id)}
          </Button>
        ))}
      </div>

      <div role="group" aria-label="Version" className="mt-3 flex flex-wrap gap-2 border-t border-hairline pt-3">
        {TOOL_MODES.map((m) => (
          <Button
            key={m}
            size="sm"
            variant={m === mode ? 'secondary' : 'ghost'}
            aria-pressed={m === mode}
            onClick={() => pickMode(m)}
            data-tool-mode={m}
          >
            {m === 'simple' ? (
              TOOL_NAMES.simple.en
            ) : (
              <>
                <span lang={TOOL_LANG[m]}>{TOOL_NAMES[m].native}</span>
                <span className="sr-only"> ({TOOL_NAMES[m].en})</span>
              </>
            )}
          </Button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {version ? (
          <p className="flex flex-wrap items-center gap-x-1 text-sm text-text-secondary" data-tool-note="">
            <span>{isTranslation ? 'Machine-translated' : 'Simplified by AI'}</span>
            <span aria-hidden="true">·</span>
            <Button variant="ghost" size="sm" onClick={() => setShowOriginal((v) => !v)} aria-pressed={showOriginal} className="px-2" data-tool-original="">
              {showOriginal ? (isTranslation ? `Show ${TOOL_NAMES[mode].en}` : 'Show plain English') : 'Show original'}
            </Button>
          </p>
        ) : (
          <p className="text-sm text-text-muted" data-tool-unavailable="">
            {isTranslation ? `A ${TOOL_NAMES[mode].en} version of this section isn't ready yet. Here is the original.` : "A plain-English version of this section isn't ready yet. Here is the original."}
          </p>
        )}
        <ReadAloud key={`${section}:${mode}:${shownOriginal}`} text={blocksText(blocks)} lang={voice} caption={false} />
      </div>

      <article
        lang={lang}
        data-section-tool-text=""
        className={cn('mt-5 flex flex-col gap-4 text-base text-text-primary', lang === 'en' ? 'leading-relaxed' : 'leading-loose')}
      >
        {blocks.map((b, i) => (
          <div key={`${section}-${i}`}>
            {b.heading ? <h3 className="mb-1 font-display text-lg font-semibold leading-snug text-text-primary">{b.heading}</h3> : null}
            <p className="max-w-[68ch] text-text-secondary">{b.text}</p>
          </div>
        ))}
      </article>

      {version && !shownOriginal ? (
        <div className="mt-auto flex flex-col gap-1 border-t border-hairline pt-4">
          <AIDisclosure compact />
          <p className="text-xs text-text-muted" data-tool-provenance="">
            {provenance(version.entry)}
            {isTranslation ? ` · names and numbers are checked against the original` : ''}
          </p>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {shownOriginal ? `${labelOf(section)}, original` : `${labelOf(section)}, ${TOOL_NAMES[mode].en}`}
      </p>
    </div>
  );
}
