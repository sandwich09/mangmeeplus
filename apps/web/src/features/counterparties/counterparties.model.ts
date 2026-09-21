import type {
  AccountingCounterpartyDetail,
  AccountingCounterpartySummary,
  BuyerEntityKind,
  BuyerVatStatus,
  CounterpartyAddressV2,
} from '@watchdog-bms/contracts';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';

/** §11.1/§12.1: both keys already exist; this screen adds none. */
export const COUNTERPARTY_READ_PERMISSION = 'accounting.counterparty.read';
export const COUNTERPARTY_MANAGE_PERMISSION = 'accounting.counterparty.manage';

/** §6/§8: the same ceiling the expense column has. Over it the API answers `counterparty_address_too_long`. */
export const COUNTERPARTY_ADDRESS_MAX_LENGTH = 500;
export const COUNTERPARTY_BRANCH_CODE_LENGTH = 5;
export const COUNTERPARTY_PAGE_SIZE = 20;

/**
 * What `GET .../counterparties` really returns. The contract summary predates the columns the
 * registry screen reads (`entityKind` decides ภ.ง.ด.3 vs 53, `vatStatus` is a label only per
 * CON-13, `billingAddressJson` carries the address), and `packages/` is out of scope for this
 * change — so the extra keys are declared here rather than guessed at the call site.
 */
export type CounterpartySummary = AccountingCounterpartySummary & {
  entityKind?: BuyerEntityKind | null;
  vatStatus?: BuyerVatStatus | null;
  billingAddressJson?: Record<string, unknown> | null;
};

export type CounterpartyDetail = CounterpartySummary & AccountingCounterpartyDetail;

/** A5: the chips are usage and address, never `type` — there is no customer/vendor picker. */
export type CounterpartyListFilter = 'all' | 'bought' | 'sold' | 'addressMissing';

/** A legacy row may hold a free-shape object, so every field here is already normalised. */
export type CounterpartyAddressView = {
  addressText: string;
  postalCode: string;
  /** A4 "ล็อกที่อยู่หลัก": a newer document address stops replacing this one. */
  locked: boolean;
  provenance: CounterpartyAddressV2['provenance'] | null;
  seenOnDocuments: NonNullable<CounterpartyAddressV2['seenOnDocuments']>;
};

export type CounterpartyFormValues = {
  displayName: string;
  legalName: string;
  taxId: string;
  /** '' = ยังไม่ระบุ. Kept out of the payload so a save never invents ภ.ง.ด.53 for a row that had none (CON-7). */
  entityKind: BuyerEntityKind | '';
  /** Local, like the review page's: a blank code means both "สำนักงานใหญ่" and "สาขา, not typed yet" (CON-8). */
  isBranch: boolean;
  branchCode: string;
  addressText: string;
  postalCode: string;
  locked: boolean;
  email: string;
  phone: string;
};

export type CounterpartyFormIssue = { field: keyof CounterpartyFormValues; messageKey: DictionaryKey };

/**
 * §7 cases a-d as the review page renders them: a toast for a create/fill, one quiet line under the
 * address field for a differing address (A4 — no button, nothing to decide), and a bar when the
 * expense saved but the registry write did not. `counterpartyId` is null when the reader holds no
 * `accounting.counterparty.read`, which hides the link instead of leading to a refusal (§8).
 */
export type CounterpartyAutoSaveNotice = {
  kind: 'toast' | 'hint' | 'bar';
  messageKey: DictionaryKey;
  params?: Record<string, string>;
  counterpartyId: string | null;
};
