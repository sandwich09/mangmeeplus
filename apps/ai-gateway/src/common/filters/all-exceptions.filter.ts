import { ArgumentsHost, Catch, HttpException, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import type { AppLogger } from '../logger/logger.service';

// Gateway counterpart of the API filter: keeps the exact default response (via super.catch) but
// logs 5xx with a stack, requestId, method and path so unhandled gateway errors are correlatable
// in CloudWatch. 4xx (validation/permission/not-found) stay quiet.
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly logger: AppLogger, httpAdapter: HttpServer) {
    super(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<Request>();
      const e = exception as { name?: string; message?: string; stack?: string; code?: unknown; meta?: unknown };
      this.logger.error(
        {
          requestId: req.headers['x-request-id'],
          method: req.method,
          path: req.path,
          err: exception instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack, ...(e.code !== undefined && { code: e.code }), ...(e.meta !== undefined && { meta: e.meta }) }
            : exception,
        },
        'unhandled exception',
      );
    }
    super.catch(exception, host);
  }
}
