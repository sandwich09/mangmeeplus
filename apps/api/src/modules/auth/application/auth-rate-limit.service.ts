import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';

// P10 public signup buckets. One hour of window for all of them; the counts differ by how
// expensive the action is downstream (an email send costs SES reputation, a status read costs a row).
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
