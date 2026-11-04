import { inflateSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, DISBURSEMENT_VOUCHER_SLIP_PURPOSE, DISBURSEMENT_VOUCHER_PDF_PURPOSE, DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE, DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import {
  REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
  REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
  REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG,
} from '../../../reimbursements/domain/reimbursement.constants';

/** The capture capability endpoint reports this list, so no client hard-codes it (§4.1). */
export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg', 'image/png',
  'application/pdf',
] as const;

const ALLOWED_MIME_TYPES = new Set<string>(ALLOWED_ATTACHMENT_MIME_TYPES);

const ALLOWED_EXTENSIONS_BY_MIME_TYPE: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
};

const CANONICAL_EXTENSION_BY_MIME_TYPE: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

// `expense.signature.asset` is deliberately absent: it is the signature LIBRARY's purpose, written
// only against `company.signature_asset`, and nothing has ever created it on an expense. Leaving it
// admissible here let a client hang a signature image off an expense through the generic links
// endpoint, which is one of the two ways the owner-only download gate ended up 403-ing reviewers.
const EXPENSE_ATTACHMENT_PURPOSES = new Set([
  'expense.receipt.primary',
  'expense.receipt.supporting',
  'expense.payment.evidence',
  'expense.review.evidence',
]);

const ACCOUNTING_DOCUMENT_ATTACHMENT_PURPOSES = new Set([
  'accounting.receipt.evidence',
  'accounting.document.supporting',
]);

/**
 * A capture group is the CANONICAL owner of its evidence (appendix §2.3): the file hangs off the
 * group, and a derived expense may link the same bytes as its own receipt. One purpose only —
 * anything else on this target type is not evidence the group collected.
 */
export const EXPENSE_CAPTURE_GROUP_TARGET_TYPE = 'expense.capture_group';
export const EXPENSE_CAPTURE_EVIDENCE_PURPOSE = 'expense.capture.evidence';

export function isAllowedAttachmentTarget(targetType: string, purpose: string): boolean {
  return (targetType === 'expense.record' && EXPENSE_ATTACHMENT_PURPOSES.has(purpose))
    || (targetType === 'accounting.document' && ACCOUNTING_DOCUMENT_ATTACHMENT_PURPOSES.has(purpose))
    || (targetType === EXPENSE_CAPTURE_GROUP_TARGET_TYPE && purpose === EXPENSE_CAPTURE_EVIDENCE_PURPOSE);
}

export const SIGNATURE_ASSET_TARGET_TYPE = 'company.signature_asset';

type AttachmentLinkReader = {
  attachmentLink: { findFirst(args: any): Promise<{ targetType: string } | null> };
  attachmentObject: { findFirst(args: any): Promise<{ metadataJson?: unknown } | null> };
};

/**
 * The signature library and everything else must never share the same bytes.
 *
 * D14 makes a signature image owner-only on the SHARED download path, so an attachment carrying both
 * a `company.signature_asset` link and, say, an `expense.record` one hands every reviewer of that
 * expense a 403 and a blank document viewer. Loosening the gate is not the fix: it would let anyone
 * holding `expense.review` link a victim's signature onto an expense they can read and then download
 * it. So the state itself is refused, at every place a link is written.
 *
 * A reimbursement payment slip is exclusive in the same way (owner decision 2026-10-01): it is opened
 * only through its claim, by the people that claim names, so it is never an expense receipt, a
 * signed claim copy or anything OCR may read. That holds from the moment it is uploaded as a slip
 * (the upload tag), not only once a payment carries it (the slip link).
 *
 * Runs on the caller's transaction client when there is one, so a link written moments earlier in
 * the same transaction still counts. Returns the refusal message, or `null` when the link is fine.
 */
