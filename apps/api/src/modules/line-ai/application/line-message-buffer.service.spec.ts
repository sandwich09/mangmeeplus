import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../../../generated/prisma/client';
import { LineMessageBufferService } from './line-message-buffer.service';
import type { LineBufferEnvelope } from './line-message-buffer.service';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS } from '../domain/logic/line-message-buffer.logic';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Row = {
  webhookEventId: string;
  status: string;
  createdAt: Date;
  processedAt?: Date | null;
  errorCode?: string | null;
  companyId?: string | null;
  payloadJson?: unknown;
};

function makeHarness(opts: {
  debounceMs?: number;
  maxWaitMs?: number;
  loadingEnabled?: boolean;
  executeImpl?: (event: any) => Promise<void>;
  receiptOutcomes?: Array<'done' | 'defer_text'>;
  replyResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
  pushResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
  eventStoreUnavailable?: boolean;
  legalAcceptanceRequired?: boolean;
  preflightImpl?: (event: { lineUserId: string; messagingChannelId?: string }) => Promise<{ status: 'continue' } | { status: 'required'; companyId: string }>;
} = {}) {
  const rows = new Map<string, Row>();
  const executed: any[] = [];
  const receipts: Array<{ event: any; caption?: string }> = [];
  const replies: string[] = [];
  const replyTokens: string[] = [];
  const pushes: Array<{ to: string; text: string }> = [];
  const loadingCalls: string[] = [];
  const auditLogs: any[] = [];
  const serviceLogs: any[] = [];
  const preflightCalls: Array<{ lineUserId: string; messagingChannelId?: string }> = [];
  let receiptCall = 0;

  const prisma = {
    client: {
      lineWebhookEventLog: {
        create: async ({ data }: any) => {
          if (opts.eventStoreUnavailable) throw new Error('database unavailable');
          if (rows.has(data.webhookEventId)) throw new Error('P2002 unique constraint');
          rows.set(data.webhookEventId, {
            webhookEventId: data.webhookEventId,
            status: data.status,
            createdAt: new Date(),
            processedAt: data.processedAt,
            errorCode: data.errorCode,
            companyId: data.companyId,
            payloadJson: data.payloadJson,
          });
          return data;
        },
        findUnique: async ({ where }: any) => {
          if (opts.eventStoreUnavailable) throw new Error('database unavailable');
          return rows.get(where.webhookEventId) ?? null;
        },
        updateMany: async ({ where, data }: any) => {
          const ids: string[] = where.webhookEventId.in ?? [where.webhookEventId];
          let count = 0;
          for (const id of ids) {
            const row = rows.get(id);
            if (row && (!where.status || row.status === where.status) && (!where.errorCode || row.errorCode === where.errorCode)) {
              if (data.status) row.status = data.status;
              if ('processedAt' in data) row.processedAt = data.processedAt;
              if ('errorCode' in data) row.errorCode = data.errorCode;
              if ('companyId' in data) row.companyId = data.companyId;
              if ('payloadJson' in data) row.payloadJson = data.payloadJson;
              count += 1;
            }
          }
          return { count };
        },
      },
    },
  } as any;

  const config = {
    lineAiBufferDebounceMs: opts.debounceMs ?? 20,
    lineAiBufferMaxWaitMs: opts.maxWaitMs ?? 500,
    lineAiLoadingAnimationEnabled: opts.loadingEnabled ?? false,
  } as any;

  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;

  const lineReply = {
    buildTextMessage: (text: string) => ({ type: 'text', text }),
    sendReply: async (token: string, messages: Array<{ text: string }>) => {
      replyTokens.push(token);
      replies.push(messages[0]?.text ?? '');
      return opts.replyResult ?? 'ok';
    },
    sendPush: async (to: string, messages: Array<{ text: string }>) => {
      pushes.push({ to, text: messages[0]?.text ?? '' });
      return opts.pushResult ?? 'ok';
    },
    startLoadingAnimation: async (chatId: string) => { loadingCalls.push(chatId); },
  } as any;

  const useCase = {
    preflightLegalAcceptance: async (event: { lineUserId: string; messagingChannelId?: string }) => {
      preflightCalls.push(event);
      if (opts.preflightImpl) return opts.preflightImpl(event);
      return opts.legalAcceptanceRequired
        ? { status: 'required' as const, companyId: 'company-1' }
        : { status: 'continue' as const };
    },
    execute: async (event: any) => {
      executed.push(event);
      if (opts.executeImpl) await opts.executeImpl(event);
    },
    executeReceiptUpload: async (event: any, caption?: string) => {
      receipts.push({ event, caption });
      const outcome = opts.receiptOutcomes?.[receiptCall] ?? 'done';
      receiptCall += 1;
      return { outcome };
    },
  } as any;

  const service = new LineMessageBufferService(prisma, config, audit, lineReply, useCase);
  (service as any).logger = {
    log: (entry: unknown) => serviceLogs.push(entry),
    warn: (entry: unknown) => serviceLogs.push(entry),
    error: (entry: unknown) => serviceLogs.push(entry),
  };
  return { service, rows, executed, receipts, replies, replyTokens, pushes, loadingCalls, auditLogs, serviceLogs, preflightCalls };
}

