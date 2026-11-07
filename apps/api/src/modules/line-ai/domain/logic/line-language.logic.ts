import { parseLineFixedReadControl } from '@watchdog-bms/contracts';
import { lineReplyLanguage, lineChatAction, lineCustomerWording, expenseEvidenceImageMissing, expenseEvidenceAssessment, EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, scrubRecordText, type ExpenseEvidenceSource } from '@watchdog-bms/contracts';
export function lineCustomerText(value: string): string {
  const ids = /\bc[a-z0-9]{24}\b|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/iu;
  return lineCustomerWording(value.replace(/https?:\/\/[^\s]*\/companies\/[^\s]+/gu, uri => ids.test(uri) ? '' : uri)
    .replace(new RegExp(ids.source, 'giu'), 'ไม่ระบุ'));
}
/** Visible LINE fields only; message-action text is executable input, like postback data or a URI. */
export function lineCustomerVisibleText<T>(value: T): T {
  if (Array.isArray(value)) return value.map(lineCustomerVisibleText) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
    key === 'text' && (value as { type?: unknown }).type === 'message' ? child
      : ['text', 'label', 'altText', 'displayText'].includes(key) && typeof child === 'string' ? lineCustomerText(child)
      : typeof child === 'object' ? lineCustomerVisibleText(child) : child])) as T;
}
export type LineReplyLanguage = 'th' | 'en';
export { lineReplyLanguage };

