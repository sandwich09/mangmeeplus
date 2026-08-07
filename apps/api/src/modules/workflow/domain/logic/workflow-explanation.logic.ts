import type { WorkflowActionDefinition, WorkflowActionRunStatus, WorkflowConditionEvalResult, WorkflowTriggerType } from '@watchdog-bms/contracts';

const TRIGGER_LABEL: Record<WorkflowTriggerType, string> = {
  EVENT: 'a source event',
  SCHEDULE: 'a schedule',
  THRESHOLD_SCAN: 'a threshold scan',
  SLA_SCAN: 'an SLA scan',
  MANUAL_TEST: 'a manual test',
  MANUAL_REPLAY: 'a manual replay',
};

export function summarizeTrigger(triggerType: WorkflowTriggerType, sourceModule?: string, sourceType?: string): string {
  const base = `Fired by ${TRIGGER_LABEL[triggerType] ?? triggerType}`;
  if (sourceModule && sourceType) return `${base} (${sourceModule}.${sourceType})`;
  return base;
}

export function summarizeCondition(result: WorkflowConditionEvalResult): string {
  if (result.matched) return 'Conditions matched.';
  if (result.errors && result.errors.length > 0) return `Conditions did not match: ${result.errors.join('; ')}`;
  return 'Conditions did not match.';
}

const ACTION_LABEL: Record<string, string> = {
  SEND_NOTIFICATION: 'Sent a notification',
  CREATE_WORKFLOW_TASK: 'Created a workflow task',
  CREATE_APPROVAL_REVIEW_REQUEST: 'Created an approval-review task',
  REQUEST_AI_DRAFT: 'Requested an AI draft',
  CREATE_REPORT_EXPORT_DRAFT: 'Requested a report export draft',
  CALL_WEBHOOK: 'Called a webhook',
  ADD_AUDIT_NOTE: 'Added an audit note',
  NOOP_DISABLED_TEMPLATE: 'Skipped (template disabled)',
};

const ACTION_STATUS_LABEL: Record<WorkflowActionRunStatus, string> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED_RETRYABLE: 'failed, will retry',
  FAILED_FINAL: 'failed',
  DEAD_LETTERED: 'dead-lettered',
  SKIPPED: 'skipped',
  CANCELED: 'canceled',
};

export function summarizeAction(action: WorkflowActionDefinition, status: WorkflowActionRunStatus): string {
  const label = ACTION_LABEL[action.actionType] ?? action.actionType;
  return `${label} (${action.actionKey}) — ${ACTION_STATUS_LABEL[status] ?? status}`;
}

export function nextActionHint(status: string): string {
  switch (status) {
    case 'FAILED':
    case 'PARTIAL_FAILED':
      return 'Review the failed action run and dead letters, then replay if the source state allows it.';
    case 'SKIPPED':
      return 'No action required — conditions were not met or the source was unavailable.';
    case 'SUCCEEDED':
      return 'No action required — the run completed successfully.';
    default:
      return 'Run is in progress.';
  }
}
