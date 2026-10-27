import type { GhostCard } from './home-halloween-cards';
import { HALLOWEEN_HOME_URL, HALLOWEEN_LINE_URL } from './home-halloween-cards';
import { embedHalloweenProvenance, makeHalloweenImageProvenance } from './home-halloween-provenance';

export type PreparedHalloweenImage = { cardId: string; file: File; url: string; name: string };

export const HALLOWEEN_QR_PATH = '/home/events/halloween/cards/play-qr.svg';

export function halloweenCaption(card: GhostCard) {
  return [`${card.name} · ${card.tag}`, ...card.quote, HALLOWEEN_HOME_URL, `LINE ${HALLOWEEN_LINE_URL}`].join('\n');
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('โหลดรูปสำหรับทำภาพไม่สำเร็จ'));
    image.src = src;
  });
}

function toJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('สร้างไฟล์ภาพไม่สำเร็จ')), 'image/jpeg', 0.92));
}

export async function prepareHalloweenImage(card: GhostCard): Promise<PreparedHalloweenImage> {
  await document.fonts.ready;
  const [art, qr] = await Promise.all([loadImage(card.image), loadImage(HALLOWEEN_QR_PATH)]);
  const width = 1080;
  const height = 1920;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เปิดพื้นที่วาดภาพไม่สำเร็จ');

  context.fillStyle = '#180f27';
  context.fillRect(0, 0, width, height);
  const artHeight = 1480;
  const scale = Math.min(width / art.width, artHeight / art.height);
  const drawWidth = art.width * scale;
  const drawHeight = art.height * scale;
  context.drawImage(art, (width - drawWidth) / 2, (artHeight - drawHeight) / 2, drawWidth, drawHeight);
  context.fillStyle = '#251633';
  context.fillRect(0, artHeight, width, height - artHeight);
  context.strokeStyle = '#c99c52';
  context.lineWidth = 4;
  context.strokeRect(24, 24, width - 48, height - 48);
  context.fillStyle = '#f5d99b';
  context.textAlign = 'center';
  context.font = '600 38px "IBM Plex Sans Thai", sans-serif';

  context.fillText('การ์ดวิญญาณของฉัน', width / 2, 1540);
  context.font = '500 31px "IBM Plex Sans Thai", sans-serif';
  context.fillText('สแกนเพื่อดูเว็บไซต์', width / 2, 1598);
  context.fillStyle = '#fff';
  context.fillRect(width / 2 - 82, 1620, 164, 164);
  context.drawImage(qr, width / 2 - 74, 1628, 148, 148);
  context.font = '500 27px Outfit, sans-serif';
  context.fillStyle = '#f5d99b';
  context.fillText('mangmeeplus.com', width / 2, 1818);
  context.fillText('LINE @mangmeeplus', width / 2, 1864);

  const jpeg = await toJpeg(canvas);
  const marked = embedHalloweenProvenance(new Uint8Array(await jpeg.arrayBuffer()), makeHalloweenImageProvenance(card.id, 'story'));
  const blob = new Blob([new Uint8Array(marked)], { type: 'image/jpeg' });
  const name = `mangmee-${card.id}-story-9x16.jpg`;
  return { cardId: card.id, file: new File([blob], name, { type: 'image/jpeg' }), url: URL.createObjectURL(blob), name };
}

export function supportsFileShare(file: File) {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* use the visible manual-copy field below */ }
  return false;
}
