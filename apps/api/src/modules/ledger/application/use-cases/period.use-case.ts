import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaLedgerRepository } from '../../infrastructure/prisma-ledger.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { PrismaAccountingRepository } from '../../../accounting-documents/infrastructure/prisma-accounting.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { PrismaProcurementRepository } from '../../../procurement/infrastructure/prisma-procurement.repository';
import { PrismaReimbursementRepository } from '../../../reimbursements/infrastructure/prisma-reimbursement.repository';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { RequestContext, AccountingPeriodSummary, PeriodCloseRunSummary, PeriodCloseCheck } from '@watchdog-bms/contracts';
import type { PeriodRecord } from '../../domain/models/ledger.model';
import Decimal from 'decimal.js';
import { ChartReadinessService } from '../services/chart-readiness.service.js';
import { requiresReviewedPostingRules } from '../../domain/logic/posting-engine.logic.js';
import { exclusiveEndOfDay } from '@watchdog-bms/contracts';

function requirePerm(ctx: RequestContext, perm: string) {
  if (!ctx.permissions.includes(perm)) throw new ForbiddenException(`Missing permission: ${perm}`);
}

function toSummary(r: PeriodRecord): AccountingPeriodSummary {
  return {
    id: r.id, companyId: r.companyId, periodKey: r.periodKey,
    startDate: r.startDate.toISOString(), endDate: r.endDate.toISOString(),
    status: r.status, closedAt: r.closedAt?.toISOString() ?? null,
    reopenedAt: r.reopenedAt?.toISOString() ?? null,
  };
}

export function transactionTaxCloseIssueCount(
  events: Array<{ componentKey: string | null; branchId: string | null; updatedAt: Date }>,
  runs: Array<{ formType: string; branchId: string | null; status: string; blockingIssueCount: number; createdAt: Date }>,
): number {
  const required = new Map<string, { formType: string; branchId: string | null; latestEventAt: Date }>();
  for (const event of events) {
    const form = event.componentKey === 'PP36_OUTPUT' ? 'PP36'
      : ['VAT', 'IMPORT_VAT', 'PP36_INPUT'].includes(event.componentKey ?? '') ? 'PP30'
        : ['CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX'].includes(event.componentKey ?? '') ? 'CUSTOMS_SUPPORT' : null;
    if (!form) continue;
    const key = `${form}|${event.branchId ?? '__ALL__'}`;
    const latest = required.get(key);
    if (!latest || event.updatedAt > latest.latestEventAt) required.set(key, { formType: form, branchId: event.branchId, latestEventAt: event.updatedAt });
  }
  let issues = 0;
  for (const { formType, branchId, latestEventAt } of required.values()) {
    const latest = runs.filter((run) => run.formType === formType && (run.branchId === null || run.branchId === branchId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!latest || latest.status !== 'REVIEWED' || latest.blockingIssueCount > 0 || latest.createdAt < latestEventAt) issues += 1;
  }
  return issues;
}

@Injectable()
export class ListPeriodsUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext): Promise<AccountingPeriodSummary[]> {
    requirePerm(ctx, 'ledger.period.read');
    const rows = await this.repo.listPeriods(ctx.companyId);
    return rows.map(toSummary);
  }
}

@Injectable()
export class EnsurePeriodUseCase {
  constructor(private readonly repo: PrismaLedgerRepository) {}

  async execute(ctx: RequestContext, periodKey: string): Promise<AccountingPeriodSummary> {
    requirePerm(ctx, 'ledger.period.read');
    const [y, m] = periodKey.split('-').map(Number) as [number, number];
    // UTC, not local: AccountingPeriod.startDate/endDate are @db.Date, and local-midnight
    // construction from a non-UTC host stores the previous day (civil-date.ts trap 1).
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end   = new Date(Date.UTC(y, m, 0));
    const period = await this.repo.upsertPeriod(ctx.companyId, periodKey, start, end);
    return toSummary(period);
  }
}

