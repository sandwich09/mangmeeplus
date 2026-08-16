import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProcessLineWebhookUseCase, putLineMediaUpload, classifyPendingMediaReply, splitPendingMediaReply } from './process-line-webhook.use-case';
import { isDeliveredCapabilityFollowUp } from '../../domain/logic/line-ai-capability-follow-up.logic';
import type { BusinessDocumentClassification, LineIntakeRoutePlan } from '@watchdog-bms/contracts';
import { LineTextExpenseCaptureIncompleteError } from '../../../expenses/application/use-cases/expense-document.use-case';

// Router-driven webhook dispatch tests (item 10B LINE Intake Router front stage).

/** Shadow probe double (piece 5) — the dispatch tests assert routing, not shadow evidence. */
const shadowProbe = {
  startSweep: () => ({
    record: async () => ({ wouldBlock: false, reason: 'available' as const }),
    flush: async () => ({}),
  }),
} as any;
const acceptedLegal = { isRequired: async () => false } as any;

function replyAssertionText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;

  const strings: string[] = [];
  const collectStrings = (value: unknown): void => {
    if (typeof value === 'string') {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collectStrings);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(collectStrings);
    }
  };
  collectStrings(message);
  return strings.join('\n');
}

function makePrisma() {
  const updates: any[] = [];
  const recordUpdates: any[] = [];
  const turnCreates: any[] = [];
  const pendingMediaRows: any[] = [];
  const prisma = {
    client: {
      // Consumption markers commit with the terminal outcome; the fake runs the callback inline.
      $transaction: async (work: (tx: any) => Promise<unknown>) => work({
        outboxEvent: { create: async () => undefined, findMany: async () => [], findFirst: async () => null },
      }),
      lineWebhookEventLog: {
        findUnique: async () => null,
        create: async (args: unknown) => args,
        updateMany: async (args: any) => { updates.push(args); return { count: 1 }; },
      },
      externalIdentity: {
        findFirst: async () => ({ userId: 'user-1', user: { status: 'ACTIVE' } }),
      },
      companyMembership: {
        findMany: async () => [{ companyId: 'company-1', company: { name: 'c1', brandName: null }, roles: [{ role: { key: 'OWNER' } }] }],
      },
      lineCompanyContext: { findUnique: async () => null, upsert: async (args: unknown) => args },
      companyFeatureEntitlement: { findMany: async () => [] },
      expenseRecord: { update: async (args: any) => { recordUpdates.push(args); return args; } },
      attachmentLink: { findFirst: async () => null },
      aiConversation: { upsert: async (args: any) => ({ id: args.where.id }) },
      aiTurn: { create: async (args: any) => { turnCreates.push(args); return { id: 'turn-1' }; }, findMany: async () => [], update: async (args: any) => args },
      aiToolInvocation: { createMany: async (args: unknown) => args },
      // RECEIPT-05: stateful pending-media store so redelivery / follow-up tests observe the real row lifecycle.
      lineIntakePendingMedia: {
        findFirst: async (args: any) => {
          const w = args.where;
          return pendingMediaRows.find((r) =>
            r.companyId === w.companyId && r.userId === w.userId && r.status === w.status &&
            (!w.expiresAt || r.expiresAt > w.expiresAt.gt)) ?? null;
        },
        findUnique: async (args: any) => {
          const { companyId, lineMessageId } = args.where.companyId_lineMessageId;
          return pendingMediaRows.find((r) => r.companyId === companyId && r.lineMessageId === lineMessageId) ?? null;
        },
        create: async (args: any) => { const row = { id: `pm-${pendingMediaRows.length + 1}`, ...args.data }; pendingMediaRows.push(row); return row; },
        update: async (args: any) => { const row = pendingMediaRows.find((r) => r.id === args.where.id); if (row) Object.assign(row, args.data); return row; },
        updateMany: async (args: any) => {
          const rows = pendingMediaRows.filter((r) => r.id === args.where.id && (!args.where.status || r.status === args.where.status));
          rows.forEach((row) => Object.assign(row, args.data));
          return { count: rows.length };
        },
      },
    },
  } as any;
  return { prisma, updates, recordUpdates, turnCreates, pendingMediaRows };
}

type Harness = {
  useCase: ProcessLineWebhookUseCase;
  candidateQueries: any[];
  correctionCalls: any[];
  replies: string[];
  captured: any[];
  signatureCreated: any[];
  routeRequests: any[];
  ocrRequests: any[];
  uploads: any[];
  initCalls: any[];
  completeCalls: any[];
  createUploadIntentCalls: any[];
  completeAttachmentCalls: any[];
  createExpenseCalls: any[];
  linkAttachmentCalls: any[];
  updateExpenseCalls: any[];
  substituteCalls: any[];
  receiptContinuationCalls: any[];
};

