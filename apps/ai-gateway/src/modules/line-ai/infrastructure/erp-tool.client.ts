/**
 * Client for calling ERP read tool adapters in the API.
 * AI Gateway never accesses DB directly; all data goes through ERP core.
 * Governed path: policy decision → audit record → execute.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AiGatewayConfigService } from '../../../common/config/ai-gateway-config.service';
import { ToolPolicyEnforcerService } from '../../../common/ai/tool-policy-enforcer.service';
import { parsePublicLookupRequest, publicLookupPolicy, publicQueryNeedsRephrase,
  LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES,
  type AiBudgetGrantV2, type LineAiInputEvidenceV2, type LineAiValueCandidatesV2,
  type ToolResult, type ToolMeta } from '@watchdog-bms/contracts';
import type { ToolPolicy } from '../../../common/ai/tool-policy.model';
import { currentBudgetGrantV2 } from '../../../common/usage/usage-context';

// ponytail: intentionally empty — every previously-stubbed tool now has an API endpoint.
// Kept so a future not-yet-wired tool can short-circuit to unsupported_module instead of HTTP 404.
const UNIMPLEMENTED_TOOLS = new Set<string>();

/** The bound both sides agree on. The API does NOT reject a longer value — it truncates at the
 *  same length (`internal-tools.controller.ts`, `GROUNDING_TEXT_MAX_CHARS`), deliberately, because
 *  a length rejection under `forbidNonWhitelisted` would 400 every ERP tool call of a turn whose
 *  LINE message happened to run long. The sender truncates too, so the wire carries what the
 *  receiver will keep and neither end depends on the other's mercy. */
export const GROUNDING_TEXT_MAX = 1000;

export type ErpToolContext = {
  requestId?: string;
  companyId: string;
  userId: string;
  membershipId?: string;
  permissions: string[];
  branchIds?: string[];
  locationIds?: string[];
  locale: string;
  /** Chat provenance forwarded verbatim from the API's own turn request (spec §5.5). It carries no
   *  authority — the ERP boundary re-resolves company, permissions and branch scope. */
  chatKeyHash?: string;
  /** S-4 value grounding (spec §5.4): the message this turn is answering, forwarded so the ERP
   *  boundary can refuse a draft edit whose number nobody said. Carries no authority, and is
   *  bounded at {@link GROUNDING_TEXT_MAX} before it is sent. */
  groundingText?: string;
  /** Complete turn evidence/candidates originate in the admitted request, never tool arguments. */
  inputEvidence?: LineAiInputEvidenceV2;
  valueCandidatesV2?: LineAiValueCandidatesV2;
  /** Type-level carrier for callers; egress always uses the request-scoped validated grant. */
  budgetGrantV2?: AiBudgetGrantV2;
  actorDelegations?: Record<string, string[]>;
  /** Process-local egress canaries; stripped before any API request. */
  privateLookupCanaries?: string[];
};

/** Derive ToolPolicy from ToolMeta for enforcer assertion. */
export function toolMetaToPolicy(tool: ToolMeta): ToolPolicy {
  // `draft_update` is deliberately NOT a mutation here (spec §5.4): those five tools only PREVIEW,
  // and the write they lead to happens on a LINE confirm postback that never passes through this
  // client. Gating them on AI_FINAL_MUTATION_ENABLED would claim this path can mutate — it cannot.
  // Their own switch is LINE_AI_DRAFT_EDIT_ENABLED, enforced by the router catalog, the tool loop
  // and (authoritatively) the API executor.
  const isMutation = tool.category === 'final_mutation' || tool.category === 'approval_request';
  return {
    toolName: tool.name,
    requiredPermission: tool.requiredPermissions[0] ?? tool.anyOfPermissions?.[0] ?? 'unknown',
    riskLevel: tool.sensitiveAudit ? 'high' : 'low',
    requiresConfirmation: false,
    requiresAudit: tool.sensitiveAudit,
    requiresErpCorePermissionCheck: tool.requiresErpPermissionCheck,
    allowedWhenFinalMutationDisabled: !isMutation,
  };
}

