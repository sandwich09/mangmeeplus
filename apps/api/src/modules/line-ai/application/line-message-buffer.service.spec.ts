import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../../../generated/prisma/client';
import { LineMessageBufferService } from './line-message-buffer.service';
import type { LineBufferEnvelope } from './line-message-buffer.service';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS, LINE_MEDIA_RECEIVED_TEXT, debounceCohortMs, lineMediaGroupAckText } from '../domain/logic/line-message-buffer.logic';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Real macrotask boundary (setImmediate is never mocked here) — flushes the async dispatch chain that
// runs after a mock-timer tick fires the backstop callback.
const settle = async () => { for (let i = 0; i < 6; i += 1) await new Promise<void>((resolve) => setImmediate(resolve)); };

type Row = {
  webhookEventId: string;
  status: string;
  createdAt: Date;
  processedAt?: Date | null;
  errorCode?: string | null;
  companyId?: string | null;
  lineMessageId?: string | null;
  payloadJson?: unknown;
};

function makeHarness(opts: {
  debounceMs?: number;
  maxWaitMs?: number;
  loadingEnabled?: boolean;
  loadingOnAcceptEnabled?: boolean;
  loadingAccepted?: boolean;
  loadingGate?: Promise<void>;
  debounceExperimentEnabled?: boolean;
  debounceExperimentSecret?: string;
  executeImpl?: (event: any) => Promise<void>;
  receiptImpl?: (event: any, caption?: string) => Promise<{ outcome: 'done' | 'defer_text' | 'locked' }>;
  receiptOutcomes?: Array<'done' | 'defer_text' | 'locked'>;
  replyResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
  pushResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
  /** One result per push, in order; when it runs out, `pushResult` (or 'ok') answers. */
  pushResults?: Array<'ok' | 'failed_flex' | 'failed_other' | 'failed_permanent'>;
  eventStoreUnavailable?: boolean;
  legalAcceptanceRequired?: boolean;
  assistantPaused?: boolean;
  preflightImpl?: (event: {
    lineUserId: string;
    messagingChannelId?: string;
    companyIdAtAcceptance?: string;
    snapshotAssistantPause?: boolean;
  }) => Promise<{ status: 'continue'; companyId?: string; assistantPaused?: true } | { status: 'required'; companyId: string }>;
} = {}) {
  const rows = new Map<string, Row>();
  const executed: any[] = [];
  const receipts: Array<{ event: any; caption?: string }> = [];
  const replies: string[] = [];
  const replyMessages: any[] = [];
  const replyTokens: string[] = [];
  // `text` is what the chat list shows (a card's altText); `message` is the whole message as sent.
  const pushes: Array<{ to: string; text: string; message: any; operationId?: string }> = [];
  const loadingCalls: string[] = [];
  const auditLogs: any[] = [];
  const serviceLogs: any[] = [];
  const preflightCalls: Array<{
    lineUserId: string;
    messagingChannelId?: string;
    companyIdAtAcceptance?: string;
    snapshotAssistantPause?: boolean;
  }> = [];
  let receiptCall = 0;

  const prisma = {
    client: {
      company: { findUnique: async () => ({ reportClassification: 'CUSTOMER' }) },
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
            lineMessageId: data.lineMessageId,
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
    webBaseUrl: 'https://app.example.com',
    lineAiBufferDebounceMs: opts.debounceMs ?? 20,
    lineAiBufferMaxWaitMs: opts.maxWaitMs ?? 500,
    // Loading-on-accept is a SUB-feature of the master animation flag (both must be on). For test
    // ergonomics the master defaults ON whenever accept-loading is requested, UNLESS a test sets
    // loadingEnabled explicitly (the gate test sets it false to prove accept-loading stays dark).
    lineAiLoadingAnimationEnabled: opts.loadingEnabled ?? opts.loadingOnAcceptEnabled ?? false,
    lineAiLoadingOnAcceptEnabled: opts.loadingOnAcceptEnabled ?? false,
    lineAiDebounceExperimentEnabled: opts.debounceExperimentEnabled ?? false,
    lineAiDebounceExperimentSecret: opts.debounceExperimentSecret,
  } as any;

  const audit = { log: async (entry: any) => { auditLogs.push(entry); } } as any;

  const lineReply = {
    buildTextMessage: (text: string) => ({ type: 'text', text }),
    sendReply: async (token: string, messages: Array<{ text?: string; altText?: string }>) => {
      replyTokens.push(token);
      replyMessages.push(messages[0]);
      replies.push(messages[0]?.text ?? messages[0]?.altText ?? '');
      return opts.replyResult ?? 'ok';
    },
    sendPush: async (to: string, messages: Array<{ text?: string; altText?: string }>, operationId?: string) => {
      pushes.push({ to, text: messages[0]?.text ?? messages[0]?.altText ?? '', message: messages[0], operationId });
      return opts.pushResults?.shift() ?? opts.pushResult ?? 'ok';
    },
    startLoadingAnimation: async (chatId: string) => {
      loadingCalls.push(chatId);
      if (opts.loadingGate) await opts.loadingGate;
      return opts.loadingAccepted ?? true;
    },
  } as any;

  const useCase = {
    preflightPublicGeneral: async (event: any) => {
      if (opts.legalAcceptanceRequired) return null;
      preflightCalls.push(event);
      const result = opts.preflightImpl ? await opts.preflightImpl(event) : undefined;
      return result?.status === 'required' ? null : { companyId: result?.companyId };
    },
    preflightLegalAcceptance: async (event: {
      lineUserId: string;
      messagingChannelId?: string;
      companyIdAtAcceptance?: string;
      snapshotAssistantPause?: boolean;
    }) => {
      preflightCalls.push(event);
      if (opts.preflightImpl) return opts.preflightImpl(event);
      return opts.legalAcceptanceRequired
        ? { status: 'required' as const, companyId: 'company-1' }
        : {
            status: 'continue' as const,
            ...(opts.assistantPaused ? { assistantPaused: true as const } : {}),
          };
    },
    assistantPaused: async () => opts.assistantPaused ?? false,
    execute: async (event: any) => {
      executed.push(event);
      if (opts.executeImpl) await opts.executeImpl(event);
    },
    executeReceiptUpload: async (event: any, caption?: string) => {
      receipts.push({ event, caption });
      if (opts.receiptImpl) return opts.receiptImpl(event, caption);
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
  return { service, rows, executed, receipts, replies, replyMessages, replyTokens, pushes, loadingCalls, auditLogs, serviceLogs, preflightCalls };
}

let uniq = 0;
function textEnv(id: string, body: string, opts: { chatId?: string; userId?: string; timestamp?: number; draftUpdatePreviewId?: string } = {}): LineBufferEnvelope {
  uniq += 1;
  const userId = opts.userId ?? 'user-1';
  return {
    chatId: opts.chatId ?? userId,
    lineUserId: userId,
    messagingChannelId: 'ch-1',
    item: { kind: 'text', webhookEventId: id, replyToken: `rt-${id}`, text: body,
      ...(opts.draftUpdatePreviewId ? { draftUpdatePreviewId: opts.draftUpdatePreviewId } : {}),
      lineMessageId: `mid-${id}`, timestamp: opts.timestamp ?? uniq },
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

describe('Round 29b incoming LINE message IDs', () => {
  it('persists text and photo message IDs on their created event logs, including the legal gate', async () => {
    for (const legalAcceptanceRequired of [false, true]) {
      const h = makeHarness({ legalAcceptanceRequired });
      await h.service.enqueue(textEnv('own-text-id', 'ข้อความ'));
      await h.service.enqueue(mediaEnv('own-photo-id'));
      assert.equal(h.rows.get('own-text-id')?.lineMessageId, 'mid-own-text-id');
      assert.equal(h.rows.get('own-photo-id')?.lineMessageId, 'mid-own-photo-id');
      await h.service.onModuleDestroy();
    }
  });

  it('stores malformed or absent incoming message IDs as null', async () => {
    for (const legalAcceptanceRequired of [false, true]) {
      const h = makeHarness({ legalAcceptanceRequired });
      for (const [index, id] of [undefined, '', 'has space', 'a'.repeat(201), 'รูป', 'bad/id'].entries()) {
        const envelope = textEnv(`invalid-id-${index}`, 'ข้อความ');
        envelope.item.lineMessageId = id;
        await h.service.enqueue(envelope);
        assert.equal(h.rows.get(envelope.item.webhookEventId)?.lineMessageId, null);
      }
      await h.service.onModuleDestroy();
    }
  });
});

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
    assert.equal(h.replyMessages[0]?.type, 'flex');
    assert.match(JSON.stringify(h.replyMessages[0]), /https:\/\/app\.example\.com\/companies\/company-1/);
    assert.deepEqual(Object.keys(h.preflightCalls[0] ?? {}).sort(), ['lineUserId', 'messagingChannelId']);
  });

  it('terminalizes pending employee media with only its message ID retained', async () => {
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
    assert.equal(row?.lineMessageId, 'mid-legal-media');
    assert.doesNotMatch(JSON.stringify(row), /payroll-secret|rt-legal-media/);
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
    assert.match(h.pushes[0]?.text ?? '', /แชตส่วนตัว/);
    assert.equal(h.rows.get('legal-push')?.status, 'public_unavailable');
    assert.equal(h.preflightCalls.length, 0, 'group refusal never loads private legal/membership context');
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

  it('dispatches public contact and talk without identity/legal preflight while other staff commands stay gated', async () => {
    const publicCommands = makeHarness({
      debounceMs: 5_000,
      preflightImpl: async () => { throw new Error('public commands must not call legal preflight'); },
    });
    await publicCommands.service.enqueue(textEnv('public-contact', 'ติดต่อเรา'));
    await sleep(20);
    await publicCommands.service.enqueue(textEnv('public-talk', 'คุยกับน้องมั่งมี'));
    await sleep(20);
    assert.equal(publicCommands.preflightCalls.length, 0);
    assert.deepEqual(publicCommands.executed.map((event) => event.messageText), ['ติดต่อเรา', 'คุยกับน้องมั่งมี']);

    const services = makeHarness({ legalAcceptanceRequired: true });
    await services.service.enqueue(textEnv('legal-services', 'บริการของเรา'));
    assert.equal(services.executed.length, 0);
    assert.equal(services.rows.get('legal-services')?.status, 'legal_acceptance_required');
  });

  it('lets the callback request through the legal gate like its twin ติดต่อเจ้าหน้าที่ (G19)', async () => {
    const h = makeHarness({ legalAcceptanceRequired: true, debounceMs: 5_000 });
    await h.service.enqueue(textEnv('legal-callback', 'ให้ทีมงานติดต่อกลับ'));
    await sleep(20);
    assert.equal(h.preflightCalls.length, 0);
    assert.deepEqual(h.executed.map((event) => event.messageText), ['ให้ทีมงานติดต่อกลับ']);
    assert.equal(h.replies.length, 0, 'the use case answers the request, never the legal notice');
    assert.notEqual(h.rows.get('legal-callback')?.status, 'legal_acceptance_required');
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

describe('LineMessageBufferService – card-bound draft postbacks', () => {
  it('preserves opaque previewId through accepted payload and fast dispatch without changing command text', async () => {
    const previewId = '550e8400-e29b-41d4-a716-446655440000';
    const h = makeHarness({ debounceMs: 0 });
    await h.service.enqueue(textEnv('draft-card-confirm', 'ยืนยันการแก้ไข', { draftUpdatePreviewId: previewId }));

    assert.equal((h.rows.get('draft-card-confirm')?.payloadJson as any)?.item?.text, 'ยืนยันการแก้ไข');
    assert.equal((h.rows.get('draft-card-confirm')?.payloadJson as any)?.item?.draftUpdatePreviewId, previewId);
    await sleep(20);
    assert.equal(h.executed[0]?.messageText, 'ยืนยันการแก้ไข');
    assert.equal(h.executed[0]?.draftUpdatePreviewId, previewId);
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

  it('max wait flushes anchored to the first bubble under continuous typing', async (t) => {
    // Wall-clock sleeps can exceed the 40ms debounce under parallel-suite load, changing the input timeline.
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      const h = makeHarness({ debounceMs: 40, maxWaitMs: 120 });
      await h.service.enqueue(textEnv('m0', 'm0'));
      for (const id of ['m1', 'm2', 'm3']) {
        t.mock.timers.tick(30);
        await h.service.enqueue(textEnv(id, id));
      }
      t.mock.timers.tick(30);
      await settle();
      assert.equal(h.executed.length, 0, 'the inclusive max-wait boundary has not expired');
      t.mock.timers.tick(1);
      await settle();
      assert.equal(h.executed.length, 1);
      assert.equal(h.executed[0].messageText, 'm0\nm1\nm2\nm3');
      await h.service.enqueue(textEnv('m4', 'm4'));
      t.mock.timers.tick(41);
      await settle();
      assert.equal(h.executed.length, 2);
      assert.equal(h.executed[1].messageText, 'm4');
    } finally {
      t.mock.timers.reset();
    }
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

  it('dispatches deterministic rich-menu message commands without debounce or fragment merging', async () => {
    for (const [index, command] of ['ติดต่อเรา', 'คุยกับน้องมั่งมี', 'บริการของเรา', 'ถ่ายใบเสร็จ', 'เมนูหลัก'].entries()) {
      const h = makeHarness({ debounceMs: 5_000 });
      await h.service.enqueue(textEnv(`rich-command-${index}`, command));
      await sleep(20);
      assert.equal(h.executed[0]?.messageText, command);
    }
  });
});

describe('LineMessageBufferService – media and captions', () => {
  it('snapshots a support pause and dispatches media without AI wait feedback or loading', async () => {
    const h = makeHarness({
      debounceMs: 0,
      loadingOnAcceptEnabled: true,
      assistantPaused: true,
    });

    await h.service.enqueue(mediaEnv('support-photo'));
    await settle();

    assert.equal(h.receipts.length, 1);
    assert.equal(h.receipts[0]?.event.assistantPaused, true);
    assert.equal(
      (h.rows.get('support-photo')?.payloadJson as any)?.item?.assistantPausedAtAcceptance,
      true,
      'orphan replay must preserve that this media arrived while support owned the chat',
    );
    assert.deepEqual(h.loadingCalls, []);
    assert.deepEqual(h.pushes, [], 'no กำลังอ่านเอกสาร wait bubble is emitted');
  });

  it('keeps normal chat responsive while an uncaptioned receipt is still in OCR', async () => {
    let releaseReceipt!: () => void;
    const receiptGate = new Promise<void>((resolve) => { releaseReceipt = resolve; });
    const h = makeHarness({
      debounceMs: 0,
      loadingEnabled: false,
      preflightImpl: async () => ({ status: 'continue', companyId: 'company-at-acceptance' }),
      receiptImpl: async () => {
        await receiptGate;
        return { outcome: 'done' };
      },
    });

    await h.service.enqueue(mediaEnv('slow-receipt'));
    await sleep(20);
    assert.equal(h.receipts.length, 1);
    assert.equal(h.receipts[0]?.event.companyIdAtAcceptance, 'company-at-acceptance');
    assert.equal(
      (h.rows.get('slow-receipt')?.payloadJson as any)?.item?.companyIdAtAcceptance,
      'company-at-acceptance',
      'orphan replay preserves the accepted tenant snapshot',
    );
    // Design lock context 8: the acknowledgement is the scanning card; its sentence is unchanged underneath.
    assert.equal(h.pushes.length, 1);
    assert.equal(h.pushes[0]?.message.type, 'flex');
    assert.match(h.pushes[0]?.message.canonicalText ?? '', /ได้รับรูปแล้ว.*คุยกับน้องต่อได้เลย/);
    assert.match(h.pushes[0]?.text ?? '', /^กำลังอ่านข้อมูลจากรูป .*คุยกับน้องต่อได้เลย$/);

    await h.service.enqueue(textEnv('while-ocr', 'ติดต่อเรา'));
    await sleep(20);
    assert.equal(h.executed.length, 1, 'later command must not wait for OCR');
    assert.equal(h.executed[0]?.messageText, 'ติดต่อเรา');

    releaseReceipt();
    await sleep(20);
  });

  it('company selection stays ordered while receipt result delivery is pending', async () => {
    let release!: () => void;
    const delivery = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    let started!: () => void;
    const receiptStarted = new Promise<void>(resolve => { started = resolve; });
    const h = makeHarness({ debounceMs: 10,
      receiptImpl: async () => { order.push('receipt'); started(); await delivery; order.push('receipt-delivered'); return { outcome: 'done' }; },
      executeImpl: async event => { order.push(event.messageText); },
    });
    try {
      await h.service.enqueue(mediaEnv('r19-receipt'));
      await h.service.enqueue(textEnv('r19-caption', 'ค่าอาหาร'));
      await receiptStarted;
      await h.service.enqueue(textEnv('r19-switch', '/company 2'));
      await settle();
      assert.deepEqual(order, ['receipt'], 'a company switch must not overtake pending receipt delivery');
    } finally { release(); }
    await settle();
    assert.deepEqual(order, ['receipt', 'receipt-delivered', '/company 2']);
    assert.equal(h.receipts.length, 1);
    assert.equal(h.executed.length, 1);
  });

  it('keeps uncaptioned receipts serial with each other', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let call = 0;
    const h = makeHarness({
      debounceMs: 0,
      receiptImpl: async () => {
        call += 1;
        if (call === 1) await firstGate;
        return { outcome: 'done' };
      },
    });

    await h.service.enqueue(mediaEnv('receipt-1'));
    await sleep(20);
    await h.service.enqueue(mediaEnv('receipt-2'));
    await sleep(20);
    assert.equal(h.receipts.length, 1, 'second OCR waits behind the first media job');

    releaseFirst();
    await sleep(30);
    assert.deepEqual(h.receipts.map(({ event }) => event.webhookEventId), ['receipt-1', 'receipt-2']);
  });

  // UAT 2026-09-29 "ส่งรูปที่ 2 ต่อกันแล้วเงียบไป": the second photo of a burst was acknowledged only
  // when its own read began, after the first photo had been answered.
  it('acknowledges a two-photo burst once, on arrival, and answers both in order', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const timeline: string[] = [];
    let loadingAtFirstAnswer = -1;
    let loadingAtSecondRead = -1;
    const h = makeHarness({
      debounceMs: 20,
      loadingEnabled: true,
      receiptImpl: async (event) => {
        timeline.push(`read:${event.webhookEventId}`);
        if (event.webhookEventId === 'burst-1') await firstGate;
        else loadingAtSecondRead = h.loadingCalls.length;
        await event.beforeReply?.();
        timeline.push(`answer:${event.webhookEventId}`);
        if (event.webhookEventId === 'burst-1') loadingAtFirstAnswer = h.loadingCalls.length;
        return { outcome: 'done' };
      },
    });

    await h.service.enqueue(mediaEnv('burst-1'));
    await h.service.enqueue(mediaEnv('burst-2'));
    await sleep(60);
    assert.deepEqual(h.pushes.map((push) => push.message.canonicalText), [lineMediaGroupAckText(['image', 'image'])], 'one acknowledgement for the burst');
    assert.match(h.pushes[0]!.message.canonicalText, /^ได้รับรูปแล้ว 2 รูปค่ะ/);
    // … and it is ONE scanning card that names the burst by its count, not a card per photo.
    assert.equal(h.pushes[0]!.message.type, 'flex');
    assert.match(h.pushes[0]!.text, /^กำลังอ่านข้อมูลจากรูป 2 รูป /);
    assert.match(JSON.stringify(h.pushes[0]!.message.contents), /"เอกสารที่ส่งมา".*"กำลังสแกน"/);
    assert.deepEqual(timeline, ['read:burst-1'], 'both photos are acknowledged while the first is still being read');
    assert.equal(h.service.holds('burst-2'), true, 'the queued photo is still in memory, so the orphan sweep must leave it alone');

    releaseFirst();
    await sleep(40);
    assert.deepEqual(timeline, ['read:burst-1', 'answer:burst-1', 'read:burst-2', 'answer:burst-2']);
    assert.equal(h.pushes.length, 1, 'no per-photo acknowledgement follows');
    assert.ok(loadingAtSecondRead > loadingAtFirstAnswer, 'the typing indicator comes back for the second read');
    assert.equal(h.service.holds('burst-1') || h.service.holds('burst-2'), false, 'answered photos are released');
  });

  // A pushed card has no reply token behind it: if LINE refuses its body, nothing else re-sends it.
  it('re-sends a scanning card LINE refuses ONCE as the sentence it stands for, and the photo is still read and answered', async () => {
    const h = makeHarness({ debounceMs: 0, pushResults: ['failed_flex', 'ok'] });
    await h.service.enqueue(mediaEnv('refused-card'));
    await sleep(30);
    assert.equal(h.pushes.length, 2, 'the card, then its sentence — never a third bubble');
    assert.equal(h.pushes[0]!.message.type, 'flex');
    assert.deepEqual(h.pushes[1]!.message, { type: 'text', text: LINE_MEDIA_RECEIVED_TEXT }, 'the acknowledgement sentence the card declares, as plain text');
    assert.ok(h.pushes[0]!.operationId, 'the first push names its operation');
    assert.equal(h.pushes[1]!.operationId, `${h.pushes[0]!.operationId}:text`, 'the fallback\'s retry key is derived from the first');
    assert.deepEqual(h.receipts.map(({ event }) => event.webhookEventId), ['refused-card'], 'waiting feedback never fails a turn');
  });

  it('does not retry a waiting bubble that failed for another reason, or whose sentence is refused too', async () => {
    for (const pushResults of [['failed_other'], ['failed_permanent'], ['failed_flex', 'failed_other']] as const) {
      const h = makeHarness({ debounceMs: 0, pushResults: [...pushResults] });
      await h.service.enqueue(mediaEnv(`no-retry-${pushResults.join('-')}`));
      await sleep(30);
      assert.equal(h.pushes.length, pushResults.length, pushResults.join(' → '));
      assert.equal(h.receipts.length, 1, 'the read goes on');
    }
  });

  it('acknowledges a photo at once even when an earlier photo is still being read', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const h = makeHarness({
      debounceMs: 0,
      receiptImpl: async (event) => {
        if (event.webhookEventId === 'later-1') await firstGate;
        await event.beforeReply?.();
        return { outcome: 'done' };
      },
    });

    await h.service.enqueue(mediaEnv('later-1'));
    await sleep(20);
    await h.service.enqueue(mediaEnv('later-2'));
    await sleep(20);
    assert.equal(h.receipts.length, 1, 'the second read still waits for the first');
    assert.deepEqual(h.pushes.map((push) => push.message.canonicalText), [LINE_MEDIA_RECEIVED_TEXT, LINE_MEDIA_RECEIVED_TEXT],
      'but its acknowledgement does not');
    assert.deepEqual(h.pushes.map((push) => push.message.type), ['flex', 'flex']);

    releaseFirst();
    await sleep(30);
    assert.deepEqual(h.receipts.map(({ event }) => event.webhookEventId), ['later-1', 'later-2']);
    assert.equal(h.pushes.length, 2);
  });

  it('answers a failed photo on its own and still reads the rest of the burst', async () => {
    const h = makeHarness({
      debounceMs: 20,
      receiptImpl: async (event) => {
        if (event.webhookEventId === 'fail-1') throw new Error('unexpected read failure');
        await event.beforeReply?.();
        return { outcome: 'done' };
      },
    });

    await h.service.enqueue(mediaEnv('fail-1'));
    await h.service.enqueue(mediaEnv('fail-2'));
    await sleep(80);
    assert.deepEqual(h.receipts.map(({ event }) => event.webhookEventId), ['fail-1', 'fail-2'], 'the second photo is still read');
    assert.deepEqual(h.replyTokens, ['rt-fail-1'], 'the fallback answers only the photo that failed');
    assert.match(h.replies[0] ?? '', /ระบบตอบกลับไม่ได้ชั่วคราว/);
    assert.equal(h.rows.get('fail-1')?.status, 'unavailable_delivered');
    assert.equal(h.rows.get('fail-2')?.status, 'received', 'the second photo stays with its own turn');
  });

  it('keeps captioned media on the ordered main lane', async () => {
    let releaseReceipt!: () => void;
    const receiptGate = new Promise<void>((resolve) => { releaseReceipt = resolve; });
    const h = makeHarness({
      debounceMs: 10,
      receiptImpl: async () => {
        await receiptGate;
        return { outcome: 'done' };
      },
    });

    await h.service.enqueue(mediaEnv('captioned-receipt'));
    await h.service.enqueue(textEnv('receipt-caption', 'ค่าอาหารลูกค้า'));
    await sleep(30);
    assert.equal(h.receipts.length, 1);
    assert.equal(h.receipts[0]?.caption, 'ค่าอาหารลูกค้า');

    await h.service.enqueue(textEnv('after-captioned', 'ติดต่อเรา'));
    await sleep(20);
    // Owner 2026-08-27: stateless MENU commands answer immediately instead of waiting behind the
    // in-flight receipt turn; only company commands still keep strict send order.
    assert.equal(h.executed.length, 1, 'stateless menu command overtakes the busy worker');
    assert.equal(h.executed[0]?.messageText, 'ติดต่อเรา');

    releaseReceipt();
    await sleep(40);
    assert.equal(h.executed.length, 1, 'no duplicate dispatch after the receipt completes');
  });

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

  // Review 2026-09-29: a locked shop's burst of photos drew one lock card PER photo, each after a
  // "reading your photo" ack for a read that never happens. The first card answers the batch.
  it('answers a locked shop\'s photo batch with one lock card, and closes the rest', async () => {
    const h = makeHarness({ debounceMs: 20, receiptOutcomes: ['locked'] });
    await h.service.enqueue(mediaEnv('lk1'));
    await h.service.enqueue(mediaEnv('lk2'));
    await h.service.enqueue(mediaEnv('lk3'));
    await h.service.enqueue(textEnv('lk-cap', 'บันทึกบิลพวกนี้'));
    await sleep(80);
    assert.equal(h.receipts.length, 1, 'one turn, one card');
    for (const id of ['lk2', 'lk3', 'lk-cap']) assert.equal(h.rows.get(id)?.status, 'batched', id);
    assert.equal(h.executed.length, 0, 'and no text turn to draw a second card');
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
    assert.equal(h.replies.filter((r) => /กำลังประมวลผลข้อความก่อนหน้า|previous request is still processing/iu.test(r)).length, 1, 'one notice per episode');
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

  it('onModuleDestroy also drains media handed off after shutdown begins', async () => {
    let releaseReceipt!: () => void;
    const receiptGate = new Promise<void>((resolve) => { releaseReceipt = resolve; });
    const h = makeHarness({
      debounceMs: 60_000,
      receiptImpl: async () => {
        await receiptGate;
        return { outcome: 'done' };
      },
    });
    await h.service.enqueue(mediaEnv('shutdown-receipt'));

    let destroyed = false;
    const destroying = h.service.onModuleDestroy().then(() => { destroyed = true; });
    await sleep(20);
    assert.equal(h.receipts.length, 1);
    assert.equal(destroyed, false, 'shutdown waits for the detached media lane');

    releaseReceipt();
    await destroying;
    assert.equal(destroyed, true);
  });

  it('starts the loading animation for 1:1 chats only', async () => {
    const h = makeHarness({ debounceMs: 10, loadingEnabled: true });
    await h.service.enqueue(textEnv('l1', 'สวัสดี', { userId: 'user-1' }));
    await h.service.enqueue(textEnv('l2', 'จากกลุ่ม', { userId: 'user-2', chatId: 'group-1' }));
    await sleep(60);
    assert.deepEqual(h.loadingCalls, ['user-1']);
  });

  it('keeps the spinner as the only feedback until ONE slow-turn status just before it expires (Owner 2026-08-27 + 2026-08-29)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      let releaseTurn!: () => void;
      let completeTurn!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const completed = new Promise<void>((resolve) => { completeTurn = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const h = makeHarness({
        debounceMs: 2_000,
        maxWaitMs: 8_000,
        loadingEnabled: true,
        executeImpl: async (event) => {
          markStarted();
          await gate;
          await event.beforeReply?.();
          completeTurn();
        },
      });

      await h.service.enqueue(textEnv('wait-1', 'ขอดูบัญชีเดือนนี้หน่อย'));
      assert.deepEqual(h.loadingCalls, []);

      t.mock.timers.tick(1_999);
      await settle();
      assert.deepEqual(h.loadingCalls, [], 'debounce keeps collecting bubbles for 2 seconds');

      t.mock.timers.tick(2);
      await settle();
      await started;
      assert.deepEqual(h.loadingCalls, ['user-1']);

      t.mock.timers.tick(52_000);
      await settle();
      assert.equal(h.pushes.length, 0, 'quick and ordinary turns stay bubble-free — the spinner is the story');

      t.mock.timers.tick(8_000);
      await settle();
      assert.equal(h.pushes.length, 1, 'a genuinely slow turn says so once, before the 60 s spinner lapses');
      assert.match(h.pushes[0]?.text ?? '', /ยังหาคำตอบอยู่/);
      // Design lock context 5 "กำลังตรวจสอบ": that one status is the locked waiting card, same sentence.
      assert.equal(h.pushes[0]?.message.type, 'flex');
      assert.match(h.pushes[0]?.message.canonicalText ?? '', /ยังหาคำตอบอยู่/);
      assert.match(JSON.stringify(h.pushes[0]?.message.contents), /"ข้อมูลที่คุณขอ".*"กำลังตรวจสอบ"/);

      t.mock.timers.tick(1_300);
      await settle();
      assert.deepEqual(h.loadingCalls, ['user-1', 'user-1', 'user-1'], 'the status restarts the spinner to cover the stretch to the 120 s timeout');

      releaseTurn();
      await completed;
      assert.equal(h.pushes.length, 1, 'never a second slow status for the same turn');
    } finally {
      t.mock.timers.reset();
    }
  });

  it('cancels waiting feedback when the real answer is ready within 5 seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
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

      await h.service.enqueue(textEnv('wait-fast', 'ขอบคุณนะ'));
      await completed;
      t.mock.timers.tick(5_750);
      await settle();
      assert.equal(h.pushes.length, 0);
      assert.deepEqual(h.loadingCalls, ['user-1']);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('runs no loading restarts now that no status bubble dismisses the spinner', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      let releaseTurn!: () => void;
      let completeTurn!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const completed = new Promise<void>((resolve) => { completeTurn = resolve; });
      const h = makeHarness({
        debounceMs: 0,
        loadingEnabled: true,
        executeImpl: async (event) => {
          await gate;
          await event.beforeReply?.();
          completeTurn();
        },
      });

      await h.service.enqueue(textEnv('wait-restart-cancel', 'ช่วยตรวจข้อมูลให้หน่อย'));
      await settle();
      t.mock.timers.tick(5_000);
      await settle();
      t.mock.timers.tick(300);
      await settle();
      assert.deepEqual(h.loadingCalls, ['user-1'], 'one spinner request, no status, no restart');

      releaseTurn();
      await completed;
      t.mock.timers.tick(1_000);
      await settle();
      assert.deepEqual(h.loadingCalls, ['user-1'], 'nothing left to cancel after the answer');
    } finally {
      t.mock.timers.reset();
    }
  });

  it('keeps reordered-batch joining intact with no status bubble at any tick', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      let releaseTurn!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const h = makeHarness({
        debounceMs: 2_000,
        maxWaitMs: 8_000,
        loadingEnabled: true,
        executeImpl: async (event) => {
          markStarted();
          await gate;
          await event.beforeReply?.();
        },
      });

      // The later-accepted bubble carries an older LINE timestamp, so sorting moves it before wait-old.
      await h.service.enqueue(textEnv('wait-old', 'ข้อความแรก', { timestamp: 200 }));
      t.mock.timers.tick(1_000);
      await settle();
      await h.service.enqueue(textEnv('wait-new', 'ข้อความล่าสุด', { timestamp: 100 }));

      t.mock.timers.tick(2_001);
      await settle();
      await started;
      assert.equal(h.executed[0]?.messageText, 'ข้อความล่าสุด\nข้อความแรก');

      t.mock.timers.tick(1_999);
      await settle();
      assert.equal(h.pushes.length, 0);

      t.mock.timers.tick(48_000);
      await settle();
      assert.equal(h.pushes.length, 0, 'no early status bubble — nothing at the old 5-second mark');

      t.mock.timers.tick(12_000);
      await settle();
      assert.equal(h.pushes.length, 1, 'only the anchored slow-turn status appears');

      releaseTurn();
      await settle();
    } finally {
      t.mock.timers.reset();
    }
  });

  it('with the animation disabled, the 5 s topic status returns as the fallback feedback (spec §10)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      let releaseTurn!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const h = makeHarness({
        debounceMs: 0,
        loadingEnabled: false,
        executeImpl: async (event) => {
          await gate;
          await event.beforeReply?.();
        },
      });

      await h.service.enqueue(textEnv('wait-fallback', 'ช่วยตรวจข้อมูลให้หน่อย'));
      await settle();
      assert.deepEqual(h.loadingCalls, [], 'no spinner when the animation flag is off');

      t.mock.timers.tick(5_000);
      await settle();
      assert.equal(h.pushes.length, 1, 'the topic status is the only early "working" signal without the spinner');
      assert.match(h.pushes[0]?.text ?? '', /ตรวจสอบ|เช็กข้อมูล/);

      releaseTurn();
      await settle();
    } finally {
      t.mock.timers.reset();
    }
  });
});

describe('LineMessageBufferService – loading on accept (latency/autonomy §10, default off)', () => {
  it('requests one coalesced 1:1 loading after acceptance, before the debounce wait', async () => {
    // Both flags on; the 5 s debounce means no batch has dispatched yet, so the only loading call so far is
    // the accept-time one (the processing-start loading only fires later, at dispatch).
    const h = makeHarness({ debounceMs: 5_000, loadingOnAcceptEnabled: true });
    await h.service.enqueue(textEnv('a1', 'ขอ'));
    await h.service.enqueue(textEnv('a2', 'ยอดขาย'));
    await h.service.enqueue(textEnv('a3', 'วันนี้'));
    // Fired synchronously in enqueue, before the batch is ever dispatched.
    assert.deepEqual(h.loadingCalls, ['user-1']);
    assert.equal(h.executed.length, 0);
  });

  it('requires the MASTER animation flag: the accept flag alone shows NO loading (P2-A)', async () => {
    // Master off, accept on → loading-on-accept is a sub-feature and stays dark: no LINE request, no event.
    const h = makeHarness({ debounceMs: 5_000, loadingEnabled: false, loadingOnAcceptEnabled: true });
    await h.service.enqueue(textEnv('a1', 'ขอ'));
    await h.service.enqueue(textEnv('a2', 'ยอดขาย'));
    assert.deepEqual(h.loadingCalls, [], 'no accept-loading when the master animation flag is off');
    assert.equal(h.serviceLogs.filter((entry) => entry.msg === 'line.ai.loading_started').length, 0, 'no loading_started telemetry either');
  });

  it('does not request accept-time loading for group chats', async () => {
    const h = makeHarness({ debounceMs: 5_000, loadingOnAcceptEnabled: true });
    await h.service.enqueue(textEnv('g1', 'สวัสดี', { userId: 'user-1', chatId: 'group-1' }));
    assert.deepEqual(h.loadingCalls, []);
  });

  it('does not request accept-time loading for an idle command', async () => {
    const h = makeHarness({ debounceMs: 5_000, loadingOnAcceptEnabled: true });
    await h.service.enqueue(textEnv('c1', '/companies'));
    assert.deepEqual(h.loadingCalls, []);
  });

  it('leaves loading at processing start when the accept flag is off (unchanged path)', async () => {
    const h = makeHarness({ debounceMs: 10, loadingEnabled: true, loadingOnAcceptEnabled: false });
    await h.service.enqueue(textEnv('o1', 'สวัสดี'));
    // No accept-time call; the single call is the existing processing-start loading.
    await sleep(60);
    assert.deepEqual(h.loadingCalls, ['user-1']);
  });
});

describe('LineMessageBufferService – debounce experiment cohort (latency/autonomy §10, default off)', () => {
  it('applies a stable cohort only when on with a secret and a resolved company', async () => {
    // Company present → effective debounce becomes a cohort (>=1000 ms), so a single bubble does NOT
    // take the configured 0 ms serialize-now path.
    const withCompany = makeHarness({
      debounceMs: 0, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue', companyId: 'co-1' }),
    });
    await withCompany.service.enqueue(textEnv('exp-1', 'ยอดขายวันนี้'));
    await sleep(20);
    assert.equal(withCompany.executed.length, 0, 'the cohort debounce holds the bubble past the 0 ms path');
    await withCompany.service.onModuleDestroy();
    assert.equal(withCompany.executed.length, 1);

    // No resolved company → no assignment; the configured 0 ms serialize-now path is unchanged.
    const noCompany = makeHarness({
      debounceMs: 0, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue' }),
    });
    await noCompany.service.enqueue(textEnv('exp-2', 'ยอดขายวันนี้'));
    await sleep(20);
    assert.equal(noCompany.executed.length, 1, 'no company → configured debounce, immediate flush');
  });

  it('keeps the configured debounce for everyone when the experiment is off', async () => {
    const h = makeHarness({
      debounceMs: 0, maxWaitMs: 60_000,
      debounceExperimentEnabled: false, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue', companyId: 'co-1' }),
    });
    await h.service.enqueue(textEnv('off-1', 'ยอดขายวันนี้'));
    await sleep(20);
    assert.equal(h.executed.length, 1, 'experiment off → configured 0 ms path, immediate flush');
  });

  it('preserves the configured debounce path when the experiment is on but the secret is missing', async () => {
    const h = makeHarness({
      debounceMs: 0, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: undefined,
      preflightImpl: async () => ({ status: 'continue', companyId: 'co-1' }),
    });
    await h.service.enqueue(textEnv('nosecret-1', 'ยอดขายวันนี้'));
    await sleep(20);
    assert.equal(h.executed.length, 1, 'no secret → no assignment, configured 0 ms path unchanged');
  });

  it('freezes the batch cohort at open; a later bubble resolving a DIFFERENT company does not re-assign it', async () => {
    // Precondition: the two authoritative companies map to different cohorts for this chat.
    const co1 = debounceCohortMs({ enabled: true, secret: 'experiment-secret', assignmentKey: 'co-1:chat-frz', configuredMs: 2_000 });
    const co2 = debounceCohortMs({ enabled: true, secret: 'experiment-secret', assignmentKey: 'co-2:chat-frz', configuredMs: 2_000 });
    assert.notEqual(co1, co2, 'test precondition: co-1 and co-2 resolve to different cohorts for this chat');

    let call = 0;
    const h = makeHarness({
      debounceMs: 2_000, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue' as const, companyId: call++ === 0 ? 'co-1' : 'co-2' }),
    });
    try {
      await h.service.enqueue(textEnv('frz-1', 'ก', { chatId: 'chat-frz', userId: 'user-1' })); // opens batch → freezes co-1 cohort
      await h.service.enqueue(textEnv('frz-2', 'ข', { chatId: 'chat-frz', userId: 'user-1' })); // joins; preflight now resolves co-2
      const state = (h.service as any).chats.get('ch-1:chat-frz:user-1');
      assert.equal(state.debounceMs, co1, 'cohort frozen at open (co-1), NOT re-assigned to co-2 by the later bubble');
    } finally {
      await h.service.onModuleDestroy();
    }
  });

  it('unresolved company stays on the configured debounce even with the experiment on', async () => {
    const h = makeHarness({
      debounceMs: 0, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue' as const }), // no companyId resolved
    });
    await h.service.enqueue(textEnv('unres-1', 'ยอดขายวันนี้'));
    await sleep(20);
    assert.equal(h.executed.length, 1, 'no company → configured 0 ms path, immediate flush');
  });

  it('assigns the SAME cohort to two users in one group (cluster is company+chat, not per user), buffers stay isolated', async () => {
    const h = makeHarness({
      debounceMs: 2_000, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue', companyId: 'co-1' }),
    });
    try {
      await h.service.enqueue(textEnv('g-a', 'ก', { chatId: 'group-9', userId: 'user-A' }));
      await h.service.enqueue(textEnv('g-b', 'ข', { chatId: 'group-9', userId: 'user-B' }));
      const stateA = (h.service as any).chats.get('ch-1:group-9:user-A');
      const stateB = (h.service as any).chats.get('ch-1:group-9:user-B');
      assert.ok(stateA && stateB && stateA !== stateB, 'buffers are isolated per (chat,user)');
      assert.equal(stateA.debounceMs, stateB.debounceMs, 'cohort shared across users of the same (company,chat)');
      assert.ok([1_000, 1_500, 2_000].includes(stateA.debounceMs), 'cohort is one of the declared values');
    } finally {
      await h.service.onModuleDestroy();
    }
  });
});

describe('LineMessageBufferService – deterministic debounce boundary (latency/autonomy §10)', () => {
  // Fake timers ACTUALLY fire here (tick advances the clock and runs due callbacks). The backstop is
  // armed strictly after the logical boundary (+1 ms), so a bubble arriving at exactly the boundary
  // (gap == debounce) still joins even though the scheduler drives the timer.
  it('joins at exactly gap == debounce when the backstop timer is one ms past the boundary', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      const h = makeHarness({ debounceMs: 1_000, maxWaitMs: 60_000 });
      await h.service.enqueue(textEnv('j1', 'ขอ'));   // t=0; backstop fires at t=1001
      t.mock.timers.tick(1_000);                        // advance to the boundary; backstop (1001) does NOT fire
      await settle();
      assert.equal(h.executed.length, 0, 'boundary reached but not passed → no flush yet');
      await h.service.enqueue(textEnv('j2', 'ยอดขาย')); // acceptedAt=1000; scheduledFlushAt(1000) < 1000 is false → join
      t.mock.timers.tick(2_000);                        // fire the joined buffer's backstop
      await settle();
      assert.equal(h.executed.length, 1, 'gap == debounce joins one turn');
      assert.equal(h.executed[0].messageText, 'ขอ\nยอดขาย');
    } finally {
      t.mock.timers.reset();
    }
  });

  it('splits at gap == debounce + 1 when the backstop timer fires', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      const h = makeHarness({ debounceMs: 1_000, maxWaitMs: 60_000 });
      await h.service.enqueue(textEnv('s1', 'ขอ'));   // t=0; backstop fires at t=1001
      t.mock.timers.tick(1_001);                        // fire the backstop → s1 flushes
      await settle();
      assert.equal(h.executed.length, 1, 's1 flushed by its own backstop');
      await h.service.enqueue(textEnv('s2', 'ยอดขาย')); // t=1001; open empty → separate batch
      t.mock.timers.tick(2_000);
      await settle();
      assert.equal(h.executed.length, 2, 'gap > debounce splits into two turns');
      assert.deepEqual(h.executed.map((event) => event.messageText), ['ขอ', 'ยอดขาย']);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('a stale (superseded/cleared-but-queued) backstop callback cannot clear or disable the current schedule', async () => {
    // Capture the service's setTimeout callbacks so a stale one can be fired by hand — the case fake
    // timers cannot model (clearTimeout removes it from their queue).
    const captured: Array<{ cb: () => void; handle: number; cleared: boolean }> = [];
    let nextHandle = 1;
    const realSetTimeout = global.setTimeout;
    const realClearTimeout = global.clearTimeout;
    (global as any).setTimeout = (cb: () => void) => { const handle = nextHandle++; captured.push({ cb, handle, cleared: false }); return handle; };
    (global as any).clearTimeout = (handle: number) => { const found = captured.find((entry) => entry.handle === handle); if (found) found.cleared = true; };
    try {
      const h = makeHarness({ debounceMs: 1_000, maxWaitMs: 60_000 });
      await h.service.enqueue(textEnv('a', 'ขอ'));   // arms backstop #1 (generation 1)
      await h.service.enqueue(textEnv('b', 'ยอด'));  // joins within debounce → clears #1, arms #2 (gen 2)
      const state = (h.service as any).chats.get('ch-1:user-1:user-1');
      assert.equal(captured.length, 2);
      assert.equal(captured[0].cleared, true, 'the first backstop was cleared on reschedule');
      const liveTimer = state.debounceTimer;
      const liveGeneration = state.flushGeneration;

      // Fire the STALE callback #1: it must return without touching the live schedule.
      captured[0].cb();
      assert.equal(state.debounceTimer, liveTimer, 'stale callback did not erase the current timer reference');
      assert.equal(state.flushGeneration, liveGeneration, 'stale callback did not change the generation');
      assert.equal(state.open.length, 2, 'the joined buffer is still open under the live schedule');

      // The CURRENT callback #2 still owns the schedule and flushes once its boundary has passed.
      const realDateNow = Date.now;
      Date.now = () => Number.MAX_SAFE_INTEGER;
      try { captured[1].cb(); } finally { Date.now = realDateNow; }
      assert.equal(state.debounceTimer, null, 'current callback cleared its own reference');
      assert.equal(state.open.length, 0, 'current schedule flushed the joined buffer');
    } finally {
      (global as any).setTimeout = realSetTimeout;
      (global as any).clearTimeout = realClearTimeout;
    }
  });
});

describe('LineMessageBufferService – API end-to-end trace (latency/autonomy §12)', () => {
  it('emits one privacy-safe api_trace per dispatched turn, correlated by webhookEventId', async () => {
    const h = makeHarness({ debounceMs: 20 });
    await h.service.enqueue(textEnv('t1', 'ขอ'));
    await h.service.enqueue(textEnv('t2', 'ยอดขาย'));
    await sleep(60);
    const traces = h.serviceLogs.filter((entry) => entry.msg === 'line.ai.api_trace');
    assert.equal(traces.length, 1, 'one joined turn → one trace');
    const trace = traces[0];
    assert.equal(trace.webhookEventId, 't2', 'keyed by the synthesized (last) bubble');
    assert.equal(trace.chat, 'one_to_one');
    assert.equal(trace.segment, 'text');
    assert.ok(Number.isInteger(trace.acceptedAtMs) && trace.acceptedAtMs > 0, 'carries the durable-acceptance milestone');
    assert.ok(Number.isInteger(trace.bufferWaitMs) && trace.bufferWaitMs >= 0);
    assert.ok(Number.isInteger(trace.queueWaitMs) && trace.queueWaitMs >= 0);
    // No lumped dispatch duration (that is decomposed into the line.ai.stage seams), and no raw ids/text.
    const keys = Object.keys(trace);
    assert.ok(!keys.includes('dispatchMs'), 'no lumped dispatch aggregation on the api_trace');
    assert.ok(!keys.includes('lineUserId') && !keys.includes('chatId') && !keys.includes('text'));
  });

  it('marks a group chat trace as group', async () => {
    const h = makeHarness({ debounceMs: 0 });
    await h.service.enqueue(textEnv('grp', 'ยอดขาย', { userId: 'user-1', chatId: 'group-9' }));
    await sleep(20);
    const trace = h.serviceLogs.find((entry) => entry.msg === 'line.ai.api_trace');
    assert.equal(trace?.chat, 'group');
  });

  it('emits loading_started at acceptance and loading_accepted at the ordered consumption', async () => {
    const h = makeHarness({ debounceMs: 20, loadingOnAcceptEnabled: true, loadingAccepted: true });
    await h.service.enqueue(textEnv('load-1', 'ยอดขายวันนี้'));
    // loading_started is emitted synchronously at acceptance…
    assert.equal(h.serviceLogs.find((entry) => entry.msg === 'line.ai.loading_started')?.webhookEventId, 'load-1');
    // …loading_accepted only once the turn consumes/awaits the request (before its reply).
    await sleep(60);
    assert.equal(h.serviceLogs.find((entry) => entry.msg === 'line.ai.loading_accepted')?.webhookEventId, 'load-1');
  });

  it('does not emit loading_accepted when LINE rejects the loading request', async () => {
    const h = makeHarness({ debounceMs: 20, loadingOnAcceptEnabled: true, loadingAccepted: false });
    await h.service.enqueue(textEnv('load-2', 'ยอดขายวันนี้'));
    await sleep(60);
    assert.ok(h.serviceLogs.some((entry) => entry.msg === 'line.ai.loading_started'));
    assert.ok(!h.serviceLogs.some((entry) => entry.msg === 'line.ai.loading_accepted'));
  });

  it('orders the accept-loading request and loading_accepted strictly before the final reply (fast/debounce-0 turn)', async () => {
    let releaseLoading!: () => void;
    const loadingGate = new Promise<void>((resolve) => { releaseLoading = resolve; });
    const order: string[] = [];
    const h = makeHarness({
      debounceMs: 0, loadingOnAcceptEnabled: true, loadingAccepted: true, loadingGate,
      executeImpl: async (event) => { order.push('turn'); await event.beforeReply?.(); order.push('reply'); },
    });
    await h.service.enqueue(textEnv('ord-1', 'ยอดขายวันนี้'));
    await sleep(20);
    // The turn is blocked awaiting the (gated) loading request; nothing has replied yet.
    assert.deepEqual(order, [], 'turn must not run before the loading request resolves');
    assert.ok(!h.serviceLogs.some((entry) => entry.msg === 'line.ai.loading_accepted'));

    releaseLoading();
    await sleep(20);
    assert.deepEqual(order, ['turn', 'reply']);
    const acceptedIdx = h.serviceLogs.findIndex((entry) => entry.msg === 'line.ai.loading_accepted');
    assert.ok(acceptedIdx >= 0, 'loading_accepted was emitted');
  });

  it('does not fire a duplicate processing-start loading when accept-loading covers the turn', async () => {
    // Both features on: exactly one loading request for the single turn (the reused accept-time one).
    const h = makeHarness({ debounceMs: 10, loadingEnabled: true, loadingOnAcceptEnabled: true, loadingAccepted: true });
    await h.service.enqueue(textEnv('dup-1', 'ยอดขายวันนี้'));
    await sleep(60);
    assert.deepEqual(h.loadingCalls, ['user-1'], 'accept-loading reused, not duplicated at processing start');
  });

  it('binds each batch’s loading to its own batch — no overwrite or cross-consumption while a first batch is blocked with multiple groups', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const order: string[] = [];
    const h = makeHarness({
      debounceMs: 20, loadingOnAcceptEnabled: true, loadingAccepted: true, loadingGate: gate,
      executeImpl: async (event) => { order.push('turn:' + event.messageText); await event.beforeReply?.(); order.push('reply:' + event.messageText); },
    });
    const startedIds = () => h.serviceLogs.filter((e) => e.msg === 'line.ai.loading_started').map((e) => e.webhookEventId);
    const acceptedIds = () => h.serviceLogs.filter((e) => e.msg === 'line.ai.loading_accepted').map((e) => e.webhookEventId);

    // Batch 1: a text opener (fires its loading) plus a command → one batch with TWO groups.
    await h.service.enqueue(textEnv('b1a', 'ยอดขายวันนี้'));
    await h.service.enqueue(textEnv('cmd1', '/company 1')); // command forces the flush → batch1 = [text, command]
    await sleep(40);
    // Batch 1 is dequeued and blocked awaiting ITS OWN loading; no turn has run.
    assert.equal(order.length, 0, 'batch1 blocked on its own loading before any group ran');
    assert.deepEqual(acceptedIds(), []);

    // Batch 2 arrives while batch 1 is processing → its own loading, bound to batch 2.
    await h.service.enqueue(textEnv('b2a', 'ของอะไรใกล้หมด'));
    await sleep(40);
    assert.deepEqual(startedIds(), ['b1a', 'b2a'], 'each batch requested its own loading; the second never overwrote the first');
    assert.deepEqual(acceptedIds(), [], 'neither loading consumed while gated');

    // Release both loading requests. Each batch proceeds after — and only after — its own loading.
    release();
    await sleep(80);
    assert.deepEqual(acceptedIds(), ['b1a', 'b2a'], 'each batch consumed only its own loading, in batch order');
    // Loading was awaited before each batch’s finals: the gate held every turn until release.
    assert.ok(order.includes('reply:ยอดขายวันนี้'), 'batch1 content final delivered');
    assert.ok(order.includes('reply:ของอะไรใกล้หมด'), 'batch2 content final delivered');
    assert.equal(order.indexOf('turn:ยอดขายวันนี้') < order.indexOf('turn:ของอะไรใกล้หมด'), true, 'batch order preserved');
  });

  it('api_trace.loadingRequested is false for a COMMAND segment even in a batch that bound loading', async () => {
    // A text opener binds accept-loading, then a command forces the flush → one batch, two segments.
    const h = makeHarness({ debounceMs: 5_000, loadingOnAcceptEnabled: true, loadingAccepted: true });
    await h.service.enqueue(textEnv('mix-q', 'ยอดขายวันนี้'));  // text opener → binds loading
    await h.service.enqueue(textEnv('mix-c', '/company 2'));    // command forces flush → mixed batch
    await sleep(40);
    const textTrace = h.serviceLogs.find((entry) => entry.msg === 'line.ai.api_trace' && entry.segment === 'text');
    const commandTrace = h.serviceLogs.find((entry) => entry.msg === 'line.ai.api_trace' && entry.segment === 'command');
    assert.ok(textTrace && commandTrace, 'both a text and a command api_trace were emitted');
    assert.equal(textTrace.loadingRequested, true, 'the text segment reports the batch bound loading');
    assert.equal(commandTrace.loadingRequested, false, 'the command segment never reports loading, even in a loading batch');
  });

  it('api_trace.loadingRequested reflects the batch actual bound accept-loading, not a config guess', async () => {
    const traceFor = (h: ReturnType<typeof makeHarness>, id: string) =>
      h.serviceLogs.find((entry) => entry.msg === 'line.ai.api_trace' && entry.webhookEventId === id);

    // Flag off → no loading bound → false.
    const off = makeHarness({ debounceMs: 0, loadingOnAcceptEnabled: false });
    await off.service.enqueue(textEnv('r-off', 'ยอดขาย'));
    await sleep(20);
    assert.equal(traceFor(off, 'r-off')?.loadingRequested, false);

    // Flag on, 1:1 text → loading bound → true.
    const on = makeHarness({ debounceMs: 0, loadingOnAcceptEnabled: true, loadingAccepted: true });
    await on.service.enqueue(textEnv('r-on', 'ยอดขาย'));
    await sleep(20);
    assert.equal(traceFor(on, 'r-on')?.loadingRequested, true);

    // Flag on but GROUP chat → not 1:1 → no loading bound → false.
    const grp = makeHarness({ debounceMs: 0, loadingOnAcceptEnabled: true });
    await grp.service.enqueue(textEnv('r-grp', 'ยอดขาย', { userId: 'user-1', chatId: 'group-1' }));
    await sleep(20);
    assert.equal(traceFor(grp, 'r-grp')?.loadingRequested, false);
  });

  it('api_trace.loadingRequested is false for a TEXT turn whose batch bound no loading (command-opened, merged while busy)', async () => {
    // The case that distinguishes actual truth from a config guess: flag ON + 1:1 + a text turn, yet
    // its batch carries no accept-loading because a command opened the batch (during prior processing)
    // and the text merged into it.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let blocked = false;
    const h = makeHarness({
      debounceMs: 0, loadingOnAcceptEnabled: true, loadingAccepted: true,
      executeImpl: async (event) => { if (event.messageText === 'block' && !blocked) { blocked = true; await gate; } await event.beforeReply?.(); },
    });
    await h.service.enqueue(textEnv('blk', 'block'));       // batch0 → processing, gated (worker busy)
    await sleep(20);
    await h.service.enqueue(textEnv('cmd', '/company 1'));  // opens+flushes a command batch (no loading), stays pending
    await h.service.enqueue(textEnv('q', 'ยอดขายวันนี้'));   // merges into the pending command batch (still no loading)
    await sleep(20);
    release();
    await sleep(60);
    const textTrace = h.serviceLogs.find((entry) => entry.msg === 'line.ai.api_trace' && entry.webhookEventId === 'q' && entry.segment === 'text');
    assert.ok(textTrace, 'a text-segment trace was emitted');
    assert.equal(textTrace.loadingRequested, false, 'text turn in a no-loading batch reports false, not a config guess');
  });

  it('re-shows processing-start loading for a batch whose accept-loading spinner was dismissed by a prior batch final (overlap)', async () => {
    let releaseBatch1!: () => void;
    const gate = new Promise<void>((resolve) => { releaseBatch1 = resolve; });
    let batch1Turn = false;
    const h = makeHarness({
      debounceMs: 0, loadingEnabled: true, loadingOnAcceptEnabled: true, loadingAccepted: true,
      executeImpl: async (event) => { if (event.messageText === 'batch1' && !batch1Turn) { batch1Turn = true; await gate; } await event.beforeReply?.(); },
    });
    await h.service.enqueue(textEnv('b1', 'batch1'));  // idle → accept-loading (call 1), suppressed at processing
    await sleep(20);
    assert.deepEqual(h.loadingCalls, ['user-1'], 'batch1 accept-loading only (suppressed processing-start)');
    await h.service.enqueue(textEnv('b2', 'batch2'));  // during batch1 processing → accept-loading (call 2), firedDuringProcessing
    await sleep(20);
    assert.deepEqual(h.loadingCalls, ['user-1', 'user-1']);
    releaseBatch1();                                    // batch1 final dismisses batch2's spinner
    await sleep(60);
    assert.deepEqual(h.loadingCalls, ['user-1', 'user-1', 'user-1'], 'batch2 re-showed processing-start loading (not suppressed)');
  });
});


