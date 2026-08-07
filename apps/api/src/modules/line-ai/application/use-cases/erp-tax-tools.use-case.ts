/**
 * Tax read-only ERP tools for LINE AI (item 11, phase 8).
 * Read-only: no mutation of tax records, filing, config, or certificates.
 */
import { Injectable } from '@nestjs/common';
import type {
  RequestContext,
  SourceRef,
  TaxCodeDefinitionDto,
  TaxCodeProfileDto,
  ToolResult,
  TransactionTaxAgentSummaryDto,
} from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import { PrismaTaxRepository } from '../../../tax/infrastructure/repositories/prisma-tax.repository';
import {
  GetTransactionTaxAgentSummaryUseCase,
  TransactionTaxConfigUseCase,
} from '../../../tax/application/use-cases/transaction-tax-config.use-case';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';

function now(): string { return new Date().toISOString(); }
function addMoney(values: string[]): string {
  const scale = 10000n;
  const total = values.reduce((acc, value) => acc + parseMoney(value, scale), 0n);
  return `${total / scale}.${String(total % scale).padStart(4, '0')}`;
}
function subtractMoney(left: string, right: string): string {
  const scale = 10000n;
  const total = parseMoney(left, scale) - parseMoney(right, scale);
  const sign = total < 0n ? '-' : '';
  const abs = total < 0n ? -total : total;
  return `${sign}${abs / scale}.${String(abs % scale).padStart(4, '0')}`;
}
function parseMoney(value: string, scale: bigint): bigint {
  const negative = value.trim().startsWith('-');
  const normalized = negative ? value.trim().slice(1) : value.trim();
  const [whole = '0', fraction = ''] = normalized.split('.');
  const amount = BigInt(whole || '0') * scale + BigInt(`${fraction}0000`.slice(0, 4) || '0');
  return negative ? -amount : amount;
}
function displayMoney(value: string): string {
  const [whole, fraction = '00'] = value.split('.');
  return `${whole}.${fraction.slice(0, 2).padEnd(2, '0')}`;
}

