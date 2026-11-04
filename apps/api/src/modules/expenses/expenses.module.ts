import { ExpensePaymentSlipUploadUseCase } from './application/use-cases/expense-upload.use-case';
import { Module } from '@nestjs/common';
import { LinkLinePaymentEvidenceUseCase } from './application/use-cases/link-line-payment-evidence.use-case';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import {
  CreateExpenseDraftUseCase,
  GetExpenseUseCase,
  GetExpenseHistoryUseCase,
  ListExpensesUseCase,
  UpdateExpenseDraftUseCase,
  DecideExpenseInputVatUseCase,
  ConfirmExpenseUseCase,
  RejectExpenseUseCase,
  VoidExpenseUseCase,
  MarkExpenseReadyUseCase,
  RecordExpensePaymentUseCase,
  ReopenExpenseUseCase,
  CancelExpensePaymentUseCase,
} from './application/use-cases/expense-draft.use-case';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
  GetExpenseSourcePostingInputUseCase,
  DuplicateCheckUseCase,
  ResolveDuplicateUseCase,
  ConfirmBuyerMatchUseCase,
  ListExpenseCategoriesUseCase,
} from './application/use-cases/expense-upload.use-case';
import {
  CaptureLineExpenseNoteUseCase,
  SetExpenseCategoryAccountantAccountUseCase,
  ClearExpenseCategoryAccountantAccountUseCase,
  CreateExpenseCategoryUseCase,
  UpdateExpenseCategoryUseCase,
  ListAllExpenseCategoriesUseCase,
} from './application/use-cases/expense-document.use-case';
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
  ListMySubstituteReceiptSignaturesUseCase,
  ListSubstituteReceiptHistoryUseCase,
  ListSubstituteReceiptPayersUseCase,
  PrepareSubstituteReceiptUseCase,
  PreviewSubstituteReceiptUseCase,
  SupersedeSubstituteReceiptUseCase,
} from './application/use-cases/substitute-receipt.use-case';
import {
  GetSubstituteReceiptPolicyUseCase,
  UpdateSubstituteReceiptPolicyUseCase,
} from './application/use-cases/substitute-receipt-policy.use-case';
import {
  InitSignatureUploadUseCase,
  CreateSignatureAssetUseCase,
  ArchiveSignatureAssetUseCase,
  SetSignatureDerivedAssetUseCase,
  FillSignatureUseCase,
  ListSignatureAssetsUseCase,
  GetSignatureImageUseCase,
} from './application/use-cases/signature-asset.use-case';
import {
  GetSharedEvidenceViewUseCase,
  CreateAccountantPackageUseCase,
} from './application/use-cases/expense-evidence.use-case';
import { CompanySubstituteReceiptController, ExpenseController, ExpenseCategoryController, ExpenseSignatureController, ExpenseSettingsController } from './presentation/http/expense.controller';
import { ExpenseCaptureController } from './presentation/http/expense-capture.controller';
import { DisbursementVoucherController } from './presentation/http/disbursement-voucher.controller';
import { ReadDisbursementVoucherSourcesUseCase } from './application/use-cases/disbursement-voucher-read.use-case';
import { DisbursementVoucherFileService } from './application/services/disbursement-voucher-file.service';
import { DisbursementVoucherNoticeService } from './application/services/disbursement-voucher-notice.service';
import { DisbursementVoucherUseCase } from './application/use-cases/disbursement-voucher.use-case';
import { PrismaDisbursementVoucherRepository } from './infrastructure/prisma-disbursement-voucher.repository';
import { ExpenseCaptureReadInternalController } from './presentation/http/expense-capture-read-internal.controller';
import { ExpenseCaptureReadClient } from './infrastructure/expense-capture-read.client';
import { ExpenseCaptureAutoSplitService } from './application/services/expense-capture-auto-split.service';
import { ExpenseCaptureReadRunnerService } from './application/services/expense-capture-read-runner.service';
import { PrismaExpenseCaptureRepository } from './infrastructure/prisma-expense-capture.repository';
import {
  AddExpenseCaptureFileUseCase,
  CloseExpenseCaptureGroupUseCase,
  CompleteExpenseCaptureFileUseCase,
  ConvertExpenseToCaptureGroupUseCase,
  CreateExpenseCaptureGroupUseCase,
  DetachExpenseCaptureFileUseCase,
  ExpenseCaptureAccessService,
  GetExpenseCaptureCapabilityUseCase,
  GetExpenseCaptureGroupUseCase,
  ListExpenseCaptureGroupsUseCase,
} from './application/use-cases/expense-capture-group.use-case';
import {
  AcceptExpenseCaptureAllocationUseCase,
  PatchExpenseCaptureFactsUseCase,
  ReviewExpenseCaptureGroupUseCase,
} from './application/use-cases/expense-capture-review.use-case';
import {
  AutoHandoffSingleDocumentCaptureUseCase,
  HandoffExpenseCaptureGroupUseCase,
} from './application/use-cases/expense-capture-handoff.use-case';
import { GetExpenseReadStatusUseCase } from './application/use-cases/expense-capture-read-status.use-case';
import { ReceiptOcrApplyService } from './application/services/receipt-ocr-apply.service';
import { GetExpenseCapturePolicyUseCase } from './application/use-cases/expense-capture-policy.use-case';
import { ExpenseCaptureLineUseCase } from './application/use-cases/expense-capture-line.use-case';
import { RequestReceiptExtractionUseCase } from './application/use-cases/expense-extraction.use-case';
import { ReceiptOcrClient } from './infrastructure/receipt-ocr.client';
import { TaxModule } from '../tax/tax.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { ExpenseTransactionTaxService } from './application/services/expense-transaction-tax.service';
import { RemoveExpenseReceiptUseCase } from './application/use-cases/remove-expense-receipt.use-case';
import { DeleteExpenseUseCase } from './application/use-cases/delete-expense.use-case';
import { CorrectLineCapturedExpenseUseCase } from './application/use-cases/line-correction.use-case';
import { LineSubstituteReceiptContinuationUseCase } from './application/use-cases/line-substitute-receipt-continuation.use-case';
import { LineExpenseDraftConversationUseCase } from './application/use-cases/line-expense-draft-conversation.use-case';
import { LineDraftUpdateUseCase } from './application/use-cases/line-draft-update.use-case';
import { LineDraftPreviewStore } from './application/services/line-draft-preview.store';
import { AccountingDocumentsModule } from '../accounting-documents/accounting-documents.module';
import { ProcurementModule } from '../procurement/procurement.module';

