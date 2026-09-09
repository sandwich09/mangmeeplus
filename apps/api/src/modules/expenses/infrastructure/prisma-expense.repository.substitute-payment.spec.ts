import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalFingerprint } from '../../../common/security/canonical-fingerprint';
import { PrismaExpenseRepository } from './prisma-expense.repository';

const VERSION = new Date('2026-08-10T01:00:00.000Z');
const PAID_AT = new Date('2026-08-08T00:00:00.000Z');

function harness(paidAmount: string, fundingSource: 'COMPANY' | 'PERSONAL_ADVANCE' | null = 'COMPANY') {
  const payments: any[] = [];
  let expenseUpdate: Record<string, unknown> | undefined;
  const evidence: any = {
    id: 'evidence-1', companyId: 'company-1', expenseId: 'expense-1', branchId: 'branch-1',
    fundingSource, status: 'PAYER_CERTIFIED', version: 1, updatedAt: VERSION, payerUserId: 'payer-1',
    paymentDate: PAID_AT, paymentMethod: 'CASH', missingReceiptReason: 'ไม่มีใบเสร็จ',
    paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], snapshotJson: {},
  };
  const expense: any = {
    id: 'expense-1', companyId: 'company-1', currency: 'THB', netPayableAmount: '100.0000',
    paidAmount, paymentMethod: 'CASH', paidAt: PAID_AT, postingStatus: 'posted', updatedAt: VERSION,
  };
  const client: any = {
    $transaction: async (work: (tx: any) => Promise<unknown>) => work({
      $executeRaw: async () => 0,
      expenseSubstituteReceiptEvidence: {
        findFirst: async () => evidence,
        updateMany: async ({ where }: any) => ({ count: where.status === 'PAYER_CERTIFIED' ? 1 : 0 }),
        findUniqueOrThrow: async () => ({ ...evidence, status: 'ISSUED' }),
      },
      expenseRecord: {
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
