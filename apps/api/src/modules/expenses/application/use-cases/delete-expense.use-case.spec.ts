import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { compileRole } from '../../../employee-access/domain/logic/capability.logic';
import { ExpenseController } from '../../presentation/http/expense.controller';
import { DeleteExpenseUseCase } from './delete-expense.use-case';

const EXPENSE_ID = 'expense-1';
const COMPANY_ID = 'company-1';
const TX = Symbol('expense-delete-tx');

const baseExpense = {
  id: EXPENSE_ID,
  branchId: 'branch-1' as string | null,
  status: 'DRAFT',
  expenseNumber: 'EXP-2026-0001',
  vendorNameSnapshot: 'ร้านทดสอบ',
  expenseDate: new Date('2026-07-29T00:00:00.000Z'),
  grandTotalAmount: { toString: () => '1234.5000' },
  paidAmount: { gt: () => false },
  paymentStatus: 'UNPAID',
  captureSource: 'WEB_MANUAL',
  createdByUserId: 'creator-1',
  updatedAt: new Date('2026-07-29T08:00:00.000Z'),
  _count: { lines: 3 },
};

const linkedModels = {
  taxEvent: 'TAX_EVENT',
  taxReviewIssue: 'TAX_REVIEW_ISSUE',
  taxReconciliationLine: 'TAX_RECONCILIATION_LINE',
  tradeTaxEvidence: 'TRADE_TAX_EVIDENCE',
  journalEntry: 'JOURNAL_ENTRY',
  journalLine: 'JOURNAL_LINE',
  bankReconciliationMatch: 'BANK_RECONCILIATION_MATCH',
  workflowRun: 'WORKFLOW_RUN',
  workflowTask: 'WORKFLOW_TASK',
  workflowEventInbox: 'WORKFLOW_EVENT_INBOX',
  notificationEvent: 'NOTIFICATION_EVENT',
} as const;

type LinkedModel = keyof typeof linkedModels;

const expenseReference = { sourceType: 'expense.record', sourceId: EXPENSE_ID };
const expenseSource = { companyId: COMPANY_ID, ...expenseReference };
const workflowReference = { sourceType: 'expense_record', sourceId: EXPENSE_ID };
const workflowSource = { companyId: COMPANY_ID, ...workflowReference };
const linkedDataCases: Array<{ model: LinkedModel; where: Record<string, unknown> }> = [
  { model: 'taxEvent', where: expenseSource },
  { model: 'taxReviewIssue', where: expenseSource },
  { model: 'taxReconciliationLine', where: expenseSource },
  { model: 'tradeTaxEvidence', where: expenseSource },
  { model: 'journalEntry', where: expenseSource },
  {
    model: 'journalLine',
    where: {
      companyId: COMPANY_ID,
      OR: [
        expenseReference,
        { journalEntry: { is: expenseSource } },
      ],
    },
  },
  {
    model: 'bankReconciliationMatch',
    where: { companyId: COMPANY_ID, sourceType: 'EXPENSE_PAYMENT', sourceId: EXPENSE_ID },
  },
  { model: 'workflowRun', where: workflowSource },
  {
    model: 'workflowTask',
    where: {
      companyId: COMPANY_ID,
      OR: [
        workflowReference,
        { workflowRun: { is: workflowSource } },
      ],
    },
  },
  // Only an unprocessed event blocks; a SKIPPED row means no rule ever matched the expense.
  { model: 'workflowEventInbox', where: { ...workflowSource, status: { not: 'SKIPPED' } } },
  { model: 'notificationEvent', where: workflowSource },
];

function requestContext(permissions: string[], userId = 'actor-1', branchIds?: string[]) {
  return {
    requestId: 'request-1',
    authSubject: userId,
    userId,
    companyId: COMPANY_ID,
    membershipId: 'membership-1',
    roles: [],
    permissions,
    scopes: { branchIds },
    authProvider: 'watchdog' as const,
  };
}

