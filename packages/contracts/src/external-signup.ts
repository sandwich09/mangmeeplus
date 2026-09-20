// P10 Flow B — public auto-register + admin review queue contracts.
// Spec: docs/specs/mangmee-external-signup-contract-spec-th.md (amendment v2 2026-08-30).

/** Self-reported discovery, separate from a signup rail or an influencer referral code. */
export const SIGNUP_DISCOVERY_SOURCE_OPTIONS = [
  { value: 'WEBSITE', label: 'Website' },
  { value: 'IG', label: 'IG' },
  { value: 'TIKTOK', label: 'TikTok' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'OTHER', label: 'อื่น ๆ' },
] as const;
export type SignupDiscoverySource = typeof SIGNUP_DISCOVERY_SOURCE_OPTIONS[number]['value'];
export const SIGNUP_DISCOVERY_OTHER_MAX = 200;

/** Display the same attribution in the signup queue and the company's admin profile. */
export function signupDiscoveryLabel(source?: SignupDiscoverySource | null, other?: string | null): string {
  const label = SIGNUP_DISCOVERY_SOURCE_OPTIONS.find((option) => option.value === source)?.label;
  return label ? label + (source === 'OTHER' && other ? ` — ${other}` : '') : 'ไม่ระบุ';
}

/**
 * Offer catalog 2026-08-30 (Billing §8).
 *
 * Owner 2026-09-05 (review R02): this key no longer chooses a package. Every self-signed-up shop —
 * web form and LINE alike — is provisioned on the free trial, so the key is recorded as attribution
 * only and an unrecognised value is dropped rather than refused.
 *
 * `FREE_TRIAL` is the only offer the form presents. `PRO_TRIAL` is its retired name, kept so an
 * in-flight or cached client is normalised onto the free trial rather than refused; nothing new
 * should send it. The paid keys are recorded as attribution only.
 */
export type SignupOfferKey = 'FREE_TRIAL' | 'PRO_TRIAL' | 'STARTER_249' | 'BASIC_499' | 'PRO_999' | 'ENTERPRISE_1999';

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

/**
 * Coarse public states — never expose internal review detail. Coarse is not the same as untrue:
 * R11 added the three keys below because the page was telling applicants that a shop existed, that
 * a rescue was under way, or that an email had been delivered, in states where none of that had
 * happened. A key added here needs Thai copy behind it in `apps/web`'s signup logic.
 */
export const PUBLIC_SIGNUP_STATUS_KEYS = [
  'CHECKING',         // RECEIVED/VALIDATED
  'PENDING_REVIEW',   // waiting for admin
  'AWAITING_CLAIM',   // approved, claim email sent (EMAIL_PENDING)
  'EMAIL_FAILED',     // the claim email bounced — nothing is on its way
  'PREPARING',        // mailbox proved, shop being built (EMAIL_VERIFIED/PROVISIONING)
  'PREPARING_FAILED', // the build stopped and nothing retries by itself
  'READY',            // provisioned (READY/LINE_LINK_PENDING/COMPLETED)
  'REJECTED',
  'EXPIRED',
] as const;

export type PublicSignupStatusKey = (typeof PUBLIC_SIGNUP_STATUS_KEYS)[number];

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
  discoverySource?: SignupDiscoverySource;
  discoverySourceOther?: string;
  requestId: string;
  version: number;
  state: string;
  companyName: string;
  ownerDisplayName: string;
  /** Shop contact for LINE; absent only on legacy applications that did not collect it. */
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
  /**
   * R10: what `businessType` maps to today — the stored review choice when one was made, otherwise
   * the exact-match mapping. The server owns the mapping, so the approve dialog can DEFAULT to it
   * and can tell that a row with free text answering OTHER is one the reviewer has to decide.
   */
  businessCategory?: string;
  mxValid?: boolean;
  createdAt: string;
  approvedAt?: string;
  claimEmailLastSentAt?: string;
  /** Dedupe hints — booleans/labels only, decided at claim time per spec §4C. */
  emailMatchesExistingUser: boolean;
  /** LINE submit found this address in an account, shop or earlier application; review before opening another shop. */
  emailPreviouslyUsed?: boolean;
  priorRejectedRequestId?: string;
  /** Current persisted duplicate-contact routing result for LINE; false includes safe own-contact/history exclusions. */
  contactEmailConflict?: boolean;
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
  /** Explicit LINE review outcome. PLAN_REVIEW remains actionable under PENDING_REVIEW. */
  reviewResolution?: LineSignupReviewResolution;
  /** Existing shop selected from current LINE proof; never the company created by provisioning. */
  resolvedExistingCompanyId?: string;
  /** Current proven ACTIVE shops an operator may safely return this applicant to. */
  eligibleExistingCompanies?: LineSignupEligibleCompanyDto[];
  /** @deprecated R1 (Owner 2026-09-20): no longer emitted. A second shop opens LOCKED like the
   *  first, so there is no free trial to authorize. Kept so an older console still compiles. */
  requiresRepeatTrialGrant?: boolean;
  /** @deprecated See `requiresRepeatTrialGrant`. */
  repeatTrialGranted?: boolean;
  /**
   * Why provisioning stopped, for the rows on the "มีปัญหา" tab. A bounded code the API already
   * stores on the request (`failureCode`), surfaced so the queue can say what an admin must fix
   * instead of showing "เปิดร้านไม่สำเร็จ" for two very different causes.
   */
  failureCode?: string;
};

