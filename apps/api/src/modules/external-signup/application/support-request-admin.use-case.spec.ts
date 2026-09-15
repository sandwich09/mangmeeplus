import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { createHash } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { SupportRequestAdminUseCase } from './support-request-admin.use-case';
import { SupportRequestReplyDto } from '../presentation/http/system-support-request.controller';
import {
  SUPPORT_REQUEST_CLAIM_ACTION,
  SUPPORT_REQUEST_RELEASE_ACTION,
  SUPPORT_REQUEST_REPLY_ACTION,
  SUPPORT_REQUEST_RESOLVE_ACTION,
  SUPPORT_REQUEST_RESUME_ACTION,
} from '../domain/support-request.constants';

const REQUEST_ID = 'req-1';
const ADMIN = 'admin-1';
const OP_A = '9ef3ba5f-89a0-489b-96f5-c885fd6dd098';
const OP_B = 'ea6dbfd0-10b1-4531-96c4-b9d560370c6f';
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const row = (over: Record<string, unknown> = {}) => ({
  id: 'sr-1', status: 'OPEN', companyId: null, lineUserId: 'Uline-secret',
  lineUserIdHash: 'feedfacefeedface', signupRequestId: 'signup-1',
  requestedAt: new Date('2026-09-05T02:00:00.000Z'), requestText: 'ช่วยสมัครร้านค่ะ',
  lastMessageText: 'ช่วยสมัครร้านค่ะ', lastMessageAt: new Date('2026-09-05T02:00:00.000Z'),
  lastMediaAt: null, reopenedCount: 0, lineNotifiedCount: 0, emailSent: true,
  notifiedAt: new Date('2026-09-05T02:00:05.000Z'), answeredAt: null,
  answeredByUserId: null, assignedToUserId: ADMIN,
  assignedAt: new Date('2026-09-05T02:01:00.000Z'), assignmentNote: null,
  replyOperationId: null, replyTextHash: null, replyFirstAttemptAt: null,
  lastReplyText: null, lastReplySenderName: null, lastReplyDeliveryStatus: null,
  lastReplyError: null, closedAt: null, closedReason: null, resolvedByUserId: null,
  resolutionNote: null,
  ...over,
});

function same(value: unknown, expected: unknown): boolean {
  if (value instanceof Date && expected instanceof Date) return value.getTime() === expected.getTime();
  return value === expected;
}

function matches(current: any, where: any): boolean {
  for (const [key, expected] of Object.entries(where ?? {})) {
    const value = current[key];
    if (key === 'AND') {
      if (!(expected as any[]).every((part) => matches(current, part))) return false;
    } else if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('not' in (expected as any) && same(value, (expected as any).not)) return false;
      if ('in' in (expected as any) && !(expected as any).in.includes(value)) return false;
    } else if (!same(value, expected)) return false;
  }
  return true;
}

function harness(options: {
  one?: any | null; rows?: any[]; counts?: number[]; pauseCleared?: number; auditFails?: boolean;
} = {}) {
  let current = options.one === undefined ? row() : options.one;
  const rows = options.rows ?? (current ? [current] : []);
  const audits: any[] = [];
  const updates: any[] = [];
  const listQueries: any[] = [];
  const transactions: number[] = [];
  const countAnswers = [...(options.counts ?? [rows.length, rows.length])];
  let auditFails = options.auditFails ?? false;

  const lineSupportRequest = {
    findMany: async (args: any) => { listQueries.push(args); return rows; },
    count: async () => countAnswers.shift() ?? rows.length,
    findUnique: async () => current ? { ...current } : null,
    updateMany: async (args: any) => {
      updates.push(args);
      if (!current || !matches(current, args.where)) return { count: 0 };
      Object.assign(current, args.data);
      return { count: 1 };
    },
  };
  const client: any = {
    lineSupportRequest,
    lineCompanyContext: { updateMany: async () => ({ count: options.pauseCleared ?? 1 }) },
    company: { findMany: async () => [] },
    companySignupRequest: { findMany: async () => [{
      id: 'signup-1', companyName: 'ร้านที่กำลังสมัคร', reviewResolution: 'REQUEST_INFO',
      resolutionNote: 'กรุณาส่งอีเมลใหม่',
    }] },
    user: {
      findMany: async () => [{ id: ADMIN, displayName: 'พี่แอดมิน' }, { id: 'admin-old', displayName: 'ทีมเดิม' }],
      findUnique: async ({ where }: any) => ({ displayName: where.id === ADMIN ? 'พี่แอดมิน' : 'ทีมเดิม' }),
    },
    auditLog: { create: async ({ data }: any) => {
      if (auditFails) throw new Error('audit unavailable');
      audits.push(data);
      return {};
    } },
  };
  client.$transaction = async (fn: (tx: any) => unknown) => {
    transactions.push(1);
    const before = current ? { ...current } : current;
    const auditCount = audits.length;
    try {
      return await fn(client);
    } catch (error) {
      current = before;
      audits.splice(auditCount);
      throw error;
    }
  };
  const config = {
    sesWebBaseUrl: 'https://app.example.test', lineMessagingChannelAccessToken: 'line-token',
  } as any;
  return {
    useCase: new SupportRequestAdminUseCase(lineMessagingCredentialsFixture(config), { client } as any, config),
    audits, updates, listQueries, transactions,
    current: () => current,
    allowAudit: () => { auditFails = false; },
  };
}

