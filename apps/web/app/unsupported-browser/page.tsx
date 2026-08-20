import type { Metadata } from 'next';
import { GenericClientNotice } from '@/common/client-support/GenericClientNotice';
import { sanitizeNextPath } from '@/common/auth/middleware.logic';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Device compatibility | MangmeePlus',
  robots: { index: false, follow: false },
};

export default async function UnsupportedBrowserPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const rawNext = (await searchParams).next;
  const safeNext = sanitizeNextPath(Array.isArray(rawNext) ? rawNext[0] : rawNext);
  const retryHref = safeNext?.startsWith('/unsupported-browser') ? '/login' : (safeNext ?? '/login');

  return <GenericClientNotice retryHref={retryHref} />;
}
