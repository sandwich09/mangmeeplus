#!/usr/bin/env tsx
/**
 * Synthetic states behind the W08 browser evidence bundle.
 *
 * Committed with the images so the bundle is reproducible: run this against a THROWAWAY database
 * seeded by `apps/api/prisma/seed.ts`, boot the API and the web dev server, and the pages in
 * `README.md` render exactly what the PNGs show.
 *
 * Everything here is invented. No customer, no real shop, no personal data, no LINE identity, no
 * real file: the two "uploaded" documents are `AttachmentObject` rows with a synthetic object key
 * and no bytes behind them, which is all the pages under test read.
 *
 * It refuses any database whose host is not local, and it only ever writes ids prefixed `w08-`.
 *
 * Usage:
 *   DATABASE_URL=postgresql://…@127.0.0.1:<throwaway port>/<db> \
 *     pnpm exec tsx docs/qa/evidence/marketplace-buyer-expense-capture-2026-09-19/seed-capture-evidence.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../../apps/api/src/generated/prisma/client';
import { assembleCaptureFacts } from '../../../../apps/api/src/modules/expenses/domain/logic/expense-capture-facts.logic';
import { computeCaptureAllocation } from '../../../../apps/api/src/modules/expenses/domain/logic/expense-capture-allocation.logic';
import { EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION, type ExpenseCaptureObservations } from '@watchdog-bms/contracts';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required');
if (!['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('refusing to seed anything but an explicit local throwaway database');
}

const COMPANY = 'seed-local-company';
const BRANCH = 'seed-local-branch-ho';
const OWNER = 'seed-qa-user-owner';
const PAYER = 'seed-qa-user-staff';
const TAG = 'w08';

const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

// ─── the synthetic documents the reader "found" ───────────────────────────────

const classification = {
  contentKind: 'DOCUMENT', documentFamily: 'EXPENSE_EVIDENCE', documentKind: 'RECEIPT',
  businessDirection: 'PURCHASE_EXPENSE', transactionState: 'PAID', evidenceRoles: ['EXPENSE_SUPPORT'],
  confidence: 0.94, evidenceSignals: [], amountSignals: [], settlementSignals: [],
  missingRequiredSignals: [], contradictionSignals: [], requiresClarification: false,
} as ExpenseCaptureObservations['documents'][number]['classification'];

/**
 * Shop A: four rows, one of which printed no amount at all (the "ไม่ทราบ" the page must never show
 * as 0), and a printed total that does NOT meet the rows — so the page shows the mismatch chip.
 */
const shopA = (): ExpenseCaptureObservations => ({
  documents: [{
    ref: 'D1', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านวัสดุ สมใจ', taxId: '0105560012345' },
    documentNumber: 'RC-2026-0918', documentDate: '2026-09-18', currency: 'THB',
    printedPage: { number: 1, of: 1 }, printedPages: [1], classification,
  }],
  items: [
    { id: '0:1', documentRef: 'D1', description: 'ปูนซีเมนต์ถุง', quantity: '4', unitPrice: '145.00', amount: '580.00', event: 'sale', evidenceSpan: 'ปูนซีเมนต์ถุง 4 145.00 580.00' },
    { id: '0:2', documentRef: 'D1', description: 'สีทาภายใน 5 ลิตร', quantity: '2', unitPrice: '390.00', amount: '780.00', event: 'sale', evidenceSpan: 'สีทาภายใน 5 ลิตร 2 390.00 780.00' },
    { id: '0:3', documentRef: 'D1', description: 'แปรงทาสี', quantity: '3', unitPrice: '65.00', amount: '195.00', event: 'sale', evidenceSpan: 'แปรงทาสี 3 65.00 195.00' },
    // A row the page printed faintly: the amount is genuinely unknown (A28 — never 0).
    { id: '0:4', documentRef: 'D1', description: 'เทปกาวผ้า', quantity: '2', event: 'sale', evidenceSpan: 'เทปกาวผ้า 2' },
  ],
  components: [
    { id: 'c1', documentRef: 'D1', label: 'ค่าจัดส่ง', amount: '100.00', role: 'charge', scope: 'order', appliedStatus: 'applied', evidenceSpan: 'ค่าจัดส่ง 100.00' },
    { id: 'c2', documentRef: 'D1', label: 'ส่วนลดท้ายบิล', amount: '140.00', role: 'applied_discount', scope: 'order', appliedStatus: 'applied', evidenceSpan: 'ส่วนลดท้ายบิล 140.00' },
  ],
  // 580 + 780 + 195 + 100 − 140 = 1,515 against a printed 1,530: a real, unexplained difference.
  totals: [{ documentRef: 'D1', kind: 'document_total', amount: '1530.00', evidenceSpan: 'รวมทั้งสิ้น 1,530.00' }],
  payments: [{ documentRef: 'D1', method: 'เงินสด', status: 'paid', amount: '1530.00', evidenceSpan: 'ชำระด้วยเงินสด' }],
  refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 1, pagesCovered: [0], notes: ['อ่านราคาแถวสุดท้ายไม่ชัด'] },
});