function makeHarness(opts: {
  permissions: string[];
  scopes?: { branchIds?: string[] };
  routePlan?: LineIntakeRoutePlan;
  correctionOutcome?: any;
  openWaiting?: any[];
  recentCaptures?: Array<{ id: string; expenseDate: Date | null; grandTotalAmount: string | null; sourceDocumentType: string | null; createdAt: Date }>;
  routeThrows?: boolean;
  uploadThrows?: boolean;
  mediaDownloadFails?: boolean;
  receiptOcrResult?: any;
  findExpenseByLineMessageId?: (companyId: string, lineMessageId: string) => Promise<any>;
  prisma?: any;
  /** Collects appendSubRequests calls so a test can assert what the next turn will carry. */
  captureLedger?: any[];
  captureError?: Error;
  substituteResult?: any;
  expenseDetail?: any;
  lineReplyResult?: 'ok' | 'failed_token' | 'failed_other';
  conversationTurns?: any[];
}): Harness {
  const replies: string[] = [];
  const captured: any[] = [];
  const signatureCreated: any[] = [];
  const routeRequests: any[] = [];
  const ocrRequests: any[] = [];
  const uploads: any[] = [];
  const initCalls: any[] = [];
  const completeCalls: any[] = [];
  const createUploadIntentCalls: any[] = [];
  const completeAttachmentCalls: any[] = [];
  const createExpenseCalls: any[] = [];
  const candidateQueries: any[] = [];
  const correctionCalls: any[] = [];
  const linkAttachmentCalls: any[] = [];
  const updateExpenseCalls: any[] = [];
  const substituteCalls: any[] = [];
  const receiptContinuationCalls: any[] = [];
  const prisma = opts.prisma ?? makePrisma().prisma;
  if (opts.conversationTurns) prisma.client.aiTurn.findMany = async () => opts.conversationTurns;

  const useCase = new ProcessLineWebhookUseCase(
    prisma,
    { webBaseUrl: 'https://app.example.com', lineMessagingChannelAccessToken: 'line-token' } as any,
    { resolveAccess: async () => ({ membershipId: 'mem-1', roles: ['STAFF'], permissions: opts.permissions, scopes: opts.scopes ?? {} }) } as any,
    { log: async () => undefined } as any,
    {
      requestLineTurn: async () => ({
        requestId: 'r', replyText: 'turn-answer', sourceRefs: [], sourceLabels: [], webLinks: [],
        intent: 'read_summary', agent: 'general', refused: false, toolsInvoked: [], durationMs: 1,
      }),
      requestReceiptOcr: async (req: any) => {
        ocrRequests.push(req);
        return opts.receiptOcrResult ?? validReceiptOcr();
      },
      requestLineIntakeRoute: async (req: any) => {
        routeRequests.push(req);
        if (opts.routeThrows) throw new Error('gateway down');
        return opts.routePlan ?? { status: 'UNAVAILABLE', intent: 'UNSUPPORTED', language: 'th', confidence: 0, errorCode: 'PROVIDER_DISABLED' };
      },
    } as any,
    {
      buildTextMessage: (text: string) => ({ type: 'text', text }),
      sendReply: async (_token: string, messages: unknown[]) => {
        replies.push(replyAssertionText(messages[0]));
        return opts.lineReplyResult ?? 'ok';
      },
      sendPush: async () => opts.lineReplyResult ?? 'ok',
    } as any,
    { apply: async () => ({ candidatesCreated: 0 }) } as any,
    { assertClean: async () => undefined } as any,
    acceptedLegal,
    shadowProbe,
    // initReceiptUpload / completeReceiptUpload
    { execute: async (_ctx: any, cmd: any) => { initCalls.push(cmd); return { expenseId: 'expense-1', attachmentId: 'att-1', uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() }; } } as any,
    { execute: async (_ctx: any, cmd: any) => { completeCalls.push(cmd); return { id: 'expense-1' }; } } as any,
    // captureExpenseNote
    {
      execute: async (_ctx: any, cmd: any) => {
        if (opts.captureError) throw opts.captureError;
        captured.push(cmd);
        return {
          expense: { id: 'expense-note-1', sourceDocumentType: 'EXPENSE_NOTE_TEXT', grandTotalAmount: '65.0000', expenseCategoryId: 'cat-meals' },
          warnings: [],
          insertedAmount: '65.0000',
          categoryId: 'cat-meals',
          categoryName: 'ค่าอาหาร',
        };
      },
    } as any,
    // initSignatureUpload
    { execute: async () => ({ attachmentId: 'sig-att-1', uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() }) } as any,
    // createSignatureAsset
    {
      execute: async (_ctx: any, cmd: any) => {
        signatureCreated.push(cmd);
        return { id: 'sig-1', status: 'PENDING_OWNER_APPROVAL', submittedFromChannel: 'LINE' };
      },
    } as any,
    // expenseRepo (categories catalog for the router + RECEIPT-05 draft-from-attachment)
    {
      listCategories: async () => [{ id: 'cat-meals', name: 'ค่าอาหาร' }],
      listRecentLineCaptures: async (input: any) => { candidateQueries.push(input); return opts.recentCaptures ?? []; },
      recordDeliveredLineReceiptContinuation: async (input: any) => { receiptContinuationCalls.push(input); },
      findByLineMessageId: opts.findExpenseByLineMessageId ?? (async () => null),
      runDuplicateCheck: async (_input: any, detectWithinTx: (tx: any) => Promise<string[]>) => {
        const matched = await detectWithinTx({ marker: 'tx' });
        return { openCandidates: matched.length, duplicateStatus: matched.length > 0 ? 'POSSIBLE_DUPLICATE' : 'NO_MATCH' };
      },
      createExpense: async (input: any) => { createExpenseCalls.push(input); return { id: 'expense-clarified-1' }; },
      linkAttachment: async (...args: any[]) => { linkAttachmentCalls.push(args); },
      updateExpense: async (input: any) => { updateExpenseCalls.push(input); return { id: input.id }; },
      findByIdWithRelations: async (_companyId: string, expenseId: string) => opts.expenseDetail ?? ({
        id: expenseId,
        primaryAttachmentId: 'pending-att-1',
        attachments: [{
          id: 'pending-att-1',
          purpose: 'expense.receipt.primary',
          checksumSha256: 'hash',
          perceptualHash: '8f00aa55cc33f00f',
        }],
        vendorDocumentNumber: null,
        vendorTaxIdSnapshot: null,
        expenseDate: new Date('2026-07-29T00:00:00.000Z'),
        grandTotalAmount: '0',
        vendorCounterpartyId: null,
        createdByUserId: 'user-1',
      }),
      findNearDuplicates: async () => [],
      findExpenseIdsByAttachmentChecksum: async () => [],
      createDuplicateCandidate: async () => undefined,
    } as any,
    // ledger: only the open-clarification read matters for the correction evidence tests
    (opts.openWaiting || opts.captureLedger
      ? {
        enabled: true,
        openWaitingUser: async () => opts.openWaiting ?? [],
        ack: async () => undefined,
        appendTurn: async () => null,
        appendSubRequests: async (input: any) => { opts.captureLedger?.push(input); },
        coverageToSubRequests: () => [],
      }
      : undefined) as any,
    // createUploadIntent (RECEIPT-05 byte persist)
    { execute: async (_ctx: any, cmd: any) => { createUploadIntentCalls.push(cmd); return { attachmentId: 'pending-att-1', uploadUrl: '/u', uploadMethod: 'PUT', expiresAt: new Date() }; } } as any,
    // completeAttachmentUpload
    { execute: async (_ctx: any, cmd: any) => { completeAttachmentCalls.push(cmd); return { id: 'pending-att-1' }; } } as any,
    // correctExpense
    {
      execute: async (_ctx: any, cmd: any) => {
        correctionCalls.push(cmd);
        return opts.correctionOutcome ?? { status: 'guidance', reason: 'no_correctable_field' };
      },
    } as any,
    (opts.substituteResult ? { execute: async (_ctx: any, input: any) => { substituteCalls.push(input); return opts.substituteResult; } } : undefined) as any,
  );
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  (useCase as any).downloadLineMedia = async () => opts.mediaDownloadFails ? null : ({
    fileName: 'image.jpg', mimeType: 'image/jpeg', byteSize: jpegBytes.byteLength,
    checksumSha256: 'hash', contentBase64: jpegBytes.toString('base64'), bytes: jpegBytes,
  });
  (useCase as any).uploadLineMedia = async (intent: any, media: any) => {
    uploads.push({ intent, media });
    if (opts.uploadThrows) throw new Error('storage PUT failed');
  };
  return { useCase, replies, captured, signatureCreated, routeRequests, ocrRequests, uploads, initCalls, completeCalls, createUploadIntentCalls, completeAttachmentCalls, createExpenseCalls, linkAttachmentCalls, updateExpenseCalls, candidateQueries, correctionCalls, substituteCalls, receiptContinuationCalls };
}

const TEXT_EVENT = {
  webhookEventId: 'evt-text-1',
  lineUserId: 'line-user-secret',
  replyToken: 'reply-1',
  messageText: 'ค่ากาแฟ 65 บาท',
  messagingChannelId: 'ch-1',
  lineMessageId: 'msg-text-1',
};

const MEDIA_EVENT = {
  webhookEventId: 'evt-media-1',
  lineUserId: 'line-user-secret',
  replyToken: 'reply-2',
  lineMessageId: 'msg-media-1',
  messageType: 'image' as const,
  messagingChannelId: 'ch-1',
};

function businessClassification(overrides: Partial<BusinessDocumentClassification> = {}): BusinessDocumentClassification {
  return {
    contentKind: 'DOCUMENT',
    documentFamily: 'EXPENSE_EVIDENCE',
    documentKind: 'RECEIPT',
    businessDirection: 'PURCHASE_EXPENSE',
    transactionState: 'PAID',
    evidenceRoles: ['EXPENSE_SUPPORT'],
    confidence: 0.98,
    evidenceSignals: ['receipt', 'total 120.00'],
    amountSignals: ['120.00'],
    settlementSignals: ['paid'],
    missingRequiredSignals: [],
    contradictionSignals: [],
    requiresClarification: false,
    ...overrides,
  };
}

function validReceiptOcr(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    classification: businessClassification(),
    fields: { vendorName: 'ร้านทดสอบ', documentNumber: 'R-1', grandTotalAmount: '120.00', confidence: 0.98 },
    ...overrides,
  };
}