export type AdminSignupQueueDto = {
  items: AdminSignupQueueItemDto[];
  /**
   * R13: pass back as `?cursor=` for the next page. `null`/absent means this was the last page —
   * the queue used to read 200 rows with no way past them, so a backlog simply disappeared.
   */
  nextCursor?: string | null;
  /**
   * R13: how many rows each tab holds IN THE DATABASE, keyed by tab. Counted server-side because
   * the page can only ever count what it was given, which is how a tab came to say "no
   * applications in this group" over rows that were there.
   */
  counts?: Record<string, number>;
};

/** Bounded because the admin's paragraph travels through the outbox and into an inbox. */
export const SIGNUP_REJECTION_REASON_MAX_LENGTH = 500;
export const SIGNUP_RESOLUTION_NOTE_MAX_LENGTH = 500;

export type AdminSignupDecisionBody = {
  /** Idempotency: repeat with same requestId is a no-op returning current state.
   *  SUSPEND (P10-L §8) stops an auto-approved application an admin does not want to keep. */
  action:
    | 'APPROVE'
    | 'CREATE_NEW_SHOP'
    | 'RETURN_EXISTING'
    | 'REQUEST_INFO'
    | 'RETRY_INTAKE'
    | 'REJECT'
    | 'SUSPEND';
  /** Required on LINE admin mutations so an applicant correction cannot race an old decision. */
  version?: number;
  /** RETURN_EXISTING only; the server re-proves current LINE/user/membership access before commit. */
  targetCompanyId?: string;
  /** @deprecated R1 (Owner 2026-09-20): accepted and IGNORED. Approving a repeat applicant no
   *  longer grants anything free, so it needs no authorization. Kept so an older console's
   *  payload is not rejected. */
  grantRepeatTrial?: boolean;
  /** @deprecated See `grantRepeatTrial`. */
  trialGrantNote?: string;
  /** CREATE_NEW_SHOP only; required when another person's contact data still conflicts. */
  acknowledgeSharedContact?: boolean;
  sharedContactNote?: string;
  /** REQUEST_INFO customer-facing text; internal notes on other outcomes are never public. */
  resolutionNote?: string;
  /**
   * R10, APPROVE only. `businessType` on the form is free text in the applicant's own language and
   * the PDPA health tripwire reads the CLOSED enum — "คลินิก" maps to OTHER, so the safeguard never
   * fired for the people it exists for. The reviewer who is already reading that word picks the
   * enum here; nothing guesses it, and omitting it keeps the exact-match mapping.
   * A `CompanyBusinessCategory` (company-profile.ts); the server re-checks membership.
   */
  businessCategory?: string;
  /** REJECT only: send a notice email (default silent). */
  notifyApplicant?: boolean;
  /**
   * REJECT only, and only meaningful with `notifyApplicant`. The admin's own paragraph for the
   * applicant to read — plain text, bounded. The internal review reason is never disclosed.
   */
  rejectionReason?: string;
};

