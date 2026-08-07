import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { CrmModule } from '../crm/crm.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { PrismaCrmInboxRepository } from './infrastructure/prisma-crm-inbox.repository';
import { PrismaCrmChannelCapRepository } from './infrastructure/prisma-crm-channel-cap.repository';
import { LineMessagingAdapter } from './infrastructure/line-messaging.adapter';
import {
  MessagingChannelSecretsService,
  ListMessagingChannelsUseCase,
  ConnectMessagingChannelUseCase,
  TestMessagingChannelUseCase,
  RotateMessagingChannelCredentialUseCase,
  DisableMessagingChannelUseCase,
  RevealMessagingChannelCredentialUseCase,
  UpdateMessagingChannelSettingsUseCase,
} from './application/use-cases/messaging-channel.use-case';
import { ProcessInboundLineMessageUseCase } from './application/use-cases/process-inbound-line-message.use-case';
import {
  ListCrmConversationsUseCase,
  GetCrmConversationUseCase,
  GetCrmMessageContentUseCase,
  SendCrmInboxMessageUseCase,
  SetCrmConversationStatusUseCase,
  UpdateCrmConversationAutoReplyUseCase,
  SetCrmConversationPriorityUseCase,
  SetCrmConversationTagsUseCase,
  AssignCrmConversationUseCase,
  MarkCrmConversationReadUseCase,
} from './application/use-cases/crm-conversation.use-case';
import {
  ListCrmMessageTemplatesUseCase,
  CreateCrmMessageTemplateUseCase,
  UpdateCrmMessageTemplateUseCase,
  ApproveCrmMessageTemplateForAiUseCase,
  ArchiveCrmMessageTemplateUseCase,
} from './application/use-cases/crm-template.use-case';
import { GetCrmInboxPolicyUseCase, UpdateCrmInboxPolicyUseCase } from './application/use-cases/crm-inbox-policy.use-case';
import { ScanCrmSlaBreachesUseCase } from './application/use-cases/scan-crm-sla-breaches.use-case';
import { ScanCrmNewConversationsUseCase } from './application/use-cases/scan-crm-new-conversations.use-case';
import { RetryCrmInboxDeliveriesUseCase } from './application/use-cases/retry-crm-inbox-deliveries.use-case';
import { RetryCrmAutonomyJobsUseCase } from './application/use-cases/retry-crm-autonomy-jobs.use-case';
// CreateFromConversationUseCase injects the item-15 create flows exported by CrmModule.
import { CreateFromConversationUseCase } from './application/use-cases/create-from-conversation.use-case';
import { CrmPaymentProofUseCase } from './application/use-cases/crm-payment-proof.use-case';
import { ScanCrmBookingRemindersUseCase } from './application/use-cases/scan-crm-booking-reminders.use-case';
import { SweepCrmBookingProposalsUseCase } from './application/use-cases/sweep-crm-booking-proposals.use-case';
import { CrmDailyBriefUseCase } from './application/use-cases/crm-daily-brief.use-case';
import { GetCrmCustomer360SummaryUseCase, GetCrmCustomer360TimelineUseCase } from './application/use-cases/crm-customer-360.use-case';
import { ProcessCrmErasureRequestsUseCase, PurgeCrmPdpaUseCase, EraseCrmCustomerUseCase, CrmCustomerSelfServiceUseCase } from './application/use-cases/crm-pdpa.use-case';
import { PrismaCrmPdpaSelfServiceRepository } from './infrastructure/prisma-crm-pdpa-self-service.repository';
import { CrmCustomerPdpaController } from './presentation/http/crm-customer-pdpa.controller';
import { GetCrmReportsSummaryUseCase } from './application/use-cases/crm-reports-summary.use-case';
import { AccountingDocumentsModule } from '../accounting-documents/accounting-documents.module';
import { MessagingChannelController } from './presentation/http/messaging-channel.controller';
import { CrmConversationController } from './presentation/http/crm-conversation.controller';
import { CrmTemplateController } from './presentation/http/crm-template.controller';
import { CrmInboxPolicyController } from './presentation/http/crm-inbox-policy.controller';
import { CrmInternalController } from './presentation/http/crm-internal.controller';
import { CrmLineWebhookController } from './presentation/http/crm-line-webhook.controller';
import { CrmCustomer360Controller } from './presentation/http/crm-customer-360.controller';
import { CrmConversationActionsController, CrmPaymentProofQueueController, CrmDailyBriefController } from './presentation/http/crm-conversation-actions.controller';
import { CrmReportsController } from './presentation/http/crm-reports.controller';
// MVP1-4 B4/B5: AI staff assist + trust score (Dev B)
import { CrmAiGatewayClient } from './infrastructure/crm-ai-gateway.client';
import { CrmAiContextRepository } from './infrastructure/crm-ai-context.repository';
import { CRM_AUTO_REPLY_AGENT } from './domain/logic/crm-auto-reply.logic';
import {
  CrmAiFeedbackUseCase,
  CrmCustomerProfileExtractUseCase,
  CrmAiInsightsUseCase,
  CrmAiReplyDraftUseCase,
  CrmAiSummaryUseCase,
  CrmAiTrustReadUseCase,
} from './application/use-cases/crm-ai-assist.use-case';
import { CrmAiAutoReplyUseCase } from './application/use-cases/crm-ai-auto-reply.use-case';
import { ScanCrmTrustScoresUseCase } from './application/use-cases/crm-ai-trust.use-case';
import { CrmAiAssistController, CrmCustomerProfileAssistController } from './presentation/http/crm-ai-assist.controller';
import { CrmAiInternalController } from './presentation/http/crm-ai-internal.controller';
import { CustomerLineRegisterUseCase } from './application/use-cases/customer-line-register.use-case';
import { CustomerLineRegisterController } from './presentation/http/customer-line-register.controller';
import { PrismaCrmCampaignRepository } from './infrastructure/prisma-crm-campaign.repository';
import { CrmCampaignUseCase } from './application/use-cases/crm-campaign.use-case';
import { CrmCampaignController } from './presentation/http/crm-campaign.controller';
import { DeliverCrmCampaignUseCase } from './application/use-cases/deliver-crm-campaign.use-case';
import { CrmAiBroadcastUseCase } from './application/use-cases/crm-ai-broadcast.use-case';

