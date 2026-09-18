import type { ExpenseCapturePausedReason, ExpenseCaptureReadStatus } from '@watchdog-bms/contracts';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';

/**
 * Read status → what the user is told (appendix §10, spec §17.2/§17.6).
 *
 * Two rules the type system cannot hold:
 * - "เก็บไฟล์แล้ว" is only ever said about a file the SERVER confirmed it holds, which is exactly
 *   what a read job is evidence of — a job exists only after the bytes were stored;
 * - a read that ENDED badly offers no way to read it again. §17.6 replaced the reread button with
 *   "the file is saved, carry on filling it in here", so `readAgainCta` answers false for every
 *   terminal failure rather than leaving the decision to each call site.
 */

/** The `GET …/read-status` row, mirrored locally: its contract file belongs to W03. */
export type ExpenseReadStatusFile = {
  fileId: string | null;
  attachmentId: string;
  status: ExpenseCaptureReadStatus;
  pagesRead: number;
  pageCount: number | null;
  pausedReason: ExpenseCapturePausedReason | null;
  lastErrorCode: string | null;
};

export type CaptureReadNotice = {
  tone: 'info' | 'error';
  messageKey: DictionaryKey;
  params?: Record<string, string>;
  /** The §17.2 case code, so support and the guards can name what the user saw. */
  uxe: 'UXE-10' | 'UXE-13' | 'UXE-14' | 'UXE-17' | 'READING' | 'DONE';
};

/** A job in one of these owes no further answer; the reading lane for that file is over. */
const TERMINAL_READ_STATUSES = new Set<ExpenseCaptureReadStatus>(['DONE', 'PARTIAL', 'PAUSED', 'FAILED', 'CANCELLED']);

/** …and these ended WITHOUT a complete read, which is what forbids a "read again" affordance. */
const TERMINAL_READ_FAILURES = new Set<ExpenseCaptureReadStatus>(['PARTIAL', 'PAUSED', 'FAILED']);

const PAUSED_REASON_KEYS: Record<ExpenseCapturePausedReason, DictionaryKey> = {
  ai_credit: 'expenses.capture.paused_ai_credit',
  page_limit: 'expenses.capture.paused_page_limit',
  call_budget: 'expenses.capture.paused_call_budget',
  time_budget: 'expenses.capture.paused_time_budget',
  memory_budget: 'expenses.capture.paused_memory_budget',
};

export const captureReadIsRunning = (status: ExpenseCaptureReadStatus | null | undefined): boolean =>
  Boolean(status) && !TERMINAL_READ_STATUSES.has(status!);

export const captureReadFailed = (status: ExpenseCaptureReadStatus | null | undefined): boolean =>
  Boolean(status) && TERMINAL_READ_FAILURES.has(status!);

/** "อ่านแล้ว n จาก m หน้า" — only once the reader has opened the file and counted its pages. */
export function captureReadProgressParams(
  file: Pick<ExpenseReadStatusFile, 'pagesRead' | 'pageCount'>,
): { read: string; total: string } | null {
  return file.pageCount && file.pageCount > 0
    ? { read: String(file.pagesRead), total: String(file.pageCount) }
    : null;
}

export function capturePausedReasonKey(reason: ExpenseCapturePausedReason | null): DictionaryKey | null {
  return reason ? PAUSED_REASON_KEYS[reason] ?? null : null;
}

/** The one persistent line shown beside the file. `null` while there is nothing to say. */
export function captureReadNotice(file: ExpenseReadStatusFile | null | undefined): CaptureReadNotice | null {
  if (!file) return null;
  if (file.status === 'FAILED') {
    return { tone: 'error', messageKey: 'expenses.capture.read_failed', uxe: 'UXE-10' };
  }
  if (file.status === 'PARTIAL') {
    return { tone: 'info', messageKey: 'expenses.capture.read_partial', uxe: 'UXE-13' };
  }
  if (file.status === 'PAUSED') {
    return { tone: 'info', messageKey: 'expenses.capture.read_paused', uxe: 'UXE-14' };
  }
  if (file.status === 'CANCELLED') return null;
  if (file.status === 'DONE') {
    return { tone: 'info', messageKey: 'expenses.capture.read_done', uxe: 'DONE' };
  }
  const progress = captureReadProgressParams(file);
  return progress
    ? { tone: 'info', messageKey: 'expenses.capture.read_progress', params: progress, uxe: 'READING' }
    : { tone: 'info', messageKey: 'expenses.capture.read_stored_reading', uxe: 'READING' };
}

/**
 * Whether "อ่านเอกสารอีกครั้ง" may be offered at all. It is a deliberate user intent on a file that
 * has NOT just failed — never a recovery affordance hung off an error (§17.6).
 */
export function captureReadAgainAllowed(input: {
  canExtract: boolean;
  readStatus?: ExpenseCaptureReadStatus | null;
  noticeTone?: 'info' | 'error' | null;
}): boolean {
  if (!input.canExtract) return false;
  if (captureReadFailed(input.readStatus)) return false;
  return input.noticeTone !== 'error';
}
