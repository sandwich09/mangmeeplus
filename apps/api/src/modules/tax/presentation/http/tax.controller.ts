import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Post, Patch, Param, Body, Query, HttpCode, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { LinkExternalWhtCertificateDto, SetWhtHandoffPayeeAddressDto } from './tax.dtos';
import { SyncTaxEventsUseCase } from '../../application/use-cases/sync-tax-events.use-case';
import { GenerateVatReportUseCase } from '../../application/use-cases/generate-vat-report.use-case';
import { GenerateWhtReportUseCase } from '../../application/use-cases/generate-wht-report.use-case';
import { GenerateTaxFilingPackageUseCase } from '../../application/use-cases/generate-tax-filing-package.use-case';
import { CreateWhtCertificateUseCase } from '../../application/use-cases/create-wht-certificate.use-case';
import { WhtCertificateHandoffUseCase } from '../../application/use-cases/wht-certificate-handoff.use-case';
import { IssueWhtCertificateFromHandoffUseCase } from '../../application/use-cases/issue-wht-certificate-from-handoff.use-case';
import { SetWhtIncomeCategoryStatusUseCase } from '../../application/use-cases/wht-income-category.use-case';
import { GetCitCalendarUseCase } from '../../application/use-cases/get-cit-calendar.use-case';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { taxReviewerViolation } from '../../domain/logic/tax-reviewer.logic';

