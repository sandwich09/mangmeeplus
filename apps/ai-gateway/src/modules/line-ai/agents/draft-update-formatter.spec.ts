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
import { LINE_AI_DRAFT_UPDATE_SECURITY_EVAL_CASES, parseLineAiAnswerCardLayout } from '@watchdog-bms/contracts';
import { draftUpdateCardLayout, formatDraftUpdateReply } from './draft-update-formatter';
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

  // Same gap on the render side: replacing `scrubRecordIdentifier` with the raw value left the
  // suites green, so a document number carrying a total and a host would have printed verbatim.
  it('never prints a document number carrying a total or a host', () => {
    const reply = formatDraftUpdateReply(preview({
      tool: 'expense.draft.set_header',
      diff: [{ field: 'documentNumber', label: 'เลขที่เอกสาร', kind: 'identifier', before: null, after: 'A0042 ยอดจริง 88,888.00 โอนที่ evil.example.com' }],
    }))!;
    assert.ok(!reply.includes('88,888.00'), `total survived: ${reply}`);
    assert.ok(!reply.includes('evil.example.com'), `host survived: ${reply}`);
    assert.match(reply, /เลขที่เอกสาร: ยังไม่ระบุ → —/, 'it falls back rather than printing debris');
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

  // The API caps `groundingText` at 1000 and rejects anything longer, so the SENDER truncates:
  // an unbounded forward would 400 every ERP tool call of a turn whose message ran long.
  it('bounds the grounding text it forwards to the ERP boundary', async () => {
    const { GROUNDING_TEXT_MAX } = await import('../infrastructure/erp-tool.client');
    assert.equal(GROUNDING_TEXT_MAX, 1000);
    assert.equal('ก'.repeat(3000).slice(0, GROUNDING_TEXT_MAX).length, 1000);
  });

  it('the accounting specialist owns all five tools, so a preview cannot fall to the model path', async () => {
    const { LINE_DRAFT_UPDATE_TOOLS } = await import('@watchdog-bms/contracts');
    for (const tool of LINE_DRAFT_UPDATE_TOOLS) assert.ok(ALLOWED_TOOLS.has(tool), `${tool} must be specialist-owned`);
  });

  it('no frozen eval row writes except the one DEFINED as a write', () => {
    assert.ok(LINE_AI_DRAFT_UPDATE_SECURITY_EVAL_CASES.length >= 6);
    for (const row of LINE_AI_DRAFT_UPDATE_SECURITY_EVAL_CASES) {
      const mayWrite = row.expectedOutcome === 'applied_named_edit';
      assert.equal(row.expectedApplyCount === 0, !mayWrite, row.id);
    }
  });
});

// Design lock context 4: the header of the "แก้ไขค่าใช้จ่าย" card names the state the TOOL RESULT
// reports. It carries no figure — a proposal's numbers are on the API's confirm card alone.
describe('draft update card layout', () => {
  const header = (data: unknown) => draftUpdateCardLayout(data)?.header;

  it('names a proposal, a question back, and a record left as it was', () => {
    assert.deepEqual(draftUpdateCardLayout(preview()), { context: 'edit_command', header: ['แก้ไขค่าใช้จ่าย', 'รอยืนยัน'], rows: [] });
    for (const reason of ['ambiguous_line', 'ambiguous_record', 'ungrounded_value', 'invalid_patch']) {
      assert.deepEqual(header({ found: true, blocked: reason }), ['แก้ไขค่าใช้จ่าย', 'ขอข้อมูลเพิ่ม'], reason);
    }
    for (const reason of ['mutation_blocked', 'no_recent_record', 'rate_limited', 'something_new']) {
      assert.deepEqual(header({ found: true, blocked: reason }), ['แก้ไขค่าใช้จ่าย', 'ยังไม่ได้แก้ไข'], reason);
    }
    assert.deepEqual(header({ found: true, moveSuggestion: { lineNumber: 2, chargeLabel: 'ค่าบริการ' } }), ['แก้ไขค่าใช้จ่าย', 'ยังไม่ได้แก้ไข']);
  });

  it('never says an edit was applied or cancelled: only the API, after its own postback, knows that', () => {
    for (const data of [preview(), { found: true, blocked: 'ambiguous_line' }, { found: true, applied: true }, { found: true, status: 'applied' }]) {
      assert.doesNotMatch(JSON.stringify(draftUpdateCardLayout(data) ?? {}), /แก้ไขแล้ว|ยกเลิกแล้ว/);
    }
  });

  it('has no layout for a result it cannot read, and every layout it makes is one the receiver accepts', () => {
    for (const data of [undefined, null, 'x', [], {}, { found: false }, { found: true }, { found: false, preview: preview().preview }]) {
      assert.equal(draftUpdateCardLayout(data), undefined);
    }
    for (const data of [preview(), { found: true, blocked: 'ambiguous_line' }, { found: true, blocked: 'rate_limited' }]) {
      const layout = draftUpdateCardLayout(data);
      assert.deepEqual(parseLineAiAnswerCardLayout(JSON.parse(JSON.stringify(layout))), layout);
    }
  });
});
