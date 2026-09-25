import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import '../src/index.css';
import profile from '@/data/profile.json';
import { BOOTSTRAP_SCRIPT } from '@/lib/bootstrap-script';
import { SITE } from '@/lib/site';
import { headlineRole, siteDescription } from '@/lib/structured-data';
import { StructuredData } from '@/components/seo/StructuredData';
import { WebVitals } from '@/components/seo/WebVitals';
import { Providers } from './providers';
import { fontVariables } from './fonts';

// Vercel serves /_vercel/insights and /_vercel/speed-insights; anywhere else
// (next start, CI) their scripts would 404 and fail the console-error checks.
const ON_VERCEL = Boolean(process.env.NEXT_PUBLIC_VERCEL_ENV);

const TITLE = `${SITE.name} — ${headlineRole(SITE.headline)}`;
const DESCRIPTION = siteDescription(profile);

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: TITLE, template: `%s | ${SITE.name}` },
  description: DESCRIPTION,
  applicationName: SITE.name,
  authors: [{ name: SITE.name, url: SITE.url }],
  creator: SITE.name,
  // './' resolves against each route's own pathname, so every page is its own canonical.
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    url: './',
    siteName: SITE.name,
    locale: 'en_IN',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // One tag: the head bootstrap repaints it for the light theme before first paint.
  themeColor: '#060609',
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <StructuredData />
        <WebVitals />
        {ON_VERCEL ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
