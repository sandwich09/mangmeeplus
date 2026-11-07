import { degrees, PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import Decimal from 'decimal.js';
import { escapeHtml } from '../../../../common/security/liff-page.security';
import { wrapText } from './substitute-receipt.logic';
import { SUBSTITUTE_RECEIPT_PDF_LIMITS } from './substitute-receipt-pdf.logic';

export type RecordPdfFile = {
  path: string; part: number; mimeType: string; load: () => Promise<Buffer>; identity?: string;
  unavailableReason?: string;
};
export type RecordPdfAppendix = { path: string; part: number; status: 'included' | 'referenced' | 'unavailable'; reason?: string };
const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 36, FOOTER = 28;
const LIMITS = SUBSTITUTE_RECEIPT_PDF_LIMITS;

export function recordMoney(value: string): string {
  const [whole = '0', fraction = '00'] = new Decimal(value).toFixed(2, Decimal.ROUND_HALF_UP).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function recordFileReadFailure(error: unknown): string {
  const failure = (error ?? {}) as { status?: number; code?: string; getStatus?: () => number; $metadata?: { httpStatusCode?: number } };
  const status = failure.getStatus?.() ?? failure.status ?? failure.$metadata?.httpStatusCode;
  return status === 404 || ['ENOENT', 'NoSuchKey', 'NoSuchVersion'].includes(failure.code ?? '') ? 'ไม่พบไฟล์'
    : status === 403 ? 'ไม่มีสิทธิ์เปิดไฟล์' : 'อ่านไฟล์ไม่ได้ ลองดาวน์โหลดอีกครั้ง';
}

/** Conservative structure inspection. Parsing alone never establishes that an original is unsigned. */
function pdfProtection(document: PDFDocument): 'signature' | 'uncertain' | undefined {
  if (document.isEncrypted) return 'uncertain';
  let signature = false, uncertain = false;
  const visited = new Set<unknown>();
  const inspect = (object: unknown) => {
    if (!object || visited.has(object)) return;
    visited.add(object);
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) {
        const name = key.decodeText();
        if (['ByteRange', 'Perms', 'DocMDP'].includes(name) || ['FT', 'Type'].includes(name) && value instanceof PDFName && value.decodeText() === 'Sig') signature = true;
        if (['EmbeddedFiles', 'EF', 'AF', 'XFA'].includes(name) || name === 'Type' && value instanceof PDFName && value.decodeText() === 'EmbeddedFile') uncertain = true;
        if (name === 'AcroForm') {
          const form = object.lookupMaybe(key, PDFDict);
          if (!form || (form.lookupMaybe(PDFName.of('Fields'), PDFArray)?.size() ?? 0) > 0) uncertain = true;
        }
        if (name === 'Filter') {
          const filters = value instanceof PDFArray ? value.asArray() : [value];
          if (filters.some(filter => !(filter instanceof PDFName) || !['FlateDecode', 'DCTDecode', 'JPXDecode', 'CCITTFaxDecode', 'JBIG2Decode', 'LZWDecode', 'RunLengthDecode', 'ASCIIHexDecode', 'ASCII85Decode'].includes(filter.decodeText()))) uncertain = true;
        }
        inspect(value);
      }
    } else if (object instanceof PDFArray) object.asArray().forEach(inspect);
    else if (typeof object === 'object') {
      if (object.constructor.name === 'PDFInvalidObject') uncertain = true;
      if ('dict' in object) inspect(object.dict);
    }
  };
  inspect(document.catalog);
  for (const [, object] of document.context.enumerateIndirectObjects()) inspect(object);
  return signature ? 'signature' : uncertain ? 'uncertain' : undefined;
}

