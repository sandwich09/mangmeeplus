import { LineWorkflowTargetService } from './application/line-workflow-target.service';
import { LineSubstituteReceiptActionService } from './application/line-substitute-receipt-action.service';
import { LineQuotedMessageService } from './application/line-quoted-message.service';
import { CounterpartySearchTool, CounterpartyGetDetailTool, CounterpartyActionPreviewTool, LineCounterpartyService } from './application/line-counterparty.service';
import { EmployeeAccessModule } from '../employee-access/employee-access.module';
import { LineTeamActionService, CompanyActionPreviewTool } from './application/line-team-action.service';
import { CompanyGetRolesTool } from './application/use-cases/erp-team-tools.use-case';
import { LineVoucherActionService } from './application/line-voucher-action.service';
import { VoucherListRecentTool, VoucherGetDetailTool, WhtGetMonthSummaryTool, WhtCalculateWithholdingTool } from './application/use-cases/erp-advisor-document-tools.use-case';
import { LinePackagePurchaseService } from './application/line-package-purchase.service';
import { LineExpenseActionService, ExpenseActionPreviewTool } from './application/line-expense-action.service';
import { LineReimbursementDraftAdapterService } from './application/line-reimbursement-draft-adapter.service';
import { ReimbursementDraftGetOptionsTool, ReimbursementDraftPreviewCreateTool, ReimbursementDraftPreviewUpdateTool } from './infrastructure/reimbursement-draft-tools';
import { LineDocumentQaService } from './application/line-document-qa.service';
import { LineDocumentQaWorker } from './application/line-document-qa.worker';
import { LineDocumentQaInternalController } from './presentation/http/line-document-qa-internal.controller';
import { LineReimbursementDraftService } from './application/line-reimbursement-draft.service';
import { PublicLookupAdmissionTool } from './infrastructure/public-lookup';
import { BankingModule } from '../banking/banking.module';
import { BankGetAccountBalancesTool, BankGetReconciliationStatusTool } from './application/use-cases/erp-banking-tools.use-case';
import { LineAiBudgetAuthorityService } from './application/line-ai-budget-authority.service';
import { LineConversationContextService } from './application/line-conversation-context.service';
import { Module } from '@nestjs/common';
import { LineReadEvidenceService } from './application/line-read-evidence.service';
import { LineLedgerDeliveryService } from './application/line-ledger-delivery.service';
import { ERP_READ_TOOL_REGISTRY, type ErpReadToolPort } from './domain/ports/erp-read-tool.port';
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
// P10-L: the LINE surface opens package-change requests and tells operators about support requests.
import { ExternalSignupModule } from '../external-signup/external-signup.module';
import { BillingModule } from '../billing/billing.module';

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
import { ExpenseGetDailyClosingTool } from './application/use-cases/erp-expense-daily-closing.use-case';
import { ReimbursementListPendingApprovalsTool, ReimbursementGetApprovalBacklogTool } from './application/use-cases/erp-reimbursement-tools.use-case';
import { ExpenseListSubstituteReceiptsToSignTool } from './application/use-cases/erp-substitute-receipt-tools.use-case';
import { BillingGetPackageCatalogTool, BillingGetPackageUsageTool } from './application/use-cases/erp-package-tools.use-case';
import { CrmGetCustomerSummaryTool, CrmSearchCustomersTool, CrmGetCustomer360Tool } from './application/use-cases/erp-crm-tools.use-case';
import {
  InventoryGetProductDetailTool,
  AccountingGetDocumentDetailTool,
  AccountingGetReceivableSummaryTool,
  ExpenseGetDetailTool,
  ExpenseExplainRecordTool,
  ReimbursementGetSummaryTool,
  ReimbursementGetDetailTool,
} from './application/use-cases/erp-core-detail-tools.use-case';
import {
  ExpenseDraftSetHeaderTool,
  ExpenseDraftSetLineTool,
  ExpenseDraftAddChargeTool,
  ExpenseDraftRemoveLineTool,
  ExpenseDraftSetVatModeTool,
} from './application/use-cases/erp-draft-update-tools.use-case';
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

