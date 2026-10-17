import { lineUiLabel, lineDisplayDate, type LineReplyLanguage } from './line-language.logic';
import { EXPENSE_MANUAL_EDIT_HELP_TH, EXPENSE_READ_FAILED_HELP_TH, EXPENSE_READ_PARTIAL_HELP_TH, EXPENSE_STATUS_LABELS, SOURCE_DOCUMENT_TYPE_LABELS, scrubRecordIdentifier } from '@watchdog-bms/contracts';
import type { BusinessDocumentClassification } from '@watchdog-bms/contracts';
import type { LineExpenseDraftCardFacts } from './line-business-card.logic';

/**
 * Spec §18.4 NR01–NR09, as copy.
 *
 * ONE table, because the whole point of §18.4 is that the customer is told WHICH kind of document
 * they sent and what is still missing — a second copy of these sentences somewhere else is how two
 * lanes end up calling the same parcel label two different things. Every sentence here is the
 * spec's, character for character; the only interpolations are values the server has verified.
 *
 * "การจำแนกได้ว่าเป็นเอกสารอื่นเป็นผลอ่านสำเร็จ" (§18.4): NR01–NR08 are SUCCESSFUL reads and must
 * never borrow NR09's failure copy, which is why the read-outcome sentences sit in their own
 * function below.
 */
export type LineNonReceiptCase =
  | 'NR01' | 'NR02' | 'NR03' | 'NR04' | 'NR05_SLIP' | 'NR05_ORDER' | 'NR06' | 'NR07' | 'NR08';

/** The §18.4 CTA. Only for a case whose file is really persisted — never as a bare URL. */
export const CONTINUE_IN_WEB_LABEL = 'กรอกข้อมูลต่อ';

const continueTail = (link?: string, capturedDraft?: boolean): string => {
  if (!link) return '';
  // Appendix §25: on the LINE document lane the file is already an expense DRAFT, so the reply says
  // what exists. Claiming "ยังไม่ได้สร้างรายการ" over a draft the customer can open is the one thing
  // §18.4 forbids here.
  return capturedDraft
    ? `\nเก็บไฟล์ไว้ในรายการร่างแล้ว ยังไม่ยืนยัน ${EXPENSE_MANUAL_EDIT_HELP_TH}: ${link}`
    : `\n${EXPENSE_MANUAL_EDIT_HELP_TH}: ${link}`;
};

/** §10.2: the courier signals that split one `DELIVERY_NOTE` into NR01 vs NR02. */
export const PARCEL_LABEL_SIGNAL = 'PARCEL_LABEL_SIGNAL';
export const DEPOSIT_SLIP_SIGNAL = 'DEPOSIT_SLIP_SIGNAL';

const hasSignal = (classification: BusinessDocumentClassification, code: string): boolean =>
  (classification.missingRequiredSignals as readonly string[]).includes(code)
  || (classification.contradictionSignals as readonly string[]).includes(code);

/** NR03's "{ชนิดเอกสารที่ยืนยันได้}" — only kinds the classifier actually confirmed. */
const COMMERCIAL_DOCUMENT_LABEL_TH: Record<string, string> = {
  QUOTATION: 'ใบเสนอราคา',
  PURCHASE_ORDER: 'ใบสั่งซื้อ',
  DELIVERY_NOTE: 'ใบส่งของ',
};

/**
 * Which §18.4 row this classification is, or `null` when the document belongs to a lane that keeps
 * its own copy (a receipt, a check bill continuation, an unreadable image).
 *
 * `capturedExpense` is the server's answer to "is there an expense": §18.4 forbids the words
 * "ยังไม่ได้สร้างรายการ" on an append/replace of a record that already exists, so the caller passes
 * what it knows rather than this table guessing.
 */
