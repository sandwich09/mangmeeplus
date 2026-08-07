import { planDocumentRaster } from './document-raster.logic';
import { buildImagePdf } from './image-pdf.logic';

/**
 * Saves an on-screen document image (ใบเบิกค่าใช้จ่าย, ใบรับรองแทนใบเสร็จ, a receipt photo) as a PDF.
 *
 * Rasterising in the browser rather than rendering the PDF server-side is deliberate: the documents
 * are SVG with `font-family="Noto Sans Thai, Tahoma"`, so only a machine that HAS a Thai font can
 * draw them — the API container has none, and the repo ships no font file. The viewer's browser
 * already rendered the page correctly, so we capture exactly what the user is looking at.
 */
export async function downloadDocumentAsPdf(
  src: string,
  fileName: string,
  /** SVG documents carry no fixed resolution, so they may be rendered as large as the page needs. */
  options: { vector?: boolean } = {},
): Promise<void> {
  const image = await loadImage(src);
  const plan = planDocumentRaster({
    naturalWidth: image.naturalWidth || 850,
    naturalHeight: image.naturalHeight || 1202,
    vector: options.vector ?? false,
  });
  const { canvasWidth: width, canvasHeight: height } = plan;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('เบราว์เซอร์นี้สร้างไฟล์ PDF ไม่ได้ กรุณาใช้ปุ่มเปิดแท็บใหม่แทน');
  // JPEG carries no alpha: paint the sheet white first or transparent areas turn black.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let jpegDataUrl: string;
  try {
    jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
  } catch {
    // Tainted canvas: the source is cross-origin without CORS headers.
    throw new Error('ดาวน์โหลดไฟล์นี้เป็น PDF ไม่ได้ กรุณาใช้ปุ่มเปิดแท็บใหม่แทน');
  }

  const pdf = buildImagePdf({
    jpeg: base64ToBytes(jpegDataUrl.slice(jpegDataUrl.indexOf(',') + 1)),
    pixelWidth: width,
    pixelHeight: height,
    maxDrawWidthPt: plan.maxDrawWidthPt,
  });
  saveBlob(new Blob([pdf as BlobPart], { type: 'application/pdf' }), fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Storage URLs are another origin; without this the canvas would be tainted.
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('โหลดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'));
    image.src = src;
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