function toCtx(ctx: ErpToolContext, branchId?: string): RequestContext {
  return {
    requestId: ctx.requestId ?? '',
    authSubject: ctx.userId,
    userId: ctx.userId,
    companyId: ctx.companyId,
    membershipId: ctx.membershipId ?? '',
    roles: [],
    permissions: ctx.permissions,
    scopes: { branchIds: branchId ? [branchId] : ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

function hasAllPermissions(ctx: ErpToolContext, permissions: string[]): boolean {
  return permissions.every((permission) => ctx.permissions.includes(permission));
}

function branchOutsideScope(ctx: ErpToolContext, branchId?: string): boolean {
  return Boolean(branchId && ctx.branchIds && !ctx.branchIds.includes(branchId));
}

function profileSourceRef(companyId: string, profile: TaxCodeProfileDto, asOf: string): SourceRef {
  return {
    label: `Tax Code profile ${profile.sourceProfileKey}`,
    module: 'tax',
    entityType: 'tax_code_profile',
    entityId: profile.id,
    asOf,
    permissionChecked: true,
    webPath: `/companies/${companyId}/settings/tax-codes`,
  };
}

function summarySourceRef(companyId: string, summary: TransactionTaxAgentSummaryDto, asOf: string): SourceRef {
  const run = summary.latestReconciliation;
  return {
    label: run ? `กระทบยอดภาษี ${run.formType} ${run.periodKey}` : `สรุปภาษี ${summary.periodKey ?? 'ล่าสุด'}`,
    module: 'tax',
    entityType: run ? 'tax_reconciliation' : 'tax_summary',
    ...(run ? { entityId: run.id } : {}),
    asOf,
    permissionChecked: true,
    webPath: `/companies/${companyId}/tax`,
  };
}

function safeProfile(profile: TaxCodeProfileDto) {
  return {
    name: profile.name,
    sourceSystem: profile.sourceSystem,
    sourceProfileKey: profile.sourceProfileKey,
    countryCode: profile.countryCode,
    sapClient: profile.sapClient,
    sapCompanyCode: profile.sapCompanyCode,
    isDefault: profile.isDefault,
    status: profile.status,
    effectiveFrom: profile.effectiveFrom,
    effectiveTo: profile.effectiveTo,
    version: profile.version,
    roundingMode: profile.roundingMode,
    roundingScale: profile.roundingScale,
    taxAmountTolerance: profile.taxAmountTolerance,
  };
}

function safeDefinition(definition: TaxCodeDefinitionDto) {
  return {
    externalCode: definition.externalCode,
    displayName: definition.displayName,
    taxRegime: definition.taxRegime,
    direction: definition.direction,
    treatment: definition.treatment,
    transactionContexts: definition.transactionContexts,
    rate: definition.rate,
    calculationMethod: definition.calculationMethod,
    sapAccountKey: definition.sapAccountKey,
    claimabilityDefault: definition.claimabilityDefault,
    evidenceRuleKey: definition.evidenceRuleKey,
    status: definition.status,
    effectiveFrom: definition.effectiveFrom,
    effectiveTo: definition.effectiveTo,
    version: definition.version,
  };
}

function taxSourceRef(companyId: string, periodId: string, periodKey: string, asOf: string): SourceRef {
  return {
    label: `งวดภาษี ${periodKey}`,
    module: 'tax',
    entityType: 'tax_period',
    entityId: periodId,
    asOf,
    permissionChecked: true,
    webPath: `/companies/${companyId}/tax`,
  };
}

function taxAggregateRef(companyId: string, entityType: string, label: string, asOf: string): SourceRef {
  return { label, module: 'tax', entityType, asOf, permissionChecked: true, webPath: `/companies/${companyId}/tax` };
}

// ── tax.get_upcoming_tax_obligations ────────────────────────────────────────

@Injectable()
export class TaxGetUpcomingObligationsTool implements ErpReadToolPort {
  toolName = 'tax.get_upcoming_tax_obligations';
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('tax.period.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const { items } = await this.taxRepo.findPeriods(ctx.companyId, { status: 'OPEN', pageSize: 20 });
    const upcoming = items.filter(p => p.dueDate);
    const sourceRefs: SourceRef[] = upcoming.map(p => taxSourceRef(ctx.companyId, p.id, p.periodKey, asOf));
    if (sourceRefs.length === 0) sourceRefs.push(taxAggregateRef(ctx.companyId, 'tax_obligation_list', 'ภาระภาษีที่กำลังจะถึงกำหนด', asOf));
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        total: upcoming.length,
        obligations: upcoming.map(p => ({
          formType: p.formType,
          periodKey: p.periodKey,
          status: p.status,
          dueDate: p.dueDate,
          webPath: `/companies/${ctx.companyId}/tax`,
        })),
        disclaimer: 'ข้อมูลนี้เป็นการสรุปเพื่อแจ้งเตือนเท่านั้น กรุณายืนยันกับนักบัญชีหรือสรรพากรก่อนดำเนินการ',
      },
    };
  }
}

// ── tax.get_vat_summary ──────────────────────────────────────────────────────

@Injectable()
export class TaxGetVatSummaryTool implements ErpReadToolPort {
  toolName = 'tax.get_vat_summary';
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('tax.period.read') || !ctx.permissions.includes('tax.event.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const periodKey = input.periodKey ?? civilPeriodKey(todayCivilDate());
    const period = await this.taxRepo.findPeriod(ctx.companyId, 'PP30', periodKey);
    if (!period) {
      return { toolName: this.toolName, status: 'ok', asOf, sourceRefs: [taxAggregateRef(ctx.companyId, 'vat_period_query', `VAT ${periodKey}`, asOf)], data: { periodKey, message: 'ยังไม่มีข้อมูล VAT งวดนี้', disclaimer: 'ซิงค์ข้อมูลก่อนหรือตรวจสอบกับนักบัญชี' } };
    }
    const events = await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE');
    const vatOut = addMoney(events.filter(e => e.eventType === 'VAT_OUTPUT').map(e => e.taxAmount));
    const vatIn = addMoney(events.filter(e => e.eventType === 'VAT_INPUT').map(e => e.taxAmount));
    const sourceRefs: SourceRef[] = [taxSourceRef(ctx.companyId, period.id, periodKey, asOf)];
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        periodKey, status: period.status,
        vatOutput: displayMoney(vatOut), vatInput: displayMoney(vatIn), netVat: displayMoney(subtractMoney(vatOut, vatIn)),
        eventCount: events.length, currency: 'THB',
        disclaimer: 'ข้อมูลสรุปนี้ยังไม่ผ่านการรับรองจากนักบัญชี กรุณาตรวจสอบและยืนยันก่อนยื่นแบบ',
      },
    };
  }
}

