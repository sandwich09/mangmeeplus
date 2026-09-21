import {
  COMPANY_PROFILE_SHOP_HASH, companyProfilePath,
  type ExpenseBuyerAsPrinted, type ExpenseBuyerMismatchReason, type TaxClaimability, type TransactionTaxSnapshot,
} from '@watchdog-bms/contracts';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { formatTaxId, type ExpenseDetail } from './expenses.model';

/**
 * Vendor-address §8 Slice 2 / AC13: what the review page says about the buyer a full tax invoice
 * printed. Warn-only — every way forward is a person's choice, and nothing here disables anything
 * else on the page. A MATCH, a page with no buyer block, or a closed record says nothing at all.
 */
export type RestorableClaimStatus = NonNullable<ExpenseBuyerAsPrinted['claimStatusBeforeMark']>;

export type BuyerMatchBannerState =
  | { kind: 'none' }
  | ({
    /** Review fix 2: the status the mark replaced, when this viewer may put it back here and now. */
    restoreClaimStatus: RestorableClaimStatus | null;
  } & (
    | { kind: 'unchecked'; settingsHref: string | null }
    | { kind: 'confirmed'; reason: string }
    /** A re-check no longer warns, but a mark is still in place: its undo must stay reachable. */
    | { kind: 'marked' }
    | {
      kind: 'mismatch';
      differences: Array<{ reason: ExpenseBuyerMismatchReason; labelKey: DictionaryKey; printed: string; registered: string }>;
      canConfirm: boolean;
      canMarkNonClaimable: boolean;
      /** Why the mark button is absent, or what to do instead, in words (D5). */
      markHintKey: DictionaryKey | null;
      /** Tax-code path: the way forward is on the lines, so offer to take the reviewer there. */
      openLines: boolean;
    }
  ));

type BannerLine = {
  taxSnapshot?: Pick<TransactionTaxSnapshot, 'taxCodeDefinitionId' | 'externalTaxCode' | 'claimability'>;
  taxComponents?: ReadonlyArray<{ snapshot: Pick<TransactionTaxSnapshot, 'claimability'> }>;
};

const REASON_LABEL_KEYS: Record<ExpenseBuyerMismatchReason, DictionaryKey> = {
  TAX_ID: 'expenses.buyer_match_reason_tax_id',
  BRANCH: 'expenses.buyer_match_reason_branch',
  NAME: 'expenses.buyer_match_reason_name',
  POSTAL_CODE: 'expenses.buyer_match_reason_postal_code',
};
const CLAIMING: readonly TaxClaimability[] = ['CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIAL'];

/**
 * Review fix 1: once a line carries a Tax Code, ภ.พ.30 takes its input VAT from that line and never
 * reads the header claim status (`sync-tax-events` component path; the header path only sees expenses
 * whose lines have no component). The header mark would change nothing there, so it is not offered.
 */
function lineTaxCodes(lines: readonly BannerLine[]): { taxCodePath: boolean; claiming: boolean } {
  const coded = lines.filter((line) => Boolean(line.taxSnapshot?.taxCodeDefinitionId || line.taxSnapshot?.externalTaxCode || line.taxComponents?.length));
  return {
    taxCodePath: coded.length > 0,
    claiming: coded.some((line) => [line.taxSnapshot?.claimability, ...(line.taxComponents ?? []).map((component) => component.snapshot.claimability)]
      .some((claimability) => claimability !== undefined && CLAIMING.includes(claimability))),
  };
}

export function buyerMatchBannerState(input: {
  companyId: string;
  detail: Pick<ExpenseDetail, 'sourceDocumentType' | 'buyerAsPrinted' | 'status' | 'postingStatus' | 'inputVatClaimStatus'> & { lines: readonly BannerLine[] };
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
  const canReview = has('expense.review');
  const nonClaimable = detail.inputVatClaimStatus === 'NON_CLAIMABLE';
  const restoreClaimStatus = nonClaimable && buyer.claimStatusBeforeMark && input.editable && canReview ? buyer.claimStatusBeforeMark : null;
  if (buyer.matchStatus === 'UNCHECKED') {
    // The profile page needs `company.setup.read`; without it the link would open a refusal.
    return {
      kind: 'unchecked', restoreClaimStatus,
      settingsHref: has('company.setup.read') ? companyProfilePath(input.companyId, COMPANY_PROFILE_SHOP_HASH) : null,
    };
  }
  if (buyer.matchStatus !== 'MISMATCH') return restoreClaimStatus ? { kind: 'marked', restoreClaimStatus } : { kind: 'none' };
  const overrideReason = buyer.overrideReason?.trim();
  if (overrideReason) return { kind: 'confirmed', reason: overrideReason, restoreClaimStatus };
  const lines = lineTaxCodes(detail.lines);
  const locked: DictionaryKey = input.claimed ? 'expenses.buyer_match_mark_via_claim' : 'expenses.buyer_match_mark_locked';
  const markHintKey: DictionaryKey | null = lines.taxCodePath
    ? (!lines.claiming ? 'expenses.buyer_match_line_tax_not_claimed'
      : !input.editable ? locked
        : !canReview ? 'expenses.buyer_match_mark_needs_reviewer'
          : 'expenses.buyer_match_change_line_tax_code')
    : nonClaimable ? (buyer.claimStatusBeforeMark ? 'expenses.buyer_match_marked_non_claimable' : 'expenses.buyer_match_already_not_claimed')
      : !input.editable ? locked
        : !canReview ? 'expenses.buyer_match_mark_needs_reviewer'
          : null;
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
    canMarkNonClaimable: !lines.taxCodePath && input.editable && canReview && !nonClaimable,
    markHintKey,
    openLines: lines.taxCodePath && lines.claiming && input.editable && canReview,
    restoreClaimStatus,
  };
}
