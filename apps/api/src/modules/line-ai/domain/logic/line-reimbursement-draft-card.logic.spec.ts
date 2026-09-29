import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReimbursementDraftMessages, buildReimbursementOptionsMessages, formatClaimMoney, reimbursementPreviewText } from './line-reimbursement-draft-card.logic';
import { parseLineReimbursementDraftControl } from '../../application/line-reimbursement-draft.service';
import type { LineReimbursementDraftPreview, LineReimbursementDraftResult, LineReimbursementDraftSnapshot } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
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

const text = (messages: ReturnType<typeof buildReimbursementDraftMessages>) => messages.map(message => (message as { text?: string }).text ?? '').join('\n');
const draft = (result: LineReimbursementDraftResult) => text(buildReimbursementDraftMessages(result, 'https://web.test', 'company'));

describe('LINE reimbursement preview speaks plain Thai (Owner rule 2026-09-27/29)', () => {
  it('names the branch, status, evidence, source bill and category in words, with amounts to the satang', () => {
    assert.equal(reimbursementPreviewText(preview), [
      'ตรวจร่างใบเบิกใหม่ (ยังไม่ได้บันทึก)', 'ผู้เบิก: คุณเอ', 'สาขา: สำนักงานใหญ่', 'สถานะหลังบันทึก: ร่าง', 'หัวเรื่อง: -', 'เหตุผล: เดินทางพบลูกค้า',
      'เหตุผลที่ไม่มีใบเสร็จ: -',
      'รายการ 1: ค่าแท็กซี่', 'วันที่: 27 ก.ย. 2569 | หมวด: ยังไม่ได้เลือกหมวด', 'วัตถุประสงค์: -', 'จำนวน: 1,234.50 บาท', 'หลักฐาน: ยังไม่มีไฟล์แนบ',
      'รายการ 2: ปากกาและแฟ้ม', 'วันที่: 26 ก.ย. 2569 | หมวด: วัสดุอุปกรณ์', 'วัตถุประสงค์: -', 'จำนวน: 380.00 บาท',
      'หลักฐาน: มีไฟล์แนบ | บิลต้นทาง: INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569',
      'ยอดรวมที่ระบบคำนวณ: 1,614.50 บาท', 'สถานะหลักฐาน: ยังขาดใบเสร็จบางรายการ',
      'ข้อควรตรวจ: บันทึกเป็นร่างได้ แต่ต้องแนบใบเสร็จให้ครบก่อนยื่นเบิก',
      'ปุ่มนี้บันทึกเป็นร่างเท่านั้น ยังไม่ได้ยื่น อนุมัติ จ่ายเงิน หรือลงบัญชี'].join('\n'));
    // A preview saved before the branch name existed still renders, just without the branch row.
    assert.doesNotMatch(reimbursementPreviewText({ ...preview, after: { ...after, branchName: undefined } }), /สาขา:/u);
  });

  it('lists every change as a Thai label with formatted old → new values', () => {
    const lines = reimbursementPreviewText(update).split('\n');
    const changes = lines.slice(lines.indexOf('การเปลี่ยนแปลงทั้งหมด:') + 1, lines.findIndex(line => line.startsWith('ข้อควรตรวจ')));
    assert.deepEqual(changes, [
      'เหตุผล: พบลูกค้า → เดินทางพบลูกค้า', 'ยอดรวม: 300.00 → 1,614.50 บาท', 'หมวดของใบเบิก: เดินทาง → หลายหมวด (2 รายการ)',
      'สถานะหลักฐาน: มีหลักฐานครบทุกรายการแล้ว → ยังขาดใบเสร็จบางรายการ',
      'หมวด รายการที่ 1: เดินทาง → ยังไม่ได้เลือกหมวด', 'ยอดเงิน รายการที่ 1: 300.00 → 1,234.50 บาท', 'หลักฐาน รายการที่ 1: มีไฟล์แนบ → ยังไม่มีไฟล์แนบ',
      'รายละเอียด รายการที่ 2: ค่าทางด่วน → ปากกาและแฟ้ม', 'วันที่จ่าย รายการที่ 2: 27 ก.ย. 2569 → 26 ก.ย. 2569', 'หมวด รายการที่ 2: ยังไม่ได้เลือกหมวด → วัสดุอุปกรณ์',
      'ยอดเงิน รายการที่ 2: 70.00 → 380.00 บาท', 'หลักฐาน รายการที่ 2: ยังไม่มีไฟล์แนบ → มีไฟล์แนบ',
      'บิลต้นทาง รายการที่ 2: - → INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569']);
    // The signature change is said once, by its own sentence, not as a diff row or a warning code.
    assert.equal(lines.filter(line => /ลายเซ็น/u.test(line)).length, 1);
    assert.ok(lines.includes('ลายเซ็นเดิมจะใช้ไม่ได้หลังแก้ไข ต้องลงนามใหม่ในเว็บ'));
  });

  it('says where each line\'s evidence comes from, and a line the claim counts as evidenced never reads "no file" (2026-09-30)', () => {
    const all = reimbursementPreviewText(withLines([noFile, ownFile, byBill])).split('\n');
    assert.deepEqual(all.filter(line => line.startsWith('หลักฐาน:')), ['หลักฐาน: ยังไม่มีไฟล์แนบ', 'หลักฐาน: มีไฟล์แนบ',
      'หลักฐาน: ใช้ใบเสร็จจากบิลต้นทาง | บิลต้นทาง: INV-0042 · ร้านเครื่องเขียนสมใจ · 26 ก.ย. 2569']);
    assert.ok(all.includes('สถานะหลักฐาน: ยังขาดใบเสร็จบางรายการ'));
    // The real-model run: a bill claimed by reference is the claim's whole evidence, and its line says so.
    for (const lines of [[byBill], [ownFile, byBill]]) {
      const shown = reimbursementPreviewText(withLines(lines));
      assert.match(shown, /\nสถานะหลักฐาน: มีหลักฐานครบทุกรายการแล้ว\n/u);
      assert.doesNotMatch(shown, /ยังไม่มีไฟล์แนบ|ข้อควรตรวจ/u);
    }
    assert.match(reimbursementPreviewText({ ...update, before: { ...after, lines: [byBill] }, after: { ...after, lines: [{ ...noFile, lineNo: 3 }] },
      diff: [{ fieldPath: 'lines' }], warnings: [] }), /\nหลักฐาน รายการที่ 3: ใช้ใบเสร็จจากบิลต้นทาง → ยังไม่มีไฟล์แนบ\n/u);
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
    assert.match(JSON.stringify(control), /"label":"บันทึกเป็นร่าง"/u);
  });

  it('oversized full preview links to authorized web review without a financial LINE control', () => {
    const large = { ...preview, after: { ...preview.after, lines: Array.from({ length: 50 }, (_, i) => ({ ...preview.after.lines[0]!, lineNo: i + 1, description: 'ก'.repeat(500) })) } };
    const messages = buildReimbursementDraftMessages({ status: 'preview', preview: large }, 'https://example.test', 'company');
    assert.equal(messages.length, 1); assert.equal(messages[0]!.type, 'text');
    assert.ok(JSON.stringify(messages).includes(`/reimbursements/draft-actions/${preview.actionId}`));
    assert.ok(!JSON.stringify(messages).includes('reimbursement_draft_confirm'));
  });
});

