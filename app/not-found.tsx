import type { Metadata } from 'next';
import { NotFoundView } from '@/components/shared/NotFoundViewLazy';
import { hasCaseStudy, PROJECTS } from '@/data/projects';
import type { SuggestCatalog } from '@/lib/ai/tour';
import { SECTIONS } from '@/lib/site';

// Next adds noindex to every not-found response.
export const metadata: Metadata = { title: 'Page not found' };

// Only what the island needs, so the 404 bundle carries no project descriptions.
const CATALOG: SuggestCatalog = {
  projects: PROJECTS.map((p) => ({ slug: p.slug, name: p.name, caseStudy: hasCaseStudy(p) })),
  sections: SECTIONS.map(({ id, label }) => ({ id, label })),
};
const CASE_STUDY_SLUGS = PROJECTS.filter(hasCaseStudy).map((p) => p.slug);

export default function NotFound() {
  return <NotFoundView catalog={CATALOG} caseStudySlugs={CASE_STUDY_SLUGS} />;
}
