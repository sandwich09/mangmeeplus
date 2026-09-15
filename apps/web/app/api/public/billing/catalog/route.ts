import { internalApiV1Base } from '@/common/api/internal-api-base';

export const dynamic = 'force-dynamic';
// Anonymous price data only. Never forward cookies, authorization, or company context.
// A public CORS response lets the separate marketing site consume the same runtime catalog.
const headers = { 'Cache-Control': 'no-store, max-age=0', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' };
export async function GET() {
  try {
    const upstream = await fetch(`${internalApiV1Base()}/billing/catalog`, {
      cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) throw new Error('catalog unavailable');
    return Response.json(await upstream.json(), { headers });
  } catch {
    return Response.json({ code: 'BILLING_CATALOG_UNAVAILABLE' }, { status: 503, headers });
  }
}
