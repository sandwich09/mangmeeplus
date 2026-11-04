import { lineDisplayDate, lineControlData, lineUiLabel, type LineReplyLanguage } from './line-language.logic';
import type { ReimbursementSourceSnapshot } from '@watchdog-bms/contracts';
import type { LineReimbursementDraftResult, LineReimbursementDraftPreview, LineReimbursementDraftSnapshot } from '../../../reimbursements/application/use-cases/line-reimbursement-draft.use-case';
import { normalizeReimbursementAmount } from '../../../reimbursements/domain/logic/reimbursement.logic';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';
import { asCompleteLineCard, buildLineSystemTextCardMessage, lineChoiceQuickReply } from './line-business-card.logic';
import { drawLineSystemCard } from './line-system-card-limits.logic';
import type { LineSystemCardRow } from './line-system-card.logic';
import { lineMessagePreview } from './line-message-preview.logic';
import { formatThaiDate } from './line-draft-update-card.logic';

export const REIMBURSEMENT_DRAFT_CHANGED = {
  th: 'ข้อมูลหรือสถานะใบเบิกเปลี่ยนแล้ว กรุณาตรวจร่างฉบับปัจจุบันใหม่',
  en: 'The claim has changed; please review its current draft again.',
};

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

/** Facts from the authorized snapshot, never empty form fields. */
function previewRows(claim: ClaimSnapshot, language: LineReplyLanguage): LineSystemCardRow[] {
  const en = language === 'en', rows: LineSystemCardRow[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value?.trim() && value.trim() !== '-') rows.push({ label, value: value.trim() });
  };
  add(en ? 'Requester' : 'ผู้เบิก', claim.requesterDisplayName);
  add(en ? 'Branch' : 'สาขา', /^(head office|สำนักงานใหญ่)$/iu.test(claim.branchName?.trim() ?? '')
    ? en ? 'Head Office' : 'สำนักงานใหญ่' : claim.branchName);
  add(en ? 'Title' : 'หัวเรื่อง', claim.title);
  add(en ? 'Reason' : 'เหตุผล', claim.reason);
  add(en ? 'Missing receipt reason' : 'เหตุผลที่ไม่มีใบเสร็จ', claim.missingReceiptReason);
  for (const line of claim.lines) {
    const source = line.sourceExpenseSnapshot as Partial<ReimbursementSourceSnapshot> | undefined;
    const bill = [source?.certificate?.documentNumber ?? source?.seller?.documentNumber, source?.seller?.name].filter(Boolean).join(' · ');
    const evidence = line.linkedExpenseId ? `${en ? 'Receipt from expense' : 'ใบเสร็จจากบิล'}${bill ? ` ${bill}` : ''}`
      : line.attachmentId ? en ? 'Attachment included' : 'มีไฟล์แนบ' : en ? 'Receipt missing' : 'ยังไม่มีใบเสร็จ';
    const facts: LineSystemCardRow[] = [
      { label: en ? 'Item' : 'รายการ', value: line.description },
      { label: en ? 'Date' : 'วันที่', value: lineDisplayDate(line.incurredDate, language) },
      ...(line.categoryLabel?.trim() ? [{ label: en ? 'Category' : 'หมวด', value: lineUiLabel(line.categoryLabel, language) }] : []),
      ...(line.purpose?.trim() ? [{ label: en ? 'Purpose' : 'วัตถุประสงค์', value: line.purpose }] : []),
      { label: en ? 'Evidence' : 'หลักฐาน', value: evidence },
    ];
    if (claim.lines.length === 1) rows.push(...facts.filter(row => row.value.trim() && row.value.trim() !== '-'));
    else rows.push({ label: `${en ? 'Item' : 'รายการ'} ${line.lineNo}`, value: [line.description, formatClaimMoney(line.amount, claim.currency, language),
      ...facts.slice(1).map(row => `${row.label}: ${row.value}`)].join(' · ') });
  }
  rows.push({ label: en ? 'Total' : 'ยอดรวม', value: formatClaimMoney(claim.amount, claim.currency, language), total: true });
  return rows;
}

