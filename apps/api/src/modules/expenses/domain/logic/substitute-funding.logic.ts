import { ConflictException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { SETTLE_EPSILON } from './expense-totals.logic';

export function assertFullSubstitutePayment(source: string | null | undefined, paid: string, payable: string): void {
  if (source !== 'COMPANY' && source !== 'PERSONAL_ADVANCE') {
    throw new ConflictException({ code: 'substitute_funding_source_required', message: 'เอกสารเดิมยังไม่ระบุแหล่งเงิน กรุณาสร้างเวอร์ชันใหม่และลงนามอีกครั้ง' });
  }
  const amount = new Decimal(paid);
  const total = new Decimal(payable);
  if (!total.isPositive() || amount.isNegative() || (source === 'PERSONAL_ADVANCE' && !amount.isZero())
    || (source === 'COMPANY' && !amount.isZero() && amount.minus(total).abs().gt(SETTLE_EPSILON))) {
    throw new ConflictException({ code: 'substitute_full_payment_required', message: 'รองรับบริษัทจ่ายเต็มหรือพนักงานสำรองจ่ายเต็มเท่านั้น รายการนี้มีข้อมูลการจ่ายที่ต้องตรวจแก้ก่อน' });
  }
}
