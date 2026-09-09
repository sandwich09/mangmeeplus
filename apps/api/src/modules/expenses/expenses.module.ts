import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { PrismaExpenseRepository } from './infrastructure/prisma-expense.repository';
import {
  CreateExpenseDraftUseCase,
  GetExpenseUseCase,
  ListExpensesUseCase,
  UpdateExpenseDraftUseCase,
  ConfirmExpenseUseCase,
  RejectExpenseUseCase,
  VoidExpenseUseCase,
  MarkExpenseReadyUseCase,
  RecordExpensePaymentUseCase,
} from './application/use-cases/expense-draft.use-case';
import {
  InitReceiptUploadUseCase,
  CompleteReceiptUploadUseCase,
  GetExpenseSourcePostingInputUseCase,
  DuplicateCheckUseCase,
  ResolveDuplicateUseCase,
  ListExpenseCategoriesUseCase,
} from './application/use-cases/expense-upload.use-case';
import {
  CaptureLineExpenseNoteUseCase,
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
import { ReceiptOcrApplyService } from './application/services/receipt-ocr-apply.service';
import { GetExpenseCapturePolicyUseCase } from './application/use-cases/expense-capture-policy.use-case';
import { RequestReceiptExtractionUseCase } from './application/use-cases/expense-extraction.use-case';
import { ReceiptOcrClient } from './infrastructure/receipt-ocr.client';
import { TaxModule } from '../tax/tax.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { ExpenseTransactionTaxService } from './application/services/expense-transaction-tax.service';
import { DeleteExpenseUseCase } from './application/use-cases/delete-expense.use-case';
import { CorrectLineCapturedExpenseUseCase } from './application/use-cases/line-correction.use-case';
import { LineSubstituteReceiptContinuationUseCase } from './application/use-cases/line-substitute-receipt-continuation.use-case';
import { LineExpenseDraftConversationUseCase } from './application/use-cases/line-expense-draft-conversation.use-case';
import { LineDraftUpdateUseCase } from './application/use-cases/line-draft-update.use-case';
import { LineDraftPreviewStore } from './application/services/line-draft-preview.store';

@Module({
  // FeatureLaunchModule supplies the guard that fences the two roots of the expenses journey
  // (manual draft, receipt upload) on `expenses/DEFAULT`.
  imports: [AuditModule, DashboardNotificationsModule, DataModelCoreModule, TaxModule, FeatureLaunchModule],
  controllers: [ExpenseController, ExpenseCategoryController, ExpenseSignatureController, ExpenseSettingsController, CompanySubstituteReceiptController],
  providers: [
    PrismaExpenseRepository,
    ReceiptOcrClient,
    ReceiptOcrApplyService,
    ExpenseTransactionTaxService,
    GetExpenseCapturePolicyUseCase,
    RequestReceiptExtractionUseCase,
    CreateExpenseDraftUseCase,
    GetExpenseUseCase,
    ListExpensesUseCase,
    UpdateExpenseDraftUseCase,
    ConfirmExpenseUseCase,
    RejectExpenseUseCase,
    VoidExpenseUseCase,
    MarkExpenseReadyUseCase,
    RecordExpensePaymentUseCase,
    DeleteExpenseUseCase,
    InitReceiptUploadUseCase,
    CompleteReceiptUploadUseCase,
    GetExpenseSourcePostingInputUseCase,
    DuplicateCheckUseCase,
    ResolveDuplicateUseCase,
    ListExpenseCategoriesUseCase,
    CaptureLineExpenseNoteUseCase,
    CorrectLineCapturedExpenseUseCase,
    LineDraftPreviewStore,
    LineDraftUpdateUseCase,
    LineSubstituteReceiptContinuationUseCase,
    LineExpenseDraftConversationUseCase,
    ListCompanySubstituteReceiptsUseCase,
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
    PrismaExpenseRepository,
    GetExpenseUseCase,
    ReceiptOcrApplyService,
    CreateExpenseDraftUseCase,
    ListExpensesUseCase,
    GetExpenseSourcePostingInputUseCase,
    InitReceiptUploadUseCase,
    CompleteReceiptUploadUseCase,
    CaptureLineExpenseNoteUseCase,
    CorrectLineCapturedExpenseUseCase,
    LineDraftPreviewStore,
    LineDraftUpdateUseCase,
    LineSubstituteReceiptContinuationUseCase,
    LineExpenseDraftConversationUseCase,
    ConfirmExpenseUseCase,
    VoidExpenseUseCase,
    InitSignatureUploadUseCase,
    CreateSignatureAssetUseCase,
  ],
})
export class ExpensesModule {}
