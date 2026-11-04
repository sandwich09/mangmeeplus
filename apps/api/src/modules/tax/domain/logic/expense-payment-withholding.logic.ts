import { Prisma } from '../../../../generated/prisma/client';

/** Cash is net payable. Round cumulative shares to satang in recording order and subtract prior shares;
 * the payment completing the net payable takes the remaining satang. Unknown-date
 * payments retain their share, but are withheld from the paper by the caller. */
export function allocateExpenseWithholding<T extends { id: string; amount: unknown; status: string; createdAt: Date }>(
  payments: T[], netPayable: string, income: string, withheld: string,
  frozen = new Map<string, { grossAmount: string; whtAmount: string }>(),
  grossPayable = new Prisma.Decimal(netPayable).add(withheld).toString(),
): Array<T & { grossAmount: string; whtAmount: string }> {
  // Historical gross payments still owe the tax. Spread that duty over the gross cash,
  // rather than treating the first net-sized fraction as a completed payment.
  const cash = payments.filter(p => p.status === 'RECORDED').reduce((sum, p) => sum.add(String(p.amount)), new Prisma.Decimal(0));
  const net = cash.gte(grossPayable) ? new Prisma.Decimal(grossPayable) : new Prisma.Decimal(netPayable);
  if (!net.gt(0)) return [];
  let paid = new Prisma.Decimal(0), baseUsed = new Prisma.Decimal(0), taxUsed = new Prisma.Decimal(0);
  return payments.filter(p => p.status === 'RECORDED').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).map(p => {
    const amount = new Prisma.Decimal(String(p.amount));
    paid = paid.add(amount);
    const complete = paid.toDecimalPlaces(2).gte(net.toDecimalPlaces(2));
    const fixed = frozen.get(p.id);
    const base = fixed ? new Prisma.Decimal(fixed.grossAmount) : complete ? new Prisma.Decimal(income).sub(baseUsed) : new Prisma.Decimal(income).mul(paid).div(net).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).sub(baseUsed).clampedTo(0, income);
    const tax = fixed ? new Prisma.Decimal(fixed.whtAmount) : complete ? new Prisma.Decimal(withheld).sub(taxUsed) : new Prisma.Decimal(withheld).mul(paid).div(net).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).sub(taxUsed).clampedTo(0, withheld);
    baseUsed = baseUsed.add(base); taxUsed = taxUsed.add(tax);
    return { ...p, grossAmount: base.toString(), whtAmount: tax.toString() };
  });
}

/** Shared form choice; callers retain source-specific kind validation and review issues. */
export function withholdingFormFor(kind: string | null, filingRoute?: string | null): 'PND2' | 'PND3' | 'PND53' | null {
  if (kind === 'INDIVIDUAL') return filingRoute === 'SEPARATE_PND2' ? 'PND2' : 'PND3';
  return kind === 'JURISTIC' || kind === 'JURISTIC_PERSON' ? 'PND53' : null;
}
