import achievementsRaw from '@/data/achievements.json';
import certificationsRaw from '@/data/certifications.json';
import profile from '@/data/profile.json';
import { PROJECTS, hasCaseStudy } from '@/data/projects';
import { allAchievements, parseAchievements } from '@/lib/achievements';
import { allCertifications, parseCertifications } from '@/lib/certifications';
import { SITE } from '@/lib/site';
import { buildSiteGraph, serializeJsonLd } from '@/lib/structured-data';

const BUILT_AT = process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME) : new Date();
// Parsed once; a malformed file throws here and fails the build rather than shipping a bad credential link.
const CREDENTIALS = allCertifications(parseCertifications(certificationsRaw));
const ACHIEVEMENTS = allAchievements(parseAchievements(achievementsRaw));

/**
 * JSON-LD. Without `data` it renders the site graph (Person with credentials and
 * awards, WebSite, the project ItemList and any organisation he founded); pass
 * `data` to render any other object the same safe way.
 */
export function StructuredData({ data }: { data?: object }) {
  const graph =
    data ??
    buildSiteGraph({
      siteUrl: SITE.url,
      profile,
      projects: PROJECTS,
      caseStudyPath: (p) => (hasCaseStudy(p) ? `/projects/${p.slug}` : null),
      credentials: CREDENTIALS,
      achievements: ACHIEVEMENTS,
      now: BUILT_AT,
    });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }} />;
}
