-- Item 05 Inventory MVP schema missed from the prior checked-off item.
-- Item 06 depends on these read models for dashboard widgets and stock alerts.

CREATE TYPE "ProductKind" AS ENUM ('STOCKABLE', 'SERVICE', 'NON_STOCK');
CREATE TYPE "InventoryRecordStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "InventoryLocationType" AS ENUM ('MAIN', 'WAREHOUSE', 'STOREFRONT', 'VEHICLE', 'VIRTUAL', 'OTHER');
CREATE TYPE "ProductBarcodeType" AS ENUM ('INTERNAL_QR', 'EAN13', 'UPC', 'CODE128', 'SUPPLIER', 'OTHER');
CREATE TYPE "InternalQrEntityType" AS ENUM ('PRODUCT', 'LOCATION');
CREATE TYPE "StockMovementType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_ADJUSTMENT_IN', 'COUNT_ADJUSTMENT_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT');
CREATE TYPE "StockMovementDirection" AS ENUM ('IN', 'OUT');

CREATE TABLE "Product" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT,
  "unit" TEXT NOT NULL,
  "kind" "ProductKind" NOT NULL DEFAULT 'STOCKABLE',
  "reorderPoint" DECIMAL(65,30),
  "status" "InventoryRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductBarcode" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "type" "ProductBarcodeType" NOT NULL,
  "value" TEXT NOT NULL,
  "source" TEXT,
  "status" "InventoryRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryLocation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "InventoryLocationType" NOT NULL DEFAULT 'MAIN',
  "status" "InventoryRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalQrLabel" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "entityType" "InternalQrEntityType" NOT NULL,
  "entityId" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "labelText" TEXT NOT NULL,
  "status" "InventoryRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "printedAt" TIMESTAMP(3),
  "printedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InternalQrLabel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "movementNumber" TEXT,
  "productId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "movementType" "StockMovementType" NOT NULL,
  "direction" "StockMovementDirection" NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "reason" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "transferGroupId" TEXT,
  "reversesMovementId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Product_companyId_sku_key" ON "Product"("companyId", "sku");
CREATE INDEX "Product_companyId_status_idx" ON "Product"("companyId", "status");
CREATE INDEX "Product_companyId_name_idx" ON "Product"("companyId", "name");
CREATE UNIQUE INDEX "ProductBarcode_companyId_value_key" ON "ProductBarcode"("companyId", "value");
CREATE INDEX "ProductBarcode_companyId_productId_idx" ON "ProductBarcode"("companyId", "productId");
CREATE UNIQUE INDEX "InventoryLocation_companyId_code_key" ON "InventoryLocation"("companyId", "code");
CREATE INDEX "InventoryLocation_companyId_status_idx" ON "InventoryLocation"("companyId", "status");
CREATE INDEX "InventoryLocation_companyId_branchId_idx" ON "InventoryLocation"("companyId", "branchId");
CREATE UNIQUE INDEX "InternalQrLabel_companyId_payload_key" ON "InternalQrLabel"("companyId", "payload");
CREATE INDEX "InternalQrLabel_companyId_entityType_entityId_idx" ON "InternalQrLabel"("companyId", "entityType", "entityId");
CREATE UNIQUE INDEX "StockMovement_companyId_movementNumber_key" ON "StockMovement"("companyId", "movementNumber");
CREATE INDEX "StockMovement_companyId_productId_locationId_occurredAt_idx" ON "StockMovement"("companyId", "productId", "locationId", "occurredAt");
CREATE INDEX "StockMovement_companyId_productId_occurredAt_idx" ON "StockMovement"("companyId", "productId", "occurredAt");
CREATE INDEX "StockMovement_companyId_locationId_occurredAt_idx" ON "StockMovement"("companyId", "locationId", "occurredAt");
CREATE INDEX "StockMovement_companyId_movementType_occurredAt_idx" ON "StockMovement"("companyId", "movementType", "occurredAt");
CREATE INDEX "StockMovement_companyId_transferGroupId_idx" ON "StockMovement"("companyId", "transferGroupId");
CREATE INDEX "StockMovement_companyId_referenceType_referenceId_idx" ON "StockMovement"("companyId", "referenceType", "referenceId");

ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductBarcode" ADD CONSTRAINT "ProductBarcode_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalQrLabel" ADD CONSTRAINT "InternalQrLabel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "DashboardScope" AS ENUM ('COMPANY', 'ROLE', 'USER');
CREATE TYPE "DashboardFreshnessStatus" AS ENUM ('FRESH', 'STALE', 'PARTIAL', 'UNAVAILABLE');
CREATE TYPE "DashboardGeneratedBy" AS ENUM ('SYSTEM', 'MANUAL', 'WORKER', 'AI_GATEWAY');
CREATE TYPE "DashboardWidgetStatus" AS ENUM ('ENABLED', 'DISABLED');
CREATE TYPE "NotificationSeverity" AS ENUM ('CRITICAL', 'ACTION', 'INSIGHT', 'INFO');
CREATE TYPE "NotificationChannel" AS ENUM ('WEB', 'LINE');
CREATE TYPE "NotificationEventStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPPRESSED', 'EXPIRED');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'SUPPRESSED');
CREATE TYPE "NotificationRuleStatus" AS ENUM ('ENABLED', 'DISABLED', 'SYSTEM');
CREATE TYPE "NotificationDigestPolicy" AS ENUM ('NONE', 'DAILY', 'WEEKLY');
CREATE TYPE "AlertStateStatus" AS ENUM ('ACTIVE', 'COOLING_DOWN', 'RESOLVED');

