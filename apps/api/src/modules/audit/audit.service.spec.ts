import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AUDIT_PERSIST_FAILED_EVENT, AuditService } from './application/audit.service';
import { AuditAction } from './domain/models/audit-action';
import { AuditController } from './presentation/audit.controller';
import type { AuditTransactionClient, IAuditRepository } from './domain/ports/audit-repository.port';
import type { AuditLogEntry, AuditLogRecord } from './domain/models/audit-log.model';
import type { AppLogger } from '../../common/logger/logger.service';

const makeRepo = (overrides: Partial<IAuditRepository> = {}): IAuditRepository => ({
  log: mock.fn(async () => {}),
  getCompanyLogs: mock.fn(async () => ({ data: [], total: 0 })),
  ...overrides,
});

const makeLogger = () => {
  const errors: Record<string, unknown>[] = [];
  const logger = { error: (payload: Record<string, unknown>) => { errors.push(payload); } } as unknown as AppLogger;
  return { errors, logger };
};

describe('AuditAction', () => {
  it('has no duplicate values', () => {
    const values = Object.values(AuditAction);
    const unique = new Set(values);
    assert.equal(unique.size, values.length, 'AuditAction must not have duplicate values');
  });
});

describe('AuditService', () => {
  it('delegates log() call to repository with the correct entry', async () => {
    const logged: AuditLogEntry[] = [];
    const repo = makeRepo({
      log: mock.fn(async (entry: AuditLogEntry) => { logged.push(entry); }),
    });

    const service = new AuditService(repo, makeLogger().logger);
    const entry: AuditLogEntry = {
      actorUserId: 'user-1',
      companyId: 'company-1',
      action: 'test.action',
      targetType: 'test',
      requestId: 'req-1',
      result: 'SUCCESS',
    };

    await service.log(entry);

    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0], entry);
  });

  it('redacts sensitive metadata before writing', async () => {
    const logged: AuditLogEntry[] = [];
    const repo = makeRepo({
      log: mock.fn(async (entry: AuditLogEntry) => { logged.push(entry); }),
    });

    const service = new AuditService(repo, makeLogger().logger);
    await service.log({
      actorUserId: 'user-1',
      companyId: 'company-1',
      action: 'test.action',
      targetType: 'test',
      requestId: 'req-1',
      result: 'SUCCESS',
      metadataJson: {
        authorization: 'Bearer token',
        cookie: 'session=abc',
        rawPrompt: 'show secrets',
        documentBody: 'full document',
        nested: { refreshToken: 'secret-refresh' },
        note: 'safe note',
      },
    });

    assert.deepEqual(logged[0]?.metadataJson, {
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      rawPrompt: '[REDACTED]',
      documentBody: '[REDACTED]',
      nested: { refreshToken: '[REDACTED]' },
      note: 'safe note',
    });
  });

  it('truncates oversized metadata strings', async () => {
    const logged: AuditLogEntry[] = [];
    const repo = makeRepo({
      log: mock.fn(async (entry: AuditLogEntry) => { logged.push(entry); }),
    });

    const service = new AuditService(repo, makeLogger().logger);
    await service.log({
      action: 'test.action',
      targetType: 'test',
      requestId: 'req-1',
      result: 'SUCCESS',
      metadataJson: { summary: 'x'.repeat(600) },
    });

    const summary = logged[0]?.metadataJson?.['summary'];
    assert.equal(typeof summary, 'string');
    assert.equal((summary as string).length, 526);
    assert.ok((summary as string).endsWith('...[TRUNCATED]'));
  });

  it('delegates getCompanyLogs() to repository', async () => {
    const fakeRecord: AuditLogRecord = {
      id: 'log-1',
      createdAt: new Date('2024-01-01'),
      actorUserId: 'user-1',
      companyId: 'co-1',
      action: AuditAction.AUTH_SESSION_LOGOUT,
      targetType: 'auth_session',
      requestId: 'req-1',
      result: 'SUCCESS',
    };
    const repo = makeRepo({
      getCompanyLogs: mock.fn(async () => ({ data: [fakeRecord], total: 1 })),
    });

    const service = new AuditService(repo, makeLogger().logger);
    const result = await service.getCompanyLogs({ companyId: 'co-1', page: 1, pageSize: 20 });

    assert.equal(result.total, 1);
    assert.equal(result.data[0]?.id, 'log-1');
  });
});