@Injectable()
export class RunPeriodCloseChecksUseCase {
  constructor(
    private readonly repo: PrismaLedgerRepository,
    private readonly accountingRepo: PrismaAccountingRepository,
    private readonly expenseRepo: PrismaExpenseRepository,
    private readonly procurementRepo: PrismaProcurementRepository,
    private readonly reimbursementRepo: PrismaReimbursementRepository,
    private readonly prisma: PrismaService,
    private readonly chartReadiness: ChartReadinessService,
  ) {}

  async execute(ctx: RequestContext, periodId: string): Promise<PeriodCloseRunSummary> {
    requirePerm(ctx, 'ledger.period.close');
    const period = await this.repo.findPeriodById(ctx.companyId, periodId);
    if (!period || period.companyId !== ctx.companyId) throw new NotFoundException('Period not found');
    const db = this.prisma.client as any;

    const checks: PeriodCloseCheck[] = [];

    // Check 1: No draft journals
    const draftCount = await this.repo.countDraftJournals(ctx.companyId, periodId);
    checks.push({
      checkKey: 'no_draft_journals',
      status: draftCount === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: draftCount === 0 ? 'ไม่มีสมุดรายวันค้างร่าง' : `มีสมุดรายวันค้างร่าง ${draftCount} รายการ กรุณาบันทึกหรือยกเลิกก่อนปิดงวด`,
      count: draftCount,
    });

    // Check 2: Trial balance debit === credit
    const balances = await this.repo.getAccountBalances(ctx.companyId, [periodId]);
    const totalDr = balances.reduce((total, balance) => total.add(balance.totalDebit), new Decimal(0));
    const totalCr = balances.reduce((total, balance) => total.add(balance.totalCredit), new Decimal(0));
    const difference = totalDr.minus(totalCr).abs();
    const tbBalanced = difference.lt('0.0001');
    checks.push({
      checkKey: 'trial_balance_balanced',
      status: tbBalanced ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: tbBalanced ? 'งบทดลองสมดุล' : `งบทดลองไม่สมดุล: เดบิต ${totalDr.toFixed(2)} เครดิต ${totalCr.toFixed(2)}`,
      amount: difference.toFixed(2),
    });

    const [
      documentBlockers,
      accountingPaymentBlockers,
      expenseBlockers,
      vendorBillBlockers,
      supplierPaymentBlockers,
      reimbursementBlockers,
      supplementalPostingErrors,
    ] = await Promise.all([
      this.accountingRepo.countPostingBlockers(ctx.companyId, period.startDate, period.endDate),
      this.accountingRepo.countPaymentPostingBlockers(ctx.companyId, period.startDate, period.endDate),
      this.expenseRepo.countPostingBlockers(ctx.companyId, period.startDate, period.endDate),
      this.procurementRepo.countVendorBillPostingBlockers(ctx.companyId, period.startDate, period.endDate),
      this.procurementRepo.countSupplierPaymentPostingBlockers(ctx.companyId, period.startDate, period.endDate),
      this.reimbursementRepo.countReimbursementPostingBlockers(ctx.companyId, period.startDate, period.endDate),
      Promise.all([
        db.purchaseOrder.count({ where: {
          companyId: ctx.companyId,
          orderDate: { gte: period.startDate, lt: exclusiveEndOfDay(period.endDate) },
          postingStatus: 'posting_error',
        } }),
        db.goodsReceipt.count({ where: {
          companyId: ctx.companyId,
          receivedAt: { gte: period.startDate, lt: exclusiveEndOfDay(period.endDate) },
          postingStatus: 'posting_error',
        } }),
        db.bankAdjustment.count({ where: {
          companyId: ctx.companyId,
          adjustmentDate: { gte: period.startDate, lt: exclusiveEndOfDay(period.endDate) },
          postingStatus: 'posting_error',
        } }),
        db.reimbursementRequest.count({ where: {
          companyId: ctx.companyId,
          incurredDate: { gte: period.startDate, lte: period.endDate },
          postingStatus: 'posting_error',
        } }),
      ]),
    ]);
    const pendingSources = documentBlockers.pending + accountingPaymentBlockers.pending + expenseBlockers.pending + vendorBillBlockers.pending + supplierPaymentBlockers.pending;
    checks.push({
      checkKey: 'source_postings_complete',
      status: pendingSources === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: pendingSources === 0 ? 'All finalized sources have generated postings' : `${pendingSources} finalized source records still need ledger posting`,
      count: pendingSources,
    });

    const postingErrors = documentBlockers.errors
      + accountingPaymentBlockers.errors
      + expenseBlockers.errors
      + vendorBillBlockers.errors
      + supplierPaymentBlockers.errors
      + reimbursementBlockers.paymentErrors
      + supplementalPostingErrors.reduce((sum, count) => sum + count, 0);
    checks.push({
      checkKey: 'no_source_posting_errors',
      status: postingErrors === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: postingErrors === 0 ? 'No source posting errors remain' : `${postingErrors} source records have posting errors`,
      count: postingErrors,
    });

    const [chartInspection, chartCompany, chartAccounts] = await Promise.all([
      this.chartReadiness.inspect(ctx.companyId),
      db.company.findUnique({
        where: { id: ctx.companyId },
        select: {
          chartOfAccountsTemplateKey: true,
          chartOfAccountsTemplateVersion: true,
          chartOfAccountsTemplateChecksum: true,
          chartOfAccountsTemplateAppliedAt: true,
        },
      }),
      db.chartOfAccount.findMany({
        where: { OR: [{ companyId: ctx.companyId }, { companyId: null, isSystem: true }] },
        select: { id: true, isSystem: true, accountClass: true },
      }),
    ]);
    const chartGoverned = requiresReviewedPostingRules(chartCompany ?? {});
    const systemAccountIds = new Set(
      chartAccounts.filter((account: any) => account.isSystem).map((account: any) => account.id),
    );
    const openChartRemediations = chartGoverned
      ? chartInspection.preview.rows.filter((row) =>
        row.classification === 'UNUSED_CONFLICT'
        && row.existingAccountId
        && systemAccountIds.has(row.existingAccountId)).length
      : 0;
    checks.push({
      checkKey: 'chart_conflict_remediation_clear',
      status: openChartRemediations === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: openChartRemediations === 0
        ? 'No legacy system-account chart remediation remains open'
        : `${openChartRemediations} unused legacy system-account conflicts still require replace-or-review remediation`,
      count: openChartRemediations,
    });

    const invalidChartRows = chartGoverned
      ? chartInspection.preview.rows.filter((row) =>
        row.differingFields.some((field) =>
          ['accountClass', 'normalBalance', 'globalAccount'].includes(field))).length
      : 0;
    checks.push({
      checkKey: 'chart_semantics_valid',
      status: invalidChartRows === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: invalidChartRows === 0
        ? 'Chart account class and normal-balance semantics are valid'
        : `${invalidChartRows} chart rows have invalid class, normal balance, or global shadow semantics`,
      count: invalidChartRows,
    });

    const suspenseAccountIds = new Set(
      chartAccounts.filter((account: any) => account.accountClass === 'SUSPENSE').map((account: any) => account.id),
    );
    const suspensePeriods = await db.accountingPeriod.findMany({
      where: { companyId: ctx.companyId, endDate: { lte: period.endDate } },
      select: { id: true },
    });
    const cumulativeBalances = await this.repo.getAccountBalances(
      ctx.companyId,
      suspensePeriods.map((candidate: any) => candidate.id),
    );
    const suspenseBalances = cumulativeBalances
      .filter((balance) => suspenseAccountIds.has(balance.accountId))
      .map((balance) => new Decimal(balance.totalDebit).minus(balance.totalCredit).abs())
      .filter((balance) => balance.gte('0.0001'));
    const suspenseAmount = suspenseBalances.reduce((sum, balance) => sum.add(balance), new Decimal(0));
    checks.push({
      checkKey: 'suspense_balance_zero',
      status: suspenseBalances.length === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: suspenseBalances.length === 0
        ? 'Suspense accounts have no unresolved balance'
        : `${suspenseBalances.length} suspense accounts retain an unresolved balance`,
      count: suspenseBalances.length,
      amount: suspenseAmount.toFixed(2),
    });

    const readiness = chartInspection.readiness;
    const invalidTaxMappings = readiness.taxConfigurationRequired
      ? readiness.requiredTaxAccountRolesMissing.length + readiness.taxProfilesNeedingReview
      : 0;
    checks.push({
      checkKey: 'tax_account_mapping_valid',
      status: invalidTaxMappings === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: invalidTaxMappings === 0
        ? 'Tax profile and account-role mappings are ready'
        : `${invalidTaxMappings} tax profile or account-role mapping issues remain`,
      count: invalidTaxMappings,
    });

    const [taxEvents, reconciliationRuns, blockingTaxIssues, paidPp36Lines] = await Promise.all([
      db.taxEvent.findMany({ where: { companyId: ctx.companyId, periodKey: period.periodKey, status: 'ACTIVE', componentKey: { not: null } },
        select: { componentKey: true, branchId: true, updatedAt: true } }),
      db.taxReconciliationRun.findMany({ where: { companyId: ctx.companyId, periodKey: period.periodKey },
        select: { formType: true, branchId: true, status: true, blockingIssueCount: true, createdAt: true } }),
      db.taxReviewIssue.count({ where: { companyId: ctx.companyId, status: 'OPEN', severity: 'BLOCKING',
        taxPeriod: { periodKey: period.periodKey } } }),
      // A paid PP36 source is itself enough to require reconciliation, even if
      // tax-event sync or journal generation has not run yet.
      db.vendorBillLine.findMany({ where: {
        companyId: ctx.companyId, taxContextSnapshot: 'IMPORT_SERVICE', taxComponentsJson: { not: null },
        vendorBill: { status: 'PAID' },
      }, select: { taxComponentsJson: true, updatedAt: true, vendorBill: { select: { branchId: true } } } }),
    ]);
    const pp36SourceFacts = (paidPp36Lines as any[]).flatMap((line) => (Array.isArray(line.taxComponentsJson) ? line.taxComponentsJson : [])
      .filter((component: any) => ['PP36_OUTPUT', 'PP36_INPUT'].includes(component.componentKey)
        && !(component.componentKey === 'PP36_INPUT' && component.snapshot?.claimability === 'PENDING_EVIDENCE')
        && component.snapshot?.recognitionDate?.slice(0, 7) === period.periodKey)
      .map((component: any) => ({ componentKey: component.componentKey, branchId: line.vendorBill.branchId ?? null, updatedAt: line.updatedAt })));
    const reconciliationIssues = transactionTaxCloseIssueCount([...(taxEvents as any[]), ...pp36SourceFacts], reconciliationRuns as any[]);
    checks.push({
      checkKey: 'transaction_tax_reconciliation_clear',
      status: reconciliationIssues + blockingTaxIssues === 0 ? 'PASSED' : 'FAILED', severity: 'ERROR',
      message: reconciliationIssues + blockingTaxIssues === 0
        ? 'Required transaction-tax reconciliations are current and reviewed'
        : `${reconciliationIssues + blockingTaxIssues} missing, stale, unreviewed, or blocking tax reconciliations/issues remain`,
      count: reconciliationIssues + blockingTaxIssues,
    });

    // Claim money must be on the books — approved claim expenses are
    // confirmed (accrual can post) and settlement payments have posted.
    const reimbursementPending = reimbursementBlockers.unconfirmedClaimExpenses + reimbursementBlockers.pendingPayments + reimbursementBlockers.paymentErrors;
    checks.push({
      checkKey: 'reimbursement_postings_complete',
      status: reimbursementPending === 0 ? 'PASSED' : 'FAILED',
      severity: 'ERROR',
      message: reimbursementPending === 0
        ? 'ค่าใช้จ่ายและการจ่ายเงินจากใบเบิกลงบัญชีครบแล้ว'
        : `มีค่าใช้จ่ายจากใบเบิกยังไม่ยืนยัน ${reimbursementBlockers.unconfirmedClaimExpenses} รายการ และการจ่ายเงินเบิกยังไม่ลงบัญชี ${reimbursementBlockers.pendingPayments} รายการ (ลงบัญชีผิดพลาด ${reimbursementBlockers.paymentErrors} รายการ) กรุณาดำเนินการก่อนปิดงวด`,
      count: reimbursementPending,
    });

    const allPassed = checks.every((c) => c.status === 'PASSED');
    const runId = await this.repo.createCloseRun(ctx.companyId, periodId, ctx.userId);
    await this.repo.updateCloseRun(runId, allPassed ? 'PASSED' : 'FAILED', checks as unknown[]);

    return {
      id: runId, periodId, status: allPassed ? 'PASSED' : 'FAILED',
      checks, requestedByUserId: ctx.userId,
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    };
  }
}

