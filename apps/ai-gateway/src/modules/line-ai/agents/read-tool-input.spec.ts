import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { conversationReadCandidates, evidenceRefsText, fileAttemptReferenceGrounded, misroutedReadTool, myPendingWorkQuestion, nameFilterGroundedInText, paymentStatusGroundedInText, reimbursementStatusQuestion, resolvePeriodKeyAlias } from './read-tool-input';

const context = (turns: any[]) => ({ windowMinutes: 15, maxTurns: 15, recentTurns: turns });

describe('bounded conversational read candidates', () => {
  it('anchors each complete USER preview to its Bangkok civil date and deduplicates flat tuples', () => {
    const result = conversationReadCandidates(context([
      { at: '2026-09-30T18:00:00.000Z', userMessagePreview: 'ค่าใช้จ่ายเดือนนี้', userMessagePreviewComplete: true },
      { at: '2026-09-30T18:01:00.000Z', userMessagePreview: 'เดือนนี้เฉพาะยืนยันแล้ว', userMessagePreviewComplete: true },
    ]));
    assert.equal(result?.turns.length, 2);
    assert.equal(result?.turns[0]?.todayIso, '2026-10-01');
    assert.deepEqual(result?.candidates.periods?.map(period => [period.fromDate, period.toDate]), [['2026-10-01', '2026-10-01']]);
    assert.deepEqual(result?.candidates.amounts, []);
  });

  it('does not admit legacy/incomplete or overflow previews', () => {
    assert.equal(conversationReadCandidates(context([
      { at: '2026-09-27T04:00:00.000Z', userMessagePreview: 'ค่าใช้จ่ายเดือนนี้' },
      { at: '2026-09-27T04:01:00.000Z', userMessagePreview: 'เดือนนี้ '.repeat(33), userMessagePreviewComplete: true },
    ])), undefined);
  });

  it('blocks historical fallback when current input has any date/period evidence or overflow', () => {
    const history = context([{ at: '2026-09-27T04:00:00.000Z', userMessagePreview: 'ค่าใช้จ่ายเดือนนี้', userMessagePreviewComplete: true }]);
    assert.equal(conversationReadCandidates(history, { amounts: [], dates: [{ isoDate: '2026-01-02' } as any] }), undefined);
    assert.equal(conversationReadCandidates(history, { version: 2, completeness: 'overflow', dates: [], periods: [], amounts: [] } as any), undefined);
  });
});

describe('item 2b: name filter grounding', () => {
  it('matches after NFC + lowercase + collapsed whitespace, not only raw equality', () => {
    assert.equal(nameFilterGroundedInText('อาหาร', 'ค่าใช้จ่ายหมวด   อาหาร   เดือนนี้'), true);
    assert.equal(nameFilterGroundedInText('Vendor', 'the VENDOR   spent a lot'), true);
    // NFC vs NFD: a decomposed e + combining acute accent must still match a precomposed é.
    assert.equal(nameFilterGroundedInText('Café Vendor', 'invoice from café vendor last week'), true);
  });

  it('rejects a name the message never mentions', () => {
    assert.equal(nameFilterGroundedInText('ร้านสมใจ', 'เดือนนี้ค่าใช้จ่ายเท่าไหร่'), false);
  });

  it('rejects an empty or whitespace-only name', () => {
    assert.equal(nameFilterGroundedInText('', 'อะไรก็ได้'), false);
    assert.equal(nameFilterGroundedInText('   ', 'อะไรก็ได้'), false);
  });
});

