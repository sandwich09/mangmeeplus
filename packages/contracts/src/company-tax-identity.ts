// Company tax identity ("Step 0") — shared vocabulary for the API and the wizard.
// Authority: docs/specs/company-tax-identity-setup-spec.md (v2.9). Section numbers below
// point at it; this file carries no rule the spec does not state.
//
// Every `as const` array here is mirrored by a Prisma enum of the derived name and is checked
// by prisma-enum-parity.spec.ts. Adding a value in one place and not the other fails that spec.
import type { BuyerSnapshotV1 } from './buyer-snapshot-v1.js';
import type { CivilDate } from './civil-date.js';
import type { CompanyBusinessType } from './company-business-type.js';

// ─── Enum mirrors (§4.1) ─────────────────────────────────────────────────────

/** Why the company's legal identity became authoritative. All three imply real evidence. */
export const LEGAL_IDENTITY_AUTHORITY_REASONS = ['TIN_VERIFIED', 'VAT_MATCHED', 'TAX_DOCUMENT_ISSUED'] as const;
export type LegalIdentityAuthorityReason = (typeof LEGAL_IDENTITY_AUTHORITY_REASONS)[number];

export const TIN_EXISTENCE_STATUSES = ['VERIFIED', 'NOT_FOUND'] as const;
export type TinExistenceStatus = (typeof TIN_EXISTENCE_STATUSES)[number];

export const VAT_DETAIL_STATUSES = ['MATCHED', 'NOT_FOUND', 'MISMATCH'] as const;
export type VatDetailStatus = (typeof VAT_DETAIL_STATUSES)[number];

/**
 * Last *attempt*, which is not the last *success*: `SERVICE_UNAVAILABLE` records that the RD
 * call failed without overwriting an earlier `VERIFIED` (§9).
 */
export const VERIFICATION_ATTEMPT_STATUSES = ['VERIFIED', 'NOT_FOUND', 'MISMATCH', 'SERVICE_UNAVAILABLE'] as const;
export type VerificationAttemptStatus = (typeof VERIFICATION_ATTEMPT_STATUSES)[number];

/**
 * `INITIAL_CAPTURE` is bound to the capture window, not to version 0 — the wizard saves each
 * step, so the version has already moved by step 2 (§4.3(1)).
 * `RECONCILIATION_CORRECTION` is reachable only through the §16 resolver/repair routes.
 */
export const LEGAL_IDENTITY_CHANGE_KINDS = [
  'INITIAL_CAPTURE',
  'CORRECTION',
  'LEGAL_CHANGE',
  'RECONCILIATION_CORRECTION',
] as const;
export type LegalIdentityChangeKind = (typeof LEGAL_IDENTITY_CHANGE_KINDS)[number];

/** The change kinds a user-facing PATCH may send. The resolver kind is deliberately absent. */
export const USER_LEGAL_IDENTITY_CHANGE_KINDS = ['INITIAL_CAPTURE', 'CORRECTION', 'LEGAL_CHANGE'] as const;
export type UserLegalIdentityChangeKind = (typeof USER_LEGAL_IDENTITY_CHANGE_KINDS)[number];

export const LEGAL_IDENTITY_CORRECTION_REASONS = ['TYPO', 'FORMATTING', 'TRANSLITERATION'] as const;
export type LegalIdentityCorrectionReason = (typeof LEGAL_IDENTITY_CORRECTION_REASONS)[number];

export const BUYER_ENTITY_KINDS = ['JURISTIC', 'INDIVIDUAL'] as const;
export type BuyerEntityKind = (typeof BUYER_ENTITY_KINDS)[number];

/** `UNKNOWN` is a real stored state: it blocks tax-invoice issuance until someone confirms (§7.1). */
export const BUYER_VAT_STATUSES = ['VAT_REGISTERED', 'NOT_REGISTERED', 'UNKNOWN'] as const;
export type BuyerVatStatus = (typeof BUYER_VAT_STATUSES)[number];

export const VAT_FACT_SOURCES = ['LEGACY_SEED', 'USER_ANSWER', 'RD_VERIFIED', 'RECONCILIATION'] as const;
export type VatFactSource = (typeof VAT_FACT_SOURCES)[number];

/** A VAT *fact* is binary. The tri-state below is what an accessor answers, not what is stored. */
export const VAT_FACT_STATUSES = ['REGISTERED', 'NOT_REGISTERED'] as const;
export type VatFactStatus = (typeof VAT_FACT_STATUSES)[number];

