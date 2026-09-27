import type { LinePreferenceValues } from '../../application/line-conversation-context.service';
export type LinePreferenceCommand = { kind: 'list' } | { kind: 'set'; values: LinePreferenceValues } | { kind: 'delete'; keys: Array<keyof LinePreferenceValues> | 'all' };
export const LINE_PREFERENCE_NOTICE = 'จำเฉพาะรูปแบบคำตอบในแชตส่วนตัวของคุณกับบริษัทนี้นาน 90 วัน อ่านค่าได้ด้วย “จำอะไรไว้บ้าง” และลบได้ด้วย “ลืมรูปแบบคำตอบทั้งหมด” ไม่เก็บข้อมูลการเงินหรือข้อมูลส่วนตัวอื่นเป็นความจำ';
/** Explicit whole commands only. A one-turn style request never authorizes durable storage. */
export function parseLinePreferenceCommand(raw: string): LinePreferenceCommand | null {
  const text = raw.trim().replace(/[.!。]$/u, '').toLowerCase();
  if (['จำอะไรไว้บ้าง', 'ดูรูปแบบคำตอบที่จำไว้', 'list my response preferences'].includes(text)) return { kind: 'list' };
  if (['ลืมรูปแบบคำตอบทั้งหมด', 'ลืมความชอบทั้งหมด', 'forget all response preferences'].includes(text)) return { kind: 'delete', keys: 'all' };
  const remove: Record<string, keyof LinePreferenceValues> = { 'ลืมภาษาที่ชอบ': 'language', 'ลืมความยาวคำตอบที่ชอบ': 'detail', 'ลืมรูปแบบการนำเสนอ': 'presentation' };
  if (remove[text]) return { kind: 'delete', keys: [remove[text]!] };
  const remember = /^(?:จำไว้ว่า|จำว่า|ช่วยจำไว้ว่า|remember (?:that )?)(.+)$/u.exec(text)?.[1]?.trim();
  if (!remember) return null;
  const values: Record<string, LinePreferenceValues> = {
    'ชอบสั้น': { detail: 'short' }, 'ชอบคำตอบสั้น': { detail: 'short' }, 'ตอบสั้น': { detail: 'short' }, 'i prefer short answers': { detail: 'short' },
    'ชอบคำตอบปกติ': { detail: 'normal' }, 'ชอบคำตอบละเอียด': { detail: 'detailed' }, 'ชอบละเอียด': { detail: 'detailed' }, 'i prefer detailed answers': { detail: 'detailed' },
    'ชอบภาษาไทย': { language: 'th' }, 'ตอบภาษาไทย': { language: 'th' }, 'ชอบภาษาอังกฤษ': { language: 'en' }, 'ตอบภาษาอังกฤษ': { language: 'en' },
    'ชอบตอบเป็นข้อ': { presentation: 'bullets' }, 'ชอบแบบหัวข้อ': { presentation: 'bullets' }, 'ชอบตอบเป็นตาราง': { presentation: 'table' },
    'ชอบตอบเป็นขั้นตอน': { presentation: 'steps' }, 'ชอบตอบเป็นย่อหน้า': { presentation: 'prose' },
  };
  return values[remember] ? { kind: 'set', values: values[remember]! } : null;
}
export function formatLinePreferences(values: LinePreferenceValues): string {
  const labels: Record<string, string> = { th: 'ภาษาไทย', en: 'ภาษาอังกฤษ', short: 'สั้น', normal: 'ปกติ', detailed: 'ละเอียด', prose: 'ย่อหน้า', bullets: 'หัวข้อ', table: 'ตาราง', steps: 'ขั้นตอน' };
  return Object.keys(values).length ? ['รูปแบบคำตอบที่จำไว้:', ...Object.values(values).map(value => `• ${labels[value]}`)].join('\n') : 'ยังไม่มีรูปแบบคำตอบที่จำไว้ค่ะ';
}
