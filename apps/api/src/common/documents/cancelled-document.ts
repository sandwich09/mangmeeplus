const RED = '#991B1B';
const FONT = 'Noto Sans Thai, Tahoma, sans-serif';
const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
const words = new Intl.Segmenter('th', { granularity: 'word' });
// Same print-font advance budgets as the claim form, scaled from 15px to this box's 16px.
// Thai vowel/tone marks share their base glyph's advance; a flat 13px per cluster wrapped too early.
function textWidth(text: string): number {
  let width = 0;
  for (const { segment } of graphemes.segment(text)) {
    width += /^\s+$/.test(segment) ? 4.5
      : /^[.,:;|!()\-]$/.test(segment) ? 5.5
      : /^[%@WM#]/.test(segment) ? 14.5
      : /^[A-Z0-9]/.test(segment) ? 9.5
      : /^[\u0000-\u007f]/.test(segment) ? 8
      : /^[ฌญฑฒณ]/.test(segment) ? 13.2
      : /^[ซฆทพฟษหฬ]/.test(segment) ? 11.3
      : /^[เรใะวาำงโๆไ]/.test(segment) ? 6.8
      : /^[\u0e00-\u0e7f]/.test(segment) ? 9.7 : 16;
  }
  return width * 16 / 15;
}

const xml = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

/** Shared print design; state and permission decisions belong to the calling use case. */
export function cancelledDocumentWatermark(width: number, height: number): string {
  return `<g data-cancelled-watermark="true" transform="translate(${width / 2} ${height / 2}) rotate(-30)" opacity="0.18" fill="${RED}" font-family="${FONT}" font-weight="700" text-anchor="middle">
    <text y="0" font-size="${width * 0.15}">ยกเลิก</text>
    <text y="${width * 0.065}" font-family="Arial, DejaVu Sans, sans-serif" font-size="${width * 0.045}" letter-spacing="3">CANCELLED</text>
  </g>`;
}

function cancellationReasonLines(reason: string | null | undefined): string[] {
  const lines: string[] = [];
  for (const paragraph of (reason?.trim() || 'ไม่ได้ระบุเหตุผลการยกเลิก').split(/\r?\n/)) {
    let line = '';
    for (const { segment } of words.segment(paragraph)) {
      if (textWidth(line + segment) <= 710) { line += segment; continue; }
      if (line) lines.push(line.trimEnd());
      line = '';
      for (const { segment: grapheme } of graphemes.segment(segment.trimStart())) {
        if (line && textWidth(line + grapheme) > 710) { lines.push(line); line = ''; }
        line += grapheme;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function cancelledDocumentReasonBox(reason: string | null | undefined, documentNumber?: string): { svg: string; height: number } {
  return renderReasonBox(cancellationReasonLines(reason), documentNumber);
}

/** A reason taller than one sheet continues without shrinking or losing recorded text. */
export function cancelledDocumentReasonBoxes(reason: string | null | undefined, maxHeight: number): Array<{ svg: string; height: number }> {
  const lines = cancellationReasonLines(reason);
  const perPage = Math.max(1, Math.floor((maxHeight - 112) / 24));
  const boxes = [];
  for (let offset = 0; offset < lines.length; offset += perPage) {
    boxes.push(renderReasonBox(lines.slice(offset, offset + perPage), undefined, offset > 0));
  }
  return boxes;
}

function renderReasonBox(lines: string[], documentNumber?: string, continuation = false): { svg: string; height: number } {
  const offset = documentNumber ? 28 : 0;
  const height = 112 + offset + lines.length * 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 760 ${height}">
    <rect x="1" y="1" width="758" height="${height - 2}" fill="#FFF7F7" stroke="${RED}" stroke-width="1.5"/>
    <g font-family="${FONT}" font-size="16" fill="#222">
      <text x="24" y="34" font-weight="700" fill="${RED}">เหตุผลการยกเลิกเอกสาร${continuation ? ' (ต่อ)' : ''}</text>
      ${documentNumber ? `<text x="24" y="62" font-size="14">เลขที่เอกสาร: ${xml(documentNumber)}</text>` : ''}
      ${lines.map((line, index) => `<text x="24" y="${64 + offset + index * 24}">${xml(line)}</text>`).join('')}
      <line x1="24" x2="736" y1="${height - 44}" y2="${height - 44}" stroke="#E5C7C7"/>
      <text x="24" y="${height - 20}" font-size="13" fill="${RED}">เอกสารฉบับนี้ยกเลิกแล้ว ใช้เพื่อการอ้างอิงและตรวจสอบย้อนหลังเท่านั้น</text>
    </g>
  </svg>`;
  return { svg, height };
}
