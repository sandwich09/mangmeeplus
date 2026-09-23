import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { AuditModule } from '../audit/audit.module';
import { BillingModule } from '../billing/billing.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { EmployeeAccessModule } from '../employee-access/employee-access.module';
import { SystemPartnerManagementModule } from '../system-partner-management/system-partner-management.module';
import { SalesAgentsService } from './application/sales-agents.service';
import { SalesCompanySearchService } from './application/sales-company-search.service';
import { SalesDealsService } from './application/sales-deals.service';
import { SalesReferralService } from './application/sales-referral.service';
import { SalesReportsService } from './application/sales-reports.service';
import { SalesRenewalService } from './application/sales-renewal.service';
import { SalesController } from './presentation/http/sales.controller';
import { SalesInternalController } from './presentation/http/sales-internal.controller';
import { SystemSalesAgentsController, SystemSalesAttributionController, SystemSalesReferralController } from './presentation/http/system-sales-agents.controller';

/**
 * Sales console (spec §8 "module ใหม่ sales-console").
 *
 * Owns roles/agents/deals/company-search for มั่งมี's own sales team. It reads Company and
 * CompanyPlanTerm through its own limited projection and never touches a shop's business tables.
 *
 * LoggerModule: LOGGER_TOKEN for the best-effort LINE notice an approval sends. AuditModule: every
 * mutation here writes an audit row (spec Â§10), and AuditService is not global.
 * SalesReferralService is exported because both signup paths resolve sales codes through it.
 */
@Module({
  imports: [LoggerModule, AuditModule, BillingModule, DashboardNotificationsModule, DataModelCoreModule, EmployeeAccessModule, SystemPartnerManagementModule],
  controllers: [
    SalesController,
    SystemSalesAgentsController,
    SystemSalesAttributionController,
    SystemSalesReferralController,
    SalesInternalController,
  ],
  providers: [SalesAgentsService, SalesCompanySearchService, SalesDealsService, SalesReferralService,
    SalesReportsService, SalesRenewalService],
  exports: [SalesReferralService, SalesDealsService],
})
export class SalesConsoleModule {}