/** Normalize the untrusted ERP response before any specialist can inspect it. */
export function enforceSourceHonesty(tool: ToolMeta, value: unknown): ToolResult {
  const invalid = (): ToolResult => ({
    toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'INVALID_TOOL_RESULT',
  });
  if (!value || typeof value !== 'object') return invalid();
  const result = value as Partial<ToolResult>;
  if (!result.status || !['ok', 'forbidden', 'unsupported_module', 'unavailable', 'error'].includes(result.status)) return invalid();
  const asOf = typeof result.asOf === 'string' && result.asOf ? result.asOf : new Date().toISOString();

  // A non-success result never carries business data or entity references across the boundary.
  // Preserve its typed status so specialists can distinguish denied, unavailable, and failed.
  if (result.status !== 'ok') {
    return {
      toolName: tool.name,
      status: result.status,
      sourceRefs: [],
      asOf,
      ...(typeof result.errorCode === 'string' ? { errorCode: result.errorCode } : {}),
      ...(typeof result.errorMessage === 'string' ? { errorMessage: result.errorMessage } : {}),
    };
  }
  if (tool.name === 'public.lookup') {
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : undefined;
    const admission = data?.['approvedLookup'];
    const lookup = admission && typeof admission === 'object' && !Array.isArray(admission)
      ? admission as Record<string, unknown> : undefined;
    const request = parsePublicLookupRequest(lookup?.['request']);
    const policy = request && publicLookupPolicy(request);
    if (data?.['admissionOnly'] !== true || !request || !policy
      || canonicalJson(lookup?.['policy']) !== canonicalJson(policy)) {
      return invalid();
    }
    // Admission metadata is not a searched fact and intentionally has no source citation yet.
    return { toolName: tool.name, status: 'ok', data: { admissionOnly: true, approvedLookup: { request, policy } }, sourceRefs: [], asOf };
  }
  if (result.toolName !== tool.name) {
    return { toolName: tool.name, status: 'error', sourceRefs: [], asOf, errorCode: 'TOOL_RESULT_NAME_MISMATCH' };
  }
  if (result.data === undefined || result.data === null) {
    return { toolName: tool.name, status: 'error', sourceRefs: [], asOf, errorCode: 'TOOL_RESULT_NO_DATA' };
  }
  if (!Array.isArray(result.sourceRefs) || result.sourceRefs.length === 0) {
    return { toolName: tool.name, status: 'error', sourceRefs: [], asOf, errorCode: 'TOOL_RESULT_NO_SOURCE' };
  }
  if (result.sourceRefs.some((ref) => ref.module !== tool.sourceModule || ref.permissionChecked !== true)) {
    return { toolName: tool.name, status: 'error', sourceRefs: [], asOf, errorCode: 'TOOL_RESULT_SOURCE_MISMATCH' };
  }
  const reimbursementDraft = (LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES as readonly string[]).includes(tool.name);
  const actionSourceMismatch = reimbursementDraft
    ? result.sourceRefs.length !== 1 || result.sourceRefs.some(ref => ref.sourceType !== 'ACTION'
        || ref.entityType !== 'reimbursement_draft_action' || typeof ref.entityId !== 'string' || !ref.entityId)
    : result.sourceRefs.some(ref => ref.sourceType === 'ACTION');
  if (actionSourceMismatch) {
    return { toolName: tool.name, status: 'error', sourceRefs: [], asOf, errorCode: 'TOOL_RESULT_SOURCE_MISMATCH' };
  }
  return result as ToolResult;
}

@Injectable()
export class ErpToolClient {
  private readonly logger = new Logger(ErpToolClient.name);

  constructor(
    @Inject(AiGatewayConfigService) private readonly config: AiGatewayConfigService,
    @Inject(ToolPolicyEnforcerService) private readonly policyEnforcer: ToolPolicyEnforcerService,
  ) {}

  /**
   * Measures the whole invoke (fetch included) once, attaches it to every returned ToolResult, and
   * emits one correlatable `ai.tool.invoke.result` per call. Never logs tool input or delegations.
   */
  async invoke(tool: ToolMeta, ctx: ErpToolContext, input: Record<string, unknown> = {}): Promise<ToolResult> {
    const startedMs = Date.now();
    const result = await this.invokeInner(tool, ctx, input);
    const durationMs = Date.now() - startedMs;
    this.logger.log({
      msg: 'ai.tool.invoke.result',
      requestId: ctx.requestId,
      toolName: tool.name,
      status: result.status,
      durationMs,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    });
    return { ...result, durationMs };
  }

