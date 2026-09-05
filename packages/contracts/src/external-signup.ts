// P10 Flow B — public auto-register + admin review queue contracts.
// Spec: docs/specs/mangmee-external-signup-contract-spec-th.md (amendment v2 2026-08-30).

/**
 * Offer catalog 2026-08-30 (Billing §8).
 *
 * Owner 2026-09-05 (review R02): this key no longer chooses a package. Every self-signed-up shop —
 * web form and LINE alike — is provisioned on the free trial, so the key is recorded as attribution
 * only and an unrecognised value is dropped rather than refused.
 */
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
  /** Attribution only — the provisioned package is the free trial regardless of this value. */
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

/**
 * Review R01: the claim token is a bearer credential, so it travels in a POST body — never in a URL
 * segment, which every access log on the way in records verbatim.
 */
export type SignupClaimInfoBody = { token: string };

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
   * This LINE account already belongs to an active user (spec §5 `attachUserId`), so approving adds
   * a SECOND shop to that account rather than creating a new one. Decided at submit from the
   * verified ID token — a fact by then, not a hint the admin has to act on.
   */
  attachesToExistingAccount?: boolean;
  /**
   * A PROVISIONING row nobody is working on any more (the process holding the fence died). Decided
   * server-side against the same clock the fence uses, so the queue and the fence cannot disagree.
   */
  staleProvisioning?: boolean;
  /**
   * The shop this application built, once it has built one. Absent means no company exists yet —
   * which is precisely what makes an abandoned PROVISIONING row safe to suspend (plan note L-C).
   */
  companyId?: string;
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
  /**
   * Review A-01: the phone on this application already reaches a shop we opened — most often one an
   * admin set up by hand for the same person, who is now applying as if they were new. The name of
   * that shop, so the operator can call before opening a second one. A hint, never a block.
   */
  phoneMatchesCompanyName?: string;
  daysSinceApproval?: number;
  emailDeliveryFailed: boolean;
  /**
   * Owner 2026-09-05. This LINE account — or the account its identity belongs to, whatever status
   * that identity is in — has held a shop before, so the free trial being asked for is a REPEAT.
   * The shop's name, because the operator's question is "is this the same person coming back".
   * A hint, never a block: the row is still approvable.
   */
  priorCompanyName?: string;
  /** How that shop stands today: 'ACTIVE' | 'EXPIRED' (term ended) | 'CLOSED'. Web owns the Thai. */
  priorCompanyState?: string;
  /**
   * Why provisioning stopped, for the rows on the "มีปัญหา" tab. A bounded code the API already
   * stores on the request (`failureCode`), surfaced so the queue can say what an admin must fix
   * instead of showing "เปิดร้านไม่สำเร็จ" for two very different causes.
   */
  failureCode?: string;
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

/** The same row seen from the admin queue: it adds who and which shop, which the owner already knows. */
export type AdminPackageChangeItemDto = PackageChangeRequestDto & {
  companyName: string;
  /** What the shop is on today, so the operator sees the move rather than only the destination. */
  currentTierKey?: string;
  requestedByDisplayName?: string;
};

export type AdminPackageChangeQueueDto = { items: AdminPackageChangeItemDto[] };

export type AdminPackageChangeDecisionBody = {
  /** APPROVE moves the tier through the one plan-term writer; REJECT only closes the row. */
  action: 'APPROVE' | 'REJECT';
  /** Optional line for the shop, appended to the LINE notice. Bounded like every crossing paragraph. */
  note?: string;
};

export type AdminPackageChangeDecisionDto = { id: string; status: PackageChangeRequestStatus };

/** Bounded because the admin's paragraph is pushed verbatim into a customer's LINE chat (SEC-05). */
export const PARTNER_LINE_MESSAGE_MAX_LENGTH = 500;

export type PartnerLineMessageBody = { text: string };

export type PartnerLineMessageResultDto = {
  /** How many linked OWNER identities the message reached. 0 means nobody has LINE linked. */
  delivered: number;
};

// ── Support requests: "ติดต่อเจ้าหน้าที่" (line-support-request-spec-th §2.3) ──

export type SupportRequestStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

/** Why a request closed. `expired` is the sweep; the other two are a person deciding. */
export type SupportRequestClosedReason = 'admin' | 'customer_resumed' | 'expired';

/**
 * One person waiting for a human.
 *
 * §3 PDPA: NO raw LINE id crosses this contract. `askerLabel` is a shop name, or the name of the
 * shop the person applied for, and `askerRef` is the last 6 characters of the same sha256 prefix
 * the audit rail carries — enough for an operator to match two rows to one person, not enough to
 * identify anyone outside our own database.
 */
export type SupportRequestItemDto = {
  id: string;
  status: SupportRequestStatus;
  /** Shop name, or "ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: …)" — already display-ready Thai. */
  askerLabel: string;
  askerRef: string;
  /** Present once the asker holds an ACTIVE membership: the partner page opens from here. */
  companyId?: string;
  /** Present while they are still in the signup funnel: the queue opens from here instead. */
  signupRequestId?: string;
  requestedAt: string;
  /** ≤200 chars of what they last typed, when the assistant kept any. */
  lastMessageText?: string;
  /**
   * Owner 2026-09-05: admins are not LINE-linked, so `0` is the expected reading and NOT an error.
   * This page is the primary channel; these two only say which extras also went out.
   */
  lineNotifiedCount: number;
  emailSent: boolean;
  /**
   * Read this BEFORE the two counts above. `queued` means the outbox drain has not run yet, so
   * `0`/`false` are defaults rather than outcomes — without this a request rendered "nobody was
   * told" for the seconds between the tap and the drain. Only `unreachable` is a fault.
   */
  notifyState: 'queued' | 'notified' | 'unreachable';
  answeredAt?: string;
  answeredByDisplayName?: string;
  closedAt?: string;
  closedReason?: SupportRequestClosedReason;
};

export type SupportRequestQueueDto = {
  items: SupportRequestItemDto[];
  /** Always the OPEN total, whatever `status` filtered the list — it feeds the system nav badge. */
  openCount: number;
};

/**
 * Just the badge number. Its own endpoint because the system header asks for it on every
 * navigation, and answering that with a 200-row queue read is a page of rows nobody renders.
 */
export type SupportRequestCountDto = { open: number };

export type SupportRequestActionDto = {
  id: string;
  status: SupportRequestStatus;
  /** `resume-ai` only: whether a running assistant pause was actually lifted. */
  pauseCleared?: boolean;
};

/** One event on a shop's timeline (§8). Assembled from rows that already exist — no new log table. */
export type PartnerTimelineEntryDto = {
  /** Stable key the page maps to an icon/label; unknown values still render by `label`. */
  kind:
    | 'signup_submitted'
    | 'signup_approved'
    | 'legal_accepted'
    | 'first_web_entry'
    | 'first_receipt'
    | 'last_activity'
    | 'package_change'
    | 'ai_refusal';
  label: string;
  at?: string;
  detail?: string;
};

export type PartnerTimelineDto = { entries: PartnerTimelineEntryDto[] };