/** The same shop A after a reviewer filled the unreadable row in: nothing unknown, total meets rows. */
const shopAClean = (): ExpenseCaptureObservations => {
  const base = shopA();
  return {
    ...base,
    items: base.items.filter((item) => item.id !== '0:4'),
    totals: [{ documentRef: 'D1', kind: 'document_total', amount: '1515.00', evidenceSpan: 'รวมทั้งสิ้น 1,515.00' }],
    payments: [{ documentRef: 'D1', method: 'เงินสด', status: 'paid', amount: '1515.00', evidenceSpan: 'ชำระด้วยเงินสด' }],
    completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
  };
};

/** Shop B: clean, so the group has one scope that reconciles beside one that does not. */
const shopB = (): ExpenseCaptureObservations => ({
  documents: [{
    ref: 'D2', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านเครื่องเขียน ปากน้ำ', taxId: '0105560099999' },
    documentNumber: 'SP-7781', documentDate: '2026-09-18', currency: 'THB',
    printedPage: { number: 1, of: 1 }, printedPages: [1], classification,
  }],
  items: [
    { id: '0:1', documentRef: 'D2', description: 'กระดาษ A4', quantity: '5', unitPrice: '120.00', amount: '600.00', event: 'sale', evidenceSpan: 'กระดาษ A4 5 120.00 600.00' },
    { id: '0:2', documentRef: 'D2', description: 'แฟ้มเอกสาร', quantity: '4', unitPrice: '45.00', amount: '180.00', event: 'sale', evidenceSpan: 'แฟ้มเอกสาร 4 45.00 180.00' },
  ],
  components: [],
  totals: [{ documentRef: 'D2', kind: 'document_total', amount: '780.00', evidenceSpan: 'รวม 780.00' }],
  payments: [{ documentRef: 'D2', method: 'เงินสด', status: 'paid', amount: '780.00', evidenceSpan: 'ชำระด้วยเงินสด' }],
  refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
});

/** Shop C: every amount readable, and a printed total 60 baht above the rows — a real mismatch. */
const shopC = (): ExpenseCaptureObservations => ({
  documents: [{
    ref: 'D3', pageIndexes: [0], kind: 'RECEIPT', family: 'EXPENSE_EVIDENCE',
    issuer: { name: 'ร้านกาแฟ ริมคลอง', taxId: '0105560077777' },
    documentNumber: 'CF-0042', documentDate: '2026-09-18', currency: 'THB',
    printedPage: { number: 1, of: 1 }, printedPages: [1], classification,
  }],
  items: [
    { id: '0:1', documentRef: 'D3', description: 'กาแฟเย็น', quantity: '6', unitPrice: '55.00', amount: '330.00', event: 'sale', evidenceSpan: 'กาแฟเย็น 6 55.00 330.00' },
    { id: '0:2', documentRef: 'D3', description: 'ขนมปังปิ้ง', quantity: '4', unitPrice: '45.00', amount: '180.00', event: 'sale', evidenceSpan: 'ขนมปังปิ้ง 4 45.00 180.00' },
  ],
  components: [],
  // 330 + 180 = 510 against a printed 570: shown to the reviewer, never balanced away (§6 rule 9).
  totals: [{ documentRef: 'D3', kind: 'document_total', amount: '570.00', evidenceSpan: 'รวมทั้งสิ้น 570.00' }],
  payments: [{ documentRef: 'D3', method: 'เงินสด', status: 'paid', amount: '570.00', evidenceSpan: 'ชำระด้วยเงินสด' }],
  refunds: [],
  completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
});

