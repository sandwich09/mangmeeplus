/**
 * The operator boundary for held AI credit (hold-reconciliation spec §4): reason, company lock,
 * sweep-before-read, DTO shape and the typed refusals the web translates.
 *
 * The engine's own fences live in `company-ai-budget-reservation.spec.ts`, and whether the locks
 * really serialize two operators is `company-ai-credit-holds.pg.spec.ts` against real PostgreSQL.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PartnerAiCreditHoldsUseCase } from './partner-ai-credit-holds.use-case';

const NOW = new Date('2026-09-18T04:00:00.000Z'); // 2026-09-18 11:00 Bangkok

/** The stable `code` a typed refusal carries, whatever exception class it arrived in. */
const refusalCode = (error: unknown): unknown => {
  const body = (error as HttpException).getResponse();
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['code'] : body;
};

type Hold = {
  id: string; companyId: string; status: string; stepKind: string; bucket: string; sourceRoute: string;
  requestKind: string | null; upperBoundSatang: number; settledCostSatang: number | null;
  monthKey: string; createdAt: Date; dispatchedAt: Date | null; invocationKey: string;
  breach: boolean; breachAcknowledgedAt: Date | null;
};

const hold = (over: Partial<Hold> = {}): Hold => ({
  id: 'res-1', companyId: 'c1', status: 'UNRESOLVED', stepKind: 'receipt-ocr', bucket: 'OCR',
  sourceRoute: 'receipt-ocr-web', requestKind: 'IMAGE', upperBoundSatang: 47, settledCostSatang: null,
  monthKey: '2026-09', createdAt: new Date('2026-09-16T03:00:00.000Z'), dispatchedAt: new Date('2026-09-16T03:00:01.000Z'),
  invocationKey: `c1#${'a'.repeat(32)}#receipt-ocr#0`, breach: false, breachAcknowledgedAt: null,
  ...over,
});

/**
 * One fake for both halves: the read (company + sweep + list) and the actions (company + engine).
 * `sweeps` records the advisory-lock keys, which is how "it sweeps both months first" is asserted.
 */
function fakePrisma(options: { status?: string; holds?: Hold[]; row?: Hold | null; count?: number; liveMonths?: string[] } = {}) {
  const sweeps: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const listed: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: async (strings: unknown, ...values: unknown[]) => { sweeps.push(String(values[0])); return 0; },
    aiBudgetReservation: {
      updateMany: async (args: Record<string, unknown>) => { updates.push(args); return { count: options.count ?? 1 }; },
    },
    auditLog: { create: async (args: { data: Record<string, unknown> }) => { audits.push(args.data); return args.data; } },
  };
  const client = {
    company: { findUnique: async () => (options.status === 'MISSING' ? null : { status: options.status ?? 'ACTIVE' }) },
    aiBudgetReservation: {
      findUnique: async () => (options.row === undefined ? hold() : options.row),
      // The read asks twice: the months still holding a pre-terminal row (`distinct`), then the page.
      findMany: async (args: Record<string, unknown>) => {
        if (args['distinct']) return (options.liveMonths ?? []).map((monthKey) => ({ monthKey }));
        listed.push(args); return options.holds ?? [];
      },
    },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };
  return { prisma: { client } as never, sweeps, updates, audits, listed };
}

const COMMAND = {
  companyId: 'c1', reservationId: 'res-1', reason: 'ตรวจกับผู้ให้บริการแล้ว',
  requestingAdminUserId: 'admin-1', requestId: 'req-1', now: NOW,
};

