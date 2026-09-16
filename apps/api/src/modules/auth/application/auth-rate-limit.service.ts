import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';

// P10 public signup buckets. One hour of window for all of them; the counts differ by how
// expensive the action is downstream (an email send costs SES reputation, a status read costs a row).
// P10-L §15.4. `POST me/password/set` answers `username_taken`, which makes it a username oracle
// for anyone holding one valid session; `me/contact` is a cheap write on the same account. One
// per-user budget covers both. Module constants rather than config keys because nothing
// operational wants this tuned per environment — the same call the LINE_SIGNUP_* buckets make.
const ACCOUNT_PROFILE_WRITE_WINDOW_SECONDS = 900;
const ACCOUNT_PROFILE_WRITE_MAX_PER_USER = 10;

const PUBLIC_SIGNUP_WINDOW_SECONDS = 3600;
const PUBLIC_SIGNUP_MAX_PER_IP = 10;
const PUBLIC_SIGNUP_MAX_PER_EMAIL = 5;
const PUBLIC_SIGNUP_READ_MAX_PER_IP = 60;
const PUBLIC_SIGNUP_RESEND_MAX_PER_IP = 10;
const PUBLIC_SIGNUP_RESEND_MAX_PER_REQUEST = 3;
const PUBLIC_SIGNUP_CLAIM_MAX_PER_IP = 20;
// SES publishes one event per send (delivery as well as bounce/complaint) and SNS delivers them
// from a small pool of AWS addresses, so this bucket sits far above the applicant-facing ones —
// it exists to bound an unsigned flood, not to shape legitimate AWS traffic.
const SES_EVENTS_MAX_PER_IP = 600;

/**
 * Review F6: the merge PREVIEW is a read the dialog makes to describe a decision, not an attempt at
 * the decision itself. It used to share the LINE-login callback bucket (10/window), so a person who
 * opened the dialog a few times could 429 their own LINE login — the very thing the dialog exists
 * to recover. Its own bucket, sized for a human opening a dialog, keeps the two apart.
 */
const ACCOUNT_MERGE_PREVIEW_WINDOW_SECONDS = 3600;
const ACCOUNT_MERGE_PREVIEW_MAX_PER_IP = 120;

// P10-L §9. Same fail-closed policy and the same "constants, not env knobs" reasoning as the web
// signup buckets above: `LINE_SIGNUP_ENABLED` is the operational switch, not the limits.
// Per-LINE-account is the tightest one because it is the only key tied to a verified human, and
// three shops a day is already generous for a person who owns shops.
const LINE_SIGNUP_WINDOW_SECONDS = 3600;
const LINE_SIGNUP_DAY_SECONDS = 86_400;
const LINE_SIGNUP_MAX_PER_USER_PER_DAY = 3;
// Review L-4: the creation bucket above deliberately does not charge a failed submit, which on its
// own would let one account drive unbounded ID-token verifications. This one charges every attempt
// that got as far as a verified token, sized so a person correcting a form never notices it.
const LINE_SIGNUP_ATTEMPT_MAX_PER_USER = 20;
// Reading a status is not attempting a signup, so it gets its own, roomier quota: spending the
// submit bucket on reads would let a status screen lock a customer out of applying (review LOW-4).
const LINE_SIGNUP_READ_MAX_PER_USER = 60;
// line-support-request-spec-th review: "ติดต่อเจ้าหน้าที่" is reachable by an unauthenticated LINE
// account, and every OPEN request that closes frees the dedupe — so tap → resume → tap, repeated,
// was an unbounded source of rows, letters and pushes from one person. Three genuine asks in a day
// is already more than a real customer makes; the fourth is answered warmly and writes nothing.
const LINE_SUPPORT_MAX_PER_USER_PER_DAY = 3;
const LINE_SIGNUP_MAX_PER_IP = 20;
const LINE_SIGNUP_READ_MAX_PER_IP = 60;
const LINE_LIFF_SESSION_MAX_PER_USER = 30;

@Injectable()
export class AuthRateLimitService {
  private readonly logger = new Logger(AuthRateLimitService.name);
  private readonly limits: RedisRateLimitService;

  constructor(
    private readonly config: AppConfigService,
    limits?: RedisRateLimitService,
  ) {
    this.limits = limits ?? new RedisRateLimitService(config);
  }

  // Login throttling counts FAILURES only: check both buckets before the attempt,
  // record into them when the attempt is rejected. Successful logins never consume quota.
  async assertPasswordLoginAllowed(identifier: string, ipAddress: string): Promise<void> {
    await this.assertOnly(
      'password-login-identifier-ip',
      `${identifier}:${ipAddress}`,
      this.config.passwordLoginMaxPerIdentifier,
      this.config.passwordLoginWindowSeconds,
    );
    await this.assertOnly(
      'password-login-ip',
      ipAddress,
      this.config.passwordLoginMaxPerIp,
      this.config.passwordLoginWindowSeconds,
    );
  }

