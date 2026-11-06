import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReimbursementDraftMessages, buildReimbursementOptionsMessages, formatClaimMoney, reimbursementPreviewText } from './line-reimbursement-draft-card.logic';
import { parseLineReimbursementDraftControl } from '../../application/line-reimbursement-draft.service';
import type { LineReimbursementDraftPreview, LineReimbursementDraftResult, LineReimbursementDraftSnapshot } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import { lineFlexBodyProblems } from './line-system-card-limits.logic';
import { lineSystemCardTexts } from './line-system-card.logic';
import { isCompleteLineBusinessAnswerPresentation } from './line-business-card.logic';
import { computeReceiptRequirement } from '../../../reimbursements/domain/logic/reimbursement.logic';

// Ids shaped like the real ones (cuid / uuid / sha-256), so a leak into visible text cannot hide.
const ids = { branch: 'cmg7x2k9p0001branchq8w3e5', attachment: 'cmg7x2k9p0002attachr4t6y8', expense: 'cmg7x2k9p0003expenseu1i3o',
  request: 'cmg7x2k9p0004requestp5a7s', action: '30000000-0000-4000-8000-000000000001', digest: 'a'.repeat(64) };
const bill = { schemaVersion: 1, expenseId: ids.expense, expenseDate: '2026-09-26T00:00:00.000Z', currency: 'THB',
  seller: { name: 'ร้านเครื่องเขียนสมใจ', taxId: null, branchCode: null, documentNumber: 'INV-0042' }, certificate: null };
const after: LineReimbursementDraftSnapshot = { requesterUserId: 'user', requesterDisplayName: 'คุณเอ', branchId: ids.branch, branchName: 'สำนักงานใหญ่',
  currency: 'THB', reason: 'เดินทางพบลูกค้า', lines: [
    { lineRef: 'b'.repeat(64), lineNo: 1, incurredDate: '2026-09-27', description: 'ค่าแท็กซี่', amount: '1234.5000', categoryKey: 'travel' },
    { lineRef: 'c'.repeat(64), lineNo: 2, incurredDate: '2026-09-26', description: 'ปากกาและแฟ้ม', amount: '380.0000', categoryKey: 'supplies',
      categoryLabel: 'วัสดุอุปกรณ์', attachmentId: ids.attachment, linkedExpenseId: ids.expense, sourceExpenseSnapshot: bill }],
  amount: '1614.5000', categoryKey: 'travel', categoryLabel: 'หลายหมวด (2 รายการ)', incurredDate: '2026-09-26', receiptRequirementStatus: 'REQUIRED',
  status: 'DRAFT', signatureImpact: 'NONE' };
const preview: LineReimbursementDraftPreview = { schemaVersion: 1, actionId: ids.action, operation: 'CREATE', previewRevision: 2,
  expiresAt: '2026-09-27T22:00:00Z', confirmationDigest: ids.digest, diff: [{ fieldPath: 'request', after }], warnings: ['missing_receipt'], after };

const before: LineReimbursementDraftSnapshot = { ...after, reason: 'พบลูกค้า', amount: '300.0000', categoryLabel: 'เดินทาง', receiptRequirementStatus: 'ATTACHED',
  lines: [{ ...after.lines[0]!, amount: '300.0000', attachmentId: ids.attachment, categoryLabel: 'เดินทาง' }, { ...after.lines[0]!, lineNo: 2, description: 'ค่าทางด่วน', amount: '70.0000' }] };
const update: LineReimbursementDraftPreview = { ...preview, operation: 'UPDATE', before, after: { ...after, signatureImpact: 'INVALIDATED' },
  warnings: ['missing_receipt', 'signatures_invalidated'], diff: [
    { fieldPath: 'reason', before: before.reason, after: after.reason }, { fieldPath: 'amount', before: before.amount, after: after.amount },
    { fieldPath: 'categoryLabel', before: before.categoryLabel, after: after.categoryLabel },
    { fieldPath: 'receiptRequirementStatus', before: 'ATTACHED', after: 'REQUIRED' },
    { fieldPath: 'lines', before: before.lines, after: after.lines }, { fieldPath: 'claimSignatures', before: 'PRESENT', after: 'INVALIDATED' }] };

