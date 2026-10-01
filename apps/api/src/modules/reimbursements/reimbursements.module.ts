import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { PrismaReimbursementRepository } from './infrastructure/prisma-reimbursement.repository';
import { ReimbursementEvidenceService } from './application/services/reimbursement-evidence.service';
import { MaterializeClaimExpensesService } from './application/services/materialize-claim-expenses.service';
import { ReimbursementProjectionOrchestratorService } from './application/services/reimbursement-projection-orchestrator.service';
import { ReimbursementProjectionReconcilerService } from './application/services/reimbursement-projection-reconciler.service';
import { GetReimbursementPolicyUseCase, ListReimbursementApproverOptionsUseCase, UpdateReimbursementPolicyUseCase } from './application/use-cases/reimbursement-policy.use-case';
import {
  CreateReimbursementDraftUseCase,
  ListReimbursementSourcesUseCase,
  UpdateReimbursementDraftUseCase,
  ReopenRejectedReimbursementUseCase,
  GetReimbursementDetailUseCase,
  ReimbursementInternalNotesUseCase,
  ListReimbursementsUseCase,
  SubmitReimbursementUseCase,
  CancelReimbursementUseCase,
} from './application/use-cases/reimbursement-request.use-case';
import { ListApprovalQueueUseCase, ApproveReimbursementUseCase, RejectReimbursementUseCase } from './application/use-cases/reimbursement-approval.use-case';
import {
  ListFinanceQueueUseCase,
  FinanceReviewReimbursementUseCase,
  RecordReimbursementPaymentUseCase,
  VoidReimbursementPaymentUseCase,
  ListUnpostedReimbursementPaymentsUseCase,
  ExportReimbursementEvidenceUseCase,
} from './application/use-cases/reimbursement-finance.use-case';
import { GetReimbursementAiSummaryUseCase, GetReimbursementApprovalBacklogUseCase } from './application/use-cases/reimbursement-summary.use-case';
import { PreviewReimbursementClaimFormUseCase } from './application/use-cases/reimbursement-claim-form.use-case';
import {
  CompleteClaimSignatureUploadUseCase,
  InitClaimSignatureUploadUseCase,
  LinkSignedClaimFormCopyUseCase,
  SignClaimFormUseCase,
} from './application/use-cases/reimbursement-claim-signature.use-case';
import {
  AttachPaymentSlipUseCase,
  CompletePaymentSlipUploadUseCase,
  CreatePaymentSlipDownloadUrlUseCase,
  InitPaymentSlipUploadUseCase,
} from './application/use-cases/reimbursement-payment-slip.use-case';
import { ReimbursementController } from './presentation/http/reimbursement.controller';
import { ReimbursementPolicyController } from './presentation/http/reimbursement-policy.controller';
import { ReimbursementWriteQuiesceGuard } from './presentation/http/reimbursement-write-quiesce.guard';
import { LineReimbursementDraftUseCase } from './application/use-cases/line-reimbursement-draft.use-case';

@Module({
  imports: [AuditModule, DataModelCoreModule, ExpensesModule],
  controllers: [ReimbursementController, ReimbursementPolicyController],
  providers: [
    PrismaReimbursementRepository,
    ReimbursementEvidenceService,
    MaterializeClaimExpensesService,
    ReimbursementProjectionOrchestratorService,
    ReimbursementProjectionReconcilerService,
    ReimbursementWriteQuiesceGuard,
    LineReimbursementDraftUseCase,
    GetReimbursementPolicyUseCase,
    ListReimbursementApproverOptionsUseCase,
    UpdateReimbursementPolicyUseCase,
    CreateReimbursementDraftUseCase,
  ListReimbursementSourcesUseCase,
    UpdateReimbursementDraftUseCase,
    ReopenRejectedReimbursementUseCase,
    GetReimbursementDetailUseCase,
    ReimbursementInternalNotesUseCase,
    ListReimbursementsUseCase,
    SubmitReimbursementUseCase,
    CancelReimbursementUseCase,
    ListApprovalQueueUseCase,
    ApproveReimbursementUseCase,
    RejectReimbursementUseCase,
    ListFinanceQueueUseCase,
    FinanceReviewReimbursementUseCase,
    RecordReimbursementPaymentUseCase,
    VoidReimbursementPaymentUseCase,
    ListUnpostedReimbursementPaymentsUseCase,
    ExportReimbursementEvidenceUseCase,
    GetReimbursementAiSummaryUseCase,
    GetReimbursementApprovalBacklogUseCase,
    PreviewReimbursementClaimFormUseCase,
    InitClaimSignatureUploadUseCase,
    CompleteClaimSignatureUploadUseCase,
    SignClaimFormUseCase,
    LinkSignedClaimFormCopyUseCase,
    InitPaymentSlipUploadUseCase,
    CompletePaymentSlipUploadUseCase,
    AttachPaymentSlipUseCase,
    CreatePaymentSlipDownloadUrlUseCase,
  ],
  exports: [PrismaReimbursementRepository, ReimbursementProjectionReconcilerService, ListReimbursementApproverOptionsUseCase, GetReimbursementAiSummaryUseCase, GetReimbursementApprovalBacklogUseCase, GetReimbursementDetailUseCase, ListApprovalQueueUseCase, LineReimbursementDraftUseCase],
})
export class ReimbursementsModule {}
