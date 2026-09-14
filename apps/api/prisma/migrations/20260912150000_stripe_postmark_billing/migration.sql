-- AlterTable
ALTER TABLE "CompanySignupRequest" ADD COLUMN     "latestClaimEmailAttemptId" TEXT;

-- CreateTable
CREATE TABLE "EmailSendAttempt" (
    "id" TEXT NOT NULL,
    "intentKey" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "signupRequestId" TEXT,
    "provider" TEXT NOT NULL,
    "providerServerId" INTEGER NOT NULL,
    "stream" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "errorCode" TEXT,
    "deadlineAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "suppressedAt" TIMESTAMP(3),
    "nextRecoveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSendAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "providerServerId" INTEGER NOT NULL,
    "stream" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPolicyRevision" (
    "id" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "policyJson" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPolicyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "policyRevisionId" TEXT,
    "gatesJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "customerId" TEXT,
    "baseSubscriptionId" TEXT,
    "activeAttemptId" TEXT,
    "contractAttemptId" TEXT,
    "termProjectionHash" TEXT,
    "nextReconcileAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionState" TEXT NOT NULL DEFAULT 'NONE',
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "paidThrough" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "nextChargeAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "observedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingQuote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "initiatingUserId" TEXT NOT NULL,
    "policyRevisionId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "initiatingUserId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "quoteSnapshot" JSONB NOT NULL,
    "policyRevisionId" TEXT NOT NULL,
    "consentRevision" TEXT NOT NULL,
    "consentAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "checkoutSessionId" TEXT,
    "subscriptionId" TEXT,
    "errorCode" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "providerInvoiceId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "providerNumber" TEXT,
    "offerSnapshot" JSONB NOT NULL,
    "policyRevisionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "totalSatang" INTEGER NOT NULL,
    "paidSatang" INTEGER NOT NULL,
    "refundedSatang" INTEGER NOT NULL DEFAULT 0,
    "taxSatang" INTEGER NOT NULL DEFAULT 0,
    "feeSatang" INTEGER,
    "providerChargeId" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "applyStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "errorCode" TEXT,
    "appliedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingProviderEvent" (
    "id" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "BillingProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingIssue" (
    "id" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "companyId" TEXT,
    "kind" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeUserId" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BillingIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingOperation" (
    "id" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL,
    "companyId" TEXT,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PREVIEW',
    "referenceId" TEXT,
    "proposedJson" JSONB NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "initiatorUserId" TEXT NOT NULL,
    "approverUserId" TEXT,
    "idempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3),

    CONSTRAINT "BillingOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailSendAttempt_status_nextRecoveryAt_idx" ON "EmailSendAttempt"("status", "nextRecoveryAt");

-- CreateIndex
CREATE INDEX "EmailSendAttempt_signupRequestId_idx" ON "EmailSendAttempt"("signupRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSendAttempt_intentKey_generation_key" ON "EmailSendAttempt"("intentKey", "generation");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSendAttempt_provider_providerServerId_providerMessageI_key" ON "EmailSendAttempt"("provider", "providerServerId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_providerServerId_stream_recipient_key" ON "EmailSuppression"("providerServerId", "stream", "recipient");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPolicyRevision_stripeAccountId_livemode_version_key" ON "BillingPolicyRevision"("stripeAccountId", "livemode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSettings_stripeAccountId_livemode_key" ON "BillingSettings"("stripeAccountId", "livemode");

-- CreateIndex
CREATE INDEX "BillingAccount_observedAt_idx" ON "BillingAccount"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_companyId_stripeAccountId_livemode_key" ON "BillingAccount"("companyId", "stripeAccountId", "livemode");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeAccountId_livemode_customerId_key" ON "BillingAccount"("stripeAccountId", "livemode", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAccount_stripeAccountId_livemode_baseSubscriptionId_key" ON "BillingAccount"("stripeAccountId", "livemode", "baseSubscriptionId");

-- CreateIndex
CREATE INDEX "BillingQuote_companyId_createdAt_idx" ON "BillingQuote"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_quoteId_key" ON "BillingAttempt"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_checkoutSessionId_key" ON "BillingAttempt"("checkoutSessionId");

-- CreateIndex
CREATE INDEX "BillingAttempt_status_updatedAt_idx" ON "BillingAttempt"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_billingAccountId_idempotencyKey_key" ON "BillingAttempt"("billingAccountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "BillingInvoice_applyStatus_updatedAt_idx" ON "BillingInvoice"("applyStatus", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_billingAccountId_providerInvoiceId_key" ON "BillingInvoice"("billingAccountId", "providerInvoiceId");

-- CreateIndex
CREATE INDEX "BillingProviderEvent_status_retryAt_idx" ON "BillingProviderEvent"("status", "retryAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingProviderEvent_stripeAccountId_livemode_eventId_key" ON "BillingProviderEvent"("stripeAccountId", "livemode", "eventId");

-- CreateIndex
CREATE INDEX "BillingIssue_state_createdAt_idx" ON "BillingIssue"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingIssue_stripeAccountId_livemode_kind_referenceId_key" ON "BillingIssue"("stripeAccountId", "livemode", "kind", "referenceId");

-- CreateIndex
CREATE INDEX "BillingOperation_state_createdAt_idx" ON "BillingOperation"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingOperation_stripeAccountId_livemode_idempotencyKey_key" ON "BillingOperation"("stripeAccountId", "livemode", "idempotencyKey");
