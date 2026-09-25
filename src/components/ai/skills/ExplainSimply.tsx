'use client';

import { Lightbulb } from 'lucide-react';
import { useId, useState } from 'react';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { Button } from '@/components/ui/Button';
import { provenance } from '@/lib/ai/reviewGate';
import type { Skill } from '@/types/skills';
import { storeEntry, useSkillsStore } from './SkillUsage';

type ExplainValue = { skill: string; sentences: string[] };

function isExplain(v: unknown): v is ExplainValue {
  const x = v as Partial<ExplainValue> | null;
  return (
    typeof x?.skill === 'string' &&
    Array.isArray(x.sentences) &&
    x.sentences.length > 0 &&
    x.sentences.every((s) => typeof s === 'string' && s.trim().length > 0)
  );
}

/**
 * "Explain simply": three precomputed plain-English sentences rewritten from the
 * generic write-up's purpose and key capabilities. They describe the technology,
 * not his use of it, so they are not claim-bearing and need no review; they still
 * carry the AI-written provenance and disclosure. Renders nothing when the store
 * has no entry for this skill.
 */
export function ExplainSimply({ skill }: { skill: Skill }) {
  const panelId = useId();
  const store = useSkillsStore();
  // Keyed by skill, so paging to the next skill starts closed.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const entry = storeEntry(store, `explain:${skill.slug}`, isExplain);
  if (!entry || entry.value.skill !== skill.name) return null;
  const open = openFor === skill.slug;

  return (
    <div data-skill-explain-root="">
      <Button
        variant="outline"
        size="md"
        aria-pressed={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpenFor(open ? null : skill.slug)}
        leadingIcon={<Lightbulb aria-hidden="true" className="size-4 text-cyan-text" />}
        data-skill-explain-toggle=""
      >
        Explain simply
      </Button>
      {open ? (
        <div id={panelId} data-skill-explain="" className="ai-skill-explain mt-4 rounded-xl border border-hairline bg-surface-tint p-4">
          <p className="text-xs font-medium text-text-muted" data-skill-explain-scope="">
            About the technology, not about Oikantik&rsquo;s experience
          </p>
          <ul className="mt-3 space-y-2">
            {entry.value.sentences.map((s) => (
              <li key={s} className="flex items-start gap-3 text-sm leading-relaxed text-text-primary">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan-bright" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted" data-provenance="">
            {provenance(entry)}
          </p>
          <AIDisclosure compact className="mt-2" />
        </div>
      ) : null}
    </div>
  );
}
