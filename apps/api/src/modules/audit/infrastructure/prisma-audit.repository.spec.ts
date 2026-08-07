import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PrismaService } from '../../../common/database/prisma.service';
import type { AuditTransactionClient } from '../domain/ports/audit-repository.port';
import { PrismaAuditRepository } from './prisma-audit.repository';

describe('PrismaAuditRepository', () => {
  it('preserves USER audits when the typed actor migration is not applied yet', async () => {
    const calls: unknown[] = [];
    const rawCalls: unknown[] = [];
    const create = async (args: unknown) => {
      calls.push(args);
      throw Object.assign(new Error('column actorType of relation AuditLog does not exist'), { code: 'P2022' });
    };
    const $executeRaw = async (...args: unknown[]) => { rawCalls.push(args); return 1; };
    const repo = new PrismaAuditRepository({ client: { auditLog: { create }, $executeRaw } } as unknown as PrismaService);

    await repo.log({ actorUserId: 'user-1', companyId: 'company-1', action: 'inventory.product.created', targetType: 'product', requestId: 'request-1', result: 'SUCCESS' });

    assert.equal(calls.length, 1);
    assert.equal(rawCalls.length, 1);
    assert.doesNotMatch(String((rawCalls[0] as unknown[][])[0]), /actorType|actorRefId/);
  });

  it('writes on the caller transaction client instead of the root client (L-10)', async () => {
    const rootCalls: unknown[] = [];
    const txCalls: unknown[] = [];
    const repo = new PrismaAuditRepository({
      client: { auditLog: { create: async (args: unknown) => { rootCalls.push(args); } } },
    } as unknown as PrismaService);
    const tx = { auditLog: { create: async (args: unknown) => { txCalls.push(args); } } } as unknown as AuditTransactionClient;

    await repo.log(
      { actorUserId: 'user-1', companyId: 'company-1', action: 'ledger.period.close', targetType: 'accounting_period', requestId: 'req-2', result: 'SUCCESS', riskLevel: 'CRITICAL' },
      tx,
    );

    assert.equal(rootCalls.length, 0);
    assert.equal(txCalls.length, 1);
    assert.equal((txCalls[0] as { data: { action: string } }).data.action, 'ledger.period.close');
  });

  it('propagates an in-transaction insert failure so the caller transaction rolls back (L-10)', async () => {
    const repo = new PrismaAuditRepository({
      client: { auditLog: { create: async () => {} } },
    } as unknown as PrismaService);
    const tx = { auditLog: { create: async () => { throw new Error('insert failed'); } } } as unknown as AuditTransactionClient;

    await assert.rejects(
      () => repo.log({ action: 'ledger.period.close', targetType: 'accounting_period', requestId: 'req-3', result: 'SUCCESS' }, tx),
      /insert failed/,
    );
  });
});
