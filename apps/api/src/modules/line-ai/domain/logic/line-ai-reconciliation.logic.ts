import { createHash } from 'node:crypto';
import {
  LINE_AI_TERMINAL_CLASSES,
  classifyLineAiTerminalOutcome,
  type LineAiTerminalClass,
} from './line-ai-terminal-outcome.logic';

export type LineAiReconciliationRow = {
  webhookEventId: string;
  status: string;
  errorCode?: string | null;
  payloadPresent: boolean;
};

export type LineAiReconciliationReport = {
  acceptedInboundCount: number;
  terminalOutcomeCount: number;
  reconciliationDelta: number;
  outcomeCounts: Record<LineAiTerminalClass, number>;
  violations: {
    duplicateEventRefs: string[];
    unreconciledEventRefs: string[];
    terminalPayloadRefs: string[];
    unexplainedFailedTerminalRefs: string[];
  };
  reconciled: boolean;
};

function eventRef(webhookEventId: string): string {
  return createHash('sha256').update(webhookEventId).digest('hex').slice(0, 16);
}

/** Reconciles the persisted final snapshot, not transition metrics. A delivery-pending row is an
 * explicit operational outcome and may retain its replay payload; every other terminal row must
 * have released it. Raw provider ids never enter the report. */
export function buildLineAiReconciliationReport(
  rows: LineAiReconciliationRow[],
): LineAiReconciliationReport {
  const outcomeCounts = Object.fromEntries(
    LINE_AI_TERMINAL_CLASSES.map((terminalClass) => [terminalClass, 0]),
  ) as Record<LineAiTerminalClass, number>;
  const seen = new Set<string>();
  const violations = {
    duplicateEventRefs: [] as string[],
    unreconciledEventRefs: [] as string[],
    terminalPayloadRefs: [] as string[],
    unexplainedFailedTerminalRefs: [] as string[],
  };
  let terminalOutcomeCount = 0;

  for (const row of rows) {
    const ref = eventRef(row.webhookEventId);
    if (seen.has(row.webhookEventId)) violations.duplicateEventRefs.push(ref);
    else seen.add(row.webhookEventId);

    const terminalClass = classifyLineAiTerminalOutcome(row.status, row.errorCode);
    if (!terminalClass) {
      violations.unreconciledEventRefs.push(ref);
      continue;
    }
    terminalOutcomeCount += 1;
    outcomeCounts[terminalClass] += 1;
    if (row.payloadPresent && terminalClass !== 'delivery_pending') {
      violations.terminalPayloadRefs.push(ref);
    }
    if (terminalClass === 'failed_terminal' && !row.errorCode) {
      violations.unexplainedFailedTerminalRefs.push(ref);
    }
  }

  const reconciliationDelta = rows.length - terminalOutcomeCount;
  const reconciled = reconciliationDelta === 0
    && Object.values(violations).every((items) => items.length === 0);
  return {
    acceptedInboundCount: rows.length,
    terminalOutcomeCount,
    reconciliationDelta,
    outcomeCounts,
    violations,
    reconciled,
  };
}
