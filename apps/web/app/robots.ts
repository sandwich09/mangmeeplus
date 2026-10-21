import type { MetadataRoute } from 'next';

// Read per request: one image is built on UAT and promoted to Production unchanged, so the
// environment must not be baked in at build time.
export const dynamic = 'force-dynamic';

/** Only Production is indexed; UAT and local answer "disallow everything". */
export function robotsFor(environment: string | undefined): MetadataRoute.Robots {
  if (environment !== 'production') return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{
      userAgent: ['*', 'GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot', 'CCBot'],
      allow: ['/$', '/privacy', '/terms', '/llms.txt', '/llms-full.txt', '/home/'],
      disallow: ['/companies', '/api', '/system', '/sales', '/billing', '/account', '/login', '/signup', '/liff', '/l/',
        '/line-qr', '/claim-account', '/change-password', '/reset-password', '/forgot-password', '/email-access',
        '/verify-email', '/legal-acceptance', '/maintenance', '/unsupported-browser'],
    }],
    sitemap: 'https://mangmeeplus.com/sitemap.xml',
  };
}

export default function robots(): MetadataRoute.Robots {
  return robotsFor(process.env.DEPLOY_ENVIRONMENT);
}