// ─── writers ─────────────────────────────────────────────────────────────────

async function attachment(id: string, name: string, mimeType = 'application/pdf'): Promise<string> {
  const attachmentId = `${TAG}-att-${id}`;
  await client.attachmentObject.upsert({
    where: { id: attachmentId },
    update: {},
    create: {
      id: attachmentId, companyId: COMPANY, branchId: BRANCH, uploadedByUserId: OWNER,
      storageProvider: 'local', bucket: 'w08-evidence-no-storage', objectKey: `${attachmentId}.pdf`,
      originalFileName: name, mimeType, byteSize: 812_400, checksumSha256: `sha-${attachmentId}`,
      status: 'ACTIVE', uploadedAt: new Date('2026-09-18T09:00:00.000Z'),
    },
  });
  return attachmentId;
}

async function captureFile(input: {
  id: string; groupId: string; attachmentId: string; position: number; name: string; pageCount?: number;
}): Promise<string> {
  const fileId = `${TAG}-file-${input.id}`;
  await client.expenseCaptureFile.upsert({
    where: { id: fileId },
    update: {},
    create: {
      id: fileId, companyId: COMPANY, groupId: input.groupId, attachmentId: input.attachmentId,
      position: input.position, uploadState: 'STORED', originalFileName: input.name,
      mimeType: 'application/pdf', byteSize: 812_400, checksumSha256: `sha-${fileId}`,
      addedByUserId: OWNER, ...(input.pageCount ? { pageCount: input.pageCount } : {}),
    },
  });
  await client.attachmentLink.upsert({
    where: { attachmentId_targetType_targetId_purpose: {
      attachmentId: input.attachmentId, targetType: 'expense.capture_group', targetId: input.groupId,
      purpose: 'expense.capture.evidence',
    } },
    update: {},
    create: {
      companyId: COMPANY, attachmentId: input.attachmentId, targetType: 'expense.capture_group',
      targetId: input.groupId, purpose: 'expense.capture.evidence', linkedByUserId: OWNER,
    },
  });
  return fileId;
}

async function readJob(input: {
  id: string; groupId: string; fileId: string; attachmentId: string;
  status: 'READING' | 'DONE' | 'FAILED' | 'PARTIAL'; pages: number; read: number; lastErrorCode?: string;
  expenseId?: string;
}): Promise<void> {
  await client.expenseCaptureReadJob.upsert({
    where: { id: `${TAG}-job-${input.id}` },
    update: {},
    create: {
      id: `${TAG}-job-${input.id}`, companyId: COMPANY,
      ownerType: input.expenseId ? 'EXPENSE' : 'CAPTURE_GROUP',
      groupId: input.expenseId ? null : input.groupId, expenseId: input.expenseId ?? null,
      fileId: input.expenseId ? null : input.fileId,
      attachmentId: input.attachmentId, attachmentChecksum: `sha-${input.fileId}`,
      ocrAdmissionRequestId: `${TAG}-ocr-${input.id}`, status: input.status,
      ...(input.lastErrorCode ? { lastErrorCode: input.lastErrorCode, lastErrorAt: new Date() } : {}),
      manifestJson: {
        pageCount: input.pages,
        pages: Array.from({ length: input.pages }, (_, index) => ({
          index, state: index < input.read ? 'read' : 'pending',
        })),
        chunks: [], windows: [], electronicVerification: { status: 'NOT_CHECKED', method: null, checkedAt: null },
      },
      providerCallCount: input.read,
    },
  });
}