let uniq = 0;
function textEnv(id: string, body: string, opts: { chatId?: string; userId?: string; timestamp?: number } = {}): LineBufferEnvelope {
  uniq += 1;
  const userId = opts.userId ?? 'user-1';
  return {
    chatId: opts.chatId ?? userId,
    lineUserId: userId,
    messagingChannelId: 'ch-1',
    item: { kind: 'text', webhookEventId: id, replyToken: `rt-${id}`, text: body, lineMessageId: `mid-${id}`, timestamp: opts.timestamp ?? uniq },
  };
}
function mediaEnv(id: string, opts: { chatId?: string; userId?: string; timestamp?: number } = {}): LineBufferEnvelope {
  uniq += 1;
  const userId = opts.userId ?? 'user-1';
  return {
    chatId: opts.chatId ?? userId,
    lineUserId: userId,
    messagingChannelId: 'ch-1',
    item: { kind: 'media', webhookEventId: id, replyToken: `rt-${id}`, lineMessageId: `mid-${id}`, messageType: 'image', timestamp: opts.timestamp ?? uniq },
  };
}

describe('LineMessageBufferService – legal acceptance pre-storage gate', () => {
  it('terminalizes pending employee text without persisting or dispatching its raw envelope', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true, loadingEnabled: true });
    const envelope = textEnv('legal-text', 'ความลับทางธุรกิจ');

    await h.service.enqueue(envelope);

    const row = h.rows.get('legal-text');
    assert.equal(row?.status, 'legal_acceptance_required');
    assert.equal(row?.errorCode, 'LINE_AI_FORBIDDEN');
    assert.equal(row?.companyId, 'company-1');
    assert.equal(row?.payloadJson, Prisma.DbNull);
    assert.equal(h.executed.length, 0);
    assert.equal(h.receipts.length, 0);
    assert.equal(h.loadingCalls.length, 0);
    assert.deepEqual(h.replyTokens, ['rt-legal-text']);
    assert.match(h.replies[0] ?? '', /ยอมรับข้อกำหนดการใช้งาน/);
    assert.deepEqual(Object.keys(h.preflightCalls[0] ?? {}).sort(), ['lineUserId', 'messagingChannelId']);
  });

  it('terminalizes pending employee media before any media id or filename is durable', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true });
    const envelope = mediaEnv('legal-media');
    if (envelope.item.kind === 'media') {
      envelope.item.fileName = 'payroll-secret.pdf';
      envelope.item.fileSize = 9_999;
    }

    await h.service.enqueue(envelope);

    const row = h.rows.get('legal-media');
    assert.equal(row?.status, 'legal_acceptance_required');
    assert.equal(row?.payloadJson, Prisma.DbNull);
    assert.equal(h.receipts.length, 0);
    assert.equal(h.executed.length, 0);
    assert.doesNotMatch(JSON.stringify(row), /mid-legal-media|payroll-secret|rt-legal-media/);
  });

  it('deduplicates a pending event and sends the neutral reply only once', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true });
    await h.service.enqueue(textEnv('legal-dup', 'ข้อความแรก'));
    await h.service.enqueue(textEnv('legal-dup', 'ข้อความที่สอง'));

    assert.equal(h.rows.get('legal-dup')?.status, 'legal_acceptance_required');
    assert.equal(h.rows.get('legal-dup')?.payloadJson, Prisma.DbNull);
    assert.equal(h.replies.length, 1);
    assert.equal(h.executed.length, 0);
  });

  it('falls back to a chat-scoped push without reopening the terminal event', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true, replyResult: 'failed_token' });
    await h.service.enqueue(textEnv('legal-push', 'ข้อความ', { chatId: 'group-legal' }));

    assert.equal(h.pushes.length, 1);
    assert.equal(h.pushes[0]?.to, 'group-legal');
    assert.match(h.pushes[0]?.text ?? '', /นโยบายความเป็นส่วนตัว/);
    assert.equal(h.rows.get('legal-push')?.status, 'legal_acceptance_required');
    assert.equal(h.rows.get('legal-push')?.payloadJson, Prisma.DbNull);
  });

  it('returns the claim to received and rejects the webhook when legal guidance cannot be delivered', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true, replyResult: 'failed_other' });

    await assert.rejects(
      () => h.service.enqueue(textEnv('legal-retry', 'ข้อความสำคัญ')),
      /LINE_LEGAL_REPLY_DELIVERY_FAILED/,
    );
    await assert.rejects(
      () => h.service.enqueue(textEnv('legal-retry', 'ข้อความเดิมที่ LINE ส่งซ้ำ')),
      /LINE_LEGAL_REPLY_DELIVERY_FAILED/,
    );

    assert.equal(h.rows.get('legal-retry')?.status, 'received');
    assert.equal(h.rows.get('legal-retry')?.errorCode, 'RETRYABLE_LEGAL_REPLY_DELIVERY_FAILED');
    assert.equal(h.rows.get('legal-retry')?.payloadJson, Prisma.DbNull);
    assert.equal(h.executed.length, 0);
    assert.equal(
      h.serviceLogs.filter((entry) => entry.msg === 'line.ai.accepted').length,
      1,
      'LINE redelivery retries the durable row without double-counting the unique accepted event',
    );
  });

  it('keeps a concurrent legal reply claim retryable and reclaims it only after the orphan bound', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true });
    const createdAt = new Date(Date.now() - LINE_BUFFER_ORPHAN_REPROCESS_MS - 1_000);
    h.rows.set('legal-orphan', {
      webhookEventId: 'legal-orphan',
      status: 'response_ready',
      errorCode: 'LINE_AI_FORBIDDEN',
      companyId: 'company-1',
      createdAt,
      processedAt: new Date(),
      payloadJson: Prisma.DbNull,
    });

    await assert.rejects(
      () => h.service.enqueue(textEnv('legal-orphan', 'ข้อความที่ LINE ส่งซ้ำเร็วเกินไป')),
      /LINE_LEGAL_REPLY_IN_FLIGHT/,
    );
    assert.equal(h.replies.length, 0);

    h.rows.get('legal-orphan')!.processedAt = createdAt;
    await h.service.enqueue(textEnv('legal-orphan', 'ข้อความที่ LINE ส่งซ้ำหลัง worker เดิมหาย'));

    assert.equal(h.replies.length, 1);
    assert.equal(h.rows.get('legal-orphan')?.status, 'legal_acceptance_required');
    assert.equal(h.serviceLogs.filter((entry) => entry.msg === 'line.ai.accepted').length, 0,
      'reclaiming the previously accepted id must not increment acceptance again');
  });

  it('keeps company-context controls usable but memory-only while acceptance is pending', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true, debounceMs: 5_000 });
    await h.service.enqueue(textEnv('legal-company', '/company 2'));
    await sleep(20);

    assert.equal(h.rows.get('legal-company')?.payloadJson, Prisma.DbNull);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0]?.messageText, '/company 2');
    assert.equal(h.replies.length, 0);
  });

  it('preserves the existing unlinked/unresolved path when preflight says continue', async () => {
    const h = makeHarness({ debounceMs: 0 });
    const envelope = textEnv('preflight-continue', 'ขอเชื่อมบัญชี');
    await h.service.enqueue(envelope);
    await sleep(20);

    assert.equal(h.rows.get('preflight-continue')?.payloadJson, envelope);
    assert.equal(h.executed.length, 1);
  });

  it('fails closed before persistence when preflight infrastructure is unavailable', async () => {
    const h = makeHarness({
      preflightImpl: async () => { throw new Error('legal preflight unavailable'); },
    });

    await assert.rejects(
      () => h.service.enqueue(textEnv('preflight-down', 'ห้ามเก็บ')),
      /legal preflight unavailable/,
    );
    assert.equal(h.rows.size, 0);
    assert.equal(h.executed.length, 0);
  });
});

