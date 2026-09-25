'use client';

import { BriefcaseBusiness, ExternalLink, Github } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { AIButton } from '@/components/ai/AIButton';
import { AIDisclosure } from '@/components/ai/AIDisclosure';
import { Button } from '@/components/ui/Button';
import profile from '@/data/profile.json';
import { SHOW_UNREVIEWED } from '@/lib/ai/config';
import { provenance, visible, type Store, type StoreEntry } from '@/lib/ai/reviewGate';
import { evidenceIds, experienceEvidence } from '@/lib/ai/spans';
import { projectsUsing } from '@/lib/skills';
import type { Skill } from '@/types/skills';

/* ---------------------------------------------------------------------------
 * The precomputed store, src/data/ai-generated/skills.json (scripts/ai/gen-skills.mjs):
 *   summary:<slug>  where a skill appears on the site; claim-bearing, review-gated
 *   explain:<slug>  three plain sentences about the technology; not claim-bearing
 *   gallery:<nn-id> the "Where lexicons break" examples; not claim-bearing
 * It is split into its own chunk and fetched the first time a surface needs it,
 * so it never weighs on the page's first load. A static JSON chunk, never /api/ai.
 * ------------------------------------------------------------------------- */

export type SkillsStore = Store<unknown>;

const EMPTY: SkillsStore = { version: 1, entries: {} };
let loaded: SkillsStore | null = null;
let pending: Promise<SkillsStore> | null = null;

export function loadSkillsStore(): Promise<SkillsStore> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= import('@/data/ai-generated/skills.json').then(
    (m) => (loaded = m.default as unknown as SkillsStore),
    () => {
      pending = null;
      return EMPTY;
    },
  );
  return pending;
}

/** The store once its chunk has arrived; null until then. */
export function useSkillsStore(): SkillsStore | null {
  const [store, setStore] = useState<SkillsStore | null>(loaded);
  useEffect(() => {
    if (store) return;
    let alive = true;
    void loadSkillsStore().then((s) => {
      if (alive) setStore(s);
    });
    return () => {
      alive = false;
    };
  }, [store]);
  return store;
}

const isStrings = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');

/** The store entry at `key` when its value passes `valid`, else null. */
export function storeEntry<V>(store: SkillsStore | null, key: string, valid: (v: unknown) => v is V): StoreEntry<V> | null {
  const entry = store?.entries[key];
  if (!entry || typeof entry !== 'object' || !valid(entry.value)) return null;
  return entry as StoreEntry<V>;
}

type SummaryValue = { skill: string; text: string; evidence: string[] };

function isSummary(v: unknown): v is SummaryValue {
  const x = v as Partial<SummaryValue> | null;
  return typeof x?.skill === 'string' && typeof x.text === 'string' && x.text.trim().length > 0 && isStrings(x.evidence);
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((id, i) => id === b[i]);

/* ---------------------------------------------------------------------------
 * The panel
 * ------------------------------------------------------------------------- */

const EXPERIENCE = profile.experience as readonly { company: string; role: string; description?: string; highlights?: string[] }[];

type Props = {
  skill: Skill;
  onOpenProject: (slug: string) => void;
  /** Opens the concierge scoped to this skill (the modal closes first). */
  onAsk: (skill: Skill) => void;
};

/**
 * "Where he has used X". The evidence block is deterministic and always shown:
 * the projects whose stack lists the skill and the lines of his roles that name
 * it. Above it sits a precomputed two or three sentence summary of that same
 * evidence, shown only when its review gate allows and its evidence ids still
 * match what the site says today. Nothing here calls /api/ai; only the Ask
 * button does, through the concierge.
 */
export function SkillUsage({ skill, onOpenProject, onAsk }: Props) {
  const headingId = useId();
  const projects = projectsUsing(skill.name);
  const roles = experienceEvidence(EXPERIENCE, skill.name);
  const ids = evidenceIds(
    projects.map((p) => p.slug),
    roles,
  );

  const store = useSkillsStore();
  const entry = storeEntry(store, `summary:${skill.slug}`, isSummary);
  const summary =
    entry && entry.value.skill === skill.name && visible(entry, SHOW_UNREVIEWED) && ids.length > 0 && sameIds(entry.value.evidence, ids)
      ? entry
      : null;

  return (
    <section data-skill-usage={skill.slug} aria-labelledby={headingId} className="space-y-6">
      <h3 id={headingId} className="font-mono text-eyebrow uppercase text-cyan-text">
        Where he has used {skill.name}
      </h3>

      {summary ? (
        <div
          data-skill-summary=""
          data-review={summary.reviewed ? 'reviewed' : 'draft'}
          className="ai-skill-summary rounded-xl border border-hairline bg-surface-tint p-4"
        >
          <p className="text-sm leading-relaxed text-text-primary">{summary.value.text}</p>
          <p className="mt-3 text-xs text-text-muted">
            Summary of the evidence below · <span data-provenance="">{provenance(summary)}</span>
          </p>
          <AIDisclosure compact className="mt-2" />
        </div>
      ) : null}

      <div>
        <h4 className="mb-3 text-sm font-semibold text-text-primary">Used in projects</h4>
        {projects.length > 0 ? (
          <ul data-skill-projects="" className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <li key={p.slug} className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface-tint p-4">
                <div>
                  <p className="text-sm font-semibold text-text-primary">{p.name}</p>
                  {p.tagline ? <p className="mt-1 text-xs leading-relaxed text-text-muted">{p.tagline}</p> : null}
                </div>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" cursor="open" onClick={() => onOpenProject(p.slug)}>
                    Open project
                  </Button>
                  {p.githubUrl ? (
                    <Button
                      href={p.githubUrl}
                      size="sm"
                      variant="icon"
                      aria-label={`${p.name} on GitHub`}
                      leadingIcon={<Github aria-hidden="true" className="size-4" />}
                    />
                  ) : null}
                  {p.liveUrl ? (
                    <Button
                      href={p.liveUrl}
                      size="sm"
                      variant="icon"
                      aria-label={`${p.name} live demo`}
                      leadingIcon={<ExternalLink aria-hidden="true" className="size-4" />}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p data-skill-no-projects="" className="rounded-xl border border-hairline p-4 text-sm text-text-secondary">
            No project on this site lists {skill.name}.
          </p>
        )}
      </div>

      {roles.length > 0 ? (
        <div data-skill-experience="">
          <h4 className="mb-3 text-sm font-semibold text-text-primary">Named in his roles</h4>
          <ul className="space-y-3">
            {roles.map((r) => (
              <li key={r.index} data-exp-ref={r.index} className="rounded-xl border border-hairline p-4">
                <p className="flex items-start gap-2 text-sm font-medium text-text-primary">
                  <BriefcaseBusiness aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
                  <span>
                    {r.role} <span className="font-normal text-text-muted">· {r.company}</span>
                  </span>
                </p>
                <ul className="mt-2 space-y-1.5 pl-6">
                  {r.lines.map((line) => (
                    <li key={line} className="text-sm leading-relaxed text-text-secondary">
                      <q className="ai-skill-quote">{line}</q>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <AIButton size="md" data-skill-ask={skill.name} onClick={() => onAsk(skill)}>
          Ask how he uses {skill.name}
        </AIButton>
        <p className="text-xs text-text-muted">Opens the assistant, scoped to this skill.</p>
      </div>
    </section>
  );
}
