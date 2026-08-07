import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { AccountingDocumentsModule } from '../accounting-documents/accounting-documents.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ReimbursementsModule } from '../reimbursements/reimbursements.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { PrismaLedgerRepository } from './infrastructure/prisma-ledger.repository';
import { ListAccountsUseCase, GetAccountUseCase, CreateAccountUseCase, UpdateAccountUseCase } from './application/use-cases/account.use-case';
import {
  ListJournalsUseCase, GetJournalUseCase, CreateManualJournalUseCase,
  PostJournalUseCase, ReverseJournalUseCase, GenerateJournalFromSourceUseCase,
} from './application/use-cases/journal.use-case';
import {
  ListPeriodsUseCase, EnsurePeriodUseCase, RunPeriodCloseChecksUseCase,
  ClosePeriodUseCase, UnclosePeriodUseCase,
} from './application/use-cases/period.use-case';
import {
  GetGeneralLedgerUseCase, GetTrialBalanceUseCase, GetPnlReportUseCase,
  GetBalanceSheetUseCase, ExportReportUseCase,
} from './application/use-cases/report.use-case';
import { LedgerController } from './presentation/http/ledger.controller';
import { DrainExpenseAutoPostUseCase } from './application/use-cases/expense-auto-post.use-case';
import { ExpenseAutoPostInternalController } from './presentation/http/expense-auto-post-internal.controller';
import {
  PreviewExpenseBackfillUseCase,
  RunExpenseBackfillUseCase,
} from './application/use-cases/expense-backfill.use-case';
import { ChartTemplateService } from './application/services/chart-template.service.js';
import { ChartReadinessService } from './application/services/chart-readiness.service.js';

@Module({
  imports: [AuditModule, DataModelCoreModule, AccountingDocumentsModule, ExpensesModule, ProcurementModule, ReimbursementsModule, FeatureLaunchModule],
  controllers: [LedgerController, ExpenseAutoPostInternalController],
  providers: [
    PrismaLedgerRepository,
    ListAccountsUseCase,
    GetAccountUseCase,
    CreateAccountUseCase,
    UpdateAccountUseCase,
    ChartReadinessService,
    ChartTemplateService,
    ListJournalsUseCase,
    GetJournalUseCase,
    CreateManualJournalUseCase,
    PostJournalUseCase,
    ReverseJournalUseCase,
    GenerateJournalFromSourceUseCase,
    DrainExpenseAutoPostUseCase,
    PreviewExpenseBackfillUseCase,
    RunExpenseBackfillUseCase,
    ListPeriodsUseCase,
    EnsurePeriodUseCase,
    RunPeriodCloseChecksUseCase,
    ClosePeriodUseCase,
    UnclosePeriodUseCase,
    GetGeneralLedgerUseCase,
    GetTrialBalanceUseCase,
    GetPnlReportUseCase,
    GetBalanceSheetUseCase,
    ExportReportUseCase,
  ],
  exports: [
    PrismaLedgerRepository,
    ChartReadinessService,
    ListPeriodsUseCase,
    GenerateJournalFromSourceUseCase,
    GetGeneralLedgerUseCase,
    GetTrialBalanceUseCase,
    GetPnlReportUseCase,
    GetBalanceSheetUseCase,
  ],
})
export class LedgerModule {}
