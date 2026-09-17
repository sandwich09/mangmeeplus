// Pure helpers for the banking statement import + matching UI. No React, no fetch.
import { ATTACHMENT_UPLOAD_ACCEPT, classifyUploadSourceFile } from '@/common/files/upload-file.logic';

export const BANKING_TABS = ['accounts', 'cash', 'import', 'matching', 'reconciliations', 'adjustments'] as const;
export type BankingTab = (typeof BANKING_TABS)[number];

/**
 * Each tab uses the permission for its first tab-owned read request. Import and
 * matching also load bank accounts, but `bank.account.read` is their shared
 * prerequisite rather than permission to offer those tabs.
 */
const BANKING_TAB_PERMISSIONS: Record<BankingTab, readonly string[]> = {
  accounts: ['bank.account.read'],
  cash: ['bank.cash.read'],
  import: ['bank.statement.read'],
  matching: ['bank.match.read'],
  reconciliations: ['bank.reconciliation.read'],
  adjustments: ['bank.adjustment.read'],
};

export function visibleBankingTabs(permissions: readonly string[]): BankingTab[] {
  return BANKING_TABS.filter((tab) =>
    BANKING_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key)),
  );
}

/** Unknown or hidden `?tab=` values fall back to the first tab this session can use. */
export function parseBankingTab(
  value: string | null | undefined,
  visible: readonly BankingTab[] = BANKING_TABS,
): BankingTab {
  return visible.includes(value as BankingTab) ? (value as BankingTab) : (visible[0] ?? 'accounts');
}

export type ParsedStatement = { headers: string[]; rows: Record<string, string>[] };

/**
 * Parse CSV or TSV text (bank exports, or rows pasted from Excel) into
 * objects keyed by the header row. Quoted CSV fields with embedded commas are
 * supported; newlines inside quoted fields are not (bank statement exports
 * are one record per line).
 */
