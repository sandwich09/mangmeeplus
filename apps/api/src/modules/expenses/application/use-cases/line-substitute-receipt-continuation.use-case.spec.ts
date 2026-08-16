import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { LineSubstituteReceiptContinuationUseCase } from './line-substitute-receipt-continuation.use-case';

function ctx(): RequestContext {
  return {
    requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
    membershipId: 'mem-1', roles: ['OWNER'], permissions: ['expense.review', 'expense.confirm'],
    scopes: { branchIds: ['branch-1'] }, authProvider: 'line',
  };
}

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1', companyId: 'company-1', branchId: 'branch-1', expenseNumber: 'EXP-001',
    status: 'NEEDS_REVIEW', sourceDocumentType: 'EXPENSE_NOTE_TEXT', currency: 'THB', grandTotalAmount: '200.0000',
    expenseCategoryId: 'cat-travel', accountHintKey: null, taxEvidenceStatus: 'SUPPORTING_ONLY',
    aiVerificationSummaryJson: null, missingReceiptReason: null, note: null,
    vendorNameSnapshot: null, paymentMethod: null, paidAt: null,
    sourceChannelMetadataJson: { channel: 'LINE', kind: 'text_note', chatKeyHash: 'chat-hash' },
    substituteReceiptEvidence: null,
    lines: [{ description: 'ค่าเดินทาง', expenseCategoryId: 'cat-travel', accountHintKey: null }],
    attachments: [],
    updatedAt: new Date('2026-08-16T09:00:00.000Z'),
    ...overrides,
  } as any;
}

function harness(overrides: { expense?: any; policy?: any; approvers?: any[]; candidates?: any[] } = {}) {
  let current = overrides.expense ?? expense();
  const saves: any[] = [];
  const repo = {
    listLineSubstituteContinuationRows: async () => {
      const state = current.sourceChannelMetadataJson?.lineSubstituteReceiptContinuation;
      return state ? [{ id: current.id, updatedAt: current.updatedAt, sourceChannelMetadataJson: current.sourceChannelMetadataJson }] : [];
    },
    findByIdWithRelations: async (_companyId: string, id: string) => id === current.id ? current : null,
    listCategories: async () => [{ id: 'cat-travel', name: 'ค่าเดินทาง' }],
    getSubstituteReceiptPolicy: async () => overrides.policy ?? null,
    listEligibleSubstituteReceiptApprovers: async () => overrides.approvers ?? [{ userId: 'user-1', displayName: 'เจ้าของ' }],
    findActiveMemberIdentity: async (_companyId: string, userId: string) => userId === 'user-1' ? { userId, displayName: 'เจ้าของ' } : null,
    saveLineSubstituteContinuation: async (input: any) => {
      assert.equal(input.expectedUpdatedAt.toISOString(), current.updatedAt.toISOString(), 'CAS uses the current expense revision');
      const now = new Date(current.updatedAt.getTime() + 1000);
      const continuation = { ...input.continuation, targetRevision: now.toISOString(), lastActivityAt: now.toISOString() };
      current = {
        ...current,
        updatedAt: now,
        sourceChannelMetadataJson: { ...current.sourceChannelMetadataJson, lineSubstituteReceiptContinuation: continuation },
      };
      saves.push({ ...input, continuation });
      return { updatedAt: now, continuation };
    },
  } as any;
  return { useCase: new LineSubstituteReceiptContinuationUseCase(repo), saves, getExpense: () => current };
}