describe('LineMessageBufferService – batching', () => {
  it('coalesces rapid fragments into one turn keyed by the last bubble', async () => {
    const h = makeHarness({ debounceMs: 20 });
    await h.service.enqueue(textEnv('f1', 'ขอ'));
    await h.service.enqueue(textEnv('f2', 'รายชื่อ'));
    await h.service.enqueue(textEnv('f3', 'ลูกค้า'));
    await sleep(80);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0].messageText, 'ขอ\nรายชื่อ\nลูกค้า');
    assert.equal(h.executed[0].webhookEventId, 'f3');
    assert.equal(h.executed[0].replyToken, 'rt-f3');
    assert.equal(h.executed[0].pushTargetId, 'user-1');
    // Earlier bubbles become batched members; the primary keeps its own lifecycle.
    assert.equal(h.rows.get('f1')?.status, 'batched');
    assert.equal(h.rows.get('f2')?.status, 'batched');
    assert.equal(h.rows.get('f3')?.status, 'received');
    assert.deepEqual(
      h.serviceLogs.filter((entry) => entry.msg === 'line.ai.terminal').map((entry) => [entry.webhookEventId, entry.terminalClass]),
      [['f1', 'intentional_noop'], ['f2', 'intentional_noop']],
      'each accepted bubble folded into the synthesized turn receives its own terminal class',
    );
  });

  it('debounce 0 keeps per-event turns but still serializes them', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = makeHarness({ debounceMs: 0, executeImpl: (event) => (event.messageText === 'แรก' ? gate : Promise.resolve()) });
    await h.service.enqueue(textEnv('s1', 'แรก'));
    await h.service.enqueue(textEnv('s2', 'สอง'));
    await sleep(20);
    assert.equal(h.executed.length, 1, 'second turn must wait for the first');
    release();
    await sleep(20);
    assert.equal(h.executed.length, 2);
    assert.deepEqual(h.executed.map((e) => e.messageText), ['แรก', 'สอง']);
  });

  it('messages arriving during processing form the next batch (merge-into-pending)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = makeHarness({ debounceMs: 10, executeImpl: (event) => (event.messageText === 'คำถามแรก' ? gate : Promise.resolve()) });
    await h.service.enqueue(textEnv('p1', 'คำถามแรก'));
    await sleep(30); // first batch flushed and now processing (held open)
    await h.service.enqueue(textEnv('p2', 'ที่ค้างชำระ'));
    await sleep(30);
    await h.service.enqueue(textEnv('p3', 'เดือนนี้'));
    await sleep(30);
    assert.equal(h.executed.length, 1);
    release();
    await sleep(30);
    // Both later bubbles merged into ONE pending batch, not two.
    assert.equal(h.executed.length, 2);
    assert.equal(h.executed[1].messageText, 'ที่ค้างชำระ\nเดือนนี้');
  });

  it('max wait flushes anchored to the first bubble under continuous typing', async () => {
    const h = makeHarness({ debounceMs: 40, maxWaitMs: 120 });
    await h.service.enqueue(textEnv('m0', 'm0'));
    await sleep(30);
    await h.service.enqueue(textEnv('m1', 'm1'));
    await sleep(30);
    await h.service.enqueue(textEnv('m2', 'm2'));
    await sleep(30);
    await h.service.enqueue(textEnv('m3', 'm3'));
    await sleep(250);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0].messageText, 'm0\nm1\nm2\nm3');
    await h.service.enqueue(textEnv('m4', 'm4'));
    await sleep(80);
    assert.equal(h.executed.length, 2);
    assert.equal(h.executed[1].messageText, 'm4');
  });

  it('buffers different chats independently', async () => {
    const h = makeHarness({ debounceMs: 20 });
    await h.service.enqueue(textEnv('c1', 'จากแชทเดี่ยว', { userId: 'user-1' }));
    await h.service.enqueue(textEnv('c2', 'จากกลุ่ม', { userId: 'user-1', chatId: 'group-9' }));
    await sleep(80);
    assert.equal(h.executed.length, 2);
    const group = h.executed.find((e) => e.pushTargetId === 'group-9');
    assert.ok(group, 'group chat keeps its own buffer and push target');
    assert.equal(group.messageText, 'จากกลุ่ม');
  });
});