function previewNotes(preview: LineReimbursementDraftPreview, language: LineReplyLanguage): string[] {
  const en = language === 'en';
  return [en ? 'Not saved yet.' : 'ยังไม่ได้บันทึกค่ะ',
    ...(preview.warnings.includes('missing_receipt') ? [en ? 'Attach the missing receipts before submitting.' : 'แนบใบเสร็จที่ขาดก่อนส่งอนุมัติค่ะ'] : []),
    ...(preview.after.signatureImpact === 'INVALIDATED' ? [en ? 'Existing signatures will be invalidated; sign again on the web.' : 'ลายเซ็นเดิมจะใช้ไม่ได้หลังแก้ไข ต้องเซ็นใหม่ในเว็บค่ะ'] : []),
    ...preview.warnings.filter(warning => !Object.hasOwn(WARNING_TEXT, warning)).map(() => en ? 'Review the details and evidence before saving.' : 'ตรวจรายละเอียดและหลักฐานก่อนบันทึกค่ะ')];
}

function previewChanges(preview: LineReimbursementDraftPreview, language: LineReplyLanguage): LineSystemCardRow[] {
  if (!preview.before) return [];
  if (language === 'th') return changeText(preview.before, preview.after, preview.diff).map(text => {
    const colon = text.indexOf(':');
    return colon < 0 ? { label: 'แก้ไข', value: text } : { label: text.slice(0, colon), value: text.slice(colon + 1).trim().replace(/(^| → )-(?= → |$)/gu, '$1ยังไม่ระบุ') };
  });
  const before = previewRows(preview.before, language), after = previewRows(preview.after, language);
  return [...new Set([...before, ...after].map(row => row.label))].flatMap(label => {
    const old = before.find(row => row.label === label)?.value, value = after.find(row => row.label === label)?.value;
    return old === value ? [] : [{ label: `Change: ${label}`, value: `${old ?? 'Not provided'} → ${value ?? 'Removed'}` }];
  });
}

export function reimbursementPreviewText(preview: LineReimbursementDraftPreview, language: LineReplyLanguage = 'th'): string {
  return [language === 'en' ? 'Claim draft' : 'ร่างใบเบิก', ...previewRows(preview.after, language).map(row => `${row.label}: ${row.value}`),
    ...previewChanges(preview, language).map(row => `${row.label}: ${row.value}`), ...previewNotes(preview, language)].join('\n');
}