export function classifyNonReceiptCase(
  classification: BusinessDocumentClassification | null | undefined,
): LineNonReceiptCase | null {
  if (!classification) return null;
  if (classification.contentKind === 'MULTI_DOCUMENT' || classification.contentKind === 'UNREADABLE') return null;
  switch (classification.documentKind) {
    case 'DELIVERY_NOTE':
      if (hasSignal(classification, PARCEL_LABEL_SIGNAL)) return 'NR01';
      if (hasSignal(classification, DEPOSIT_SLIP_SIGNAL)) return 'NR02';
      return 'NR03';
    case 'QUOTATION':
    case 'PURCHASE_ORDER':
      return 'NR03';
    case 'SUPPLIER_INVOICE_OR_BILL':
      return 'NR04';
    case 'TRANSFER_SLIP':
      return 'NR05_SLIP';
    case 'MARKETPLACE_ORDER':
      return 'NR05_ORDER';
    case 'ORDER_OR_CHECK_BILL':
      return 'NR06';
    case 'NON_FINANCIAL_IMAGE':
      return 'NR07';
    case 'NEEDS_REVIEW':
      return 'NR08';
    default:
      return classification.contentKind === 'AMBIGUOUS' ? 'NR08' : null;
  }
}

/** §18.4 rows that keep the bytes and therefore may offer the Web CTA (§18.4 "การเก็บและผูกงาน"). */
export const NON_RECEIPT_PERSISTING_CASES: readonly LineNonReceiptCase[] = ['NR01', 'NR02', 'NR03', 'NR08'];

export function nonReceiptReply(
  nr: LineNonReceiptCase,
  input: {
    language?: LineReplyLanguage;
    classification?: BusinessDocumentClassification | null;
    /** Only when the server verified it; §18.4 forbids an unverified amount in NR04. */
    amountLabel?: string;
    /** Present only when the bytes really are persisted for this user's own work. */
    captureLink?: string;
    /** Appendix §25: that link is an expense DRAFT, not a group waiting to be reviewed. */
    capturedDraft?: boolean;
  } = {},
): string {
  if (input.language === 'en') {
    const replies: Record<LineNonReceiptCase, string> = {
      NR01: `This is a parcel label without evidence of shipping payment; send the shipping receipt.${input.capturedDraft ? '' : ' No expense was created.'}`,
      NR02: 'This confirms parcel acceptance, but not shipping payment; send the shipping receipt.',
      NR03: 'This commercial document has insufficient expense details; send its invoice or receipt.',
      NR04: `This is an invoice${input.amountLabel ? ` for ${input.amountLabel} THB` : ''}; payment evidence is missing, so review it before saving.`,
      NR05_SLIP: 'This is a transfer slip; check what was paid and to whom.', NR05_ORDER: 'This is order evidence; check its items and payment status.',
      NR06: 'This shows the amount due, but does not confirm payment; have you paid?',
      NR07: 'This image is not an expense document; no expense was created, so please send the intended document.',
      NR08: 'The document type is unclear; please review it.',
    };
    return replies[nr] + (input.captureLink ? `\n${input.capturedDraft ? 'Review draft' : 'Continue on web'}: ${input.captureLink}` : '');
  }
  const tail = continueTail(input.captureLink, input.capturedDraft);
  switch (nr) {
    case 'NR01':
      // The "จึงยังไม่ได้สร้างรายการค่าใช้จ่าย" clause is TRUE only where nothing was created; with a
      // draft on the file it would contradict the link printed two words later.
      return (input.capturedDraft
        ? 'ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง '
        : 'ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง จึงยังไม่ได้สร้างรายการค่าใช้จ่าย ')
        + `หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ${tail}`;
    case 'NR02':
      return 'ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง '
        + `หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ${tail}`;
    case 'NR03': {
      const label = COMMERCIAL_DOCUMENT_LABEL_TH[input.classification?.documentKind ?? ''] ?? 'เอกสารการค้า';
      return `ใบนี้เป็น${label}ค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย `
        + `ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ${tail}`;
    }
    case 'NR04':
      // The amount is the only interpolation, and only when it was read: "ยอดที่ยืนยันได้".
      return input.amountLabel
        ? `ใบนี้เป็นใบแจ้งหนี้ ยอด ${input.amountLabel} บาทค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก`
        : 'ใบนี้เป็นใบแจ้งหนี้ค่ะ ยังไม่พบหลักฐานการชำระ กรุณาตรวจข้อมูลก่อนบันทึก';
    case 'NR05_SLIP':
      return 'พบสลิปโอนเงินค่ะ กรุณาตรวจว่าจ่ายค่าอะไรและให้ใคร';
    case 'NR05_ORDER':
      return 'พบหลักฐานคำสั่งซื้อค่ะ กรุณาตรวจรายการและสถานะชำระเงิน';
    case 'NR06':
      // The check-bill continuation owns its own three choices; this row exists so the table is
      // complete and a caller can never route a check bill anywhere else.
      return 'ใบนี้บอกยอดที่ต้องจ่าย แต่ยังไม่ยืนยันว่าร้านรับเงินแล้วค่ะ จ่ายเงินแล้วหรือยังคะ';
    case 'NR07':
      // No link and no persist: §18.4 forbids an expense pending for a non-business image.
      return 'ภาพนี้ไม่ใช่เอกสารค่าใช้จ่ายค่ะ จึงไม่ได้สร้างรายการ ส่งเอกสารค่าใช้จ่ายที่ต้องการบันทึกได้เลยค่ะ';
    case 'NR08':
      return `ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ${tail}`;
  }
}

