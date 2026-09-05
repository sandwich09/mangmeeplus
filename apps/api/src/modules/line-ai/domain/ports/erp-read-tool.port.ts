/**
 * ERP read tool port – implemented by each source module adapter.
 * AI Gateway invokes these through the internal HTTP API.
 * All adapters must re-check permissions and ABAC server-side.
 */
import type { ToolResult } from '@watchdog-bms/contracts';

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
};

export interface ErpReadToolPort<TInput = Record<string, unknown>> {
  toolName: string;
  execute(ctx: ErpToolContext, input: TInput): Promise<ToolResult>;
}

export const ERP_READ_TOOL_REGISTRY = 'ERP_READ_TOOL_REGISTRY';
