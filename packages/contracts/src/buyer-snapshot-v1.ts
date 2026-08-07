// Frozen buyer identity on an issued tax document (spec §7.2, normative).
//
// One definition, four consumers: the issue flow that freezes it, the CN/DN flow that reuses
// the original's copy, the buyer-evidence remediation endpoint (§7.3), and report 6 that
// measures coverage. They must agree exactly — a report that calls a snapshot valid while the
// issue path rejects it is how "100% coverage" ships next to a blocked credit note.
//
// Snapshots frozen before this feature carry only `{id, displayName, taxId, legalName}` and no
// `snapshotSchemaVersion`, so they are invalid by construction. That is deliberate: it is what
// puts every legacy tax invoice on report 6 without a separate migration or backfill flag.
import { BUYER_ENTITY_KINDS, type BuyerEntityKind } from './company-tax-identity.js';

/** The buyer VAT statuses that can appear in a snapshot. `UNKNOWN` cannot: §7.1 blocks issuance. */
export const BUYER_SNAPSHOT_VAT_STATUSES = ['VAT_REGISTERED', 'NOT_REGISTERED'] as const;

export type BuyerSnapshotVatStatus = (typeof BUYER_SNAPSHOT_VAT_STATUSES)[number];

export type BuyerSnapshotV1 = {
  snapshotSchemaVersion: 1;
  // Legacy keys, kept verbatim: an N-1 task reading a v1 snapshot must not break (§2 item 21).
  id: string | null;
  displayName: string;
  legalName: string | null;
  taxId: string | null;
  // v1 additions.
  buyerEntityKind: BuyerEntityKind;
  buyerVatStatus: BuyerSnapshotVatStatus;
  isForeign: boolean;
  /** Required when `isForeign` — a foreign buyer with no country cannot be printed. */
  country: string | null;
  /** The address block printed on the document. Not the seller's structured `addressJson`. */
  addressText: string;
  /** `'00000'` = head office, five digits for a branch. Required when VAT-registered. */
  branchCode: string | null;
};

const BUYER_SNAPSHOT_V1_KEYS = [
  'snapshotSchemaVersion',
  'id',
  'displayName',
  'legalName',
  'taxId',
  'buyerEntityKind',
  'buyerVatStatus',
  'isForeign',
  'country',
  'addressText',
  'branchCode',
] as const satisfies readonly (keyof BuyerSnapshotV1)[];

const THAI_TAX_ID_PATTERN = /^\d{13}$/;
const TAX_BRANCH_CODE_PATTERN = /^\d{5}$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Strict on purpose in both directions: a missing key is invalid (not "null by default"), and
 * an unknown key is invalid (not ignored). Anything looser lets a half-populated snapshot pass
 * the check and then print a tax invoice with a blank buyer address.
 */
export function validBuyerSnapshotV1(value: unknown): value is BuyerSnapshotV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;

  const allowed = new Set<string>(BUYER_SNAPSHOT_V1_KEYS);
  if (Object.keys(snapshot).some((key) => !allowed.has(key))) return false;
  if (BUYER_SNAPSHOT_V1_KEYS.some((key) => !(key in snapshot))) return false;

  if (snapshot.snapshotSchemaVersion !== 1) return false;
  if (!isNullableString(snapshot.id)) return false;
  if (!isNullableString(snapshot.legalName)) return false;
  if (!isNonEmptyString(snapshot.displayName)) return false;
  if (!isNonEmptyString(snapshot.addressText)) return false;
  if (typeof snapshot.isForeign !== 'boolean') return false;
  if (!isNullableString(snapshot.country)) return false;
  if (snapshot.isForeign && !isNonEmptyString(snapshot.country)) return false;
  if (!(BUYER_ENTITY_KINDS as readonly string[]).includes(snapshot.buyerEntityKind as string)) return false;
  if (!(BUYER_SNAPSHOT_VAT_STATUSES as readonly string[]).includes(snapshot.buyerVatStatus as string)) return false;
  if (!isNullableString(snapshot.taxId)) return false;
  if (!isNullableString(snapshot.branchCode)) return false;

  // ประกาศอธิบดีฯ ฉบับที่ 199 covers every registered operator, Thai or not: a foreign buyer
  // registered for Thai VAT still needs the 13-digit number and the 5-digit establishment code.
  if (snapshot.buyerVatStatus === 'VAT_REGISTERED') {
    if (!THAI_TAX_ID_PATTERN.test((snapshot.taxId as string) ?? '')) return false;
    if (!TAX_BRANCH_CODE_PATTERN.test((snapshot.branchCode as string) ?? '')) return false;
    return true;
  }

  // NOT_REGISTERED: ม.86/4 needs name + address only, so the tax fields may be null — but a
  // present value still has to be well-formed, or the document prints a malformed number.
  if (snapshot.taxId !== null && !THAI_TAX_ID_PATTERN.test(snapshot.taxId as string)) return false;
  if (snapshot.branchCode !== null && !TAX_BRANCH_CODE_PATTERN.test(snapshot.branchCode as string)) return false;
  return true;
}
