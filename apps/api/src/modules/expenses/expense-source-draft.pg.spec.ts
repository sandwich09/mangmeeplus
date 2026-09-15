import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AuditService } from '../audit/application/audit.service';
import { PrismaAuditRepository } from '../audit/infrastructure/prisma-audit.repository';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import { UpdateExpenseDraftUseCase, GetExpenseUseCase, MarkExpenseReadyUseCase } from './application/use-cases/expense-draft.use-case';
import { LineExpenseDraftConversationUseCase } from './application/use-cases/line-expense-draft-conversation.use-case';
import { buildInitialLineExpenseDraftContinuation, collectLineExpenseDraftQuestions } from './domain/logic/line-expense-draft-conversation.logic';
import { bindSourceDraftLines, sourceDraftState } from './domain/logic/expense-source-draft.logic';

const databaseUrl = process.env.RECEIPT_SOURCE_DRAFT_TEST_DATABASE_URL;
describe('receipt source draft continuity on PostgreSQL (T11–T18)', { skip: !databaseUrl }, () => {
  const tag = `source-draft-${randomUUID().slice(0, 8)}`;
  const companyId = `${tag}-company`, userId = `${tag}-user`, branchId = `${tag}-branch`, categoryId = `${tag}-category`;
  let client: PrismaClient, repo: PrismaExpenseRepository, update: UpdateExpenseDraftUseCase, conversation: LineExpenseDraftConversationUseCase;
  const ctx = (permissions = ['expense.receipt.upload'], authProvider = 'watchdog') => ({
    companyId, userId, membershipId: `${tag}-member`, authSubject: userId, requestId: randomUUID(), roles: [], permissions, scopes: {}, authProvider,
  } as any);
  const lineCtx = () => ctx(['expense.receipt.line_upload'], 'line');
  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
    assert.ok(['/watchdog_bms', '/substitute_receipt_only_review'].includes(url.pathname)
      || url.port === '15432' && url.pathname === '/mangmee_billing_20260912');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await client.user.create({ data: { id: userId, displayName: 'Source draft test', status: 'ACTIVE' } });
    await client.company.create({ data: { id: companyId, name: tag, businessCategory: 'SERVICE' } });
    await client.branch.create({ data: { id: branchId, companyId, code: 'HO', name: 'HO', type: 'HEAD_OFFICE', createdByUserId: userId } });
    await client.companyMembership.create({ data: { id: `${tag}-member`, companyId, userId, status: 'ACTIVE', branchScopeMode: 'ALL_BRANCHES' } });
    await client.expenseCategory.create({ data: { id: categoryId, companyId, name: 'วัสดุสำนักงาน', accountHintKey: 'office' } });
    repo = new PrismaExpenseRepository({ client } as any);
    const audit = new AuditService(new PrismaAuditRepository({ client } as any), { error: () => undefined } as any);
    update = new UpdateExpenseDraftUseCase(repo, audit, { resolveLines: async (_ctx: unknown, _header: unknown, lines: any[]) => lines } as any);
    conversation = new LineExpenseDraftConversationUseCase(repo, update);
  });
  after(async () => {
    if (!client) return;
    try {
      await client.auditLog.deleteMany({ where: { companyId } });
      await client.outboxEvent.deleteMany({ where: { companyId } });
      await client.expenseLine.deleteMany({ where: { companyId } });
      await client.expenseRecord.deleteMany({ where: { companyId } });
      await client.expenseCategory.deleteMany({ where: { companyId } });
      await client.companyMembership.deleteMany({ where: { companyId } });
      await client.branch.deleteMany({ where: { companyId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.user.deleteMany({ where: { id: userId } });
    } finally { await client.$disconnect(); }
  });
  async function draft(count = 1, charge = false) {
    const row = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId,
      status: 'DRAFT', captureSource: 'LINE_UPLOAD', expenseDate: new Date('2026-09-01'), vendorNameSnapshot: 'ร้านเดิม',
      sourceDocumentType: 'TAX_INVOICE', taxEvidenceStatus: 'NEEDS_REVIEW', currency: 'THB', vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE', note: 'LINE receipt upload', reviewedByUserId: userId, reviewedAt: new Date('2026-09-01'),
      subtotalAmount: String(count * 100), discountAmount: '10', taxableAmount: String(count * 100 - 10 + (charge ? 5 : 0)),
      grandTotalAmount: String(count * 100 - 10 + (charge ? 5 : 0)), netPayableAmount: String(count * 100 - 10 + (charge ? 5 : 0)),
      outstandingAmount: String(count * 100 - 10 + (charge ? 5 : 0)),
    } });
    for (let index = 0; index < count; index++) await client.expenseLine.create({ data: {
      expenseId: row.id, companyId, lineNumber: index + 1, description: `สินค้า${index + 1}`, quantity: '1', unitPrice: '100',
      discountAmount: index === 0 ? '10' : '0', taxableAmount: index === 0 ? '90' : '100', vatRate: '0', vatTreatment: 'NON_VAT',
      lineSubtotalAmount: '100', lineTotalAmount: index === 0 ? '90' : '100', expenseCategoryId: categoryId,
      accountHintKey: 'reviewer.chosen', sourceLineText: `สินค้า${index + 1} 1 100`, aiLineConfidence: 0.91, reviewStatus: 'REVIEWED',
    } });
    if (charge) await client.expenseLine.create({ data: { expenseId: row.id, companyId, lineNumber: count + 1,
      description: 'ค่าบริการ', chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '5', taxableAmount: '5',
      lineSubtotalAmount: '5', lineTotalAmount: '5', vatRate: '0', vatTreatment: 'NON_VAT', reviewStatus: 'REVIEWED',
      externalTaxCodeSnapshot: 'N0', taxProfileKeySnapshot: 'REVIEWED', taxProfileVersionSnapshot: 2,
      taxRegimeSnapshot: 'VAT', taxDirectionSnapshot: 'INPUT', taxTreatmentSnapshot: 'NON_TAXABLE', taxContextSnapshot: 'DOMESTIC_PURCHASE',
      taxRateSnapshot: '0', sourceCurrencySnapshot: 'THB', taxCurrencySnapshot: 'THB', exchangeRateSnapshot: '1',
      exchangeRateSourceSnapshot: 'FUNCTIONAL_CURRENCY', exchangeRateDateSnapshot: new Date('2026-09-01'),
      taxBaseAmount: '5', transactionTaxAmount: '0', claimabilitySnapshot: 'NOT_APPLICABLE', taxEvidenceReviewStatus: 'VERIFIED',
      roundingModeSnapshot: 'HALF_UP', roundingScaleSnapshot: 2, taxAmountToleranceSnapshot: '0.01',
      accountRuleVersionSnapshot: 2, reportRuleVersionSnapshot: 3, taxComponentsJson: [], accountAssignmentsJson: [],
    } });
    const expense = (await repo.findByIdWithRelations(companyId, row.id))!;
    const categories = await repo.listCategories(companyId);
    const hints = expense.lines.filter((line) => !line.chargeKind).map((line) => ({ sourceText: `${line.description} 1 100`, description: line.description, quantity: '1', unitPrice: '100' }));
    let state = buildInitialLineExpenseDraftContinuation({ workflowId: randomUUID(), companyId, userId, expenseId: row.id,
      chatKeyHash: 'chat', targetRevision: row.updatedAt.toISOString(), provisionalExpenseDate: '2026-09-01',
      messageText: `2026-09-01 ร้านเดิม ${hints.map((item) => item.sourceText).join(' ')}`, hints: { confidence: 1, expenseDate: '2026-09-01', vendorName: 'ร้านเดิม', items: hints }, categories });
    state = bindSourceDraftLines(state, expense);
    state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, categories);
    await client.expenseRecord.update({ where: { id: row.id }, data: { sourceChannelMetadataJson: { channel: 'LINE', secretChatMetadata: 'never-to-web', lineExpenseDraftContinuation: state } as any, updatedAt: row.updatedAt } });
    return row.id;
  }
  const stored = (expenseId: string) => client.expenseRecord.findUniqueOrThrow({ where: { id: expenseId }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
  const durableLines = (row: Awaited<ReturnType<typeof stored>>) => row.lines.map(({ updatedAt: _updated, ...line }) => JSON.parse(JSON.stringify(line)));

  it('keeps the full reviewed purpose and provenance through a source-only web save and reload', async () => {
    const id = await draft(), before = await stored(id);
    const purpose = 'ก'.repeat(500);
    await update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { businessPurpose: purpose } });
    const saved = await stored(id);
    assert.equal(saved.note, `LINE receipt upload · วัตถุประสงค์: ${purpose}`);
    assert.equal(sourceDraftState(saved as any, await repo.listCategories(companyId))?.header.businessPurpose, purpose);
  });

  it('resolves explicit dates through source, reviewer, combined and voluntary LINE saves without trusting omitted dates', async () => {
    for (const mode of ['source', 'reviewer', 'combined', 'line'] as const) {
      const id = await draft(), before = await stored(id);
      const oldReason = 'วันที่บนเอกสารยังอ่านไม่ได้ – ใช้วันที่ส่งไว้ก่อน';
      const unrelatedReason = 'ตรวจฐานหัก ณ ที่จ่ายกับค่าบริการ';
      const raw = { expenseDate: 'OCR raw evidence', vendorName: 'ร้านเดิม' };
      await client.expenseRecord.update({ where: { id }, data: { updatedAt: before.updatedAt,
        aiVerificationSummaryJson: { dateStatus: 'unverified', missingFields: ['expenseDate'], reviewReasons: [oldReason, unrelatedReason], recognizedFields: raw } } });
      const omitted = await update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { businessPurpose: 'ใช้สำนักงาน' } });
      assert.equal(((await stored(id)).aiVerificationSummaryJson as { dateStatus?: string } | null)?.dateStatus, 'unverified');
      const chosen = mode === 'line' ? '2026-09-02' : '2026-09-01'; // explicitly confirming the old placeholder is valid
      if (mode === 'line') {
        const answered = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: `D-DATE ${chosen}`, captureHints: { targetExpenseId: id } });
        assert.ok(answered.acceptedFields.includes('D-DATE'));
      } else {
        await update.execute(ctx(mode === 'source' ? ['expense.receipt.upload'] : ['expense.review']), id, {
          expectedUpdatedAt: omitted.updatedAt.toISOString(),
          ...(mode !== 'source' ? { expenseDate: chosen } : {}),
          ...(mode !== 'reviewer' ? { sourceDraft: { expenseDate: chosen } } : {}),
        });
      }
      const saved = await stored(id), summary = saved.aiVerificationSummaryJson as any;
      assert.equal(saved.expenseDate.toISOString().slice(0, 10), chosen);
      assert.equal(summary.dateStatus, 'verified', mode);
      assert.equal(summary.dateResolution.resolvedByUserId, userId);
      assert.equal(summary.dateResolution.expenseDate, chosen);
      assert.deepEqual(summary.recognizedFields, raw);
      assert.deepEqual(summary.reviewReasons, [unrelatedReason]);
      assert.deepEqual(durableLines(saved), durableLines(before));
      await assert.rejects(() => update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { expenseDate: null } }));
      assert.equal(((await stored(id)).aiVerificationSummaryJson as { dateStatus?: string } | null)?.dateStatus, 'verified');
      const ready = await new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id);
      assert.equal(ready.status, 'READY_FOR_CONFIRMATION');
    }
  });

  it('blocks unreadable dates at final mutations and can clear then explicitly re-confirm a staged date', async () => {
    const id = await draft(), before = await stored(id);
    await client.expenseRecord.update({ where: { id }, data: { updatedAt: before.updatedAt,
      aiVerificationSummaryJson: { dateStatus: 'implausible', missingFields: [], reviewReasons: ['วันที่ผิดปกติ'] } } });
    const isDateError = (error: any) => error?.getResponse?.()?.code === 'EXPENSE_DOCUMENT_DATE_REVIEW_REQUIRED';
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id), isDateError);
    await assert.rejects(() => repo.updateExpense({ id, companyId, updatedByUserId: userId, status: 'READY_FOR_CONFIRMATION' }), isDateError);
    await client.expenseRecord.update({ where: { id }, data: { status: 'READY_FOR_CONFIRMATION', updatedAt: before.updatedAt } });
    await assert.rejects(() => repo.confirmExpenseCas({ companyId, id, expectedUpdatedAt: before.updatedAt, actorUserId: userId,
      expenseNumber: 'never-date', postingStatus: 'pending', vendorSnapshotJson: null, outboxEvent: { eventKey: 'never-date', payloadJson: {} } }), isDateError);
    await assert.rejects(() => repo.finalizeAndConfirmExpenseCas({ companyId, id, expectedUpdatedAt: before.updatedAt, actorUserId: userId } as any,
      async () => { throw new Error('Date guard must run before final tax mutation'); }), isDateError);
    await client.expenseRecord.update({ where: { id }, data: { status: 'DRAFT', updatedAt: before.updatedAt } });
    const reviewed = await update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { expenseDate: '2026-09-01' } });
    assert.equal(((await stored(id)).aiVerificationSummaryJson as { dateStatus?: string } | null)?.dateStatus, 'verified');
    const cleared = await update.execute(ctx(), id, { expectedUpdatedAt: reviewed.updatedAt.toISOString(), sourceDraft: { expenseDate: null } });
    assert.equal(((await stored(id)).aiVerificationSummaryJson as { dateStatus?: string } | null)?.dateStatus, 'unverified');
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id));
    await assert.rejects(() => update.execute(ctx(), id, { expectedUpdatedAt: cleared.updatedAt.toISOString(), sourceDraft: { expenseDate: '2026-02-30' } }));
    assert.equal(((await stored(id)).aiVerificationSummaryJson as { dateStatus?: string } | null)?.dateStatus, 'unverified');
    await update.execute(ctx(), id, { expectedUpdatedAt: cleared.updatedAt.toISOString(), sourceDraft: { expenseDate: '2026-09-01' } });
    assert.equal((await new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id)).status, 'READY_FOR_CONFIRMATION');
  });

  it('keeps the discounted 90 total and every row byte on purpose, pause, resume and unrelated/no-field turns', async () => {
    const id = await draft();
    const before = await stored(id);
    for (const messageText of ['D-PURPOSE ใช้ในสำนักงาน', 'บันทึกไปก่อน', 'ต่อ']) {
      const result = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText, captureHints: { targetExpenseId: id } });
      assert.notEqual(result.status, 'STALE');
      const after = await stored(id);
      assert.equal(after.grandTotalAmount.toString(), '90');
      assert.deepEqual(durableLines(after), durableLines(before));
      assert.equal(after.reviewedAt?.toISOString(), before.reviewedAt?.toISOString());
    }
    const last = await stored(id);
    const unrelated = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: 'วันนี้ฝนตกไหม', captureHints: { targetExpenseId: id } });
    assert.equal(unrelated.handled, false);
    assert.deepEqual(await stored(id), last);
  });

  it('preserves all 21 and40 OCR rows across header answers and explicit older-draft lookup', async () => {
    const ids: string[] = [];
    for (const count of [21, 40]) {
      const id = await draft(count); ids.push(id);
      const result = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: 'D-PURPOSE ใช้ในสำนักงาน', captureHints: { targetExpenseId: id } });
      assert.equal(result.status, 'UPDATED');
      assert.equal((await stored(id)).lines.length, count);
    }
    for (let index = 0; index < 6; index++) await draft();
    const recent = await repo.listLineExpenseDraftContinuationRows({ companyId, userId, chatKeyHash: 'chat', scopes: {}, take: 5 });
    assert.ok(!recent.some((row) => row.id === ids[0]));
    const old = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: 'ต่อ', captureHints: { targetExpenseId: ids[0] } });
    assert.equal(old.expenseId, ids[0]); assert.equal(old.status, 'UPDATED');
  });

  it('preserves charges, line ids, tax snapshots, discount and reviewer choices on an accepted item edit', async () => {
    const id = await draft(1, true), before = await stored(id);
    await update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { items: [{ itemRef: 'I01', description: 'กระดาษสำนักงาน' }] } });
    const after = await stored(id);
    assert.equal(after.lines[0]!.id, before.lines[0]!.id);
    assert.equal(after.lines[0]!.description, 'กระดาษสำนักงาน');
    assert.equal(after.lines[0]!.discountAmount.toString(), '10');
    assert.equal(after.lines[0]!.accountHintKey, 'reviewer.chosen');
    assert.equal(after.grandTotalAmount.toString(), '95');
    assert.deepEqual(durableLines(after)[1], durableLines(before)[1]);
    assert.equal(after.reviewedAt?.toISOString(), before.reviewedAt?.toISOString());
  });

  it('changes only accepted money and preserves existing ids when inserting a product ahead of charges', async () => {
    const id = await draft(1, true), before = await stored(id);
    await update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { items: [{ itemRef: 'I01', unitPrice: '110' }] } });
    const priced = await stored(id);
    assert.equal(priced.grandTotalAmount.toString(), '105');
    assert.equal(priced.lines[0]!.discountAmount.toString(), '10');
    assert.deepEqual(durableLines(priced)[1], durableLines(before)[1]);
    await update.execute(ctx(), id, { expectedUpdatedAt: priced.updatedAt.toISOString(), sourceDraft: { items: [{ description: 'รายการเพิ่ม', quantity: '1', unitPrice: '25', expenseCategoryId: categoryId }] } });
    const appended = await stored(id);
    assert.equal(appended.grandTotalAmount.toString(), '130');
    assert.equal(appended.lines[0]!.id, before.lines[0]!.id);
    assert.equal(appended.lines[2]!.id, before.lines[1]!.id);
    assert.equal(appended.lines[2]!.chargeKind, 'SERVICE_CHARGE');
    assert.equal(appended.lines[2]!.externalTaxCodeSnapshot, 'N0');
  });

  it('round-trips unknown partial fields on NEEDS_REVIEW without conversation enabled, and blocks all finalization seams', async () => {
    const row = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW',
      captureSource: 'LINE_UPLOAD', expenseDate: new Date('2026-09-07'), note: 'LINE receipt upload',
      aiVerificationSummaryJson: { recognizedFields: { vendorName: 'ร้าน ABC', lines: [{ description: 'กระดาษ', evidenceSignal: 'กระดาษ' }] }, missingFields: ['expenseDate', 'quantity', 'price'] } } });
    await update.execute(ctx(), row.id, { expectedUpdatedAt: row.updatedAt.toISOString(), sourceDraft: { vendorName: 'ร้านใหม่', items: [{ itemRef: 'I01', quantity: null, unitPrice: '0', expenseCategoryId: categoryId }] } });
    const get = new GetExpenseUseCase(repo), loaded = await get.execute(ctx(), row.id), projection = (await get.sourceDraft(ctx(), loaded))!;
    assert.equal(projection.canEdit, true); assert.equal(projection.header.expenseDate, null);
    assert.equal(projection.items[0]!.quantity, null); assert.equal(projection.items[0]!.unitPrice, '0');
    assert.equal(loaded.lines.length, 0); assert.equal(loaded.primaryAttachmentId, row.primaryAttachmentId);
    assert.equal(projection.status, 'PAUSED'); assert.ok(!JSON.stringify(projection).includes('chatKeyHash'));
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), row.id), /Complete the saved source draft/);
    await assert.rejects(() => repo.updateExpense({ id: row.id, companyId, updatedByUserId: userId, status: 'READY_FOR_CONFIRMATION' }), /Complete the saved source draft/);
    await client.expenseRecord.update({ where: { id: row.id }, data: { status: 'READY_FOR_CONFIRMATION' } });
    const ready = await stored(row.id);
    await assert.rejects(() => repo.confirmExpenseCas({ companyId, id: row.id, expectedUpdatedAt: ready.updatedAt, actorUserId: userId, expenseNumber: 'never', postingStatus: 'pending', vendorSnapshotJson: null, outboxEvent: { eventKey: 'never', payloadJson: {} } }), /Complete the saved source draft/);
    await assert.rejects(() => repo.finalizeAndConfirmExpenseCas({ companyId, id: row.id, expectedUpdatedAt: ready.updatedAt, actorUserId: userId } as any, async () => { throw new Error('Final tax mutation must not run for incomplete source'); }), /Complete the saved source draft/);
  });

  it('atomically saves the Drtb financial form while keeping unknown source facts staged', async () => {
    const id = await draft(), before = await stored(id), product = before.lines[0]!;
    const metadata = structuredClone(before.sourceChannelMetadataJson) as Record<string, any>;
    const state = metadata.lineExpenseDraftContinuation;
    state.header = { vendorName: 'PANDA MALA', businessPurpose: 'ประชุมลูกค้า' };
    state.items[0] = { ...state.items[0], description: 'AMERICANO', totalAmount: '55', reviewRequired: true };
    delete state.items[0].quantity; delete state.items[0].unitPrice; delete state.items[0].expenseCategoryId; delete state.items[0].materializedFacts;
    state.materializedHeader = { expenseDate: '2026-09-01', vendorName: 'PANDA MALA', businessPurpose: 'ประชุมลูกค้า' };
    state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, await repo.listCategories(companyId));
    await client.$transaction(async (tx) => {
      await tx.expenseLine.update({ where: { id: product.id }, data: { description: 'AMERICANO', quantity: '1', unitPrice: '55',
        discountAmount: '0', taxableAmount: '51.40', vatRate: '0.07', vatTreatment: null, vatAmount: '3.60', lineSubtotalAmount: '55', lineTotalAmount: '55' } });
      await tx.expenseRecord.update({ where: { id }, data: { vendorNameSnapshot: 'PANDA MALA', note: 'LINE receipt upload · วัตถุประสงค์: ประชุมลูกค้า',
        vatMode: 'VAT_INCLUDED', subtotalAmount: '55', discountAmount: '0', taxableAmount: '51.40', vatAmount: '3.60',
        grandTotalAmount: '55', netPayableAmount: '55', outstandingAmount: '55', sourceChannelMetadataJson: metadata, updatedAt: before.updatedAt } });
    });
    const current = await stored(id);
    const line = { id: product.id, sourceItemRef: 'I01', lineNumber: 1, description: 'AMERICANO', chargeKind: null,
      quantity: '1', unitPrice: '55', discountAmount: '0', vatRate: '0.07', expenseCategoryId: categoryId } as const;
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: current.updatedAt.toISOString(), expenseDate: '2026-09-01', sourceDraft: { expenseDate: null }, lines: [line],
    }), /Source and financial header facts disagree/);
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: current.updatedAt.toISOString(), sourceDraft: { items: [{ itemRef: 'I01', quantity: '2' }] }, lines: [line],
    }), /Source facts and reviewed financial row disagree/);
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: current.updatedAt.toISOString(), sourceDraft: { items: [{ itemRef: 'I01', quantity: null }] },
      lines: [{ ...line, quantity: 'invalid' }],
    }), (error: any) => error?.getStatus?.() === 400);
    assert.equal((await stored(id)).updatedAt.toISOString(), current.updatedAt.toISOString());

    await update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: current.updatedAt.toISOString(), vendorNameSnapshot: 'PANDA MALA',
      note: 'LINE receipt upload · วัตถุประสงค์: ประชุมลูกค้า', vatMode: 'VAT_INCLUDED',
      sourceDraft: { expenseDate: null, vendorName: 'PANDA MALA', businessPurpose: 'ประชุมลูกค้า',
        items: [{ itemRef: 'I01', description: 'AMERICANO', quantity: null, unitPrice: null, expenseCategoryId: null }] },
      lines: [line],
    });
    const saved = await stored(id);
    assert.equal(saved.expenseDate.toISOString().slice(0, 10), '2026-09-01');
    assert.equal(saved.lines[0]!.id, product.id); assert.equal(saved.lines[0]!.expenseCategoryId, categoryId);
    assert.equal(saved.lines[0]!.unitPrice.toString(), '55'); assert.equal(saved.lines[0]!.vatAmount.toString(), '3.6');
    assert.equal(saved.grandTotalAmount.toString(), '55');
    const get = new GetExpenseUseCase(repo), projection = (await get.sourceDraft(ctx(['expense.review']), await get.execute(ctx(['expense.review']), id)))!;
    assert.equal(projection.header.expenseDate, null); assert.equal(projection.items[0]!.quantity, null);
    assert.equal(projection.items[0]!.unitPrice, null); assert.equal(projection.items[0]!.totalAmount, '55');
    assert.equal(projection.items[0]!.expenseCategoryId, categoryId);
    assert.ok(!projection.missingFields.some((field) => field.field === 'expenseCategoryId'));
    assert.ok(projection.missingFields.some((field) => field.field === 'expenseDate'));
    assert.ok(projection.missingFields.some((field) => field.field === 'quantity'));
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id), /Complete the saved source draft/);

    const durable = durableLines(saved), source = structuredClone(saved.sourceChannelMetadataJson);
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: current.updatedAt.toISOString(), vendorNameSnapshot: 'STALE',
      sourceDraft: { vendorName: 'STALE', items: [{ itemRef: 'I01', quantity: '2', unitPrice: '30' }] },
      lines: [{ ...line, quantity: '2', unitPrice: '30' }],
    }), /changed by another user/);
    const afterStale = await stored(id);
    assert.equal(afterStale.vendorNameSnapshot, 'PANDA MALA'); assert.deepEqual(durableLines(afterStale), durable);
    assert.deepEqual(afterStale.sourceChannelMetadataJson, source);

    await update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: saved.updatedAt.toISOString(), expenseDate: '2026-09-01', vendorNameSnapshot: 'PANDA MALA',
      note: 'LINE receipt upload · วัตถุประสงค์: ประชุมลูกค้า', vatMode: 'VAT_INCLUDED',
      sourceDraft: { expenseDate: '2026-09-01', vendorName: 'PANDA MALA', businessPurpose: 'ประชุมลูกค้า',
        items: [{ itemRef: 'I01', description: 'AMERICANO', quantity: '1', unitPrice: '55', expenseCategoryId: categoryId }] },
      lines: [line],
    });
    const completed = await stored(id);
    const completedSource = (await get.sourceDraft(ctx(['expense.review']), await get.execute(ctx(['expense.review']), id)))!;
    assert.equal(completedSource.items[0]!.quantity, '1'); assert.equal(completedSource.items[0]!.unitPrice, '55');
    assert.deepEqual(completedSource.missingFields, []);
    assert.equal((await new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id)).status, 'READY_FOR_CONFIRMATION');
    assert.equal(completed.lines[0]!.id, product.id);
  });

  it('full review replaces an unaccepted OCR breakdown without hidden blockers; partial save retains its evidence', async () => {
    const id = await draft();
    const first = await stored(id);
    const metadata = first.sourceChannelMetadataJson as Record<string, any>;
    const state = structuredClone(metadata.lineExpenseDraftContinuation);
    state.items = Array.from({ length: 6 }, (_, i) => ({ itemRef: `I0${i + 1}`, sourceText: `รายละเอียด ${i}`, description: `รายละเอียด ${i}`, reviewRequired: true }));
    state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, await repo.listCategories(companyId));
    const evidence = { recognizedFields: { description: 'original OCR evidence', lines: state.items.map((item: any) => ({ description: item.description })) }, dateStatus: 'verified' };
    await client.expenseRecord.update({ where: { id }, data: { sourceChannelMetadataJson: { ...metadata, lineExpenseDraftContinuation: state }, aiVerificationSummaryJson: evidence } });
    let current = await stored(id);
    await update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: current.updatedAt.toISOString(), sourceDraft: { businessPurpose: 'ใช้สำนักงาน' } });
    current = await stored(id);
    assert.equal((current.sourceChannelMetadataJson as any).lineExpenseDraftContinuation.items.length, 6);
    const product = current.lines[0]!;
    await update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: current.updatedAt.toISOString(), expenseDate: '2026-09-01',
      vendorEntityKindSnapshot: 'JURISTIC', whtInput: { inputType: 'AMOUNT', value: '2.71', baseAmount: '270.50' },
      lines: [{ id: product.id, lineNumber: 1, description: product.description, quantity: '1', unitPrice: '100', discountAmount: '10', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId }] });
    const get = new GetExpenseUseCase(repo), loaded = await get.execute(ctx(['expense.review']), id);
    const projected = (await get.sourceDraft(ctx(['expense.review']), loaded))!;
    assert.equal(loaded.lines.length, 1);
    assert.equal(projected.items.length, 1);
    assert.deepEqual(projected.missingFields, []);
    assert.equal(Number(loaded.grandTotalAmount), 90);
    assert.equal(Number(loaded.whtAmount), 2.71);
    assert.equal(Number(loaded.netPayableAmount), 87.29);
    assert.equal(loaded.whtInputJson?.baseAmount, '270.50');
    assert.deepEqual(loaded.aiVerificationSummaryJson?.recognizedFields, evidence.recognizedFields);
    const saved = await stored(id);
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: saved.updatedAt.toISOString(), whtInput: { inputType: 'RATE', value: '100', baseAmount: '270.50' },
      lines: [{ id: product.id, lineNumber: 1, description: product.description, quantity: '1', unitPrice: '100', discountAmount: '10', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId }] }));
    assert.equal((await stored(id)).updatedAt.toISOString(), saved.updatedAt.toISOString(), 'invalid money fails atomically');
  });

  it('one review save binds same-named staged rows by scoped references without losing charges or purpose', async () => {
    const id = await draft(1, true);
    const before = await stored(id);
    const metadata = before.sourceChannelMetadataJson as Record<string, any>;
    const state = structuredClone(metadata.lineExpenseDraftContinuation) as any;
    state.items.push({ itemRef: 'I02', sourceText: 'สินค้า1 1 15', description: 'สินค้า1', quantity: '1', unitPrice: '15', expenseCategoryId: categoryId });
    state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, await repo.listCategories(companyId));
    await client.expenseRecord.update({ where: { id }, data: { sourceChannelMetadataJson: { ...metadata, lineExpenseDraftContinuation: state } } });
    const current = await stored(id);
    const charge = current.lines.find((line) => line.chargeKind)!;
    const product = current.lines.find((line) => !line.chargeKind)!;
    await update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: current.updatedAt.toISOString(), note: 'LINE receipt upload · วัตถุประสงค์: ใช้สำนักงาน',
      lines: [
        { id: product.id, sourceItemRef: state.items[0].itemRef, lineNumber: 1, description: product.description, quantity: '1', unitPrice: '100', discountAmount: '10', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId },
        { sourceItemRef: 'I02', lineNumber: 2, description: product.description, quantity: '1', unitPrice: '15', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId },
        { id: charge.id, lineNumber: 3, description: charge.description, chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '5', vatRate: '0', vatTreatment: 'NON_VAT' },
      ],
    });
    const saved = await stored(id);
    assert.equal(saved.lines.length, 3);
    assert.equal(saved.lines[0]!.id, product.id);
    assert.equal(saved.lines[2]!.id, charge.id);
    assert.equal(String(saved.grandTotalAmount), '110');
    const get = new GetExpenseUseCase(repo);
    const projected = (await get.sourceDraft(ctx(['expense.review']), await get.execute(ctx(['expense.review']), id)))!;
    assert.equal(projected.items.length, 2);
    assert.equal(new Set(projected.items.map((item) => item.lineId)).size, 2);
    assert.equal(projected.header.businessPurpose, 'ใช้สำนักงาน');
    assert.deepEqual(projected.missingFields, []);
    const body = { expectedUpdatedAt: saved.updatedAt.toISOString(), lines: [{ id: product.id, sourceItemRef: 'other-source', lineNumber: 1, description: 'ไม่แก้', quantity: '1', unitPrice: '999' }] };
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, body), /staged receipt row/);
    await assert.rejects(() => update.execute(ctx(['expense.update']), id, { ...body, lines: [{ ...body.lines[0]!, sourceItemRef: state.items[0].itemRef }] }), /Only a reviewer/);
    assert.equal(String((await stored(id)).grandTotalAmount), String(saved.grandTotalAmount));
    await update.execute(ctx(['expense.review']), id, {
      expectedUpdatedAt: saved.updatedAt.toISOString(), removedSourceItemRefs: ['I02'],
      lines: [
        { id: product.id, sourceItemRef: state.items[0].itemRef, lineNumber: 1, description: product.description, quantity: '1', unitPrice: '100', discountAmount: '10', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId },
        { id: charge.id, lineNumber: 2, description: charge.description, chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '5', vatRate: '0', vatTreatment: 'NON_VAT' },
      ],
    });
    const afterRemoval = await get.execute(ctx(['expense.review']), id);
    const remaining = (await get.sourceDraft(ctx(['expense.review']), afterRemoval))!;
    assert.equal(remaining.items.length, 1);
    assert.equal(afterRemoval.lines.length, 2);
    assert.equal(Number(afterRemoval.grandTotalAmount), 95);
    assert.ok(!remaining.items.some((item) => item.itemRef === 'I02'));

  });

  it('blocks real OCR gaps, retires legacy purpose requirements and confirms with blank optional purpose', async () => {
    const row = await client.expenseRecord.create({ data: { companyId, branchId, createdByUserId: userId, status: 'NEEDS_REVIEW',
      captureSource: 'LINE_UPLOAD', expenseDate: new Date('2026-09-07'), note: 'LINE receipt upload',
      aiVerificationSummaryJson: { recognizedFields: { vendorName: 'ร้าน ABC', lines: [{ description: 'กระดาษ' }] }, missingFields: ['expenseDate', 'quantity', 'price'] } } });
    const get = new GetExpenseUseCase(repo);
    const loaded = await get.execute(ctx(), row.id);
    const untouched = (await get.sourceDraft(ctx(), loaded))!;
    assert.ok(untouched.missingFields.some((field) => field.field === 'quantity'));
    assert.equal((await stored(row.id)).sourceChannelMetadataJson, null);
    const legacy = sourceDraftState(loaded, await repo.listCategories(companyId))!;
    legacy.status = 'INPUT_ENDED_INCOMPLETE';
    legacy.unresolvedQuestions.push({ id: 'D-PURPOSE', scope: 'DOCUMENT', field: 'businessPurpose', prompt: 'legacy required purpose' });
    await client.expenseRecord.update({ where: { id: row.id }, data: {
      sourceChannelMetadataJson: { lineExpenseDraftContinuation: legacy },
      aiVerificationSummaryJson: { ...(loaded.aiVerificationSummaryJson ?? {}), missingFields: ['expenseDate', 'quantity', 'price', 'businessPurpose'],
        lineDraftQuestionIds: legacy.unresolvedQuestions.map((question) => question.id), collectionState: legacy.status },
      updatedAt: row.updatedAt,
    } });
    const legacyLoaded = await get.execute(ctx(), row.id);
    const legacyProjection = (await get.sourceDraft(ctx(), legacyLoaded))!;
    assert.ok(!legacyProjection.missingFields.some((field) => field.field === 'businessPurpose'));
    assert.ok(!(legacyLoaded.aiVerificationSummaryJson?.['missingFields'] as string[]).includes('businessPurpose'));
    assert.ok(!(legacyLoaded.aiVerificationSummaryJson?.['lineDraftQuestionIds'] as string[]).includes('D-PURPOSE'));
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), row.id), /Complete the saved source draft/);
    await assert.rejects(() => repo.updateExpense({ id: row.id, companyId, updatedByUserId: userId, status: 'READY_FOR_CONFIRMATION' }), /Complete the saved source draft/);
    await client.expenseRecord.update({ where: { id: row.id }, data: { status: 'READY_FOR_CONFIRMATION' } });
    const ready = await stored(row.id);
    const readonly = (await get.sourceDraft(ctx(['expense.review']), await get.execute(ctx(['expense.review']), row.id)))!;
    assert.equal(readonly.canEdit, false);
    assert.ok(readonly.missingFields.some((field) => field.field === 'quantity'));
    assert.ok(!readonly.missingFields.some((field) => field.field === 'businessPurpose'));
    await assert.rejects(() => repo.confirmExpenseCas({ companyId, id: row.id, expectedUpdatedAt: ready.updatedAt, actorUserId: userId, expenseNumber: 'never', postingStatus: 'pending', vendorSnapshotJson: null, outboxEvent: { eventKey: 'never', payloadJson: {} } }), /Complete the saved source draft/);
    await assert.rejects(() => repo.finalizeAndConfirmExpenseCas({ companyId, id: row.id, expectedUpdatedAt: ready.updatedAt, actorUserId: userId } as any, async () => { throw new Error('Final tax mutation must not run for incomplete source'); }), /Complete the saved source draft/);
    const reviewed = await update.execute(ctx(['expense.review']), row.id, { expectedUpdatedAt: ready.updatedAt.toISOString(), expenseDate: '2026-09-07', vendorNameSnapshot: 'ร้าน ABC',
      sourceDraft: { expenseDate: '2026-09-07', vendorName: 'ร้าน ABC', items: [{ itemRef: 'I01', description: 'กระดาษ', quantity: '2', unitPrice: '50', expenseCategoryId: categoryId }] },
      lines: [{ sourceItemRef: 'I01', lineNumber: 1, description: 'กระดาษ', quantity: '2', unitPrice: '50', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId }] });
    assert.equal(reviewed.status, 'READY_FOR_CONFIRMATION');
    const completedLoaded = await get.execute(ctx(), row.id);
    const completed = (await get.sourceDraft(ctx(), completedLoaded))!;
    assert.equal(completed.canEdit, false); assert.equal(completed.items[0]!.quantity, '2');
    assert.equal(completed.header.businessPurpose, null);
    assert.deepEqual(completed.missingFields, []);
    const readyForConfirm = await stored(row.id);
    const savedState = (readyForConfirm.sourceChannelMetadataJson as any).lineExpenseDraftContinuation;
    assert.ok(!savedState.unresolvedQuestions.some((question: any) => question.id === 'D-PURPOSE'));
    assert.ok(!((readyForConfirm.aiVerificationSummaryJson as any)?.missingFields as string[]).includes('businessPurpose'));
    const confirmed = await repo.confirmExpenseCas({ companyId, id: row.id, expectedUpdatedAt: readyForConfirm.updatedAt,
      actorUserId: userId, expenseNumber: `${tag}-optional-purpose`, postingStatus: 'pending', vendorSnapshotJson: null,
      outboxEvent: { eventKey: `${tag}:optional-purpose`, payloadJson: {} } });
    assert.equal(confirmed.status, 'CONFIRMED');
  });

  it('reconciles explicit reviewer deletion by row id while preserving charges and unresolved unmaterialized source items', async () => {
    const id = await draft(2, true), before = await stored(id);
    await update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: { businessPurpose: 'ใช้สำนักงาน', items: [{ description: 'รอข้อมูลเพิ่ม' }] } });
    const partial = await stored(id);
    await assert.rejects(() => update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: partial.updatedAt.toISOString(), lines: [{ id: 'foreign-line', lineNumber: 1, description: 'สินค้า2', quantity: '1', unitPrice: '100' }] }), /identity is outside/);
    await update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: partial.updatedAt.toISOString(), lines: [
      { id: before.lines[1]!.id, lineNumber: 1, description: 'สินค้า2', quantity: '1', unitPrice: '100', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId },
      { id: before.lines[2]!.id, lineNumber: 2, description: 'ค่าบริการ', chargeKind: 'SERVICE_CHARGE', quantity: '1', unitPrice: '5', vatRate: '0', vatTreatment: 'NON_VAT' },
    ] });
    const after = await stored(id), state = (after.sourceChannelMetadataJson as any).lineExpenseDraftContinuation;
    assert.deepEqual(after.lines.map((line) => line.id), [before.lines[1]!.id, before.lines[2]!.id]);
    assert.equal(after.lines[1]!.chargeKind, 'SERVICE_CHARGE');
    assert.equal(state.items.some((item: any) => item.lineId === before.lines[0]!.id), false);
    assert.equal(state.items.some((item: any) => item.description === 'รอข้อมูลเพิ่ม' && !item.lineId), true);
    assert.equal(state.items.some((item: any) => item.lineId === before.lines[1]!.id), true);
    await assert.rejects(() => new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id), /Complete the saved source draft/);
  });

  it('materializes earlier staged source edits when the final missing quantity arrives', async () => {
    const id = await draft(), before = await stored(id);
    await client.expenseRecord.update({ where: { id }, data: { aiVerificationSummaryJson: { missingFields: ['amount', 'grandTotalAmount', 'quantity', 'price'] }, updatedAt: before.updatedAt } });
    await update.execute(ctx(), id, { expectedUpdatedAt: before.updatedAt.toISOString(), sourceDraft: {
      items: [{ itemRef: 'I01', description: 'ชื่อแก้ไว้ก่อน', quantity: null, unitPrice: '50' }],
    } });
    const partial = await stored(id);
    assert.equal(partial.lines[0]!.description, 'สินค้า1');
    await update.execute(ctx(), id, { expectedUpdatedAt: partial.updatedAt.toISOString(), sourceDraft: { items: [{ itemRef: 'I01', quantity: '2' }] } });
    const complete = await stored(id);
    assert.equal(complete.lines[0]!.description, 'ชื่อแก้ไว้ก่อน');
    assert.equal(complete.lines[0]!.quantity.toString(), '2');
    assert.equal(complete.lines[0]!.unitPrice.toString(), '50');
    assert.equal(complete.lines[0]!.discountAmount.toString(), '10');
    assert.equal(complete.grandTotalAmount.toString(), '90');
    const missing = (complete.aiVerificationSummaryJson as any).missingFields;
    for (const field of ['amount', 'grandTotalAmount', 'quantity', 'price']) assert.ok(!missing.includes(field), field);
  });

  it('allows an explicit financial review to resolve an unproven summary mapping without erasing staged facts', async () => {
    const id = await draft();
    const before = await stored(id);
    const metadata = before.sourceChannelMetadataJson as any;
    const state = metadata.lineExpenseDraftContinuation;
    delete state.items[0].lineId; delete state.items[0].materializedFacts;
    state.items[0].quantity = '2'; state.items[0].unitPrice = '50'; state.items[0].reviewRequired = true;
    state.header.businessPurpose = 'ใช้สำนักงาน';
    state.unresolvedQuestions = collectLineExpenseDraftQuestions(state, await repo.listCategories(companyId));
    await client.expenseRecord.update({ where: { id }, data: { sourceChannelMetadataJson: metadata, note: 'LINE receipt upload · วัตถุประสงค์: ใช้สำนักงาน', updatedAt: before.updatedAt } });
    await update.execute(ctx(['expense.review']), id, { expectedUpdatedAt: before.updatedAt.toISOString(), lines: [{ lineNumber: 1,
      description: 'สินค้า1', quantity: '2', unitPrice: '50', discountAmount: '10', vatRate: '0', vatTreatment: 'NON_VAT', expenseCategoryId: categoryId }] });
    const get = new GetExpenseUseCase(repo), current = await get.execute(ctx(), id), projection = (await get.sourceDraft(ctx(), current))!;
    assert.equal(projection.items[0]!.quantity, '2'); assert.equal(projection.items[0]!.unitPrice, '50');
    assert.equal(projection.items[0]!.lineId, before.lines[0]!.id);
    assert.equal(projection.missingFields.length, 0);
    assert.equal((await new MarkExpenseReadyUseCase(repo).execute(ctx(['expense.review']), id)).status, 'READY_FOR_CONFIRMATION');
  });

  it('fails a stale answer, then resumes current web facts and accepts the following answer', async () => {
    const id = await draft(), initial = await stored(id);
    await client.expenseRecord.update({ where: { id }, data: { vendorNameSnapshot: 'ร้านแก้จากเว็บ', updatedAt: new Date(initial.updatedAt.getTime() + 1000) } });
    const stale = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: 'D-PURPOSE ใช้สำนักงาน', captureHints: { targetExpenseId: id } });
    assert.equal(stale.status, 'STALE');
    assert.equal(stale.source, undefined, 'a refused update carries no committed success proof');
    const resume = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: 'ต่อ', captureHints: { targetExpenseId: id } });
    assert.equal(resume.status, 'UPDATED'); assert.match(resume.replyTexts.join('\n'), /ร้านแก้จากเว็บ/);
    const resumed = await stored(id);
    assert.deepEqual(resume.source?.records, [{ id, updatedAt: resumed.updatedAt }]);
    const answer = await conversation.execute(lineCtx(), { chatKeyHash: 'chat', messageText: 'D-PURPOSE ใช้สำนักงาน', captureHints: { targetExpenseId: id } });
    assert.equal(answer.status, 'UPDATED');
    const answered = await stored(id);
    assert.equal(answered.vendorNameSnapshot, 'ร้านแก้จากเว็บ');
    assert.deepEqual(answer.source?.records, [{ id, updatedAt: answered.updatedAt }]);
    assert.deepEqual(resume.source?.records, [{ id, updatedAt: resumed.updatedAt }], 'later saves never bless an earlier reply');
  });

  it('enforces source-only fields, active membership, scope, exact references and concurrent revision', async () => {
    const id = await draft(), row = await stored(id), version = row.updatedAt.toISOString();
    for (const sourceDraft of [{ items: [{ itemRef: 'I99', quantity: '1' }] }, { items: [{ itemRef: 'I01', quantity: 'NaN' }] }, { items: [{ itemRef: 'I01', quantity: '0' }] }, { items: [{ itemRef: 'I01', expenseCategoryId: 'cross-company' }] }, { expenseDate: '2026-02-30' }]) {
      await assert.rejects(() => update.execute(ctx(), id, { expectedUpdatedAt: version, sourceDraft }));
    }
    await assert.rejects(() => update.execute(ctx(), id, { expectedUpdatedAt: version, sourceDraft: {}, vatMode: 'VAT_INCLUDED' }));
    await assert.rejects(() => update.execute({ ...ctx(), userId: 'not-origin' }, id, { expectedUpdatedAt: version, sourceDraft: {} }));
    await assert.rejects(() => update.execute({ ...ctx(), scopes: { branchIds: ['other-branch'] } }, id, { expectedUpdatedAt: version, sourceDraft: {} }));
    await assert.rejects(() => update.execute({ ...ctx(), companyId: 'other-company' }, id, { expectedUpdatedAt: version, sourceDraft: {} }));
    await client.companyMembership.update({ where: { id: `${tag}-member` }, data: { status: 'SUSPENDED' } });
    await assert.rejects(() => update.execute(ctx(), id, { expectedUpdatedAt: version, sourceDraft: {} }));
    await client.companyMembership.update({ where: { id: `${tag}-member` }, data: { status: 'ACTIVE' } });
    const requests = await Promise.allSettled(['ร้าน ก', 'ร้าน ข'].map((vendorName) => update.execute(ctx(), id, { expectedUpdatedAt: version, sourceDraft: { vendorName } })));
    assert.equal(requests.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(requests.filter((result) => result.status === 'rejected').length, 1);
  });
});
