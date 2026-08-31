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

export function canTransitionCompanySignup(from: CompanySignupState, to: CompanySignupState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isCompanySignupFailureState(state: CompanySignupState): boolean {
  return state === 'EMAIL_FAILED' || state === 'PROVISIONING_FAILED' || state === 'SUSPENDED' || state === 'EXPIRED';
}