describe('LineSubstituteReceiptContinuationUseCase', () => {
  it('returns every knowable blocker together and keeps absent policy as ready OWNER_SELF semantics', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });

    assert.equal(result.status, 'BLOCKED');
    const codes = result.blockers.map((item) => item.code);
    assert.ok(codes.includes('reason_code_required'));
    assert.ok(codes.includes('missing_receipt_reason_required'));
    assert.ok(codes.includes('business_purpose_required'));
    assert.ok(codes.includes('payer_required'));
    assert.ok(codes.includes('payee_required'));
    assert.ok(codes.includes('payment_method_required'));
    assert.ok(codes.includes('payment_date_required'));
    assert.ok(codes.includes('supporting_evidence_required'));
    assert.ok(codes.includes('payment_evidence_required'));
    assert.equal(codes.some((code) => code.includes('policy') || code.includes('designated')), false,
      'no policy row is the ready OWNER_SELF default, not feature-disabled');
    assert.deepEqual(result.policy, { configured: false, ready: true, approvalMode: 'OWNER_SELF' });
    assert.match(result.replyText, /OWNER_SELF · ใช้ค่าเริ่มต้นของระบบ · พร้อม/);
    assert.match(result.replyText, /สิ่งที่ยังต้องทำทั้งหมด/);
    assert.match(result.replyText, /ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร/);
    assert.equal(h.saves.length, 1);
  });

  it('returns forbidden without a target-specific web link when review permission is missing', async () => {
    const h = harness();
    const result = await h.useCase.execute({ ...ctx(), permissions: ['expense.receipt.line_upload'] }, {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'FORBIDDEN');
    assert.equal(result.webPath, undefined);
    assert.equal(result.replyText.includes('/expenses/expense-1'), false);
  });

  it('accepts several labeled fields in one message, preserves them across a later partial answer, and never creates PREPARED evidence', async () => {
    const h = harness();
    const first = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(first.pendingQuestion);

    const second = await h.useCase.execute(ctx(), {
      messageText: [
        'ไม่มีใบเสร็จ ร้านไม่ออกให้',
        'เหตุผล: ร้านค้าไม่สามารถออกใบเสร็จได้',
        'วัตถุประสงค์: เดินทางไปพบลูกค้า',
        'ผู้รับเงิน: ร้านรถเช่า เอ',
        'ฉันเป็นผู้จ่าย',
        'วันที่จ่าย: 15 สิงหาคม 2569',
        'ชำระด้วยเงินสด',
      ].join('\n'),
      chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.ok(second.acceptedFields.includes('businessPurpose'));
    assert.ok(second.acceptedFields.includes('payerUserId'));
    assert.ok(second.acceptedFields.includes('paymentDate'));
    assert.ok(second.acceptedFields.includes('paymentMethod'));
    const state = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation;
    assert.equal(state.acceptedValues.businessPurpose, 'เดินทางไปพบลูกค้า');
    assert.equal(state.acceptedValues.payerUserId, 'user-1');
    assert.equal(state.status, 'OPEN');
    assert.equal(h.getExpense().substituteReceiptEvidence, null, 'LINE staging never creates PREPARED evidence');

    const third = await h.useCase.execute(ctx(), {
      messageText: 'เหตุผล: ผู้ขายรายย่อยไม่ออกเอกสาร', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.ok(third.acceptedFields.includes('missingReceiptReason'));
    const after = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues;
    assert.equal(after.businessPurpose, 'เดินทางไปพบลูกค้า', 'a partial answer does not erase earlier accepted fields');
    assert.equal(after.payeeName, 'ร้านรถเช่า เอ');
  });

  it('maps a short unlabeled answer only to the exact pending field', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ร้านทำใบเสร็จหาย', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(result.acceptedFields.includes('reasonCode'), true);
    assert.equal(result.acceptedFields.includes('missingReceiptReason'), false,
      'a phrase already parsed as reason type is not guessed into another slot');
  });

  it('answers an intervening VAT question from current source state and resumes without consuming a field', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const before = h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.missingFields;
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ใบนี้เคลม VAT ได้ไหม', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.deepEqual(result.acceptedFields, []);
    assert.match(result.replyText, /SUPPORTING_ONLY/);
    assert.match(result.replyText, /ไม่ใช่ใบกำกับภาษี/);
    assert.match(result.replyText, /งานเดิมยังอยู่/);
    assert.deepEqual(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.missingFields, before);
  });

  it('handles accepted fields and a grounded question as separate outcomes in one message', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์: ไปส่งสินค้า\nใบนี้เคลม VAT ได้ไหม', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.ok(result.acceptedFields.includes('businessPurpose'));
    assert.match(result.replyText, /รับข้อมูลเข้าร่างแล้ว.*วัตถุประสงค์ทางธุรกิจ/);
    assert.match(result.replyText, /คำถามแทรก — VAT/);
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.businessPurpose, 'ไปส่งสินค้า');
  });

  it('does not infer payment method or reason code from a hypothetical question', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์ต้องกรอกอะไรบ้าง? ถ้าร้านไม่ออกใบเสร็จและจ่ายเงินสด เคลม VAT ได้ไหม?', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(result.acceptedFields.includes('reasonCode'), false);
    assert.equal(result.acceptedFields.includes('paymentMethod'), false);
    assert.equal(result.acceptedFields.includes('businessPurpose'), false);
  });

  it('requires target selection when several open workflows exist', async () => {
    const h = harness();
    const current = h.getExpense();
    const state = {
      workflowId: 'wf-1', kind: 'SUBSTITUTE_RECEIPT', companyId: 'company-1', userId: 'user-1',
      expenseId: 'expense-1', chatKeyHash: 'chat-hash', status: 'OPEN', acceptedValues: {}, provenance: {},
      resolvedFields: [], missingFields: [], attachmentRefs: [], pendingQuestion: null,
      targetRevision: current.updatedAt.toISOString(), lastActivityAt: current.updatedAt.toISOString(),
    };
    const repo = (h.useCase as any).repo;
    repo.listLineSubstituteContinuationRows = async () => [
      { id: 'expense-1', updatedAt: current.updatedAt, sourceChannelMetadataJson: { lineSubstituteReceiptContinuation: state } },
      { id: 'expense-2', updatedAt: current.updatedAt, sourceChannelMetadataJson: { lineSubstituteReceiptContinuation: { ...state, workflowId: 'wf-2', expenseId: 'expense-2' } } },
    ];
    const result = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.match(result.replyText, /1\).*expense-1[\s\S]*2\).*expense-2/);
  });

  it('pauses and cancels only conversation state without deleting the expense or evidence', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const paused = await h.useCase.execute(ctx(), { messageText: 'พักไว้ก่อน', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(paused.status, 'PAUSED');
    assert.equal(h.getExpense().id, 'expense-1');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'PAUSED');
    const cancelled = await h.useCase.execute(ctx(), { messageText: 'ยกเลิก', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(h.getExpense().id, 'expense-1');
    const afterCancel = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(afterCancel.status, 'TARGET_REQUIRED', 'closed values are not resurrected as active conversation state');
  });

  it('routes a valid receipt to normal review unless unavailability/incompleteness is proven', async () => {
    const h = harness({ expense: expense({ sourceDocumentType: 'RECEIPT', vendorNameSnapshot: 'Royal Pizza' }) });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'ใบเสร็จ · 2,890.00' }],
    });
    assert.equal(result.status, 'INELIGIBLE');
    assert.ok(result.blockers.some((item) => item.code === 'valid_receipt_normal_path'));
    assert.match(result.webPath ?? '', /\/expenses\/expense-1$/);
  });

  it('refuses to overwrite a newer web revision with a plain continuation answer', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    h.getExpense().updatedAt = new Date(h.getExpense().updatedAt.getTime() + 5000);
    const before = h.saves.length;
    const result = await h.useCase.execute(ctx(), { messageText: 'เป็นค่าเดินทาง', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(result.status, 'STALE');
    assert.equal(h.saves.length, before, 'stale text performs no write');
    const explicitResume = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(explicitResume.status, 'STALE');
    assert.equal(h.saves.length, before, 'explicit resume also reloads/fails closed instead of rebasing staged values over a web edit');
  });

  it('reloads opaque prefill only for the same authenticated web user, scope, workflow, and revision', async () => {
    const h = harness();
    const opened = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const webCtx = { ...ctx(), authProvider: 'watchdog' as const };
    const prefill = await h.useCase.loadForWeb(webCtx, 'expense-1', opened.workflowId!);
    assert.equal(prefill.acceptedValues.businessPurpose, 'ไปพบลูกค้า');
    assert.equal(prefill.targetRevision, h.getExpense().updatedAt.toISOString());

    await assert.rejects(
      () => h.useCase.loadForWeb(ctx(), 'expense-1', opened.workflowId!),
      /authenticated web app/,
    );
    await assert.rejects(
      () => h.useCase.loadForWeb({ ...webCtx, userId: 'other-user' }, 'expense-1', opened.workflowId!),
      /not found/i,
    );
    h.getExpense().updatedAt = new Date(h.getExpense().updatedAt.getTime() + 1000);
    await assert.rejects(
      () => h.useCase.loadForWeb(webCtx, 'expense-1', opened.workflowId!),
      /Expense changed/,
    );
  });
});
