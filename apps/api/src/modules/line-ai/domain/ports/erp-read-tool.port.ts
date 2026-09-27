/**
 * ERP read tool port – implemented by each source module adapter.
 * AI Gateway invokes these through the internal HTTP API.
 * All adapters must re-check permissions and ABAC server-side.
 */
import type { AiBudgetGrantV2, LineAiInputEvidenceV2, LineAiValueCandidatesV2, ToolResult } from '@watchdog-bms/contracts';

export type ErpToolContext = {
  requestId?: string;
  companyId: string;
  userId: string;
  membershipId?: string;
  roles?: string[];
  permissions: string[];
  branchIds?: string[];
  locationIds?: string[];
  locale: string;
  /** Chat provenance for tools that resolve "the record this chat just captured" (spec §5.5).
   *  DATA only — it can never widen company, permission or branch scope, all of which are
   *  re-resolved from the verified actor delegation. Absent for a non-LINE caller. */
  chatKeyHash?: string;
  /** The message this turn is answering, forwarded verbatim by the API that received it, bounded
   *  at the transport. Used by exactly one thing: the S-4 value-grounding guard (spec §5.4), which
   *  needs to prove that a number a draft edit would write was actually said. It is never stored,
   *  never logged, and grants nothing — with it absent, only numbers already on the record ground. */
  groundingText?: string;
  inputEvidence?: LineAiInputEvidenceV2;
  valueCandidatesV2?: LineAiValueCandidatesV2;
  budgetGrantV2?: AiBudgetGrantV2;
};

export interface ErpReadToolPort<TInput = Record<string, unknown>> {
  toolName: string;
  execute(ctx: ErpToolContext, input: TInput): Promise<ToolResult>;
}

export const ERP_READ_TOOL_REGISTRY = 'ERP_READ_TOOL_REGISTRY';
