import { randomUUID } from 'node:crypto';

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
 * Runs on the caller's transaction client when there is one, so a link written moments earlier in
 * the same transaction still counts. Returns the refusal message, or `null` when the link is fine.
 */
export async function findAttachmentLinkConflict(
  db: AttachmentLinkReader,
  input: { companyId: string; attachmentId: string; targetType: string },
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
  if (!clash) return null;
  return isSignature
    ? 'This file is already attached to a document, so it cannot also be saved as a personal signature.'
    : 'A personal signature image cannot be attached to anything else.';
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

// CR-10: a scanned receipt is one compressed image stream per page, and compressed bytes are
// statistically random — so short needles like `/js` hit by chance. Measured on well-formed
// PDFs, the old whole-stream scan quarantined 13% of 0.5 MB scans and 78% of 10 MB ones,
// permanently and behind a HIGH security alert. Strip stream payloads and match only the object
// structure a reader parses for behaviour. Detection is unchanged in practice: active content
// only works from a dictionary, and anything hidden inside a compressed stream was already
// unreadable to a regex. Anchored on `>>` so the literal word "stream" cannot blind the scan.
const PDF_STREAM_PAYLOAD = />>\s*stream\b[\s\S]*?endstream/g;

export function inspectAttachmentBytes(mimeType: string, bytes: Buffer): string | null {
  if (detectAttachmentMimeType(bytes) !== mimeType) return 'File signature does not match the declared MIME type.';

  const ascii = bytes.toString('latin1').toLowerCase();
  if (ascii.includes('eicar-standard-antivirus-test-file')) return 'Malware test signature detected.';

  const isPdf = mimeType === 'application/pdf';
  const scanned = isPdf ? ascii.replace(PDF_STREAM_PAYLOAD, '>>') : ascii;
  if (/<script\b|<svg\b|javascript:|vbscript:|data:text\/html/.test(scanned)) {
    return 'Active content is not allowed in attachments.';
  }
  if (isPdf && /\/(javascript|js|openaction|launch|richmedia|embeddedfile|xfa)\b/.test(scanned)) {
    return 'Active PDF content is not allowed.';
  }
  const pdfObjectCount = isPdf ? (scanned.match(/\bobj\b/g) ?? []).length : 0;
  if (pdfObjectCount > 100_000) return 'PDF object count exceeds the parser safety limit.';
  return null;
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

/** The `Content-Disposition` a signed download carries. `attachment` unless inline is asked for AND safe. */
export function downloadContentDisposition(input: {
  disposition?: 'inline' | 'attachment';
  mimeType?: string | null;
  fileName?: string | null;
}): string {
  const type = input.disposition === 'inline' && input.mimeType && INLINE_DISPOSITION_MIME_TYPES.test(input.mimeType)
    ? 'inline'
    : 'attachment';
  return `${type}; filename="${(input.fileName ?? 'download').replace(/["\r\n]/g, '_')}"`;
}

export function generateObjectKey(companyId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `pending/${companyId}/${randomUUID()}_${safe}`;
}

export function generateImmutableObjectKey(companyId: string, checksumSha256: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `evidence/${companyId}/${checksumSha256}/${randomUUID()}_${safe}`;
}