@Module({
  // FeatureLaunchModule supplies the guard that fences the two roots of the expenses journey
  // (manual draft, receipt upload) on `expenses/DEFAULT`.
  // AccountingDocumentsModule supplies `EnsureVendorCounterpartyFromExpenseUseCase` (spec D4): an
  // expense save grows the vendor registry. One-way — accounting-documents does not import this
  // module, so there is no cycle.
  // ProcurementModule: reuses ListWhtIncomeCategoriesUseCase for the Expenses income-category
  // endpoint (WHT certificate system issuance plan §1.2) — one-way, ProcurementModule does not
  // import ExpensesModule, so there is no cycle.
  imports: [AuditModule, DashboardNotificationsModule, DataModelCoreModule, TaxModule, FeatureLaunchModule, AccountingDocumentsModule, ProcurementModule],
  // ExpenseCaptureController FIRST: `ExpenseController` owns `@Get(':expenseId')` on the same
  // path, and Express matches in registration order — a later `capture-groups` literal would be
  // read as an expense id.
  controllers: [ExpenseCaptureController, ExpenseCaptureReadInternalController, ExpenseController, ExpenseCategoryController, ExpenseSignatureController, ExpenseSettingsController, CompanySubstituteReceiptController, DisbursementVoucherController],
  providers: [
    ExpensePaymentSlipUploadUseCase,
    LinkLinePaymentEvidenceUseCase,
    ReadDisbursementVoucherSourcesUseCase,
    DisbursementVoucherUseCase,
    DisbursementVoucherNoticeService,
    DisbursementVoucherFileService,
    PrismaDisbursementVoucherRepository,
    PrismaExpenseRepository,
    PrismaExpenseCaptureRepository,
    ExpenseCaptureAccessService,
    GetExpenseCaptureCapabilityUseCase,
    CreateExpenseCaptureGroupUseCase,
    ListExpenseCaptureGroupsUseCase,
    GetExpenseCaptureGroupUseCase,
    AddExpenseCaptureFileUseCase,
    CompleteExpenseCaptureFileUseCase,
    DetachExpenseCaptureFileUseCase,
    CloseExpenseCaptureGroupUseCase,
    ExpenseCaptureLineUseCase,
    ConvertExpenseToCaptureGroupUseCase,
    PatchExpenseCaptureFactsUseCase,
    ReviewExpenseCaptureGroupUseCase,
    AcceptExpenseCaptureAllocationUseCase,
    HandoffExpenseCaptureGroupUseCase,
    AutoHandoffSingleDocumentCaptureUseCase,
    GetExpenseReadStatusUseCase,
    ExpenseCaptureReadClient,
    ExpenseCaptureAutoSplitService,
    ExpenseCaptureReadRunnerService,
    ReceiptOcrClient,
    ReceiptOcrApplyService,
    ExpenseTransactionTaxService,
    GetExpenseCapturePolicyUseCase,
    RequestReceiptExtractionUseCase,
    CreateExpenseDraftUseCase,
    GetExpenseUseCase,
    GetExpenseHistoryUseCase,
    ListExpensesUseCase,
    UpdateExpenseDraftUseCase,
    DecideExpenseInputVatUseCase,
    ConfirmExpenseUseCase,
    RejectExpenseUseCase,
    VoidExpenseUseCase,
    MarkExpenseReadyUseCase,
    RecordExpensePaymentUseCase,
  ReopenExpenseUseCase,
  CancelExpensePaymentUseCase,
    DeleteExpenseUseCase,
    RemoveExpenseReceiptUseCase,
    InitReceiptUploadUseCase,
    CompleteReceiptUploadUseCase,
    GetExpenseSourcePostingInputUseCase,
    DuplicateCheckUseCase,
    ResolveDuplicateUseCase,
    ConfirmBuyerMatchUseCase,
    ListExpenseCategoriesUseCase,
    CaptureLineExpenseNoteUseCase,
    CorrectLineCapturedExpenseUseCase,
    LineDraftPreviewStore,
    LineDraftUpdateUseCase,
    LineSubstituteReceiptContinuationUseCase,
    LineExpenseDraftConversationUseCase,
    ListCompanySubstituteReceiptsUseCase,
    ListSubstituteReceiptCandidatesUseCase,
  SaveOwnSubstituteReceiptReviewUseCase,
  SubstituteReceiptEvidenceUploadUseCase,
    ListMySubstituteReceiptSignaturesUseCase,
    PrepareSubstituteReceiptUseCase,
    PreviewSubstituteReceiptUseCase,
    CertifySubstituteReceiptUseCase,
    PaperSubstituteReceiptUseCase,
    ApproveSubstituteReceiptUseCase,
    ListSubstituteReceiptHistoryUseCase,
    ListSubstituteReceiptPayersUseCase,
    InitSubstituteSignatureUploadUseCase,
    CompleteSubstituteSignatureUploadUseCase,
    DownloadPaymentVoucherPdfUseCase,
    DownloadSubstituteReceiptPdfUseCase,
    DownloadSubstituteReceiptFormPdfUseCase,
    SupersedeSubstituteReceiptUseCase,
    GetSubstituteReceiptPolicyUseCase,
    UpdateSubstituteReceiptPolicyUseCase,
    SetExpenseCategoryAccountantAccountUseCase,
    ClearExpenseCategoryAccountantAccountUseCase,
    CreateExpenseCategoryUseCase,
    UpdateExpenseCategoryUseCase,
    ListAllExpenseCategoriesUseCase,
    InitSignatureUploadUseCase,
    CreateSignatureAssetUseCase,
    ArchiveSignatureAssetUseCase,
    SetSignatureDerivedAssetUseCase,
    FillSignatureUseCase,
    ListSignatureAssetsUseCase,
    GetSignatureImageUseCase,
    GetSharedEvidenceViewUseCase,
    CreateAccountantPackageUseCase,
  ],
  exports: [
    DisbursementVoucherUseCase,
    RecordExpensePaymentUseCase,
    LinkLinePaymentEvidenceUseCase,
    PrismaExpenseRepository,
    // W02-LINE needs the attempt log and the group intake from the LINE webhook lane.
    PrismaExpenseCaptureRepository,
    CreateExpenseCaptureGroupUseCase,
    AddExpenseCaptureFileUseCase,
    CompleteExpenseCaptureFileUseCase,
    ExpenseCaptureLineUseCase,
    ExpenseCaptureReadRunnerService,
    // W05 §3.2: the LINE lane calls this when a single-document read finishes. No HTTP route.
    AutoHandoffSingleDocumentCaptureUseCase,
    GetExpenseUseCase,
    ReceiptOcrApplyService,
    CreateExpenseDraftUseCase,
    ListExpensesUseCase,
    UpdateExpenseDraftUseCase,
    GetExpenseSourcePostingInputUseCase,
    InitReceiptUploadUseCase,
    CompleteReceiptUploadUseCase,
    CaptureLineExpenseNoteUseCase,
    CorrectLineCapturedExpenseUseCase,
    LineDraftPreviewStore,
    LineDraftUpdateUseCase,
    LineSubstituteReceiptContinuationUseCase,
    PreviewSubstituteReceiptUseCase,
    CertifySubstituteReceiptUseCase,
    ApproveSubstituteReceiptUseCase,
    // Advisor S1: the LINE read tool for the caller's own substitute-receipt signature queue.
    ListMySubstituteReceiptSignaturesUseCase,
    LineExpenseDraftConversationUseCase,
    ConfirmExpenseUseCase,
    MarkExpenseReadyUseCase,
    DeleteExpenseUseCase,
    ResolveDuplicateUseCase,
    VoidExpenseUseCase,
    InitSignatureUploadUseCase,
    CreateSignatureAssetUseCase,
  ],
})
export class ExpensesModule {}