describe('support queue paging and privacy', () => {
  it('uses an oldest-first stable cursor, real counts, ownership and no raw LINE id', async () => {
    const first = row({ id: 'sr-1' });
    const second = row({ id: 'sr-2', lastMessageAt: new Date('2026-09-05T03:00:00.000Z') });
    const h = harness({ rows: [first, second], counts: [9, 23] });
    const result = await h.useCase.list(ADMIN, { status: 'OPEN', limit: 1 });

    assert.equal(result.openCount, 9);
    assert.equal(result.totalCount, 23);
    assert.ok(result.nextCursor);
    assert.deepEqual(h.listQueries[0].orderBy, [{ lastMessageAt: 'asc' }, { id: 'asc' }]);
    assert.equal(h.listQueries[0].take, 2);
    assert.equal(result.items[0]!.assignedToMe, true);
    assert.equal(result.items[0]!.askerLabel, 'ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: ร้านที่กำลังสมัคร)');
    assert.equal(result.items[0]!.requestedInformation, 'กรุณาส่งอีเมลใหม่');
    assert.equal(JSON.stringify(result).includes('Uline-secret'), false);
  });

  it('returns an explicit empty page shape', async () => {
    const result = await harness({ rows: [], one: null, counts: [0, 0] }).useCase.list(ADMIN, { status: 'OPEN' });
    assert.deepEqual(result, { items: [], openCount: 0, totalCount: 0, nextCursor: null });
  });
});

describe('support reply HTTP body', () => {
  const errors = async (previousReplyOperationId: unknown) => {
    const dto = Object.assign(new SupportRequestReplyDto(), {
      text: 'ตอบค่ะ', operationId: OP_A, previousReplyOperationId,
    });
    return validate(dto);
  };

  it('requires explicit null for the first reply, or a UUID for the version already read', async () => {
    assert.equal((await errors(null)).length, 0);
    assert.ok((await errors(undefined)).length > 0);
    assert.ok((await errors('old')).length > 0);
    assert.equal((await errors(OP_B)).length, 0);
  });
});

