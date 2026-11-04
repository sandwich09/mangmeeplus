/**
 * The durable reader's state machine (appendix §4.5), against fakes for storage, the gateway and
 * the money seams. No provider, no database, no network.
 *
 * What is pinned here is what a review cannot see by reading the happy path: a runner that lost
 * its lease writes nothing, a resumed job pays only for what it has no answer for, a budget that
 * runs out PAUSES with the pages already read, a file holding two shops' receipts is SPLIT into one
 * draft each exactly once (appendix §25), and every terminal transition appends exactly one
 * notification.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { BusinessDocumentClassification, ExpenseCaptureObservations } from '@watchdog-bms/contracts';
import {
  EXPENSE_CAPTURE_MAX_PROVIDER_CALLS,
  EXPENSE_CAPTURE_MAX_RUN_MS,
  ExpenseCaptureReadRunnerService,
} from './expense-capture-read-runner.service';
import { ExpenseCaptureAutoSplitService } from './expense-capture-auto-split.service';
import { planWindows, priorDocuments } from '../../domain/logic/expense-capture-assembly.logic';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReceiptOcrApplyService } from './receipt-ocr-apply.service';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';

it('Z3: a published PARTIAL cannot swallow attempts_exhausted for the same LINE PDF job', async () => {
  const h = await build({ readResults: [{ status: 'ok', truncated: true, text: 'ITEM 60.00' }] });
  const events = new Map<string, any>();
  (h.runner as any).outbox = new OutboxAppendService({ append: async (event: any) => {
    if (!events.has(event.eventKey)) events.set(event.eventKey, event);
  } } as any, { error: () => assert.fail('outbox append must persist') } as any);
  try {
    await h.runner.runClaimed(h.job);
    assert.equal(terminal(h).status, 'PARTIAL');
    h.job.status = 'READING'; h.job.leaseOwner = 'owner-1'; h.job.attempts = 6;
    await h.runner.runClaimed(h.job);
    assert.equal(terminal(h).status, 'FAILED');
    assert.equal(terminal(h).lastErrorCode, 'attempts_exhausted');
    assert.equal(events.size, 2, 'the real outbox dedupe must retain the final failure');
    assert.deepEqual([...events.values()].map(event => event.payloadJson.status), ['PARTIAL', 'FAILED']);
    assert.deepEqual([...events.values()].map(event => event.payloadJson.requestId), ['job-1:1', 'job-1:6']);
    assert.ok([...events.values()].every(event => event.payloadJson.expenseId === h.job.expenseId && event.companyId === h.job.companyId));
    h.job.status = 'READING'; h.job.leaseOwner = 'owner-1';
    await h.runner.runClaimed(h.job);
    assert.equal(events.size, 2, 'replaying the same claimed attempt remains idempotent');
  } finally { h.restore(); }
});

const classification: BusinessDocumentClassification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  // A real read quotes its evidence, and `isExpenseExtractionEligible` refuses without it — a
  // fixture with empty signal arrays would silently test the refusal instead of the apply.
  confidence: 0.9, evidenceSignals: ['ร้านตัวอย่าง'], amountSignals: ['100.00'], settlementSignals: ['รวม 100.00'],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
};

function observations(over: Partial<ExpenseCaptureObservations> = {}): ExpenseCaptureObservations {
  return {
    documents: [{
      ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
      issuer: { name: 'ร้านตัวอย่าง' }, documentNumber: 'INV-1', documentDate: '2026-09-10', classification,
    }],
    items: [
      { id: '0:1', documentRef: 'd1', description: 'น้ำดื่ม', quantity: '1', amount: '60.00', event: 'sale', evidenceSpan: 'น้ำดื่ม 60.00' },
      { id: '0:2', documentRef: 'd1', description: 'ขนม', quantity: '1', amount: '40.00', event: 'sale', evidenceSpan: 'ขนม 40.00' },
    ],
    components: [],
    totals: [{ documentRef: 'd1', kind: 'document_total', amount: '100.00', evidenceSpan: 'รวม 100.00' }],
    payments: [], refunds: [],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
    ...over,
  };
}

/**
 * One file, two shops — what appendix §25 splits. Each document quotes its OWN printed amount,
 * because `isExpenseExtractionEligible` refuses a total the classification never saw.
 */
const shopClassification = (amount: string): BusinessDocumentClassification =>
  ({ ...classification, amountSignals: [amount], settlementSignals: [`รวม ${amount}`] });