  async recordPasswordLoginFailure(identifier: string, ipAddress: string): Promise<void> {
    await Promise.all([
      this.record('password-login-identifier-ip', `${identifier}:${ipAddress}`, this.config.passwordLoginMaxPerIdentifier, this.config.passwordLoginWindowSeconds),
      this.record('password-login-ip', ipAddress, this.config.passwordLoginMaxPerIp, this.config.passwordLoginWindowSeconds),
    ]);
  }

  async assertPasswordResetRequestAllowed(identifier: string, ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'password-reset-request-identifier-ip',
      `${identifier}:${ipAddress}`,
      this.config.passwordResetRequestMaxPerIdentifier,
      this.config.passwordResetRequestWindowSeconds,
    );
    await this.assertWithinLimit(
      'password-reset-request-ip',
      ipAddress,
      this.config.passwordResetRequestMaxPerIp,
      this.config.passwordResetRequestWindowSeconds,
    );
  }

  async assertPasswordResetConfirmAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'password-reset-confirm-ip',
      ipAddress,
      this.config.passwordResetConfirmMaxPerIp,
      this.config.passwordResetConfirmWindowSeconds,
    );
  }

  // P12-1: the web LINE login callback presents an unauthenticated one-time code, so the only
  // key available before identity is resolved is the caller IP — same fail-closed shape as
  // the password-reset confirm bucket.
  async assertLineLoginCallbackAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'line-login-callback-ip',
      ipAddress,
      this.config.lineLoginCallbackMaxPerIp,
      this.config.lineLoginCallbackWindowSeconds,
    );
  }

  /**
   * Review F6. Reading what a merge WOULD do must never cost the visitor their ability to log in
   * with LINE: this is an authenticated read behind a ticket the caller already holds, so it is
   * bounded generously and separately from the callback that mints the ticket.
   */
  async assertAccountMergePreviewAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'account-merge-preview-ip',
      ipAddress,
      ACCOUNT_MERGE_PREVIEW_MAX_PER_IP,
      ACCOUNT_MERGE_PREVIEW_WINDOW_SECONDS,
    );
  }

  // P12-3a: both desktop QR endpoints are unauthenticated, so the caller IP is again the only key.
  // Minting is rare; polling is not — the desktop asks every 2.5s for the QR's 180s lifetime — so
  // the two buckets are sized separately instead of sharing one quota.
  async assertLineQrCreateAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'line-qr-create-ip',
      ipAddress,
      this.config.lineQrCreateMaxPerIp,
      this.config.lineQrCreateWindowSeconds,
    );
  }

  async assertLineQrPollAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'line-qr-poll-ip',
      ipAddress,
      this.config.lineQrPollMaxPerIp,
      this.config.lineQrPollWindowSeconds,
    );
  }

  // P12-3b: the deep-link exchange is unauthenticated and the token IS the credential, so the
  // caller IP is again the only key available. One tap costs one call; the bucket bounds guessing
  // without punishing a family behind a single NAT.
  async assertLineHandoffExchangeAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'line-handoff-exchange-ip',
      ipAddress,
      this.config.lineHandoffExchangeMaxPerIp,
      this.config.lineHandoffExchangeWindowSeconds,
    );
  }

  /**
   * P10 §3: the public signup form is unauthenticated, so both buckets are fail-closed like every
   * other credential-adjacent bucket here. The limits are constants rather than env knobs — nothing
   * operational wants them tuned per environment, and `EXTERNAL_SIGNUP_ENABLED` is the real switch.
   */
  async assertPublicSignupAllowed(ipAddress: string, contactEmail: string): Promise<void> {
    await this.assertWithinLimit('public-signup-ip', ipAddress, PUBLIC_SIGNUP_MAX_PER_IP, PUBLIC_SIGNUP_WINDOW_SECONDS);
    // Lowercased so case permutations of one address share a single quota (L-06).
    await this.assertWithinLimit(
      'public-signup-email',
      contactEmail.trim().toLowerCase(),
      PUBLIC_SIGNUP_MAX_PER_EMAIL,
      PUBLIC_SIGNUP_WINDOW_SECONDS,
    );
  }

  /** Status polling and claim-link reads: cheap, but still a public enumeration surface. */
  async assertPublicSignupReadAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit('public-signup-read-ip', ipAddress, PUBLIC_SIGNUP_READ_MAX_PER_IP, PUBLIC_SIGNUP_WINDOW_SECONDS);
  }

  /** Applicant-triggered resend (spec §4D ②) — per request as well as per IP, so one applicant
   *  cannot mail-bomb their own inbox and burn SES reputation. */
  async assertPublicSignupResendAllowed(ipAddress: string, requestId: string): Promise<void> {
    await this.assertWithinLimit('public-signup-resend-ip', ipAddress, PUBLIC_SIGNUP_RESEND_MAX_PER_IP, PUBLIC_SIGNUP_WINDOW_SECONDS);
    await this.assertWithinLimit('public-signup-resend-request', requestId, PUBLIC_SIGNUP_RESEND_MAX_PER_REQUEST, PUBLIC_SIGNUP_WINDOW_SECONDS);
  }

  /** Claim submission carries a password, so it gets its own bucket separate from the reads. */
  async assertSignupClaimSubmitAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit('public-signup-claim-ip', ipAddress, PUBLIC_SIGNUP_CLAIM_MAX_PER_IP, PUBLIC_SIGNUP_WINDOW_SECONDS);
  }

  /**
   * P10-L: the caller IP is all that is known BEFORE the ID token is verified, so it bounds the
   * cost of the verification round trip itself.
   */
  async assertLineSignupIpAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit('line-signup-ip', ipAddress, LINE_SIGNUP_MAX_PER_IP, LINE_SIGNUP_WINDOW_SECONDS);
  }

  /**
   * Checked only AFTER the token proves which LINE account is asking (spec §9), and — like the
   * login buckets above — CHECKED here but not spent: three shops a day is generous, three typos
   * in one sitting is not, and consuming on a rejected submit would lock a real customer out of
   * their own signup for 24 hours. `recordLineSignupUser` is what spends it.
   */
  async assertLineSignupUserAllowed(lineProviderUserId: string): Promise<void> {
    await this.assertOnly(
      'line-signup-user',
      lineProviderUserId,
      LINE_SIGNUP_MAX_PER_USER_PER_DAY,
      LINE_SIGNUP_DAY_SECONDS,
    );
  }

  /**
   * Charged on EVERY attempt by a verified LINE account, successful or not (review L-4). Bounds
   * what a never-succeeding account can cost without touching the creation quota a real customer
   * needs to fix a typo.
   */
  async assertLineSignupAttemptAllowed(lineProviderUserId: string): Promise<void> {
    await this.assertWithinLimit(
      'line-signup-attempt-user',
      lineProviderUserId,
      LINE_SIGNUP_ATTEMPT_MAX_PER_USER,
      LINE_SIGNUP_WINDOW_SECONDS,
    );
  }

  /** Per-account quota for status reads, which also verify an ID token (review LOW-4). */
  async assertLineSignupReadUserAllowed(lineProviderUserId: string): Promise<void> {
    await this.assertWithinLimit(
      'line-signup-read-user',
      lineProviderUserId,
      LINE_SIGNUP_READ_MAX_PER_USER,
      LINE_SIGNUP_WINDOW_SECONDS,
    );
  }

  /**
   * The one bucket in this family that ANSWERS instead of throwing.
   *
   * Everything else here guards an HTTP endpoint, where a 429 is the right reply. This guards a
   * chat message from somebody asking for help: a 429 would surface as the generic error reply, and
   * telling a customer in trouble "too many requests" is the opposite of what this flow is for. So
   * the caller gets a boolean and answers "we already have your request" in Thai.
   *
   * Spends the slot on the way in, like `assertWithinLimit` — a request that WAS opened is the cost
   * being bounded, and the caller only asks when it is about to open one.
   *
   * No `emitSecurityEvent` either: `SecurityEventRisk` is HIGH or CRITICAL, and the deployed metric
   * filter alarms on both. A customer asking for help a fourth time is neither — the webhook writes
   * a `DENIED` audit row for it, which is where this belongs.
   *
   * `degrade-to-local`, and this is the whole reason the method exists rather than a one-line
   * `assertWithinLimit` call. The default `fail-closed` throws `ServiceUnavailableException` in
   * production when Redis is unavailable — which here would propagate out of `handleStaffContact`
   * and produce NO request row, NO notice and NO reply, on a webhook event already claimed and so
   * never redelivered. That is precisely the silent "รับเรื่องแล้วค่ะ that reached nobody" this
   * branch exists to remove, and no non-production environment can catch it because outside
   * production every policy already degrades. This bucket guards no spend and no secret (the cost
   * it bounds is rows and emails), so it takes the §4-rule-6 side: still bounded, at 3 per task
   * instead of 3 per fleet, rather than trading a customer's route to a human for it.
   */
  async consumeLineSupportRequestSlot(lineProviderUserId: string): Promise<boolean> {
    const decision = await this.limits.consume(
      'line-support-request-user',
      lineProviderUserId,
      LINE_SUPPORT_MAX_PER_USER_PER_DAY,
      LINE_SIGNUP_DAY_SECONDS,
      'degrade-to-local',
    );
    return decision.allowed;
  }

  /** Spent once an application actually exists. */
  async recordLineSignupUser(lineProviderUserId: string, signupRequestId: string): Promise<void> {
    await this.limits.consumeOnce(
      'line-signup-user',
      lineProviderUserId,
      signupRequestId,
      LINE_SIGNUP_MAX_PER_USER_PER_DAY,
      LINE_SIGNUP_DAY_SECONDS,
    );
  }

  /** Status polling from the LIFF page and the LINE status card: cheap, still enumerable. */
  async assertLineSignupReadAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit('line-signup-read-ip', ipAddress, LINE_SIGNUP_READ_MAX_PER_IP, LINE_SIGNUP_WINDOW_SECONDS);
  }

  /** Declared here with the rest of the family; the LIFF session exchange that spends it is L-B. */
  async assertLineLiffSessionAllowed(lineProviderUserId: string): Promise<void> {
    await this.assertWithinLimit(
      'line-liff-session-user',
      lineProviderUserId,
      LINE_LIFF_SESSION_MAX_PER_USER,
      LINE_SIGNUP_WINDOW_SECONDS,
    );
  }

  /** SNS callbacks for SES delivery/bounce/complaint events (external-signup spec §4D). */
  async assertSesEventsAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit('ses-events-ip', ipAddress, SES_EVENTS_MAX_PER_IP, PUBLIC_SIGNUP_WINDOW_SECONDS);
  }

  async assertCustomerRegisterAllowed(ipAddress: string, lineChannelId: string): Promise<void> {
    await this.assertWithinLimit(
      'customer-register-ip-channel',
      `${ipAddress}:${lineChannelId}`,
      this.config.customerRegisterMaxPerIpChannel,
      this.config.customerRegisterWindowSeconds,
    );
  }

  async assertEmailVerificationRequestAllowed(userId: string): Promise<void> {
    await this.assertWithinLimit(
      'email-verification-request-user',
      userId,
      this.config.emailVerificationRequestMaxPerUser,
      this.config.emailVerificationRequestWindowSeconds,
    );
  }

  /** Per-account OTP budgets live in the same DB transaction as the proof. This bounds IP floods. */
  async assertEmailOtpIpAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit('email-otp-ip', ipAddress, 120, 3600);
  }

  async assertEmailOtpUserAllowed(userId: string): Promise<void> {
    // Bound current-password guessing across different visitor IPs before reserving an OTP.
    await this.assertWithinLimit('email-otp-reauth-user', userId, 20, 3600);
  }

  /** Self-service writes on the caller's own account: phone number and first password. */
  async assertAccountProfileWriteAllowed(userId: string): Promise<void> {
    await this.assertWithinLimit(
      'account-profile-write-user',
      userId,
      ACCOUNT_PROFILE_WRITE_MAX_PER_USER,
      ACCOUNT_PROFILE_WRITE_WINDOW_SECONDS,
    );
  }

  async assertEmailVerificationConfirmAllowed(ipAddress: string): Promise<void> {
    await this.assertWithinLimit(
      'email-verification-confirm-ip',
      ipAddress,
      this.config.emailVerificationConfirmMaxPerIp,
      this.config.emailVerificationConfirmWindowSeconds,
    );
  }

  // L-01: keyed on the *presented refresh token id*, not the session row, so a holder of a stale
  // token cannot burn the live session's quota. RefreshSessionUseCase calls this only after the
  // session is proven ACTIVE, and treats an unavailable store as "allow" — see that call site.
  async assertRefreshAllowed(refreshTokenId: string): Promise<void> {
    await this.assertWithinLimit(
      'session-refresh',
      refreshTokenId,
      this.config.sessionRefreshMaxPerSession,
      this.config.sessionRefreshWindowSeconds,
    );
  }

  private async assertWithinLimit(scope: string, key: string, maxRequests: number, windowSeconds: number): Promise<void> {
    const decision = await this.limits.consume(scope, key, maxRequests, windowSeconds);
    this.assertDecision(scope, decision.allowed, decision.retryAfterSeconds);
  }

  private async assertOnly(scope: string, key: string, maxRequests: number, windowSeconds: number): Promise<void> {
    const decision = await this.limits.inspect(scope, key, maxRequests, windowSeconds);
    this.assertDecision(scope, decision.allowed, decision.retryAfterSeconds);
  }

  private async record(scope: string, key: string, maxRequests: number, windowSeconds: number): Promise<void> {
    await this.limits.consume(scope, key, maxRequests, windowSeconds);
  }

  private assertDecision(scope: string, allowed: boolean, retryAfterSeconds: number): void {
    if (!allowed) {
      // L-14: stable dotted name so an alarm keys on a contract, not free text.
      emitSecurityEvent(this.logger, SECURITY_EVENT.authRateLimitExceeded, 'HIGH', { scope, retryAfterSeconds });
      throw new HttpException(
        { message: 'Too many requests. Please wait before trying again.', retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
