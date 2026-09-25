import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // The API routes serve widgets and the AI features; none of them is a page.
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