function twoShops(): ExpenseCaptureObservations {
  return observations({
    documents: [
      { ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้าน ก' }, documentNumber: 'A-1', classification: shopClassification('60.00') },
      { ref: 'd2', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้าน ข' }, documentNumber: 'B-1', classification: shopClassification('40.00') },
    ],
    items: [
      { id: '0:1', documentRef: 'd1', description: 'น้ำดื่ม', quantity: '1', amount: '60.00', event: 'sale', evidenceSpan: 'น้ำดื่ม 60.00' },
      { id: '0:2', documentRef: 'd2', description: 'ขนม', quantity: '1', amount: '40.00', event: 'sale', evidenceSpan: 'ขนม 40.00' },
    ],
    totals: [
      { documentRef: 'd1', kind: 'document_total', amount: '60.00', evidenceSpan: 'รวม 60.00' },
      { documentRef: 'd2', kind: 'document_total', amount: '40.00', evidenceSpan: 'รวม 40.00' },
    ],
  });
}

async function textPdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let index = 0; index < pages; index += 1) {
    doc.addPage([595, 842]).drawText(`PAGE ${index + 1} TOTAL 100.00`, { x: 40, y: 800, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

type Harness = Awaited<ReturnType<typeof build>>;

async function build(options: {
  pages?: number;
  ownerType?: 'CAPTURE_GROUP' | 'EXPENSE';
  readResults?: Array<{ status: 'ok' | 'failed'; errorCode?: string; truncated?: boolean; text?: string }>;
  extractResults?: Array<{ status: 'ok' | 'failed'; errorCode?: string; observations?: ExpenseCaptureObservations }>;
  ocrAdmission?: { allowed: boolean; reason?: string };
  free?: boolean;
  observationFailure?: boolean;
  workerAccess?: { permissions: string[]; scopes?: { branchIds?: string[] } };
  applyResult?: Record<string, unknown>;
  expense?: Record<string, unknown> | null;
  maxPages?: number;
  derivativeMaxBytes?: number;
  corruptBytes?: boolean;
  jobOver?: Record<string, unknown>;
  applyService?: ReceiptOcrApplyService;
} = {}) {
  const bytes = options.corruptBytes
    ? Buffer.from('%PDF-1.7\nthis file cannot be opened')
    : await textPdf(options.pages ?? 1);
  const ownerType = options.ownerType ?? 'EXPENSE';
  const job: any = {
    id: 'job-1', companyId: 'co-1', ownerType,
    groupId: ownerType === 'CAPTURE_GROUP' ? 'group-1' : null,
    expenseId: ownerType === 'EXPENSE' ? 'exp-1' : null,
    fileId: ownerType === 'CAPTURE_GROUP' ? 'file-1' : null,
    attachmentId: 'att-1', attachmentChecksum: '', objectVersionId: null,
    status: 'READING', ocrAdmissionRequestId: 'ocr-1', manifestJson: {}, checkpointJson: {},
    attempts: 1, leaseOwner: 'owner-1', leasedUntil: new Date(Date.now() + 120_000),
    pausedReason: null, lastErrorCode: null, providerCallCount: 0,
    expectedSourceUpdatedAt: new Date('2026-09-15T00:00:00.000Z'),
    createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    ...options.jobOver,
  };
  const writes: Array<{ owner: string; data: Record<string, unknown>; accepted: boolean }> = [];
  const observationsStored: any[] = [];
  const fileWrites: any[] = [];
  const outbox: any[] = [];
  const released: any[] = [];
  const admissions: any[] = [];
  let leaseOwner: string | null = job.leaseOwner;

  const capture = {
    client: {
      expenseCaptureObservation: {
        updateMany: async () => ({ count: 1 }),
        findFirst: async () => observationsStored.at(-1) ?? null,
      },
      expenseCaptureFile: { updateMany: async (input: any) => { fileWrites.push(input.data); return { count: 1 }; } },
    },
    updateJobFenced: async (input: any) => {
      const accepted = input.leaseOwner === leaseOwner;
      writes.push({ owner: input.leaseOwner, data: input.data, accepted });
      if (accepted) Object.assign(job, input.data);
      return accepted;
    },
    renewJobLease: async (input: any) => input.leaseOwner === leaseOwner,
    setFilePageCount: async () => undefined,
    nextObservationVersion: async () => observationsStored.length + 1,
    createObservation: async (_db: unknown, input: any) => {
      if (options.observationFailure) throw new Error('storage unavailable');
      observationsStored.push(input);
      return input;
    },
    findGroup: async () => ({ id: 'group-1', companyId: 'co-1', createdByUserId: 'user-1', branchId: 'br-1', status: 'OPEN' }),
    findFile: async () => ({ id: 'file-1', uploadState: 'STORED' }),
    claimReadJob: async () => job,
    claimReadJobs: async () => [job],
    // Appendix §25 auto-split: the sibling group and the membership write it needs.
    transaction: async (fn: (db: unknown) => Promise<unknown>) => fn({
      expenseRecord: { updateMany: async (input: any) => { groupMemberships.push(input); return { count: 1 }; } },
    }),
    createGroup: async (_db: unknown, input: any) => {
      groupsCreated.push(input);
      return { id: `group-auto-${groupsCreated.length}`, revision: 1 };
    },
    bumpRevision: async (_db: unknown, input: any) => { groupWrites.push(input.data); return 2; },
  };
  const groupsCreated: any[] = [];
  const groupWrites: any[] = [];
  const groupMemberships: any[] = [];
  const attachments = {
    findById: async () => ({ id: 'att-1', companyId: 'co-1', bucket: 'b', objectKey: 'k', mimeType: 'application/pdf', status: 'ACTIVE', byteSize: bytes.byteLength }),
  };
  const createdExpenses: any[] = [];
  const evidenceLinks: any[] = [];
  // What the sibling's own INSERT transaction writes after the row exists (its primary receipt).
  const siblingWrites: any[] = [];
  const siblingTx = { expenseRecord: { updateMany: async (input: any) => { siblingWrites.push(input); return { count: 1 }; } } };
  const expenses = {
    findById: async () => options.expense === undefined
      ? {
        id: 'exp-1', companyId: 'co-1', status: 'DRAFT', primaryAttachmentId: 'att-1',
        branchId: 'br-1', createdByUserId: 'user-1', captureSource: 'WEB_UPLOAD',
        captureGroupId: null, expenseDate: new Date('2026-09-10T00:00:00.000Z'),
        updatedAt: new Date('2026-09-15T00:00:00.000Z'),
      }
      : options.expense,
    createExpense: async (input: any, withinTx?: (tx: unknown, expense: any) => Promise<void>) => {
      createdExpenses.push(input);
      const expense = { id: `split-${createdExpenses.length}`, ...input };
      await withinTx?.(siblingTx, expense);
      return expense;
    },
    linkAttachmentToTarget: async (...args: any[]) => { evidenceLinks.push(args); },
    // The starter template's shape: `accountHintKey` is what keeps the catch-all out of AI choice.
    listCategories: async () => [
      { id: 'cat-freight', companyId: 'co-1', name: 'ค่าขนส่ง', accountHintKey: 'expense.freight' },
      { id: 'cat-misc', companyId: 'co-1', name: 'ค่าใช้จ่ายเบ็ดเตล็ด', accountHintKey: 'expense.miscellaneous' },
      { id: 'cat-meals', companyId: 'co-1', name: 'ค่าอาหารและเครื่องดื่ม', accountHintKey: 'expense.meals' },
    ],
  };
  const storage = { getObject: async () => ({ bytes, mimeType: 'application/pdf' }) };

  let readIndex = 0;
  let extractIndex = 0;
  const readCalls: any[] = [];
  const extractCalls: any[] = [];
  const client = {
    readChunk: async (input: any) => {
      readCalls.push(input);
      const answer = options.readResults?.[readIndex] ?? { status: 'ok' as const };
      readIndex += 1;
      if (answer.status !== 'ok') return { status: 'failed', errorCode: answer.errorCode ?? 'PROVIDER_ERROR' };
      return {
        status: 'ok',
        pages: input.chunk.pageIndexes.map((pageIndex: number, position: number) => ({
          pageIndex,
          text: answer.text ?? `PAGE ${pageIndex + 1} TOTAL 100.00`,
          truncated: answer.truncated === true && position === input.chunk.pageIndexes.length - 1,
          blank: false,
        })),
      };
    },
    extractWindow: async (input: any) => {
      extractCalls.push(input);
      const answer = options.extractResults?.[extractIndex] ?? { status: 'ok' as const };
      extractIndex += 1;
      if (answer.status !== 'ok') return { status: 'failed', errorCode: answer.errorCode ?? 'PROVIDER_ERROR' };
      return { status: 'ok', observations: answer.observations ?? observations() };
    },
  };
  const applyCalls: any[] = [];
  const applyService = {
    apply: async (...args: any[]) => {
      applyCalls.push(args);
      if (options.applyService) return options.applyService.apply(args[0], args[1], args[2], args[3]);
      return { candidatesCreated: 0, committedUpdatedAt: new Date(), ...options.applyResult };
    },
  };
  const outboxService = { append: async (...args: any[]) => { outbox.push(args); } };
  const audit = { log: async () => undefined };
  // The REAL `admitCompanyOcr` / `releaseCompanyOcrAdmission` run against this fake client, exactly
  // as `expense-extraction.use-case.spec.ts` does — a fake of the governance itself would prove
  // nothing about the fence that stops a retry counting a second read.
  let usedCount = 0;
  const tx = {
    $executeRaw: async () => undefined,
    $queryRaw: async () => [],
    company: { findUnique: async () => options.free ? { status: 'ACTIVE', archivedAt: null, planTerm: { tierKey: 'FREE_TRIAL_15', termEndsAt: new Date(0), billingReceiptAccountId: null, capacityOverride: null } } : null },
    billingAccount: { findMany: async () => [] },
    companyMembership: { findFirst: async () => ({ branchScopeMode: 'ALL_BRANCHES', branchScopes: [], roles: [{ role: { permissions: [{ permission: { key: 'expense.receipt.upload' } }] } }] }) },
    branch: { findFirst: async () => ({ id: 'br-1' }) },
    companyFeatureEntitlement: { findMany: async () => [] },
    expenseCaptureObservation: capture.client.expenseCaptureObservation,
    billingInvoice: { findFirst: async () => null },
    billingReceiptGrant: { findFirst: async () => null },
    packageChangeRequest: { findFirst: async () => null },
    salesAttribution: { findUnique: async () => null },
    companyAiConfiguration: { findUnique: async () => ({ ocrEnabled: options.ocrAdmission?.allowed !== false, ocrMonthlyLimit: 10 }) },
    companyOcrUsageEvent: {
      findUnique: async ({ where }: any) => {
        const key = where.companyId_sourceRoute_requestId;
        return admissions.find((event) => event.companyId === key.companyId
          && event.sourceRoute === key.sourceRoute && event.requestId === key.requestId) ?? null;
      },
      findMany: async ({ where }: any) => admissions.filter((event) => event.quotaSource === where.quotaSource).map((event) => ({ succeededAt: event.succeededAt ?? null })),
      updateMany: async ({ where, data }: any) => {
        const event = admissions.find((row) => row.id === where.id && !row.succeededAt);
        if (event) Object.assign(event, data);
        return { count: event ? 1 : 0 };
      },
      create: async ({ data }: any) => {
        const event = { id: `ocr-event-${admissions.length + 1}`, ...data };
        admissions.push(event);
        return event;
      },
      delete: async ({ where }: any) => {
        released.push({ eventId: where.id, reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT' });
        return admissions.splice(admissions.findIndex((event) => event.id === where.id), 1)[0];
      },
    },
    companyOcrMonthlyUsage: {
      findUnique: async () => usedCount ? { usedCount } : null,
      upsert: async () => ({ usedCount: ++usedCount }),
      updateMany: async () => { usedCount -= 1; return { count: 1 }; },
    },
    companyPlanTerm: { findUnique: async () => null },
    auditLog: { findFirst: async () => null, create: async () => ({}) },
  };
  const prisma = { client: { ...tx, $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) } } as any;
  const config = {
    expenseCaptureReadConcurrency: 2,
    expenseCapturePdfMaxPages: options.maxPages ?? 60,
    expenseCaptureDerivativeMaxBytes: options.derivativeMaxBytes ?? 67_108_864,
    receiptQuotaEnforced: false,
  } as any;

  // The REAL auto-split service over the same fakes: a fake of it would prove nothing about the
  // idempotency record or the sibling links, which are the whole point of appendix §25.
  const autoSplit = new ExpenseCaptureAutoSplitService(
    capture as any, expenses as any, applyService as any, audit as any,
  );
  const runner = new ExpenseCaptureReadRunnerService(
    capture as any, attachments as any, expenses as any, storage as any, client as any,
    applyService as any, outboxService as any, audit as any, prisma, config, autoSplit, undefined,
    { resolveAccess: async () => ({ companyId: 'co-1', permissions: options.workerAccess?.permissions ?? ['expense.ocr.request'], scopes: options.workerAccess?.scopes ?? {} }) } as any,
  );

  return {
    runner, job, writes, outbox, released, admissions, observationsStored, fileWrites,
    readCalls, extractCalls, applyCalls, createdExpenses, evidenceLinks, siblingWrites,
    groupsCreated, groupWrites, groupMemberships,
    loseLease: () => { leaseOwner = 'someone-else'; },
    restore: () => undefined,
  };
}

const terminal = (harness: Harness) => harness.writes.filter((write) => write.accepted && 'status' in write.data).at(-1)?.data as any;

for (const counts of [[33, 7], [33, 37, 0]]) {
  it(`D2: applies all ${counts.reduce((sum, count) => sum + count, 0)} rows after assembling the provisional first window and headerless continuation`, async () => {
    const rowCount = counts.reduce((sum, count) => sum + count, 0);
    const grand = (rowCount * 107).toFixed(2), vat = (rowCount * 7).toFixed(2);
    const windows = counts.map((count, page) => observations({
      documents: [{ ref: `d${page + 1}`, pageIndexes: [page], kind: page ? 'SUPPLIER_INVOICE_OR_BILL' : 'TAX_INVOICE', family: 'EXPENSE_EVIDENCE',
        issuer: page ? {} : { name: 'First printed issuer' }, ...(page ? { continuationOfRef: 'd1' } : { documentNumber: 'INV-1' }),
        classification: { ...classification, documentKind: page ? 'SUPPLIER_INVOICE_OR_BILL' : 'TAX_INVOICE', transactionState: 'DUE',
          amountSignals: [], settlementSignals: [], requiresClarification: page === 0, missingRequiredSignals: page === 0 ? ['HUMAN_REVIEW_REQUIRED'] : [] } }],
      items: Array.from({ length: count }, (_, row) => ({ id: `${page}:${row}`, documentRef: `d${page + 1}`, description: `item ${page}:${row}`,
        quantity: '1', unitPrice: '100.00', amount: '100.00', event: 'sale', evidenceSpan: 'item 100.00' })),
      components: page === counts.length - 1 ? [{ id: 'vat', documentRef: `d${page + 1}`, label: 'VAT', role: 'tax_additional', scope: 'document', appliedStatus: 'applied', amount: vat, evidenceSpan: `VAT ${vat}` }] : [],
      totals: page === counts.length - 1 ? [{ documentRef: `d${page + 1}`, kind: 'document_total', amount: grand, evidenceSpan: `TOTAL ${grand}` },
        { documentRef: `d${page + 1}`, kind: 'tax', amount: vat, evidenceSpan: `VAT ${vat}` }] : [],
      completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [page], notes: [] },
    }));
    const h = await build({ pages: counts.length, extractResults: windows.map(observations => ({ status: 'ok', observations })) });
    try {
      await h.runner.runClaimed(h.job);
      assert.equal(terminal(h).status, 'DONE');
      assert.equal(h.outbox[0]![3].applied, true);
      assert.equal(h.applyCalls.length, 1);
      const fields = h.applyCalls[0]![2];
      assert.equal(fields.lines.length, rowCount);
      assert.equal(fields.grandTotalAmount, grand); assert.equal(fields.vatAmount, vat);
      assert.equal(fields.vendorName, 'First printed issuer');
      assert.equal(h.applyCalls[0]![3].sourceDocumentType, 'TAX_INVOICE');
      assert.equal(h.applyCalls[0]![3].sourceAttachmentId, 'att-1');
      assert.equal(h.applyCalls[0]![3].expectedUpdatedAt.toISOString(), h.job.expectedSourceUpdatedAt.toISOString());
      assert.equal(h.createdExpenses.length, 0, 'a continuation never becomes a split draft');
      assert.equal(windows[0]!.documents[0]!.classification.requiresClarification, true, 'raw checkpoint is not mutated');
    } finally { h.restore(); }
  });
}

describe('capture read runner — the happy path', () => {
  let harness: Harness;
  beforeEach(() => { harness?.restore(); });

  it('reads, extracts, stores one observation and applies it to the expense', async () => {
    harness = await build({ pages: 2 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'DONE');
      assert.equal(harness.readCalls.length, 2, 'one page per call');
      assert.equal(harness.extractCalls.length, 2);
      assert.equal(harness.observationsStored.length, 1);
      assert.equal(harness.observationsStored[0]!.source, 'AI');
      assert.equal(harness.applyCalls.length, 1, 'one document, one issuer: the draft is filled');
      assert.equal(harness.applyCalls[0]![3].expectedUpdatedAt.toISOString(), '2026-09-15T00:00:00.000Z',
        'the apply is fenced on the version read before the job started');
      assert.equal(harness.outbox.length, 1);
      assert.equal(harness.outbox[0]![0], 'expense.capture_read.finished');
      assert.equal(harness.outbox[0]![3].status, 'DONE');
      assert.equal(harness.outbox[0]![3].applied, true);
      // The LINE push reads the §18.4 sentence and the confirmed amount off the event itself.
      assert.equal(harness.outbox[0]![3].classification.documentKind, 'RECEIPT');
      assert.equal(harness.outbox[0]![3].documentTotal, '100.00');
    } finally { harness.restore(); }
  });

  it('counts the customer OCR read exactly once for a file of many chunks', async () => {
    harness = await build({ pages: 7 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.readCalls.length, 7, 'seven pages, seven chunks');
      assert.equal(harness.admissions.length, 1, 'one file is one read, whatever it costs us');
      assert.equal(harness.admissions[0]!.sourceRoute, 'receipt-capture-web');
      assert.equal(harness.admissions[0]!.requestId, 'ocr-1', 'the job owns the fence, so a retry cannot re-count');
      assert.equal(harness.released.length, 0);
    } finally { harness.restore(); }
  });

  it('writes the manifest before the first provider call', async () => {
    harness = await build({ pages: 4 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const first = harness.writes[0]!.data as any;
      assert.ok(first.manifestJson, 'the first durable write is the manifest');
      assert.equal(first.manifestJson.pageCount, 4);
      assert.equal(first.manifestJson.pages.length, 4);
      assert.ok(first.manifestJson.pages.every((page: any) => page.state === 'pending'));
      assert.equal(first.manifestJson.chunks.length, 4);
    } finally { harness.restore(); }
  });
});

describe('capture read runner — fences and resume', () => {
  let harness: Harness;

  it('does not reuse an old truncated window checkpoint under the new complete page plan', async () => {
    harness = await build({ jobOver: { checkpointJson: { version: 1, chunks: { c1: 'done' },
      pages: { '0': { text: 'row 1.00\n'.repeat(1700) } }, windows: { w1: observations() } } } });
    await harness.runner.runClaimed(harness.job);
    assert.equal(terminal(harness).lastErrorCode, 'CAPTURE_WINDOW_EVIDENCE_VERSION_CHANGED');
    assert.equal(harness.extractCalls.length, 0); assert.equal(harness.applyCalls.length, 0);
  });

  it('writes nothing after its lease was reclaimed', async () => {
    harness = await build({ pages: 2 });
    try {
      harness.loseLease();
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.writes.every((write) => !write.accepted), true, 'every write was refused by the fence');
      assert.equal(harness.readCalls.length, 0, 'a runner that lost the job does not spend money on it');
      assert.equal(harness.outbox.length, 0, 'and never announces a result nobody stored');
    } finally { harness.restore(); }
  });

  it('resumes from the checkpoint and re-reads only what it has no answer for', async () => {
    harness = await build({
      pages: 7,
      jobOver: {
        checkpointJson: {
          version: 1,
          pages: { '0': { text: 'PAGE 1 TOTAL 100.00' }, '1': { text: 'PAGE 2' }, '2': { text: 'PAGE 3' } },
          chunks: { c1: 'done' },
          windows: {},
          ocrEventId: 'ocr-event-1',
        },
      },
    });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.readCalls.length, 4, 'the first three pages were already paid for');
      assert.deepEqual(harness.readCalls.map((call) => call.chunk.id), ['c4', 'c5', 'c6', 'c7']);
      const manifest = (harness.writes[0]!.data as any).manifestJson;
      assert.ok(manifest.pages.slice(0, 3).every((page: any) => page.state === 'read'), 'restored page coverage survives the new manifest');
    } finally { harness.restore(); }
  });

  it('keeps a truncated page partial and continues with the remaining single pages', async () => {
    harness = await build({ pages: 3, readResults: [{ status: 'ok', truncated: true }, { status: 'ok' }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.readCalls.length, 3, 'each page is already isolated');
      assert.deepEqual(harness.readCalls[1]!.chunk.pageIndexes, [1]);
      assert.equal(harness.readCalls[1]!.chunk.id, 'c2');
    } finally { harness.restore(); }
  });

  /**
   * W10 D3. The 896-px Leceipt screenshot came back with its item row and no totals block, and the
   * job ended DONE on a draft with a line and no total. A page the reader could not finish — the
   * model hit `max_tokens`, or it declared the printing too small to transcribe — is a PARTIAL read,
   * which is the state §17.6 already has copy for. Nothing is re-read: a one-page chunk cannot be
   * split any further, and asking the provider for the same pixels again is spending twice for the
   * same answer.
   */
  it('ends PARTIAL when the only page was read partially, and never re-reads it', async () => {
    harness = await build({ pages: 1, readResults: [{ status: 'ok', truncated: true }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.readCalls.length, 1, 'no second read of the same page');
      const state = terminal(harness);
      assert.equal(state.status, 'PARTIAL', 'was DONE: an item with no total looked like a finished read');
      const manifest = harness.writes.filter((write) => write.accepted && 'manifestJson' in write.data).at(-1)!.data as any;
      assert.equal(manifest.manifestJson.pages[0]!.state, 'partial', 'the reviewer sees WHICH page fell short');
      assert.equal(harness.outbox[0]![3].status, 'PARTIAL', 'and both lanes are told the same');
    } finally { harness.restore(); }
  });

  it('controller review: a one-page transcription that stops at the item table ends PARTIAL, whatever the model declared', async () => {
    // The 896-px Lazada screenshot: seller, buyer, number, date, the item row — and nothing after it.
    const cutShort = ['[SELLER]\nบริษัท ผู้ขายทดสอบ จำกัด\n[/SELLER]', 'เลขที่ TIV20210500001', '| ลำดับ | รายการ | จำนวนเงิน |', '|---|---|---|', '| 1 | Test batch | 7,000.00 บาท |'].join('\n');
    harness = await build({ pages: 1, readResults: [{ status: 'ok', text: cutShort }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'PARTIAL', 'an item with no total block is not a finished read');
      const manifest = harness.writes.filter((write) => write.accepted && 'manifestJson' in write.data).at(-1)!.data as any;
      assert.equal(manifest.manifestJson.pages[0]!.state, 'partial');
      assert.equal(harness.readCalls.length, 1, 'no re-read: the page was read, its small print was not');
    } finally { harness.restore(); }
  });

  it('controller review: a summary printed as the last table row (the Lotus\'s e-Tax shape) stays DONE', async () => {
    const tableTotal = ['| 1 | น้ำจิ้มสุกี้ | 109.00 V |', '| Total: | 0.00 | 178.00 | 9.87 | 168.13 |'].join('\n');
    harness = await build({ pages: 1, readResults: [{ status: 'ok', text: tableTotal }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'DONE');
    } finally { harness.restore(); }
  });

  it('controller review: the same table followed by a total line stays DONE', async () => {
    const whole = ['| 1 | Test batch | 7,000.00 บาท |', 'จำนวนเงินทั้งสิ้น 7,000.00 บาท'].join('\n');
    harness = await build({ pages: 1, readResults: [{ status: 'ok', text: whole }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'DONE');
    } finally { harness.restore(); }
  });

  it('retries a timed-out page once with a distinct request, then keeps going', async () => {
    harness = await build({
      pages: 2,
      readResults: [{ status: 'failed', errorCode: 'PROVIDER_TIMEOUT' }, { status: 'failed', errorCode: 'PROVIDER_TIMEOUT' }, { status: 'ok' }],
    });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.readCalls.length, 3, 'two attempts on chunk 1, then chunk 2');
      assert.notEqual(harness.readCalls[0]!.requestId, harness.readCalls[1]!.requestId);
      assert.equal(harness.admissions.length, 1, 'the timeout retry is not another customer read');
      const state = terminal(harness);
      assert.equal(state.status, 'PARTIAL', 'a file with a failed chunk is partial, never done');
      assert.equal(harness.extractCalls.length, 1, 'the pages that WERE read are still extracted');
    } finally { harness.restore(); }
  });

  it('stops immediately when the job has already been attempted too often', async () => {
    harness = await build({ jobOver: { attempts: 6 } });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'FAILED');
      assert.equal(terminal(harness).lastErrorCode, 'attempts_exhausted');
      assert.equal(harness.readCalls.length, 0);
    } finally { harness.restore(); }
  });
});

describe('capture read runner — boundaries', () => {
  let harness: Harness;

  it('OCR-C reads a LINE PDF one page at a time, applies through the photo seam and emits its result notification', async () => {
    harness = await build({ pages: 2, expense: { id: 'exp-1', companyId: 'co-1', status: 'DRAFT', primaryAttachmentId: 'att-1',
      branchId: 'br-1', createdByUserId: 'user-1', captureSource: 'LINE_UPLOAD', updatedAt: new Date('2026-09-15') } });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.readCalls.length, 2);
      for (const call of harness.readCalls) {
        assert.equal(call.chunk.pageIndexes.length, 1);
        assert.equal((await PDFDocument.load(Buffer.from(call.chunk.contentBase64, 'base64'))).getPageCount(), 1);
      }
      assert.equal(harness.extractCalls.length, 2); assert.equal(harness.applyCalls.length, 1);
      assert.equal(harness.applyCalls[0]![1], 'exp-1');
      assert.equal(harness.outbox[0]![0], 'expense.capture_read.finished');
      assert.equal(harness.outbox[0]![3].ownerType, 'EXPENSE');
      assert.equal(harness.outbox[0]![3].applied, true);
    } finally { harness.restore(); }
  });

  it('OCR-C retries a timed-out extraction once with a distinct attempt and one document admission', async () => {
    for (const second of ['ok', 'failed'] as const) {
      harness = await build({ extractResults: [{ status: 'failed', errorCode: 'PROVIDER_TIMEOUT' },
        { status: second, errorCode: 'PROVIDER_TIMEOUT' }] });
      try {
        await harness.runner.runClaimed(harness.job as any);
        assert.equal(harness.extractCalls.length, 2);
        assert.notEqual(harness.extractCalls[0]!.requestId, harness.extractCalls[1]!.requestId);
        assert.equal(harness.admissions.length + harness.released.length, 1);
        assert.equal(harness.job.providerCallCount, 3, 'one page read and two extraction attempts');
        assert.equal(terminal(harness).status, second === 'ok' ? 'DONE' : 'PARTIAL');
      } finally { harness.restore(); }
    }
  });

  it('OCR-C never retries a non-timeout extract failure or exceeds the file call ceiling', async () => {
    harness = await build({ extractResults: [{ status: 'failed', errorCode: 'PROVIDER_ERROR' }] });
    try { await harness.runner.runClaimed(harness.job as any); assert.equal(harness.extractCalls.length, 1); }
    finally { harness.restore(); }
    harness = await build({ jobOver: { providerCallCount: EXPENSE_CAPTURE_MAX_PROVIDER_CALLS - 2 },
      extractResults: [{ status: 'failed', errorCode: 'PROVIDER_TIMEOUT' }] });
    try { await harness.runner.runClaimed(harness.job as any); assert.equal(harness.extractCalls.length, 1);
      assert.equal(harness.job.providerCallCount, EXPENSE_CAPTURE_MAX_PROVIDER_CALLS); }
    finally { harness.restore(); }
  });

  it('pauses with page_limit after reading the pages inside the declared scope', async () => {
    harness = await build({ pages: 5, maxPages: 3 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const state = terminal(harness);
      assert.equal(state.status, 'PAUSED');
      assert.equal(state.pausedReason, 'page_limit');
      assert.equal(harness.readCalls.length, 3, 'three pages were read, the other two were not cut silently');
      assert.equal(harness.observationsStored.length, 1, 'what was read is still stored');
      assert.equal(harness.outbox[0]![3].pausedReason, 'page_limit');
    } finally { harness.restore(); }
  });

  it('pauses with ai_credit on a money refusal and keeps the checkpoint', async () => {
    harness = await build({ pages: 6, readResults: [{ status: 'ok' }, { status: 'failed', errorCode: 'AI_BUDGET_INSUFFICIENT' }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const state = terminal(harness);
      assert.equal(state.status, 'PAUSED');
      assert.equal(state.pausedReason, 'ai_credit');
      assert.equal(harness.readCalls.length, 2, 'a refusal is never retried — it would refuse again');
      const checkpointed = harness.writes.filter((write) => write.accepted && (write.data as any).checkpointJson).at(-1)!.data as any;
      assert.equal(Object.keys(checkpointed.checkpointJson.pages).length, 1, 'the first chunk survives the pause');
    } finally { harness.restore(); }
  });

  it('pauses with call_budget rather than reading a file without end', async () => {
    harness = await build({ pages: 60, jobOver: { providerCallCount: EXPENSE_CAPTURE_MAX_PROVIDER_CALLS } });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const state = terminal(harness);
      assert.equal(state.status, 'PAUSED');
      assert.equal(state.pausedReason, 'call_budget');
      assert.equal(harness.readCalls.length, 0);
    } finally { harness.restore(); }
  });

  it('pauses with memory_budget instead of building derivatives without a ceiling', async () => {
    harness = await build({ pages: 6, derivativeMaxBytes: 1 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const state = terminal(harness);
      assert.equal(state.status, 'PAUSED');
      assert.equal(state.pausedReason, 'memory_budget');
      assert.equal(harness.readCalls.length, 0, 'the chunk that would pass the ceiling is never sent');
      assert.equal(harness.outbox[0]![3].pausedReason, 'memory_budget');
    } finally { harness.restore(); }
  });

  it('spends the JOB\'s time budget, not a fresh one per resume', async () => {
    harness = await build({
      pages: 6,
      jobOver: { checkpointJson: { version: 1, pages: {}, chunks: {}, windows: {}, runMillis: EXPENSE_CAPTURE_MAX_RUN_MS + 1 } },
    });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const state = terminal(harness);
      assert.equal(state.status, 'PAUSED');
      assert.equal(state.pausedReason, 'time_budget');
      assert.equal(harness.readCalls.length, 0, 'a job that already spent 15 minutes gets no more');
    } finally { harness.restore(); }
  });

  it('banks the time this run spent, so the next claim starts from it', async () => {
    harness = await build({ pages: 1 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      const state = terminal(harness);
      assert.equal(state.status, 'DONE');
      assert.equal(typeof state.checkpointJson.runMillis, 'number');
      assert.ok(state.checkpointJson.runMillis >= 0);
      assert.ok(state.checkpointJson.derivativeBytes > 0, 'and what it already built');
    } finally { harness.restore(); }
  });

  it('releases the customer read when the job ends with nothing usable', async () => {
    harness = await build({ pages: 2, readResults: [{ status: 'failed' }, { status: 'failed' }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'PARTIAL');
      assert.equal(harness.released.length, 1);
      assert.equal(harness.released[0]!.reason, 'SYSTEM_FAILURE_NO_USABLE_RESULT');
      assert.equal(harness.released[0]!.eventId, 'ocr-event-1');
    } finally { harness.restore(); }
  });

  it('fails without reading anything when the stored bytes are not the ones the job fenced on', async () => {
    harness = await build({ jobOver: { attachmentChecksum: 'a-different-file' } });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'FAILED');
      assert.equal(terminal(harness).lastErrorCode, 'source_changed');
      assert.equal(harness.readCalls.length, 0);
    } finally { harness.restore(); }
  });

  it('reports an unreadable file as electronically UNCHECKABLE, not merely unchecked', async () => {
    // D09 baseline has two states, and a file nobody can open is the second one: the UI must never
    // show "ยังไม่ได้ตรวจสอบ" for bytes that cannot be opened at all (appendix §2.2).
    harness = await build({ ownerType: 'CAPTURE_GROUP', corruptBytes: true });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).lastErrorCode, 'corrupt_pdf');
      const manifest = harness.writes.find((write) => (write.data as any).manifestJson)!.data as any;
      assert.equal(manifest.manifestJson.electronicVerification.status, 'UNAVAILABLE');
      assert.equal(harness.fileWrites[0]!.electronicVerificationJson.status, 'UNAVAILABLE');
    } finally { harness.restore(); }
  });

  it('cancels when the expense no longer points at this attachment', async () => {
    harness = await build({ expense: { id: 'exp-1', status: 'DRAFT', primaryAttachmentId: 'att-9' } });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(terminal(harness).status, 'CANCELLED');
      assert.equal(harness.readCalls.length, 0);
      assert.equal(harness.outbox.length, 1, 'a cancellation is still a terminal transition');
    } finally { harness.restore(); }
  });
});

