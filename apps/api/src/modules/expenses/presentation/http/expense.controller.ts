import { GetExpenseEWhtSettingUseCase, UpdateExpenseEWhtSettingUseCase } from '../../application/use-cases/expense-e-wht-setting.use-case';
import { ExpensePaymentSlipUploadUseCase } from '../../application/use-cases/expense-upload.use-case';
import { DecideExpenseInputVatUseCase } from '../../application/use-cases/expense-draft.use-case';
import { DecideExpenseInputVatDto, SubstituteReceiptListQueryDto } from './expense.dtos';
import { PrismaService } from '../../../../common/database/prisma.service';
import { Controller, Delete, Put, Get, HttpCode, Post, Patch, Param, Body, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import {
  SetExpenseCategoryAccountantAccountDto,
  AccountantEvidenceBundleDto,
  AccountantPackageDto,
  AccountingSoftwareExportDto,
  AmendSubstituteReceiptDto,
  CorrectSubstituteDocumentDto,
  SubmitSubstituteReceiptPaperDto,
  AcceptSubstituteReceiptPaperDto,
  ConfirmExpenseDto,
  ExpenseTotalsPreviewDto, UpdateExpenseEWhtSettingDto,
  CreateSignatureAssetDto,
  ReasonOptionalDto,
  ReasonRequiredDto,
  VoidExpenseDto,
  ReopenExpenseDto,
  ReceiptUploadCompletionDto,
  RemoveExpenseReceiptDto,
  ReceiptUploadIntentDto,
  RecordExpensePaymentDto,
  ConfirmExpensePaymentDateDto,
  SetSignatureDerivedAssetDto,
  MarkExpenseReadyDto,
  SubstitutePreparationUploadCompletionDto,
  SubstitutePreparationUploadIntentDto,
  UploadCompletionDto,
  UploadIntentDto,
} from './expense.dtos';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  CreateExpenseDraftUseCase,
  GetExpenseUseCase,
  GetExpenseHistoryUseCase,
  ListExpensesUseCase,
  UpdateExpenseDraftUseCase,
  ConfirmExpenseUseCase,
  RejectExpenseUseCase,
  VoidExpenseUseCase,
  MarkExpenseReadyUseCase,
  RecordExpensePaymentUseCase,
  ReopenExpenseUseCase,
  CancelExpensePaymentUseCase,
} from '../../application/use-cases/expense-draft.use-case';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
  GetExpenseSourcePostingInputUseCase,
  DuplicateCheckUseCase,
  ResolveDuplicateUseCase,
  ConfirmBuyerMatchUseCase,
  ListExpenseCategoriesUseCase,
} from '../../application/use-cases/expense-upload.use-case';
import {
  SetExpenseCategoryAccountantAccountUseCase,
  ClearExpenseCategoryAccountantAccountUseCase,
  CreateExpenseCategoryUseCase,
  UpdateExpenseCategoryUseCase,
  ListAllExpenseCategoriesUseCase,
} from '../../application/use-cases/expense-document.use-case';
import {
  PaperSubstituteReceiptUseCase,
  ApproveSubstituteReceiptUseCase,
  CertifySubstituteReceiptUseCase,
  CompleteSubstituteSignatureUploadUseCase,
  DownloadPaymentVoucherPdfUseCase,
  DownloadSubstituteReceiptFormPdfUseCase,
  DownloadSubstituteReceiptPdfUseCase,
  InitSubstituteSignatureUploadUseCase,
  ListCompanySubstituteReceiptsUseCase,
  ListSubstituteReceiptCandidatesUseCase,
  SaveOwnSubstituteReceiptReviewUseCase,
  SubstituteReceiptEvidenceUploadUseCase,
  ListSubstituteReceiptHistoryUseCase,
  ListSubstituteReceiptPayersUseCase,
  PrepareSubstituteReceiptUseCase,
  PreviewSubstituteReceiptUseCase,
  SupersedeSubstituteReceiptUseCase,
} from '../../application/use-cases/substitute-receipt.use-case';
import {
  GetSubstituteReceiptPolicyUseCase,
  UpdateSubstituteReceiptPolicyUseCase,
} from '../../application/use-cases/substitute-receipt-policy.use-case';
import {
  InitSignatureUploadUseCase,
  CreateSignatureAssetUseCase,
  ArchiveSignatureAssetUseCase,
  SetSignatureDerivedAssetUseCase,
  FillSignatureUseCase,
  ListSignatureAssetsUseCase,
  GetSignatureImageUseCase,
  SIGNATURE_OWNER_PERMISSIONS,
} from '../../application/use-cases/signature-asset.use-case';
import {
  GetSharedEvidenceViewUseCase,
  CreateAccountantPackageUseCase,
  CreateAccountingSoftwareExportUseCase,
} from '../../application/use-cases/expense-evidence.use-case';
import { GetExpenseCapturePolicyUseCase } from '../../application/use-cases/expense-capture-policy.use-case';
import { RequestReceiptExtractionUseCase } from '../../application/use-cases/expense-extraction.use-case';
import { ListWhtIncomeCategoriesUseCase } from '../../../procurement/application/use-cases/wht-income-category.use-case';
import { RemoveExpenseReceiptUseCase } from '../../application/use-cases/remove-expense-receipt.use-case';
import { DeleteExpenseUseCase } from '../../application/use-cases/delete-expense.use-case';
import { LineSubstituteReceiptContinuationUseCase } from '../../application/use-cases/line-substitute-receipt-continuation.use-case';
import type {
  CreateExpenseDraftInput, UpdateExpenseDraftInput, ExpenseStatus,
  CreateExpenseCategoryInput, UpdateExpenseCategoryInput,
  SignatureFillInput, GenerateSubstituteReceiptInput, SharedEvidenceFilter,
  NonExpenseClassificationOverrideInput, OcrTotalAcknowledgementInput, SourceDocumentType, CertifySubstituteReceiptInput, ApproveSubstituteReceiptInput,
  UpdateSubstituteReceiptPolicyInput,
  PreviewSubstituteReceiptInput,
  SupersedeSubstituteReceiptInput,
} from '@watchdog-bms/contracts';