function setup(input: {
  expense?: typeof baseExpense | null;
  evidence?: object | null;
  links?: Array<{ attachmentId: string }>;
  /** Links OTHER records still hold on each file after this expense's own are gone (appendix §25). */
  sharedLinkCount?: number;
  attachmentHold?: 'SUBSTITUTE_ARTIFACT' | 'SUBSTITUTE_SOURCE' | null;
  markDeletedError?: Error;
  auditFailure?: Error;
  linkedModel?: LinkedModel;
  ownSubdata?: boolean;
  readLog?: boolean;
  duplicateReferencedBy?: Array<{ expenseId: string }>;
  duplicateRemaining?: Array<{ candidateExpenseId: string; status: string; resolvedByUserId: string | null }>;
  deleteCount?: number;
} = {}) {
  const order: string[] = [];
  const auditCalls: Array<{ entry: any; tx: unknown }> = [];
  let commits = 0;
  let rollbacks = 0;
  const expense = input.expense === undefined ? baseExpense : input.expense;

  const expenseRecord = {
    findFirst: mock.fn(async () => {
      order.push('expense.find');
      return expense;
    }),
    updateMany: mock.fn(async () => {
      order.push('expense.updateMany');
      return { count: 1 };
    }),
    deleteMany: mock.fn(async () => {
      order.push('expense.delete');
      return { count: input.deleteCount ?? 1 };
    }),
  };
  // Two reads share this delegate: the referencing lookup keys on candidateExpenseId, the
  // per-referencer re-verdict keys on that referencer's own expenseId.
  const expenseDuplicateCandidate = {
    findMany: mock.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.candidateExpenseId === EXPENSE_ID) {
        order.push('duplicate.referencing');
        return input.duplicateReferencedBy ?? [];
      }
      order.push('duplicate.remaining');
      return input.duplicateRemaining ?? [];
    }),
  };
  const expenseSubstituteReceiptEvidence = {
    findFirst: mock.fn(async () => {
      order.push('evidence.find');
      return input.evidence ?? null;
    }),
  };
  const attachmentLink = {
    findMany: mock.fn(async () => {
      order.push('links.find');
      return input.links ?? [];
    }),
    deleteMany: mock.fn(async () => {
      order.push('links.delete');
      return { count: input.links?.length ?? 0 };
    }),
    count: mock.fn(async () => input.sharedLinkCount ?? 0),
  };
  const expenseLine = {
    findFirst: mock.fn(async () => input.ownSubdata ? { id: 'line-1' } : null),
  };
  const receiptExtraction = {
    findFirst: mock.fn(async () => input.ownSubdata ? { id: 'extraction-1' } : null),
  };
  const receiptAiVerification = {
    findFirst: mock.fn(async () => input.ownSubdata ? { id: 'verification-1' } : null),
  };
  const reportDrilldownAccessLog = {
    findFirst: mock.fn(async () => input.readLog ? { id: 'read-log-1' } : null),
  };
  const linkedDelegates = Object.fromEntries(
    Object.keys(linkedModels).map((model) => [
      model,
      {
        findFirst: mock.fn(async () => {
          order.push(`${model}.find`);
          return input.linkedModel === model ? { id: `${model}-1` } : null;
        }),
      },
    ]),
  ) as unknown as Record<LinkedModel, { findFirst: ReturnType<typeof mock.fn> }>;
  const tx = {
    expenseRecord,
    expenseDuplicateCandidate,
    expenseSubstituteReceiptEvidence,
    attachmentLink,
    expenseLine,
    receiptExtraction,
    receiptAiVerification,
    reportDrilldownAccessLog,
    ...linkedDelegates,
    marker: TX,
  };
  const prisma = {
    client: {
      $transaction: mock.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
        order.push('transaction.begin');
        try {
          const result = await work(tx);
          commits++;
          order.push('transaction.commit');
          return result;
        } catch (error) {
          rollbacks++;
          order.push('transaction.rollback');
          throw error;
        }
      }),
    },
  };
  const attachments = {
    findSubstituteEvidenceRetentionHold: mock.fn(async ({ id }: { id: string }, client: unknown) => {
      assert.equal(client, tx);
      order.push(`attachment.hold:${id}`);
      return input.attachmentHold ?? null;
    }),
    markDeleted: mock.fn(async ({ id }: { id: string }, client: unknown) => {
      assert.equal(client, tx);
      order.push(`attachment.delete:${id}`);
      if (input.markDeletedError) throw input.markDeletedError;
      return { id, status: 'DELETED' };
    }),
  };
  const audit = {
    log: mock.fn(async (entry: any, client?: unknown) => {
      auditCalls.push({ entry, tx: client });
      order.push(`audit.${entry.result.toLowerCase()}`);
      if (entry.result === 'SUCCESS' && input.auditFailure) throw input.auditFailure;
    }),
  };

  return {
    useCase: new DeleteExpenseUseCase(prisma as any, attachments as any, audit as any),
    prisma,
    tx,
    expenseRecord,
    expenseDuplicateCandidate,
    expenseSubstituteReceiptEvidence,
    attachmentLink,
    expenseLine,
    receiptExtraction,
    receiptAiVerification,
    reportDrilldownAccessLog,
    linkedDelegates,
    attachments,
    auditCalls,
    order,
    committed: () => commits > 0,
    rolledBack: () => rollbacks > 0,
    commits: () => commits,
    rollbacks: () => rollbacks,
  };
}

