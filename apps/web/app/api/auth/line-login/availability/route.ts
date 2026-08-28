import { NextResponse } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';

type LoginChannels = { line?: { available?: boolean } };

// Server-driven visibility for the login page's LINE button: the flag and the credentials
// live in the API, and anything the browser cannot confirm reads as unavailable.
export async function GET() {
  const channels = await fetch(`${internalApiV1Base()}/auth/login-channels`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<LoginChannels>) : null))
    .catch(() => null);
  return NextResponse.json({ available: Boolean(channels?.line?.available) });
}
