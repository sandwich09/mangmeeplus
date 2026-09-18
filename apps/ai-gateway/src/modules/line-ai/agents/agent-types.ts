/**
 * Shared agent types for item 10B local orchestration.
 * No NestJS, HTTP, or DB imports.
 */
import type { ErpToolContext } from '../infrastructure/erp-tool.client';
import type { AgentFact, AgentIntentPlan, SpecialistOutput, LineAiWebLink, LineAiCoverageItem, LineAiAnswerPresentation, SourceRef } from '@watchdog-bms/contracts';
import { formatThaiPeriodRange } from '@watchdog-bms/contracts';

// ponytail: AgentContext = ErpToolContext; requestId is already optional there
export type AgentContext = ErpToolContext;

export type AgentRunResult = {
  plan: AgentIntentPlan;
  outputs: SpecialistOutput[];
  replyText: string;
  sourceRefs: SourceRef[];
  webLinks: LineAiWebLink[];
  presentation?: LineAiAnswerPresentation;
  durationMs: number;
  /** Item 10F: critic verdicts per sub-request; present only on the native tool-loop path. */
  coverage?: LineAiCoverageItem[];
};

/**
 * Period-resolution spec §3.4: every answer that covers a period must SAY which period, and a period
 * the user named in words gets those words back plus its dates. The composer prints facts, so this is
 * how the agentic path states it — built from the window the TOOL echoed (never from the request), so
 * it can only ever name the period the numbers above it actually cover. `periodLabel` (resolved by
 * `resolvePeriodCandidates` from the user's own words) supplies the words when the turn had them;
 * without it the fact still states the dates, which is what the answer used to leave implicit.
 */
const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function periodFact(data: unknown, periodLabel?: string): AgentFact | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const row = data as Record<string, unknown>;
  const day = (value: unknown): string | undefined =>
    (typeof value === 'string' && CIVIL_DAY.test(value) ? value : undefined);
  const echoed = row['period'];
  const window = echoed && typeof echoed === 'object' && !Array.isArray(echoed)
    ? echoed as Record<string, unknown>
    : row;
  const from = day(window['fromDate']) ?? day(window['periodFrom']) ?? day(row['newCustomersSince']) ?? day(row['date']);
  const to = day(window['toDate']) ?? day(window['periodTo']) ?? day(row['newCustomersUntil']) ?? day(row['date']);
  const stated = from && to
    ? formatThaiPeriodRange(from, to)
    : typeof row['periodKey'] === 'string' && row['periodKey'].trim() ? `งวด ${row['periodKey']}` : undefined;
  if (!stated) return undefined;
  return { label: 'ช่วงข้อมูล', value: periodLabel && from && to ? periodLabel : stated };
}
