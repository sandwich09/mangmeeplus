import type { BillingInterval } from '@watchdog-bms/contracts';
import { billingError, paidVariant } from './billing-policy';

const invalid = () => billingError('BILLING_PACKAGE_STATE_INVALID', 'ข้อมูลแพ็กเกจเปลี่ยนแล้ว กรุณาตรวจสอบรายการใหม่');
const time = (date: Date): number => {
  const value = date.getTime();
  if (!Number.isSafeInteger(value)) throw invalid();
  return value;
};
const units = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) throw invalid();
  return value;
};

/** Preserve the billing anniversary through February/short months, without assuming 30/365 days. */
export function appendPackageInterval(start: Date, interval: BillingInterval, anchorDay = start.getUTCDate()): Date {
  time(start);
  if (!['month', 'year'].includes(interval) || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw invalid();
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (interval === 'year' ? 12 : 1));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(anchorDay, lastDay));
  if (time(end) <= time(start)) throw invalid();
  return end;
}

/** Server-owned paid history only: callers must not pass trial dates or browser-submitted balances. */
export function fullPackagePurchaseImpact(input: {
  tier: unknown; interval: unknown; verifiedPaidAt: Date; paidThrough: Date | null;
  remainingPaidReceipts: number; anchorDay?: number;
}) {
  const { offer, interval } = paidVariant(input.tier, input.interval);
  const paidAt = time(input.verifiedPaidAt);
  const continuing = input.paidThrough !== null && time(input.paidThrough) > paidAt;
  const serviceStartsAt = continuing ? new Date(input.paidThrough!) : new Date(input.verifiedPaidAt);
  const paidThrough = appendPackageInterval(serviceStartsAt, interval, continuing ? input.anchorDay : undefined);
  const previousRemaining = units(input.remainingPaidReceipts);
  // Expired paid allowance cannot be revived merely by buying again after a lapse.
  const remainingReceipts = units((continuing ? previousRemaining : 0) + offer.receiptAllowance);
  return {
    offer, receiptAvailableAt: new Date(input.verifiedPaidAt), receiptUnitsAdded: offer.receiptAllowance,
    previousRemaining: continuing ? previousRemaining : 0, remainingReceipts,
    serviceStartsAt, paidThrough, nextRenewalAt: new Date(paidThrough),
  };
}

/** Upgrade every still-paid segment, including full future segments bought in advance. */
export function proratedReceiptIncrease(periods: readonly {
  start: Date; end: Date; oldAllowance: number; newAllowance: number;
}[], effectiveAt: Date): number {
  const at = time(effectiveAt);
  let total = 0, previousEnd = Number.NEGATIVE_INFINITY;
  for (const period of [...periods].sort((a, b) => time(a.start) - time(b.start))) {
    const start = time(period.start), end = time(period.end);
    const oldAllowance = units(period.oldAllowance), newAllowance = units(period.newAllowance);
    if (start >= end || start < previousEnd || newAllowance < oldAllowance) throw invalid();
    previousEnd = end;
    const remaining = Math.max(0, end - Math.max(at, start));
    // Integer arithmetic keeps flooring deterministic even for multiple years of prepaid service.
    total = units(total + Number(BigInt(newAllowance - oldAllowance) * BigInt(remaining) / BigInt(end - start)));
  }
  return total;
}

/** Round each accepted price difference half up, in integer satang, over actual service time. */
export function proratedPackagePrice(oldPrice: number, newPrice: number, start: Date, end: Date, at: Date): number {
  units(oldPrice); units(newPrice);
  const duration = time(end) - time(start), remaining = Math.max(0, time(end) - Math.max(time(at), time(start)));
  if (duration <= 0 || newPrice < oldPrice) throw invalid();
  return units(Number((BigInt(newPrice - oldPrice) * BigInt(remaining) * 2n + BigInt(duration)) / (2n * BigInt(duration))));
}
