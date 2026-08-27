import type { WhtFormType, WhtPayeeGroupDto, TaxSourceRef } from '@watchdog-bms/contracts';

function toNum(s: string): number { return parseFloat(s) || 0; }
function d4(v: number): string { return v.toFixed(4); }

export type WhtEventInput = {
  id: string;
  whtFormType: WhtFormType;
  payeeSnapshot: { name: string; taxId: string | null; address: string | null; branchCode: string | null } | null;
  incomeCategoryCode: string | null;
  whtRate: string | null;
  grossAmount: string | null;
  withheldAmount: string | null;
  netPaidAmount: string | null;
  taxEventIds?: string[];
  certificateNumber?: string | null;
  sourceType: string;
  sourceId: string;
  sourceEventType: string | null;
};

export type WhtReportTotals = {
  totalGross: string;
  totalWithheld: string;
  payeeGroupCount: number;
  reviewIssueCount: number;
};

/**
 * The income the withholding was taken on, derived from the tax and its rate.
 *
 * A supplier payment's own gross is a settlement figure that includes VAT, so it is NOT the income
 * base — reporting it would make base x rate disagree with the tax actually withheld on both the
 * 50 ทวิ and the ภ.ง.ด. attachment. Shared rather than inlined precisely because those two
 * documents must show the same number for the same payment.
 *
 * `ratePercent` is a percentage ('3' = 3%). A non-positive or unparseable rate returns null: the
 * base is genuinely unknown then, and null leaves it for review instead of inventing a figure.
 */
export function deriveWhtIncomeBase(withheldAmount: string, ratePercent: string | null | undefined): string | null {
  const rate = toNum(ratePercent ?? '');
  if (rate <= 0) return null;
  const withheld = toNum(withheldAmount);
  return d4(Math.round((withheld / (rate / 100)) * 100) / 100);
}

type GroupKey = string;

function groupKey(e: WhtEventInput): GroupKey {
  return [
    e.payeeSnapshot?.name ?? '_',
    e.payeeSnapshot?.taxId ?? '_',
    e.incomeCategoryCode ?? '_',
    e.whtRate ?? '_',
  ].join('|');
}

export function groupWhtEvents(events: WhtEventInput[]): WhtPayeeGroupDto[] {
  const map = new Map<GroupKey, { e: WhtEventInput[]; cert: Set<string> }>();

  for (const e of events) {
    const k = groupKey(e);
    if (!map.has(k)) map.set(k, { e: [], cert: new Set() });
    const bucket = map.get(k)!;
    bucket.e.push(e);
    if (e.certificateNumber) bucket.cert.add(e.certificateNumber);
  }

  const groups: WhtPayeeGroupDto[] = [];
  for (const { e: group, cert } of map.values()) {
    const totalGross = group.reduce((acc, ev) => acc + toNum(ev.grossAmount ?? '0'), 0);
    const totalWithheld = group.reduce((acc, ev) => acc + toNum(ev.withheldAmount ?? '0'), 0);
    const totalNetPaid = group.reduce((acc, ev) => acc + toNum(ev.netPaidAmount ?? '0'), 0);
    const first = group[0]!;
    groups.push({
      payeeName: first.payeeSnapshot?.name ?? '',
      payeeTaxId: first.payeeSnapshot?.taxId ?? null,
      incomeCategoryCode: first.incomeCategoryCode ?? '',
      whtRate: first.whtRate ?? null,
      totalGross: d4(totalGross),
      totalWithheld: d4(totalWithheld),
      totalNetPaid: d4(totalNetPaid),
      certificateNumbers: Array.from(cert),
      taxEventIds: group.map(ev => ev.id),
    });
  }
  return groups;
}

export function computeWhtTotals(groups: WhtPayeeGroupDto[], reviewIssueCount: number): WhtReportTotals {
  let totalGross = 0;
  let totalWithheld = 0;
  for (const g of groups) {
    totalGross += toNum(g.totalGross);
    totalWithheld += toNum(g.totalWithheld);
  }
  return {
    totalGross: d4(totalGross),
    totalWithheld: d4(totalWithheld),
    payeeGroupCount: groups.length,
    reviewIssueCount,
  };
}

export function validateCertificateTotals(
  certificateGross: string,
  certificateWithheld: string,
  eventTotalGross: string,
  eventTotalWithheld: string,
): string[] {
  const errors: string[] = [];
  if (Math.abs(toNum(certificateGross) - toNum(eventTotalGross)) > 0.0001) {
    errors.push(`Certificate gross ${certificateGross} does not match event total ${eventTotalGross}`);
  }
  if (Math.abs(toNum(certificateWithheld) - toNum(eventTotalWithheld)) > 0.0001) {
    errors.push(`Certificate withheld ${certificateWithheld} does not match event total ${eventTotalWithheld}`);
  }
  return errors;
}
