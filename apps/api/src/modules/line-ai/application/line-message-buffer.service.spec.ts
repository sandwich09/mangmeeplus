import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '../../../generated/prisma/client';
import { LineMessageBufferService } from './line-message-buffer.service';
import type { LineBufferEnvelope } from './line-message-buffer.service';
import { LINE_BUFFER_ORPHAN_REPROCESS_MS, debounceCohortMs } from '../domain/logic/line-message-buffer.logic';

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
  receiptImpl?: (event: any, caption?: string) => Promise<{ outcome: 'done' | 'defer_text' }>;
  receiptOutcomes?: Array<'done' | 'defer_text'>;
  replyResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
  pushResult?: 'ok' | 'failed_token' | 'failed_other' | 'skipped';
  eventStoreUnavailable?: boolean;
  legalAcceptanceRequired?: boolean;
  preflightImpl?: (event: { lineUserId: string; messagingChannelId?: string; companyIdAtAcceptance?: string }) => Promise<{ status: 'continue'; companyId?: string } | { status: 'required'; companyId: string }>;
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
  const preflightCalls: Array<{ lineUserId: string; messagingChannelId?: string; companyIdAtAcceptance?: string }> = [];
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
    sendReply: async (token: string, messages: Array<{ text: string }>) => {
      replyTokens.push(token);
      replies.push(messages[0]?.text ?? '');
      return opts.replyResult ?? 'ok';
    },
    sendPush: async (to: string, messages: Array<{ text: string }>) => {
      pushes.push({ to, text: messages[0]?.text ?? '' });
      return opts.pushResult ?? 'ok';
    },
    startLoadingAnimation: async (chatId: string) => {
      loadingCalls.push(chatId);
      if (opts.loadingGate) await opts.loadingGate;
      return opts.loadingAccepted ?? true;
    },
  } as any;

  const useCase = {
    preflightLegalAcceptance: async (event: { lineUserId: string; messagingChannelId?: string; companyIdAtAcceptance?: string }) => {
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
    assert.match(h.pushes[0]?.text ?? '', /ได้รับรูปแล้ว.*คุยกับน้องต่อได้เลย/);

    await h.service.enqueue(textEnv('while-ocr', 'ติดต่อเรา'));
    await sleep(20);
    assert.equal(h.executed.length, 1, 'later command must not wait for OCR');
    assert.equal(h.executed[0]?.messageText, 'ติดต่อเรา');

    releaseReceipt();
    await sleep(20);
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
    assert.equal(h.executed.length, 0, 'caption context keeps strict ordering');

    releaseReceipt();
    await sleep(40);
    assert.equal(h.executed[0]?.messageText, 'ติดต่อเรา');
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

  it('pushes one contextual status after 2 seconds and restores loading before the answer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
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

  it('keeps the legacy 2s-from-processing-start wait status when loading-on-accept is off (no immediate status at a 2.5s debounce)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      let releaseTurn!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      const order: string[] = [];
      const h = makeHarness({
        debounceMs: 2_500, maxWaitMs: 60_000,
        loadingEnabled: true, loadingOnAcceptEnabled: false, // legacy default
        executeImpl: async (event) => { markStarted(); order.push('turn'); await gate; await event.beforeReply?.(); order.push('reply'); },
      });

      await h.service.enqueue(textEnv('legacy-wait', 'ช่วยเปรียบเทียบยอดขายสองสาขา'));
      t.mock.timers.tick(2_501);   // flush the 2.5s debounce → processing starts ~2.5s after acceptance
      await settle();
      await started;
      // Processing started well past 2s of durable acceptance, yet the status must NOT be immediate.
      assert.equal(h.pushes.length, 0, 'no immediate wait status at processing start');
      t.mock.timers.tick(1_999);   // legacy delay is 2s FROM PROCESSING START, not from acceptance
      await settle();
      assert.equal(h.pushes.length, 0, 'no status before the legacy 2s from processing start');
      t.mock.timers.tick(1);
      await settle();
      assert.equal(h.pushes.length, 1, 'status after exactly the legacy 2s from processing start');
      // Ordering: the status is delivered before the final answer.
      releaseTurn();
      await settle();
      assert.deepEqual(order, ['turn', 'reply']);
      assert.equal(h.pushes.length, 1, 'exactly one status, ordered before the final');
    } finally {
      t.mock.timers.reset();
    }
  });

  it('re-times the wait status from durable acceptance ONLY when the accept spinner was actually shown (P2-B)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      let releaseTurn!: () => void; let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      // Accept-loading ON and ACCEPTED by LINE: the spinner has been up since durable acceptance (t=0), so
      // when processing starts ~2.5s later the 2s window has already elapsed → the status is due at once.
      const h = makeHarness({
        debounceMs: 2_500, maxWaitMs: 60_000,
        loadingEnabled: true, loadingOnAcceptEnabled: true, loadingAccepted: true,
        executeImpl: async (event) => { markStarted(); await gate; await event.beforeReply?.(); },
      });
      await h.service.enqueue(textEnv('accept-retime', 'ช่วยเปรียบเทียบยอดขายสองสาขา'));
      t.mock.timers.tick(2_501);   // flush the 2.5s debounce → processing starts
      await settle();
      await started;
      t.mock.timers.tick(1);       // the re-timed status delay is 0 (already elapsed) → fires immediately
      await settle();
      assert.equal(h.pushes.length, 1, 'accepted accept-loading re-times the status from acceptance (immediate here)');
      releaseTurn();
      await settle();
    } finally {
      t.mock.timers.reset();
    }
  });

  it('a REJECTED accept-loading falls back to the legacy 2s-from-processing-start (never immediate) (P2-B)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    try {
      t.mock.timers.setTime(0);
      let releaseTurn!: () => void; let markStarted!: () => void;
      const gate = new Promise<void>((resolve) => { releaseTurn = resolve; });
      const started = new Promise<void>((resolve) => { markStarted = resolve; });
      // Accept-loading ON but LINE REJECTED it (loadingAccepted:false): no spinner was shown, so the status
      // must NOT collapse to immediate at a 2.5s debounce — it uses the legacy 2s FROM PROCESSING START.
      const h = makeHarness({
        debounceMs: 2_500, maxWaitMs: 60_000,
        loadingEnabled: true, loadingOnAcceptEnabled: true, loadingAccepted: false,
        executeImpl: async (event) => { markStarted(); await gate; await event.beforeReply?.(); },
      });
      await h.service.enqueue(textEnv('accept-reject', 'ช่วยเปรียบเทียบยอดขายสองสาขา'));
      t.mock.timers.tick(2_501);   // flush the 2.5s debounce → processing starts
      await settle();
      await started;
      assert.equal(h.pushes.length, 0, 'no immediate status even though acceptance was >2s ago (spinner was rejected)');
      t.mock.timers.tick(1_999);
      await settle();
      assert.equal(h.pushes.length, 0, 'still nothing before the legacy 2s from processing start');
      t.mock.timers.tick(1);
      await settle();
      assert.equal(h.pushes.length, 1, 'status after exactly the legacy 2s from processing start');
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
    const co1 = debounceCohortMs({ enabled: true, secret: 'experiment-secret', assignmentKey: 'co-1:chat-frz', configuredMs: 2_500 });
    const co2 = debounceCohortMs({ enabled: true, secret: 'experiment-secret', assignmentKey: 'co-2:chat-frz', configuredMs: 2_500 });
    assert.notEqual(co1, co2, 'test precondition: co-1 and co-2 resolve to different cohorts for this chat');

    let call = 0;
    const h = makeHarness({
      debounceMs: 2_500, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue' as const, companyId: call++ === 0 ? 'co-1' : 'co-2' }),
    });
    try {
      await h.service.enqueue(textEnv('frz-1', 'ก', { chatId: 'chat-frz', userId: 'user-1' })); // opens batch → freezes co-1 cohort
      await h.service.enqueue(textEnv('frz-2', 'ข', { chatId: 'chat-frz', userId: 'user-1' })); // joins; preflight now resolves co-2
      const state = (h.service as any).chats.get('chat-frz:user-1');
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
      debounceMs: 2_500, maxWaitMs: 60_000,
      debounceExperimentEnabled: true, debounceExperimentSecret: 'experiment-secret',
      preflightImpl: async () => ({ status: 'continue', companyId: 'co-1' }),
    });
    try {
      await h.service.enqueue(textEnv('g-a', 'ก', { chatId: 'group-9', userId: 'user-A' }));
      await h.service.enqueue(textEnv('g-b', 'ข', { chatId: 'group-9', userId: 'user-B' }));
      const stateA = (h.service as any).chats.get('group-9:user-A');
      const stateB = (h.service as any).chats.get('group-9:user-B');
      assert.ok(stateA && stateB && stateA !== stateB, 'buffers are isolated per (chat,user)');
      assert.equal(stateA.debounceMs, stateB.debounceMs, 'cohort shared across users of the same (company,chat)');
      assert.ok([1_000, 1_500, 2_500].includes(stateA.debounceMs), 'cohort is one of the declared values');
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
      const state = (h.service as any).chats.get('user-1:user-1');
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
