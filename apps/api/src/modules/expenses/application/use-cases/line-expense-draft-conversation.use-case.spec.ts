import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { buildInitialLineExpenseDraftContinuation } from '../../domain/logic/line-expense-draft-conversation.logic';
import { LineExpenseDraftConversationUseCase } from './line-expense-draft-conversation.use-case';

const categories = [
  { id: 'cat-office', companyId: 'c1', name: 'อุปกรณ์สำนักงาน', accountHintKey: 'expense.office', defaultInputTaxCode: null, status: 'ACTIVE', sortOrder: 1 },
] as any;

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'u1', userId: 'u1', companyId: 'c1', membershipId: 'm1',
  roles: [], permissions: ['expense.receipt.line_upload'], scopes: {}, authProvider: 'line',
};

function harness(count = 1, expenseNote?: string, passive = false) {
  const state = buildInitialLineExpenseDraftContinuation({
    workflowId: 'wf-1', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
    targetRevision: '2026-08-18T00:00:00.000Z', provisionalExpenseDate: '2026-08-18',
    messageText: 'ซื้อกระดาษ A4 มาใช้สำนักงาน', categories, now: '2026-08-18T00:00:00.000Z',
    hints: { confidence: 0.9, businessPurpose: 'ใช้สำนักงาน', items: [{ sourceText: 'กระดาษ A4', description: 'กระดาษ A4', expenseCategoryId: 'cat-office' }] },
  });
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`, expenseNumber: null, note: 'ใช้สำนักงาน', grandTotalAmount: '0',
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    sourceChannelMetadataJson: { lineExpenseDraftContinuation: { ...state, expenseId: `e${index + 1}`, workflowId: `wf-${index + 1}`, ...(passive ? { status: 'PAUSED' as const } : {}) } },
  }));
  const expense = {
    id: 'e1', companyId: 'c1', createdByUserId: 'u1', captureSource: 'LINE_UPLOAD', status: 'DRAFT',
    ...(expenseNote !== undefined ? { note: expenseNote } : {}),
    updatedAt: new Date('2026-08-18T00:00:00.000Z'), sourceChannelMetadataJson: rows[0]!.sourceChannelMetadataJson,
    aiVerificationSummaryJson: {}, lines: [], attachments: [], duplicateCandidates: [], substituteReceiptEvidence: null, payments: [],
  } as any;
  const updates: any[] = [];
  const repo = {
    listLineExpenseDraftContinuationRows: async () => rows,
    findByIdWithRelations: async (_companyId: string, id: string) => id === 'e1' ? expense : { ...expense, id },
    listCategories: async () => categories,
  } as any;
  const updateDraft = {
    execute: async (_ctx: any, id: string, input: any, options: any) => {
      updates.push({ id, input, options });
      return { ...expense, id, updatedAt: options.lineDraftCollection.nextUpdatedAt };
    },
  } as any;
  const useCase = new LineExpenseDraftConversationUseCase(repo, updateDraft);
  return { useCase, updates };
}

describe('LineExpenseDraftConversationUseCase', () => {
  it('matches grounded answers only for a unique open questionnaire, preserving ambiguity and unrelated requests (A4)', async () => {
    const h = harness();
    const rows = await (h.useCase as any).repo.listLineExpenseDraftContinuationRows();
    const state = rows[0].sourceChannelMetadataJson.lineExpenseDraftContinuation;
    state.items = state.items.slice(0, 1);
    state.unresolvedQuestions = state.unresolvedQuestions.filter((question: any) => !question.id.startsWith('I02-'));
    for (const text of ['วันที่ 10 ตุลา 2569 จำนวน 1 คน ราคา 500', 'อุปกรณ์สำนักงาน', 'ร้าน ABC', '500 บาท']) {
      assert.equal(await h.useCase.answersOpenDraft(ctx, 'chat', text), true, text);
    }
    for (const text of ['อ่าว ทำไมเงียบ', 'ยอดขายวันที่ 10 ตุลา 2569 เท่าไร', 'สร้างค่าใช้จ่ายใหม่ 500 บาท วันที่ 10 ตุลา 2569', 'รายรับอุปกรณ์สำนักงาน']) {
      assert.equal(await h.useCase.answersOpenDraft(ctx, 'chat', text), false, text);
    }
    assert.equal(await harness(2).useCase.answersOpenDraft(ctx, 'chat', 'อุปกรณ์สำนักงาน'), false);
    assert.equal(await harness(1, undefined, true).useCase.answersOpenDraft(ctx, 'chat', 'อุปกรณ์สำนักงาน'), false);
    assert.equal(h.updates.length, 0, 'matching is read only');
  });
  it('returns the exact committed revision and only referenced category identities with its reply', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'I01-QTY 5', webhookEventId: 'source-proof' });
    assert.equal(result.status, 'UPDATED');
    assert.deepEqual(result.source?.records, [{ id: 'e1', updatedAt: h.updates[0].options.lineDraftCollection.nextUpdatedAt }]);
    assert.deepEqual(result.source?.categories, [{ id: 'cat-office', name: 'อุปกรณ์สำนักงาน' }]);
    assert.equal(h.updates.length, 1);
  });

  it('binds multiple draft choices to the original ordered records without writing', async () => {
    const h = harness(2);
    const result = await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'ต่อ' });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.deepEqual(result.source?.records.map(row => row.id), ['e1', 'e2']);
    assert.deepEqual(result.source?.choices, await h.useCase.routeContexts(ctx, 'chat'));
    assert.equal(h.updates.length, 0);
  });

  it('initializes a passive draft from current saved facts when old OCR hints disagree', async () => {
    const h = harness();
    const repo = (h.useCase as any).repo;
    const read = repo.findByIdWithRelations;
    repo.findByIdWithRelations = async (...args: any[]) => ({ ...(await read(...args)),
      sourceChannelMetadataJson: { chatKeyHash: 'chat' }, expenseDate: new Date('2026-09-15'),
      vendorNameSnapshot: 'ร้านที่เจ้าของแก้ล่าสุด',
      lines: [{ id: 'current-line', lineNumber: 1, description: 'กระดาษ A4', quantity: '5', unitPrice: '150', lineTotalAmount: '750', expenseCategoryId: 'cat-office' }],
    });
    await h.useCase.startFromReceipt(ctx, { expenseId: 'e1', chatKeyHash: 'chat', webhookEventId: 'old-ocr',
      ocrFields: { vendorName: 'ร้านจาก OCR เก่า', expenseDate: '2026-08-18',
        lines: [{ description: 'กระดาษ A4', quantity: '2', unitPrice: '120', amount: '240', evidenceSignal: 'old OCR' }] } });
    const saved = h.updates[0].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation;
    assert.equal(saved.header.vendorName, 'ร้านที่เจ้าของแก้ล่าสุด');
    assert.equal(saved.header.expenseDate, '2026-09-15');
    // Without a proven binding, old OCR is unresolved evidence, never silently mapped onto
    // the owner's different financial row by position or description alone.
    assert.equal(saved.items[0].reviewRequired, true); assert.equal(saved.items[0].lineId, undefined);
    assert.equal(saved.status, 'PAUSED');
    assert.deepEqual(h.updates[0].input, { expectedUpdatedAt: '2026-08-18T00:00:00.000Z' }, 'initialization does not rewrite money or identity');
  });

  it('loads persistent route context without any AiTurn/Redis context', async () => {
    const { useCase } = harness();
    const contexts = await useCase.routeContexts(ctx, 'chat');
    assert.equal(contexts.length, 1);
    assert.ok(contexts[0]?.questions.some((question) => question.id === 'I01-PRICE'));
  });

  it('keeps passive uploads out of unrelated chat even when a model proposes their id; explicit edits still work', async () => {
    const passive = harness(1, undefined, true);
    const contexts = await passive.useCase.routeContexts(ctx, 'chat');
    assert.deepEqual(contexts[0]!.questions, []);
    for (const messageText of ['300', 'ยอดขายวันนี้เท่าไร', 'ขอบคุณ']) {
      const result = await passive.useCase.execute(ctx, { chatKeyHash: 'chat', messageText, captureHints: { targetExpenseId: 'e1', vendorName: messageText } });
      assert.equal(result.handled, false);
    }
    assert.equal(passive.updates.length, 0);
    const edited = await passive.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'แก้ผู้ขายเป็น ร้าน ABC', captureHints: { targetExpenseId: 'e1', vendorName: 'ร้าน ABC' } });
    assert.equal(edited.handled, true);
    assert.ok(edited.acceptedFields.includes('D-VENDOR'));
    assert.doesNotMatch(edited.replyTexts.join(''), /ข้อมูลที่ต้องใช้|ตอบรวม|D-VENDOR/u);
    assert.equal(passive.updates.length, 1);
  });

  it('starts the same durable question workflow from validated receipt OCR fields', async () => {
    const h = harness();
    const expense = (h.useCase as any).repo.findByIdWithRelations;
    (h.useCase as any).repo.findByIdWithRelations = async (...args: any[]) => ({
      ...(await expense(...args)),
      expenseDate: new Date('2026-08-18T00:00:00.000Z'),
      sourceChannelMetadataJson: { channel: 'LINE', kind: 'media' },
      aiVerificationSummaryJson: {},
      vendorNameSnapshot: 'ร้าน ABC',
      lines: [{ id: 'line-1', lineNumber: 1, description: 'กระดาษ A4', quantity: '2', unitPrice: '120', lineTotalAmount: '240', expenseCategoryId: 'cat-office' }],
    });

    const result = await h.useCase.startFromReceipt(ctx, {
      expenseId: 'e1', chatKeyHash: 'chat', webhookEventId: 'receipt-evt',
      ocrFields: {
        expenseDate: '2026-08-18', vendorName: 'ร้าน ABC', confidence: 0.97,
        lines: [{ description: 'กระดาษ A4', quantity: '2', amount: '240', unitPrice: '120', evidenceSignal: 'กระดาษ A4 2 120 240' }],
      },
      suggestedCategoryId: 'cat-office',
    });

    assert.equal(result.status, 'UPDATED');
    assert.match(result.replyTexts.join('\n'), /ร้าน ABC/u);
    assert.doesNotMatch(result.replyTexts.join('\n'), /D-PURPOSE|I01-CATEGORY|ข้อมูลที่ต้องใช้|ตอบรวม/u);
    const saved = h.updates[0].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation;
    assert.equal(saved.status, 'PAUSED');
    assert.ok(!saved.unresolvedQuestions.some((question: any) => question.id === 'D-PURPOSE'));
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].quantity, '2');
    assert.ok(Object.values(saved.provenance).every((item: any) => item.source === 'LINE_MEDIA_OCR'));
  });

  it('applies several answers with CAS, materializes valid lines, and returns all remaining questions', async () => {
    const { useCase, updates } = harness();
    const result = await useCase.execute(ctx, {
      chatKeyHash: 'chat', webhookEventId: 'evt-2',
      messageText: 'D-DATE 18/08/2026, D-VENDOR ร้าน ABC, I01-QTY 5 รีม, I01-PRICE 650 รวม, I01-CATEGORY ตามที่แนะนำ',
    });
    assert.equal(result.status, 'UPDATED');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].input.expectedUpdatedAt, '2026-08-18T00:00:00.000Z');
    assert.equal(updates[0].input.lines[0].quantity, '5');
    assert.equal(updates[0].input.lines[0].unitPrice, '130');
    assert.equal(updates[0].options.requireExpectedUpdatedAt, true);
    assert.equal(updates[0].options.transactionalAudit.action, 'expense.line_draft.answer');
    assert.deepEqual(updates[0].options.transactionalAudit.metadataJson.acceptedFields.sort(), [
      'D-DATE', 'D-VENDOR', 'I01-CATEGORY', 'I01-PRICE', 'I01-QTY',
    ]);
    assert.deepEqual(updates[0].options.transactionalAudit.metadataJson.rejectedCandidates, []);
    assert.equal(updates[0].options.transactionalAudit.metadataJson.previousVersion, 1);
    assert.equal(updates[0].options.transactionalAudit.metadataJson.nextVersion, 2);
    assert.deepEqual(updates[0].options.transactionalAudit.metadataJson.webhookEventIds, ['evt-2']);
    assert.match(result.replyTexts.join('\n'), /กระดาษ A4/u);
    assert.match(result.replyTexts.join('\n'), /ยังไม่ยืนยันรายการ/u);
  });

  // Spec S1-R5: the override signal must come from the mobile journey too, or the measured
  // override rate quietly excludes the surface most receipts arrive on.
  it('emits a category override event only when a stored answer replaces the AI suggestion', async () => {
    const withFuel = async (messageText: string) => {
      const h = harness();
      const events: any[] = [];
      (h.useCase as any).logger = { log: (entry: any) => events.push(entry) };
      (h.useCase as any).repo.listCategories = async () => [
        ...categories,
        { id: 'cat-fuel', companyId: 'c1', name: 'ค่าน้ำมัน', accountHintKey: 'expense.fuel', defaultInputTaxCode: null, status: 'ACTIVE', sortOrder: 2 },
      ];
      const result = await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText });
      return { events, result, updates: h.updates };
    };

    const accepted = await withFuel('I01-CATEGORY ตามที่แนะนำ');
    assert.equal(accepted.result.status, 'UPDATED');
    assert.ok(accepted.updates[0].options.transactionalAudit.metadataJson.acceptedFields.includes('I01-CATEGORY'));
    assert.deepEqual(accepted.events, [], 'taking the suggested category is not an override');

    const overridden = await withFuel('I01-CATEGORY ค่าน้ำมัน');
    assert.equal(overridden.result.status, 'UPDATED');
    assert.deepEqual(overridden.events, [{
      msg: 'expense_category_overridden',
      companyId: 'c1',
      expenseId: 'e1',
      surface: 'line',
      fromSuggested: true,
    }], 'ids and booleans only — no category name, no message text');

    const unrelated = await withFuel('D-VENDOR ร้าน ABC');
    assert.deepEqual(unrelated.events, [], 'an answer that stored no category is not an override');
  });

  it('preserves policy-only missing evidence while recomputing collection questions', async () => {
    const h = harness();
    const find = (h.useCase as any).repo.findByIdWithRelations;
    (h.useCase as any).repo.findByIdWithRelations = async (...args: any[]) => ({
      ...(await find(...args)),
      aiVerificationSummaryJson: { missingFields: ['receipt_evidence', 'quantity'] },
    });

    await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'D-VENDOR ร้าน ABC' });

    const missing = h.updates[0].options.lineDraftCollection.aiVerificationSummaryJson.missingFields;
    assert.ok(missing.includes('receipt_evidence'));
    assert.ok(!missing.includes('quantity'));
    assert.ok(missing.includes('price'));
  });

  it('keeps pause and end-input distinct and never requests a final financial mutation', async () => {
    const paused = await harness().useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'พัก' });
    const ended = await harness().useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'หมด' });
    assert.equal(paused.status, 'PAUSED');
    assert.equal(ended.status, 'ENDED');
    assert.match(ended.replyTexts.join('\n'), /ยังไม่ยืนยันรายการ/u);
  });

  it('fails closed when several drafts exist and no exact target is selected', async () => {
    const { useCase, updates } = harness(2);
    const result = await useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'I01-QTY 5 รีม' });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.equal(updates.length, 0);
    assert.match(result.replyTexts[0]!, /ร่าง 1/u);
  });

  it('makes an explicit target durable by opening it and parking other open drafts', async () => {
    const { useCase, updates } = harness(2);
    const result = await useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'ร่าง 1' });
    assert.equal(result.status, 'UPDATED');
    assert.deepEqual(updates.map((update) => update.id), ['e2', 'e1']);
    assert.equal(
      updates[0].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.status,
      'PAUSED_INTERRUPTED',
    );
    assert.equal(
      updates[1].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.status,
      'OPEN',
    );
    assert.equal(
      updates[1].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.targetRevision,
      updates[1].options.lineDraftCollection.nextUpdatedAt.toISOString(),
    );
  });

  it('reports stale instead of overwriting a newer web revision', async () => {
    const h = harness();
    (h as any).useCase['updateDraft'].execute = async () => { throw new ConflictException('stale'); };
    const result = await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'พัก' });
    assert.equal(result.status, 'STALE');
    assert.match(result.replyTexts[0]!, /ไม่เขียนทับ/u);
  });

  it('uses the revision of the loaded continuation snapshot for CAS, not a later detail read', async () => {
    const h = harness();
    const find = (h.useCase as any).repo.findByIdWithRelations;
    (h.useCase as any).repo.findByIdWithRelations = async (...args: any[]) => ({
      ...(await find(...args)),
      updatedAt: new Date('2026-08-18T02:00:00.000Z'),
    });

    await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'พัก' });

    assert.equal(h.updates[0].input.expectedUpdatedAt, '2026-08-18T00:00:00.000Z');
  });

  it('parks one open draft silently for an unrelated request', async () => {
    const { useCase, updates } = harness();
    const capsule = await useCase.interruptOpen(ctx, 'chat');
    assert.equal(capsule, undefined);
    assert.equal(updates[0].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.status, 'PAUSED_INTERRUPTED');
  });

  it('parks every open draft before handing an unrelated request back to normal chat', async () => {
    const { useCase, updates } = harness(2);
    const capsule = await useCase.interruptOpen(ctx, 'chat');
    assert.equal(capsule, undefined);
    assert.equal(updates.length, 2);
    assert.ok(updates.every((update) =>
      update.options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.status === 'PAUSED_INTERRUPTED'));
  });
});

/**
 * Spec `line-ai-draft-control-spec-th.md` §5.3. This lane collects a business purpose over several
 * turns and, with no purpose column to put it in, stores it in the header note — by overwriting the
 * whole column, which took `'LINE receipt upload'` with it the moment the user answered.
 */
describe('the collected purpose does not evict the capture provenance', () => {
  const PROVENANCE = 'LINE receipt upload';

  async function collectPurpose(existingNote: string) {
    const h = harness(1, existingNote);
    const find = (h.useCase as any).repo.findByIdWithRelations;
    (h.useCase as any).repo.findByIdWithRelations = async (...args: any[]) => ({
      ...(await find(...args)),
      note: existingNote,
      expenseDate: new Date('2026-08-18T00:00:00.000Z'),
      sourceChannelMetadataJson: { channel: 'LINE', kind: 'media' },
      aiVerificationSummaryJson: {},
      lines: [],
    });
    await h.useCase.startFromReceipt(ctx, {
      expenseId: 'e1', chatKeyHash: 'chat', webhookEventId: 'receipt-evt',
      businessPurpose: 'เลี้ยงลูกค้า',
      ocrFields: { expenseDate: '2026-08-18', vendorName: 'ร้าน ABC', confidence: 0.97 },
    });
    return h.updates.at(-1)!.input.note as string;
  }

  it('writes the purpose behind the provenance, never over it', async () => {
    const note = await collectPurpose(PROVENANCE);
    assert.ok(note.startsWith(PROVENANCE), `provenance must survive the first answer, got: ${note}`);
    assert.ok(note.includes('วัตถุประสงค์: เลี้ยงลูกค้า'));
  });

  it('replaces its own earlier answer instead of stacking a second purpose', async () => {
    const note = await collectPurpose(`${PROVENANCE} · วัตถุประสงค์: ยังไม่แน่ใจ`);
    assert.equal(note, `${PROVENANCE} · วัตถุประสงค์: เลี้ยงลูกค้า`);
    assert.equal(note.split('วัตถุประสงค์:').length - 1, 1);
  });
});


it('rejects an appended purpose exceeding note storage before any draft update, without truncating', async () => {
  const h = harness(1, 'x'.repeat(490));
  const result = await h.useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'D-PURPOSE ใช้เดินทางพบลูกค้า', webhookEventId: 'long-purpose' });
  assert.equal(h.updates.length, 0); assert.match(result.replyTexts.join('\n'), /500/); assert.deepEqual(result.acceptedFields, []);
});

it('Fix-up 17A C01: วันนี้ remains the grounded document date even when the router omitted its date hint', () => {
  const state = buildInitialLineExpenseDraftContinuation({ workflowId: 'fx17-date', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
    targetRevision: '2026-10-16T03:00:00Z', provisionalExpenseDate: '2026-10-16', now: '2026-10-16T03:00:00Z', categories,
    messageText: 'ทำให้หน่อย ค่าซ่อมแอร์หน้าร้าน 1,800 บาท ร้านเย็นฉ่ำแอร์ วันนี้ จ่ายเงินสดไปแล้ว',
    hints: { confidence: 0.9, description: 'ค่าซ่อมแอร์หน้าร้าน', amount: '1800', vendorName: 'ร้านเย็นฉ่ำแอร์' } });
  assert.equal(state.header.expenseDate, '2026-10-16');
  assert.ok(!state.unresolvedQuestions.some(question => question.id === 'D-DATE'));
});