describe('PartnerAiCreditHoldsUseCase.read (hold spec §4.1)', () => {
  it('runs the same lazy sweep for the current AND previous Bangkok month before listing', async () => {
    const { prisma, sweeps, listed } = fakePrisma();

    const result = await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW });

    // The sweep is lazy by design, so a quiet company would otherwise show DISPATCHED rows that
    // admission has already decided are UNRESOLVED.
    assert.deepEqual(sweeps, ['ai-budget:c1:2026-09', 'ai-budget:c1:2026-08']);
    assert.deepEqual(result.monthKeys, ['2026-09', '2026-08']);
    assert.equal((listed[0]!['where'] as { monthKey?: unknown }).monthKey, undefined, 'the list covers every month (add-on C11)');
    assert.ok(sweeps.every((key, index) => sweeps.indexOf(key) === index), 'one sweep per month');
  });

  it('also sweeps any older month that still holds a live row, and pages the list with a cursor (add-on C11)', async () => {
    const holds = Array.from({ length: 101 }, (_, index) => hold({ id: `res-${index}`, monthKey: '2026-05',
      createdAt: new Date(Date.UTC(2026, 4, 20, 0, 0, 100 - index)) }));
    const { prisma, sweeps, listed } = fakePrisma({ liveMonths: ['2026-05', '2026-09'], holds });

    const first = await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW });

    assert.deepEqual(sweeps, ['ai-budget:c1:2026-09', 'ai-budget:c1:2026-08', 'ai-budget:c1:2026-05']);
    assert.deepEqual(first.monthKeys, ['2026-09', '2026-08', '2026-05']);
    assert.equal(first.items.length, 100);
    assert.equal(first.nextCursor, `${holds[99]!.createdAt.toISOString()}_res-99`);
    assert.equal(listed[0]!['take'], 101);

    await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW, cursor: first.nextCursor! });
    assert.deepEqual((listed[1]!['where'] as { AND: unknown }).AND, [{ OR: [{ createdAt: { lt: holds[99]!.createdAt } },
      { createdAt: holds[99]!.createdAt, id: { lt: 'res-99' } }] }]);
    await assert.rejects(new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW, cursor: 'nonsense' }),
      (error: unknown) => error instanceof UnprocessableEntityException);
  });

  it('maps a hold to money, ids and declared kinds — never a message', async () => {
    const { prisma } = fakePrisma({ holds: [hold()] });

    const result = await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW });

    assert.deepEqual(result.items[0], {
      id: 'res-1', status: 'UNRESOLVED', kind: 'UNRESOLVED_HOLD', stepKind: 'receipt-ocr', bucket: 'OCR',
      sourceRoute: 'receipt-ocr-web', requestKind: 'IMAGE', upperBoundSatang: 47, settledCostSatang: null,
      monthKey: '2026-09', createdAt: '2026-09-16T03:00:00.000Z', dispatchedAt: '2026-09-16T03:00:01.000Z',
      invocationKeyShort: 'aaaaaaaa…#receipt-ocr#0',
    });
  });

  it('reads an unknown stored bucket or request kind as UNKNOWN rather than asserting it through', async () => {
    const { prisma } = fakePrisma({ holds: [hold({ bucket: 'SOMETHING', requestKind: null })] });
    const result = await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW });
    assert.equal(result.items[0]!.bucket, 'UNKNOWN');
    assert.equal(result.items[0]!.requestKind, 'UNKNOWN');
  });

  it('labels a breach row by its breach and carries the settled actual', async () => {
    const { prisma } = fakePrisma({ holds: [hold({ status: 'SETTLED', breach: true, settledCostSatang: 60 })] });
    const result = await new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'c1', canManage: true, now: NOW });
    assert.equal(result.items[0]!.kind, 'BREACH');
    assert.equal(result.items[0]!.status, 'SETTLED');
    assert.equal(result.items[0]!.settledCostSatang, 60);
  });

  it('reports canManage and companyLocked so the page shows the table without buttons', async () => {
    const readOnly = await new PartnerAiCreditHoldsUseCase(fakePrisma().prisma)
      .read({ companyId: 'c1', canManage: false, now: NOW });
    assert.equal(readOnly.canManage, false);
    assert.equal(readOnly.companyLocked, false);

    const locked = await new PartnerAiCreditHoldsUseCase(fakePrisma({ status: 'ARCHIVED' }).prisma)
      .read({ companyId: 'c1', canManage: true, now: NOW });
    assert.equal(locked.companyLocked, true);
    assert.equal(locked.canManage, true, 'the permission and the company status are different facts');
  });

  it('404s an unknown company instead of sweeping it', async () => {
    const { prisma, sweeps } = fakePrisma({ status: 'MISSING' });
    await assert.rejects(
      new PartnerAiCreditHoldsUseCase(prisma).read({ companyId: 'nope', canManage: true, now: NOW }),
      NotFoundException,
    );
    assert.deepEqual(sweeps, []);
  });
});

