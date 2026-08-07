import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { PrismaBankingRepository } from './infrastructure/prisma-banking.repository';
import { PrismaMatchSourceQuery } from './infrastructure/prisma-match-source.query';
import { PdfStatementTextExtractor } from './infrastructure/pdf-statement-text.extractor';
import { StatementAiExtractClient } from './infrastructure/statement-ai-extract.client';
import {
  ListBankAccountsUseCase,
  GetBankAccountUseCase,
  CreateBankAccountUseCase,
  UpdateBankAccountUseCase,
  DeactivateBankAccountUseCase,
} from './application/use-cases/bank-account.use-case';
import {
  ListStatementLinesUseCase,
  ListStatementImportsUseCase,
  ExtractStatementFileUseCase,
  PreviewStatementImportUseCase,
  CommitStatementImportUseCase,
  CreateManualStatementLineUseCase,
  VoidStatementImportUseCase,
} from './application/use-cases/statement-import.use-case';
import {
  ListMatchCandidatesUseCase,
  ConfirmMatchUseCase,
  RejectMatchUseCase,
  VoidMatchUseCase,
  IgnoreStatementLineUseCase,
} from './application/use-cases/matching.use-case';
import {
  ListBankAdjustmentsUseCase,
  GetBankAdjustmentUseCase,
  CreateBankAdjustmentUseCase,
  SubmitBankAdjustmentUseCase,
  ApproveBankAdjustmentUseCase,
  VoidBankAdjustmentUseCase,
} from './application/use-cases/bank-adjustment.use-case';
import {
  ListReconciliationSessionsUseCase,
  GetReconciliationSessionUseCase,
  CreateReconciliationSessionUseCase,
  CompleteReconciliationSessionUseCase,
  ReopenReconciliationSessionUseCase,
  GetCashPositionUseCase,
} from './application/use-cases/reconciliation.use-case';
import { BankAccountController } from './presentation/http/bank-account.controller';
import { StatementController } from './presentation/http/statement.controller';
import { MatchingController } from './presentation/http/matching.controller';
import { AdjustmentController } from './presentation/http/adjustment.controller';
import { ReconciliationController } from './presentation/http/reconciliation.controller';

@Module({
  imports: [AuditModule, DataModelCoreModule],
  controllers: [
    BankAccountController,
    StatementController,
    MatchingController,
    AdjustmentController,
    ReconciliationController,
  ],
  providers: [
    PrismaBankingRepository,
    PrismaMatchSourceQuery,
    PdfStatementTextExtractor,
    StatementAiExtractClient,
    // Bank Account
    ListBankAccountsUseCase,
    GetBankAccountUseCase,
    CreateBankAccountUseCase,
    UpdateBankAccountUseCase,
    DeactivateBankAccountUseCase,
    // Statement Import
    ListStatementLinesUseCase,
    ListStatementImportsUseCase,
    ExtractStatementFileUseCase,
    PreviewStatementImportUseCase,
    CommitStatementImportUseCase,
    CreateManualStatementLineUseCase,
    VoidStatementImportUseCase,
    // Matching
    ListMatchCandidatesUseCase,
    ConfirmMatchUseCase,
    RejectMatchUseCase,
    VoidMatchUseCase,
    IgnoreStatementLineUseCase,
    // Adjustment
    ListBankAdjustmentsUseCase,
    GetBankAdjustmentUseCase,
    CreateBankAdjustmentUseCase,
    SubmitBankAdjustmentUseCase,
    ApproveBankAdjustmentUseCase,
    VoidBankAdjustmentUseCase,
    // Reconciliation
    ListReconciliationSessionsUseCase,
    GetReconciliationSessionUseCase,
    CreateReconciliationSessionUseCase,
    CompleteReconciliationSessionUseCase,
    ReopenReconciliationSessionUseCase,
    GetCashPositionUseCase,
  ],
  exports: [PrismaBankingRepository, GetCashPositionUseCase],
})
export class BankingModule {}
