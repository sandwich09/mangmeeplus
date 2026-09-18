import type { ExpenseCaptureCapabilityDto } from '@watchdog-bms/contracts';
import { classifyUploadFile, expenseExtractionResponseIsUnknown } from './expense-upload.logic';

/**
 * Multi-file intake for a capture group (appendix §3/§11, spec §14.3).
 *
 * The rules this file exists to hold:
 * - one file is one row with its own state, so a failure never restarts the files that arrived;
 * - a lost response is NOT a failure — the group is re-read and the server's answer wins (UXE-02);
 * - the browser promises nothing about bytes it no longer holds: after a reload, a file the server
 *   never received asks to be picked again, and every STORED file stays where it is.
 *
 * Kept free of React and of `fetch` so the state machine can be driven by a test.
 */

/** What the user is told about one file, in the order a file moves through it. */
export type CaptureUploadState = 'PENDING' | 'UPLOADING' | 'STORED' | 'FAILED' | 'UNKNOWN';

export type CaptureUploadEntry = {
  /** Null until the server reserved a slot; kept afterwards so a retry is the SAME file. */
  fileId: string | null;
  name: string;
  size: number;
  state: CaptureUploadState;
  /** The bytes never arrived and this browser no longer holds them — ask for the file again. */
  needsReselect?: boolean;
};

export type CaptureUploadManifest = {
  companyId: string;
  groupId: string;
  revision: number;
  files: CaptureUploadEntry[];
};

export type CaptureUploadIntent = {
  fileId: string;
  attachmentId: string;
  revision: number;
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
};

export type CaptureUploadApi = {
  addFile(groupId: string, body: {
    originalFileName: string; mimeType: string; byteSize: number; expectedRevision: number;
  }): Promise<CaptureUploadIntent>;
  putBytes(intent: CaptureUploadIntent, file: File): Promise<void>;
  completeFile(groupId: string, fileId: string, body: {
    byteSize: number; expectedRevision: number;
  }): Promise<{ revision: number; uploadState: string }>;
  readGroup(groupId: string): Promise<{
    revision: number; files: Array<{ fileId: string; uploadState: string }>;
  }>;
};

type ManifestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const manifestKey = (companyId: string) => `expense-capture-upload:${companyId}`;

export function readCaptureManifest(
  storage: ManifestStorage | undefined,
  companyId: string,
): CaptureUploadManifest | null {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(manifestKey(companyId)) ?? 'null') as CaptureUploadManifest | null;
    return raw && raw.companyId === companyId && typeof raw.groupId === 'string' && Array.isArray(raw.files)
      ? raw
      : null;
  } catch { return null; }
}

export function writeCaptureManifest(
  storage: ManifestStorage | undefined,
  manifest: CaptureUploadManifest | null,
  companyId: string,
): void {
  if (!storage) return;
  try {
    if (manifest) storage.setItem(manifestKey(companyId), JSON.stringify(manifest));
    else storage.removeItem(manifestKey(companyId));
  } catch { /* storage can be disabled */ }
}

/**
 * What the reopened tab shows: the SERVER's manifest, plus the rows it never received. A file the
 * server has is displayed from the server's own state; a file whose bytes never arrived is offered
 * for re-selection instead of being claimed as saved.
 */
export function mergeCaptureManifest(
  local: CaptureUploadEntry[],
  server: Array<{ fileId: string; uploadState: string; originalFileName?: string; byteSize?: number }>,
): CaptureUploadEntry[] {
  const byId = new Map(server.map((file) => [file.fileId, file]));
  const merged = local.map((entry) => {
    const stored = entry.fileId ? byId.get(entry.fileId) : undefined;
    if (stored) byId.delete(stored.fileId);
    if (stored?.uploadState === 'STORED') return { ...entry, state: 'STORED' as const, needsReselect: false };
    if (stored?.uploadState === 'REJECTED' || stored?.uploadState === 'DETACHED') {
      return { ...entry, state: 'FAILED' as const, needsReselect: true };
    }
    // Reserved but never filled, or never reserved at all: this browser cannot promise the bytes.
    return { ...entry, state: entry.state === 'STORED' ? 'FAILED' as const : entry.state, needsReselect: true };
  });
  // Files this tab never knew about (another tab, or LINE) still belong to the group.
  const extra: CaptureUploadEntry[] = [...byId.values()]
    .filter((file) => file.uploadState !== 'DETACHED')
    .map((file) => ({
      fileId: file.fileId,
      name: file.originalFileName ?? '',
      size: file.byteSize ?? 0,
      state: file.uploadState === 'STORED' ? 'STORED' : 'PENDING',
      needsReselect: file.uploadState !== 'STORED',
    }));
  return [...merged, ...extra];
}

