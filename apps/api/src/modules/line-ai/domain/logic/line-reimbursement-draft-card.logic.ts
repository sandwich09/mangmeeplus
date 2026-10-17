import { lineDisplayDate, lineControlData, lineUiLabel, type LineReplyLanguage } from './line-language.logic';
import type { ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import type { LineReimbursementDraftResult, LineReimbursementDraftPreview, LineReimbursementDraftSnapshot } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import { normalizeReimbursementAmount } from '../../../reimbursements/domain/logic/reimbursement.logic';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { lineChoiceQuickReply } from './line-business-card.logic';
import { splitLineDeliveryText } from './line-delivery-plan.logic';
import { formatThaiDate } from './line-draft-update-card.logic';

type ClaimSnapshot = LineReimbursementDraftSnapshot;
type ClaimLine = ClaimSnapshot['lines'][number];

/** Owner rule (2026-09-27/29): the customer reads plain Thai — never an id, enum key, error code, field path or
 *  JSON — and money exact to the satang with separators ("1,234.50"), not the stored four-place decimal. */
function formatClaimAmount(value: unknown): string {
  const text = String(value ?? '');
  if (!/^\d{1,14}(?:\.\d{1,4})?$/u.test(text)) return '-';
  const [whole, fraction] = normalizeReimbursementAmount(text).split('.');
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}.${fraction!.slice(0, 2)}`;
}
const unit = (currency: unknown) => !currency || currency === 'THB' ? 'บาท' : String(currency);
export const formatClaimMoney = (value: unknown, currency: unknown, language: LineReplyLanguage = 'th') => `${formatClaimAmount(value)} ${language === 'en' && (!currency || currency === 'THB') ? 'THB' : unit(currency)}`;

const CLAIM_STATE_TEXT: Record<string, string> = { DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ถูกส่งกลับให้แก้',
  CANCELLED: 'ยกเลิก', FINANCE_REVIEW: 'รอตรวจสอบการเงิน', READY_FOR_PAYMENT: 'พร้อมจ่าย', PARTIALLY_PAID: 'จ่ายบางส่วน', PAID: 'จ่ายแล้ว', VOIDED: 'เพิกถอน' };
const RECEIPT_TEXT: Record<string, string> = { REQUIRED: 'ยังขาดใบเสร็จบางรายการ', ATTACHED: 'มีหลักฐานครบทุกรายการแล้ว',
  MISSING_WITH_REASON: 'บางรายการไม่มีใบเสร็จ และระบุเหตุผลไว้แล้ว', WAIVED_BY_POLICY: 'นโยบายบริษัทไม่บังคับแนบใบเสร็จ' };
/** null: the signature sentence at the end of the preview already says it. */
const WARNING_TEXT: Record<string, string | null> = { missing_receipt: 'บันทึกเป็นร่างได้ แต่ต้องแนบใบเสร็จให้ครบก่อนยื่นเบิก', signatures_invalidated: null };
const receiptText = (status: unknown) => RECEIPT_TEXT[String(status)] ?? 'กรุณาตรวจหลักฐานในเว็บ';
const categoryText = (item: { categoryLabel?: string }) => item.categoryLabel?.trim() || 'ยังไม่ได้เลือกหมวด';
/** The same test as the claim's evidence status (`isLineEvidenced`): a bill claimed by reference brings its own receipt,
 *  so its line never reads "ยังไม่มีไฟล์แนบ" beside "มีหลักฐานครบทุกรายการแล้ว" (2026-09-30). The web draft page says the same. */
const evidenceText = (line: ClaimLine) => line.attachmentId ? 'มีไฟล์แนบ' : line.linkedExpenseId ? 'ใช้ใบเสร็จจากบิลต้นทาง' : 'ยังไม่มีไฟล์แนบ';

/** A claimed bill as the customer knows it — document number, shop, date — never its record id. */
function sourceText(line: ClaimLine): string | undefined {
  if (!line.linkedExpenseId) return undefined;
  const source = line.sourceExpenseSnapshot as Partial<ReimbursementSourceSnapshot> | undefined;
  return [source?.certificate?.documentNumber ?? source?.seller?.documentNumber, source?.seller?.name,
    source?.expenseDate ? formatThaiDate(source.expenseDate) : undefined].filter(Boolean).join(' · ') || 'บิลที่เลือกไว้';
}

/** Changed fields in words, old → new (the MISSING_FIELD_LABELS idea); money carries its unit once at the end. */
type Field<T> = [label: string, render: (item: T) => string, money?: true];
const CLAIM_FIELDS: Record<string, Field<ClaimSnapshot>> = {
  title: ['หัวเรื่อง', claim => claim.title ?? '-'], reason: ['เหตุผล', claim => claim.reason],
  missingReceiptReason: ['เหตุผลที่ไม่มีใบเสร็จ', claim => claim.missingReceiptReason ?? '-'],
  amount: ['ยอดรวม', claim => formatClaimAmount(claim.amount), true],
  categoryKey: ['หมวดของใบเบิก', categoryText], categoryLabel: ['หมวดของใบเบิก', categoryText],
  incurredDate: ['วันที่ของใบเบิก', claim => formatThaiDate(claim.incurredDate)],
  receiptRequirementStatus: ['สถานะหลักฐาน', claim => receiptText(claim.receiptRequirementStatus)],
};
const LINE_FIELDS: Array<Field<ClaimLine>> = [['รายละเอียด', line => line.description], ['วันที่จ่าย', line => formatThaiDate(line.incurredDate)],
  ['วัตถุประสงค์', line => line.purpose ?? '-'], ['หมวด', categoryText], ['ยอดเงิน', line => formatClaimAmount(line.amount), true],
  ['หลักฐาน', evidenceText], ['บิลต้นทาง', line => sourceText(line) ?? '-']];
const change = <T>([label, render, money]: Field<T>, before: T, after: T, currency: string, where = '') =>
  render(before) === render(after) ? [] : [`${label}${where}: ${render(before)} → ${render(after)}${money ? ` ${unit(currency)}` : ''}`];

function lineChanges(before: ClaimLine[], after: ClaimLine[], currency: string): string[] {
  const prior = new Map(before.map(line => [line.lineNo, line])), out: string[] = [];
  for (const line of after) {
    const old = prior.get(line.lineNo); prior.delete(line.lineNo);
    if (!old) { out.push(`เพิ่มรายการที่ ${line.lineNo}: ${line.description} · ${formatClaimMoney(line.amount, currency)}`); continue; }
    out.push(...LINE_FIELDS.flatMap(field => change(field, old, line, currency, ` รายการที่ ${line.lineNo}`)));
    if (old.attachmentId && line.attachmentId && old.attachmentId !== line.attachmentId) out.push(`ไฟล์แนบ รายการที่ ${line.lineNo}: เปลี่ยนเป็นไฟล์ใหม่`);
  }
  return [...out, ...[...prior.values()].map(line => `ลบรายการที่ ${line.lineNo}: ${line.description} · ${formatClaimMoney(line.amount, currency)}`)];
}

function changeText(before: ClaimSnapshot, after: ClaimSnapshot, diff: LineReimbursementDraftPreview['diff']): string[] {
  const out = new Set<string>();
  for (const { fieldPath } of diff) {
    if (Object.hasOwn(CLAIM_FIELDS, fieldPath)) change(CLAIM_FIELDS[fieldPath]!, before, after, after.currency).forEach(line => out.add(line));
    else if (fieldPath === 'lines') {
      const lines = lineChanges(before.lines, after.lines, after.currency);
      (lines.length ? lines : ['รายละเอียดอื่นของรายการเบิกมีการเปลี่ยนแปลง']).forEach(line => out.add(line));
    } else if (fieldPath !== 'claimSignatures') out.add('ข้อมูลอื่นในใบเบิกมีการเปลี่ยนแปลง'); // claimSignatures: the closing signature sentence says it
  }
  return [...out];
}

function lineText(line: ClaimLine, currency: string): string {
  const source = sourceText(line);
  return [`รายการ ${line.lineNo}: ${line.description}`, `วันที่: ${formatThaiDate(line.incurredDate)} | หมวด: ${categoryText(line)}`,
    `วัตถุประสงค์: ${line.purpose ?? '-'}`, `จำนวน: ${formatClaimMoney(line.amount, currency)}`,
    `หลักฐาน: ${evidenceText(line)}${source ? ` | บิลต้นทาง: ${source}` : ''}`].join('\n');
}

/** Every resulting line, the complete change list and warnings, from the authorized domain snapshots — in words. */
export function reimbursementPreviewText(preview: LineReimbursementDraftPreview, language: LineReplyLanguage = 'th'): string {
  const after = preview.after;
  if (language === 'en') {
    const snapshot = (claim: ClaimSnapshot) => [
      `Requester: ${claim.requesterDisplayName}`, ...(claim.branchName ? [`Branch: ${claim.branchName}`] : []),
      `Status: ${lineUiLabel(CLAIM_STATE_TEXT[claim.status] ?? '', language)}`, `Title: ${claim.title ?? '-'}`,
      `Reason: ${claim.reason}`, `Missing receipt reason: ${claim.missingReceiptReason ?? '-'}`,
      ...claim.lines.flatMap(line => [`Item: ${line.description}`, `Date: ${lineDisplayDate(line.incurredDate, language)}`,
        `Category: ${lineUiLabel(line.categoryLabel?.trim() || 'Not selected', language)}`, `Purpose: ${line.purpose ?? '-'}`,
        `Amount: ${formatClaimMoney(line.amount, claim.currency, language)}`,
        `Evidence: ${line.attachmentId ? 'Attachment included' : line.linkedExpenseId ? 'Receipt from source expense' : 'No attachment'}`,
        ...(line.linkedExpenseId ? (() => { const source = line.sourceExpenseSnapshot as Partial<ReimbursementSourceSnapshot> | undefined;
          return [`Source expense: ${[source?.certificate?.documentNumber ?? source?.seller?.documentNumber, source?.seller?.name,
            source?.expenseDate ? lineDisplayDate(source.expenseDate, language) : undefined].filter(Boolean).join(' · ') || 'Selected expense'}`]; })() : [])]),
      `Calculated total: ${formatClaimMoney(claim.amount, claim.currency, language)}`,
      `Evidence status: ${{ REQUIRED: 'Some receipts are missing', ATTACHED: 'All items have evidence',
        MISSING_WITH_REASON: 'Missing receipts have reasons recorded', WAIVED_BY_POLICY: 'Receipts waived by company policy' }[claim.receiptRequirementStatus] ?? 'Review evidence on the web'}`,
    ];
    return [preview.operation === 'CREATE' ? 'Review new claim draft; it has not been saved.' : 'Review claim draft changes; they have not been saved.',
      ...(preview.before ? ['Before:', ...snapshot(preview.before), 'After:'] : []), ...snapshot(after),
      ...preview.warnings.flatMap(warning => warning === 'signatures_invalidated' ? [] : [warning === 'missing_receipt'
        ? 'You can save a draft; attach the missing receipts before submitting.' : 'Review the details and evidence before confirming.']),
      ...(after.signatureImpact === 'INVALIDATED' ? ['Existing signatures will be invalidated; sign again on the web.'] : []),
      'This button saves a draft only; it does not submit, approve, pay or post it.'].join('\n');
  }
  return [preview.operation === 'CREATE' ? 'ตรวจร่างใบเบิกใหม่ (ยังไม่ได้บันทึก)' : 'ตรวจการแก้ร่างใบเบิก (ยังไม่ได้บันทึก)',
    `ผู้เบิก: ${after.requesterDisplayName}`, ...(after.branchName ? [`สาขา: ${after.branchName}`] : []), `สถานะหลังบันทึก: ${CLAIM_STATE_TEXT[after.status]}`,
    `หัวเรื่อง: ${after.title ?? '-'}`, `เหตุผล: ${after.reason}`, `เหตุผลที่ไม่มีใบเสร็จ: ${after.missingReceiptReason ?? '-'}`,
    ...after.lines.map(line => lineText(line, after.currency)),
    `ยอดรวมที่ระบบคำนวณ: ${formatClaimMoney(after.amount, after.currency)}`, `สถานะหลักฐาน: ${receiptText(after.receiptRequirementStatus)}`,
    ...(preview.before ? ['การเปลี่ยนแปลงทั้งหมด:', ...changeText(preview.before, after, preview.diff)] : []),
    ...new Set(preview.warnings.flatMap(warning => {
      const text = Object.hasOwn(WARNING_TEXT, warning) ? WARNING_TEXT[warning] : 'กรุณาตรวจรายละเอียดและหลักฐานก่อนยืนยัน';
      return text ? [`ข้อควรตรวจ: ${text}`] : [];
    })),
    ...(after.signatureImpact === 'INVALIDATED' ? ['ลายเซ็นเดิมจะใช้ไม่ได้หลังแก้ไข ต้องลงนามใหม่ในเว็บ'] : []),
    'ปุ่มนี้บันทึกเป็นร่างเท่านั้น ยังไม่ได้ยื่น อนุมัติ จ่ายเงิน หรือลงบัญชี'].join('\n');
}

/** One plain sentence per blocked code. The code stays on the result for logs and audit, never in the reply. */
const BLOCKED_TEXT: Record<string, string> = {
  forbidden: 'คุณไม่มีสิทธิ์ทำรายการใบเบิกนี้ หรือบัญชี LINE ที่ผูกไว้เปลี่ยนไปแล้วค่ะ',
  feature_disabled: 'ตอนนี้ปิดการบันทึกร่างใบเบิกจาก LINE ชั่วคราว ทำรายการในเว็บได้ค่ะ',
  unsupported_channel: 'ทำรายการใบเบิกได้เฉพาะในแชตส่วนตัวค่ะ',
  write_quiesced: 'ระบบใบเบิกกำลังปรับปรุงชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่ค่ะ',
  invalid_provenance: 'ยังยืนยันที่มาของข้อมูลบางส่วนไม่ได้ กรุณาพิมพ์รายละเอียดการเบิกอีกครั้งค่ะ',
  evidence_overflow: 'รายละเอียดใบเบิกยาวเกินกว่าจะทำใน LINE ได้ กรุณาแบ่งเป็นหลายใบ หรือทำรายการในเว็บค่ะ',
  source_changed: 'บิลหรือไฟล์ที่เลือกมีการเปลี่ยนแปลง กรุณาตรวจร่างใหม่อีกครั้งค่ะ',
  invalid_source: 'บิลหรือไฟล์ที่เลือกใช้เบิกไม่ได้ กรุณาเลือกบิลหรือไฟล์อื่นค่ะ',
  state_not_editable: 'ใบเบิกนี้ไม่ได้เป็นร่างแล้ว จึงแก้จาก LINE ไม่ได้ค่ะ',
  preview_not_fully_delivered: 'รายละเอียดร่างยังส่งไม่ครบ จึงยังยืนยันไม่ได้ กรุณาขอดูร่างอีกครั้งค่ะ',
  rate_limited: 'ขอดูร่างใบเบิกถี่เกินไป กรุณารอสักครู่แล้วลองใหม่ค่ะ',
  store_unavailable: 'ตอนนี้ยังอ่านร่างใบเบิกไม่ได้ กรุณาลองใหม่อีกครั้งค่ะ',
  schema_unsupported: 'ร่างนี้ใช้ต่อไม่ได้แล้ว กรุณาเริ่มทำรายการใหม่ค่ะ',
};
function blockedText(result: Extract<LineReimbursementDraftResult, { status: 'blocked' }>): string {
  const labels = fieldLabels(result.fieldPaths ?? []).join(', ');
  if (result.errorCode === 'field_too_long') return `${labels || 'ข้อความบางช่อง'} ยาวเกินไป${result.limit ? ` (ไม่เกิน ${result.limit.toLocaleString('en-US')} ตัวอักษร)` : ''} กรุณาย่อแล้วส่งใหม่ค่ะ`;
  if (result.errorCode === 'invalid_field') return result.fieldPaths?.includes('activeAction')
    ? 'มีร่างใบเบิกที่ยังทำค้างอยู่ กรุณายืนยันหรือยกเลิกร่างเดิมก่อนเริ่มใบใหม่ค่ะ'
    : `ข้อมูลบางช่องยังไม่ถูกต้อง${labels ? `: ${labels}` : ''} กรุณาตรวจแล้วส่งใหม่ค่ะ`;
  return BLOCKED_TEXT[result.errorCode] ?? 'ยังทำรายการใบเบิกนี้ไม่ได้ กรุณาลองใหม่อีกครั้ง หรือทำรายการในเว็บค่ะ';
}

export function buildReimbursementDraftMessages(result: LineReimbursementDraftResult, webBaseUrl: string, companyId: string, permissions: readonly string[] = [], submitToken?: string, language: LineReplyLanguage = 'th'): LineReplyMessage[] {
  const en = language === 'en';
  if (result.status === 'preview') {
    const preview = result.preview, text = reimbursementPreviewText(preview, language);
    const parts = splitLineDeliveryText(text, 4500);
    const web = `${webBaseUrl.replace(/\/$/u, '')}/companies/${encodeURIComponent(companyId)}/reimbursements/draft-actions/${encodeURIComponent(preview.actionId)}`;
    if (parts.length > 4) return [{ type: 'text', text: en ? `Please review and confirm this long draft on the web.\n${web}` : `รายละเอียดร่างยาวเกินปุ่มยืนยัน LINE กรุณาตรวจทั้งหมดและยืนยันในเว็บ\n${web}` }];
    const data = (action: string) => new URLSearchParams({ action, actionId: preview.actionId,
      previewRevision: String(preview.previewRevision), confirmationDigest: preview.confirmationDigest, ...(en ? { language } : {}) }).toString();
    return [...parts.map(part => ({ type: 'text' as const, text: part.text })), { type: 'flex', altText: (en ? 'Confirm claim draft' : 'ยืนยันบันทึกร่างใบเบิก'), canonicalText: (en ? 'Save this claim as a draft, or cancel this proposal.' : 'ยืนยันบันทึกเฉพาะร่างใบเบิก หรือยกเลิกร่างที่กำลังตรวจ'),
      contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: (en ? 'Review all details before confirming.' : 'ตรวจครบแล้วจึงยืนยัน'), wrap: true }] },
        footer: { type: 'box', layout: 'vertical', contents: [
          { type: 'button', action: { type: 'postback', label: (en ? 'Save draft' : 'บันทึกเป็นร่าง'), data: data('reimbursement_draft_confirm') } },
          { type: 'button', action: { type: 'postback', label: (en ? 'Cancel proposal' : 'ยกเลิกร่างนี้'), data: data('reimbursement_draft_cancel') } },
        ] } } }];
  }
  if (result.status === 'applied') {
    // The claim's own document number once it has one; its internal id is never printed.
    const r = result.receipt, requestNo = typeof r.requestNo === 'string' ? r.requestNo : '';
    if (en) return [{ type: 'text', text: ['Claim draft saved.', ...(requestNo ? [`Claim number: ${requestNo}`] : []),
      `Total: ${formatClaimMoney(r.amount, r.currency, language)}`,
      `Current status: ${lineUiLabel(CLAIM_STATE_TEXT[String(r.currentState ?? r.committedState ?? 'DRAFT')] ?? 'Check the latest status on the web', language)}`,
      'This action did not submit, approve or pay the claim.'].join('\n'),
      ...(submitToken && permissions.includes('reimbursement.submit') && String(r.currentState ?? r.committedState ?? 'DRAFT') === 'DRAFT'
        ? { quickReply: { items: [{ type: 'action', action: { type: 'postback', label: 'Submit for approval',
          data: lineControlData(new URLSearchParams({ action: 'expense_action_submit', token: submitToken }).toString(), language) } }] } } : {}) }];
    return [{ type: 'text', text: ['บันทึกร่างใบเบิกแล้ว', ...(requestNo ? [`เลขที่ใบเบิก: ${requestNo}`] : []),
      `ยอด: ${formatClaimMoney(r.amount, r.currency)}`,
      `สถานะปัจจุบัน: ${CLAIM_STATE_TEXT[String(r.currentState ?? r.committedState ?? 'DRAFT')] ?? 'ตรวจสถานะล่าสุดได้ในเว็บ'}`,
      'ยังไม่ได้ยื่น อนุมัติ หรือจ่ายเงินโดยคำสั่งนี้'].join('\n'),
      ...(submitToken && permissions.includes('reimbursement.submit') && String(r.currentState ?? r.committedState ?? 'DRAFT') === 'DRAFT' ? { quickReply: { items: [{ type: 'action' as const,
        action: { type: 'postback' as const, label: 'ส่งอนุมัติ', data: new URLSearchParams({ action: 'expense_action_submit', token: submitToken }).toString() } }] } } : {}) }];
  }
  if (en) {
    const fieldNames: Array<[RegExp, string]> = [[/missingReceiptReason/u, 'missing receipt reason'], [/reason/u, 'claim reason'],
      [/title/u, 'title'], [/amount/u, 'amount'], [/incurredDate/u, 'payment date'], [/description/u, 'description'], [/purpose/u, 'purpose'],
      [/category/u, 'category'], [/attachment/u, 'evidence attachment'], [/linkedExpense/u, 'source expense'], [/branchChoiceId/u, 'branch'],
      [/requesterChoiceId/u, 'requester'], [/targetRef/u, 'claim to edit'], [/currency/u, 'currency'], [/lineChanges|lines/u, 'claim items']];
    const fields = 'fieldPaths' in result ? [...new Set((result.fieldPaths ?? []).flatMap(path => fieldNames.find(([pattern]) => pattern.test(path))?.[1] ?? []))] : [];
    const blocked: Record<string, string> = {
      forbidden: 'You cannot change this claim; ask the shop owner or an authorized administrator.',
      feature_disabled: 'Claim drafts are currently unavailable in LINE; please use the web app.',
      unsupported_channel: 'Please prepare claims in a private chat.', write_quiesced: 'Claims are temporarily unavailable; please try again shortly.',
      invalid_provenance: 'Some details could not be verified; please send the claim details again.',
      evidence_overflow: 'Please split the claim details into smaller requests.',
      field_too_long: 'Please shorten the claim details and send them again.', invalid_field: 'Please check the claim details and send them again.',
      rate_limited: 'Please wait a moment before requesting the draft again.', store_unavailable: 'The claim draft is unavailable; please try again.',
      schema_unsupported: 'This draft can no longer be continued; please start a new request.',
    };
    const text = result.status === 'needs_fields' ? `Nothing has been saved; please add ${fields.join(', ') || 'the missing claim details'}.`
      : result.status === 'needs_target' ? 'Please choose the claim to edit.'
        : result.status === 'cancelled' ? 'Draft collection or confirmation cancelled; any saved claim is kept.'
          : result.status === 'expired' ? 'This proposal has expired; please send a new request.'
            : result.status === 'stale' ? 'The claim has changed; please review its current draft again.'
              : result.status === 'result_unknown' ? 'The save result is unconfirmed; check the existing claim on the web before creating another.'
                : blocked[result.errorCode] ?? 'This claim action is unavailable; please try again or use the web app.';
    return [{ type: 'text', text }];
  }
  const text = result.status === 'needs_fields' ? reimbursementMissingText(result.fieldPaths)
    : result.status === 'needs_target' ? 'กรุณาเลือกใบเบิกที่ต้องการแก้ ระบบยังไม่ได้เลือกใบล่าสุดให้อัตโนมัติ'
      : result.status === 'cancelled' ? 'ยกเลิกการเก็บข้อมูลหรือการยืนยันร่างนี้แล้ว ไม่ได้ยกเลิกใบเบิกที่บันทึกไว้'
        : result.status === 'expired' ? 'ร่างที่รอยืนยันหมดอายุแล้ว กรุณาระบุคำขอใหม่'
          : result.status === 'stale' ? 'ข้อมูลหรือสถานะใบเบิกเปลี่ยนแล้ว กรุณาตรวจร่างฉบับปัจจุบันใหม่'
            : result.status === 'result_unknown' ? 'ยังตรวจสอบผลบันทึกไม่ได้ กรุณาตรวจใบเดิมในเว็บ ยังไม่ควรสร้างซ้ำ'
              : blockedText(result);
  return [{ type: 'text', text }];
}

/** NAT04 (2026-09-29): the customer reads field names, never paths such as `lineChanges.0.values.amount`.
 *  Specific names first: `missingReceiptReason` also contains `reason`. */
const MISSING_FIELD_LABELS: Array<[RegExp, string]> = [[/missingReceiptReason/u, 'เหตุผลที่ไม่มีใบเสร็จ'], [/reason/u, 'เหตุผลการเบิก'],
  [/title/u, 'หัวเรื่อง'], [/amount/u, 'ยอดเงิน'], [/incurredDate/u, 'วันที่จ่าย'], [/description/u, 'รายละเอียด'], [/purpose/u, 'วัตถุประสงค์'],
  [/category/u, 'หมวดค่าใช้จ่าย'], [/attachment/u, 'ไฟล์หลักฐาน'], [/linkedExpense/u, 'บิลที่จะเบิก'], [/branchChoiceId/u, 'สาขา'],
  [/requesterChoiceId/u, 'ผู้ขอเบิก'], [/targetRef/u, 'ใบเบิกที่จะแก้'], [/currency/u, 'สกุลเงิน'], [/lineChanges|lines/u, 'บิลหรือรายการที่จะเบิก']];
const fieldLabel = (path: string) => MISSING_FIELD_LABELS.find(([pattern]) => pattern.test(path))?.[1];
/** Internal paths with no customer meaning (e.g. `activeAction`, `fieldPaths`) are left out, never printed. */
const fieldLabels = (paths: string[]) => [...new Set(paths.flatMap(path => fieldLabel(path) ?? []))];
function reimbursementMissingText(fieldPaths: string[]): string {
  const labels = [...new Set(fieldPaths.map(path => fieldLabel(path) ?? 'ข้อมูลที่ขาด'))];
  return labels.length ? `ร่างใบเบิกยังไม่ครบค่ะ ยังไม่ได้บันทึกอะไร ขอเพิ่ม: ${labels.join(', ')}` : 'ร่างใบเบิกยังไม่ครบค่ะ ยังไม่ได้บันทึกอะไร';
}

/** Bounded server choices keep labels visible without turning them into final-mutation controls. A family the
 *  server already chose is not asked again, and bills are shown only when they can actually be claimed. */
export function buildReimbursementOptionsMessages(options: { choices: Array<{ choiceId?: string; kind: string; label: string; details?: Record<string, string | number | boolean | null> }>;
  pages: Partial<Record<string, { hasMore: boolean }>>; selected?: { branchChoiceId?: string; requesterChoiceId?: string; targetRef?: string };
  control?: { actionId: string; revision: string }; awaitingPhoto?: boolean;
  nonEditableTargets?: Array<{ label: string; webPath: string; canReopen: boolean; pending: boolean }>; reasonQuestion?: string; receiptNotice?: string; collection?: { lineChosen: boolean; receiptChosen: boolean; categoryChosen: boolean } }, webBaseUrl = '', language: LineReplyLanguage = 'th'): LineReplyMessage[] {
  if (language === 'en') return reimbursementOptionsEnglish(options, webBaseUrl);
  if (options.nonEditableTargets?.length) return options.nonEditableTargets.slice(0, 5).map(target => ({ type: 'text',
    text: target.canReopen ? target.pending
      ? 'ใบเบิกส่งอนุมัติแล้ว จึงต้องถอนกลับเป็นร่างในเว็บก่อนแก้ยอดค่ะ'
      : 'ใบเบิกถูกส่งกลับแล้ว จึงต้องเปิดเป็นร่างในเว็บก่อนแก้ยอดค่ะ'
      : 'ใบเบิกพ้นสถานะร่างแล้ว เปิดดูวิธีดำเนินการต่อในเว็บได้ค่ะ',
    quickReply: { items: [{ type: 'action', action: { type: 'uri', label: options.nonEditableTargets!.length > 1 ? Array.from(target.label).slice(0, 20).join('') : target.canReopen ? target.pending ? 'ถอนกลับเป็นร่าง' : 'เปิดเป็นร่าง' : 'เปิดใบเบิก',
      uri: `${webBaseUrl.replace(/\/$/u, '')}${target.webPath}` } }] },
  }));
  const choiceAction = (label: string, choice: string, text: string) => options.control
    ? { type: 'postback' as const, label: Array.from(label).slice(0, 20).join(''), displayText: text, data: new URLSearchParams({ action: 'reimbursement_choice', ...options.control, choice }).toString() }
    : { type: 'message' as const, label, text };
  const buttons = (text: string, choices: Array<{ label: string; text: string }>): LineReplyMessage[] => [{ type: 'text', text,
    quickReply: lineChoiceQuickReply(choices) }];
  for (const [kind, chosen, name] of [['BRANCH', options.selected?.branchChoiceId, 'สาขา'],
    ['REQUESTER', options.selected?.requesterChoiceId, 'ผู้ขอเบิก'], ['TARGET', options.selected?.targetRef, 'ใบเบิกที่จะแก้']] as const) {
    const choices = options.choices.filter(choice => choice.kind === kind);
    if (!chosen && choices.length) return buttons(`เลือก${name}ได้เลยค่ะ`, choices.slice(0, 12).map(choice => ({ label: choice.label, text: `เลือก${name} ${choice.label}` }))
      .concat(choices.length > 12 || options.pages[kind.toLowerCase()]?.hasMore ? [{ label: 'ค้นหาเพิ่มเติม', text: `ขอค้นหา${name}เพิ่มเติม` }] : []));
  }
  const bills = options.choices.filter(choice => choice.kind === 'SOURCE' && choice.details?.['eligible'] !== false);
  if (!options.collection?.lineChosen && bills.length) return buttons('เลือกบิลที่จะเบิก หรือเริ่มรายการใหม่ได้เลยค่ะ', [
    ...bills.slice(0, 4).map(choice => {
      const detail = [choice.label, typeof choice.details?.['incurredDate'] === 'string' ? formatThaiDate(choice.details['incurredDate']) : undefined,
        choice.details?.['amount'] ? formatClaimMoney(choice.details['amount'], choice.details['currency']) : undefined].filter(Boolean).join(' · ');
      const label = choice.details?.['description'] && choice.details?.['amount']
        ? `${Array.from(String(choice.details['description'])).slice(0, 9).join('')} ${formatClaimAmount(choice.details['amount'])}` : detail;
      return { label, text: `เบิกบิล ${detail}` };
    }), { label: 'รายการใหม่', text: 'ขอเบิกรายการใหม่ ไม่มีบิลในระบบ' },
  ]);
  if (!options.collection?.lineChosen) return [{ type: 'text', text: 'ขอรายละเอียดรายการ จำนวนเงิน และวันที่สำรองจ่ายเพื่อทำใบเบิกต่อค่ะ' }];
  if (!options.collection?.receiptChosen) return [{ type: 'text', text: 'ส่งรูปใบเสร็จ หรือเลือกไม่มีใบเสร็จเพื่อทำรายการต่อได้ค่ะ',
    quickReply: { items: [{ type: 'action', action: choiceAction('ส่งรูปใบเสร็จ', 'photo', 'ส่งรูปใบเสร็จสำหรับใบเบิกนี้') },
      { type: 'action', action: choiceAction('ไม่มีใบเสร็จ', 'no-receipt', 'ไม่มีใบเสร็จ ขอเบิกรายการใหม่นี้') }] } }];
  if (!options.collection?.categoryChosen) {
    const categories = options.choices.filter(choice => choice.kind === 'CATEGORY');
    if (categories.length) return [{ type: 'text', text: [options.receiptNotice, 'เลือกหมวดค่าใช้จ่ายได้เลยค่ะ'].filter(Boolean).join('\n'), quickReply: { items: categories.slice(0, 12).map(choice => ({ type: 'action' as const,
      action: choiceAction(choice.label, choice.choiceId ?? '', `เลือกหมวดค่าใช้จ่าย ${choice.label}`) })).concat(
        categories.length > 12 || options.pages.category?.hasMore ? [{ type: 'action', action: { type: 'message', label: 'ค้นหาหมวดเพิ่มเติม', text: 'ขอค้นหาหมวดค่าใช้จ่ายเพิ่มเติม' } }] : []) } }];
  }
  return options.reasonQuestion ? [{ type: 'text', text: options.reasonQuestion }] : [];
}

function reimbursementOptionsEnglish(options: Parameters<typeof buildReimbursementOptionsMessages>[0], webBaseUrl: string): LineReplyMessage[] {
  const buttons = (text: string, choices: Array<{ label: string; text: string }>): LineReplyMessage[] => [{ type: 'text', text, quickReply: lineChoiceQuickReply(choices) }];
  const choice = (label: string, value: string, text: string) => options.control
    ? { type: 'postback' as const, label: Array.from(label).slice(0, 20).join(''), displayText: text,
      data: lineControlData(new URLSearchParams({ action: 'reimbursement_choice', ...options.control, choice: value }).toString(), 'en') }
    : { type: 'message' as const, label, text };
  if (options.nonEditableTargets?.length) return options.nonEditableTargets.slice(0, 5).map(target => ({ type: 'text',
    text: target.canReopen ? 'Open this claim on the web and return it to draft before editing.' : 'This claim is no longer a draft; open it on the web for the next step.',
    quickReply: { items: [{ type: 'action', action: { type: 'uri', label: 'Open claim', uri: `${webBaseUrl.replace(/\/$/u, '')}${target.webPath}` } }] } }));
  for (const [kind, selected, label] of [['BRANCH', options.selected?.branchChoiceId, 'branch'], ['REQUESTER', options.selected?.requesterChoiceId, 'requester'],
    ['TARGET', options.selected?.targetRef, 'claim to edit']] as const) {
    const choices = options.choices.filter(entry => entry.kind === kind);
    if (!selected && choices.length) return buttons(`Please choose the ${label}.`, choices.slice(0, 12).map(entry => ({ label: entry.label, text: `Choose ${label}: ${entry.label}` }))
      .concat(choices.length > 12 || options.pages[kind.toLowerCase()]?.hasMore ? [{ label: 'Search more', text: `Find more ${label} choices` }] : []));
  }
  if (!options.collection?.lineChosen) {
    const bills = options.choices.filter(entry => entry.kind === 'SOURCE' && entry.details?.eligible !== false);
    return bills.length ? buttons('Choose an expense to claim, or start a new item.', [...bills.slice(0, 4).map(entry => ({ label: entry.label, text: `Claim expense: ${entry.label}` })),
      { label: 'New item', text: 'Start a new claim item without an existing expense' }])
      : [{ type: 'text', text: 'Please provide the item details, amount and date you paid.' }];
  }
  if (!options.collection?.receiptChosen) return [{ type: 'text', text: 'Send a receipt photo or choose no receipt to continue.', quickReply: { items: [
    { type: 'action', action: choice('Send receipt', 'photo', 'Send a receipt photo for this claim') },
    { type: 'action', action: choice('No receipt', 'no-receipt', 'No receipt for this new claim item') }] } }];
  if (!options.collection?.categoryChosen) {
    const categories = options.choices.filter(entry => entry.kind === 'CATEGORY');
    if (categories.length) return [{ type: 'text', text: 'Please choose the expense category.', quickReply: { items: categories.slice(0, 12).map(entry => ({ type: 'action',
      action: choice(lineUiLabel(entry.label, 'en'), entry.choiceId ?? '', `Choose expense category: ${entry.label}`) })) } }];
  }
  return options.reasonQuestion ? [{ type: 'text', text: options.reasonQuestion === 'ไม่มีใบเสร็จเพราะอะไรคะ' ? 'Why is the receipt missing?' : 'What was the business purpose of this claim?' }] : [];
}