describe('LINE intake dispatch – capture correction (phase 1 guidance)', () => {
  const CORRECTION_PLAN = { status: 'ROUTED' as const, intent: 'EXPENSE_CAPTURE_CORRECTION' as const, language: 'th', confidence: 0.93 };
  const capturedRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, expenseDate: new Date('2026-06-17T00:00:00.000Z'), grandTotalAmount: '59.00',
    sourceDocumentType: 'HANDWRITTEN_CASH_BILL', createdAt: new Date('2026-08-03T13:01:00.000Z'), ...overrides,
  });

  it('points at the single recent capture and creates nothing', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'วันที่ออกสารผิดนะ ต้องเป็นวันที่ 20 กรกฎาคม 2569' });

    assert.equal(h.captured.length, 0, 'a correction must never create a draft');
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /expense-1/);
    assert.match(h.replies[0] ?? '', /ไม่สร้างรายการใหม่/);
  });

  it('offers the list when nothing recent is correctable', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้ยอดเป็น 590' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่พบรายการ/);
    assert.equal(/expenses\/[a-z0-9-]/.test(h.replies[0] ?? ''), false, 'must not point at a specific record');
  });

  it('names the candidates instead of silently picking the newest when several match', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1'), capturedRow('expense-2', { grandTotalAmount: '120.00' })],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่หน่อย' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /พบหลายรายการ/);
    assert.equal(/expenses\/expense-1/.test(h.replies[0] ?? ''), false, 'no silent newest-target link');
  });

  it('never promises an edit to a capture-only role', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'], // ACCOUNTANT/MARKETING shape
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดผิด' });

    assert.match(h.replies[0] ?? '', /ส่งต่อผู้มีสิทธิ์แก้ไข/);
    assert.equal(/เปิดแก้ไขในเว็บแอป/.test(h.replies[0] ?? ''), false);
  });

  it('scopes candidates to this user, this chat, and a bounded window', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่' });

    const query = h.candidateQueries.at(-1);
    assert.equal(query.createdByUserId, 'user-1');
    assert.equal(query.take, 5);
    assert.ok(query.chatKeyHash && !query.chatKeyHash.includes('line-user-secret'), 'chat scope is hashed, never raw');
    assert.ok(query.since instanceof Date);
  });

  it('sends only structured candidate labels to the router', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้วันที่' });

    const [candidate] = h.routeRequests[0].recentCapturedExpenses ?? [];
    assert.equal(candidate?.id, 'expense-1');
    assert.match(candidate?.label ?? '', /บิลเงินสดเขียนมือ/);
    assert.equal(Object.keys(candidate ?? {}).includes('vendorName'), false, 'no free text in candidate payloads');
  });


  it('applies the correction to the existing record and confirms old to new', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { expenseDate: { to: '2026-07-20' } } },
      recentCaptures: [capturedRow('expense-1')],
      correctionOutcome: { status: 'applied', expenseId: 'expense-1', fields: { expenseDate: { from: '2026-06-17T00:00:00.000Z', to: '2026-07-20' } } },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'วันที่ต้องเป็น 20 กรกฎาคม 2569' });

    assert.equal(h.captured.length, 0, 'still never a create');
    assert.equal(h.correctionCalls.length, 1);
    assert.equal(h.correctionCalls[0].candidates[0].id, 'expense-1');
    assert.match(h.replies[0] ?? '', /แก้ไขรายการเดิมให้แล้ว/);
    assert.match(h.replies[0] ?? '', /วันที่เอกสาร/);
    assert.match(h.replies[0] ?? '', /expense-1/);
  });

  it('falls back to guidance when a guard refuses, never to a create', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { amount: { to: '9999' } } },
      recentCaptures: [capturedRow('expense-1')],
      correctionOutcome: { status: 'guidance', reason: 'ungrounded_value:amount' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้ยอด' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่สร้างรายการใหม่/);
  });

  it('asks one question when the message names both the old and the new value', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, correctionHints: { amount: { to: '590' } } },
      recentCaptures: [capturedRow('expense-1')],
      correctionOutcome: { status: 'clarify', field: 'amount' },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอด 59 ไม่ใช่ 590' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ค่าเดิมและค่าใหม่/);
  });

  it('hands the apply the evidence of the clarification it answered, dated when it was asked', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.update', 'line.ai.query'],
      routePlan: { ...CORRECTION_PLAN, resolvedClarificationIds: ['7-0'] },
      recentCaptures: [capturedRow('expense-1')],
      openWaiting: [{
        id: '7-0', question: 'รายการไหน', text: 'แก้ยอดเป็น 590', askedAt: '2026-08-03T13:03:00.000Z',
        entry: { id: '7-0', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 't0', kind: 'sub_request', userId: 'user-1' },
      }],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'รายการที่ 2' });

    const evidence = h.correctionCalls[0]?.evidence ?? [];
    assert.equal(evidence.length, 2, 'current turn plus the answered clarification');
    assert.equal(evidence[1].text, 'แก้ยอดเป็น 590');
    assert.equal(evidence[1].todayIso, '2026-08-03');
  });

  it('refuses the correction route without capture permission', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: CORRECTION_PLAN,
      recentCaptures: [capturedRow('expense-1')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'แก้ยอด' });

    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์อัปโหลด/);
  });
});