describe('v2 buffer rollout admission', () => {
  it('uses private-company restrictions or the public channel, without a public-list bypass', async () => {
    const cases = [
      { name: 'private unrestricted', companyId: 'company-1', expected: true },
      { name: 'private reliability restriction', companyId: 'company-1', companyIds: ['other'], expected: false },
      { name: 'private delivery restriction', companyId: 'company-1', writeIds: ['other'], expected: false },
      { name: 'explicit off', companyId: 'company-1', mode: 'off', expected: false },
      { name: 'delivery off', companyId: 'company-1', deliveryEnabled: false, expected: false },
      { name: 'public unrestricted', publicChat: true, companyId: 'payer', companyIds: ['other'], expected: true },
      { name: 'public restricted', publicChat: true, companyId: 'payer', publicIds: ['other'], expected: false },
      { name: 'public wrong primary channel', publicChat: true, companyId: 'payer', primaryChannel: 'other', expected: false },
    ];
    for (const sample of cases) {
      const { service } = makeHarness({ preflightImpl: async () => ({ status: 'continue', companyId: sample.companyId }) });
      const subject = service as any;
      Object.assign(subject.config, {
        lineAiReliabilityV2Mode: sample.mode ?? 'on', lineAiDeliveryPlanV2Enabled: sample.deliveryEnabled ?? true,
        lineAiReliabilityV2CompanyIds: sample.companyIds ?? [], lineAiDeliveryPlanV2WriteCompanyIds: sample.writeIds ?? [],
        lineAiDeliveryPlanV2PublicChannelIds: sample.publicIds ?? [], lineMessagingChannelId: sample.primaryChannel ?? 'ch-1',
      });
      // Inspect the admitted state before any dispatch; this test never invokes an AI provider.
      subject.scheduleFlush = () => {};
      const envelope = textEnv(`rollout-${sample.name}`, 'คำถามทดสอบ', sample.publicChat ? { chatId: 'group-1' } : {});
      await service.enqueue(envelope);
      assert.equal([...subject.chats.values()][0]?.reliabilityV2, sample.expected, sample.name);
      subject.chats.clear();
    }
  });
});