export const allCaptureFilesStored = (files: CaptureUploadEntry[]): boolean =>
  files.length > 0 && files.every((file) => file.state === 'STORED');

/**
 * Is there work a new selection would throw away?
 *
 * A manifest only survives while a group is unfinished (`settleCaptureUpload` clears it the moment
 * every file is stored), and the bytes it points at are on the SERVER — so clearing it because the
 * customer picked another file abandons a group only this browser knew how to find. The panel asks
 * instead: "ทำงานเดิมต่อ" or "เริ่มงานใหม่".
 */
export const hasUnfinishedCapture = (stored: CaptureUploadManifest | null): boolean =>
  Boolean(stored && stored.files.length > 0 && !allCaptureFilesStored(stored.files));

/** bytes → "9.8 MB". One decimal, because the limits users meet are whole-ish megabytes. */
export const captureMegabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

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

const patch = (
  files: CaptureUploadEntry[],
  index: number,
  change: Partial<CaptureUploadEntry>,
): CaptureUploadEntry[] => files.map((entry, position) => (position === index ? { ...entry, ...change } : entry));

/**
 * Send one pass of the selected files. Already-STORED rows are skipped, so the same call resumes an
 * interrupted batch, and every transition is published through `onChange` before the next request.
 *
 * Returns the group revision the server last confirmed, so the caller keeps its fence current.
 */
export async function runCaptureUpload(input: {
  groupId: string;
  revision: number;
  entries: Array<{ entry: CaptureUploadEntry; file: File | null }>;
  api: CaptureUploadApi;
  onChange?: (files: CaptureUploadEntry[]) => void;
}): Promise<{ revision: number; files: CaptureUploadEntry[] }> {
  let revision = input.revision;
  let files = input.entries.map(({ entry }) => entry);
  const publish = () => input.onChange?.(files);

  for (const [index, { file }] of input.entries.entries()) {
    const current = files[index]!;
    if (current.state === 'STORED') continue;
    if (!file) {
      files = patch(files, index, { state: 'FAILED', needsReselect: true });
      publish();
      continue;
    }
    files = patch(files, index, { state: 'UPLOADING', needsReselect: false });
    publish();
    try {
      let fileId = current.fileId;
      if (!fileId) {
        const intent = await input.api.addFile(input.groupId, {
          originalFileName: file.name, mimeType: file.type, byteSize: file.size, expectedRevision: revision,
        });
        revision = intent.revision;
        fileId = intent.fileId;
        files = patch(files, index, { fileId });
        publish();
        await input.api.putBytes(intent, file);
      }
      const completed = await input.api.completeFile(input.groupId, fileId, {
        byteSize: file.size, expectedRevision: revision,
      });
      revision = completed.revision;
      files = patch(files, index, { state: completed.uploadState === 'STORED' ? 'STORED' : 'FAILED' });
      publish();
    } catch (error) {
      // "We do not know" is its own state (UXE-02): the bytes may well be stored, so nothing is
      // re-sent and nothing is called failed until the group itself answers.
      files = patch(files, index, { state: expenseExtractionResponseIsUnknown(error) ? 'UNKNOWN' : 'FAILED' });
      publish();
    }
  }
  return { revision, files };
}

/** "ตรวจสอบสถานะ": ask the group what it holds and believe it, for every row this tab is unsure of. */
export async function reconcileCaptureUpload(input: {
  groupId: string;
  files: CaptureUploadEntry[];
  api: Pick<CaptureUploadApi, 'readGroup'>;
}): Promise<{ revision: number; files: CaptureUploadEntry[] }> {
  const group = await input.api.readGroup(input.groupId);
  return { revision: group.revision, files: mergeCaptureManifest(input.files, group.files) };
}
