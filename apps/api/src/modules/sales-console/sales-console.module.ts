import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { SalesAgentsService } from './application/sales-agents.service';
import { SalesCompanySearchService } from './application/sales-company-search.service';
import { SalesDealsService } from './application/sales-deals.service';
import { SalesReferralService } from './application/sales-referral.service';
import { SalesController } from './presentation/http/sales.controller';
import { SalesInternalController } from './presentation/http/sales-internal.controller';
import { SystemSalesAgentsController, SystemSalesReferralController } from './presentation/http/system-sales-agents.controller';

/**
 * Sales console (spec §8 "module ใหม่ sales-console").
 *
 * Owns roles/agents/deals/company-search for มั่งมี's own sales team. It reads Company and
 * CompanyPlanTerm through its own limited projection and never touches a shop's business tables.
 *
 * LoggerModule: LOGGER_TOKEN for the best-effort LINE notice an approval sends.
 * SalesReferralService is exported because both signup paths resolve sales codes through it.
 */
@Module({
  imports: [LoggerModule],
  controllers: [
    SalesController,
    SystemSalesAgentsController,
    SystemSalesReferralController,
    SalesInternalController,
  ],
  providers: [SalesAgentsService, SalesCompanySearchService, SalesDealsService, SalesReferralService],
  exports: [SalesReferralService, SalesDealsService],
})
export class SalesConsoleModule {}
