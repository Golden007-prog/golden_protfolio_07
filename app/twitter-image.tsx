import { SITE } from '@/lib/site';
import { headlineRole } from '@/lib/structured-data';
import OpenGraphImage from './opengraph-image';

// Same card as opengraph-image.tsx; the config is repeated because each metadata image route declares its own.
export const alt = `${SITE.name} — ${headlineRole(SITE.headline)}, ${SITE.location}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default OpenGraphImage;
