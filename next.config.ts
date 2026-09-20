import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1536, 1920],
    imageSizes: [96, 128, 192, 256, 384],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    const immutable = [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ];
    return [
      { source: '/models/:path*', headers: immutable },
      { source: '/videos/:path*', headers: immutable },
      { source: '/images/:path*', headers: immutable },
      { source: '/skills/:path*', headers: immutable },
      { source: '/lottie/:path*', headers: immutable },
    ];
  },
};

export default nextConfig;
