import { Controller, Delete, Get, Post, Patch, Param, Body, Query, HttpCode, UseGuards } from '@nestjs/common';
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
  AttachPaymentSlipDto,
  CompleteClaimSignatureUploadDto,
  CompletePaymentSlipUploadDto,
  CreateReimbursementRequestDto,
  InitClaimSignatureUploadDto,
  InitPaymentSlipUploadDto,
  LinkReimbursementSignedCopyDto,
  RecordReimbursementPaymentDto,
  SignReimbursementClaimFormDto,
  UpdateReimbursementDraftDto,
  ReimbursementInternalNoteDto,
  ReimbursementDraftActionControlDto,
} from './reimbursement.dtos';
import {
  CreateReimbursementDraftUseCase,
  ListReimbursementSourcesUseCase,
  UpdateReimbursementDraftUseCase,
  GetReimbursementDetailUseCase,
  ReimbursementInternalNotesUseCase,
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
import {
  AttachPaymentSlipUseCase,
  CompletePaymentSlipUploadUseCase,
  CreatePaymentSlipDownloadUrlUseCase,
  InitPaymentSlipUploadUseCase,
} from '../../application/use-cases/reimbursement-payment-slip.use-case';
import { ReimbursementEvidenceService } from '../../application/services/reimbursement-evidence.service';
import { ReimbursementWriteQuiesceGuard } from './reimbursement-write-quiesce.guard';
import { LineReimbursementDraftUseCase } from '../../application/use-cases/line-reimbursement-draft.use-case';

@ApiTags('reimbursements')
@UseGuards(ReimbursementWriteQuiesceGuard)
@Controller('companies/:companyId/reimbursements')
export class ReimbursementController {
  constructor(
    private readonly createDraft: CreateReimbursementDraftUseCase,
    private readonly sources: ListReimbursementSourcesUseCase,
    private readonly updateDraft: UpdateReimbursementDraftUseCase,
    private readonly getDetail: GetReimbursementDetailUseCase,
    private readonly internalNotes: ReimbursementInternalNotesUseCase,
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
    private readonly draftActions: LineReimbursementDraftUseCase,
    private readonly initSlip: InitPaymentSlipUploadUseCase,
    private readonly completeSlip: CompletePaymentSlipUploadUseCase,
    private readonly attachSlip: AttachPaymentSlipUseCase,
    private readonly slipDownloadUrl: CreatePaymentSlipDownloadUrlUseCase,
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

  @Get('source-options')
  @RequireAnyPermission('reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.finance_review')
  sourceOptions(@ReqCtx() ctx: RequestContext, @Query('branchId') branchId?: string, @Query('requesterUserId') requesterUserId?: string, @Query('search') search?: string, @Query('expenseId') expenseId?: string) {
    return this.sources.execute(ctx, branchId, requesterUserId, search, expenseId);
  }

  @Get('draft-actions/:actionId')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Render the exact current LINE reimbursement draft preview' })
  getDraftAction(@ReqCtx() ctx: RequestContext, @Param('actionId') actionId: string) {
    return this.draftActions.getForWeb(ctx, actionId);
  }

  @Post('draft-actions/:actionId/confirm')
  @RequirePermissions('account.session.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the exact rendered LINE reimbursement draft preview' })
  confirmDraftAction(@ReqCtx() ctx: RequestContext, @Param('actionId') actionId: string, @Body() body: ReimbursementDraftActionControlDto) {
    return this.draftActions.confirmForWeb(ctx, actionId, body.previewRevision, body.confirmationDigest);
  }

  @Post('draft-actions/:actionId/cancel')
  @RequirePermissions('account.session.read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel the exact LINE reimbursement draft preview without cancelling a reimbursement' })
  cancelDraftAction(@ReqCtx() ctx: RequestContext, @Param('actionId') actionId: string, @Body() body: ReimbursementDraftActionControlDto) {
    return this.draftActions.cancelForWeb(ctx, actionId, body.previewRevision, body.confirmationDigest);
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

  @Post(':requestId/internal-notes')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Add a company-internal reimbursement note' })
  addInternalNote(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: ReimbursementInternalNoteDto) {
    return this.internalNotes.create(ctx, requestId, body.body);
  }

  @Patch(':requestId/internal-notes/:noteId')
  @RequirePermissions('account.session.read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Edit a company-internal reimbursement note' })
  editInternalNote(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string,
    @Param('noteId') noteId: string, @Body() body: ReimbursementInternalNoteDto) {
    return this.internalNotes.update(ctx, requestId, noteId, body.body);
  }

  @Delete(':requestId/internal-notes/:noteId')
  @RequirePermissions('account.session.read')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a company-internal reimbursement note' })
  deleteInternalNote(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Param('noteId') noteId: string) {
    return this.internalNotes.delete(ctx, requestId, noteId);
  }

  @Patch(':requestId')
  @RequireAnyPermission('reimbursement.update_own_draft', 'reimbursement.finance_review')
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
  @ApiOperation({ summary: 'Reopen a rejected reimbursement, or withdraw one nobody has decided yet, as a draft for correction and resubmission' })
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
  // A resolve-only call (no decision) is the payment-step duplicate clear, gated in the use case on
  // payment.record or duplicate.resolve; every decision still requires finance_review there.
  @RequireAnyPermission('reimbursement.finance_review', 'reimbursement.duplicate.resolve', 'reimbursement.payment.record')
  @HttpCode(200)
  @ApiOperation({ summary: 'Finance review reimbursement request, or clear its duplicate block at the payment step' })
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

  // ---- Payment slips ----
  //
  // Payment evidence with its own viewer rule (spec §11, §12.5). Writes are the payer's; opening a
  // slip is decided in the use case, like the claim detail it belongs to.

  @Post(':requestId/payments/slip-upload-intent')
  @RequirePermissions('reimbursement.payment.record')
  @ApiOperation({ summary: 'Start a payment slip upload for this claim' })
  initPaymentSlip(@ReqCtx() ctx: RequestContext, @Param('requestId') requestId: string, @Body() body: InitPaymentSlipUploadDto) {
    return this.initSlip.execute(ctx, requestId, body);
  }

  @Post(':requestId/payments/slip-uploads/:attachmentId/complete')
  @RequirePermissions('reimbursement.payment.record')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete a payment slip upload' })
  completePaymentSlip(
    @ReqCtx() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: CompletePaymentSlipUploadDto,
  ) {
    return this.completeSlip.execute(ctx, requestId, attachmentId, body);
  }

  @Post(':requestId/payments/:paymentId/slips')
  @RequirePermissions('reimbursement.payment.record')
  @HttpCode(200)
  @ApiOperation({ summary: 'Attach a slip to a recorded payment, or move a misfiled signed copy to be its slip' })
  attachPaymentSlip(
    @ReqCtx() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Param('paymentId') paymentId: string,
    @Body() body: AttachPaymentSlipDto,
  ) {
    return this.withAttachmentFileName(ctx, this.attachSlip.execute(ctx, requestId, paymentId, body));
  }

  // `?disposition=inline` is the preview ask, as on the generic attachment download.
  @Get(':requestId/payments/:paymentId/slips/:attachmentId/download-url')
  @RequirePermissions('account.session.read')
  @ApiOperation({ summary: 'Open a payment slip (requester, the claim approver, payment-record or finance-review holders)' })
  paymentSlipDownloadUrl(
    @ReqCtx() ctx: RequestContext,
    @Param('requestId') requestId: string,
    @Param('paymentId') paymentId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('disposition') disposition?: string,
  ) {
    return this.slipDownloadUrl.execute(ctx, requestId, paymentId, attachmentId, disposition === 'inline' ? 'inline' : undefined);
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