describe('support ownership and resolution', () => {
  it('claims and releases with the state change and audit in the same transaction', async () => {
    const h = harness({ one: row({ assignedToUserId: null, assignedAt: null }) });
    await h.useCase.claim('sr-1', ADMIN, REQUEST_ID);
    assert.equal(h.current().assignedToUserId, ADMIN);
    assert.equal(h.audits[0].action, SUPPORT_REQUEST_CLAIM_ACTION);
    await h.useCase.release('sr-1', ADMIN, REQUEST_ID);
    assert.equal(h.current().assignedToUserId, null);
    assert.equal(h.audits[1].action, SUPPORT_REQUEST_RELEASE_ACTION);
    assert.equal(h.transactions.length, 2);
  });

  it('takes over only the exact assignment version and leaves a visible reason', async () => {
    const assignedAt = new Date('2026-09-05T02:01:00.000Z');
    const h = harness({ one: row({ assignedToUserId: 'admin-old', assignedAt }) });
    await h.useCase.reclaim('sr-1', assignedAt.toISOString(), 'ผู้รับผิดชอบเดิมลางาน', ADMIN, REQUEST_ID);
    assert.equal(h.current().assignedToUserId, ADMIN);
    assert.equal(h.current().assignmentNote, 'ผู้รับผิดชอบเดิมลางาน');
    assert.equal(h.audits[0].metadataJson.takeover, true);

    const stale = harness({ one: row({ assignedToUserId: 'admin-old', assignedAt }) });
    await assert.rejects(
      () => stale.useCase.reclaim('sr-1', new Date(assignedAt.getTime() - 1).toISOString(), 'รับช่วง', ADMIN, REQUEST_ID),
      ConflictException,
    );
  });

  it('resume clears only the AI pause; explicit resolve closes and records the outcome', async () => {
    const h = harness();
    assert.deepEqual(await h.useCase.resumeAssistant('sr-1', ADMIN, REQUEST_ID), {
      id: 'sr-1', status: 'OPEN', assignedToMe: true, pauseCleared: true,
    });
    assert.equal(h.current().status, 'OPEN');
    assert.equal(h.audits[0].action, SUPPORT_REQUEST_RESUME_ACTION);

    await h.useCase.resolve('sr-1', 'เปิดร้านและยืนยันว่าเข้าได้แล้ว', ADMIN, REQUEST_ID);
    assert.equal(h.current().status, 'CLOSED');
    assert.equal(h.current().closedReason, 'resolved');
    assert.equal(h.current().resolutionNote, 'เปิดร้านและยืนยันว่าเข้าได้แล้ว');
    assert.equal(h.audits[1].action, SUPPORT_REQUEST_RESOLVE_ACTION);
    assert.equal(JSON.stringify(h.audits[1]).includes('เปิดร้าน'), false);
  });
});