export type AdminSignupDecisionDto = {
  requestId: string;
  state: string;
  version?: number;
  resolution?: LineSignupReviewResolution;
  entryCompanyId?: string;
  /** REQUEST_INFO: durable outbox acceptance, never a claim that LINE delivered it. */
  customerNotification?: 'QUEUED' | 'NOT_AVAILABLE';
  /** REQUEST_INFO: the owned support inbox case that receives the customer's follow-up. */
  supportRequestId?: string;
};

export type AdminSignupReissueDto = { requestId: string; state: string; claimEmailQueued: boolean };

export type AdminSignupClaimHistoryDto = { requestId: string; state: string; version: number; latestAttemptId: string | null;
  lastClaimSentAt: string | null; hasLegacySesReference: boolean;
  items: Array<{ id: string; provider: string; generation: number; state: string; latest: boolean; possibleDuplicate: boolean;
    createdAt: string; submittedAt: string | null; deliveredAt: string | null; suppressedAt: string | null;
    deadlineAt: string | null; nextRecoveryAt: string | null; needsReview: boolean }>;
  nextCursor: string | null };

// ── Spec §4F account merge — what a merge would do, shown before it is confirmed ──

/**
 * Review R05. `move`: this shop follows you to the account you keep, with the same roles.
 * `close_duplicate`: you already have identical access there through the other account, so the
 * duplicate is closed and nothing about the shop changes. `blocked`: the two memberships disagree,
 * and merging would decide a question only a person can — the whole merge is refused.
 */
export type AccountMergeCompanyOutcomeDto = {
  companyName: string;
  outcome: 'move' | 'close_duplicate' | 'blocked';
  /** Only on `blocked`: which rule refused, so the dialog can say something true. */
  reason?: 'role_conflict' | 'target_membership_inactive' | 'last_active_owner';
};

/** Names an account well enough to decide between two of them, and nothing more — never an email. */
export type AccountMergeAccountSummaryDto = {
  displayName: string;
  username?: string;
  /** The ways this account can sign in today. */
  signInWith: Array<'line' | 'password'>;
};

export type AccountMergePreviewDto = {
  canMerge: boolean;
  /** The account that survives; its `signInWith` is what still works afterwards. */
  keeps: AccountMergeAccountSummaryDto;
  /** The account that is closed; signing in with these stops working. */
  closes: AccountMergeAccountSummaryDto;
  companies: AccountMergeCompanyOutcomeDto[];
};

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
  discoverySource?: SignupDiscoverySource | null;
  discoverySourceOther?: string | null;
  /** LIFF ID token. The ONLY identity input; the profile the client shows is never trusted. */
  idToken: string;
  /** Client-stable UUID, persisted before POST and reused verbatim after a lost response. */
  submissionId: string;
  /** Opening another shop is an explicit choice and always uses a fresh submissionId. */
  intent: LineSignupIntent;
  companyName: string;
  /** Required Thai mobile, 10 digits starting 0. */
  phoneNumber: string;
  /** Optional shop contact; no mailbox verification or recovery authority. */
  contactEmail?: string | null;
  referralCode?: string;
  legal: LineSignupLegalEvidenceDto;
};

export type LineSignupIntent = 'FIRST_SHOP' | 'ADD_SHOP';

export type LineSignupReviewResolution = 'NEW_SHOP' | 'RETURN_EXISTING' | 'REQUEST_INFO' | 'PLAN_REVIEW';

export type LineSignupEligibleCompanyDto = {
  companyId: string;
  companyName: string;
  /** EXPIRED is term-disabled and remains visible for the renewal/support path. */
  status: 'ACTIVE' | 'EXPIRED';
  /** Only ACTIVE is a valid RETURN_EXISTING target and direct entry. */
  canEnter: boolean;
};

export type LineSignupProgressDto = {
  discoverySource?: SignupDiscoverySource;
  discoverySourceOther?: string;
  requestId: string;
  submissionId: string;
  version: number;
  state: string;
  companyName: string;
  phoneNumber: string;
  contactEmail: string;
  referralCode?: string;
  intent: LineSignupIntent;
  resolution?: LineSignupReviewResolution;
  /** Present only when an operator chose REQUEST_INFO. */
  requestedInformation?: string;
  /** True when this LINE account belongs to an active user. */
  existingAccount: boolean;
  /** Asia/Bangkok business hours right now; decides which waiting message the client shows. */
  businessHours: boolean;
  /** RECEIVED/VALIDATED work may be resumed against this exact persisted submission. */
  canRetryIntake: boolean;
  /** A guarded correction endpoint may revise the contact before any provisioning begins. */
  canUpdateContactEmail: boolean;
  /** A company was created by this request even when current access was later revoked. */
  companyCreated: boolean;
  /** Permission-checked navigation target, whether newly created or an explicitly resolved existing shop. */
  entryCompanyId?: string;
};

