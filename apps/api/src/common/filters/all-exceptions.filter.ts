import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  HttpException,
  NotFoundException,
  type HttpServer,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { InvalidCivilDateError } from '@watchdog-bms/contracts';
import type { AppLogger } from '../logger/logger.service';

// M-02: module logs are wired to pino (main.ts `logger: new NestPinoLoggerBridge(...)`), but Nest's
// default 500 handling carries no request context. This filter keeps the exact default response (via
// super.catch) and adds a requestId/method/path-enriched 5xx stack so unhandled errors are
// investigable in CloudWatch. Plain 4xx (validation/permission/not-found) stay quiet.
// Spec §15: it also translates the four Prisma failures that are deterministically caused by request
// content against a healthy database into 4xx (400/409/404/409) and logs exactly one `warn` for them.
// Everything else — schema drift (P2021/P2022), P1xxx, P2024, P2034, unknown/panic, raw errors — stays
// 500 with the enriched 5xx log, so broken deploys and outages never masquerade as client mistakes.
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly logger: AppLogger, httpAdapter: HttpServer) {
    super(httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    // A malformed date on the wire is a client mistake, not a server fault. civil-date.ts throws
    // from deep inside a repository where a Nest exception would not belong, so the translation
    // happens here — the same shape as the Prisma translation below. Note this is stricter than
    // what it replaced: `2026-02-30` used to be accepted and silently queried as 2 March.
    if (exception instanceof InvalidCivilDateError) {
      super.catch(new BadRequestException({ code: 'invalid_date', message: exception.message }), host);
      return;
    }
    const translated = translatePrismaError(exception);
    if (translated) {
      const req = host.switchToHttp().getRequest<Request>();
      this.logger.warn(
        {
          requestId: req.headers['x-request-id'],
          method: req.method,
          path: req.path,
          prismaCode: translated.prismaCode,
          ...(translated.target && { target: translated.target }),
        },
        'prisma client error mapped to 4xx',
      );
      // Hand Nest the translated HttpException so it renders the normal 4xx body and skips the
      // ExceptionsHandler 500 path entirely.
      super.catch(translated.exception, host);
      return;
    }
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

// Spec §15.4: fixed constants only. A Prisma message may never reach a client — PrismaClientValidationError
// embeds the constructed query with its argument values (request payload, potential PII).
const INVALID_REQUEST_MESSAGE = 'Request shape or field values are invalid.';
const DUPLICATE_MESSAGE = 'Duplicate value: a record with the same unique field(s) already exists.';
const NOT_FOUND_MESSAGE = 'Record not found.';
const RELATED_RECORDS_MESSAGE =
  'Operation conflicts with related records: a referenced record is missing or this record is still referenced.';

type TranslatedPrismaError = { exception: HttpException; prismaCode: string; target?: string[] };

// Spec §15.2. Detection is `instanceof` against the generated client, never `err.code` sniffing — this
// filter sees every exception in the app, including ones that merely happen to carry a `code`.
function translatePrismaError(exception: unknown): TranslatedPrismaError | null {
  if (exception instanceof Prisma.PrismaClientValidationError) {
    return { exception: new BadRequestException(INVALID_REQUEST_MESSAGE), prismaCode: 'validation' };
  }
  if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (exception.code) {
    case 'P2002': {
      // Only `meta.target` column names may enrich a body; nothing else from meta.
      const raw = exception.meta?.['target'];
      const target = Array.isArray(raw) && raw.every((c) => typeof c === 'string') ? (raw as string[]) : undefined;
      const message = target?.length ? `${DUPLICATE_MESSAGE} Fields: ${target.join(', ')}` : DUPLICATE_MESSAGE;
      return { exception: new ConflictException(message), prismaCode: 'P2002', ...(target && { target }) };
    }
    case 'P2025':
      return { exception: new NotFoundException(NOT_FOUND_MESSAGE), prismaCode: 'P2025' };
    case 'P2003':
      return { exception: new ConflictException(RELATED_RECORDS_MESSAGE), prismaCode: 'P2003' };
    // Spec §15.3: every other code (P2021/P2022 schema drift, P2024 pool, P2034 serialization, …) stays 500.
    default:
      return null;
  }
}