describe('LineMessageBufferService – commands', () => {
  it('command on an idle chat dispatches immediately without debounce wait', async () => {
    const h = makeHarness({ debounceMs: 5_000 });
    await h.service.enqueue(textEnv('cmd1', '/companies'));
    await sleep(20);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0].messageText, '/companies');
  });

  it('command after buffered fragments flushes and preserves send order', async () => {
    const h = makeHarness({ debounceMs: 5_000 });
    await h.service.enqueue(textEnv('q1', 'ขอรายชื่อลูกค้า'));
    await h.service.enqueue(textEnv('cmd2', '/company 2'));
    await sleep(30);
    assert.deepEqual(h.executed.map((e) => e.messageText), ['ขอรายชื่อลูกค้า', '/company 2']);
  });
});

describe('LineMessageBufferService – media and captions', () => {
  it('text buffered with media rides along as caption and gets no standalone turn', async () => {
    const h = makeHarness({ debounceMs: 20 });
    await h.service.enqueue(mediaEnv('img1'));
    await h.service.enqueue(textEnv('cap1', 'บันทึกค่าใช้จ่าย'));
    await sleep(80);
    assert.equal(h.receipts.length, 1);
    assert.equal(h.receipts[0].caption, 'บันทึกค่าใช้จ่าย');
    assert.equal(h.receipts[0].event.webhookEventId, 'img1');
    assert.equal(h.executed.length, 0);
    assert.equal(h.rows.get('cap1')?.status, 'batched');
  });

  it('defer_text runs the caption as its own text turn afterwards', async () => {
    const h = makeHarness({ debounceMs: 20, receiptOutcomes: ['defer_text'] });
    await h.service.enqueue(mediaEnv('img2'));
    await h.service.enqueue(textEnv('q2', 'ยอดขายเดือนนี้เท่าไหร่'));
    await sleep(80);
    assert.equal(h.receipts.length, 1);
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0].messageText, 'ยอดขายเดือนนี้เท่าไหร่');
  });

  it('multiple media in one batch share the caption', async () => {
    const h = makeHarness({ debounceMs: 20 });
    await h.service.enqueue(mediaEnv('r1'));
    await h.service.enqueue(mediaEnv('r2'));
    await h.service.enqueue(textEnv('cap2', 'บันทึกบิล 2 ใบนี้'));
    await sleep(80);
    assert.equal(h.receipts.length, 2);
    assert.deepEqual(h.receipts.map((r) => r.caption), ['บันทึกบิล 2 ใบนี้', 'บันทึกบิล 2 ใบนี้']);
  });
});

