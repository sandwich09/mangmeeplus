import { candyCaption, candyTier } from './home-halloween-candy';
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

export async function prepareCandyShareImage(score: number): Promise<PreparedHalloweenImage> {
  const tier = candyTier(score);
  await document.fonts.ready;
  const art = await loadImage(tier.image);
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เปิดพื้นที่วาดภาพไม่ได้');

  const scale = Math.max(canvas.width / art.width, canvas.height / art.height);
  const width = art.width * scale;
  const height = art.height * scale;
  context.drawImage(art, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  const top = context.createLinearGradient(0, 0, 0, 430);
  top.addColorStop(0, 'rgba(24,7,35,.82)');
  top.addColorStop(1, 'rgba(24,7,35,0)');
  context.fillStyle = top;
  context.fillRect(0, 0, 1080, 430);
  const bottom = context.createLinearGradient(0, 1120, 0, 1920);
  bottom.addColorStop(0, 'rgba(24,7,35,0)');
  bottom.addColorStop(1, 'rgba(24,7,35,.94)');
  context.fillStyle = bottom;
  context.fillRect(0, 1120, 1080, 800);

  context.textAlign = 'left';
  context.fillStyle = '#fff4d1';
  context.shadowColor = 'rgba(0,0,0,.65)';
  context.shadowBlur = 20;
  context.font = '700 70px "IBM Plex Sans Thai", sans-serif';
  context.fillText('คืนล่าลูกอม', 60, 100);
  context.fillText('ต้องสาป', 60, 180);

  context.shadowBlur = 0;
  context.fillStyle = 'rgba(45,18,52,.82)';
  context.beginPath();
  context.roundRect(790, 58, 230, 70, 35);
  context.fill();
  context.strokeStyle = '#ffe18f';
  context.lineWidth = 2;
  context.stroke();
  context.textAlign = 'center';
  context.fillStyle = '#ffe49a';
  context.font = '500 34px "IBM Plex Sans Thai", sans-serif';
  context.fillText(`${score} คะแนน`, 905, 106);

  context.fillStyle = 'rgba(63,19,73,.9)';
  context.beginPath();
  context.roundRect(58, 1595, 964, 150, 28);
  context.fill();
  context.strokeStyle = '#ffd770';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = '#fff';
  context.shadowColor = 'rgba(0,0,0,.55)';
  context.shadowBlur = 14;
  context.font = '700 62px "IBM Plex Sans Thai", sans-serif';
  context.fillText(tier.title, 540, 1692, 900);
  context.shadowBlur = 0;
  context.fillStyle = '#fff2d2';
  context.font = '500 31px Outfit, sans-serif';
  context.fillText('mangmeeplus.com', 540, 1847);

  const jpeg = await toJpeg(canvas);
  const cardId = `candy-${tier.id}-${score}`;
  const marked = embedHalloweenProvenance(new Uint8Array(await jpeg.arrayBuffer()), makeHalloweenImageProvenance(cardId, 'story'));
  const blob = new Blob([new Uint8Array(marked)], { type: 'image/jpeg' });
  const name = `mangmee-candy-${score}-story-9x16.jpg`;
  return { cardId, file: new File([blob], name, { type: 'image/jpeg' }), url: URL.createObjectURL(blob), name };
}

export { candyCaption };