export async function findAttachmentLinkConflict(
  db: AttachmentLinkReader,
  input: { companyId: string; attachmentId: string; targetType: string; targetId?: string; purpose?: string },
): Promise<string | null> {
  const isSignature = input.targetType === SIGNATURE_ASSET_TARGET_TYPE;
  const clash = await db.attachmentLink.findFirst({
    where: {
      companyId: input.companyId,
      attachmentId: input.attachmentId,
      targetType: isSignature ? { not: SIGNATURE_ASSET_TARGET_TYPE } : SIGNATURE_ASSET_TARGET_TYPE,
    },
    select: { targetType: true },
  });
  const documentFile = await isDisbursementVoucherFile(db, input);
  const documentTarget = input.targetType === DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE;
  if (documentFile && !documentTarget) return DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_file_link_outside;
  if (documentTarget) {
    const other = await db.attachmentLink.findFirst({ where: { companyId: input.companyId, attachmentId: input.attachmentId,
      NOT: { targetType: input.targetType, targetId: input.targetId, purpose: input.purpose } }, select: { targetType: true } });
    const file = await db.attachmentObject.findFirst({ where: { id: input.attachmentId, companyId: input.companyId }, select: { metadataJson: true } });
    const metadata = file?.metadataJson as Record<string, unknown> | null | undefined;
    if (other || clash || metadata?.['generatedFor'] && ![DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG, DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG].includes(String(metadata['generatedFor']))
      || metadata?.['generatedBy'] === 'disbursement_voucher' && input.purpose !== DISBURSEMENT_VOUCHER_PDF_PURPOSE
      || await isReimbursementPaymentSlipFile(db, input)) return DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_slip_link_conflict;
  }
  if (clash) {
    return isSignature
      ? 'This file is already attached to a document, so it cannot also be saved as a personal signature.'
      : 'A personal signature image cannot be attached to anything else.';
  }
  if (input.targetType !== REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE && await isReimbursementPaymentSlipFile(db, input)) {
    return 'A reimbursement payment slip cannot be attached to anything else.';
  }
  return null;
}

/** Exclusive from upload onward, including replaced slips whose link has been removed. */
export async function isDisbursementVoucherFile(db: AttachmentLinkReader, input: { companyId: string; attachmentId: string }): Promise<boolean> {
  for (const purpose of [DISBURSEMENT_VOUCHER_SLIP_PURPOSE, DISBURSEMENT_VOUCHER_SUPPORTING_PURPOSE, DISBURSEMENT_VOUCHER_PDF_PURPOSE]) {
    const link = await db.attachmentLink.findFirst({ where: { companyId: input.companyId, attachmentId: input.attachmentId,
      targetType: DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE, purpose }, select: { targetType: true } });
    // Believe the row, not only the filter: a link of another kind is never this document's file.
    if (link?.targetType === DISBURSEMENT_VOUCHER_ATTACHMENT_TARGET_TYPE) return true;
  }
  const file = await db.attachmentObject.findFirst({ where: { id: input.attachmentId, companyId: input.companyId }, select: { metadataJson: true } });
  const metadata = file?.metadataJson as Record<string, unknown> | null | undefined;
  return metadata?.['generatedFor'] === DISBURSEMENT_VOUCHER_SUPPORTING_UPLOAD_TAG || metadata?.['generatedFor'] === DISBURSEMENT_VOUCHER_SLIP_UPLOAD_TAG || metadata?.['generatedBy'] === 'disbursement_voucher';
}

/** Whether these bytes are a reimbursement payment slip: linked to a payment, or uploaded to become one. */
export async function isReimbursementPaymentSlipFile(
  db: AttachmentLinkReader,
  input: { companyId: string; attachmentId: string },
): Promise<boolean> {
  const slipLink = await db.attachmentLink.findFirst({
    where: {
      companyId: input.companyId,
      attachmentId: input.attachmentId,
      targetType: REIMBURSEMENT_PAYMENT_ATTACHMENT_TARGET_TYPE,
      purpose: REIMBURSEMENT_PAYMENT_SLIP_PURPOSE,
    },
    select: { targetType: true },
  });
  if (slipLink) return true;
  const file = await db.attachmentObject.findFirst({
    where: { id: input.attachmentId, companyId: input.companyId },
    select: { metadataJson: true },
  });
  return (file?.metadataJson as Record<string, unknown> | null | undefined)?.['generatedFor'] === REIMBURSEMENT_PAYMENT_SLIP_UPLOAD_TAG;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export function validateAttachmentMeta(mimeType: string, byteSize: number, maxBytes = MAX_ATTACHMENT_BYTES): string | null {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `MIME type "${mimeType}" is not allowed.`;
  }
  if (byteSize <= 0 || byteSize > Math.min(MAX_ATTACHMENT_BYTES, maxBytes)) {
    return `File size must be between 1 byte and ${Math.min(MAX_ATTACHMENT_BYTES, maxBytes)} bytes.`;
  }
  return null;
}

