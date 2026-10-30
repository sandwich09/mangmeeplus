export function expenseHistoryActionLabel(action: string): string {
  const labels: Record<string, string> = {
    'expense.create': 'สร้างรายการจ่าย',
    'expense.review.update': 'แก้ไขรายการจ่าย',
    'expense.update': 'แก้ไขรายการจ่าย',
    'expense.line_draft.answer': 'แก้ไขรายการจ่าย',
    'expense.line_ai.draft_update': 'แก้ไขรายการจ่าย',
    'expense.line_ai.draft_preview': 'ดูตัวอย่างรายการจ่าย',
    'expense.confirm': 'ยืนยันรายการจ่าย',
    'expense.reject': 'ยกเลิกรายการจ่าย',
    'expense.void': 'ยกเลิกรายการบัญชี',
    'expense.delete': 'ลบรายการจ่าย',
    'expense.evidence.review': 'ตรวจเอกสาร',
    'expense.classification.override': 'ปรับประเภทเอกสาร',
    'expense.vat.source_override': 'ปรับข้อมูล VAT',
    'expense.input_vat.decide': 'ตัดสินใจเครดิตภาษีซื้อ',
    'expense.buyer_match.confirm': 'ยืนยันข้อมูลผู้ซื้อในเอกสาร',
    'expense.signature.fill': 'กรอกลายเซ็นในเอกสาร',
    'expense.reopen': 'เปิดรายการจ่ายให้ตรวจใหม่',
    'expense.payment.cancel': 'ยกเลิกการจ่ายเงิน',
    'expense.payment_date_confirmed': 'ยืนยันวันที่จ่ายเงิน',
    'expense.line_upload.receive': 'อัปโหลดไฟล์',
    'expense.upload.complete': 'อัปโหลดไฟล์',
    'expense.upload_intent.create': 'อัปโหลดไฟล์',
    'expense.ocr.request': 'อ่านข้อมูลจากไฟล์',
    'expense.receipt.remove': 'ลบไฟล์แนบ',
    'expense.duplicate.confirm': 'ยืนยันรายการซ้ำ',
    'expense.duplicate.dismiss': 'ยืนยันว่าไม่ซ้ำ',
    'expense.payment.record': 'บันทึกการจ่ายเงิน',
    'expense.line_draft.start': 'สร้างรายการจ่าย',
    'expense.line_draft.transition': 'แก้ไขรายการจ่าย',
    'expense.substitute_receipt.correct_document': 'แก้ไขใบรับรองแทนใบเสร็จ',
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

export function expenseHistoryActorLabel(actorType: string, displayName: string | null): string {
  if (displayName?.trim()) return displayName.trim();
  return ({ USER: 'ผู้ใช้ที่ไม่ทราบชื่อ', SYSTEM: 'ระบบ', SERVICE: 'บริการอัตโนมัติ', CRM_CUSTOMER: 'ลูกค้า' } as Record<string, string>)[actorType] ?? 'ไม่ทราบผู้ดำเนินการ';
}
