import React from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReimbursementDraftActionView } from './ReimbursementDraftActionPage';
import type { ReimbursementDraftActionResponse } from './reimbursements.api';

// The page is drawn with the shared page frame, notice and buttons, which are compiled to `React.createElement`.
(globalThis as typeof globalThis & { React: typeof React }).React = React;
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
const visible = (html: string) => [...[...html.matchAll(/aria-label="([^"]*)"/gu)].map(match => match[1]!), ...html.replace(/<span class="text-red-600"(?: aria-hidden="true")?> \*<\/span>/gu, ' *').replace(/<[^>]*>/gu, '\n').split('\n')]
  .map(text => text.replace(/&quot;/gu, '"').replace(/&#x27;/gu, "'").replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').trim()).filter(Boolean);

describe('ReimbursementDraftActionView', () => {
  it('renders the complete before/after result, draft-only boundary and warnings in plain Thai', () => {
    const html = render(ready({ status: 'preview', preview }));
    const texts = visible(html);
    for (const text of ['ตรวจร่างใบเบิกจาก LINE', 'บันทึกเป็นร่างเท่านั้น ยังไม่ส่งอนุมัติ', 'ข้อมูลก่อนแก้ไข', 'ข้อมูลหลังแก้ไข', 'สำนักงานใหญ่',
      'ค่าแท็กซี่', 'ยังไม่ได้เลือกหมวด · ยังไม่มีไฟล์แนบ', '27 ก.ย. 2569', '1,234.50 บาท', '1,614.50 บาท', '100.00 บาท',
      'วัสดุอุปกรณ์ · มีไฟล์แนบ · บิลต้นทาง: INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569', 'ยังขาดใบเสร็จบางรายการ', 'มีหลักฐานครบทุกรายการแล้ว',
      // Each thing to mind is one shared warning notice (its mark is part of its text), in the web's own word for sending a claim.
      '⚠ การแก้ไขนี้จะลบลายเซ็นเดิม และต้องเซ็นใหม่ภายหลัง', '⚠ บันทึกเป็นร่างได้ แต่ต้องแนบใบเสร็จให้ครบก่อนส่งอนุมัติ', 'ยกเลิกร่างนี้', 'ยืนยันบันทึกเป็นร่าง']) assert.ok(texts.includes(text), text);
    // The lost signatures were said twice (in the card and in the list under it): once now.
    assert.equal(texts.filter((text) => text.includes('ลายเซ็นเดิม')).length, 1);
    // The revision still travels with confirm/cancel (reimbursements.api.spec.ts); it is never shown.
    assert.doesNotMatch(texts.join('\n'), /รุ่น|DRAFT|travel|THB|2026-09-2\d/u);
  });

  // Owner 2026-10-13 (Thai UX standard §2.2, §3.3): the page had its own headings, a purple and a black button and a
  // second <main> inside the shop's; a state that could not go on showed a sentence and nothing to press.
  it('is drawn in the shop\'s page frame with the shared buttons, and no state is a dead end', () => {
    const states: ViewState[] = [
      { kind: 'loading' }, { kind: 'error', notice: 'read_failed' }, { kind: 'unknown', notice: 'connection_lost' },
      ready({ status: 'preview', preview }), ready({ status: 'applied', receipt: { ...receipt, currentState: 'DRAFT' } }),
      ...(['cancelled', 'expired', 'stale', 'result_unknown'] as const).map(status => ready({ status, actionId: ids.action })),
      ready({ status: 'needs_target', actionId: ids.action, actionRevision: 1 }),
      ...['forbidden', 'feature_disabled', 'a_code_added_later'].map(errorCode => ready({ status: 'blocked', errorCode })),
    ];
    for (const state of states) {
      const html = render(state);
      // One heading, the frame's; the way back to the claims is above it in every state.
      assert.equal((html.match(/<h1\b/g) ?? []).length, 1, html.slice(0, 300));
      assert.match(html, /^<div class="mangmee-page"><div class="mangmee-page-header"><div class="min-w-0"><div class="mangmee-page-back"><a class="mangmee-btn mangmee-btn-secondary w-fit" href="\/companies\/company-1\/reimbursements">/);
      assert.doesNotMatch(html, /<main\b|bg-indigo|bg-gray-900|text-indigo/);
      for (const [control] of html.matchAll(/<(?:button|a)\b[^>]*>/g)) assert.match(control, /class="mangmee-btn mangmee-btn-(?:primary|secondary)(?: w-fit)?"/, control);
      assert.ok((html.match(/mangmee-btn-primary/g) ?? []).length <= 1, 'one main button at most');
    }
    // What can be tried again offers it; a result nobody could confirm offers the check, also when the API says so itself.
    assert.ok(visible(render({ kind: 'error', notice: 'read_failed' })).includes('ลองอีกครั้ง'));
    assert.ok(visible(render(ready({ status: 'result_unknown', actionId: ids.action }))).includes('ตรวจสถานะจากระบบ'));
    // A new draft has nothing to compare: no "what changes" box, no "before".
    const fresh = visible(render(ready({ status: 'preview', preview: created([taxi], 'REQUIRED') })));
    for (const gone of ['สิ่งที่จะเปลี่ยน', 'ข้อมูลก่อนแก้ไข', 'ข้อมูลหลังแก้ไข']) assert.equal(fresh.includes(gone), false, gone);
    // An edit says each changed value once, as it was and as it will be; the lines are in the cards.
    const edited = visible(render(ready({ status: 'preview', preview: { ...preview, diff: [{ fieldPath: 'reason' }, { fieldPath: 'amount' }, { fieldPath: 'lines' }] } })));
    for (const text of ['สิ่งที่จะเปลี่ยน', 'เดิม: เดิม', 'ใหม่: ไปพบลูกค้า', 'เดิม: 100.00 บาท', 'ใหม่: 1,614.50 บาท', 'ยังไม่มีรายการ']) assert.ok(edited.includes(text), text);
    // After the save the page says what is still to do, only while the claim is a draft.
    assert.ok(visible(render(ready({ status: 'applied', receipt: { ...receipt, currentState: 'DRAFT' } }))).includes('ยังไม่ได้ส่งอนุมัติ เปิดใบเบิกเพื่อตรวจและส่งอนุมัติ'));
    assert.equal(visible(render(ready({ status: 'applied', receipt: { ...receipt, currentState: 'PENDING_APPROVAL' } }))).some((text) => text.includes('ยังไม่ได้ส่งอนุมัติ')), false);
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

  it('shows each line as a card on a phone and keeps the table from sm up (Owner, 2026-09-30)', () => {
    const html = render(ready({ status: 'preview', preview: created([taxi, pens], 'REQUIRED') }));
    // Before: only the four-column table, which left the item a sliver of a 390 px phone.
    assert.match(html, /<div class="[^"]*\bsm:hidden\b[^"]*" data-testid="draft-line-cards">/u);
    assert.match(html, /<div class="mangmee-table-scroll mt-4 hidden sm:block" data-testid="draft-lines-table"><table /u);
    const cards = visible(html.slice(html.indexOf('data-testid="draft-line-cards"'), html.indexOf('data-testid="draft-lines-table"')));
    for (const text of ['ค่าแท็กซี่', '1,234.50 บาท', '27 ก.ย. 2569', 'ยังไม่ได้เลือกหมวด · ยังไม่มีไฟล์แนบ', 'ปากกาและแฟ้ม', '380.00 บาท', '26 ก.ย. 2569',
      'วัสดุอุปกรณ์ · มีไฟล์แนบ · บิลต้นทาง: INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569']) assert.ok(cards.includes(text), text);
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
