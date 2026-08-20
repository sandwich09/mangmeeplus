/**
 * Pure domain logic for LINE AI answer formatting.
 * Thai-first, concise, with source labels and safe web links.
 * No NestJS, Prisma, HTTP, LINE SDK, AI provider, or storage imports.
 */
import type { LineAiRefusalReason, LineAiWebLink } from '@watchdog-bms/contracts';
import type { SourceRef } from '@watchdog-bms/contracts';
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
    '⏱ ขออภัยค่ะ ระบบใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้งนะคะ',
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

// ---- Source ref formatting ----

export function buildSourceLabels(sourceRefs: SourceRef[]): string[] {
  return sourceRefs.map((ref) => ref.label);
}

export function buildWebLinks(sourceRefs: SourceRef[]): LineAiWebLink[] {
  return sourceRefs.flatMap((ref) => (ref.webPath ? [{ label: ref.label, path: webLink(ref.webPath) }] : []));
}

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
