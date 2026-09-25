import type { MetadataRoute } from 'next';
import { PROJECTS, hasCaseStudy } from '@/data/projects';
import { SITE } from '@/lib/site';

const BUILT_AT = process.env.NEXT_PUBLIC_BUILD_TIME ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME) : new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  // The same filter the case-study route's generateStaticParams uses, so every URL here exists.
  const caseStudies = PROJECTS.filter(hasCaseStudy).map((p) => `/projects/${p.slug}`);

  return [
    { url: SITE.url, lastModified: BUILT_AT, changeFrequency: 'monthly', priority: 1 },
    ...caseStudies.map((path) => ({
      url: `${SITE.url}${path}`,
      lastModified: BUILT_AT,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    { url: `${SITE.url}${SITE.cvPath}`, lastModified: BUILT_AT, changeFrequency: 'monthly', priority: 0.5 },
  ];
}
