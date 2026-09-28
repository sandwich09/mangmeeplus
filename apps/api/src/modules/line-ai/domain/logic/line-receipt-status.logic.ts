/**
 * Spec §17.5: "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" is a question about an INTAKE ATTEMPT, which may have been
 * rejected long before any expense existed. It is deliberately matched before the progress question
 * below: `receiptStatusQuestion`'s progress words ("เสร็จยัง", "ถึงไหน") never appear in it, and the
 * receipt-list answer would say "ยังไม่พบรายการ" for a file the system actually refused for being
 * 12 MB — the exact wrong answer §17.5 exists to remove.
 */
const FILE_ATTEMPT_PATTERNS: readonly RegExp[] = [
  // "ไฟล์เมื่อกี้", "รูปล่าสุด", "เอกสารก่อนหน้า" — a reference to the thing just sent.
  /(?:ไฟล์|รูป|ภาพ|เอกสาร|pdf)(?:.{0,12})?(?:เมื่อกี้|เมื่อสักครู่|ล่าสุด|ก่อนหน้า|ที่ส่งไป|ที่เพิ่งส่ง)/iu,
  // "ส่งไม่ได้", "รับไม่ได้", "ทำไมถึงอ่านไม่ได้"
  /(?:ส่งไม่ได้|ส่งไม่สำเร็จ|รับไม่ได้|รับไม่สำเร็จ|อ่านไม่ได้|อ่านไม่ออก)/u,
  /ทำไม(?:ถึง)?(?:ส่ง|รับ|อ่าน|บันทึก)ไม่/u,
  // "ใหญ่ไปไหม", "ขนาดไฟล์เท่าไร". Bare "ขนาด" (no "ไฟล์") is handled separately below —
  // it collides with "ขนาดนี้/ขนาดนั้น" used as a plain intensifier.
  /(?:ใหญ่ไป|ใหญ่เกิน|เกินขนาด|ขนาดไฟล์)/u,
  // "รองรับ PDF ไหม", "ส่ง PDF ได้ไหม"
  /(?:รองรับ ?pdf|ส่ง ?pdf ?ได้|pdf ?ได้ไหม|ไฟล์แบบไหน(?:ส่ง)?ได้)/iu,
  // "ต้องส่งใหม่ไหม"
  /ต้อง(?:ส่ง|อัปโหลด|อัพโหลด)(?:ไฟล์|รูป)?ใหม่/u,
  // "บันทึกไปหรือยัง", "เก็บไว้หรือยัง"
  /(?:บันทึก|เก็บ|เซฟ)(?:ไฟล์|รูป|ไว้|ไป)?(?:หรือ)?ยัง/u,
  // English, same six questions.
  /\b(?:why (?:did|didn'?t|couldn'?t|can'?t))\b.{0,24}\b(?:file|photo|image|pdf|upload|send|read)\b/iu,
  /\b(?:file|photo|image|pdf)\b.{0,24}\b(?:too (?:big|large)|size limit|not supported|failed|rejected)\b/iu,
  /\bdo(?:es)? (?:you|it) (?:support|accept)\b.{0,16}\bpdf\b/iu,
  /\b(?:should|do) i (?:re-?send|send (?:it )?again|upload again)\b/iu,
  /\b(?:was|is) (?:it|the file|the photo|my file) saved\b/iu,
];

// tuning-5c (C1, T-107-b): "ทำไม...พุ่งขนาดนี้คะ" (an expense-spike question) matched bare "ขนาด" —
// "ขนาดนี้/ขนาดนั้น" is a plain intensifier, not a file-size reference. Only count it as a size
// complaint when the message also names the thing that's too big.
const BARE_SIZE_WORD = /ขนาด(?!ไฟล์)/u;
const MEDIA_NOUN_PATTERN = /(?:ไฟล์|รูป|ภาพ|เอกสาร|pdf)/iu;

/** A progress question is read-only. Do not turn editing, payment or tax questions into status. */
export function receiptStatusQuestion(text: string): 'receipt' | 'contextual' | 'file_attempt' | null {
  const normalized = text.trim().replace(/[?？!\s]/gu, '');
  if (/(?:ยกเลิก|ลบ|แก้|เปลี่ยน|ถ้า|สมมติ)/u.test(normalized)) return null;
  // §17.5 runs first and on the ORIGINAL text: the English variants need their word boundaries,
  // which stripping every space would destroy.
  if (isFileAttemptQuestion(text, normalized)) return 'file_attempt';
  const progress = /(?:เสร็จ(?:หรือ)?ยัง|เสร็จแล้ว(?:ไหม|หรือยัง)|ถึงไหน|อ่าน(?:ครบ|หมด|แล้ว)(?:หรือยัง|ไหม|ยัง)|ตอบ(?:มา)?(?:แค่|ใบเดียว|ไม่ครบ)|ตาม(?:งาน|บิล)|สถานะ)/u;
  if (!progress.test(normalized)) return null;
  if (/(?:ใบเสร็จ|บิล|รูปที่ส่ง|เอกสารที่ส่ง)/u.test(normalized)) return 'receipt';
  return /^(?:นานจัง|รอนาน|แล้ว|ตอนนี้|อ่าน|ประมวลผล|งาน|ทำ)*?(?:เสร็จ(?:หรือ)?ยัง|เสร็จแล้ว(?:ไหม|หรือยัง)|ถึงไหน)(?:ครับ|ค่ะ|คะ|นะ|แล้ว)*$/u.test(normalized)
    ? 'contextual' : null;
}

function isFileAttemptQuestion(original: string, normalized: string): boolean {
  const spaced = original.trim().replace(/[?？!]/gu, ' ').replace(/\s+/gu, ' ');
  if (FILE_ATTEMPT_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(spaced))) return true;
  // Bare "ขนาด" (not "ขนาดไฟล์", already covered above) needs a co-occurring media noun — see C1 above.
  return BARE_SIZE_WORD.test(normalized) && MEDIA_NOUN_PATTERN.test(normalized);
}

export function receiptProgressLabel(status: string, verificationStatus?: string | null): string {
  if (status === 'CONFIRMED') return 'ยืนยันรายการแล้ว';
  if (status === 'VOIDED') return 'ยกเลิกรายการแล้ว';
  if (status === 'REJECTED') return 'รายการไม่ผ่านการตรวจ';
  if (status === 'EXTRACTING' || verificationStatus === 'VERIFYING') return 'กำลังอ่านใบเสร็จ';
  if (verificationStatus === 'FAILED') return 'เก็บภาพแล้ว แต่อ่านข้อมูลไม่สำเร็จ';
  if (status === 'DRAFT' || status === 'NEEDS_REVIEW' || status === 'READY_FOR_CONFIRMATION') return 'บันทึกแบบร่างแล้ว รอคุณตรวจสอบและยืนยัน';
  return 'ยังยืนยันสถานะไม่ได้';
}
