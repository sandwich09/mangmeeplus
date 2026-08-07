import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type {
  CreateTaxCodeProfileInput,
  CreateTradeTaxEvidenceInput,
  TaxAccountDeterminationRuleDto,
  TaxCodeDefinitionDto,
  TaxCodeProfileDto,
  TaxReconciliationDetailDto,
  TaxReconciliationRunDto,
  TaxReportMappingRuleDto,
  TradeTaxEvidenceDto,
  TransactionTaxAgentSummaryDto,
  ResolveTransactionTaxPreviewDto,
  TransactionTaxSnapshot,
  UpsertTaxAccountDeterminationRuleInput,
  UpsertTaxCodeDefinitionInput,
  UpsertTaxReportMappingRuleInput,
} from '@watchdog-bms/contracts';
import { aggregatePp30Boxes, aggregateTaxRoundingPolicy, formatTransactionTaxAmount } from '../../domain/logic/transaction-tax.logic';
import type { TaxCodeProfileTemplate } from '../../domain/tax-code-template.catalog';
import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

const str = (value: unknown) => String(value ?? '0');
const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : null;

export type LegacyTaxRemediationSourceType = 'accounting.document' | 'expense.record' | 'procurement.vendor_bill';

export type LegacyTaxRemediationLine = {
  id: string;
  updatedAt: string;
  netAmount: string;
  grossAmount: string;
  enteredTaxAmount: string;
  sourceVatRate: string;
  sourceExternalTaxCode?: string | null;
  accountHint?: string;
  taxCodeDefinitionId: string | null;
  externalTaxCode: string | null;
  taxRegime: string | null;
  taxDirection: string | null;
  taxTreatment: string | null;
  taxContext: string | null;
  taxRate: string;
  taxBaseAmount: string;
  transactionTaxAmount: string;
};

export type LegacyTaxRemediationSource = {
  companyId: string;
  sourceType: LegacyTaxRemediationSourceType;
  sourceId: string;
  branchId: string | null;
  documentDate: string;
  currency: string;
  sourceKind: string;
  status: string;
  postingStatus: string;
  journalEntryId: string | null;
  updatedAt: string;
  blockers: string[];
  lines: LegacyTaxRemediationLine[];
};

export type LegacyTaxRemediationUpdate = {
  sourceLineId: string;
  expectedUpdatedAt: string;
  preview: ResolveTransactionTaxPreviewDto;
};

@Injectable()
export class PrismaTransactionTaxRepository {
  constructor(readonly prisma: PrismaService) {}

  private get db(): any { return this.prisma.client as any; }

  private profile(row: any): TaxCodeProfileDto {
    return {
      id: row.id, companyId: row.companyId, name: row.name, sourceSystem: row.sourceSystem,
      sourceProfileKey: row.sourceProfileKey, countryCode: row.countryCode, sapClient: row.sapClient ?? null,
      sapCompanyCode: row.sapCompanyCode ?? null, status: row.status, effectiveFrom: iso(row.effectiveFrom)!,
      isDefault: row.isDefault,
      roundingMode: row.roundingMode ?? 'HALF_UP', roundingScale: row.roundingScale ?? 2,
      taxAmountTolerance: str(row.taxAmountTolerance ?? '0.01'),
      effectiveTo: iso(row.effectiveTo), sourceUrl: row.sourceUrl ?? null, reviewedByUserId: row.reviewedByUserId ?? null,
      reviewedAt: iso(row.reviewedAt), createdAt: iso(row.createdAt)!, updatedAt: iso(row.updatedAt)!, version: row.version,
    };
  }

  private definition(row: any): TaxCodeDefinitionDto {
    return {
      id: row.id, companyId: row.companyId, profileId: row.profileId, externalCode: row.externalCode,
      displayName: row.displayName, taxRegime: row.taxRegime, direction: row.direction, treatment: row.treatment,
      transactionContexts: Array.isArray(row.transactionContextsJson) ? row.transactionContextsJson : [], rate: str(row.rate),
      calculationMethod: row.calculationMethod, sapAccountKey: row.sapAccountKey ?? null,
      claimabilityDefault: row.claimabilityDefault, evidenceRuleKey: row.evidenceRuleKey ?? null, status: row.status,
      effectiveFrom: iso(row.effectiveFrom)!, effectiveTo: iso(row.effectiveTo), version: row.version,
      reviewedByUserId: row.reviewedByUserId ?? null, reviewedAt: iso(row.reviewedAt),
    };
  }

  private accountRule(row: any): TaxAccountDeterminationRuleDto {
    return {
      id: row.id, companyId: row.companyId, taxCodeDefinitionId: row.taxCodeDefinitionId ?? null,
      taxRegime: row.taxRegime, direction: row.direction, treatment: row.treatment,
      transactionContext: row.transactionContext ?? null, sourceModule: row.sourceModule ?? null,
      accountRole: row.accountRole, accountId: row.accountId, postingSide: row.postingSide,
      priority: row.priority, status: row.status, effectiveFrom: iso(row.effectiveFrom)!, effectiveTo: iso(row.effectiveTo), version: row.version,
    };
  }

