import { EXPENSE_MANUAL_EDIT_HELP_TH, expenseCaptureMegabytes, JPEG_LABEL, PNG_LABEL, SIGNATURE_FILE_TYPES_LABEL } from '@watchdog-bms/contracts';

/**
 * Spec §17.5 as a pure table: attempt facts in, one Thai sentence out.
 *
 * It is deliberately free of Prisma, permissions and HTTP. The handler that calls it has already
 * decided WHICH attempts this actor may see; this file only decides what may honestly be SAID about
 * them — and §17.5's hardest rule is exactly that distinction: "ไม่พบ event" and "ค้นสถานะไม่ได้"
 * are different answers, and neither may be dressed as "the file was too big".
 */

export type LineFileAttemptStage = 'DOWNLOAD' | 'SECURITY' | 'PERSIST' | 'READ' | 'ROUTE';

export type LineFileAttemptOutcome =
  | 'REJECTED' | 'STORED' | 'STORED_READING' | 'STORED_READ_FAILED'
  | 'STORED_READ_PARTIAL' | 'STORED_READ_DONE' | 'UNKNOWN';

export type LineFileAttemptFacts = {
  ref: string;
  messageType: 'image' | 'file';
  fileNameSanitized: string | null;
  stage: LineFileAttemptStage;
  reasonCode: string;
  outcome: LineFileAttemptOutcome;
  declaredFileSize: number | null;
  measuredByteSize: number | null;
  capability: { maxBytes?: number; allowedMimeTypes?: string[]; pdfAutomaticRead?: boolean };
  createdAt: Date;
  /** Set only when the caller re-read the target through a permission-checked read. */
  currentStatus?: string | null;
  recoveryAction?: { kind: 'open_web' | 'resend' | 'choose_smaller' | 'choose_other_file' | 'wait'; url?: string };
};

export const FILE_ATTEMPT_NONE_REPLY =
  'ตอนนี้ยังไม่พบไฟล์ที่จะอ่านค่ะ กด + → ไฟล์ แล้วเลือกส่งไฟล์นั้นในแชตนี้อีกครั้งได้เลย';

export const FILE_ATTEMPT_LOOKUP_FAILED_REPLY =
  'ตอนนี้ยังตรวจสอบสถานะไม่ได้ จึงยังยืนยันไม่ได้ว่าไฟล์ถูกเก็บหรือยัง';

export const FILE_ATTEMPT_AMBIGUOUS_LEAD = 'หมายถึงไฟล์ไหนคะ';

/** The word the customer used. §17.1: "คำว่ารูป/ไฟล์/เอกสารตรงกับสิ่งที่ส่ง". */
export const mediaWordTh = (messageType: 'image' | 'file'): string => (messageType === 'file' ? 'ไฟล์' : 'รูป');

const named = (attempt: LineFileAttemptFacts): string =>
  attempt.fileNameSanitized ? `${mediaWordTh(attempt.messageType)} ${attempt.fileNameSanitized}` : `${mediaWordTh(attempt.messageType)}ที่ส่งมา`;

/**
 * The same label INSIDE a sentence. Thai runs words together, but a Latin file name needs air on
 * both sides or "invoice-aug.pdfไว้แล้ว" is what the customer reads — so a named file keeps its
 * spaces and an unnamed one collapses to the natural Thai phrase.
 */
const namedInline = (attempt: LineFileAttemptFacts): string =>
  attempt.fileNameSanitized ? `${mediaWordTh(attempt.messageType)} ${attempt.fileNameSanitized} ` : `${mediaWordTh(attempt.messageType)}นี้`;

const timeLabel = (at: Date): string =>
  new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(at);

/** The list shown when more than one attempt could be the one the customer means (§17.5). */
export function fileAttemptChoiceList(attempts: readonly LineFileAttemptFacts[], language: 'th' | 'en' = 'th'): string {
  if (language === 'en') return ['Which file do you mean?', ...attempts.map(attempt => `• ${attempt.fileNameSanitized ?? (attempt.messageType === 'file' ? 'File' : 'Photo')} · ${timeLabel(attempt.createdAt)} · ${englishAttemptState(attempt)}`)].join('\n');
  return [
    FILE_ATTEMPT_AMBIGUOUS_LEAD,
    ...attempts.map(attempt =>
      `• ${named(attempt)} · ${timeLabel(attempt.createdAt)} · ${shortStateTh(attempt)}`),
  ].join('\n');
}

function shortStateTh(attempt: LineFileAttemptFacts): string {
  switch (attempt.outcome) {
    case 'REJECTED': return 'ยังไม่ได้เก็บไฟล์';
    case 'STORED': return 'เก็บไฟล์แล้ว';
    case 'STORED_READING': return 'กำลังอ่านเอกสาร';
    case 'STORED_READ_FAILED': return 'เก็บไฟล์แล้ว อ่านไม่สำเร็จ';
    case 'STORED_READ_PARTIAL': return 'เก็บไฟล์แล้ว อ่านได้บางส่วน';
    case 'STORED_READ_DONE': return 'อ่านเอกสารเสร็จแล้ว';
    default: return 'ยังยืนยันสถานะไม่ได้';
  }
}

