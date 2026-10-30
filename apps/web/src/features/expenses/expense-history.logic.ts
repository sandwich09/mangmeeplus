export function expenseHistoryActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'expense.create': 'สร้างรายการจ่าย',
    'expense.review.update': 'แก้ไขข้อมูลรายการจ่าย',
    'expense.update': 'แก้ไขข้อมูลรายการจ่าย',
    'expense.confirm': 'ยืนยันรายการจ่าย',
    'expense.reject': 'ยกเลิกรายการจ่าย',
    'expense.void': 'ยกเลิกรายการบัญชี',
    'expense.delete': 'ลบรายการจ่าย',
    'expense.evidence.review': 'ตรวจสอบข้อมูลเอกสาร',
    'expense.classification.override': 'ปรับประเภทเอกสาร',
    'expense.vat.source_override': 'ปรับแหล่งข้อมูล VAT',
    'expense.input_vat.decide': 'ตัดสินใจเครดิตภาษีซื้อ',
    'expense.buyer_match.confirm': 'ยืนยันข้อมูลผู้ซื้อในเอกสาร',
    'expense.signature.fill': 'กรอกลายเซ็นในเอกสาร',
    'expense.reopen': 'เปิดรายการจ่ายให้ตรวจใหม่',
    'expense.payment.cancel': 'ยกเลิกการจ่ายเงิน',
    'expense.payment_date_confirmed': 'ยืนยันวันที่จ่ายเงิน',
    'expense.line_upload.receive': 'รับข้อมูลรายการจากไฟล์',
    'expense.upload.complete': 'อัปโหลดเอกสารสำเร็จ',
    'expense.upload_intent.create': 'เริ่มอัปโหลดเอกสาร',
    'expense.ocr.request': 'ขออ่านข้อความจากเอกสาร',
    'expense.receipt.remove': 'ลบเอกสารแนบ',
    'expense.duplicate.confirm': 'ยืนยันรายการซ้ำ',
    'expense.duplicate.dismiss': 'ไม่ใช่รายการซ้ำ',
    'expense.payment.record': 'บันทึกการจ่ายเงิน',
    'expense.line_ai.draft_update': 'ปรับข้อมูลร่างจาก AI',
    'expense.line_ai.draft_preview': 'ดูตัวอย่างร่างจาก AI',
    'expense.line_draft.answer': 'ตอบคำถามร่างรายการ',
    'expense.line_draft.start': 'เริ่มบันทึกรายการผ่าน LINE',
    'expense.line_draft.transition': 'ดำเนินการร่างรายการผ่าน LINE',
    'expense.substitute_receipt.correct_document': 'แก้ไขข้อมูลใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.amend': 'แก้ไขใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.prepare': 'เตรียมใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.artifact.download': 'ดาวน์โหลดใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.form.download': 'ดาวน์โหลดแบบฟอร์มใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.certify': 'รับรองใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.approve': 'อนุมัติใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.supersede': 'แทนที่ใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.paper.submit': 'ส่งเอกสารใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.paper.accept': 'รับเอกสารใบรับรองแทนใบเสร็จ',
    'expense.substitute_receipt.source_refreshed': 'ปรับข้อมูลตามรายการจ่าย',
    'expense.substitute_receipt.wet_signed_scan.link': 'แนบใบรับรองแทนใบเสร็จที่เซ็นแล้ว',
    'tax.document_tax.finalize': 'ยืนยันข้อมูลภาษี',
  };
  return labels[action] ?? 'กิจกรรมในรายการจ่าย';
}