@Controller('companies/:companyId/expenses')
export class ExpenseController {
  constructor(
    private readonly create: CreateExpenseDraftUseCase,
    private readonly get: GetExpenseUseCase,
    private readonly history: GetExpenseHistoryUseCase,
    private readonly decideVat: DecideExpenseInputVatUseCase,
    private readonly list: ListExpensesUseCase,
    private readonly update: UpdateExpenseDraftUseCase,
    private readonly confirm: ConfirmExpenseUseCase,
    private readonly reject: RejectExpenseUseCase,
    private readonly void_: VoidExpenseUseCase,
    private readonly ready: MarkExpenseReadyUseCase,
    private readonly payment: RecordExpensePaymentUseCase,
    private readonly paymentSlip: ExpensePaymentSlipUploadUseCase,
    private readonly reopen: ReopenExpenseUseCase,
    private readonly cancelPayment: CancelExpensePaymentUseCase,
    private readonly initUpload: InitReceiptUploadUseCase,
    private readonly completeUpload: CompleteReceiptUploadUseCase,
    private readonly sourcePosting: GetExpenseSourcePostingInputUseCase,
    private readonly dupCheck: DuplicateCheckUseCase,
    private readonly dupResolve: ResolveDuplicateUseCase,
    private readonly listCats: ListExpenseCategoriesUseCase,
    private readonly ownCertificateReview: SaveOwnSubstituteReceiptReviewUseCase,
    private readonly preparationUploads: SubstituteReceiptEvidenceUploadUseCase,
    private readonly prepareSubstituteReceipt: PrepareSubstituteReceiptUseCase,
    private readonly lineSubstituteReceiptContinuation: LineSubstituteReceiptContinuationUseCase,
    private readonly previewSubstituteReceipt: PreviewSubstituteReceiptUseCase,
    private readonly certifySubstituteReceipt: CertifySubstituteReceiptUseCase,
    private readonly paperSubstituteReceipt: PaperSubstituteReceiptUseCase,
    private readonly approveSubstituteReceipt: ApproveSubstituteReceiptUseCase,
    private readonly substituteReceiptPayers: ListSubstituteReceiptPayersUseCase,
    private readonly substituteReceiptHistory: ListSubstituteReceiptHistoryUseCase,
    private readonly supersedeSubstituteReceipt: SupersedeSubstituteReceiptUseCase,
    private readonly initSubstituteSignatureUpload: InitSubstituteSignatureUploadUseCase,
    private readonly completeSubstituteSignatureUpload: CompleteSubstituteSignatureUploadUseCase,
    private readonly downloadPaymentVoucherPdf: DownloadPaymentVoucherPdfUseCase,
    private readonly downloadSubstituteReceiptPdf: DownloadSubstituteReceiptPdfUseCase,
    private readonly downloadSubstituteReceiptFormPdf: DownloadSubstituteReceiptFormPdfUseCase,
    private readonly signatureFill: FillSignatureUseCase,
    private readonly sharedEvidence: GetSharedEvidenceViewUseCase,
    private readonly accountantPackage: CreateAccountantPackageUseCase,
    private readonly softwareExport: CreateAccountingSoftwareExportUseCase,
    private readonly requestExtraction: RequestReceiptExtractionUseCase,
    private readonly deleteExpense: DeleteExpenseUseCase,
    private readonly removeReceipt: RemoveExpenseReceiptUseCase,
    private readonly capturePolicy: GetExpenseCapturePolicyUseCase,
    private readonly buyerMatch: ConfirmBuyerMatchUseCase,
    private readonly listWhtCategories: ListWhtIncomeCategoriesUseCase,
    private readonly prisma: PrismaService,
  ) {}

  // Any authority that puts a user on an expense screen may read it: the answer is only whether
  // the form asks Thai VAT questions, and the registration fact itself stays masked without
  // `company.vat_registration.read`. Declared before `:expenseId` so the literal path wins.
  @Get('capture-policy')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.create', 'expense.review')
  captureExpensePolicy(@ReqCtx() ctx: RequestContext, @Query('on') on?: string) {
    return this.capturePolicy.execute(ctx, on);
  }