// Owner 2026-09-30 ("ทุกกรณีที่ระบบรับไว้ก่อน"): a message the orphan sweep replays was accepted before the AI
// credit ran out, so its turn may pass the cap. The mark lives in memory only and never comes from LINE.
describe('LineMessageBufferService – an orphan replay may pass the AI credit cap', () => {
  it('marks a replayed text and photo in memory only; a LINE webhook never', async () => {
    const h = makeHarness({ debounceMs: 0 });
    h.rows.set('replayed-text', {
      webhookEventId: 'replayed-text', status: 'received', errorCode: 'RETRYABLE_ORPHAN_REPLAY',
      createdAt: new Date(Date.now() - 5 * 60_000), processedAt: null, payloadJson: null,
    });

    await h.service.enqueue(textEnv('fresh-text', 'ยอดขายวันนี้'));
    await h.service.enqueue(textEnv('replayed-text', 'ค่าใช้จ่ายเดือนนี้', { userId: 'user-2' }), true);
    await h.service.enqueue(mediaEnv('replayed-photo', { userId: 'user-3' }), true);
    await settle();
    await sleep(20);

    const executed = (id: string) => h.executed.find((event) => event.webhookEventId === id);
    assert.equal(executed('fresh-text')?.admitOverCap, undefined);
    assert.equal(executed('replayed-text')?.admitOverCap, true);
    assert.equal(h.receipts.find(({ event }) => event.webhookEventId === 'replayed-photo')?.event.admitOverCap, true);
    for (const id of ['fresh-text', 'replayed-text', 'replayed-photo']) {
      assert.equal((h.rows.get(id)?.payloadJson as any)?.item?.admitOverCap, undefined, `${id}: never stored, so never trusted from a payload`);
    }
  });
});