describe('LINE intake dispatch – text path', () => {
  it('keeps an immediate vague follow-up attached to the delivered capability answer without another model call', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      conversationTurns: [{
        createdAt: new Date(), userMessagePreview: 'ทำอะไรได้บ้าง',
        replyPreview: 'น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์ของคุณได้ค่ะ',
        intent: 'UNKNOWN', agent: 'general', refused: false, toolInvocations: [],
      }],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อย่างไหร่' });

    assert.equal(h.routeRequests.length, 0);
    assert.match(h.replies[0] ?? '', /ยอดขายวันนี้เท่าไหร่/);
    assert.match(h.replies[0] ?? '', /ส่งรูปใบเสร็จ/);
    assert.match(h.replies[0] ?? '', /ขั้นสุดท้ายยังทำในเว็บ/);
  });

  it('does not treat the same vague text as capability follow-up without the delivered capability marker', () => {
    assert.equal(isDeliveredCapabilityFollowUp('อย่างไหร่', undefined), false);
    assert.equal(isDeliveredCapabilityFollowUp('อย่างไหร่', {
      windowMinutes: 15, maxTurns: 15,
      recentTurns: [{ at: new Date().toISOString(), assistantReplyPreview: 'สรุปยอดขายแล้ว', refused: false }],
    }), false);
  });

  it('answers a receipt follow-up from the current captured expense without invoking the model or inventing purpose/tax policy', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      scopes: { branchIds: ['branch-1'] },
      recentCaptures: [{
        id: 'expense-royal', expenseDate: new Date('2026-08-15T00:00:00.000Z'), grandTotalAmount: '2890.00',
        sourceDocumentType: 'RECEIPT', createdAt: new Date(),
      }],
      expenseDetail: {
        id: 'expense-royal', companyId: 'company-1', branchId: 'branch-1', createdByUserId: 'user-1',
        sourceDocumentType: 'RECEIPT', grandTotalAmount: '2890.00', currency: 'THB',
        expenseCategoryId: null, accountHintKey: null, taxEvidenceStatus: 'NEEDS_REVIEW',
        sourceChannelMetadataJson: {
          lineReceiptContinuation: {
            kind: 'CAPTURED_EXPENSE', expenseId: 'expense-royal', userId: 'user-1',
            chatKeyHash: '20cb92ee125850e6', deliveredOutcomeId: 'opaque-outcome',
          },
        },
        aiVerificationSummaryJson: {
          recognizedFields: {
            vendorName: 'Royal Pizza Bravo BKK', expenseDate: '2026-08-15', documentNumber: '04003692',
            grandTotalAmount: '2890.00', vatAmount: '189.07',
          },
          missingFields: ['category', 'businessPurpose'],
        },
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อ่านใบเสร็จนี้ให้หน่อยว่าเป็นประเภทไหน และจะนำมาเป็นค่าใช้จ่ายของบริษัทอย่างไร' });

    assert.equal(h.routeRequests.length, 0, 'grounded follow-up never reaches the model router');
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /Royal Pizza Bravo BKK/);
    assert.match(h.replies[0] ?? '', /2,890\.00 THB/);
    assert.match(h.replies[0] ?? '', /189\.07/);
    assert.match(h.replies[0] ?? '', /ไม่ยืนยันนโยบายบริษัทหรือสิทธิเครดิต VAT/);
    assert.doesNotMatch(h.replies[0] ?? '', /ประชุม|รับรองลูกค้า|เคลมได้/);
  });

  it('requires target selection instead of silently reading one of several recent receipts', async () => {
    const recent = (id: string) => ({
      id, expenseDate: new Date('2026-08-15T00:00:00.000Z'), grandTotalAmount: '100.00',
      sourceDocumentType: 'RECEIPT', createdAt: new Date(),
    });
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      recentCaptures: [recent('expense-1'), recent('expense-2')],
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ใบนี้เป็นเอกสารประเภทอะไร' });

    assert.equal(h.routeRequests.length, 0);
    assert.match(h.replies[0] ?? '', /มากกว่า 1 รายการ/);
    assert.match(h.replies[0] ?? '', /1\).*100\.00[\s\S]*2\).*100\.00/);
  });

  it('a concurrent duplicate event-log claim processes exactly one turn', async () => {
    const { prisma } = makePrisma();
    let claimed = false;
    prisma.client.lineWebhookEventLog.create = async () => {
      if (!claimed) {
        claimed = true;
        return {};
      }
      const error = new Error('unique constraint') as Error & { code: string };
      error.code = 'P2002';
      throw error;
    };
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65' },
      },
      prisma,
    });

    await Promise.all([h.useCase.execute(TEXT_EVENT), h.useCase.execute(TEXT_EVENT)]);

    assert.equal(h.captured.length, 1);
  });

  it('routes text spend note to expense capture with semantic hints and Paypers reply', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65', expenseCategoryId: 'cat-meals' },
      },
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 1);
    assert.equal(h.captured[0].lineMessageId, 'msg-text-1');
    assert.equal(h.captured[0].captureHints.amount, '65');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ค่าอาหาร/);
    assert.match(h.replies[0] ?? '', /expense-note-1/);
    // Router received the active category catalog and permissions, never the raw LINE user id.
    assert.equal(h.routeRequests[0].activeCategories[0].id, 'cat-meals');
    assert.ok(!JSON.stringify(h.routeRequests[0]).includes('line-user-secret'));
  });

  it('turns an incomplete advisory capture route into one clarification and zero drafts', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.99,
        captureHints: { amount: '590' },
      },
      captureError: new LineTextExpenseCaptureIncompleteError(),
      captureLedger,
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'รีบทำให้หน่อย' });
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ยอดเงิน.*วัตถุประสงค์|ยอดเงิน.*หมวดค่าใช้จ่าย/);
    assert.equal(captureLedger[0]?.items?.[0]?.clarifyForIntent, 'EXPENSE_DOCUMENT_CAPTURE');
  });

  it('handles a substitute-receipt request through typed preflight before any model or final mutation', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      recentCaptures: [{
        id: 'expense-1', expenseDate: new Date('2026-08-16T00:00:00.000Z'), grandTotalAmount: '200.00',
        sourceDocumentType: 'EXPENSE_NOTE_TEXT', createdAt: new Date(),
      }],
      substituteResult: {
        handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-1',
        replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nสิ่งที่ยังต้องทำทั้งหมด:\n• เหตุผล\n• หลักฐาน\nLINE ยังไม่ได้ออกเอกสาร',
        acceptedFields: [], blockers: [{ code: 'reason_code_required' }], pendingQuestion: 'เหตุผลคืออะไร?',
      },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ช่วยทำใบทดแทนใบเสร็จให้หน่อย' });
    assert.equal(h.routeRequests.length, 0, 'deterministic workflow boundary skips the model router');
    assert.equal(h.captured.length, 0);
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /สิ่งที่ยังต้องทำทั้งหมด/);
  });

  it('answers an arbitrary intervening question normally, then resumes the same substitute workflow', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      openWaiting: [{
        id: 'sub-clarify-1', question: 'เหตุผลคืออะไร?', text: 'ทำใบรับรองต่อ', askedAt: new Date().toISOString(),
        clarifyForIntent: 'SUBSTITUTE_RECEIPT_CONTINUATION',
        entry: { id: 'sub-clarify-1', key: 'lineai:ledger:company-1:line-user-secret', companyId: 'company-1', turnId: 'turn-1', kind: 'sub_request', userId: 'user-1' },
      }],
      captureLedger,
      substituteResult: {
        handled: true, status: 'BLOCKED', workflowId: 'wf-1', expenseId: 'expense-1',
        replyText: 'preflight not directly delivered', acceptedFields: [], blockers: [],
        pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?', sideQuestionAnswered: false,
        resumeCapsule: '↩️ งานใบรับรองแทนใบเสร็จรับเงินของรายการ EXP-001 ยังอยู่\nทำต่อ: เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
      },
    });

    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'ยอดขายเดือนนี้เท่าไหร่?' });

    assert.equal(h.substituteCalls.length, 1);
    assert.equal(h.routeRequests.length, 1, 'the side question still uses the normal read path');
    assert.equal(h.routeRequests[0].openClarifications, undefined, 'pending substitute fields are not exposed as instructions to the side-question router');
    assert.match(h.replies[0] ?? '', /turn-answer/);
    assert.match(h.replies[0] ?? '', /งานใบรับรองแทนใบเสร็จรับเงิน.*ยังอยู่/);
    assert.equal(captureLedger.length, 1, 'the current pending question is re-appended after the side answer is delivered');
  });

  it('denies text capture without upload permission even when router says capture', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9 },
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์อัปโหลด/);
  });

  it('text signature intent replies asking for the image without creating anything', async () => {
    const h = makeHarness({
      permissions: ['expense.signature.manage', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.9 },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'อยากฝากลายเซ็นไว้ใช้ในระบบ' });
    assert.equal(h.signatureCreated.length, 0);
    assert.match(h.replies[0] ?? '', /ส่ง "รูปลายเซ็น"/);
  });

  it('CLARIFY route replies with clarification and creates no records', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.4 },
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่แน่ใจ/);
  });

  it('remembers the capture turn for multi-turn follow-ups (EVIDENCE_CAPTURE memory row)', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.9,
        captureHints: { sourceDocumentType: 'EXPENSE_NOTE_TEXT', amount: '65' },
      },
      prisma,
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(turnCreates.length, 1);
    assert.equal(turnCreates[0].data.intent, 'EVIDENCE_CAPTURE');
    assert.equal(turnCreates[0].data.userMessagePreview, 'ค่ากาแฟ 65 บาท');
    assert.match(turnCreates[0].data.replyPreview, /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
  });

  it('CLARIFY prefers the router clarifying question and remembers the clarify turn', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.4, clarifyQuestion: 'ต้องการบันทึกเป็นค่าใช้จ่าย หรือสอบถามยอดครับ?' },
      prisma,
    });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.replies[0], 'ต้องการบันทึกเป็นค่าใช้จ่าย หรือสอบถามยอดครับ?');
    assert.equal(turnCreates[0].data.intent, 'CLARIFY');
  });

  it('BUSINESS_READ_QUESTION falls through to the normal AI turn path', async () => {
    const h = makeHarness({
      permissions: ['line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
    });
    await h.useCase.execute({ ...TEXT_EVENT, messageText: 'เดือนนี้ใช้เงินเท่าไหร่' });
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('router unavailable falls back to the legacy AI turn path (no keyword shortcut)', async () => {
    const h = makeHarness({ permissions: ['line.ai.query'], routeThrows: true });
    await h.useCase.execute(TEXT_EVENT);
    assert.equal(h.captured.length, 0);
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });
});

describe('LINE intake dispatch – media path', () => {
  it('PUTs the exact downloaded bytes to a storage upload intent', async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    await putLineMediaUpload(
      { uploadUrl: '/local-storage/upload/token', uploadMethod: 'PUT' },
      { mimeType: 'image/jpeg', bytes: Buffer.from('receipt') },
      'https://api.example.com',
      (async (url: string | URL | Request, init?: RequestInit) => {
        captured = { url: String(url), init };
        return { ok: true, status: 204 } as Response;
      }) as typeof fetch,
    );
    assert.equal(captured.url, 'https://api.example.com/local-storage/upload/token');
    assert.equal(captured.init?.method, 'PUT');
    assert.equal((captured.init?.headers as Record<string, string>)['Content-Type'], 'image/jpeg');
    assert.deepEqual(Buffer.from(captured.init?.body as Uint8Array), Buffer.from('receipt'));
  });

  it('signature-like image creates a pending signature ticket, not an expense draft', async () => {
    const h = makeHarness({
      permissions: ['expense.signature.manage', 'expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.92 },
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.signatureCreated.length, 1);
    assert.equal(h.signatureCreated[0].submittedFromChannel, 'LINE');
    assert.equal(h.signatureCreated[0].lineMessageId, 'msg-media-1');
    assert.match(h.replies[0] ?? '', /รอเจ้าของกิจการอนุมัติ/);
    assert.match(h.replies[0] ?? '', /tab=signatures/);
    assert.ok(!/บันทึกข้อมูลค่าใช้จ่าย/.test(h.replies[0] ?? ''));
  });

  it('signature route without signature permission is refused', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'SIGNATURE_UPLOAD_TICKET', language: 'th', confidence: 0.92 },
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.signatureCreated.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์ส่งลายเซ็น/);
  });

  it('receipt image routes to expense capture with document type + tax evidence from hints', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { sourceDocumentType: 'TRANSFER_SLIP', sourceDocumentLanguage: 'th', confidence: 0.9 },
      },
      receiptOcrResult: validReceiptOcr({
        classification: businessClassification({
          documentFamily: 'PAYMENT_EVIDENCE', documentKind: 'TRANSFER_SLIP',
          transactionState: 'PAID', evidenceRoles: ['PAYMENT_PROOF'], amountSignals: ['500.00'],
        }),
        fields: { grandTotalAmount: '500.00', confidence: 0.98 },
      }),
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.ocrRequests.length, 1, 'one OCR preflight before upload');
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(h.uploads.length, 1);
    const update = recordUpdates.at(-1);
    assert.equal(update.data.sourceDocumentType, 'TRANSFER_SLIP');
    assert.equal(update.data.taxEvidenceStatus, 'SUPPORTING_ONLY');
    assert.equal(update.data.taxEvidenceReasonCode, 'PAYMENT_EVIDENCE_ONLY');
    assert.match(h.replies[0] ?? '', /สลิปโอนเงิน/);
  });

  it('redelivery with the same LINE message id returns the existing expense without creating another draft', async () => {
    let lookupCount = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      findExpenseByLineMessageId: async (_companyId, lineMessageId) => {
        lookupCount += 1;
        return lookupCount === 1 ? null : { id: 'expense-1', lineMessageId, sourceDocumentType: 'RECEIPT' };
      },
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-redelivery' });

    assert.equal(h.initCalls.length, 1);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.match(h.replies[1] ?? '', /expense-1/);
  });

  it('OCR unavailable without a caption persists clarification and creates no expense', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      receiptOcrResult: { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' },
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.completeCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.equal(pendingMediaRows.length, 1);
    assert.match(h.replies[0] ?? '', /1\).*ใบเสร็จ[\s\S]*2\).*ภาพประกอบ/);
  });

  it('explicit expense caption still clarifies when OCR cannot prove document evidence', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      receiptOcrResult: { status: 'not_configured', errorCode: 'AI_GATEWAY_SECRET_MISSING' },
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'บันทึกเป็นค่าใช้จ่าย');

    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.completeCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.equal(pendingMediaRows.length, 1);
    assert.match(h.replies[0] ?? '', /1\).*ใบเสร็จ[\s\S]*2\).*ภาพประกอบ/);
  });

  it('leaves a transient media-download failure reclaimable instead of terminal', async () => {
    const { prisma, updates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      mediaDownloadFails: true,
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT);

    const release = updates.at(-1)?.data;
    assert.equal(release.status, undefined);
    assert.equal(release.processedAt, null);
    assert.equal(release.errorCode, 'RETRYABLE_LINE_MEDIA_DOWNLOAD_FAILED');
  });

  it('does not complete an attachment when the storage PUT fails', async () => {
    const { prisma, updates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      uploadThrows: true,
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.uploads.length, 1);
    assert.equal(h.completeCalls.length, 0);
    assert.match(h.replies[0] ?? '', /เกิดข้อผิดพลาดชั่วคราว/);
    assert.equal(updates.at(-1)?.data.status, undefined);
    assert.equal(updates.at(-1)?.data.processedAt, null);
    assert.equal(updates.at(-1)?.data.errorCode, 'RETRYABLE_RECEIPT_UPLOAD_ERROR');
  });

  it('ambiguous media routes to CLARIFY and creates no draft or ticket', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'CLARIFY', language: 'th', confidence: 0.5 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.signatureCreated.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.match(h.replies[0] ?? '', /ยังไม่แน่ใจ/);
  });

  for (const scenario of [
    {
      name: 'quantity-only order', expected: /ยังไม่พบยอดเงินรวม/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({
        documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'ORDERED', evidenceSignals: ['x2'], amountSignals: [], settlementSignals: [],
        missingRequiredSignals: ['QUANTITY_ONLY', 'MISSING_MONETARY_AMOUNT'],
      }),
      fields: { quantity: '2' },
    },
    {
      name: 'check bill with total but no settlement', expected: /ยังไม่ยืนยันการรับชำระ/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({
        documentKind: 'ORDER_OR_CHECK_BILL', transactionState: 'DUE', amountSignals: ['500.00'], settlementSignals: [],
        missingRequiredSignals: ['MISSING_PAYMENT_EVIDENCE'],
      }),
      fields: { grandTotalAmount: '500.00' },
    },
    {
      name: 'quotation', expected: /ใบเสนอราคา/,
      intent: 'BUSINESS_DOCUMENT_REFERENCE' as const,
      classification: businessClassification({ documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION', transactionState: 'PROPOSED', evidenceRoles: ['COMMERCIAL_PROPOSAL'] }),
      fields: { grandTotalAmount: '5000.00' },
    },
    ...(['APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION'] as const).map((documentKind) => ({
      name: documentKind.toLowerCase(), expected: /เอกสารนัดหมาย\/การจอง/,
      intent: 'BUSINESS_DOCUMENT_REFERENCE' as const,
      classification: businessClassification({ documentFamily: 'SCHEDULING_DOCUMENT', documentKind, transactionState: 'CONFIRMED', evidenceRoles: ['SCHEDULING_PROOF'] }),
      fields: { grandTotalAmount: '500.00' },
    })),
    {
      name: 'non-financial image', expected: /ไม่ใช่เอกสารค่าใช้จ่าย/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({ contentKind: 'NON_DOCUMENT_IMAGE', documentFamily: 'NON_BUSINESS', documentKind: 'NON_FINANCIAL_IMAGE', businessDirection: 'UNKNOWN', transactionState: 'UNKNOWN', evidenceRoles: [], evidenceSignals: [], amountSignals: [], settlementSignals: [] }),
      fields: {},
    },
    {
      name: 'unreadable image', expected: /ยังอ่านเอกสารนี้ได้ไม่ชัด/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({ contentKind: 'UNREADABLE', documentKind: 'NEEDS_REVIEW', confidence: 0.2, requiresClarification: true, missingRequiredSignals: ['UNREADABLE_OR_CROPPED'] }),
      fields: {},
    },
    {
      name: 'multi-document image', expected: /สรุปหลายรายการ/,
      intent: 'EXPENSE_DOCUMENT_CAPTURE' as const,
      classification: businessClassification({ contentKind: 'MULTI_DOCUMENT', documentKind: 'NEEDS_REVIEW', requiresClarification: true, missingRequiredSignals: ['MULTIPLE_DOCUMENTS'] }),
      fields: { grandTotalAmount: '900.00' },
    },
  ]) {
    it(`${scenario.name} returns bounded guidance with no expense mutation`, async () => {
      const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
      const h = makeHarness({
        permissions: ['expense.receipt.line_upload'],
        routePlan: { status: 'ROUTED', intent: scenario.intent, language: 'th', confidence: 0.95, documentClassification: scenario.classification },
        receiptOcrResult: { status: 'ok', classification: scenario.classification, fields: scenario.fields },
        prisma,
      });

      await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: `evt-${scenario.name}` });

      assert.equal(h.ocrRequests.length, 1);
      assert.equal(h.initCalls.length, 0);
      assert.equal(h.completeCalls.length, 0);
      assert.equal(recordUpdates.length, 0);
      const preservesMultiple = scenario.classification.contentKind === 'MULTI_DOCUMENT';
      assert.equal(h.uploads.length, preservesMultiple ? 1 : 0);
      assert.equal(pendingMediaRows.length, preservesMultiple ? 1 : 0);
      assert.match(h.replies[0] ?? '', scenario.expected);
    });
  }

  it('denies an expense route before OCR or existing-expense lookup when capture permission is missing', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95 },
      prisma,
    });

    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-no-expense-permission' });

    assert.equal(h.ocrRequests.length, 0);
    assert.equal(h.initCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.match(h.replies[0] ?? '', /ไม่มีสิทธิ์อัปโหลด/);
  });

  it('allows bounded quotation guidance without expense permission and creates no record', async () => {
    const { prisma, recordUpdates } = makePrisma();
    const detected = businessClassification({
      documentFamily: 'COMMERCIAL_DOCUMENT', documentKind: 'QUOTATION', businessDirection: 'CUSTOMER_INBOUND',
      transactionState: 'PROPOSED', evidenceRoles: ['COMMERCIAL_PROPOSAL'], amountSignals: ['5000.00'], settlementSignals: [],
    });
    const h = makeHarness({
      permissions: ['expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_DOCUMENT_REFERENCE', language: 'th', confidence: 0.95, documentClassification: detected },
      receiptOcrResult: { status: 'ok', classification: detected, fields: { grandTotalAmount: '5000.00' } },
      prisma,
    });

    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-reference-no-expense-permission' });

    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.match(h.replies[0] ?? '', /ใบเสนอราคา/);
  });

  it('router unavailable still captures an uncaptioned receipt that passes the OCR expense gate', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], routeThrows: true, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(recordUpdates.length, 1);
    assert.equal(pendingMediaRows.length, 0);
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
  });

  it('router and OCR unavailable persist clarification and never create an expense draft', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routeThrows: true,
      receiptOcrResult: { status: 'failed', errorCode: 'AI_GATEWAY_UNREACHABLE' },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.completeCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.equal(pendingMediaRows.length, 1);
    assert.match(h.replies[0] ?? '', /1\).*ใบเสร็จ[\s\S]*2\).*ภาพประกอบ/);
  });

  it('router unavailable with a caption still clarifies even when OCR sees a receipt', async () => {
    const { prisma, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({ permissions: ['expense.receipt.line_upload'], routeThrows: true, prisma });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'อันนี้คิดยังไง');
    assert.equal(h.initCalls.length, 0);
    assert.equal(h.completeCalls.length, 0);
    assert.equal(recordUpdates.length, 0);
    assert.equal(pendingMediaRows.length, 1);
    assert.match(h.replies[0] ?? '', /1\).*ใบเสร็จ[\s\S]*2\).*ภาพประกอบ/);
  });

  it('mutation request with media is refused with web guidance and remembered as refused', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: { status: 'ROUTED', intent: 'MUTATION_REQUEST_REFUSAL', language: 'th', confidence: 0.97 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.match(h.replies[0] ?? '', /ไม่สามารถทำรายการอนุมัติ/);
    assert.equal(turnCreates[0].data.intent, 'MUTATION_REQUEST');
    assert.equal(turnCreates[0].data.refused, true);
  });

  it('remembers a receipt-image capture turn (media EVIDENCE_CAPTURE memory row)', async () => {
    const { prisma, turnCreates, recordUpdates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { sourceDocumentType: 'RECEIPT', confidence: 0.9 },
      },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(h.ocrRequests.length, 1);
    assert.equal(h.initCalls.length, 1);
    assert.equal(h.completeCalls.length, 1);
    assert.equal(recordUpdates.length, 1);
    assert.equal(turnCreates.length, 1);
    assert.equal(turnCreates[0].data.intent, 'EVIDENCE_CAPTURE');
    assert.match(turnCreates[0].data.replyPreview, /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.equal(h.receiptContinuationCalls.length, 1);
    assert.equal(h.receiptContinuationCalls[0].expenseId, 'expense-1');
    assert.ok(h.receiptContinuationCalls[0].chatKeyHash && !h.receiptContinuationCalls[0].chatKeyHash.includes('line-user-secret'));
    assert.ok(h.receiptContinuationCalls[0].deliveredOutcomeId && !h.receiptContinuationCalls[0].deliveredOutcomeId.includes('evt-media'));
  });
});