// ── tax.get_wht_summary ──────────────────────────────────────────────────────

@Injectable()
export class TaxGetWhtSummaryTool implements ErpReadToolPort {
  toolName = 'tax.get_wht_summary';
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string; formType?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('tax.period.read') || !ctx.permissions.includes('tax.event.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const periodKey = input.periodKey ?? civilPeriodKey(todayCivilDate());
    const formType = (input.formType === 'PND3' ? 'PND3' : 'PND53') as 'PND3' | 'PND53';
    const period = await this.taxRepo.findPeriod(ctx.companyId, formType, periodKey);
    if (!period) {
      return { toolName: this.toolName, status: 'ok', asOf, sourceRefs: [taxAggregateRef(ctx.companyId, 'wht_period_query', `${formType} ${periodKey}`, asOf)], data: { periodKey, formType, message: 'ยังไม่มีข้อมูล WHT งวดนี้' } };
    }
    const events = await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE');
    const totalWithheld = addMoney(events.map(e => e.taxAmount));
    const payeeIds = new Set(events.map(e => e.payeeSnapshot?.taxId ?? e.sourceId)).size;
    const sourceRefs: SourceRef[] = [taxSourceRef(ctx.companyId, period.id, periodKey, asOf)];
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        periodKey, formType, status: period.status,
        totalWithheld: displayMoney(totalWithheld), payeeCount: payeeIds,
        eventCount: events.length, currency: 'THB',
        disclaimer: 'ไม่แสดงรายละเอียดผู้รับเงิน กรุณาตรวจสอบในระบบหรือกับนักบัญชี',
      },
    };
  }
}

// ── tax.get_cit_calendar ─────────────────────────────────────────────────────

@Injectable()
export class TaxGetCitCalendarTool implements ErpReadToolPort {
  toolName = 'tax.get_cit_calendar';
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(ctx: ErpToolContext): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('tax.period.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const { items } = await this.taxRepo.findPeriods(ctx.companyId, { taxType: 'CIT', pageSize: 10 });
    const sourceRefs: SourceRef[] = items.map(p => taxSourceRef(ctx.companyId, p.id, p.periodKey, asOf));
    if (sourceRefs.length === 0) sourceRefs.push(taxAggregateRef(ctx.companyId, 'cit_calendar', 'ปฏิทินภาษีเงินได้นิติบุคคล', asOf));
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        citPeriods: items.map(p => ({ formType: p.formType, periodKey: p.periodKey, status: p.status, dueDate: p.dueDate })),
        disclaimer: 'ปฏิทิน CIT นี้เป็นการประมาณการเท่านั้น SME ต้องยืนยันกับนักบัญชีหรือที่ปรึกษาภาษีก่อนยื่นแบบ',
      },
    };
  }
}

// ── tax.list_missing_tax_documents ───────────────────────────────────────────