describe('reimbursement receipts and refusals speak plain Thai', () => {
  const receipt = { schemaVersion: 1, actionId: ids.action, operation: 'CREATE', requestId: ids.request, committedState: 'DRAFT', amount: '1614.5000',
    currency: 'THB', confirmationDigest: ids.digest, committedAt: '2026-09-30T01:00:00.000Z', appliedRequestUpdatedAt: '2026-09-30T01:00:00.000Z' };

  it('reports the saved claim by its document number, never its id, with the current state in words', () => {
    assert.equal(draft({ status: 'applied', receipt: { ...receipt, currentState: 'DRAFT' } }),
      'บันทึกร่างใบเบิกแล้ว\nยอด: 1,614.50 บาท\nสถานะปัจจุบัน: ร่าง\nยังไม่ได้ยื่น อนุมัติ หรือจ่ายเงินโดยคำสั่งนี้');
    assert.equal(draft({ status: 'applied', receipt: { ...receipt, currentState: 'PENDING_APPROVAL', requestNo: 'RB-2569-0007' } }),
      'บันทึกร่างใบเบิกแล้ว\nเลขที่ใบเบิก: RB-2569-0007\nยอด: 1,614.50 บาท\nสถานะปัจจุบัน: รออนุมัติ\nยังไม่ได้ยื่น อนุมัติ หรือจ่ายเงินโดยคำสั่งนี้');
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
    assert.equal((message as any).text, 'ร่างใบเบิกยังไม่ครบค่ะ ยังไม่ได้บันทึกอะไร ขอเพิ่ม: เหตุผลการเบิก, ยอดเงิน');
    const [empty] = buildReimbursementDraftMessages({ status: 'needs_fields', actionId: 'a', actionRevision: 1, fieldPaths: [] }, 'https://web.test', 'company');
    assert.doesNotMatch((empty as any).text, /กรุณาระบุ: $|ขอเพิ่ม/u);
    assert.match(draft({ status: 'needs_fields', actionId: 'a', actionRevision: 1, fieldPaths: ['fields.missingReceiptReason'] }), /ขอเพิ่ม: เหตุผลที่ไม่มีใบเสร็จ$/u);
  });

  it('offers only claimable bills once branch and requester are chosen, without category or file noise', () => {
    const text = (buildReimbursementOptionsMessages({ selected: { branchChoiceId: 'b', requesterChoiceId: 'r' }, pages: {}, choices: [
      { kind: 'BRANCH', label: 'สำนักงานใหญ่ (BKK)' }, { kind: 'REQUESTER', label: 'คุณเอ' }, { kind: 'CATEGORY', label: 'อาหาร' },
      { kind: 'ATTACHMENT', label: 'receipt.png' },
      { kind: 'SOURCE', label: 'NAT-STN-002 · ร้านเครื่องเขียนบ้านกระดาษ', details: { eligible: true, incurredDate: '2026-09-26', amount: '380' } },
      { kind: 'SOURCE', label: 'EXP-1 · ปั๊มน้ำมัน', details: { eligible: false } },
      { kind: 'SOURCE', label: 'NAT-STN-001 · ร้านเครื่องเขียนสมใจ', details: { eligible: true, incurredDate: '2026-09-24', amount: '1245.5', currency: 'THB' } },
    ] })[0] as any).text as string;
    assert.match(text, /^เลือกบิลที่จะเบิก/u);
    assert.match(text, /1\) NAT-STN-002 · ร้านเครื่องเขียนบ้านกระดาษ · 26 ก\.ย\. 2569 · 380\.00 บาท\n2\) NAT-STN-001 · ร้านเครื่องเขียนสมใจ · 24 ก\.ย\. 2569 · 1,245\.50 บาท/u);
    assert.doesNotMatch(text, /ปั๊มน้ำมัน|สำนักงานใหญ่|คุณเอ|อาหาร|receipt\.png/u);
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
