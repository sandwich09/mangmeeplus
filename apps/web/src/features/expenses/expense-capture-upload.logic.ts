import type { ExpenseCaptureCapabilityDto } from '@watchdog-bms/contracts';
import { classifyUploadFile } from './expense-upload.logic';

/**
 * Multi-file intake on the ORDINARY upload panel (appendix §25, owner decision 2026-09-19).
 *
 * There is no capture group and no second screen any more: picking three files is picking three
 * receipts, so each one walks TODAY's single-file path on its own and becomes its own expense
 * draft. What is left here is only what that needs and the type system cannot hold:
 * - one file is one row with its own state, so a failure never restarts the files that arrived;
 * - files go one at a time, because the AI read, the slip ceiling and the money meters are all
 *   per-request — N files must cost and behave exactly like N separate uploads;
 * - the size/type gate is the SERVER's capability, never a number typed into the client.
 *
 * Kept free of React and of `fetch` so the state machine can be driven by a test.
 */

/** What the user is told about one file, in the order a file moves through it. */
export type CaptureUploadState = 'PENDING' | 'UPLOADING' | 'STORED' | 'FAILED';

export type CaptureUploadEntry = {
  name: string;
  size: number;
  state: CaptureUploadState;
  /** Set once the file became an expense, so a retry never uploads the same receipt twice. */
  expenseId?: string;
  error?: string;
};

export { expenseCaptureMegabytes as captureMegabytes } from '@watchdog-bms/contracts';

/** UXE-04/UXE-05, from the server's own capability — never from a number typed into the client. */
export function captureFileRejection(
  file: { name: string; type: string; size: number },
  capability: Pick<ExpenseCaptureCapabilityDto, 'maxBytes' | 'allowedMimeTypes'> | null,
): 'unsupported' | 'too_large' | null {
  if (classifyUploadFile(file.name, file.type) === 'unsupported') return 'unsupported';
  if (capability && file.type && capability.allowedMimeTypes.length > 0
    && !capability.allowedMimeTypes.includes(file.type)) return 'unsupported';
  if (capability && file.size > capability.maxBytes) return 'too_large';
  return null;
}

/** Compare the picked originals, before image preparation changes their size. */
export function appendReceiptFiles<T extends Pick<File, 'name' | 'size' | 'lastModified'>>(existing: T[], picked: T[]): T[] {
  const files = [...existing];
  for (const file of picked) if (!files.some(old => old.name === file.name && old.size === file.size && old.lastModified === file.lastModified)) files.push(file);
  return files;
}

export const entryForFile = (file: { name: string; size: number }): CaptureUploadEntry =>
  ({ name: file.name, size: file.size, state: 'PENDING' });

const patch = (
  entries: CaptureUploadEntry[],
  index: number,
  change: Partial<CaptureUploadEntry>,
): CaptureUploadEntry[] => entries.map((entry, position) => (position === index ? { ...entry, ...change } : entry));

/**
 * Send the selected files as N ORDINARY single-file uploads, SEQUENTIALLY.
 *
 * `upload` is the whole existing one-receipt path (init → PUT → complete → extraction request); it
 * answers the expense it created. A row that already has an `expenseId` is skipped, so the same
 * call retries only what failed, and every transition is published through `onChange` before the
 * next request — a failing file never stops the ones behind it.
 */
export async function runSingleFileUploads<T>(input: {
  entries: Array<{ entry: CaptureUploadEntry; file: File | null }>;
  upload: (file: File) => Promise<{ expenseId: string; result?: T }>;
  retryIndex?: number;
  describeFailure?: (cause: unknown) => string;
  onChange?: (entries: CaptureUploadEntry[]) => void;
  shouldStop?: () => boolean;
}): Promise<{ entries: CaptureUploadEntry[]; created: Array<{ expenseId: string; result?: T }> }> {
  let entries = input.entries.map(({ entry }) => entry);
  const created: Array<{ expenseId: string; result?: T }> = [];
  const publish = () => input.onChange?.(entries);

  for (const [index, { file }] of input.entries.entries()) {
    if (input.shouldStop?.()) break;
    const current = entries[index]!;
    if (current.expenseId || input.retryIndex !== undefined && input.retryIndex !== index) continue;
    if (!file) {
      entries = patch(entries, index, { state: 'FAILED' });
      publish();
      continue;
    }
    entries = patch(entries, index, { state: 'UPLOADING', error: undefined });
    publish();
    try {
      const done = await input.upload(file);
      created.push(done);
      entries = patch(entries, index, { state: 'STORED', expenseId: done.expenseId });
    } catch (cause) {
      entries = patch(entries, index, { state: 'FAILED', error: input.describeFailure?.(cause) });
    }
    publish();
  }
  return { entries, created };
}