export function validateAttachmentFileName(fileName: unknown, mimeType: string): string | null {
  const extension = typeof fileName === 'string'
    ? /^.+\.([^.]+)$/.exec(fileName.trim())?.[1]?.toLowerCase()
    : undefined;
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_MIME_TYPE[mimeType];
  if (!extension || !allowedExtensions?.includes(extension)) {
    return 'File extension does not match the declared MIME type.';
  }
  return null;
}

export function detectAttachmentMimeType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return 'image/jpeg';
  }
  return null;
}

export function normalizeAttachmentMimeType(declaredMimeType: string | null | undefined, bytes: Buffer): string {
  const declared = declaredMimeType?.split(';')[0]?.trim().toLowerCase();
  if (declared === 'image/jpg') return 'image/jpeg';
  if (declared && declared !== 'application/octet-stream') return declared;
  return detectAttachmentMimeType(bytes) ?? declared ?? 'application/octet-stream';
}

export function canonicalAttachmentExtension(mimeType: string): string | null {
  return CANONICAL_EXTENSION_BY_MIME_TYPE[mimeType] ?? null;
}

const PDF_UNINSPECTABLE = 'PDF could not be inspected.';
const PDF_EMBEDDED_REJECTED = 'Embedded files are not supported in PDFs.';
const PDF_OBJECT_LIMIT = 'PDF object count exceeds the parser safety limit.';
const PDF_ACTIVE = 'Active PDF content is not allowed.';
const CONTENT_ACTIVE = 'Active content is not allowed in attachments.';
const PDF_MAX_OBJECT_STREAM_BYTES = 8 * 1024 * 1024;
const PDF_MAX_EXPANDED_BYTES = 32 * 1024 * 1024;

type PdfAtom = { kind: 'name' | 'string' | 'word'; value: string };
type PdfReference = { kind: 'reference'; key: string };
type PdfDictionary = { kind: 'dictionary'; entries: Map<string, PdfValue> };
type PdfValue = number | PdfAtom | PdfReference | PdfDictionary | PdfValue[];
type PdfToken = { kind: 'name' | 'string' | 'word' | 'number' | 'delimiter'; value: string; end: number };
type PdfStream = { dictionary: PdfDictionary; bytes: Buffer; declaredLength: PdfValue; length: number };

function pdfWhitespace(byte: number) { return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32; }
function pdfDelimiter(byte: number) { return pdfWhitespace(byte) || '()<>[]{}/%'.includes(String.fromCharCode(byte)); }
function pdfInspectionFailure(): never { throw new Error(PDF_UNINSPECTABLE); }
function checkPdfText(value: string): void {
  // Tags need their word boundary on the raw text ("<svg onload" compacts to "<svgonload");
  // schemes are also checked compacted, so "java\nscript:" cannot slip through.
  const lower = value.toLowerCase();
  const compact = lower.replace(/[\x00-\x20\x7f]/g, '');
  if (/<script\b|<svg\b|javascript:|vbscript:|data:text\/html/.test(lower)
    || /javascript:|vbscript:|data:text\/html/.test(compact)) throw new Error(CONTENT_ACTIVE);
}

class PdfInspectionBudget {
  private readonly startedAt = performance.now();
  objects = 0;
  objectStreams = 0;
  expandedBytes = 0;
  check() {
    if (this.objects > 100_000) throw new Error(PDF_OBJECT_LIMIT);
    if (performance.now() - this.startedAt > 2000 || this.objectStreams > 2000
      || this.expandedBytes > PDF_MAX_EXPANDED_BYTES) pdfInspectionFailure();
  }
}