it('Round 2 A: preserves a signed expense-action postback through accepted payload and fast dispatch', async () => {
  const h = makeHarness({ debounceMs: 0 });
  const envelope = textEnv('expense-action-confirm', 'ตรวจผลรายการค่าใช้จ่าย');
  const control = { action: 'expense_action_confirm' as const, token: '550e8400-e29b-41d4-a716-446655440000.' + 'a'.repeat(43) };
  if (envelope.item.kind !== 'text') assert.fail('text fixture');
  envelope.item.expenseActionControl = control;
  await h.service.enqueue(envelope);
  assert.deepEqual((h.rows.get('expense-action-confirm')?.payloadJson as any)?.item?.expenseActionControl, control);
  await sleep(20);
  assert.deepEqual(h.executed[0]?.expenseActionControl, control);
});

it('Round 4 preserves a signed package control through durable buffering and dispatch', async () => {
  const h = makeHarness({ debounceMs: 0 }), envelope = textEnv('package-confirm', 'ตรวจลิงก์จ่ายแพ็กเกจ');
  const control = { action: 'package_purchase_confirm' as const, token: '550e8400-e29b-41d4-a716-446655440000.' + 'a'.repeat(43) };
  if (envelope.item.kind !== 'text') assert.fail('text fixture');
  envelope.item.packagePurchaseControl = control;
  await h.service.enqueue(envelope);
  assert.deepEqual((h.rows.get('package-confirm')?.payloadJson as any)?.item?.packagePurchaseControl, control);
  await sleep(20);
  assert.deepEqual(h.executed[0]?.packagePurchaseControl, control);
});

