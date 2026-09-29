import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { EmployeeAccessModule } from '../employee-access/employee-access.module';
import { SystemPartnerManagementModule } from '../system-partner-management/system-partner-management.module';
import { ClaimEventDiscountUseCase } from './application/claim-event-discount.use-case';
import { SalesAgentsService } from './application/sales-agents.service';
import { SalesCompanySearchService } from './application/sales-company-search.service';
import { SalesDealsService } from './application/sales-deals.service';
import { SalesEventsService } from './application/sales-events.service';
import { SalesReferralService } from './application/sales-referral.service';
import { SalesReportsService } from './application/sales-reports.service';
import { SalesRenewalService } from './application/sales-renewal.service';
import { SalesEventReportsService } from './application/sales-event-reports.service';
import { PublicEventDiscountsController } from './presentation/http/public-event-discounts.controller';
import { SalesController } from './presentation/http/sales.controller';
import { SalesEventsController } from './presentation/http/sales-events.controller';
import { SalesInternalController } from './presentation/http/sales-internal.controller';
import { SalesEventReportsController } from './presentation/http/sales-event-reports.controller';
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
 * AuthModule: the sales-event claim verifies a LIFF ID token (`LineIdTokenService`) and spends a
 * per-LINE-account bucket (`AuthRateLimitService`); both are exported there for exactly this.
 */
@Module({
  imports: [LoggerModule, AuditModule, AuthModule, BillingModule, DashboardNotificationsModule, DataModelCoreModule, EmployeeAccessModule, SystemPartnerManagementModule],
  controllers: [
    SalesController,
    SalesEventsController,
    SystemSalesAgentsController,
    SystemSalesAttributionController,
    SystemSalesReferralController,
    SalesInternalController,
    PublicEventDiscountsController,
    SalesEventReportsController,
  ],
  providers: [SalesAgentsService, SalesCompanySearchService, SalesDealsService, SalesReferralService,
    SalesReportsService, SalesRenewalService, SalesEventsService, ClaimEventDiscountUseCase, SalesEventReportsService],
  exports: [SalesReferralService, SalesDealsService],
})
export class SalesConsoleModule {}