async function appendPdf(destination: PDFDocument, source: PDFDocument, maxPages: number) {
  if (!source.getPageCount() || destination.getPageCount() + source.getPageCount() > maxPages) throw new Error('page_limit');
  const pages = source.getPages();
  for (const page of pages) {
    const { width, height } = page.getSize();
    if (!(width > FOOTER && height > FOOTER) || width > LIMITS.maxRasterDimension || height > LIMITS.maxRasterDimension || page.getRotation().angle % 90 !== 0) throw new Error('page_size');
  }
  const embeddedPages = await destination.embedPages(pages.filter(page => page.node.Contents()));
  let contentIndex = 0;
  for (const page of pages) {
    const { width, height } = page.getSize();
    const angle = (page.getRotation().angle % 360 + 360) % 360;
    const targetWidth = angle % 180 ? height : width, targetHeight = angle % 180 ? width : height;
    const target = destination.addPage([targetWidth, targetHeight]);
    if (!page.node.Contents()) continue;
    const embedded = embeddedPages[contentIndex++]!;
    await embedded.embed();
    const scale = (targetHeight - FOOTER) / targetHeight;
    const x = (targetWidth - targetWidth * scale) / 2 + (angle === 180 || angle === 270 ? targetWidth * scale : 0);
    const y = FOOTER + (angle === 90 || angle === 180 ? targetHeight * scale : 0);
    target.drawPage(embedded, { x, y, width: width * scale, height: height * scale, rotate: degrees(-angle) });
  }
}

