/*
 * Which projects use a skill, from projects.json techStack through the shared tech
 * normaliser. Pure (the data is passed in) so node --test can run it; relative
 * .ts imports for the same reason.
 */
import { slugify } from './slug.ts';
import { matchesTech } from './tech.ts';

export type StackItem = { techStack: readonly string[] };

export function projectsForSkill<P extends StackItem>(projects: readonly P[], skill: string): P[] {
  return projects.filter((p) => matchesTech(p.techStack, skill));
}

/** Matching-project count per skill name; skills with no match are omitted. */
export function projectCounts(projects: readonly StackItem[], skills: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const skill of skills) {
    const n = projectsForSkill(projects, skill).length;
    if (n > 0) out[skill] = n;
  }
  return out;
}

/** The project's URL slug: its own field once projects.json carries one, else slugify(name). */
export function projectSlug(p: { name: string; slug?: string }): string {
  return p.slug || slugify(p.name);
}