export function lineExpenseEvidenceNotes(source: Pick<ExpenseEvidenceSource, 'aiVerificationSummaryJson' | 'attachments'>, language: LineReplyLanguage = 'th'): string[] {
  if (!expenseEvidenceImageMissing(source)) return [];
  const note = scrubRecordText(expenseEvidenceAssessment(source)?.note, 200);
  return [lineUiLabel(EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, language), ...(note ? [`${language === 'en' ? 'Note' : 'หมายเหตุ'}: ${note}`] : [])];
}
/** Presentation metadata only; strip it before passing a control to its strict domain parser. */
export function lineControlLanguage(data: string | undefined): { data: string | undefined; language?: LineReplyLanguage } {
  if (!data) return { data };
  const params = new URLSearchParams(data);
  const values = params.getAll('language');
  if (values.length !== 1 || !['th', 'en'].includes(values[0]!)) return { data };
  params.delete('language');
  return { data: params.toString(), language: values[0] as LineReplyLanguage };
}
export function lineControlData(data: string, language: LineReplyLanguage): string {
  if (language === 'th') return data;
  const params = new URLSearchParams(data);
  params.set('language', language);
  return params.toString();
}
/** Fixed UI vocabulary only. Never translate arbitrary vendor names, descriptions or evidence. */
const EN_LABELS: Record<string, string> = {
  'บันทึกจ่ายค่าใช้จ่าย': 'Record expense payment', 'ส่งตรวจค่าใช้จ่าย': 'Send expense for review', 'ยืนยันค่าใช้จ่าย': 'Confirm expense', 'ลบร่างค่าใช้จ่าย': 'Delete expense draft', 'ยกเลิกค่าใช้จ่าย': 'Void expense',
  'ส่งใบเบิกอนุมัติ': 'Submit claim', 'อนุมัติใบเบิก': 'Approve claim', 'ไม่อนุมัติใบเบิก': 'Reject claim', 'บันทึกจ่ายคืนใบเบิก': 'Record claim payment',
  'ผู้มีสิทธิ์สร้างใบเบิก': 'An authorized claim creator', 'ผู้มีสิทธิ์ส่งใบเบิกอนุมัติ': 'An authorized claim submitter', 'ผู้มีสิทธิ์ยกเลิกใบเบิก': 'An authorized claim canceller',
  'ผู้มีสิทธิ์ไม่อนุมัติใบเบิก': 'An authorized claim reviewer', 'ผู้มีสิทธิ์บันทึกจ่ายคืนใบเบิก': 'An authorized reimbursement payer', 'ผู้มีสิทธิ์บันทึกจ่ายค่าใช้จ่าย': 'An authorized expense payer', 'ผู้อนุมัติใบเบิกที่ได้รับมอบหมาย': 'The assigned claim approver',
  'ผู้มีสิทธิ์ส่งตรวจค่าใช้จ่าย': 'An authorized expense reviewer', 'ผู้มีสิทธิ์ยืนยันค่าใช้จ่าย': 'An authorized expense confirmer', 'ผู้มีสิทธิ์ลบร่างค่าใช้จ่าย': 'An authorized expense draft editor',
  'ผู้มีสิทธิ์ยกเลิกค่าใช้จ่าย': 'An authorized expense reviewer', 'ผู้มีสิทธิ์จัดทำใบเตรียมจ่าย': 'An authorized voucher preparer', 'ผู้มีสิทธิ์เตรียมใบรับรองแทนใบเสร็จ': 'An authorized substitute receipt preparer', 'ผู้มีสิทธิ์ออกหนังสือรับรอง': 'An authorized withholding certificate issuer',
  'มีใบเบิกรอคุณอนุมัติ {count} ใบ{total} เลือกใบที่จะอนุมัติได้เลยค่ะ': 'You have {count} claims awaiting your approval{total}. Choose a claim to approve.',
  ' รวม {amount}': ', totalling {amount}',
  [EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL]: 'Document image not attached', 'ส่งรูปเอกสาร': 'Send document photo',
  'บันทึกค่าใช้จ่าย': 'Record expense', 'สร้างใบเบิก': 'Create claim', 'ทำใบรับรองแทนใบเสร็จ': 'Substitute receipt', 'ค้นหาค่าใช้จ่าย': 'Find expenses',
  'ดูใบเบิกรออนุมัติ': 'Review claims', 'เพิ่มคู่ค้า': 'Add counterparty', 'เลือกแพ็กเกจ': 'Choose package', 'ดูยอดขาย': 'View sales', 'ค้นหาสินค้า': 'Find products',
  'ค่าเดินทาง': 'Travel', 'ค่าน้ำมัน': 'Fuel', 'ค่าออฟฟิศ': 'Office', 'ค่าใช้จ่ายอื่นๆ': 'Other expenses',
  'ภาษาไทย': 'Thai', 'ภาษาอังกฤษ': 'English', 'สั้น': 'Short', 'ปกติ': 'Normal', 'ละเอียด': 'Detailed', 'ย่อหน้า': 'Paragraphs', 'หัวข้อ': 'Bullets', 'ตาราง': 'Table', 'ขั้นตอน': 'Steps',
  'ไม่พบรูปแบบคำตอบนี้ที่จำไว้ค่ะ จึงไม่ได้ลบอะไร': 'No matching answer preference was saved, so nothing was deleted.',
  'จำเฉพาะรูปแบบคำตอบในแชตส่วนตัวของคุณกับบริษัทนี้นาน 90 วัน อ่านค่าได้ด้วย “จำอะไรไว้บ้าง” และลบได้ด้วย “ลืมรูปแบบคำตอบทั้งหมด” ไม่เก็บข้อมูลการเงินหรือข้อมูลส่วนตัวอื่นเป็นความจำ': 'Only answer styles are saved for this private shop chat for 90 days; ask to list or forget your answer preferences at any time.',
  'งาน': 'service', 'ผู้ยื่น': 'Requester', 'ผู้เบิก': 'Requester', 'ใบเบิก': 'Claim', 'ผู้มีสิทธิ์อนุมัติ': 'Authorized approver', 'ฝ่ายการเงิน': 'Finance',
  'ผู้มีสิทธิ์บันทึกจ่าย': 'Authorized payer', 'ระบบ': 'System',
  'เพิ่มพนักงาน': 'Add employee', 'แก้ไขพนักงาน': 'Edit employee', 'ปิดใช้งาน': 'Disable', 'เปิดใช้งาน': 'Enable', 'เพิ่มสาขา': 'Add branch', 'แก้ไขสาขา': 'Edit branch',
  'รอยืนยัน': 'Awaiting confirmation', 'ดำเนินการแล้ว': 'Completed',
  'กำลังดึงข้อมูล': 'Extracting document', 'ปฏิเสธ': 'Rejected', 'ยังไม่ชำระ': 'Unpaid', 'ชำระบางส่วน': 'Partially paid', 'ชำระแล้ว': 'Paid',
  'ยังไม่มีแพ็กเกจ': 'No package', 'หมดอายุ': 'Expired', 'เอกสารค่าใช้จ่าย': 'Expense document',
  'ใบเสร็จรับเงิน': 'Receipt', 'ใบเสร็จรับเงินกรมศุลกากร (VAT นำเข้า)': 'Customs VAT receipt',
  'ใบเสร็จรับเงิน ภ.พ.36': 'PP36 receipt', 'ใบกำกับภาษี (เต็มรูป)': 'Full tax invoice', 'ใบกำกับภาษีอย่างย่อ': 'Abbreviated tax invoice',
  'บิลเงินสดเขียนมือ': 'Handwritten cash bill', 'บิลผู้ขาย': 'Supplier bill', 'สกรีนช็อตคำสั่งซื้อ': 'Order screenshot',
  'สกรีนช็อตคำสั่งซื้อ (Shopee/Lazada/TikTok)': 'Marketplace order screenshot', 'โน้ตค่าใช้จ่าย (ข้อความ)': 'Expense note',
  'จ่ายค่าอะไร': 'What was paid for', 'หลักฐานรายจ่าย': 'Expense evidence', 'ใช้ VAT ตอนยื่นภาษี': 'Use VAT when filing tax',
  'ใบแทนใบเสร็จ': 'Substitute receipt', 'ใบรับรองแทนใบเสร็จรับเงิน': 'Substitute receipt',
  'เอกสารค่าใช้จ่ายอื่น': 'Other expense document', 'รอตรวจประเภทเอกสาร': 'Document type needs review',
  'ค่าบริการ': 'Service charge', 'ส่วนลด': 'Discount', 'วันที่': 'Date', 'ชื่อผู้ขาย': 'Seller name', 'เลขที่เอกสาร': 'Document number',
  'ยอดรวมใหม่': 'New total', 'ยอดรวมเดิม': 'Previous total', 'ยอดก่อนภาษี': 'Subtotal', 'อัตรา VAT': 'VAT rate', 'ภาษีมูลค่าเพิ่ม': 'VAT',
  'จำนวน': 'Quantity', 'ราคาต่อหน่วย': 'Unit price', 'รายละเอียด': 'Description', 'หมวด': 'Category', 'วัตถุประสงค์': 'Purpose',
  'DRAFT': 'Draft', 'PENDING_APPROVAL': 'Awaiting approval', 'APPROVED': 'Approved', 'READY_FOR_PAYMENT': 'Ready for payment',
  'PARTIALLY_PAID': 'Partially paid', 'PAID': 'Paid', 'UNPAID': 'Unpaid', 'REJECTED': 'Rejected', 'VOIDED': 'Voided', 'CANCELLED': 'Cancelled',
  'CONFIRMED': 'Confirmed', 'NEEDS_REVIEW': 'Needs review', 'READY_FOR_CONFIRMATION': 'Ready to confirm', 'DELETED': 'Deleted',
  'ไม่มี VAT': 'No VAT', 'VAT รวมในราคา': 'VAT included', 'VAT แยกจากราคา': 'VAT excluded', 'ยกเว้น VAT': 'VAT exempt', 'รอตรวจ VAT': 'VAT needs review',
  'ใช้ได้': 'Usable', 'ใช้ได้เมื่อมีหลักฐานอื่นประกอบ': 'Needs supporting evidence', 'ใช้ไม่ได้': 'Not usable', 'รอตรวจ': 'Needs review',
  'ผู้ขาย/ผู้รับเงิน': 'Seller / payee', 'เพิ่มหมายเหตุ': 'Add note', 'โหมด VAT': 'VAT mode',
  'VAT_INCLUDED': 'VAT included', 'VAT_EXCLUDED': 'VAT excluded', 'NO_VAT': 'No VAT', 'EXEMPT': 'VAT exempt', 'ZERO_RATED': 'Zero-rated VAT', 'NON_VAT': 'Outside VAT',
  'ค่าขนส่ง': 'Shipping charge', 'ค่าธรรมเนียม': 'Fee', 'ค่าปัดเศษ': 'Rounding', 'รายการสินค้า': 'Product item',
  'ข้อมูลจากน้องมั่งมี': 'From Nong Mangmee', 'เปิดดูข้อมูล': 'View details', 'เปิดดูในเว็บแอป': 'Open in web app',
  'เปิดดูในเว็บ': 'Open on web', 'เปิดดูรายการ': 'View record', 'ร่างค่าใช้จ่าย': 'Expense draft', 'ข้อมูลใบเสร็จ': 'Receipt details',
  'ข้อมูลเอกสาร': 'Document details', 'รอตรวจสอบ': 'Needs review', 'ผู้ขาย / ร้านค้า': 'Seller / shop', 'ผู้ขาย': 'Seller',
  'รายการ': 'Item', 'วันที่เอกสาร': 'Document date', 'เลขเอกสาร': 'Document number', 'ประเภทเอกสาร': 'Document type',
  'หมวดค่าใช้จ่าย': 'Expense category', 'ยอดรวม': 'Total', 'ภาษีหัก ณ ที่จ่าย': 'Withholding tax', 'ค่าบริการอื่นๆ': 'Other charges',
  'สถานะเอกสาร': 'Document status', 'ร่าง': 'Draft', 'ข้อมูลพร้อมยืนยัน': 'Ready to confirm', 'พร้อมยืนยัน': 'Ready to confirm',
  'ยืนยันแล้ว': 'Confirmed', 'ถูกปฏิเสธ': 'Rejected', 'ยกเลิก': 'Cancelled', 'จ่ายแล้ว': 'Paid', 'ยังไม่จ่าย': 'Unpaid',
  'จ่ายบางส่วน': 'Partially paid', 'รออนุมัติ': 'Awaiting approval', 'อนุมัติแล้ว': 'Approved', 'พร้อมจ่าย': 'Ready for payment',
  'รอตรวจสอบการเงิน': 'Finance review', 'ถูกส่งกลับให้แก้': 'Returned for correction', 'เพิกถอน': 'Voided',
  'รายการนี้เป็นร่าง ยังไม่ได้ยืนยันรายการ': 'This is a draft awaiting your confirmation.', 'ไม่ระบุผู้ขาย': 'Seller not specified',
  'ใบเสร็จ': 'Receipt', 'ใบกำกับภาษี': 'Tax invoice', 'สลิปโอนเงิน': 'Transfer slip', 'ใบรับรองแทนใบเสร็จ': 'Substitute receipt',
  'ยืนยันรายการ': 'Confirm expense', 'ตรวจแล้ว ยืนยัน': 'Reviewed, confirm', 'ยืนยัน': 'Confirm', 'ไม่ทำ': 'Cancel action',
  'ส่งตรวจ': 'Send for review', 'ลบร่าง': 'Delete draft', 'ยกเลิกรายการ': 'Void expense', 'ส่งใบเบิก': 'Submit claim',
  'ยกเลิกใบเบิก': 'Cancel claim', 'อนุมัติ': 'Approve', 'ไม่อนุมัติ': 'Reject', 'บันทึกจ่ายคืน': 'Record reimbursement',
  'บันทึกจ่าย': 'Record payment', 'สร้างใบเตรียมจ่าย': 'Prepare voucher', 'ส่งอนุมัติ': 'Submit for approval',
  'ส่งใบเตรียมจ่ายอนุมัติ': 'Submit voucher for approval', 'จ่ายใบเตรียมจ่าย': 'Pay voucher',
  'ผู้มีสิทธิ์อนุมัติใบเตรียมจ่าย': 'An authorized voucher approver', 'ผู้มีสิทธิ์จ่ายใบเตรียมจ่าย': 'An authorized voucher payer',
  'อนุมัติใบเตรียมจ่าย': 'Approve voucher', 'ส่งกลับแก้ไข': 'Return for correction', 'ยกเลิกใบเตรียมจ่าย': 'Cancel voucher',
  'ออก 50 ทวิ': 'Issue 50 bis', 'ดู / ดาวน์โหลด 50 ทวิ': 'View tax certificate', 'ให้น้องทำให้': 'Prepare this for me',
  'ข้อความของคุณ': 'Your message', 'เอกสารที่ส่งมา': 'Your document', 'ขอข้อมูลเพิ่ม': 'More information needed',
  'กำลังอ่านเอกสาร': 'Reading document', 'ผลการอ่านเอกสาร': 'Document result', 'อ่านข้อมูลไม่ได้': 'Unable to read document',
  'ยังรับเอกสารนี้ไม่ได้': 'Unable to accept document', 'ไม่ใช่เอกสารค่าใช้จ่าย': 'Not an expense document', 'เก็บไว้แล้ว': 'Stored',
};
export function lineUiLabel(value: string, language: LineReplyLanguage): string {
  return language === 'en' ? EN_LABELS[value] ?? value : value;
}
export function lineDisplayDate(value: string, language: LineReplyLanguage = 'th'): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'th-TH',
    { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
/** These controls ask the existing menu/intake route to run; they carry no business mutation. */
export function isLineNavigationPostback(data: string): boolean {
  const params = new URLSearchParams(lineControlLanguage(data).data);
  const action = params.get('action');
  if (action === 'fixed-read') return parseLineFixedReadControl(params.toString()) !== null;
  if (action === 'company-select') return [...params.keys()].length === 2 && params.getAll('companyId').length === 1 && /^[A-Za-z0-9_-]{1,128}$/u.test(params.get('companyId') ?? '');
  if (action === 'company-page') return [...params.keys()].length === 2 && /^[1-9][0-9]{0,2}$/u.test(params.get('page') ?? '');
  if (action === 'chat-action') return [...params.keys()].length === 2 && params.getAll('id').length === 1 && !!lineChatAction(params.get('id') ?? '');
  return [...params.keys()].length === 1 && ['staff-contact', 'view-packages', 'employee-door', 'query-menu', 'approvals',
    'line-rich-talk', 'package-change', 'package-callback', 'profile-guard', 'profile-guard-later'].includes(action ?? '');
}
/** Source captions are UI metadata; the source objects and their authorization evidence stay intact. */
export function lineSourceLabel(label: string, module: string | undefined, language: LineReplyLanguage): string {
  if (language !== 'en' || !/[\u0E00-\u0E7F]/u.test(label)) return label;
  return ({ expenses: 'Expenses', reimbursements: 'Claims', reimbursement: 'Claims', billing: 'Packages', company: 'Shop',
    'employee-access': 'Team', 'accounting-documents': 'Suppliers and documents', tax: 'Tax', inventory: 'Stock',
    ledger: 'Accounting', reports: 'Reports', procurement: 'Purchasing', crm: 'Customers', dashboard: 'Shop overview' } as Record<string, string>)[module ?? ''] ?? lineUiLabel(label, language);
}