@ApiTags('tax')
@Controller('companies/:companyId')
export class TaxController {
  constructor(
    private readonly syncEvents: SyncTaxEventsUseCase,
    private readonly generateVat: GenerateVatReportUseCase,
    private readonly generateWht: GenerateWhtReportUseCase,
    private readonly generateFilingPackage: GenerateTaxFilingPackageUseCase,
    private readonly createWhtCertificate: CreateWhtCertificateUseCase,
    private readonly whtHandoffs: WhtCertificateHandoffUseCase,
    private readonly issueFromHandoff: IssueWhtCertificateFromHandoffUseCase,
    private readonly setWhtCategoryStatus: SetWhtIncomeCategoryStatusUseCase,
    private readonly getCitCalendar: GetCitCalendarUseCase,
    private readonly taxRepo: PrismaTaxRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * GAP-04: enforce the company's `taxReviewerRole` on top of the existing
   * permission gate. Returns the effective reviewer role for audit metadata.
   */
  private async assertTaxReviewerRole(ctx: RequestContext): Promise<string> {
    const profile = await this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId } });
    const violation = taxReviewerViolation(ctx.roles, profile?.taxReviewerRole);
    if (violation) throw new ForbiddenException({ code: 'tax_reviewer_role_required', message: violation });
    return profile?.taxReviewerRole?.trim() || 'ACCOUNTANT';
  }

  // ─── Company Tax Profile ──────────────────────────────────────────────────

  @Get('tax/profile')
  @RequirePermissions('tax.profile.read')
  @ApiOperation({ summary: 'Get company tax profile' })
  async getProfile(@ReqCtx() ctx: RequestContext) {
    const row = await this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId } });
    return row ?? { companyId: ctx.companyId, vatRegistered: false, branchPolicy: 'HEAD_OFFICE_ONLY', taxReviewerRole: 'ACCOUNTANT' };
  }

  // ─── Tax Periods ──────────────────────────────────────────────────────────

  @Get('tax/periods')
  @RequirePermissions('tax.period.read')
  @ApiOperation({ summary: 'List tax periods' })
  async listPeriods(@ReqCtx() ctx: RequestContext, @Query('taxType') taxType?: string, @Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.taxRepo.findPeriods(ctx.companyId, { taxType: taxType as any, status: status as any, page: page ? parseInt(page) : 1, pageSize: pageSize ? parseInt(pageSize) : 20 });
  }

  // ─── Tax Event Sync ───────────────────────────────────────────────────────

  @Post('tax/sync')
  @HttpCode(200)
  @RequirePermissions('tax.event.sync')
  @ApiOperation({ summary: 'Sync source tax events from accounting/expense/payment records' })
  async sync(@ReqCtx() ctx: RequestContext, @Body() body: { since?: string }) {
    const since = body.since ? new Date(body.since) : undefined;
    return this.syncEvents.execute(ctx.companyId, since);
  }

  // ─── Tax Events ───────────────────────────────────────────────────────────

  @Get('tax/periods/:periodId/events')
  @RequirePermissions('tax.event.read')
  @ApiOperation({ summary: 'List tax events for a period' })
  async listEvents(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string) {
    return this.taxRepo.findEventsByPeriod(ctx.companyId, periodId);
  }

  // ─── VAT Report ───────────────────────────────────────────────────────────

  @Post('tax/periods/:periodId/vat-report')
  @HttpCode(200)
  @RequirePermissions('tax.report.recompute')
  @ApiOperation({ summary: 'Generate/recompute VAT report snapshot for a period' })
  async generateVatReport(@ReqCtx() ctx: RequestContext, @Param('periodId') _periodId: string, @Body() body: { formType?: 'PP30' | 'PP36'; periodKey: string }) {
    return this.generateVat.execute(ctx.companyId, body.formType ?? 'PP30', body.periodKey);
  }

  // ─── WHT Report ───────────────────────────────────────────────────────────

  @Post('tax/periods/:periodId/wht-report')
  @HttpCode(200)
  @RequirePermissions('tax.report.recompute')
  @ApiOperation({ summary: 'Generate/recompute WHT report snapshot for a period' })
  async generateWhtReport(@ReqCtx() ctx: RequestContext, @Param('periodId') _periodId: string, @Body() body: { formType?: 'PND3' | 'PND53'; periodKey: string }) {
    return this.generateWht.execute(ctx.companyId, body.formType ?? 'PND53', body.periodKey);
  }

  // ─── Review Issues ────────────────────────────────────────────────────────

  @Get('tax/periods/:periodId/review-issues')
  @RequirePermissions('tax.review_issue.read')
  @ApiOperation({ summary: 'List review issues for a tax period' })
  async listReviewIssues(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string, @Query('status') status?: string) {
    return this.taxRepo.findIssuesByPeriod(ctx.companyId, periodId, { status: status as any });
  }

  @Patch('tax/review-issues/:issueId/resolve')
  @RequirePermissions('tax.review_issue.resolve')
  @ApiOperation({ summary: 'Resolve a tax review issue' })
  async resolveIssue(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('issueId') issueId: string, @Body() body: { note: string }) {
    assertRouteCompany(ctx, companyId);
    const reviewerRole = await this.assertTaxReviewerRole(ctx);
    const note = body.note?.trim();
    if (!note) throw new BadRequestException('Resolution note is required');
    const issue = await this.taxRepo.prisma.client.taxReviewIssue.findFirst({ where: { id: issueId, companyId: ctx.companyId } });
    if (!issue) throw new NotFoundException('Tax review issue not found');
    if (issue.status !== 'OPEN') throw new ConflictException('Tax review issue is not open');
    const resolved = await this.taxRepo.resolveIssue(ctx.companyId, issueId, note, ctx.userId);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.review_issue.resolve', targetType: 'tax_review_issue', targetId: issueId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { taxPeriodId: issue.taxPeriodId, taxReviewerRole: reviewerRole } });
    return resolved;
  }

  // ─── Filing Status ────────────────────────────────────────────────────────

  @Patch('tax/periods/:periodId/mark-filed')
  @RequirePermissions('tax.filing.mark_filed')
  @ApiOperation({ summary: 'Mark tax period as filed (manual)' })
  async markFiled(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Body() body: { note?: string }) {
    assertRouteCompany(ctx, companyId);
    const reviewerRole = await this.assertTaxReviewerRole(ctx);
    const period = await this.taxRepo.findPeriodById(ctx.companyId, periodId);
    if (!period) throw new NotFoundException('Tax period not found');
    if (period.status !== 'EXPORTED') throw new ConflictException('Tax period must have a current reviewed export package before filing');
    const [filingPackage, openIssues, events, reconciliation] = await Promise.all([
      this.taxRepo.prisma.client.taxFilingPackage.findFirst({ where: { companyId: ctx.companyId, taxPeriodId: periodId, status: { in: ['GENERATED', 'DOWNLOADED'] } }, orderBy: { generatedAt: 'desc' } }),
      this.taxRepo.findIssuesByPeriod(ctx.companyId, periodId, { status: 'OPEN' }),
      this.taxRepo.findEventsByPeriod(ctx.companyId, periodId, 'ACTIVE'),
      ['PP30', 'PP36'].includes(period.formType) ? (this.taxRepo.prisma.client as any).taxReconciliationRun.findFirst({ where: { companyId: ctx.companyId, branchId: null, formType: period.formType, periodKey: period.periodKey }, orderBy: { createdAt: 'desc' } }) : null,
    ]);
    if (!filingPackage) throw new ConflictException('Active filing export package not found');
    if (openIssues.some((issue) => issue.severity === 'BLOCKING')) throw new ConflictException('Blocking tax review issues must be resolved before filing');
    if (['PP30', 'PP36'].includes(period.formType)) {
      if (!reconciliation || reconciliation.status !== 'REVIEWED' || reconciliation.blockingIssueCount > 0) throw new ConflictException('Tax reconciliation must remain reviewed with no blocking lines');
      const reviewedAt = new Date(reconciliation.reviewedAt ?? reconciliation.updatedAt).getTime();
      const latestEventAt = events.reduce((latest, event) => Math.max(latest, event.updatedAt.getTime()), 0);
      if (latestEventAt > reviewedAt || latestEventAt > filingPackage.generatedAt.getTime()) throw new ConflictException('Tax data changed after review/export; reconcile and export again');
    }
    const filedAt = new Date();
    await this.taxRepo.prisma.client.$transaction([
      this.taxRepo.prisma.client.taxFilingPackage.update({ where: { id: filingPackage.id }, data: { status: 'ACCEPTED_MANUAL', filedManuallyAt: filedAt, filedManuallyNote: body.note } }),
      this.taxRepo.prisma.client.taxPeriod.update({ where: { id: periodId }, data: { status: 'FILED', filedAt, reviewNote: body.note } }),
    ]);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.period.mark_filed', targetType: 'tax_period', targetId: periodId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { formType: period.formType, periodKey: period.periodKey, filingPackageId: filingPackage.id, taxReviewerRole: reviewerRole } });
    return this.taxRepo.findPeriodById(ctx.companyId, periodId);
  }

  @Patch('tax/periods/:periodId/mark-paid')
  @RequirePermissions('tax.filing.mark_paid')
  @ApiOperation({ summary: 'Mark tax period as paid (manual)' })
  async markPaid(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Body() body: { note?: string }) {
    assertRouteCompany(ctx, companyId);
    const period = await this.taxRepo.findPeriodById(ctx.companyId, periodId);
    if (!period) throw new NotFoundException('Tax period not found');
    if (period.status !== 'FILED') throw new ConflictException('Tax period must be filed before it can be marked paid');
    const paid = await this.taxRepo.updatePeriodStatus(ctx.companyId, periodId, 'PAID', { paidAt: new Date(), reviewNote: body.note });
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.period.mark_paid', targetType: 'tax_period', targetId: periodId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { formType: period.formType, periodKey: period.periodKey } });
    return paid;
  }

  @Post('tax/periods/:periodId/filing-packages')
  @HttpCode(200)
  @RequirePermissions('tax.report.export')
  @ApiOperation({ summary: 'Generate tax review export package artifact' })
  async generateExportPackage(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string, @Body() body: { exportFormat: 'REVIEW_JSON' | 'CSV' | 'XLSX' | 'PDF' }) {
    return this.generateFilingPackage.execute(ctx, periodId, body.exportFormat);
  }

  // ─── 50 Tawi WHT Certificate ─────────────────────────────────────────────

  @Post('tax/wht-certificates')
  @HttpCode(200)
  @RequirePermissions('tax.certificate.issue')
  @ApiOperation({ summary: 'Issue 50 Tawi WHT certificate with PDF artifact' })
  async issueWhtCertificate(@ReqCtx() ctx: RequestContext, @Body() body: Parameters<CreateWhtCertificateUseCase['execute']>[1]) {
    return this.createWhtCertificate.execute(ctx, body);
  }

  // ─── 50 Tawi External Handoff ────────────────────────────────────────────
  //
  // Deliberately NOT under the `tax/` path prefix and NOT on a `tax.*` permission: this journey
  // must work for a company that never bought `thai_tax` (spec:301-302). It is reachable from the
  // source payment, outside the Tax workspace (tax-thailand-2026-spec.md:1391).

  @Get('wht/payment-handoffs')
  @RequirePermissions('wht.certificate.read')
  @ApiOperation({ summary: 'List 50 Tawi certificates awaiting external issuance' })
  async listWhtHandoffs(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    // The auth guard lets an `x-company-id` header set the context company; without this the route
    // param would be decorative and a caller could read another company's URL with their own scope.
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.list(ctx, { status, branchId });
  }

  @Get('wht/payment-handoffs/:handoffId')
  @RequirePermissions('wht.certificate.read')
  @ApiOperation({ summary: 'Read one 50 Tawi external handoff with its prefilled facts' })
  async getWhtHandoff(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.get(ctx, handoffId);
  }

  @Post('wht/payment-handoffs/:handoffId/payee-address')
  @HttpCode(200)
  // Same key as the link, not `wht.certificate.read`: this writes the address that will be printed
  // on the certificate, so whoever may record the document may supply it (§12.1 adds no new key).
  @RequirePermissions('wht.external_certificate.link')
  @ApiOperation({ summary: 'Supply the payee address a frozen 50 Tawi prefill never had' })
  async setWhtHandoffPayeeAddress(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('handoffId') handoffId: string,
    @Body() body: SetWhtHandoffPayeeAddressDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.setPayeeAddress(ctx, handoffId, body);
  }

  @Post('wht/payment-handoffs/:handoffId/external-certificate')
  @HttpCode(200)
  @RequirePermissions('wht.external_certificate.link')
  @ApiOperation({ summary: 'Link an externally issued 50 Tawi certificate back to its handoff' })
  async linkExternalWhtCertificate(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('handoffId') handoffId: string,
    @Body() body: LinkExternalWhtCertificateDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.linkExternal(ctx, handoffId, body);
  }

  // A new route, sibling to the two above, rather than an overload of `POST tax/wht-certificates`
  // below: that endpoint's body shape (`CreateWhtCertificateDto`) requires a pre-existing
  // `taxPeriodId`/`taxEventIds`, a completely different input from this one (just a `handoffId`).
  // `wht.certificate.issue` is gated by `thai_tax` (via `pack.wht.certificate.issue`, plan §2.1) —
  // unlike its `wht/payment-handoffs/*` siblings above, which are deliberately NOT gated — but the
  // URL family stays the same because both AP and Expenses already read/write handoffs here.
  @Post('wht/payment-handoffs/:handoffId/system-certificate')
  @HttpCode(200)
  @RequirePermissions('wht.certificate.issue')
  @ApiOperation({ summary: 'Issue a 50 Tawi certificate directly from a settlement/expense WHT handoff' })
  async issueSystemWhtCertificate(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
    assertRouteCompany(ctx, companyId);
    return this.issueFromHandoff.execute(ctx, handoffId);
  }

  // ─── CIT Calendar ────────────────────────────────────────────────────────

  @Get('tax/cit-calendar')
  @RequirePermissions('tax.period.read')
  @ApiOperation({ summary: 'List CIT PND50/PND51 calendar entries' })
  async citCalendar(@ReqCtx() ctx: RequestContext) {
    return this.getCitCalendar.execute(ctx.companyId);
  }

  // ─── WHT Config (income categories) ──────────────────────────────────────

  @Patch('tax/wht-categories/:code')
  @RequirePermissions('tax.config.manage')
  @ApiOperation({ summary: 'Activate or return to draft a WHT income category' })
  async setWhtCategoryStatusRoute(@ReqCtx() ctx: RequestContext, @Param('code') code: string, @Body() body: { status: string }) {
    return this.setWhtCategoryStatus.execute(ctx, code, body?.status);
  }

  @Get('tax/wht-categories')
  @RequirePermissions('tax.config.read')
  @ApiOperation({ summary: 'List WHT income categories' })
  async listWhtCategories(@ReqCtx() ctx: RequestContext, @Query('status') status?: string) {
    const where: Record<string, unknown> = {};
    if (status) where['status'] = status;
    return this.taxRepo.prisma.client.whtIncomeCategory.findMany({ where, orderBy: { code: 'asc' } });
  }
}
