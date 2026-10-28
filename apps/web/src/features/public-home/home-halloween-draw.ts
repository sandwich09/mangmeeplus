import { GHOST_CARDS, getGhostCard } from './home-halloween-cards';

export type HalloweenDraw = { cardId: string };
type SeenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const HALLOWEEN_SEEN_STORAGE_KEY = 'mangmeeplus:halloween:seen-cards-v1';
const ordinaryIds = new Set(GHOST_CARDS.filter(card => card.region !== 'secret').map(card => card.id));

export function readHalloweenSeenCards(storage: SeenStorage | undefined): string[] {
  if (!storage) return [];
  try {
    const value: unknown = JSON.parse(storage.getItem(HALLOWEEN_SEEN_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value) || value.length > ordinaryIds.size || value.some(id => typeof id !== 'string' || !ordinaryIds.has(id)) || new Set(value).size !== value.length) throw new Error('Invalid seen cards');
    if (value.length === ordinaryIds.size) { storage.removeItem(HALLOWEEN_SEEN_STORAGE_KEY); return []; }
    return value;
  } catch {
    try { storage.removeItem(HALLOWEEN_SEEN_STORAGE_KEY); } catch {}
    return [];
  }
}

export function rememberHalloweenDraw(storage: SeenStorage | undefined, cardId: string) {
  if (!storage || !ordinaryIds.has(cardId)) return;
  const seen = readHalloweenSeenCards(storage);
  if (!seen.includes(cardId)) seen.push(cardId);
  try { storage.setItem(HALLOWEEN_SEEN_STORAGE_KEY, JSON.stringify(seen)); } catch {}
}

export async function requestHalloweenDraw(signal: AbortSignal, search: string, seenCardIds: readonly string[] = [], fetcher: typeof fetch = fetch): Promise<HalloweenDraw> {
  const params = new URLSearchParams(search);
  const preview = process.env.NODE_ENV === 'development' && params.get('preview') === 'events' && params.get('event') === 'halloween';
  let response: Response;
  try {
    response = await fetcher(`/api/public/halloween/draw${preview ? '?preview=events&event=halloween' : ''}`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', signal,
      headers: seenCardIds.length ? { 'X-Halloween-Seen': seenCardIds.join(',') } : undefined,
    });
  } catch (failure) {
    if (signal.aborted) throw failure;
    throw new Error('ติดต่อประตูวิญญาณไม่ได้ ตรวจการเชื่อมต่อแล้วลองอีกครั้ง');
  }
  if (!response.ok) throw new Error(response.status === 429 ? 'เรียกวิญญาณถี่เกินไป รอสักครู่แล้วลองอีกครั้ง'
    : response.status === 404 ? 'ประตูวิญญาณปิดแล้ว กลับหน้าแรกเพื่อเลือกกิจกรรม' : 'เรียกวิญญาณไม่ได้ ลองอีกครั้ง');
  try {
    const result: unknown = await response.json();
    if (!result || typeof result !== 'object' || Array.isArray(result) || !('cardId' in result)
      || typeof result.cardId !== 'string' || !getGhostCard(result.cardId)) throw new Error('Invalid card');
    return { cardId: result.cardId };
  }
  catch { throw new Error('อ่านร่างวิญญาณไม่ได้ ลองอีกครั้ง'); }
}
