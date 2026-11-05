export const FREE_EXPENSE_CHAT_REPLY = 'สิทธิ์ใช้ฟรียังไม่รวมคำถาม พิมพ์ ‘เมนูหลัก’ เพื่อดูทางเลือกค่ะ';
export const FREE_EXPENSE_TEXT_EDIT_REPLY = 'การแก้ข้อมูลผ่านข้อความยังไม่รวมในสิทธิ์ใช้ฟรีค่ะ เปิดร่างที่คุณมีสิทธิ์แล้วแก้ข้อมูลในเว็บได้ค่ะ';
/** A member who cannot edit the draft is not told to edit it on the web (A1/G21). */
export const FREE_EXPENSE_TEXT_EDIT_SUPPORT_REPLY = 'การแก้ข้อมูลผ่านข้อความยังไม่รวมในสิทธิ์ใช้ฟรี พิมพ์ ‘เมนูหลัก’ เพื่อดูทางเลือกค่ะ';

/** Exact commands only. Courtesy words never turn a near miss into a business read. */
export function isFreeExpenseMonthSummaryRequest(text: string): boolean {
  const command = text.normalize('NFC').trim().replace(/\s/gu, '');
  return /^(?:ขอ|ช่วย|น้องมั่งมี)*(?:ดูใบที่อัปโหลด|ใบที่อัปโหลด|ดูใบที่ส่ง|สรุปร่างเดือนนี้|สรุปค่าใช้จ่ายเดือนนี้|ดูค่าใช้จ่ายเดือนนี้|ค่าใช้จ่ายเดือนนี้)(?:ค่ะ|คะ|ครับ|หน่อย|นะ)*$/u.test(command);
}

/** Denial-only recognition: this never selects a tool or grants an action. */
export function isExplicitFinalFinancialRequest(text: string): boolean {
  return /^(?:(?:ช่วย|ขอ|กรุณา|น้องมั่งมี)\s*)*(?:อนุมัติ|ยืนยันจ่าย|จ่ายเงิน|โอนเงิน|ลงบัญชี|ยื่นภาษี|ปิดบัญชี)/u.test(text.trim());
}

export function isExplicitSourceEditRequest(text: string): boolean {
  return /^(?:(?:ช่วย|ขอ|กรุณา|น้องมั่งมี)\s*)*แก้(?:ไข|ยอด|ข้อมูล|บิล|วันที่|ชื่อ|รายการ|จำนวน|ราคา|ภาษี|ร่าง|\s)/u.test(text.trim());
}

/** No model or speculative capability list: every link is an existing permission-checked route. */
export function freeExpenseMenuReply(webBaseUrl: string | undefined, companyId: string, permissions: readonly string[]): string {
  const mayRead = ['expense.read', 'expense.read_own', 'expense.read_related'].some((key) => permissions.includes(key));
  const mayUpload = ['expense.receipt.upload', 'expense.receipt.line_upload'].some((key) => permissions.includes(key));
  return [
    'เลือกการใช้งานรายจ่ายได้ค่ะ',
    ...(mayRead ? [webBaseUrl ? `เปิดดูรายการ: ${webBaseUrl.replace(/\/$/, '')}/companies/${encodeURIComponent(companyId)}/expenses` : 'เปิดดูรายการรายจ่ายในเว็บ MangmeePlus ได้ค่ะ'] : []),
    ...(mayRead ? ['พิมพ์ ‘สรุปร่างเดือนนี้’ เพื่อดูใบที่ส่งเข้าเดือนนี้'] : []),
    ...(mayUpload ? ['ส่งบิล ใบเสร็จ หรือสลิปที่เกี่ยวกับรายจ่ายให้อ่านตามสิทธิ์ของร้านได้ค่ะ'] : []),
    ...(mayRead && permissions.includes('expense.update') ? ['เปิดร่างที่คุณมีสิทธิ์แล้วแก้ไขข้อมูลในเว็บได้ค่ะ'] : []),
    'หากต้องการคุยกับทีมงาน พิมพ์ ติดต่อเจ้าหน้าที่ ค่ะ',
  ].join('\n');
}