describe('capture read runner — what it refuses to apply', () => {
  let harness: Harness;

  /**
   * Appendix §25 (owner decision 2026-09-19): a file holding two shops used to stop at "stored and
   * shown" and offer a group screen. There is no screen any more, so the ENGINE splits it: the
   * first document onto the draft the file was uploaded to, the second onto its own ordinary draft,
   * both in one sibling group so the duplicate rules do not flag them against each other.
   */
  it('splits a file holding two shops into one ordinary draft each', async () => {
    harness = await build({ extractResults: [{ status: 'ok', observations: twoShops() }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.applyCalls.length, 2, 'both documents go through the ordinary apply path');
      assert.deepEqual(harness.applyCalls.map((call) => call[1]), ['exp-1', 'split-1']);
      // The first document applies under the job's fence; a brand-new draft has nothing to fence on.
      assert.equal(harness.applyCalls[0]![3].expectedUpdatedAt?.toISOString(), '2026-09-15T00:00:00.000Z');
      assert.equal(harness.applyCalls[1]![3].expectedUpdatedAt, undefined);
      assert.equal(harness.applyCalls[0]![2].vendorName, 'ร้าน ก');
      assert.equal(harness.applyCalls[1]![2].vendorName, 'ร้าน ข');

      // One sibling group, HANDED_OFF from the start, keyed on the job so a re-claim cannot open a
      // second batch; the owning expense joins it and the new draft is created into it.
      assert.equal(harness.groupsCreated.length, 1);
      assert.equal(harness.groupWrites[0]!.status, 'HANDED_OFF');
      assert.equal(harness.groupWrites[0]!.handoffBatchKey, 'auto-split:job-1');
      assert.equal(harness.groupMemberships[0]!.data.captureGroupId, 'group-auto-1');
      assert.equal(harness.createdExpenses[0]!.captureGroupId, 'group-auto-1');
      assert.equal(harness.createdExpenses[0]!.captureScopeKey, 'doc-2');
      assert.equal(harness.createdExpenses[0]!.createdByUserId, 'user-1', 'the original creator owns it');
      assert.equal(harness.createdExpenses[0]!.status, 'NEEDS_REVIEW');
      assert.equal(harness.createdExpenses[0]!.captureAllocationId, undefined, 'no allocation');
      // The same bytes are the sibling's PRIMARY receipt — link and `primaryAttachmentId`, inside its
      // own INSERT transaction — because `validateConfirm` refuses a draft with no primary receipt.
      assert.deepEqual(harness.evidenceLinks[0]!.slice(0, 4), ['att-1', 'expense.record', 'split-1', 'expense.receipt.primary']);
      assert.ok(harness.evidenceLinks[0]![6], 'the link is written inside the sibling INSERT transaction');
      assert.deepEqual(harness.siblingWrites, [{ where: { companyId: 'co-1', id: 'split-1' }, data: { primaryAttachmentId: 'att-1' } }]);

      assert.equal(harness.observationsStored.length, 1, 'the observation stays stored, unsplit');
      assert.equal(harness.outbox[0]![3].multiDocument, true);
      assert.equal(harness.outbox[0]![3].documentCount, 2);
      assert.equal(harness.outbox[0]![3].applied, true);
      assert.deepEqual(harness.outbox[0]![3].splitExpenseIds, ['split-1'], 'both lanes link to what was created');
    } finally { harness.restore(); }
  });

  /**
   * Owner 2026-09-29 ("หมวดหมู่ AI ควรจับได้เลย"): a PDF used to be read with NO catalogue, so its
   * draft never got the category a photo of the same receipt gets. Each window is now offered the
   * photo reader's catalogue, and each document's pick reaches the ordinary apply, which decides.
   */
  it('offers every window the shop catalogue minus the catch-all, and hands each document its own category', async () => {
    const suggestion = (id: string, signal: string) => ({ expenseCategoryId: id, confidence: 0.93, evidenceSignals: [signal] });
    const shops = twoShops();
    shops.documents[0]!.categorySuggestion = suggestion('cat-freight', 'ร้าน ก');
    shops.documents[1]!.categorySuggestion = suggestion('cat-meals', 'ขนม 40.00');
    harness = await build({ pages: 2, extractResults: [{ status: 'ok', observations: shops }, { status: 'ok', observations: { ...shops, documents: [], items: [], components: [], totals: [], payments: [], refunds: [] } }] });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.deepEqual(harness.extractCalls[0]!.activeCategories, [
        { id: 'cat-freight', name: 'ค่าขนส่ง' },
        { id: 'cat-meals', name: 'ค่าอาหารและเครื่องดื่ม' },
      ], 'ids and names only, never the catch-all');
      assert.deepEqual(harness.applyCalls.map((call) => [call[1], call[2].categorySuggestion]), [
        ['exp-1', suggestion('cat-freight', 'ร้าน ก')],
        ['split-1', suggestion('cat-meals', 'ขนม 40.00')],
      ], 'the draft the file was uploaded to, and the split draft, each get their own document\'s pick');
    } finally { harness.restore(); }
  });

  it('leaves the category to the reviewer when the read named none', async () => {
    harness = await build();
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.applyCalls.length, 1);
      assert.equal(harness.applyCalls[0]![2].categorySuggestion, undefined);
    } finally { harness.restore(); }
  });

  it('is idempotent: a re-claimed job never creates a second draft for the same document', async () => {
    harness = await build({
      extractResults: [{ status: 'ok', observations: twoShops() }],
      // What an earlier run of this job already recorded (appendix §25 idempotency record).
      jobOver: { checkpointJson: { version: 1, pages: {}, chunks: {}, windows: {}, splitExpenseIds: { d2: 'split-earlier' } } },
    });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.createdExpenses.length, 0, 'the document already produced an expense');
      assert.deepEqual(harness.applyCalls.map((call) => call[1]), ['exp-1'], 'only the owner is written again');
      assert.deepEqual(harness.outbox[0]![3].splitExpenseIds, ['split-earlier']);
      const terminalWrite = harness.writes.filter((write) => write.accepted && 'status' in write.data).at(-1)!;
      assert.deepEqual((terminalWrite.data.checkpointJson as any).splitExpenseIds, { d2: 'split-earlier' });
    } finally { harness.restore(); }
  });

  it('never invents a draft for a non-expense document riding in the same file', async () => {
    const label: BusinessDocumentClassification = {
      ...classification, documentKind: 'DELIVERY_NOTE', evidenceRoles: [], transactionState: 'DUE',
      amountSignals: [], settlementSignals: [],
    };
    harness = await build({
      extractResults: [{ status: 'ok', observations: observations({
        documents: [
          { ref: 'd1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE', issuer: { name: 'ร้าน ก' }, documentNumber: 'A-1', classification },
          { ref: 'd2', pageIndexes: [0], kind: 'DELIVERY_NOTE', family: 'COMMERCIAL_DOCUMENT', issuer: { name: 'ขนส่ง' }, documentNumber: 'AWB-1', classification: label },
        ],
        items: [{ id: '0:1', documentRef: 'd1', description: 'น้ำดื่ม', quantity: '1', amount: '100.00', event: 'sale', evidenceSpan: 'น้ำดื่ม 100.00' }],
        totals: [{ documentRef: 'd1', kind: 'document_total', amount: '100.00', evidenceSpan: 'รวม 100.00' }],
      }) }],
    });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.deepEqual(harness.applyCalls.map((call) => call[1]), ['exp-1']);
      assert.equal(harness.createdExpenses.length, 0, 'a shipping label is not an expense (§18.4)');
      assert.deepEqual(harness.outbox[0]![3].splitExpenseIds, []);
    } finally { harness.restore(); }
  });

  it('reports applied: false when the draft moved while the job was reading', async () => {
    harness = await build({ applyResult: { staleSkipped: true, committedUpdatedAt: undefined } });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.applyCalls.length, 1);
      assert.equal(harness.outbox[0]![3].applied, false, 'a stale fence never claims the draft was filled');
      assert.equal(terminal(harness).status, 'DONE');
    } finally { harness.restore(); }
  });

  it('never applies anything for a capture group — W04 consumes the observation', async () => {
    harness = await build({ ownerType: 'CAPTURE_GROUP' });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.applyCalls.length, 0);
      assert.equal(harness.observationsStored[0]!.groupId, 'group-1');
      assert.equal(harness.admissions[0]!.sourceRoute, 'receipt-capture-line');
      assert.equal(harness.outbox[0]![3].ownerType, 'CAPTURE_GROUP');
    } finally { harness.restore(); }
  });

  it('appends exactly one terminal event per run', async () => {
    harness = await build({ pages: 2 });
    try {
      await harness.runner.runClaimed(harness.job as any);
      assert.equal(harness.outbox.length, 1);
      assert.equal(harness.outbox[0]![1], 'expense_capture_read_job');
      assert.equal(harness.outbox[0]![2], 'job-1');
      assert.equal(harness.outbox[0]![4], 'HIGH');
    } finally { harness.restore(); }
  });
});

