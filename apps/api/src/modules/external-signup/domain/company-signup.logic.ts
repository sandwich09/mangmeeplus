import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { normalizeTaxId } from '../../data-model-core/domain/logic/company-legal-identity.logic';

export const COMPANY_SIGNUP_STATES = [
  'RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'EMAIL_PENDING', 'EMAIL_VERIFIED', 'PROVISIONING', 'READY',
  'LINE_LINK_PENDING', 'COMPLETED', 'EMAIL_FAILED', 'PROVISIONING_FAILED', 'SUSPENDED', 'EXPIRED', 'REJECTED',
] as const;

export type CompanySignupState = (typeof COMPANY_SIGNUP_STATES)[number];

/** Spec §3A: the form shows four tiers but only the PRO trial is selectable server-side. */
export const SELECTABLE_SIGNUP_OFFER_KEYS: readonly string[] = ['PRO_TRIAL'];

export type CompanySignupInput = Readonly<{
  externalSignupId: string;
  companyName: string;
  taxId?: string;
  ownerFirstName: string;
  ownerLastName: string;
  contactEmail: string;
  consentVersion: string;
  referralCode?: string;
  requestedOfferKey?: string;
  businessType?: string;
  phoneNumber?: string;
  vatRegistered?: boolean;
}>;

export type NormalizedCompanySignupInput = Readonly<{
  externalSignupId: string;
  companyName: string;
  taxId: string | null;
  ownerFirstName: string;
  ownerLastName: string;
  ownerDisplayName: string;
  contactEmail: string;
  consentVersion: string;
  referralCode: string | null;
  requestedOfferKey: string | null;
  businessType: string | null;
  phoneNumber: string | null;
  vatRegistered: boolean | null;
}>;

// Flow B (spec §4): review comes before the single claim email, so VALIDATED can only reach
// EMAIL_PENDING through PENDING_REVIEW — the admin gate is unskippable by construction (SIGNUP-02).
// EXPIRED keeps one way out: spec §4D ④ "no dead end" — an admin may reissue a claim link at any age.
const TRANSITIONS: Readonly<Record<CompanySignupState, readonly CompanySignupState[]>> = {
  RECEIVED: ['VALIDATED', 'SUSPENDED'],
  VALIDATED: ['PENDING_REVIEW', 'SUSPENDED'],
  PENDING_REVIEW: ['EMAIL_PENDING', 'REJECTED', 'SUSPENDED'],
  EMAIL_PENDING: ['EMAIL_VERIFIED', 'EMAIL_FAILED', 'SUSPENDED', 'EXPIRED'],
  EMAIL_FAILED: ['EMAIL_PENDING', 'SUSPENDED', 'EXPIRED'],
  EMAIL_VERIFIED: ['PROVISIONING', 'SUSPENDED'],
  PROVISIONING: ['READY', 'PROVISIONING_FAILED', 'SUSPENDED'],
  PROVISIONING_FAILED: ['PROVISIONING', 'SUSPENDED'],
  READY: ['LINE_LINK_PENDING', 'SUSPENDED'],
  LINE_LINK_PENDING: ['COMPLETED', 'SUSPENDED'],
  COMPLETED: [],
  SUSPENDED: [],
  EXPIRED: ['EMAIL_PENDING'],
  REJECTED: [],
};

export const SIGNUP_SOURCE_OFFICIAL_SITE = 'official-site';
export const SIGNUP_SOURCE_LINE_OA = 'line-oa';

/**
 * Review B-05: "one open application per LINE account", enforced by the partial unique index in
 * `migrations/20260904120000_line_first_signup/migration.sql`. This list and that index's WHERE
 * clause MUST agree — a spec asserts they do — because a state missing from the index is a state
 * in which a re-submit silently opens a SECOND application, and for a row whose provisioning half
 * committed (the ExternalIdentity exists) that means a SECOND company through the attach path.
 * PROVISIONING_FAILED and READY are in the set for exactly that reason: both are states in which
 * the shop may already exist and the application has not settled. Only COMPLETED, REJECTED and
 * SUSPENDED free the LINE account to apply again.
 */
