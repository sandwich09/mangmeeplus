// P10 Flow B — public auto-register + admin review queue contracts.
// Spec: docs/specs/mangmee-external-signup-contract-spec-th.md (amendment v2 2026-08-30).

/** Offer catalog 2026-08-30 (Billing §8). Only PRO_TRIAL is selectable at signup. */
export type SignupOfferKey = 'PRO_TRIAL' | 'STARTER_249' | 'BASIC_499' | 'PRO_999' | 'ENTERPRISE_1999';

export type PublicCompanySignupBody = {
  /** Client-minted UUID, reused verbatim on retry (idempotency key). */
  externalSignupId: string;
  companyName: string;
  ownerFirstName: string;
  ownerLastName: string;
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
  /**
   * True when this request's contact email already belongs to a user. Boolean only — the page
   * already shows the masked address and learns nothing new about the account. Without it the page
   * offered a "set a password" form that `setPassword` refuses outright for a duplicate email.
   */
  emailMatchesExistingUser?: boolean;
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
  /** P10-L: absent on a `line-oa` application — that flow never asks for an address (spec §5). */
  contactEmail?: string;
  /** 'official-site' (Flow B) or 'line-oa' (P10-L). Absent reads as the legacy web form. */
  source?: string;
  /** LINE profile name at submit time. No picture is ever stored (DATA-MIN-01). */
  lineDisplayName?: string;
  /** True when AUTO_FREE approved this without an admin; the row is here for after-the-fact review. */
  autoApproved?: boolean;
  /**
   * A PROVISIONING row nobody is working on any more (the process holding the fence died). Decided
   * server-side against the same clock the fence uses, so the queue and the fence cannot disagree.
   */
  staleProvisioning?: boolean;
  legalAcceptedAt?: string;
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
  /** Idempotency: repeat with same requestId is a no-op returning current state.
   *  SUSPEND (P10-L §8) stops an auto-approved application an admin does not want to keep. */
  action: 'APPROVE' | 'REJECT' | 'SUSPEND';
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

// ── P10-L LINE-first signup (spec docs/specs/mangmee-line-first-signup-spec-th.md) ──

/**
 * The clickwrap evidence the LIFF page echoes back with the form. Every value is re-checked
 * against the CURRENT release server-side before it is stored — the client cannot choose which
 * legal text it agreed to (LEGAL-LIFF-01). `acceptedAt` is the server's clock, never the client's.
 */
export type LineSignupLegalEvidenceDto = {
  documentVersion: string;
  statementSha256: string;
  releaseFingerprintSha256: string;
  displayChallenge: string;
  locale: string;
};

export type LineSignupSubmitDto = {
  /** LIFF ID token. The ONLY identity input; the profile the client shows is never trusted. */
  idToken: string;
  companyName: string;
  /** Thai mobile, 10 digits starting 0. Optional by design (spec §3.2). */
  phoneNumber?: string;
  referralCode?: string;
  legal: LineSignupLegalEvidenceDto;
};

export type LineSignupSubmitAcceptedDto = {
  requestId: string;
  state: string;
  /** True when this LINE account already belongs to an active user — the shop becomes their 2nd. */
  existingAccount: boolean;
  /** Asia/Bangkok business hours right now; decides which waiting message the client shows. */
  businessHours: boolean;
};

export type LineSignupStatusDto = {
  requestId: string;
  state: string;
  companyName: string;
  businessHours: boolean;
  /** Set once the shop exists, so the LIFF page can send the owner straight into it. */
  companyId?: string;
} | null;

export type PackageChangeRequestStatus = 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type PackageChangeRequestDto = {
  id: string;
  companyId: string;
  requestedTierKey: string;
  status: PackageChangeRequestStatus;
  note?: string;
  createdAt: string;
  decidedAt?: string;
};