  // WHT certificate system issuance plan §1.2: the ACTIVE income-category catalog AP already reads
  // under `procurement.supplier_payment.read` — reused here under `expense.create` (the permission
  // that already gates entering/saving this side) rather than `tax.config.read`, same reasoning as
  // the AP endpoint. Registered before `:expenseId` — see NOTE below.
  @Get('wht-income-categories')
  @RequirePermissions('expense.create')
  async whtIncomeCategories(@ReqCtx() ctx: RequestContext) {
    const rows = await this.listWhtCategories.execute(ctx);
    const routes = await this.prisma.client.whtIncomeCategory.findMany({ where: { code: { in: rows.map(row => row.code) } }, select: { code: true, filingRoute: true } });
    const byCode = new Map(routes.map(row => [row.code, row.filingRoute]));
    return rows.map(row => ({ ...row, filingRoute: byCode.get(row.code) ?? 'SYSTEM_FILLS' }));
  }

  @Get()
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.review')
  listExpenses(
    @ReqCtx() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('duplicateStatus') duplicateStatus?: string,
    @Query('vendorCounterpartyId') vendorCounterpartyId?: string,
    @Query('sourceDocumentType') sourceDocumentType?: string,
    @Query('vendorAddressMissing') vendorAddressMissing?: string,
    @Query('taxEvidenceStatus') taxEvidenceStatus?: string,
    @Query('expenseCategoryId') expenseCategoryId?: string,
    @Query('captureSource') captureSource?: string,
    @Query('postingStatus') postingStatus?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('uploadedFromDate') uploadedFromDate?: string,
    @Query('uploadedToDate') uploadedToDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.list.execute(ctx, {
      ...(status && { status: status as ExpenseStatus }),
      ...(branchId && { branchId }),
      ...(paymentStatus && { paymentStatus: paymentStatus as any }),
      ...(duplicateStatus && { duplicateStatus: duplicateStatus as any }),
      ...(vendorCounterpartyId && { vendorCounterpartyId }),
      ...(sourceDocumentType && { sourceDocumentType: sourceDocumentType as any }),
      // GAP-11: only the literal string turns it on, so `?vendorAddressMissing=false` means off
      // rather than "any non-empty value is truthy".
      ...(vendorAddressMissing === 'true' && { vendorAddressMissing: true }),
      ...(taxEvidenceStatus && { taxEvidenceStatus: taxEvidenceStatus as any }),
      ...(expenseCategoryId && { expenseCategoryId }),
      ...(captureSource && { captureSource: captureSource as any }),
      ...(postingStatus && { postingStatus: postingStatus as any }),
      ...(fromDate && { fromDate }),
      ...(toDate && { toDate }),
      ...(uploadedFromDate && { uploadedFromDate }),
      ...(uploadedToDate && { uploadedToDate }),
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  // NOTE: static routes must stay above the :expenseId param routes.
  @Get('shared-evidence')
  @RequirePermissions('expense.evidence.read')
  getSharedEvidence(@ReqCtx() ctx: RequestContext, @Query() query: Record<string, string>) {
    const filter: SharedEvidenceFilter = {
      ...(query['branchId'] && { branchId: query['branchId'] }),
      ...(query['dateField'] === 'uploadedAt' ? { dateField: 'uploadedAt' as const } : { dateField: 'expenseDate' as const }),
      ...(query['fromDate'] && { fromDate: query['fromDate'] }),
      ...(query['toDate'] && { toDate: query['toDate'] }),
      ...(query['yearMonth'] && { yearMonth: query['yearMonth'] }),
      ...(query['status'] && { status: query['status'] as ExpenseStatus }),
      ...(query['sourceDocumentType'] && { sourceDocumentType: query['sourceDocumentType'] as any }),
      ...(query['taxEvidenceStatus'] && { taxEvidenceStatus: query['taxEvidenceStatus'] as any }),
      ...(query['expenseCategoryId'] && { expenseCategoryId: query['expenseCategoryId'] }),
      ...(query['paymentStatus'] && { paymentStatus: query['paymentStatus'] as any }),
      ...(query['postingStatus'] && { postingStatus: query['postingStatus'] as any }),
      ...(query['createdByUserId'] && { createdByUserId: query['createdByUserId'] }),
      ...(query['page'] && { page: parseInt(query['page'], 10) }),
      ...(query['pageSize'] && { pageSize: parseInt(query['pageSize'], 10) }),
    };
    return this.sharedEvidence.execute(ctx, filter);
  }

  @Post('accountant-package/bundle-plan')
  @HttpCode(200)
  @RequirePermissions('expense.export')
  planAccountantBundle(@ReqCtx() ctx: RequestContext, @Body() body: AccountantEvidenceBundleDto) {
    return this.accountantPackage.planBundle(ctx, body);
  }

  @Post('accountant-package/bundle/:part')
  @HttpCode(200)
  @RequirePermissions('expense.export')
  async downloadAccountantBundle(@ReqCtx() ctx: RequestContext, @Body() body: AccountantEvidenceBundleDto, @Param('part') part: string, @Res({ passthrough: true }) response: Response) {
    const result = await this.accountantPackage.downloadBundle(ctx, body, Number(part));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="evidence.zip"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`);
    return new StreamableFile(result.bytes, { type: 'application/zip' });
  }

  @Post('accounting-software-export')
  @HttpCode(200)
  @RequirePermissions('expense.export')
  createAccountingSoftwareExport(@ReqCtx() ctx: RequestContext, @Body() body: AccountingSoftwareExportDto) {
    return this.softwareExport.execute(ctx, body);
  }

  @Post('accountant-package')
  @RequirePermissions('expense.export')
  createAccountantPackage(@ReqCtx() ctx: RequestContext, @Body() body: AccountantPackageDto) {
    return this.accountantPackage.execute(ctx, body ?? {});
  }

  @Post()
  @RequirePermissions('expense.create')
  createDraft(@ReqCtx() ctx: RequestContext, @Body() body: CreateExpenseDraftInput) {
    return this.create.execute(ctx, body);
  }

  @Post('receipt-uploads')
  @RequirePermissions('expense.receipt.upload')
  initReceiptUpload(
    @ReqCtx() ctx: RequestContext,
    @Body() body: ReceiptUploadIntentDto,
  ) {
    return this.initUpload.execute(ctx, body);
  }

  // Either authority reaches the use case, which owns the real rule: `expense.delete` deletes in
  // scope, `expense.update` only the caller's own draft. Finance-template roles hold the first alone.
  @Delete(':expenseId')
  @HttpCode(204)
  @RequireAnyPermission('expense.delete', 'expense.update')
  async removeExpense(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string): Promise<void> {
    await this.deleteExpense.execute(ctx, expenseId);
  }

  @Get(':expenseId')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.create', 'expense.review', 'expense.confirm', 'expense.receipt.upload', 'expense.receipt.line_upload')
  async getExpense(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    const expense = await this.get.execute(ctx, expenseId);
    const sourceDraft = await this.get.sourceDraft(ctx, expense);
    // `buyerAsPrinted` is the parsed form of `buyerAsPrintedJson`; the detail carries only that one.
    const { sourceChannelMetadataJson: _metadata, lineMessageId: _message, lineEventId: _event, buyerAsPrintedJson: _buyer, ...detail } = expense;
    return { ...detail, inputVatRight: await this.get.inputVatRight(ctx, expenseId), reviewRequest: await this.get.reviewRequest(ctx, expense), ...await this.get.correctionHistory(ctx, expense), sourceDraft, correctionCapabilities: await this.get.correctionCapabilities(ctx, expenseId) };
  }

  @Post(':expenseId/payments/slip-upload-intent')
  @RequirePermissions('expense.payment.record')
  initPaymentSlip(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: UploadIntentDto) {
    return this.paymentSlip.init(ctx, expenseId, body);
  }

  @Post(':expenseId/payments/slip-uploads/:attachmentId/complete')
  @RequirePermissions('expense.payment.record')
  completePaymentSlip(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('attachmentId') attachmentId: string, @Body() body: UploadCompletionDto) {
    return this.paymentSlip.complete(ctx, expenseId, attachmentId, body);
  }

  @Post(':expenseId/input-vat-decision')
  @RequireAnyPermission('expense.review')
  decideInputVat(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: DecideExpenseInputVatDto) {
    return this.decideVat.execute(ctx, expenseId, body);
  }

  @Get(':expenseId/history')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.create', 'expense.review', 'expense.confirm', 'expense.receipt.upload', 'expense.receipt.line_upload')
  getHistory(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Query('page') page?: string) {
    return this.history.execute(ctx, expenseId, page === undefined ? 1 : Number(page));
  }

  @Get(':expenseId/payment-voucher.pdf')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.review')
  async downloadPaymentVoucher(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Query('paymentDate') paymentDate: string | undefined,
    @Query('payeeName') payeeName: string | undefined,
    @Query('payeeAddress') payeeAddress: string | undefined,
    @Query('payeeTaxId') payeeTaxId: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { data, fileName } = await this.downloadPaymentVoucherPdf.execute(ctx, expenseId, {
      ...(paymentDate !== undefined ? { paymentDate } : {}),
      ...(payeeName !== undefined ? { payeeName } : {}),
      ...(payeeAddress !== undefined ? { payeeAddress } : {}),
      ...(payeeTaxId !== undefined ? { payeeTaxId } : {}),
    });
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('Content-Disposition', `attachment; filename="payment-voucher.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return new StreamableFile(data, { type: 'application/pdf' });
  }

  @Post(':expenseId/substitute-receipt/evidence-upload')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  initPreparationUpload(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: SubstitutePreparationUploadIntentDto) {
    return this.preparationUploads.init(ctx, expenseId, body);
  }

  @Post(':expenseId/substitute-receipt/evidence-upload/:attachmentId/complete')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  completePreparationUpload(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('attachmentId') attachmentId: string, @Body() body: SubstitutePreparationUploadCompletionDto) {
    return this.preparationUploads.complete(ctx, expenseId, attachmentId, body);
  }

  @Post(':expenseId/substitute-receipt')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  prepareSubstitute(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: GenerateSubstituteReceiptInput) {
    return this.prepareSubstituteReceipt.execute(ctx, expenseId, body);
  }

  @Patch(':expenseId/substitute-receipt/:evidenceId')
  @RequirePermissions('expense.review')
  amendSubstitute(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('evidenceId') evidenceId: string, @Body() body: AmendSubstituteReceiptDto) {
    return this.prepareSubstituteReceipt.executeAmendment(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/correct-document')
  @RequirePermissions('expense.review')
  correctSubstituteDocument(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('evidenceId') evidenceId: string, @Body() body: CorrectSubstituteDocumentDto) {
    return this.prepareSubstituteReceipt.executeCorrection(ctx, expenseId, evidenceId, body);
  }

  @Get(':expenseId/substitute-receipt/continuations/:workflowId')
  @RequirePermissions('expense.review')
  loadLineSubstituteContinuation(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('workflowId') workflowId: string,
  ) {
    return this.lineSubstituteReceiptContinuation.loadForWeb(ctx, expenseId, workflowId);
  }

  @Get(':expenseId/substitute-receipt/payers')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  listSubstitutePayers(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.substituteReceiptPayers.execute(ctx, expenseId);
  }

  @Get(':expenseId/substitute-receipt/history')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  listSubstituteHistory(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.substituteReceiptHistory.execute(ctx, expenseId);
  }

  @Get(':expenseId/substitute-receipt/:evidenceId/artifact.pdf')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.review', 'expense.confirm')
  async downloadSubstitutePdf(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { data, fileName } = await this.downloadSubstituteReceiptPdf.execute(ctx, expenseId, evidenceId);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return new StreamableFile(data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get(':expenseId/substitute-receipt/:evidenceId/artifact-preview')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.review', 'expense.confirm')
  async previewIssuedSubstitute(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return this.downloadSubstituteReceiptPdf.preview(ctx, expenseId, evidenceId);
  }

  // R8: derived on demand from the PREPARED snapshot, never stored, never "issued". `expense.review`
  // matches the permission that prepared it — the use case enforces the same gate.
  @Get(':expenseId/substitute-receipt/:evidenceId/form.pdf')
  @RequirePermissions('expense.review')
  async downloadSubstituteFormPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { data, fileName } = await this.downloadSubstituteReceiptFormPdf.execute(ctx, expenseId, evidenceId);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return new StreamableFile(data, {
      type: 'application/pdf',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/certify')
  @RequireAnyPermission('expense.read_related', 'expense.read_own')
  certifySubstitute(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: CertifySubstituteReceiptInput,
  ) {
    return this.certifySubstituteReceipt.execute(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/preview')
  @RequireAnyPermission('expense.read_related', 'expense.read_own')
  previewSubstitute(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: PreviewSubstituteReceiptInput,
  ) {
    return this.previewSubstituteReceipt.execute(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/paper/upload-intent')
  @RequirePermissions('expense.review')
  initPaperUpload(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('evidenceId') evidenceId: string, @Body() body: UploadIntentDto) {
    return this.paperSubstituteReceipt.initUpload(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/paper/submit')
  @RequirePermissions('expense.review')
  submitPaper(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('evidenceId') evidenceId: string, @Body() body: SubmitSubstituteReceiptPaperDto) {
    return this.paperSubstituteReceipt.submit(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/paper/preview')
  @RequireAnyPermission('expense.review', 'expense.confirm')
  previewPaper(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('evidenceId') evidenceId: string) {
    return this.paperSubstituteReceipt.preview(ctx, expenseId, evidenceId);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/paper/accept')
  @RequirePermissions('expense.confirm')
  acceptPaper(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('evidenceId') evidenceId: string, @Body() body: AcceptSubstituteReceiptPaperDto) {
    return this.paperSubstituteReceipt.accept(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/signature-upload-intent')
  @RequireAnyPermission('expense.read_related', 'expense.read_own')
  initSubstituteSignature(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: UploadIntentDto,
  ) {
    return this.initSubstituteSignatureUpload.execute(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/signature-uploads/:attachmentId/complete')
  @RequireAnyPermission('expense.read_related', 'expense.read_own')
  completeSubstituteSignature(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: UploadCompletionDto,
  ) {
    return this.completeSubstituteSignatureUpload.execute(ctx, expenseId, evidenceId, attachmentId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/approve')
  @RequirePermissions('expense.confirm')
  approveSubstitute(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: ApproveSubstituteReceiptInput,
  ) {
    return this.approveSubstituteReceipt.execute(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/substitute-receipt/:evidenceId/supersede')
  @RequirePermissions('expense.review')
  supersedeSubstitute(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('evidenceId') evidenceId: string,
    @Body() body: SupersedeSubstituteReceiptInput,
  ) {
    return this.supersedeSubstituteReceipt.execute(ctx, expenseId, evidenceId, body);
  }

  @Post(':expenseId/extraction-request')
  @RequireAnyPermission('expense.ocr.request', 'expense.review', 'expense.receipt.upload')
  requestReceiptExtraction(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.requestExtraction.execute(ctx, expenseId);
  }

  @Post(':expenseId/signature-fill')
  @RequirePermissions('expense.review')
  fillSignature(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: SignatureFillInput & { checksumSha256?: string; byteSize?: number }) {
    return this.signatureFill.execute(ctx, expenseId, body);
  }

  @Patch(':expenseId')
  @RequireAnyPermission('expense.update', 'expense.review', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload')
  async updateDraft(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: UpdateExpenseDraftInput & { expectedUpdatedAt: string }) {
    // Every person who may edit a draft saves through the draft update, which itself decides what
    // each right may change. The certificate-only rule belongs to `review-fields` below: routing
    // non-reviewers through it here refused a plain employee's own draft save (2026-10-13).
    const expense = await this.update.execute(ctx, expenseId, body, { requireExpectedUpdatedAt: true });
    const { sourceChannelMetadataJson: _metadata, lineMessageId: _message, lineEventId: _event, ...detail } = expense;
    return detail;
  }

  @Post(':expenseId/totals-preview')
  @RequireAnyPermission('expense.update', 'expense.review')
  previewDraftTotals(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: ExpenseTotalsPreviewDto) {
    return this.update.execute(ctx, expenseId, body, { requireExpectedUpdatedAt: true, previewOnly: true });
  }

  @Patch(':expenseId/review-fields')
  @RequireAnyPermission('expense.review', 'expense.read', 'expense.read_related', 'expense.read_own', 'expense.confirm')
  async updateReviewFields(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: UpdateExpenseDraftInput & { expectedUpdatedAt: string }) {
    const expense = ctx.permissions.includes('expense.review')
      ? await this.update.execute(ctx, expenseId, body, { requireExpectedUpdatedAt: true })
      : await this.ownCertificateReview.execute(ctx, expenseId, body);
    const { sourceChannelMetadataJson: _metadata, lineMessageId: _message, lineEventId: _event, ...detail } = expense;
    return detail;
  }

  @Post(':expenseId/non-expense-classification-override')
  @RequirePermissions('expense.review')
  overrideNonExpenseClassification(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Body() body: NonExpenseClassificationOverrideInput & { sourceDocumentType: SourceDocumentType; expectedUpdatedAt: string },
  ) {
    return this.update.execute(ctx, expenseId, {
      sourceDocumentType: body.sourceDocumentType,
      expectedUpdatedAt: body.expectedUpdatedAt,
      nonExpenseClassificationOverride: {
        acknowledged: body.acknowledged,
        reason: body.reason,
      },
    }, { requireExpectedUpdatedAt: true });
  }

  @Post(':expenseId/ocr-total-acknowledgement')
  @RequirePermissions('expense.review')
  acknowledgeOcrTotal(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: OcrTotalAcknowledgementInput & { expectedUpdatedAt: string }) {
    const { expectedUpdatedAt, ...acknowledgement } = body;
    return this.update.execute(ctx, expenseId, {
      expectedUpdatedAt,
      ocrTotalAcknowledgement: acknowledgement,
    }, { requireExpectedUpdatedAt: true });
  }

  @Delete(':expenseId/receipts/:attachmentId')
  @HttpCode(204)
  @RequireAnyPermission('expense.update', 'expense.review')
  removeExpenseReceipt(
    @ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string,
    @Param('attachmentId') attachmentId: string, @Body() body: RemoveExpenseReceiptDto,
  ) {
    return this.removeReceipt.execute(ctx, expenseId, attachmentId, body.expectedUpdatedAt, body.purpose);
  }

  @Post(':expenseId/receipt-uploads/:attachmentId/complete')
  @RequireAnyPermission('expense.receipt.upload', 'expense.review')
  completeReceiptUpload(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: ReceiptUploadCompletionDto,
  ) {
    return this.completeUpload.execute(ctx, { expenseId, attachmentId, ...body });
  }

  @Get(':expenseId/reviewers')
  @RequireAnyPermission('expense.update', 'expense.review')
  reviewers(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.ready.reviewers(ctx, expenseId);
  }

  @Post(':expenseId/mark-ready')
  @RequirePermissions('expense.update')
  markReady(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: MarkExpenseReadyDto) {
    return this.ready.execute(ctx, expenseId, body.requestedReviewerUserId);
  }

  @Post(':expenseId/reviewer-mark-ready')
  @RequirePermissions('expense.review')
  markReadyAsReviewer(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: MarkExpenseReadyDto) {
    return this.ready.execute(ctx, expenseId, body.requestedReviewerUserId);
  }

  @Post(':expenseId/confirm')
  @RequirePermissions('expense.confirm')
  confirmExpense(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: ConfirmExpenseDto) {
    return this.confirm.execute(ctx, expenseId, body?.vatSourceOverride);
  }

  @Post(':expenseId/reject')
  @RequirePermissions('expense.reject')
  rejectExpense(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: ReasonRequiredDto) {
    return this.reject.execute(ctx, expenseId, body.reason);
  }

  @Post(':expenseId/void')
  @RequirePermissions('expense.void')
  voidExpense(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: VoidExpenseDto) {
    return this.void_.execute(ctx, expenseId, body.reason, body.taxFilingAttested);
  }

  @Post(':expenseId/reopen')
  @RequirePermissions('expense.confirm')
  reopenExpense(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: ReopenExpenseDto) {
    return this.reopen.execute(ctx, expenseId, body.reason, body.taxFilingAttested);
  }

  @Post(':expenseId/payments/:paymentId/cancel')
  @RequirePermissions('expense.payment.record')
  cancelExpensePayment(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('paymentId') paymentId: string, @Body() body: ReasonRequiredDto) {
    return this.cancelPayment.execute(ctx, expenseId, paymentId, body.reason);
  }

  @Post(':expenseId/payments/:paymentId/confirm-date')
  @RequirePermissions('expense.payment.record')
  confirmPaymentDate(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('paymentId') paymentId: string, @Body() body: ConfirmExpensePaymentDateDto) {
    return this.payment.confirmDate(ctx, expenseId, paymentId, body.paidAt);
  }

  @Post(':expenseId/payment')
  @RequirePermissions('expense.payment.record')
  recordPayment(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Body() body: RecordExpensePaymentDto,
  ) {
    return this.payment.execute(ctx, expenseId, body);
  }

  @Post(':expenseId/duplicate-check')
  @RequirePermissions('expense.review')
  duplicateCheck(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.dupCheck.execute(ctx, expenseId);
  }

  @Post(':expenseId/duplicates/:candidateId/dismiss')
  @RequirePermissions('expense.duplicate.resolve')
  dismissDuplicate(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('candidateId') candidateId: string, @Body() body: ReasonOptionalDto) {
    return this.dupResolve.execute(ctx, expenseId, candidateId, 'dismiss', body.reason);
  }

  @Post(':expenseId/duplicates/:candidateId/confirm')
  @RequirePermissions('expense.duplicate.resolve')
  confirmDuplicate(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Param('candidateId') candidateId: string, @Body() body: ReasonOptionalDto) {
    return this.dupResolve.execute(ctx, expenseId, candidateId, 'confirm', body.reason);
  }

  // Vendor-address §8 Slice 2: the reason is required, but the use case refuses a blank one with its
  // own code (`expense_buyer_match_reason_required`), so the DTO only checks type and length.
  @Post(':expenseId/buyer-match/confirm')
  @RequirePermissions('expense.confirm')
  confirmBuyerMatch(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string, @Body() body: ReasonOptionalDto) {
    return this.buyerMatch.execute(ctx, expenseId, body.reason);
  }

  @Get(':expenseId/source-posting-input')
  @RequirePermissions('expense.read')
  getSourcePosting(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.sourcePosting.execute(ctx, expenseId);
  }
}

@Controller('companies/:companyId/expense-categories')
export class ExpenseCategoryController {
  constructor(
    private readonly listCats: ListExpenseCategoriesUseCase,
    private readonly listAllCats: ListAllExpenseCategoriesUseCase,
    private readonly createCat: CreateExpenseCategoryUseCase,
    private readonly updateCat: UpdateExpenseCategoryUseCase,
    private readonly setAccount: SetExpenseCategoryAccountantAccountUseCase,
    private readonly clearAccount: ClearExpenseCategoryAccountantAccountUseCase,
  ) {}

  @Get()
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.review', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload')
  listCategories(@ReqCtx() ctx: RequestContext) {
    return this.listCats.execute(ctx);
  }

  /** Management view including archived categories. */
  @Get('manage')
  @RequirePermissions('expense.category.manage')
  listAllCategories(@ReqCtx() ctx: RequestContext) {
    return this.listAllCats.execute(ctx);
  }

  @Post()
  @RequirePermissions('expense.category.manage')
  createCategory(@ReqCtx() ctx: RequestContext, @Body() body: CreateExpenseCategoryInput) {
    return this.createCat.execute(ctx, body);
  }

  @Put(':categoryId/accountant-account')
  @RequirePermissions('expense.category.manage')
  setAccountantAccount(@ReqCtx() ctx: RequestContext, @Param('categoryId') categoryId: string, @Body() body: SetExpenseCategoryAccountantAccountDto) {
    return this.setAccount.execute(ctx, categoryId, body);
  }

  @Delete(':categoryId/accountant-account')
  @HttpCode(204)
  @RequirePermissions('expense.category.manage')
  clearAccountantAccount(@ReqCtx() ctx: RequestContext, @Param('categoryId') categoryId: string) {
    return this.clearAccount.execute(ctx, categoryId);
  }

  @Patch(':categoryId')
  @RequirePermissions('expense.category.manage')
  updateCategory(@ReqCtx() ctx: RequestContext, @Param('categoryId') categoryId: string, @Body() body: UpdateExpenseCategoryInput) {
    return this.updateCat.execute(ctx, categoryId, body);
  }
}

@Controller('companies/:companyId/substitute-receipts')
export class CompanySubstituteReceiptController {
  constructor(private readonly listSubstituteReceipts: ListCompanySubstituteReceiptsUseCase, private readonly candidates: ListSubstituteReceiptCandidatesUseCase, private readonly history: ListSubstituteReceiptHistoryUseCase) {}

  @Get(':evidenceId/expense')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  async resolveExpense(@ReqCtx() ctx: RequestContext, @Param('evidenceId') evidenceId: string) {
    return { expenseId: await this.history.resolveExpenseId(ctx, evidenceId) };
  }

  @Get('candidates')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  listCandidates(@ReqCtx() ctx: RequestContext, @Query() query: Record<string, string | undefined>) {
    return this.candidates.execute(ctx, { branchId: query['branchId'], search: query['search'], includeBlocked: query['includeBlocked'] === 'true',
      page: query['page'] ? Number(query['page']) : undefined, pageSize: query['pageSize'] ? Number(query['pageSize']) : undefined });
  }

  @Get()
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  list(@ReqCtx() ctx: RequestContext, @Query() query: SubstituteReceiptListQueryDto) {
    return this.listSubstituteReceipts.execute(ctx, query);
  }
}

@Controller('companies/:companyId/expense-settings')
export class ExpenseSettingsController {
  constructor(
    private readonly getSubstitutePolicy: GetSubstituteReceiptPolicyUseCase,
    private readonly updateSubstitutePolicy: UpdateSubstituteReceiptPolicyUseCase,
    private readonly getEWhtSetting: GetExpenseEWhtSettingUseCase,
    private readonly updateEWhtSetting: UpdateExpenseEWhtSettingUseCase,
  ) {}

  @Get('e-wht')
  @RequireAnyPermission('company.setup.manage', 'expense.review', 'expense.confirm', 'expense.create', 'expense.update', 'expense.read', 'expense.read_related', 'expense.read_own')
  getEWht(@ReqCtx() ctx: RequestContext) {
    return this.getEWhtSetting.execute(ctx);
  }

  @Patch('e-wht')
  @RequirePermissions('company.setup.manage')
  updateEWht(@ReqCtx() ctx: RequestContext, @Body() body: UpdateExpenseEWhtSettingDto) {
    return this.updateEWhtSetting.execute(ctx, body);
  }

  @Get('substitute-receipt')
  @RequirePermissions('company.setup.manage')
  getPolicy(@ReqCtx() ctx: RequestContext) {
    return this.getSubstitutePolicy.execute(ctx);
  }

  @Get('substitute-receipt/runtime')
  @RequireAnyPermission('expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own')
  getRuntimePolicy(@ReqCtx() ctx: RequestContext) {
    return this.getSubstitutePolicy.executeRuntime(ctx);
  }

  @Patch('substitute-receipt')
  @RequirePermissions('company.setup.manage')
  updatePolicy(@ReqCtx() ctx: RequestContext, @Body() body: UpdateSubstituteReceiptPolicyInput) {
    return this.updateSubstitutePolicy.execute(ctx, body);
  }
}

@Controller('companies/:companyId/expense-signatures')
export class ExpenseSignatureController {
  constructor(
    private readonly listAssets: ListSignatureAssetsUseCase,
    private readonly initUpload: InitSignatureUploadUseCase,
    private readonly createAsset: CreateSignatureAssetUseCase,
    private readonly archive: ArchiveSignatureAssetUseCase,
    private readonly setDerived: SetSignatureDerivedAssetUseCase,
    private readonly signatureImage: GetSignatureImageUseCase,
  ) {}

  /**
   * The bytes behind `previewUrl`. Same-origin through this API rather than a raw presigned storage
   * URL, because Chrome's ORB refuses a cross-origin storage response bound into `<img src>` — the
   * signer saw a broken image and certified blind. Owner-only, enforced in the use case.
   */
  @Get('images/:attachmentId')
  @RequireAnyPermission(...SIGNATURE_OWNER_PERMISSIONS)
  async signatureImageBytes(
    @ReqCtx() ctx: RequestContext,
    @Param('attachmentId') attachmentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { bytes, mimeType, fileName } = await this.signatureImage.execute(ctx, attachmentId);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    // The uploaded name is the signer's own, and on this product that is Thai — “ลายเซ็น.png”. A
    // non-latin1 byte in a header value is `ERR_INVALID_CHAR`, so quoting it raw turned the one
    // request that shows the signer their signature into a 500 and put them back to certifying
    // blind. RFC 5987 form, same as the payment-voucher download above: an ASCII fallback for the
    // quoted parameter, the real name only in the percent-encoded one.
    const asciiName = mimeType === 'image/jpeg' ? 'signature.jpg' : 'signature.png';
    return new StreamableFile(bytes, {
      type: mimeType,
      disposition: `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  /**
   * `RequirePermissions` is ALL-of, while personal-signature self service accepts any one of the
   * compatible grants below. The use cases then enforce owner-only scope on every row and image.
   */
  @Get()
  @RequireAnyPermission(...SIGNATURE_OWNER_PERMISSIONS)
  list(@ReqCtx() ctx: RequestContext, @Query('status') status?: string) {
    return this.listAssets.execute(ctx, status);
  }

  @Post('uploads')
  @RequireAnyPermission(...SIGNATURE_OWNER_PERMISSIONS)
  initSignatureUpload(@ReqCtx() ctx: RequestContext, @Body() body: UploadIntentDto) {
    return this.initUpload.execute(ctx, body);
  }

  @Post()
  @RequireAnyPermission(...SIGNATURE_OWNER_PERMISSIONS)
  createSignature(@ReqCtx() ctx: RequestContext, @Body() body: CreateSignatureAssetDto) {
    // Built field-by-field, never spread: `attachmentAlreadyActive`/`lineMessageId` are LINE-only
    // internals the use case honours, and spreading a caller's body would let a web request skip the
    // PENDING_UPLOAD/ownership gate and point a signature asset at any ACTIVE attachment. Channel is
    // set server-side; the LINE path calls the use case directly, so it keeps those fields.
    return this.createAsset.execute(ctx, {
      attachmentId: body.attachmentId,
      label: body.label,
      checksumSha256: body.checksumSha256,
      byteSize: body.byteSize,
      submittedFromChannel: 'WEB',
    });
  }

  /** Owner-only, including when the caller holds the legacy manage grant. */
  @Post(':signatureId/archive')
  @RequireAnyPermission(...SIGNATURE_OWNER_PERMISSIONS)
  archiveSignature(@ReqCtx() ctx: RequestContext, @Param('signatureId') signatureId: string) {
    return this.archive.execute(ctx, signatureId);
  }

  /** Records the web-canvas background-removed derived PNG. Original is kept. Submitter only. */
  @Post(':signatureId/derived')
  @RequireAnyPermission(...SIGNATURE_OWNER_PERMISSIONS)
  setDerivedAsset(@ReqCtx() ctx: RequestContext, @Param('signatureId') signatureId: string, @Body() body: SetSignatureDerivedAssetDto) {
    return this.setDerived.execute(ctx, signatureId, body);
  }
}