CREATE TABLE "DashboardSnapshot" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "scope" "DashboardScope" NOT NULL DEFAULT 'COMPANY',
  "scopeKey" TEXT,
  "periodKind" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "metricsJson" JSONB NOT NULL,
  "sourceRefsJson" JSONB NOT NULL DEFAULT '[]',
  "freshnessStatus" "DashboardFreshnessStatus" NOT NULL DEFAULT 'FRESH',
  "generatedBy" "DashboardGeneratedBy" NOT NULL DEFAULT 'SYSTEM',
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DashboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DashboardWidgetConfig" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "widgetKey" TEXT NOT NULL,
  "moduleKey" TEXT NOT NULL,
  "status" "DashboardWidgetStatus" NOT NULL DEFAULT 'ENABLED',
  "position" INTEGER,
  "configJson" JSONB NOT NULL DEFAULT '{}',
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DashboardWidgetConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationRule" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "triggerKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  "conditionJson" JSONB NOT NULL DEFAULT '{}',
  "recipientPolicyJson" JSONB NOT NULL DEFAULT '{}',
  "channelPolicyJson" JSONB NOT NULL DEFAULT '{}',
  "cooldownMinutes" INTEGER NOT NULL DEFAULT 60,
  "digestPolicy" "NotificationDigestPolicy" NOT NULL DEFAULT 'NONE',
  "status" "NotificationRuleStatus" NOT NULL DEFAULT 'ENABLED',
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT,
  "triggerKey" TEXT NOT NULL,
  "sourceModule" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "severity" "NotificationSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL DEFAULT '{}',
  "sourceRefsJson" JSONB NOT NULL DEFAULT '[]',
  "deepLinkHref" TEXT,
  "dedupKey" TEXT NOT NULL,
  "status" "NotificationEventStatus" NOT NULL DEFAULT 'OPEN',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationRecipient" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recipientReason" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
  "id" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "channel" "NotificationChannel" NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "providerMessageId" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabledChannelsJson" JSONB NOT NULL DEFAULT '[]',
  "enabledTriggerKeysJson" JSONB NOT NULL DEFAULT '[]',
  "quietHoursStart" TEXT,
  "quietHoursEnd" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
  "digestFrequency" "NotificationDigestPolicy" NOT NULL DEFAULT 'NONE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertState" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "status" "AlertStateStatus" NOT NULL DEFAULT 'ACTIVE',
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "lastTriggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cooldownUntil" TIMESTAMP(3),
  "lastResolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AlertState_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DashboardSnapshot_companyId_periodKind_periodStart_periodEnd_generatedAt_idx" ON "DashboardSnapshot"("companyId", "periodKind", "periodStart", "periodEnd", "generatedAt");
CREATE INDEX "DashboardSnapshot_companyId_scope_scopeKey_generatedAt_idx" ON "DashboardSnapshot"("companyId", "scope", "scopeKey", "generatedAt");
CREATE UNIQUE INDEX "DashboardWidgetConfig_companyId_widgetKey_key" ON "DashboardWidgetConfig"("companyId", "widgetKey");
CREATE INDEX "DashboardWidgetConfig_companyId_moduleKey_idx" ON "DashboardWidgetConfig"("companyId", "moduleKey");
CREATE UNIQUE INDEX "NotificationRule_companyId_triggerKey_key" ON "NotificationRule"("companyId", "triggerKey");
CREATE INDEX "NotificationRule_companyId_status_idx" ON "NotificationRule"("companyId", "status");
CREATE INDEX "NotificationEvent_companyId_triggerKey_status_createdAt_idx" ON "NotificationEvent"("companyId", "triggerKey", "status", "createdAt");
CREATE INDEX "NotificationEvent_companyId_sourceModule_sourceType_sourceId_idx" ON "NotificationEvent"("companyId", "sourceModule", "sourceType", "sourceId");
CREATE INDEX "NotificationEvent_companyId_dedupKey_idx" ON "NotificationEvent"("companyId", "dedupKey");
CREATE UNIQUE INDEX "NotificationRecipient_eventId_userId_key" ON "NotificationRecipient"("eventId", "userId");
CREATE INDEX "NotificationRecipient_companyId_userId_readAt_idx" ON "NotificationRecipient"("companyId", "userId", "readAt");
CREATE INDEX "NotificationRecipient_companyId_userId_dismissedAt_idx" ON "NotificationRecipient"("companyId", "userId", "dismissedAt");
CREATE INDEX "NotificationDelivery_companyId_channel_status_nextAttemptAt_idx" ON "NotificationDelivery"("companyId", "channel", "status", "nextAttemptAt");
CREATE INDEX "NotificationDelivery_recipientId_channel_idx" ON "NotificationDelivery"("recipientId", "channel");
CREATE UNIQUE INDEX "NotificationPreference_companyId_userId_key" ON "NotificationPreference"("companyId", "userId");
CREATE INDEX "NotificationPreference_companyId_userId_idx" ON "NotificationPreference"("companyId", "userId");
CREATE UNIQUE INDEX "AlertState_companyId_dedupKey_key" ON "AlertState"("companyId", "dedupKey");
CREATE INDEX "AlertState_companyId_status_idx" ON "AlertState"("companyId", "status");

ALTER TABLE "DashboardSnapshot" ADD CONSTRAINT "DashboardSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DashboardWidgetConfig" ADD CONSTRAINT "DashboardWidgetConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationRule" ADD CONSTRAINT "NotificationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "NotificationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "NotificationRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertState" ADD CONSTRAINT "AlertState_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