describe('capture read windows', () => {
  it('groups consecutive pages inside the declared window ceiling', () => {
    const windows = planWindows({
      '0': { text: 'a'.repeat(7_000) },
      '1': { text: 'b'.repeat(6_000) },
      '2': { text: 'c'.repeat(100) },
    });
    assert.equal(windows.length, 3);
    assert.deepEqual(windows.map(window => window.pageIndexes), [[0], [1], [2]]);
    assert.deepEqual(windows.map(window => window.id), ['w1', 'w2', 'w3']);
  });

  it('skips blank pages and orders by page index, never by insertion', () => {
    const windows = planWindows({ '5': { text: 'later' }, '1': { text: '' }, '0': { text: 'first' } });
    assert.equal(windows.length, 2);
    assert.deepEqual(windows.map(window => window.pageIndexes), [[0], [5]]);
  });

  it('tells a later window which documents are still open', () => {
    const prior = priorDocuments({ w1: observations() });
    assert.equal(prior.length, 1);
    assert.equal(prior[0]!.issuerName, 'ร้านตัวอย่าง');
    assert.equal(prior[0]!.openTotals, false, 'this one printed its total');
    const open = priorDocuments({ w1: observations({ totals: [] }) });
    assert.equal(open[0]!.openTotals, true);
  });
});