// Item 15A: CRM Customer OS — company LINE OA channel + inbox foundation.
// Imports CrmModule to reuse item 15's exported repository for customer
// creation; never duplicates CRM master-data code. AccountingDocumentsModule
// feeds the Customer 360 finance blocks through its permission-checked reads.
@Module({
  // FeatureLaunchModule supplies the shadow probe for the campaign-delivery sweep (plan §3 F1).
  imports: [AuditModule, AuthModule, DataModelCoreModule, CrmModule, DashboardNotificationsModule, AccountingDocumentsModule, FeatureLaunchModule],
  controllers: [
    MessagingChannelController,
    CrmConversationController,
    CrmTemplateController,
    CrmInboxPolicyController,
    CrmInternalController,
    CrmLineWebhookController,
    CrmCustomer360Controller,
    CrmConversationActionsController,
    CrmPaymentProofQueueController,
    CrmDailyBriefController,
    CrmReportsController,
    CrmAiAssistController,
    CrmCustomerProfileAssistController,
    CrmAiInternalController,
    CustomerLineRegisterController,
    CrmCustomerPdpaController,
    CrmCampaignController,
  ],
  providers: [
    PrismaCrmInboxRepository,
    PrismaCrmChannelCapRepository,
    PrismaCrmPdpaSelfServiceRepository,
    CrmCustomerSelfServiceUseCase,
    ProcessCrmErasureRequestsUseCase,
    LineMessagingAdapter,
    MessagingChannelSecretsService,
    // Channel lifecycle
    ListMessagingChannelsUseCase,
    ConnectMessagingChannelUseCase,
    TestMessagingChannelUseCase,
    RotateMessagingChannelCredentialUseCase,
    DisableMessagingChannelUseCase,
    RevealMessagingChannelCredentialUseCase,
    UpdateMessagingChannelSettingsUseCase,
    // Inbound ingestion
    ProcessInboundLineMessageUseCase,
    // Inbox reads
    ListCrmConversationsUseCase,
    GetCrmConversationUseCase,
    GetCrmMessageContentUseCase,
    // Phase 2 triage
    SendCrmInboxMessageUseCase,
    SetCrmConversationStatusUseCase,
    UpdateCrmConversationAutoReplyUseCase,
    SetCrmConversationPriorityUseCase,
    SetCrmConversationTagsUseCase,
    AssignCrmConversationUseCase,
    MarkCrmConversationReadUseCase,
    // Phase 2 templates (quick replies)
    ListCrmMessageTemplatesUseCase,
    CreateCrmMessageTemplateUseCase,
    UpdateCrmMessageTemplateUseCase,
    ApproveCrmMessageTemplateForAiUseCase,
    ArchiveCrmMessageTemplateUseCase,
    // Phase 2 SLA policy + breach scanner
    GetCrmInboxPolicyUseCase,
    UpdateCrmInboxPolicyUseCase,
    ScanCrmSlaBreachesUseCase,
    ScanCrmNewConversationsUseCase,
    RetryCrmInboxDeliveriesUseCase,
    RetryCrmAutonomyJobsUseCase,
    // A3 revenue loop
    CreateFromConversationUseCase,
    CrmPaymentProofUseCase,
    // A7 appointment reminders
    ScanCrmBookingRemindersUseCase,
    // CUST-02 booking-proposal expiry + stuck-COMMITTING crash recovery
    SweepCrmBookingProposalsUseCase,
    // A8 daily brief
    CrmDailyBriefUseCase,
    // Phase 3 Customer 360 aggregate + timeline
    GetCrmCustomer360SummaryUseCase,
    GetCrmCustomer360TimelineUseCase,
    // A6 PDPA retention purge + on-demand erasure
    PurgeCrmPdpaUseCase,
    EraseCrmCustomerUseCase,
    GetCrmReportsSummaryUseCase,
    // MVP1-4 B4/B5: AI staff assist + trust score (Dev B)
    CrmAiGatewayClient,
    CrmAiContextRepository,
    CrmAiSummaryUseCase,
    CrmAiReplyDraftUseCase,
    CrmAiInsightsUseCase,
    CrmAiFeedbackUseCase,
    CrmCustomerProfileExtractUseCase,
    CrmAiTrustReadUseCase,
    ScanCrmTrustScoresUseCase,
    CrmAiAutoReplyUseCase,
    CustomerLineRegisterUseCase,
    PrismaCrmCampaignRepository,
    CrmCampaignUseCase,
    DeliverCrmCampaignUseCase,
    CrmAiBroadcastUseCase,
    { provide: CRM_AUTO_REPLY_AGENT, useExisting: CrmAiAutoReplyUseCase },
  ],
  exports: [
    PrismaCrmInboxRepository,
    GetCrmCustomer360SummaryUseCase,
    GetCrmReportsSummaryUseCase,
    ListCrmConversationsUseCase,
    GetCrmConversationUseCase,
  ],
})
export class CrmInboxModule {}