describe('LINE intake dispatch – buffered caption (message buffering spec §8)', () => {
  it('caption text buffered with the media reaches the intake route as messageText', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload'],
      routePlan: {
        status: 'ROUTED', intent: 'EXPENSE_DOCUMENT_CAPTURE', language: 'th', confidence: 0.95,
        captureHints: { sourceDocumentType: 'RECEIPT', confidence: 0.9 },
      },
      prisma,
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'บันทึกค่าใช้จ่าย ร้านกาแฟ');
    assert.equal(result.outcome, 'done');
    assert.equal(h.routeRequests[0].messageText, 'บันทึกค่าใช้จ่าย ร้านกาแฟ');
    // The caption becomes part of the multi-turn memory preview.
    assert.match(turnCreates[0].data.userMessagePreview, /บันทึกค่าใช้จ่าย ร้านกาแฟ/);
  });

  it('RECEIPT-05: BUSINESS_READ_QUESTION with a caption persists the media + a PENDING row and asks ONE clarify question (no discard, no draft)', async () => {
    const { prisma, updates, recordUpdates, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'อันนี้คิดยังไง ยอดขายเดือนนี้เท่าไหร่');
    assert.equal(result.outcome, 'done');
    assert.equal(h.createUploadIntentCalls.length, 1, 'one attachment persisted');
    assert.equal(h.uploads.length, 1);
    assert.equal(h.completeAttachmentCalls.length, 1);
    assert.equal(pendingMediaRows.length, 1, 'one PENDING clarify row');
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.equal(pendingMediaRows[0].attachmentId, 'pending-att-1');
    assert.equal(pendingMediaRows[0].lineMessageId, 'msg-media-1');
    assert.equal(recordUpdates.length, 0, 'no expense draft created');
    assert.equal(h.createExpenseCalls.length, 0);
    assert.match(h.replies[0] ?? '', /1\).*ใบเสร็จ[\s\S]*2\).*ภาพประกอบ/);
    const statuses = updates.map((u: any) => u.data?.status);
    assert.ok(statuses.includes('clarification_required'),
      `expected clarification_required, got ${statuses.join(',')}`);
    assert.ok(!statuses.includes('caption_deferred_to_text'), 'no longer defers the caption');
  });

  it('RECEIPT-05 (Fix #7): a redelivered media+question event reuses the row — exactly one clarify reply, one attachment, one PENDING row, one intake turn', async () => {
    const { prisma, pendingMediaRows, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-redelivery' }, 'ยอดขายเดือนนี้เท่าไหร่');
    assert.equal(h.createUploadIntentCalls.length, 1, 'no second attachment on redelivery');
    assert.equal(h.uploads.length, 1);
    assert.equal(pendingMediaRows.length, 1, 'no second pending row on redelivery');
    assert.equal(h.replies.length, 1, 'redelivery stays silent — the clarify question is asked once');
    assert.equal(turnCreates.length, 1, 'no second intake turn persisted on redelivery');
  });

  it('RECEIPT-05 (Fix #8): a concurrent delivery that loses the unique pending-row race uploads no bytes (no orphaned attachment)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    // Both racers pass the existence check (findUnique null) before either inserts; the unique
    // (companyId, lineMessageId) index elects one winner and the loser's create hits P2002.
    prisma.client.lineIntakePendingMedia.findUnique = async () => null;
    let creates = 0;
    prisma.client.lineIntakePendingMedia.create = async (args: any) => {
      if (creates++ > 0) { const e = new Error('unique') as Error & { code: string }; e.code = 'P2002'; throw e; }
      const row = { id: 'pm-1', ...args.data }; pendingMediaRows.push(row); return row;
    };
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    await h.useCase.executeReceiptUpload({ ...MEDIA_EVENT, webhookEventId: 'evt-media-race' }, 'ยอดขายเดือนนี้เท่าไหร่');
    // Was 2 before the media-clarify context fix: every racer reserved an intent and the loser
    // orphaned it. The loser now sees the winner's still-open PENDING row and attaches to it, so no
    // second intent is reserved at all — strictly fewer orphans, same one-upload invariant.
    assert.equal(h.createUploadIntentCalls.length, 1, 'the loser attaches to the open row instead of reserving its own intent');
    assert.equal(h.uploads.length, 1, 'only the race winner uploaded bytes — the loser orphans nothing');
    assert.equal(h.completeAttachmentCalls.length, 1, 'exactly one attachment persisted');
    assert.equal(pendingMediaRows.length, 1, 'exactly one pending row');
  });

  it('RECEIPT-05: media+question without capture permission keeps the media-unsupported reply (no pending row)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    const h = makeHarness({
      permissions: ['line.ai.query', 'expense.signature.manage'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    assert.equal(result.outcome, 'done');
    assert.equal(pendingMediaRows.length, 0);
    assert.equal(h.createUploadIntentCalls.length, 0);
    assert.match(h.replies[0] ?? '', /ระบบรองรับ/);
  });

  it('BUSINESS_READ_QUESTION without caption keeps the media-unsupported reply', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
    });
    const result = await h.useCase.executeReceiptUpload(MEDIA_EVENT);
    assert.equal(result.outcome, 'done');
    assert.match(h.replies[0] ?? '', /ระบบรองรับ/);
  });
});