async function observation(input: {
  id: string; groupId: string; fileId: string; payload: ExpenseCaptureObservations;
}): Promise<void> {
  await client.expenseCaptureObservation.upsert({
    where: { id: `${TAG}-obs-${input.id}` },
    update: {},
    create: {
      id: `${TAG}-obs-${input.id}`, companyId: COMPANY, groupId: input.groupId, fileId: input.fileId,
      jobId: `${TAG}-job-${input.id}`, version: 1, source: 'AI',
      payloadJson: { ...input.payload, reconciliation: [], multiDocument: false } as never,
    },
  });
}

async function group(input: {
  id: string;
  status: 'OPEN' | 'HANDED_OFF';
  businessUse: 'UNKNOWN' | 'ALL_COMPANY' | 'MIXED';
  fundingRoute: 'UNKNOWN' | 'COMPANY' | 'EMPLOYEE';
  payerUserId?: string | null;
  revision: number;
  note: string;
  acceptedAllocationId?: string | null;
  handoffBatchKey?: string | null;
}): Promise<string> {
  const groupId = `${TAG}-group-${input.id}`;
  await client.expenseCaptureGroup.upsert({
    where: { id: groupId },
    update: {},
    create: {
      id: groupId, companyId: COMPANY, branchId: BRANCH, createdByUserId: OWNER,
      intakeChannel: 'WEB', status: input.status, revision: input.revision,
      businessUse: input.businessUse, fundingRoute: input.fundingRoute,
      payerUserId: input.payerUserId ?? null, note: input.note,
      acceptedAllocationId: input.acceptedAllocationId ?? null,
      handoffBatchKey: input.handoffBatchKey ?? null,
      handoffState: input.status === 'HANDED_OFF' ? 'ACTIVE' : 'NONE',
    },
  });
  return groupId;
}

/** Real math: the allocation the page renders is computed by the production engine, not typed in. */
async function allocation(input: {
  id: string; groupId: string; groupRevision: number; fileIds: string[];
  businessUse: 'ALL_COMPANY' | 'MIXED'; fundingRoute: 'COMPANY' | 'EMPLOYEE';
  payerUserId: string | null; selection: Record<string, { companyQuantity: string }>;
  accepted: boolean; taxReview?: Record<string, { vatMode: string; inputVatClaimStatus: string; taxEvidenceStatus: string }>;
}): Promise<string> {
  const rows = await client.expenseCaptureObservation.findMany({
    where: { companyId: COMPANY, groupId: input.groupId }, orderBy: { version: 'asc' },
  });
  const facts = assembleCaptureFacts(rows.map((row) => ({
    id: row.id, fileId: row.fileId, expenseId: row.expenseId, version: row.version,
    source: row.source, stale: row.stale, payloadJson: row.payloadJson,
  })) as never);
  const result = computeCaptureAllocation({
    facts, businessUse: input.businessUse, fundingRoute: input.fundingRoute,
    payerUserId: input.payerUserId, selection: input.selection,
    taxReview: input.taxReview ?? {}, expenseDateChoice: {},
    policy: { discount: 'shared-discount-v1', shipping: 'shipping-by-eligible-item-v1' },
    todayIso: '2026-09-19',
  } as never);
  const allocationId = `${TAG}-alloc-${input.id}`;
  await client.expenseCaptureAllocation.upsert({
    where: { id: allocationId },
    update: {},
    create: {
      id: allocationId, companyId: COMPANY, groupId: input.groupId, groupRevision: input.groupRevision,
      policyVersion: EXPENSE_CAPTURE_ALLOCATION_POLICY_VERSION,
      selectionJson: input.selection as never, inputJson: { businessUse: input.businessUse } as never,
      resultJson: result as never, fundingRoute: input.fundingRoute, payerUserId: input.payerUserId,
      computedByUserId: OWNER,
      ...(input.accepted ? { status: 'ACCEPTED', acceptedByUserId: OWNER, acceptedAt: new Date() } : {}),
    },
  });
  return allocationId;
}

