import { civilDate } from '@watchdog-bms/contracts';
import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { SETTLE_EPSILON } from './expense-totals.logic';

export function assertFullSubstitutePayment(source: string | null | undefined, paid: string, payable: string): void {
  if (source !== 'COMPANY' && source !== 'PERSONAL_ADVANCE') {
    throw new ConflictException({ code: 'substitute_funding_source_required', message: 'เอกสารเดิมยังไม่ระบุแหล่งเงิน กรุณาสร้างเวอร์ชันใหม่และลงนามอีกครั้ง' });
  }
  const amount = new Decimal(paid);
  const total = new Decimal(payable);
  if (!total.gt(0) || amount.isNegative() || (source === 'PERSONAL_ADVANCE' && !amount.isZero())
    || (source === 'COMPANY' && !amount.isZero() && amount.minus(total).abs().gt(SETTLE_EPSILON))) {
    throw new ConflictException({ code: 'substitute_full_payment_required', message: 'รองรับบริษัทจ่ายเต็มหรือพนักงานสำรองจ่ายเต็มเท่านั้น รายการนี้มีข้อมูลการจ่ายที่ต้องตรวจแก้ก่อน' });
  }
}

/** Company payment facts are immutable here; compare the recorded calendar day, not the clock. */
export function assertSubstitutePaymentDetails(source: string | null | undefined,
  expense: { paidAmount: { toString(): string }; paidAt: Date | null; paymentMethod: string | null },
  certificate: { paymentDate: Date | null; paymentMethod: string | null }): void {
  if (source !== 'COMPANY' || !new Decimal(expense.paidAmount.toString()).gt(0)) return;
  if ((expense.paymentMethod && expense.paymentMethod !== certificate.paymentMethod)
    || (expense.paidAt && (!certificate.paymentDate || civilDate(expense.paidAt) !== civilDate(certificate.paymentDate)))) {
    throw new ConflictException({ code: 'substitute_existing_payment_details_mismatch',
      message: 'วันที่หรือวิธีจ่ายในใบแทนไม่ตรงกับการจ่ายที่บันทึกแล้ว กลับไปแก้ข้อมูลใบแทนและเลือกใช้ข้อมูลการจ่ายที่บันทึกไว้ หากรายการจ่ายเดิมผิด ให้ผู้มีสิทธิ์ตรวจแก้รายการจ่ายก่อนลงนาม' });
  }
}

export function assertSubstituteFactsComplete(evidence: {
  payeeName: string | null; missingReceiptReason: string; businessPurpose: string;
  paymentDate: Date | null; paymentMethod: string | null;
}): void {
  if (!evidence.payeeName?.trim() || !evidence.missingReceiptReason.trim() || !evidence.businessPurpose.trim()
    || !evidence.paymentDate || !evidence.paymentMethod) {
    throw new ConflictException({ code: 'substitute_facts_incomplete',
      message: 'ข้อมูลใบแทนยังไม่ครบ เลือกแก้ไขข้อมูลใบแทนเพื่อระบุผู้รับเงิน เหตุผล วัตถุประสงค์ และวันที่/วิธีจ่ายก่อนลงนาม ไม่ต้องยกเลิกเอกสาร' });
  }
}
