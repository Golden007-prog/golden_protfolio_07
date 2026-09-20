import type { Metadata, Viewport } from 'next';
import '../src/index.css';
import { Providers } from './providers';

const SITE_URL = 'https://basuoikantik.in';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Oikantik Basu — Data Scientist & ML Engineer',
  description:
    'Portfolio of Oikantik Basu — Data Science graduate specializing in ML, LLMs, and NLP. Interactive 3D showcase of projects, skills, and experience.',
  authors: [{ name: 'Oikantik Basu' }],
  alternates: { canonical: '/' },
  icons: {
    icon: [{ url: '/ob-logo.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/ob-logo.svg' }],
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Oikantik Basu',
    title: 'Oikantik Basu — Data Scientist & ML Engineer',
    description:
      'Interactive portfolio featuring AI/ML projects, 3D visualizations, and cinematic motion design.',
    images: [{ url: '/images/skills-bg.webp', width: 1408, height: 768 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Oikantik Basu — Data Scientist & ML Engineer',
    description:
      'Interactive portfolio featuring AI/ML projects, 3D visualizations, and cinematic motion design.',
    images: ['/images/skills-bg.webp'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#060609' },
    { media: '(prefers-color-scheme: light)', color: '#FAFAF7' },
  ],
};

const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('theme');var l=window.matchMedia('(prefers-color-scheme: light)').matches;var r=s==='light'?'light':s==='dark'?'dark':s==='system'?(l?'light':'dark'):'dark';document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&f[]=satoshi@400,500,700,900&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500;1,600&family=Instrument+Serif:ital,wght@0,400;1,400&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
