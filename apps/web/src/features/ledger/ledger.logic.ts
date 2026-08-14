export type PeriodCloseCheckLike = {
  checkKey: string;
  status: string;
  count?: number;
  amount?: string;
};

const CHECK_LABELS: Record<string, string> = {
  no_draft_journals: 'สมุดรายวันค้างร่าง',
  trial_balance_balanced: 'ความสมดุลของงบทดลอง',
  source_postings_complete: 'การลงบัญชีเอกสารต้นทาง',
  no_source_posting_errors: 'ข้อผิดพลาดการลงบัญชี',
  chart_conflict_remediation_clear: 'ความขัดแย้งในผังบัญชี',
  chart_semantics_valid: 'โครงสร้างผังบัญชี',
  suspense_balance_zero: 'ยอดคงค้างในบัญชีพัก',
  tax_account_mapping_valid: 'การผูกบัญชีภาษี',
  transaction_tax_reconciliation_clear: 'การกระทบยอดภาษี',
  reimbursement_postings_complete: 'การลงบัญชีใบเบิก',
};

const PASSED_MESSAGES: Record<string, string> = {
  no_draft_journals: 'ไม่มีสมุดรายวันค้างร่าง',
  trial_balance_balanced: 'งบทดลองสมดุล',
  source_postings_complete: 'เอกสารที่เสร็จสิ้นลงบัญชีครบแล้ว',
  no_source_posting_errors: 'ไม่พบข้อผิดพลาดการลงบัญชีเอกสาร',
  chart_conflict_remediation_clear: 'ไม่พบความขัดแย้งในผังบัญชีที่ต้องแก้ไข',
  chart_semantics_valid: 'โครงสร้างและยอดคงเหลือปกติของผังบัญชีถูกต้อง',
  suspense_balance_zero: 'ไม่มีรายการคงค้างในบัญชีพัก',
  tax_account_mapping_valid: 'Tax Profile และการผูกบัญชีภาษีพร้อมใช้งาน',
  transaction_tax_reconciliation_clear: 'การกระทบยอดภาษีเป็นปัจจุบันและผ่านการตรวจสอบ',
  reimbursement_postings_complete: 'ค่าใช้จ่ายและการจ่ายเงินจากใบเบิกลงบัญชีครบแล้ว',
};

function count(value: number | undefined, noun: string): string {
  return typeof value === 'number' ? `${value} ${noun}` : noun;
}

function failedMessage(check: PeriodCloseCheckLike): string {
  switch (check.checkKey) {
    case 'no_draft_journals': return `มีสมุดรายวันค้างร่าง ${count(check.count, 'รายการ')} กรุณาบันทึกหรือยกเลิกก่อนปิดงวด`;
    case 'trial_balance_balanced': return `งบทดลองไม่สมดุล${check.amount ? ` ผลต่าง ${check.amount} บาท` : ''} กรุณาตรวจสอบรายการบัญชีก่อนปิดงวด`;
    case 'source_postings_complete': return `มีเอกสาร ${count(check.count, 'รายการ')} ที่ยังไม่ลงบัญชี กรุณาลงบัญชีให้ครบก่อนปิดงวด`;
    case 'no_source_posting_errors': return `พบเอกสารลงบัญชีผิดพลาด ${count(check.count, 'รายการ')} กรุณาแก้ไขแล้วตรวจสอบอีกครั้ง`;
    case 'chart_conflict_remediation_clear': return `พบความขัดแย้งในผังบัญชี ${count(check.count, 'รายการ')} กรุณาแก้ไขหรือยืนยันบัญชีก่อนปิดงวด`;
    case 'chart_semantics_valid': return `พบผังบัญชีที่มีโครงสร้างไม่ถูกต้อง ${count(check.count, 'รายการ')} กรุณาตรวจสอบประเภทและด้านยอดคงเหลือ`;
    case 'suspense_balance_zero': return `พบบัญชีพักที่ยังมียอดคงค้าง ${count(check.count, 'บัญชี')} กรุณาเคลียร์ยอดก่อนปิดงวด`;
    case 'tax_account_mapping_valid': return `พบการตั้งค่าโปรไฟล์หรือบัญชีภาษีไม่ครบ ${count(check.count, 'รายการ')} กรุณาตั้งค่าให้ครบ`;
    case 'transaction_tax_reconciliation_clear': return `พบการกระทบยอดหรือประเด็นภาษีค้างอยู่ ${count(check.count, 'รายการ')} กรุณาตรวจสอบก่อนปิดงวด`;
    case 'reimbursement_postings_complete': return `พบรายการจากใบเบิกที่ยังลงบัญชีไม่ครบ ${count(check.count, 'รายการ')} กรุณาดำเนินการก่อนปิดงวด`;
    default: return 'รายการนี้ยังไม่พร้อมสำหรับการปิดงวด กรุณาติดต่อผู้ดูแลระบบ';
  }
}

export function periodCloseCheckCopy(check: PeriodCloseCheckLike) {
  const passed = check.status === 'PASSED';
  return {
    label: CHECK_LABELS[check.checkKey] ?? 'การตรวจสอบก่อนปิดงวด',
    statusLabel: passed ? 'ผ่าน' : check.status === 'FAILED' ? 'ไม่ผ่าน' : 'รอตรวจสอบ',
    message: passed
      ? PASSED_MESSAGES[check.checkKey] ?? 'ตรวจสอบรายการนี้ผ่านแล้ว'
      : failedMessage(check),
  };
}