function firstCallArgs(fn: { mock: { calls: unknown[] } }, index = 0): any {
  return (fn.mock.calls[index] as any)?.arguments[0];
}

function exceptionResponse(error: unknown): unknown {
  return (error as { getResponse(): unknown }).getResponse();
}

describe('DeleteExpenseUseCase', () => {
  it('deletes a WEB_UPLOAD DRAFT with only its own lines, extraction, verification, and attachment', async () => {
    const harness = setup({
      expense: { ...baseExpense, captureSource: 'WEB_UPLOAD' },
      ownSubdata: true,
      links: [{ attachmentId: 'attachment-2' }, { attachmentId: 'attachment-1' }, { attachmentId: 'attachment-2' }],
    });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.equal(harness.committed(), true);
    assert.equal(harness.rolledBack(), false);
    assert.deepEqual(firstCallArgs(harness.attachmentLink.findMany), {
      where: { companyId: 'company-1', targetType: 'expense.record', targetId: EXPENSE_ID },
      select: { attachmentId: true },
    });
    assert.deepEqual(firstCallArgs(harness.attachmentLink.deleteMany), {
      where: { companyId: COMPANY_ID, targetType: 'expense.record', targetId: EXPENSE_ID },
    });
    assert.equal(harness.expenseLine.findFirst.mock.callCount(), 0);
    assert.equal(harness.receiptExtraction.findFirst.mock.callCount(), 0);
    assert.equal(harness.receiptAiVerification.findFirst.mock.callCount(), 0);
    assert.deepEqual(
      (harness.attachments.markDeleted.mock.calls as any[]).map((call) => call.arguments[0]),
      [
        { id: 'attachment-2', companyId: 'company-1' },
        { id: 'attachment-1', companyId: 'company-1' },
      ],
    );
    const success = harness.auditCalls.find(({ entry }) => entry.result === 'SUCCESS');
    assert.ok(success);
    assert.equal(success.tx, harness.tx);
    assert.deepEqual(success.entry, {
      companyId: 'company-1',
      actorUserId: 'actor-1',
      action: 'expense.delete',
      targetType: 'expense_record',
      targetId: EXPENSE_ID,
      requestId: 'request-1',
      result: 'SUCCESS',
      riskLevel: 'CRITICAL',
      metadataJson: {
        expenseNumber: 'EXP-2026-0001',
        vendorNameSnapshot: 'ร้านทดสอบ',
        expenseDate: '2026-07-29T00:00:00.000Z',
        grandTotalAmount: '1234.5000',
        captureSource: 'WEB_UPLOAD',
        createdByUserId: 'creator-1',
        attachmentIds: ['attachment-2', 'attachment-1'],
        lineCount: 3,
        duplicateRecheckedExpenseIds: [],
      },
    });
    assert.equal(harness.order.indexOf('audit.success') + 1, harness.order.indexOf('expense.delete'));
    assert.deepEqual(firstCallArgs(harness.expenseRecord.deleteMany), {
      where: {
        id: EXPENSE_ID,
        companyId: COMPANY_ID,
        updatedAt: new Date('2026-07-29T08:00:00.000Z'),
      },
    });
  });

  it('keeps a file another expense still links — an auto-split sibling shares its bytes (appendix §25)', async () => {
    const harness = setup({
      expense: { ...baseExpense, captureSource: 'WEB_UPLOAD' },
      ownSubdata: true,
      links: [{ attachmentId: 'attachment-shared' }],
      sharedLinkCount: 1,
    });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.equal(harness.committed(), true);
    // This expense's own claim on the file goes; the file itself stays with the record that still links it.
    assert.equal(harness.attachmentLink.deleteMany.mock.callCount(), 1);
    assert.equal(harness.attachments.markDeleted.mock.callCount(), 0, 'a shared file is never retired');
    const success = harness.auditCalls.find(({ entry }) => entry.result === 'SUCCESS');
    assert.ok(success);
    assert.deepEqual(success.entry.metadataJson.attachmentIds, ['attachment-shared']);
    assert.deepEqual(success.entry.metadataJson.sharedAttachmentIds, ['attachment-shared']);
  });

  it('denies deletion outside the actor branch scope before inspecting state or linked data', async () => {
    const harness = setup({ expense: { ...baseExpense, status: 'CONFIRMED', branchId: 'branch-2' } });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete'], 'actor-1', ['branch-1']), EXPENSE_ID),
      ForbiddenException,
    );

    assert.equal(harness.committed(), true);
    assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
      reason: 'BRANCH_OUT_OF_SCOPE',
      branchId: 'branch-2',
    });
    assert.equal(harness.expenseSubstituteReceiptEvidence.findFirst.mock.callCount(), 0);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
  });

  it('allows a company-central expense for a branch-restricted actor', async () => {
    const harness = setup({ expense: { ...baseExpense, branchId: null } });

    await harness.useCase.execute(requestContext(['expense.delete'], 'actor-1', ['branch-1']), EXPENSE_ID);

    assert.deepEqual(firstCallArgs(harness.expenseRecord.deleteMany).where, {
      id: EXPENSE_ID,
      companyId: COMPANY_ID,
      updatedAt: baseExpense.updatedAt,
      OR: [{ branchId: { in: ['branch-1'] } }, { branchId: null }],
    });
  });

  it('does not treat ReportDrilldownAccessLog as linked business data', async () => {
    const harness = setup({ readLog: true });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.equal(harness.reportDrilldownAccessLog.findFirst.mock.callCount(), 0);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
  });

  it('deletes a draft another expense flagged as its duplicate and clears that flag', async () => {
    const harness = setup({
      duplicateReferencedBy: [{ expenseId: 'expense-2' }, { expenseId: 'expense-2' }],
      duplicateRemaining: [],
    });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
    assert.deepEqual(firstCallArgs(harness.expenseDuplicateCandidate.findMany), {
      where: { companyId: COMPANY_ID, candidateExpenseId: EXPENSE_ID, expenseId: { not: EXPENSE_ID } },
      select: { expenseId: true },
    });
    // Both rows name the same referencing expense; it is re-verdicted once.
    assert.equal(harness.expenseRecord.updateMany.mock.callCount(), 1);
    assert.deepEqual(firstCallArgs(harness.expenseRecord.updateMany), {
      where: { id: 'expense-2', companyId: COMPANY_ID },
      data: {
        duplicateStatus: 'NO_MATCH',
        duplicateOfExpenseId: null,
        duplicateOverrideReason: null,
        updatedByUserId: 'actor-1',
      },
    });
    assert.ok(harness.order.indexOf('expense.updateMany') < harness.order.indexOf('expense.delete'));
    const success = harness.auditCalls.find(({ entry }) => entry.result === 'SUCCESS');
    assert.deepEqual(success?.entry.metadataJson.duplicateRecheckedExpenseIds, ['expense-2']);
  });

  it('keeps a surviving confirmed duplicate verdict when re-verdicting a referencing expense', async () => {
    const harness = setup({
      duplicateReferencedBy: [{ expenseId: 'expense-2' }],
      duplicateRemaining: [
        { candidateExpenseId: 'expense-3', status: 'CONFIRMED_DUPLICATE', resolvedByUserId: 'actor-9' },
        { candidateExpenseId: 'expense-4', status: 'OPEN', resolvedByUserId: null },
      ],
    });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.deepEqual(firstCallArgs(harness.expenseRecord.updateMany).data, {
      duplicateStatus: 'CONFIRMED_DUPLICATE',
      duplicateOfExpenseId: 'expense-3',
      duplicateOverrideReason: null,
      updatedByUserId: 'actor-1',
    });
    assert.deepEqual(firstCallArgs(harness.expenseDuplicateCandidate.findMany, 1), {
      where: { companyId: COMPANY_ID, expenseId: 'expense-2', candidateExpenseId: { not: EXPENSE_ID } },
      select: { candidateExpenseId: true, status: true, resolvedByUserId: true },
    });
  });

  it('re-verdicts a referencing expense left with only a human dismissal as OVERRIDDEN', async () => {
    const harness = setup({
      duplicateReferencedBy: [{ expenseId: 'expense-2' }],
      duplicateRemaining: [
        { candidateExpenseId: 'expense-3', status: 'DISMISSED', resolvedByUserId: 'actor-9' },
      ],
    });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.deepEqual(firstCallArgs(harness.expenseRecord.updateMany).data, {
      duplicateStatus: 'OVERRIDDEN',
      duplicateOfExpenseId: null,
      updatedByUserId: 'actor-1',
    });
  });

  it('deletes an unpaid zero-total expense awaiting review', async () => {
    const harness = setup({
      expense: {
        ...baseExpense,
        status: 'NEEDS_REVIEW',
        grandTotalAmount: { toString: () => '0.0000' },
      },
    });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
    assert.equal(harness.auditCalls.at(-1)?.entry.result, 'SUCCESS');
  });

  it('deletes a rejected expense at its full amount', async () => {
    const harness = setup({ expense: { ...baseExpense, status: 'REJECTED' } });

    await harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID);

    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
    assert.equal(harness.auditCalls.at(-1)?.entry.result, 'SUCCESS');
  });

  it('allows the creator holding expense.update to delete their own rejected expense', async () => {
    const harness = setup({ expense: { ...baseExpense, status: 'REJECTED' } });

    await harness.useCase.execute(requestContext(['expense.update'], 'creator-1'), EXPENSE_ID);

    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
    assert.equal(harness.auditCalls.at(-1)?.entry.result, 'SUCCESS');
  });

  it('denies a non-owner without expense.delete on a rejected expense', async () => {
    const harness = setup({ expense: { ...baseExpense, status: 'REJECTED' } });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.update']), EXPENSE_ID),
      ForbiddenException,
    );

    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
    assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, { reason: 'MISSING_PERMISSION' });
  });

  it('refuses non-draft states that are not unpaid zero-total review items and commits a DENIED audit', async () => {
    const statuses = ['EXTRACTING', 'CONFIRMED', 'VOIDED'];
    for (const status of statuses) {
      const harness = setup({ expense: { ...baseExpense, status } });

      await assert.rejects(
        () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          assert.deepEqual(exceptionResponse(error), {
            code: 'EXPENSE_NOT_DELETABLE',
            message: 'Only drafts, rejected records, or unpaid zero-total expenses awaiting confirmation can be deleted.',
          });
          return true;
        },
      );

      assert.equal(harness.committed(), true, status);
      assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0, status);
      assert.equal(harness.auditCalls.length, 1, status);
      assert.equal(harness.auditCalls[0]?.tx, harness.tx, status);
      assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
        reason: 'EXPENSE_NOT_DELETABLE',
        status,
        grandTotalAmount: '1234.5000',
        paymentStatus: 'UNPAID',
      });
    }
  });

  it('returns 404 for an expense id outside the company tenant', async () => {
    const harness = setup({ expense: null });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
      NotFoundException,
    );

    assert.equal(harness.auditCalls.length, 0);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
    assert.deepEqual(firstCallArgs(harness.expenseRecord.findFirst).where, {
      id: EXPENSE_ID,
      companyId: 'company-1',
    });
  });

  it('refuses target substitute evidence with the retention code and a committed DENIED audit', async () => {
    const harness = setup({ evidence: { id: 'evidence-1' } });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.deepEqual(exceptionResponse(error), {
          code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
          message: 'Expense is retained as substitute-receipt evidence.',
        });
        return true;
      },
    );

    assert.equal(harness.committed(), true);
    assert.equal(harness.auditCalls.length, 1);
    assert.equal(harness.auditCalls[0]?.tx, harness.tx);
    assert.equal(harness.auditCalls[0]?.entry.result, 'DENIED');
    assert.deepEqual(firstCallArgs(harness.expenseSubstituteReceiptEvidence.findFirst), {
      where: { companyId: COMPANY_ID, expenseId: EXPENSE_ID },
      select: { id: true },
    });
    assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
      reason: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
    });
    assert.equal(harness.attachmentLink.deleteMany.mock.callCount(), 0);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
  });

  for (const testCase of linkedDataCases) {
    const blocker = linkedModels[testCase.model];
    it(`refuses a DRAFT linked by ${blocker} and records naming metadata`, async () => {
      const harness = setup({ linkedModel: testCase.model });

      await assert.rejects(
        () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
        (error: unknown) => {
          assert.ok(error instanceof ConflictException);
          assert.deepEqual(exceptionResponse(error), {
            code: 'EXPENSE_HAS_LINKED_DATA',
            blocker,
            message: `Expense cannot be deleted because it has linked data: ${blocker}.`,
          });
          return true;
        },
      );

      assert.deepEqual(firstCallArgs(harness.linkedDelegates[testCase.model].findFirst), {
        where: testCase.where,
        select: { id: true },
      });
      assert.equal(harness.commits(), 1, blocker);
      assert.equal(harness.rollbacks(), 0, blocker);
      assert.equal(harness.auditCalls.length, 1, blocker);
      assert.equal(harness.auditCalls[0]?.tx, harness.tx, blocker);
      assert.equal(harness.auditCalls[0]?.entry.result, 'DENIED', blocker);
      assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
        reason: 'EXPENSE_HAS_LINKED_DATA',
        blocker,
      });
      assert.equal(harness.attachmentLink.findMany.mock.callCount(), 0, blocker);
      assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0, blocker);
    });
  }

  const paymentCases = [
    { name: 'paymentStatus is not UNPAID', paymentStatus: 'PARTIALLY_PAID', paidAmount: { gt: () => false } },
    { name: 'paidAmount is greater than zero', paymentStatus: 'UNPAID', paidAmount: { gt: () => true } },
  ];
  for (const payment of paymentCases) {
    it(`refuses a DRAFT when ${payment.name} and records naming metadata`, async () => {
      const harness = setup({ expense: { ...baseExpense, ...payment } });

      await assert.rejects(
        () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
        (error: unknown) => {
          assert.deepEqual(exceptionResponse(error), {
            code: 'EXPENSE_HAS_LINKED_DATA',
            blocker: 'PAYMENT',
            message: 'Expense cannot be deleted because it has linked data: PAYMENT.',
          });
          return true;
        },
      );

      assert.equal(harness.linkedDelegates.taxEvent.findFirst.mock.callCount(), 0);
      assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
        reason: 'EXPENSE_HAS_LINKED_DATA',
        blocker: 'PAYMENT',
      });
      assert.equal(harness.auditCalls[0]?.tx, harness.tx);
      assert.equal(harness.auditCalls[0]?.entry.result, 'DENIED');
      assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
    });
  }

  it('preflights attachment retention before unlinking and commits a DENIED audit', async () => {
    const harness = setup({
      links: [{ attachmentId: 'attachment-1' }],
      attachmentHold: 'SUBSTITUTE_SOURCE',
    });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
      (error: unknown) => {
        assert.deepEqual(exceptionResponse(error), {
          code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
          message: 'Expense is retained as substitute-receipt evidence.',
        });
        return true;
      },
    );

    assert.equal(harness.committed(), true);
    assert.equal(harness.attachmentLink.deleteMany.mock.callCount(), 0);
    assert.equal(harness.attachments.markDeleted.mock.callCount(), 0);
    assert.equal(harness.auditCalls.length, 1);
    assert.equal(harness.auditCalls[0]?.tx, harness.tx);
    assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
      reason: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
      attachmentId: 'attachment-1',
      retentionHold: 'SUBSTITUTE_SOURCE',
    });
  });

  it('normalizes a retention race from attachment soft-delete after rollback and logs DENIED once', async () => {
    const harness = setup({
      links: [{ attachmentId: 'attachment-1' }],
      markDeletedError: new ConflictException({
        statusCode: 409,
        code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
        message: 'Attachment is retained by certified substitute-receipt evidence.',
        hold: 'SUBSTITUTE_SOURCE',
      }),
    });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
      (error: unknown) => {
        assert.deepEqual(exceptionResponse(error), {
          code: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
          message: 'Expense is retained as substitute-receipt evidence.',
        });
        return true;
      },
    );

    assert.equal(harness.rolledBack(), true);
    assert.equal(harness.commits(), 1);
    assert.equal(harness.rollbacks(), 1);
    assert.equal(harness.prisma.client.$transaction.mock.callCount(), 2);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
    assert.equal(harness.auditCalls.length, 1);
    assert.equal(harness.auditCalls[0]?.tx, harness.tx);
    assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, {
      reason: 'SUBSTITUTE_EVIDENCE_RETENTION_LOCKED',
      source: 'attachment',
    });
  });

  it('denies a non-owner without expense.delete and commits the DENIED audit', async () => {
    const harness = setup();

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.update']), EXPENSE_ID),
      ForbiddenException,
    );

    assert.equal(harness.committed(), true);
    assert.equal(harness.auditCalls.length, 1);
    assert.equal(harness.auditCalls[0]?.tx, harness.tx);
    assert.deepEqual(harness.auditCalls[0]?.entry.metadataJson, { reason: 'MISSING_PERMISSION' });
    assert.equal(harness.expenseSubstituteReceiptEvidence.findFirst.mock.callCount(), 0);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
  });

  it('allows the creator holding expense.update to delete their own DRAFT', async () => {
    const harness = setup();

    await harness.useCase.execute(requestContext(['expense.update'], 'creator-1'), EXPENSE_ID);

    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
    assert.equal(harness.auditCalls[0]?.entry.result, 'SUCCESS');
  });

  it('does not delete when the in-transaction audit write fails', async () => {
    const harness = setup({ auditFailure: new Error('audit insert failed') });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
      /audit insert failed/,
    );

    assert.equal(harness.rolledBack(), true);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 0);
    assert.equal(harness.auditCalls.length, 1);
    assert.equal(harness.auditCalls[0]?.tx, harness.tx);
    assert.deepEqual(harness.order.slice(-2), ['audit.success', 'transaction.rollback']);
  });

  it('rolls back attachment and duplicate side effects when the expense changes before final delete', async () => {
    const harness = setup({
      deleteCount: 0,
      links: [{ attachmentId: 'attachment-1' }],
      duplicateReferencedBy: [{ expenseId: 'expense-2' }],
    });

    await assert.rejects(
      () => harness.useCase.execute(requestContext(['expense.delete']), EXPENSE_ID),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.deepEqual(exceptionResponse(error), {
          code: 'EXPENSE_CHANGED_DURING_DELETE',
          message: 'Expense changed while it was being deleted. Reload and try again.',
        });
        return true;
      },
    );

    assert.equal(harness.rollbacks(), 1);
    assert.equal(harness.commits(), 0);
    assert.equal(harness.attachments.markDeleted.mock.callCount(), 1);
    assert.equal(harness.expenseRecord.updateMany.mock.callCount(), 1);
    assert.equal(harness.expenseRecord.deleteMany.mock.callCount(), 1);
    assert.deepEqual(harness.order.slice(-2), ['expense.delete', 'transaction.rollback']);
  });
});