it('Y3: PARTIAL → retry → DONE preserves window plan 3, re-reads only the incomplete page and replaces its observations', async () => {
  const h = await build({ pages: 2, readResults: [
    { status: 'ok', truncated: true, text: 'PARTIAL first page 60.00' },
    { status: 'ok', text: 'PAGE 2 TOTAL 100.00' },
    { status: 'ok', text: 'COMPLETE first page 60.00 40.00' },
  ] });
  try {
    await h.runner.runClaimed(h.job);
    assert.equal(terminal(h).status, 'PARTIAL');
    assert.equal(h.job.checkpointJson.windowPlanVersion, 3);
    assert.equal(h.readCalls.length, 2); assert.equal(h.extractCalls.length, 2);
    h.job.status = 'READING'; h.job.leaseOwner = 'owner-1'; h.job.attempts++;
    await h.runner.runClaimed(h.job);
    assert.equal(terminal(h).status, 'DONE', h.job.lastErrorCode);
    assert.equal(h.readCalls.length, 3); assert.deepEqual(h.readCalls[2].chunk.pageIndexes, [0]);
    assert.equal(h.extractCalls.length, 4, 'the changed page and its dependent prior-document context are re-extracted');
    assert.equal(h.extractCalls[2].window.pages[0].text, 'COMPLETE first page 60.00 40.00');
    assert.deepEqual(h.extractCalls[3].window.pageIndexes, [1]);
    assert.equal(h.job.checkpointJson.windowPlanVersion, 3);
    assert.equal(h.admissions.length, 1, 'the retry retains one document admission');
    assert.deepEqual(h.outbox.map(row => row[3].status), ['PARTIAL', 'DONE']);
  } finally { h.restore(); }
});