@Injectable()
export class ClosePeriodUseCase {
  constructor(
    private readonly repo: PrismaLedgerRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly closeChecks: RunPeriodCloseChecksUseCase,
  ) {}

  async execute(ctx: RequestContext, periodId: string, note?: string): Promise<AccountingPeriodSummary> {
    requirePerm(ctx, 'ledger.period.close');
    const period = await this.repo.findPeriodById(ctx.companyId, periodId);
    if (!period || period.companyId !== ctx.companyId) throw new NotFoundException('Period not found');
    if (period.status === 'CLOSED') throw new BadRequestException('งวดบัญชีถูกปิดแล้ว');

    const checkRun = await this.closeChecks.execute(ctx, periodId);
    const failed = checkRun.checks.filter((check) => check.status === 'FAILED' && check.severity === 'ERROR');
    if (failed.length > 0) throw new BadRequestException({ code: 'close_check_failed', checks: failed });

    const closed = await this.repo.closePeriod(periodId, ctx.userId, note);

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.period.close', targetType: 'accounting_period', targetId: periodId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { periodKey: period.periodKey, note } });
    void this.outbox.append('period.closed', 'accounting_period', periodId, { companyId: ctx.companyId, aggregateType: 'accounting_period', aggregateId: periodId, occurredAt: new Date().toISOString(), data: { periodKey: period.periodKey } });
    return toSummary(closed);
  }
}

