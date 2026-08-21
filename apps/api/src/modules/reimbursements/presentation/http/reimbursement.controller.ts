import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '@watchdog-bms/contracts';
import type {
  ListReimbursementsFilter,
  ApproveReimbursementInput,
  RejectReimbursementInput,
  FinanceReviewReimbursementInput,
  VoidReimbursementPaymentInput,
  ReimbursementRequestStatus,
  ReimbursementPaymentStatus,
} from '@watchdog-bms/contracts';
import {
  CompleteClaimSignatureUploadDto,
  CreateReimbursementRequestDto,
  InitClaimSignatureUploadDto,
  LinkReimbursementSignedCopyDto,
  RecordReimbursementPaymentDto,
  SignReimbursementClaimFormDto,
  UpdateReimbursementDraftDto,
} from './reimbursement.dtos';
import {
  CreateReimbursementDraftUseCase,
  UpdateReimbursementDraftUseCase,
  GetReimbursementDetailUseCase,
  ListReimbursementsUseCase,
  SubmitReimbursementUseCase,
  CancelReimbursementUseCase,
  ReopenRejectedReimbursementUseCase,
} from '../../application/use-cases/reimbursement-request.use-case';
import { ListApprovalQueueUseCase, ApproveReimbursementUseCase, RejectReimbursementUseCase } from '../../application/use-cases/reimbursement-approval.use-case';
import {
  ListFinanceQueueUseCase,
  FinanceReviewReimbursementUseCase,
  RecordReimbursementPaymentUseCase,
  VoidReimbursementPaymentUseCase,
  ListUnpostedReimbursementPaymentsUseCase,
  ExportReimbursementEvidenceUseCase,
} from '../../application/use-cases/reimbursement-finance.use-case';
import { GetReimbursementAiSummaryUseCase } from '../../application/use-cases/reimbursement-summary.use-case';
import { PreviewReimbursementClaimFormUseCase } from '../../application/use-cases/reimbursement-claim-form.use-case';
import {
  CompleteClaimSignatureUploadUseCase,
  InitClaimSignatureUploadUseCase,
  LinkSignedClaimFormCopyUseCase,
  SignClaimFormUseCase,
} from '../../application/use-cases/reimbursement-claim-signature.use-case';
import { ReimbursementEvidenceService } from '../../application/services/reimbursement-evidence.service';
import { ReimbursementWriteQuiesceGuard } from './reimbursement-write-quiesce.guard';

