import { getGhostCard } from './home-halloween-cards';

export type HalloweenDraw = { cardId: string };

export async function requestHalloweenDraw(signal: AbortSignal, search: string, fetcher: typeof fetch = fetch): Promise<HalloweenDraw> {
  const params = new URLSearchParams(search);
  const preview = process.env.NODE_ENV === 'development' && params.get('preview') === 'events' && params.get('event') === 'halloween';
  let response: Response;
  try {
    response = await fetcher(`/api/public/halloween/draw${preview ? '?preview=events&event=halloween' : ''}`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', signal,
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