// ── §17.6 / NR09 and the finished-read push (appendix §3 LINE column) ─────────

/** Thai reason for a read that stopped at a declared bound (appendix §4.5 `pausedReason`). */
export function capturePausedReasonTh(reason: string | null | undefined): string {
  switch (reason) {
    // Wave-2 credit wording, unchanged: one sentence for every ceiling that stops a read.
    case 'ai_credit': return 'เครดิตสำหรับการอ่านเอกสารไม่พอ';
    case 'page_limit': return 'เอกสารมีจำนวนหน้ามากกว่าที่ระบบอ่านอัตโนมัติได้';
    case 'call_budget': return 'ใช้รอบการอ่านของงานนี้ครบแล้ว';
    case 'time_budget': return 'ใช้เวลาอ่านนานเกินกว่าที่กำหนดไว้';
    case 'memory_budget': return 'ไฟล์ใหญ่เกินที่อ่านอัตโนมัติได้ในรอบเดียว';
    default: return 'ยังอ่านไม่ครบทุกหน้า';
  }
}

/** §17.6 exactly: "เก็บไฟล์ไว้แล้ว" is claimed only by a caller that has the persisted identity. */
export const CAPTURE_READ_FAILED_REPLY = (link: string, language: LineReplyLanguage = 'th'): string =>
  language === 'en' ? `The file is stored, but could not be read; review and enter its details on the web: ${link}` :
  `${EXPENSE_READ_FAILED_HELP_TH}\n${link}`;

export const CAPTURE_READ_PARTIAL_REPLY = (link: string, language: LineReplyLanguage = 'th'): string =>
  language === 'en' ? `The file is stored, but its reading is incomplete; review and complete the details on the web: ${link}` :
  `${EXPENSE_READ_PARTIAL_HELP_TH}\n${link}`;

export const CAPTURE_READ_PAUSED_REPLY = (link: string, pausedReason: string | null | undefined, language: LineReplyLanguage = 'th'): string =>
  language === 'en' ? `The file is stored, but reading is paused; review and enter its details on the web: ${link}` :
  `เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ (${capturePausedReasonTh(pausedReason)}) `
  + `${EXPENSE_MANUAL_EDIT_HELP_TH}\n${link}`;

/**
 * The DONE summary the LINE result push sends when the group stays a group.
 *
 * §3.2's auto-handoff replaces it with `formatCaptureAutoHandoffReply` below, for the
 * single-document/single-issuer/eligible case only. Everything else — multi-document, mixed
 * issuers, a classified non-receipt, blockers — keeps the group link here.
 */
export function formatCaptureReadFinishedReply(input: {
  language?: LineReplyLanguage;
  link: string;
  documentCount: number;
  issuerName?: string | null;
  documentTotal?: string | null;
}): string {
  if (input.language === 'en') return `Document reading finished: ${input.documentCount} document${input.documentCount === 1 ? '' : 's'}${input.issuerName?.trim() ? ` · ${input.issuerName.trim()}` : ''}${input.documentTotal?.trim() ? ` · Total ${input.documentTotal.trim()}` : ''}; review before creating expenses on the web: ${input.link}`;
  if (input.documentCount > 1) {
    return `📄 อ่านเอกสารแล้วค่ะ พบ ${input.documentCount} ฉบับ กรุณาตรวจการจัดกลุ่มในเว็บ: ${input.link}`;
  }
  const issuer = input.issuerName?.trim();
  const total = input.documentTotal?.trim();
  const found = [issuer ? `พบ ${issuer}` : 'พบเอกสาร 1 ฉบับ', total ? `ยอด ${total}` : '']
    .filter(Boolean).join(' ');
  return `📄 อ่านเอกสารแล้วค่ะ ${found} — ตรวจและสร้างรายการค่าใช้จ่ายในเว็บ: ${input.link}`;
}

