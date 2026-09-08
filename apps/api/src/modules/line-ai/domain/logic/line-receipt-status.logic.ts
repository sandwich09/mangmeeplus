/** A progress question is read-only. Do not turn editing, payment or tax questions into status. */
export function receiptStatusQuestion(text: string): 'receipt' | 'contextual' | null {
  const normalized = text.trim().replace(/[?？!\s]/gu, '');
  if (/(?:ยกเลิก|ลบ|แก้|เปลี่ยน|ถ้า|สมมติ)/u.test(normalized)) return null;
  const progress = /(?:เสร็จ(?:หรือ)?ยัง|เสร็จแล้ว(?:ไหม|หรือยัง)|ถึงไหน|อ่าน(?:ครบ|หมด|แล้ว)(?:หรือยัง|ไหม|ยัง)|ตอบ(?:มา)?(?:แค่|ใบเดียว|ไม่ครบ)|ตาม(?:งาน|บิล)|สถานะ)/u;
  if (!progress.test(normalized)) return null;
  if (/(?:ใบเสร็จ|บิล|รูปที่ส่ง|เอกสารที่ส่ง)/u.test(normalized)) return 'receipt';
  return /^(?:นานจัง|รอนาน|แล้ว|ตอนนี้|อ่าน|ประมวลผล|งาน|ทำ)*?(?:เสร็จ(?:หรือ)?ยัง|เสร็จแล้ว(?:ไหม|หรือยัง)|ถึงไหน)(?:ครับ|ค่ะ|คะ|นะ|แล้ว)*$/u.test(normalized)
    ? 'contextual' : null;
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
