// Seller readiness (spec §8.1) — the two levels, named so they cannot be confused.
//
// "The data is complete" and "this company may issue a tax invoice" are different questions with
// different answers, and collapsing them is how a system tells a user they are ready and then
// refuses them at the last step. `sellerIdentityComplete` answers the first. `taxInvoiceEligible`
// answers the second, and only a dated VAT fact can answer it.
import { COMPANY_LEGAL_ADDRESS_KEYS, type VatRegistrationStatus } from '@watchdog-bms/contracts';

/** Reasons are stable machine keys; the web maps them to Thai copy through the honesty seam. */
export type SellerIdentityReason =
  | 'tax_id_missing'
  | 'tax_id_invalid'
  | 'registered_name_missing'
  | 'company_address_incomplete'
  | 'branch_not_tax_establishment'
  | 'branch_address_missing'
  | 'vat_status_unanswered';

export type ReadinessBranch = {
  id: string;
  type: string;
  status: string;
  isVatEstablishment: boolean;
  taxBranchCode: string | null;
  addressJson: unknown;
};

export type ReadinessCompany = {
  taxId: string | null;
  registeredName: string | null;
  addressJson: unknown;
};

export type SellerIdentityReadiness = { complete: boolean; reasons: SellerIdentityReason[] };

function addressComplete(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const address = value as Record<string, unknown>;
  return COMPANY_LEGAL_ADDRESS_KEYS.filter((key) => key !== 'line2').every(
    (key) => typeof address[key] === 'string' && (address[key] as string).trim().length > 0,
  );
}

/**
 * Per establishment. A branch that is not a ภ.พ.20 establishment can never be the seller on a
 * tax invoice, and a non-head-office establishment must carry its OWN address — only the head
 * office may fall back to the company address, because that is the one case where they are the
 * same place (§6.2).
 *
 * `promptResolved` is part of completeness rather than eligibility: a company that has never
 * been asked about VAT is not "complete but ineligible", it is unfinished.
 */
export function sellerIdentityComplete(
  company: ReadinessCompany,
  branch: ReadinessBranch | null,
  promptResolved: boolean,
): SellerIdentityReadiness {
  const reasons: SellerIdentityReason[] = [];

  if (!company.taxId) reasons.push('tax_id_missing');
  else if (!/^\d{13}$/.test(company.taxId)) reasons.push('tax_id_invalid');
  if (!company.registeredName?.trim()) reasons.push('registered_name_missing');
  if (!addressComplete(company.addressJson)) reasons.push('company_address_incomplete');

  if (!branch || !branch.isVatEstablishment || !branch.taxBranchCode) {
    reasons.push('branch_not_tax_establishment');
  } else if (branch.type !== 'HEAD_OFFICE' && !addressComplete(branch.addressJson)) {
    reasons.push('branch_address_missing');
  }

  if (!promptResolved) reasons.push('vat_status_unanswered');

  return { complete: reasons.length === 0, reasons };
}

/**
 * The company-level gate (§8.1). Closing the capture window and setting the authoritative latch
 * both hang off THIS, not off whichever branch happens to be issuing: a company whose head
 * office is still half-filled has not established its identity, whatever a branch has.
 */
export function sellerIdentityCompleteHO(
  company: ReadinessCompany,
  branches: readonly ReadinessBranch[],
  promptResolved: boolean,
): SellerIdentityReadiness {
  const headOffice = branches.find((branch) => branch.type === 'HEAD_OFFICE' && branch.status === 'ACTIVE') ?? null;
  return sellerIdentityComplete(company, headOffice, promptResolved);
}

/** Eligibility is exactly one thing: a fact says REGISTERED on that date. */
export function taxInvoiceEligible(status: VatRegistrationStatus): boolean {
  return status === 'REGISTERED';
}