  private reportRule(row: any): TaxReportMappingRuleDto {
    return {
      id: row.id, companyId: row.companyId, taxCodeDefinitionId: row.taxCodeDefinitionId,
      formType: row.formType, boxKey: row.boxKey, amountSource: row.amountSource, signRule: row.signRule,
      status: row.status, effectiveFrom: iso(row.effectiveFrom)!, effectiveTo: iso(row.effectiveTo), version: row.version,
    };
  }

  private evidence(row: any): TradeTaxEvidenceDto {
    return {
      id: row.id, companyId: row.companyId, branchId: row.branchId ?? null, transactionContext: row.transactionContext,
      sourceType: row.sourceType, sourceId: row.sourceId, sourceLineId: row.sourceLineId ?? null,
      evidenceType: row.evidenceType, referenceNumber: row.referenceNumber, evidenceDate: iso(row.evidenceDate)!,
      countryCode: row.countryCode ?? null, currency: row.currency, exchangeRate: row.exchangeRate == null ? null : str(row.exchangeRate),
      exchangeRateSource: row.exchangeRateSource ?? null, customsValue: str(row.customsValue), dutyAmount: str(row.dutyAmount),
      exciseAmount: str(row.exciseAmount), otherTaxAmount: str(row.otherTaxAmount), importVatAmount: str(row.importVatAmount),
      attachmentIds: Array.isArray(row.attachmentIdsJson) ? row.attachmentIdsJson : [], status: row.status,
      reviewedByUserId: row.reviewedByUserId ?? null, reviewedAt: iso(row.reviewedAt),
    };
  }

  private remediationLine(row: any, netAmount: unknown, grossAmount: unknown): LegacyTaxRemediationLine {
    return {
      id: row.id,
      updatedAt: iso(row.updatedAt)!,
      netAmount: str(netAmount),
      grossAmount: str(grossAmount),
      enteredTaxAmount: str(row.vatAmount),
      sourceVatRate: str(row.vatRate),
      accountHint: row.accountHint ?? row.accountHintKey ?? undefined,
      taxCodeDefinitionId: row.taxCodeDefinitionId ?? null,
      externalTaxCode: row.externalTaxCodeSnapshot ?? null,
      taxRegime: row.taxRegimeSnapshot ?? null,
      taxDirection: row.taxDirectionSnapshot ?? null,
      taxTreatment: row.taxTreatmentSnapshot ?? null,
      taxContext: row.taxContextSnapshot ?? null,
      taxRate: str(row.taxRateSnapshot),
      taxBaseAmount: str(row.taxBaseAmount),
      transactionTaxAmount: str(row.transactionTaxAmount),
    };
  }

  private scalarRemediationLines(rows: any[], amounts: (row: any) => [unknown, unknown]): LegacyTaxRemediationLine[] {
    return rows
      .filter((row) => row.taxEvidenceReviewStatus === 'REVIEW_REQUIRED'
        && ['VAT', 'IMPORT_VAT'].includes(row.taxRegimeSnapshot)
        && row.taxBaseAmount != null && row.transactionTaxAmount != null
        && (!Array.isArray(row.taxComponentsJson) || row.taxComponentsJson.length === 0))
      .map((row) => this.remediationLine(row, ...amounts(row)));
  }

  private async findLegacyRemediationSourceWith(db: any, companyId: string, sourceType: LegacyTaxRemediationSourceType, sourceId: string): Promise<LegacyTaxRemediationSource | null> {
    let row: any;
    let source: Omit<LegacyTaxRemediationSource, 'blockers' | 'lines'>;
    if (sourceType === 'accounting.document') {
      row = await db.accountingDocument.findFirst({ where: { id: sourceId, companyId }, include: { lines: true } });
      if (!row) return null;
      source = { companyId, sourceType, sourceId, branchId: row.branchId ?? null, documentDate: iso(row.documentDate)!, currency: row.currency, sourceKind: row.documentType, status: row.status, postingStatus: row.postingStatus, journalEntryId: row.journalEntryId ?? null, updatedAt: iso(row.updatedAt)! };
      return {
        ...source,
        blockers: await this.legacyRemediationBlockers(db, source),
        lines: this.scalarRemediationLines(row.lines, (line) => [line.lineSubtotalAmount, line.lineTotalAmount])
          .map((line) => ({ ...line, sourceExternalTaxCode: row.outputTaxCode ?? null })),
      };
    }
    if (sourceType === 'expense.record') {
      row = await db.expenseRecord.findFirst({ where: { id: sourceId, companyId }, include: { lines: true } });
      if (!row) return null;
      source = { companyId, sourceType, sourceId, branchId: row.branchId ?? null, documentDate: iso(row.expenseDate)!, currency: row.currency, sourceKind: row.sourceDocumentType, status: row.status, postingStatus: row.postingStatus, journalEntryId: row.journalEntryId ?? null, updatedAt: iso(row.updatedAt)! };
      return { ...source, blockers: await this.legacyRemediationBlockers(db, source), lines: this.scalarRemediationLines(row.lines, (line) => [line.taxableAmount, line.lineTotalAmount]) };
    }
    row = await db.vendorBill.findFirst({ where: { id: sourceId, companyId }, include: { lines: true } });
    if (!row) return null;
    source = { companyId, sourceType, sourceId, branchId: row.branchId ?? null, documentDate: iso(row.billDate)!, currency: row.currency, sourceKind: row.pp36Candidate ? 'PP36_CANDIDATE' : 'VENDOR_BILL', status: row.status, postingStatus: row.postingStatus, journalEntryId: row.journalEntryId ?? null, updatedAt: iso(row.updatedAt)! };
    return { ...source, blockers: await this.legacyRemediationBlockers(db, source), lines: this.scalarRemediationLines(row.lines, (line) => [line.lineSubtotalAmount, line.lineTotalAmount]) };
  }

