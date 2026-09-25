'use client';

import { useId } from 'react';
import profile from '@/data/profile.json';
import { PROJECTS } from '@/data/projects';
import type { MatrixRow } from '@/lib/ai/fit';

const NAME = new Map(PROJECTS.map((p) => [p.slug, p.name]));

type Props = {
  rows: readonly MatrixRow[];
  /** 'Exact keyword matches (no AI)' until the AI adds mapped rows. */
  title: string;
  onSkill: (name: string) => void;
};

/**
 * Each JD skill mapped to its profile category, the projects that use it
 * (counted in code with projectsForSkill) and the roles whose text names it
 * verbatim. AI synonyms carry a 'mapped by AI' label. The table scrolls inside
 * its own wrapper, never a section ancestor, so sticky layouts are untouched.
 */
export function SkillsMatrix({ rows, title, onSkill }: Props) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-title`} data-fit-matrix="" className="fit-block">
      <h3 id={`${id}-title`} className="text-sm font-semibold text-text-primary">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted" data-fit-matrix-empty="">
          None of the site&apos;s listed skills or project technologies appear word for word in this JD.
        </p>
      ) : (
        <div
          data-fit-matrix-scroll=""
          role="region"
          aria-labelledby={`${id}-title`}
          tabIndex={0}
          className="fit-matrix-scroll mt-2 overflow-x-auto rounded-2xl border border-hairline ring-focus"
        >
          <table className="w-full min-w-[34rem] border-collapse text-left text-[13px]">
            <caption className="sr-only">{title}: each term, where the site lists it, and what uses it</caption>
            <thead>
              <tr className="border-b border-hairline text-xs text-text-muted">
                <th scope="col" className="px-3 py-2 font-medium">
                  In the JD
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  On the site
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Category
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Projects
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Roles naming it
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.jdTerm}-${r.siteTerm}`} data-fit-matrix-row={r.siteTerm} data-mapped={r.mappedByAi ? 'ai' : 'exact'} className="border-b border-hairline last:border-b-0 align-top">
                  <th scope="row" className="px-3 py-2 font-medium text-text-primary [overflow-wrap:anywhere]">
                    {r.jdTerm}
                  </th>
                  <td className="px-3 py-2 text-text-secondary">
                    {r.category ? (
                      <button type="button" onClick={() => onSkill(r.siteTerm)} className="ai-link ring-focus rounded-md text-text-primary">
                        {r.siteTerm}
                      </button>
                    ) : (
                      r.siteTerm
                    )}
                    {r.mappedByAi ? <span className="ml-1.5 whitespace-nowrap rounded-full border border-hairline px-1.5 py-px text-[10px] uppercase tracking-wider text-amber-text">mapped by AI</span> : null}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{r.category ?? 'Project stack'}</td>
                  <td className="px-3 py-2 text-text-secondary">
                    <span className="font-mono tabular-nums text-text-primary">{r.projects.length}</span>
                    {r.projects.length ? <span className="text-text-muted"> · {r.projects.map((s) => NAME.get(s) ?? s).join(', ')}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{r.roles.length ? r.roles.map((i) => profile.experience[i]?.company).filter(Boolean).join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