it('Y3: a resumed complete version-3 window is reused; a version-2 window still fails closed', async () => {
  for (const version of [3, 2]) {
    const h = await build({ jobOver: { checkpointJson: { version: 1, windowPlanVersion: version,
      pages: { '0': { text: 'PAGE 1 TOTAL 100.00' } }, chunks: { c1: 'done' }, windows: { w1: observations() } } } });
    try {
      await h.runner.runClaimed(h.job);
      assert.equal(h.readCalls.length, 0); assert.equal(h.extractCalls.length, 0);
      assert.equal(terminal(h).status, version === 3 ? 'DONE' : 'FAILED');
      assert.equal(h.applyCalls.length, version === 3 ? 1 : 0);
      if (version === 2) assert.equal(h.job.lastErrorCode, 'CAPTURE_WINDOW_EVIDENCE_VERSION_CHANGED');
    } finally { h.restore(); }
  }
});

for (const counts of [[33, 7], [33, 37, 0]]) {
  it(`Fix-up 10 P1: ${counts.reduce((sum, count) => sum + count, 0)} PDF rows apply after real delivery bookkeeping, refuse genuine edits, including checkpoint resume`, async () => {
    // g1's two/three-page regression: later model windows call their physical page "0".
    // The supplied g1 files retain final empty expenses, not raw checkpoint JSON; reconstruct the
    // reported checkpoint shape here rather than depending on uncommitted .live-r8 artifacts.
    const rows = counts.reduce((sum, count) => sum + count, 0), grand = (rows * 107).toFixed(2), vat = (rows * 7).toFixed(2);
    const windows = counts.map((count, page) => observations({
      documents: [{ ref: `d${page + 1}`, pageIndexes: [0], kind: page ? 'SUPPLIER_INVOICE_OR_BILL' : 'TAX_INVOICE', family: 'EXPENSE_EVIDENCE',
        issuer: page ? {} : { name: 'First printed issuer' }, ...(page ? { continuationOfRef: 'd1' } : { documentNumber: 'INV-1' }),
        classification: { ...classification, documentKind: page ? 'SUPPLIER_INVOICE_OR_BILL' : 'TAX_INVOICE', transactionState: 'DUE',
          amountSignals: [], settlementSignals: [], requiresClarification: page === 0, missingRequiredSignals: page === 0 ? ['HUMAN_REVIEW_REQUIRED'] : [] } }],
      items: Array.from({ length: count }, (_, row) => ({ id: `${page}:${row}`, documentRef: `d${page + 1}`, description: `item ${page}:${row}`,
        quantity: '1', unitPrice: '100.00', amount: '100.00', event: 'sale', evidenceSpan: 'item 100.00' })),
      components: page === counts.length - 1 ? [{ id: 'vat', documentRef: `d${page + 1}`, label: 'VAT', role: 'tax_additional', scope: 'document', appliedStatus: 'applied', amount: vat, evidenceSpan: `VAT ${vat}` }] : [],
      totals: page === counts.length - 1 ? [{ documentRef: `d${page + 1}`, kind: 'document_total', amount: grand, evidenceSpan: `TOTAL ${grand}` },
        { documentRef: `d${page + 1}`, kind: 'tax', amount: vat, evidenceSpan: `VAT ${vat}` }] : [],
      completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
    }));
    const original = JSON.stringify(windows);
    let checkpoint: any;
    for (const [resume, userEdit] of [[false, false], [true, false], [false, true], [true, true]]) {
      const record: any = { id: 'exp-1', companyId: 'co-1', status: 'DRAFT', captureSource: 'LINE_UPLOAD', primaryAttachmentId: 'att-1',
        updatedAt: new Date('2026-09-15T00:00:00.000Z'), expenseDate: new Date('2026-09-10'), vendorNameSnapshot: null,
        grandTotalAmount: '0', vatAmount: '0', netPayableAmount: '0', whtAmount: '0', discountAmount: '0', vatMode: 'NO_VAT', lines: [], attachments: [],
        sourceChannelMetadataJson: { chatKeyHash: 'chat' }, substituteReceiptEvidences: [] };
      const tx = { $executeRaw: async () => 0, companyVatRegistrationFact: { findMany: async () => [] }, expenseRecord: {
        findFirst: async () => record, findFirstOrThrow: async () => record,
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.companyId, 'co-1');
          if (where.updatedAt.getTime() !== record.updatedAt.getTime()) return { count: 0 };
          Object.assign(record, data); return { count: 1 };
        },
        update: async ({ where, data }: any) => { assert.equal(where.companyId, 'co-1'); assert.equal(where.updatedAt.getTime(), record.updatedAt.getTime()); Object.assign(record, data); },
      }, expenseCategory: { findFirst: async () => null }, expenseLine: {
        deleteMany: async () => { record.lines = []; }, create: async ({ data }: any) => { record.lines.push(data); },
      } };
      const repo = { findByIdWithRelations: async () => record, findNearDuplicates: async () => [],
        runDuplicateCheck: async (_input: any, detect: any, db: any) => { assert.equal(db, tx); await detect(db); return { openCandidates: 0, duplicateStatus: 'NO_MATCH' }; } };
      const applyService = new ReceiptOcrApplyService({ client: { $transaction: async (work: any) => work(tx) } } as any, repo as any);
      const h = await build({ pages: counts.length, applyService, extractResults: windows.map(observations => ({ status: 'ok', observations })),
        ...(resume ? { jobOver: { checkpointJson: checkpoint } } : {}) });
      try {
        const originalRevision = record.updatedAt.toISOString();
        const deliveries = new PrismaExpenseRepository({ client: { $transaction: async (work: any) => work(tx) } } as any);
        await deliveries.recordDeliveredLineReceiptContinuation({ companyId: 'co-1', expenseId: record.id, userId: 'user',
          chatKeyHash: 'chat', deliveredOutcomeId: 'outcome', scopes: {} });
        assert.equal(record.updatedAt.toISOString(), originalRevision, 'enqueue → delivered continuation preserves the queued content fence');
        if (userEdit) { record.updatedAt = new Date(record.updatedAt.getTime() + 1); record.vendorNameSnapshot = 'User correction'; }
        await h.runner.runClaimed(h.job);
        assert.equal(terminal(h).status, 'DONE'); assert.equal(h.outbox[0]![3].applied, !userEdit);
        if (userEdit) {
          assert.equal(record.lines.length, 0); assert.equal(record.vendorNameSnapshot, 'User correction');
          assert.equal(Number(record.grandTotalAmount), 0); continue;
        }
        assert.equal(record.lines.length, rows); assert.equal(Number(record.grandTotalAmount), Number(grand));
        assert.equal(record.vendorNameSnapshot, 'First printed issuer'); assert.equal(record.sourceDocumentType, 'TAX_INVOICE');
        const assembled = h.observationsStored[0].payloadJson;
        assert.deepEqual(assembled.completeness.pagesCovered, counts.map((_count, page) => page));
        assert.deepEqual(assembled.documents[0].pageIndexes, counts.map((_count, page) => page));
        assert.equal(assembled.documents[0].classification.requiresClarification, false);
        assert.ok(!assembled.documents[0].classification.missingRequiredSignals.includes('HUMAN_REVIEW_REQUIRED'));
        if (resume) { assert.equal(h.readCalls.length, 0); assert.equal(h.extractCalls.length, 0); }
        else checkpoint = structuredClone(h.job.checkpointJson);
        assert.equal(JSON.stringify(windows), original, 'provider checkpoints remain immutable');
      } finally { h.restore(); }
    }
  });
}