@ApiTags('reimbursements')
@UseGuards(ReimbursementWriteQuiesceGuard)
@Controller('companies/:companyId/reimbursements')
export class ReimbursementController {
  constructor(
    private readonly createDraft: CreateReimbursementDraftUseCase,
    private readonly updateDraft: UpdateReimbursementDraftUseCase,
    private readonly getDetail: GetReimbursementDetailUseCase,
    private readonly listRequests: ListReimbursementsUseCase,
    private readonly submit: SubmitReimbursementUseCase,
    private readonly cancel: CancelReimbursementUseCase,
    private readonly reopenRejected: ReopenRejectedReimbursementUseCase,
    private readonly approvalQueue: ListApprovalQueueUseCase,
    private readonly approve: ApproveReimbursementUseCase,
    private readonly reject: RejectReimbursementUseCase,
    private readonly financeQueue: ListFinanceQueueUseCase,
    private readonly financeReview: FinanceReviewReimbursementUseCase,
    private readonly recordPayment: RecordReimbursementPaymentUseCase,
    private readonly voidPayment: VoidReimbursementPaymentUseCase,
    private readonly unpostedPayments: ListUnpostedReimbursementPaymentsUseCase,
    private readonly exportEvidence: ExportReimbursementEvidenceUseCase,
    private readonly aiSummary: GetReimbursementAiSummaryUseCase,
    private readonly claimForm: PreviewReimbursementClaimFormUseCase,
    private readonly initSignature: InitClaimSignatureUploadUseCase,
    private readonly completeSignature: CompleteClaimSignatureUploadUseCase,
    private readonly signClaim: SignClaimFormUseCase,
    private readonly linkSignedClaimCopy: LinkSignedClaimFormCopyUseCase,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  /** Decisions/payments return the same detail shape the drawer reads, receipt names included. */
  private async withAttachmentFileName(ctx: RequestContext, detailPromise: Promise<any>) {
    const detail = await detailPromise;
    const [primaryAttachmentFileName, lineFileNames] = await Promise.all([
      this.evidence.getAttachmentFileName(ctx.companyId, detail.primaryAttachmentId),
      this.evidence.getAttachmentFileNames(ctx.companyId, (detail.lines ?? []).map((line: any) => line.attachmentId ?? '')),
    ]);
    return {
      ...detail,
      primaryAttachmentFileName,
      lines: (detail.lines ?? []).map((line: any) => ({ ...line, attachmentFileName: line.attachmentId ? lineFileNames[line.attachmentId] : undefined })),
    };
  }

  // ---- Static routes (declared before :requestId) ----

  @Get('approval-queue')
  // The pending-step snapshot is the real capability. `account.session.read` keeps the global
  // deny-by-default guard explicit while the use case narrows the result to this exact assignee.
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'List reimbursement approval queue (current permission or frozen assignment)' })
  listApprovalQueue(@ReqCtx() ctx: RequestContext) {
    return this.approvalQueue.execute(ctx);
  }

  @Get('finance-queue')
  @RequirePermissions('reimbursement.finance_review')
  @ApiOperation({ summary: 'List reimbursement finance queue' })
  listFinanceQueue(@ReqCtx() ctx: RequestContext) {
    return this.financeQueue.execute(ctx);
  }

  @Get('posting/pending')
  @RequirePermissions('reimbursement.finance_review')
  @ApiOperation({ summary: 'List recorded reimbursement payments awaiting posting' })
  listUnpostedPayments(@ReqCtx() ctx: RequestContext) {
    return this.unpostedPayments.execute(ctx);
  }

  @Get('summary')
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @ApiOperation({ summary: 'Read-only reimbursement summary for AI/LINE' })
  summary(@ReqCtx() ctx: RequestContext) {
    return this.aiSummary.execute(ctx);
  }

  // ---- Request CRUD ----

  @Get()
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @ApiOperation({ summary: 'List reimbursement requests' })
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'related' | 'team' | 'all',
    @Query('status') status?: ReimbursementRequestStatus,
    @Query('paymentStatus') paymentStatus?: ReimbursementPaymentStatus,
    @Query('requesterUserId') requesterUserId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListReimbursementsFilter = {
      scope, status, paymentStatus, requesterUserId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.listRequests.execute(ctx, filter);
  }

  @Post()
  @RequirePermissions('reimbursement.create')
  @ApiOperation({ summary: 'Create reimbursement draft' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateReimbursementRequestDto) {
    return this.createDraft.execute(ctx, body);
  }

  @Get(':requestId')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Get reimbursement detail (read permission or exact frozen approval assignment)' })
  get(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string) {
    return this.getDetail.execute(ctx, requestId);
  }

  @Patch(':requestId')
  @RequirePermissions('reimbursement.update_own_draft')
  @ApiOperation({ summary: 'Update reimbursement draft' })
  update(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: UpdateReimbursementDraftDto) {
    return this.updateDraft.execute(ctx, requestId, body);
  }

  @Post(':requestId/submit')
  @RequirePermissions('reimbursement.submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit reimbursement for approval' })
  submitRequest(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string) {
    return this.submit.execute(ctx, requestId);
  }

  @Post(':requestId/reopen')
  @RequirePermissions('reimbursement.update_own_draft')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen a rejected reimbursement as a draft for correction and resubmission' })
  reopenRequest(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string) {
    return this.reopenRejected.execute(ctx, requestId);
  }

  @Post(':requestId/cancel')
  @RequireAnyPermission('reimbursement.cancel_own', 'reimbursement.finance_review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel reimbursement request' })
  cancelRequest(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: { reason?: string }) {
    return this.cancel.execute(ctx, requestId, body?.reason);
  }

  // ---- Approval ----

  @Post(':requestId/approve')
  @RequirePermissions('account.session.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve reimbursement request (current permission or frozen assignment)' })
  approveRequest(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: ApproveReimbursementInput) {
    return this.withAttachmentFileName(ctx, this.approve.execute(ctx, requestId, body?.comment, body?.approvalSnapshotHash));
  }

  @Post(':requestId/reject')
  @RequirePermissions('account.session.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject reimbursement request (current permission or frozen assignment)' })
  rejectRequest(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: RejectReimbursementInput) {
    return this.withAttachmentFileName(ctx, this.reject.execute(ctx, requestId, body?.reason));
  }

  // ---- Finance and payment ----

  @Post(':requestId/finance-review')
  @RequirePermissions('reimbursement.finance_review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finance review reimbursement request' })
  reviewRequest(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: FinanceReviewReimbursementInput) {
    return this.withAttachmentFileName(ctx, this.financeReview.execute(ctx, requestId, body));
  }

  @Post(':requestId/payments')
  @RequirePermissions('reimbursement.payment.record')
  @ApiOperation({ summary: 'Record reimbursement payment' })
  createPayment(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: RecordReimbursementPaymentDto) {
    return this.withAttachmentFileName(ctx, this.recordPayment.execute(ctx, requestId, body));
  }

  @Post(':requestId/payments/:paymentId/void')
  @RequirePermissions('reimbursement.payment.void')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void reimbursement payment' })
  voidRequestPayment(
    @ReqCtx() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: VoidReimbursementPaymentInput,
  ) {
    return this.withAttachmentFileName(ctx, this.voidPayment.execute(ctx, requestId, paymentId, body));
  }

  @Get(':requestId/export')
  @RequirePermissions('reimbursement.export')
  @ApiOperation({ summary: 'Export reimbursement evidence (bounded JSON)' })
  export(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string) {
    return this.exportEvidence.execute(ctx, requestId);
  }

  // ---- Printable claim form ----

  @Post(':requestId/claim-form/preview')
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @HttpCode(200)
  @ApiOperation({ summary: 'Render the printable ใบเบิกค่าใช้จ่าย for this claim' })
  previewClaimForm(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string) {
    return this.claimForm.execute(ctx, requestId);
  }

  // ---- Claim-form signatures + signed copies ----
  //
  // No new permission keys: the read permission plus the per-role actor check in
  // the use case is the gate (only the real approver may sign ผู้อนุมัติ).

  @Post(':requestId/claim-form/signature-upload-intent')
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @ApiOperation({ summary: 'Start a claim-form signature image upload' })
  initClaimSignature(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: InitClaimSignatureUploadDto) {
    return this.initSignature.execute(ctx, requestId, body);
  }

  @Post(':requestId/claim-form/signature-uploads/:attachmentId/complete')
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @ApiOperation({ summary: 'Complete a claim-form signature image upload' })
  completeClaimSignature(
    @ReqCtx() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: CompleteClaimSignatureUploadDto,
  ) {
    return this.completeSignature.execute(ctx, requestId, attachmentId, body);
  }

  @Post(':requestId/claim-form/signatures')
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign the claim form for one role' })
  signClaimForm(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: SignReimbursementClaimFormDto) {
    return this.signClaim.execute(ctx, requestId, body);
  }

  @Post(':requestId/claim-form/signed-copies')
  @RequireAnyPermission('reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own')
  @HttpCode(200)
  @ApiOperation({ summary: 'Attach a scan of the wet-ink signed claim form' })
  linkSignedCopy(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: LinkReimbursementSignedCopyDto) {
    return this.linkSignedClaimCopy.execute(ctx, requestId, body);
  }
}
