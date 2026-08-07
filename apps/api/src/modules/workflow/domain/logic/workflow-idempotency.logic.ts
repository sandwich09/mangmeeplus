import type { WorkflowActionDefinition, WorkflowConditionNode, WorkflowTriggerType } from '@watchdog-bms/contracts';

// Unique per (companyId, ruleVersionId, dedupKey) — see WorkflowRun unique constraint.
// EVENT triggers reuse the source event's own dedupKey so replays of the same source
// event never create a second run for the same rule version. Scan-style triggers key
// on a period bucket so a scan cannot double-fire within the same bucket.
export function buildRunDedupKey(input: {
  triggerType: WorkflowTriggerType;
  eventDedupKey?: string;
  sourceType?: string;
  sourceId?: string;
  periodKey?: string;
  manualSeed?: string;
}): string {
  switch (input.triggerType) {
    case 'EVENT':
      if (!input.eventDedupKey) throw new Error('EVENT trigger requires eventDedupKey');
      return `event:${input.eventDedupKey}`;
    case 'SCHEDULE':
      return `schedule:${input.periodKey ?? 'unknown'}`;
    case 'THRESHOLD_SCAN':
    case 'SLA_SCAN':
      return `scan:${input.periodKey ?? 'unknown'}:${input.sourceType ?? ''}:${input.sourceId ?? ''}`;
    case 'MANUAL_TEST':
      return `manual-test:${input.manualSeed ?? Math.random().toString(36).slice(2)}`;
    case 'MANUAL_REPLAY':
      return `manual-replay:${input.manualSeed ?? ''}`;
    default:
      return `unknown:${input.manualSeed ?? ''}`;
  }
}

// Unique per (companyId, actionType, idempotencyKey). Deliberately excludes attemptCount
// so retries and dead-letter replays of the SAME action run reuse the SAME key and cannot
// double-execute a side effect (e.g. a second notification or webhook call).
export function buildActionIdempotencyKey(workflowRunId: string, actionKey: string): string {
  return `${workflowRunId}:${actionKey}`;
}

export function isRuleInCooldown(lastRunAt: Date | undefined, cooldownSeconds: number, now: Date): boolean {
  if (!lastRunAt || cooldownSeconds <= 0) return false;
  return now.getTime() - lastRunAt.getTime() < cooldownSeconds * 1000;
}

export function computeNextAttemptAt(attemptCount: number, now: Date): Date {
  const baseMs = 30_000;
  const maxMs = 30 * 60_000;
  const backoffMs = Math.min(Math.pow(2, attemptCount) * baseMs, maxMs);
  const jitterMs = Math.floor(Math.random() * 1000);
  return new Date(now.getTime() + backoffMs + jitterMs);
}

export function isRetryExhausted(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}

export type WorkflowRuleVersionSnapshot = {
  triggerSnapshotJson: Record<string, unknown>;
  conditionSnapshotJson: WorkflowConditionNode;
  actionSnapshotJson: WorkflowActionDefinition[];
  recipientSnapshotJson: Record<string, unknown>;
  cooldownSeconds: number;
};

// Deep-clones via JSON round-trip so the version snapshot is immutable and cannot be
// affected by later edits to the mutable WorkflowRule row.
export function buildRuleVersionSnapshot(rule: {
  triggerConfigJson: Record<string, unknown>;
  conditionJson: WorkflowConditionNode;
  actionJson: WorkflowActionDefinition[];
  recipientConfigJson: Record<string, unknown>;
  cooldownSeconds: number;
}): WorkflowRuleVersionSnapshot {
  return {
    triggerSnapshotJson: JSON.parse(JSON.stringify(rule.triggerConfigJson ?? {})),
    conditionSnapshotJson: JSON.parse(JSON.stringify(rule.conditionJson)),
    actionSnapshotJson: JSON.parse(JSON.stringify(rule.actionJson)),
    recipientSnapshotJson: JSON.parse(JSON.stringify(rule.recipientConfigJson ?? {})),
    cooldownSeconds: rule.cooldownSeconds,
  };
}
