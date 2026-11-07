import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { ListSubstituteReceiptCandidatesUseCase } from '../application/use-cases/substitute-receipt.use-case';
import { PrismaExpenseRepository } from './prisma-expense.repository';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';
import { pgSpecUnreachableReason } from '../../../common/database/pg-spec-guard';

const VERSION = new Date('2026-08-10T01:00:00.000Z');
const PAID_AT = new Date('2026-08-08T00:00:00.000Z');

function harness(paidAmount: string, fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE' | null = 'COMPANY', reservation?: { preparerName: string | null }) {
  const payments: any[] = [];
  let expenseUpdate: Record<string, unknown> | undefined;
  const evidence: any = {
    id: 'evidence-1', companyId: 'company-1', expenseId: 'expense-1', branchId: 'branch-1',
    fundingSource, status: 'PAYER_CERTIFIED', version: 1, updatedAt: VERSION, payerUserId: 'payer-1',
    paymentDate: PAID_AT, paymentMethod: 'CASH', missingReceiptReason: 'ไม่มีใบเสร็จ',
    payeeName: 'ผู้ขาย', businessPurpose: 'ใช้งานบริษัท',
    paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], snapshotJson: {},
  };
  const expense: any = {
    id: 'expense-1', companyId: 'company-1', currency: 'THB', netPayableAmount: '100.0000',
    reservedByDisbursementVoucherId: reservation ? 'voucher-1' : null, paidAmount, paymentMethod: 'CASH', paidAt: PAID_AT, postingStatus: 'posted', updatedAt: VERSION,
  };
  const client: any = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({
      $executeRaw: async () => 0,
      expenseSubstituteReceiptEvidence: {
        findFirst: async () => evidence,
        updateMany: async ({ where }: any) => ({ count: where.status === 'PAYER_CERTIFIED' ? 1 : 0 }),
        findUniqueOrThrow: async () => ({ ...evidence, status: 'ISSUED' }),
      },
      disbursementVoucher: { findMany: async () => [{ id: 'voucher-1', documentNumber: 'DV-1', preparedByUserId: 'preparer-1' }] },
      user: { findMany: async () => reservation?.preparerName ? [{ id: 'preparer-1', displayName: reservation.preparerName }] : [] },
      expenseRecord: {
        findMany: async () => [expense],
        findFirst: async () => expense,
        updateMany: async ({ where, data }: any) => {
          expenseUpdate = data;
          return { count: where.updatedAt.getTime() === VERSION.getTime() ? 1 : 0 };
        },
      },
      attachmentObject: {
        count: async () => 0,
        create: async () => ({ id: 'artifact-1' }),
      },
      attachmentLink: { findMany: async () => [], create: async () => ({}) },
      reimbursementLine: { findFirst: async () => null },
      expensePayment: {
        create: async ({ data }: any) => {
          payments.push(data);
          return data;
        },
      },
    }),
  };
  return {
    repo: new PrismaExpenseRepository({ client } as any),
    expense,
    evidence,
    payments,
    expenseUpdate: () => expenseUpdate,
  };
}

function issue(repo: PrismaExpenseRepository) {
  return repo.issueSubstituteEvidence({
    companyId: 'company-1', expenseId: 'expense-1', evidenceId: 'evidence-1',
    approverUserId: 'approver-1', approverName: 'Approver', approverPosition: 'Finance',
    allowSelfApproval: false, approverSignatureAttachmentId: 'signature-1', approvedAt: VERSION,
    expectedExpenseUpdatedAt: VERSION, referencedAttachmentIds: [], expectedVersion: 1,
    expectedEvidenceUpdatedAt: VERSION,
    artifact: {
      storageProvider: 'S3', bucket: 'bucket', objectKey: 'key', objectVersionId: 'v1',
      byteSize: 1, checksumSha256: 'hash', originalFileName: 'issued.svg',
    },
  });
}