/**
 * Appendix §25: one file held several documents, and the engine already made each of them its own
 * draft. The push names the count and links every record, because there is no group screen left to
 * send the customer to.
 */
export function formatCaptureSplitReply(input: {
  language?: LineReplyLanguage;
  documentCount: number;
  links: readonly string[];
}): string {
  if (input.language === 'en') return [`${input.documentCount} documents were read and expense drafts created; review them before confirming.`, ...input.links.map(link => `Review expense: ${link}`)].join('\n');
  return [
    `📄 อ่านเอกสารแล้วค่ะ พบเอกสาร ${input.documentCount} ใบ สร้างรายการให้แล้ว`,
    ...input.links.map((link, index) => `${index + 1}) ${link}`),
    'ยังไม่ยืนยันรายการ กรุณาตรวจในเว็บแอปค่ะ',
  ].join('\n');
}

/**
 * §17.5 for a capture group that has NOT become an expense: the status question is asked against
 * the expense list, and a group is not in it. Without this the honest-sounding "ยังไม่พบรายการ" is
 * wrong — the file was read, and the work is waiting on the web.
 */
export const captureGroupStatusReply = (link: string, reading: boolean): string => (reading
  ? `ไฟล์เมื่อกี้กำลังอ่านอยู่ค่ะ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้ ระหว่างนี้เปิดดูได้ที่: ${link}`
  : `ไฟล์เมื่อกี้อ่านแล้ว รอตรวจและสร้างรายการในเว็บ: ${link}`);

const CAPTURE_MONEY_FORMATTER = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Same user-facing date shape the receipt reply prints, e.g. 25 ก.ค. 2569. */
const CAPTURE_DATE_FORMATTER = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * §3.2: the auto-handoff's summary — the rows the LINE receipt card prints today
 * (`formatPaypersReply` compact), read off the derived source instead of the OCR result, and
 * pointing at the EXPENSE rather than the group. A row the source does not carry is left out
 * rather than printed as a placeholder that reads like a fact.
 */
type CaptureAutoHandoffReplyInput = {
  language?: LineReplyLanguage;
  link: string;
  vendorName?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  documentTypeLabel?: string | null;
  expenseDate?: Date | string | null;
  expenseId?: string;
  status?: string;
  documentNumber?: string | null;
  categoryName?: string | null;
  vatAmount?: string | null;
  vatMode?: string | null;
};

/** One reading for the file notice and the locked review card. Optional rows carry saved facts only;
 *  the text remains the original notice, including its link, for exact canonical fallback. */