describe('PartnerAiCreditHoldsUseCase actions (hold spec §4.2)', () => {
  const actions = ['release', 'chargeAtBound', 'acknowledgeBreach'] as const;

  for (const action of actions) {
    it(`${action} refuses an empty or over-long reason before touching money`, async () => {
      const { prisma, updates } = fakePrisma({ row: hold({ breach: true, status: 'SETTLED' }) });
      const useCase = new PartnerAiCreditHoldsUseCase(prisma);
      for (const reason of ['', '   ', 'x'.repeat(501)]) {
        await assert.rejects(useCase[action]({ ...COMMAND, reason }), (error: unknown) => {
          assert.ok(error instanceof UnprocessableEntityException);
          assert.match(String((error as Error).message), /partner_adjustment_reason_required/);
          return true;
        });
      }
      assert.deepEqual(updates, []);
    });

    it(`${action} refuses a DISABLED or ARCHIVED company`, async () => {
      for (const status of ['DISABLED', 'ARCHIVED']) {
        const { prisma, updates } = fakePrisma({ status, row: hold({ breach: true, status: 'SETTLED' }) });
        await assert.rejects(new PartnerAiCreditHoldsUseCase(prisma)[action](COMMAND), UnprocessableEntityException);
        assert.deepEqual(updates, [], `${status} must write nothing`);
      }
    });

    it(`${action} 404s an unknown company`, async () => {
      const { prisma } = fakePrisma({ status: 'MISSING' });
      await assert.rejects(new PartnerAiCreditHoldsUseCase(prisma)[action](COMMAND), NotFoundException);
    });
  }

  it('release trims the reason, answers the terminal status and takes the company-month lock', async () => {
    const { prisma, sweeps, updates } = fakePrisma();

    const result = await new PartnerAiCreditHoldsUseCase(prisma).release({ ...COMMAND, reason: '  ปล่อยคืน  ' });

    assert.deepEqual(result, { id: 'res-1', action: 'release', status: 'CANCELLED', chargedSatang: 0 });
    assert.deepEqual(sweeps, ['ai-budget:c1:2026-09']);
    assert.equal(((updates[0]!['data'] as { evidenceJson: { operator: { reason: string } } })
      .evidenceJson.operator.reason), 'ปล่อยคืน');
  });

  it('acknowledge answers with no money moved', async () => {
    const { prisma } = fakePrisma({ row: hold({ status: 'SETTLED', breach: true, settledCostSatang: 60 }) });
    const result = await new PartnerAiCreditHoldsUseCase(prisma).acknowledgeBreach(COMMAND);
    assert.deepEqual(result, { id: 'res-1', action: 'acknowledge_breach', status: 'SETTLED', chargedSatang: 0 });
  });

  it('maps a lost fence to 409 partner_ai_credit_hold_already_resolved', async () => {
    const { prisma } = fakePrisma({ count: 0 });
    await assert.rejects(new PartnerAiCreditHoldsUseCase(prisma).release(COMMAND), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(refusalCode(error), 'partner_ai_credit_hold_already_resolved');
      return true;
    });
  });

  it('maps a repeated acknowledgement to its own 409 code', async () => {
    const { prisma } = fakePrisma({ row: hold({ status: 'SETTLED', breach: true }), count: 0 });
    await assert.rejects(new PartnerAiCreditHoldsUseCase(prisma).acknowledgeBreach(COMMAND), (error: unknown) => {
      assert.equal(refusalCode(error), 'partner_ai_credit_breach_already_acknowledged');
      return true;
    });
  });

  it('maps a missing hold, another tenant id and a non-breach row to 404 with a typed code', async () => {
    for (const row of [null, hold({ companyId: 'other-co', breach: true }), hold({ breach: false })] as Array<Hold | null>) {
      const { prisma } = fakePrisma({ row });
      // The second case is acknowledge on a row with no breach at all.
      await assert.rejects(new PartnerAiCreditHoldsUseCase(prisma).acknowledgeBreach(COMMAND), (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(refusalCode(error), 'partner_ai_credit_hold_not_found');
        return true;
      });
    }
  });

  it('maps an engine failure to a retryable typed code rather than leaking a stack', async () => {
    // A transaction that throws: the engine catches it, logs ids only and reports `failed`.
    const client = {
      company: { findUnique: async () => ({ status: 'ACTIVE' }) },
      aiBudgetReservation: { findUnique: async () => hold() },
      $transaction: async () => { throw new Error('deadlock detected'); },
    };
    await assert.rejects(
      new PartnerAiCreditHoldsUseCase({ client } as never).release(COMMAND),
      (error: unknown) => {
        assert.ok(error instanceof UnprocessableEntityException);
        assert.equal(refusalCode(error), 'partner_ai_credit_hold_action_failed');
        return true;
      },
    );
  });
});
