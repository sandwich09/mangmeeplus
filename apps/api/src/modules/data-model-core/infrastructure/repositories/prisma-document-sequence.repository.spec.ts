import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaDocumentSequenceRepository } from './prisma-document-sequence.repository';

const now = new Date('2026-06-24T00:00:00.000Z');

const sequenceRow = {
  id: 'seq-1',
  companyId: 'co-1',
  branchId: null,
  branchScopeKey: 'GLOBAL',
  documentType: 'invoice',
  periodKey: 'ALL',
  prefixTemplate: 'INV-{SEQ}',
  nextNumber: 7,
  padding: 5,
  resetPolicy: 'NONE',
  status: 'ACTIVE',
  createdAt: now,
  updatedAt: now,
};

const numberRow = {
  id: 'num-1',
  companyId: 'co-1',
  branchId: null,
  sequenceId: 'seq-1',
  documentType: 'invoice',
  documentNumber: 'INV-00007',
  status: 'RESERVED',
  ownerType: null,
  ownerId: null,
  idempotencyKey: 'idem-1',
  reservedByUserId: 'user-1',
  reservedAt: now,
  committedAt: null,
  cancelledAt: null,
  voidedAt: null,
  sequence: sequenceRow,
};

function makeRepo(txOverrides: Record<string, any> = {}, clientOverrides: Record<string, any> = {}) {
  const tx = {
    documentNumber: {
      findFirst: mock.fn(async () => null),
      create: mock.fn(async (args: any) => ({ ...numberRow, ...args.data })),
      update: mock.fn(async (args: any) => ({ ...numberRow, ...args.data })),
    },
    documentSequence: {
      findFirst: mock.fn(async () => sequenceRow),
      upsert: mock.fn(),
      update: mock.fn(async () => ({ ...sequenceRow, nextNumber: 8 })),
    },
    branch: { findFirst: mock.fn(async () => null) },
    ...txOverrides,
  };
  const client = {
    $transaction: mock.fn(async (fn: (arg: typeof tx) => unknown) => fn(tx)),
    documentNumber: {
      findFirst: mock.fn(async () => numberRow),
      update: mock.fn(async (args: any) => ({ ...numberRow, ...args.data })),
    },
    ...clientOverrides,
  };
  return { repo: new PrismaDocumentSequenceRepository({ client } as any), tx, client };
}

