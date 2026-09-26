import type { Metadata } from 'next';
import { VenturePage } from '@/components/coreforge/VenturePage';
import { Footer } from '@/components/layout/Footer';
import { SubpageHeader } from '@/components/layout/SubpageHeader';
import { COREFORGE_BRAND, COREFORGE_DISCLAIMER, COREFORGE_POSITIONING } from '@/lib/coreforge/facts';
import { buildCoreforgeJsonLd } from '@/lib/coreforge/jsonld';
import { fetchCoreforgeNews } from '@/lib/coreforge/news';
import { VENTURE_COPY } from '@/lib/coreforge/section-copy';
import { SITE } from '@/lib/site';

const PATH = '/ventures/coreforge';
const TITLE = `${COREFORGE_BRAND.product}, the dMAT practice platform I founded`;
const DESCRIPTION = `${COREFORGE_POSITIONING} ${COREFORGE_DISCLAIMER}`;

// Static, regenerated at most hourly so the goldensdmat.in news block stays current;
// a failed or slow feed read renders the page without that block.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: `${COREFORGE_BRAND.product} · ${COREFORGE_BRAND.tagline}`,
  description: DESCRIPTION,
  alternates: { canonical: PATH },
  // og:image comes from the colocated opengraph-image.tsx; twitter inherits it.
  openGraph: { type: 'website', url: PATH, siteName: SITE.name, title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// The founder is the site-wide Person node (StructuredData, '#person'), so the graphs join up.
const JSON_LD = JSON.stringify(buildCoreforgeJsonLd()).replace(/</g, '\u003c');

export default async function CoreforgeVenturePage() {
  const news = await fetchCoreforgeNews({ limit: 4, revalidate: 3600 });
  return (
    <>
      <SubpageHeader />
      <main id="main" tabIndex={-1} aria-label={VENTURE_COPY.title} className="min-h-screen overflow-x-clip bg-bg-base text-text-primary outline-none">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
        <div className="pb-16 sm:pb-24">
          <VenturePage newsItems={news} shareUrl={`${SITE.url}${PATH}`} />
        </div>
      </main>
      {/* The footer's oversized wordmark bleeds past narrow viewports; clip it like the home page does. */}
      <div className="overflow-x-clip">
        <Footer />
      </div>
    </>
  );
}