function claimTextCard(message: LineReplyMessage, webBaseUrl: string, language: LineReplyLanguage): LineReplyMessage {
  if (message.type !== 'text') return message;
  const card = buildLineSystemTextCardMessage({ text: message.text, header: { lines: language === 'en' ? ['Claim', 'Claim draft'] : ['ใบเบิก', 'ร่างใบเบิก'] }, webBaseUrl, companyId: '', language });
  return card ? asCompleteLineCard({ ...card, ...(message.quickReply ? { quickReply: message.quickReply } : {}) }) : message;
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

function reimbursementDraftMessages(result: LineReimbursementDraftResult, webBaseUrl: string, companyId: string, permissions: readonly string[] = [], submitToken?: string, language: LineReplyLanguage = 'th', refusal?: { reply: string; webPath: string; webLabel: string }): LineReplyMessage[] {
  const en = language === 'en';
  if (result.status === 'preview') {
    const preview = result.preview, text = reimbursementPreviewText(preview, language);
    const web = `${webBaseUrl.replace(/\/$/u, '')}/companies/${encodeURIComponent(companyId)}/reimbursements/draft-actions/${encodeURIComponent(preview.actionId)}`;
    const data = (action: string) => new URLSearchParams({ action, actionId: preview.actionId,
      previewRevision: String(preview.previewRevision), confirmationDigest: preview.confirmationDigest, ...(en ? { language } : {}) }).toString();
    const contents = drawLineSystemCard({ mascot: 'general', header: { lines: en ? [preview.operation === 'UPDATE' ? 'Claim changes' : 'Claim', 'Claim draft'] : [preview.operation === 'UPDATE' ? 'แก้ไขใบเบิก' : 'ใบเบิก', 'ร่างใบเบิก'] },
      rows: [...previewRows(preview.after, language), ...previewChanges(preview, language)], notes: previewNotes(preview, language),
      choice: [
        { type: 'postback', label: en ? 'Save draft' : 'บันทึกร่าง', data: data('reimbursement_draft_confirm') },
        { type: 'postback', label: en ? 'Cancel draft' : 'ยกเลิกร่างนี้', data: data('reimbursement_draft_cancel') },
      ],
    }, webBaseUrl);
    if (contents) return [asCompleteLineCard({ type: 'flex', altText: lineMessagePreview(text, 400), canonicalText: text, contents })];
    // LINE has a 30 KB bubble limit; never offer a save control beside an incomplete preview.
    const handoff = en ? 'Review and save this draft on the web; its details exceed the LINE card limits.' : 'รายละเอียดร่างเกินขนาดการ์ด LINE เปิดตรวจและบันทึกในเว็บได้ค่ะ';
    const handoffCard = drawLineSystemCard({ mascot: 'general', header: { lines: en ? ['Claim draft', 'Review on the web'] : ['ร่างใบเบิก', 'ตรวจร่างในเว็บ'] },
      text: handoff, button: { icon: 'file', action: { type: 'uri', label: en ? 'Open claim draft' : 'เปิดร่างใบเบิก', uri: web } } }, webBaseUrl);
    return handoffCard ? [asCompleteLineCard({ type: 'flex', altText: handoff, canonicalText: `${handoff}\n${web}`, contents: handoffCard })]
      : [{ type: 'text', text: `${handoff}\n${web}` }];
  }
  if (result.status === 'applied') {
    const r = result.receipt, requestNo = typeof r.requestNo === 'string' ? r.requestNo : '';
    const status = lineUiLabel(CLAIM_STATE_TEXT[String(r.currentState ?? r.committedState ?? 'DRAFT')] ?? (en ? 'Check status on the web' : 'ตรวจสถานะในเว็บ'), language);
    return [{ type: 'text', text: [en ? 'Claim draft saved.' : 'บันทึกร่างใบเบิกแล้วค่ะ',
      ...(requestNo ? [`${en ? 'Claim number' : 'เลขที่ใบเบิก'}: ${requestNo}`] : []),
      `${en ? 'Status' : 'สถานะ'}: ${status}`, `${en ? 'Total' : 'ยอดรวม'}: ${formatClaimMoney(r.amount, r.currency, language)}`, ...(refusal ? [refusal.reply] : [])].join('\n'),
      ...(refusal ? { quickReply: { items: [{ type: 'action' as const, action: { type: 'uri' as const, label: refusal.webLabel, uri: `${webBaseUrl.replace(/\/$/u, '')}${refusal.webPath}` } }] } }
        : submitToken && permissions.includes('reimbursement.submit') && String(r.currentState ?? r.committedState ?? 'DRAFT') === 'DRAFT'
        ? { quickReply: { items: [{ type: 'action', action: { type: 'postback', label: en ? 'Submit for approval' : 'ส่งอนุมัติ',
          data: lineControlData(new URLSearchParams({ action: 'expense_action_submit', token: submitToken }).toString(), language) } }] } } : {}) }];
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
            : result.status === 'stale' ? REIMBURSEMENT_DRAFT_CHANGED.en
              : result.status === 'result_unknown' ? 'The save result is unconfirmed; check the existing claim on the web before creating another.'
                : blocked[result.errorCode] ?? 'This claim action is unavailable; please try again or use the web app.';
    return [{ type: 'text', text }];
  }
  const text = result.status === 'needs_fields' ? reimbursementMissingText(result.fieldPaths)
    : result.status === 'needs_target' ? 'กรุณาเลือกใบเบิกที่ต้องการแก้ ระบบยังไม่ได้เลือกใบล่าสุดให้อัตโนมัติ'
      : result.status === 'cancelled' ? 'ยกเลิกการเก็บข้อมูลหรือการยืนยันร่างนี้แล้ว ไม่ได้ยกเลิกใบเบิกที่บันทึกไว้'
        : result.status === 'expired' ? 'ร่างที่รอยืนยันหมดอายุแล้ว กรุณาระบุคำขอใหม่'
          : result.status === 'stale' ? REIMBURSEMENT_DRAFT_CHANGED.th
            : result.status === 'result_unknown' ? 'ยังตรวจสอบผลบันทึกไม่ได้ กรุณาตรวจใบเดิมในเว็บ ยังไม่ควรสร้างซ้ำ'
              : blockedText(result);
  return [{ type: 'text', text }];
}

export function buildReimbursementDraftMessages(...args: Parameters<typeof reimbursementDraftMessages>): LineReplyMessage[] {
  const [result, webBaseUrl, companyId, , , language = 'th', refusal] = args;
  return reimbursementDraftMessages(...args).map(message => {
    if (result.status === 'applied' && message.type === 'text') {
      const r = result.receipt, en = language === 'en';
      const rows = [
        ...(typeof r.requestNo === 'string' && r.requestNo ? [{ label: en ? 'Claim number' : 'เลขที่ใบเบิก', value: r.requestNo }] : []),
        { label: en ? 'Status' : 'สถานะ', value: lineUiLabel(CLAIM_STATE_TEXT[String(r.currentState ?? r.committedState ?? 'DRAFT')] ?? 'ตรวจสถานะล่าสุดในเว็บ', language) },
        { label: en ? 'Total' : 'ยอดรวม', value: formatClaimMoney(r.amount, r.currency, language), total: true },
      ];
      const web = `${webBaseUrl.replace(/\/$/u, '')}/companies/${encodeURIComponent(companyId)}/reimbursements/${encodeURIComponent(String(r.requestId))}`;
      const submit = message.quickReply?.items[0]?.action;
      const open = { type: 'uri' as const, label: en ? 'Open claim' : 'เปิดใบเบิก', uri: web };
      const repair = refusal ? { type: 'uri' as const, label: refusal.webLabel, uri: `${webBaseUrl.replace(/\/$/u, '')}${refusal.webPath}` } : open;
      const contents = drawLineSystemCard({ mascot: 'general', header: { lines: en ? ['Claim draft', 'Draft saved'] : ['ร่างใบเบิก', 'บันทึกแล้ว'] }, rows,
        ...(refusal ? { notes: [refusal.reply] } : {}),
        ...(submit?.type === 'postback' ? { choice: [submit, open] as const }
          : refusal && repair.uri !== open.uri ? { choice: [repair, open] as const } : { button: { icon: 'file' as const, action: repair } }) }, webBaseUrl);
      if (contents) return asCompleteLineCard({ type: 'flex', altText: lineMessagePreview(message.text, 400), canonicalText: message.text, contents, ...(message.quickReply ? { quickReply: message.quickReply } : {}) });
    }
    return claimTextCard(message, webBaseUrl, language);
  });
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
function reimbursementOptionsMessages(options: { choices: Array<{ choiceId?: string; kind: string; label: string; details?: Record<string, string | number | boolean | null> }>;
  pages: Partial<Record<string, { hasMore: boolean }>>; selected?: { branchChoiceId?: string; requesterChoiceId?: string; targetRef?: string };
  operation?: 'CREATE' | 'UPDATE';
  lineQuestion?: { text: string; amountChoices: Array<{ label: string; text: string }> };
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
  const buttons = (text: string, choices: Array<{ label: string; text: string; choice?: string }>): LineReplyMessage[] => [{ type: 'text', text,
    quickReply: options.operation === 'CREATE' && options.control
      ? { items: choices.map(item => ({ type: 'action' as const, action: item.choice ? choiceAction(item.label, item.choice, item.text)
        : { type: 'message' as const, label: item.label, text: item.text } })) } : lineChoiceQuickReply(choices) }];
  for (const [kind, chosen, name] of [['BRANCH', options.selected?.branchChoiceId, 'สาขา'],
    ['REQUESTER', options.selected?.requesterChoiceId, 'ผู้ขอเบิก'], ['TARGET', options.selected?.targetRef, 'ใบเบิกที่จะแก้']] as const) {
    const choices = options.choices.filter(choice => choice.kind === kind);
    if (!chosen && choices.length) return buttons(`เลือก${name}ได้เลยค่ะ`, choices.slice(0, 12).map(choice => ({ label: choice.label, text: `เลือก${name} ${choice.label}`, ...(kind !== 'TARGET' ? { choice: choice.choiceId } : {}) }))
      .concat(choices.length > 12 || options.pages[kind.toLowerCase()]?.hasMore ? [{ label: 'ค้นหาเพิ่มเติม', text: `ขอค้นหา${name}เพิ่มเติม` }] : []));
  }
  const bills = options.choices.filter(choice => choice.kind === 'SOURCE' && choice.details?.['eligible'] !== false);
  if (!options.collection?.lineChosen && !options.lineQuestion && bills.length) return buttons('เลือกบิลที่จะเบิก หรือเริ่มรายการใหม่ได้เลยค่ะ', [
    ...bills.slice(0, 4).map(choice => {
      const detail = [choice.label, typeof choice.details?.['incurredDate'] === 'string' ? formatThaiDate(choice.details['incurredDate']) : undefined,
        choice.details?.['amount'] ? formatClaimMoney(choice.details['amount'], choice.details['currency']) : undefined].filter(Boolean).join(' · ');
      const label = choice.details?.['description'] && choice.details?.['amount']
        ? `${Array.from(String(choice.details['description'])).slice(0, 9).join('')} ${formatClaimAmount(choice.details['amount'])}` : detail;
      return { label, text: `เบิกบิล ${detail}`, choice: choice.choiceId };
    }), { label: 'รายการใหม่', text: 'ขอเบิกรายการใหม่ ไม่มีบิลในระบบ', choice: 'new-line' },
  ]);
  if (!options.collection?.lineChosen && options.lineQuestion) return [{ type: 'text', text: options.lineQuestion.text,
    ...(options.lineQuestion.amountChoices.length ? { quickReply: lineChoiceQuickReply(options.lineQuestion.amountChoices) } : {}) }];
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
  const choice = (label: string, value: string, text: string) => options.control
    ? { type: 'postback' as const, label: Array.from(label).slice(0, 20).join(''), displayText: text,
      data: lineControlData(new URLSearchParams({ action: 'reimbursement_choice', ...options.control, choice: value }).toString(), 'en') }
    : { type: 'message' as const, label, text };
  const buttons = (text: string, choices: Array<{ label: string; text: string; choice?: string }>): LineReplyMessage[] => [{ type: 'text', text,
    quickReply: options.operation === 'CREATE' && options.control
      ? { items: choices.map(item => ({ type: 'action' as const, action: item.choice ? choice(item.label, item.choice, item.text)
        : { type: 'message' as const, label: item.label, text: item.text } })) } : lineChoiceQuickReply(choices) }];
  if (options.nonEditableTargets?.length) return options.nonEditableTargets.slice(0, 5).map(target => ({ type: 'text',
    text: target.canReopen ? 'Open this claim on the web and return it to draft before editing.' : 'This claim is no longer a draft; open it on the web for the next step.',
    quickReply: { items: [{ type: 'action', action: { type: 'uri', label: 'Open claim', uri: `${webBaseUrl.replace(/\/$/u, '')}${target.webPath}` } }] } }));
  for (const [kind, selected, label] of [['BRANCH', options.selected?.branchChoiceId, 'branch'], ['REQUESTER', options.selected?.requesterChoiceId, 'requester'],
    ['TARGET', options.selected?.targetRef, 'claim to edit']] as const) {
    const choices = options.choices.filter(entry => entry.kind === kind);
    if (!selected && choices.length) return buttons(`Please choose the ${label}.`, choices.slice(0, 12).map(entry => ({ label: entry.label, text: `Choose ${label}: ${entry.label}`, ...(kind !== 'TARGET' ? { choice: entry.choiceId } : {}) }))
      .concat(choices.length > 12 || options.pages[kind.toLowerCase()]?.hasMore ? [{ label: 'Search more', text: `Find more ${label} choices` }] : []));
  }
  if (!options.collection?.lineChosen && options.lineQuestion) return [{ type: 'text', text: options.lineQuestion.text,
    ...(options.lineQuestion.amountChoices.length ? { quickReply: lineChoiceQuickReply(options.lineQuestion.amountChoices) } : {}) }];
  if (!options.collection?.lineChosen) {
    const bills = options.choices.filter(entry => entry.kind === 'SOURCE' && entry.details?.eligible !== false);
    return bills.length ? buttons('Choose an expense to claim, or start a new item.', [...bills.slice(0, 4).map(entry => ({ label: entry.label, text: `Claim expense: ${entry.label}`, choice: entry.choiceId })),
      { label: 'New item', text: 'Start a new claim item without an existing expense', choice: 'new-line' }])
      : [{ type: 'text', text: 'Please provide the item details, amount and date you paid.' }];
  }
  if (!options.collection?.receiptChosen) return [{ type: 'text', text: 'Send a receipt photo or choose no receipt to continue.', quickReply: { items: [
    { type: 'action', action: choice('Send receipt', 'photo', 'Send a receipt photo for this claim') },
    { type: 'action', action: choice('No receipt', 'no-receipt', 'No receipt for this new claim item') }] } }];
  if (!options.collection?.categoryChosen) {
    const categories = options.choices.filter(entry => entry.kind === 'CATEGORY');
    if (categories.length) return [{ type: 'text', text: 'Please choose the expense category.', quickReply: { items: categories.slice(0, 12).map(entry => ({ type: 'action',
      action: choice(lineUiLabel(entry.label, 'en'), entry.choiceId ?? '', `Choose expense category: ${lineUiLabel(entry.label, 'en')}`) })) } }];
  }
  return options.reasonQuestion ? [{ type: 'text', text: options.reasonQuestion === 'ไม่มีใบเสร็จเพราะอะไรคะ' ? 'Why is the receipt missing?' : 'What was the business purpose of this claim?' }] : [];
}

export function buildReimbursementOptionsMessages(...args: Parameters<typeof reimbursementOptionsMessages>): LineReplyMessage[] {
  return reimbursementOptionsMessages(...args).map(message => claimTextCard(message, args[1] ?? '', args[2] ?? 'th'));
}