it('preserves English presentation language on a Thai synthetic confirmation through durable buffering and dispatch', async () => {
  const { lineControlData, lineControlLanguage } = await import('../domain/logic/line-language.logic');
  const { parseExpenseActionControl } = await import('./line-expense-action.service');
  const token = '550e8400-e29b-41d4-a716-446655440000.' + 'a'.repeat(43);
  const raw = lineControlData(new URLSearchParams({ action: 'expense_action_confirm', token }).toString(), 'en');
  const control = lineControlLanguage(raw);
  assert.equal(control.language, 'en');
  assert.ok(parseExpenseActionControl(control.data));
  assert.equal(lineControlLanguage(raw + '&language=th').language, undefined, 'ambiguous metadata must not reach a domain parser');
  const h = makeHarness({ debounceMs: 0 });
  const envelope = textEnv('english-confirmation', 'ตรวจผลรายการค่าใช้จ่าย');
  Object.assign(envelope.item, { language: control.language, expenseActionControl: parseExpenseActionControl(control.data) });
  await h.service.enqueue(envelope);
  assert.equal((h.rows.get('english-confirmation')?.payloadJson as any)?.item?.language, 'en');
  await sleep(20);
  assert.equal(h.executed[0]?.language, 'en');
  assert.equal(h.executed[0]?.messageText, 'ตรวจผลรายการค่าใช้จ่าย');
});

