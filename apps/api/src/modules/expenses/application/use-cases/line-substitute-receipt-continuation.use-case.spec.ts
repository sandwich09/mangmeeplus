import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestContext } from '@watchdog-bms/contracts';
import { isSubstituteReceiptConversationText, LineSubstituteReceiptContinuationUseCase, substituteRequestExpenseText } from './line-substitute-receipt-continuation.use-case';

const WEB_BASE = 'https://app.example.com';

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
    assert.equal(codes.includes('payment_evidence_required'), false,
      'R6: with no policy row and no stated non-cash method, separate payment evidence is not demanded');
    assert.equal(codes.some((code) => code.includes('policy') || code.includes('designated')), false,
      'no policy row is the ready OWNER_SELF default, not feature-disabled');
    assert.deepEqual(result.policy, { configured: false, ready: true, approvalMode: 'OWNER_SELF' });
    assert.match(result.replyText, /OWNER_SELF · ใช้ค่าเริ่มต้นของระบบ · พร้อม/);
    assert.match(result.replyText, /สิ่งที่ยังต้องทำทั้งหมด/);
    assert.match(result.replyText, /ยังไม่ได้เตรียม ลงนาม อนุมัติ หรือออกเอกสาร/);
    assert.equal(h.saves.length, 1);
  });

  it('returns forbidden with no link at all before any target is discovered when review permission is missing', async () => {
    const h = harness();
    const result = await h.useCase.execute({ ...ctx(), permissions: ['expense.receipt.line_upload'] }, {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'FORBIDDEN');
    assert.equal(result.webPath, undefined);
    assert.equal(result.replyText.includes('/expenses/expense-1'), false);
    assert.match(result.replyText, /expense\.review|สิทธิ์ตรวจทานค่าใช้จ่าย/);
    assert.equal(result.replyText.includes('/companies/'), false, 'a forbidden reply carries no tenant path');
    assert.equal(result.replyText.includes('http'), false, 'a forbidden reply carries no link');
    assert.equal(h.saves.length, 0);
  });

  it('still demands payment evidence for a non-cash method and under an explicit strict policy', async () => {
    const nonCash = await harness().useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ\nชำระด้วยโอน', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(nonCash.blockers.some((item) => item.code === 'payment_evidence_required'),
      'a transfer slip exists by nature, so non-cash still requires it');

    const strict = await harness({
      policy: { approvalMode: 'OWNER_SELF', approverUserIds: [], cashEvidencePolicy: 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE' },
    }).useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(strict.blockers.some((item) => item.code === 'payment_evidence_required'),
      'a company that deliberately chose the strict rule keeps it');
  });

  it('asks about evidence once and clears the blocker when the sender states there is none', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'ร้านน้ำแข็ง', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จ',
      }),
    });
    const asked = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }], webBaseUrl: WEB_BASE,
    });
    assert.equal(asked.status, 'BLOCKED');
    assert.deepEqual(asked.blockers.map((item) => item.code), ['supporting_evidence_required']);
    assert.match(asked.pendingQuestion ?? '', /มีสลิปหรือรูปถ่ายประกอบไหมคะ/);

    const declared = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีหลักฐาน', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(declared.status, 'READY_FOR_WEB');
    assert.deepEqual(declared.blockers, []);
    assert.ok(declared.acceptedFields.includes('evidenceNone'));
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.acceptedValues.evidenceNone, true,
      'the declaration is persisted, so the question is never asked twice');
    assert.equal(declared.replyText.includes('true'), false, 'the echo shows readable Thai, not a raw boolean');
  });

  it('accepts the bare “ไม่มี” people actually answer, but only while the evidence question is pending', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'ร้านน้ำแข็ง', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จ',
      }),
    });
    const asked = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.deepEqual(asked.blockers.map((item) => item.code), ['supporting_evidence_required']);

    const answered = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีค่ะ', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(answered.status, 'READY_FOR_WEB', 'the question does not loop on its own natural answer');
    assert.ok(answered.acceptedFields.includes('evidenceNone'));

    // Same words with a different question pending must not silently declare "no evidence".
    const other = harness();
    await other.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const stray = await other.useCase.execute(ctx(), {
      messageText: 'ไม่มีค่ะ', chatKeyHash: 'chat-hash', recentCandidates: [],
    });
    assert.equal(stray.acceptedFields.includes('evidenceNone'), false);
  });

  it('reads a label mid-line and never invents one out of ordinary prose', async () => {
    const h = harness();
    // The dispatcher collapses newlines to spaces before this use case ever sees the message.
    const collapsed = await h.useCase.execute(ctx(), {
      messageText: 'สร้างใบทดแทนใบเสร็จ ผู้รับเงิน: ร้านน้ำแข็ง วัตถุประสงค์: เลี้ยงลูกค้า',
      chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.match(collapsed.replyText, /• ผู้รับเงิน\/ผู้ขาย: ร้านน้ำแข็ง$/mu, 'the first value stops at the next label');
    assert.match(collapsed.replyText, /• วัตถุประสงค์ทางธุรกิจ: เลี้ยงลูกค้า$/mu, 'the second label is not swallowed');

    const question = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ สอบถามยอดขาย', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(/• ยอดเงิน/u.test(question.replyText), false, 'a label inside a word is not a label');
  });

  it('never lets mid-line prose write a certified field: only an explicit “:” marks a label there', async () => {
    // คือ/เป็น stay valid at the start of a line (unchanged); mid-line they are ordinary Thai words.
    const prose: Array<[string, RegExp]> = [
      ['ทำใบทดแทนใบเสร็จ ค่าส่งของวันนี้ ผู้ขายเป็นคนจัดส่งเอง', /• ผู้รับเงิน\/ผู้ขาย/u],
      ['ทำใบทดแทนใบเสร็จ ค่าเดินทาง ยอดเป็น 50 บาทหรือเปล่า', /• ยอดเงิน/u],
      ['ทำใบทดแทนใบเสร็จ สรุปแล้ว หมวดเป็นค่าเดินทาง', /• หมวดค่าใช้จ่าย/u],
      ['ทำใบทดแทนใบเสร็จ ตอนนี้ รายการคือเรื่องที่ต้องคุยกันก่อน', /• รายการ/u],
    ];
    for (const [messageText, forbidden] of prose) {
      const result = await harness().useCase.execute(ctx(), {
        messageText, chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
      });
      assert.equal(forbidden.test(result.replyText), false, `${messageText} must not populate ${forbidden}`);
    }
  });

  it('hands the capture gate one contiguous slice of the message, and nothing when only an amount is left', () => {
    assert.equal(substituteRequestExpenseText('สร้างใบทดแทนใบเสร็จ ค่าวินมอไซต์ไปพบลูกค้า 50 บาท'), 'ค่าวินมอไซต์ไปพบลูกค้า 50 บาท');
    // The phrase can trail the fact; the slice keeps the lead-in word verbatim because the gate
    // matches the description against the source text, not against a cleaned-up paraphrase.
    assert.equal(substituteRequestExpenseText('ค่าวินมอไซต์ไปพบลูกค้า 50 บาท ขอใบแทนใบเสร็จ'), 'ค่าวินมอไซต์ไปพบลูกค้า 50 บาท ขอ');
    assert.equal(substituteRequestExpenseText('ทำใบทดแทนใบเสร็จ 50 บาท'), undefined, 'an amount alone is not a purpose');
    assert.equal(substituteRequestExpenseText('ทำใบทดแทนใบเสร็จ'), undefined, 'a leftover request verb is not a purpose');
    assert.equal(substituteRequestExpenseText('ขอใบแทนใบเสร็จ ค่าแท็กซี่ 120 บาท'), 'ค่าแท็กซี่ 120 บาท');
    assert.equal(substituteRequestExpenseText('ค่ากาแฟ 65 บาท'), undefined, 'not a substitute request at all');
  });

  it('matches the composed-ำ vocabulary the formatter itself tells users to type', () => {
    assert.equal(isSubstituteReceiptConversationText('ทำใบรับรองต่อ'), true);
    assert.equal(isSubstituteReceiptConversationText('ขอใบแทนใบเสร็จหน่อย'), true);
    assert.equal(isSubstituteReceiptConversationText('ยอดขายเดือนนี้เท่าไหร่'), false);
  });

  it('echoes every understood value in readable Thai, byte-identical, with one absolute wizard link and no target', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx(), {
      messageText: [
        'สร้างใบทดแทนใบเสร็จ',
        'ผู้รับเงิน: ร้านน้ำแข็ง',
        'ยอด: 50 บาท',
        'หมวด: ค่าเดินทาง',
        'ชำระด้วยเงินสด',
        'วันที่จ่าย: 15 สิงหาคม 2569',
        'ฉันเป็นผู้จ่าย',
        'ไม่มีใบเสร็จ',
      ].join('\n'),
      chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE,
    });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.match(result.replyText, /ยังไม่บันทึก/);
    assert.ok(result.replyText.includes('• ผู้รับเงิน/ผู้ขาย: ร้านน้ำแข็ง'), 'ำ survives the round trip byte-identically');
    assert.match(result.replyText, /• ยอดเงิน: 50/);
    assert.match(result.replyText, /• หมวดค่าใช้จ่าย: ค่าเดินทาง/, 'a typed category is resolved to its name, not dropped');
    assert.match(result.replyText, /• วิธีชำระเงิน: เงินสด/);
    assert.match(result.replyText, /• ผู้จ่ายเงินจริง: คุณ \(ผู้ส่งข้อความ\)/);
    assert.match(result.replyText, /• กรณีที่ใช้ใบเสร็จเดิมไม่ได้: ไม่มีใบเสร็จ\/ใบเสร็จหาย/);
    assert.match(result.replyText, /• วันที่ชำระเงินจริง: 15 ส\.ค\. 2569/);
    assert.equal(/^• .*: *$/mu.test(result.replyText), false, 'no echoed bullet is left dangling without a value');
    assert.equal(result.replyText.includes('RECEIPT_UNAVAILABLE') || result.replyText.includes('CASH')
      || result.replyText.includes('user-1') || result.replyText.includes('2026-08-15'), false, 'no raw ids, enums or ISO dates');
    assert.equal(h.saves.length, 0, 'nothing is persisted without a target');
    assert.equal(result.pendingQuestion, undefined, 'with no candidate the web link is the exit, so nothing stays pending');
    assert.match(result.replyText, /https:\/\/app\.example\.com\/companies\/company-1\/expenses\/substitute-receipts\/new/);
    assert.equal((result.replyText.match(/https?:\/\//gu) ?? []).length, 1, 'exactly one link');
    assert.equal((result.replyText.match(/\/companies\//gu) ?? []).length, 1, 'no bare relative tenant path remains');
    assert.equal((result.replyText.match(/ทำต่อ: /gu) ?? []).length, 1, 'exactly one next question');
  });

  it('answers out-of-scope targets with the formatter and the expense list, never hand-written copy', async () => {
    const h = harness();
    const unknown = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-out-of-scope', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(unknown.status, 'TARGET_REQUIRED');
    assert.match(unknown.replyText, /^📄 ใบรับรองแทนใบเสร็จรับเงิน/);
    assert.match(unknown.replyText, /สิทธิ์หรือสาขาปัจจุบัน/);
    assert.match(unknown.replyText, /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\/company-1\/expenses$/mu);
    assert.equal((unknown.replyText.match(/\/companies\//gu) ?? []).length, 1, 'no bare relative tenant path remains');
    assert.equal(unknown.pendingQuestion, undefined, 'nothing here is answerable in chat');

    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    (h.useCase as any).repo.findByIdWithRelations = async () => null;
    const lostTarget = await h.useCase.execute(ctx(), {
      messageText: 'วัตถุประสงค์: ไปพบลูกค้า', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE, recentCandidates: [],
    });
    assert.equal(lostTarget.status, 'TARGET_REQUIRED');
    assert.match(lostTarget.replyText, /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\/company-1\/expenses$/mu);
    assert.equal((lostTarget.replyText.match(/\/companies\//gu) ?? []).length, 1);
  });

  it('lists numbered candidates when the target is ambiguous and still resolves the chosen number', async () => {
    const h = harness();
    const listed = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบทดแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [
        { id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' },
        { id: 'expense-9', label: 'โน้ตค่าใช้จ่าย · 90.00' },
      ],
    });
    assert.equal(listed.status, 'TARGET_REQUIRED');
    assert.match(listed.replyText, /1\).*200\.00[\s\S]*2\).*90\.00/);
    assert.equal(listed.pendingQuestion, listed.replyText.split('ทำต่อ: ')[1],
      'the offered choice stays pending so the dispatcher routes the next “1” back here');

    const chosen = await h.useCase.execute(ctx(), {
      messageText: '1', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [
        { id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' },
        { id: 'expense-9', label: 'โน้ตค่าใช้จ่าย · 90.00' },
      ],
    });
    assert.equal(chosen.expenseId, 'expense-1');
    assert.equal(chosen.status, 'BLOCKED');
  });

  it('emits absolute links in the reply, resume capsule and webPath when a web base url is configured', async () => {
    const h = harness();
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.webPath?.startsWith(`${WEB_BASE}/companies/company-1/expenses/substitute-receipts/new?`));
    assert.match(result.replyText, /เปิดตรวจสอบในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.match(result.resumeCapsule ?? '', /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false,
      'no bare relative tenant path survives once the absolute links are stripped');

    const withoutBase = harness();
    const relative = await withoutBase.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.ok(relative.webPath?.startsWith('/companies/company-1/'), 'an unset base degrades to the relative path');
    assert.equal(relative.replyText.includes('http'), false);
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
    const result = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(result.status, 'TARGET_REQUIRED');
    assert.match(result.replyText, /1\).*expense-1[\s\S]*2\).*expense-2/);
    assert.equal(result.pendingQuestion, result.replyText.split('ทำต่อ: ')[1], 'the numbered choice stays pending');
    assert.equal(result.replyText.includes('/companies/'), false, 'an ambiguous target offers no link at all');
  });

  it('pauses and cancels only conversation state without deleting the expense or evidence', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    const paused = await h.useCase.execute(ctx(), { messageText: 'ไว้ทำทีหลัง', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(paused.status, 'PAUSED', 'the composed-ำ pause phrase matches');
    assert.equal(h.getExpense().id, 'expense-1');
    assert.equal(h.getExpense().sourceChannelMetadataJson.lineSubstituteReceiptContinuation.status, 'PAUSED');
    assert.ok(paused.webPath?.startsWith(`${WEB_BASE}/companies/company-1/`));
    assert.equal(paused.replyText.includes('/companies/'), false);
    const cancelled = await h.useCase.execute(ctx(), { messageText: 'ไม่ทำแล้ว', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(cancelled.status, 'CANCELLED', 'the composed-ำ cancel phrase matches');
    assert.equal(h.getExpense().id, 'expense-1');
    assert.ok(cancelled.webPath?.startsWith(`${WEB_BASE}/companies/company-1/`));
    assert.equal(cancelled.replyText.includes('/companies/'), false);
    const afterCancel = await h.useCase.execute(ctx(), { messageText: 'ทำใบรับรองต่อ', chatKeyHash: 'chat-hash', recentCandidates: [] });
    assert.equal(afterCancel.status, 'TARGET_REQUIRED', 'closed values are not resurrected as active conversation state');
  });

  it('routes a valid receipt to normal review unless unavailability/incompleteness is proven', async () => {
    const h = harness({ expense: expense({ sourceDocumentType: 'RECEIPT', vendorNameSnapshot: 'Royal Pizza' }) });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'ใบเสร็จ · 2,890.00' }],
    });
    assert.equal(result.status, 'INELIGIBLE');
    assert.ok(result.blockers.some((item) => item.code === 'valid_receipt_normal_path'));
    assert.equal(result.webPath, `${WEB_BASE}/companies/company-1/expenses/expense-1`);
    assert.match(result.replyText, /เปิดตรวจสอบในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false);
  });

  it('reaches READY_FOR_WEB with absolute links once every blocker is answered', async () => {
    const h = harness({
      expense: expense({
        vendorNameSnapshot: 'ร้านน้ำแข็ง', paymentMethod: 'CASH', paidAt: new Date('2026-08-15T00:00:00.000Z'),
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จ',
        attachments: [
          { id: 'att-1', status: 'ACTIVE', purpose: 'expense.source.document' },
          { id: 'att-2', status: 'ACTIVE', purpose: 'expense.payment.evidence' },
        ],
      }),
    });
    const result = await h.useCase.execute(ctx(), {
      messageText: 'ไม่มีใบเสร็จ\nวัตถุประสงค์: ไปพบลูกค้า\nฉันเป็นผู้จ่าย',
      chatKeyHash: 'chat-hash', webBaseUrl: WEB_BASE,
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    assert.equal(result.status, 'READY_FOR_WEB');
    assert.deepEqual(result.blockers, []);
    assert.ok(result.webPath?.startsWith(`${WEB_BASE}/companies/company-1/expenses/substitute-receipts/new?`));
    assert.match(result.replyText, /เปิดตรวจสอบในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.match(result.resumeCapsule ?? '', /เปิดในเว็บ: https:\/\/app\.example\.com\/companies\//);
    assert.equal(result.replyText.replace(/https:\/\/app\.example\.com\S*/gu, '').includes('/companies/'), false);
  });

  it('refuses to overwrite a newer web revision with a plain continuation answer', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), {
      messageText: 'ทำใบรับรองแทนใบเสร็จ', chatKeyHash: 'chat-hash',
      recentCandidates: [{ id: 'expense-1', label: 'โน้ตค่าใช้จ่าย · 200.00' }],
    });
    h.getExpense().updatedAt = new Date(h.getExpense().updatedAt.getTime() + 5000);
    const before = h.saves.length;
    const result = await h.useCase.execute(ctx(), { messageText: 'เป็นค่าเดินทาง', chatKeyHash: 'chat-hash', recentCandidates: [], webBaseUrl: WEB_BASE });
    assert.equal(result.status, 'STALE');
    assert.match(result.replyText, /ตรวจสอบสถานะปัจจุบันในเว็บ: https:\/\/app\.example\.com\/companies\//);
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
