import type { BillingInterval, BillingOffer } from '@watchdog-bms/contracts';
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
const bangkokDay = (milliseconds: number) => Math.floor((milliseconds + 7 * 60 * 60 * 1000) / 86_400_000);

/**
 * Preserve the billing anniversary through February/short months, without assuming 30/365 days.
 *
 * `count` is how many whole intervals to append at once — 1 for every catalog offer, N for a
 * sales deal sold as N months (spec §19.2/S35). Counting months once, rather than calling this N
 * times, is what keeps the anchor day: 31 Jan + 3 months is 30 Apr, not 30 Apr via 28 Feb.
 */
export function appendPackageInterval(start: Date, interval: BillingInterval, anchorDay = start.getUTCDate(), count = 1): Date {
  time(start);
  if (!['month', 'year'].includes(interval) || !Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31 ||
      !Number.isInteger(count) || count < 1 || count > 1200) throw invalid();
  const end = new Date(start);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + (interval === 'year' ? 12 : 1) * count);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(anchorDay, lastDay));
  if (time(end) <= time(start)) throw invalid();
  return end;
}

/** Server-owned paid history only: callers must not pass trial dates or browser-submitted balances. */
export function fullPackagePurchaseImpact(input: {
  tier: unknown; interval: unknown; verifiedPaidAt: Date; paidThrough: Date | null;
  remainingPaidReceipts: number; anchorDay?: number; offer?:BillingOffer;
}) {
  const variant = paidVariant(input.tier, input.interval), interval=variant.interval, offer=input.offer??variant.offer;
  if(offer.offerKey!==variant.tier||offer.interval!==interval||offer.receiptAllowance<1)throw invalid();
  units(offer.receiptAllowance);
  const paidAt = time(input.verifiedPaidAt);
  const continuing = input.paidThrough !== null && time(input.paidThrough) > paidAt;
  const serviceStartsAt = continuing ? new Date(input.paidThrough!) : new Date(input.verifiedPaidAt);
  const paidThrough = appendPackageInterval(serviceStartsAt, interval, continuing ? input.anchorDay : undefined, offer.intervalCount ?? 1);
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
    if (at >= start && at < end && bangkokDay(at) === bangkokDay(start)) {
      total = units(total + newAllowance - oldAllowance);
      continue;
    }
    // After purchase day, round each paid segment half up in exact integer arithmetic.
    const duration = BigInt(end - start);
    total = units(total + Number((BigInt(newAllowance - oldAllowance) * BigInt(remaining) * 2n + duration) / (2n * duration)));
  }
  return total;
}

/** Round each accepted price difference half up, in integer satang, over actual service time. */
export function proratedPackagePrice(oldPrice: number, newPrice: number, start: Date, end: Date, at: Date): number {
  units(oldPrice); units(newPrice);
  const startMs = time(start), endMs = time(end), atMs = time(at);
  const duration = endMs - startMs, remaining = Math.max(0, endMs - Math.max(atMs, startMs));
  if (duration <= 0 || newPrice < oldPrice) throw invalid();
  if (atMs >= startMs && atMs < endMs && bangkokDay(atMs) === bangkokDay(startMs)) return newPrice - oldPrice;
  return units(Number((BigInt(newPrice - oldPrice) * BigInt(remaining) * 2n + BigInt(duration)) / (2n * BigInt(duration))));
}
