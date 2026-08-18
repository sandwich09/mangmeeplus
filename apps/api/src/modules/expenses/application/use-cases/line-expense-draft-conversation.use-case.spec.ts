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

function harness(count = 1) {
  const state = buildInitialLineExpenseDraftContinuation({
    workflowId: 'wf-1', companyId: 'c1', userId: 'u1', expenseId: 'e1', chatKeyHash: 'chat',
    targetRevision: '2026-08-18T00:00:00.000Z', provisionalExpenseDate: '2026-08-18',
    messageText: 'ซื้อกระดาษ A4 มาใช้สำนักงาน', categories, now: '2026-08-18T00:00:00.000Z',
    hints: { confidence: 0.9, businessPurpose: 'ใช้สำนักงาน', items: [{ sourceText: 'กระดาษ A4', description: 'กระดาษ A4', expenseCategoryId: 'cat-office' }] },
  });
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `e${index + 1}`, expenseNumber: null, note: 'ใช้สำนักงาน', grandTotalAmount: '0',
    updatedAt: new Date('2026-08-18T00:00:00.000Z'),
    sourceChannelMetadataJson: { lineExpenseDraftContinuation: { ...state, expenseId: `e${index + 1}`, workflowId: `wf-${index + 1}` } },
  }));
  const expense = {
    id: 'e1', companyId: 'c1', createdByUserId: 'u1', captureSource: 'LINE_UPLOAD', status: 'DRAFT',
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
  it('loads persistent route context without any AiTurn/Redis context', async () => {
    const { useCase } = harness();
    const contexts = await useCase.routeContexts(ctx, 'chat');
    assert.equal(contexts.length, 1);
    assert.ok(contexts[0]?.questions.some((question) => question.id === 'I01-QTY'));
  });

  it('starts the same durable question workflow from validated receipt OCR fields', async () => {
    const h = harness();
    const expense = (h.useCase as any).repo.findByIdWithRelations;
    (h.useCase as any).repo.findByIdWithRelations = async (...args: any[]) => ({
      ...(await expense(...args)),
      expenseDate: new Date('2026-08-18T00:00:00.000Z'),
      sourceChannelMetadataJson: { channel: 'LINE', kind: 'media' },
      aiVerificationSummaryJson: {},
      lines: [],
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
    assert.match(result.replyTexts.join('\n'), /D-PURPOSE/u);
    assert.match(result.replyTexts.join('\n'), /I01-CATEGORY/u);
    const saved = h.updates[0].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation;
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
    assert.match(result.replyTexts.join('\n'), /ข้อมูลครบสำหรับส่งให้ผู้มีสิทธิ์ตรวจสอบ/u);
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
    assert.ok(missing.includes('quantity'));
  });

  it('keeps pause and end-input distinct and never requests a final financial mutation', async () => {
    const paused = await harness().useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'พัก' });
    const ended = await harness().useCase.execute(ctx, { chatKeyHash: 'chat', messageText: 'หมด' });
    assert.equal(paused.status, 'PAUSED');
    assert.equal(ended.status, 'ENDED');
    assert.match(ended.replyTexts.join('\n'), /ยังไม่ลงบัญชี/u);
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

  it('parks one open draft for an unrelated request and returns a resume capsule', async () => {
    const { useCase, updates } = harness();
    const capsule = await useCase.interruptOpen(ctx, 'chat');
    assert.match(capsule!, /พิมพ์ “ต่อ”/u);
    assert.equal(updates[0].options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.status, 'PAUSED_INTERRUPTED');
  });

  it('parks every open draft before handing an unrelated request back to normal chat', async () => {
    const { useCase, updates } = harness(2);
    const capsule = await useCase.interruptOpen(ctx, 'chat');
    assert.match(capsule!, /2 รายการ/u);
    assert.equal(updates.length, 2);
    assert.ok(updates.every((update) =>
      update.options.lineDraftCollection.sourceChannelMetadataJson.lineExpenseDraftContinuation.status === 'PAUSED_INTERRUPTED'));
  });
});
