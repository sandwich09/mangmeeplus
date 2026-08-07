/**
 * Spec §15: Prisma failures at the API boundary.
 * UAT incident (2026-07-28): `POST /v1/procurement/suppliers` with an unknown `supplierType` answered
 * 500 because the global filter turned every non-HttpException into a server fault. This spec pins the
 * four request-caused Prisma failures to 4xx AND — just as important — pins everything else (schema
 * drift, pool exhaustion, raw errors) to the unchanged 500 + enriched 5xx log path, so a broken deploy
 * can never hide behind a client error.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, Logger, type HttpServer } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { AppLogger } from '../logger/logger.service';
import { AllExceptionsFilter } from './all-exceptions.filter';

// BaseExceptionFilter.handleUnknownError logs through Nest's own ExceptionsHandler logger on the 500
// path; silence it so the 500 cases don't spray stack traces over the test reporter.
Logger.overrideLogger(false);

const CLIENT_VERSION = '7.8.0';

type Reply = { body: Record<string, unknown>; status: number };

function run(exception: unknown) {
  const replies: Reply[] = [];
  const warns: Array<Record<string, unknown>> = [];
  const errors: Array<Record<string, unknown>> = [];
  const logger = {
    warn: (obj: Record<string, unknown>) => void warns.push(obj),
    error: (obj: Record<string, unknown>) => void errors.push(obj),
  } as unknown as AppLogger;

  const req = { method: 'POST', path: '/v1/procurement/suppliers', headers: { 'x-request-id': 'req-1' } };
  const res = {};
  const host = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getArgByIndex: (index: number) => (index === 1 ? res : req),
  } as unknown as import('@nestjs/common').ArgumentsHost;

  // BaseExceptionFilter renders through the http adapter, not through the express response directly.
  const httpAdapter = {
    isHeadersSent: () => false,
    reply: (_res: unknown, body: Record<string, unknown>, status: number) => void replies.push({ body, status }),
    end: () => undefined,
  } as unknown as HttpServer;

  new AllExceptionsFilter(logger, httpAdapter).catch(exception, host);
  assert.equal(replies.length, 1, 'exactly one response must be rendered');
  return { reply: replies[0] as Reply, warns, errors };
}

const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma says ${code}`, { code, clientVersion: CLIENT_VERSION, meta });

describe('AllExceptionsFilter — Prisma error mapping (spec §15.2)', () => {
  it('PrismaClientValidationError → 400 with a fixed message and no query/payload leak', () => {
    const raw = 'Invalid value for argument `supplierType`: expected SupplierType, got "COMPANY"';
    const { reply, warns, errors } = run(new Prisma.PrismaClientValidationError(raw, { clientVersion: CLIENT_VERSION }));

    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body, {
      statusCode: 400,
      message: 'Request shape or field values are invalid.',
      error: 'Bad Request',
    });
    const rendered = JSON.stringify(reply.body);
    assert.ok(!rendered.includes('supplierType'), 'the Prisma message embeds request payload values — never echo it');
    assert.ok(!rendered.includes('COMPANY'));

    assert.equal(errors.length, 0, 'a mapped 4xx must not emit the M-02 "unhandled exception" 5xx log');
    assert.equal(warns.length, 1, 'exactly one warn line per translated 4xx');
    assert.deepEqual(warns[0], {
      requestId: 'req-1',
      method: 'POST',
      path: '/v1/procurement/suppliers',
      prismaCode: 'validation',
    });
  });

  it('P2002 → 409 naming the conflicting columns from meta.target', () => {
    const { reply, warns, errors } = run(knownError('P2002', { target: ['companyId', 'supplierCode'] }));

    assert.equal(reply.status, 409);
    assert.equal(reply.body['error'], 'Conflict');
    const message = String(reply.body['message']);
    assert.ok(message.startsWith('Duplicate value: a record with the same unique field(s) already exists.'), message);
    assert.ok(message.includes('companyId, supplierCode'), message);
    assert.ok(!message.includes('prisma says'), 'the raw Prisma message must not reach the client');

    assert.equal(errors.length, 0);
    assert.equal(warns.length, 1);
    assert.equal(warns[0]?.['prismaCode'], 'P2002');
    assert.deepEqual(warns[0]?.['target'], ['companyId', 'supplierCode']);
  });

  it('P2002 with meta.target absent or non-array → 409 with the base message only', () => {
    for (const meta of [undefined, { target: 'supplierCode_companyId_key' }, { target: [1, 2] }]) {
      const { reply, warns } = run(knownError('P2002', meta));
      assert.equal(reply.status, 409);
      assert.equal(
        reply.body['message'],
        'Duplicate value: a record with the same unique field(s) already exists.',
        `meta ${JSON.stringify(meta)} must not enrich the message`,
      );
      assert.equal(warns.length, 1);
      assert.equal(warns[0]?.['target'], undefined, 'only a string array may be logged as target');
    }
  });

  it('P2025 → 404 and P2003 → 409, both with fixed messages', () => {
    const notFound = run(knownError('P2025'));
    assert.equal(notFound.reply.status, 404);
    assert.deepEqual(notFound.reply.body, { statusCode: 404, message: 'Record not found.', error: 'Not Found' });
    assert.equal(notFound.warns.length, 1);
    assert.equal(notFound.warns[0]?.['prismaCode'], 'P2025');
    assert.equal(notFound.errors.length, 0);

    const conflict = run(knownError('P2003', { field_name: 'supplierId' }));
    assert.equal(conflict.reply.status, 409);
    assert.deepEqual(conflict.reply.body, {
      statusCode: 409,
      message:
        'Operation conflicts with related records: a referenced record is missing or this record is still referenced.',
      error: 'Conflict',
    });
    assert.equal(
      JSON.stringify(conflict.reply.body).includes('supplierId'),
      false,
      'no meta beyond P2002 target columns may reach a client',
    );
    assert.equal(conflict.warns.length, 1);
    assert.equal(conflict.warns[0]?.['prismaCode'], 'P2003');
    assert.equal(conflict.errors.length, 0);
  });
});

describe('AllExceptionsFilter — what must NOT be remapped (spec §15.3)', () => {
  // P2021/P2022 are this repo's real prod schema-drift incident class; P2024/P2034 are server capacity
  // and concurrency. A 4xx here would hide a broken deploy from the 5xx logs and from the ALB 4xx alarm.
  for (const code of ['P2021', 'P2022', 'P2024', 'P2034', 'P2010']) {
    it(`${code} stays 500 with the enriched 5xx log`, () => {
      const { reply, warns, errors } = run(knownError(code, { table: 'Supplier' }));
      assert.equal(reply.status, 500);
      assert.deepEqual(reply.body, { statusCode: 500, message: 'Internal server error' });
      assert.equal(warns.length, 0, 'nothing was translated, so no warn line');
      assert.equal(errors.length, 1);
      assert.equal(errors[0]?.['requestId'], 'req-1');
      assert.equal(errors[0]?.['method'], 'POST');
      assert.equal(errors[0]?.['path'], '/v1/procurement/suppliers');
      const err = errors[0]?.['err'] as Record<string, unknown>;
      assert.equal(err['name'], 'PrismaClientKnownRequestError');
      assert.equal(err['code'], code);
      assert.deepEqual(err['meta'], { table: 'Supplier' });
      assert.ok(String(err['stack']).length > 0, 'the 5xx log must still carry a stack');
    });
  }

  it('other Prisma client error classes stay 500 (initialization, unknown, panic)', () => {
    const others = [
      new Prisma.PrismaClientInitializationError('Can\'t reach database server', CLIENT_VERSION, 'P1001'),
      new Prisma.PrismaClientUnknownRequestError('engine blew up', { clientVersion: CLIENT_VERSION }),
      new Prisma.PrismaClientRustPanicError('panic', CLIENT_VERSION),
    ];
    for (const exception of others) {
      const { reply, warns, errors } = run(exception);
      assert.equal(reply.status, 500, `${(exception as Error).name} must stay 500`);
      assert.equal(warns.length, 0);
      assert.equal(errors.length, 1);
    }
  });

  it('a plain Error stays 500 with the unchanged enriched log shape', () => {
    const { reply, warns, errors } = run(new Error('boom'));
    assert.equal(reply.status, 500);
    assert.deepEqual(reply.body, { statusCode: 500, message: 'Internal server error' });
    assert.equal(warns.length, 0);
    assert.equal(errors.length, 1);
    assert.deepEqual(Object.keys(errors[0] ?? {}), ['requestId', 'method', 'path', 'err']);
    const err = errors[0]?.['err'] as Record<string, unknown>;
    assert.deepEqual(Object.keys(err), ['name', 'message', 'stack'], 'no code/meta keys when absent');
    assert.equal(err['message'], 'boom');
  });

  it('plain HttpException 4xx pass through unchanged and stay quiet', () => {
    const { reply, warns, errors } = run(new BadRequestException(['supplierType must be one of ...']));
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body['message'], ['supplierType must be one of ...'], 'DTO field errors survive');
    assert.equal(warns.length, 0);
    assert.equal(errors.length, 0);
  });
});