// §8.3: durable neutral intake state (Postgres, fails CLOSED) — the money-safe counterpart to the
// fail-open Redis ledger below. Inert until LINE_AI_INTAKE_STATE_MODE leaves 'off'.
import { LineIntakeStateRepository } from './infrastructure/line-intake-state.repository';
// Item 10F: turn ledger (Redis Streams) + reclaim drain
import { LineAiLedgerService } from './application/line-ai-ledger.service';
import { LineHandoffLinkService } from './application/line-handoff-link.service';
import { DrainLineLedgerUseCase } from './application/use-cases/drain-line-ledger.use-case';
import { RecoverOrphanLineEventsUseCase } from './application/use-cases/recover-orphan-line-events.use-case';

// Controllers
import { InternalToolsController } from './presentation/http/internal-tools.controller';
import { InternalAiBudgetController } from './presentation/http/internal-ai-budget.controller';
import { LineAiLedgerInternalController } from './presentation/http/line-ai-ledger-internal.controller';
import { LineCaptureResultsInternalController } from './presentation/http/line-capture-results-internal.controller';
import { LineCaptureResultNotifierUseCase } from './application/use-cases/line-capture-result-notifier.use-case';
import { LineExplainFileAttemptTool } from './application/use-cases/line-file-attempt.tool';
import { LineWebhookController } from '../auth/presentation/line-webhook.controller';
import { LineOfficialWebhookController } from '../auth/presentation/line-official-webhook.controller';

const erpTools = [
  CounterpartySearchTool, CounterpartyGetDetailTool, CounterpartyActionPreviewTool,
  CompanyActionPreviewTool, CompanyGetRolesTool,
  VoucherListRecentTool, VoucherGetDetailTool, WhtGetMonthSummaryTool, WhtCalculateWithholdingTool,
  ExpenseActionPreviewTool,
  LineExplainFileAttemptTool,
  ReimbursementDraftGetOptionsTool, ReimbursementDraftPreviewCreateTool, ReimbursementDraftPreviewUpdateTool,
  PublicLookupAdmissionTool,
  CompanyGetCurrentContextTool,
  CompanyListBranchesTool,
  CompanyEmployeeSummaryTool,
  CompanyEmployeeDetailTool,
  AccountingGetSummaryTool,
  AccountingListRecentDocumentsTool,
  ProcurementApOutstandingTool,
  ExpenseGetBreakdownTool,
  ExpenseGetDailyClosingTool,
  ExpenseListSubstituteReceiptsToSignTool,
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
  ExpenseExplainRecordTool,
  ExpenseDraftSetHeaderTool,
  ExpenseDraftSetLineTool,
  ExpenseDraftAddChargeTool,
  ExpenseDraftRemoveLineTool,
  ExpenseDraftSetVatModeTool,
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
  ReimbursementGetApprovalBacklogTool,
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
  BankGetAccountBalancesTool,
  BankGetReconciliationStatusTool,
  BillingGetPackageUsageTool,
  BillingGetPackageCatalogTool,
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
    BankingModule,
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
    ExternalSignupModule,
    // LINE "ฉันมีส่วนลดไหม": the owner-only ส่วนลดจากงาน read the package page uses (sales-event spec §8.1).
    BillingModule,
    EmployeeAccessModule,
  ],
  controllers: [LineDocumentQaInternalController, InternalToolsController, InternalAiBudgetController, LineAiLedgerInternalController, LineCaptureResultsInternalController, LineWebhookController, LineOfficialWebhookController],
  providers: [
    LineReplyAdapter,
    LineQuotedMessageService,
    ActorDelegationService,
    AiGatewayClient,
    ProcessLineWebhookUseCase,
    LineMessageBufferService,
    LineAiLedgerService,
    LineHandoffLinkService,
    LineIntakeStateRepository,
    DrainLineLedgerUseCase,
    RecoverOrphanLineEventsUseCase,
    LineCaptureResultNotifierUseCase,
    ...erpTools,
    { provide: ERP_READ_TOOL_REGISTRY, inject: erpTools,
      useFactory: (...tools: ErpReadToolPort[]) => new Map(tools.map(tool => [tool.toolName, tool])) },
    LineReadEvidenceService,
    LineConversationContextService,
    LineDocumentQaService,
    LineDocumentQaWorker,
    LinePackagePurchaseService,
    LineTeamActionService,
    LineExpenseActionService,
    LineWorkflowTargetService,
    LineSubstituteReceiptActionService,
    LineCounterpartyService,
    LineVoucherActionService,
    LineReimbursementDraftAdapterService,
    LineReimbursementDraftService,
    LineAiBudgetAuthorityService,
    LineLedgerDeliveryService,
  ],
  exports: [ProcessLineWebhookUseCase, LineMessageBufferService],
})
export class LineAiModule {}