export type LineSignupStatusDto = {
  progress: LineSignupProgressDto | null;
  /** Current ACTIVE companies reachable through the token-proven ACTIVE account and memberships. */
  eligibleCompanies: LineSignupEligibleCompanyDto[];
};

export type LineSignupSubmitAcceptedDto = LineSignupStatusDto;

export type LineSignupContactEmailCorrectionDto = {
  idToken: string;
  version: number;
  contactEmail?: string | null;
};

export type LineSignupRetryDto = {
  idToken: string;
  version: number;
};

export type PackageChangeRequestStatus = 'OPEN' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type PackageChangeRequestDto = {
  id: string;
  companyId: string;
  requestedTierKey: string;
  status: PackageChangeRequestStatus;
  /** Present only when the original request was fulfilled by an applied paid package. */
  resolutionSource?: 'PAID_PURCHASE';
  note?: string;
  createdAt: string;
  decidedAt?: string;
};

/** The same row seen from the admin queue: it adds who and which shop, which the owner already knows. */
export type AdminPackageChangeItemDto = PackageChangeRequestDto & {
  companyName: string;
  /** What the shop is on today, so the operator sees the move rather than only the destination. */
  currentTierKey?: string;
  /** Paid sources use the reviewed control; a legacy direct approval cannot change purchased fields. */
  billingReviewPath?: string;
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

export type PartnerLineMessageBody = {
  text: string;
  /**
   * The support request this reply answers — carried by the inbox's "เปิดหน้าร้าน" link. It adds
   * that ONE requester to the recipients (an employee's reply would otherwise go only to their
   * owner) and marks the request answered. Must be this shop's, and not CLOSED.
   */
  supportRequestId?: string;
};

export type PartnerLineMessageResultDto = {
  /**
   * How many LINE chats the message reached: the shop's linked OWNERs, plus the one requester named
   * by `supportRequestId`. 0 means nobody in that set has LINE linked.
   */
  delivered: number;
};

// ── Support requests: "ติดต่อเจ้าหน้าที่" (line-support-request-spec-th §2.3) ──

export type SupportRequestStatus = 'OPEN' | 'ANSWERED' | 'CLOSED';

/** Why a request closed. `expired` and `customer_resumed` remain readable for legacy rows. */
export type SupportRequestClosedReason = 'admin' | 'customer_resumed' | 'expired' | 'resolved';

export type SupportReplyDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED';

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
  /** Current bounded REQUEST_INFO question from the linked signup review, when one is active. */
  requestedInformation?: string;
  requestedAt: string;
  /**
   * ≤200 chars of the question that was on the screen when they tapped. Never rewritten — a nudge
   * or an unrelated receipt photo used to overwrite the sentence an operator was answering.
   */
  requestText?: string;
  /** ≤200 chars of the newest customer TEXT, when the assistant kept any. */
  lastMessageText?: string;
  /**
   * When that message arrived. The waiting clock counts from HERE, not from `requestedAt`: once a
   * customer has written again, "how long since they last wrote" is the only honest reading of how
   * long they have been ignored. Equal to `requestedAt` until they do.
   */
  lastMessageAt: string;
  /**
   * When a photo or document last arrived on this thread. §3 keeps the bytes out of the record
   * entirely, so this is all the inbox has to show ("📷 ส่งรูปมา") — and the words the customer
   * typed survive a picture that may just be an ordinary receipt.
   *
   * A MARKER, on whichever tab the row is already on: a photo is not the customer asking again, so
   * it moves neither the status nor `lastMessageAt` (§2.2 delta รอบ 5). An ANSWERED thread that
   * receives one stays ANSWERED with a camera beside it.
   */
  lastMediaAt?: string;
  /**
   * How many times this request was answered and then reopened by the customer writing back. `> 0`
   * on an OPEN row is the "ตอบแล้ว N ครั้ง · ลูกค้าตอบกลับ" case — the conversation is still running.
   */
  reopenedCount: number;
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
  assignedAt?: string;
  assigneeDisplayName?: string;
  assignedToMe: boolean;
  assignmentNote?: string;
  /** Stable id of the latest logical send; reused only to retry that same text. */
  replyOperationId?: string;
  replyFirstAttemptAt?: string;
  lastReplyText?: string;
  lastReplyByDisplayName?: string;
  lastReplyDeliveryStatus?: SupportReplyDeliveryStatus;
  lastReplyError?: string;
  closedAt?: string;
  closedReason?: SupportRequestClosedReason;
  resolvedByDisplayName?: string;
  resolutionNote?: string;
};