describe('AuditService delivery contract (L-10)', () => {
  const entry: AuditLogEntry = {
    actorUserId: 'user-1', companyId: 'company-1', action: 'ledger.journal.post',
    targetType: 'journal_entry', requestId: 'req-9', result: 'SUCCESS', riskLevel: 'HIGH',
  };

  it('post-commit mode retries exactly once and stays silent when the retry succeeds', async () => {
    let attempts = 0;
    const repo = makeRepo({
      log: mock.fn(async () => { attempts += 1; if (attempts === 1) throw new Error('connection reset'); }),
    });
    const { errors, logger } = makeLogger();

    await new AuditService(repo, logger).log(entry);

    assert.equal(attempts, 2);
    assert.equal(errors.length, 0);
  });

  it('post-commit mode never throws and emits audit.persist.failed when the retry also fails', async () => {
    let attempts = 0;
    const repo = makeRepo({ log: mock.fn(async () => { attempts += 1; throw new Error('db down'); }) });
    const { errors, logger } = makeLogger();

    // Resolving is the contract: the financial mutation already committed.
    await new AuditService(repo, logger).log(entry);

    assert.equal(attempts, 2);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.['event'], AUDIT_PERSIST_FAILED_EVENT);
    // L-14: the production metric filter keys on `$.riskLevel`, so without a root-level one the
    // single event L-10 exists to surface — a financial audit write that failed twice — pages nobody.
    assert.equal(errors[0]?.['riskLevel'], 'CRITICAL');
    assert.equal(errors[0]?.['action'], 'ledger.journal.post');
    assert.equal(errors[0]?.['targetType'], 'journal_entry');
    assert.equal(errors[0]?.['requestId'], 'req-9');
    assert.equal((errors[0]?.['err'] as { message?: string })?.message, 'db down');
  });

  it('logOrThrow propagates after the same single retry, and still raises the alarm event', async () => {
    let attempts = 0;
    const repo = makeRepo({ log: mock.fn(async () => { attempts += 1; throw new Error('db down'); }) });
    const { errors, logger } = makeLogger();

    await assert.rejects(() => new AuditService(repo, logger).logOrThrow(entry), /db down/);

    assert.equal(attempts, 2, 'one insert plus exactly one retry, same as post-commit mode');
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.['event'], AUDIT_PERSIST_FAILED_EVENT);
    assert.equal(errors[0]?.['riskLevel'], 'CRITICAL');
  });

  it('logOrThrow resolves silently when the retry succeeds', async () => {
    let attempts = 0;
    const repo = makeRepo({
      log: mock.fn(async () => { attempts += 1; if (attempts === 1) throw new Error('connection reset'); }),
    });
    const { errors, logger } = makeLogger();

    await new AuditService(repo, logger).logOrThrow(entry);

    assert.equal(attempts, 2);
    assert.equal(errors.length, 0);
  });

  it('logOrThrow does not weaken the post-commit contract: log() still resolves on the same repo', async () => {
    const repo = makeRepo({ log: mock.fn(async () => { throw new Error('db down'); }) });
    const { logger } = makeLogger();
    const service = new AuditService(repo, logger);

    await assert.rejects(() => service.logOrThrow(entry));
    await service.log(entry); // must not throw — a committed mutation is never turned into a 500
  });

  it('in-transaction mode forwards the tx client, throws, and never retries', async () => {
    const seen: unknown[] = [];
    const repo = makeRepo({
      log: mock.fn(async (_entry: AuditLogEntry, tx?: AuditTransactionClient) => {
        seen.push(tx);
        throw new Error('audit insert failed');
      }),
    });
    const { errors, logger } = makeLogger();
    const tx = { auditLog: {} } as unknown as AuditTransactionClient;

    await assert.rejects(() => new AuditService(repo, logger).log(entry, tx), /audit insert failed/);

    assert.deepEqual(seen, [tx]);
    assert.equal(errors.length, 0);
  });

  it('sanitizes metadata in in-transaction mode as well', async () => {
    const logged: AuditLogEntry[] = [];
    const repo = makeRepo({ log: mock.fn(async (received: AuditLogEntry) => { logged.push(received); }) });
    const tx = {} as unknown as AuditTransactionClient;

    await new AuditService(repo, makeLogger().logger)
      .log({ ...entry, metadataJson: { password: 'p', grandTotalAmount: '10.00' } }, tx);

    assert.deepEqual(logged[0]?.metadataJson, { password: '[REDACTED]', grandTotalAmount: '10.00' });
  });
});