export function expenseHistoryFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    status: 'สถานะ', vendorNameSnapshot: 'ผู้ขาย', vendorDocumentNumber: 'เลขที่เอกสาร',
    vendorTaxIdSnapshot: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', vendorBranchCodeSnapshot: 'รหัสสาขาผู้ขาย',
    vendorEntityKindSnapshot: 'ประเภทผู้ขาย', vendorAddressSnapshot: 'ที่อยู่ผู้ขาย', branchName: 'สาขา', expenseCategoryName: 'หมวดหมู่ค่าใช้จ่าย',
    expenseDate: 'วันที่เอกสาร', receivedAt: 'วันที่รับเอกสาร', dueDate: 'วันครบกำหนด', currency: 'สกุลเงิน',
    vatMode: 'รูปแบบ VAT', inputVatClaimStatus: 'สถานะเครดิตภาษีซื้อ', sourceDocumentType: 'ประเภทเอกสาร',
    sourceDocumentLanguage: 'ภาษาเอกสาร', taxEvidenceStatus: 'สถานะหลักฐานภาษี', taxEvidenceReasonCode: 'เหตุผลหลักฐานภาษี',
    note: 'หมายเหตุ', internalMemo: 'บันทึกภายใน', missingReceiptReason: 'เหตุผลที่ไม่มีใบเสร็จ',
    subtotalAmount: 'ยอดก่อนส่วนลด', discountAmount: 'ส่วนลด', taxableAmount: 'ยอดที่เสียภาษี', vatAmount: 'VAT',
    whtAmount: 'ภาษีหัก ณ ที่จ่าย', grandTotalAmount: 'ยอดรวม', netPayableAmount: 'ยอดชำระสุทธิ',
  };
  if (labels[field]) return labels[field];
  const line = /^lines\.(\d+)\.(description|expenseCategoryName|quantity|unitPrice|discountAmount|taxableAmount|vatRate|vatAmount|whtRate|whtAmount|lineSubtotalAmount|lineTotalAmount|vatTreatment|chargeKind)$/.exec(field);
  if (!line) return 'ข้อมูลที่เปลี่ยน';
  const lineLabels: Record<string, string> = {
    description: 'รายละเอียด', expenseCategoryName: 'หมวดหมู่ค่าใช้จ่าย', quantity: 'จำนวน', unitPrice: 'ราคาต่อหน่วย', discountAmount: 'ส่วนลด', taxableAmount: 'ยอดที่เสียภาษี',
    vatRate: 'อัตรา VAT', vatAmount: 'VAT', whtRate: 'อัตราภาษีหัก ณ ที่จ่าย', whtAmount: 'ภาษีหัก ณ ที่จ่าย',
    lineSubtotalAmount: 'ยอดก่อนภาษี', lineTotalAmount: 'ยอดรวม', vatTreatment: 'การคิด VAT', chargeKind: 'ประเภทค่าใช้จ่าย',
  };
  return `รายการที่ ${line[1]} · ${lineLabels[line[2]]}`;
}

export function expenseHistoryActorLabel(actorType: string, displayName: string | null): string {
  if (displayName?.trim()) return displayName.trim();
  return ({ USER: 'ผู้ใช้ที่ไม่ทราบชื่อ', SYSTEM: 'ระบบ', SERVICE: 'บริการอัตโนมัติ', CRM_CUSTOMER: 'ลูกค้า' } as Record<string, string>)[actorType] ?? 'ไม่ทราบผู้ดำเนินการ';
}
import { formatThaiDate } from '@/common/i18n/thai-date';
import { EXPENSE_LINE_CHARGE_KIND_LABELS, EXPENSE_STATUS_LABELS, EXPENSE_VAT_MODE_LABELS, PAYEE_ENTITY_KIND_LABELS, SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_REASON_LABELS, TAX_EVIDENCE_STATUS_LABELS, expenseRateToPercent } from './expenses.model';

const amountFormatter = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function expenseHistoryValueLabel(field: string, value: string | null): string {
  if (value === null) return '—';
  const key = field.replace(/^lines\.\d+\./, '');
  if ((key.endsWith('Amount') || key.endsWith('Price')) && Number.isFinite(Number(value.replace(/,/g, '')))) return amountFormatter.format(Number(value.replace(/,/g, '')));
  const labels: Record<string, Record<string, string>> = {
    status: EXPENSE_STATUS_LABELS, vatMode: EXPENSE_VAT_MODE_LABELS,
    sourceDocumentType: SOURCE_DOCUMENT_TYPE_LABELS, taxEvidenceStatus: TAX_EVIDENCE_STATUS_LABELS,
    taxEvidenceReasonCode: TAX_EVIDENCE_REASON_LABELS, vendorEntityKindSnapshot: PAYEE_ENTITY_KIND_LABELS,
    chargeKind: EXPENSE_LINE_CHARGE_KIND_LABELS,
    vatTreatment: { ZERO_RATED: 'อัตรา VAT 0%', EXEMPT: 'ยกเว้น VAT', NON_VAT: 'ไม่มี VAT' },
    inputVatClaimStatus: { CLAIMABLE: 'ขอคืนภาษีซื้อได้', NON_CLAIMABLE: 'ขอคืนภาษีซื้อไม่ได้', NEEDS_REVIEW: 'รอตรวจสอบ' },
  };
  if (['expenseDate', 'receivedAt', 'dueDate'].includes(key)) return formatThaiDate(value, value);
  if (key === 'vatRate' || key === 'whtRate') return Number.isFinite(Number(value)) ? `${expenseRateToPercent(value)}%` : value;
  if (key === 'currency') {
    try { return new Intl.DisplayNames(['th-TH'], { type: 'currency' }).of(value) ?? value; } catch { return value; }
  }
  if (key === 'sourceDocumentLanguage') return ({ TH: 'ภาษาไทย', THAI: 'ภาษาไทย', EN: 'ภาษาอังกฤษ', ENGLISH: 'ภาษาอังกฤษ' } as Record<string, string>)[value.toUpperCase()] ?? value;
  if (key === 'vendorBranchCodeSnapshot') return value === '00000' ? 'สำนักงานใหญ่ (00000)' : `สาขา ${value}`;
  return labels[key]?.[value] ?? value;
}