@Injectable()
export class UnclosePeriodUseCase {
  constructor(private readonly repo: PrismaLedgerRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService, private readonly prisma: PrismaService) {}

  async execute(ctx: RequestContext, periodId: string, note: string): Promise<AccountingPeriodSummary> {
    requirePerm(ctx, 'ledger.period.unclose');
    if (!note?.trim()) throw new BadRequestException('หมายเหตุการเปิดงวดคืนจำเป็น');
    const period = await this.repo.findPeriodById(ctx.companyId, periodId);
    if (!period || period.companyId !== ctx.companyId) throw new NotFoundException('Period not found');
    if (period.status !== 'CLOSED') throw new BadRequestException('งวดบัญชียังไม่ถูกปิด');
    const lockedTaxPeriods = await (this.prisma.client as any).taxPeriod.count({ where: {
      companyId: ctx.companyId, periodKey: period.periodKey, status: { in: ['FILED', 'PAID', 'CLOSED'] },
    } });
    if (lockedTaxPeriods > 0) throw new BadRequestException({ code: 'tax_period_filed', message: 'Tax period has been filed/paid/closed; use an amendment workflow before reopening the accounting period' });

    const reopened = await this.repo.reopenPeriod(periodId, ctx.userId, note);

    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'ledger.period.unclose', targetType: 'accounting_period', targetId: periodId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { periodKey: period.periodKey, note } });
    void this.outbox.append('period.reopened', 'accounting_period', periodId, { companyId: ctx.companyId, aggregateType: 'accounting_period', aggregateId: periodId, occurredAt: new Date().toISOString(), data: { periodKey: period.periodKey, note } });
    return toSummary(reopened);
  }
}