describe('LineMessageBufferService – dedup and redelivery', () => {
  it('rejects enqueue when the durable event store is unavailable', async () => {
    const h = makeHarness({ eventStoreUnavailable: true });
    await assert.rejects(() => h.service.enqueue(textEnv('db-down', 'ข้อความ')), /database unavailable/);
    assert.equal(h.executed.length, 0);
  });

  it('marks a row retryable if the in-memory append fails after persistence', async () => {
    const h = makeHarness();
    (h.service as any).appendAccepted = () => { throw new Error('append failed'); };
    await assert.rejects(() => h.service.enqueue(textEnv('append-fail', 'ข้อความ')), /append failed/);
    assert.equal(h.rows.get('append-fail')?.errorCode, 'RETRYABLE_BUFFER_APPEND_FAILED');
    assert.equal(h.rows.get('append-fail')?.processedAt, null);
  });

  it('drops a redelivered event whose row is young and still received', async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.rows.set('dup1', { webhookEventId: 'dup1', status: 'received', createdAt: new Date() });
    await h.service.enqueue(textEnv('dup1', 'ซ้ำ'));
    await sleep(40);
    assert.equal(h.executed.length, 0);
  });

  it('drops a redelivered event whose row is terminal', async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.rows.set('dup2', { webhookEventId: 'dup2', status: 'completed', createdAt: new Date(Date.now() - 10 * 60_000) });
    await h.service.enqueue(textEnv('dup2', 'ซ้ำ'));
    await sleep(40);
    assert.equal(h.executed.length, 0);
  });

  it('reprocesses an orphaned received row older than the orphan window', async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.rows.set('orphan1', { webhookEventId: 'orphan1', status: 'received', createdAt: new Date(Date.now() - 3 * 60_000) });
    await h.service.enqueue(textEnv('orphan1', 'ขอรายชื่อลูกค้า'));
    await sleep(40);
    assert.equal(h.executed.length, 1);
  });

  it('atomically re-enqueues a retryable received row without waiting for the orphan window', async () => {
    const h = makeHarness({ debounceMs: 10 });
    h.rows.set('retry1', {
      webhookEventId: 'retry1', status: 'received', createdAt: new Date(), processedAt: null,
      errorCode: 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED',
    });
    await Promise.all([
      h.service.enqueue(textEnv('retry1', 'ลองใหม่')),
      h.service.enqueue(textEnv('retry1', 'ลองใหม่')),
    ]);
    await sleep(40);
    assert.equal(h.executed.length, 1);
  });
});