/** A bounded lexer/parser. Only dictionaries with an exact stream boundary may hide opaque bytes. */
class PdfSafetyReader {
  private position = 0;
  private readonly lookahead: PdfToken[] = [];
  readonly objects = new Map<string, PdfValue>();
  private readonly streams: PdfStream[] = [];

  constructor(private readonly bytes: Buffer, private readonly budget: PdfInspectionBudget) {}

  private checkpoint() { if ((this.position & 4095) === 0) this.budget.check(); }

  private token(): PdfToken | undefined {
    const bytes = this.bytes;
    while (this.position < bytes.length) {
      this.checkpoint();
      if (pdfWhitespace(bytes[this.position]!)) { this.position++; continue; }
      if (bytes[this.position] !== 37) break;
      while (this.position < bytes.length && ![10, 13].includes(bytes[this.position]!)) { this.checkpoint(); this.position++; }
    }
    if (this.position >= bytes.length) return undefined;
    const start = this.position++;
    const first = bytes[start]!;
    const result = (kind: PdfToken['kind'], value: string): PdfToken => ({ kind, value, end: this.position });
    if (first === 47) {
      while (this.position < bytes.length && !pdfDelimiter(bytes[this.position]!)) { this.checkpoint(); this.position++; }
      const raw = bytes.toString('latin1', start + 1, this.position);
      if (/#(?![\da-f]{2})/i.test(raw)) pdfInspectionFailure();
      const value = raw.replace(/#([\da-f]{2})/gi, (_match, hex: string) => {
        const decoded = String.fromCharCode(parseInt(hex, 16));
        if (/[a-z\d]/i.test(decoded)) pdfInspectionFailure();
        return decoded;
      });
      if (/^(javascript|js|openaction|launch|richmedia|xfa)$/i.test(value)) throw new Error(PDF_ACTIVE);
      if (/^embeddedfile$/i.test(value)) throw new Error(PDF_EMBEDDED_REJECTED);
      if (/^encrypt$/i.test(value)) pdfInspectionFailure();
      checkPdfText(value);
      return result('name', value);
    }
    if (first === 40) {
      let depth = 1;
      const decoded: number[] = [];
      while (this.position < bytes.length && depth > 0) {
        this.checkpoint();
        let byte = bytes[this.position++]!;
        if (byte === 92) {
          if (this.position >= bytes.length) pdfInspectionFailure();
          byte = bytes[this.position++]!;
          if (byte === 10) continue;
          if (byte === 13) { if (bytes[this.position] === 10) this.position++; continue; }
          if (byte >= 48 && byte <= 55) {
            let octal = String.fromCharCode(byte);
            for (let count = 1; count < 3 && bytes[this.position]! >= 48 && bytes[this.position]! <= 55; count++) octal += String.fromCharCode(bytes[this.position++]!);
            decoded.push(parseInt(octal, 8) & 255);
          } else decoded.push(({ 110: 10, 114: 13, 116: 9, 98: 8, 102: 12 } as Record<number, number>)[byte] ?? byte);
          continue;
        }
        if (byte === 40 && ++depth > 64) pdfInspectionFailure();
        if (byte === 41 && --depth === 0) break;
        decoded.push(byte);
      }
      if (depth !== 0) pdfInspectionFailure();
      const value = Buffer.from(decoded).toString('latin1');
      checkPdfText(value);
      return result('string', value);
    }
    if (first === 60 && bytes[this.position] !== 60) {
      if (/^<(?:script|svg)\b/i.test(bytes.toString('latin1', start, start + 10))) throw new Error(CONTENT_ACTIVE);
      let hex = '';
      while (this.position < bytes.length && bytes[this.position] !== 62) {
        this.checkpoint();
        const byte = bytes[this.position++]!;
        if (pdfWhitespace(byte)) continue;
        const character = String.fromCharCode(byte);
        if (!/[\da-f]/i.test(character)) pdfInspectionFailure();
        hex += character;
      }
      if (bytes[this.position++] !== 62) pdfInspectionFailure();
      const value = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex').toString('latin1');
      checkPdfText(value);
      return result('string', value);
    }
    if ((first === 60 || first === 62) && bytes[this.position] === first) {
      this.position++;
      return result('delimiter', String.fromCharCode(first, first));
    }
    if ('[]()<>{}'.includes(String.fromCharCode(first))) return result('delimiter', String.fromCharCode(first));
    while (this.position < bytes.length && !pdfDelimiter(bytes[this.position]!)) { this.checkpoint(); this.position++; }
    const value = bytes.toString('latin1', start, this.position);
    checkPdfText(value);
    return result(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) ? 'number' : 'word', value);
  }

  private peek(index = 0): PdfToken | undefined {
    while (this.lookahead.length <= index) {
      const token = this.token();
      if (!token) return undefined;
      this.lookahead.push(token);
    }
    return this.lookahead[index];
  }

  private take() { const token = this.peek(); this.lookahead.shift(); return token; }

  private value(depth = 0): PdfValue {
    this.budget.check();
    if (depth > 64) pdfInspectionFailure();
    const token = this.take();
    if (!token) pdfInspectionFailure();
    if (token.value === '[' && token.kind === 'delimiter') {
      const items: PdfValue[] = [];
      while (this.peek()?.value !== ']') items.push(this.value(depth + 1));
      this.take();
      return items;
    }
    if (token.value === '<<' && token.kind === 'delimiter') {
      const entries = new Map<string, PdfValue>();
      while (this.peek()?.value !== '>>') {
        const key = this.take();
        if (!key || key.kind !== 'name' || entries.has(key.value)) pdfInspectionFailure();
        entries.set(key.value, this.value(depth + 1));
      }
      this.take();
      return { kind: 'dictionary', entries };
    }
    if (token.kind === 'delimiter') pdfInspectionFailure();
    if (token.kind === 'number') {
      if (this.peek()?.kind === 'number' && this.peek(1)?.value === 'R') {
        const generation = this.take()!;
        this.take();
        if (!/^\d+$/.test(token.value) || !/^\d+$/.test(generation.value)) pdfInspectionFailure();
        return { kind: 'reference', key: `${token.value} ${generation.value}` };
      }
      const number = Number(token.value);
      if (!Number.isFinite(number)) pdfInspectionFailure();
      return number;
    }
    if (depth > 0 && token.kind === 'word' && !['null', 'true', 'false'].includes(token.value)) pdfInspectionFailure();
    return { kind: token.kind, value: token.value };
  }

  private stream(dictionary: PdfDictionary) {
    const token = this.take()!;
    this.position = token.end;
    this.lookahead.length = 0;
    while ([9, 32].includes(this.bytes[this.position]!)) this.position++;
    if (this.bytes[this.position] === 13) this.position++;
    else if (this.bytes[this.position] !== 10) pdfInspectionFailure();
    if (this.bytes[this.position] === 10) this.position++;
    const start = this.position;
    const declaredLength = dictionary.entries.get('Length');
    if (declaredLength === undefined) pdfInspectionFailure();
    const known = this.resolve(declaredLength);
    let end: number;
    if (typeof known === 'number') {
      if (!Number.isSafeInteger(known) || known < 0) pdfInspectionFailure();
      end = start + known;
    } else {
      // Forward scalar /Length references are verified after the rest of the structure is parsed.
      // An earlier fake delimiter makes that verification fail, so ambiguity never becomes clean.
      if (typeof known === 'number' || Array.isArray(known) || known.kind !== 'reference') pdfInspectionFailure();
      const candidates = [this.bytes.indexOf(Buffer.from('\nendstream'), start), this.bytes.indexOf(Buffer.from('\rendstream'), start)].filter(index => index >= 0);
      end = Math.min(...candidates);
      if (!Number.isFinite(end)) pdfInspectionFailure();
      if (this.bytes[end - 1] === 13) end--;
    }
    if (end > this.bytes.length) pdfInspectionFailure();
    this.position = end;
    while (pdfWhitespace(this.bytes[this.position]!)) { this.checkpoint(); this.position++; }
    if (this.bytes.toString('latin1', this.position, this.position + 9) !== 'endstream'
      || this.position + 9 < this.bytes.length && !pdfDelimiter(this.bytes[this.position + 9]!)) pdfInspectionFailure();
    this.position += 9;
    this.streams.push({ dictionary, bytes: this.bytes.subarray(start, end), declaredLength, length: end - start });
  }

  private resolve(value: PdfValue): PdfValue {
    const seen = new Set<string>();
    while (typeof value === 'object' && !Array.isArray(value) && value.kind === 'reference' && this.objects.has(value.key)) {
      if (seen.has(value.key)) pdfInspectionFailure();
      seen.add(value.key);
      value = this.objects.get(value.key)!;
    }
    return value;
  }

  inspect() {
    let previous: PdfValue[] = [];
    while (this.peek()) {
      let value = this.value();
      if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'word' && value.value === 'obj') {
        this.budget.objects++;
        this.budget.check();
        const [id, generation] = previous.slice(-2);
        value = this.value();
        if (typeof id === 'number' && typeof generation === 'number') this.objects.set(`${id} ${generation}`, value);
      }
      if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'dictionary' && this.peek()?.value === 'stream') {
        this.stream(value);
      } else if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'word' && ['stream', 'endstream'].includes(value.value)) pdfInspectionFailure();
      previous.push(value);
      if (previous.length > 2) previous.shift();
    }
    for (const stream of this.streams) {
      if (this.resolve(stream.declaredLength) !== stream.length) pdfInspectionFailure();
      const storedType = stream.dictionary.entries.get('Type');
      const type = storedType === undefined ? undefined : this.resolve(storedType);
      if (type && typeof type === 'object' && !Array.isArray(type) && type.kind === 'reference') pdfInspectionFailure();
      if (typeof type !== 'object' || Array.isArray(type) || type.kind !== 'name' || type.value.toLowerCase() !== 'objstm') continue;
      this.budget.objectStreams++;
      this.budget.check();
      if (stream.dictionary.entries.has('DecodeParms')) pdfInspectionFailure();
      const storedFilter = stream.dictionary.entries.get('Filter');
      const filter = storedFilter === undefined ? undefined : this.resolve(storedFilter);
      const single = Array.isArray(filter) && filter.length === 1 ? filter[0] : filter;
      if (!single || typeof single !== 'object' || Array.isArray(single) || single.kind !== 'name' || single.value !== 'FlateDecode') pdfInspectionFailure();
      const expanded = inflateSync(stream.bytes, { maxOutputLength: PDF_MAX_OBJECT_STREAM_BYTES });
      this.budget.expandedBytes += expanded.length;
      this.budget.check();
      const count = stream.dictionary.entries.get('N');
      const first = stream.dictionary.entries.get('First');
      if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || typeof first !== 'number'
        || !Number.isSafeInteger(first) || first < 0 || first > expanded.length) pdfInspectionFailure();
      this.budget.objects += count;
      this.budget.check();
      const header = new PdfSafetyReader(expanded.subarray(0, first), this.budget);
      let lastOffset = -1;
      const offsets: number[] = [];
      for (let index = 0; index < count; index++) {
        const id = header.value();
        const offset = header.value();
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0 || typeof offset !== 'number'
          || !Number.isSafeInteger(offset) || offset <= lastOffset || first + offset >= expanded.length) pdfInspectionFailure();
        lastOffset = offset;
        offsets.push(offset);
      }
      if (header.peek()) pdfInspectionFailure();
      if (count === 0 && first !== expanded.length) pdfInspectionFailure();
      for (let index = 0; index < offsets.length; index++) {
        const object = new PdfSafetyReader(expanded.subarray(first + offsets[index]!,
          index + 1 < offsets.length ? first + offsets[index + 1]! : expanded.length), this.budget);
        object.value(1);
        if (object.peek()) pdfInspectionFailure();
      }
    }
  }
}

