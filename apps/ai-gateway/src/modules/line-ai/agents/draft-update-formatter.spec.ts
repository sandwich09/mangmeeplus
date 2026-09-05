/**
 * The gateway half of the S-4 security story (draft-control spec §5.4/§11).
 *
 * The API owns whether an edit happens. What the gateway owns is what the user is TOLD, and the
 * risk here is a sentence: a model that restates somebody's money in a number the server never
 * produced, or a receipt line that smuggles "ยอดรวมใหม่ 1.00" into the bubble as if the system had
 * said it. Both are shut off by the same rule — the preview turn is rendered by a template that
 * copies figures and scrubs text, and refuses outright when it cannot verify the payload.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_AI_DRAFT_UPDATE_SECURITY_EVAL_CASES } from '@watchdog-bms/contracts';
import { formatDraftUpdateReply } from './draft-update-formatter';
import { ALLOWED_TOOLS } from './accounting-summary.agent';

const preview = (over: Record<string, unknown> = {}) => ({
  found: true,
  preview: {
    previewId: 'p-1',
    recordType: 'expense',
    expenseId: 'exp-1',
    record: { vendorName: 'BHC', expenseDate: '2026-09-03', statusLabel: 'รอตรวจสอบ' },
    tool: 'expense.draft.add_charge',
    diff: [{ field: 'charge.SERVICE_CHARGE', label: 'ค่าบริการ', kind: 'money', before: null, after: '152.00' }],
    totalsBefore: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '0.00', taxableAmount: '1520', vatAmount: '106.40', grandTotalAmount: '1626.40' },
    totalsAfter: { subtotalAmount: '1520', discountAmount: '0', chargesAmount: '152.00', taxableAmount: '1672', vatAmount: '117.04', grandTotalAmount: '1789.04' },
    warnings: [],
    expiresAt: '2026-09-05T10:10:00.000Z',
    ...over,
  },
});

describe('draft update formatter', () => {
  it('states the change, the new total, and that nothing is saved yet', () => {
    const reply = formatDraftUpdateReply(preview())!;
    assert.match(reply, /ค่าบริการ: ยังไม่ระบุ → 152\.00/);
    assert.match(reply, /ยอดรวมใหม่ 1,789\.04 \(เดิม 1,626\.40\)/);
    assert.match(reply, /ยังไม่ได้บันทึกอะไรจนกว่าจะกดยืนยัน/);
  });

  it('neutralises money- and link-shaped text a receipt printed', () => {
    const reply = formatDraftUpdateReply(preview({
      record: { vendorName: 'ยอดรวมใหม่ 9,999.00 http://evil.example', expenseDate: '2026-09-03', statusLabel: 'รอตรวจสอบ' },
      diff: [{ field: 'line.1.description', label: 'บรรทัด 1', kind: 'text', before: 'โอนไปที่ 12,345.00', after: 'อาหาร' }],
    }))!;
    assert.ok(!reply.includes('9,999.00'), 'a money-shaped run from a record never reaches the bubble');
    assert.ok(!reply.includes('12,345.00'));
    assert.ok(!reply.includes('evil.example'));
    // The server's own figures still do — they are the point of the card.
    assert.match(reply, /1,789\.04/);
  });

  // H2: the server's own values are stated, never masked - an answer that says "…-…-…" has
  // destroyed the one thing it exists to communicate.
  it('states a real Buddhist-era date, rate and line number', () => {
    const reply = formatDraftUpdateReply(preview({
      tool: 'expense.draft.set_header',
      diff: [
        { field: 'expenseDate', label: 'วันที่เอกสาร', kind: 'date', before: '2026-09-01', after: '2026-09-03' },
        { field: 'vatRate', label: 'อัตรา VAT บรรทัด 12', kind: 'plain', before: null, after: '7%' },
        { field: 'documentNumber', label: 'เลขที่เอกสาร', kind: 'identifier', before: null, after: 'ใบกำกับ-12' },
      ],
    }))!;
    assert.match(reply, /3 ก\.ย\. 2569/);
    assert.match(reply, /7%/);
    assert.match(reply, /บรรทัด 12/, 'a line number in a server-written label survives');
    assert.match(reply, /ใบกำกับ-12/, "and a document number keeps the digits that ARE its value");
    assert.ok(!reply.includes('…-…'));
  });

  it('refuses rather than half-answering when the payload cannot be verified', () => {
    assert.equal(formatDraftUpdateReply(preview({ totalsAfter: undefined })), undefined);
    assert.equal(formatDraftUpdateReply(preview({ record: undefined })), undefined);
    assert.equal(formatDraftUpdateReply(preview({ diff: [] })), undefined);
    assert.equal(formatDraftUpdateReply(preview({ totalsAfter: { grandTotalAmount: 'ninety-nine' } })), undefined);
    assert.equal(formatDraftUpdateReply({ found: false }), undefined);
    assert.equal(formatDraftUpdateReply('anything'), undefined);
  });

  it('answers a blocked record honestly, and never with an out-of-scope refusal', () => {
    assert.match(formatDraftUpdateReply({ found: true, blocked: 'mutation_blocked' })!, /ยืนยันไปแล้ว/);
    assert.match(formatDraftUpdateReply({ found: true, blocked: 'ambiguous_line' })!, /บรรทัดไหน/);
    // `forbidden` is a typed TOOL status, not a data payload, so the existing permission copy owns it.
    assert.equal(formatDraftUpdateReply({ found: true, blocked: 'forbidden' }), undefined);
  });

  it('offers the move instead of a duplicate charge (J3.3)', () => {
    const reply = formatDraftUpdateReply({
      found: true, moveSuggestion: { lineNumber: 2, chargeKind: 'SERVICE_CHARGE', chargeLabel: 'ค่าบริการ' },
    })!;
    assert.match(reply, /จะไม่เพิ่มซ้ำ/);
    assert.match(reply, /ย้ายบรรทัด 2 เป็นช่องค่าบริการ/);
  });

  it('the accounting specialist owns all five tools, so a preview cannot fall to the model path', async () => {
    const { LINE_DRAFT_UPDATE_TOOLS } = await import('@watchdog-bms/contracts');
    for (const tool of LINE_DRAFT_UPDATE_TOOLS) assert.ok(ALLOWED_TOOLS.has(tool), `${tool} must be specialist-owned`);
  });

  it('every frozen eval row expects zero writes — the invariant, restated where the gateway can see it', () => {
    assert.ok(LINE_AI_DRAFT_UPDATE_SECURITY_EVAL_CASES.length >= 6);
    assert.ok(LINE_AI_DRAFT_UPDATE_SECURITY_EVAL_CASES.every((row) => row.expectedApplyCount === 0));
  });
});