// A line's three evidence situations: nothing yet, its own file, a bill claimed by reference (no file of its own).
const noFile = after.lines[0]!, ownFile = { ...noFile, lineNo: 2, attachmentId: ids.attachment }, byBill = { ...after.lines[1]!, lineNo: 3, attachmentId: undefined };
/** The preview as the use case builds it: the claim's evidence status and warning come from the lines. */
const withLines = (lines: LineReimbursementDraftSnapshot['lines']): LineReimbursementDraftPreview => {
  const status = computeReceiptRequirement({ requireReceipt: true, allowMissingReceiptWithReason: false, lines }).status;
  return { ...preview, after: { ...after, lines, receiptRequirementStatus: status }, warnings: status === 'REQUIRED' ? ['missing_receipt'] : [] };
};

const text = (messages: ReturnType<typeof buildReimbursementDraftMessages>) => messages.map(message => message.type === 'text' ? message.text : message.type === 'flex' ? message.canonicalText ?? '' : '').join('\n');
const draft = (result: LineReimbursementDraftResult) => text(buildReimbursementDraftMessages(result, 'https://web.test', 'company'));

describe('LINE reimbursement preview speaks plain Thai (Owner rule 2026-09-27/29)', () => {
  it('shows only populated facts in locked rows, compact items, source receipt and exact amounts', () => {
    const shown = reimbursementPreviewText(preview);
    for (const fact of ['ผู้เบิก: คุณเอ', 'สาขา: สำนักงานใหญ่', 'เหตุผล: เดินทางพบลูกค้า', 'รายการ 1: ค่าแท็กซี่ · 1,234.50 บาท',
      'รายการ 2: ปากกาและแฟ้ม · 380.00 บาท', 'วันที่: 26 ก.ย. 2569', 'หมวด: วัสดุอุปกรณ์', 'ใบเสร็จจากบิล INV-0042 · ร้านเครื่องเขียนสมใจ', 'ยอดรวม: 1,614.50 บาท']) assert.ok(shown.includes(fact), fact);
    assert.doesNotMatch(shown, /หัวเรื่อง:|วัตถุประสงค์:|เหตุผลที่ไม่มีใบเสร็จ:|: -|สถานะหลังบันทึก|ระบบคำนวณ/u);
    assert.doesNotMatch(reimbursementPreviewText({ ...preview, after: { ...after, branchName: undefined } }), /สาขา:/u);
  });

  it('keeps every update and warns once that signatures must be renewed', () => {
    const shown = reimbursementPreviewText(update);
    for (const fact of ['เหตุผล: พบลูกค้า → เดินทางพบลูกค้า', 'ยอดรวม: 300.00 → 1,614.50 บาท',
      'ยอดเงิน รายการที่ 1: 300.00 → 1,234.50 บาท', 'วันที่จ่าย รายการที่ 2: 27 ก.ย. 2569 → 26 ก.ย. 2569',
      'บิลต้นทาง รายการที่ 2: ยังไม่ระบุ → INV-0042']) assert.ok(shown.includes(fact), fact);
    assert.equal(shown.split('\n').filter(line => /ลายเซ็น/u.test(line)).length, 1);
  });

  it('distinguishes no receipt, own attachment and source receipt without contradicting evidence', () => {
    const shown = reimbursementPreviewText(withLines([noFile, ownFile, byBill]));
    for (const fact of ['หลักฐาน: ยังไม่มีใบเสร็จ', 'หลักฐาน: มีไฟล์แนบ', 'หลักฐาน: ใบเสร็จจากบิล INV-0042']) assert.ok(shown.includes(fact));
    for (const lines of [[byBill], [ownFile, byBill]]) assert.doesNotMatch(reimbursementPreviewText(withLines(lines)), /ยังไม่มีใบเสร็จ|แนบใบเสร็จที่ขาด/u);
  });

  it('rejects placeholder rows on CREATE and UPDATE cards in Thai and English', () => {
    for (const language of ['th', 'en'] as const) for (const sample of [preview, update]) {
      const messages = buildReimbursementDraftMessages({ status: 'preview', preview: sample }, 'https://web.test', 'company', [], undefined, language);
      assert.equal(messages.length, 1);
      const message = messages[0]!;
      assert.equal(message.type, 'flex');
      if (message.type !== 'flex') throw new Error('expected card');
      assert.deepEqual(lineFlexBodyProblems(message.contents), []);
      const texts = lineSystemCardTexts(message.contents);
      assert.ok(texts.includes(language === 'th' ? 'คุณเอ' : 'คุณเอ'));
      assert.ok(texts.includes(':'));
      assert.ok(texts.includes(language === 'th' ? 'บันทึกร่าง' : 'Save draft'));
      assert.ok(texts.includes(language === 'th' ? 'ไม่ทำ' : 'Cancel action'));
      assert.ok(texts.includes(language === 'th' ? 'ยังไม่ได้บันทึกค่ะ' : 'Not saved yet.'));
      for (const value of texts) assert.doesNotMatch(value, /^-$|:\s*-(?:\s|$)/u);
      assert.equal(isCompleteLineBusinessAnswerPresentation(message), true);
    }
  });

  it('localizes the default branch and omits absent reason and purpose in either language', () => {
    for (const language of ['th', 'en'] as const) {
      const sample = { ...preview, after: { ...after, branchName: 'Head Office', reason: '', lines: [byBill] } };
      const message = buildReimbursementDraftMessages({ status: 'preview', preview: sample }, 'https://web.test', 'company', [], undefined, language)[0]!;
      assert.equal(message.type, 'flex');
      const shown = lineSystemCardTexts((message as any).contents).join('\n');
      assert.match(shown, language === 'th' ? /สำนักงานใหญ่/u : /Head Office/u);
      assert.doesNotMatch(shown, language === 'th' ? /Head Office|เหตุผล|วัตถุประสงค์/u : /Reason|Purpose/u);
    }
  });

  it('names added and removed lines, and a swapped file without its id', () => {
    const [first, second] = after.lines;
    const shown = reimbursementPreviewText({ ...update, before: { ...after, lines: [{ ...first!, attachmentId: 'cmg7x2k9p0009oldfilez2x4c' }, second!] },
      after: { ...after, lines: [{ ...first!, attachmentId: ids.attachment }, { ...second!, lineNo: 3 }] }, diff: [{ fieldPath: 'lines' }], warnings: [] });
    assert.match(shown, /ไฟล์แนบ รายการที่ 1: เปลี่ยนเป็นไฟล์ใหม่\nเพิ่มรายการที่ 3: ปากกาและแฟ้ม · 380\.00 บาท\nลบรายการที่ 2: ปากกาและแฟ้ม · 380\.00 บาท/u);
  });

  it('keeps the exact confirm/cancel revision in postback data behind a plain Thai button', () => {
    const messages = buildReimbursementDraftMessages({ status: 'preview', preview: update }, 'https://example.test', 'company');
    const control = messages.at(-1)!;
    assert.equal(control.type, 'flex');
    const visit = (value: unknown): string[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(visit)
      : 'data' in value && typeof value.data === 'string' ? [value.data] : Object.values(value).flatMap(visit);
    const controls = visit(control).map(parseLineReimbursementDraftControl);
    assert.deepEqual(controls.map(item => item!.action), ['reimbursement_draft_confirm', 'reimbursement_draft_cancel']);
    assert.ok(controls.every(item => item?.previewRevision === 2 && item.confirmationDigest === preview.confirmationDigest));
    assert.match(JSON.stringify(control), /"label":"บันทึกร่าง"/u);
  });

  it('oversized full preview links to authorized web review without a financial LINE control', () => {
    const large = { ...preview, after: { ...preview.after, lines: Array.from({ length: 50 }, (_, i) => ({ ...preview.after.lines[0]!, lineNo: i + 1, description: 'ก'.repeat(500) })) } };
    const messages = buildReimbursementDraftMessages({ status: 'preview', preview: large }, 'https://example.test', 'company');
    assert.equal(messages.length, 1); assert.equal(messages[0]!.type, 'flex');
    assert.deepEqual(lineFlexBodyProblems((messages[0] as any).contents), []);
    assert.ok(JSON.stringify(messages).includes(`/reimbursements/draft-actions/${preview.actionId}`));
    assert.ok(!JSON.stringify(messages).includes('reimbursement_draft_confirm'));
  });
});

describe('reimbursement receipts and refusals speak plain Thai', () => {
  const receipt = { schemaVersion: 1, actionId: ids.action, operation: 'CREATE', requestId: ids.request, committedState: 'DRAFT', amount: '1614.5000',
    currency: 'THB', confirmationDigest: ids.digest, committedAt: '2026-09-30T01:00:00.000Z', appliedRequestUpdatedAt: '2026-09-30T01:00:00.000Z' };

  it('reports the saved claim by its document number, never its id, with the current state in words', () => {
    assert.equal(draft({ status: 'applied', receipt: { ...receipt, currentState: 'DRAFT' } }),
      'บันทึกร่างใบเบิกแล้วค่ะ\nสถานะ: ร่าง\nยอดรวม: 1,614.50 บาท');
    assert.equal(draft({ status: 'applied', receipt: { ...receipt, currentState: 'PENDING_APPROVAL', requestNo: 'RB-2569-0007' } }),
      'บันทึกร่างใบเบิกแล้วค่ะ\nเลขที่ใบเบิก: RB-2569-0007\nสถานะ: รออนุมัติ\nยอดรวม: 1,614.50 บาท');
  });

  it('turns each refusal into one sentence and keeps the code out of the reply', () => {
    assert.equal(draft({ status: 'blocked', errorCode: 'rate_limited', retryAfter: 300 }), 'ขอดูร่างใบเบิกถี่เกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ');
    assert.equal(draft({ status: 'blocked', errorCode: 'field_too_long', fieldPaths: ['reason'], limit: 1000 }),
      'เหตุผลการเบิก ยาวเกินไป (ไม่เกิน 1,000 ตัวอักษร) กรุณาย่อแล้วส่งใหม่ค่ะ');
    assert.equal(draft({ status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['lines.0.description', 'fieldPaths'] }),
      'ข้อมูลบางช่องยังไม่ถูกต้อง: รายละเอียด กรุณาตรวจแล้วส่งใหม่ค่ะ');
    assert.equal(draft({ status: 'blocked', errorCode: 'invalid_field', fieldPaths: ['activeAction'] }),
      'มีร่างใบเบิกที่ยังทำค้างอยู่ กรุณายืนยันหรือยกเลิกร่างเดิมก่อนเริ่มใบใหม่ค่ะ');
    assert.equal(draft({ status: 'blocked', errorCode: 'a_code_added_later' }), 'ยังทำรายการใบเบิกนี้ไม่ได้ กรุณาลองใหม่อีกครั้ง หรือทำรายการในเว็บค่ะ');
  });
});

describe('reimbursement choices speak to the customer (NAT04 2026-09-29)', () => {
  it('names missing fields in words, never paths', () => {
    const [message] = buildReimbursementDraftMessages({ status: 'needs_fields', actionId: 'a', actionRevision: 1,
      fieldPaths: ['fields.reason', 'lineChanges.0.values.amount'] }, 'https://web.test', 'company');
    assert.equal((message as any).canonicalText ?? (message as any).text, 'ร่างใบเบิกยังไม่ครบค่ะ ยังไม่ได้บันทึกอะไร ขอเพิ่ม: เหตุผลการเบิก, ยอดเงิน');
    const [empty] = buildReimbursementDraftMessages({ status: 'needs_fields', actionId: 'a', actionRevision: 1, fieldPaths: [] }, 'https://web.test', 'company');
    assert.doesNotMatch((empty as any).canonicalText ?? (empty as any).text, /กรุณาระบุ: $|ขอเพิ่ม/u);
    assert.match(draft({ status: 'needs_fields', actionId: 'a', actionRevision: 1, fieldPaths: ['fields.missingReceiptReason'] }), /ขอเพิ่ม: เหตุผลที่ไม่มีใบเสร็จ$/u);
  });

  it('offers only claimable bills once branch and requester are chosen, without category or file noise', () => {
    const message = buildReimbursementOptionsMessages({ selected: { branchChoiceId: 'b', requesterChoiceId: 'r' }, pages: {}, choices: [
      { kind: 'BRANCH', label: 'สำนักงานใหญ่ (BKK)' }, { kind: 'REQUESTER', label: 'คุณเอ' }, { kind: 'CATEGORY', label: 'อาหาร' },
      { kind: 'ATTACHMENT', label: 'receipt.png' },
      { kind: 'SOURCE', label: 'NAT-STN-002 · ร้านเครื่องเขียนบ้านกระดาษ', details: { eligible: true, incurredDate: '2026-09-26', amount: '380' } },
      { kind: 'SOURCE', label: 'EXP-1 · ปั๊มน้ำมัน', details: { eligible: false } },
      { kind: 'SOURCE', label: 'NAT-STN-001 · ร้านเครื่องเขียนสมใจ', details: { eligible: true, incurredDate: '2026-09-24', amount: '1245.5', currency: 'THB' } },
    ] })[0] as any;
    assert.match(message.text, /^เลือกบิลที่จะเบิก/u);
    assert.deepEqual(message.quickReply.items.map((item: any) => item.action.text), [
      'เบิกบิล NAT-STN-002 · ร้านเครื่องเขียนบ้านกระดาษ · 26 ก.ย. 2569 · 380.00 บาท',
      'เบิกบิล NAT-STN-001 · ร้านเครื่องเขียนสมใจ · 24 ก.ย. 2569 · 1,245.50 บาท', 'ขอเบิกรายการใหม่ ไม่มีบิลในระบบ']);
    assert.doesNotMatch(JSON.stringify(message), /ปั๊มน้ำมัน|สำนักงานใหญ่|คุณเอ|อาหาร|receipt\.png/u);
  });
});

/** Every string the customer can read — message text, alt/canonical text, flex text and button labels — but not
 *  postback data, which carries the exact action locator on purpose. */
const visible = (value: unknown): string[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(visible)
  : Object.entries(value).flatMap(([key, item]) => typeof item === 'string' ? ['text', 'altText', 'canonicalText', 'label'].includes(key) ? [item] : [] : visible(item));
const MACHINE_TOKENS: Array<[string, RegExp]> = [
  ['cuid/uuid/hash-like id', /\b[a-z0-9]{20,}\b|[0-9a-f]{8}-[0-9a-f]{4}-/iu], ['DRAFT', /\bDRAFT\b/u], ['enum or code', /[A-Z_]{4,}/u],
  ['field path', /\w+\.\w+\.\d|\b[a-zA-Z]\w*\.(?:\d|[a-z]\w*\b)|\b[a-z]+[A-Z]\w*\b/u], ['snake_case code', /\b[a-z]+_[a-z_]+\b/u], ['3+ decimal amount', /\d\.\d{3,}/u], ['raw JSON', /[{}[\]"]/u],
];

describe('no customer-visible reimbursement text carries a machine token (Owner rule 2026-09-27/29)', () => {
  it('holds for every preview, receipt, status, refusal and option message', () => {
    const results: LineReimbursementDraftResult[] = [
      { status: 'preview', preview }, { status: 'preview', preview: update }, { status: 'preview', preview: withLines([noFile, ownFile, byBill]) },
      { status: 'preview', preview: { ...preview, warnings: ['a_warning_added_later'], after: { ...after, receiptRequirementStatus: 'A_STATUS_ADDED_LATER' } } },
      { status: 'preview', preview: { ...update, diff: [...update.diff, { fieldPath: 'aFieldAddedLater', before: { x: 1 }, after: { x: 2 } }] } },
      { status: 'applied', receipt: { schemaVersion: 1, actionId: ids.action, requestId: ids.request, committedState: 'DRAFT', amount: '1614.5000', currency: 'THB',
        confirmationDigest: ids.digest, currentState: 'A_STATE_ADDED_LATER' } },
      { status: 'needs_fields', actionId: ids.action, actionRevision: 1, fieldPaths: ['lineChanges.0.values.attachmentChoiceId', 'fields.title', 'somethingInternal'] },
      { status: 'needs_target', actionId: ids.action, actionRevision: 1 }, { status: 'cancelled', actionId: ids.action },
      { status: 'expired', actionId: ids.action }, { status: 'stale', actionId: ids.action, errorCode: 'state_not_editable' },
      { status: 'result_unknown', actionId: ids.action },
      ...['forbidden', 'feature_disabled', 'unsupported_channel', 'write_quiesced', 'invalid_provenance', 'evidence_overflow', 'field_too_long',
        'invalid_field', 'source_changed', 'invalid_source', 'state_not_editable', 'preview_not_fully_delivered', 'rate_limited', 'store_unavailable',
        'schema_unsupported', 'a_code_added_later'].map(errorCode => ({ status: 'blocked' as const, errorCode,
        fieldPaths: ['lines.0.categoryKey', 'expectedRequestUpdatedAt', 'activeAction'], limit: 80, retryAfter: 60 })),
    ];
    const options = buildReimbursementOptionsMessages({ pages: { source: { hasMore: true } }, choices: [
      { kind: 'BRANCH', label: 'สำนักงานใหญ่ (BKK)' }, { kind: 'TARGET', label: 'RB-2569-0007 · เดินทางพบลูกค้า', details: { amount: '1614.5000', currency: 'THB', status: 'DRAFT', lines: 2 } },
      { kind: 'LINE', label: `1. ค่าแท็กซี่ · ${formatClaimMoney('1234.5000', 'THB')}`, details: { lineNo: 1, amount: '1234.5000', categoryKey: 'travel', linked: false } },
      { kind: 'SOURCE', label: 'INV-0042 · ร้านเครื่องเขียนสมใจ', details: { eligible: true, incurredDate: '2026-09-26', amount: '380.0000', currency: 'THB' } }] });
    const texts = [...results.flatMap(result => visible(buildReimbursementDraftMessages(result, 'https://web.test', 'company'))), ...visible(options)];
    assert.ok(texts.length > 30);
    for (const raw of texts) {
      // The web link is kept as it is by design; "LINE" is the app's name.
      const shown = raw.replace(/https?:\/\/\S+/gu, '').replace(/\bLINE\b/gu, '');
      for (const [name, pattern] of MACHINE_TOKENS) assert.doesNotMatch(shown, pattern, `${name} in: ${raw}`);
      assert.doesNotMatch(shown, /\b(?:travel|supplies|THB)\b/u, `category key or currency code in: ${raw}`);
    }
  });
});

it('Z3 saved claim has a signed submit next step and its own web button in Thai and English', () => {
  for (const language of ['th', 'en'] as const) for (const permitted of [true, false]) for (const state of ['DRAFT', 'PENDING_APPROVAL']) {
    const message = buildReimbursementDraftMessages({ status: 'applied', receipt: { requestId: 'saved-claim', amount: '170', currency: 'THB', currentState: state } } as any,
      'https://web.test', 'company', permitted ? ['reimbursement.submit'] : [], 'saved-claim.signed-token', language)[0]!;
    assert.equal(message.type, 'flex'); if (message.type !== 'flex') throw new Error('expected card');
    assert.deepEqual(lineFlexBodyProblems(message.contents), []);
    const actions: any[] = [];
    const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (value.action) actions.push(value.action); Object.values(value).forEach(child => { if (child && typeof child === 'object') Array.isArray(child) ? child.forEach(visit) : visit(child); }); };
    visit(message.contents);
    const submit = actions.filter(action => action.type === 'postback');
    assert.equal(submit.length, Number(permitted && state === 'DRAFT'));
    if (submit.length) { assert.equal(submit[0].label, language === 'th' ? 'ส่งอนุมัติ' : 'Submit for approval'); assert.equal(new URLSearchParams(submit[0].data).get('token'), 'saved-claim.signed-token'); }
    const open = actions.find(action => action.type === 'uri');
    assert.equal(open.label, language === 'th' ? 'เปิดใบเบิก' : 'Open claim');
    assert.equal(open.uri, 'https://web.test/companies/company/reimbursements/saved-claim');
  }
});

it('Z4 shared card rows never end in picker separators, including the exact Starbucks UAT value', async () => {
  const { drawLineSystemCard, lineSystemCardSendable } = await import('./line-system-card-limits.logic');
  const values = ['261005-08-00190 · Starbucks Coffee ·', 'Starbucks Coffee | ', 'อาหาร •  '];
  const card = drawLineSystemCard({ mascot: 'general', header: { lines: ['ใบเบิก', 'ร่างใบเบิก'] }, rows: values.map(value => ({ label: 'รายการ', value })) }, 'https://web.test');
  assert.ok(card); assert.deepEqual(lineFlexBodyProblems(card), []);
  for (const text of lineSystemCardTexts(card)) assert.doesNotMatch(text, /[·•|]\s*$/u);
  assert.equal(lineSystemCardSendable({ mascot: 'general', header: { lines: ['ใบเบิก', 'ร่างใบเบิก'] }, rows: [{ label: 'รายการ', value: ' · | • ' }] }), false);
});
