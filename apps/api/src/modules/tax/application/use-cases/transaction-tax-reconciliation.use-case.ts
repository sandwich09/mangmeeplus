import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { Pp30BoxesDto, RequestContext, TaxReportContribution, TaxReportForm, TransactionTaxComponentPreview } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { aggregatePp30Boxes, aggregateTaxRoundingPolicy } from '../../domain/logic/transaction-tax.logic';
import {
  primaryTaxReportAmount,
  reconcileTaxFact,
  reconciliationFactKey,
  taxComponentInForm,
  unionReconciliationFacts,
  type TaxReconciliationFactIdentity,
} from '../../domain/logic/tax-reconciliation.logic';
import { PrismaTransactionTaxRepository } from '../../infrastructure/repositories/prisma-transaction-tax.repository';

const s = (value: unknown) => String(value ?? '0');

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

function scopedBranch(ctx: RequestContext, branchId?: string): string | undefined {
  const allowed = ctx.scopes.branchIds;
  if (branchId && allowed && !allowed.includes(branchId)) throw new ForbiddenException('Branch is outside the granted scope');
  if (!branchId && allowed) {
    if (allowed.length !== 1) throw new ForbiddenException('A branchId is required for a branch-scoped reconciliation');
    return allowed[0];
  }
  return branchId;
}

type SourceFact = TaxReconciliationFactIdentity & { branchId: string | null; sourceLineId: string; component: any };
type JournalFact = TaxReconciliationFactIdentity & { branchId: string | null; lines: any[] };

function components(line: any): any[] {
  return Array.isArray(line?.taxComponentsJson) ? line.taxComponentsJson : [];
}

function componentInReconciliation(component: any, formType: TaxReportForm): boolean {
  return taxComponentInForm(component.componentKey, formType)
    && !(component.componentKey === 'PP36_INPUT' && component.snapshot?.claimability === 'PENDING_EVIDENCE');
}

function periodRange(periodKey: string): { gte: Date; lt: Date } {
  if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new BadRequestException('periodKey must be YYYY-MM');
  const [year, month] = periodKey.split('-').map(Number);
  if (!year || !month || month > 12) throw new BadRequestException('periodKey must be YYYY-MM');
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) };
}

