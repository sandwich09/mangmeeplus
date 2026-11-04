import { civilDate, eWhtPaymentMethodAllowed, E_WHT_WORDS } from '@watchdog-bms/contracts';
import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { SETTLE_EPSILON } from './expense-totals.logic';

export function assertFullSubstitutePayment(source: string | null | undefined, paid: string, payable: string): void {
  if (source !== 'COMPANY' && source !== 'PERSONAL_ADVANCE') {
    throw new ConflictException({ code: 'substitute_funding_source_required', message: 'เอกสารเดิมยังไม่ระบุแหล่งเงิน จัดทำฉบับแก้ไขและเซ็นอีกครั้ง' });
  }
  const amount = new Decimal(paid);
  const total = new Decimal(payable);
  if (!total.gt(0) || amount.isNegative() || (source === 'PERSONAL_ADVANCE' && !amount.isZero())
    || (source === 'COMPANY' && !amount.isZero() && amount.minus(total).abs().gt(SETTLE_EPSILON))) {
    throw new ConflictException({ code: 'substitute_full_payment_required', message: 'รองรับเฉพาะร้านจ่ายเต็มจำนวนหรือพนักงานสำรองจ่ายเต็มจำนวน รายการนี้มีข้อมูลการจ่ายที่ต้องตรวจแก้ก่อนทำต่อ' });
  }
}

/** Company payment facts are immutable here; compare the recorded calendar day, not the clock. */
export function assertSubstitutePaymentDetails(source: string | null | undefined,
  expense: { paidAmount: { toString(): string }; paidAt: Date | null; paymentMethod: string | null; whtRemittance?: string | null },
  certificate: { paymentDate: Date | null; paymentMethod: string | null }): void {
  if (source === 'COMPANY' && expense.whtRemittance === 'E_WHT' && !eWhtPaymentMethodAllowed(certificate.paymentMethod)) {
    throw new ConflictException({ code: 'substitute_receipt_ewht_payment_method', message: E_WHT_WORDS['W-R3'] });
  }
  if (source !== 'COMPANY' || !new Decimal(expense.paidAmount.toString()).gt(0)) return;
  if ((expense.paymentMethod && expense.paymentMethod !== certificate.paymentMethod)
    || (expense.paidAt && (!certificate.paymentDate || civilDate(expense.paidAt) !== civilDate(certificate.paymentDate)))) {
    throw new ConflictException({ code: 'substitute_existing_payment_details_mismatch',
      message: 'วันที่หรือวิธีจ่ายในใบรับรองไม่ตรงกับการจ่ายที่บันทึกแล้ว ตรวจประวัติการจ่าย ยกเลิกใบรับรองก่อนสร้างใหม่ หากรายการจ่ายเดิมผิด ให้ผู้มีสิทธิ์ยกเลิกรายจ่ายและกลับรายการที่เกี่ยวข้องก่อน' });
  }
}

export function assertSubstituteFactsComplete(evidence: {
  payeeName: string | null; missingReceiptReason: string; businessPurpose: string;
  paymentDate: Date | null; paymentMethod: string | null;
}): void {
  if (!evidence.payeeName?.trim() || !evidence.missingReceiptReason.trim() || !evidence.businessPurpose.trim()
    || !evidence.paymentDate || !evidence.paymentMethod) {
    throw new ConflictException({ code: 'substitute_facts_incomplete',
      message: 'ข้อมูลใบรับรองยังไม่ครบ แก้ไขใบรับรองเพื่อระบุผู้รับเงิน เหตุผล วัตถุประสงค์ และวันที่หรือวิธีจ่ายก่อนเซ็น โดยไม่ต้องยกเลิกเอกสาร' });
  }
}
