import { SITE } from '@/lib/site';
import { headlineRole, profileUrls, splitLocation } from '@/lib/structured-data';
import { buildVCard } from '@/lib/vcard';
import profile from '@/data/profile.json';

export const dynamic = 'force-static';

export function GET() {
  const { locality, country } = splitLocation(SITE.location);
  const card = buildVCard({
    name: SITE.name,
    email: SITE.email,
    phone: SITE.phone,
    title: headlineRole(SITE.headline),
    locality,
    country,
    urls: [SITE.url, ...profileUrls(profile)],
  });

  return new Response(card, {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'attachment; filename="oikantik-basu.vcf"',
    },
  });
}