export function formatCaptureAutoHandoffReply(input: CaptureAutoHandoffReplyInput): { text: string; draft?: LineExpenseDraftCardFacts } {
  if (input.language === 'en') {
    const total = input.amount != null && Number.isFinite(Number(input.amount)) ? `${CAPTURE_MONEY_FORMATTER.format(Number(input.amount))} ${input.currency ?? 'THB'}` : undefined;
    const date = input.expenseDate ? lineDisplayDate(input.expenseDate instanceof Date ? input.expenseDate.toISOString() : input.expenseDate, 'en') : undefined;
    const document = input.documentTypeLabel ? lineUiLabel(input.documentTypeLabel, 'en') : undefined;
    const note = 'This expense is a draft awaiting your confirmation.';
    const text = ['Document read and expense draft saved.', input.vendorName ? `Seller: ${input.vendorName}` : undefined,
      `Total: ${total ?? 'Not yet read'}`, `Date: ${date ?? 'Not provided; please enter the document date'}`, document ? `Document: ${document}` : undefined,
      note, `Review expense: ${input.link}`].filter(Boolean).join('\n');
    if (!input.expenseId || !['DRAFT', 'NEEDS_REVIEW'].includes(input.status ?? '')) return { text };
    const row = (label: string, value: string | null | undefined, extra = {}) => value ? [{ label, value, ...extra }] : [];
    return { text, draft: { expenseId: input.expenseId, subject: 'Document details', rows: [
      ...row('Seller / shop', input.vendorName), ...row('Document date', date), ...row('Document number', scrubRecordIdentifier(input.documentNumber ?? null, 40)),
      ...row('Document type', document), ...row('Expense category', input.categoryName), ...row('Total', total, { total: true }),
      ...(input.vatMode !== 'NO_VAT' && input.vatMode !== 'EXEMPT' && input.vatAmount && Number(input.vatAmount) > 0 ? row('VAT', `${CAPTURE_MONEY_FORMATTER.format(Number(input.vatAmount))} THB`) : []),
      { label: 'Document status', value: input.status === 'DRAFT' ? 'Draft' : 'Needs review', pill: 'pending' }], notes: [note, ...(!date ? ['Please enter the document date.'] : [])] } };
  }
  const amount = input.amount === null || input.amount === undefined || !Number.isFinite(Number(input.amount))
    ? null : Number(input.amount);
  const date = input.expenseDate ? new Date(input.expenseDate) : null;
  const vendor = input.vendorName?.trim();
  const amountLabel = amount === null ? null : `${CAPTURE_MONEY_FORMATTER.format(amount)}${input.currency && input.currency !== 'THB' ? ` ${input.currency}` : ' บาท'}`;
  const dateLabel = date && !Number.isNaN(date.getTime()) ? CAPTURE_DATE_FORMATTER.format(date) : null;
  const note = 'ยังไม่ยืนยันรายการ';
  const text = [
    '🧾 อ่านเอกสารแล้ว บันทึกเป็นร่างรายการให้แล้วค่ะ',
    ...(vendor ? [`ร้าน: ${vendor}`] : []),
    `ยอดในใบเสร็จ: ${amountLabel ?? 'ยังอ่านยอดไม่ได้'}`,
    ...(input.documentTypeLabel ? [`ประเภทเอกสาร: ${input.documentTypeLabel}`] : []),
    `วันที่: ${dateLabel ?? 'ยังไม่มีวันที่ กรุณาระบุวันที่เอกสารค่ะ'}`,
    note,
    '',
    `✅ ตรวจสอบและยืนยันในเว็บแอป:\n${input.link}`,
  ].join('\n');
  if (!input.expenseId || !['DRAFT', 'NEEDS_REVIEW'].includes(input.status ?? '')) return { text };
  const row = (label: string, value: string | null | undefined, extra: Partial<LineExpenseDraftCardFacts['rows'][number]> = {}) =>
    value ? [{ label, value, ...extra }] : [];
  const vat = input.vatMode !== 'NO_VAT' && input.vatMode !== 'EXEMPT' && input.vatAmount && Number.isFinite(Number(input.vatAmount)) && Number(input.vatAmount) > 0
    ? `${CAPTURE_MONEY_FORMATTER.format(Number(input.vatAmount))} บาท` : null;
  return { text, draft: {
    expenseId: input.expenseId,
    subject: input.documentTypeLabel === SOURCE_DOCUMENT_TYPE_LABELS.RECEIPT ? 'ข้อมูลใบเสร็จ' : 'ข้อมูลเอกสาร',
    rows: [
      ...row('ผู้ขาย / ร้านค้า', vendor),
      ...row('วันที่เอกสาร', dateLabel ?? 'ยังไม่มีวันที่'),
      ...row('เลขเอกสาร', scrubRecordIdentifier(input.documentNumber ?? null, 40)),
      ...row('ประเภทเอกสาร', input.documentTypeLabel),
      ...row('หมวดค่าใช้จ่าย', input.categoryName?.trim()),
      ...row('ยอดรวม', amountLabel, { total: true }),
      ...row('ภาษีมูลค่าเพิ่ม', vat),
      { label: 'สถานะเอกสาร', value: EXPENSE_STATUS_LABELS[input.status as 'DRAFT' | 'NEEDS_REVIEW'], pill: 'pending' },
    ], notes: [note, ...(!dateLabel ? ['กรุณาระบุวันที่เอกสารค่ะ'] : [])],
  } };
}
