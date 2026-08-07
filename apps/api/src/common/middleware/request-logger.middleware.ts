import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { LOGGER_TOKEN, type AppLogger } from '../logger/logger.service';

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
        path: req.path,
        status,
        durationMs: Date.now() - startMs,
        // ponytail: authorization header intentionally omitted; pino redact covers * patterns
      }, 'request');
    });

    next();
  }
}
