import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { InventoryModule } from '../inventory/inventory.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { LedgerModule } from '../ledger/ledger.module';
import { TaxModule } from '../tax/tax.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AccountingDocumentsModule } from '../accounting-documents/accounting-documents.module';
import { ProcurementModule } from '../procurement/procurement.module';
import { ReportsModule } from '../reports/reports.module';
import { ReimbursementsModule } from '../reimbursements/reimbursements.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { CrmModule } from '../crm/crm.module';
import { CrmInboxModule } from '../crm-inbox/crm-inbox.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';

// Infrastructure
import { LineReplyAdapter } from './infrastructure/line-reply.adapter';
import { AiGatewayClient } from './infrastructure/ai-gateway.client';
import { ActorDelegationService } from './infrastructure/actor-delegation.service';

// Use Cases – ERP tools (dashboard/notifications)
import {
  CompanyGetCurrentContextTool,
  CompanyListBranchesTool,
  DashboardGetHealthSummaryTool,
  NotificationsListOpenAlertsTool,
  NotificationsGetDailySummaryTool,
} from './application/use-cases/erp-dashboard-tools.use-case';

// Use Cases – ERP tools (inventory)
import {
  InventorySearchProductsTool,
  InventoryListLowStockTool,
  InventoryGetStockBalanceTool,
  InventorySummarizeMovementsTool,
  LedgerFinancialSummaryTool,
  ExpenseListRecentTool,
  SalesGetSalesSummaryTool,
} from './application/use-cases/erp-tools.use-case';

// Use Cases – ERP tools (tax)
import {
  TaxGetUpcomingObligationsTool,
  TaxGetVatSummaryTool,
  TaxGetWhtSummaryTool,
  TaxGetCitCalendarTool,
  TaxGetReconciliationSummaryTool,
  TaxGetTaxCodeProfileTool,
  TaxGetTransactionTaxSummaryTool,
  TaxListMissingDocumentsTool,
} from './application/use-cases/erp-tax-tools.use-case';

// Use Cases – ERP tools (workflow automation)
import {
  WorkflowExplainRunTool,
  WorkflowListAssignedTasksTool,
  WorkflowListRecentFailuresTool,
  WorkflowSummarizeRuleHealthTool,
} from './application/use-cases/erp-workflow-tools.use-case';

// Use Cases – ERP tools (accounting documents / AP / employees / expense breakdown)
import {
  AccountingGetSummaryTool,
  AccountingListRecentDocumentsTool,
  ProcurementApOutstandingTool,
  CompanyEmployeeSummaryTool,
  CompanyEmployeeDetailTool,
  ExpenseGetBreakdownTool,
} from './application/use-cases/erp-business-tools.use-case';
import { ReportsMonthlySummaryTool } from './application/use-cases/erp-report-tools.use-case';
import { ReimbursementListPendingApprovalsTool } from './application/use-cases/erp-reimbursement-tools.use-case';
import { CrmGetCustomerSummaryTool, CrmSearchCustomersTool, CrmGetCustomer360Tool } from './application/use-cases/erp-crm-tools.use-case';
import {
  InventoryGetProductDetailTool,
  AccountingGetDocumentDetailTool,
  AccountingGetReceivableSummaryTool,
  ExpenseGetDetailTool,
  ReimbursementGetSummaryTool,
  ReimbursementGetDetailTool,
} from './application/use-cases/erp-core-detail-tools.use-case';
import {
  CrmGetReportSummaryTool,
  CrmGetPipelineSummaryTool,
  CrmListOpenFollowupsTool,
  CrmGetBookingSummaryTool,
  CrmListBookingsTool,
  CrmGetInboxSummaryTool,
  CrmListConversationsTool,
  CrmGetConversationSummaryTool,
} from './application/use-cases/erp-crm-operational-tools.use-case';
import {
  ProcurementGetSummaryTool,
  ProcurementSearchSuppliersTool,
  ProcurementGetPurchaseOrderDetailTool,
  LedgerGetPeriodStatusTool,
  LedgerGetReportSummaryTool,
} from './application/use-cases/erp-procurement-ledger-tools.use-case';

