import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';

// Infrastructure
import { PrismaDashboardSnapshotRepository, PrismaDashboardWidgetConfigRepository } from './infrastructure/prisma-dashboard.repository';
import {
  PrismaNotificationRuleRepository,
  PrismaNotificationEventRepository,
  PrismaNotificationRecipientRepository,
  PrismaNotificationDeliveryRepository,
  PrismaNotificationPreferenceRepository,
  PrismaAlertStateRepository,
} from './infrastructure/prisma-notification.repository';

// Providers
import { InventoryHealthProvider } from './application/providers/inventory-health.provider';
import { ExpenseSummaryProvider } from './application/providers/expense-summary.provider';

// Use Cases
import { GenerateSnapshotUseCase } from './application/use-cases/generate-snapshot.use-case';
import {
  ListNotificationsUseCase,
  GetUnreadCountUseCase,
  MarkReadUseCase,
  MarkAllReadUseCase,
  DismissNotificationUseCase,
  GetPreferenceUseCase,
  UpdatePreferenceUseCase,
  ListRulesUseCase,
  UpdateRuleUseCase,
  ListDeliveriesUseCase,
  RetryDeliveryUseCase,
  CreateOrUpdateNotificationEventUseCase,
  CreateDailyOwnerSummaryUseCase,
  ProcessQueuedDeliveryUseCase,
  ProcessDueNotificationDeliveriesUseCase,
} from './application/use-cases/notification.use-cases';
import { StockLowScanUseCase } from './application/use-cases/stock-low-scan.use-case';
import {
  CreateDailyOwnerSummariesSweepUseCase,
  GenerateDashboardSnapshotsSweepUseCase,
  ScanStockLowNotificationsSweepUseCase,
} from './application/use-cases/notification-sweeps.use-cases';

// Controllers
import { DashboardController } from './presentation/http/dashboard.controller';
import {
  NotificationController,
  NotificationPreferenceController,
  NotificationRuleController,
  NotificationDeliveryController,
} from './presentation/http/notification.controller';
import { InternalNotificationController, InternalNotificationSweepController } from './presentation/http/internal.controller';

const repositories = [
  PrismaDashboardSnapshotRepository,
  PrismaDashboardWidgetConfigRepository,
  PrismaNotificationRuleRepository,
  PrismaNotificationEventRepository,
  PrismaNotificationRecipientRepository,
  PrismaNotificationDeliveryRepository,
  PrismaNotificationPreferenceRepository,
  PrismaAlertStateRepository,
];

const providers = [
  InventoryHealthProvider,
  ExpenseSummaryProvider,
];

const useCases = [
  GenerateSnapshotUseCase,
  ListNotificationsUseCase,
  GetUnreadCountUseCase,
  MarkReadUseCase,
  MarkAllReadUseCase,
  DismissNotificationUseCase,
  GetPreferenceUseCase,
  UpdatePreferenceUseCase,
  ListRulesUseCase,
  UpdateRuleUseCase,
  ListDeliveriesUseCase,
  RetryDeliveryUseCase,
  CreateOrUpdateNotificationEventUseCase,
  CreateDailyOwnerSummaryUseCase,
  ProcessQueuedDeliveryUseCase,
  ProcessDueNotificationDeliveriesUseCase,
  StockLowScanUseCase,
  GenerateDashboardSnapshotsSweepUseCase,
  ScanStockLowNotificationsSweepUseCase,
  CreateDailyOwnerSummariesSweepUseCase,
];

@Module({
  // FeatureLaunchModule supplies the shadow probe for the notification sweeps and the four
  // on-demand worker endpoints (plan §3 F1).
  imports: [AuditModule, FeatureLaunchModule],
  controllers: [
    DashboardController,
    NotificationController,
    NotificationPreferenceController,
    NotificationRuleController,
    NotificationDeliveryController,
    InternalNotificationController,
    InternalNotificationSweepController,
  ],
  providers: [...repositories, ...providers, ...useCases],
  exports: [
    CreateOrUpdateNotificationEventUseCase,
    GenerateSnapshotUseCase,
    ListNotificationsUseCase,
    GetUnreadCountUseCase,
  ],
})
export class DashboardNotificationsModule {}