describe('substitute receipt payment history', () => {
  it('R4 rejects company-funded e-WHT cash/card on the actual issue path without any payment', async () => {
    for (const paymentMethod of ['CASH', 'CARD']) {
      const h = harness('0'); h.expense.whtRemittance = 'E_WHT'; h.evidence.paymentMethod = paymentMethod;
      await assert.rejects(() => issue(h.repo), (e: any) => e.getStatus() === 409 && e.getResponse().code === 'substitute_receipt_ewht_payment_method');
      assert.equal(h.payments.length, 0); assert.equal(h.expenseUpdate(), undefined);
    }
  });
  it('records a full company payment exactly once and leaves accrual posting alone', async () => {
    const { repo, payments, expenseUpdate } = harness('0.0000');
    await issue(repo);

    assert.equal(payments.length, 1);
    assert.deepEqual(payments[0], {
      companyId: 'company-1', expenseId: 'expense-1', amount: '100.0000', currency: 'THB',
      paymentMethod: 'CASH', paidAt: new Date('2026-08-07T17:00:00.000Z'), paidAtConfirmed: true, status: 'RECORDED', postingStatus: 'pending',
      createdByUserId: 'approver-1',
      idempotencyKey: 'substitute-receipt:evidence-1',
      payloadFingerprint: canonicalFingerprint({ expenseId: 'expense-1', amount: '100.0000', paymentMethod: 'CASH', paidAt: PAID_AT.toISOString() }),
    });
    assert.equal(expenseUpdate()?.paidAmount, '100.0000');
    assert.equal(expenseUpdate()?.outstandingAmount, '0.0000');
    assert.equal('postingStatus' in (expenseUpdate() ?? {}), false);
  });

  it('does not duplicate payment history when the expense is already fully paid', async () => {
    const { repo, payments } = harness('100.0000');
    await issue(repo);
    assert.equal(payments.length, 0);
  });

  it('refuses partial payment without adding the remainder', async () => {
    const { repo, payments } = harness('40.0000');
    await assert.rejects(() => issue(repo), /รองรับเฉพาะร้านจ่ายเต็มจำนวน/);
    assert.equal(payments.length, 0);
  });

  it('personal full advance produces evidence without company cash or paid status', async () => {
    const { repo, payments, expenseUpdate } = harness('0.0000', 'PERSONAL_ADVANCE');
    await issue(repo);
    assert.equal(payments.length, 0);
    assert.equal('paidAmount' in expenseUpdate()!, false);
    assert.equal('paymentStatus' in expenseUpdate()!, false);
    assert.equal(expenseUpdate()?.taxEvidenceStatus, 'SUPPORTING_ONLY');
  });

  it('legacy pending evidence requires an explicit funding declaration', async () => {
    await assert.rejects(() => issue(harness('0.0000', null).repo), /เอกสารเดิมยังไม่ระบุ/);
  });

  it('superseding an issued certificate preserves all payments and paid totals', async () => {
    let paymentVoid: Record<string, unknown> | undefined;
    let expenseUpdate: Record<string, unknown> | undefined;
    const evidence: any = {
      id: 'evidence-1', companyId: 'company-1', expenseId: 'expense-1',
      status: 'ISSUED', version: 1, updatedAt: VERSION,
      preparedAt: VERSION, expenseUpdatedAtAtPreparation: VERSION,
    };
    const client: any = {
      $transaction: async (work: (tx: any) => Promise<unknown>) => work({
        $executeRaw: async () => 0,
        attachmentLink: { findMany: async () => [] },
        reimbursementLine: { findFirst: async () => null },
        expenseSubstituteReceiptEvidence: {
          findFirst: async () => evidence,
          updateMany: async () => ({ count: 1 }),
          findUniqueOrThrow: async () => ({ ...evidence, status: 'SUPERSEDED', supersedeReason: 'wrong amount' }),
        },
        expenseRecord: {
          findFirst: async () => ({ id: 'expense-1', companyId: 'company-1', status: 'NEEDS_REVIEW', netPayableAmount: '100.0000' }),
          updateMany: async ({ data }: any) => { expenseUpdate = data; return { count: 1 }; },
        },
        expensePayment: {
          updateMany: async ({ where, data }: any) => { paymentVoid = { where, data }; return { count: 1 }; },
        },
      }),
    };
    const repo = new PrismaExpenseRepository({ client } as any);
    await repo.supersedeSubstituteEvidence({
      companyId: 'company-1', expenseId: 'expense-1', evidenceId: 'evidence-1',
      actorUserId: 'finance-1', reason: 'wrong amount', expectedEvidenceUpdatedAt: VERSION,
    });

    assert.equal(paymentVoid, undefined);
    for (const key of ['paymentStatus', 'paidAmount', 'outstandingAmount', 'paymentMethod', 'paidAt']) assert.equal(key in expenseUpdate!, false);
    assert.equal(expenseUpdate?.substituteReceiptGeneratedAt, null);
  });
});


