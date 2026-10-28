// Node-only implementation, reached through a server-only Route Handler.
import { randomInt } from 'node:crypto';
import { isSameOriginRequest } from '../../common/auth/middleware.logic';
import { GHOST_CARDS } from './home-halloween-cards';
import { homeThemeForRequest } from './home-theme.server';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const ordinaryCards = GHOST_CARDS.filter(card => card.region !== 'secret');
const secretCard = GHOST_CARDS.find(card => card.region === 'secret')!;
const ordinaryIds = new Set(ordinaryCards.map(card => card.id));
let tokens = 30;
let lastRefill = performance.now();

function seenCards(value: string | null) {
  if (!value) return new Set<string>();
  if (value.length > 512) throw new RangeError('Seen cards too long');
  const ids = value.split(',');
  const seen = new Set(ids);
  if (ids.length > ordinaryCards.length || seen.size !== ids.length || ids.some(id => !ordinaryIds.has(id))) throw new RangeError('Invalid seen cards');
  return seen;
}

async function emptyBody(request: Request) {
  if (request.headers.has('content-length') && request.headers.get('content-length') !== '0') return false;
  if (!request.body) return true;
  // Next may wrap a zero-byte POST in a stream. Inspect only its first chunk, with no buffering/parsing.
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Body timeout')), 1000); })]);
    return first.done === true;
  } catch { return false; }
  finally { clearTimeout(timeout); void reader.cancel().catch(() => {}); }
}

export async function handleHalloweenDraw(request: Request, environment: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch, random: (max: number) => number = randomInt) {
  const fail = (status: number, code: string) => Response.json({ code }, { status, headers });
  if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');
  const url = new URL(request.url);
  if (!isSameOriginRequest(request.headers.get('origin'), request.headers.get('sec-fetch-site'), request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host)) return fail(403, 'CROSS_ORIGIN_REJECTED');
  // The client cannot choose the card.
  if ([...url.searchParams.keys()].some(key => key !== 'preview' && key !== 'event')) {
    void request.body?.cancel().catch(() => {});
    return fail(400, 'INVALID_DRAW_REQUEST');
  }
  let seen: Set<string>;
  try { seen = seenCards(request.headers.get('x-halloween-seen')); }
  catch { return fail(400, 'INVALID_DRAW_REQUEST'); }
  // ponytail: one anonymous bucket per process, no player/IP records; edge protection remains a deployment concern.
  const now = performance.now();
  tokens = Math.min(30, tokens + (now - lastRefill) / 100);
  lastRefill = now;
  if (tokens < 1) return Response.json({ code: 'DRAW_BUSY' }, { status: 429, headers: { ...headers, 'Retry-After': '1' } });
  tokens--;
  if (!await emptyBody(request)) return fail(400, 'INVALID_DRAW_REQUEST');
  const theme = await homeThemeForRequest(Object.fromEntries(url.searchParams), environment.NODE_ENV, fetcher);
  if (theme.event !== 'halloween') return fail(404, 'HALLOWEEN_INACTIVE');
  if (request.signal.aborted) return fail(408, 'DRAW_CANCELLED');
  try {
    const available = ordinaryCards.filter(card => !seen.has(card.id));
    const choices = available.length ? available : ordinaryCards;
    const card = random(100) === 0 ? secretCard : choices[random(choices.length)];
    return Response.json({ cardId: card.id }, { headers });
  } catch {
    // No local-random fallback when the server cannot produce a result.
    return fail(503, 'DRAW_UNAVAILABLE');
  }
}
