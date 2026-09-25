import type { NextConfig } from 'next';
import { withBotId } from 'botid/next/config';

const BUILD_TIME = new Date().toISOString();
const COMMIT = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local';

// These folders hold unhashed file names, so a replaced asset must expire. A day
// fresh plus a week of background revalidation keeps repeat visits instant.
const PUBLIC_ASSET_CACHE = [
  { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
];

const SECURITY_HEADERS = [
  // No includeSubDomains or preload: other subdomains of the apex are not ours to pin.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // microphone=(self): the AI kit's click-to-start VoiceInput uses SpeechRecognition.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), browsing-topics=()' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  turbopack: {
    root: __dirname,
  },
  env: {
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
    NEXT_PUBLIC_COMMIT: COMMIT,
    // Always defined so useRenderCount's guard is a build-time constant.
    NEXT_PUBLIC_RENDER_COUNT: process.env.NEXT_PUBLIC_RENDER_COUNT === '1' ? '1' : '',
    // Unreviewed claim-bearing AI entries show as drafts on preview and local builds,
    // so they can be reviewed in context; production hides them until approved.
    // Nothing secret may ever be added here: ai:scan allows only these four keys.
    NEXT_PUBLIC_AI_SHOW_UNREVIEWED: process.env.VERCEL_ENV === 'production' ? '' : '1',
  },
  // Loaded from node_modules at runtime rather than bundled into each AI route.
  serverExternalPackages: ['@google/genai'],
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [96, 128, 192, 256, 384],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async redirects() {
    return [
      { source: '/cv', destination: '/oikantik_basu_u.pdf', permanent: false },
      { source: '/resume', destination: '/oikantik_basu_u.pdf', permanent: false },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      ...['models', 'videos', 'images', 'skills', 'lottie', 'data', 'fonts'].map((dir) => ({
        source: `/${dir}/:path*`,
        headers: PUBLIC_ASSET_CACHE,
      })),
    ];
  },
};

// BotID Basic: serves its challenge script through a same-origin rewrite. The
// client side (instrumentation-client.ts) attaches the challenge to /api/ai/* POSTs.
export default withBotId(nextConfig);
