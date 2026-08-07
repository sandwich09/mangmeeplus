// LINE behavior for AI suggestions (item 17). LINE may request a suggestion, ask for a
// pending summary, and deep-link to web review. It can NEVER create a source draft,
// accept, dismiss, or perform any final mutation — those are web-only and refused here.

export type LineSuggestionIntent = 'request' | 'pending_summary' | 'refuse_web_only' | 'help';

const REFUSE_KW = [
  'create draft', 'create source', 'accept', 'approve', 'confirm draft', 'apply',
  'สร้างร่าง', 'สร้างเอกสาร', 'อนุมัติ', 'ยืนยันร่าง', 'ยอมรับ', 'บันทึกร่าง',
];
const REQUEST_KW = ['suggest', 'suggestion', 'draft', 'recommend', 'ขอคำแนะนำ', 'แนะนำ', 'ร่าง', 'ช่วยคิด'];
const PENDING_KW = ['pending', 'queue', 'waiting', 'รอรีวิว', 'ค้าง', 'รายการรอ', 'ที่รออยู่'];

function matchAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

export function classifyLineSuggestionIntent(rawText: string): LineSuggestionIntent {
  const text = rawText.toLowerCase().trim();
  // Refusal takes priority: a "create/accept the draft" ask must be refused, not requested.
  if (matchAny(text, REFUSE_KW)) return 'refuse_web_only';
  if (matchAny(text, PENDING_KW)) return 'pending_summary';
  if (matchAny(text, REQUEST_KW)) return 'request';
  return 'help';
}

function suggestionsPath(webBaseUrl: string, companyId: string): string {
  const base = webBaseUrl.replace(/\/$/, '');
  return `${base}/companies/${companyId}/ai-suggestions`;
}

export function buildLineRequestAck(webBaseUrl: string, companyId: string): string {
  return [
    'รับคำขอแล้ว ✅ กำลังเตรียมคำแนะนำจาก AI',
    'เมื่อพร้อม จะให้รีวิวและยืนยันในเว็บ (LINE ดูสรุปได้เท่านั้น)',
    `เปิดรีวิว: ${suggestionsPath(webBaseUrl, companyId)}`,
  ].join('\n');
}

export function buildLineRefusal(webBaseUrl: string, companyId: string): string {
  return [
    'ไม่สามารถสร้างหรือยืนยันร่างผ่าน LINE ได้ 🔒',
    'AI แนะนำได้ แต่การสร้างร่างในระบบต้องรีวิวและยืนยันในเว็บเท่านั้น',
    `รีวิวในเว็บ: ${suggestionsPath(webBaseUrl, companyId)}`,
  ].join('\n');
}

export function buildLinePendingSummary(
  webBaseUrl: string,
  companyId: string,
  items: Array<{ title: string; riskLevel: string; citationCount: number }>,
): string {
  if (items.length === 0) {
    return `ไม่มีคำแนะนำ AI ที่รอรีวิว\nเปิดในเว็บ: ${suggestionsPath(webBaseUrl, companyId)}`;
  }
  const lines = items.slice(0, 3).map((s, i) => `${i + 1}. ${s.title} (ความเสี่ยง ${s.riskLevel}, อ้างอิง ${s.citationCount})`);
  return [
    `มีคำแนะนำ AI รอรีวิว ${items.length} รายการ`,
    ...lines,
    `รีวิวทั้งหมดในเว็บ: ${suggestionsPath(webBaseUrl, companyId)}`,
  ].join('\n');
}

export function buildLineHelp(webBaseUrl: string, companyId: string): string {
  return [
    'ผมช่วยเรื่องคำแนะนำจาก AI ได้:',
    '• พิมพ์ "ขอคำแนะนำ" เพื่อขอ AI draft',
    '• พิมพ์ "รายการรอ" เพื่อดูคำแนะนำที่รอรีวิว',
    `รีวิวและยืนยันได้ในเว็บ: ${suggestionsPath(webBaseUrl, companyId)}`,
  ].join('\n');
}