export function parseDelimitedStatement(text: string): ParsedStatement {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitDelimitedLine(lines[0], delimiter).map((h, i) => h.trim() || `column${i + 1}`);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitDelimitedLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---- Matching helpers ----

type LineLike = {
  direction: string;
  signedAmount: string;
  postedDate: string;
  currency: string;
};

type CandidateLike = {
  direction: string;
  currency: string;
  paymentDate: string;
  remainingUnmatchedAmount: string;
};

function toCents(v: string | undefined | null): number {
  const n = Number.parseFloat(String(v ?? '0').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToAmount(c: number): string {
  return (c / 100).toFixed(2);
}

/**
 * Filter candidates to the line's direction + currency and sort by closest
 * amount, then closest date. Mirrors the server-side scoring priorities.
 */
export function rankCandidatesForLine<T extends CandidateLike>(line: LineLike, candidates: T[]): T[] {
  const lineCents = Math.abs(toCents(line.signedAmount));
  const lineDate = new Date(line.postedDate).getTime();
  return candidates
    .filter((c) => c.direction === line.direction && c.currency.toUpperCase() === line.currency.toUpperCase())
    .map((c) => {
      const amountDiff = Math.abs(Math.abs(toCents(c.remainingUnmatchedAmount)) - lineCents);
      const candDate = new Date(c.paymentDate).getTime();
      const dateDiff = Number.isFinite(lineDate) && Number.isFinite(candDate) ? Math.abs(lineDate - candDate) : Number.MAX_SAFE_INTEGER;
      return { c, amountDiff, dateDiff };
    })
    .sort((a, b) => a.amountDiff - b.amountDiff || a.dateDiff - b.dateDiff)
    .map((x) => x.c);
}

/** Prefill allocation: what's left on the line, capped by what's left on the candidate. */
export function suggestedAllocation(lineSignedAmount: string, alreadyMatched: string, candidateRemaining: string): string {
  const lineRemaining = Math.abs(toCents(lineSignedAmount)) - toCents(alreadyMatched);
  const cents = Math.min(Math.max(lineRemaining, 0), toCents(candidateRemaining));
  return centsToAmount(cents);
}

/** Sum of confirmed match allocations for a line. */
export function confirmedMatchedTotal(matches: { status: string; allocatedAmount: string }[]): string {
  const cents = matches.filter((m) => m.status === 'CONFIRMED').reduce((s, m) => s + toCents(m.allocatedAmount), 0);
  return centsToAmount(cents);
}

// ---- Statement file policy and extraction helpers ----

export const STATEMENT_UPLOAD_ACCEPT =
  `.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,${ATTACHMENT_UPLOAD_ACCEPT}`;
export const MAX_STATEMENT_TEXT_BYTES = 4 * 1024 * 1024;
export const MAX_STATEMENT_BINARY_BYTES = 25 * 1024 * 1024;

export type StatementFileKind = 'delimited' | 'extractable' | 'unsupported';

export function classifyStatementFile(fileName: string, mimeType: string): StatementFileKind {
  const extension = /^.+\.([^.]+)$/.exec(fileName.trim())?.[1]?.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (classifyUploadSourceFile({ name: fileName, type: mimeType }) !== 'unsupported') return 'extractable';
  if (
    (extension === 'csv' && ['', 'text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'].includes(mime))
    || (extension === 'tsv' && ['', 'text/tab-separated-values', 'text/plain'].includes(mime))
    || (extension === 'txt' && ['', 'text/plain'].includes(mime))
  ) return 'delimited';
  return 'unsupported';
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const EXTRACT_ERROR_MESSAGES: Record<string, string> = {
    extract_pdf_scanned_unsupported:
      'PDF นี้เป็นไฟล์สแกน (ไม่มีชั้นข้อความ) — ถ่ายรูปหน้ากระดาษเป็น JPG/PNG แล้วอัพโหลดแทน หรือใช้ไฟล์ CSV จากธนาคาร',
    extract_pdf_table_not_found: 'อ่าน PDF ได้แต่ไม่พบหัวตารางรายการเดินบัญชี — ตรวจสอบว่าเป็น statement จากธนาคาร หรือใช้ไฟล์ CSV แทน',
    extract_pdf_unreadable: 'เปิดไฟล์ PDF ไม่สำเร็จ ไฟล์อาจเสียหายหรือถูกล็อกด้วยรหัสผ่าน',
    extract_ocr_not_configured: 'ระบบ OCR ยังไม่ถูกเปิดใช้งาน — ใช้ไฟล์ CSV จากธนาคาร หรือติดต่อผู้ดูแลระบบ',
    extract_ocr_disabled: 'ผู้ดูแลปิด OCR ของบริษัทนี้ไว้ — กรุณาใช้ไฟล์ CSV จากธนาคาร หรือติดต่อผู้ดูแล',
    extract_ocr_limit_exceeded: 'ใช้ OCR ครบจำนวนของเดือนนี้แล้ว — กรุณาใช้ไฟล์ CSV จากธนาคาร หรือติดต่อผู้ดูแล',
    extract_ocr_duplicate_request: 'คำขออ่านไฟล์นี้เคยถูกรับแล้ว — ตรวจรายการเดิมก่อนลองอัปโหลดอีกครั้ง',
    extract_ocr_quota_unavailable: 'ตรวจสอบสิทธิ์ OCR ไม่สำเร็จชั่วคราว — กรุณาลองใหม่ภายหลังหรือใช้ไฟล์ CSV',
    // Spec §9.4: the company's monthly AI money, not the OCR count. Re-photographing the page cannot
    // help, so the way out is the CSV the bank already provides (or a bigger package).
    extract_ai_budget_exhausted: 'งบ AI ของเดือนนี้ไม่พออ่านไฟล์นี้แล้ว — ไฟล์ยังอยู่ กรุณาใช้ไฟล์ CSV จากธนาคาร หรือติดต่อผู้ดูแลเพื่อปรับแพ็กเกจ',
    extract_ai_budget_unavailable: 'ยังตรวจสอบงบ AI ไม่ได้ จึงยังไม่ได้อ่านไฟล์นี้ — ไฟล์ยังอยู่ กรุณาลองใหม่ภายหลังหรือใช้ไฟล์ CSV',
    extract_ocr_failed: 'อ่านรูปภาพไม่สำเร็จ ลองถ่ายใหม่ให้ชัดขึ้น หรือใช้ไฟล์ CSV จากธนาคาร',
    extract_file_too_large: 'ไฟล์ใหญ่เกินกำหนด',
    extract_unsupported_mime_type: 'รองรับเฉพาะไฟล์ PDF, JPG, PNG',
    extract_invalid_file: 'ไฟล์ไม่ถูกต้อง ชนิดไฟล์อาจไม่ตรงกับนามสกุล หรือไฟล์ไม่ผ่านการตรวจสอบความปลอดภัย',
    extract_no_rows_found: 'ไม่พบรายการเดินบัญชีในไฟล์',
};

export function extractErrorMessage(code: string): string {
  return Object.hasOwn(EXTRACT_ERROR_MESSAGES, code) ? EXTRACT_ERROR_MESSAGES[code]! : code;
}

/** Pull only an allowlisted statement-extraction code before the global API formatter hides raw 422 details. */
export function statementExtractErrorCode(error: unknown): string | null {
  const value = error as {
    message?: unknown;
    code?: unknown;
    details?: { message?: unknown; code?: unknown };
  } | null;
  const candidates = [value?.code, value?.details?.code, value?.message, value?.details?.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && Object.hasOwn(EXTRACT_ERROR_MESSAGES, candidate)) return candidate;
    if (Array.isArray(candidate)) {
      const match = candidate.find((item) => typeof item === 'string' && Object.hasOwn(EXTRACT_ERROR_MESSAGES, item));
      if (typeof match === 'string') return match;
    }
  }
  return null;
}

const STATEMENT_ROW_ERROR_MESSAGES: Record<string, string> = {
  'Missing posted date': 'ไม่พบวันที่ทำรายการ กรุณาระบุวันที่',
  'Missing amount': 'ไม่พบจำนวนเงิน กรุณาระบุยอดถอน ยอดฝาก หรือจำนวนเงิน',
};

/** Row diagnostics come from a successful preview response and are not presentation copy. */
export function statementRowErrorMessage(diagnostic: string): string {
  return STATEMENT_ROW_ERROR_MESSAGES[diagnostic] ?? 'ข้อมูลแถวนี้ไม่ถูกต้อง กรุณาตรวจสอบวันที่และจำนวนเงิน';
}

export const SOURCE_KIND_LABELS: Record<string, string> = {
  pdf_text: 'อ่านจากชั้นข้อความ PDF (ไม่ใช้ AI)',
  ocr: 'อ่านด้วย AI OCR — ตรวจทานตัวเลขก่อนยืนยัน',
};

/** Rows whose OCR confidence is below this get flagged for human attention. */
export const LOW_CONFIDENCE_THRESHOLD = 0.8;

// ---- Thai labels ----

export const LINE_STATUS_LABELS: Record<string, string> = {
  UNMATCHED: 'ยังไม่จับคู่',
  SUGGESTED: 'มีรายการแนะนำ',
  PARTIALLY_MATCHED: 'จับคู่บางส่วน',
  MATCHED: 'จับคู่แล้ว',
  IGNORED: 'ข้ามแล้ว',
  VOIDED: 'ยกเลิก',
};

export const IMPORT_STATUS_LABELS: Record<string, string> = {
  PREVIEW: 'ตัวอย่าง',
  COMMITTED: 'นำเข้าแล้ว',
  VOIDED: 'ยกเลิก',
  FAILED: 'ล้มเหลว',
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  CUSTOMER_PAYMENT: 'รับชำระจากลูกค้า',
  SUPPLIER_PAYMENT: 'จ่ายซัพพลายเออร์',
  EXPENSE_PAYMENT: 'จ่ายค่าใช้จ่าย',
  REIMBURSEMENT_PAYMENT: 'จ่ายเบิกคืน',
  BANK_ADJUSTMENT: 'รายการปรับปรุงธนาคาร',
  LEDGER_JOURNAL_LINE: 'รายการบัญชีแยกประเภท',
  INTER_ACCOUNT_TRANSFER: 'โอนระหว่างบัญชี',
  OTHER_SOURCE: 'อื่น ๆ',
};