  private async legacyRemediationBlockers(db: any, source: Omit<LegacyTaxRemediationSource, 'blockers' | 'lines'>): Promise<string[]> {
    const blockers: string[] = [];
    if (source.journalEntryId || ['posted', 'reversed'].includes(source.postingStatus)) blockers.push('source_already_posted');
    if (source.status === 'VOIDED' || (source.sourceType === 'accounting.document' && ['CREDITED', 'DEBITED', 'CLOSED'].includes(source.status)) || (source.sourceType === 'procurement.vendor_bill' && source.status === 'CREDITED')) blockers.push('source_is_final_or_voided');
    if (source.sourceType === 'accounting.document' && ['CREDIT_NOTE', 'DEBIT_NOTE'].includes(source.sourceKind)) blockers.push('legacy_correction_requires_original_snapshot');
    if (source.sourceKind === 'PP36_CANDIDATE') blockers.push('pp36_requires_payment_triggered_resolution');
    const periodKey = source.documentDate.slice(0, 7);
    const [filed, filedEvent] = await Promise.all([
      db.taxPeriod.findFirst({ where: {
        companyId: source.companyId,
        periodKey, formType: { in: ['PP30', 'PP36'] }, status: { in: ['FILED', 'PAID', 'CLOSED', 'AMENDED'] },
      }, select: { id: true } }),
      db.taxEvent.findFirst({ where: {
        companyId: source.companyId, sourceType: source.sourceType, sourceId: source.sourceId,
        taxPeriod: { status: { in: ['FILED', 'PAID', 'CLOSED', 'AMENDED'] } },
      }, select: { id: true } }),
    ]);
    if (filed || filedEvent) blockers.push('tax_period_already_filed');
    return blockers;
  }

  async findLegacyRemediationSource(companyId: string, sourceType: LegacyTaxRemediationSourceType, sourceId: string): Promise<LegacyTaxRemediationSource | null> {
    return this.findLegacyRemediationSourceWith(this.db, companyId, sourceType, sourceId);
  }

  async applyLegacyRemediation(companyId: string, sourceType: LegacyTaxRemediationSourceType, sourceId: string, expectedSourceUpdatedAt: string, updates: LegacyTaxRemediationUpdate[]): Promise<number> {
    return this.db.$transaction(async (tx: any) => {
      const source = await this.findLegacyRemediationSourceWith(tx, companyId, sourceType, sourceId);
      if (!source) throw new Error('legacy_remediation_source_not_found');
      if (source.updatedAt !== expectedSourceUpdatedAt || source.blockers.length) throw new Error('legacy_remediation_source_changed_or_locked');
      const candidates = new Map(source.lines.map((line) => [line.id, line]));
      if (candidates.size !== updates.length || updates.some((update) => !candidates.has(update.sourceLineId))) throw new Error('legacy_remediation_candidate_changed');
      const model = sourceType === 'accounting.document' ? tx.accountingDocumentLine : sourceType === 'expense.record' ? tx.expenseLine : tx.vendorBillLine;
      const parentKey = sourceType === 'accounting.document' ? 'documentId' : sourceType === 'expense.record' ? 'expenseId' : 'vendorBillId';
      for (const update of updates) {
        const snapshot = update.preview.snapshot;
        const current = candidates.get(update.sourceLineId)!;
        if (current.updatedAt !== update.expectedUpdatedAt) throw new Error('legacy_remediation_candidate_changed');
        const result = await model.updateMany({
          where: { id: update.sourceLineId, companyId, [parentKey]: sourceId, updatedAt: new Date(update.expectedUpdatedAt), taxEvidenceReviewStatus: 'REVIEW_REQUIRED' },
          data: {
            taxCodeDefinitionId: snapshot.taxCodeDefinitionId,
            externalTaxCodeSnapshot: snapshot.externalTaxCode,
            taxProfileKeySnapshot: snapshot.taxProfileKey,
            taxProfileVersionSnapshot: snapshot.taxProfileVersion,
            roundingModeSnapshot: snapshot.roundingMode ?? null,
            roundingScaleSnapshot: snapshot.roundingScale ?? null,
            taxAmountToleranceSnapshot: snapshot.taxAmountTolerance ?? null,
            taxRegimeSnapshot: snapshot.taxRegime,
            taxDirectionSnapshot: snapshot.taxDirection,
            taxTreatmentSnapshot: snapshot.taxTreatment,
            taxContextSnapshot: snapshot.taxContext,
            taxRateSnapshot: snapshot.taxRate,
            sourceCurrencySnapshot: snapshot.sourceCurrency,
            taxCurrencySnapshot: snapshot.taxCurrency,
            exchangeRateSnapshot: snapshot.exchangeRate,
            exchangeRateSourceSnapshot: snapshot.exchangeRateSource,
            exchangeRateDateSnapshot: snapshot.exchangeRateDate ? new Date(snapshot.exchangeRateDate) : null,
            taxBaseAmount: snapshot.taxBaseAmount,
            transactionTaxAmount: snapshot.taxAmount,
            claimabilitySnapshot: snapshot.claimability,
            accountRuleVersionSnapshot: snapshot.accountRuleVersion,
            reportRuleVersionSnapshot: snapshot.reportRuleVersion,
            taxEvidenceReviewStatus: snapshot.evidenceStatus,
            taxComponentsJson: update.preview.components,
            accountAssignmentsJson: update.preview.components.flatMap((component) => component.accountAssignments),
          },
        });
        if (result.count !== 1) throw new Error('legacy_remediation_candidate_changed');
      }
      return updates.length;
    }, { isolationLevel: 'Serializable' });
  }

