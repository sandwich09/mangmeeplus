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
};

export interface ErpReadToolPort<TInput = Record<string, unknown>> {
  toolName: string;
  execute(ctx: ErpToolContext, input: TInput): Promise<ToolResult>;
}

export const ERP_READ_TOOL_REGISTRY = 'ERP_READ_TOOL_REGISTRY';