it('R23 fresh frozen replay and company switch retain control order', async () => {
  for (const { free, mode } of [
    { free: false, mode: 'off' }, { free: false, mode: 'on' },
    { free: true, mode: 'off' }, { free: true, mode: 'on' },
  ]) {
    for (const control of [
      { workflowControl: { action: 'wf_open', act: 'RECORD_PAYMENT', id: 'expense', sig: 'a'.repeat(43) } },
      { workflowControl: { action: 'wf_choice', token: 'choice', pick: 'other' } },
      { workflowStart: 'reimbursement_claim' },
      { fixedReadControl: { id: 'expense_month' } },
    ]) {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let company = 'A';
      const seen: Array<{ text: string; company: string; control: unknown }> = [];
      const h = makeHarness({ debounceMs: 0, preflightImpl: async () => ({ status: 'continue', companyId: free ? 'free' : 'paid' }),
        executeImpl: async event => {
          if (event.webhookEventId === 'running') await gate;
          if (event.messageText === '/company B') company = 'B';
          seen.push({ text: event.messageText, company, control: event[Object.keys(control)[0]!] });
        } });
      const subject = h.service as any;
      Object.assign(subject.config, { lineAiReliabilityV2Mode: mode, lineAiDeliveryPlanV2Enabled: true,
        lineAiReliabilityV2CompanyIds: [], lineAiDeliveryPlanV2WriteCompanyIds: [] });
      subject.prisma.client.$transaction = async (work: any) => work(subject.prisma.client);
      try {
        await h.service.enqueue(textEnv('running', 'รายการก่อนหน้า'));
        await settle();
        await h.service.enqueue(textEnv('switch', '/company B'));
        const envelope = textEnv('workflow', 'เลือกงาน');
        Object.assign(envelope.item, control);
        await h.service.enqueue(envelope);
        await settle();
        assert.equal(seen.length, 0, 'a control must wait for the running turn and company switch');
        const accepted = (h.rows.get('workflow')!.payloadJson as any);
        assert.deepEqual(accepted.item[Object.keys(control)[0]!], Object.values(control)[0]);
        release();
        await sleep(25);
        assert.deepEqual(seen.map(item => item.company), ['A', 'B', 'B']);
        assert.deepEqual(seen[2]!.control, Object.values(control)[0]);
        const frozen = h.rows.get('workflow')!.payloadJson as any;
        assert.equal(Boolean(frozen.item.inputEvidence), mode === 'on');
        assert.deepEqual(frozen.item[Object.keys(control)[0]!], Object.values(control)[0]);
        const replay = makeHarness({ debounceMs: 0 });
        replay.rows.set('workflow', { webhookEventId: 'workflow', status: 'received', errorCode: 'RETRYABLE_ORPHAN_REPLAY', createdAt: new Date(), payloadJson: frozen });
        const { parseBufferEnvelope } = await import('./use-cases/recover-orphan-line-events.use-case');
        const recovered = parseBufferEnvelope(JSON.parse(JSON.stringify(frozen)));
        assert.ok(recovered);
        await replay.service.enqueue(recovered, true);
        await sleep(25);
        assert.deepEqual(replay.executed[0]?.[Object.keys(control)[0]!], Object.values(control)[0]);
      } finally { release(); }
    }
  }
});