export function attachmentInspectionFailureCode(message: string): 'CONTENT_UNINSPECTABLE' | 'EMBEDDED_FILE_REJECTED' | 'CONTENT_REJECTED' {
  if (message === PDF_EMBEDDED_REJECTED) return 'EMBEDDED_FILE_REJECTED';
  if (message === PDF_UNINSPECTABLE || message === PDF_OBJECT_LIMIT || message === 'File signature does not match the declared MIME type.') return 'CONTENT_UNINSPECTABLE';
  return 'CONTENT_REJECTED';
}

export function inspectAttachmentBytes(mimeType: string, bytes: Buffer): string | null {
  if (detectAttachmentMimeType(bytes) !== mimeType) return 'File signature does not match the declared MIME type.';
  if (bytes.toString('latin1').toLowerCase().includes('eicar-standard-antivirus-test-file')) return 'Malware test signature detected.';
  try {
    if (mimeType === 'application/pdf') new PdfSafetyReader(bytes, new PdfInspectionBudget()).inspect();
    else checkPdfText(bytes.toString('latin1'));
    return null;
  } catch (error) {
    return error instanceof Error && [PDF_UNINSPECTABLE, PDF_OBJECT_LIMIT, PDF_EMBEDDED_REJECTED, PDF_ACTIVE, CONTENT_ACTIVE].includes(error.message)
      ? error.message : PDF_UNINSPECTABLE;
  }
}