describe('PrismaAuditRepository.getCompanyLogs (unit)', () => {
  it('passes actorUserId filter to where clause when provided', async () => {
    const calls: unknown[] = [];
    // ponytail: stub Prisma client inline — no test framework needed
    const prismaStub = {
      client: {
        auditLog: {
          findMany: mock.fn(async (args: unknown) => { calls.push(args); return []; }),
          count: mock.fn(async () => 0),
        },
      },
    };

    const { PrismaAuditRepository } = await import('./infrastructure/prisma-audit.repository');
    const repo = new PrismaAuditRepository(prismaStub as any);
    await repo.getCompanyLogs({ companyId: 'co-1', actorUserId: 'u-99', page: 1, pageSize: 10 });

    assert.equal(calls.length, 1);
    const where = (calls[0] as any).where;
    assert.equal(where.companyId, 'co-1');
    assert.equal(where.actorUserId, 'u-99');
  });

  it('passes audit category filter to where clause when provided', async () => {
    const calls: unknown[] = [];
    const prismaStub = {
      client: {
        auditLog: {
          findMany: mock.fn(async (args: unknown) => { calls.push(args); return []; }),
          count: mock.fn(async () => 0),
        },
      },
    };

    const { PrismaAuditRepository } = await import('./infrastructure/prisma-audit.repository');
    const repo = new PrismaAuditRepository(prismaStub as any);
    await repo.getCompanyLogs({ companyId: 'co-1', categories: ['admin', 'security'], page: 1, pageSize: 10 });

    const where = (calls[0] as any).where;
    assert.deepEqual(
      where.OR.map((entry: any) => entry.action.startsWith),
      ['admin.', 'auth.', 'identity.', 'audit.', 'ai.'],
    );
  });

  it('surfaces the typed actor (actorType/actorRefId) in mapped read records', async () => {
    const row = {
      id: 'log-1', createdAt: new Date('2024-01-01'),
      actorType: 'SYSTEM', actorUserId: null, actorRefId: 'document-number',
      companyId: 'co-1', action: 'document.number.commit', targetType: 'document_number',
      targetId: 't-1', requestId: 'req-1', result: 'SUCCESS', riskLevel: 'LOW', metadataJson: null,
    };
    const prismaStub = {
      client: { auditLog: { findMany: mock.fn(async () => [row]), count: mock.fn(async () => 1) } },
    };

    const { PrismaAuditRepository } = await import('./infrastructure/prisma-audit.repository');
    const repo = new PrismaAuditRepository(prismaStub as any);
    const { data } = await repo.getCompanyLogs({ companyId: 'co-1', page: 1, pageSize: 10 });

    assert.equal(data[0]?.actorType, 'SYSTEM');
    assert.equal(data[0]?.actorRefId, 'document-number');
    assert.equal(data[0]?.actorUserId, undefined);
  });
});

