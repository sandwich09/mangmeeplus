import type { BusinessDocumentClassification } from '@watchdog-bms/contracts';

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

const continueTail = (link?: string): string => (link ? `\n${CONTINUE_IN_WEB_LABEL}ได้ที่นี่: ${link}` : '');

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
    classification?: BusinessDocumentClassification | null;
    /** Only when the server verified it; §18.4 forbids an unverified amount in NR04. */
    amountLabel?: string;
    /** Present only when the bytes really are persisted for this user's own work. */
    captureLink?: string;
  } = {},
): string {
  switch (nr) {
    case 'NR01':
      return 'ใบนี้เป็นใบปะหน้าพัสดุค่ะ ยังไม่พบหลักฐานการจ่ายค่าส่ง จึงยังไม่ได้สร้างรายการค่าใช้จ่าย '
        + `หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ${continueTail(input.captureLink)}`;
    case 'NR02':
      return 'ใบนี้ยืนยันการรับฝากพัสดุค่ะ แต่ยังไม่พบข้อมูลการจ่ายค่าส่ง '
        + `หากมีใบเสร็จค่าส่ง ส่งเพิ่มได้เลยค่ะ${continueTail(input.captureLink)}`;
    case 'NR03': {
      const label = COMMERCIAL_DOCUMENT_LABEL_TH[input.classification?.documentKind ?? ''] ?? 'เอกสารการค้า';
      return `ใบนี้เป็น${label}ค่ะ ยังมีข้อมูลไม่พอสำหรับบันทึกค่าใช้จ่าย `
        + `ส่งใบแจ้งหนี้หรือใบเสร็จของรายการนี้เพิ่มได้เลยค่ะ${continueTail(input.captureLink)}`;
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
      return `ยังไม่แน่ใจว่าเป็นเอกสารประเภทใดค่ะ${continueTail(input.captureLink)}`;
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
    default: return 'ยังอ่านไม่ครบทุกหน้า';
  }
}

/** §17.6 exactly: "เก็บไฟล์ไว้แล้ว" is claimed only by a caller that has the persisted identity. */
export const CAPTURE_READ_FAILED_REPLY = (link: string): string =>
  `อ่านข้อมูลไม่สำเร็จค่ะ เก็บไฟล์ไว้แล้ว กด${CONTINUE_IN_WEB_LABEL}ได้ที่นี่\n${link}`;

// The partial/paused sentences of §17.6 say "กรอกข้อมูลส่วนที่ขาด", not "กรอกข้อมูลต่อส่วนที่ขาด" —
// spelled out rather than composed from the button label, which belongs to the other two.
export const CAPTURE_READ_PARTIAL_REPLY = (link: string): string =>
  `อ่านข้อมูลได้บางส่วนค่ะ เก็บไฟล์ไว้แล้ว กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่\n${link}`;

export const CAPTURE_READ_PAUSED_REPLY = (link: string, pausedReason: string | null | undefined): string =>
  `เก็บไฟล์ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ (${capturePausedReasonTh(pausedReason)}) `
  + `กดกรอกข้อมูลส่วนที่ขาดต่อได้ที่นี่\n${link}`;

/**
 * The DONE summary the LINE result push sends when the group stays a group.
 *
 * §3.2's auto-handoff replaces it with `formatCaptureAutoHandoffReply` below, for the
 * single-document/single-issuer/eligible case only. Everything else — multi-document, mixed
 * issuers, a classified non-receipt, blockers — keeps the group link here.
 */
export function formatCaptureReadFinishedReply(input: {
  link: string;
  documentCount: number;
  issuerName?: string | null;
  documentTotal?: string | null;
}): string {
  if (input.documentCount > 1) {
    return `📄 อ่านเอกสารแล้วค่ะ พบ ${input.documentCount} ฉบับ กรุณาตรวจการจัดกลุ่มในเว็บ: ${input.link}`;
  }
  const issuer = input.issuerName?.trim();
  const total = input.documentTotal?.trim();
  const found = [issuer ? `พบ ${issuer}` : 'พบเอกสาร 1 ฉบับ', total ? `ยอด ${total}` : '']
    .filter(Boolean).join(' ');
  return `📄 อ่านเอกสารแล้วค่ะ ${found} — ตรวจและสร้างรายการค่าใช้จ่ายในเว็บ: ${input.link}`;
}

const CAPTURE_MONEY_FORMATTER = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Same user-facing date shape the receipt reply prints, e.g. 25 ก.ค. 2569. */
const CAPTURE_DATE_FORMATTER = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * §3.2: the auto-handoff's summary — the rows the LINE receipt card prints today
 * (`formatPaypersReply` compact), read off the derived source instead of the OCR result, and
 * pointing at the EXPENSE rather than the group. A row the source does not carry is left out
 * rather than printed as a placeholder that reads like a fact.
 */
export function formatCaptureAutoHandoffReply(input: {
  link: string;
  vendorName?: string | null;
  amount?: string | number | null;
  currency?: string | null;
  documentTypeLabel?: string | null;
  expenseDate?: Date | string | null;
}): string {
  const amount = input.amount === null || input.amount === undefined || !Number.isFinite(Number(input.amount))
    ? null : Number(input.amount);
  const date = input.expenseDate ? new Date(input.expenseDate) : null;
  const vendor = input.vendorName?.trim();
  return [
    '🧾 อ่านเอกสารแล้ว บันทึกเป็นร่างรายการให้แล้วค่ะ',
    ...(vendor ? [`ร้าน: ${vendor}`] : []),
    `ยอดในใบเสร็จ: ${amount === null ? 'ยังอ่านยอดไม่ได้'
      : `${CAPTURE_MONEY_FORMATTER.format(amount)}${input.currency && input.currency !== 'THB' ? ` ${input.currency}` : ' บาท'}`}`,
    ...(input.documentTypeLabel ? [`ประเภทเอกสาร: ${input.documentTypeLabel}`] : []),
    ...(date && !Number.isNaN(date.getTime()) ? [`วันที่: ${CAPTURE_DATE_FORMATTER.format(date)}`] : []),
    'ยังไม่ยืนยันรายการ',
    '',
    `✅ ตรวจสอบและยืนยันในเว็บแอป:\n${input.link}`,
  ].join('\n');
}
