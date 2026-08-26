import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { AccountingDocumentsModule } from '../accounting-documents/accounting-documents.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { PrismaCrmRepository } from './infrastructure/prisma-crm.repository';
import { PrismaCrmBookingProposalRepository } from './infrastructure/prisma-crm-booking-proposal.repository';
import {
  CreateCrmCustomerUseCase,
  UpdateCrmCustomerUseCase,
  GetCrmCustomerUseCase,
  ListCrmCustomersUseCase,
  GetCrmCustomerSummaryUseCase,
  ArchiveCrmCustomerUseCase,
  AssignCrmCustomerUseCase,
  ListCrmContactsUseCase,
  CreateCrmContactUseCase,
  UpdateCrmContactUseCase,
  PreviewCrmCustomerMergeUseCase,
  MergeCrmCustomersUseCase,
  LinkCrmCustomerLineIdentityUseCase,
} from './application/use-cases/crm-customer.use-case';
import {
  CreateCrmLeadUseCase,
  ListCrmLeadsUseCase,
  GetCrmLeadUseCase,
  UpdateCrmLeadUseCase,
  AssignCrmLeadUseCase,
  DisqualifyCrmLeadUseCase,
  ConvertCrmLeadUseCase,
} from './application/use-cases/crm-lead.use-case';
import {
  ListCrmPipelineStagesUseCase,
  UpdateCrmPipelineStagesUseCase,
  CreateCrmOpportunityUseCase,
  ListCrmOpportunitiesUseCase,
  GetCrmOpportunityUseCase,
  GetCrmPipelineBoardUseCase,
  UpdateCrmOpportunityUseCase,
  MoveCrmOpportunityStageUseCase,
  CloseCrmOpportunityUseCase,
  ReopenCrmOpportunityUseCase,
  ListCrmActivitiesUseCase,
  CreateCrmActivityUseCase,
} from './application/use-cases/crm-opportunity.use-case';
import {
  ListCrmFollowUpsUseCase,
  CreateCrmFollowUpUseCase,
  UpdateCrmFollowUpUseCase,
  CompleteCrmFollowUpUseCase,
  SnoozeCrmFollowUpUseCase,
  CancelCrmFollowUpUseCase,
} from './application/use-cases/crm-follow-up.use-case';
import {
  ListCrmQuotationLinksUseCase,
  CreateCrmQuotationDraftUseCase,
  RefreshCrmQuotationLinkUseCase,
} from './application/use-cases/crm-quotation.use-case';
import {
  GetCrmFollowUpPrioritiesUseCase,
  GetCrmCustomerAiSummaryUseCase,
  GetCrmOpportunityAiSummaryUseCase,
  GetCrmPipelineAiSummaryUseCase,
  GetCrmDashboardSummaryUseCase,
} from './application/use-cases/crm-ai.use-case';
import {
  GetCrmBookingSettingsUseCase,
  UpdateCrmBookingSettingsUseCase,
  ListCrmBookingsUseCase,
  ListCrmCustomerBookingsUseCase,
  CreateCrmBookingUseCase,
  CreateAutonomousCrmBookingUseCase,
  UpdateCrmBookingUseCase,
  CancelCrmBookingUseCase,
} from './application/use-cases/crm-booking.use-case';
import { CrmCustomerController } from './presentation/http/crm-customer.controller';
import { CrmLeadController } from './presentation/http/crm-lead.controller';
import { CrmOpportunityController } from './presentation/http/crm-opportunity.controller';
import { CrmFollowUpController } from './presentation/http/crm-follow-up.controller';
import { CrmAiController } from './presentation/http/crm-ai.controller';
import { CrmBookingController } from './presentation/http/crm-booking.controller';

@Module({
  imports: [AuditModule, DataModelCoreModule, AccountingDocumentsModule, FeatureLaunchModule],
  controllers: [CrmCustomerController, CrmLeadController, CrmOpportunityController, CrmFollowUpController, CrmAiController, CrmBookingController],
  providers: [
    PrismaCrmRepository,
    PrismaCrmBookingProposalRepository,
    // Customer + contact
    CreateCrmCustomerUseCase,
    UpdateCrmCustomerUseCase,
    GetCrmCustomerUseCase,
    ListCrmCustomersUseCase,
    GetCrmCustomerSummaryUseCase,
    ArchiveCrmCustomerUseCase,
    AssignCrmCustomerUseCase,
    ListCrmContactsUseCase,
    CreateCrmContactUseCase,
    UpdateCrmContactUseCase,
    PreviewCrmCustomerMergeUseCase,
    MergeCrmCustomersUseCase,
    LinkCrmCustomerLineIdentityUseCase,
    // Lead
    CreateCrmLeadUseCase,
    ListCrmLeadsUseCase,
    GetCrmLeadUseCase,
    UpdateCrmLeadUseCase,
    AssignCrmLeadUseCase,
    DisqualifyCrmLeadUseCase,
    ConvertCrmLeadUseCase,
    // Opportunity + pipeline + activity
    ListCrmPipelineStagesUseCase,
    UpdateCrmPipelineStagesUseCase,
    CreateCrmOpportunityUseCase,
    ListCrmOpportunitiesUseCase,
    GetCrmOpportunityUseCase,
    GetCrmPipelineBoardUseCase,
    UpdateCrmOpportunityUseCase,
    MoveCrmOpportunityStageUseCase,
    CloseCrmOpportunityUseCase,
    ReopenCrmOpportunityUseCase,
    ListCrmActivitiesUseCase,
    CreateCrmActivityUseCase,
    // Follow-up
    ListCrmFollowUpsUseCase,
    CreateCrmFollowUpUseCase,
    UpdateCrmFollowUpUseCase,
    CompleteCrmFollowUpUseCase,
    SnoozeCrmFollowUpUseCase,
    CancelCrmFollowUpUseCase,
    // Quotation link
    ListCrmQuotationLinksUseCase,
    CreateCrmQuotationDraftUseCase,
    RefreshCrmQuotationLinkUseCase,
    // AI / dashboard read
    GetCrmFollowUpPrioritiesUseCase,
    GetCrmCustomerAiSummaryUseCase,
    GetCrmOpportunityAiSummaryUseCase,
    GetCrmPipelineAiSummaryUseCase,
    GetCrmDashboardSummaryUseCase,
    // มั่งมี Flow A bookings
    GetCrmBookingSettingsUseCase,
    UpdateCrmBookingSettingsUseCase,
    ListCrmBookingsUseCase,
    ListCrmCustomerBookingsUseCase,
    CreateCrmBookingUseCase,
    CreateAutonomousCrmBookingUseCase,
    UpdateCrmBookingUseCase,
    CancelCrmBookingUseCase,
  ],
  exports: [
    PrismaCrmRepository,
    PrismaCrmBookingProposalRepository,
    GetCrmCustomerUseCase,
    ListCrmCustomersUseCase,
    GetCrmCustomerSummaryUseCase,
    CreateCrmFollowUpUseCase,
    GetCrmDashboardSummaryUseCase,
    // Item 15A Customer 360 aggregates read through these permission-checked use cases.
    ListCrmOpportunitiesUseCase,
    GetCrmPipelineBoardUseCase,
    ListCrmFollowUpsUseCase,
    ListCrmBookingsUseCase,
    ListCrmActivitiesUseCase,
    ListCrmQuotationLinksUseCase,
    // A3 create-from-conversation reuses these item-15 create flows (permission-checked inside).
    CreateCrmOpportunityUseCase,
    CreateCrmQuotationDraftUseCase,
    CreateAutonomousCrmBookingUseCase,
  ],
})
export class CrmModule {}
