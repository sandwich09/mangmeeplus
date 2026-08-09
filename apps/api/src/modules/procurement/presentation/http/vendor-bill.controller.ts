import { Controller, Get, Patch, Post, Put, Param, Body, Query } from '@nestjs/common';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import { CreateVendorBillUseCase, GetVendorBillUseCase, ListVendorBillsUseCase, MatchVendorBillUseCase, OverrideVendorBillMatchUseCase, SubmitVendorBillUseCase, ApproveVendorBillUseCase, RejectVendorBillUseCase, VoidVendorBillUseCase, GetVendorBillPostingSourceUseCase, GetVendorBillPp36PostingSourceUseCase, UpdateVendorBillTaxEvidenceUseCase, ReviewVendorBillTaxEvidenceUseCase } from '../../application/use-cases/vendor-bill.use-case';
import { GetProcurementApprovalPolicyUseCase, UpdateProcurementApprovalPolicyUseCase } from '../../application/use-cases/approval-policy.use-case';
import { ApprovalNoteDto, CreateVendorBillDto, MatchOverrideDto, RequiredNoteDto, RequiredReasonDto, ReviewVendorBillTaxEvidenceDto, UpdateApprovalPolicyDto, UpdateVendorBillTaxEvidenceDto } from './procurement.dtos';

@Controller('companies/:companyId/accounts-payable/vendor-bills')
export class VendorBillController {
  constructor(
    private readonly createBill: CreateVendorBillUseCase,
    private readonly getBill: GetVendorBillUseCase,
    private readonly getApprovalPolicy: GetProcurementApprovalPolicyUseCase,
    private readonly updateApprovalPolicy: UpdateProcurementApprovalPolicyUseCase,
    private readonly updateTaxEvidence: UpdateVendorBillTaxEvidenceUseCase,
    private readonly reviewTaxEvidence: ReviewVendorBillTaxEvidenceUseCase,
    private readonly listBills: ListVendorBillsUseCase,
    private readonly matchBill: MatchVendorBillUseCase,
    private readonly overrideMatch: OverrideVendorBillMatchUseCase,
    private readonly submitBill: SubmitVendorBillUseCase,
    private readonly approveBill: ApproveVendorBillUseCase,
    private readonly rejectBill: RejectVendorBillUseCase,
    private readonly voidBill: VoidVendorBillUseCase,
    private readonly postingSource: GetVendorBillPostingSourceUseCase,
    private readonly pp36PostingSource: GetVendorBillPp36PostingSourceUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('procurement.vendor_bill.read', 'procurement.vendor_bill.read_related')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listBills.execute(ctx, { status: q['status'], supplierId: q['supplierId'], purchaseOrderId: q['purchaseOrderId'], matchingStatus: q['matchingStatus'], postingStatus: q['postingStatus'], fromDate: q['fromDate'], toDate: q['toDate'], page: q['page'] ? Number(q['page']) : undefined, pageSize: q['pageSize'] ? Number(q['pageSize']) : undefined });
  }

  // H-07: static routes must be declared before the ':id' routes below.
  @Get('approval-policy')
  @RequirePermissions('procurement.approval_policy.read')
  async getPolicy(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.getApprovalPolicy.execute(ctx);
  }

  @Put('approval-policy')
  @RequirePermissions('procurement.approval_policy.manage')
  async updatePolicy(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: UpdateApprovalPolicyDto) {
    assertRouteCompany(ctx, companyId);
    return this.updateApprovalPolicy.execute(ctx, { allowSelfApproval: body.allowSelfApproval, dualApprovalThresholdAmount: body.dualApprovalThresholdAmount });
  }

  @Get(':id/pp36-posting-source')
  @RequirePermissions('procurement.vendor_bill.read')
  async getPp36PostingSource(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.pp36PostingSource.execute(ctx, id);
  }

  @Post()
  @RequirePermissions('procurement.vendor_bill.create')
  async create(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateVendorBillDto) {
    assertRouteCompany(ctx, companyId);
    return this.createBill.execute(ctx, body);
  }

  @Get(':id')
  @RequireAnyPermission('procurement.vendor_bill.read', 'procurement.vendor_bill.read_related')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.getBill.execute(ctx, id);
  }

  @Patch(':id/tax-evidence')
  @RequirePermissions('procurement.vendor_bill.create')
  async updateEvidence(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: UpdateVendorBillTaxEvidenceDto) {
    assertRouteCompany(ctx, companyId);
    return this.updateTaxEvidence.execute(ctx, id, body);
  }

  @Post(':id/tax-evidence/review')
  @RequirePermissions('procurement.vendor_bill.approve')
  async reviewEvidence(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ReviewVendorBillTaxEvidenceDto) {
    assertRouteCompany(ctx, companyId);
    return this.reviewTaxEvidence.execute(ctx, id, body.status);
  }

  @Get(':id/posting-source')
  @RequirePermissions('procurement.vendor_bill.read')
  async getPostingSource(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.postingSource.execute(ctx, id);
  }

  @Post(':id/match')
  @RequirePermissions('procurement.vendor_bill.match')
  async match(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.matchBill.execute(ctx, id);
  }

  @Post(':id/match/override')
  @RequirePermissions('procurement.vendor_bill.match.override')
  async overrideMatchRoute(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: MatchOverrideDto) {
    assertRouteCompany(ctx, companyId);
    return this.overrideMatch.execute(ctx, id, body.overrideReason);
  }

  @Post(':id/submit')
  @RequirePermissions('procurement.vendor_bill.create')
  async submit(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string) {
    assertRouteCompany(ctx, companyId);
    return this.submitBill.execute(ctx, id);
  }

  @Post(':id/approve')
  @RequirePermissions('procurement.vendor_bill.approve')
  async approve(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: ApprovalNoteDto) {
    assertRouteCompany(ctx, companyId);
    return this.approveBill.execute(ctx, id, body.note);
  }

  @Post(':id/reject')
  @RequirePermissions('procurement.vendor_bill.approve')
  async reject(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: RequiredNoteDto) {
    assertRouteCompany(ctx, companyId);
    return this.rejectBill.execute(ctx, id, body.note);
  }

  @Post(':id/void')
  @RequirePermissions('procurement.vendor_bill.void')
  async void(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('id') id: string, @Body() body: RequiredReasonDto) {
    assertRouteCompany(ctx, companyId);
    return this.voidBill.execute(ctx, id, body.reason);
  }
}