describe('PrismaAuditRepository.log typed actor (unit)', () => {
  const makeRepo = async () => {
    const created: any[] = [];
    const prismaStub = {
      client: { auditLog: { create: mock.fn(async (args: any) => { created.push(args.data); }) } },
    };
    const { PrismaAuditRepository } = await import('./infrastructure/prisma-audit.repository');
    return { repo: new PrismaAuditRepository(prismaStub as any), created };
  };

  const baseEntry: AuditLogEntry = {
    action: 'test.action', targetType: 'test', requestId: 'req-1', result: 'SUCCESS',
  };

  it('stores a USER actor with the id in actorUserId and a null actorRefId', async () => {
    const { repo, created } = await makeRepo();
    await repo.log({ ...baseEntry, actorUserId: 'user-1' });
    assert.equal(created[0].actorType, 'USER');
    assert.equal(created[0].actorUserId, 'user-1');
    assert.equal(created[0].actorRefId, null);
  });

  it('stores a SYSTEM actor with actorRefId and a NULL actorUserId', async () => {
    const { repo, created } = await makeRepo();
    // Even a stray actorUserId must never reach the User FK for a non-USER actor.
    await repo.log({ ...baseEntry, actorType: 'SYSTEM', actorUserId: 'user-1', actorRefId: 'scan-crm-sla' });
    assert.equal(created[0].actorType, 'SYSTEM');
    assert.equal(created[0].actorUserId, null);
    assert.equal(created[0].actorRefId, 'scan-crm-sla');
  });

  it('defaults an omitted actorType to USER (backward compatible)', async () => {
    const { repo, created } = await makeRepo();
    await repo.log(baseEntry);
    assert.equal(created[0].actorType, 'USER');
    assert.equal(created[0].actorUserId, null);
    assert.equal(created[0].actorRefId, null);
  });
});

describe('AuditController role/category filters', () => {
  const makeController = (calls: unknown[]) =>
    new AuditController({
      getCompanyLogs: async (params: unknown) => {
        calls.push(params);
        return { data: [], total: 0 };
      },
    } as any);

  const makeRequest = (roles: string[]) => ({
    context: {
      requestId: 'req-1',
      authSubject: 'u-1',
      userId: 'u-1',
      companyId: 'co-1',
      membershipId: 'm-1',
      roles,
      permissions: ['audit.log.read'],
      scopes: {},
      authProvider: 'dev',
    },
  } as any);

  it('uses a company-explicit route instead of relying on an optional tenant header', () => {
    assert.equal(Reflect.getMetadata(PATH_METADATA, AuditController), 'companies/:companyId/audit');
  });

  it('allows OWNER full company audit visibility', async () => {
    const calls: unknown[] = [];
    await makeController(calls).getLogs(makeRequest(['OWNER']), 'co-1');

    const params = calls[0] as any;
    assert.equal(params.actorUserId, undefined);
    assert.equal(params.categories, undefined);
  });

  it('limits ADMIN to admin/security categories', async () => {
    const calls: unknown[] = [];
    await makeController(calls).getLogs(makeRequest(['ADMIN']), 'co-1');

    const params = calls[0] as any;
    assert.equal(params.actorUserId, undefined);
    assert.deepEqual(params.categories, ['admin', 'security']);
  });

  it('limits ACCOUNTANT to accounting/tax/finance categories', async () => {
    const calls: unknown[] = [];
    await makeController(calls).getLogs(makeRequest(['ACCOUNTANT']), 'co-1');

    const params = calls[0] as any;
    assert.equal(params.actorUserId, undefined);
    assert.deepEqual(params.categories, ['accounting', 'tax', 'finance']);
  });

  it('rejects a route company that differs from the resolved request context', async () => {
    const calls: unknown[] = [];

    await assert.rejects(
      () => makeController(calls).getLogs(makeRequest(['OWNER']), 'co-2'),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.equal(calls.length, 0);
  });
});