describe('request-bound support replies', () => {
  it('replies to the request recipient and marks answered only after delivery', async () => {
    let pushed: any;
    globalThis.fetch = (async (_url: unknown, init: any) => {
      pushed = { headers: init.headers, body: JSON.parse(init.body) };
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const h = harness();
    const result = await h.useCase.reply('sr-1', 'กรุณาส่งอีเมลที่ใช้สมัครค่ะ', OP_A, null, ADMIN, REQUEST_ID);

    assert.equal(result.deliveryStatus, 'SENT');
    assert.equal(result.status, 'ANSWERED');
    assert.equal(pushed.headers['X-Line-Retry-Key'], OP_A);
    assert.equal(pushed.body.to, 'Uline-secret');
    assert.match(pushed.body.messages[0].text, /พี่แอดมิน/);
    assert.equal(h.current().lastReplyText, 'กรุณาส่งอีเมลที่ใช้สมัครค่ะ');
    assert.equal(h.current().lastReplyDeliveryStatus, 'SENT');
    assert.equal(h.audits.at(-1).action, SUPPORT_REQUEST_REPLY_ACTION);
    assert.equal(JSON.stringify(h.audits).includes('กรุณาส่งอีเมล'), false);
  });

  it('keeps a failed send retryable and never claims answered', async () => {
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    const h = harness();
    const result = await h.useCase.reply('sr-1', 'กำลังตรวจให้ค่ะ', OP_A, null, ADMIN, REQUEST_ID);
    assert.deepEqual(result, { id: 'sr-1', status: 'OPEN', deliveryStatus: 'FAILED', errorCode: 'line_api_503' });
    assert.equal(h.current().status, 'OPEN');
    assert.equal(h.current().lastReplyDeliveryStatus, 'FAILED');
    assert.equal(h.current().lastReplyError, 'line_api_503');
  });

  it('replays a SENT operation without another push and rejects a delayed older operation', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response('', { status: 200 }); }) as typeof fetch;
    const sent = row({
      status: 'ANSWERED', replyOperationId: OP_B, replyTextHash: hash('ข้อความใหม่'),
      replyFirstAttemptAt: new Date(), lastReplyText: 'ข้อความใหม่', lastReplySenderName: 'พี่แอดมิน',
      lastReplyDeliveryStatus: 'SENT', answeredAt: new Date(),
    });
    const h = harness({ one: sent });
    assert.equal((await h.useCase.reply('sr-1', 'ข้อความใหม่', OP_B, OP_A, ADMIN, REQUEST_ID)).deliveryStatus, 'SENT');
    assert.equal(calls, 0);
    await assert.rejects(
      () => h.useCase.reply('sr-1', 'ข้อความเก่า', OP_A, null, ADMIN, REQUEST_ID),
      ConflictException,
    );
    assert.equal(calls, 0);
  });

  it('keeps the first-attempt clock and does not retry the same key after 24 hours', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response('', { status: 503 }); }) as typeof fetch;
    const first = new Date('2026-09-01T00:00:00.000Z');
    const h = harness({ one: row({
      replyOperationId: OP_A, replyTextHash: hash('ข้อความเดิม'), replyFirstAttemptAt: first,
      lastReplyText: 'ข้อความเดิม', lastReplySenderName: 'พี่แอดมิน', lastReplyDeliveryStatus: 'FAILED',
    }) });
    const result = await h.useCase.reply('sr-1', 'ข้อความเดิม', OP_A, OP_A, ADMIN, REQUEST_ID);
    assert.equal(result.errorCode, 'support_reply_retry_window_expired');
    assert.deepEqual(h.current().replyFirstAttemptAt, first);
    assert.equal(calls, 0);
  });

  it('keeps the case OPEN when a customer writes while LINE accepts the reply', async () => {
    const h = harness();
    globalThis.fetch = (async () => {
      h.current().lastMessageAt = new Date('2026-09-05T03:00:00.000Z');
      return new Response('', { status: 200 });
    }) as typeof fetch;
    const result = await h.useCase.reply('sr-1', 'กำลังตรวจให้ค่ะ', OP_A, null, ADMIN, REQUEST_ID);
    assert.equal(result.deliveryStatus, 'SENT');
    assert.equal(result.newerCustomerMessage, true);
    assert.equal(h.current().status, 'OPEN');
    assert.equal(h.current().lastReplyDeliveryStatus, 'SENT');
  });

  it('makes SENT monotonic when same-key success and failure finish out of order', async () => {
    const h = harness();
    let finishFirst!: (response: Response) => void;
    let call = 0;
    globalThis.fetch = (() => {
      call += 1;
      if (call === 1) return new Promise<Response>((resolve) => { finishFirst = resolve; });
      return Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;

    const first = h.useCase.reply('sr-1', 'ข้อความเดิม', OP_A, null, ADMIN, REQUEST_ID);
    await new Promise((resolve) => setImmediate(resolve));
    const second = h.useCase.reply('sr-1', 'ข้อความเดิม', OP_A, OP_A, ADMIN, `${REQUEST_ID}-retry`);
    assert.equal((await second).deliveryStatus, 'SENT');
    finishFirst(new Response('', { status: 503 }));
    assert.equal((await first).deliveryStatus, 'SENT');
    assert.equal(h.current().lastReplyDeliveryStatus, 'SENT');
  });

  it('rolls back the local SENT stamp when audit fails, then repairs with the same provider key', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1
        ? new Response('', { status: 200 })
        : new Response('', { status: 409, headers: { 'x-line-accepted-request-id': 'accepted-1' } });
    }) as typeof fetch;
    const h = harness({ auditFails: true });

    await assert.rejects(
      () => h.useCase.reply('sr-1', 'ข้อความเดิม', OP_A, null, ADMIN, REQUEST_ID),
      /audit unavailable/,
    );
    assert.equal(h.current().lastReplyDeliveryStatus, 'PENDING', 'provider result and answer rolled back with audit');
    assert.equal(h.current().status, 'OPEN');

    h.allowAudit();
    const repaired = await h.useCase.reply('sr-1', 'ข้อความเดิม', OP_A, OP_A, ADMIN, `${REQUEST_ID}-retry`);
    assert.equal(repaired.deliveryStatus, 'SENT');
    assert.equal(h.current().status, 'ANSWERED');
    assert.equal(h.audits.length, 1);
  });

  it('requires ownership and returns 404 for a missing request', async () => {
    await assert.rejects(() => harness({ one: row({ assignedToUserId: null }) }).useCase.reply(
      'sr-1', 'ตอบค่ะ', OP_A, null, ADMIN, REQUEST_ID,
    ), ConflictException);
    await assert.rejects(() => harness({ one: null }).useCase.claim('missing', ADMIN, REQUEST_ID), NotFoundException);
  });
});
