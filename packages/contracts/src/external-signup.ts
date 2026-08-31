// P10 Flow B — public auto-register + admin review queue contracts.
// Spec: docs/specs/mangmee-external-signup-contract-spec-th.md (amendment v2 2026-08-30).

/** Offer catalog 2026-08-30 (Billing §8). Only PRO_TRIAL is selectable at signup. */
export type SignupOfferKey = 'PRO_TRIAL' | 'STARTER_249' | 'BASIC_499' | 'PRO_999' | 'ENTERPRISE_1999';

export type PublicCompanySignupBody = {
  /** Client-minted UUID, reused verbatim on retry (idempotency key). */
  externalSignupId: string;
  companyName: string;
  ownerDisplayName: string;
  contactEmail: string;
  phoneNumber?: string;
  businessType?: string;
  vatRegistered?: boolean;
  taxId?: string;
  consentVersion: string;
  referralCode?: string;
  requestedOfferKey?: SignupOfferKey;
};

export type PublicCompanySignupAcceptedDto = { requestId: string };

/** Coarse public states — never expose internal review detail. */
export type PublicSignupStatusKey =
  | 'CHECKING'        // RECEIVED/VALIDATED
  | 'PENDING_REVIEW'  // waiting for admin
  | 'AWAITING_CLAIM'  // approved, claim email sent (EMAIL_PENDING)
  | 'READY'           // provisioned (EMAIL_VERIFIED..COMPLETED)
  | 'REJECTED'
  | 'EXPIRED';

export type PublicSignupStatusDto = {
  requestId: string;
  status: PublicSignupStatusKey;
  /** True when the applicant may request a fresh claim email (AWAITING_CLAIM or revivable EXPIRED within the self-serve window). */
  canResendClaim: boolean;
};

export type SignupClaimInfoDto = {
  /** Token valid and unused. */
  valid: boolean;
  companyName?: string;
  /** Masked, e.g. "so***@gmail.com" — full address never returned to an unauthenticated page. */
  maskedEmail?: string;
  suggestedUsername?: string;
  expiresAt?: string;
};

export type SignupClaimSetPasswordBody = {
  token: string;
  username: string;
  password: string;
};

export type SignupClaimAttachBody = {
  token: string;
  /** Existing-account login inside the claim page. */
  identifier: string;
  password: string;
};

export type SignupClaimResultDto = {
  companyId: string;
  companyName: string;
  /** Where the success page sends the user next. */
  homePath: string;
  attachedToExistingUser: boolean;
};

// ── Admin review queue (System Admin only) ──

export type AdminSignupQueueItemDto = {
  requestId: string;
  state: string;
  companyName: string;
  ownerDisplayName: string;
  contactEmail: string;
  phoneNumber?: string;
  businessType?: string;
  vatRegistered?: boolean;
  taxId?: string;
  requestedOfferKey?: string;
  mxValid?: boolean;
  createdAt: string;
  approvedAt?: string;
  claimEmailLastSentAt?: string;
  /** Dedupe hints — booleans/labels only, decided at claim time per spec §4C. */
  emailMatchesExistingUser: boolean;
  taxIdMatchesCompanyName?: string;
  daysSinceApproval?: number;
  emailDeliveryFailed: boolean;
};

export type AdminSignupQueueDto = { items: AdminSignupQueueItemDto[] };

/** Bounded because the admin's paragraph travels through the outbox and into an inbox. */
export const SIGNUP_REJECTION_REASON_MAX_LENGTH = 500;

export type AdminSignupDecisionBody = {
  /** Idempotency: repeat with same requestId is a no-op returning current state. */
  action: 'APPROVE' | 'REJECT';
  /** REJECT only: send a notice email (default silent). */
  notifyApplicant?: boolean;
  /**
   * REJECT only, and only meaningful with `notifyApplicant`. The admin's own paragraph for the
   * applicant to read — plain text, bounded. The internal review reason is never disclosed.
   */
  rejectionReason?: string;
};

export type AdminSignupDecisionDto = { requestId: string; state: string };

export type AdminSignupReissueDto = { requestId: string; state: string; claimEmailQueued: boolean };
