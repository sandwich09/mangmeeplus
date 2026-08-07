/**
 * Domain models for Workflow Automation (Item 16).
 * Plain TypeScript types — no Prisma, no NestJS imports.
 */

import type {
  WorkflowTriggerType,
  WorkflowConditionNode,
  WorkflowActionDefinition,
  WorkflowTemplateStatus,
  WorkflowRuleStatus,
  WorkflowRunStatus,
  WorkflowActionRunStatus,
  WorkflowTaskPriority,
  WorkflowTaskStatus,
  WorkflowDeadLetterResolutionStatus,
  WorkflowWebhookStatus,
  WorkflowEventInboxStatus,
  WorkflowConditionEvalResult,
} from '@watchdog-bms/contracts';

export type WorkflowTemplateRecord = {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  sourceModule: string;
  triggerType: WorkflowTriggerType;
  defaultConditionJson: WorkflowConditionNode;
  defaultActionJson: WorkflowActionDefinition[];
  requiredPermissions: string[];
  requiredSourceModules: string[];
  defaultEnabled: boolean;
  status: WorkflowTemplateStatus;
  unavailableReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowRuleRecord = {
  id: string;
  companyId: string;
  templateId?: string;
  name: string;
  description?: string;
  status: WorkflowRuleStatus;
  triggerType: WorkflowTriggerType;
  triggerConfigJson: Record<string, unknown>;
  conditionJson: WorkflowConditionNode;
  actionJson: WorkflowActionDefinition[];
  recipientConfigJson: Record<string, unknown>;
  cooldownSeconds: number;
  timezone: string;
  createdBy: string;
  updatedBy?: string;
  enabledBy?: string;
  enabledAt?: Date;
  disabledBy?: string;
  disabledAt?: Date;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  template?: { key: string; sourceModule: string };
  lastRunAt?: Date;
  lastRunStatus?: WorkflowRunStatus;
};

export type WorkflowRuleVersionRecord = {
  id: string;
  ruleId: string;
  companyId: string;
  version: number;
  status: WorkflowRuleStatus;
  triggerSnapshotJson: Record<string, unknown>;
  conditionSnapshotJson: WorkflowConditionNode;
  actionSnapshotJson: WorkflowActionDefinition[];
  recipientSnapshotJson: Record<string, unknown>;
  cooldownSeconds: number;
  createdBy: string;
  createdAt: Date;
};

export type WorkflowEventInboxRecord = {
  id: string;
  companyId: string;
  eventId: string;
  eventType: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  sourceVersion?: string;
  payloadJson: Record<string, unknown>;
  dedupKey: string;
  status: WorkflowEventInboxStatus;
  receivedAt: Date;
  processedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
};

export type WorkflowRunRecord = {
  id: string;
  companyId: string;
  ruleId: string;
  ruleVersionId: string;
  triggerType: WorkflowTriggerType;
  triggerEventId?: string;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  dedupKey: string;
  triggerPayloadJson: Record<string, unknown>;
  conditionResultJson: WorkflowConditionEvalResult;
  status: WorkflowRunStatus;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  rule?: { name: string };
  ruleVersion?: WorkflowRuleVersionRecord;
  actionRuns?: WorkflowActionRunRecord[];
};

export type WorkflowActionRunRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  actionKey: string;
  actionType: string;
  actionConfigSnapshotJson: Record<string, unknown>;
  status: WorkflowActionRunStatus;
  idempotencyKey: string;
  targetType?: string;
  targetId?: string;
  attemptCount: number;
  nextAttemptAt?: Date;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  resultJson?: Record<string, unknown>;
  startedAt?: Date;
  finishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowTaskRecord = {
  id: string;
  companyId: string;
  workflowRunId?: string;
  workflowActionRunId?: string;
  sourceModule?: string;
  sourceType?: string;
  sourceId?: string;
  title: string;
  description?: string;
  assigneeUserId?: string;
  assigneeRole?: string;
  priority: WorkflowTaskPriority;
  status: WorkflowTaskStatus;
  dueAt?: Date;
  snoozedUntil?: Date;
  completedBy?: string;
  completedAt?: Date;
  cancelReason?: string;
  webDeepLink?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkflowDeadLetterRecord = {
  id: string;
  companyId: string;
  workflowRunId: string;
  workflowActionRunId: string;
  errorCode?: string;
  errorMessage?: string;
  errorDetailsJson?: Record<string, unknown>;
  resolutionStatus: WorkflowDeadLetterResolutionStatus;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolutionNote?: string;
  createdAt: Date;
};

export type WorkflowWebhookEndpointRecord = {
  id: string;
  companyId: string;
  name: string;
  url: string;
  status: WorkflowWebhookStatus;
  secretRef: string;
  allowedEventTypes: string[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};