async function appendRecordFile(destination: PDFDocument, file: RecordPdfFile, maxPages: number, budget: { bytes: number }): Promise<RecordPdfAppendix> {
  const result: RecordPdfAppendix = { path: file.path, part: file.part, status: 'referenced' };
  if (file.unavailableReason) return { ...result, status: 'unavailable', reason: file.unavailableReason };
  let bytes: Buffer;
  try { bytes = await file.load(); }
  catch (error) { return { ...result, status: 'unavailable', reason: recordFileReadFailure(error) }; }
  const start = destination.getPageCount();
  try {
    if (budget.bytes + bytes.length > 60_000_000) return { ...result, reason: 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ' };
    // The header selects the parser even for mislabeled files. Only parsed objects decide integrity.
    if (file.mimeType === 'application/pdf' || bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
      try {
        const source = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
        const protection = pdfProtection(source);
        if (protection) return { ...result, reason: protection === 'signature' ? 'เปิดไฟล์ต้นฉบับเพื่อคงลายเซ็นอิเล็กทรอนิกส์' : 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ' };
        await appendPdf(destination, source, maxPages);
      } catch {
        while (destination.getPageCount() > start) destination.removePage(destination.getPageCount() - 1);
        return { ...result, reason: 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ' };
      }
    } else if (['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimeType)) {
      const image = sharp(bytes, { limitInputPixels: LIMITS.maxRasterPixels }).rotate();
      const resized = await image.resize({ width: Math.round((WIDTH - MARGIN * 2) * 200 / 72), withoutEnlargement: true })
        .flatten({ background: '#fff' }).png().toBuffer({ resolveWithObject: true });
      const sliceHeight = Math.floor(resized.info.width * (HEIGHT - MARGIN * 2 - FOOTER) / (WIDTH - MARGIN * 2));
      const count = Math.ceil(resized.info.height / sliceHeight);
      if (destination.getPageCount() + count > maxPages) return { ...result, reason: 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ' };
      for (let top = 0; top < resized.info.height; top += sliceHeight) {
        const height = Math.min(sliceHeight, resized.info.height - top);
        const data = await sharp(resized.data).extract({ left: 0, top, width: resized.info.width, height }).jpeg({ quality: 85 }).toBuffer();
        const embedded = await destination.embedJpg(data);
        const target = destination.addPage([WIDTH, HEIGHT]);
        const placedWidth = Math.min(WIDTH - MARGIN * 2, resized.info.width * 72 / 200);
        const placedHeight = height * placedWidth / resized.info.width;
        target.drawImage(embedded, { x: MARGIN, y: HEIGHT - MARGIN - placedHeight, width: placedWidth, height: placedHeight });
      }
    } else return { ...result, reason: 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ' };
    budget.bytes += bytes.length;
    return { ...result, status: 'included' };
  } catch {
    while (destination.getPageCount() > start) destination.removePage(destination.getPageCount() - 1);
    return { ...result, reason: 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ' };
  }
}

export async function buildExpenseRecordPdf(input: {
  cover: readonly string[]; leading?: RecordPdfFile; files: readonly RecordPdfFile[];
  exportedAt: Date; timezone: string; relatedPackets?: readonly { path: string; part: number }[];
}): Promise<{ data: Buffer; appendices: RecordPdfAppendix[] }> {
  const destination = await PDFDocument.create();
  const budget = { bytes: 0 };
  const appendices: RecordPdfAppendix[] = [];
  const indexLines = [...input.cover, 'เอกสารในชุดนี้', ...[...(input.leading ? [input.leading] : []), ...input.files].flatMap(file => [
    `${file.path} (ชุดที่ ${file.part})`, 'เปิดไฟล์ต้นฉบับเพื่อคงลายเซ็นอิเล็กทรอนิกส์',
  ]), 'ชุดเอกสารรายการที่เกี่ยวข้อง', ...(input.relatedPackets ?? []).map(file => `${file.path} (ชุดที่ ${file.part})`)];
  const reservedPages = Math.ceil(indexLines.flatMap(line => wrapText(line, 770, 16)).length / 35);
  const maxContentPages = LIMITS.maxPages - reservedPages;
  if (input.leading) appendices.push(await appendRecordFile(destination, input.leading, maxContentPages, budget));
  const indexPosition = destination.getPageCount();
  const seen = new Set(input.leading ? [input.leading.identity ?? input.leading.path] : []);
  for (const file of input.files) {
    const identity = file.identity ?? file.path;
    if (seen.has(identity)) continue;
    seen.add(identity);
    appendices.push(await appendRecordFile(destination, file, maxContentPages, budget));
  }
  const lines = [...input.cover, 'เอกสารในชุดนี้', ...appendices.flatMap(file => [
    `${file.path} (ชุดที่ ${file.part})`, file.reason ?? (file.status === 'included' ? 'รวมในชุดนี้แล้ว' : 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ'),
  ]), ...(input.relatedPackets?.length ? ['ชุดเอกสารรายการที่เกี่ยวข้อง', ...input.relatedPackets.map(file => `${file.path} (ชุดที่ ${file.part})`)] : [])];
  const wrapped = lines.flatMap(line => wrapText(line, 770, 16));
  if (Math.ceil(wrapped.length / 35) + destination.getPageCount() > LIMITS.maxPages) throw new Error('page_limit');
  for (let start = 0; start < wrapped.length; start += 35) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="1150"><rect width="850" height="1150" fill="white"/><g font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="16" fill="#111">${wrapped.slice(start, start + 35).map((line, index) => `<text x="35" y="${45 + index * 29}">${escapeHtml(line)}</text>`).join('')}</g></svg>`;
    // Fixed-size sheets already have explicit breaks, so render their Thai SVG directly without a second PDF composition.
    const image = await destination.embedJpg(await sharp(Buffer.from(svg), { density: 144, limitInputPixels: LIMITS.maxRasterPixels })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer());
    await image.embed();
    const page = destination.insertPage(indexPosition + start / 35, [WIDTH, HEIGHT]);
    page.drawImage(image, { x: MARGIN, y: FOOTER + MARGIN, width: WIDTH - MARGIN * 2, height: HEIGHT - FOOTER - MARGIN * 2 });
  }
  const label = `ส่งออกวันที่ ${new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short', year: 'numeric', timeZone: input.timezone }).format(input.exportedAt)}`;
  const footerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="28"><text x="8" y="20" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="14">${escapeHtml(label)}</text></svg>`;
  const footer = await destination.embedPng(await sharp(Buffer.from(footerSvg), { density: 144 }).png().toBuffer());
  for (const page of destination.getPages()) page.drawImage(footer, { x: 12, y: 2, width: Math.min(page.getWidth() - 24, 500), height: 20 });
  destination.setSubject(label);
  destination.setCreationDate(input.exportedAt); destination.setModificationDate(input.exportedAt);
  return { data: Buffer.from(await destination.save()), appendices };
}
