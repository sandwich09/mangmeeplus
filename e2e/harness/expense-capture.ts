/**
 * Shared by the appendix §25 intake spec (`expense-capture-intake.spec.ts`) and its evidence spec
 * (`expense-capture-intake.evidence.spec.ts`): the synthetic files, the ordinary upload panel, the
 * drafts the panel created, the drain of the capture read queue, and the seeded multi-document pair.
 *
 * Seeding writes only into an explicitly named local database, the way `receipt-draft-continuity.spec.ts`
 * does; the browser side is real HTTP against the real pages.
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { ensureBrowserLegalAcceptance } from './auth';
import { branchOptionName, chooseThemedOption, gotoCompany } from './e2e-utils';

const apiRequire = createRequire(resolve('apps/api/package.json'));

export const WORKER_TOKEN = process.env['WORKER_INTERNAL_TOKEN'];
export const API_BASE = process.env['E2E_API_BASE_URL'] ?? `http://127.0.0.1:${process.env['API_PORT'] ?? '3001'}/v1`;

/** A 1×1 PNG, generated here — never a copied customer receipt. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=',
  'base64',
);

/** The smallest valid one-page PDF, so the async read lane is the real one. */
export const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
  + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
  + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\n'
  + 'trailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
);

export type ExpenseRow = { id: string; captureSource: string; primaryAttachmentId: string | null };

