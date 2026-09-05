/**
 * Pure domain logic for LINE AI answer formatting.
 * Thai-first and concise. Refusal copy and answer templates only — source labels and web links
 * are composed by the AI Gateway and rendered by `formatLineReply`.
 * No NestJS, Prisma, HTTP, LINE SDK, AI provider, or storage imports.
 */
import type { LineAiRefusalReason } from '@watchdog-bms/contracts';
// One base-URL resolution for the whole app. The previous local const fell back to the production
// host, so any environment without WEB_BASE_URL/PUBLIC_BASE_URL sent its users to production.
import { webLink } from '../../../../common/http/web-link';

// ---- Refusal messages ----

export const REFUSAL_MESSAGES: Record<LineAiRefusalReason, string> = {
  mutation_blocked:
    '⚠️ ขออภัยค่ะ น้องมั่งมีไม่สามารถดำเนินการนี้ผ่าน LINE ได้\n' +
    'กรุณาเปิดเว็บแอปเพื่อดำเนินการต่อนะคะ',
  safety_crisis:
    'น้องมั่งมีเป็นห่วงความปลอดภัยของคุณนะคะ ตอนนี้คุณอยู่ในที่ปลอดภัยและมีคนที่ไว้ใจอยู่ใกล้ๆ ไหมคะ\n' +
    'ถ้าไหว โทรสายด่วนสุขภาพจิต 1323 (24 ชั่วโมง) หรือบอกคนที่ไว้ใจให้อยู่กับคุณตอนนี้ค่ะ\n' +
    'ถ้ามีอันตรายทันทีหรืออาจทำร้ายตัวเอง โทร 1669 หรือไปห้องฉุกเฉินที่ใกล้ที่สุดเดี๋ยวนี้นะคะ',
  privacy_rumor:
    'น้องมั่งมีไม่ขอเดาหรือขยายข่าวลือเกี่ยวกับชีวิตส่วนตัวของคนอื่นนะคะ',
  unsupported_module:
    '📋 ขออภัยค่ะ ฟีเจอร์นี้ยังไม่พร้อมใช้งานผ่าน LINE ในขณะนี้\n' +
    'กรุณาเปิดเว็บแอปเพื่อดูข้อมูลเพิ่มเติมนะคะ',
  // Spec §5.3: the subject IS in the system — telling the owner their own bill is "out of scope"
  // is wrong twice. Pass a `webPath` to `formatRefusal` and the link is appended below.
  unsupported_yet:
    '📋 เรื่องนี้อยู่ในระบบ แต่น้องมั่งมียังทำผ่าน LINE ไม่ได้ในตอนนี้ค่ะ\n' +
    'ทำได้ในเว็บนะคะ',
  forbidden:
    '🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ\n' +
    'หากต้องการสิทธิ์เพิ่มเติม กรุณาติดต่อผู้ดูแลระบบนะคะ',
  unlinked_user:
    '🔗 กรุณาเชื่อมต่อบัญชี มั่งมีพลัส กับ LINE ก่อนใช้งานนะคะ\n' +
    'แตะ "เชื่อมต่อบัญชี" หรือเข้าสู่ระบบผ่านเว็บแอปค่ะ',
  ambiguous_company:
    '🏢 พบหลายบริษัทที่เชื่อมต่อกับบัญชีของคุณค่ะ\n' +
    'กรุณาเลือกบริษัทที่ต้องการผ่านเว็บแอปนะคะ',
  tool_unavailable:
    '⏳ ข้อมูลไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่อีกครั้งนะคะ',
  feature_disabled:
    '📋 ฟีเจอร์นี้ยังไม่ได้เปิดใช้งานหรือยังไม่พร้อมใช้งานในระบบนี้ค่ะ',
  ai_timeout:
    '⏱ ขออภัยค่ะ รอบนี้ระบบใช้เวลานานเกินไปจนต้องหยุดก่อนค่ะ พิมพ์คำถามเดิมส่งมาใหม่ได้เลยนะคะ',
  line_delivery_failure:
    '❌ เกิดข้อผิดพลาดในการส่งข้อความ กรุณาลองใหม่อีกครั้งนะคะ',
};

export function formatRefusal(reason: LineAiRefusalReason, webPath?: string): string {
  const base = REFUSAL_MESSAGES[reason];
  if (webPath) {
    return `${base}\n🌐 ${webLink(webPath)}`;
  }
  return base;
}

// Source labels and web links are NOT built here. The AI Gateway owns both — it derives them from
// the same sourceRefs (`response-composer.agent.ts` filters `webPath`; `orchestrator.agent.ts` maps
// labels) — and the API only renders what it is handed, in `formatLineReply`. The duplicate pair
// that used to sit here had no caller in this repo's history and read as if the feature were unwired.

// ---- Thai answer templates ----

export function formatStaleDataWarning(asOf: string): string {
  return `⚠️ ข้อมูลอาจไม่ใช่ข้อมูลล่าสุด (อัปเดตล่าสุด: ${asOf})`;
}

export function formatUnavailableData(): string {
  return '📭 ไม่มีข้อมูลที่พร้อมแสดงในขณะนี้';
}

export function formatCompanyContext(companyName: string, branchCount: number): string {
  return `🏢 บริษัท: ${companyName}\n📍 สาขา: ${branchCount} สาขา`;
}

export function formatLowStockSummary(count: number, topItems: string[]): string {
  const header = `⚠️ สินค้าใกล้หมด: ${count} รายการ`;
  if (topItems.length === 0) return header;
  const list = topItems.slice(0, 5).map((item) => `• ${item}`).join('\n');
  return `${header}\n${list}`;
}

export function formatStockBalance(productName: string, qty: number, unit: string, locationName?: string): string {
  const loc = locationName ? ` (${locationName})` : '';
  return `📦 ${productName}${loc}: ${qty} ${unit}`;
}

export function formatOpenAlertsSummary(count: number, topAlerts: string[]): string {
  if (count === 0) return '✅ ไม่มีการแจ้งเตือนที่ค้างอยู่';
  const header = `🔔 การแจ้งเตือนที่ยังไม่ได้อ่าน: ${count} รายการ`;
  if (topAlerts.length === 0) return header;
  const list = topAlerts.slice(0, 5).map((a) => `• ${a}`).join('\n');
  return `${header}\n${list}`;
}

export function formatBusinessHealthSummary(score: number, summary: string): string {
  const emoji = score >= 80 ? '💚' : score >= 50 ? '🟡' : '🔴';
  return `${emoji} สุขภาพธุรกิจ: ${score}/100\n${summary}`;
}

/** Redact secrets/tokens from any log-like object. */
const REDACT_KEYS = /authorization|password|token|secret|cookie|credential|api[_-]?key|signature|x-line/i;

export function redactSensitiveFields(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      REDACT_KEYS.test(k) ? '[REDACTED]' : typeof v === 'object' && v !== null ? redactSensitiveFields(v as Record<string, unknown>) : v,
    ]),
  );
}