// RECEIPT-05: the text reply that resolves a pending media-clarify question.
function seedPendingRow(pendingMediaRows: any[], overrides: Partial<Record<string, any>> = {}) {
  pendingMediaRows.push({
    id: 'pm-1', companyId: 'company-1', userId: 'user-1', lineMessageId: 'msg-media-1',
    attachmentId: 'pending-att-1', caption: 'ยอดขายเดือนนี้เท่าไหร่', mimeType: 'image/jpeg',
    status: 'PENDING', expiresAt: new Date(Date.now() + 60_000), createdAt: new Date(), ...overrides,
  });
}

describe('LINE intake dispatch – RECEIPT-05 media-clarify follow-up', () => {
  it('completes choice 1 and returns the web-only substitute outcome in the same delivered turn', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'expense.review', 'expense.confirm', 'line.ai.query'],
      prisma,
      captureLedger,
      substituteResult: {
        handled: true, status: 'BLOCKED', workflowId: 'workflow-1', expenseId: 'expense-clarified-1',
        acceptedFields: [], blockers: [{ code: 'supporting_evidence_required' }],
        pendingQuestion: 'เหตุผลที่ไม่มีใบเสร็จคืออะไรคะ?',
        replyText: '📄 ใบรับรองแทนใบเสร็จรับเงิน\nLINE ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร\nเปิดตรวจสอบในเว็บ: /opaque-workflow',
      },
    });

    await h.useCase.execute({
      ...TEXT_EVENT,
      webhookEventId: 'evt-choice-and-substitute',
      messageText: 'ข้อ 1 และออกใบรับรองแทนเงินสดให้ฉัน',
    });

    assert.equal(h.createExpenseCalls.length, 1, 'the permitted receipt outcome completes once');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.equal(h.substituteCalls.length, 1, 'the additional clause is evaluated independently');
    assert.equal(h.substituteCalls[0].recentCandidates[0].id, 'expense-clarified-1');
    assert.match(h.replies[0] ?? '', /บันทึกข้อมูลค่าใช้จ่ายเบื้องต้นแล้ว/);
    assert.match(h.replies[0] ?? '', /ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.match(h.replies[0] ?? '', /ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร/);
    assert.equal(captureLedger.length, 1, 'only the unresolved substitute question remains in the ledger');
  });

  it('"ใช่ ใบเสร็จ" builds the draft from the STORED attachment (original message id) and marks the row RESOLVED_RECEIPT', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      scopes: { branchIds: ['branch-a'] },
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-receipt', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 1, 'draft created');
    assert.equal(h.createExpenseCalls[0].lineMessageId, 'msg-media-1', 'idempotency uses the ORIGINAL media message id');
    assert.equal(h.createExpenseCalls[0].branchId, 'branch-a', 'clarified media keeps the caller branch scope');
    assert.equal(h.linkAttachmentCalls.length, 1);
    assert.equal(h.linkAttachmentCalls[0][1], 'pending-att-1', 'links the already-persisted attachment (no re-download)');
    assert.equal(h.createUploadIntentCalls.length, 0, 'no new attachment on resolve');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.match(h.replies[0] ?? '', /expense-clarified-1/);
    assert.match(h.replies[0] ?? '', /ตรวจสอบและยืนยันในเว็บแอป/);
  });

  it('"ใช่ ใบเสร็จ" warns when the stored attachment checksum matches a web upload', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    const repo = (h.useCase as any).expenseRepo;
    repo.findExpenseIdsByAttachmentChecksum = async () => ['expense-from-web'];

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-duplicate', messageText: 'ใช่ ใบเสร็จ' });

    assert.equal(h.updateExpenseCalls.some((update) => 'duplicateStatus' in update), false);
    assert.equal(h.updateExpenseCalls.at(-1).aiVerificationSummaryJson.duplicateWarning, true);
    assert.match(h.replies[0] ?? '', /อาจซ้ำ/);
  });

  it('keeps a receipt choice pending when the capture outcome cannot be delivered', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
      lineReplyResult: 'failed_other',
    });

    await assert.rejects(h.useCase.execute({
      ...TEXT_EVENT,
      webhookEventId: 'evt-receipt-delivery-fail',
      messageText: 'ใช่ ใบเสร็จ',
    }));

    assert.equal(h.createExpenseCalls.length, 1, 'the idempotent draft may exist for retry');
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'stored media is not consumed before delivery');
  });

  it('a redelivered receipt confirmation reuses the existing draft (findByLineMessageId) instead of creating a second', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      findExpenseByLineMessageId: async (_c, lineMessageId) => ({ id: 'expense-existing-1', lineMessageId, sourceDocumentType: 'RECEIPT' }),
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-confirm-again', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 0, 'no second draft');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT');
    assert.match(h.replies[0] ?? '', /expense-existing-1/);
  });

  it('Fix #5: a link failure on first resolve leaves the row PENDING; the retry repairs the link and only then resolves (receipt never detached)', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    // First resolve: createExpense succeeds but linkAttachment throws — a partial draft. The retry
    // finds that partial expense and must REPAIR the link (not rubber-stamp it) before resolving.
    let findCalls = 0;
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      findExpenseByLineMessageId: async () =>
        findCalls++ === 0 ? null : { id: 'expense-clarified-1', lineMessageId: 'msg-media-1', primaryAttachmentId: null },
      prisma,
    });
    const repo = (h.useCase as any).expenseRepo;
    const realLink = repo.linkAttachment;
    let linkCalls = 0;
    repo.linkAttachment = async (...a: any[]) => {
      if (linkCalls++ === 0) throw new Error('attachment link failed');
      return realLink(...a);
    };

    await assert.rejects(h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-r1', messageText: 'ใช่ ใบเสร็จ' }));
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'row NOT resolved while the receipt is still detached');

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-r2', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 1, 'no second draft — the retry repairs the partial one');
    assert.equal(linkCalls, 2, 'the retry re-attempted the attachment link');
    assert.ok(h.updateExpenseCalls.some((u: any) => u.primaryAttachmentId === 'pending-att-1'), 'primaryAttachmentId repaired');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_RECEIPT', 'row resolves only once the attachment is really linked');
    assert.match(h.replies.at(-1) ?? '', /expense-clarified-1/);
  });

  it('"แค่ภาพประกอบ" creates no draft, marks the row RESOLVED_ILLUSTRATION, and answers the ORIGINAL caption as a text turn', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-illustration', messageText: 'แค่ภาพประกอบ' });
    assert.equal(h.createExpenseCalls.length, 0, 'no draft');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_ILLUSTRATION');
    // The stored caption — not the "just an illustration" reply — is what reaches the intake route + AI turn.
    assert.match(h.routeRequests.at(-1)?.messageText ?? '', /ยอดขาย/);
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('"สรุปหลายรายการ" preserves the file, creates no expense, and closes the pending review choice after delivery', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      prisma,
    });

    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-multiple', messageText: 'สรุปหลายรายการ' });

    assert.equal(h.createExpenseCalls.length, 0, 'multiple transactions never collapse into one draft');
    assert.equal(pendingMediaRows[0].status, 'RESOLVED_MULTI_ENTRY_REVIEW');
    assert.match(h.replies[0] ?? '', /ยังไม่ได้สร้างค่าใช้จ่ายรายการเดียว/);
    assert.match(h.replies[0] ?? '', /\/companies\/company-1\/expenses/);
    assert.equal(h.routeRequests.length, 0, 'the model cannot reinterpret the safe multi-entry decision');
  });

  it('keeps an illustration choice pending until the deferred answer is delivered', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
      lineReplyResult: 'failed_other',
    });

    await h.useCase.execute({
      ...TEXT_EVENT,
      webhookEventId: 'evt-illustration-delivery-fail',
      messageText: 'แค่ภาพประกอบ',
    });

    assert.equal(pendingMediaRows[0].status, 'PENDING');
  });

  it('an ambiguous follow-up leaves the row PENDING and routes the reply normally', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows);
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-ambiguous', messageText: 'เดี๋ยวก่อนนะ' });
    assert.equal(h.createExpenseCalls.length, 0);
    assert.equal(pendingMediaRows[0].status, 'PENDING', 'row untouched');
    assert.match(h.routeRequests.at(-1)?.messageText ?? '', /เดี๋ยวก่อน/, 'the original reply routes, not the caption');
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });

  it('an expired pending row is ignored — the reply routes normally, no draft, row left as-is', async () => {
    const { prisma, pendingMediaRows } = makePrisma();
    seedPendingRow(pendingMediaRows, { expiresAt: new Date(Date.now() - 60_000) });
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.9 },
      prisma,
    });
    await h.useCase.execute({ ...TEXT_EVENT, webhookEventId: 'evt-expired', messageText: 'ใช่ ใบเสร็จ' });
    assert.equal(h.createExpenseCalls.length, 0, 'expired row not consumed');
    assert.equal(pendingMediaRows[0].status, 'PENDING');
    assert.match(h.replies[0] ?? '', /turn-answer/);
  });
});

