import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  CreateTaxCodeProfileInput,
  CreateTradeTaxEvidenceInput,
  RequestContext,
  ResolveTransactionTaxPreviewDto,
  TransactionTaxAgentSummaryDto,
  TransactionTaxContext,
  TransactionTaxDirection,
  TransactionTaxLineInput,
  TransactionTaxRoundingPolicy,
  TransactionTaxSnapshot,
  TaxProfileSetupBlocker,
  TaxProfileSetupReadiness,
  UpsertTaxAccountDeterminationRuleInput,
  UpsertTaxCodeDefinitionInput,
  UpsertTaxReportMappingRuleInput,
} from '@watchdog-bms/contracts';
import Decimal from 'decimal.js';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { normalizeTaxRoundingPolicy, resolveTransactionTaxPreview } from '../../domain/logic/transaction-tax.logic';
import { missingConfiguration, ruleCoversDefinition, validateAccountRuleSemantic, validateReportRuleSemantic, validateTaxCodeDefinition } from '../../domain/logic/tax-configuration.logic';
import { findTaxCodeProfileTemplate, TAX_CODE_PROFILE_TEMPLATES } from '../../domain/tax-code-template.catalog';
import { resolveTaxEvidencePolicy, taxEvidencePolicyAllowedTypes, taxEvidencePolicyComplete } from '../../domain/logic/tax-evidence-policy.logic';
import { PrismaTransactionTaxRepository } from '../../infrastructure/repositories/prisma-transaction-tax.repository';
import type { LegacyTaxRemediationSourceType } from '../../infrastructure/repositories/prisma-transaction-tax.repository';
import { todayCivilDate } from '@watchdog-bms/contracts';

export type LegacyTaxRemediationInput = {
  sourceType: LegacyTaxRemediationSourceType;
  sourceId: string;
  lines: Array<{
    sourceLineId: string;
    taxCodeDefinitionId: string;
    transactionContext: TransactionTaxContext;
    evidenceRefs?: string[];
  }>;
};

type InternalTaxResolution = {
  authoritativeSelfAssessedTaxBaseAmount?: string;
  authoritativeSelfAssessedTaxAmount?: string;
  historicalSnapshot?: TransactionTaxSnapshot;
};

const PROFILE_READINESS_BLOCKER_LIMIT = 500;

export type LegacyTaxRemediationPreview = {
  sourceType: LegacyTaxRemediationSourceType;
  sourceId: string;
  canApply: boolean;
  blockers: string[];
  sourceUpdatedAt: string;
  lines: Array<{
    sourceLineId: string;
    previous: {
      taxCodeDefinitionId: string | null;
      externalTaxCode: string | null;
      taxRegime: string | null;
      taxDirection: string | null;
      taxTreatment: string | null;
      taxContext: string | null;
      taxRate: string;
      taxBaseAmount: string;
      taxAmount: string;
    };
    preview: ResolveTransactionTaxPreviewDto;
    errors: string[];
    expectedUpdatedAt: string;
  }>;
};

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

function assertBranch(ctx: RequestContext, branchId?: string): string[] | undefined {
  const allowed = ctx.scopes.branchIds;
  if (branchId && allowed && !allowed.includes(branchId)) throw new ForbiddenException('Branch is outside the granted scope');
  return allowed;
}

function assertSourcePermission(ctx: RequestContext, sourceType: string): void {
  const candidates = sourceType.startsWith('expense.') ? ['expense.read', 'expense.read_own', 'expense.create', 'expense.update', 'expense.review']
    : sourceType.startsWith('procurement.') ? ['procurement.vendor_bill.read', 'procurement.vendor_bill.create', 'procurement.vendor_bill.direct_entry', 'procurement.vendor_bill.approve']
      : sourceType.startsWith('accounting.') ? ['accounting.document.read', 'accounting.document.create', 'accounting.document.update', 'accounting.quotation.create', 'accounting.invoice.create'] : null;
  if (!candidates) throw new ForbiddenException('Unsupported or unauthorized tax evidence source');
  if (!candidates.some((permission) => ctx.permissions.includes(permission))) {
    throw new ForbiddenException(`Missing source permission: ${candidates[0]}`);
  }
}

function assertLegacyRemediationSourcePermission(ctx: RequestContext, sourceType: LegacyTaxRemediationSourceType): void {
  const permission = sourceType === 'accounting.document' ? 'accounting.document.read'
    : sourceType === 'expense.record' ? 'expense.read' : 'procurement.vendor_bill.read';
  requirePermission(ctx, permission);
}

function canSelectForContext(ctx: RequestContext, context?: string): boolean {
  if (ctx.permissions.includes('tax.config.read')) return true;
  if (context?.includes('SALE') || context?.startsWith('EXPORT_') || context === 'RETURN_OR_CREDIT' || context === 'DEBIT_ADJUSTMENT') {
    return ['accounting.document.create', 'accounting.document.update', 'accounting.quotation.create', 'accounting.invoice.create'].some((permission) => ctx.permissions.includes(permission));
  }
  if (context?.includes('PURCHASE') || context?.startsWith('IMPORT_')) {
    return ['expense.create', 'expense.update', 'expense.review', 'procurement.vendor_bill.create', 'procurement.vendor_bill.direct_entry'].some((permission) => ctx.permissions.includes(permission));
  }
  return false;
}

function allowedSourcePrefixes(ctx: RequestContext): string[] {
  const prefixes: string[] = [];
  if (ctx.permissions.includes('accounting.document.read')) prefixes.push('accounting.');
  if (ctx.permissions.includes('expense.read') || ctx.permissions.includes('expense.read_own')) prefixes.push('expense.');
  if (ctx.permissions.includes('procurement.vendor_bill.read')) prefixes.push('procurement.');
  if (!prefixes.length) throw new ForbiddenException('No source permission for trade tax evidence');
  return prefixes;
}

function sameDecimal(left: string, right: string): boolean {
  try { return new Decimal(left).eq(right); } catch { return false; }
}

function validateRoundingPolicy(policy: Partial<TransactionTaxRoundingPolicy>): TransactionTaxRoundingPolicy {
  try { return normalizeTaxRoundingPolicy(policy); }
  catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'invalid_tax_rounding_policy'); }
}

function canonicalLegacyRate(sourceType: LegacyTaxRemediationSourceType, value: string): string {
  const rate = new Decimal(value || 0);
  // ExpenseLine historically stores 7% as 0.07; item11B snapshots use percent units (7).
  return sourceType === 'expense.record' && !rate.isZero() && rate.abs().lte(1) ? rate.mul(100).toString() : rate.toString();
}

