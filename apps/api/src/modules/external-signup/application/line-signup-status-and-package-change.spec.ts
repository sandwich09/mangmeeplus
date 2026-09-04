import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { GetLineSignupStatusUseCase } from './get-line-signup-status.use-case';
import { PackageChangeRequestUseCase } from './package-change-request.use-case';

const NOW = new Date('2026-09-03T10:00:00+07:00');

const CONFIG = { lineSignupBusinessDays: 'MON-SAT', lineSignupBusinessHours: '09:00-18:00' } as any;

function statusHarness(row: any, verifyThrows?: Error) {
  const queries: any[] = [];
  const prisma = {
    client: {
      companySignupRequest: {
        findFirst: async (args: any) => { queries.push(args); return row; },
      },
    },
  } as any;
  const lineIdToken = {
    verify: async () => {
      if (verifyThrows) throw verifyThrows;
      return { providerUserId: 'Uline-1', channelId: 'channel-1' };
    },
  } as any;
  return { useCase: new GetLineSignupStatusUseCase(prisma, CONFIG, lineIdToken), queries };
}

describe('GetLineSignupStatusUseCase', () => {
  it('answers for the LINE account the token proves and no other', async () => {
    const h = statusHarness({ id: 'signup-1', state: 'PENDING_REVIEW', companyName: 'ร้านมั่งมี', companyId: null });
    const status = await h.useCase.execute('aaaa.bbbb.cccc', NOW);

    assert.deepEqual(status, {
      requestId: 'signup-1', state: 'PENDING_REVIEW', companyName: 'ร้านมั่งมี', businessHours: true,
    });
    // Scoped by identity, not by a caller-supplied id: there is nothing here to enumerate.
    assert.equal(h.queries[0].where.lineProviderUserId, 'Uline-1');
    assert.equal(h.queries[0].where.lineChannelId, 'channel-1');
    assert.equal(h.queries[0].where.source, 'line-oa');
    assert.deepEqual(h.queries[0].orderBy, { createdAt: 'desc' });
  });

  it('hands back the shop id once it exists, so the page can open it', async () => {
    const h = statusHarness({ id: 'signup-1', state: 'COMPLETED', companyName: 'ร้านมั่งมี', companyId: 'co-1' });
    const status = await h.useCase.execute('aaaa.bbbb.cccc', NOW);
    assert.equal(status?.companyId, 'co-1');
  });

  it('answers null for a LINE account that never applied', async () => {
    assert.equal(await statusHarness(null).useCase.execute('aaaa.bbbb.cccc', NOW), null);
  });

  it('reads nothing when the token does not verify', async () => {
    const h = statusHarness(null, new UnauthorizedException('bad token'));
    await assert.rejects(() => h.useCase.execute('aaaa.bbbb.cccc', NOW), UnauthorizedException);
    assert.deepEqual(h.queries, []);
  });
});

function packageHarness(options: {
  createThrows?: unknown;
  openRow?: any;
  rows?: any[];
  /** Roles the caller holds in the company; no membership at all when null. */
  roles?: string[] | null;
} = {}) {
  const audits: any[] = [];
  const rows: any[] = [];
  const prisma = {
    client: {
      companyMembership: {
        findFirst: async () => (options.roles === null
          ? null
          : { roles: (options.roles ?? ['OWNER']).map((key) => ({ role: { key } })) }),
      },
      packageChangeRequest: {
        findFirst: async () => options.openRow ?? null,
        findMany: async () => options.rows ?? [],
      },
      $transaction: async (fn: any) => fn({
        packageChangeRequest: {
          create: async (args: any) => {
            if (options.createThrows) throw options.createThrows;
            const row = {
              id: 'pcr-1', status: 'OPEN', note: null, decidedAt: null,
              createdAt: new Date('2026-09-03T03:00:00.000Z'), ...args.data,
            };
            rows.push(row);
            return row;
          },
        },
        auditLog: { create: async (args: any) => { audits.push(args); return {}; } },
      }),
    },
  } as any;
  return { useCase: new PackageChangeRequestUseCase(prisma), audits, rows };
}

describe('PackageChangeRequestUseCase', () => {
  const cmd = {
    companyId: 'co-1', requestedByUserId: 'user-1', requestedTierKey: 'PRO_999', requestId: 'req-1',
  };

  it('opens a request and audits it without touching the tier', async () => {
    const h = packageHarness();
    const dto = await h.useCase.create(cmd);

    assert.equal(dto.status, 'OPEN');
    assert.equal(dto.requestedTierKey, 'PRO_999');
    assert.equal(h.audits[0].data.action, 'signup.line.package_change_requested');
    // Asking is not granting: nothing here writes a plan term.
    assert.equal(JSON.stringify(h.rows).includes('monthlySlipLimit'), false);
  });

  // Review LOW-2: the route's `company.setup.manage` permission is also held by a default ADMIN,
  // but spec §4 puts this decision with the OWNER — it is about what the shop PAYS.
  it('refuses a member who can edit settings but does not own the shop', async () => {
    for (const roles of [['ADMIN'], ['MANAGER', 'FINANCE'], []]) {
      const h = packageHarness({ roles });
      await assert.rejects(() => h.useCase.create(cmd), (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.match(JSON.stringify((error as ForbiddenException).getResponse()), /owner_role_required/);
        return true;
      });
      assert.deepEqual(h.audits, [], String(roles));
    }
  });

  it('refuses a caller with no active membership in the company at all', async () => {
    const h = packageHarness({ roles: null });
    await assert.rejects(() => h.useCase.create(cmd), ForbiddenException);
  });

  it('refuses a tier that is not in the catalog', async () => {
    const h = packageHarness();
    await assert.rejects(
      () => h.useCase.create({ ...cmd, requestedTierKey: 'PLATINUM_9999' }),
      UnprocessableEntityException,
    );
    assert.deepEqual(h.audits, []);
  });

  it('is idempotent: a second ask returns the OPEN request rather than queueing a duplicate', async () => {
    const open = {
      id: 'pcr-1', companyId: 'co-1', requestedTierKey: 'PRO_999', status: 'OPEN',
      note: null, createdAt: new Date('2026-09-03T03:00:00.000Z'), decidedAt: null,
    };
    const h = packageHarness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }), openRow: open });
    const dto = await h.useCase.create(cmd);

    assert.equal(dto.id, 'pcr-1');
    assert.deepEqual(h.audits, [], 'the same ask is not audited twice');
  });

  it('surfaces a unique violation with no OPEN row behind it instead of inventing one', async () => {
    const h = packageHarness({ createThrows: Object.assign(new Error('unique'), { code: 'P2002' }) });
    await assert.rejects(() => h.useCase.create(cmd), /unique/);
  });

  it('lists a company own requests newest first', async () => {
    const h = packageHarness({
      rows: [{
        id: 'pcr-2', companyId: 'co-1', requestedTierKey: 'BASIC_499', status: 'APPROVED',
        note: 'ขอเพิ่มสาขา', createdAt: new Date('2026-09-01T00:00:00.000Z'),
        decidedAt: new Date('2026-09-02T00:00:00.000Z'),
      }],
    });
    const list = await h.useCase.listForCompany('co-1');
    assert.equal(list[0]!.status, 'APPROVED');
    assert.equal(list[0]!.note, 'ขอเพิ่มสาขา');
    assert.equal(list[0]!.decidedAt, '2026-09-02T00:00:00.000Z');
  });
});