export type SupportRequestQueueDto = {
  items: SupportRequestItemDto[];
  /** Always the OPEN total, whatever `status` filtered the list — it feeds the system nav badge. */
  openCount: number;
  /** Total rows matching this status in the database, not only the current page. */
  totalCount: number;
  nextCursor: string | null;
};

/**
 * Just the badge number. Its own endpoint because the system header asks for it on every
 * navigation, and answering that with a 200-row queue read is a page of rows nobody renders.
 */
export type SupportRequestCountDto = { open: number };

export type SupportRequestActionDto = {
  id: string;
  status: SupportRequestStatus;
  assignedToMe?: boolean;
  assigneeDisplayName?: string;
  /** `resume-ai` only: whether a running assistant pause was actually lifted. */
  pauseCleared?: boolean;
};

export type SupportRequestReplyBody = {
  text: string;
  /** Client-minted UUID: retries reuse it; a deliberate later message mints another. */
  operationId: string;
  /** Latest operation the client read. Null means this case has never had a reply operation. */
  previousReplyOperationId: string | null;
};

export type SupportRequestReplyResultDto = SupportRequestActionDto & {
  deliveryStatus: 'SENT' | 'FAILED';
  errorCode?: string;
  /** True when a newer customer message kept the request OPEN after this reply landed. */
  newerCustomerMessage?: boolean;
};

export type SupportRequestResolveBody = {
  /** Required, bounded operator note describing the actual outcome. */
  note: string;
};

export type SupportRequestReclaimBody = {
  /** Assignment version shown by the queue; prevents taking a case after it changed again. */
  expectedAssignedAt: string;
  reason: string;
};

// ── Support thread: the chat behind one request (line-support-request-spec-th สัญญา v3, 2026-09-20) ──

export type SupportRequestMessageDirection = 'CUSTOMER' | 'STAFF';
export type SupportRequestMessageKind = 'TEXT' | 'IMAGE' | 'FILE';

/** Bounded codes only (§3): why a customer photo/file has no bytes to show. */
export type SupportRequestMediaError =
  | 'media_fetch_failed'
  | 'media_security_rejected'
  | 'media_scan_failed'
  /** The request already holds as many stored files as one case may keep. */
  | 'media_limit_reached';

/**
 * One thing said on a support request. §3 still holds: no LINE id, no LINE display name and no
 * LINE message id cross here — a STAFF row names the operator who signed the push, nothing else.
 */
export type SupportRequestMessageDto = {
  id: string;
  direction: SupportRequestMessageDirection;
  kind: SupportRequestMessageKind;
  /** TEXT: the sentence. A customer's is the full text (≤2000), not the 200-char row summary. */
  text?: string;
  /** STAFF only: the display name the LINE push was signed with. */
  senderName?: string;
  /** IMAGE/FILE: the bytes are stored, and `…/messages/:id/content` streams them. */
  hasContent: boolean;
  fileName?: string;
  mimeType?: string;
  byteSize?: number;
  /** IMAGE/FILE without bytes: why, so the bubble can say so instead of rendering nothing. */
  mediaError?: SupportRequestMediaError;
  /** STAFF only: mirrors the reply operation this row belongs to. */
  deliveryStatus?: SupportReplyDeliveryStatus;
  createdAt: string;
};

/**
 * The request AND its messages in one read, so the chat window polls one endpoint and never shows a
 * status the row has already left behind. A request raised before v3 has an empty `messages` and
 * only the row's own summaries — the window says so rather than inventing history.
 */
export type SupportRequestThreadDto = {
  request: SupportRequestItemDto;
  messages: SupportRequestMessageDto[];
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
