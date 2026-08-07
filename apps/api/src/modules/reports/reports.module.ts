import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AccountingDocumentsModule } from '../accounting-documents/accounting-documents.module';
import { BankingModule } from '../banking/banking.module';
import { CrmModule } from '../crm/crm.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { InventoryModule } from '../inventory/inventory.module';
import { LedgerModule } from '../ledger/ledger.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { TaxModule } from '../tax/tax.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AiDraftModule } from '../ai-draft/ai-draft.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { PrismaReportRepository } from './infrastructure/prisma-report.repository';
import { ReportSourceAdapters } from './application/report-source-adapters';
import { ReportEntitlementService } from './application/report-entitlement.service';
import {
  ArchiveReportViewUseCase,
  CreateReportExportUseCase,
  CreateReportViewUseCase,
  DownloadReportExportUseCase,
  GetReportRunUseCase,
  ListReportExportsUseCase,
  ListReportCatalogUseCase,
  ListReportRunsUseCase,
  ListReportViewsUseCase,
  ReportDrilldownUseCase,
  RunReportQueryUseCase,
  UpdateReportViewUseCase,
} from './application/report.use-cases';
import { ReportController } from './presentation/http/report.controller';

@Module({
  imports: [
    AuditModule,
    AccountingDocumentsModule,
    BankingModule,
    CrmModule,
    DashboardNotificationsModule,
    DataModelCoreModule,
    ExpensesModule,
    InventoryModule,
    LedgerModule,
    ProcurementModule,
    TaxModule,
    WorkflowModule,
    AiDraftModule,
  ],
  controllers: [ReportController],
  providers: [
    PrismaReportRepository,
    ReportSourceAdapters,
    ReportEntitlementService,
    ListReportCatalogUseCase,
    RunReportQueryUseCase,
    GetReportRunUseCase,
    ListReportRunsUseCase,
    ListReportViewsUseCase,
    CreateReportViewUseCase,
    UpdateReportViewUseCase,
    ArchiveReportViewUseCase,
    ListReportExportsUseCase,
    CreateReportExportUseCase,
    DownloadReportExportUseCase,
    ReportDrilldownUseCase,
  ],
  exports: [RunReportQueryUseCase, ListReportCatalogUseCase],
})
export class ReportsModule {}
