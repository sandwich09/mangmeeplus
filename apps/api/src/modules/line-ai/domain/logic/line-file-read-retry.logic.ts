import { createHmac, timingSafeEqual } from 'node:crypto';

const PREFIX = '__line_file_read_retry__:';
export type FileReadRetryControl = { expenseId: string; attachmentId: string; signature: string };
type RetryOwner = { companyId: string; userId: string; chatKeyHash: string; messagingChannelId: string };

export function fileReadRetryData(secret: string, owner: RetryOwner, expenseId: string, attachmentId: string): string {
  const signature = createHmac('sha256', secret).update(JSON.stringify([
    'line-file-read-retry-v1', owner.companyId, owner.userId, owner.chatKeyHash, owner.messagingChannelId, expenseId, attachmentId,
  ])).digest('base64url');
  return new URLSearchParams({ action: 'file-read-retry', expenseId, attachmentId, signature }).toString();
}

export function fileReadRetryPostbackCommand(data: string | undefined): string | null {
  if (!data || data.length > 300) return null;
  const params = new URLSearchParams(data);
  const keys = ['action', 'expenseId', 'attachmentId', 'signature'];
  return [...params.keys()].length === keys.length && keys.every(key => params.getAll(key).length === 1)
    && params.get('action') === 'file-read-retry'
    && ['expenseId', 'attachmentId'].every(key => /^[A-Za-z0-9_-]{1,128}$/u.test(params.get(key) ?? ''))
    && /^[A-Za-z0-9_-]{43}$/u.test(params.get('signature') ?? '') ? PREFIX + params.toString() : null;
}

export function isFileReadRetryCommand(text: string): boolean { return text.startsWith(PREFIX); }

export function parseFileReadRetryControl(text: string): FileReadRetryControl | null {
  if (!text.startsWith(PREFIX) || !fileReadRetryPostbackCommand(text.slice(PREFIX.length))) return null;
  const params = new URLSearchParams(text.slice(PREFIX.length));
  return { expenseId: params.get('expenseId')!, attachmentId: params.get('attachmentId')!, signature: params.get('signature')! };
}

export function verifyFileReadRetryControl(secret: string, owner: RetryOwner, control: FileReadRetryControl): boolean {
  const expected = new URLSearchParams(fileReadRetryData(secret, owner, control.expenseId, control.attachmentId)).get('signature')!;
  return Boolean(secret) && control.signature.length === expected.length
    && timingSafeEqual(Buffer.from(control.signature), Buffer.from(expected));
}
