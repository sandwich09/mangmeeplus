/**
 * Workflow Automation Job Definitions (Item 16)
 * Defines job types for BullMQ queues. No framework dependencies.
 */

export type WorkflowJobKind = 'outbox.drain' | 'scan.threshold' | 'scan.sla' | 'scan.schedule' | 'action.retry';

export type WorkflowJobPayload = { kind: WorkflowJobKind };

export const WORKFLOW_QUEUE = 'workflow';

export function computeNextAttemptAt(attemptCount: number): Date {
  const backoffMs = Math.min(Math.pow(2, attemptCount) * 30_000, 3_600_000);
  return new Date(Date.now() + backoffMs);
}
