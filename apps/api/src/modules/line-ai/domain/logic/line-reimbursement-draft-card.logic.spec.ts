import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReimbursementDraftMessages, buildReimbursementOptionsMessages, reimbursementPreviewText } from './line-reimbursement-draft-card.logic';
import { parseLineReimbursementDraftControl } from '../../application/line-reimbursement-draft.service';
import type { LineReimbursementDraftPreview } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';

const preview: LineReimbursementDraftPreview = { schemaVersion: 1, actionId: '30000000-0000-4000-8000-000000000001', operation: 'CREATE', previewRevision: 2,
  expiresAt: '2026-09-27T22:00:00Z', confirmationDigest: 'a'.repeat(64), diff: [], warnings: ['ต้องแนบใบเสร็จก่อนยื่น'],
  after: { requesterUserId: 'user', requesterDisplayName: 'ผู้ขอ', branchId: 'branch', currency: 'THB', reason: 'เดินทางพบลูกค้า',
    lines: [{ lineRef: 'line1', lineNo: 1, incurredDate: '2026-09-27', description: 'ค่าเดินทาง', amount: '9007199254740.0100', categoryKey: 'travel' }],
    amount: '9007199254740.0100', categoryKey: 'travel', incurredDate: '2026-09-27', receiptRequirementStatus: 'MISSING', status: 'DRAFT', signatureImpact: 'NONE' } };
describe('LINE reimbursement exact preview control', () => {
  it('preserves domain decimal, complete diff, warnings and exact confirm/cancel revision', () => {
    const current = { ...preview, operation: 'UPDATE' as const, before: preview.after,
      diff: [{ fieldPath: 'lines.1.amount', before: '1.0000', after: '9007199254740.0100' }] };
    const text = reimbursementPreviewText(current);
    assert.ok(text.includes('9007199254740.0100'));
    assert.ok(text.includes('1.0000'));
    assert.ok(text.includes('ต้องแนบใบเสร็จก่อนยื่น'));
    const messages = buildReimbursementDraftMessages({ status: 'preview', preview: current }, 'https://example.test', 'company');
    const control = messages.at(-1)!;
    assert.equal(control.type, 'flex');
    const visit = (value: unknown): string[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(visit)
      : 'data' in value && typeof value.data === 'string' ? [value.data] : Object.values(value).flatMap(visit);
    const controls = visit(control).map(parseLineReimbursementDraftControl);
    assert.deepEqual(controls.map(item => item!.action), ['reimbursement_draft_confirm', 'reimbursement_draft_cancel']);
    assert.ok(controls.every(item => item?.previewRevision === 2 && item.confirmationDigest === preview.confirmationDigest));
  });
  it('oversized full preview links to authorized web review without a financial LINE control', () => {
    const large = { ...preview, after: { ...preview.after, lines: Array.from({ length: 50 }, (_, i) => ({ ...preview.after.lines[0]!, lineNo: i + 1, description: 'ก'.repeat(500) })) } };
    const messages = buildReimbursementDraftMessages({ status: 'preview', preview: large }, 'https://example.test', 'company');
    assert.equal(messages.length, 1); assert.equal(messages[0]!.type, 'text');
    assert.ok(JSON.stringify(messages).includes(`/reimbursements/draft-actions/${preview.actionId}`));
    assert.ok(!JSON.stringify(messages).includes('reimbursement_draft_confirm'));
  });
});

describe('reimbursement choices speak to the customer (NAT04 2026-09-29)', () => {
  it('names missing fields in words, never paths', () => {
    const [message] = buildReimbursementDraftMessages({ status: 'needs_fields', actionId: 'a', actionRevision: 1,
      fieldPaths: ['fields.reason', 'lineChanges.0.values.amount'] }, 'https://web.test', 'company');
    assert.equal((message as any).text, 'ร่างใบเบิกยังไม่ครบค่ะ ยังไม่ได้บันทึกอะไร ขอเพิ่ม: เหตุผลการเบิก, ยอดเงิน');
    const [empty] = buildReimbursementDraftMessages({ status: 'needs_fields', actionId: 'a', actionRevision: 1, fieldPaths: [] }, 'https://web.test', 'company');
    assert.doesNotMatch((empty as any).text, /กรุณาระบุ: $|ขอเพิ่ม/u);
  });

  it('offers only claimable bills once branch and requester are chosen, without category or file noise', () => {
    const text = (buildReimbursementOptionsMessages({ selected: { branchChoiceId: 'b', requesterChoiceId: 'r' }, pages: {}, choices: [
      { kind: 'BRANCH', label: 'สำนักงานใหญ่ (BKK)' }, { kind: 'REQUESTER', label: 'คุณเอ' }, { kind: 'CATEGORY', label: 'อาหาร' },
      { kind: 'ATTACHMENT', label: 'receipt.png' },
      { kind: 'SOURCE', label: 'NAT-STN-002 · ร้านเครื่องเขียนบ้านกระดาษ', details: { eligible: true, incurredDate: '2026-09-26', amount: '380' } },
      { kind: 'SOURCE', label: 'EXP-1 · ปั๊มน้ำมัน', details: { eligible: false } },
      { kind: 'SOURCE', label: 'NAT-STN-001 · ร้านเครื่องเขียนสมใจ', details: { eligible: true, incurredDate: '2026-09-24', amount: '245' } },
    ] })[0] as any).text as string;
    assert.match(text, /^เลือกบิลที่จะเบิก/u);
    assert.match(text, /1\) NAT-STN-002 · ร้านเครื่องเขียนบ้านกระดาษ · 2026-09-26 · 380 บาท\n2\) NAT-STN-001 · ร้านเครื่องเขียนสมใจ · 2026-09-24 · 245 บาท/u);
    assert.doesNotMatch(text, /ปั๊มน้ำมัน|สำนักงานใหญ่|คุณเอ|อาหาร|receipt\.png/u);
  });
});