/**
 * One attempt → the §17.5 sentence for it.
 *
 * `resolvedFrom` is the EARLIER attempt for the same file when the problem has since been fixed:
 * §17.5's last row ("ตอนแรก {เหตุ} ตอนนี้ {สถานะล่าสุด} แล้ว") exists so a customer is never answered
 * from a stale error and made to send or pay twice.
 */
export function fileInspectionRefusalReply(reason: string, language: 'th' | 'en' = 'th'): string | undefined {
  if (reason === 'EMBEDDED_FILE_REJECTED') return language === 'en'
    ? 'Attachments inside this PDF are unsupported; send another file.' : 'ไฟล์แนบใน PDF นี้ยังไม่รองรับ ส่งไฟล์อื่นได้ค่ะ';
  if (reason === 'CONTENT_UNINSPECTABLE' || reason === 'MALWARE_SCAN_FAILED') return language === 'en'
    ? 'This file could not be inspected; send another file.' : 'ระบบตรวจไฟล์นี้ไม่ได้ ส่งไฟล์อื่นได้ค่ะ';
  return undefined;
}

export function fileAttemptAnswer(
  attempt: LineFileAttemptFacts,
  resolvedFrom?: LineFileAttemptFacts,
  language: 'th' | 'en' = 'th',
): string {
  if (attempt.outcome === 'REJECTED') {
    const refusal = fileInspectionRefusalReply(attempt.reasonCode, language);
    if (refusal) return refusal;
  }
  if (language === 'en') {
    const link = linkTail(attempt);
    if (resolvedFrom?.outcome === 'REJECTED' && attempt.outcome !== 'REJECTED') return `The earlier upload was rejected; now ${englishAttemptState(attempt).toLowerCase()}.${link}`;
    if (attempt.outcome !== 'REJECTED') return `${englishAttemptState(attempt)}.${link}`;
    if (attempt.reasonCode === 'oversize_declared' || attempt.reasonCode === 'oversize_measured') return `This file exceeds the accepted size${attempt.capability.maxBytes ? ` of ${expenseCaptureMegabytes(attempt.capability.maxBytes)}` : ''}; it was not stored, so send a smaller file.`;
    if (['METADATA_REJECTED', 'EXTENSION_MIME_MISMATCH'].includes(attempt.reasonCode)) return 'This file type is unsupported and was not stored; send a PDF or supported image file.';
    if (['CONTENT_REJECTED', 'MALWARE_DETECTED', 'MALWARE_SCAN_FAILED'].includes(attempt.reasonCode)) return 'This file did not pass the security check and was not stored; resend the original file from its source.';
    return 'This file could not be received or stored; no expense was created, so check the web before resending it.';
  }
  if (resolvedFrom && resolvedFrom.outcome === 'REJECTED' && attempt.outcome !== 'REJECTED') {
    return `ตอนแรก ${rejectionCauseTh(resolvedFrom)} ตอนนี้ ${shortStateTh(attempt)} แล้วค่ะ${linkTail(attempt)}`;
  }
  if (attempt.outcome === 'REJECTED') return rejectionSentence(attempt);
  return storedSentence(attempt);
}

/** The cause half only, for the "problem already fixed" sentence. */
function rejectionCauseTh(attempt: LineFileAttemptFacts): string {
  switch (attempt.reasonCode) {
    case 'oversize_declared':
    case 'oversize_measured':
      return 'ไฟล์ใหญ่เกินขนาดที่ระบบรับได้';
    case 'METADATA_REJECTED':
    case 'EXTENSION_MIME_MISMATCH':
      return 'ไฟล์ชนิดนี้ยังไม่รองรับ';
    case 'CONTENT_REJECTED':
    case 'MALWARE_DETECTED':
      return 'ไฟล์ไม่ผ่านการตรวจความปลอดภัย';
    case 'MALWARE_SCAN_FAILED':
    case 'CONTENT_UNINSPECTABLE':
      return 'ระบบตรวจไฟล์ไม่ได้';
    case 'EMBEDDED_FILE_REJECTED':
      return 'ไฟล์แนบใน PDF ยังไม่รองรับ';
    case 'persist_failed':
      return 'ระบบเก็บไฟล์ไม่สำเร็จ';
    default:
      return 'ระบบรับไฟล์จาก LINE ไม่สำเร็จ';
  }
}