// F02. The web shows the delete button for `expense.delete` and the use case accepts it, but the
// route asked for `expense.update` alone. A role built from a finance template holds the first and
// not the second, so its delete button answered 403 before the use case was ever asked.
describe('DELETE expenses/:expenseId route guard (F02)', () => {
  const guard = new DenyByDefaultGuard(new Reflector());
  const reach = (permissions: string[]) => guard.canActivate({
    getHandler: () => ExpenseController.prototype.removeExpense,
    getClass: () => ExpenseController,
    switchToHttp: () => ({ getRequest: () => ({ context: { permissions } }) }),
  } as any);

  it('admits a role built from every finance template, the own-draft editor, and nobody holding neither', () => {
    for (const roleTemplateKey of ['tpl.x.finance', 'tpl.trading.finance', 'tpl.service.finance', 'tpl.ecom.finance']) {
      const { permissionKeys } = compileRole({ roleTemplateKey, permissionKeys: [], entitledFeatureKeys: null, granterPermissionKeys: null });
      assert.ok(permissionKeys.includes('expense.delete') && !permissionKeys.includes('expense.update'),
        `${roleTemplateKey} is the role shape this test exists for`);
      assert.equal(reach(permissionKeys), true, roleTemplateKey);
    }
    // The creator's own-draft path is unchanged; ownership and state stay with the use case.
    assert.equal(reach(['expense.update']), true);
    assert.throws(() => reach(['expense.read', 'expense.review', 'expense.confirm']), ForbiddenException);
  });
});
