import type { WorkflowActionType, WorkflowConditionOperator, WorkflowConditionGroupType } from '@watchdog-bms/contracts';

export const WORKFLOW_TRIGGER_TYPES = ['EVENT', 'SCHEDULE', 'THRESHOLD_SCAN', 'SLA_SCAN', 'MANUAL_TEST', 'MANUAL_REPLAY'] as const;

export const WORKFLOW_CONDITION_GROUP_TYPES: WorkflowConditionGroupType[] = ['ALL', 'ANY', 'NOT'];

export const WORKFLOW_CONDITION_OPERATORS: WorkflowConditionOperator[] = [
  'EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE',
  'IN', 'NOT_IN', 'EXISTS', 'MISSING',
  'CONTAINS', 'STARTS_WITH', 'OLDER_THAN', 'WITHIN_NEXT', 'BETWEEN',
];

// Unsafe final actions (money/stock/tax/accounting/permission/export/publishing mutation)
// are intentionally absent from this list. Any actionType outside this list is rejected.
export const WORKFLOW_ALLOWED_ACTION_TYPES: WorkflowActionType[] = [
  'SEND_NOTIFICATION',
  'CREATE_WORKFLOW_TASK',
  'CREATE_APPROVAL_REVIEW_REQUEST',
  'REQUEST_AI_DRAFT',
  'CREATE_REPORT_EXPORT_DRAFT',
  'CALL_WEBHOOK',
  'ADD_AUDIT_NOTE',
  'NOOP_DISABLED_TEMPLATE',
];

export const WORKFLOW_DEFAULT_COOLDOWN_SECONDS = 3600;
export const WORKFLOW_DEFAULT_TIMEZONE = 'Asia/Bangkok';
export const WORKFLOW_MAX_RETRY_ATTEMPTS = 3;
export const WORKFLOW_RETRY_BASE_DELAY_MS = 30_000;
export const WORKFLOW_RETRY_MAX_DELAY_MS = 30 * 60_000;
