import { EXPENSE_CORRECTION_WORDS } from '@watchdog-bms/contracts';
import { lockExpenseCorrection } from '../../../expenses/infrastructure/expense-void-blocker';
import { ConflictException, BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { TaxEventRecord, UpsertTaxEventInput } from '../../domain/ports/tax-event.repository.port';
import type { TaxPeriodRecord, CreateTaxPeriodInput } from '../../domain/ports/tax-period.repository.port';
import type { TaxReviewIssueRecord, CreateReviewIssueInput } from '../../domain/ports/tax-review-issue.repository.port';
import type { TaxEventStatus, TaxEventType, TaxFormType, TaxPeriodStatus, TaxType, ReviewIssueSeverity, ReviewIssueStatus } from '@watchdog-bms/contracts';
import { findAttachmentLinkConflict } from '../../../data-model-core/domain/logic/attachment.logic';

function toStr(v: unknown): string { return String(v ?? '0'); }

@Injectable()
export class PrismaTaxRepository {
  constructor(readonly prisma: PrismaService) {}

  // ─── Tax Period ─────────────────────────────────────────────────────────────

  async findPeriod(companyId: string, formType: TaxFormType, periodKey: string): Promise<TaxPeriodRecord | null> {
    const row = await this.prisma.client.taxPeriod.findUnique({
      where: { companyId_formType_periodKey: { companyId, formType, periodKey } },
    });
    return row ? this.toPeriodRecord(row) : null;
  }

  async findPeriodById(companyId: string, id: string): Promise<TaxPeriodRecord | null> {
    const row = await this.prisma.client.taxPeriod.findFirst({ where: { id, companyId } });
    return row ? this.toPeriodRecord(row) : null;
  }

  async findPeriods(companyId: string, filters?: { taxType?: TaxType; formType?: string; status?: TaxPeriodStatus; periodKey?: string; page?: number; pageSize?: number }): Promise<{ items: TaxPeriodRecord[]; total: number }> {
    const page = filters?.page ?? 1;
    const pageSize = filters?.pageSize ?? 20;
    const where: Record<string, unknown> = { companyId };
    if (filters?.taxType) where['taxType'] = filters.taxType;
    if (filters?.formType) where['formType'] = filters.formType;
    if (filters?.status) where['status'] = filters.status;
    if (filters?.periodKey) where['periodKey'] = filters.periodKey;
    const [items, total] = await Promise.all([
      this.prisma.client.taxPeriod.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { periodKey: 'desc' } }),
      this.prisma.client.taxPeriod.count({ where }),
    ]);
    return { items: items.map(r => this.toPeriodRecord(r)), total };
  }

  async upsertPeriod(input: CreateTaxPeriodInput): Promise<TaxPeriodRecord> {
    const row = await this.prisma.client.taxPeriod.upsert({
      where: { companyId_formType_periodKey: { companyId: input.companyId, formType: input.formType, periodKey: input.periodKey } },
      update: { dueDate: input.dueDate ?? undefined },
      create: {
        companyId: input.companyId,
        taxType: input.taxType as any,
        formType: input.formType as any,
        periodKey: input.periodKey,
        status: (input.status ?? 'OPEN') as any,
        dueDate: input.dueDate ?? null,
      },
    });
    return this.toPeriodRecord(row);
  }

  async updatePeriodStatus(companyId: string, id: string, status: TaxPeriodStatus, meta?: { filedAt?: Date; paidAt?: Date; closedAt?: Date; reviewNote?: string }): Promise<TaxPeriodRecord> {
    const current = await this.prisma.client.taxPeriod.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!current) throw new Error('tax_period_not_found');
    const row = await this.prisma.client.taxPeriod.update({
      where: { id },
      data: { status: status as any, filedAt: meta?.filedAt, paidAt: meta?.paidAt, closedAt: meta?.closedAt, reviewNote: meta?.reviewNote },
    });
    return this.toPeriodRecord(row);
  }

  private toPeriodRecord(row: any): TaxPeriodRecord {
    return {
      id: row.id, companyId: row.companyId, taxType: row.taxType as TaxType, formType: row.formType as TaxFormType,
      periodKey: row.periodKey, status: row.status as TaxPeriodStatus, dueDate: row.dueDate ?? null,
      filedAt: row.filedAt ?? null, paidAt: row.paidAt ?? null, reviewNote: row.reviewNote ?? null,
      closedAt: row.closedAt ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ─── Tax Event ──────────────────────────────────────────────────────────────

  async findEventByIdempotencyKey(key: string): Promise<TaxEventRecord | null> {
    const row = await this.prisma.client.taxEvent.findUnique({ where: { idempotencyKey: key } });
    return row ? this.toEventRecord(row) : null;
  }

  async findActiveEventBySourceComponent(companyId: string, sourceType: string, sourceId: string, sourceLineKey: string, componentKey: string | null, eventType: string): Promise<TaxEventRecord | null> {
    const row = await (this.prisma.client as any).taxEvent.findFirst({ where: {
      companyId, sourceType, sourceId, sourceLineKey, componentKey, eventType, status: 'ACTIVE',
    }, orderBy: { createdAt: 'desc' } });
    return row ? this.toEventRecord(row) : null;
  }

  async findEventsByPeriod(companyId: string, taxPeriodId: string, status?: TaxEventStatus): Promise<TaxEventRecord[]> {
    const where: Record<string, unknown> = { companyId, taxPeriodId };
    if (status) where['status'] = status;
    const rows = await this.prisma.client.taxEvent.findMany({ where, orderBy: { eventDate: 'asc' } });
    return rows.map(r => this.toEventRecord(r));
  }

  async upsertEvent(input: UpsertTaxEventInput, db: any = this.prisma.client): Promise<TaxEventRecord> {
    if (input.sourceType === 'expense.record') {
      if (db === this.prisma.client) return this.prisma.client.$transaction(tx => this.upsertEvent(input, tx), { isolationLevel: 'ReadCommitted' });
      await lockExpenseCorrection(db, input.companyId, input.sourceId);
      const current = await db.expenseRecord.findFirst({ where: { companyId: input.companyId, id: input.sourceId } });
      if (!current || current.status !== 'CONFIRMED' || (input.expectedExpenseConfirmedAt !== undefined && (current.confirmedAt?.getTime() ?? null) !== (input.expectedExpenseConfirmedAt?.getTime() ?? null))) {
        throw new ConflictException({ code: 'expense_tax_source_changed', message: EXPENSE_CORRECTION_WORDS.sourceChanged });
      }
    }
    const data = {
      companyId: input.companyId, taxPeriodId: input.taxPeriodId, idempotencyKey: input.idempotencyKey,
      eventType: input.eventType as any, status: (input.status ?? 'ACTIVE') as any,
      sourceType: input.sourceType, sourceId: input.sourceId, branchId: input.branchId ?? null,
      sourceLineId: input.sourceLineId ?? null, sourceLineKey: input.sourceLineKey ?? '__HEADER__', componentKey: input.componentKey as any ?? null,
      sourceEventType: input.sourceEventType ?? null,
      sourceHash: input.sourceHash ?? null, periodKey: input.periodKey, eventDate: input.eventDate,
      taxableBase: input.taxableBase, taxAmount: input.taxAmount, currency: input.currency,
      vatMode: input.vatMode ?? null, outputTaxCode: input.outputTaxCode as any ?? null,
      whtFormType: input.whtFormType as any ?? null,
      payeeSnapshotJson: input.payeeSnapshot as any ?? null, incomeCategoryCode: input.incomeCategoryCode ?? null,
      whtRate: input.whtRate ?? null, grossAmount: input.grossAmount ?? null,
      withheldAmount: input.withheldAmount ?? null, netPaidAmount: input.netPaidAmount ?? null,
      taxInvoiceNumber: input.taxInvoiceNumber ?? null, reviewNote: input.reviewNote ?? null,
      taxCodeDefinitionId: input.taxSnapshot?.taxCodeDefinitionId ?? null,
      externalTaxCodeSnapshot: input.taxSnapshot?.externalTaxCode ?? null,
      taxProfileKeySnapshot: input.taxSnapshot?.taxProfileKey ?? null,
      taxProfileVersionSnapshot: input.taxSnapshot?.taxProfileVersion ?? null,
      roundingModeSnapshot: input.taxSnapshot?.roundingMode ?? null,
      roundingScaleSnapshot: input.taxSnapshot?.roundingScale ?? null,
      taxAmountToleranceSnapshot: input.taxSnapshot?.taxAmountTolerance ?? null,
      taxRegimeSnapshot: input.taxSnapshot?.taxRegime as any ?? null,
      taxDirectionSnapshot: input.taxSnapshot?.taxDirection as any ?? null,
      taxTreatmentSnapshot: input.taxSnapshot?.taxTreatment as any ?? null,
      taxContextSnapshot: input.taxSnapshot?.taxContext as any ?? null,
      taxRateSnapshot: input.taxSnapshot?.taxRate ?? null,
      sourceCurrencySnapshot: input.taxSnapshot?.sourceCurrency ?? null,
      taxCurrencySnapshot: input.taxSnapshot?.taxCurrency ?? null,
      exchangeRateSnapshot: input.taxSnapshot?.exchangeRate ?? null,
      exchangeRateSourceSnapshot: input.taxSnapshot?.exchangeRateSource ?? null,
      exchangeRateDateSnapshot: input.taxSnapshot?.exchangeRateDate ? new Date(input.taxSnapshot.exchangeRateDate) : null,
      claimabilitySnapshot: input.taxSnapshot?.claimability as any ?? null,
      accountRuleVersionSnapshot: input.taxSnapshot?.accountRuleVersion ?? null,
      reportRuleVersionSnapshot: input.taxSnapshot?.reportRuleVersion ?? null,
      taxEvidenceReviewStatus: input.taxSnapshot?.evidenceStatus as any ?? null,
      reportContributionsJson: input.reportContributions as any ?? null,
      accountAssignmentsJson: input.accountAssignments as any ?? null,
    };
    const row = await db.taxEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: data,
      create: data,
    });
    return this.toEventRecord(row);
  }

  async supersedeEvent(id: string): Promise<void> {
    await this.prisma.client.taxEvent.update({ where: { id }, data: { status: 'SUPERSEDED' as any } });
  }

  private toEventRecord(row: any): TaxEventRecord {
    return {
      id: row.id, companyId: row.companyId, taxPeriodId: row.taxPeriodId, idempotencyKey: row.idempotencyKey,
      eventType: row.eventType as TaxEventType, status: row.status as TaxEventStatus,
      sourceType: row.sourceType, sourceId: row.sourceId, sourceEventType: row.sourceEventType ?? null,
      branchId: row.branchId ?? null, sourceLineId: row.sourceLineId ?? null, sourceLineKey: row.sourceLineKey ?? '__HEADER__',
      componentKey: row.componentKey ?? null,
      taxSnapshot: row.taxCodeDefinitionId || row.externalTaxCodeSnapshot ? {
        taxCodeDefinitionId: row.taxCodeDefinitionId ?? null, externalTaxCode: row.externalTaxCodeSnapshot ?? null,
        taxProfileKey: row.taxProfileKeySnapshot ?? null, taxProfileVersion: row.taxProfileVersionSnapshot ?? null,
        roundingMode: row.roundingModeSnapshot ?? 'HALF_UP', roundingScale: row.roundingScaleSnapshot ?? 2,
        taxAmountTolerance: toStr(row.taxAmountToleranceSnapshot ?? '0.01'),
        taxRegime: row.taxRegimeSnapshot ?? null, taxDirection: row.taxDirectionSnapshot ?? null,
        taxTreatment: row.taxTreatmentSnapshot ?? null, taxContext: row.taxContextSnapshot ?? null,
        taxRate: toStr(row.taxRateSnapshot), sourceCurrency: row.sourceCurrencySnapshot ?? row.currency,
        taxCurrency: row.taxCurrencySnapshot ?? row.currency,
        exchangeRate: toStr(row.exchangeRateSnapshot ?? (row.sourceCurrencySnapshot === row.taxCurrencySnapshot || !row.sourceCurrencySnapshot ? 1 : 0)),
        exchangeRateSource: row.exchangeRateSourceSnapshot ?? (!row.sourceCurrencySnapshot || row.sourceCurrencySnapshot === row.taxCurrencySnapshot ? 'FUNCTIONAL_CURRENCY' : ''),
        exchangeRateDate: row.exchangeRateDateSnapshot?.toISOString?.().slice(0, 10) ?? '',
        taxBaseAmount: toStr(row.taxableBase), taxAmount: toStr(row.taxAmount),
        claimability: row.claimabilitySnapshot ?? 'NOT_APPLICABLE', evidenceStatus: row.taxEvidenceReviewStatus ?? 'REVIEW_REQUIRED',
        accountRuleVersion: row.accountRuleVersionSnapshot ?? null, reportRuleVersion: row.reportRuleVersionSnapshot ?? null,
        recognitionDate: row.eventDate?.toISOString?.() ?? null, evidenceRefs: [],
      } : null,
      reportContributions: Array.isArray(row.reportContributionsJson) ? row.reportContributionsJson : [],
      accountAssignments: Array.isArray(row.accountAssignmentsJson) ? row.accountAssignmentsJson : [],
      sourceHash: row.sourceHash ?? null, periodKey: row.periodKey, eventDate: row.eventDate,
      taxableBase: toStr(row.taxableBase), taxAmount: toStr(row.taxAmount), currency: row.currency,
      vatMode: row.vatMode ?? null, outputTaxCode: row.outputTaxCode ?? null,
      whtFormType: row.whtFormType as TaxFormType ?? null,
      payeeSnapshot: row.payeeSnapshotJson as any ?? null, incomeCategoryCode: row.incomeCategoryCode ?? null,
      whtRate: row.whtRate ? toStr(row.whtRate) : null, grossAmount: row.grossAmount ? toStr(row.grossAmount) : null,
      withheldAmount: row.withheldAmount ? toStr(row.withheldAmount) : null,
      netPaidAmount: row.netPaidAmount ? toStr(row.netPaidAmount) : null,
      taxInvoiceNumber: row.taxInvoiceNumber ?? null, reviewNote: row.reviewNote ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ─── Tax Review Issue ────────────────────────────────────────────────────────

  async createIssue(input: CreateReviewIssueInput): Promise<TaxReviewIssueRecord> {
    // Sync passes re-flag the same condition every run; one OPEN issue per
    // (period, code, source) is enough. Resolved/ignored issues may recur.
    // ponytail: check-then-create can race concurrent syncs; add a partial unique index if that ever matters.
    const existing = await this.prisma.client.taxReviewIssue.findFirst({
      where: {
        companyId: input.companyId, taxPeriodId: input.taxPeriodId, issueCode: input.issueCode,
        sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null, status: 'OPEN' as any,
      },
    });
    if (existing) return this.toIssueRecord(existing);
    const row = await this.prisma.client.taxReviewIssue.create({
      data: {
        companyId: input.companyId, taxPeriodId: input.taxPeriodId, taxEventId: input.taxEventId ?? null,
        severity: input.severity as any, status: 'OPEN' as any, issueCode: input.issueCode,
        description: input.description, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
      },
    });
    return this.toIssueRecord(row);
  }

  async findIssuesByPeriod(companyId: string, taxPeriodId: string, filters?: { status?: ReviewIssueStatus; severity?: ReviewIssueSeverity }): Promise<TaxReviewIssueRecord[]> {
    const where: Record<string, unknown> = { companyId, taxPeriodId };
    if (filters?.status) where['status'] = filters.status;
    if (filters?.severity) where['severity'] = filters.severity;
    const rows = await this.prisma.client.taxReviewIssue.findMany({ where, orderBy: { createdAt: 'asc' } });
    return rows.map(r => this.toIssueRecord(r));
  }

  async resolveIssue(companyId: string, id: string, note: string, resolvedByUserId: string): Promise<TaxReviewIssueRecord> {
    const current = await this.prisma.client.taxReviewIssue.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!current) throw new Error('tax_review_issue_not_found');
    const row = await this.prisma.client.taxReviewIssue.update({
      where: { id },
      data: { status: 'RESOLVED' as any, resolvedNote: note, resolvedByUserId, resolvedAt: new Date() },
    });
    return this.toIssueRecord(row);
  }

  private toIssueRecord(row: any): TaxReviewIssueRecord {
    return {
      id: row.id, companyId: row.companyId, taxPeriodId: row.taxPeriodId, taxEventId: row.taxEventId ?? null,
      severity: row.severity as ReviewIssueSeverity, status: row.status as ReviewIssueStatus,
      issueCode: row.issueCode, description: row.description,
      sourceType: row.sourceType ?? null, sourceId: row.sourceId ?? null,
      resolvedAt: row.resolvedAt ?? null, resolvedNote: row.resolvedNote ?? null,
      resolvedByUserId: row.resolvedByUserId ?? null, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // ─── Company tax signature (WHT certificate system issuance plan §3.2) ──────
  // Fifth copy of the `linkAttachmentToTarget`-shaped method every module that links attachments
  // already carries its own of (expenses/procurement/reimbursements/crm-inbox) — repo convention is
  // a small per-module copy, not a shared cross-module service.
  async linkAttachmentToTarget(attachmentId: string, targetType: string, targetId: string, purpose: string, companyId: string, actorUserId: string): Promise<void> {
    const conflict = await findAttachmentLinkConflict(this.prisma.client, { companyId, attachmentId, targetType });
    if (conflict) throw new BadRequestException(conflict);
    await this.prisma.client.attachmentLink.create({ data: { attachmentId, targetType, targetId, purpose, companyId, linkedByUserId: actorUserId } });
  }
}