it('R17 buffer rate-limit and dispatch notices use validated locked cards', async () => {
  const { readLineSystemCard } = await import('../domain/logic/line-system-card.fixture');
  const { lineFlexBodyProblems } = await import('../domain/logic/line-system-card-limits.logic');
  for (const text of ['คำขอก่อนหน้ายังทำอยู่ รอสักครู่ค่ะ', 'ยังทำรายการนี้ไม่สำเร็จ ลองอีกครั้งค่ะ']) {
    const h = makeHarness();
    await (h.service as any).deliverNotice('reply-token', text);
    const card = h.replyMessages[0];
    assert.deepEqual(readLineSystemCard(card).header, ['น้องมั่งมี', 'แจ้งให้ทราบ']);
    assert.equal(card.canonicalText, text);
    assert.deepEqual(lineFlexBodyProblems(card.contents), []);
  }
});

it('R17 a rejected buffer notice retains the text fallback on reply and token-expired push', async () => {
  for (const tokenExpired of [false, true]) {
    const h = makeHarness();
    const service = h.service as any;
    const calls: any[] = [];
    service.lineReply.sendReply = async (_token: string, messages: any[]) => { calls.push(messages); return tokenExpired ? 'failed_token' : calls.length === 1 ? 'failed_flex' : 'ok'; };
    service.lineReply.sendPush = async (_target: string, messages: any[], operation: string) => { calls.push(messages); return operation.endsWith(':text-fallback') ? 'ok' : 'failed_flex'; };
    const text = 'ยังทำรายการนี้ไม่สำเร็จ ลองอีกครั้งค่ะ';
    assert.equal(await service.deliverNotice('reply-token', text, { target: 'user', operationId: 'notice' }), 'ok');
    assert.deepEqual(calls.at(-1), [{ type: 'text', text }]);
    assert.equal(calls.length, tokenExpired ? 3 : 2);
  }
});
