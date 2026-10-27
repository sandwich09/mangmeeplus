import 'server-only';
import { handleHalloweenDraw } from '@/features/public-home/home-halloween-draw.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleHalloweenDraw(request);
}