@Injectable()
export class TransactionTaxReconciliationUseCase {
  constructor(
    private readonly repo: PrismaTransactionTaxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  private get db(): any { return this.repo.prisma.client as any; }

  private async assertCompanyBranch(companyId: string, branchId?: string): Promise<void> {
    if (branchId && !(await this.db.branch.findFirst({ where: { id: branchId, companyId }, select: { id: true } }))) {
      throw new ForbiddenException('Branch is outside the company');
    }
  }

  private async sourceFacts(companyId: string, branchId: string | undefined, formType: TaxReportForm, range: { gte: Date; lt: Date }): Promise<SourceFact[]> {
    const [accounting, expenses, vendorBills, claimReleases, paymentAllocations] = await Promise.all([
      this.db.accountingDocumentLine.findMany({ where: { companyId, taxComponentsJson: { not: null }, document: { branchId, documentDate: range, status: { in: ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'] } } }, include: { document: { select: { id: true, branchId: true } } } }),
      this.db.expenseLine.findMany({ where: { companyId, taxComponentsJson: { not: null }, expense: { branchId, expenseDate: range, status: 'CONFIRMED' } }, include: { expense: { select: { id: true, branchId: true } } } }),
      this.db.vendorBillLine.findMany({ where: {
        companyId, taxComponentsJson: { not: null }, vendorBill: { branchId, status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID', 'CREDITED'] } },
        OR: [{ taxContextSnapshot: 'IMPORT_SERVICE' }, { vendorBill: { billDate: range } }],
      }, include: { vendorBill: { select: { id: true, branchId: true, billDate: true } } } }),
      this.db.taxAdjustment.findMany({ where: {
        companyId, adjustmentType: 'CORRECTION', taxPeriod: { formType: 'PP30', periodKey: `${range.gte.getUTCFullYear()}-${String(range.gte.getUTCMonth() + 1).padStart(2, '0')}` },
      }, select: { id: true, metadataJson: true } }),
      formType === 'PP36' ? this.db.supplierPaymentAllocation.findMany({ where: {
        companyId, pp36RecognitionStatus: 'ACTIVE', supplierPayment: { branchId, paymentDate: range },
      }, include: { supplierPayment: { select: { id: true, branchId: true } } } }) : Promise.resolve([]),
    ]);
    const expand = (rows: any[], sourceType: string, parent: string): SourceFact[] => rows.flatMap((line) => components(line)
      .filter((component) => componentInReconciliation(component, formType))
      .map((component) => ({
        sourceType, sourceId: line[parent].id, sourceLineId: line.id, sourceLineKey: line.id,
        branchId: line[parent].branchId ?? null, componentKey: component.componentKey, component,
      })));
    const inRange = (value: unknown) => {
      if (!value) return false;
      const date = new Date(String(value));
      return !Number.isNaN(date.getTime()) && date >= range.gte && date < range.lt;
    };
    const vendorBillFacts: SourceFact[] = vendorBills.flatMap((line: any) => components(line)
      .filter((component) => componentInReconciliation(component, formType))
      .filter((component) => ['PP36_OUTPUT', 'PP36_INPUT'].includes(component.componentKey)
        ? inRange(component.snapshot?.recognitionDate)
        : inRange(line.vendorBill.billDate))
      .map((component) => ({
        sourceType: 'procurement.vendor_bill', sourceId: line.vendorBill.id, sourceLineId: line.id, sourceLineKey: line.id,
        branchId: line.vendorBill.branchId ?? null, componentKey: component.componentKey, component,
      })));
    const claimReleaseFacts: SourceFact[] = claimReleases.flatMap((adjustment: any) => {
      const data = adjustment.metadataJson;
      if (data?.kind !== 'PP36_INPUT_CLAIM_RELEASE' || data.component?.componentKey !== 'PP36_INPUT'
        || !componentInReconciliation(data.component, formType) || (branchId && data.branchId !== branchId)
        || !inRange(data.claimDate)) return [];
      return [{ sourceType: 'tax.pp36_input_claim', sourceId: adjustment.id, sourceLineId: adjustment.id, sourceLineKey: adjustment.id,
        branchId: data.branchId ?? null, componentKey: 'PP36_INPUT' as const, component: data.component }];
    });
    const paymentFacts: SourceFact[] = paymentAllocations.flatMap((allocation: any) => (Array.isArray(allocation.pp36RecognitionJson) ? allocation.pp36RecognitionJson : [])
      .flatMap((recognition: any) => {
        const component = recognition.preview?.components?.find((entry: any) => entry.componentKey === 'PP36_OUTPUT');
        return component ? [{
          sourceType: 'procurement.supplier_payment.pp36', sourceId: allocation.supplierPayment.id,
          sourceLineId: recognition.vendorBillLineId, sourceLineKey: recognition.recognitionKey,
          branchId: allocation.supplierPayment.branchId ?? null, componentKey: 'PP36_OUTPUT' as const, component,
        }] : [];
      }));
    return [
      ...expand(accounting, 'accounting.document', 'document'),
      ...expand(expenses, 'expense.record', 'expense'),
      ...vendorBillFacts,
      ...claimReleaseFacts,
      ...paymentFacts,
    ];
  }

  private async journalFacts(companyId: string, branchId: string | undefined, formType: TaxReportForm, range: { gte: Date; lt: Date }): Promise<JournalFact[]> {
    const lines = await this.db.journalLine.findMany({ where: {
      companyId, branchId, componentKey: { not: null }, journalEntry: { status: 'POSTED', entryDate: range },
    }, include: { journalEntry: { select: { id: true, sourceType: true, sourceId: true } } } });
    const grouped = new Map<string, JournalFact>();
    for (const line of lines) {
      if (!line.journalEntry.sourceType || !line.journalEntry.sourceId || !taxComponentInForm(line.componentKey, formType)) continue;
      if (line.componentKey === 'PP36_INPUT' && line.claimabilitySnapshot === 'PENDING_EVIDENCE') continue;
      const identity: TaxReconciliationFactIdentity = {
        sourceType: line.journalEntry.sourceType,
        sourceId: line.journalEntry.sourceId,
        sourceLineKey: line.sourceId && line.sourceId !== line.journalEntry.sourceId ? line.sourceId : '__HEADER__',
        componentKey: line.componentKey,
      };
      const key = reconciliationFactKey(identity);
      const current: JournalFact = grouped.get(key) ?? { ...identity, branchId: line.branchId ?? null, lines: [] as any[] };
      current.lines.push(line);
      grouped.set(key, current);
    }
    return [...grouped.values()];
  }

  async generate(ctx: RequestContext, input: { formType: TaxReportForm; periodKey: string; branchId?: string }) {
    requirePermission(ctx, 'tax.report.recompute');
    const branchId = scopedBranch(ctx, input.branchId);
    await this.assertCompanyBranch(ctx.companyId, branchId);
    const range = periodRange(input.periodKey);
    const company = await this.db.company.findUnique({ where: { id: ctx.companyId }, select: { baseCurrency: true } });
    if (!company) throw new NotFoundException('Company not found');
    const baseCurrency = String(company.baseCurrency).toUpperCase();
    const events = await this.db.taxEvent.findMany({ where: {
      companyId: ctx.companyId, branchId, periodKey: input.periodKey, status: 'ACTIVE',
    }, orderBy: [{ sourceType: 'asc' }, { sourceId: 'asc' }, { sourceLineKey: 'asc' }, { componentKey: 'asc' }] });
    const filteredEvents = events.filter((event: any) => taxComponentInForm(event.componentKey ?? 'VAT', input.formType));
    const [sourceFacts, journalFacts] = await Promise.all([
      this.sourceFacts(ctx.companyId, branchId, input.formType, range),
      this.journalFacts(ctx.companyId, branchId, input.formType, range),
    ]);
    const sources = new Map(sourceFacts.map((fact) => [reconciliationFactKey(fact), fact]));
    const eventMap = new Map<string, any>(filteredEvents.map((event: any) => [reconciliationFactKey({
      sourceType: event.sourceType, sourceId: event.sourceId, sourceLineKey: event.sourceLineKey ?? '__HEADER__', componentKey: event.componentKey ?? 'VAT',
    }), event]));
    const journals = new Map(journalFacts.map((fact) => [reconciliationFactKey(fact), fact]));
    const identities = unionReconciliationFacts(sourceFacts, filteredEvents.map((event: any) => ({
      sourceType: event.sourceType, sourceId: event.sourceId, sourceLineKey: event.sourceLineKey ?? '__HEADER__', componentKey: event.componentKey ?? 'VAT',
    })), journalFacts);
    const facts: any[] = [];
    for (const identity of identities) {
      const key = reconciliationFactKey(identity);
      const source = sources.get(key);
      const event = eventMap.get(key);
      const journal = journals.get(key);
      const componentKey = identity.componentKey;
      const sourceComponent = source?.component;
      const sourceSnapshot = sourceComponent?.snapshot ?? null;
      const sourceBaseAmount = sourceSnapshot?.taxBaseAmount ?? 0;
      const sourceTaxAmount = sourceSnapshot?.taxAmount ?? 0;
      const journalLines = journal?.lines ?? [];
      const debit = journalLines.reduce((total: Decimal, line: any) => total.add(line.debitAmount), new Decimal(0));
      const credit = journalLines.reduce((total: Decimal, line: any) => total.add(line.creditAmount), new Decimal(0));
      const eventTaxAmount = s(event?.taxAmount);
      const taxSign = new Decimal(eventTaxAmount).isZero() ? new Decimal(s(sourceTaxAmount)).isNegative() ? -1 : 1 : new Decimal(eventTaxAmount).isNegative() ? -1 : 1;
      const journalTaxAmount = Decimal.max(debit.abs(), credit.abs()).mul(taxSign).toFixed(4);
      const allContributions: TaxReportContribution[] = Array.isArray(event?.reportContributionsJson) ? event.reportContributionsJson : [];
      const contributions = allContributions.filter((entry) => entry.formType === input.formType);
      const configuredContributions: TaxReportContribution[] = (Array.isArray(sourceComponent?.reportContributions) ? sourceComponent.reportContributions : allContributions)
        .filter((entry: TaxReportContribution) => entry.formType === input.formType);
      const accountAssignments = Array.isArray(sourceComponent?.accountAssignments) ? sourceComponent.accountAssignments : Array.isArray(event?.accountAssignmentsJson) ? event.accountAssignmentsJson : [];
      const reportAmount = primaryTaxReportAmount(contributions, eventTaxAmount);
      let result = reconcileTaxFact({
        componentKey, externalTaxCode: sourceSnapshot?.externalTaxCode ?? event?.externalTaxCodeSnapshot ?? event?.outputTaxCode ?? journalLines[0]?.externalTaxCodeSnapshot ?? null,
        evidenceStatus: sourceSnapshot?.evidenceStatus ?? event?.taxEvidenceReviewStatus ?? journalLines[0]?.taxEvidenceReviewStatus ?? null,
        accountAssignmentsPresent: accountAssignments.length > 0 || new Decimal(sourceTaxAmount).isZero(),
        reportMappingPresent: configuredContributions.length > 0,
        sourceBaseAmount: s(sourceBaseAmount), sourceTaxAmount: s(sourceTaxAmount),
        eventBaseAmount: s(event?.taxableBase), eventTaxAmount, journalTaxAmount, reportAmount,
        taxAmountTolerance: sourceSnapshot?.taxAmountTolerance
          ?? event?.taxAmountToleranceSnapshot?.toString?.()
          ?? journalLines[0]?.taxAmountToleranceSnapshot?.toString?.()
          ?? '0.01',
      });
      const sourceCurrency = sourceSnapshot?.sourceCurrency?.toUpperCase?.() ?? null;
      const taxCurrency = sourceSnapshot?.taxCurrency?.toUpperCase?.() ?? event?.currency?.toUpperCase?.() ?? journalLines[0]?.currency?.toUpperCase?.() ?? null;
      const factCurrencies = new Set([taxCurrency, event?.currency?.toUpperCase?.(), ...journalLines.map((line: any) => line.currency?.toUpperCase?.())].filter(Boolean));
      if (!sourceCurrency || taxCurrency !== baseCurrency || factCurrencies.size !== 1) {
        result = { issueCode: 'CURRENCY_MISMATCH', blocking: true, sourceEventDelta: result.sourceEventDelta, eventJournalDelta: result.eventJournalDelta, eventReportDelta: result.eventReportDelta };
      }
      facts.push({
        companyId: ctx.companyId, branchId: source?.branchId ?? event?.branchId ?? journal?.branchId ?? null, ...identity,
        sourceLineId: source?.sourceLineId ?? event?.sourceLineId ?? null,
        taxEventId: event?.id ?? null, journalEntryId: journalLines[0]?.journalEntry?.id ?? null,
        taxCodeDefinitionId: sourceSnapshot?.taxCodeDefinitionId ?? event?.taxCodeDefinitionId ?? journalLines[0]?.taxCodeDefinitionId ?? null,
        externalTaxCode: sourceSnapshot?.externalTaxCode ?? event?.externalTaxCodeSnapshot ?? event?.outputTaxCode ?? journalLines[0]?.externalTaxCodeSnapshot ?? null,
        sourceCurrency, taxCurrency,
        sourceBaseAmount: s(sourceBaseAmount), sourceTaxAmount: s(sourceTaxAmount), eventBaseAmount: s(event?.taxableBase), eventTaxAmount,
        journalTaxAccountId: journalLines[0]?.accountId ?? null, journalDebitAmount: debit.toFixed(4), journalCreditAmount: credit.toFixed(4), journalTaxAmount,
        reportAmount, reportBoxesJson: contributions, ...result,
        sourceRefsJson: [{ sourceType: identity.sourceType, sourceId: identity.sourceId, ...(source?.sourceLineId || event?.sourceLineId ? { sourceLineId: source?.sourceLineId ?? event.sourceLineId } : {}) }],
      });
    }
    const checksum = createHash('sha256').update(JSON.stringify(facts.map((fact) => [fact.taxEventId, fact.sourceTaxAmount, fact.eventTaxAmount, fact.journalTaxAmount, fact.reportAmount, fact.issueCode]))).digest('hex');
    const idempotencyKey = createHash('sha256').update([ctx.companyId, branchId ?? '__ALL__', input.formType, input.periodKey, checksum].join('|')).digest('hex');
    const existing = await this.db.taxReconciliationRun.findFirst({ where: { companyId: ctx.companyId, idempotencyKey } });
    if (existing) return this.repo.reconciliationRun(existing);
    const blockingIssueCount = facts.filter((fact) => fact.blocking).length;
    const run = await this.db.taxReconciliationRun.create({ data: {
      companyId: ctx.companyId, branchId, idempotencyKey, formType: input.formType, periodKey: input.periodKey,
      status: blockingIssueCount ? 'NEEDS_REVIEW' : 'GENERATED', checksum, blockingIssueCount, createdByUserId: ctx.userId,
      lines: { create: facts },
    } });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.reconciliation.generate', targetType: 'tax_reconciliation', targetId: run.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { formType: input.formType, periodKey: input.periodKey, branchId, blockingIssueCount } });
    await this.outbox.append('tax.reconciliation.generated', 'tax_reconciliation', run.id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'tax_reconciliation', aggregateId: run.id, occurredAt: new Date().toISOString(), data: { formType: input.formType, periodKey: input.periodKey, branchId, blockingIssueCount } });
    return this.repo.reconciliationRun(run);
  }

  async get(ctx: RequestContext, id: string, page = 1, pageSize = 100) {
    requirePermission(ctx, 'tax.report.read');
    const detail = await this.repo.findReconciliation(ctx.companyId, id, ctx.scopes.branchIds, Math.max(1, page), Math.min(200, Math.max(1, pageSize)));
    if (!detail) throw new NotFoundException('Tax reconciliation not found');
    return detail;
  }

  async list(ctx: RequestContext, filters: { branchId?: string; formType?: string; periodKey?: string; page?: number; pageSize?: number }) {
    requirePermission(ctx, 'tax.report.read');
    const branchId = filters.branchId ? scopedBranch(ctx, filters.branchId) : undefined;
    await this.assertCompanyBranch(ctx.companyId, branchId);
    return this.repo.listReconciliations(ctx.companyId, ctx.scopes.branchIds, {
      ...filters, branchId, page: Math.max(1, filters.page ?? 1), pageSize: Math.min(200, Math.max(1, filters.pageSize ?? 50)),
    });
  }

  async review(ctx: RequestContext, id: string, note?: string) {
    requirePermission(ctx, 'tax.review_issue.resolve');
    const run = await this.db.taxReconciliationRun.findFirst({ where: { id, companyId: ctx.companyId, branchId: ctx.scopes.branchIds ? { in: ctx.scopes.branchIds } : undefined } });
    if (!run) throw new NotFoundException('Tax reconciliation not found');
    if (run.blockingIssueCount > 0) throw new ConflictException('Blocking reconciliation lines must be resolved before review');
    const reviewed = await this.db.taxReconciliationRun.update({ where: { id }, data: { status: 'REVIEWED', reviewedByUserId: ctx.userId, reviewedAt: new Date() } });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.reconciliation.review', targetType: 'tax_reconciliation', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { note: note?.slice(0, 500) } });
    return this.repo.reconciliationRun(reviewed);
  }

  async pp30Boxes(ctx: RequestContext, periodKey: string, branchId?: string): Promise<Pp30BoxesDto> {
    requirePermission(ctx, 'tax.report.read');
    const scoped = scopedBranch(ctx, branchId);
    await this.assertCompanyBranch(ctx.companyId, scoped);
    if (!/^\d{4}-\d{2}$/.test(periodKey)) throw new BadRequestException('periodKey must be YYYY-MM');
    const [company, events] = await Promise.all([
      this.db.company.findUnique({ where: { id: ctx.companyId }, select: { baseCurrency: true } }),
      this.db.taxEvent.findMany({ where: { companyId: ctx.companyId, branchId: scoped, periodKey, status: 'ACTIVE', taxPeriod: { formType: 'PP30' } } }),
    ]);
    if (!company) throw new NotFoundException('Company not found');
    if (events.some((event: any) => event.currency.toUpperCase() !== String(company.baseCurrency).toUpperCase())) {
      throw new ConflictException('PP30 contains a non-functional-currency tax event; reconcile FX snapshots before aggregation');
    }
    return aggregatePp30Boxes(
      events.flatMap((event: any) => Array.isArray(event.reportContributionsJson) ? event.reportContributionsJson : []),
      aggregateTaxRoundingPolicy(events.map((event: any) => ({
        roundingMode: event.roundingModeSnapshot ?? undefined,
        roundingScale: event.roundingScaleSnapshot ?? undefined,
        taxAmountTolerance: event.taxAmountToleranceSnapshot?.toString?.() ?? undefined,
      }))),
    );
  }
}
