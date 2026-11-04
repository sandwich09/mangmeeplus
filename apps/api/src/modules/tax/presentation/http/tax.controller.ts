import { isSerializationFailure } from '../../../../common/database/prisma-error';
import { withholdingPaperBlockers } from '../../application/services/withholding-filing-validation';
import { assertOpenWithholdingSequence, withholdingPaperPayments } from '../../application/services/withholding-filing-state';
import { filedWithholdingPaymentPeriods } from '../../application/services/filed-withholding-payment';
import { loadWithholdingEstablishments, partitionWithholdingPayments, selectWithholdingPaper, rollUpWithholdingPeriod } from '../../application/services/withholding-establishments';
import { currentWithholdingPayments, isWithholdingDownloadCurrent } from '../../application/services/withholding-filing-state';
import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Post, Patch, Param, Body, Query, HttpCode, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import { ExternalWhtFileUploadDto, CompleteExternalWhtFileDto, WhtCertificateHandoffListQueryDto, IssueWhtCertificateDto, ConfirmWhtFilingRowsDto, ExportTaxPackageDto, AnswerWhtPayerModeDto, CorrectWhtCertificateDto, ExportPnd53Dto, LinkExternalWhtCertificateDto, RemoveExternalWhtCertificateDto, MarkPnd53FiledDto, ResolvePnd53IssueDto, SetWhtHandoffPayeeAddressDto, UpdateCompanyTaxSignatureDto } from './tax.dtos';
import { SyncTaxEventsUseCase } from '../../application/use-cases/sync-tax-events.use-case';
import { GenerateVatReportUseCase } from '../../application/use-cases/generate-vat-report.use-case';
import { GenerateWhtReportUseCase } from '../../application/use-cases/generate-wht-report.use-case';
import { GenerateTaxFilingPackageUseCase } from '../../application/use-cases/generate-tax-filing-package.use-case';
import { CreateWhtCertificateUseCase } from '../../application/use-cases/create-wht-certificate.use-case';
import { WhtCertificateHandoffUseCase } from '../../application/use-cases/wht-certificate-handoff.use-case';
import { IssueWhtCertificateFromHandoffUseCase } from '../../application/use-cases/issue-wht-certificate-from-handoff.use-case';
import { CorrectWhtCertificateUseCase } from '../../application/use-cases/correct-wht-certificate.use-case';
import { IssueWhtReplacementCopyUseCase } from '../../application/use-cases/issue-wht-replacement-copy.use-case';
import { UpdateCompanyTaxSignatureUseCase } from '../../application/use-cases/update-company-tax-signature.use-case';
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
    private readonly correctCertificate: CorrectWhtCertificateUseCase,
    private readonly issueReplacementCopy: IssueWhtReplacementCopyUseCase,
    private readonly updateSignature: UpdateCompanyTaxSignatureUseCase,
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

  @Get('tax/withholding/payer-mode')
  @RequireAnyPermission('wht.pnd53.read', 'company.legal_identity.manage', 'company.branch.read')
  async getWhtPayerMode(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query('periodKey') periodKey?: string) {
    assertRouteCompany(ctx, companyId);
    return this.taxRepo.readWhtPayerMode(ctx.companyId, periodKey);
  }

  @Post('tax/withholding/payer-mode')
  @HttpCode(200)
  @RequirePermissions('company.legal_identity.manage')
  async answerWhtPayerMode(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: AnswerWhtPayerModeDto) {
    assertRouteCompany(ctx, companyId);
    if (!ctx.permissions.includes('company.legal_identity.manage')) throw new ForbiddenException({ code: 'WHT_PAYER_MODE_FORBIDDEN', message: 'ไม่มีสิทธิ์บันทึกวิธีจ่าย ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก' });
    const result = await this.taxRepo.answerWhtPayerMode(ctx, body);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.wht_payer_mode.answer', targetType: 'company', targetId: ctx.companyId,
      requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { mode: body.mode, effectiveFromPeriodKey: result.periodKey } });
    return result;
  }

  @Post('tax/withholding/filings/:filingId/confirm-rows')
  @RequirePermissions('wht.pnd53.prepare')
  async confirmWhtFilingRows(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('filingId') filingId: string, @Body() body: ConfirmWhtFilingRowsDto) {
    assertRouteCompany(ctx, companyId);
    return this.generateFilingPackage.confirmRows(ctx, filingId);
  }

  @Get('tax/withholding/months')
  @RequirePermissions('wht.pnd53.read')
  async listWithholdingMonths(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.generateWht.listMonths(ctx);
  }

  @Get('tax/withholding/months/:periodKey')
  @RequirePermissions('wht.pnd53.read')
  async getWithholdingMonth(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodKey') periodKey: string) {
    assertRouteCompany(ctx, companyId);
    return this.generateWht.getMonth(ctx, periodKey);
  }

  private withholdingForm(formType?: string): 'PND3' | 'PND53' {
    if (formType === undefined) return 'PND53';
    if (formType !== 'PND3' && formType !== 'PND53') throw new BadRequestException('ไม่พบแบบภาษีที่เลือก เลือก ภ.ง.ด.3 หรือ ภ.ง.ด.53');
    return formType;
  }

  private async withholdingPeriod(companyId: string, periodId: string, formType: string) {
    const period = await this.taxRepo.findPeriodById(companyId, periodId);
    if (!period || period.formType !== formType) throw new NotFoundException(`${formType} period not found`);
    return period;
  }

  @Get(['tax/pnd53/periods', 'tax/withholding/:formType/periods'])
  @RequirePermissions('wht.pnd53.read')
  @ApiOperation({ summary: 'List periods of the selected withholding form' })
  async listPnd53Periods(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    return this.taxRepo.findPeriods(ctx.companyId, { taxType: 'WHT', formType: form, pageSize: 100 });
  }

  @Get(['tax/pnd53/periods/:periodId/events', 'tax/withholding/:formType/periods/:periodId/events'])
  @RequirePermissions('wht.pnd53.read')
  @ApiOperation({ summary: 'Read source events for the selected withholding form' })
  async listPnd53Events(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    await this.withholdingPeriod(ctx.companyId, periodId, form);
    return this.taxRepo.findEventsByPeriod(ctx.companyId, periodId);
  }

  @Post(['tax/pnd53/sync', 'tax/withholding/:formType/sync'])
  @HttpCode(200)
  @RequirePermissions('wht.pnd53.prepare')
  @ApiOperation({ summary: 'Sync both withholding forms without VAT' })
  async syncPnd53(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    this.withholdingForm(formType);
    await this.syncEvents.execute(ctx.companyId, undefined, formType === undefined ? 'PND53' : 'WHT');
    return { synced: true };
  }

  @Post(['tax/pnd53/periods/:periodId/report', 'tax/withholding/:formType/periods/:periodId/report'])
  @HttpCode(200)
  @RequirePermissions('wht.pnd53.prepare')
  @ApiOperation({ summary: 'Compute the selected withholding report' })
  async generatePnd53(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    const period = await this.withholdingPeriod(ctx.companyId, periodId, form);
    return this.generateWht.execute(ctx.companyId, form, period.periodKey);
  }

  @Post(['tax/pnd53/periods/:periodId/export', 'tax/withholding/:formType/periods/:periodId/export'])
  @HttpCode(200)
  @RequirePermissions('wht.pnd53.prepare')
  @ApiOperation({ summary: 'Produce the selected official withholding form and annexes' })
  async exportPnd53(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string,
    @Body() body: ExportPnd53Dto, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    await this.withholdingPeriod(ctx.companyId, periodId, form);
    if (!['PDF', 'XLSX'].includes(body?.exportFormat)) throw new BadRequestException('เลือกรูปแบบไฟล์แล้วดาวน์โหลดอีกครั้ง');
    return this.generateFilingPackage.execute(ctx, periodId, body.exportFormat, body.establishmentCode, body.sequence);
  }

  @Get(['tax/pnd53/periods/:periodId/review-issues', 'tax/withholding/:formType/periods/:periodId/review-issues'])
  @RequirePermissions('wht.pnd53.read')
  @ApiOperation({ summary: 'List review issues of the selected withholding form' })
  async listPnd53Issues(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    await this.withholdingPeriod(ctx.companyId, periodId, form);
    return this.taxRepo.findIssuesByPeriod(ctx.companyId, periodId, { status: 'OPEN' });
  }

  @Patch(['tax/pnd53/review-issues/:issueId/resolve', 'tax/withholding/:formType/review-issues/:issueId/resolve'])
  @RequirePermissions('wht.pnd53.prepare')
  @ApiOperation({ summary: 'Resolve an issue belonging to the selected withholding form' })
  async resolvePnd53Issue(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('issueId') issueId: string, @Body() body: ResolvePnd53IssueDto, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    const issue = await this.taxRepo.prisma.client.taxReviewIssue.findFirst({ where: { id: issueId, companyId: ctx.companyId } });
    if (!issue) throw new NotFoundException('PND53 review issue not found');
    await this.withholdingPeriod(ctx.companyId, issue.taxPeriodId, form);
    return this.resolveIssue(ctx, companyId, issueId, body);
  }

  @Patch(['tax/pnd53/periods/:periodId/mark-filed', 'tax/withholding/:formType/periods/:periodId/mark-filed'])
  @RequirePermissions('wht.pnd53.prepare')
  @ApiOperation({ summary: 'Record that the selected exported withholding form was filed' })
  async markPnd53Filed(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Body() body: MarkPnd53FiledDto, @Param('formType') formType?: string) {
    assertRouteCompany(ctx, companyId);
    const form = this.withholdingForm(formType);
    await this.withholdingPeriod(ctx.companyId, periodId, form);
    return this.markFiled(ctx, companyId, periodId, body);
  }

  // ─── Company Tax Profile ──────────────────────────────────────────────────

  @Get('tax/profile')
  @RequirePermissions('tax.profile.read')
  @ApiOperation({ summary: 'Get company tax profile' })
  async getProfile(@ReqCtx() ctx: RequestContext) {
    const row = await this.taxRepo.prisma.client.companyTaxProfile.findUnique({ where: { companyId: ctx.companyId } });
    return row ?? { companyId: ctx.companyId, vatRegistered: false, branchPolicy: 'HEAD_OFFICE_ONLY', taxReviewerRole: 'ACCOUNTANT', signatureMode: 'BLANK', signatureImageAttachmentId: null };
  }

  @Get('tax/profile/signature')
  @RequirePermissions('company.tax_signature.manage')
  @ApiOperation({ summary: 'Read only the company WHT-certificate signature settings' })
  async getTaxSignature(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.updateSignature.read(ctx);
  }

  // WHT certificate system issuance plan §3.3 (Decision B): OWNER-only, deliberately a DIFFERENT
  // permission than `tax.profile.manage` (which FINANCE/ACCOUNTANT already hold) — a company's
  // authorized-signatory signature is more sensitive than ordinary tax configuration.
  @Patch('tax/profile/signature')
  @RequirePermissions('company.tax_signature.manage')
  @ApiOperation({ summary: 'Set the company WHT-certificate signature mode (BLANK or AUTO_STAMP)' })
  async updateTaxSignature(@ReqCtx() ctx: RequestContext, @Body() body: UpdateCompanyTaxSignatureDto) {
    return this.updateSignature.execute(ctx, body);
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
  async markFiled(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('periodId') periodId: string, @Body() body: MarkPnd53FiledDto) {
    assertRouteCompany(ctx, companyId);
    const reviewerRole = await this.assertTaxReviewerRole(ctx);
    const period = await this.taxRepo.findPeriodById(ctx.companyId, periodId);
    if (!period) throw new NotFoundException('Tax period not found');
    if (period.formType === 'PND2') throw new ConflictException({ code: 'WHT_PND2_SEPARATE', message: 'ประเภทนี้ต้องยื่น ภ.ง.ด.2 แยก ให้ผู้ทำบัญชีจัดทำแบบให้' });
    if (['PND3', 'PND53'].includes(period.formType)) {
      await this.syncEvents.execute(ctx.companyId, undefined, 'WHT');
      try {
        await this.taxRepo.prisma.client.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "TaxPeriod" WHERE id = ${periodId} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
          if (['FILED', 'PAID', 'CLOSED'].includes(period.status) && (await filedWithholdingPaymentPeriods(tx, ctx.companyId, '', '', { formType: period.formType, periodKey: period.periodKey })).length) throw new ConflictException({ code: 'WHT_FILING_ALREADY_FILED', message: 'แบบนี้ยื่นแล้ว แก้แบบเดิมไม่ได้ ดาวน์โหลดแบบที่ยื่นไว้แทน' });
          const context = await loadWithholdingEstablishments(tx, ctx.companyId, period.periodKey);
          const events = await currentWithholdingPayments(tx, ctx.companyId, (await tx.taxEvent.findMany({ where: { companyId: ctx.companyId, taxPeriodId: periodId, status: 'ACTIVE' } })).map(event => ({
            ...event, payeeSnapshot: event.payeeSnapshotJson as import('@watchdog-bms/contracts').PayeeSnapshot | null,
            grossAmount: event.grossAmount?.toString() ?? null, withheldAmount: event.withheldAmount?.toString() ?? null, whtRate: event.whtRate?.toString() ?? null,
          })));
          const projection = await withholdingPaperBlockers(tx, ctx, period, undefined, events);
          const partition = projection.partition;
          const selected = selectWithholdingPaper(ctx, partition, body.establishmentCode);
          const paper = selected ? await tx.whtFiling.findFirst({ where: { companyId: ctx.companyId, taxPeriodId: periodId, establishmentCode: selected.establishment.code, sequence: body.sequence ?? 0 }, include: { latestPackage: true } }) : null;
          if (selected && (body.sequence ?? 0) > 0) {
            const papers = await tx.whtFiling.findMany({ where: { companyId: ctx.companyId, taxPeriodId: periodId }, include: { lines: true } });
            assertOpenWithholdingSequence(papers.filter(p => p.establishmentCode === selected.establishment.code), body.sequence!);
            selected.events = withholdingPaperPayments(selected.events, papers);
          }
          const pkg = paper?.latestPackage;
          if (!selected || !paper || paper.status !== 'EXPORTED' || !pkg || !await isWithholdingDownloadCurrent(tx, ctx.companyId, periodId, selected.events, pkg, selected.establishment.code, body.sequence)) {
            throw new ConflictException({ code: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', message: 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น' });
          }
          const blockers = await withholdingPaperBlockers(tx, ctx, period, selected.establishment, selected.events);
          const blocking = blockers.issues.find(issue => issue.severity === 'BLOCKING');
          if (blocking) throw new ConflictException({ code: `${period.formType}_FILING_REVIEW`, message: blocking.description, issues: blockers.issues });
          await this.taxRepo.markWithholdingFilingFiled(tx, ctx.companyId, pkg.id, ctx.userId, new Date(), body.note);
          await tx.taxFilingPackage.update({ where: { id: pkg.id }, data: { status: 'ACCEPTED_MANUAL', filedManuallyAt: new Date(), filedManuallyNote: body.note } });
          await rollUpWithholdingPeriod(tx, ctx.companyId, periodId, partition.papers.map(p => p.establishment.code));
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (isSerializationFailure(error)) throw new ConflictException({ code: 'WHT_FILING_CHANGED_AFTER_DOWNLOAD', message: 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ ดาวน์โหลดแบบใหม่ก่อนยื่น' });
        throw error;
      }
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.period.mark_filed', targetType: 'tax_period', targetId: periodId,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'CRITICAL', metadataJson: { establishmentCode: body.establishmentCode, taxReviewerRole: reviewerRole } });
      return this.taxRepo.findPeriodById(ctx.companyId, periodId);
    }
    if (period.status !== 'EXPORTED') throw new ConflictException('Tax period must have a current reviewed export package before filing');
    const [filingPackage, openIssues, events, reconciliation] = await Promise.all([
      this.taxRepo.prisma.client.taxFilingPackage.findFirst({ where: { companyId: ctx.companyId, taxPeriodId: periodId, status: { in: ['GENERATED', 'DOWNLOADED'] } }, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }] }),
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
  async generateExportPackage(@ReqCtx() ctx: RequestContext, @Param('periodId') periodId: string, @Body() body: ExportTaxPackageDto) {
    return this.generateFilingPackage.execute(ctx, periodId, body.exportFormat, body.establishmentCode, body.sequence);
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
  @RequireAnyPermission('wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link')
  @ApiOperation({ summary: 'List 50 Tawi certificates awaiting external issuance' })
  async listWhtHandoffs(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Query() query: WhtCertificateHandoffListQueryDto = {},
  ) {
    const { status, branchId, sourcePaymentId, page, pageSize, search, periodKey, formType, order } = query;
    // The auth guard lets an `x-company-id` header set the context company; without this the route
    // param would be decorative and a caller could read another company's URL with their own scope.
    assertRouteCompany(ctx, companyId);
    if (page !== undefined || pageSize !== undefined) {
      return this.whtHandoffs.listPaged(ctx, { status, branchId, sourcePaymentId, page: Number(page), pageSize: Number(pageSize), search, ...(order ? { order } : {}), ...(periodKey !== undefined ? { periodKey } : {}), ...(formType !== undefined ? { formType } : {}) });
    }
    return this.whtHandoffs.list(ctx, { status, branchId, sourcePaymentId, ...(periodKey !== undefined ? { periodKey } : {}), ...(formType !== undefined ? { formType } : {}) });
  }

  @Get('wht/payment-handoffs/:handoffId')
  @RequirePermissions('wht.certificate.read')
  @ApiOperation({ summary: 'Read one 50 Tawi external handoff with its prefilled facts' })
  async getWhtHandoff(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.get(ctx, handoffId);
  }

  @Get('wht/expenses/:expenseId/certificate-history')
  @RequireAnyPermission('wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link')
  @ApiOperation({ summary: 'Read certificate history for one expense, newest first' })
  async getExpenseWhtCertificateHistory(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('expenseId') expenseId: string) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.getExpenseHistory(ctx, expenseId);
  }

  @Post('wht/payment-handoffs/:handoffId/payee-address')
  @HttpCode(200)
  // Issuers and external recorders may prepare the address; read permission alone cannot write it.
  @RequireAnyPermission('wht.external_certificate.link', 'wht.certificate.issue')
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

  @Post('wht/payment-handoffs/:handoffId/external-certificate/file-upload-intent')
  @RequirePermissions('wht.external_certificate.link')
  async externalWhtFileIntent(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string, @Body() body: ExternalWhtFileUploadDto) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.externalFileIntent(ctx, handoffId, body);
  }

  @Post('wht/payment-handoffs/:handoffId/external-certificate/file-uploads/:attachmentId/complete')
  @RequirePermissions('wht.external_certificate.link')
  async completeExternalWhtFile(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string, @Param('attachmentId') attachmentId: string, @Body() body: CompleteExternalWhtFileDto) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.completeExternalFile(ctx, handoffId, { ...body, attachmentId });
  }

  @Get('wht/payment-handoffs/:handoffId/external-certificate/files/:attachmentId')
  @RequireAnyPermission('wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link')
  async externalWhtFile(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string, @Param('attachmentId') attachmentId: string) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.externalFile(ctx, handoffId, attachmentId);
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

  @Post('wht/payment-handoffs/:handoffId/external-certificate/change')
  @HttpCode(200)
  @RequirePermissions('wht.external_certificate.link')
  @ApiOperation({ summary: 'Change the standing self-issued certificate record' })
  async changeExternalWhtCertificate(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('handoffId') handoffId: string,
    @Body() body: LinkExternalWhtCertificateDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.changeExternal(ctx, handoffId, body);
  }

  @Post('wht/payment-handoffs/:handoffId/external-certificate/remove')
  @HttpCode(200)
  @RequirePermissions('wht.external_certificate.link')
  @ApiOperation({ summary: 'Remove a mistaken self-issued certificate record' })
  async removeExternalWhtCertificate(
    @ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string,
    @Param('handoffId') handoffId: string, @Body() body: RemoveExternalWhtCertificateDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.whtHandoffs.removeExternal(ctx, handoffId, body);
  }

  // A new route, sibling to the two above, rather than an overload of `POST tax/wht-certificates`
  // below: that endpoint's body shape (`CreateWhtCertificateDto`) requires a pre-existing
  // `taxPeriodId`/`taxEventIds`, a completely different input from this one (just a `handoffId`).
  // `wht.certificate.issue` is gated by `wht_50bis` (legacy `thai_tax` also retains it) —
  // unlike its `wht/payment-handoffs/*` siblings above, which are deliberately NOT gated — but the
  // URL family stays the same because both AP and Expenses already read/write handoffs here.
  @Get('wht/payment-handoffs/:handoffId/system-certificate')
  @RequireAnyPermission('wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link')
  async downloadSystemWhtCertificate(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
    assertRouteCompany(ctx, companyId);
    return this.issueFromHandoff.download(ctx, handoffId);
  }

  @Post('wht/payment-handoffs/:handoffId/system-certificate')
  @HttpCode(200)
  @RequirePermissions('wht.certificate.issue')
  @ApiOperation({ summary: 'Issue a 50 Tawi certificate directly from a settlement/expense WHT handoff' })
  async issueSystemWhtCertificate(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string, @Body() body: IssueWhtCertificateDto = {}) {
    assertRouteCompany(ctx, companyId);
    return body.paymentId ? this.issueFromHandoff.execute(ctx, handoffId, body.paymentId) : this.issueFromHandoff.execute(ctx, handoffId);
  }

  // Correction & replacement plan §2.3: mints a NEW-numbered certificate with corrected content and
  // supersedes the old one. Same URL family/permission-decoupling reasoning as
  // `issueSystemWhtCertificate` above; `wht.certificate.correct` is a shared key for both this route
  // and the replacement-copy route below (plan §2.1).
  @Post('wht/payment-handoffs/:handoffId/system-certificate/correction')
  @HttpCode(200)
  @RequirePermissions('wht.certificate.correct')
  @ApiOperation({ summary: 'Correct a SYSTEM-issued 50 Tawi certificate, superseding it with a new number' })
  async correctSystemWhtCertificate(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('handoffId') handoffId: string,
    @Body() body: CorrectWhtCertificateDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.correctCertificate.execute(ctx, handoffId, body.corrected, body.reason);
  }

  // Correction & replacement plan §3.2: an identical, same-numbered copy for a lost PDF — no body,
  // no number reservation. Shares `wht.certificate.correct` with the correction route above
  // (plan §2.1: one key covers both actions).
  @Post('wht/payment-handoffs/:handoffId/system-certificate/replacement-copy')
  @HttpCode(200)
  @RequirePermissions('wht.certificate.correct')
  @ApiOperation({ summary: 'Reissue an identical, same-numbered copy (ใบแทน) of a SYSTEM-issued 50 Tawi certificate' })
  async issueSystemWhtReplacementCopy(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('handoffId') handoffId: string) {
    assertRouteCompany(ctx, companyId);
    return this.issueReplacementCopy.execute(ctx, handoffId);
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
