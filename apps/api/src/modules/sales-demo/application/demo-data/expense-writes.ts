import { createHash } from 'node:crypto';
import { expenseEvidenceFingerprint, type ExpenseEvidenceAssessment, type RequestContext } from '@watchdog-bms/contracts';
import type { Prisma } from '../../../../generated/prisma/client';
import type { AuditService } from '../../../audit/application/audit.service';
import { recordExpensePaymentEffects } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { expenseTaxSourceChecksum } from '../../../expenses/domain/logic/expense-status.logic';
import { calcLineTotals } from '../../../expenses/domain/logic/expense-totals.logic';
import type { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import type { demoSampleRows } from './sample-rows';

export type DemoRows = ReturnType<typeof demoSampleRows>;
export type DemoInput = { companyId: string; ownerUserId: string; branchId: string; now: Date };
export type DemoCategory = { id: string; name: string; accountHintKey: string | null };
/** Deterministic per copy and shaped like a normal row id ([a-z0-9]), because signed LINE postback
 *  tokens and other id checks only accept the characters real ids use. */
export const demoId = (companyId: string, key: string) => `d${createHash('sha256').update(`${companyId}:demo:${key}`).digest('hex').slice(0, 24)}`;

// Business dates use the application's UTC-midnight civil-date representation.
// The pure rows retain Bangkok instants so their dates never exceed the creation instant.
export function documentDate(date: Date): Date {
  return new Date(new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10));
}

export async function confirmDemoExpense(
  tx: Prisma.TransactionClient,
  repo: PrismaExpenseRepository,
  input: DemoInput,
  expenseId: string,
): Promise<void> {
  const reviewed = (await repo.findByIdWithRelations(input.companyId, expenseId, tx))!;
  // ponytail: receipts are represented as reviewed paper originals. Object storage needs
  // an injected AttachmentStoragePort, which the fixed Prisma-only entry point does not receive.
  const assessment: ExpenseEvidenceAssessment = {
    route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', reason: '', attachmentIds: [], originalDocumentAvailable: true,
  };
  await tx.expenseRecord.update({ where: { id: expenseId }, data: {
    aiVerificationSummaryJson: { documentReview: {
      version: 2, reviewedAt: input.now.toISOString(), reviewedByUserId: input.ownerUserId,
      assessment, fingerprint: expenseEvidenceFingerprint(reviewed, assessment),
    } },
  } });
  const source = (await repo.findByIdWithRelations(input.companyId, expenseId, tx))!;
  const requestId = demoId(input.companyId, 'seed');
  await repo.finalizeAndConfirmExpenseCas({
    companyId: input.companyId, id: expenseId, actorUserId: input.ownerUserId,
    expectedUpdatedAt: source.updatedAt, expectedSourceChecksum: expenseTaxSourceChecksum(source),
    postingStatus: 'pending', vendorSnapshotJson: null,
    confirmationAudit: { requestId, authority: { reason: 'demo_seed' } },
    outboxEvent: { eventKey: `expense.confirmed:expense_record:${expenseId}:${requestId}`,
      payloadJson: { companyId: input.companyId, aggregateType: 'expense_record', aggregateId: expenseId,
        requestId, occurredAt: input.now.toISOString(), data: { expenseId, postingStatus: 'pending' } } },
  }, async () => [], tx);
}

export async function writeReceiptExpenses(
  tx: Prisma.TransactionClient,
  repo: PrismaExpenseRepository,
  audit: AuditService,
  ctx: RequestContext,
  input: DemoInput,
  rows: DemoRows,
  categories: Map<string, DemoCategory>,
): Promise<void> {
  const receipts = rows.expenses.filter(row => !row.sourceClaimKey);
  const records = receipts.map((row): Prisma.ExpenseRecordCreateManyInput => {
    const vendor = rows.counterparties.find(candidate => candidate.key === row.counterpartyKey);
    const category = categories.get(row.accountHintKey)!;
    return {
      id: demoId(input.companyId, row.key), companyId: input.companyId, branchId: input.branchId,
      status: 'READY_FOR_CONFIRMATION', captureSource: 'WEB_MANUAL',
      expenseDate: documentDate(row.date), receivedAt: row.date, uploadedAt: row.date,
      vendorNameSnapshot: row.vendor, vendorDocumentNumber: `DEMO-${row.key}`,
      vendorCounterpartyId: vendor ? demoId(input.companyId, vendor.key) : null,
      vendorTaxIdSnapshot: vendor?.taxId, vendorEntityKindSnapshot: vendor?.entityKind,
      vendorBranchCodeSnapshot: vendor?.entityKind === 'JURISTIC' ? '00000' : null,
      vendorAddressSnapshot: vendor ? '1 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10110' : null,
      currency: 'THB', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      subtotalAmount: row.amount, taxableAmount: row.amount, vatAmount: '0', whtAmount: row.whtAmount,
      whtRate: row.whtRate, whtCategoryCode: row.whtRate ? 'WHT_SERVICE_3' : null,
      ...(row.whtRate && { whtRemittance: 'PAYER_FILES', whtInputJson: {
        inputType: 'RATE', value: row.whtRate, baseAmount: row.amount, origin: 'REVIEWER',
      } }),
      grandTotalAmount: row.amount, netPayableAmount: row.netPayableAmount,
      paidAmount: '0', outstandingAmount: row.netPayableAmount, paymentStatus: 'UNPAID',
      expenseCategoryId: category.id, accountHintKey: row.accountHintKey,
      duplicateStatus: 'NO_MATCH', aiVerificationStatus: 'HUMAN_VERIFIED',
      sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY',
      note: `${row.category} (ตัวอย่าง)`, createdByUserId: input.ownerUserId,
      ...(row.status === 'CONFIRMED' && { reviewedAt: row.date, reviewedByUserId: input.ownerUserId }),
      createdAt: row.date,
    };
  });
  await tx.expenseRecord.createMany({ data: records });
  await tx.expenseLine.createMany({ data: receipts.map(row => {
    const line = {
      id: demoId(input.companyId, `${row.key}-line`), companyId: input.companyId,
      expenseId: demoId(input.companyId, row.key), lineNumber: 1,
      description: `${row.category} (ตัวอย่าง)`, quantity: '1', unitPrice: row.amount,
      vatRate: null, whtRate: row.whtRate ? '0.03' : null,
      expenseCategoryId: categories.get(row.accountHintKey)!.id, accountHintKey: row.accountHintKey,
      reviewStatus: 'REVIEWED' as const,
    };
    return { ...line, ...calcLineTotals({ ...line, vatMode: 'NO_VAT' }) };
  }) });
  for (const row of receipts.filter(expense => expense.status === 'CONFIRMED')) {
    const expenseId = demoId(input.companyId, row.key);
    const idempotencyKey = demoId(input.companyId, `payment-${row.key}`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.companyId}:${idempotencyKey}:expense-payment-command`}))`;
    await confirmDemoExpense(tx, repo, input, expenseId);
    await repo.recordPaymentInTransaction(tx, {
      companyId: input.companyId, expenseId, actorUserId: input.ownerUserId, scopes: {},
      idempotencyKey, amount: row.netPayableAmount, paymentMethod: 'CASH',
      paidAt: documentDate(row.date).toISOString().slice(0, 10), paidAtConfirmed: true,
    }, (db, result) => recordExpensePaymentEffects(audit, ctx, expenseId, db, result));
  }
}