@Injectable()
export class TransactionTaxConfigUseCase {
  constructor(
    private readonly repo: PrismaTransactionTaxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  private get db(): any { return this.repo.prisma.client as any; }

  private profileOverlaps(profile: Awaited<ReturnType<PrismaTransactionTaxRepository['findProfile']>>, active: Awaited<ReturnType<PrismaTransactionTaxRepository['listProfiles']>>): TaxProfileSetupBlocker[] {
    if (!profile) return [];
    const from = new Date(profile.effectiveFrom).getTime();
    const to = profile.effectiveTo ? new Date(profile.effectiveTo).getTime() : Infinity;
    const overlaps = (item: typeof profile) => from <= (item.effectiveTo ? new Date(item.effectiveTo).getTime() : Infinity)
      && to >= new Date(item.effectiveFrom).getTime();
    const sameIdentity = (item: typeof profile) => item.sourceSystem === profile.sourceSystem
      && item.sourceProfileKey === profile.sourceProfileKey
      && item.sapClient === profile.sapClient
      && item.sapCompanyCode === profile.sapCompanyCode;
    const blockers: TaxProfileSetupBlocker[] = [];
    if (active.some((item) => item.id !== profile.id && sameIdentity(item) && overlaps(item))) {
      blockers.push({ code: 'overlapping_active_profile_identity', kind: 'PROFILE_OVERLAP' });
    }
    if (profile.isDefault && active.some((item) => item.id !== profile.id && item.isDefault
      && item.sourceSystem === profile.sourceSystem && item.sapClient === profile.sapClient
      && item.sapCompanyCode === profile.sapCompanyCode && overlaps(item))) {
      blockers.push({ code: 'overlapping_default_profile', kind: 'PROFILE_OVERLAP' });
    }
    return blockers;
  }

  private async configurationIssues(companyId: string, definitions: Awaited<ReturnType<PrismaTransactionTaxRepository['listDefinitions']>>) {
    const issues: Array<{ blocker: TaxProfileSetupBlocker; message: string }> = [];
    for (const definition of definitions) {
      const base = { taxCodeDefinitionId: definition.id, externalTaxCode: definition.externalCode };
      for (const message of validateTaxCodeDefinition(definition)) {
        issues.push({ blocker: { ...base, code: 'invalid_tax_code_definition', kind: 'DEFINITION' }, message: `${definition.externalCode}:${message}` });
      }
      const reportRules = (await this.repo.listReportRules(companyId, { taxCodeDefinitionId: definition.id })).filter((rule) => rule.status !== 'RETIRED');
      const accountRules = (await this.repo.listAccountRules(companyId, { taxCodeDefinitionId: definition.id })).filter((rule) => rule.status !== 'RETIRED');
      for (const missing of missingConfiguration(definition, accountRules, reportRules)) {
        const [kind, first, second, third] = missing.split(/[:/]/);
        const blocker: TaxProfileSetupBlocker = kind === 'account'
          ? { ...base, code: 'missing_account_rule', kind: 'ACCOUNT_RULE', accountRole: first as TaxProfileSetupBlocker['accountRole'], postingSide: second as TaxProfileSetupBlocker['postingSide'] }
          : { ...base, code: 'missing_report_rule', kind: 'REPORT_RULE', formType: first as TaxProfileSetupBlocker['formType'], boxKey: second, amountSource: third as TaxProfileSetupBlocker['amountSource'] };
        issues.push({ blocker, message: `${definition.externalCode}:${missing}` });
      }
      for (const rule of accountRules) {
        const message = validateAccountRuleSemantic(definition, rule);
        if (message) issues.push({ blocker: { ...base, code: 'invalid_account_rule', kind: 'ACCOUNT_RULE', accountRole: rule.accountRole, postingSide: rule.postingSide }, message: `${definition.externalCode}:${message}` });
        if (!ruleCoversDefinition(definition, rule)) issues.push({ blocker: { ...base, code: 'account_rule_effective_window_incomplete', kind: 'EFFECTIVE_WINDOW', accountRole: rule.accountRole, postingSide: rule.postingSide }, message: `${definition.externalCode}:account_rule_effective_window_incomplete` });
      }
      for (const rule of reportRules) {
        const message = validateReportRuleSemantic(definition, rule);
        if (message) issues.push({ blocker: { ...base, code: 'invalid_report_rule', kind: 'REPORT_RULE', formType: rule.formType, boxKey: rule.boxKey, amountSource: rule.amountSource }, message: `${definition.externalCode}:${message}` });
        if (!ruleCoversDefinition(definition, rule)) issues.push({ blocker: { ...base, code: 'report_rule_effective_window_incomplete', kind: 'EFFECTIVE_WINDOW', formType: rule.formType, boxKey: rule.boxKey, amountSource: rule.amountSource }, message: `${definition.externalCode}:report_rule_effective_window_incomplete` });
      }
    }
    return issues;
  }

  private async assertCompanyBranch(ctx: RequestContext, branchId?: string, db: any = this.db): Promise<void> {
    assertBranch(ctx, branchId);
    if (branchId && !(await db.branch.findFirst({ where: { id: branchId, companyId: ctx.companyId }, select: { id: true } }))) {
      throw new ForbiddenException('Branch is outside the company');
    }
  }

  private async sourceRecord(companyId: string, sourceType: string, sourceId: string, sourceLineId?: string | null): Promise<{ branchId: string | null } | null> {
    if (sourceType === 'accounting.document') {
      const row = await this.db.accountingDocument.findFirst({ where: { id: sourceId, companyId }, select: { branchId: true, lines: sourceLineId ? { where: { id: sourceLineId }, select: { id: true } } : false } });
      return row && (!sourceLineId || row.lines?.length === 1) ? row : null;
    }
    if (sourceType === 'expense.record') {
      const row = await this.db.expenseRecord.findFirst({ where: { id: sourceId, companyId }, select: { branchId: true, lines: sourceLineId ? { where: { id: sourceLineId }, select: { id: true } } : false } });
      return row && (!sourceLineId || row.lines?.length === 1) ? row : null;
    }
    if (sourceType === 'procurement.vendor_bill') {
      const row = await this.db.vendorBill.findFirst({ where: { id: sourceId, companyId }, select: { branchId: true, lines: sourceLineId ? { where: { id: sourceLineId }, select: { id: true } } : false } });
      return row && (!sourceLineId || row.lines?.length === 1) ? row : null;
    }
    return null;
  }

  listProfiles(ctx: RequestContext, filters: Parameters<PrismaTransactionTaxRepository['listProfiles']>[1]) {
    requirePermission(ctx, 'tax.profile.read');
    return this.repo.listProfiles(ctx.companyId, filters);
  }

  listProfileTemplates(ctx: RequestContext) {
    requirePermission(ctx, 'tax.profile.read');
    return TAX_CODE_PROFILE_TEMPLATES.map((template) => ({
      key: template.key,
      name: template.name,
      sourceSystem: template.sourceSystem,
      sourceUrl: template.sourceUrl,
      warning: template.warning,
      definitionCount: template.definitions.length,
    }));
  }

  async createProfileFromTemplate(ctx: RequestContext, templateKey: string, effectiveFrom?: string) {
    requirePermission(ctx, 'tax.profile.manage');
    requirePermission(ctx, 'tax.config.manage');
    const template = findTaxCodeProfileTemplate(templateKey);
    if (!template) throw new NotFoundException('Tax Code profile template not found');
    const start = effectiveFrom ?? todayCivilDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(new Date(start).getTime())) {
      throw new BadRequestException('effectiveFrom must be a valid YYYY-MM-DD date');
    }
    const result = await this.repo.createProfileFromTemplate(ctx.companyId, template, start, ctx.userId);
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.code_profile.template_bootstrap',
      targetType: 'tax_code_profile',
      targetId: result.profile.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { templateKey, effectiveFrom: start, created: result.created, definitionCount: template.definitions.length },
    });
    return { ...result, warning: template.warning };
  }

  async createProfile(ctx: RequestContext, input: CreateTaxCodeProfileInput) {
    requirePermission(ctx, 'tax.profile.manage');
    validateRoundingPolicy(input);
    if (new Date(input.effectiveFrom) > new Date(input.effectiveTo ?? '9999-12-31')) throw new BadRequestException('effectiveTo must be on or after effectiveFrom');
    if (input.sourceSystem.startsWith('SAP_') && !input.sourceUrl) throw new UnprocessableEntityException('SAP profile requires a source URL or imported source evidence');
    const existing = await this.repo.listProfiles(ctx.companyId, { sourceSystem: input.sourceSystem });
    const from = new Date(input.effectiveFrom).getTime();
    const to = input.effectiveTo ? new Date(input.effectiveTo).getTime() : Infinity;
    if (existing.some((profile) => profile.status !== 'RETIRED' && profile.sourceProfileKey === input.sourceProfileKey
      && profile.sapClient === (input.sapClient ?? null) && profile.sapCompanyCode === (input.sapCompanyCode ?? null)
      && from <= (profile.effectiveTo ? new Date(profile.effectiveTo).getTime() : Infinity) && to >= new Date(profile.effectiveFrom).getTime())) {
      throw new ConflictException('Tax profile identity overlaps an existing effective window');
    }
    const profile = await this.repo.createProfile(ctx.companyId, input, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.code_profile.create', targetType: 'tax_code_profile', targetId: profile.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { sourceSystem: profile.sourceSystem, sourceProfileKey: profile.sourceProfileKey, roundingMode: profile.roundingMode, roundingScale: profile.roundingScale, taxAmountTolerance: profile.taxAmountTolerance } });
    return profile;
  }

  async updateProfile(ctx: RequestContext, id: string, input: Partial<CreateTaxCodeProfileInput>) {
    requirePermission(ctx, 'tax.profile.manage');
    const current = await this.repo.findProfile(ctx.companyId, id);
    if (!current) throw new NotFoundException('Tax code profile not found');
    if (current.status !== 'DRAFT') throw new ConflictException('Only DRAFT profiles can be edited');
    validateRoundingPolicy({
      roundingMode: input.roundingMode ?? current.roundingMode,
      roundingScale: input.roundingScale ?? current.roundingScale,
      taxAmountTolerance: input.taxAmountTolerance ?? current.taxAmountTolerance,
    });
    const updated = await this.repo.updateProfile(ctx.companyId, id, input);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.code_profile.update', targetType: 'tax_code_profile', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH' });
    return updated;
  }

  async activateProfile(ctx: RequestContext, id: string) {
    requirePermission(ctx, 'tax.profile.manage');
    requirePermission(ctx, 'tax.config.manage');
    const profile = await this.repo.findProfile(ctx.companyId, id);
    if (!profile) throw new NotFoundException('Tax code profile not found');
    validateRoundingPolicy(profile);
    const active = await this.repo.listProfiles(ctx.companyId, { status: 'ACTIVE' });
    const overlapBlockers = this.profileOverlaps(profile, active);
    if (overlapBlockers.some((item) => item.code === 'overlapping_active_profile_identity')) throw new ConflictException('Another active profile with the same SAP/source identity overlaps this effective window');
    if (overlapBlockers.some((item) => item.code === 'overlapping_default_profile')) throw new ConflictException('Another default profile overlaps this source identity effective window');
    const definitions = await this.repo.listDefinitions(ctx.companyId, { profileId: id });
    if (!definitions.length) throw new UnprocessableEntityException('Profile has no Tax Code definitions');
    const errors = (await this.configurationIssues(ctx.companyId, definitions)).map((issue) => issue.message);
    if (errors.length) throw new UnprocessableEntityException({ code: 'tax_profile_incomplete', errors });
    const activated = await this.repo.setProfileStatus(ctx.companyId, id, 'ACTIVE', ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.code_profile.activate', targetType: 'tax_code_profile', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { definitionCount: definitions.length } });
    await this.outbox.append('tax.code_profile.activated', 'tax_code_profile', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'tax_code_profile', aggregateId: id, occurredAt: new Date().toISOString(), data: { profileId: id } });
    return activated;
  }

  async getProfileReadiness(ctx: RequestContext, id: string): Promise<TaxProfileSetupReadiness> {
    requirePermission(ctx, 'tax.profile.read');
    requirePermission(ctx, 'tax.config.read');
    const profile = await this.repo.findProfile(ctx.companyId, id);
    if (!profile) throw new NotFoundException('Tax code profile not found');
    const [definitions, active] = await Promise.all([
      this.repo.listDefinitions(ctx.companyId, { profileId: id }),
      this.repo.listProfiles(ctx.companyId, { status: 'ACTIVE' }),
    ]);
    const configurationBlockers: TaxProfileSetupBlocker[] = definitions.length
      ? (await this.configurationIssues(ctx.companyId, definitions)).map((issue) => issue.blocker)
      : [{ code: 'profile_has_no_definitions', kind: 'DEFINITION' }];
    const allBlockers = [...this.profileOverlaps(profile, active), ...configurationBlockers];
    const warnings: TaxProfileSetupReadiness['warnings'] = profile.status === 'ACTIVE'
      ? [{ code: 'profile_already_active' }]
      : [];
    if (allBlockers.length > PROFILE_READINESS_BLOCKER_LIMIT) warnings.push({ code: 'profile_readiness_blockers_truncated' });
    return {
      profileId: profile.id,
      profileStatus: profile.status,
      definitionCount: definitions.length,
      activeDefinitionCount: definitions.filter((definition) => definition.status === 'ACTIVE').length,
      canActivate: profile.status === 'DRAFT' && allBlockers.length === 0,
      blockers: allBlockers.slice(0, PROFILE_READINESS_BLOCKER_LIMIT),
      warnings,
    };
  }

  async retireProfile(ctx: RequestContext, id: string) {
    requirePermission(ctx, 'tax.profile.manage');
    const retired = await this.repo.setProfileStatus(ctx.companyId, id, 'RETIRED', ctx.userId);
    if (!retired) throw new NotFoundException('Tax code profile not found');
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.code_profile.retire', targetType: 'tax_code_profile', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL' });
    return retired;
  }

  listDefinitions(ctx: RequestContext, filters: NonNullable<Parameters<PrismaTransactionTaxRepository['listDefinitions']>[1]> = {}) {
    if (!canSelectForContext(ctx, filters.transactionContext)) throw new ForbiddenException('Missing tax config or applicable source permission');
    const configReader = ctx.permissions.includes('tax.config.read');
    return this.repo.listDefinitions(ctx.companyId, configReader ? filters : { ...filters, status: 'ACTIVE', effectiveDate: filters.effectiveDate ?? new Date().toISOString() });
  }

  async upsertDefinition(ctx: RequestContext, input: UpsertTaxCodeDefinitionInput) {
    requirePermission(ctx, 'tax.config.manage');
    const profile = await this.repo.findProfile(ctx.companyId, input.profileId);
    if (!profile) throw new NotFoundException('Tax code profile not found');
    if (profile.status !== 'DRAFT') throw new ConflictException('Definitions of an activated profile are immutable; create a new effective version');
    if (!['VAT', 'IMPORT_VAT'].includes(input.taxRegime)) throw new UnprocessableEntityException('VAT Tax Code profiles cannot overload WHT, CIT, customs, excise, or other statutory components');
    const semanticErrors = validateTaxCodeDefinition(input);
    if (semanticErrors.length) throw new UnprocessableEntityException({ code: 'invalid_tax_code_semantics', errors: semanticErrors });
    if (input.id) {
      const current = (await this.repo.listDefinitions(ctx.companyId, { profileId: input.profileId })).find((definition) => definition.id === input.id);
      if (!current) throw new NotFoundException('Tax Code definition not found in this company/profile');
    }
    if (profile.sourceSystem.startsWith('SAP_') && !/^[A-Z0-9]{2}$/.test(input.externalCode.toUpperCase())) throw new BadRequestException('SAP Tax Code must be two alphanumeric characters');
    const overlaps = await this.repo.listDefinitions(ctx.companyId, { profileId: input.profileId, externalCode: input.externalCode, direction: input.direction });
    const from = new Date(input.effectiveFrom).getTime();
    const to = input.effectiveTo ? new Date(input.effectiveTo).getTime() : Infinity;
    if (overlaps.some((definition) => definition.id !== input.id && from <= (definition.effectiveTo ? new Date(definition.effectiveTo).getTime() : Infinity) && to >= new Date(definition.effectiveFrom).getTime())) {
      throw new ConflictException('Tax Code effective window overlaps an existing definition');
    }
    const definition = await this.repo.upsertDefinition(ctx.companyId, input, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: input.id ? 'tax.code_definition.update' : 'tax.code_definition.create', targetType: 'tax_code_definition', targetId: definition.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { externalCode: definition.externalCode, version: definition.version } });
    return definition;
  }

  listAccountRules(ctx: RequestContext, filters: NonNullable<Parameters<PrismaTransactionTaxRepository['listAccountRules']>[1]> = {}) {
    requirePermission(ctx, 'ledger.posting-rule.read');
    return this.repo.listAccountRules(ctx.companyId, filters);
  }

  async upsertAccountRule(ctx: RequestContext, input: UpsertTaxAccountDeterminationRuleInput) {
    requirePermission(ctx, 'tax.config.manage');
    requirePermission(ctx, 'ledger.posting-rule.manage');
    const definition = input.taxCodeDefinitionId ? (await this.repo.listDefinitions(ctx.companyId, {})).find((item) => item.id === input.taxCodeDefinitionId) : undefined;
    if (!definition) throw new UnprocessableEntityException('Tax account rules must reference a company Tax Code definition');
    const semanticError = validateAccountRuleSemantic(definition, input);
    if (semanticError) throw new UnprocessableEntityException(semanticError);
    const allAccountRules = await this.repo.listAccountRules(ctx.companyId, {});
    const from = new Date(input.effectiveFrom).getTime();
    const to = input.effectiveTo ? new Date(input.effectiveTo).getTime() : Infinity;
    const overlaps = allAccountRules.some((rule) => rule.id !== input.id && rule.status !== 'RETIRED'
      && rule.taxCodeDefinitionId === input.taxCodeDefinitionId && rule.taxRegime === input.taxRegime
      && rule.direction === input.direction && rule.treatment === input.treatment
      && rule.transactionContext === input.transactionContext && rule.sourceModule === input.sourceModule
      && rule.accountRole === input.accountRole
      && from <= (rule.effectiveTo ? new Date(rule.effectiveTo).getTime() : Infinity) && to >= new Date(rule.effectiveFrom).getTime());
    if (overlaps) throw new ConflictException('Tax account rule effective window overlaps an equivalent rule');
    if (input.id) {
      const current = allAccountRules.find((rule) => rule.id === input.id);
      if (!current) throw new NotFoundException('Tax account rule not found');
      if (current.status === 'ACTIVE') throw new ConflictException('Active account rules are immutable; create a new effective version');
    }
    const account = await (this.repo.prisma.client as any).chartOfAccount.findFirst({ where: { id: input.accountId, OR: [{ companyId: ctx.companyId }, { companyId: null, isSystem: true }], status: 'ACTIVE', isPosting: true } });
    if (!account) throw new UnprocessableEntityException('Account is missing, inactive, outside company, or not posting-enabled');
    const result = await this.repo.upsertAccountRule(ctx.companyId, input, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.account_rule.update', targetType: 'tax_account_rule', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { accountRole: result.accountRole, accountId: result.accountId, postingSide: result.postingSide } });
    return result;
  }

  listReportRules(ctx: RequestContext, filters: NonNullable<Parameters<PrismaTransactionTaxRepository['listReportRules']>[1]> = {}) {
    requirePermission(ctx, 'tax.config.read');
    return this.repo.listReportRules(ctx.companyId, filters);
  }

  async upsertReportRule(ctx: RequestContext, input: UpsertTaxReportMappingRuleInput) {
    requirePermission(ctx, 'tax.config.manage');
    const definition = (await this.repo.listDefinitions(ctx.companyId, {})).find((item) => item.id === input.taxCodeDefinitionId);
    if (!definition) throw new NotFoundException('Tax Code definition not found');
    const semanticError = validateReportRuleSemantic(definition, input);
    if (semanticError) throw new UnprocessableEntityException(semanticError);
    const allReportRules = await this.repo.listReportRules(ctx.companyId, { taxCodeDefinitionId: input.taxCodeDefinitionId });
    const from = new Date(input.effectiveFrom).getTime();
    const to = input.effectiveTo ? new Date(input.effectiveTo).getTime() : Infinity;
    const overlaps = allReportRules.some((rule) => rule.id !== input.id && rule.status !== 'RETIRED'
      && rule.formType === input.formType && rule.boxKey === input.boxKey && rule.amountSource === input.amountSource
      && from <= (rule.effectiveTo ? new Date(rule.effectiveTo).getTime() : Infinity) && to >= new Date(rule.effectiveFrom).getTime());
    if (overlaps) throw new ConflictException('Tax report mapping effective window overlaps an equivalent mapping');
    if (input.id) {
      const current = allReportRules.find((rule) => rule.id === input.id);
      if (!current) throw new NotFoundException('Tax report rule not found');
      if (current.status === 'ACTIVE') throw new ConflictException('Active report rules are immutable; create a new effective version');
    }
    const result = await this.repo.upsertReportRule(ctx.companyId, input, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.report_rule.update', targetType: 'tax_report_rule', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { formType: result.formType, boxKey: result.boxKey } });
    return result;
  }

  private async buildPreview(
    ctx: RequestContext,
    input: TransactionTaxLineInput,
    profileId?: string,
    direction?: TransactionTaxDirection,
    sourceModule?: string,
    db: any = this.db,
    internal?: InternalTaxResolution,
  ) {
    if (input.sourceType === 'tax.configuration') requirePermission(ctx, 'tax.config.read');
    else assertSourcePermission(ctx, input.sourceType);
    await this.assertCompanyBranch(ctx, input.branchId, db);
    const company = await db.company.findUnique({ where: { id: ctx.companyId }, select: { baseCurrency: true } });
    if (!company) throw new NotFoundException('Company not found');
    const sourceCurrency = input.currency.toUpperCase();
    const baseCurrency = String(company.baseCurrency).toUpperCase();
    const profiles = internal?.historicalSnapshot ? [] : await this.repo.listProfiles(ctx.companyId, { status: 'ACTIVE', effectiveDate: input.documentDate }, db);
    const definitionId = input.taxCodeDefinitionId ?? internal?.historicalSnapshot?.taxCodeDefinitionId ?? undefined;
    const explicitDefinition = definitionId
      ? (await this.repo.listDefinitions(ctx.companyId, {}, db)).find((definition) => definition.id === definitionId)
      : undefined;
    if (definitionId && !explicitDefinition) throw new UnprocessableEntityException('Tax Code definition is outside this company');
    const historicalProfile = internal?.historicalSnapshot && explicitDefinition
      ? await this.repo.findProfile(ctx.companyId, explicitDefinition.profileId, db)
      : undefined;
    const selected = historicalProfile ?? (profileId
      ? profiles.find((profile) => profile.id === profileId && (!explicitDefinition || explicitDefinition.profileId === profile.id))
      : explicitDefinition ? profiles.find((profile) => profile.id === explicitDefinition.profileId)
        : profiles.length === 1 ? profiles[0] : undefined);
    if (internal?.historicalSnapshot && (!selected
      || selected.sourceProfileKey !== internal.historicalSnapshot.taxProfileKey
      || selected.version !== internal.historicalSnapshot.taxProfileVersion
      || explicitDefinition?.externalCode !== internal.historicalSnapshot.externalTaxCode)) {
      throw new ConflictException('pp36_historical_tax_snapshot_changed');
    }
    if (!selected) throw new UnprocessableEntityException(profiles.length ? 'Tax profile is ambiguous' : 'No active Tax Code profile');
    const roundingPolicy = {
      roundingMode: internal?.historicalSnapshot?.roundingMode ?? selected.roundingMode,
      roundingScale: internal?.historicalSnapshot?.roundingScale ?? selected.roundingScale,
      taxAmountTolerance: internal?.historicalSnapshot?.taxAmountTolerance ?? selected.taxAmountTolerance,
    };
    const [definitions, accountRules, reportRules] = await Promise.all([
      this.repo.listDefinitions(ctx.companyId, { profileId: selected.id, effectiveDate: input.documentDate }, db),
      this.repo.listAccountRules(ctx.companyId, { effectiveDate: input.documentDate }, db),
      this.repo.listReportRules(ctx.companyId, { effectiveDate: input.documentDate }, db),
    ]);
    let trustedInput: TransactionTaxLineInput = {
      ...input,
      currency: sourceCurrency,
      taxCurrency: baseCurrency,
      exchangeRate: sourceCurrency === baseCurrency ? '1' : undefined,
      exchangeRateSource: sourceCurrency === baseCurrency ? 'FUNCTIONAL_CURRENCY' : undefined,
      exchangeRateDate: sourceCurrency === baseCurrency ? input.documentDate : undefined,
      taxCodeDefinitionId: explicitDefinition?.id ?? input.taxCodeDefinitionId,
      authoritativeSelfAssessedTaxBaseAmount: internal?.authoritativeSelfAssessedTaxBaseAmount,
      authoritativeSelfAssessedTaxAmount: internal?.authoritativeSelfAssessedTaxAmount,
      ...(input.transactionContext === 'IMPORT_SERVICE' ? { pp36InputClaimEvidenceVerified: false } : {}),
    };
    let trustedEvidence: any[] = [];
    const trustErrors: string[] = [];
    const resolvedDefinition = definitions.find((item) => item.id === input.taxCodeDefinitionId || item.externalCode.toUpperCase() === input.externalTaxCode?.toUpperCase());
    const resolvedEvidencePolicy = resolveTaxEvidencePolicy(input.transactionContext, resolvedDefinition?.evidenceRuleKey);
    trustErrors.push(...resolvedEvidencePolicy.errors);
    const allowedEvidenceTypes = taxEvidencePolicyAllowedTypes(resolvedEvidencePolicy.policy);
    let evidenceComplete = taxEvidencePolicyComplete(resolvedEvidencePolicy.policy, []);
    if (input.evidenceRefs?.length) {
      const evidence = await db.tradeTaxEvidence.findMany({ where: { companyId: ctx.companyId, id: { in: input.evidenceRefs } } });
      const valid = evidence.filter((item: any) => item.status === 'VERIFIED' && item.reviewedByUserId && item.reviewedAt
        && item.sourceType === input.sourceType && item.sourceId === input.sourceId
        && (input.transactionContext === 'IMPORT_GOODS' ? item.sourceLineId === input.sourceLineId : (!item.sourceLineId || item.sourceLineId === input.sourceLineId))
        && item.transactionContext === input.transactionContext
        && (item.branchId ?? null) === (input.branchId ?? null)
        && allowedEvidenceTypes.has(item.evidenceType));
      if (valid.length !== new Set(input.evidenceRefs).size) throw new UnprocessableEntityException('Tax evidence must be verified and match this company, source line, context, branch, and evidence rule');
      trustedEvidence = valid;
      const authoritative = (field: string): string | undefined => {
        const values = [...new Set<string>(valid.map((item: any) => String(item[field] ?? '0')).filter((value: string) => Number(value) !== 0))];
        if (values.length > 1) throw new ConflictException(`Verified evidence has conflicting ${field} amounts`);
        return values[0] ?? '0';
      };
      evidenceComplete = taxEvidencePolicyComplete(resolvedEvidencePolicy.policy, valid.map((item: any) => item.evidenceType));
      if (!evidenceComplete) trustErrors.push('required_evidence_types_incomplete');
      trustedInput = {
        ...trustedInput, evidenceRefs: evidenceComplete ? valid.map((item: any) => item.id) : [],
        pp36InputClaimEvidenceVerified: input.transactionContext === 'IMPORT_SERVICE'
          && evidenceComplete && valid.some((item: any) => item.evidenceType === 'PP36_RECEIPT'),
        authoritativeCustomsValue: authoritative('customsValue') ?? input.authoritativeCustomsValue,
        authoritativeDutyAmount: authoritative('dutyAmount') ?? input.authoritativeDutyAmount,
        authoritativeExciseAmount: authoritative('exciseAmount') ?? input.authoritativeExciseAmount,
        authoritativeOtherTaxAmount: authoritative('otherTaxAmount') ?? input.authoritativeOtherTaxAmount,
        authoritativeImportVatAmount: authoritative('importVatAmount') ?? input.authoritativeImportVatAmount,
      };
    }
    if (!input.evidenceRefs?.length && !evidenceComplete) trustErrors.push('required_evidence_types_incomplete');
    if (['IMPORT_GOODS', 'IMPORT_SERVICE'].includes(input.transactionContext) && !trustedEvidence.length) trustedInput = { ...trustedInput, evidenceRefs: [] };
    if (input.transactionContext === 'IMPORT_SERVICE' && !input.paymentDate) trustErrors.push('pp36_payment_date_required');
    if (input.transactionContext === 'IMPORT_SERVICE' && input.paymentDate
      && trustedEvidence.some((item) => item.evidenceType !== 'PP36_RECEIPT' && new Date(item.evidenceDate) > new Date(input.paymentDate!))) {
      trustErrors.push('pp36_payment_evidence_date_after_payment_date');
    }
    if (sourceCurrency !== baseCurrency) {
      const preferredEvidenceType = input.transactionContext === 'IMPORT_GOODS' ? 'CUSTOMS_ENTRY' : 'PAYMENT_EVIDENCE';
      const fxEvidence = trustedEvidence.filter((item) => item.evidenceType === preferredEvidenceType && new Decimal(item.exchangeRate ?? 0).gt(0));
      const tuples = [...new Map(fxEvidence.map((item) => {
        const date = new Date(item.evidenceDate).toISOString().slice(0, 10);
        const rate = String(item.exchangeRate);
        const source = String(item.exchangeRateSource ?? '').trim();
        return [`${rate}|${source}|${date}`, { rate, source, date }];
      })).values()];
      if (tuples.length !== 1 || !tuples[0]!.source) trustErrors.push('functional_currency_fx_required');
      else trustedInput = { ...trustedInput, taxCurrency: baseCurrency, exchangeRate: tuples[0]!.rate, exchangeRateSource: tuples[0]!.source, exchangeRateDate: tuples[0]!.date };
    }
    const preview = resolveTransactionTaxPreview({
      definitions, accountRules, reportRules, input: trustedInput, profileId: selected.id, direction, sourceModule,
      profileKey: selected.sourceProfileKey, profileVersion: selected.version,
      roundingPolicy,
    });
    preview.errors = [...new Set([...preview.errors, ...trustErrors])];
    return preview;
  }

  async resolveSourceTax(
    ctx: RequestContext,
    input: TransactionTaxLineInput,
    mode: 'DRAFT' | 'FINAL',
    profileId?: string,
    direction?: TransactionTaxDirection,
    sourceModule?: string,
    internal?: InternalTaxResolution,
  ) {
    const preview = await this.buildPreview(ctx, input, profileId, direction, sourceModule, this.db, internal);
    if (mode === 'FINAL' && preview.errors.length) throw new UnprocessableEntityException({ code: 'transaction_tax_needs_review', preview });
    return preview;
  }

  async resolveSourceTaxInTransaction(ctx: RequestContext, input: TransactionTaxLineInput, mode: 'DRAFT' | 'FINAL', db: any, profileId?: string, direction?: TransactionTaxDirection, sourceModule?: string, internal?: InternalTaxResolution) {
    const preview = await this.buildPreview(ctx, input, profileId, direction, sourceModule, db, internal);
    if (mode === 'FINAL' && preview.errors.length) throw new UnprocessableEntityException({ code: 'transaction_tax_needs_review', preview });
    return preview;
  }

  async resolvePreview(ctx: RequestContext, input: TransactionTaxLineInput, profileId?: string, direction?: TransactionTaxDirection, sourceModule?: string) {
    return this.buildPreview(ctx, input, profileId, direction, sourceModule);
  }

  async previewLegacyRemediation(ctx: RequestContext, input: LegacyTaxRemediationInput): Promise<LegacyTaxRemediationPreview> {
    requirePermission(ctx, 'tax.config.manage');
    requirePermission(ctx, 'tax.review_issue.resolve');
    assertLegacyRemediationSourcePermission(ctx, input.sourceType);
    const source = await this.repo.findLegacyRemediationSource(ctx.companyId, input.sourceType, input.sourceId);
    if (!source) throw new NotFoundException('Legacy tax-remediation source not found');
    await this.assertCompanyBranch(ctx, source.branchId ?? undefined);
    if (!source.lines.length) throw new UnprocessableEntityException('Source has no legacy scalar tax snapshots awaiting remediation');
    const selectedIds = input.lines.map((line) => line.sourceLineId);
    if (new Set(selectedIds).size !== selectedIds.length) throw new BadRequestException('Legacy remediation line selections must be unique');
    const candidates = new Map(source.lines.map((line) => [line.id, line]));
    if (selectedIds.length !== candidates.size || selectedIds.some((id) => !candidates.has(id))) {
      throw new UnprocessableEntityException('Every legacy scalar tax line must be selected explicitly');
    }

    const lines: LegacyTaxRemediationPreview['lines'] = [];
    for (const selection of input.lines) {
      const current = candidates.get(selection.sourceLineId)!;
      const direction: TransactionTaxDirection = input.sourceType === 'accounting.document'
        ? 'OUTPUT' : selection.transactionContext === 'IMPORT_SERVICE' ? 'SELF_ASSESSED' : 'INPUT';
      const sourceModule = input.sourceType === 'accounting.document' ? 'accounting' : input.sourceType === 'expense.record' ? 'expense' : 'procurement';
      const preview = await this.buildPreview(ctx, {
        branchId: source.branchId ?? undefined,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceLineId: current.id,
        transactionContext: selection.transactionContext,
        documentDate: source.documentDate,
        currency: source.currency,
        taxCodeDefinitionId: selection.taxCodeDefinitionId,
        netAmount: current.netAmount,
        grossAmount: current.grossAmount,
        enteredTaxAmount: current.enteredTaxAmount,
        evidenceRefs: selection.evidenceRefs,
        accountHint: current.accountHint,
      }, undefined, direction, sourceModule);
      const errors = [...preview.errors];
      if (!selection.taxCodeDefinitionId) errors.push('explicit_tax_code_definition_required');
      if (current.externalTaxCode && preview.snapshot.externalTaxCode !== current.externalTaxCode) errors.push('legacy_external_tax_code_must_be_preserved');
      if (current.sourceExternalTaxCode && preview.snapshot.externalTaxCode !== current.sourceExternalTaxCode) errors.push('source_external_tax_code_mismatch');
      if (current.externalTaxCode === 'O0' && !['EXPORT_GOODS', 'EXPORT_SERVICE'].includes(selection.transactionContext)) errors.push('legacy_o0_requires_explicit_export_context');
      if (current.taxRegime && preview.snapshot.taxRegime !== current.taxRegime) errors.push('legacy_tax_regime_mismatch');
      if (current.taxDirection && preview.snapshot.taxDirection !== current.taxDirection) errors.push('legacy_tax_direction_mismatch');
      const sourceRate = canonicalLegacyRate(input.sourceType, current.sourceVatRate);
      const snapshotRate = canonicalLegacyRate(input.sourceType, current.taxRate);
      if (!sameDecimal(sourceRate, snapshotRate)) errors.push('source_tax_rate_changed_after_migration');
      if (!sameDecimal(snapshotRate, preview.snapshot.taxRate)) errors.push('legacy_tax_rate_mismatch');
      if (!sameDecimal(current.taxBaseAmount, preview.snapshot.taxBaseAmount)) errors.push('legacy_tax_base_mismatch');
      if (!sameDecimal(current.transactionTaxAmount, preview.snapshot.taxAmount)) errors.push('legacy_tax_amount_mismatch');
      if (!preview.components.length) errors.push('resolved_tax_components_required');
      lines.push({
        sourceLineId: current.id,
        previous: {
          taxCodeDefinitionId: current.taxCodeDefinitionId,
          externalTaxCode: current.externalTaxCode,
          taxRegime: current.taxRegime,
          taxDirection: current.taxDirection,
          taxTreatment: current.taxTreatment,
          taxContext: current.taxContext,
          taxRate: current.taxRate,
          taxBaseAmount: current.taxBaseAmount,
          taxAmount: current.transactionTaxAmount,
        },
        preview,
        errors: [...new Set(errors)],
        expectedUpdatedAt: current.updatedAt,
      });
    }
    return {
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      canApply: source.blockers.length === 0 && lines.every((line) => line.errors.length === 0),
      blockers: source.blockers,
      sourceUpdatedAt: source.updatedAt,
      lines,
    };
  }

  async applyLegacyRemediation(ctx: RequestContext, input: LegacyTaxRemediationInput) {
    const preview = await this.previewLegacyRemediation(ctx, input);
    if (!preview.canApply) throw new UnprocessableEntityException({ code: 'legacy_transaction_tax_remediation_blocked', preview });
    try {
      await this.repo.applyLegacyRemediation(ctx.companyId, input.sourceType, input.sourceId, preview.sourceUpdatedAt, preview.lines.map((line) => ({
        sourceLineId: line.sourceLineId,
        expectedUpdatedAt: line.expectedUpdatedAt,
        preview: line.preview,
      })));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('legacy_remediation_')) throw new ConflictException('Legacy tax source changed or became locked; preview again');
      throw error;
    }
    await this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.legacy_remediation.apply',
      targetType: input.sourceType, targetId: input.sourceId, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: {
        lineCount: preview.lines.length,
        taxCodeDefinitionIds: [...new Set(preview.lines.map((line) => line.preview.snapshot.taxCodeDefinitionId).filter(Boolean))],
        sourceChecksums: preview.lines.map((line) => line.preview.sourceChecksum),
        configurationChecksums: preview.lines.map((line) => line.preview.configurationChecksum),
      },
    });
    await this.outbox.append('tax.legacy_remediation.applied', input.sourceType, input.sourceId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: input.sourceType, aggregateId: input.sourceId, occurredAt: new Date().toISOString(),
      data: { lineCount: preview.lines.length },
    });
    return { ...preview, applied: true };
  }

  async listVerifiedEvidenceIdsForSource(ctx: RequestContext, input: Pick<TransactionTaxLineInput, 'sourceType' | 'sourceId' | 'sourceLineId' | 'transactionContext' | 'branchId'> & { evidenceTypes?: string[] }, db: any = this.db): Promise<string[]> {
    assertSourcePermission(ctx, input.sourceType);
    await this.assertCompanyBranch(ctx, input.branchId, db);
    const rows = await db.tradeTaxEvidence.findMany({ where: {
      companyId: ctx.companyId, sourceType: input.sourceType, sourceId: input.sourceId,
      ...(input.transactionContext === 'IMPORT_GOODS'
        ? { sourceLineId: input.sourceLineId }
        : { OR: [{ sourceLineId: null }, { sourceLineId: input.sourceLineId }] }),
      transactionContext: input.transactionContext,
      branchId: input.branchId ?? null, status: 'VERIFIED',
      ...(input.evidenceTypes?.length ? { evidenceType: { in: input.evidenceTypes } } : {}),
    }, select: { id: true } });
    return rows.map((row: any) => row.id);
  }

  async listEvidence(ctx: RequestContext, filters: NonNullable<Parameters<PrismaTransactionTaxRepository['listEvidence']>[2]> = {}) {
    requirePermission(ctx, 'tax.config.read');
    await this.assertCompanyBranch(ctx, filters.branchId);
    if (filters.sourceType) assertSourcePermission(ctx, filters.sourceType);
    return this.repo.listEvidence(ctx.companyId, ctx.scopes.branchIds, filters, allowedSourcePrefixes(ctx));
  }

  async createEvidence(ctx: RequestContext, input: CreateTradeTaxEvidenceInput) {
    if (!ctx.permissions.includes('tax.config.manage') && !ctx.permissions.includes('tax.review_issue.resolve')) {
      throw new ForbiddenException('Missing permission: tax.review_issue.resolve');
    }
    await this.assertCompanyBranch(ctx, input.branchId ?? undefined);
    assertSourcePermission(ctx, input.sourceType);
    if (!input.referenceNumber.trim() || !input.attachmentIds.length) throw new UnprocessableEntityException('Reference number and attachment evidence are required');
    if ((input.transactionContext === 'IMPORT_GOODS' || input.evidenceType === 'PP36_RECEIPT') && !input.sourceLineId) {
      throw new UnprocessableEntityException('Customs and PP36 receipt evidence must bind one exact source line to prevent duplicated tax claims');
    }
    const source = await this.sourceRecord(ctx.companyId, input.sourceType, input.sourceId, input.sourceLineId);
    if (!source) throw new UnprocessableEntityException('Evidence source or source line does not exist in this company');
    if ((source.branchId ?? null) !== (input.branchId ?? null)) throw new UnprocessableEntityException('Evidence branch must match its source');
    const saleContext = input.transactionContext.includes('SALE') || input.transactionContext.startsWith('EXPORT_') || ['RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT'].includes(input.transactionContext);
    if (saleContext !== input.sourceType.startsWith('accounting.')) throw new UnprocessableEntityException('Evidence context is incompatible with its source module');
    for (const amount of [input.customsValue, input.dutyAmount, input.exciseAmount, input.otherTaxAmount, input.importVatAmount]) {
      if (Number(amount) < 0) throw new UnprocessableEntityException('Authoritative tax evidence amounts cannot be negative');
    }
    if (input.transactionContext === 'IMPORT_GOODS' && Number(input.customsValue) <= 0) throw new UnprocessableEntityException('Import-goods evidence requires a positive customs value');
    const attachmentCount = await (this.repo.prisma.client as any).attachmentObject.count({ where: { companyId: ctx.companyId, id: { in: input.attachmentIds }, status: 'ACTIVE' } });
    if (attachmentCount !== new Set(input.attachmentIds).size) throw new UnprocessableEntityException('Every attachment must be active and owned by the company');
    const duplicate = await this.repo.listEvidence(ctx.companyId, undefined, { sourceType: input.sourceType, sourceId: input.sourceId }, allowedSourcePrefixes(ctx));
    if (duplicate.some((item) => item.evidenceType === input.evidenceType && item.referenceNumber.toUpperCase() === input.referenceNumber.trim().toUpperCase())) throw new ConflictException('Evidence reference is already linked');
    if (['CUSTOMS_ENTRY', 'PP36_RECEIPT', 'EXPORT_DECLARATION'].includes(input.evidenceType)) {
      const reused = await this.db.tradeTaxEvidence.findFirst({ where: { companyId: ctx.companyId, evidenceType: input.evidenceType, referenceNumber: input.referenceNumber.trim().toUpperCase() }, select: { id: true } });
      if (reused) throw new ConflictException('Authoritative evidence reference is already used by another source');
    }
    const result = await this.repo.createEvidence(ctx.companyId, input, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.trade_evidence.create', targetType: 'trade_tax_evidence', targetId: result.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { transactionContext: result.transactionContext, referenceNumber: result.referenceNumber } });
    return result;
  }

  async verifyEvidence(ctx: RequestContext, id: string, status: 'VERIFIED' | 'REJECTED') {
    requirePermission(ctx, 'tax.config.manage');
    const current = await this.repo.findEvidence(ctx.companyId, id);
    if (!current) throw new NotFoundException('Trade tax evidence not found');
    await this.assertCompanyBranch(ctx, current.branchId ?? undefined);
    assertSourcePermission(ctx, current.sourceType);
    if (status === 'VERIFIED') {
      const attachmentIds = [...new Set(current.attachmentIds)];
      const attachmentCount = await this.db.attachmentObject.count({ where: {
        companyId: ctx.companyId, id: { in: attachmentIds }, status: 'ACTIVE',
      } });
      if (!attachmentIds.length || attachmentCount !== attachmentIds.length) {
        throw new UnprocessableEntityException('Every attachment must still be active and owned by the company');
      }
    }
    const result = await this.repo.verifyEvidence(ctx.companyId, id, ctx.userId, status);
    if (!result) throw new NotFoundException('Trade tax evidence not found');
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: status === 'VERIFIED' ? 'tax.trade_evidence.verify' : 'tax.trade_evidence.reject', targetType: 'trade_tax_evidence', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { status } });
    await this.outbox.append('tax.trade_evidence.reviewed', 'trade_tax_evidence', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'trade_tax_evidence', aggregateId: id, occurredAt: new Date().toISOString(), data: { status } });
    return result;
  }
}

@Injectable()
export class GetCompanyTaxCodeProfileUseCase {
  constructor(private readonly repo: PrismaTransactionTaxRepository) {}
  async execute(ctx: RequestContext) {
    requirePermission(ctx, 'tax.profile.read');
    const profiles = await this.repo.listProfiles(ctx.companyId, { status: 'ACTIVE', effectiveDate: new Date().toISOString() });
    return profiles.length === 1 ? profiles[0] : null;
  }
}

@Injectable()
export class GetTransactionTaxAgentSummaryUseCase {
  constructor(private readonly repo: PrismaTransactionTaxRepository) {}
  async execute(ctx: RequestContext, filters: { periodKey?: string; formType?: string; transactionContext?: string } = {}): Promise<TransactionTaxAgentSummaryDto> {
    requirePermission(ctx, 'tax.profile.read');
    requirePermission(ctx, 'tax.report.read');
    return this.repo.latestAgentSummary(ctx.companyId, assertBranch(ctx), filters);
  }
}
