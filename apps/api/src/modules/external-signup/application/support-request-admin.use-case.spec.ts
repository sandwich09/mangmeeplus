import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  SUPPORT_REQUEST_ANSWERED_ACTION, SUPPORT_REQUEST_RESUME_ACTION, SupportRequestAdminUseCase,
} from './support-request-admin.use-case';

const REQUEST_ID = 'req-1';
const ADMIN = 'admin-1';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'sr-1',
  status: 'OPEN',
  companyId: 'co-1',
  lineUserId: 'Uline-1',
  lineUserIdHash: 'feedfacefeedface',
  signupRequestId: null,
  requestedAt: new Date('2026-09-05T02:00:00.000Z'),
  lastMessageText: null,
  lineNotifiedCount: 0,
  emailSent: true,
  answeredAt: null,
  answeredByUserId: null,
  closedAt: null,
  closedReason: null,
  ...over,
});

function harness(options: {
  rows?: any[];
  one?: any | null;
  openCount?: number;
  companies?: any[];
  signups?: any[];
  users?: any[];
  pauseCleared?: number;
} = {}) {
  const audits: any[] = [];
  const updates: any[] = [];
  const contextUpdates: any[] = [];
  const queries: any[] = [];

  const prisma = {
    client: {
      lineSupportRequest: {
        findMany: async (args: any) => { queries.push(args); return options.rows ?? []; },
        count: async () => options.openCount ?? (options.rows ?? []).length,
        findUnique: async () => (options.one === undefined ? row() : options.one),
        update: async (args: any) => { updates.push(args); return args; },
      },
      lineCompanyContext: {
        updateMany: async (args: any) => {
          contextUpdates.push(args);
          return { count: options.pauseCleared ?? 1 };
        },
      },
      company: { findMany: async () => options.companies ?? [{ id: 'co-1', name: 'ร้านนิด' }] },
      companySignupRequest: { findMany: async () => options.signups ?? [] },
      user: { findMany: async () => options.users ?? [] },
      auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    },
  } as any;

  return { useCase: new SupportRequestAdminUseCase(prisma), audits, updates, contextUpdates, queries };
}

describe('the support inbox read (line-support-request-spec-th §2.3)', () => {
  it('names the shop, hides the LINE id, and always carries the OPEN count for the nav badge', async () => {
    const h = harness({ rows: [row()], openCount: 4 });
    const result = await h.useCase.list('CLOSED');

    assert.equal(result.openCount, 4, 'the badge count is the OPEN total, not the filtered list');
    assert.equal(h.queries[0].where.status, 'CLOSED');
    assert.deepEqual(h.queries[0].orderBy, [{ status: 'asc' }, { requestedAt: 'desc' }]);

    const [item] = result.items;
    assert.equal(item!.askerLabel, 'ร้านนิด');
    assert.equal(item!.askerRef, 'edface', 'six characters of the hash, and nothing else');
    assert.equal(JSON.stringify(result).includes('Uline-1'), false, '§3: no raw LINE id crosses the API');
    assert.equal(item!.lineNotifiedCount, 0);
    assert.equal(item!.emailSent, true);
  });

  it('names someone still in the funnel by the shop they applied for', async () => {
    const h = harness({
      rows: [row({ companyId: null, signupRequestId: 'sr-signup-1' })],
      companies: [],
      signups: [{ id: 'sr-signup-1', companyName: 'The sun coffee' }],
    });
    const result = await h.useCase.list();

    assert.equal(result.items[0]!.askerLabel, 'ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: The sun coffee)');
    assert.equal(result.items[0]!.signupRequestId, 'sr-signup-1');
    assert.equal(result.items[0]!.companyId, undefined);
    assert.equal(h.queries[0].where, undefined, 'no filter means every status');
  });

  it('answers an empty inbox with the count rather than nothing', async () => {
    const h = harness({ rows: [], openCount: 0 });
    assert.deepEqual(await h.useCase.list('OPEN'), { items: [], openCount: 0 });
  });
});

describe('the two inbox buttons', () => {
  it('records who marked a request answered, and is idempotent on the second click', async () => {
    const h = harness();
    assert.deepEqual(await h.useCase.markAnswered('sr-1', ADMIN, REQUEST_ID), { id: 'sr-1', status: 'ANSWERED' });
    assert.equal(h.updates[0].data.answeredByUserId, ADMIN);
    assert.equal(h.audits[0].action, SUPPORT_REQUEST_ANSWERED_ACTION);
    assert.equal(h.audits[0].riskLevel, 'HIGH');
    assert.equal(h.audits[0].targetId, 'sr-1');

    const again = harness({ one: row({ status: 'ANSWERED' }) });
    await again.useCase.markAnswered('sr-1', 'admin-2', REQUEST_ID);
    assert.deepEqual(again.updates, [], 'the first operator keeps the credit');
    assert.deepEqual(again.audits, []);
  });

  it('clears the customer assistant pause and closes the request as admin', async () => {
    const h = harness();
    const result = await h.useCase.resumeAssistant('sr-1', ADMIN, REQUEST_ID);

    assert.deepEqual(result, { id: 'sr-1', status: 'CLOSED', pauseCleared: true });
    // The pause is what the customer is living with, so this is the write that matters.
    assert.deepEqual(h.contextUpdates[0].where, { lineUserId: 'Uline-1', aiPausedUntil: { not: null } });
    assert.equal(h.contextUpdates[0].data.aiPausedUntil, null);
    assert.equal(h.updates[0].data.closedReason, 'admin');
    assert.equal(h.audits[0].action, SUPPORT_REQUEST_RESUME_ACTION);
    assert.equal(h.audits[0].metadataJson.pauseCleared, true);
  });

  it('still lifts the pause for an already-closed request, and says nothing was running', async () => {
    const h = harness({ one: row({ status: 'CLOSED' }), pauseCleared: 0 });
    const result = await h.useCase.resumeAssistant('sr-1', ADMIN, REQUEST_ID);

    assert.equal(result.pauseCleared, false);
    assert.equal(h.contextUpdates.length, 1, 'asked anyway: a closed row is no proof the pause lapsed');
    assert.deepEqual(h.updates, [], 'but a closed request is not re-closed');
  });

  it('404s rather than inventing a request', async () => {
    const h = harness({ one: null });
    await assert.rejects(() => h.useCase.markAnswered('nope', ADMIN, REQUEST_ID), NotFoundException);
    await assert.rejects(() => h.useCase.resumeAssistant('nope', ADMIN, REQUEST_ID), NotFoundException);
  });
});
