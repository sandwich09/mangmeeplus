import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { LOGGER_TOKEN, type AppLogger } from '../logger/logger.service';

/**
 * A URL segment long enough to be a credential rather than an identifier. Claim tokens are 32
 * random bytes as base64url (43 chars), the reset/local-storage tokens 32–64 hex; the ids this
 * product puts in paths are cuids of 25. 32 is the gap between the two, so an operator keeps the
 * company and document ids that make a log line useful and loses only the secrets.
 */
const SECRET_SHAPED_SEGMENT = /^[A-Za-z0-9._~-]{32,}$/;

/**
 * Review R01: `createLogger` redacts by KEY name, and `path` is not a sensitive key — so a bearer
 * token that travelled as a URL segment used to reach the log verbatim. Prefer the route template
 * Express matched (it can only ever contain `:param`); fall back to masking the segment shape for
 * anything unrouted, such as a 404 probe.
 */
export function loggablePath(req: { path: string; route?: { path?: string } | undefined }): string {
  const template = req.route?.path;
  if (typeof template === 'string' && template.includes(':')) return template;
  return req.path
    .split('/')
    .map((segment) => (SECRET_SHAPED_SEGMENT.test(segment) ? '[REDACTED]' : segment))
    .join('/');
}

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  constructor(
    @Inject(LOGGER_TOKEN) private readonly logger: AppLogger,
    private readonly config: AppConfigService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    // L-09: REQUEST_LOG_ENABLED was parsed by the config layer but silently ignored here.
    if (!this.config.requestLogEnabled) return next();
    const startMs = Date.now();
    const requestId = req.headers['x-request-id'] as string | undefined;

    res.on('finish', () => {
      const status = res.statusCode;
      // 5xx => error, 4xx => warn, else info — so failed requests are filterable/alertable by level.
      const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
      this.logger[level]({
        requestId,
        method: req.method,
        path: loggablePath(req),
        status,
        durationMs: Date.now() - startMs,
        // ponytail: authorization header intentionally omitted; pino redact covers * patterns
      }, 'request');
    });

    next();
  }
}