  private async invokeInner(tool: ToolMeta, ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    // Return typed unsupported_module for tools not yet backed by API endpoints
    if (UNIMPLEMENTED_TOOLS.has(tool.name)) {
      return {
        toolName: tool.name,
        status: 'unsupported_module',
        data: null,
        sourceRefs: [{ label: tool.name, module: tool.sourceModule, entityType: 'tool', permissionChecked: true }],
        asOf: new Date().toISOString(),
      };
    }

    if (tool.name === 'public.lookup') {
      const grant = currentBudgetGrantV2();
      const request = parsePublicLookupRequest(input);
      if (!this.config.lineAiPublicLookupEnabled || !grant || grant.model.provider !== 'openai'
        || !grant.allowedProfileIds.includes('public-lookup/2') || !request || !publicLookupPolicy(request)) {
        return { toolName: tool.name, status: 'unavailable', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'PUBLIC_POLICY_UNAVAILABLE' };
      }
      const canaries = [ctx.companyId, ctx.userId, ctx.membershipId, ctx.chatKeyHash,
        ...(ctx.branchIds ?? []), ...(ctx.locationIds ?? []), ...(ctx.privateLookupCanaries ?? [])]
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
      if (publicQueryNeedsRephrase(request.publicQuestion, canaries)) {
        return { toolName: tool.name, status: 'unavailable', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'PUBLIC_QUERY_REQUIRES_REPHRASE' };
      }
    }

    // Policy decision → audit record → execute
    const policy = toolMetaToPolicy(tool);
    try {
      this.policyEnforcer.assertToolCanExecute(policy);
      this.logger.log({ msg: 'ai.tool.policy.allow', requestId: ctx.requestId, toolName: tool.name, userId: ctx.userId, companyId: ctx.companyId });
    } catch (policyErr) {
      // L-14: a kill-switch/policy trip carries a root-level riskLevel so the existing production
      // metric filter ($.riskLevel = "HIGH") sees it without any infrastructure change.
      this.logger.warn({ msg: 'ai.tool.policy.deny', riskLevel: 'HIGH', requestId: ctx.requestId, toolName: tool.name, userId: ctx.userId, companyId: ctx.companyId, reason: (policyErr as Error).message });
      return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'POLICY_DENIED' };
    }

    if (tool.requiredInputFields) {
      const missing = tool.requiredInputFields.filter((f) => !(f in input));
      if (missing.length > 0) {
        return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'MISSING_REQUIRED_INPUT', errorMessage: `Missing fields: ${missing.join(', ')}` };
      }
    }

    const url = `${this.config.erpCoreInternalUrl}/internal/ai/tools/invoke`;
    const secret = this.config.aiGatewayInternalSecret;
    if (!secret) {
      return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'INTERNAL_SECRET_NOT_CONFIGURED' };
    }
    const actorDelegation = ctx.actorDelegations?.[tool.name]?.shift();
    if (!actorDelegation) {
      return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'ACTOR_DELEGATION_MISSING' };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Secret in header, not logged
      'X-Internal-Secret': secret,
      'X-Actor-Delegation': actorDelegation,
    };

    const budgetGrantV2 = currentBudgetGrantV2();
    const body = JSON.stringify({
      toolName: tool.name,
      // Explicit allowlist: runtime-only fields (including semantic inventory and delegations) can
      // never leak into the API DTO through object spread. The three v2 fields originate on the
      // admitted turn; the signed grant is replaced with the request-scoped validated copy.
      context: {
        requestId: ctx.requestId, companyId: ctx.companyId, userId: ctx.userId,
        membershipId: ctx.membershipId, permissions: ctx.permissions, branchIds: ctx.branchIds,
        locationIds: ctx.locationIds, locale: ctx.locale, chatKeyHash: ctx.chatKeyHash,
        ...(ctx.groundingText !== undefined ? { groundingText: ctx.groundingText.slice(0, GROUNDING_TEXT_MAX) } : {}),
        ...(ctx.inputEvidence ? { inputEvidence: ctx.inputEvidence } : {}),
        ...(ctx.valueCandidatesV2 ? { valueCandidatesV2: ctx.valueCandidatesV2 } : {}),
        ...(budgetGrantV2 ? { budgetGrantV2 } : {}),
      },
      input,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(this.config.aiToolTimeoutMs),
      });
    } catch (err) {
      // Fetch/abort messages carry no URL query or headers, so no delegation material can ride along.
      this.logger.error({ msg: 'ai.tool.invoke.error', requestId: ctx.requestId, toolName: tool.name, error: (err as Error).message });
      return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'TOOL_TIMEOUT' };
    }

    if (!response.ok) {
      return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: `HTTP_${response.status}` };
    }

    let result: unknown;
    try {
      result = await response.json();
    } catch {
      return { toolName: tool.name, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'INVALID_TOOL_RESULT' };
    }
    const guarded = enforceSourceHonesty(tool, result);
    if (guarded.status === 'error' && guarded.errorCode?.startsWith('TOOL_RESULT_')) {
      this.logger.warn({ msg: 'ai.tool.source_honesty.rejected', requestId: ctx.requestId, toolName: tool.name, errorCode: guarded.errorCode });
    }
    return guarded;
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