/**
 * How long a PROVISIONING row may sit untouched before another caller may take the fence from it.
 *
 * The onboarding transaction is capped at 15s (`create-company-onboarding.use-case.ts`), but that
 * is only the middle of the run: provisioning then applies trial guards, a VAT update, the fence
 * completion, an audit transaction and a final advance, each its own round trip, and a cold start
 * pays for all of it at once. 90s left no real margin over that tail. Three minutes is still far
 * shorter than a working day, which is what the alternative — no recovery at all — used to cost.
 */
export const STALE_PROVISIONING_MS = 180_000;

/**
 * "Nobody is actually holding this fence." Nothing releases it when the process holding it dies
 * (an ECS task replaced mid-transaction, a transaction that timed out) and there is no sweep, so
 * without this a row sits at PROVISIONING forever.
 *
 * Shared on purpose: the fence and the admin queue MUST agree on what abandoned means, or one of
 * them offers a recovery the other refuses — which is exactly how the first version of this shipped
 * as unreachable code.
 */
export function isStaleProvisioning(
  request: { state: string; provisioningStartedAt: Date | null },
  now: Date,
): boolean {
  return request.state === 'PROVISIONING'
    && request.provisioningStartedAt !== null
    && now.getTime() - request.provisioningStartedAt.getTime() > STALE_PROVISIONING_MS;
}

export const LINE_OPEN_APPLICATION_STATES: readonly CompanySignupState[] = [
  'RECEIVED', 'VALIDATED', 'PENDING_REVIEW', 'PROVISIONING', 'PROVISIONING_FAILED', 'READY',
];

// P10-L §5. The LINE source proves a real person with a server-verified LIFF ID token instead of a
// mailbox, so it has NO EMAIL_* edge at all — SIGNUP-02 is satisfied by the token, and an EMAIL_*
// state here could only mean a bug that mailed a shop with no address. AUTO_FREE is the extra
// VALIDATED → PROVISIONING edge; COMPLETED → SUSPENDED is how an admin stops an auto-approved shop
// after the fact (§3.7). LINE_LINK_PENDING is skipped: the identity is linked inside provisioning.
const LINE_OA_TRANSITIONS: Readonly<Record<CompanySignupState, readonly CompanySignupState[]>> = {
  RECEIVED: ['VALIDATED', 'SUSPENDED'],
  VALIDATED: ['PENDING_REVIEW', 'PROVISIONING', 'SUSPENDED'],
  PENDING_REVIEW: ['PROVISIONING', 'REJECTED', 'SUSPENDED'],
  EMAIL_PENDING: [],
  EMAIL_FAILED: [],
  EMAIL_VERIFIED: [],
  PROVISIONING: ['READY', 'PROVISIONING_FAILED', 'SUSPENDED'],
  PROVISIONING_FAILED: ['PROVISIONING', 'SUSPENDED'],
  READY: ['COMPLETED', 'SUSPENDED'],
  LINE_LINK_PENDING: [],
  COMPLETED: ['SUSPENDED'],
  SUSPENDED: [],
  EXPIRED: [],
  REJECTED: [],
};

const PHONE_PATTERN = /^[0-9+\-() ]{6,20}$/;

