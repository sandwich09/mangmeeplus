import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReimbursementDraftActionView } from './ReimbursementDraftActionPage';
import type { ReimbursementDraftActionResponse } from './reimbursements.api';

const noop = () => {};
type ViewState = React.ComponentProps<typeof ReimbursementDraftActionView>['state'];
const render = (state: ViewState) => renderToStaticMarkup(React.createElement(ReimbursementDraftActionView, { companyId: 'company-1', state, onConfirm: noop, onCancel: noop, onRefresh: noop }));
const ready = (result: ReimbursementDraftActionResponse): ViewState => ({ kind: 'ready', result });

// Ids shaped like the real ones (cuid / uuid / sha-256), so a leak into visible text cannot hide.
const ids = { branch: 'cmg7x2k9p0001branchq8w3e5', attachment: 'cmg7x2k9p0002attachr4t6y8', expense: 'cmg7x2k9p0003expenseu1i3o',
  request: 'cmg7x2k9p0004requestp5a7s', action: '30000000-0000-4000-8000-000000000001', digest: 'f'.repeat(64) };
const bill = { schemaVersion: 1, expenseId: ids.expense, expenseDate: '2026-09-26T00:00:00.000Z', currency: 'THB',
  seller: { name: 'ร้านเครื่องเขียนสมใจ', taxId: null, branchCode: null, documentNumber: 'INV-0042' }, certificate: null };
const taxi = { lineRef: 'b'.repeat(64), lineNo: 1, description: 'ค่าแท็กซี่', categoryKey: 'travel', incurredDate: '2026-09-27', amount: '1234.5000' };
const pens = { lineRef: 'c'.repeat(64), lineNo: 2, description: 'ปากกาและแฟ้ม', categoryKey: 'supplies', categoryLabel: 'วัสดุอุปกรณ์', incurredDate: '2026-09-26',
  amount: '380.0000', attachmentId: ids.attachment, linkedExpenseId: ids.expense, sourceExpenseSnapshot: bill };
// A line's three evidence situations: nothing yet (taxi), its own file, a bill claimed by reference (no file of its own).
const ownFile = { ...taxi, lineRef: 'd'.repeat(64), lineNo: 2, attachmentId: ids.attachment };
const byBill = { ...pens, lineRef: 'e'.repeat(64), lineNo: 3, attachmentId: undefined };
const preview = {
  schemaVersion: 1, actionId: ids.action, previewRevision: 7, operation: 'UPDATE', expiresAt: '2999-01-01T00:00:00.000Z', confirmationDigest: ids.digest,
  before: { requesterDisplayName: 'พิม', branchId: ids.branch, branchName: 'สำนักงานใหญ่', amount: '100.0000', currency: 'THB', reason: 'เดิม',
    receiptRequirementStatus: 'ATTACHED', status: 'DRAFT', lines: [], signatureImpact: 'NONE' },
  after: { requesterDisplayName: 'พิม', branchId: ids.branch, branchName: 'สำนักงานใหญ่', amount: '1614.5000', currency: 'THB', reason: 'ไปพบลูกค้า',
    receiptRequirementStatus: 'REQUIRED', status: 'DRAFT', lines: [taxi, pens], signatureImpact: 'INVALIDATED' },
  diff: [{ fieldPath: 'lines' }], warnings: ['missing_receipt', 'signatures_invalidated'],
};
/** A new draft as the use case builds it: the claim's evidence status and warning come from the lines. */
const created = (lines: unknown[], receiptRequirementStatus: string) => ({ ...preview, operation: 'CREATE', before: undefined, diff: [{ fieldPath: 'request' }],
  after: { ...preview.after, lines, receiptRequirementStatus, signatureImpact: 'NONE' }, warnings: receiptRequirementStatus === 'REQUIRED' ? ['missing_receipt'] : [] });
const receipt = { schemaVersion: 1, actionId: ids.action, operation: 'CREATE', requestId: ids.request, committedState: 'DRAFT', amount: '1614.5000',
  currency: 'THB', confirmationDigest: ids.digest, committedAt: '2026-09-30T01:00:00.000Z', appliedRequestUpdatedAt: '2026-09-30T01:00:00.000Z' };

