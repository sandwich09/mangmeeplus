import { BillingPlanAdjustmentsService } from './application/billing-plan-adjustments.service';
import { BillingReceiptAdjustmentsService } from './application/billing-receipt-adjustments.service';
import { BillingCheckoutExpiryService } from './application/billing-checkout-expiry.service';
import { BillingBatchesService } from './application/billing-batches.service';
import { BillingSettlementService } from './application/billing-settlement.service';
import { Module } from '@nestjs/common';
import { BillingReadinessService } from './application/billing-readiness.service';
import { BillingRefundsService } from './application/billing-refunds.service';
import { RedisRateLimitService } from '../../common/security/redis-rate-limit.service';
import { SystemPartnerManagementModule } from '../system-partner-management/system-partner-management.module';
import { AuthModule } from '../auth/auth.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { BillingNotificationsService } from './application/billing-notifications.service';
import { BillingService } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { BillingAdminService } from './application/billing-admin.service';
import { BillingOperationsService } from './application/billing-operations.service';
import { BillingProviderScansService } from './application/billing-provider-scans.service';
import { BillingScopesService } from './application/billing-scopes.service';
import { BillingConfigurationService } from './application/billing-configuration.service';
import { SalesDealPriceService } from './application/sales-deal-price.service';
import { StripeClient, STRIPE_FETCH } from './infrastructure/stripe.client';
import { BillingAdminController, BillingCatalogController, BillingController, BillingInternalController, StripeEventsController } from './presentation/billing.controller';

@Module({
  imports: [SystemPartnerManagementModule, AuthModule, DataModelCoreModule, DashboardNotificationsModule],
  controllers: [BillingAdminController, BillingCatalogController, BillingController, BillingInternalController, StripeEventsController],
  providers: [BillingPlanAdjustmentsService, BillingReceiptAdjustmentsService, BillingBatchesService, BillingCheckoutExpiryService, BillingSettlementService, BillingRefundsService, BillingReadinessService, BillingProviderScansService, BillingScopesService, BillingNotificationsService, BillingConfigurationService, BillingOperationsService, BillingAdminService, BillingService, BillingReconcilerService, SalesDealPriceService, StripeClient, RedisRateLimitService,
    { provide: STRIPE_FETCH, useFactory: () => globalThis.fetch.bind(globalThis) }],
  // Q9: the sales console's slip verification reuses the billing password proof rather than
  // growing a second five-minute re-auth window with its own rules.
  // D-P5-3: the sales console approves the deal; the per-company Stripe Price is a billing write,
  // so its one writer lives here and is lent out rather than reimplemented next door.
  exports: [BillingConfigurationService, SalesDealPriceService],
})
export class BillingModule {}