@Injectable()
export class TaxListMissingDocumentsTool implements ErpReadToolPort {
  toolName = 'tax.list_missing_tax_documents';
  constructor(private readonly taxRepo: PrismaTaxRepository) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string }): Promise<ToolResult> {
    const asOf = now();
    if (!ctx.permissions.includes('tax.period.read') || !ctx.permissions.includes('tax.review_issue.read')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const periodKey = input.periodKey ?? civilPeriodKey(todayCivilDate());
    // Find all open BLOCKING issues for any period in this month
    const { items } = await this.taxRepo.findPeriods(ctx.companyId, { pageSize: 10 });
    const targetPeriods = items.filter(p => p.periodKey === periodKey || p.periodKey.startsWith(periodKey));
    let totalBlocking = 0;
    const sourceRefs: SourceRef[] = [];
    for (const period of targetPeriods) {
      const issues = await this.taxRepo.findIssuesByPeriod(ctx.companyId, period.id, { status: 'OPEN', severity: 'BLOCKING' });
      totalBlocking += issues.length;
      if (issues.length > 0) sourceRefs.push(taxSourceRef(ctx.companyId, period.id, period.periodKey, asOf));
    }
    if (sourceRefs.length === 0) sourceRefs.push(taxAggregateRef(ctx.companyId, 'missing_tax_document_query', `เอกสารภาษีที่ขาด ${periodKey}`, asOf));
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: {
        periodKey, blockingIssueCount: totalBlocking,
        message: totalBlocking > 0
          ? `พบปัญหา ${totalBlocking} รายการที่ต้องแก้ไขก่อนยื่นแบบภาษี — กรุณาตรวจสอบในระบบ`
          : 'ไม่พบปัญหาเอกสารที่ค้างอยู่ในงวดนี้',
      },
    };
  }
}

// ── tax.get_tax_code_profile ───────────────────────────────────────────────

@Injectable()
export class TaxGetTaxCodeProfileTool implements ErpReadToolPort {
  toolName = 'tax.get_tax_code_profile';

  constructor(private readonly taxConfig: TransactionTaxConfigUseCase) {}

  async execute(ctx: ErpToolContext, input: {
    externalCode?: string;
    sourceProfileKey?: string;
    direction?: string;
    effectiveDate?: string;
  } = {}): Promise<ToolResult> {
    const asOf = now();
    if (!hasAllPermissions(ctx, ['tax.profile.read', 'tax.config.read'])) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const effectiveDate = input.effectiveDate ?? asOf;
    const activeProfiles = await this.taxConfig.listProfiles(toCtx(ctx), { status: 'ACTIVE', effectiveDate });
    const profiles = input.sourceProfileKey
      ? activeProfiles.filter((profile) => profile.sourceProfileKey === input.sourceProfileKey)
      : activeProfiles;
    const sourceRefs = profiles.map((profile) => profileSourceRef(ctx.companyId, profile, asOf));
    if (sourceRefs.length === 0) sourceRefs.push(taxAggregateRef(ctx.companyId, 'tax_code_profile_query', 'Tax Code profile', asOf));

    if (profiles.length !== 1) {
      return {
        toolName: this.toolName,
        status: 'ok',
        asOf,
        sourceRefs,
        data: {
          reviewRequired: true,
          reasonCode: profiles.length === 0 ? 'NO_MATCHING_ACTIVE_PROFILE' : 'AMBIGUOUS_ACTIVE_PROFILE',
          effectiveDate,
          candidates: profiles.map(safeProfile),
          message: profiles.length === 0
            ? 'ไม่พบ Tax Code profile ที่ active ตามเงื่อนไข ต้องให้ผู้ดูแลภาษีตรวจสอบ'
            : 'พบ Tax Code profile มากกว่าหนึ่งชุด ต้องระบุ sourceProfileKey ก่อนตีความ Tax Code',
        },
      };
    }

    const profile = profiles[0]!;
    const definitions = input.externalCode
      ? await this.taxConfig.listDefinitions(toCtx(ctx), {
          profileId: profile.id,
          externalCode: input.externalCode,
          direction: input.direction,
          effectiveDate,
          status: 'ACTIVE',
        })
      : [];
    const definitionAmbiguous = Boolean(input.externalCode) && definitions.length !== 1;

    return {
      toolName: this.toolName,
      status: 'ok',
      asOf,
      sourceRefs,
      data: {
        reviewRequired: definitionAmbiguous,
        ...(definitionAmbiguous ? {
          reasonCode: definitions.length === 0 ? 'NO_MATCHING_TAX_CODE' : 'AMBIGUOUS_TAX_CODE',
          message: definitions.length === 0
            ? 'ไม่พบ Tax Code ที่ active ใน profile และวันที่ที่ระบุ'
            : 'พบ Tax Code หลายความหมาย ต้องระบุ direction หรือบริบทเอกสารก่อน',
        } : {}),
        effectiveDate,
        profile: safeProfile(profile),
        definition: definitions.length === 1 ? safeDefinition(definitions[0]!) : null,
        candidates: definitions.length > 1 ? definitions.map(safeDefinition) : [],
        disclaimer: 'ความหมาย SAP Tax Code ผูกกับ company profile และ effective date ห้ามสรุปจากรหัสอย่างเดียว',
      },
    };
  }
}