export const RECONCILIATION_KINDS = ['TAX_ID', 'BRANCH_DUP', 'VAT_HINT'] as const;
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

export const RECONCILIATION_SOURCE_STATES = ['ALIGNED', 'PENDING_ONE_SIDED', 'PENDING_CONFLICT'] as const;
export type ReconciliationSourceState = (typeof RECONCILIATION_SOURCE_STATES)[number];

export const RECONCILIATION_STATUSES = ['PENDING', 'RESOLVED'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const BUYER_EVIDENCE_CHANGE_KINDS = ['INITIAL_REMEDIATION', 'DATA_CORRECTION'] as const;
export type BuyerEvidenceChangeKind = (typeof BUYER_EVIDENCE_CHANGE_KINDS)[number];

// ─── Identity (§4) ───────────────────────────────────────────────────────────

/** The only accepted shape of `Company.addressJson`. The server rejects any other key (§4.1). */
export type CompanyLegalAddress = {
  line1: string;
  line2?: string | null;
  subdistrict: string;
  district: string;
  province: string;
  /** Five digits. */
  postalCode: string;
};

export const COMPANY_LEGAL_ADDRESS_KEYS = [
  'line1',
  'line2',
  'subdistrict',
  'district',
  'province',
  'postalCode',
] as const satisfies readonly (keyof CompanyLegalAddress)[];

/**
 * BUG-1: the one-line address a document prints — "เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"
 * in `COMPANY_LEGAL_ADDRESS_KEYS` order, blanks skipped. The 50 ทวิ handoff printed
 * `JSON.stringify(company.addressJson)` instead, so the payer address on the prefill read
 * `{"line1":"…"}`.
 *
 * `Company.addressJson` is a Json column that also holds rows written before §4.1 fixed the shape,
 * so anything that is not this shape degrades to null here rather than throwing: an unprintable
 * address must not stop a certificate being issued.
 */
export function formatCompanyLegalAddress(addr: CompanyLegalAddress | null | undefined): string | null {
  if (!addr || typeof addr !== 'object' || Array.isArray(addr)) return null;
  const row = addr as Record<string, unknown>;
  const parts = COMPANY_LEGAL_ADDRESS_KEYS
    .map((key) => (typeof row[key] === 'string' ? row[key].trim() : ''))
    .filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

const BANGKOK_PROVINCE = /^(กรุงเทพมหานคร|กรุงเทพฯ?|กทม\.?)$/u;

/**
 * The address as a printed tax document words it (owner 2026-10-12): the sub-district and
 * district carry their words — "แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110" in Bangkok,
 * "ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200" elsewhere — because a bare
 * "คลองเตย คลองเตย" does not say which part is which. A part that already carries its own word
 * is left alone. `formatCompanyLegalAddress` stays the bare form: comparisons against addresses
 * printed by other parties use it and must not change.
 */
export function formatCompanyLegalAddressForPrint(addr: CompanyLegalAddress | null | undefined): string | null {
  if (!formatCompanyLegalAddress(addr)) return null;
  const row = addr as Record<string, unknown>;
  const part = (key: keyof CompanyLegalAddress) => (typeof row[key] === 'string' ? (row[key] as string).trim() : '');
  const worded = (value: string, word: string, already: RegExp) => (!value || already.test(value) ? value : `${word}${value}`);
  const province = part('province');
  const bangkok = BANGKOK_PROVINCE.test(province);
  return [
    part('line1'), part('line2'),
    worded(part('subdistrict'), bangkok ? 'แขวง' : 'ตำบล', /^(แขวง|ตำบล|ต\.)/u),
    worded(part('district'), bangkok ? 'เขต' : 'อำเภอ', /^(เขต|อำเภอ|อ\.)/u),
    bangkok ? province : worded(province, 'จังหวัด', /^(จังหวัด|จ\.)/u),
    part('postalCode'),
  ].filter(Boolean).join(' ');
}

/** Thai 13-digit tax number check digit. A failed check is a warning only; callers decide how to present it. */
export function thaiTaxIdChecksumValid(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(value[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}

/**
 * Carried by `GET …/identity` for every holder of `company.setup.read` (§4.4). It holds no
 * identity value, only the control state the wizard needs: the CAS token it must echo back and
 * the booleans that decide which `changeKind` it may offer. Without this block the wizard would
 * have to guess, and every guess the server rejects is an `identity_change_kind_not_allowed`
 * shown to a user who did nothing wrong.
 */
export type CompanyIdentityControl = {
  legalIdentityVersion: number;
  captureWindowOpen: boolean;
  authoritativeLatched: boolean;
  fieldLatched: { registeredName: boolean; addressJson: boolean };
};

/** What `company.setup.read` alone sees: last four of the tax id, province only. */
export type MaskedCompanyIdentity = {
  masked: true;
  displayName: string;
  registeredName: string | null;
  taxIdLast4: string | null;
  addressProvince: string | null;
};

/** What `company.legal_identity.read` adds. */
export type FullCompanyIdentity = {
  masked: false;
  /** Self-reported activity, independent of legal tax evidence and the onboarding category. */
  businessType?: CompanyBusinessType;
  displayName: string;
  registeredName: string | null;
  taxId: string | null;
  addressJson: CompanyLegalAddress | null;
  lastLegalChangeEffectiveDate: CivilDate | null;
  legalIdentityAuthoritativeAt: string | null;
  legalIdentityAuthoritativeReason: LegalIdentityAuthorityReason | null;
  legalIdentityAuthoritativeRef: string | null;
  tinExistsStatus: TinExistenceStatus | null;
  tinExistsAt: string | null;
  vatDetailStatus: VatDetailStatus | null;
  vatDetailAt: string | null;
  vatDetailSelectedBranchCode: string | null;
  verificationLastAttemptStatus: VerificationAttemptStatus | null;
  verificationLastAttemptAt: string | null;
};

export type CompanyIdentityView = MaskedCompanyIdentity | FullCompanyIdentity;

export type CompanyEstablishmentView = {
  branchId: string;
  name: string;
  isVatEstablishment: boolean;
  taxBranchCode: string | null;
  hasOwnAddress: boolean;
  isHeadOffice: boolean;
  isActive: boolean;
};

/**
 * Readiness is assembled per permission, and a section the caller may not see is ABSENT — not
 * `null`, not `{}`. `readiness.vat` missing means "you cannot see this"; `readiness.vat.eligible
 * === false` means "this company cannot issue". Step 5 of the wizard renders them differently
 * (§11), so collapsing them into one value would tell a permission-less user their company is
 * not allowed to issue tax invoices, which nobody has established.
 */
export type CompanyIdentityReadiness = {
  identity?: { complete: boolean; reasons: string[] };
  vat?: { eligible: boolean; status: VatRegistrationStatus };
  branches?: { headOfficeReady: boolean; incompleteEstablishmentBranchIds: string[] };
};

export type CompanyIdentityResponse = {
  control: CompanyIdentityControl;
  identity?: CompanyIdentityView;
  vatRegistration?: VatRegistrationView;
  branches?: CompanyEstablishmentView[];
  readiness: CompanyIdentityReadiness;
};

export type PatchCompanyIdentityRequest = {
  /** CAS. Stale → 409, no dedicated error code. */
  expectedLegalIdentityVersion: number;
  changeKind: UserLegalIdentityChangeKind;
  /** Shop name on the web; required and trimmed when supplied, same 200-character signup limit. */
  displayName?: string;
  registeredName?: string;
  taxId?: string;
  addressJson?: CompanyLegalAddress;
  /** Required for `LEGAL_CHANGE`; must be monotonic and not in the future (§4.3(2)). */
  effectiveFrom?: CivilDate;
  correctionReason?: LegalIdentityCorrectionReason;
  note?: string;
  evidenceRef?: string;
};

/** Returned so the wizard can save the next step without a refetch (§4.4). */
export type PatchCompanyIdentityResult = { legalIdentityVersion: number; revisionId: string };

export type CompleteCaptureRequest = { expectedLegalIdentityVersion: number };

/** Same body whether the window was just closed or was already closed (idempotent 200). */
export type CompleteCaptureResult = { legalIdentityVersion: number; captureWindowOpen: false };

// ─── VAT registration (§5) ───────────────────────────────────────────────────

/** What the accessor answers. `UNKNOWN` = no fact covers the date asked about. */
export type VatRegistrationStatus = VatFactStatus | 'UNKNOWN';

export type VatRegistrationView = {
  status: VatRegistrationStatus;
  effectiveFrom?: CivilDate;
  effectiveTo?: CivilDate;
  version: number;
  /** Deprecated tuple kept for the pre-CC4 wire. `vatRegistered` is a stored bit and may lag. */
  vatRegistered: boolean;
  vatEffectiveDate: CivilDate | null;
};

/**
 * Discriminated by `kind`. `CANCEL_FUTURE` deliberately has no `status`/`effectiveFrom`: the
 * API's ValidationPipe is `forbidNonWhitelisted`, so sending them is rejected rather than ignored.
 */
export type PutVatRegistrationCommand =
  | { kind: 'UPSERT_FACT'; status: VatFactStatus; effectiveFrom: CivilDate; replaceFactId?: string }
  | { kind: 'CANCEL_FUTURE'; replaceFactId: string };

export type PutVatRegistrationRequest = {
  /** ≤64 chars, client-stable per intent. The payload fingerprint is computed server-side. */
  commandId: string;
  expectedVersion: number;
  command: PutVatRegistrationCommand;
};

export const VAT_REGISTRATION_PROMPT_ANSWERS = ['REGISTERED', 'NOT_REGISTERED', 'UNSURE'] as const;
export type VatRegistrationPromptAnswer = (typeof VAT_REGISTRATION_PROMPT_ANSWERS)[number];

// ─── Documents: buyer + seller + issue (§6–§8) ───────────────────────────────

/** Per-document override of the buyer identity, ahead of the counterparty master (§7.2). */
export type BuyerTaxIdentityDraft = {
  buyerEntityKind: BuyerEntityKind;
  buyerVatStatus: BuyerVatStatus;
  isForeign?: boolean;
  country?: string | null;
  name?: string | null;
  taxId?: string | null;
  branchCode?: string | null;
  addressText?: string | null;
};

/** The only two fields `PATCH …/documents/:documentId` accepts (§7.2). */
export type PatchAccountingDocumentRequest = {
  /** CAS against `doc.updatedAt`. */
  expectedUpdatedAt: string;
  buyerTaxIdentityDraft?: BuyerTaxIdentityDraft | null;
  sellerEstablishmentBranchId?: string | null;
};

export type CreateBuyerEvidenceRevisionRequest = {
  commandId: string;
  expectedCurrentRevision: number;
  changeKind: BuyerEvidenceChangeKind;
  buyerSnapshot: BuyerSnapshotV1;
  evidenceRef: string;
  /** Required when `DATA_CORRECTION`. */
  note?: string;
};

export type BuyerEvidenceRevisionView = {
  revision: number;
  changeKind: BuyerEvidenceChangeKind;
  evidenceRef: string;
  note: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  buyerSnapshot: BuyerSnapshotV1;
};

/** Preferred issue body from Release A onward. The legacy `{}` body stays accepted until B2. */
export type IssueAccountingDocumentRequestV2 = {
  /** ≤64 chars, stable for one issuing intent — the replay key. */
  commandId: string;
  /** CAS against `doc.updatedAt`, and part of the intent fingerprint. */
  expectedUpdatedAt: string;
  sellerEstablishmentBranchId?: string;
};

/**
 * ONE success shape for both the fresh issue and the replay of an already-completed one. The
 * document stays at the top level so a pre-existing caller keeps reading `status` and
 * `documentNumber` off it; `replayed` is the only addition. Returning a smaller object on
 * replay would break exactly the callers that retried because they never saw the first answer.
 */
export type IssueAccountingDocumentResult<TDocument> = TDocument & { replayed: boolean };

// ─── Errors (§13) ────────────────────────────────────────────────────────────

/**
 * The complete set this feature introduces. Missing permission is 403 and CAS conflict is 409;
 * neither gets a code. `counterparty_anchor_mismatch` is a `details.reason` on
 * `buyer_tax_identity_incomplete`, not a sixteenth code.
 */
export const COMPANY_TAX_IDENTITY_ERROR_CODES = [
  'company_tax_identity_incomplete',
  'vat_registration_required',
  'document_branch_not_tax_establishment',
  'document_branch_required',
  'buyer_tax_identity_incomplete',
  'buyer_vat_status_confirmation_required',
  'document_backdated_across_identity_revision',
  'vat_deregistered_correction_requires_authority',
  'vat_registration_future_fact_conflict',
  'vat_registration_backdated_crosses_filed_period',
  'vat_registration_contract_upgrade_required',
  'tin_verification_unavailable',
  'issue_command_conflict',
  'branch_tax_code_duplicate',
  'identity_change_kind_not_allowed',
] as const;
export type CompanyTaxIdentityErrorCode = (typeof COMPANY_TAX_IDENTITY_ERROR_CODES)[number];
