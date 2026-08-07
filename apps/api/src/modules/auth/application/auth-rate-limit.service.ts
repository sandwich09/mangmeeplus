import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../common/config/app-config.service';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../common/logger/security-event';

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