it('R10 Q3: a failed third extraction remains PARTIAL and resumes only its missing window', async () => {
  const h = await build({ pages: 3, extractResults: [{ status: 'ok' }, { status: 'ok' }, { status: 'failed', errorCode: 'PROVIDER_ERROR' }, { status: 'ok' }] });
  try {
    await h.runner.runClaimed(h.job); assert.equal(terminal(h).status, 'PARTIAL');
    assert.deepEqual(Object.keys(h.job.checkpointJson.windows), ['w1', 'w2']);
    h.job.status = 'READING'; h.job.leaseOwner = 'owner-1'; h.job.attempts += 1;
    await h.runner.runClaimed(h.job);
    assert.equal(h.readCalls.length, 3); assert.equal(h.extractCalls.length, 4);
    assert.deepEqual(h.extractCalls[3].window.pageIndexes, [2]);
    assert.deepEqual(Object.keys(h.job.checkpointJson.windows), ['w1', 'w2', 'w3']);
    assert.ok(h.job.manifestJson.windows.every((window: any) => window.state === 'done'));
    assert.equal(terminal(h).status, 'DONE');
  } finally { h.restore(); }
});

it('R10 Q3: a signature-only page stores its third window and completes the two-page financial document', async () => {
  const h = await build({ pages: 3, extractResults: [{ status: 'ok' }, { status: 'ok' }, { status: 'ok', observations: observations({
    documents: [], items: [], components: [], totals: [], completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [2], notes: [] },
  }) }] });
  try {
    await h.runner.runClaimed(h.job);
    assert.deepEqual(Object.keys(h.job.checkpointJson.windows), ['w1', 'w2', 'w3']);
    assert.deepEqual(h.job.checkpointJson.windows.w3.documents, []); assert.equal(terminal(h).status, 'DONE');
    assert.equal(h.applyCalls.length, 1);
  } finally { h.restore(); }
});

