/** @type {import('next').NextConfig} */
const rawApiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/v1';
const rawRewriteApiBase = process.env.INTERNAL_API_URL ?? rawApiBase;
const normalizedApiBase = rawRewriteApiBase.replace(/\/+$/, '');
const apiOrigin = normalizedApiBase.startsWith('http') ? normalizedApiBase.replace(/\/v1$/, '') : 'http://localhost:3001';

const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Lets a second dev server run in this checkout (verify sessions) without fighting over .next
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The local Rancher VM (~3.8 GB) OOMs (exit 137) when `next build` runs the
  // separate tsc pass. Types are validated via package scripts, so skip that pass
  // during the container build to keep it within the memory budget. Next 16 no longer
  // runs ESLint from `next build`, so the removed legacy `eslint` key had no effect.
  typescript: { ignoreBuildErrors: true },
  // Receipt OCR (POST …/extraction-request) is synchronous and can legitimately run up to the
  // API's own 120s abort; the rewrite proxy's 30s default killed those responses mid-flight
  // and the UI reported failure for extractions that had succeeded. Milliseconds.
  experimental: { proxyTimeout: 180_000 },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${apiOrigin}/:path*` },
      { source: '/local-storage/:path*', destination: `${apiOrigin}/local-storage/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/legal/releases/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          { key: 'X-Robots-Tag', value: 'noindex, follow' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      // Enable SVG imports as React components (TailAdmin icon pattern)
      '*.svg': {
        loaders: [{
          loader: '@svgr/webpack',
          // svgr's default svgo run strips viewBox when it equals width/height, so any icon sized by
          // CSS below its intrinsic px got clipped (e.g. the amber lock at h-4 on the roles page).
          options: {
            svgoConfig: {
              plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }, 'prefixIds'],
            },
          },
        }],
        as: '*.js',
      },
    },
  },
};

export default nextConfig;