  async listProfiles(companyId: string, filters: { sourceSystem?: string; status?: string; effectiveDate?: string } = {}, db: any = this.db): Promise<TaxCodeProfileDto[]> {
    const at = filters.effectiveDate ? new Date(filters.effectiveDate) : undefined;
    const rows = await db.companyTaxCodeProfile.findMany({
      where: { companyId, sourceSystem: filters.sourceSystem, status: filters.status, ...(at ? { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] } : {}) },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row: any) => this.profile(row));
  }

  async findProfile(companyId: string, id: string, db: any = this.db): Promise<TaxCodeProfileDto | null> {
    const row = await db.companyTaxCodeProfile.findFirst({ where: { id, companyId } });
    return row ? this.profile(row) : null;
  }

  async createProfile(companyId: string, input: CreateTaxCodeProfileInput, userId: string): Promise<TaxCodeProfileDto> {
    const row = await this.db.companyTaxCodeProfile.create({ data: {
      companyId, name: input.name, sourceSystem: input.sourceSystem, sourceProfileKey: input.sourceProfileKey,
      countryCode: input.countryCode ?? 'TH', sapClient: input.sapClient, sapCompanyCode: input.sapCompanyCode,
      isDefault: input.isDefault ?? false,
      roundingMode: input.roundingMode ?? 'HALF_UP', roundingScale: input.roundingScale ?? 2,
      taxAmountTolerance: input.taxAmountTolerance ?? '0.01',
      effectiveFrom: new Date(input.effectiveFrom), effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      sourceUrl: input.sourceUrl, status: 'DRAFT', createdByUserId: userId,
    } });
    return this.profile(row);
  }

  async createProfileFromTemplate(companyId: string, template: TaxCodeProfileTemplate, effectiveFrom: string, userId: string): Promise<{ profile: TaxCodeProfileDto; created: boolean }> {
    return this.db.$transaction(async (tx: any) => {
      const existing = await tx.companyTaxCodeProfile.findFirst({
        where: { companyId, sourceSystem: template.sourceSystem, sourceProfileKey: template.key, status: { not: 'RETIRED' } },
        orderBy: { version: 'desc' },
      });
      if (existing) return { profile: this.profile(existing), created: false };
      const profile = await tx.companyTaxCodeProfile.create({ data: {
        companyId, name: template.name, sourceSystem: template.sourceSystem, sourceProfileKey: template.key,
        countryCode: 'TH', isDefault: false, status: 'DRAFT', version: 1,
        effectiveFrom: new Date(effectiveFrom), sourceUrl: template.sourceUrl, createdByUserId: userId,
      } });
      await tx.taxCodeDefinition.createMany({ data: template.definitions.map((definition) => ({
        companyId, profileId: profile.id, externalCode: definition.externalCode, displayName: definition.displayName,
        taxRegime: definition.taxRegime, direction: definition.direction, treatment: definition.treatment,
        transactionContextsJson: definition.transactionContexts, rate: definition.rate,
        calculationMethod: definition.calculationMethod, sapAccountKey: definition.sapAccountKey,
        claimabilityDefault: definition.claimabilityDefault, evidenceRuleKey: definition.evidenceRuleKey,
        status: 'REVIEW_REQUIRED', effectiveFrom: new Date(effectiveFrom), version: 1,
        sourceMetadataJson: { builtInTemplate: template.key, warning: template.warning, sourceUrl: template.sourceUrl },
        createdByUserId: userId,
      })) });
      return { profile: this.profile(profile), created: true };
    }, { isolationLevel: 'Serializable' });
  }

  async updateProfile(companyId: string, id: string, input: Partial<CreateTaxCodeProfileInput>): Promise<TaxCodeProfileDto | null> {
    const current = await this.db.companyTaxCodeProfile.findFirst({ where: { id, companyId } });
    if (!current) return null;
    const row = await this.db.companyTaxCodeProfile.update({ where: { id }, data: {
      name: input.name, sourceSystem: input.sourceSystem, sourceProfileKey: input.sourceProfileKey,
      countryCode: input.countryCode, sapClient: input.sapClient, sapCompanyCode: input.sapCompanyCode,
      isDefault: input.isDefault,
      roundingMode: input.roundingMode, roundingScale: input.roundingScale,
      taxAmountTolerance: input.taxAmountTolerance,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : undefined,
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : undefined, sourceUrl: input.sourceUrl,
    } });
    return this.profile(row);
  }

  async setProfileStatus(companyId: string, id: string, status: 'ACTIVE' | 'RETIRED', userId: string): Promise<TaxCodeProfileDto | null> {
    const current = await this.db.companyTaxCodeProfile.findFirst({ where: { id, companyId } });
    if (!current) return null;
    const row = await this.db.$transaction(async (tx: any) => {
      if (status === 'ACTIVE') {
        const definitions = await tx.taxCodeDefinition.findMany({ where: { companyId, profileId: id }, select: { id: true } });
        const definitionIds = definitions.map((definition: any) => definition.id);
        await tx.taxCodeDefinition.updateMany({ where: { companyId, profileId: id, status: { in: ['DRAFT', 'REVIEW_REQUIRED'] } }, data: { status: 'ACTIVE', reviewedByUserId: userId, reviewedAt: new Date() } });
        await tx.taxAccountDeterminationRule.updateMany({ where: { companyId, taxCodeDefinitionId: { in: definitionIds }, status: 'REVIEW_REQUIRED' }, data: { status: 'ACTIVE', reviewedByUserId: userId, reviewedAt: new Date() } });
        await tx.taxReportMappingRule.updateMany({ where: { companyId, taxCodeDefinitionId: { in: definitionIds }, status: 'REVIEW_REQUIRED' }, data: { status: 'ACTIVE', reviewedByUserId: userId, reviewedAt: new Date() } });
      }
      return tx.companyTaxCodeProfile.update({ where: { id }, data: { status, reviewedByUserId: userId, reviewedAt: new Date() } });
    });
    return this.profile(row);
  }

  async listDefinitions(companyId: string, filters: { profileId?: string; externalCode?: string; direction?: string; transactionContext?: string; status?: string; effectiveDate?: string } = {}, db: any = this.db): Promise<TaxCodeDefinitionDto[]> {
    const at = filters.effectiveDate ? new Date(filters.effectiveDate) : undefined;
    const rows = await db.taxCodeDefinition.findMany({ where: {
      companyId, profileId: filters.profileId, externalCode: filters.externalCode?.toUpperCase(), direction: filters.direction,
      status: filters.status, ...(filters.transactionContext ? { transactionContextsJson: { array_contains: filters.transactionContext } } : {}),
      ...(at ? { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] } : {}),
    }, orderBy: [{ externalCode: 'asc' }, { direction: 'asc' }, { version: 'desc' }] });
    return rows.map((row: any) => this.definition(row));
  }

  async upsertDefinition(companyId: string, input: UpsertTaxCodeDefinitionInput, userId: string): Promise<TaxCodeDefinitionDto> {
    if (input.id) {
      const existing = await this.db.taxCodeDefinition.findFirst({ where: { id: input.id, companyId } });
      if (!existing) throw new Error('tax_code_definition_not_found');
    }
    const data = {
      companyId, profileId: input.profileId, externalCode: input.externalCode.toUpperCase(), displayName: input.displayName,
      taxRegime: input.taxRegime, direction: input.direction, treatment: input.treatment,
      transactionContextsJson: input.transactionContexts, rate: input.rate, calculationMethod: input.calculationMethod,
      sapAccountKey: input.sapAccountKey, claimabilityDefault: input.claimabilityDefault,
      evidenceRuleKey: input.evidenceRuleKey, effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null, status: 'REVIEW_REQUIRED', createdByUserId: userId,
    };
    const row = input.id
      ? await this.db.taxCodeDefinition.update({ where: { id: input.id }, data: { ...data, companyId: undefined, version: { increment: 1 }, reviewedByUserId: null, reviewedAt: null } })
      : await this.db.taxCodeDefinition.create({ data });
    return this.definition(row);
  }

  async listAccountRules(companyId: string, filters: { taxCodeDefinitionId?: string; transactionContext?: string; direction?: string; status?: string; effectiveDate?: string } = {}, db: any = this.db): Promise<TaxAccountDeterminationRuleDto[]> {
    const at = filters.effectiveDate ? new Date(filters.effectiveDate) : undefined;
    const rows = await db.taxAccountDeterminationRule.findMany({ where: {
      companyId, taxCodeDefinitionId: filters.taxCodeDefinitionId, transactionContext: filters.transactionContext,
      direction: filters.direction, status: filters.status, ...(at ? { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] } : {}),
    }, orderBy: [{ priority: 'desc' }, { version: 'desc' }] });
    return rows.map((row: any) => this.accountRule(row));
  }

  async upsertAccountRule(companyId: string, input: UpsertTaxAccountDeterminationRuleInput, userId: string): Promise<TaxAccountDeterminationRuleDto> {
    if (input.id) {
      const existing = await this.db.taxAccountDeterminationRule.findFirst({ where: { id: input.id, companyId } });
      if (!existing) throw new Error('tax_account_rule_not_found');
    }
    const data = { ...input, id: undefined, companyId, status: 'REVIEW_REQUIRED', effectiveFrom: new Date(input.effectiveFrom), effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null, createdByUserId: userId, reviewedByUserId: null, reviewedAt: null };
    const row = input.id
      ? await this.db.taxAccountDeterminationRule.update({ where: { id: input.id }, data: { ...data, companyId: undefined, version: { increment: 1 } } })
      : await this.db.taxAccountDeterminationRule.create({ data });
    return this.accountRule(row);
  }

  async listReportRules(companyId: string, filters: { taxCodeDefinitionId?: string; status?: string; effectiveDate?: string } = {}, db: any = this.db): Promise<TaxReportMappingRuleDto[]> {
    const at = filters.effectiveDate ? new Date(filters.effectiveDate) : undefined;
    const rows = await db.taxReportMappingRule.findMany({ where: {
      companyId, taxCodeDefinitionId: filters.taxCodeDefinitionId, status: filters.status,
      ...(at ? { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }] } : {}),
    }, orderBy: [{ formType: 'asc' }, { boxKey: 'asc' }, { version: 'desc' }] });
    return rows.map((row: any) => this.reportRule(row));
  }

  async upsertReportRule(companyId: string, input: UpsertTaxReportMappingRuleInput, userId: string): Promise<TaxReportMappingRuleDto> {
    if (input.id) {
      const existing = await this.db.taxReportMappingRule.findFirst({ where: { id: input.id, companyId } });
      if (!existing) throw new Error('tax_report_rule_not_found');
    }
    const data = { ...input, id: undefined, companyId, status: 'REVIEW_REQUIRED', effectiveFrom: new Date(input.effectiveFrom), effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null, createdByUserId: userId, reviewedByUserId: null, reviewedAt: null };
    const row = input.id
      ? await this.db.taxReportMappingRule.update({ where: { id: input.id }, data: { ...data, companyId: undefined, version: { increment: 1 } } })
      : await this.db.taxReportMappingRule.create({ data });
    return this.reportRule(row);
  }

  async listEvidence(companyId: string, branches: string[] | undefined, filters: { branchId?: string; transactionContext?: string; status?: string; sourceType?: string; sourceId?: string } = {}, allowedSourcePrefixes?: string[]): Promise<TradeTaxEvidenceDto[]> {
    const rows = await this.db.tradeTaxEvidence.findMany({ where: {
      companyId, branchId: filters.branchId ?? (branches ? { in: branches } : undefined), transactionContext: filters.transactionContext,
      status: filters.status, sourceType: filters.sourceType, sourceId: filters.sourceId,
      ...(!filters.sourceType && allowedSourcePrefixes ? { OR: allowedSourcePrefixes.map((prefix) => ({ sourceType: { startsWith: prefix } })) } : {}),
    }, orderBy: { evidenceDate: 'desc' } });
    return rows.map((row: any) => this.evidence(row));
  }

  async createEvidence(companyId: string, input: CreateTradeTaxEvidenceInput, userId: string): Promise<TradeTaxEvidenceDto> {
    const normalizedReference = input.referenceNumber.trim().toUpperCase();
    const authoritative = ['CUSTOMS_ENTRY', 'PP36_RECEIPT', 'EXPORT_DECLARATION'].includes(input.evidenceType);
    const idempotencyKey = createHash('sha256').update(authoritative
      ? [companyId, input.evidenceType, normalizedReference].join('|')
      : [companyId, input.sourceType, input.sourceId, input.sourceLineId ?? '', input.evidenceType, normalizedReference].join('|')).digest('hex');
    const row = await this.db.tradeTaxEvidence.create({ data: {
      ...input, companyId, referenceNumber: normalizedReference, evidenceDate: new Date(input.evidenceDate), attachmentIdsJson: input.attachmentIds,
      attachmentIds: undefined, idempotencyKey, status: 'REVIEW_REQUIRED', createdByUserId: userId,
    } });
    return this.evidence(row);
  }

  async verifyEvidence(companyId: string, id: string, userId: string, status: 'VERIFIED' | 'REJECTED'): Promise<TradeTaxEvidenceDto | null> {
    const current = await this.db.tradeTaxEvidence.findFirst({ where: { id, companyId } });
    if (!current) return null;
    const row = await this.db.tradeTaxEvidence.update({ where: { id }, data: { status, reviewedByUserId: userId, reviewedAt: new Date() } });
    return this.evidence(row);
  }

  async findEvidence(companyId: string, id: string): Promise<TradeTaxEvidenceDto | null> {
    const row = await this.db.tradeTaxEvidence.findFirst({ where: { id, companyId } });
    return row ? this.evidence(row) : null;
  }

  async latestAgentSummary(companyId: string, branches?: string[], filters: { periodKey?: string; formType?: string; transactionContext?: string } = {}): Promise<TransactionTaxAgentSummaryDto> {
    const componentKeys = filters.formType === 'PP36' ? ['PP36_OUTPUT', 'PP36_INPUT']
      : filters.formType === 'CUSTOMS_SUPPORT' ? ['CUSTOMS_DUTY', 'EXCISE_TAX', 'OTHER_IMPORT_TAX']
        : filters.formType === 'PP30' ? ['VAT', 'IMPORT_VAT', 'PP36_INPUT'] : undefined;
    const eventWhere: any = {
      companyId,
      branchId: branches ? { in: branches } : undefined,
      status: 'ACTIVE',
      periodKey: filters.periodKey,
      taxContextSnapshot: filters.transactionContext,
      eventType: { in: ['VAT_OUTPUT', 'VAT_INPUT', 'VAT_EXEMPT', 'VAT_REVIEW', 'CUSTOMS_ASSESSED'] },
      ...(componentKeys ? (filters.formType === 'PP30'
        ? { OR: [{ componentKey: null }, { componentKey: { in: componentKeys } }] }
        : { componentKey: { in: componentKeys } }) : {}),
    };
    const latestEvent = await this.db.taxEvent.findFirst({ where: eventWhere, orderBy: { eventDate: 'desc' } });
    const periodKey = filters.periodKey ?? latestEvent?.periodKey;
    const periodStart = periodKey && /^\d{4}-\d{2}$/.test(periodKey) ? new Date(`${periodKey}-01T00:00:00.000Z`) : null;
    const periodEnd = periodStart ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)) : null;
    const evidenceContext = filters.transactionContext ?? (filters.formType === 'PP36' ? 'IMPORT_SERVICE' : filters.formType === 'CUSTOMS_SUPPORT' ? 'IMPORT_GOODS' : undefined);
    const [reconciliation, events, evidenceReviewPendingCount] = await Promise.all([
      this.db.taxReconciliationRun.findFirst({ where: {
        companyId, branchId: branches ? { in: branches } : undefined,
        formType: filters.formType ?? 'PP30',
        periodKey,
      }, orderBy: { createdAt: 'desc' } }),
      periodKey ? this.db.taxEvent.findMany({ where: { ...eventWhere, periodKey }, orderBy: { eventDate: 'desc' } }) : [],
      periodStart ? this.db.tradeTaxEvidence.count({ where: {
        companyId, branchId: branches ? { in: branches } : undefined, status: 'REVIEW_REQUIRED',
        transactionContext: evidenceContext, evidenceDate: { gte: periodStart, lt: periodEnd },
      } }) : 0,
    ]);
    const reviewCount = reconciliation
      ? await this.db.taxReconciliationLine.count({ where: { runId: reconciliation.id, blocking: true } })
      : 0;
    const profileSnapshots = new Map<string, { key: string; version: number }>();
    for (const event of events) if (event.taxProfileKeySnapshot && event.taxProfileVersionSnapshot != null) {
      profileSnapshots.set(`${event.taxProfileKeySnapshot}:${event.taxProfileVersionSnapshot}`, { key: event.taxProfileKeySnapshot, version: event.taxProfileVersionSnapshot });
    }
    const profileSnapshot = profileSnapshots.size === 1 ? [...profileSnapshots.values()][0]! : null;
    const matchingProfiles = profileSnapshot ? await this.db.companyTaxCodeProfile.findMany({ where: {
      companyId, sourceProfileKey: profileSnapshot.key, version: profileSnapshot.version,
    }, take: 2 }) : [];
    const profile = matchingProfiles.length === 1 ? matchingProfiles[0] : null;
    const contributions = events.flatMap((event: any) => Array.isArray(event.reportContributionsJson) ? event.reportContributionsJson : []);
    const summary = new Map<string, {
      componentKey: TransactionTaxAgentSummaryDto['componentSummary'][number]['componentKey']; transactionContext: any;
      eventCount: number; taxableBase: Decimal; taxAmount: Decimal; evidencePendingCount: number; roundingPolicies: any[];
    }>();
    for (const event of events) {
      const componentKey = event.componentKey ?? 'LEGACY_VAT';
      const transactionContext = event.taxContextSnapshot ?? null;
      const key = `${componentKey}:${transactionContext ?? ''}`;
      const current = summary.get(key) ?? { componentKey, transactionContext, eventCount: 0, taxableBase: new Decimal(0), taxAmount: new Decimal(0), evidencePendingCount: 0, roundingPolicies: [] as any[] };
      current.eventCount += 1;
      current.taxableBase = current.taxableBase.plus(str(event.taxableBase));
      current.taxAmount = current.taxAmount.plus(str(event.taxAmount));
      current.roundingPolicies.push({
        roundingMode: event.roundingModeSnapshot ?? undefined,
        roundingScale: event.roundingScaleSnapshot ?? undefined,
        taxAmountTolerance: event.taxAmountToleranceSnapshot?.toString?.() ?? undefined,
      });
      if (event.taxEvidenceReviewStatus !== 'VERIFIED') current.evidencePendingCount += 1;
      summary.set(key, current);
    }
    const includePp30 = !filters.formType || filters.formType === 'PP30';
    const aggregationPolicy = aggregateTaxRoundingPolicy(events.map((event: any) => ({
      roundingMode: event.roundingModeSnapshot ?? undefined,
      roundingScale: event.roundingScaleSnapshot ?? undefined,
      taxAmountTolerance: event.taxAmountToleranceSnapshot?.toString?.() ?? undefined,
    })));
    return {
      companyId, profile: profile ? this.profile(profile) : null, periodKey: periodKey ?? null,
      pp30: includePp30 && contributions.length ? aggregatePp30Boxes(contributions, aggregationPolicy) : null,
      componentSummary: [...summary.values()].map(({ taxableBase, taxAmount, roundingPolicies, ...item }) => {
        const policy = aggregateTaxRoundingPolicy(roundingPolicies);
        return { ...item, taxableBase: formatTransactionTaxAmount(taxableBase, policy), taxAmount: formatTransactionTaxAmount(taxAmount, policy) };
      }),
      latestReconciliation: reconciliation ? this.reconciliationRun(reconciliation) : null,
      needsReviewCount: reviewCount, evidenceReviewPendingCount, permissionChecked: true,
    };
  }

  reconciliationRun(row: any): TaxReconciliationRunDto {
    return { id: row.id, companyId: row.companyId, branchId: row.branchId ?? null, formType: row.formType, periodKey: row.periodKey, status: row.status, checksum: row.checksum, blockingIssueCount: row.blockingIssueCount, createdAt: iso(row.createdAt)!, reviewedAt: iso(row.reviewedAt) };
  }

  async listReconciliations(companyId: string, branches: string[] | undefined, filters: { branchId?: string; formType?: string; periodKey?: string; page?: number; pageSize?: number }): Promise<TaxReconciliationRunDto[]> {
    const rows = await this.db.taxReconciliationRun.findMany({ where: {
      companyId, branchId: filters.branchId ?? (branches ? { in: branches } : undefined), formType: filters.formType, periodKey: filters.periodKey,
    }, skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 50), take: filters.pageSize ?? 50, orderBy: { createdAt: 'desc' } });
    return rows.map((row: any) => this.reconciliationRun(row));
  }

  async findReconciliation(companyId: string, id: string, branches: string[] | undefined, page = 1, pageSize = 100): Promise<TaxReconciliationDetailDto | null> {
    const run = await this.db.taxReconciliationRun.findFirst({ where: { id, companyId, branchId: branches ? { in: branches } : undefined } });
    if (!run) return null;
    const [rows, total] = await Promise.all([
      this.db.taxReconciliationLine.findMany({ where: { runId: id }, skip: (page - 1) * pageSize, take: pageSize, orderBy: { sourceId: 'asc' } }),
      this.db.taxReconciliationLine.count({ where: { runId: id } }),
    ]);
    return { ...this.reconciliationRun(run), lines: rows.map((row: any) => ({
      id: row.id, runId: row.runId, branchId: row.branchId ?? null, sourceType: row.sourceType, sourceId: row.sourceId,
      sourceLineId: row.sourceLineId ?? null, componentKey: row.componentKey, taxEventId: row.taxEventId ?? null, journalEntryId: row.journalEntryId ?? null,
      externalTaxCode: row.externalTaxCode ?? null, sourceCurrency: row.sourceCurrency ?? null, taxCurrency: row.taxCurrency ?? null,
      sourceBaseAmount: str(row.sourceBaseAmount), sourceTaxAmount: str(row.sourceTaxAmount),
      eventBaseAmount: str(row.eventBaseAmount), eventTaxAmount: str(row.eventTaxAmount), journalTaxAmount: str(row.journalTaxAmount),
      reportAmount: str(row.reportAmount), sourceEventDelta: str(row.sourceEventDelta), eventJournalDelta: str(row.eventJournalDelta),
      eventReportDelta: str(row.eventReportDelta), issueCode: row.issueCode, blocking: row.blocking,
      sourceRefs: Array.isArray(row.sourceRefsJson) ? row.sourceRefsJson : [],
    })), total, page, pageSize };
  }
}