for (const split of [false, true]) it(`U1 capture ${split ? 'auto-split' : 'merged/single'} forwards the slip classification to the shared apply guard`, async () => {
  const document = split ? twoShops() : observations();
  document.documents[0] = { ...document.documents[0]!, kind: 'TRANSFER_SLIP', family: 'PAYMENT_EVIDENCE',
    issuer: { name: 'TEST FOODS CO' }, classification: { ...document.documents[0]!.classification!,
      documentKind: 'TRANSFER_SLIP', documentFamily: 'PAYMENT_EVIDENCE', businessDirection: 'UNKNOWN' } };
  const h = await build({ extractResults: [{ status: 'ok', observations: document }] });
  try {
    await h.runner.runClaimed(h.job);
    assert.equal(h.applyCalls.length, split ? 2 : 1);
    assert.equal(h.applyCalls[0]![2].vendorName, 'TEST FOODS CO');
    assert.equal(h.applyCalls[0]![3].ocrDocumentType, 'TRANSFER_SLIP');
    if (!split) assert.equal(h.applyCalls[0]![3].sourceDocumentType, 'TRANSFER_SLIP');
    else assert.equal(h.applyCalls[1]![3].ocrDocumentType, 'RECEIPT');
  } finally { h.restore(); }
});


describe('free capture document boundary', () => {
  it('rejects multiple business documents before observations or split writes and returns the slot', async () => {
    const h = await build({ free: true, extractResults: [{ status: 'ok', observations: twoShops() }] });
    await h.runner.runClaimed(h.job);
    assert.equal(terminal(h).lastErrorCode, 'FREE_MULTI_DOCUMENT_UNSUPPORTED');
    assert.equal(h.createdExpenses.length, 0);
    assert.equal(h.applyCalls.length, 0);
    assert.equal(h.observationsStored.length, 0);
    assert.equal(h.released.length, 1);
  });
  it('R6 free unusable OCR preserves allowance and usable persistence consumes once', async () => {
    const h = await build({ free: true });
    await h.runner.runClaimed(h.job);
    assert.ok(h.admissions[0]?.succeededAt);
    assert.equal(h.applyCalls[0]?.[0].userId, 'user-1');
    assert.equal(h.applyCalls[0]?.[3].sourceOnly, true);
    assert.equal(typeof h.applyCalls[0]?.[3].onUsablePersisted, 'function');
    assert.equal(h.released.length, 0);
    const failed = await build({ free: true, observationFailure: true, applyResult: { committedUpdatedAt: null } });
    await failed.runner.runClaimed(failed.job);
    assert.equal(failed.admissions.length, 0);
    assert.equal(failed.released.length, 1);
  });
});

it('rechecks the original free job owner permission/branch and refuses a promoted source before providers', async () => {
  for (const over of [
    { workerAccess: { permissions: [] } },
    { workerAccess: { permissions: ['expense.ocr.request'], scopes: { branchIds: ['other-branch'] } } },
    { expense: { id: 'exp-1', companyId: 'co-1', status: 'READY_FOR_CONFIRMATION', primaryAttachmentId: 'att-1', createdByUserId: 'user-1', branchId: 'br-1' } },
  ]) {
    const h = await build({ free: true, ...over });
    await h.runner.runClaimed(h.job);
    assert.equal(h.readCalls.length, 0);
    assert.equal(h.extractCalls.length, 0);
    assert.equal(h.released.length, 1);
  }
});