// Decides the Content-Type only; `downloadContentDisposition` decides attachment vs inline.
// Uploads never accept SVG (see ALLOWED_MIME_TYPES + inspectAttachmentBytes), so image/svg+xml
// here can only be a system-generated substitute-receipt artifact — and SVG is never
// content-sniffed by browsers, so without the real type <img> shows a broken icon.
const INLINE_DOWNLOAD_MIME_TYPES = /^(?:image\/(?:png|jpeg|svg\+xml)|application\/pdf)$/;

export function inlineDownloadContentType(mimeType: string | null | undefined): string {
  return mimeType && INLINE_DOWNLOAD_MIME_TYPES.test(mimeType) ? mimeType : 'application/octet-stream';
}

// Narrower than the Content-Type list on purpose. Chrome's ORB blocks an `attachment` response
// loaded as an <img>, so a preview caller may ask for `inline` — but only for the types a browser
// renders as a picture, never for a type it might sniff as a document. SVG is excluded even though
// it is image/*: an SVG opened inline is a document that runs its own script, on the storage
// origin. Substitute-receipt artifacts are the only SVGs we hold and they still download fine.
const INLINE_DISPOSITION_MIME_TYPES = /^(?:image\/(?:png|jpeg)|application\/pdf)$/;

/**
 * The `Content-Disposition` a signed download carries. `attachment` unless inline is asked for AND safe.
 *
 * The storage service refuses a header value outside ISO-8859-1 with HTTP 400, so a Thai file name
 * (every signed claim form the system names, "ใบเบิกค่าใช้จ่าย RB-….pdf") could not be opened at all.
 * Such a name travels as an ASCII fallback plus the RFC 5987 `filename*` form; a plain ASCII name
 * keeps the short form it always had.
 */
export function downloadContentDisposition(input: {
  disposition?: 'inline' | 'attachment';
  mimeType?: string | null;
  fileName?: string | null;
}): string {
  const type = input.disposition === 'inline' && input.mimeType && INLINE_DISPOSITION_MIME_TYPES.test(input.mimeType)
    ? 'inline'
    : 'attachment';
  const name = (input.fileName ?? 'download').replace(/["\r\n]/g, '_');
  if (/^[\x20-\x7e]*$/.test(name)) return `${type}; filename="${name}"`;
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encoded}`;
}

export function generateObjectKey(companyId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `pending/${companyId}/${randomUUID()}_${safe}`;
}

export function generateImmutableObjectKey(companyId: string, checksumSha256: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `evidence/${companyId}/${checksumSha256}/${randomUUID()}_${safe}`;
}
