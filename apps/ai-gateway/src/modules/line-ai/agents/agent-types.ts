/**
 * Shared agent types for item 10B local orchestration.
 * No NestJS, HTTP, or DB imports.
 */
import type { ErpToolContext } from '../infrastructure/erp-tool.client';
import type { AgentIntentPlan, SpecialistOutput, LineAiWebLink, LineAiCoverageItem, LineAiAnswerPresentation, SourceRef } from '@watchdog-bms/contracts';

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