/** What the customer reads: text nodes and aria labels, never attributes such as the claim link. */
const visible = (html: string) => [...[...html.matchAll(/aria-label="([^"]*)"/gu)].map(match => match[1]!), ...html.replace(/<[^>]*>/gu, '\n').split('\n')]
  .map(text => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

describe('ReimbursementDraftActionView', () => {
  it('renders the complete before/after result, draft-only boundary and warnings in plain Thai', () => {
    const texts = visible(render(ready({ status: 'preview', preview })));
    for (const text of ['ตัวอย่างก่อนบันทึก', 'ระบบจะบันทึกเป็นร่างเท่านั้น ไม่ส่งอนุมัติ ไม่อนุมัติ และไม่จ่ายเงิน', 'ข้อมูลก่อนแก้ไข', 'ข้อมูลหลังแก้ไข', 'สำนักงานใหญ่',
      'ค่าแท็กซี่', 'ยังไม่ได้เลือกหมวด · ยังไม่มีไฟล์แนบ', '27 ก.ย. 2569', '1,234.50 บาท', '1,614.50 บาท', '100.00 บาท',
      'วัสดุอุปกรณ์ · มีไฟล์แนบ · บิลต้นทาง: INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569', 'ยังขาดใบเสร็จบางรายการ', 'มีหลักฐานครบทุกรายการแล้ว',
      'การแก้ไขนี้จะลบลายเซ็นเดิม และต้องลงนามใหม่ภายหลัง', 'บันทึกเป็นร่างได้ แต่ต้องแนบใบเสร็จให้ครบก่อนยื่นเบิก', 'ยืนยันบันทึกเป็นร่าง']) assert.ok(texts.includes(text), text);
    // The revision still travels with confirm/cancel (reimbursements.api.spec.ts); it is never shown.
    assert.doesNotMatch(texts.join('\n'), /รุ่น|DRAFT|travel|THB|2026-09-2\d/u);
  });

  it('says where each line\'s evidence comes from in the LINE card\'s words, and an evidenced claim never reads "no file" (2026-09-30)', () => {
    const all = visible(render(ready({ status: 'preview', preview: created([taxi, ownFile, byBill], 'REQUIRED') })));
    for (const text of ['ยังไม่ได้เลือกหมวด · ยังไม่มีไฟล์แนบ', 'ยังไม่ได้เลือกหมวด · มีไฟล์แนบ',
      'วัสดุอุปกรณ์ · ใช้ใบเสร็จจากบิลต้นทาง · บิลต้นทาง: INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569', 'ยังขาดใบเสร็จบางรายการ']) assert.ok(all.includes(text), text);
    // The real-model run: a bill claimed by reference is the claim's whole evidence, and its line says so.
    for (const lines of [[byBill], [ownFile, byBill]]) {
      const shown = visible(render(ready({ status: 'preview', preview: created(lines, 'ATTACHED') })));
      assert.ok(shown.includes('มีหลักฐานครบทุกรายการแล้ว'));
      assert.doesNotMatch(shown.join('\n'), /ยังไม่มีไฟล์แนบ|ต้องแนบใบเสร็จ/u);
    }
  });

  it('renders terminal and unknown recovery states without offering a second create', () => {
    const applied = render(ready({ status: 'applied', receipt: { ...receipt, currentState: 'DRAFT' } }));
    assert.ok(visible(applied).includes('ยอด 1,614.50 บาท · สถานะปัจจุบัน ร่าง'));
    assert.match(applied, new RegExp(`href="/companies/company-1/reimbursements/${ids.request}"`));
    assert.doesNotMatch(applied, /สร้าง.*ใหม่/);
    // Once submitted, the claim is named by its document number; its id stays in the link only.
    const submitted = visible(render(ready({ status: 'applied', receipt: { ...receipt, currentState: 'PENDING_APPROVAL', requestNo: 'RB-202609-00007' } })));
    assert.ok(submitted.includes('เลขที่ใบเบิก RB-202609-00007 · ยอด 1,614.50 บาท · สถานะปัจจุบัน รออนุมัติ'));
    const unknown = render({ kind: 'unknown', notice: 'result_unconfirmed' });
    assert.match(unknown, /ตรวจสถานะจากระบบ/);
    assert.match(unknown, /ระบบจะตรวจจากร่างเดิมโดยไม่สร้างใบเบิกซ้ำ/);
    assert.doesNotMatch(unknown, /ยืนยันบันทึกเป็นร่าง/);
  });

  it('preserves large decimal amounts, rounds half up at the satang and does not turn an unknown amount into zero', () => {
    const withTotal = (amount: unknown) => render(ready({ status: 'preview', preview: { ...preview, after: { ...preview.after, amount } } }));
    assert.match(withTotal('9007199254740993.01'), /9,007,199,254,740,993\.01 บาท/);
    assert.match(withTotal('1234.5650'), /1,234\.57 บาท/);
    assert.match(withTotal(null), /ยังตรวจสอบจำนวนเงินไม่ได้/);
    assert.doesNotMatch(withTotal('120.00'), /missing_receipt|signatures_invalidated|claimSignatures/);
  });

  it('disables confirmation after the exact preview expires', () => {
    const html = render(ready({ status: 'preview', preview: { ...preview, expiresAt: '2000-01-01T00:00:00.000Z' } }));
    assert.match(html, /หมดอายุแล้ว/);
    assert.match(html, /disabled=""[^>]*>ยืนยันบันทึกเป็นร่าง/);
  });
});

const MACHINE_TOKENS: Array<[string, RegExp]> = [
  ['cuid/uuid/hash-like id', /\b[a-z0-9]{20,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/iu], ['DRAFT', /\bDRAFT\b/u], ['enum or code', /[A-Z_]{4,}/u],
  ['field path', /\w+\.\d+\.\w+|\b[a-zA-Z]\w*\.(?:\d|[a-z]\w*\b)/u], ['camelCase key', /\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u],
  ['ISO date', /\d{4}-\d{2}-\d{2}/u], ['3+ decimal amount', /\d\.\d{3,}/u], ['category key or currency code', /\b(?:travel|supplies|THB)\b/u],
  ['preview revision', /รุ่น/u], ['raw JSON', /[{}[\]"]/u],
];

describe('no customer-visible draft page text carries a machine token (Owner rule 2026-09-27/29)', () => {
  it('holds for every loading, preview, receipt, status and refusal state', () => {
    const odd = { ...preview, warnings: ['a_warning_added_later'], diff: [{ fieldPath: 'aFieldAddedLater' }, { fieldPath: 'lines.0.amount' }, { fieldPath: 'claimSignatures' }],
      after: { ...preview.after, branchName: undefined, receiptRequirementStatus: 'A_STATUS_ADDED_LATER', amount: '1234.5678',
        lines: [{ ...taxi, categoryLabel: '  ', amount: '0.9950' }, { ...pens, sourceExpenseSnapshot: undefined, amount: null }] } };
    const states: ViewState[] = [
      { kind: 'loading' }, { kind: 'error', notice: 'read_failed' }, { kind: 'unknown', notice: 'result_unconfirmed' }, { kind: 'unknown', notice: 'connection_lost' },
      ready({ status: 'preview', preview }), ready({ status: 'preview', preview: odd }), ready({ status: 'preview', preview: created([taxi, ownFile, byBill], 'REQUIRED') }),
      ready({ status: 'preview', preview: { ...preview, operation: 'CREATE', before: undefined, diff: [{ fieldPath: 'request' }], warnings: ['missing_receipt'] } }),
      ready({ status: 'preview', preview: { ...preview, expiresAt: '2000-01-01T00:00:00.000Z' } }),
      { kind: 'ready', result: { status: 'preview', preview }, submitting: 'confirm' },
      ...['DRAFT', 'PENDING_APPROVAL', 'A_STATE_ADDED_LATER'].map(currentState => ready({ status: 'applied', receipt: { ...receipt, currentState, requestNo: 'RB-202609-00007' } })),
      ready({ status: 'applied', receipt: { ...receipt, currentState: undefined } }),
      ready({ status: 'needs_fields', actionId: ids.action, actionRevision: 1, fieldPaths: ['lineChanges.0.values.amount', 'fields.categoryChoiceId'] }),
      ready({ status: 'needs_target', actionId: ids.action, actionRevision: 1 }),
      ...(['cancelled', 'expired', 'stale', 'result_unknown'] as const).map(status => ready({ status, actionId: ids.action, errorCode: 'state_not_editable' })),
      ...['forbidden', 'feature_disabled', 'unsupported_channel', 'write_quiesced', 'invalid_provenance', 'evidence_overflow', 'field_too_long', 'invalid_field',
        'source_changed', 'invalid_source', 'state_not_editable', 'preview_not_fully_delivered', 'rate_limited', 'store_unavailable', 'schema_unsupported',
        'a_code_added_later'].map(errorCode => ready({ status: 'blocked', errorCode, retryAfter: 60 })),
    ];
    const texts = states.flatMap(state => visible(render(state)));
    assert.ok(texts.length > 60);
    for (const raw of texts) {
      const shown = raw.replace(/\bLINE\b/gu, ''); // "LINE" is the app's name
      for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} in: ${raw}`);
    }
  });
});
