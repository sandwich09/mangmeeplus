import { COMPANY_PROFILE_SHOP_HASH, companyProfilePath, type ExpenseBuyerMismatchReason } from '@watchdog-bms/contracts';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { formatTaxId, type ExpenseDetail } from './expenses.model';

/**
 * Vendor-address §8 Slice 2 / AC13: what the review page says about the buyer a full tax invoice
 * printed. Warn-only — every way forward is a person's choice, and nothing here disables anything
 * else on the page. A MATCH, a page with no buyer block, or a closed record says nothing at all.
 */
export type BuyerMatchBannerState =
  | { kind: 'none' }
  | { kind: 'unchecked'; settingsHref: string | null }
  | { kind: 'confirmed'; reason: string }
  | {
    kind: 'mismatch';
    differences: Array<{ reason: ExpenseBuyerMismatchReason; labelKey: DictionaryKey; printed: string; registered: string }>;
    canConfirm: boolean;
    canMarkNonClaimable: boolean;
    /** Why the mark button is absent, in words (D5): never a missing button with no reason. */
    markHintKey: DictionaryKey | null;
  };

const REASON_LABEL_KEYS: Record<ExpenseBuyerMismatchReason, DictionaryKey> = {
  TAX_ID: 'expenses.buyer_match_reason_tax_id',
  BRANCH: 'expenses.buyer_match_reason_branch',
  NAME: 'expenses.buyer_match_reason_name',
  POSTAL_CODE: 'expenses.buyer_match_reason_postal_code',
};

export function buyerMatchBannerState(input: {
  companyId: string;
  detail: Pick<ExpenseDetail, 'sourceDocumentType' | 'buyerAsPrinted' | 'status' | 'postingStatus' | 'inputVatClaimStatus'>;
  permissions: readonly string[];
  /** The page's own rule for "the review form is editable here": status and reimbursement claim. */
  editable: boolean;
  /** A reimbursement claim past DRAFT owns this record's edits. */
  claimed: boolean;
}): BuyerMatchBannerState {
  const { detail } = input;
  const buyer = detail.buyerAsPrinted;
  const has = (permission: string) => input.permissions.includes(permission);
  if (detail.sourceDocumentType !== 'TAX_INVOICE' || !buyer) return { kind: 'none' };
  // A voided or reversed document is not going to be claimed by anyone; a warning there is noise.
  if (detail.status === 'VOIDED' || detail.postingStatus === 'reversed') return { kind: 'none' };
  if (buyer.matchStatus === 'UNCHECKED') {
    // The profile page needs `company.setup.read`; without it the link would open a refusal.
    return { kind: 'unchecked', settingsHref: has('company.setup.read') ? companyProfilePath(input.companyId, COMPANY_PROFILE_SHOP_HASH) : null };
  }
  if (buyer.matchStatus !== 'MISMATCH') return { kind: 'none' };
  const overrideReason = buyer.overrideReason?.trim();
  if (overrideReason) return { kind: 'confirmed', reason: overrideReason };
  const alreadyMarked = detail.inputVatClaimStatus === 'NON_CLAIMABLE';
  const canReview = has('expense.review');
  return {
    kind: 'mismatch',
    differences: (buyer.differences ?? []).map((difference) => ({
      reason: difference.reason,
      labelKey: REASON_LABEL_KEYS[difference.reason],
      // The company's own tax id, in full: nothing here is somebody else's personal data.
      printed: difference.reason === 'TAX_ID' ? formatTaxId(difference.printed) : difference.printed,
      registered: difference.reason === 'TAX_ID' ? formatTaxId(difference.registered) : difference.registered,
    })),
    canConfirm: has('expense.confirm'),
    canMarkNonClaimable: input.editable && canReview && !alreadyMarked,
    markHintKey: alreadyMarked ? 'expenses.buyer_match_marked_non_claimable'
      : !input.editable ? (input.claimed ? 'expenses.buyer_match_mark_via_claim' : 'expenses.buyer_match_mark_locked')
        : !canReview ? 'expenses.buyer_match_mark_needs_reviewer'
          : null,
  };
}
