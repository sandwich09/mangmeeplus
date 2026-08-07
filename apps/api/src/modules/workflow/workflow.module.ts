import { Module } from '@nestjs/common';
import { LoggerModule } from '../../common/logger/logger.module';
import { FeatureLaunchModule } from '../feature-launch/feature-launch.module';
import { AuditModule } from '../audit/audit.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { DashboardNotificationsModule } from '../dashboard-notifications/dashboard-notifications.module';
import { ReimbursementsModule } from '../reimbursements/reimbursements.module';
import { CrmModule } from '../crm/crm.module';
import { BankingModule } from '../banking/banking.module';
import { TaxModule } from '../tax/tax.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AiDraftModule } from '../ai-draft/ai-draft.module';
import { PrismaWorkflowRepository } from './infrastructure/prisma-workflow.repository';
import { ListWorkflowTemplatesUseCase, EnableWorkflowTemplateUseCase } from './application/use-cases/workflow-template.use-case';
import {
  CreateWorkflowRuleUseCase,
  ListWorkflowRulesUseCase,
  GetWorkflowRuleUseCase,
  UpdateWorkflowRuleUseCase,
  EnableWorkflowRuleUseCase,
  DisableWorkflowRuleUseCase,
  TestWorkflowRuleUseCase,
} from './application/use-cases/workflow-rule.use-case';
import {
  ListWorkflowRunsUseCase,
  GetWorkflowRunDetailUseCase,
  GetWorkflowExplanationUseCase,
  ReplayWorkflowActionRunUseCase,
} from './application/use-cases/workflow-run.use-case';
import {
  ListWorkflowTasksUseCase,
  SnoozeWorkflowTaskUseCase,
  CompleteWorkflowTaskUseCase,
  CancelWorkflowTaskUseCase,
} from './application/use-cases/workflow-task.use-case';
import {
  ListWorkflowDeadLettersUseCase,
  ReplayWorkflowDeadLetterUseCase,
  IgnoreWorkflowDeadLetterUseCase,
} from './application/use-cases/workflow-dead-letter.use-case';
import {
  ListWorkflowWebhookEndpointsUseCase,
  CreateWorkflowWebhookEndpointUseCase,
  SetWorkflowWebhookEndpointStatusUseCase,
} from './application/use-cases/workflow-webhook.use-case';
import { ExecuteWorkflowActionUseCase } from './application/use-cases/workflow-action-runner.use-case';
import { RunWorkflowRuleUseCase } from './application/use-cases/workflow-runner.use-case';
import { IngestWorkflowEventUseCase } from './application/use-cases/workflow-event-ingest.use-case';
import { DrainWorkflowOutboxUseCase } from './application/use-cases/workflow-outbox-drain.use-case';
import { WorkflowScanCandidatesProvider } from './application/use-cases/workflow-scan-candidates.use-case';
import { RunWorkflowScanUseCase } from './application/use-cases/workflow-scan.use-case';
import { RetryDueWorkflowActionsUseCase } from './application/use-cases/workflow-retry.use-case';
import { GetCitCalendarUseCase } from '../tax/application/use-cases/get-cit-calendar.use-case';
import { WorkflowTemplateController } from './presentation/http/workflow-template.controller';
import { WorkflowRuleController } from './presentation/http/workflow-rule.controller';
import { WorkflowRunController } from './presentation/http/workflow-run.controller';
import { WorkflowTaskController } from './presentation/http/workflow-task.controller';
import { WorkflowDeadLetterController } from './presentation/http/workflow-dead-letter.controller';
import { WorkflowWebhookController } from './presentation/http/workflow-webhook.controller';
import { WorkflowInternalController } from './presentation/http/workflow-internal.controller';

@Module({
  imports: [
    AuditModule,
    DataModelCoreModule,
    DashboardNotificationsModule,
    ReimbursementsModule,
    CrmModule,
    BankingModule,
    TaxModule,
    InventoryModule,
    AiDraftModule,
    // The outbox drain records its shadow would_block counter and its DEAD-row observability line.
    FeatureLaunchModule,
    LoggerModule,
  ],
  controllers: [
    WorkflowTemplateController,
    WorkflowRuleController,
    WorkflowRunController,
    WorkflowTaskController,
    WorkflowDeadLetterController,
    WorkflowWebhookController,
    WorkflowInternalController,
  ],
  providers: [
    PrismaWorkflowRepository,
    ListWorkflowTemplatesUseCase,
    EnableWorkflowTemplateUseCase,
    CreateWorkflowRuleUseCase,
    ListWorkflowRulesUseCase,
    GetWorkflowRuleUseCase,
    UpdateWorkflowRuleUseCase,
    EnableWorkflowRuleUseCase,
    DisableWorkflowRuleUseCase,
    TestWorkflowRuleUseCase,
    ListWorkflowRunsUseCase,
    GetWorkflowRunDetailUseCase,
    GetWorkflowExplanationUseCase,
    ReplayWorkflowActionRunUseCase,
    ListWorkflowTasksUseCase,
    SnoozeWorkflowTaskUseCase,
    CompleteWorkflowTaskUseCase,
    CancelWorkflowTaskUseCase,
    ListWorkflowDeadLettersUseCase,
    ReplayWorkflowDeadLetterUseCase,
    IgnoreWorkflowDeadLetterUseCase,
    ListWorkflowWebhookEndpointsUseCase,
    CreateWorkflowWebhookEndpointUseCase,
    SetWorkflowWebhookEndpointStatusUseCase,
    ExecuteWorkflowActionUseCase,
    RunWorkflowRuleUseCase,
    IngestWorkflowEventUseCase,
    DrainWorkflowOutboxUseCase,
    WorkflowScanCandidatesProvider,
    RunWorkflowScanUseCase,
    RetryDueWorkflowActionsUseCase,
    GetCitCalendarUseCase,
  ],
  exports: [
    PrismaWorkflowRepository,
    GetWorkflowExplanationUseCase,
    ListWorkflowTasksUseCase,
    ListWorkflowRunsUseCase,
    ListWorkflowRulesUseCase,
    ListWorkflowDeadLettersUseCase,
  ],
})
export class WorkflowModule {}