describe('LineMessageBufferService – dispatch failure', () => {
  it('delivers an explicit unavailable reply and records the visible outcome', async () => {
    const h = makeHarness({
      debounceMs: 0,
      executeImpl: async () => { throw new Error('unexpected pipeline failure'); },
    });

    await h.service.enqueue(textEnv('dispatch-fail', 'ช่วยดูยอดขาย'));
    await sleep(40);

    assert.match(h.replies[0] ?? '', /ระบบตอบกลับไม่ได้ชั่วคราว/);
    assert.equal(h.rows.get('dispatch-fail')?.status, 'unavailable_delivered');
    assert.equal(h.rows.get('dispatch-fail')?.errorCode, null);
    assert.deepEqual(
      h.serviceLogs.filter((entry) => entry.msg === 'line.ai.terminal').map((entry) => entry.terminalClass),
      ['provider_unavailable'],
      'the transient response-ready claim must not double-count delivery-pending',
    );
  });

  it('keeps the event delivery_pending when the fallback cannot reach LINE', async () => {
    const h = makeHarness({
      debounceMs: 0,
      executeImpl: async () => { throw new Error('unexpected pipeline failure'); },
      replyResult: 'failed_other',
    });

    await h.service.enqueue(textEnv('dispatch-pending', 'ช่วยดูยอดขาย'));
    await sleep(40);

    assert.equal(h.rows.get('dispatch-pending')?.status, 'delivery_pending');
    assert.equal(h.rows.get('dispatch-pending')?.errorCode, 'RETRYABLE_LINE_BUFFER_DISPATCH_FAILED');
    assert.deepEqual(
      h.serviceLogs.filter((entry) => entry.msg === 'line.ai.terminal').map((entry) => entry.terminalClass),
      ['delivery_pending'],
    );
  });
});

