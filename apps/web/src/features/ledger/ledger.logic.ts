export type PeriodCloseCheckLike = {
  checkKey: string;
  status: string;
  count?: number;
  amount?: string;
  breakdown?: Record<string, number>;
};

/** Where a failed check gets fixed: a path under `/companies/:companyId`. */
export type PeriodCloseCheckLink = { label: string; path: string };

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

// One total cannot tell a payout nobody posted from an expense nobody confirmed, and the two are
// fixed on different screens — so each kind gets its own words and its own way there.
const POSTING_SCREEN: PeriodCloseCheckLink = { label: 'เปิดรายการจ่ายเงินคืนที่ยังไม่ลงบัญชี', path: '/expenses/evidence' };
const CLAIM_MONEY_PARTS: ReadonlyArray<{ key: string; text: (n: number) => string; link: PeriodCloseCheckLink }> = [
  { key: 'unconfirmedClaimExpenses', text: (n) => `ค่าใช้จ่ายจากใบเบิกที่ยังไม่ยืนยัน ${n} รายการ`, link: { label: 'เปิดค่าใช้จ่ายที่รอตรวจ', path: '/expenses?view=pending' } },
  { key: 'pendingPayments', text: (n) => `การจ่ายเงินคืนใบเบิกที่ยังไม่ลงบัญชี ${n} รายการ`, link: POSTING_SCREEN },
  { key: 'paymentErrors', text: (n) => `การจ่ายเงินคืนใบเบิกที่ลงบัญชีไม่สำเร็จ ${n} รายการ`, link: POSTING_SCREEN },
];

/** The kinds actually pending. A response without the numbers names none and offers every way. */
function claimMoneyParts(check: PeriodCloseCheckLike) {
  return CLAIM_MONEY_PARTS.filter((part) => !check.breakdown || (check.breakdown[part.key] ?? 0) > 0);
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
    case 'reimbursement_postings_complete': {
      const { breakdown } = check;
      const parts = claimMoneyParts(check);
      return breakdown && parts.length > 0
        ? `พบ${parts.map((part) => part.text(breakdown[part.key] ?? 0)).join(' · ')} กรุณาดำเนินการก่อนปิดงวด`
        : `พบรายการจากใบเบิกที่ยังลงบัญชีไม่ครบ ${count(check.count, 'รายการ')} กรุณาดำเนินการก่อนปิดงวด`;
    }
    default: return 'รายการนี้ยังไม่พร้อมสำหรับการปิดงวด กรุณาติดต่อผู้ดูแลระบบ';
  }
}

export function periodCloseCheckCopy(check: PeriodCloseCheckLike): {
  label: string;
  statusLabel: string;
  message: string;
  links?: PeriodCloseCheckLink[];
} {
  const passed = check.status === 'PASSED';
  // One link per screen, in the order the sentence names the kinds.
  const links = !passed && check.checkKey === 'reimbursement_postings_complete'
    ? [...new Map(claimMoneyParts(check).map((part) => [part.link.path, part.link])).values()]
    : [];
  return {
    label: CHECK_LABELS[check.checkKey] ?? 'การตรวจสอบก่อนปิดงวด',
    statusLabel: passed ? 'ผ่าน' : check.status === 'FAILED' ? 'ไม่ผ่าน' : 'รอตรวจสอบ',
    message: passed
      ? PASSED_MESSAGES[check.checkKey] ?? 'ตรวจสอบรายการนี้ผ่านแล้ว'
      : failedMessage(check),
    ...(links.length > 0 ? { links } : {}),
  };
}
