import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { normalizeTaxId } from '../../data-model-core/domain/logic/company-legal-identity.logic';

export const COMPANY_SIGNUP_STATES = [
  'RECEIVED', 'VALIDATED', 'EMAIL_PENDING', 'EMAIL_VERIFIED', 'PROVISIONING', 'READY',
  'LINE_LINK_PENDING', 'COMPLETED', 'EMAIL_FAILED', 'PROVISIONING_FAILED', 'SUSPENDED', 'EXPIRED',
] as const;

export type CompanySignupState = (typeof COMPANY_SIGNUP_STATES)[number];

export type CompanySignupInput = Readonly<{
  externalSignupId: string;
  companyName: string;
  taxId?: string;
  ownerDisplayName: string;
  contactEmail: string;
  consentVersion: string;
  referralCode?: string;
  requestedOfferKey?: string;
}>;

export type NormalizedCompanySignupInput = Readonly<{
  externalSignupId: string;
  companyName: string;
  taxId: string | null;
  ownerDisplayName: string;
  contactEmail: string;
  consentVersion: string;
  referralCode: string | null;
  requestedOfferKey: string | null;
}>;

const TRANSITIONS: Readonly<Record<CompanySignupState, readonly CompanySignupState[]>> = {
  RECEIVED: ['VALIDATED', 'SUSPENDED'],
  VALIDATED: ['EMAIL_PENDING', 'SUSPENDED'],
  EMAIL_PENDING: ['EMAIL_VERIFIED', 'EMAIL_FAILED', 'SUSPENDED', 'EXPIRED'],
  EMAIL_FAILED: ['EMAIL_PENDING', 'SUSPENDED', 'EXPIRED'],
  EMAIL_VERIFIED: ['PROVISIONING', 'SUSPENDED'],
  PROVISIONING: ['READY', 'PROVISIONING_FAILED', 'SUSPENDED'],
  PROVISIONING_FAILED: ['PROVISIONING', 'SUSPENDED'],
  READY: ['LINE_LINK_PENDING', 'SUSPENDED'],
  LINE_LINK_PENDING: ['COMPLETED', 'SUSPENDED'],
  COMPLETED: [],
  SUSPENDED: [],
  EXPIRED: [],
};

function bounded(value: string, field: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(`invalid_${field}`);
  return normalized;
}

export function normalizeCompanySignupInput(input: CompanySignupInput): NormalizedCompanySignupInput {
  const rawTaxId = input.taxId?.trim();
  const taxId = rawTaxId ? normalizeTaxId(rawTaxId) : null;
  if (taxId !== null && !/^\d{13}$/.test(taxId)) throw new Error('invalid_taxId');
  const contactEmail = bounded(input.contactEmail, 'contactEmail', 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('invalid_contactEmail');

  return {
    externalSignupId: bounded(input.externalSignupId, 'externalSignupId', 128),
    companyName: bounded(input.companyName, 'companyName', 200),
    taxId,
    ownerDisplayName: bounded(input.ownerDisplayName, 'ownerDisplayName', 160),
    contactEmail,
    consentVersion: bounded(input.consentVersion, 'consentVersion', 64),
    referralCode: input.referralCode?.trim() ? bounded(input.referralCode, 'referralCode', 128) : null,
    requestedOfferKey: input.requestedOfferKey?.trim() ? bounded(input.requestedOfferKey, 'requestedOfferKey', 128) : null,
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
