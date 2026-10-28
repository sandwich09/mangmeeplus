import { escapeCaption, escapeElapsedSeconds, escapeTier } from './home-halloween-escape';
import { embedHalloweenProvenance, makeHalloweenImageProvenance } from './home-halloween-provenance';
import type { PreparedHalloweenImage } from './home-halloween-share';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('โหลดภาพผลลัพธ์ไม่ได้'));
    image.src = src;
  });
}

function toJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('สร้างไฟล์ภาพไม่ได้')), 'image/jpeg', .92));
}

export async function prepareEscapeShareImage(escaped: boolean, secondsLeft: number): Promise<PreparedHalloweenImage> {
  const tier = escapeTier(escaped, secondsLeft);
  await document.fonts.ready;
  const art = await loadImage(`/home/events/halloween/escape-result-${escaped ? 'winner' : 'loser'}.png`);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เปิดพื้นที่วาดภาพไม่ได้');

  const background = context.createLinearGradient(0, 0, 1080, 1920);
  background.addColorStop(0, tier.id === 'trapped' ? '#26302f' : '#163c35');
  background.addColorStop(.55, tier.id === 'conqueror' ? '#533c64' : '#2b2347');
  background.addColorStop(1, '#130e22');
  context.fillStyle = background;
  context.fillRect(0, 0, 1080, 1920);
  context.fillStyle = 'rgba(213,236,217,.08)';
  for (let index = 0; index < 18; index++) {
    context.beginPath();
    context.arc((index * 173) % 1120, 180 + (index * 257) % 1420, 35 + index % 4 * 18, 0, Math.PI * 2);
    context.fill();
  }

  const artX = 90;
  const artY = 275;
  const artWidth = 900;
  const artHeight = 1125;
  context.save();
  context.beginPath();
  context.roundRect(artX, artY, artWidth, artHeight, 28);
  context.clip();
  context.drawImage(art, artX, artY, artWidth, artHeight);
  context.restore();
  context.strokeStyle = escaped ? '#f5d68a' : '#86624e';
  context.lineWidth = 10;
  context.beginPath();
  context.roundRect(artX, artY, artWidth, artHeight, 28);
  context.stroke();

  context.textAlign = 'center';
  context.fillStyle = '#fff5d8';
  context.shadowColor = 'rgba(0,0,0,.65)';
  context.shadowBlur = 22;
  context.font = '700 72px "IBM Plex Sans Thai", sans-serif';
  context.fillText('คฤหาสน์ไร้ทางออก', 540, 120);
  context.shadowBlur = 0;
  context.fillStyle = '#cce8d2';
  context.font = '500 34px "IBM Plex Sans Thai", sans-serif';
  context.fillText(escaped ? 'ฉันหนีออกมาได้แล้ว' : 'ประตูปิดลงก่อนจะหนีทัน', 540, 180);

  context.fillStyle = 'rgba(24,15,39,.88)';
  context.beginPath();
  context.roundRect(60, 1500, 960, 270, 34);
  context.fill();
  context.strokeStyle = tier.id === 'conqueror' ? '#f4d47f' : '#82c49c';
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = '#fff';
  context.font = '700 58px "IBM Plex Sans Thai", sans-serif';
  context.fillText(tier.title, 540, 1607, 860);
  context.fillStyle = '#d8ccdf';
  context.font = '500 31px "IBM Plex Sans Thai", sans-serif';
  const detail = escaped ? `${escapeElapsedSeconds(secondsLeft)} วินาที` : 'ไขได้ไม่ทัน';
  context.fillText(detail, 540, 1680);
  context.fillStyle = '#fff0c1';
  context.font = '500 32px Outfit, sans-serif';
  context.fillText('mangmeeplus.com', 540, 1848);

  const jpeg = await toJpeg(canvas);
  const cardId = `escape-${tier.id}-${secondsLeft}`;
  const marked = embedHalloweenProvenance(new Uint8Array(await jpeg.arrayBuffer()), makeHalloweenImageProvenance(cardId, 'story'));
  const blob = new Blob([new Uint8Array(marked)], { type: 'image/jpeg' });
  const name = `mangmee-escape-${tier.id}-story-9x16.jpg`;
  return { cardId, file: new File([blob], name, { type: 'image/jpeg' }), url: URL.createObjectURL(blob), name };
}

export { escapeCaption };
