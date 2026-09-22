import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { createHash } from 'node:crypto';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { validate } from 'class-validator';
import { SupportRequestAdminUseCase, toSupportMessageDto } from './support-request-admin.use-case';
import { SupportRequestReplyDto } from '../presentation/http/system-support-request.controller';
import {
  SUPPORT_REQUEST_CLAIM_ACTION,
  SUPPORT_REQUEST_PAUSE_ACTION,
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
  pausedUntil?: Date | null;
  /** สัญญา v3: thread rows the fake returns, and the blob (if any) the content route finds. */
  messages?: any[]; blob?: any;
} = {}) {
  let current = options.one === undefined ? row() : options.one;
  const rows = options.rows ?? (current ? [current] : []);
  const audits: any[] = [];
  const messages: any[] = [];
  const updates: any[] = [];
  const listQueries: any[] = [];
  const transactions: number[] = [];
  const countAnswers = [...(options.counts ?? [rows.length, rows.length])];
  let auditFails = options.auditFails ?? false;
  let lineContext = options.pausedUntil === undefined
    ? null
    : { lineUserId: 'Uline-secret', companyId: 'co-1', aiPausedUntil: options.pausedUntil };

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
    lineSupportMessage: {
      upsert: async (args: any) => { messages.push({ op: 'upsert', ...args }); return {}; },
      updateMany: async (args: any) => { messages.push({ op: 'updateMany', ...args }); return { count: 1 }; },
      findMany: async () => options.messages ?? [],
    },
    lineSupportMessageBlob: { findFirst: async () => options.blob ?? null },
    lineCompanyContext: {
      findMany: async () => lineContext ? [lineContext] : [],
      findUnique: async () => lineContext,
      updateMany: async ({ data }: any) => {
        if (!lineContext) return { count: 0 };
        Object.assign(lineContext, data);
        return { count: options.pauseCleared ?? 1 };
      },
    },
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
    audits, updates, listQueries, transactions, messages,
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
    assert.equal(result.items[0]!.assistantActive, undefined);
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

  it('toggles only the AI pause; explicit resolve closes and records the outcome', async () => {
    const h = harness({ one: row({ companyId: 'co-1', signupRequestId: null }), pausedUntil: null });
    assert.deepEqual(await h.useCase.pauseAssistant('sr-1', ADMIN, REQUEST_ID), {
      id: 'sr-1', status: 'OPEN', assignedToMe: true, assistantActive: false,
    });
    assert.equal((await h.useCase.thread('sr-1', ADMIN)).request.assistantActive, false);
    assert.equal(h.audits[0].action, SUPPORT_REQUEST_PAUSE_ACTION);

    assert.deepEqual(await h.useCase.resumeAssistant('sr-1', ADMIN, REQUEST_ID), {
      id: 'sr-1', status: 'OPEN', assignedToMe: true, pauseCleared: true, assistantActive: true,
    });
    assert.equal(h.current().status, 'OPEN');
    assert.equal((await h.useCase.thread('sr-1', ADMIN)).request.assistantActive, true);
    assert.equal(h.audits[1].action, SUPPORT_REQUEST_RESUME_ACTION);

    await h.useCase.resolve('sr-1', 'เปิดร้านและยืนยันว่าเข้าได้แล้ว', ADMIN, REQUEST_ID);
    assert.equal(h.current().status, 'CLOSED');
    assert.equal(h.current().closedReason, 'resolved');
    assert.equal(h.current().resolutionNote, 'เปิดร้านและยืนยันว่าเข้าได้แล้ว');
    assert.equal(h.audits[2].action, SUPPORT_REQUEST_RESOLVE_ACTION);
    assert.equal(JSON.stringify(h.audits[2]).includes('เปิดร้าน'), false);
  });

  it('never rebuilds an assistant context from an old support row', async () => {
    const h = harness({ one: row({ companyId: 'co-1', signupRequestId: null }) });
    await assert.rejects(
      () => h.useCase.pauseAssistant('sr-1', ADMIN, REQUEST_ID),
      UnprocessableEntityException,
    );
    assert.equal((await h.useCase.thread('sr-1', ADMIN)).request.assistantActive, undefined);
    assert.equal(h.audits.length, 0);
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

// ── สัญญา v3: the chat behind a request ──

const threadRow = (over: Record<string, unknown> = {}) => ({
  id: 'm-1', direction: 'CUSTOMER', kind: 'TEXT', text: 'ช่วยสมัครร้านค่ะ', senderName: null,
  mediaMimeType: null, mediaByteSize: null, mediaFileName: null, mediaError: null, deliveryStatus: null,
  createdAt: new Date('2026-09-05T02:00:00.000Z'), blob: null,
  // Never selected by the real read; present here to prove the mapper would not leak it either.
  lineMessageId: 'line-msg-secret', operationId: null, senderUserId: null,
  ...over,
});

describe('support thread (สัญญา v3)', () => {
  it('writes the reply as a staff bubble: PENDING before the push, SENT with the row', async () => {
    const h = harness();
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
    const result = await h.useCase.reply('sr-1', 'กรุณาส่งอีเมลที่ต้องการใช้ค่ะ', OP_A, null, ADMIN, REQUEST_ID);
    assert.equal(result.deliveryStatus, 'SENT');

    const [pending, sent] = h.messages;
    assert.equal(pending.op, 'upsert');
    assert.deepEqual(pending.where, { requestId_operationId: { requestId: 'sr-1', operationId: OP_A } });
    assert.equal(pending.create.direction, 'STAFF');
    assert.equal(pending.create.kind, 'TEXT');
    assert.equal(pending.create.text, 'กรุณาส่งอีเมลที่ต้องการใช้ค่ะ');
    assert.equal(pending.create.senderName, 'พี่แอดมิน', 'signed the way the push was');
    assert.equal(pending.create.deliveryStatus, 'PENDING');
    assert.equal(sent.op, 'updateMany');
    assert.deepEqual(sent.where, { requestId: 'sr-1', operationId: OP_A });
    assert.deepEqual(sent.data, { deliveryStatus: 'SENT' });
    assert.equal(h.messages.length, 2, 'one bubble per operation, never one per attempt');
  });

  it('marks the bubble FAILED beside a failed push, and never overwrites a SENT one', async () => {
    const h = harness();
    globalThis.fetch = (async () => new Response('', { status: 503 })) as typeof fetch;
    const result = await h.useCase.reply('sr-1', 'ตอบค่ะ', OP_A, null, ADMIN, REQUEST_ID);
    assert.equal(result.deliveryStatus, 'FAILED');
    const failed = h.messages.find((entry) => entry.op === 'updateMany');
    assert.deepEqual(failed.where, { requestId: 'sr-1', operationId: OP_A, deliveryStatus: { not: 'SENT' } });
    assert.deepEqual(failed.data, { deliveryStatus: 'FAILED' });

    // The same operation retried: the upsert touches the existing bubble rather than adding one.
    globalThis.fetch = (async () => new Response('', { status: 200 })) as typeof fetch;
    await h.useCase.reply('sr-1', 'ตอบค่ะ', OP_A, null, ADMIN, REQUEST_ID);
    const upserts = h.messages.filter((entry) => entry.op === 'upsert');
    assert.equal(upserts.length, 2);
    assert.deepEqual(upserts[1].update, { deliveryStatus: 'PENDING' });
    assert.deepEqual(h.messages.at(-1).data, { deliveryStatus: 'SENT' });
  });

  it('reads the thread beside the fresh row, and keeps every LINE identifier out of it (§3)', async () => {
    const h = harness({ messages: [
      threadRow(),
      threadRow({ id: 'm-2', kind: 'IMAGE', text: null, mediaMimeType: 'image/png', mediaByteSize: 67,
        mediaFileName: 'receipt.png', blob: { messageId: 'm-2' } }),
      threadRow({ id: 'm-3', kind: 'FILE', text: null, mediaError: 'weird_new_reason' }),
      threadRow({ id: 'm-4', direction: 'STAFF', text: 'กรุณาส่งอีเมลค่ะ', senderName: 'พี่แอดมิน', deliveryStatus: 'SENT' }),
    ] });
    const thread = await h.useCase.thread('sr-1', ADMIN);

    assert.equal(thread.request.id, 'sr-1');
    assert.equal(thread.request.assignedToMe, true, 'the same mapping the queue uses');
    assert.deepEqual(
      thread.messages.map((m) => [m.direction, m.kind, m.hasContent]),
      [['CUSTOMER', 'TEXT', false], ['CUSTOMER', 'IMAGE', true], ['CUSTOMER', 'FILE', false], ['STAFF', 'TEXT', false]],
    );
    assert.equal(thread.messages[1]!.fileName, 'receipt.png');
    assert.equal(thread.messages[2]!.mediaError, 'media_fetch_failed', 'an unknown stored reason reads as the generic one');
    assert.equal(thread.messages[3]!.deliveryStatus, 'SENT');
    assert.equal(thread.messages[3]!.senderName, 'พี่แอดมิน');
    const written = JSON.stringify(thread);
    assert.equal(written.includes('line-msg-secret'), false, 'no LINE message id');
    assert.equal(written.includes('Uline-secret'), false, 'no LINE user id');
    assert.equal(written.includes('operationId'), false);
    assert.equal(written.includes('senderUserId'), false);
  });

  it('streams stored bytes only for a message on THIS request, and 404s otherwise', async () => {
    const stored = harness({ blob: {
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      message: { mediaMimeType: 'image/png', mediaFileName: 'receipt.png' },
    } });
    const content = await stored.useCase.messageContent('sr-1', 'm-2');
    assert.ok(Buffer.isBuffer(content.data));
    assert.equal(content.data.length, 4);
    assert.equal(content.mimeType, 'image/png');
    assert.equal(content.fileName, 'receipt.png');

    // A photo arrives nameless: the download gets our id and the extension, never LINE's message id.
    const nameless = harness({ blob: { data: new Uint8Array([1]), message: { mediaMimeType: 'image/jpeg', mediaFileName: null } } });
    assert.equal((await nameless.useCase.messageContent('sr-1', 'm-2')).fileName, 'support-m-2.jpg');

    await assert.rejects(() => harness().useCase.messageContent('sr-1', 'm-2'), NotFoundException);
    await assert.rejects(() => harness({ one: null }).useCase.thread('sr-missing', ADMIN), NotFoundException);
  });

  it('maps a bubble without inventing fields it does not have', () => {
    const dto = toSupportMessageDto(threadRow({ text: null, kind: 'IMAGE', blob: { messageId: 'm-1' } }) as any);
    assert.deepEqual(dto, { id: 'm-1', direction: 'CUSTOMER', kind: 'IMAGE', hasContent: true, createdAt: '2026-09-05T02:00:00.000Z' });
  });
});
