import { CanActivate, ExecutionContext, HttpException, HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AppConfigService } from '../config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../logger/security-event';
import { trustedClientIp } from './trusted-client-ip';
import { RedisRateLimitService } from './redis-rate-limit.service';

type RateLimitConfig = Pick<
  AppConfigService,
  'rateLimitEnabled' | 'rateLimitWindowSeconds' | 'rateLimitMaxRequests'
>;

const HEALTH_PATHS = new Set(['/health', '/v1/health']);

// L-14: main.ts installs NestPinoLoggerBridge as the app logger (M-02), so this reaches the
// redacted pino stream. Module-level so the guard's constructor signature stays untouched.
const securityLogger = new Logger('ApiRateLimitGuard');

export class ApiRateLimitGuard implements CanActivate {
  private limiterErrorLogged = false;
  private storeDegraded = false;
  private readonly limits: RedisRateLimitService;

  constructor(
    private readonly config: RateLimitConfig,
    private readonly logError: (error: unknown) => void = (error) => console.error('API rate limiter failed closed.', error),
    limits?: RedisRateLimitService,
  ) {
    this.limits = limits ?? new RedisRateLimitService(this.config as any);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      if (!this.config.rateLimitEnabled) return true;

      const http = context.switchToHttp();
      const request = http.getRequest<Request>();
      const path = request.path.replace(/\/+$/, '') || '/';
      if (HEALTH_PATHS.has(path)) return true;

      const key = trustedClientIp(request);
      // M-12 availability decision (2026-07-28): this bucket degrades to the per-process counter
      // when Redis is unavailable instead of 503-ing every request. It is a blunt DoS damper over
      // all traffic — it guards no spend and no credential, so "Redis down = API down" bought
      // nothing and cost everything, including a RollbackAlarm trip on the ECS canary. Every
      // cost-bearing (`ai-*-company`) and credential-guarding (auth) bucket keeps the default
      // fail-closed policy. See docs/security-remediation-checklist-merged-2026-07-17.md § M-12.
      const decision = await this.limits.consume(
        'api-ip',
        key,
        this.config.rateLimitMaxRequests,
        this.config.rateLimitWindowSeconds,
        'degrade-to-local',
      );
      this.trackStoreHealth(decision.degraded === true);
      if (decision.allowed) return true;
      http.getResponse<Response>().setHeader('Retry-After', String(decision.retryAfterSeconds));
      // L-14: sustained bot probing used to be entirely invisible — 429 with no log, no counter.
      emitSecurityEvent(securityLogger, SECURITY_EVENT.authRateLimitExceeded, 'HIGH', {
        bucket: 'api-ip',
        clientIp: key,
        method: request.method,
        path,
        requestId: request.headers['x-request-id'],
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    } catch (error) {
      this.logLimiterErrorOnce(error);
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('API abuse controls are unavailable.');
    }

    throw new HttpException(
      'Too many requests. Please wait before trying again.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Edge-triggered alarm on the degraded condition: emit when the shared store starts failing and
   * again when it recovers, never once per request — an outage would otherwise flood the stream
   * and the alarm would key on volume instead of the transition. HIGH `riskLevel` means the
   * existing L-14 CloudWatch metric filter already catches this with no infrastructure change.
   */
  private trackStoreHealth(degraded: boolean): void {
    if (degraded === this.storeDegraded) return;
    this.storeDegraded = degraded;
    emitSecurityEvent(securityLogger, SECURITY_EVENT.apiRateLimitStoreDegraded, 'HIGH', {
      bucket: 'api-ip',
      state: degraded ? 'degraded-to-local' : 'recovered',
    });
  }

  private logLimiterErrorOnce(error: unknown): void {
    if (this.limiterErrorLogged) return;
    this.limiterErrorLogged = true;
    try {
      this.logError(error);
    } catch {
      // Logging must not break fail-open behavior.
    }
  }
}