// ── tax.get_transaction_tax_summary ────────────────────────────────────────

@Injectable()
export class TaxGetTransactionTaxSummaryTool implements ErpReadToolPort {
  toolName = 'tax.get_transaction_tax_summary';

  constructor(private readonly getSummary: GetTransactionTaxAgentSummaryUseCase) {}

  async execute(ctx: ErpToolContext, input: {
    periodKey?: string;
    formType?: string;
    transactionContext?: string;
    branchId?: string;
  } = {}): Promise<ToolResult> {
    const asOf = now();
    const required = ['tax.profile.read', 'tax.period.read', 'tax.report.read', 'tax.event.read', 'tax.review_issue.read'];
    if (!hasAllPermissions(ctx, required) || branchOutsideScope(ctx, input.branchId)) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const supportedForms = ['PP30', 'PP36', 'CUSTOMS_SUPPORT'];
    const unsupportedFormFilter = Boolean(input.formType && !supportedForms.includes(input.formType));
    const summary = await this.getSummary.execute(toCtx(ctx, input.branchId), unsupportedFormFilter ? {} : {
      periodKey: input.periodKey,
      formType: input.formType,
      transactionContext: input.transactionContext,
    });
    const periodMismatch = Boolean(input.periodKey && input.periodKey !== summary.periodKey);
    const eventCount = summary.componentSummary.reduce((total, item) => total + item.eventCount, 0);
    const noEvents = !unsupportedFormFilter && !periodMismatch && eventCount === 0;
    const reconciliation = summary.latestReconciliation;
    const missingReconciliation = !unsupportedFormFilter && !periodMismatch && !reconciliation;
    const reconciliationNotReviewed = Boolean(reconciliation && (reconciliation.status !== 'REVIEWED' || reconciliation.blockingIssueCount > 0));
    const evidenceReviewPendingCount = summary.evidenceReviewPendingCount ?? 0;
    const evidenceReviewPending = evidenceReviewPendingCount > 0
      || summary.componentSummary.some((item) => item.evidencePendingCount > 0);
    const reviewRequired = !summary.profile || unsupportedFormFilter || periodMismatch || noEvents || missingReconciliation
      || reconciliationNotReviewed || summary.needsReviewCount > 0 || evidenceReviewPending;

    return {
      toolName: this.toolName,
      status: 'ok',
      asOf,
      sourceRefs: [summarySourceRef(ctx.companyId, summary, asOf)],
      data: {
        coverage: input.formType ? `REQUESTED_${input.formType}_SNAPSHOT` : 'LATEST_TRANSACTION_TAX_SNAPSHOT',
        reviewRequired,
        ...(reviewRequired ? {
          reasonCodes: [
            ...(!summary.profile ? ['NO_SNAPSHOT_PROFILE'] : []),
            ...(unsupportedFormFilter ? ['UNSUPPORTED_FORM'] : []),
            ...(periodMismatch || noEvents ? ['NO_EVENTS_FOR_REQUESTED_PERIOD'] : []),
            ...(missingReconciliation ? ['NO_RECONCILIATION_RUN'] : []),
            ...(reconciliation && reconciliation.status !== 'REVIEWED' ? ['RECONCILIATION_NOT_REVIEWED'] : []),
            ...(summary.needsReviewCount > 0 || (reconciliation?.blockingIssueCount ?? 0) > 0 ? ['BLOCKING_RECONCILIATION_ISSUES'] : []),
            ...(evidenceReviewPending ? ['EVIDENCE_REVIEW_PENDING'] : []),
          ],
        } : {}),
        requestedFilters: {
          periodKey: input.periodKey ?? null,
          formType: input.formType ?? null,
          transactionContext: input.transactionContext ?? null,
          branchId: input.branchId ?? null,
        },
        filtersApplied: {
          branchId: true,
          periodKey: (!input.periodKey || !periodMismatch) && !noEvents,
          formType: !input.formType || !unsupportedFormFilter,
          transactionContext: true,
        },
        actualPeriodKey: summary.periodKey,
        profile: summary.profile && !periodMismatch ? safeProfile(summary.profile) : null,
        pp30: unsupportedFormFilter || periodMismatch ? null : summary.pp30,
        components: unsupportedFormFilter || periodMismatch ? [] : summary.componentSummary,
        needsReviewCount: summary.needsReviewCount,
        evidenceReviewPendingCount,
        permissionChecked: summary.permissionChecked,
        disclaimer: 'สรุปจาก Tax Event snapshot ตามงวด แบบ บริบท และขอบเขตสาขาที่ขอ รายการหลักฐานค้างต้องตรวจในหน้าภาษี',
      },
    };
  }
}