describe('item 1: paymentStatus filter grounding (T-001#0)', () => {
  it('drops PAID on a plain total-spending question with no payment-state word', () => {
    assert.equal(paymentStatusGroundedInText('PAID', 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ'), false);
    assert.equal(paymentStatusGroundedInText('PAID', 'ใช้ไปเท่าไหร่แล้ว'), false);
    assert.equal(paymentStatusGroundedInText('PAID', 'ใช้จ่ายไปเท่าไหร่แล้ว'), false);
    assert.equal(paymentStatusGroundedInText('PAID', 'เสียไปเท่าไหร่แล้ว'), false);
  });

  it('drops UNPAID on a plain total-spending question with no payment-state word', () => {
    assert.equal(paymentStatusGroundedInText('UNPAID', 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ'), false);
  });

  it('grounds PAID only on an explicit already-paid contrast', () => {
    assert.equal(paymentStatusGroundedInText('PAID', 'ที่จ่ายแล้วจริงๆ เท่าไหร่คะ'), true);
    assert.equal(paymentStatusGroundedInText('PAID', 'ที่ชำระแล้วมีเท่าไหร่'), true);
    assert.equal(paymentStatusGroundedInText('PAID', 'จ่ายจริงไปเท่าไหร่'), true);
  });

  it('grounds UNPAID only on an explicit not-yet-paid contrast', () => {
    assert.equal(paymentStatusGroundedInText('UNPAID', 'ที่ยังไม่จ่ายมีเท่าไหร่คะ'), true);
    assert.equal(paymentStatusGroundedInText('UNPAID', 'ที่ค้างจ่ายอยู่เท่าไหร่'), true);
    assert.equal(paymentStatusGroundedInText('UNPAID', 'ที่ยังไม่ชำระมีเท่าไหร่'), true);
  });

  it('never mistakes UNPAID\'s own word for a PAID contrast', () => {
    assert.equal(paymentStatusGroundedInText('PAID', 'ที่ยังไม่จ่ายมีเท่าไหร่คะ'), false);
  });

  it('leaves every other enum value (PARTIALLY_PAID, VOIDED) ungated', () => {
    assert.equal(paymentStatusGroundedInText('PARTIALLY_PAID', 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ'), true);
    assert.equal(paymentStatusGroundedInText('VOIDED', 'เดือนนี้จ่ายไปเท่าไหร่แล้วคะ'), true);
  });
});

describe('item 3: periodKey alias resolution (T-009-a/T-052-a root cause)', () => {
  it('resolves the exact invented alias the real model sent for "เดือนนิ" (this-month typo)', () => {
    assert.equal(resolvePeriodKeyAlias('this_month', '2026-09-28'), '2026-09');
    assert.equal(resolvePeriodKeyAlias('this_month_to_date', '2026-09-28'), '2026-09');
    assert.equal(resolvePeriodKeyAlias('current_month', '2026-01-05'), '2026-01');
  });

  it('resolves last_month across a year boundary', () => {
    assert.equal(resolvePeriodKeyAlias('last_month', '2026-01-15'), '2025-12');
  });

  it('never invents a value for an alias outside the closed list, or with no todayIso', () => {
    assert.equal(resolvePeriodKeyAlias('this_week', '2026-09-28'), undefined);
    assert.equal(resolvePeriodKeyAlias('2026-09', '2026-09-28'), undefined);
    assert.equal(resolvePeriodKeyAlias('this_month', undefined), undefined);
  });
});

describe('item 4: evidenceRefsText grounds a subrequest to its own quoted evidence', () => {
  const salesSpan = 'ยอดขายเดือนนี้';
  const expenseSpan = 'ค่าใช้จ่ายเดือนนี้';
  const rawText = `${salesSpan} กับ${expenseSpan}ด้วยค่ะ`;
  const evidence = { turnKey: 't', joinedSha256: 'x', parts: [{ partId: 'p0', rawText, rawSha256: 'h', eventIdHash: 'e', acceptedAtMs: 0 }] } as any;
  const salesStart = rawText.indexOf(salesSpan);
  const expenseStart = rawText.indexOf(expenseSpan);

  it('returns the exact quoted span, not the whole message', () => {
    const text = evidenceRefsText([{ partId: 'p0', startUtf16: salesStart, endUtf16: salesStart + salesSpan.length, rawSha256: 'h' }] as any, evidence, 'fallback');
    assert.equal(text, salesSpan);
  });

  it('joins multiple refs with a space', () => {
    const text = evidenceRefsText([
      { partId: 'p0', startUtf16: salesStart, endUtf16: salesStart + salesSpan.length, rawSha256: 'h' },
      { partId: 'p0', startUtf16: expenseStart, endUtf16: expenseStart + expenseSpan.length, rawSha256: 'h' },
    ] as any, evidence, 'fallback');
    assert.equal(text, `${salesSpan} ${expenseSpan}`);
  });

  it('falls back to the supplied text when there is no evidence (older/simple callers)', () => {
    assert.equal(evidenceRefsText(undefined, undefined, 'fallback text'), 'fallback text');
    assert.equal(evidenceRefsText([], evidence, 'fallback text'), 'fallback text');
  });

  it('falls back when a ref points at a part that is not in this evidence', () => {
    const text = evidenceRefsText([{ partId: 'missing', startUtf16: 0, endUtf16: 3, rawSha256: 'h' }] as any, evidence, 'fallback text');
    assert.equal(text, 'fallback text');
  });
});

describe('item 4: reimbursement-status routing guard (eval T-093-b root cause)', () => {
  it('flags a claim-status question naming no expense ledger word', () => {
    assert.equal(reimbursementStatusQuestion('ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ'), true);
    assert.equal(reimbursementStatusQuestion('เบิกเงินอันนี้จ่ายหรือยังคะ'), true);
    assert.equal(reimbursementStatusQuestion('ขอเบิกไปยังไม่ได้รับเลยค่ะ'), true);
  });

  it('does not flag a plain expense question, even one about payment status', () => {
    assert.equal(reimbursementStatusQuestion('ค่าใช้จ่ายที่ยังไม่จ่ายมีเท่าไหร่คะ'), false);
  });

  it('does not flag a claim question that separately names the expense ledger too', () => {
    assert.equal(reimbursementStatusQuestion('ใบเบิกกับค่าใช้จ่ายเดือนนี้ต่างกันตรงไหนคะ'), false);
  });
});

describe('item 4: file-attempt reference grounding (eval T-107-b root cause)', () => {
  it('is grounded when the customer names a file/photo/document/slip', () => {
    assert.equal(fileAttemptReferenceGrounded('ไฟล์เมื่อกี้ส่งไม่ได้เพราะอะไร'), true);
    assert.equal(fileAttemptReferenceGrounded('รูปที่ส่งไปบันทึกหรือยัง'), true);
    assert.equal(fileAttemptReferenceGrounded('does the pdf I sent still need anything'), true);
  });

  it('is NOT grounded for a category/spending-trend question naming no file at all', () => {
    assert.equal(fileAttemptReferenceGrounded('ทำไมค่าเดินทางเดือนนี้พุ่งขนาดนี้คะ'), false);
  });
});

describe('item 4: misroutedReadTool combinator (shared by the fast lane and the classic tool loop)', () => {
  it('blocks line.explain_file_attempt with no file/photo reference', () => {
    assert.equal(misroutedReadTool('line.explain_file_attempt', 'ทำไมค่าเดินทางเดือนนี้พุ่งขนาดนี้คะ'), true);
  });

  it('allows line.explain_file_attempt when a file/photo is actually named', () => {
    assert.equal(misroutedReadTool('line.explain_file_attempt', 'ไฟล์เมื่อกี้ส่งไม่ได้เพราะอะไร'), false);
  });

  it('blocks expense.list_recent/expense.get_breakdown for a reimbursement-claim status question', () => {
    assert.equal(misroutedReadTool('expense.list_recent', 'ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ'), true);
    assert.equal(misroutedReadTool('expense.get_breakdown', 'เบิกเงินอันนี้จ่ายหรือยังคะ'), true);
  });

  it('leaves every other tool/text combination alone', () => {
    assert.equal(misroutedReadTool('expense.list_recent', 'ค่าใช้จ่ายเดือนนี้เท่าไหร่คะ'), false);
    assert.equal(misroutedReadTool('reimbursement.get_summary', 'ใบเบิกที่ฉันขอไปยังไม่จ่ายใช่ป่ะคะ'), false);
  });
});

// Advisor Q2 (owner 2026-09-30): "งานค้างของฉัน" reads the caller's own queues; Q1 "วันนี้มีอะไรต้องทำ" never does.
describe('advisor Q2: the caller\'s own pending work vs the one-day checklist', () => {
  it('recognises the caller\'s own pending work', () => {
    for (const text of ['มีอะไรค้างที่ฉันต้องทำบ้าง', 'งานค้างของฉันมีอะไรบ้างคะ', 'มีงานค้างอะไรบ้าง', 'ฉันมีอะไรค้างอยู่บ้าง', 'มีอะไรรอผมทำอยู่ไหมครับ', 'มีงานอะไรค้างอยู่บ้าง']) {
      assert.equal(myPendingWorkQuestion(text), true, text);
    }
  });

  it('leaves Q1, a named document, and unpaid spending to their own tools', () => {
    for (const text of ['วันนี้มีอะไรต้องทำบ้าง', 'สรุปวันนี้หน่อย', 'closing วันนี้', 'วันนี้มีอะไรค้างไหม', 'ใบเบิกของฉันค้างอยู่ที่ใคร',
      'มีใบรับรองค้างเซ็นไหม', 'ฉันค้างจ่ายค่าไฟอยู่เท่าไหร่', 'มีบิลค้างที่ฉันต้องจ่ายไหม', 'งานซ่อมแอร์ค้างจ่ายเท่าไหร่']) {
      assert.equal(myPendingWorkQuestion(text), false, text);
    }
  });
});