async function expense(input: {
  id: string; vendor: string; total: string; status: 'NEEDS_REVIEW' | 'CONFIRMED';
  captureGroupId?: string; captureAllocationId?: string; captureScopeKey?: string;
  payerUserId?: string; primaryAttachmentId?: string; taxEvidenceStatus?: string; vatMode?: string;
  inputVatClaimStatus?: string; aiVerificationSummaryJson?: Record<string, unknown>;
  sourceChannelMetadataJson?: Record<string, unknown>;
}): Promise<string> {
  const expenseId = `${TAG}-expense-${input.id}`;
  await client.expenseRecord.upsert({
    where: { id: expenseId },
    update: {},
    create: {
      id: expenseId, companyId: COMPANY, branchId: BRANCH, createdByUserId: OWNER,
      status: input.status as never, expenseDate: new Date('2026-09-18T00:00:00.000Z'),
      currency: 'THB', vatMode: (input.vatMode ?? 'NO_VAT') as never,
      inputVatClaimStatus: (input.inputVatClaimStatus ?? 'NON_CLAIMABLE') as never,
      taxEvidenceStatus: (input.taxEvidenceStatus ?? 'SUPPORTING_ONLY') as never,
      subtotalAmount: input.total, taxableAmount: input.total, grandTotalAmount: input.total,
      netPayableAmount: input.total, outstandingAmount: input.total,
      vendorNameSnapshot: input.vendor, captureSource: 'WEB_UPLOAD',
      ...(input.captureGroupId ? { captureGroupId: input.captureGroupId } : {}),
      ...(input.captureAllocationId ? { captureAllocationId: input.captureAllocationId } : {}),
      ...(input.captureScopeKey ? { captureScopeKey: input.captureScopeKey } : {}),
      ...(input.payerUserId ? { payerUserId: input.payerUserId } : {}),
      ...(input.primaryAttachmentId ? { primaryAttachmentId: input.primaryAttachmentId } : {}),
      ...(input.aiVerificationSummaryJson ? { aiVerificationSummaryJson: input.aiVerificationSummaryJson as never } : {}),
      ...(input.sourceChannelMetadataJson ? { sourceChannelMetadataJson: input.sourceChannelMetadataJson as never } : {}),
      lines: {
        create: [{
          companyId: COMPANY, lineNumber: 1, description: input.vendor, quantity: '1',
          unitPrice: input.total, taxableAmount: input.total, lineSubtotalAmount: input.total,
          lineTotalAmount: input.total,
        }],
      },
    },
  });
  if (input.primaryAttachmentId) {
    await client.attachmentLink.upsert({
      where: { attachmentId_targetType_targetId_purpose: {
        attachmentId: input.primaryAttachmentId, targetType: 'expense.record', targetId: expenseId,
        purpose: 'expense.receipt.primary',
      } },
      update: {},
      create: {
        companyId: COMPANY, attachmentId: input.primaryAttachmentId, targetType: 'expense.record',
        targetId: expenseId, purpose: 'expense.receipt.primary', linkedByUserId: OWNER,
      },
    });
  }
  return expenseId;
}

// ─── the four states the bundle photographs ──────────────────────────────────

