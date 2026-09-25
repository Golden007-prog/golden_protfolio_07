import type { MetadataRoute } from 'next';
import profile from '@/data/profile.json';
import { SITE } from '@/lib/site';
import { headlineRole, siteDescription } from '@/lib/structured-data';

const BG = '#060609';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${SITE.name} — ${headlineRole(SITE.headline)}`,
    short_name: SITE.shortName,
    description: siteDescription(profile),
    lang: 'en',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: BG,
    theme_color: BG,
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  };
}
