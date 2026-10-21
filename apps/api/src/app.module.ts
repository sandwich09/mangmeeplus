import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HomeThemeModule } from './modules/public-home-theme/home-theme.module';
import { DatabaseModule } from './common/database/database.module';
import { ConfigModule } from './common/config/config.module';
import { SecurityModule } from './common/security/security.module';
import { LoggerModule } from './common/logger/logger.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { DataModelCoreModule } from './modules/data-model-core/data-model-core.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { DashboardNotificationsModule } from './modules/dashboard-notifications/dashboard-notifications.module';
import { LineAiModule } from './modules/line-ai/line-ai.module';
import { AccountingDocumentsModule } from './modules/accounting-documents/accounting-documents.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { SystemIdentityReconciliationModule } from './modules/system-identity-reconciliation/system-identity-reconciliation.module';
import { SystemOnboardingModule } from './modules/system-onboarding/system-onboarding.module';
import { SystemPartnerManagementModule } from './modules/system-partner-management/system-partner-management.module';
import { TaxModule } from './modules/tax/tax.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { BankingModule } from './modules/banking/banking.module';
import { ReimbursementsModule } from './modules/reimbursements/reimbursements.module';
import { CrmModule } from './modules/crm/crm.module';
import { CrmInboxModule } from './modules/crm-inbox/crm-inbox.module';
import { EmployeeAccessModule } from './modules/employee-access/employee-access.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { AiDraftModule } from './modules/ai-draft/ai-draft.module';
import { ReportsModule } from './modules/reports/reports.module';
import { FeatureLaunchModule } from './modules/feature-launch/feature-launch.module';
import { DataRightsModule } from './modules/data-rights/data-rights.module';
import { BillingModule } from './modules/billing/billing.module';
import { ExternalSignupModule } from './modules/external-signup/external-signup.module';
import { ExecutiveBusinessModule } from './modules/executive-business/executive-business.module';
import { SalesConsoleModule } from './modules/sales-console/sales-console.module';
import { ExecutiveReportBuildModule } from './modules/executive-business/executive-report-build.module';

@Module({
  imports: [HomeThemeModule, ConfigModule, LoggerModule, SecurityModule, DatabaseModule, HealthModule, AuthModule, AuditModule, DataModelCoreModule, InventoryModule, DashboardNotificationsModule, LineAiModule, AccountingDocumentsModule, ExpensesModule, LedgerModule, SystemOnboardingModule, SystemIdentityReconciliationModule, SystemPartnerManagementModule, TaxModule, ProcurementModule, BankingModule, ReimbursementsModule, CrmModule, CrmInboxModule, EmployeeAccessModule, WorkflowModule, AiDraftModule, ReportsModule, FeatureLaunchModule, DataRightsModule, ExternalSignupModule, SalesConsoleModule, BillingModule, ExecutiveBusinessModule, ExecutiveReportBuildModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, RequestLoggerMiddleware).forRoutes('*');
  }
}