/** Every row this script writes, removed in dependency order, so a re-run is a clean re-run. */
async function reset(): Promise<void> {
  const own = { companyId: COMPANY, id: { startsWith: `${TAG}-` } };
  await client.expenseSubstituteReceiptEvidence.deleteMany({ where: own });
  await client.expenseCaptureReadJob.deleteMany({ where: own });
  await client.expenseCaptureObservation.deleteMany({ where: own });
  await client.expenseCaptureAllocation.deleteMany({ where: own });
  await client.expenseCaptureFile.deleteMany({ where: own });
  await client.attachmentLink.deleteMany({ where: { companyId: COMPANY, attachmentId: { startsWith: `${TAG}-` } } });
  await client.expenseLine.deleteMany({ where: { companyId: COMPANY, expenseId: { startsWith: `${TAG}-` } } });
  await client.expenseRecord.deleteMany({ where: own });
  await client.expenseCaptureGroup.deleteMany({ where: own });
  await client.attachmentObject.deleteMany({ where: own });
}

async function main(): Promise<void> {
  await reset();
  // 0. A LEGACY expense with no capture lineage at all (A01): the list and the review page must be
  //    byte-for-byte what they were before this feature existed.
  const legacyAttachment = await attachment('legacy', 'ใบเสร็จร้านกาแฟ.pdf');
  await expense({ id: 'legacy', vendor: 'ร้านกาแฟหน้าออฟฟิศ', total: '450.0000', status: 'NEEDS_REVIEW', primaryAttachmentId: legacyAttachment });

  // 1. An OPEN group still being read: one file done, one still reading, facts with a mismatch and
  //    an unknown amount, and NEITHER of the two questions answered yet.
  const openGroup = await group({ id: 'open', status: 'OPEN', businessUse: 'UNKNOWN', fundingRoute: 'UNKNOWN', revision: 6, note: 'ซื้อของเข้าออฟฟิศ 18 ก.ย.' });
  const attA = await attachment('open-a', 'ใบเสร็จร้านวัสดุ.pdf');
  const attB = await attachment('open-b', 'ใบเสร็จเครื่องเขียน.pdf');
  const fileA = await captureFile({ id: 'open-a', groupId: openGroup, attachmentId: attA, position: 1, name: 'ใบเสร็จร้านวัสดุ.pdf', pageCount: 3 });
  const fileB = await captureFile({ id: 'open-b', groupId: openGroup, attachmentId: attB, position: 2, name: 'ใบเสร็จเครื่องเขียน.pdf', pageCount: 4 });
  await readJob({ id: 'open-a', groupId: openGroup, fileId: fileA, attachmentId: attA, status: 'DONE', pages: 3, read: 3 });
  await readJob({ id: 'open-b', groupId: openGroup, fileId: fileB, attachmentId: attB, status: 'READING', pages: 4, read: 1 });
  await observation({ id: 'open-a', groupId: openGroup, fileId: fileA, payload: shopA() });
  const attG = await attachment('open-c', 'ใบเสร็จร้านกาแฟ.pdf');
  const fileG = await captureFile({ id: 'open-c', groupId: openGroup, attachmentId: attG, position: 3, name: 'ใบเสร็จร้านกาแฟ.pdf', pageCount: 1 });
  await readJob({ id: 'open-c', groupId: openGroup, fileId: fileG, attachmentId: attG, status: 'DONE', pages: 1, read: 1 });
  await observation({ id: 'open-c', groupId: openGroup, fileId: fileG, payload: shopC() });

  // 2. The SAME two shops, reviewed: the split is computed by the production engine and ACCEPTED,
  //    so the page shows the preview, its provenance and the accepted state.
  const reviewedGroup = await group({ id: 'reviewed', status: 'OPEN', businessUse: 'MIXED', fundingRoute: 'EMPLOYEE', payerUserId: PAYER, revision: 9, note: 'ซื้อของสองร้าน มีของส่วนตัวด้วย' });
  const attC = await attachment('rev-a', 'ใบเสร็จร้านวัสดุ-2.pdf');
  const attD = await attachment('rev-b', 'ใบเสร็จเครื่องเขียน-2.pdf');
  const fileC = await captureFile({ id: 'rev-a', groupId: reviewedGroup, attachmentId: attC, position: 1, name: 'ใบเสร็จร้านวัสดุ.pdf', pageCount: 1 });
  const fileD = await captureFile({ id: 'rev-b', groupId: reviewedGroup, attachmentId: attD, position: 2, name: 'ใบเสร็จเครื่องเขียน.pdf', pageCount: 1 });
  await readJob({ id: 'rev-a', groupId: reviewedGroup, fileId: fileC, attachmentId: attC, status: 'DONE', pages: 1, read: 1 });
  await readJob({ id: 'rev-b', groupId: reviewedGroup, fileId: fileD, attachmentId: attD, status: 'DONE', pages: 1, read: 1 });
  await observation({ id: 'rev-a', groupId: reviewedGroup, fileId: fileC, payload: shopA() });
  await observation({ id: 'rev-b', groupId: reviewedGroup, fileId: fileD, payload: shopB() });
  // Two of the four stationery items are personal, so the split is a real division, not "all".
  const accepted = await allocation({
    id: 'reviewed', groupId: reviewedGroup, groupRevision: 8, fileIds: [fileC, fileD],
    businessUse: 'MIXED', fundingRoute: 'EMPLOYEE', payerUserId: PAYER, accepted: true,
    // Item ids are `<fileId>:<page>:<row>` — the same key `distributeCaptureAmounts` builds.
    // Shop A is entirely the company's; two of the four stationery folders are personal.
    selection: {
      [`${fileC}:0:1`]: { companyQuantity: '4' }, [`${fileC}:0:2`]: { companyQuantity: '2' },
      [`${fileC}:0:3`]: { companyQuantity: '3' },
      [`${fileD}:0:1`]: { companyQuantity: '5' }, [`${fileD}:0:2`]: { companyQuantity: '2' },
    },
  });
  await client.expenseCaptureGroup.update({ where: { id: reviewedGroup }, data: { acceptedAllocationId: accepted } });

  // 3. A HANDED_OFF group and the two ordinary expenses it produced — one claim-ready, one still
  //    waiting for a tax review — plus a PREPARED certificate on the shop that has no receipt.
  const handedGroup = await group({
    id: 'handed', status: 'HANDED_OFF', businessUse: 'ALL_COMPANY', fundingRoute: 'EMPLOYEE',
    payerUserId: PAYER, revision: 12, note: 'ส่งต่อแล้ว 2 ร้าน',
    handoffBatchKey: `${TAG}-group-handed:${TAG}-alloc-handed`,
  });
  const attE = await attachment('handed-a', 'ใบเสร็จร้านวัสดุ-3.pdf');
  const attF = await attachment('handed-b', 'ใบเสร็จเครื่องเขียน-3.pdf');
  const fileE = await captureFile({ id: 'handed-a', groupId: handedGroup, attachmentId: attE, position: 1, name: 'ใบเสร็จร้านวัสดุ.pdf', pageCount: 1 });
  const fileF = await captureFile({ id: 'handed-b', groupId: handedGroup, attachmentId: attF, position: 2, name: 'ใบเสร็จเครื่องเขียน.pdf', pageCount: 1 });
  await readJob({ id: 'handed-a', groupId: handedGroup, fileId: fileE, attachmentId: attE, status: 'DONE', pages: 1, read: 1 });
  await readJob({ id: 'handed-b', groupId: handedGroup, fileId: fileF, attachmentId: attF, status: 'DONE', pages: 1, read: 1 });
  await observation({ id: 'handed-a', groupId: handedGroup, fileId: fileE, payload: shopAClean() });
  await observation({ id: 'handed-b', groupId: handedGroup, fileId: fileF, payload: shopB() });
  const handedAllocation = await allocation({
    id: 'handed', groupId: handedGroup, groupRevision: 11, fileIds: [fileE, fileF],
    businessUse: 'ALL_COMPANY', fundingRoute: 'EMPLOYEE', payerUserId: PAYER, accepted: true, selection: {},
    taxReview: { 'issuer:0105560012345': { vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE', taxEvidenceStatus: 'SUPPORTING_ONLY' } },
  });
  await client.expenseCaptureGroup.update({ where: { id: handedGroup }, data: { acceptedAllocationId: handedAllocation } });
  const scopes = ((await client.expenseCaptureAllocation.findUniqueOrThrow({ where: { id: handedAllocation } }))
    .resultJson as { scopes?: Array<{ scopeKey: string; totals?: { netPayable?: string } }> }).scopes ?? [];
  let index = 0;
  for (const scope of scopes) {
    index += 1;
    const clean = index === 1;
    const derived = await expense({
      id: `derived-${index}`, vendor: clean ? 'ร้านวัสดุ สมใจ' : 'ร้านเครื่องเขียน ปากน้ำ',
      total: scope.totals?.netPayable ?? '0.0000', status: 'NEEDS_REVIEW',
      captureGroupId: handedGroup, captureAllocationId: handedAllocation, captureScopeKey: scope.scopeKey,
      payerUserId: PAYER, primaryAttachmentId: clean ? attE : attF,
      // The second shop is still waiting for a tax decision, so only the first is claim-ready.
      ...(clean ? {} : { vatMode: 'NEEDS_REVIEW', taxEvidenceStatus: 'NEEDS_REVIEW', inputVatClaimStatus: 'NEEDS_REVIEW' }),
      aiVerificationSummaryJson: { dateStatus: 'verified', captureGroupId: handedGroup, allocationId: handedAllocation, scopeKey: scope.scopeKey },
      sourceChannelMetadataJson: { channel: 'WEB', kind: 'capture_group', captureGroupId: handedGroup, allocationId: handedAllocation, scopeKey: scope.scopeKey },
    });
    if (!clean) continue;
    // A PREPARED certificate on the first shop: the wizard has been started and not yet signed.
    await client.expenseSubstituteReceiptEvidence.upsert({
      where: { id: `${TAG}-cert-1` },
      update: {},
      create: {
        id: `${TAG}-cert-1`, companyId: COMPANY, branchId: BRANCH, expenseId: derived, version: 1,
        status: 'PREPARED', documentNumber: 'SR-2026-0001', idempotencyKey: `${TAG}-cert-1-key`,
        fundingSource: 'PERSONAL_ADVANCE', signatureMode: 'DIGITAL',
        originalSourceDocumentType: 'OTHER_EXPENSE_DOCUMENT', reasonCode: 'SELLER_REFUSED_RECEIPT',
        missingReceiptReason: 'ร้านไม่ออกใบเสร็จรับเงินให้', businessPurpose: 'ซื้อวัสดุใช้ในสำนักงาน',
        paymentEvidenceAttachmentIds: [] as never, supportingAttachmentIds: [] as never,
        payerUserId: PAYER, payerName: 'พนักงานสำรองจ่าย (ข้อมูลทดสอบ)',
        paymentDate: new Date('2026-09-18T00:00:00.000Z'), paymentMethod: 'CASH',
        preparedByUserId: OWNER, preparedAt: new Date('2026-09-19T02:00:00.000Z'),
        expenseUpdatedAtAtPreparation: new Date('2026-09-19T02:00:00.000Z'),
        snapshotJson: {
          captureAllocation: { captureGroupId: handedGroup, allocationId: handedAllocation, scopeKey: scope.scopeKey },
        } as never,
      },
    });
  }

  const counts = {
    groups: await client.expenseCaptureGroup.count({ where: { companyId: COMPANY, id: { startsWith: TAG } } }),
    files: await client.expenseCaptureFile.count({ where: { companyId: COMPANY, id: { startsWith: TAG } } }),
    allocations: await client.expenseCaptureAllocation.count({ where: { companyId: COMPANY, id: { startsWith: TAG } } }),
    expenses: await client.expenseRecord.count({ where: { companyId: COMPANY, id: { startsWith: TAG } } }),
  };
  console.log(JSON.stringify({ seeded: counts, openGroup, reviewedGroup, handedGroup }, null, 2));
}

void main()
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(() => client.$disconnect());
