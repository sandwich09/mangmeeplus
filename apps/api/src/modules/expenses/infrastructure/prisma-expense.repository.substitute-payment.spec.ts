import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaExpenseRepository } from './prisma-expense.repository';

const VERSION = new Date('2026-08-10T01:00:00.000Z');
const PAID_AT = new Date('2026-08-08T00:00:00.000Z');

function harness(paidAmount: string) {
  const payments: any[] = [];
  let expenseUpdate: Record<string, unknown> | undefined;
  const evidence: any = {
    id: 'evidence-1', companyId: 'company-1', expenseId: 'expense-1', branchId: 'branch-1',
    status: 'PAYER_CERTIFIED', version: 1, updatedAt: VERSION, payerUserId: 'payer-1',
    paymentDate: PAID_AT, paymentMethod: 'CASH', missingReceiptReason: 'ไม่มีใบเสร็จ',
    paymentEvidenceAttachmentIds: [], supportingAttachmentIds: [], snapshotJson: {},
  };
  const expense: any = {
    id: 'expense-1', companyId: 'company-1', currency: 'THB', netPayableAmount: '100.0000',
    paidAmount, postingStatus: 'posted', updatedAt: VERSION,
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
      attachmentLink: { create: async () => ({}) },
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
  it('records only the remaining paid amount and leaves accrual posting state alone', async () => {
    const { repo, payments, expenseUpdate } = harness('40.0000');
    await issue(repo);

    assert.equal(payments.length, 1);
    assert.deepEqual(payments[0], {
      companyId: 'company-1', expenseId: 'expense-1', amount: '60.0000', currency: 'THB',
      paymentMethod: 'CASH', paidAt: PAID_AT, status: 'RECORDED', postingStatus: 'pending',
      createdByUserId: 'approver-1',
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
});
