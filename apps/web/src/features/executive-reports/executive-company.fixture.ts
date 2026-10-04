// Spec fixture: the facts every company row of the API carries beside its period figures (the owner's sheet, contact, note).
const known = (value: number) => ({ value, coverage: 'complete', reasonCodes: [] });
const money = (value: number) => ({ ...known(value), currency: 'THB' });

/** Sheet, inactivity, owner contact and team note of one company, as API03 returns them. Override what a case is about. */
export function companyFacts(overrides: Record<string, unknown> = {}) {
  return {
    sheet: { asOf: '2026-10-04T18:32:24.472Z', planLabel: 'เติบโต', businessTypeLabel: 'การบริการด้านอาหารในภัตตาคาร/ร้านอาหาร', planEndsAt: '2026-10-15T02:00:00.000Z', daysLeft: 10, packageExpired: false,
      receiptsLifetime: known(27), firstReceiptAt: '2026-07-03T02:00:00.000Z', lastReceiptAt: '2026-09-30T02:00:00.000Z', daysSinceLastReceipt: 5,
      receipts7: known(2), receipts30: known(7), receiptDays30: known(3), confirmed: known(20), pending: known(4), draft: known(3), receiptBucket: 'SIX_PLUS', aiRequests30: known(5),
      paymentState: { paidEver: 'YES', fullyRefunded: false }, lifetimeReceiptsSatang: money(99900), lifetimeRefundsSatang: money(0), lifetimeNetSatang: money(99900), activeMemberCount: 2, branchCount: 1 },
    inactivity: { referenceDate: '2026-09-30', lastUseAt: '2026-09-30T02:00:00.000Z', daysSinceLastUse: 0, churned: false, neverUsed: false, coverage: { coverage: 'complete', reasonCodes: [] } },
    ownerContact: { status: 'NOT_PERMITTED' },
    note: { text: '', version: 0, updatedAt: null, updatedBy: null },
    canEditNote: false,
    ...overrides,
  };
}
