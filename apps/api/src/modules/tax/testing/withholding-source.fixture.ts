import { Prisma } from '../../../generated/prisma/client';

/** A recorded full payment behind a saved tax event. Individual cases override live facts explicitly. */
export function expenseSourceForEvent(event: any, overrides: Record<string, unknown> = {}) {
  const payee = event.payeeSnapshot ?? event.payeeSnapshotJson;
  const gross = String(event.grossAmount ?? event.taxableBase ?? '1000');
  const withheld = String(event.withheldAmount ?? event.taxAmount ?? '30');
  const rate = event.whtRate == null ? null : String(event.whtRate);
  const paymentId = event.sourceLineKey?.startsWith('payment:') ? event.sourceLineKey.slice(8).split(':line:')[0] : `${event.id ?? event.sourceId}-payment`;
  const date = event.eventDate ?? new Date('2026-09-10');
  return {
    id: event.sourceId ?? event.id, companyId: event.companyId ?? 'c1', branchId: event.branchId ?? null, status: 'CONFIRMED',
    expenseDate: date, updatedAt: date, vendorCounterpartyId: null, vendorNameSnapshot: payee?.name ?? '',
    vendorTaxIdSnapshot: payee?.taxId ?? null, vendorBranchCodeSnapshot: payee?.branchCode ?? null, vendorAddressSnapshot: payee?.address ?? null,
    vendorEntityKindSnapshot: event.eventType === 'WHT_PND53' || event.whtFormType === 'PND53' ? 'JURISTIC' : 'INDIVIDUAL',
    whtAmount: withheld, whtRate: rate, whtCategoryCode: event.incomeCategoryCode ?? null, taxableAmount: gross, grandTotalAmount: gross,
    whtInputJson: { inputType: rate == null ? 'AMOUNT' : 'RATE', value: rate ?? withheld, baseAmount: gross, origin: 'REVIEWER' },
    netPayableAmount: new Prisma.Decimal(gross).minus(withheld).toString(), currency: event.currency ?? 'THB', lines: [],
    payments: [{ id: paymentId, amount: new Prisma.Decimal(gross).minus(withheld).toString(), status: 'RECORDED', paidAtConfirmed: true, paidAt: date, createdAt: date }],
    ...overrides,
  };
}
