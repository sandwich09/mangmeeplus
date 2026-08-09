import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CreateTaxCodeProfileInput,
  CreateTradeTaxEvidenceInput,
  RequestContext,
  TransactionTaxDirection,
  TransactionTaxLineInput,
  TaxReportForm,
  UpsertTaxAccountDeterminationRuleInput,
  UpsertTaxCodeDefinitionInput,
  UpsertTaxReportMappingRuleInput,
} from '@watchdog-bms/contracts';
import {
  CreateTaxProfileFromTemplateDto,
  GenerateTaxReconciliationDto,
  ResolveTransactionTaxPreviewDto,
  ReviewTaxReconciliationDto,
  VerifyTradeTaxEvidenceDto,
} from './transaction-tax.dtos';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { taxReviewerViolation } from '../../domain/logic/tax-reviewer.logic';
import { TransactionTaxConfigUseCase } from '../../application/use-cases/transaction-tax-config.use-case';
import type { LegacyTaxRemediationInput } from '../../application/use-cases/transaction-tax-config.use-case';
import { TransactionTaxReconciliationUseCase } from '../../application/use-cases/transaction-tax-reconciliation.use-case';
import { TaxCodeImportUseCase, type TaxCodeImportInput } from '../../application/use-cases/tax-code-import.use-case';

@ApiTags('transaction-tax')
@Controller('companies/:companyId/tax')
export class TransactionTaxController {
  constructor(
    private readonly useCase: TransactionTaxConfigUseCase,
    private readonly reconciliation: TransactionTaxReconciliationUseCase,
    private readonly codeImport: TaxCodeImportUseCase,
    private readonly taxRepo: PrismaTaxRepository,
  ) {}