describe('media clarify carries its file into the next turn', () => {
  // The defect this closes: the media path stored the picture and asked a question, but wrote
  // nothing to the ledger. The follow-up reply therefore arrived with no open clarification and no
  // handle on the stored file, so the assistant asked the customer to send a picture it already had.
  it('appends a waiting_user clarification naming the stored attachment', async () => {
    const captureLedger: any[] = [];
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      captureLedger,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');

    assert.equal(captureLedger.length, 1, 'the question is carried, not dropped');
    const item = captureLedger[0].items[0];
    assert.equal(item.state, 'waiting_user');
    assert.equal(item.clarifyForIntent, 'EXPENSE_DOCUMENT_CAPTURE');
    // The caption is the deferred request, mirroring the text path.
    assert.equal(item.text, 'ยอดขายเดือนนี้เท่าไหร่');
    // The handle that lets the next turn talk about THIS file instead of asking for a new one.
    assert.equal(item.pendingMedia?.attachmentId, 'pending-att-1');
    assert.ok(item.pendingMedia?.pendingMediaId, 'the pending row id rides along');
  });

  it('names the file in the turn preview so multi-turn memory can refer back to it', async () => {
    const { prisma, turnCreates } = makePrisma();
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
      prisma,
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');

    // Was the bare '[ผู้ใช้ส่งรูป/ไฟล์]': the model could see a picture had been sent but had no
    // way to say WHICH, so a later turn could only ask for it again.
    assert.match(turnCreates.at(-1)?.data?.userMessagePreview ?? '', /\[ผู้ใช้ส่งรูป\/ไฟล์ #pending-att-1\]/);
  });

  // Step 3 of the reported loop: an unrecognised answer left the row PENDING, the customer sent the
  // picture again, and a SECOND row + question came back — forever, storing a copy each round.
  it('re-sending a picture while a question is open does not ask again or store a second copy', async () => {
    const h = makeHarness({
      permissions: ['expense.receipt.line_upload', 'line.ai.query'],
      routePlan: { status: 'ROUTED', intent: 'BUSINESS_READ_QUESTION', language: 'th', confidence: 0.95 },
    });

    await h.useCase.executeReceiptUpload(MEDIA_EVENT, 'ยอดขายเดือนนี้เท่าไหร่');
    const repliesAfterFirst = h.replies.length;
    await h.useCase.executeReceiptUpload(
      { ...MEDIA_EVENT, webhookEventId: 'evt-media-2', lineMessageId: 'line-msg-2' },
      'ยอดขายเดือนนี้เท่าไหร่',
    );

    assert.equal(h.replies.length, repliesAfterFirst, 'the open question is not repeated');
    assert.equal(h.uploads.length, 1, 'the picture is not stored twice');
  });
});

describe('classifyPendingMediaReply (RECEIPT-05 follow-up resolver)', () => {
  it('splits a numbered clarification outcome from an independent trailing request', () => {
    assert.deepEqual(splitPendingMediaReply('ข้อ 1 และออกใบรับรองแทนเงินสดให้ฉัน'), {
      decision: 'receipt', remainder: 'ออกใบรับรองแทนเงินสดให้ฉัน',
    });
    assert.equal(splitPendingMediaReply('จ่ายไป 2 ใบ'), null);
  });
  it('affirmative / receipt words → receipt', () => {
    for (const t of ['ใช่ ใบเสร็จ', 'บันทึกเลย', 'receipt please', 'บิลค่าอาหาร', 'สลิปโอน']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
  });
  it('illustration / negation words → illustration', () => {
    for (const t of ['แค่ภาพประกอบ', 'ไม่ใช่', 'แค่ถามเฉยๆ', 'just an illustration', 'no']) {
      assert.equal(classifyPendingMediaReply(t), 'illustration', t);
    }
  });
  it('multiple-entry words → safe multi-entry review', () => {
    for (const t of ['สรุปหลายรายการ', 'หลายรายการ', 'multiple entries']) {
      assert.equal(classifyPendingMediaReply(t), 'multiple', t);
    }
  });
  it('"ไม่ใช่" resolves to illustration even though it contains "ใช่"', () => {
    assert.equal(classifyPendingMediaReply('ไม่ใช่'), 'illustration');
  });
  it('Fix #4: a refusal that CONTAINS a receipt keyword is never receipt (no draft from a "no")', () => {
    // 'ไม่ต้องบันทึก' contains 'บันทึก'; 'ไม่เอา' is a bare refusal — both must NOT return receipt.
    for (const t of ['ไม่ต้องบันทึก', 'ไม่เอา', 'ยกเลิก', "don't save it", 'no, cancel']) {
      assert.notEqual(classifyPendingMediaReply(t), 'receipt', t);
    }
  });
  it('Fix #4: the question particle "ไหม" is NOT treated as the negation "ไม่"', () => {
    // 'ใช่ใบเสร็จไหม' ("is it a receipt?") carries no 'ไม่', so its receipt words still count.
    assert.equal(classifyPendingMediaReply('ใช่ใบเสร็จไหม'), 'receipt');
  });
  it('neither / both matched → ambiguous (never consume the row on a guess)', () => {
    assert.equal(classifyPendingMediaReply('เดี๋ยวก่อนนะ'), 'ambiguous');
    assert.equal(classifyPendingMediaReply('ใช่ แต่แค่ภาพประกอบ'), 'ambiguous');
    assert.equal(classifyPendingMediaReply(''), 'ambiguous');
  });

  // The reported loop: the question offers choices, the customer answers with one, and the resolver
  // did not recognise it — so the row stayed PENDING and the reply was routed as a fresh message
  // with no picture attached to it, which made the assistant ask for a picture again.
  it('accepts the numbered choice the question actually offers', () => {
    for (const t of ['1', '1.', '1)', 'ข้อ 1', 'แรก', 'อันแรก', 'ข้อแรก', 'อันที่ 1']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
    for (const t of ['2', '2)', 'ข้อ 2', 'สอง', 'อันที่สอง']) {
      assert.equal(classifyPendingMediaReply(t), 'illustration', t);
    }
    for (const t of ['3', '3)', 'ข้อ 3', 'สาม', 'อันที่สาม']) {
      assert.equal(classifyPendingMediaReply(t), 'multiple', t);
    }
  });

  // Anchored to the whole reply: a lone digit is a choice, a number inside a sentence is data.
  it('never reads an amount or a count as a menu choice', () => {
    for (const t of ['1500', 'จ่ายไป 2 ใบ', '1 พันบาท', '12']) {
      assert.equal(classifyPendingMediaReply(t), 'ambiguous', t);
    }
  });

  it('accepts the document names customers actually type, including the question’s own words', () => {
    for (const t of ['ใบกำกับภาษี', 'ใบแจ้งหนี้', 'ใบส่งของ', 'ใบวางบิล', 'invoice', 'เอกสารค่าใช้จ่าย']) {
      assert.equal(classifyPendingMediaReply(t), 'receipt', t);
    }
  });

  // Deliberate non-goal: against an A-or-B question a bare "yes" picks a side by guessing. These
  // fall through to the model, which now receives the open clarification WITH the stored file.
  it('leaves a bare affirmative to the model rather than guessing a side', () => {
    for (const t of ['ครับ', 'ค่ะ', 'ok', 'โอเค']) {
      assert.equal(classifyPendingMediaReply(t), 'ambiguous', t);
    }
  });

  it('keeps refusing a negation that also names the document', () => {
    assert.notEqual(classifyPendingMediaReply('ไม่ใช่ใบกำกับภาษี'), 'receipt');
    assert.notEqual(classifyPendingMediaReply('ไม่ต้องบันทึกใบเสร็จ'), 'receipt');
  });
});