// Use Cases – webhook processing
import { ProcessLineWebhookUseCase } from './application/use-cases/process-line-webhook.use-case';
import { LineMessageBufferService } from './application/line-message-buffer.service';

// Item 10F: turn ledger (Redis Streams) + reclaim drain
import { LineAiLedgerService } from './application/line-ai-ledger.service';
import { DrainLineLedgerUseCase } from './application/use-cases/drain-line-ledger.use-case';
import { RecoverOrphanLineEventsUseCase } from './application/use-cases/recover-orphan-line-events.use-case';

// Controllers
import { InternalToolsController } from './presentation/http/internal-tools.controller';
import { LineAiLedgerInternalController } from './presentation/http/line-ai-ledger-internal.controller';
import { LineWebhookController } from '../auth/presentation/line-webhook.controller';

const erpTools = [
  CompanyGetCurrentContextTool,
  CompanyListBranchesTool,
  CompanyEmployeeSummaryTool,
  CompanyEmployeeDetailTool,
  AccountingGetSummaryTool,
  AccountingListRecentDocumentsTool,
  ProcurementApOutstandingTool,
  ExpenseGetBreakdownTool,
  DashboardGetHealthSummaryTool,
  NotificationsListOpenAlertsTool,
  NotificationsGetDailySummaryTool,
  InventorySearchProductsTool,
  InventoryGetProductDetailTool,
  InventoryListLowStockTool,
  InventoryGetStockBalanceTool,
  InventorySummarizeMovementsTool,
  LedgerFinancialSummaryTool,
  ExpenseListRecentTool,
  ExpenseGetDetailTool,
  SalesGetSalesSummaryTool,
  TaxGetUpcomingObligationsTool,
  TaxGetVatSummaryTool,
  TaxGetWhtSummaryTool,
  TaxGetCitCalendarTool,
  TaxListMissingDocumentsTool,
  TaxGetTaxCodeProfileTool,
  TaxGetTransactionTaxSummaryTool,
  TaxGetReconciliationSummaryTool,
  WorkflowExplainRunTool,
  WorkflowListAssignedTasksTool,
  WorkflowListRecentFailuresTool,
  WorkflowSummarizeRuleHealthTool,
  ReportsMonthlySummaryTool,
  ReimbursementListPendingApprovalsTool,
  ReimbursementGetSummaryTool,
  ReimbursementGetDetailTool,
  AccountingGetDocumentDetailTool,
  AccountingGetReceivableSummaryTool,
  CrmGetCustomerSummaryTool,
  CrmSearchCustomersTool,
  CrmGetCustomer360Tool,
  CrmGetReportSummaryTool,
  CrmGetPipelineSummaryTool,
  CrmListOpenFollowupsTool,
  CrmGetBookingSummaryTool,
  CrmListBookingsTool,
  CrmGetInboxSummaryTool,
  CrmListConversationsTool,
  CrmGetConversationSummaryTool,
  ProcurementGetSummaryTool,
  ProcurementSearchSuppliersTool,
  ProcurementGetPurchaseOrderDetailTool,
  LedgerGetPeriodStatusTool,
  LedgerGetReportSummaryTool,
];

@Module({
  imports: [
    AuditModule,
    AuthModule,
    AccessControlModule,
    InventoryModule,
    DashboardNotificationsModule,
    ExpensesModule,
    LedgerModule,
    TaxModule,
    WorkflowModule,
    AccountingDocumentsModule,
    ProcurementModule,
    ReportsModule,
    ReimbursementsModule,
    DataModelCoreModule,
    CrmModule,
    CrmInboxModule,
    // Supplies the shadow probe for the employee LINE webhook and the AI ledger drain (plan §3 F1).
    FeatureLaunchModule,
  ],
  controllers: [InternalToolsController, LineAiLedgerInternalController, LineWebhookController],
  providers: [
    LineReplyAdapter,
    ActorDelegationService,
    AiGatewayClient,
    ProcessLineWebhookUseCase,
    LineMessageBufferService,
    LineAiLedgerService,
    DrainLineLedgerUseCase,
    RecoverOrphanLineEventsUseCase,
    ...erpTools,
  ],
  exports: [ProcessLineWebhookUseCase, LineMessageBufferService],
})
export class LineAiModule {}