describe('PrismaDocumentSequenceRepository', () => {
  it('rejects same idempotency key with different period', async () => {
    const { repo } = makeRepo({
      documentNumber: {
        findFirst: mock.fn(async () => ({ ...numberRow, sequence: { ...sequenceRow, periodKey: '2026-06' } })),
        create: mock.fn(),
      },
    });
    await assert.rejects(
      () => repo.reserveNumber({
        companyId: 'co-1',
        documentType: 'invoice',
        periodKey: '2026-07',
        idempotencyKey: 'idem-1',
        reservedByUserId: 'user-1',
      }),
      ConflictException,
    );
  });

  it('allocates using incremented sequence row without duplicating visible numbers', async () => {
    const { repo, tx } = makeRepo();
    const result = await repo.reserveNumber({
      companyId: 'co-1',
      documentType: 'invoice',
      periodKey: 'ALL',
      idempotencyKey: 'idem-1',
      reservedByUserId: 'user-1',
    });

    assert.equal(result.documentNumber, 'INV-00007');
    assert.equal((tx.documentSequence.update.mock.calls as any[])[0]?.arguments[0].data.nextNumber.increment, 1);
  });

  it('reuses reserve and commit logic inside a caller-owned transaction', async () => {
    let findCount = 0;
    const { repo, tx, client } = makeRepo({
      documentNumber: {
        findFirst: mock.fn(async () => findCount++ === 0 ? null : numberRow),
        create: mock.fn(async (args: any) => ({ ...numberRow, ...args.data })),
        update: mock.fn(async (args: any) => ({ ...numberRow, ...args.data })),
      },
    });
    const reserved = await repo.reserveNumberInTransaction(tx as any, {
      companyId: 'co-1', documentType: 'invoice', periodKey: 'ALL',
      idempotencyKey: 'idem-1', reservedByUserId: 'user-1',
    });
    const committed = await repo.commitNumberInTransaction(tx as any, {
      id: reserved.id, companyId: 'co-1', ownerType: 'reimbursement_request', ownerId: 'rb-1',
    });
    assert.equal(committed.status, 'COMMITTED');
    assert.equal(client.$transaction.mock.callCount(), 0, 'caller-owned helpers must not nest a transaction');
  });

  it('lazily provisions the system default on first use', async () => {
    let created: any;
    const upsert = mock.fn(async (args: any) => {
      created = { id: 'seq-expense', createdAt: now, updatedAt: now, ...args.create };
      return created;
    });
    const { repo } = makeRepo({
      documentSequence: {
        findFirst: mock.fn(async () => null),
        upsert,
        update: mock.fn(async () => ({ ...created, nextNumber: 2 })),
      },
    });

    const result = await repo.reserveNumber({
      companyId: 'co-1',
      documentType: 'expense.record',
      periodKey: '2026-07',
      idempotencyKey: 'expense-1',
      reservedByUserId: 'user-1',
    });

    const create = (upsert.mock.calls as any[])[0]?.arguments[0].create;
    assert.equal(create.prefixTemplate, 'EXP-{YYYY}{MM}-{SEQ}');
    assert.equal(create.resetPolicy, 'MONTHLY');
    assert.equal(create.padding, 5);
    assert.equal(result.documentNumber, 'EXP-202607-00001');
  });

  it('formats monthly and yearly sequences from the canonical period instead of the wall clock', async () => {
    for (const [periodKey, expected] of [['1999-02', 'INV-199902-00007'], ['1999', 'INV-199901-00007']] as const) {
      const { repo } = makeRepo({
        documentSequence: {
          findFirst: mock.fn(async () => ({ ...sequenceRow, periodKey, prefixTemplate: 'INV-{YYYY}{MM}-{SEQ}' })),
          upsert: mock.fn(),
          update: mock.fn(async () => ({ ...sequenceRow, periodKey, nextNumber: 8 })),
        },
      });
      const result = await repo.reserveNumber({
        companyId: 'co-1', documentType: 'invoice', periodKey,
        idempotencyKey: `period-${periodKey}`, reservedByUserId: 'user-1',
      });
      assert.equal(result.documentNumber, expected);
    }
  });

  it('inherits the latest active configuration into a missing period', async () => {
    const previous = {
      ...sequenceRow,
      prefixTemplate: 'CUSTOM-{SEQ}',
      padding: 4,
      resetPolicy: 'MONTHLY',
      periodKey: '2026-06',
    };
    let findCount = 0;
    let created: any;
    const upsert = mock.fn(async (args: any) => {
      created = { id: 'seq-next', createdAt: now, updatedAt: now, ...args.create };
      return created;
    });
    const { repo } = makeRepo({
      documentSequence: {
        findFirst: mock.fn(async () => findCount++ === 0 ? null : previous),
        upsert,
        update: mock.fn(async () => ({ ...created, nextNumber: 2 })),
      },
    });

    const result = await repo.reserveNumber({
      companyId: 'co-1',
      documentType: 'accounting.invoice',
      periodKey: '2026-07',
      idempotencyKey: 'invoice-1',
      reservedByUserId: 'user-1',
    });

    assert.equal((upsert.mock.calls as any[])[0]?.arguments[0].create.prefixTemplate, 'CUSTOM-{SEQ}');
    assert.equal(result.documentNumber, 'CUSTOM-0001');
  });

  it('does not bypass a disabled latest configuration', async () => {
    let findCount = 0;
    const upsert = mock.fn();
    const { repo } = makeRepo({
      documentSequence: {
        findFirst: mock.fn(async () => findCount++ === 0 ? null : { ...sequenceRow, status: 'DISABLED' }),
        upsert,
        update: mock.fn(),
      },
    });

    await assert.rejects(
      () => repo.reserveNumber({
        companyId: 'co-1',
        documentType: 'expense.record',
        periodKey: '2026-07',
        idempotencyKey: 'expense-disabled',
        reservedByUserId: 'user-1',
      }),
      UnprocessableEntityException,
    );
    assert.equal(upsert.mock.callCount(), 0);
  });

  it('keeps unknown unconfigured document types blocked', async () => {
    const upsert = mock.fn();
    const { repo } = makeRepo({
      documentSequence: {
        findFirst: mock.fn(async () => null),
        upsert,
        update: mock.fn(),
      },
    });

    await assert.rejects(
      () => repo.reserveNumber({
        companyId: 'co-1',
        documentType: 'custom.unknown',
        periodKey: '2026-07',
        idempotencyKey: 'unknown-1',
        reservedByUserId: 'user-1',
      }),
      UnprocessableEntityException,
    );
    assert.equal(upsert.mock.callCount(), 0);
  });

  it('only voids committed document numbers', async () => {
    const { repo } = makeRepo({}, {
      documentNumber: {
        findFirst: mock.fn(async () => ({ ...numberRow, status: 'RESERVED' })),
        update: mock.fn(),
      },
    });
    await assert.rejects(() => repo.voidNumber({ id: 'num-1', companyId: 'co-1' }), ConflictException);
  });
});
