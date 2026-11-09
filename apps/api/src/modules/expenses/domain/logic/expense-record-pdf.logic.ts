import { degrees, PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import Decimal from 'decimal.js';
import { escapeHtml } from '../../../../common/security/liff-page.security';
import { wrapText } from './substitute-receipt.logic';
import { SUBSTITUTE_RECEIPT_PDF_LIMITS } from './substitute-receipt-pdf.logic';

export type RecordPdfFile = {
  path: string; part: number; mimeType: string; load: () => Promise<Buffer>; identity?: string;
  unavailableReason?: string;
  /** What these pages are, printed at the bottom right of each of them, e.g. "หลักฐานการจ่าย". */
  label?: string;
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

/** One expense's cover: what an accountant reads before the attached evidence. */
export type RecordCover = {
  number: string; fields: readonly (readonly [string, string])[]; amountUnit: string;
  amounts: readonly { label: string; value: string; strong?: boolean }[];
  payments: readonly { date: string; method: string; account: string; amount: string }[];
  notes: readonly string[];
};
// The cover page is an SVG at the content area's aspect ratio, so text is not stretched when placed.
const PAGE_W = 850, PAGE_H = Math.round(PAGE_W * (HEIGHT - FOOTER - MARGIN * 2) / (WIDTH - MARGIN * 2)), LEFT = 40, RIGHT = 810, VALUE_X = 290, ROW = 34;
type CoverItem = { height: number; svg: (y: number) => string };
const text = (x: number, y: number, value: string, attributes = '') => `<text x="${x}" y="${y}"${attributes}>${escapeHtml(value)}</text>`;
const rule = (y: number, color = '#D1D5DB') => `<line x1="${LEFT}" x2="${RIGHT}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="1"/>`;
const lines = (value: string, width: number) => wrapText(value, width, 18);

function coverItems(covers: readonly RecordCover[], files: readonly { path: string; part: number; note: string; label?: string; pages?: string }[], related: readonly { path: string; part: number }[]): CoverItem[] {
  const items: CoverItem[] = [];
  const heading = (title: string) => items.push({ height: 58, svg: y => text(LEFT, y + 38, title, ' font-size="21" font-weight="700" fill="#14532D"') + rule(y + 50, '#14532D') });
  const wrapped = (x: number, width: number, value: string, attributes: string, first: (y: number) => string = () => '') => lines(value, width)
    .forEach((line, index) => items.push({ height: ROW, svg: y => (index ? '' : first(y)) + text(x, y + 24, line, attributes) }));
  for (const cover of covers) {
    items.push({ height: 104, svg: y => text(LEFT, y + 26, 'สรุปรายการค่าใช้จ่าย', ' font-size="18" fill="#4B5563"')
      + text(LEFT, y + 72, cover.number, ' font-size="34" font-weight="700" fill="#111827"') + rule(y + 92, '#14532D') });
    heading('ข้อมูลเอกสาร');
    for (const [label, value] of cover.fields) wrapped(VALUE_X, RIGHT - VALUE_X, value || '-', ' font-size="18" fill="#111827"', y => text(LEFT, y + 24, label, ' font-size="18" fill="#4B5563"'));
    heading(`ยอดเงิน (${cover.amountUnit})`);
    for (const amount of cover.amounts) items.push({ height: ROW + 4, svg: y => {
      const weight = amount.strong ? ' font-weight="700"' : '';
      return (amount.strong ? `<rect x="${LEFT}" y="${y + 2}" width="${RIGHT - LEFT}" height="${ROW}" fill="#F0FDF4"/>` : '')
        + text(LEFT + 8, y + 26, amount.label, ` font-size="18" fill="#374151"${weight}`)
        + text(RIGHT - 8, y + 26, amount.value, ` font-size="18" fill="#111827" text-anchor="end"${weight}`);
    } });
    heading('การจ่าย');
    if (!cover.payments.length) items.push({ height: ROW, svg: y => text(LEFT, y + 24, 'ยังไม่ได้จ่าย', ' font-size="18" fill="#92400E"') });
    else {
      items.push({ height: ROW, svg: y => ['วันที่จ่าย', 'วิธีจ่าย', 'จ่ายจาก'].map((label, i) => text([LEFT, 290, 470][i]!, y + 24, label, ' font-size="16" fill="#6B7280"')).join('')
        + text(RIGHT, y + 24, 'จำนวนเงิน', ' font-size="16" fill="#6B7280" text-anchor="end"') });
      for (const payment of cover.payments) items.push({ height: ROW, svg: y => rule(y + 2, '#E5E7EB') + text(LEFT, y + 26, payment.date, ' font-size="18"')
        + text(290, y + 26, payment.method, ' font-size="18"') + text(470, y + 26, lines(payment.account || '-', 200)[0]!, ' font-size="18"')
        + text(RIGHT, y + 26, payment.amount, ' font-size="18" text-anchor="end"') });
    }
    if (cover.notes.length) {
      heading('หมายเหตุ');
      for (const note of cover.notes) wrapped(LEFT, RIGHT - LEFT, note, ' font-size="18" fill="#92400E"');
    }
  }
  heading('เอกสารในไฟล์นี้');
  if (!files.length) wrapped(LEFT, RIGHT - LEFT, 'ไม่มีไฟล์แนบ รายการนี้ยังไม่มีรูปเอกสารหรือหลักฐานการจ่ายในมั่งมี', ' font-size="18" fill="#92400E"');
  files.forEach((file, index) => {
    // A table of contents: what the document is on the left, its pages on the right.
    wrapped(LEFT + 34, RIGHT - LEFT - 200, file.label ?? file.path, ' font-size="18" fill="#111827"', y => text(LEFT, y + 24, `${index + 1}.`, ' font-size="18" fill="#111827"')
      + text(RIGHT, y + 24, file.pages ?? 'แยกไว้ต่างหาก', ` font-size="18" text-anchor="end" fill="${file.pages ? '#111827' : '#92400E'}"`));
    if (!file.pages) wrapped(LEFT + 34, RIGHT - LEFT - 34, file.note, ' font-size="15" fill="#92400E"');
    wrapped(LEFT + 34, RIGHT - LEFT - 34, `ไฟล์ต้นฉบับ ${file.path} ในชุดที่ ${file.part}`, ' font-size="15" fill="#6B7280"');
  });
  if (related.length) {
    heading('ชุดเอกสารรายการที่เกี่ยวข้อง');
    for (const file of related) wrapped(LEFT, RIGHT - LEFT, `${file.path} ในชุดที่ ${file.part}`, ' font-size="18" fill="#111827"');
  }
  return items;
}

function paginate(items: readonly CoverItem[]): string[] {
  const pages: string[][] = [[]];
  let y = 0;
  for (const item of items) {
    if (y + item.height > PAGE_H - 20 && pages.at(-1)!.length) { pages.push([]); y = 0; }
    pages.at(-1)!.push(item.svg(y)); y += item.height;
  }
  return pages.map(page => `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}"><rect width="${PAGE_W}" height="${PAGE_H}" fill="white"/><g font-family="Noto Sans Thai, Tahoma, sans-serif" fill="#111">${page.join('')}</g></svg>`);
}

export async function buildExpenseRecordPdf(input: {
  cover: readonly RecordCover[]; leading?: RecordPdfFile; files: readonly RecordPdfFile[];
  exportedAt: Date; timezone: string; relatedPackets?: readonly { path: string; part: number }[];
}): Promise<{ data: Buffer; appendices: RecordPdfAppendix[] }> {
  const destination = await PDFDocument.create();
  const budget = { bytes: 0 };
  const appendices: RecordPdfAppendix[] = [];
  const related = input.relatedPackets ?? [];
  const reservedPages = paginate(coverItems(input.cover, [...(input.leading ? [input.leading] : []), ...input.files]
    .map(file => ({ ...file, note: 'เปิดไฟล์ต้นฉบับเพื่อคงลายเซ็นอิเล็กทรอนิกส์' })), related)).length;
  const maxContentPages = LIMITS.maxPages - reservedPages;
  const sections: { label: string; from: number; to: number }[] = [], ranges: { from: number; to: number }[] = [];
  const seen = new Set<string>();
  // The cover goes first; a paid voucher then leads the evidence because it is the payment record.
  for (const file of [...(input.leading ? [input.leading] : []), ...input.files]) {
    const identity = file.identity ?? file.path;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const from = destination.getPageCount();
    appendices.push(await appendRecordFile(destination, file, maxContentPages, budget));
    ranges.push({ from, to: destination.getPageCount() });
    if (file.label && destination.getPageCount() > from) sections.push({ label: file.label, from, to: destination.getPageCount() });
  }
  const indexPosition = 0;
  // Included files name their pages, which sit after the cover; a second pass settles a cover that grew a page.
  const sources = [...(input.leading ? [input.leading] : []), ...input.files];
  const coverPages = (offset: number) => paginate(coverItems(input.cover, appendices.map((file, index) => ({ ...file, label: sources.find(source => source.path === file.path)?.label,
    note: file.reason ?? 'ไฟล์นี้แยกไว้ในโฟลเดอร์ต้นฉบับ',
    pages: file.status !== 'included' ? undefined : ranges[index]!.to - ranges[index]!.from > 1
      ? `หน้า ${ranges[index]!.from + offset + 1} ถึง ${ranges[index]!.to + offset}` : `หน้า ${ranges[index]!.from + offset + 1}` })), related));
  let pages = coverPages(1);
  if (pages.length !== 1) pages = coverPages(pages.length);
  if (pages.length + destination.getPageCount() > LIMITS.maxPages) throw new Error('page_limit');
  for (const [index, svg] of pages.entries()) {
    // Fixed-size sheets already have explicit breaks, so render their Thai SVG directly without a second PDF composition.
    const image = await destination.embedJpg(await sharp(Buffer.from(svg), { density: 144, limitInputPixels: LIMITS.maxRasterPixels })
      .jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer());
    await image.embed();
    const page = destination.insertPage(indexPosition + index, [WIDTH, HEIGHT]);
    page.drawImage(image, { x: MARGIN, y: FOOTER + MARGIN, width: WIDTH - MARGIN * 2, height: HEIGHT - FOOTER - MARGIN * 2 });
  }
  const dateLabel = `ส่งออกวันที่ ${new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { day: 'numeric', month: 'short', year: 'numeric', timeZone: input.timezone }).format(input.exportedAt)}`;
  const footerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="28"><text x="8" y="20" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="14">${escapeHtml(dateLabel)}</text></svg>`;
  const footer = await destination.embedPng(await sharp(Buffer.from(footerSvg), { density: 144 }).png().toBuffer());
  for (const page of destination.getPages()) page.drawImage(footer, { x: 12, y: 2, width: Math.min(page.getWidth() - 24, 500), height: 20 });
  const labelImage = async (text: string) => destination.embedPng(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="36"><text x="672" y="27" text-anchor="end" font-family="Noto Sans Thai, Tahoma, sans-serif" font-size="22" font-weight="700" fill="#14532D">${escapeHtml(text)}</text></svg>`), { density: 144 }).png().toBuffer());
  const label = (image: Awaited<ReturnType<typeof labelImage>>, from: number, to: number) => {
    for (let index = from; index < to; index++) {
      const page = destination.getPage(index);
      page.drawImage(image, { x: page.getWidth() - 12 - 340, y: 4, width: 340, height: 18 });
    }
  };
  const numbers = input.cover.map(cover => cover.number);
  const owner = numbers.length > 2 ? `${numbers[0]} และอีก ${numbers.length - 1} รายการ` : numbers.join(', ');
  label(await labelImage(`${owner} สรุปรายการ`), 0, pages.length);
  for (const section of sections) label(await labelImage(`${owner} ${section.label}`), section.from + pages.length, section.to + pages.length);
  destination.setSubject(dateLabel);
  destination.setCreationDate(input.exportedAt); destination.setModificationDate(input.exportedAt);
  return { data: Buffer.from(await destination.save()), appendices };
}