describe('LineMessageBufferService – overflow guard', () => {
  it('drops beyond the pending cap with one rate-limit reply and audit trail', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const h = makeHarness({ debounceMs: 0, executeImpl: (event) => (event.messageText === 'hold' ? gate : Promise.resolve()) });
    await h.service.enqueue(textEnv('h0', 'hold'));
    for (let i = 1; i <= 20; i++) {
      await h.service.enqueue(textEnv(`h${i}`, `x${i}`));
    }
    // Pending batch is now at the 20-item cap; the next bubbles are dropped.
    await h.service.enqueue(textEnv('h21', 'x21'));
    await h.service.enqueue(textEnv('h22', 'x22'));
    assert.equal(h.rows.get('h21')?.status, 'rate_limited');
    assert.equal(h.rows.get('h22')?.status, 'rate_limited');
    assert.equal(h.replies.filter((r) => r.includes('กำลังประมวลผลข้อความก่อนหน้า')).length, 1, 'one notice per episode');
    assert.equal(h.auditLogs.filter((a) => a.action === 'ai.line.flood_dropped').length, 2);
    release();
    await sleep(40);
    assert.equal(h.executed.length, 2);
    assert.equal(h.executed[1].messageText.split('\n').length, 20);
    assert.ok(!h.executed[1].messageText.includes('x21'), 'dropped bubbles never reach the AI');
  });
});

describe('LineMessageBufferService – shutdown and loading animation', () => {
  it('onModuleDestroy flushes open buffers and drains the turn', async () => {
    const h = makeHarness({ debounceMs: 60_000 });
    await h.service.enqueue(textEnv('sd1', 'ขอ'));
    await h.service.enqueue(textEnv('sd2', 'รายชื่อลูกค้า'));
    await h.service.onModuleDestroy();
    assert.equal(h.executed.length, 1);
    assert.equal(h.executed[0].messageText, 'ขอ\nรายชื่อลูกค้า');
  });

  it('starts the loading animation for 1:1 chats only', async () => {
    const h = makeHarness({ debounceMs: 10, loadingEnabled: true });
    await h.service.enqueue(textEnv('l1', 'สวัสดี', { userId: 'user-1' }));
    await h.service.enqueue(textEnv('l2', 'จากกลุ่ม', { userId: 'user-2', chatId: 'group-1' }));
    await sleep(60);
    assert.deepEqual(h.loadingCalls, ['user-1']);
  });

  it('pushes one contextual status after 2 seconds and restores loading before the answer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let releaseTurn!: () => void;
      let completeTurn!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const completed = new Promise<void>((resolve) => { completeTurn = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const h = makeHarness({
        debounceMs: 0,
        loadingEnabled: true,
        executeImpl: async (event) => {
          markStarted();
          await gate;
          await event.beforeReply?.();
          completeTurn();
        },
      });

      await h.service.enqueue(textEnv('wait-1', 'ช่วยเปรียบเทียบยอดขายสองสาขา'));
      await started;
      assert.deepEqual(h.loadingCalls, ['user-1']);

      t.mock.timers.tick(1_999);
      await Promise.resolve();
      assert.equal(h.pushes.length, 0);

      t.mock.timers.tick(1);
      await Promise.resolve();
      await Promise.resolve();
      assert.match(h.pushes[0]?.text ?? '', /กำลังเปรียบเทียบข้อมูล/);
      assert.deepEqual(h.loadingCalls, ['user-1', 'user-1']);

      releaseTurn();
      await completed;
      assert.equal(h.pushes.length, 1);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('keeps a reply completed within 2 seconds to loading only', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let completeTurn!: () => void;
      const completed = new Promise<void>((resolve) => { completeTurn = resolve; });
      const h = makeHarness({
        debounceMs: 0,
        loadingEnabled: true,
        executeImpl: async (event) => {
          await event.beforeReply?.();
          completeTurn();
        },
      });

      await h.service.enqueue(textEnv('wait-fast', 'สวัสดี'));
      await completed;
      t.mock.timers.tick(2_000);
      await Promise.resolve();

      assert.deepEqual(h.loadingCalls, ['user-1']);
      assert.equal(h.pushes.length, 0);
    } finally {
      t.mock.timers.reset();
    }
  });
});