// ── tax.get_reconciliation_summary ────────────────────────────────────────────

@Injectable()
export class TaxGetReconciliationSummaryTool implements ErpReadToolPort {
  toolName = 'tax.get_reconciliation_summary';

  constructor(private readonly getSummary: GetTransactionTaxAgentSummaryUseCase) {}

  async execute(ctx: ErpToolContext, input: { periodKey?: string; formType?: string; branchId?: string } = {}): Promise<ToolResult> {
    const asOf = now();
    const required = ['tax.profile.read', 'tax.period.read', 'tax.report.read', 'tax.event.read', 'ledger.journal.read', 'tax.review_issue.read'];
    if (!hasAllPermissions(ctx, required) || branchOutsideScope(ctx, input.branchId)) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const supportedForms = ['PP30', 'PP36', 'CUSTOMS_SUPPORT'];
    const unsupportedForm = Boolean(input.formType && !supportedForms.includes(input.formType));
    const summary = await this.getSummary.execute(toCtx(ctx, input.branchId), unsupportedForm ? {} : { periodKey: input.periodKey, formType: input.formType });
    const run = summary.latestReconciliation;
    const periodMismatch = Boolean(input.periodKey && input.periodKey !== run?.periodKey);
    const formMismatch = Boolean(input.formType && input.formType !== run?.formType);
    const reviewRequired = unsupportedForm || !run || periodMismatch || formMismatch || run.status === 'NEEDS_REVIEW' || run.blockingIssueCount > 0;

    return {
      toolName: this.toolName,
      status: 'ok',
      asOf,
      sourceRefs: run && !periodMismatch && !formMismatch
        ? [summarySourceRef(ctx.companyId, summary, asOf)]
        : [taxAggregateRef(ctx.companyId, 'tax_reconciliation_query', 'ผลกระทบยอดภาษี', asOf)],
      data: {
        coverage: 'LATEST_RECONCILIATION_RUN',
        reviewRequired,
        ...(reviewRequired ? {
          reasonCodes: [
            ...(!run ? ['NO_RECONCILIATION_RUN'] : []),
            ...(unsupportedForm ? ['UNSUPPORTED_FORM'] : []),
            ...(periodMismatch ? ['REQUESTED_PERIOD_NOT_LATEST'] : []),
            ...(formMismatch ? ['REQUESTED_FORM_NOT_LATEST'] : []),
            ...(run?.status === 'NEEDS_REVIEW' || (run?.blockingIssueCount ?? 0) > 0 ? ['BLOCKING_RECONCILIATION_ISSUES'] : []),
          ],
        } : {}),
        reconciliation: run && !periodMismatch && !formMismatch ? {
          id: run.id,
          branchId: run.branchId,
          formType: run.formType,
          periodKey: run.periodKey,
          status: run.status,
          blockingIssueCount: run.blockingIssueCount,
          createdAt: run.createdAt,
          reviewedAt: run.reviewedAt,
        } : null,
        needsReviewCount: summary.needsReviewCount,
        permissionChecked: summary.permissionChecked,
        disclaimer: 'เป็นผลกระทบยอดล่าสุดแบบอ่านอย่างเดียว AI ไม่สร้างรอบใหม่ ไม่แก้ issue และไม่ยื่นแบบ',
      },
    };
  }
}