  /**
   * GAP-04: reviewing a reconciliation run certifies the tax control that gates
   * period close and filing — the same tax-reviewer duty as resolving review
   * issues, so it takes the same company taxReviewerRole gate (OWNER override).
   */
  private async assertTaxReviewerRole(ctx: RequestContext): Promise<void> {
    const profile = await this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId } });
    const violation = taxReviewerViolation(ctx.roles, profile?.taxReviewerRole);
    if (violation) throw new ForbiddenException({ code: 'tax_reviewer_role_required', message: violation });
  }

  @Get('code-profiles')
  @RequirePermissions('tax.profile.read')
  @ApiOperation({ summary: 'List effective-dated SAP/WatchDog Tax Code profiles' })
  listProfiles(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query('sourceSystem') sourceSystem?: string, @Query('status') status?: string, @Query('effectiveDate') effectiveDate?: string) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.listProfiles(ctx, { sourceSystem, status, effectiveDate });
  }

  @Get('code-profile-templates')
  @RequirePermissions('tax.profile.read')
  listProfileTemplates(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.listProfileTemplates(ctx);
  }

  @Post('code-profile-templates/:templateKey')
  @RequirePermissions('tax.profile.manage', 'tax.config.manage')
  createProfileFromTemplate(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('templateKey') templateKey: string,
    @Body() body: CreateTaxProfileFromTemplateDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.createProfileFromTemplate(ctx, templateKey, body.effectiveFrom);
  }

  @Post('code-profiles')
  @RequirePermissions('tax.profile.manage')
  createProfile(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateTaxCodeProfileInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.createProfile(ctx, body);
  }

  @Patch('code-profiles/:profileId')
  @RequirePermissions('tax.profile.manage')
  updateProfile(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('profileId') profileId: string, @Body() body: Partial<CreateTaxCodeProfileInput>) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.updateProfile(ctx, profileId, body);
  }

  @Get('code-profiles/:profileId/readiness')
  @RequirePermissions('tax.profile.read', 'tax.config.read')
  getProfileReadiness(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('profileId') profileId: string) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.getProfileReadiness(ctx, profileId);
  }

  @Post('code-profiles/:profileId/activate')
  @HttpCode(200)
  @RequirePermissions('tax.profile.manage')
  activateProfile(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('profileId') profileId: string) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.activateProfile(ctx, profileId);
  }

  @Post('code-profiles/:profileId/retire')
  @HttpCode(200)
  @RequirePermissions('tax.profile.manage')
  retireProfile(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('profileId') profileId: string) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.retireProfile(ctx, profileId);
  }

  @Post('code-profiles/:profileId/import-preview')
  @HttpCode(200)
  @RequirePermissions('tax.config.manage')
  previewProfileImport(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('profileId') profileId: string, @Body() body: Omit<TaxCodeImportInput, 'profileId'>) {
    assertRouteCompany(ctx, companyId);
    return this.codeImport.preview(ctx, { ...body, profileId });
  }

  @Post('code-profiles/:profileId/import-apply')
  @HttpCode(200)
  @RequirePermissions('tax.config.manage')
  applyProfileImport(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('profileId') profileId: string, @Body() body: Omit<TaxCodeImportInput, 'profileId'>) {
    assertRouteCompany(ctx, companyId);
    return this.codeImport.apply(ctx, { ...body, profileId });
  }

  @Get('code-definitions')
  @RequirePermissions('company.branch.read')
  listDefinitions(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('profileId') profileId?: string,
    @Query('externalCode') externalCode?: string,
    @Query('direction') direction?: string,
    @Query('transactionContext') transactionContext?: string,
    @Query('status') status?: string,
    @Query('effectiveDate') effectiveDate?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.listDefinitions(ctx, { profileId, externalCode, direction, transactionContext, status, effectiveDate });
  }

  @Post('code-definitions')
  @RequirePermissions('tax.config.manage')
  upsertDefinition(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: UpsertTaxCodeDefinitionInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.upsertDefinition(ctx, body);
  }

  @Patch('code-definitions/:taxCodeId')
  @RequirePermissions('tax.config.manage')
  updateDefinition(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('taxCodeId') taxCodeId: string, @Body() body: Omit<UpsertTaxCodeDefinitionInput, 'id'>) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.upsertDefinition(ctx, { ...body, id: taxCodeId });
  }

  @Post('resolve-preview')
  @HttpCode(200)
  @RequirePermissions('company.branch.read')
  resolvePreview(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: ResolveTransactionTaxPreviewDto) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.resolvePreview(ctx, body.input, body.profileId, body.direction, body.sourceModule);
  }

  @Post('legacy-remediation/preview')
  @HttpCode(200)
  @RequirePermissions('tax.config.manage', 'tax.review_issue.resolve')
  previewLegacyRemediation(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: LegacyTaxRemediationInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.previewLegacyRemediation(ctx, body);
  }

  @Post('legacy-remediation/apply')
  @HttpCode(200)
  @RequirePermissions('tax.config.manage', 'tax.review_issue.resolve')
  applyLegacyRemediation(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: LegacyTaxRemediationInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.applyLegacyRemediation(ctx, body);
  }

  @Get('account-determination')
  @RequirePermissions('ledger.posting-rule.read')
  listAccountRules(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('taxCodeDefinitionId') taxCodeDefinitionId?: string,
    @Query('transactionContext') transactionContext?: string,
    @Query('direction') direction?: string,
    @Query('status') status?: string,
    @Query('effectiveDate') effectiveDate?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.listAccountRules(ctx, { taxCodeDefinitionId, transactionContext, direction, status, effectiveDate });
  }

  @Put('account-determination')
  @RequirePermissions('tax.config.manage', 'ledger.posting-rule.manage')
  upsertAccountRule(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: UpsertTaxAccountDeterminationRuleInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.upsertAccountRule(ctx, body);
  }

  @Get('report-mappings')
  @RequirePermissions('tax.config.read')
  listReportRules(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query('taxCodeDefinitionId') taxCodeDefinitionId?: string, @Query('status') status?: string, @Query('effectiveDate') effectiveDate?: string) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.listReportRules(ctx, { taxCodeDefinitionId, status, effectiveDate });
  }

  @Put('report-mappings')
  @RequirePermissions('tax.config.manage')
  upsertReportRule(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: UpsertTaxReportMappingRuleInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.upsertReportRule(ctx, body);
  }

  @Get('trade-evidence')
  @RequirePermissions('tax.config.read')
  listEvidence(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('branchId') branchId?: string,
    @Query('transactionContext') transactionContext?: string,
    @Query('status') status?: string,
    @Query('sourceType') sourceType?: string,
    @Query('sourceId') sourceId?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.listEvidence(ctx, { branchId, transactionContext, status, sourceType, sourceId });
  }

  @Post('trade-evidence')
  @RequirePermissions('company.branch.read')
  createEvidence(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateTradeTaxEvidenceInput) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.createEvidence(ctx, body);
  }

  @Post('trade-evidence/:evidenceId/verify')
  @HttpCode(200)
  @RequirePermissions('tax.config.manage')
  verifyEvidence(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('evidenceId') evidenceId: string, @Body() body: VerifyTradeTaxEvidenceDto) {
    assertRouteCompany(ctx, companyId);
    return this.useCase.verifyEvidence(ctx, evidenceId, body.status ?? 'VERIFIED');
  }

  @Post('reconciliations')
  @RequirePermissions('tax.report.recompute')
  generateReconciliation(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: GenerateTaxReconciliationDto) {
    assertRouteCompany(ctx, companyId);
    return this.reconciliation.generate(ctx, body);
  }

  @Get('reconciliations')
  @RequirePermissions('tax.report.read')
  listReconciliations(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('formType') formType?: string,
    @Query('periodKey') periodKey?: string,
    @Query('branchId') branchId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.reconciliation.list(ctx, { formType, periodKey, branchId, page: Number(page ?? 1), pageSize: Number(pageSize ?? 50) });
  }

  @Get('reconciliations/:runId')
  @RequirePermissions('tax.report.read')
  getReconciliation(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('runId') runId: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    assertRouteCompany(ctx, companyId);
    return this.reconciliation.get(ctx, runId, Number(page ?? 1), Number(pageSize ?? 100));
  }

  @Post('reconciliations/:runId/review')
  @HttpCode(200)
  @RequirePermissions('tax.review_issue.resolve')
  async reviewReconciliation(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('runId') runId: string, @Body() body: ReviewTaxReconciliationDto) {
    assertRouteCompany(ctx, companyId);
    await this.assertTaxReviewerRole(ctx);
    return this.reconciliation.review(ctx, runId, body.note);
  }

  @Get('reports/pp30-boxes')
  @RequirePermissions('tax.report.read')
  pp30Boxes(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query('periodKey') periodKey: string, @Query('branchId') branchId?: string) {
    assertRouteCompany(ctx, companyId);
    return this.reconciliation.pp30Boxes(ctx, periodKey, branchId);
  }
}
