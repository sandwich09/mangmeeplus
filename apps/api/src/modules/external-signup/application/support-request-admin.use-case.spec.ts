import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { SupportRequestAdminUseCase } from './support-request-admin.use-case';
import {
  SUPPORT_REQUEST_ANSWERED_ACTION, SUPPORT_REQUEST_RESUME_ACTION,
} from '../domain/support-request.constants';

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
  requestText: null,
  lastMessageText: null,
  lastMessageAt: new Date('2026-09-05T02:00:00.000Z'),
  lastMediaAt: null,
  reopenedCount: 0,
  lineNotifiedCount: 0,
  emailSent: true,
  notifiedAt: new Date('2026-09-05T02:00:05.000Z'),
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
    // Newest CUSTOMER message first, not oldest ask first: a request the customer wrote to two
    // minutes ago showing "รอมานาน 3 วัน" at the bottom of the tab is how one gets missed twice.
    assert.deepEqual(h.queries[0].orderBy, [{ status: 'asc' }, { lastMessageAt: 'desc' }]);

    const [item] = result.items;
    assert.equal(item!.askerLabel, 'ร้านนิด');
    assert.equal(item!.askerRef, 'edface', 'six characters of the hash, and nothing else');
    assert.equal(JSON.stringify(result).includes('Uline-1'), false, '§3: no raw LINE id crosses the API');
    assert.equal(item!.lineNotifiedCount, 0);
    assert.equal(item!.emailSent, true);
    assert.equal(item!.notifyState, 'notified');
  });

  // The counters hold their DEFAULTS until the outbox drain runs, which is indistinguishable from
  // "every channel failed" — the inbox rendered a red chip for the seconds in between.
  it('calls a request queued until the drain has actually tried', () => {
    const queued = harness({ rows: [row({ notifiedAt: null, lineNotifiedCount: 0, emailSent: false })] });
    const unreachable = harness({ rows: [row({ notifiedAt: new Date(), lineNotifiedCount: 0, emailSent: false })] });
    const byLine = harness({ rows: [row({ notifiedAt: new Date(), lineNotifiedCount: 2, emailSent: false })] });

    return Promise.all([queued.useCase.list(), unreachable.useCase.list(), byLine.useCase.list()])
      .then(([q, u, l]) => {
        assert.equal(q.items[0]!.notifyState, 'queued');
        assert.equal(u.items[0]!.notifyState, 'unreachable');
        assert.equal(l.items[0]!.notifyState, 'notified', 'one rail is enough');
      });
  });

  it('answers the badge without reading a page of rows', async () => {
    const h = harness({ openCount: 7 });
    assert.deepEqual(await h.useCase.openCount(), { open: 7 });
    assert.deepEqual(h.queries, [], 'no findMany at all');
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

  // UAT 2026-09-06: an answered request the customer wrote back to is OPEN again, and the row has
  // to carry enough for the operator to see that WITHOUT opening it.
  it('carries the newest customer message and how often this one has been answered', async () => {
    const h = harness({
      rows: [row({
        status: 'OPEN',
        lastMessageText: 'ยังไม่ได้เลยค่ะ',
        lastMessageAt: new Date('2026-09-06T04:00:00.000Z'),
        answeredAt: new Date('2026-09-05T03:00:00.000Z'),
        answeredByUserId: 'admin-1',
        reopenedCount: 1,
      })],
      users: [{ id: 'admin-1', displayName: 'พี่แอดมิน' }],
    });
    const [item] = (await h.useCase.list('OPEN')).items;

    assert.equal(item!.lastMessageAt, '2026-09-06T04:00:00.000Z');
    assert.equal(item!.reopenedCount, 1);
    assert.equal(item!.lastMessageText, 'ยังไม่ได้เลยค่ะ');
    // The answer stays visible as history — the row is OPEN and answered, which is the whole point.
    assert.equal(item!.answeredAt, '2026-09-05T03:00:00.000Z');
    assert.equal(item!.answeredByDisplayName, 'พี่แอดมิน');
    assert.equal(item!.status, 'OPEN');
  });

  /**
   * Review 2026-09-06 (F3). One column held both "what they asked" and "what they last said", so a
   * nudge or an unrelated receipt photo destroyed the question the operator was answering. Two
   * columns, and a picture is a marker beside the words rather than a replacement for them.
   */
  it('carries the original question and the newest message as two separate things', async () => {
    const h = harness({
      rows: [row({
        requestText: 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ',
        lastMessageText: 'มีอัปเดตไหมคะ',
        lastMediaAt: new Date('2026-09-06T05:00:00.000Z'),
      })],
    });
    const [item] = (await h.useCase.list()).items;

    assert.equal(item!.requestText, 'ส่งใบเสร็จแล้วไม่เห็นขึ้นเลยค่ะ', 'still the question, three messages later');
    assert.equal(item!.lastMessageText, 'มีอัปเดตไหมคะ');
    assert.equal(item!.lastMediaAt, '2026-09-06T05:00:00.000Z', 'and a photo arrived, which is all we keep of it');
  });

  it('says nothing about media on a thread that has none', async () => {
    const [item] = (await harness({ rows: [row()] }).useCase.list()).items;
    assert.equal(item!.lastMediaAt, undefined);
    assert.equal(item!.requestText, undefined);
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