function bounded(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid_${field}`);
  return normalized;
}

function optional(value: string | undefined, field: string, max: number): string | null {
  return value?.trim() ? bounded(value, field, max) : null;
}

export function normalizeCompanySignupInput(input: CompanySignupInput): NormalizedCompanySignupInput {
  const rawTaxId = input.taxId?.trim();
  const taxId = rawTaxId ? normalizeTaxId(rawTaxId) : null;
  if (taxId !== null && !/^\d{13}$/.test(taxId)) throw new Error('invalid_taxId');
  const contactEmail = bounded(input.contactEmail, 'contactEmail', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('invalid_contactEmail');

  const phoneNumber = optional(input.phoneNumber, 'phoneNumber', 20);
  if (phoneNumber !== null && !PHONE_PATTERN.test(phoneNumber)) throw new Error('invalid_phoneNumber');

  // Spec §3A: an unknown or not-yet-sellable offer key is rejected outright — never a silent
  // fallback to the trial, because the key is attribution evidence the Owner reads later.
  const requestedOfferKey = optional(input.requestedOfferKey, 'requestedOfferKey', 128);
  if (requestedOfferKey !== null && !SELECTABLE_SIGNUP_OFFER_KEYS.includes(requestedOfferKey)) {
    throw new Error('offer_not_available');
  }

  return {
    externalSignupId: bounded(input.externalSignupId, 'externalSignupId', 128),
    companyName: bounded(input.companyName, 'companyName', 200),
    taxId,
    ownerFirstName: bounded(input.ownerFirstName, 'ownerFirstName', 80),
    ownerLastName: bounded(input.ownerLastName, 'ownerLastName', 80),
    // Owner 2026-08-31: the form collects first and last name separately and BOTH are stored; the
    // joined display name keeps every downstream reader (queue, provisioning, emails) unchanged.
    ownerDisplayName: `${bounded(input.ownerFirstName, 'ownerFirstName', 80)} ${bounded(input.ownerLastName, 'ownerLastName', 80)}`,
    contactEmail,
    consentVersion: bounded(input.consentVersion, 'consentVersion', 64),
    referralCode: optional(input.referralCode, 'referralCode', 128),
    requestedOfferKey,
    businessType: optional(input.businessType, 'businessType', 120),
    phoneNumber,
    vatRegistered: input.vatRegistered ?? null,
  };
}

export function companySignupPayloadHash(input: NormalizedCompanySignupInput): string {
  return canonicalFingerprint(input);
}

/**
 * Which table applies is decided by the row's `source` and nothing else. An unknown source falls
 * back to the web form's table, which is the stricter of the two — a mis-tagged row can only lose
 * moves, never gain the AUTO_FREE shortcut.
 */
export function signupTransitionTable(
  source: string,
): Readonly<Record<CompanySignupState, readonly CompanySignupState[]>> {
  return source === SIGNUP_SOURCE_LINE_OA ? LINE_OA_TRANSITIONS : TRANSITIONS;
}

export function canTransitionCompanySignup(
  from: CompanySignupState,
  to: CompanySignupState,
  source: string = SIGNUP_SOURCE_OFFICIAL_SITE,
): boolean {
  return signupTransitionTable(source)[from].includes(to);
}

export function isCompanySignupFailureState(state: CompanySignupState): boolean {
  return state === 'EMAIL_FAILED' || state === 'PROVISIONING_FAILED' || state === 'SUSPENDED' || state === 'EXPIRED';
}

/**
 * What "this applicant has already had a shop" means — the repeat-trial signal, read by BOTH the
 * AUTO_FREE guard at submit and the admin queue's hint. One definition, because the two answering
 * differently would be the queue naming a shop the machine did not act on, or the reverse.
 *
 * OWNER only (review B1): an employee whose LINE was linked by the staff QR holds a membership in
 * their EMPLOYER's shop, which is not a trial they ever had.
 *
 * DRAFT excluded: that status belongs to an employee draft nobody finished — a half-filled form,
 * not a shop. Every other status counts, because a closed, suspended or disabled shop still
 * existed; onboarding creates the owner's membership ACTIVE inside the company transaction, so a
 * shop that was really opened never sits in DRAFT.
 */
export const OWNED_COMPANY_MEMBERSHIP = {
  status: { not: 'DRAFT' as const },
  roles: { some: { role: { key: 'OWNER' } } },
};