function rejectionSentence(attempt: LineFileAttemptFacts): string {
  const limit = attempt.capability.maxBytes;
  const measured = attempt.measuredByteSize ?? attempt.declaredFileSize;
  if ((attempt.reasonCode === 'oversize_declared' || attempt.reasonCode === 'oversize_measured') && limit && measured) {
    return `ไฟล์ ${attempt.fileNameSanitized ?? 'ที่ส่งมา'} ขนาด ${expenseCaptureMegabytes(measured)} `
      + `เกินขนาดที่ระบบรับได้ ${expenseCaptureMegabytes(limit)} จึงยังไม่ได้เก็บไฟล์นี้ — `
      + 'เลือกไฟล์ที่เล็กกว่าแล้วส่งอีกครั้งได้เลยค่ะ';
  }
  if (attempt.reasonCode === 'METADATA_REJECTED' || attempt.reasonCode === 'EXTENSION_MIME_MISMATCH') {
    const kinds = attempt.capability.allowedMimeTypes?.length
      ? attempt.capability.allowedMimeTypes.map(mimeLabel).filter((label, index, all) => all.indexOf(label) === index).join(', ')
      : `PDF หรือ${SIGNATURE_FILE_TYPES_LABEL}`;
    return `ไฟล์ชนิดนี้ยังไม่รองรับค่ะ จึงยังไม่ได้เก็บไฟล์นี้ — กรุณาเลือก ${kinds} แล้วส่งอีกครั้งนะคะ`;
  }
  if (attempt.reasonCode === 'CONTENT_REJECTED' || attempt.reasonCode === 'MALWARE_DETECTED'
    || attempt.reasonCode === 'MALWARE_SCAN_FAILED') {
    return `${namedInline(attempt)}ไม่ผ่านการตรวจความปลอดภัยค่ะ จึงยังไม่ได้เก็บไฟล์นี้ — `
      + 'กรุณาส่งไฟล์ต้นฉบับที่ดาวน์โหลดจากต้นทางอีกครั้งนะคะ';
  }
  if (attempt.reasonCode === 'persist_failed') {
    return `ระบบเก็บ${namedInline(attempt)}ไม่สำเร็จค่ะ จึงยังไม่ได้บันทึกรายการใด ๆ — รบกวนส่งไฟล์เดิมอีกครั้งนะคะ`;
  }
  // §17.5 row 4: a download failure whose cause we genuinely do not know. Never widened into
  // "too large" or "expired" — that guess is the defect this row exists to prevent.
  return 'ตอนนั้นระบบรับไฟล์จาก LINE ไม่สำเร็จ แต่ยังระบุสาเหตุแน่ชัดไม่ได้ค่ะ — '
    + 'ถ้ายังไม่พบไฟล์ในเว็บ รบกวนส่งไฟล์เดิมอีกครั้งนะคะ';
}

function storedSentence(attempt: LineFileAttemptFacts): string {
  const link = linkTail(attempt);
  switch (attempt.outcome) {
    case 'STORED_READING':
      return `เก็บ${namedInline(attempt)}ไว้แล้วค่ะ กำลังอ่านเอกสารอยู่ เสร็จแล้วน้องจะสรุปให้ทางแชตนี้นะคะ${link}`;
    case 'STORED_READ_FAILED':
      return `เก็บ${namedInline(attempt)}ไว้แล้วค่ะ แต่อ่านข้อมูลไม่สำเร็จ ${EXPENSE_MANUAL_EDIT_HELP_TH}${link || ''}`;
    case 'STORED_READ_PARTIAL':
      return `เก็บ${namedInline(attempt)}ไว้แล้วค่ะ แต่ยังอ่านข้อมูลไม่ครบ ${EXPENSE_MANUAL_EDIT_HELP_TH}${link || ''}`;
    case 'STORED_READ_DONE':
      return `อ่าน${namedInline(attempt)}เสร็จแล้วค่ะ${attempt.currentStatus ? ` สถานะตอนนี้ ${attempt.currentStatus}` : ''}${link}`;
    case 'STORED':
      return `เก็บ${namedInline(attempt)}ไว้แล้วค่ะ ยังไม่ได้อ่านข้อมูลอัตโนมัตินะคะ${link}`;
    default:
      // UXE-25 / §17.5 "unknown": an outcome we never resolved is never reported as saved.
      return FILE_ATTEMPT_LOOKUP_FAILED_REPLY;
  }
}

const linkTail = (attempt: LineFileAttemptFacts): string =>
  attempt.recoveryAction?.url ? `\n${attempt.recoveryAction.url}` : '';

function mimeLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'image/png') return PNG_LABEL;
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return JPEG_LABEL;
  return 'ไฟล์ชนิดที่ระบบรองรับ';
}

/**
 * UXE-25: the read finished but LINE never accepted the push. The answer must say the RESULT is
 * ready and where to see it, without claiming the customer was told.
 */
export const FILE_ATTEMPT_DELIVERY_FAILED_REPLY = (link: string, language: 'th' | 'en' = 'th'): string =>
  language === 'en' ? `Document reading finished, but the result could not be delivered here; view it on the web: ${link}` :
  `อ่านเอกสารเสร็จแล้วค่ะ แต่ส่งผลให้ทางแชตนี้ไม่สำเร็จ จึงยังไม่ได้แจ้งผลก่อนหน้านี้ `
  + `เปิดดูผลได้ที่นี่\n${link}`;

function englishAttemptState(attempt: LineFileAttemptFacts): string {
  return ({ REJECTED: 'File not stored', STORED: 'File stored; automatic reading has not started', STORED_READING: 'File stored and being read', STORED_READ_FAILED: 'File stored; reading failed, so review it on the web', STORED_READ_PARTIAL: 'File stored; some details still need review on the web', STORED_READ_DONE: 'Document reading finished', UNKNOWN: 'The file status could not be verified' } as const)[attempt.outcome];
}
