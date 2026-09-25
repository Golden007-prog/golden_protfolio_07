import profile from '@/data/profile.json';
import { PROJECTS, hasCaseStudy } from '@/data/projects';
import { SITE } from '@/lib/site';
import { buildSiteGraph, serializeJsonLd } from '@/lib/structured-data';

const BUILT_AT = process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME) : new Date();

/**
 * JSON-LD. Without `data` it renders the site graph (Person, WebSite and the
 * project ItemList); pass `data` to render any other object the same safe way.
 */
export function StructuredData({ data }: { data?: object }) {
  const graph =
    data ??
    buildSiteGraph({
      siteUrl: SITE.url,
      profile,
      projects: PROJECTS,
      caseStudyPath: (p) => (hasCaseStudy(p) ? `/projects/${p.slug}` : null),
      now: BUILT_AT,
    });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }} />;
}
