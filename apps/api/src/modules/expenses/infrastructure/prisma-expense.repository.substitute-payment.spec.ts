import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
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
  it('records a full company payment exactly once and leaves accrual posting alone', async () => {
    const { repo, payments, expenseUpdate } = harness('0.0000');
    await issue(repo);

    assert.equal(payments.length, 1);
    assert.deepEqual(payments[0], {
      companyId: 'company-1', expenseId: 'expense-1', amount: '100.0000', currency: 'THB',
      paymentMethod: 'CASH', paidAt: PAID_AT, status: 'RECORDED', postingStatus: 'pending',
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
    await assert.rejects(() => issue(repo), /รองรับบริษัทจ่ายเต็ม/);
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
  async function source(fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE') {
    const expense = await client!.expenseRecord.create({ data: { companyId, branchId, createdByUserId: 'payer', expenseDate: PAID_AT,
      expenseNumber: `EXP-${randomUUID()}`, status: 'READY_FOR_CONFIRMATION', sourceDocumentType: 'EXPENSE_NOTE_TEXT', postingStatus: 'not_required',
      taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE', subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100', outstandingAmount: '100' } });
    const artifact = await client!.attachmentObject.create({ data: { companyId, branchId, storageProvider: 'LOCAL', bucket: 'local', objectKey: `substitute-reservation/${randomUUID()}`,
      originalFileName: 'certified.svg', mimeType: 'image/svg+xml', byteSize: 1, checksumSha256: 'a'.repeat(64), status: 'ACTIVE', uploadedByUserId: 'payer' } });
    const evidence = await client!.expenseSubstituteReceiptEvidence.create({ data: { companyId, branchId, expenseId: expense.id, version: 1,
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