/** The API's generated Prisma client, out of the same build the API under test runs from. */
export function prismaClient() {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(databaseUrl);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  expect(url.pathname).toBe('/watchdog_bms');
  const dist = process.env['API_DIST_DIR'] ?? `dist/e2e-${process.env['API_PORT'] ?? '3001'}`;
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const { PrismaClient } = apiRequire(resolve(`apps/api/${dist}/apps/api/src/generated/prisma/client.js`));
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** The ordinary upload panel, with the branch chosen — the same gate every upload test passes. */
export async function openUploadPanel(page: Page, api: APIRequestContext, companyId: string): Promise<void> {
  // Without the clickwrap every mutation 403s, which reads on screen as "the upload is broken".
  await ensureBrowserLegalAcceptance(page.context(), companyId);
  await gotoCompany(page, companyId, '/expenses/upload');
  const response = await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`);
  const { items: branches } = await response.json() as { items: Array<{ id: string; name: string; type: string }> };
  await chooseThemedOption(
    page,
    page.getByRole('combobox', { name: 'สาขา', exact: true }),
    branchOptionName(branches[0]!),
  );
  await expect(page.getByRole('button', { name: /^ส่งใบเสร็จ(?: \d+ ใบ)?$/ })).toBeEnabled();
}

/**
 * Every expense the panel created in this test, in the order it created them.
 *
 * Read off the `receipt-uploads` responses rather than diffed out of the list: the list is filtered
 * by period and by status, and "how many rows a filter shows" is not the question these files ask.
 * The body is read INSIDE the handler, before a navigation can discard it.
 */
export function watchCreatedDrafts(page: Page): () => Promise<string[]> {
  const pending: Array<Promise<string | null>> = [];
  page.on('response', (response) => {
    if (!/\/expenses\/receipt-uploads$/.test(new URL(response.url()).pathname)) return;
    if (response.request().method() !== 'POST' || !response.ok()) return;
    pending.push(response.json().then((body: { expenseId?: string }) => body.expenseId ?? null).catch(() => null));
  });
  return async () => [...new Set((await Promise.all(pending)).filter((id): id is string => Boolean(id)))];
}

/** The record itself, from the permission-checked API. */
export async function expense(api: APIRequestContext, companyId: string, id: string): Promise<ExpenseRow> {
  const response = await api.get(`companies/${companyId}/expenses/${id}`);
  expect(response.status()).toBe(200);
  return await response.json() as ExpenseRow;
}

/** What the scan worker does: run the queued capture reads. Needs `WORKER_INTERNAL_TOKEN`. */
export async function drainCaptureReads(request: APIRequestContext): Promise<void> {
  const drained = await request.post(`${API_BASE}/internal/expenses/capture-read/drain`, {
    headers: { 'x-worker-token': WORKER_TOKEN! }, data: {},
  });
  expect(drained.status()).toBeLessThan(300);
}

export type SplitPair = { tag: string; ownerId: string; siblingId: string; groupId: string; attachmentId: string };

/**
 * What the engine leaves behind after auto-splitting one file that held two documents (appendix
 * §25.4): two ordinary drafts sharing one HANDED_OFF group and one file (their PRIMARY receipt),
 * a DONE read job whose checkpoint records the split, and the multi-document observation.
 */
export async function seedSplitPair(client: any, companyId: string): Promise<SplitPair> {
  const tag = `w09-split-${randomUUID().slice(0, 8)}`;
  const branch = await client.branch.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' } });
  const base = {
    companyId, branchId: branch.id, createdByUserId: 'seed-local-owner', status: 'NEEDS_REVIEW' as const,
    captureSource: 'WEB_UPLOAD' as const, expenseDate: new Date(), currency: 'THB', vatMode: 'NO_VAT' as const,
  };
  const attachment = await client.attachmentObject.create({ data: {
    companyId, branchId: branch.id, uploadedByUserId: 'seed-local-owner', storageProvider: 'local',
    bucket: 'synthetic-local-test', objectKey: `${tag}.pdf`, originalFileName: `${tag}.pdf`,
    mimeType: 'application/pdf', byteSize: PDF.length, checksumSha256: `sha-${tag}`, status: 'ACTIVE',
  } });
  const group = await client.expenseCaptureGroup.create({ data: {
    companyId, branchId: branch.id, createdByUserId: 'seed-local-owner', intakeChannel: 'WEB',
    status: 'HANDED_OFF', handoffState: 'ACTIVE', handoffBatchKey: `auto-split:${tag}`,
  } });
  const owner = await client.expenseRecord.create({ data: {
    ...base, primaryAttachmentId: attachment.id, vendorNameSnapshot: 'ร้าน ก',
    captureGroupId: group.id, captureScopeKey: 'doc-1', aiVerifiedAt: new Date(),
  } });
  // The sibling owns the same file as its primary receipt (appendix §25.4 item 3).
  const sibling = await client.expenseRecord.create({ data: {
    ...base, vendorNameSnapshot: 'ร้าน ข', captureGroupId: group.id, captureScopeKey: 'doc-2',
    primaryAttachmentId: attachment.id,
  } });
  for (const [expenseId, purpose] of [[owner.id, 'expense.receipt.primary'], [sibling.id, 'expense.receipt.primary']] as const) {
    await client.attachmentLink.create({ data: {
      companyId, attachmentId: attachment.id, targetType: 'expense.record', targetId: expenseId, purpose,
      linkedByUserId: 'seed-local-owner',
    } });
  }
  const job = await client.expenseCaptureReadJob.create({ data: {
    companyId, ownerType: 'EXPENSE', expenseId: owner.id, attachmentId: attachment.id,
    attachmentChecksum: `sha-${tag}`, ocrAdmissionRequestId: randomUUID(), status: 'DONE',
    completedAt: new Date(),
    manifestJson: { pageCount: 2, pages: [{ index: 0, state: 'read' }, { index: 1, state: 'read' }], chunks: [], windows: [], electronicVerification: { status: 'NOT_CHECKED' } },
    // The idempotency record IS what the page reads the created ids from.
    checkpointJson: { version: 1, pages: {}, chunks: {}, windows: {}, splitExpenseIds: { d2: sibling.id } },
  } });
  await client.expenseCaptureObservation.create({ data: {
    companyId, expenseId: owner.id, jobId: job.id, version: 1, source: 'AI',
    payloadJson: { multiDocument: true, documents: [{ ref: 'd1' }, { ref: 'd2' }], items: [], components: [], totals: [], payments: [], refunds: [], reconciliation: [], completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0, 1], notes: [] } },
  } });
  return { tag, ownerId: owner.id, siblingId: sibling.id, groupId: group.id, attachmentId: attachment.id };
}

export async function cleanupSplitPair(client: any, companyId: string, pair: SplitPair | null): Promise<void> {
  if (!pair) return;
  const ids = [pair.ownerId, pair.siblingId];
  await client.expenseCaptureObservation.deleteMany({ where: { companyId, expenseId: { in: ids } } }).catch(() => undefined);
  await client.expenseCaptureReadJob.deleteMany({ where: { companyId, expenseId: { in: ids } } }).catch(() => undefined);
  await client.attachmentLink.deleteMany({ where: { companyId, attachmentId: pair.attachmentId } }).catch(() => undefined);
  await client.expenseRecord.deleteMany({ where: { companyId, id: { in: ids } } }).catch(() => undefined);
  await client.expenseCaptureGroup.deleteMany({ where: { companyId, id: pair.groupId } }).catch(() => undefined);
  await client.attachmentObject.deleteMany({ where: { companyId, id: pair.attachmentId } }).catch(() => undefined);
}

/**
 * A QUEUED read for an existing draft's primary file — what the page shows between "file saved"
 * and the worker's verdict. On a stack with no AI provider the in-process kick finishes a real job
 * in milliseconds, so the "กำลังอ่านเอกสาร" state can only be photographed from a job the worker has
 * not claimed yet. The checksum is the real file's, so a later drain runs it for real.
 */
export async function seedQueuedRead(client: any, companyId: string, expenseId: string): Promise<string> {
  const draft = await client.expenseRecord.findFirstOrThrow({ where: { companyId, id: expenseId }, select: { primaryAttachmentId: true } });
  const attachment = await client.attachmentObject.findFirstOrThrow({ where: { companyId, id: draft.primaryAttachmentId }, select: { id: true, checksumSha256: true } });
  const job = await client.expenseCaptureReadJob.create({ data: {
    companyId, ownerType: 'EXPENSE', expenseId, attachmentId: attachment.id,
    attachmentChecksum: attachment.checksumSha256 ?? '', ocrAdmissionRequestId: randomUUID(), status: 'QUEUED',
    manifestJson: { pageCount: null, pages: [], chunks: [], windows: [], electronicVerification: { status: 'NOT_CHECKED' } },
    checkpointJson: { version: 1, pages: {}, chunks: {}, windows: {} },
  } });
  return job.id;
}

/** Withdraw a seeded queued read, so the page falls back to the engine's real verdict for the file. */
export async function removeQueuedRead(client: any, companyId: string, jobId: string): Promise<void> {
  await client.expenseCaptureReadJob.deleteMany({ where: { companyId, id: jobId, status: 'QUEUED' } });
}
