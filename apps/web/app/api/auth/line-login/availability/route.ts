import { NextResponse } from 'next/server';
import { internalApiV1Base } from '@/common/api/internal-api-base';

type LoginChannels = { line?: { available?: boolean } };

// Keep unavailable configuration distinct from a failed check. Neither enables login.
export async function GET() {
  const channels = await fetch(`${internalApiV1Base()}/auth/login-channels`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) })
    .then((res) => (res.ok ? (res.json() as Promise<LoginChannels>) : null))
    .catch(() => null);
  if (typeof channels?.line?.available !== 'boolean') {
    return NextResponse.json({ available: false }, { status: 503 });
  }
  return NextResponse.json({ available: channels.line.available });
}