for (const preparerName of ['สมใจ', null]) it(`refuses reserved company substitute approval with ${preparerName ? 'a preparer' : 'no preparer'}`, async () => {
  const h = harness('0.0000', 'COMPANY', { preparerName });
  await assert.rejects(issue(h.repo), (error: any) => {
    assert.equal(error.getResponse().message, `รายการนี้อยู่ในใบเตรียมจ่ายเลขที่ DV-1${preparerName ? ` จัดทำโดย ${preparerName}` : ''} ให้ยกเลิกใบนั้นก่อน แล้วจึงอนุมัติใบรับรองแทนใบเสร็จได้`);
    return true;
  });
  assert.equal(h.payments.length, 0); assert.equal(h.expenseUpdate(), undefined);
});


describe('substitute approval reservations and cancelled personal receipts (real PostgreSQL, B5b)', () => {
  const companyId = `substitute-reservation-${randomUUID()}`;
  let client: PrismaClient | undefined; let branchId: string; let ready = false; let created = false; let unreachable: string | null = null;
  before(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) { assert.notEqual(process.env.EXPENSE_PAYMENT_REQUIRE_POSTGRES, 'true', 'PostgreSQL is required'); return; }
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    unreachable = await pgSpecUnreachableReason(() => client!.$queryRaw`SELECT "reservedByDisbursementVoucherId" FROM "ExpenseRecord" LIMIT 0`, 'EXPENSE_PAYMENT_REQUIRE_POSTGRES');
    if (unreachable) return;
    await client.company.create({ data: { id: companyId, name: 'Substitute reservation tests' } }); created = true;
    branchId = (await client.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่' } })).id;
    ready = true;
  });
  after(async () => {
    try {
      if (created) {
        await client!.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
        await client!.attachmentObject.deleteMany({ where: { companyId } });
        await client!.disbursementVoucher.deleteMany({ where: { companyId } });
        await client!.expensePayment.deleteMany({ where: { companyId } });
        await client!.outboxEvent.deleteMany({ where: { companyId } });
        await client!.expenseRecord.deleteMany({ where: { companyId } });
        await client!.company.delete({ where: { id: companyId } });
      }
    } finally { await client?.$disconnect(); }
  });
  it('R9 category confirmation CAS preserves concurrent edits', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const categories = await Promise.all(['เดิม', 'เสนอ', 'เว็บ'].map(name => client!.expenseCategory.create({ data: { companyId, name, accountHintKey: 'GENERAL_EXPENSE' } })));
    const row = await client!.expenseRecord.create({ data: { companyId, branchId, createdByUserId: 'payer', expenseDate: PAID_AT,
      expenseCategoryId: categories[0]!.id, status: 'NEEDS_REVIEW' } });
    let read!: () => void, release!: () => void;
    const readBarrier = new Promise<void>(resolve => { read = resolve; });
    const webCommitted = new Promise<void>(resolve => { release = resolve; });
    const delayedClient = { $transaction: (fn: any) => client!.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
      if (key === 'expenseRecord') return new Proxy(target.expenseRecord, { get(table, method) {
        if (method === 'findFirst') return async (args: any) => {
          const found = await table.findFirst(args); read(); await webCommitted; return found;
        };
        const value = Reflect.get(table, method); return typeof value === 'function' ? value.bind(table) : value;
      } });
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } }))) };
    const input = { companyId, expenseId: row.id, actorUserId: 'payer', expectedUpdatedAt: row.updatedAt, scopes: { branchIds: [branchId] },
      expenseCategoryId: categories[1]!.id, continuation: { workflowId: randomUUID(), acceptedValues: { expenseCategoryId: categories[1]!.id } } };
    const pending = new PrismaExpenseRepository({ client: delayedClient } as any).saveLineSubstituteContinuation(input);
    const refused = assert.rejects(pending, (error: any) => error.getResponse().code === 'LINE_SUBSTITUTE_CONTINUATION_STALE');
    try {
      await readBarrier;
      await client!.expenseRecord.update({ where: { id: row.id }, data: { expenseCategoryId: categories[2]!.id, updatedAt: new Date(row.updatedAt.getTime() + 1000) } });
    } finally { release(); }
    await refused;
    let current = await client!.expenseRecord.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(current.expenseCategoryId, categories[2]!.id, 'web edit wins the race');
    assert.equal(current.sourceChannelMetadataJson, null, 'losing CAS rolls back the continuation too');
    const repo = new PrismaExpenseRepository({ client } as any);
    const second = await client!.expenseRecord.create({ data: { companyId, branchId, createdByUserId: 'payer', expenseDate: PAID_AT, expenseCategoryId: categories[0]!.id } });
    const secondInput = { ...input, expenseId: second.id, expectedUpdatedAt: second.updatedAt };
    const confirmed = await repo.saveLineSubstituteContinuation(secondInput);
    current = await client!.expenseRecord.update({ where: { id: second.id }, data: { expenseCategoryId: categories[2]!.id, updatedAt: new Date(confirmed.updatedAt.getTime() + 1000) } });
    await assert.rejects(repo.saveLineSubstituteContinuation({ ...secondInput, expectedUpdatedAt: confirmed.updatedAt }),
      (error: any) => error.getResponse().code === 'LINE_SUBSTITUTE_CONTINUATION_STALE');
    assert.equal((await client!.expenseRecord.findUniqueOrThrow({ where: { id: second.id } })).expenseCategoryId, categories[2]!.id, 'duplicate apply cannot overwrite a newer edit');
  });

  async function source(fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE', sourceCompanyId = companyId, sourceBranchId = branchId) {
    const expense = await client!.expenseRecord.create({ data: { companyId: sourceCompanyId, branchId: sourceBranchId, createdByUserId: 'payer', expenseDate: PAID_AT,
      expenseNumber: `EXP-${randomUUID()}`, status: 'READY_FOR_CONFIRMATION', sourceDocumentType: 'EXPENSE_NOTE_TEXT', postingStatus: 'not_required',
      taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100' } });
    const artifact = await client!.attachmentObject.create({ data: { companyId: sourceCompanyId, branchId: sourceBranchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `substitute-reservation/${randomUUID()}`,
      originalFileName: 'certified.svg', mimeType: 'image/svg+xml', byteSize: 1, checksumSha256: 'a'.repeat(64), status: 'ACTIVE', uploadedByUserId: 'payer' } });
    const evidence = await client!.expenseSubstituteReceiptEvidence.create({ data: { companyId: sourceCompanyId, branchId: sourceBranchId, expenseId: expense.id, version: 1,
      status: 'PAYER_CERTIFIED', fundingSource, documentNumber: `SUB-${randomUUID()}`, idempotencyKey: randomUUID(),
      originalSourceDocumentType: 'EXPENSE_NOTE_TEXT', reasonCode: 'RECEIPT_UNAVAILABLE', missingReceiptReason: 'ผู้ขายไม่ออกใบเสร็จ', businessPurpose: 'ซื้อของใช้ในกิจการ',
      preparedByUserId: 'payer', preparedAt: VERSION, expenseUpdatedAtAtPreparation: expense.updatedAt, payerUserId: 'payer', payerName: 'ผู้จ่าย', payeeName: 'ผู้ขาย',
      paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], paymentDate: PAID_AT, paymentMethod: 'CASH', snapshotJson: {},
      // The table's own check requires a certified receipt to carry its signing facts.
      snapshotChecksumSha256: 'snapshot-hash', payerPosition: 'พนักงาน', certifiedAt: VERSION, signatureMode: 'DIGITAL',
      payerSignatureAttachmentId: artifact.id, payerSignatureChecksumSha256: 'a'.repeat(64),
      certifiedArtifactAttachmentId: artifact.id, certifiedArtifactChecksumSha256: 'a'.repeat(64) } });
    return { expense, evidence };
  }
  it('R4 company-funded e-WHT cash/card issue creates no payment or issued artifact', async t => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const companyId = `ewht-substitute-${randomUUID()}`;
    await client!.company.create({ data: { id: companyId, name: 'e-WHT substitute guard fixture' } });
    const ownBranch = await client!.branch.create({ data: { companyId, code: 'HO', name: 'สำนักงานใหญ่' } });
    try {
      for (const paymentMethod of ['CASH', 'CARD'] as const) {
        const { expense, evidence } = await source('COMPANY', companyId, ownBranch.id);
        const changed = await client!.expenseRecord.update({ where: { id: expense.id }, data: { whtRemittance: 'E_WHT' } });
        const certificate = await client!.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { paymentMethod } });
        const repo = new PrismaExpenseRepository({ client } as any);
        const before = await client!.attachmentObject.count({ where: { companyId } });
        await assert.rejects(() => repo.issueSubstituteEvidence({ companyId, expenseId: expense.id, evidenceId: evidence.id,
          approverUserId: 'approver', approverName: 'ผู้อนุมัติ', approverPosition: 'เจ้าของกิจการ', allowSelfApproval: false,
          approverSignatureAttachmentId: evidence.payerSignatureAttachmentId!, approvedAt: VERSION, expectedExpenseUpdatedAt: changed.updatedAt,
          referencedAttachmentIds: [evidence.payerSignatureAttachmentId!], expectedVersion: certificate.version, expectedEvidenceUpdatedAt: certificate.updatedAt,
          artifact: { storageProvider: 'LOCAL', bucket: 'local', objectKey: `${companyId}/${randomUUID()}`, objectVersionId: 'v1', byteSize: 1,
            checksumSha256: 'a'.repeat(64), originalFileName: 'issued.svg' } }),
        (e: any) => e.getStatus() === 409 && e.getResponse().code === 'substitute_receipt_ewht_payment_method');
        assert.equal(await client!.expensePayment.count({ where: { companyId, expenseId: expense.id } }), 0);
        assert.equal(await client!.attachmentObject.count({ where: { companyId } }), before);
        assert.equal((await client!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'PAYER_CERTIFIED');
      }
    } finally {
      await client!.expenseSubstituteReceiptEvidence.deleteMany({ where: { companyId } });
      await client!.attachmentObject.deleteMany({ where: { companyId } });
      await client!.expenseRecord.deleteMany({ where: { companyId } });
      await client!.company.delete({ where: { id: companyId } });
    }
  });

  it('candidate paging finds sources older than 200 rows, searches items, and respects creator and branch scope', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const ids = Array.from({ length: 205 }, () => randomUUID());
    const otherBranch = await client!.branch.create({ data: { companyId, code: 'OTHER', name: 'สาขาอื่น' } });
    await client!.expenseRecord.createMany({ data: ids.map((id, index) => ({ id, companyId, branchId, createdByUserId: 'candidate-payer',
      expenseNumber: `CANDIDATE-${index}`, vendorDocumentNumber: `SELLER-${index}`, expenseDate: PAID_AT, createdAt: new Date(VERSION.getTime() - index * 1000),
      status: 'NEEDS_REVIEW', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
      inputVatClaimStatus: 'NON_CLAIMABLE', vendorNameSnapshot: 'ผู้ขายทดสอบ', accountHintKey: 'GENERAL_EXPENSE',
      grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100' })) });
    await client!.expenseLine.createMany({ data: ids.map((expenseId, index) => ({ companyId, expenseId, lineNumber: 1,
      description: `สินค้าทดสอบ ${index}`, quantity: '1', unitPrice: '100', lineTotalAmount: '100' })) });
    // Newer records belonging to another creator or branch must not consume an own-reader page.
    await client!.expenseRecord.update({ where: { id: ids[0]! }, data: { createdByUserId: 'other-payer' } });
    await client!.expenseRecord.update({ where: { id: ids[1]! }, data: { branchId: otherBranch.id } });
    const useCase = new ListSubstituteReceiptCandidatesUseCase(new PrismaExpenseRepository({ client } as any));
    const own = { companyId, userId: 'candidate-payer', permissions: ['expense.read_own'], scopes: { branchIds: [branchId] }, authProvider: 'watchdog' } as any;
    const first = await useCase.execute(own, { pageSize: 5 });
    assert.equal(first.total, 203); assert.equal(first.items[0]?.id, ids[2]);
    const last = await useCase.execute(own, { page: 41, pageSize: 5 });
    assert.deepEqual(last.items.map((row) => row.id), ids.slice(202));
    for (const search of ['CANDIDATE-204', 'สินค้าทดสอบ 204', 'SELLER-204']) {
      const result = await useCase.execute(own, { search }); assert.equal(result.total, 1); assert.equal(result.items[0]?.id, ids[204]);
    }
    assert.equal((await useCase.execute(own, { search: 'ผู้ขายทดสอบ' })).total, 203);
    assert.equal((await useCase.execute(own, { search: 'SELLER-1' })).items.some(row => row.id === ids[1]), false);
  });

  it('company substitute approval refuses the committed reservation before issuing or paying and succeeds after release', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expense, evidence } = await source('COMPANY'); const repo = new PrismaExpenseRepository({ client } as any);
    const voucher = await client!.disbursementVoucher.create({ data: { companyId, branchId, origin: 'PREPARED', status: 'APPROVED',
      documentNumber: `DV-${randomUUID()}`, payeeName: 'ผู้ขาย', payeeBasis: 'SINGLE', totalAmount: '100', preparedByUserId: 'former-member' } });
    await client!.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = ${voucher.id} WHERE id = ${expense.id}`;
    const input = { companyId, expenseId: expense.id, evidenceId: evidence.id, approverUserId: 'approver', approverName: 'ผู้อนุมัติ', approverPosition: 'ผู้จัดการ', allowSelfApproval: false,
      approverSignatureAttachmentId: 'approver-signature', approvedAt: VERSION, expectedExpenseUpdatedAt: expense.updatedAt, referencedAttachmentIds: [], expectedVersion: evidence.version, expectedEvidenceUpdatedAt: evidence.updatedAt,
      artifact: { storageProvider: 'LOCAL', bucket: 'test', objectKey: `${companyId}/${evidence.id}`, objectVersionId: 'v1', byteSize: 1, checksumSha256: 'a'.repeat(64), originalFileName: 'issued.svg' } };
    await assert.rejects(repo.issueSubstituteEvidence(input), (error: any) => {
      assert.equal(error.getResponse().message, `รายการนี้อยู่ในใบเตรียมจ่ายเลขที่ ${voucher.documentNumber} ให้ยกเลิกใบนั้นก่อน แล้วจึงอนุมัติใบรับรองแทนใบเสร็จได้`); return true;
    });
    assert.equal(await client!.expensePayment.count({ where: { expenseId: expense.id } }), 0);
    // Only the fixture's certified artifact exists: the refused approval stored no issued file.
    assert.equal(await client!.attachmentObject.count({ where: { companyId } }), 1);
    assert.equal((await client!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'PAYER_CERTIFIED');
    assert.equal((await client!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).paidAmount.toString(), '0');
    await client!.$executeRaw`UPDATE "ExpenseRecord" SET "reservedByDisbursementVoucherId" = NULL WHERE id = ${expense.id}`;
    await repo.issueSubstituteEvidence(input);
    assert.equal(await client!.expensePayment.count({ where: { expenseId: expense.id } }), 1);
  });
  it('combined owner signing commits both signatures and audits together, and rolls certification back if issuance fails', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const ownerId = `combined-owner-${randomUUID()}`;
    await client!.user.create({ data: { id: ownerId, displayName: 'เจ้าของกิจการ' } });
    try {
      const { expense, evidence } = await source('COMPANY');
      const prepared = await client!.expenseSubstituteReceiptEvidence.update({ where: { id: evidence.id }, data: { status: 'PREPARED', payerUserId: ownerId, payerSignatureAttachmentId: null, payerSignatureChecksumSha256: null, certifiedArtifactAttachmentId: null, certifiedArtifactChecksumSha256: null, certifiedAt: null, snapshotChecksumSha256: null } });
      const repo = new PrismaExpenseRepository({ client } as any);
      const artifact = { storageProvider: 'LOCAL', bucket: 'test', objectKey: `${companyId}/${evidence.id}/${randomUUID()}`, objectVersionId: 'v1', byteSize: 1, checksumSha256: 'a'.repeat(64), originalFileName: 'signed.svg' };
      const signatureId = evidence.payerSignatureAttachmentId!;
      const certification = { companyId, expenseId: expense.id, evidenceId: evidence.id, payerUserId: ownerId, payerPosition: 'เจ้าของกิจการ',
        payerSignatureAttachmentId: signatureId, payerSignatureChecksumSha256: 'a'.repeat(64), referencedAttachmentIds: [signatureId],
        snapshotJson: { payer: { userId: ownerId, certifiedAt: VERSION.toISOString() } }, snapshotChecksumSha256: 'snapshot', certifiedAt: VERSION,
        expectedVersion: 1, expectedEvidenceUpdatedAt: prepared.updatedAt, artifact };
      const issuance = { companyId, expenseId: expense.id, evidenceId: evidence.id, approverUserId: ownerId, approverName: 'เจ้าของกิจการ', approverPosition: 'เจ้าของกิจการ',
        allowSelfApproval: true, approverSignatureAttachmentId: signatureId, approvedAt: VERSION, expectedExpenseUpdatedAt: expense.updatedAt,
        referencedAttachmentIds: [signatureId], expectedVersion: 1, expectedEvidenceUpdatedAt: prepared.updatedAt, artifact: { ...artifact, objectKey: `${artifact.objectKey}-issued` } };
      const auditEntries = ['certify', 'approve'].map((stage) => ({ companyId, actorUserId: ownerId, action: `expense.substitute_receipt.${stage}`,
        targetType: 'expense_substitute_receipt', targetId: evidence.id, requestId: ownerId, result: 'SUCCESS' as const }));
      const input = { certification, issuance, actorRoles: ['OWNER'], auditEntries };
      const before = await client!.attachmentObject.count({ where: { companyId } });
      await assert.rejects(repo.certifyAndIssueSubstituteEvidence({ ...input, issuance: { ...issuance, expectedExpenseUpdatedAt: new Date(0) } }), /Expense details changed/);
      assert.equal((await client!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'PREPARED');
      assert.equal((await client!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).certifiedAt, null);
      assert.equal(await client!.attachmentObject.count({ where: { companyId } }), before);
      assert.equal(await client!.auditLog.count({ where: { companyId, requestId: ownerId } }), 0);
      const issued = await repo.certifyAndIssueSubstituteEvidence(input);
      assert.equal(issued.status, 'ISSUED');
      assert.equal(issued.payerSignatureAttachmentId, issued.approverSignatureAttachmentId);
      assert.equal(issued.certifiedAt!.getTime(), issued.approvedAt!.getTime());
      assert.ok(issued.certifiedArtifactAttachmentId && issued.artifactAttachmentId);
      assert.equal(await client!.auditLog.count({ where: { companyId, requestId: ownerId } }), 2);
      assert.equal(await client!.expensePayment.count({ where: { expenseId: expense.id } }), 1);
    } finally {
      await client!.auditLog.deleteMany({ where: { companyId, requestId: ownerId } });
      await client!.user.delete({ where: { id: ownerId } });
    }
  });
  it('E4: cancelling a personal receipt restores confirmation and direct payment without changing its history', async (t) => {
    if (!ready) return t.skip(unreachable ?? 'DATABASE_URL is not set');
    const { expense, evidence } = await source('PERSONAL_ADVANCE'); const repo = new PrismaExpenseRepository({ client } as any);
    const confirm = { companyId, id: expense.id, expectedUpdatedAt: expense.updatedAt, actorUserId: 'payer', expenseNumber: expense.expenseNumber!, postingStatus: 'not_required' as const,
      vendorSnapshotJson: null, outboxEvent: { eventKey: `e4:${expense.id}`, payloadJson: { data: { expenseId: expense.id } } } };
    const pay = { companyId, expenseId: expense.id, actorUserId: 'payer', scopes: {}, idempotencyKey: randomUUID(), amount: '100' };
    await assert.rejects(repo.confirmExpenseCas(confirm), /พนักงานจ่ายร้านแล้ว/);
    await assert.rejects(repo.recordPaymentAtomic(pay), /พนักงานจ่ายร้านแล้ว/);
    assert.equal((await repo.expenseCorrectionCapabilities(companyId, expense.id, ['expense.payment.record'])).recordPaymentBlocker, 'personal_advance');
    await repo.supersedeSubstituteEvidence({ companyId, expenseId: expense.id, evidenceId: evidence.id, actorUserId: 'payer', reason: 'ยกเลิกใบแทน', expectedEvidenceUpdatedAt: evidence.updatedAt });
    assert.equal((await repo.findByIdWithRelations(companyId, expense.id))!.substituteReceiptEvidence, null);
    await repo.confirmExpenseCas(confirm);
    const capabilities = await repo.expenseCorrectionCapabilities(companyId, expense.id, ['expense.confirm', 'expense.payment.record']);
    assert.equal(capabilities.recordPaymentBlocker, null); assert.equal(capabilities.disbursementReservation, null);
    await repo.recordPaymentAtomic(pay);
    assert.equal(await client!.expensePayment.count({ where: { expenseId: expense.id } }), 1);
    assert.equal((await client!.expenseRecord.findUniqueOrThrow({ where: { id: expense.id } })).status, 'CONFIRMED');
    assert.equal((await client!.expenseSubstituteReceiptEvidence.findUniqueOrThrow({ where: { id: evidence.id } })).status, 'SUPERSEDED');
  });
});

it('candidate search combines its OR with the existing branch OR instead of replacing it', async () => {
  let query: any;
  const repo = new PrismaExpenseRepository({ client: { expenseRecord: { findMany: async (input: any) => { query = input; return []; } } } } as any);
  const branchScope = { companyId: 'co', createdByUserId: 'payer', OR: [{ branchId: { in: ['allowed'] } }, { branchId: null }] };
  await repo.listSubstituteReceiptCandidateSources({ ...branchScope, search: 'old' }, {});
  assert.deepEqual(query.where.AND[0], branchScope);
  assert.equal(query.where.AND[1].OR[2].lines.some.description.contains, 'old');
  assert.equal(query.where.AND[1].OR[3].vendorDocumentNumber.contains, 'old');
});

it('certificate signer choices identify the active owner without changing branch visibility', async () => {
  const repo = new PrismaExpenseRepository({ client: { companyMembership: { findMany: async () => [
    { userId: 'owner', user: { displayName: 'เจ้าของ' }, branchScopeMode: 'ALL_BRANCHES', roles: [{ role: { key: 'OWNER', status: 'ACTIVE' } }] },
    { userId: 'other', user: { displayName: 'ต่างสาขา' }, branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'other', roles: [] },
  ] } } } as any);
  assert.deepEqual(await repo.listActiveMemberIdentities('co', 'b1'), [{ userId: 'owner', displayName: 'เจ้าของ', isOwner: true }]);
});


it('candidate sources read active receipt files through the tenant and branch scoped evidence path', async () => {
  let links: any;
  const row = { id: 'expense', companyId: 'co', branchId: 'b1', lines: [], substituteReceiptEvidences: [], grandTotalAmount: '0', vatMode: 'NO_VAT' };
  const file = { id: 'receipt', companyId: 'co', branchId: 'b1', status: 'ACTIVE', originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 12, checksumSha256: 'hash', createdAt: new Date() };
  const repo = new PrismaExpenseRepository({ client: {
    expenseRecord: { findMany: async () => [row] },
    expenseSubstituteReceiptEvidence: { findMany: async () => [] },
    attachmentLink: { findMany: async (query: any) => { links = query; return [{ targetId: row.id, attachmentId: file.id, purpose: 'expense.receipt.primary', attachment: file }]; } },
  } } as any);
  const result = await repo.listSubstituteReceiptCandidateSources({ companyId: 'co' }, { branchIds: ['b1'] });
  assert.equal(result[0].attachments[0].id, 'receipt');
  assert.equal(links.where.companyId, 'co'); assert.equal(links.where.attachment.companyId, 'co');
  assert.equal(links.where.attachment.status, 'ACTIVE');
  assert.match(JSON.stringify(links.where.attachment), /b1/);
});
