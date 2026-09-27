/** AgentCore Runtime invoke port – spec section 9.2. */
import type { AgentToolCall, AiModelPolicy, AiUsageEntry, LineAiAnswerPresentation, LineAiConversationContext, LineAiExpectedRuntimeIdentity, LineAiPreparedPlan, LineAiRefusalReason, LineAiRuntimeBinding, LineAiRuntimeIdentity, LineAiSemanticCoverageV2, LineAiStageDurations, LineAiTaskProjectionV2, LineAiResponsePreferences, LineAiTurnRequest, LineAiWebLink, LineIntakeRouteIntent, SourceRef } from '@watchdog-bms/contracts';

export type AgentCoreInvokeInput = {
  turnId: string;
  companyId: string;
  userId: string;
  membershipId?: string;
  chatKeyHash?: string;
  branchIds?: string[];
  locationIds?: string[];
  roles?: string[];
  messageText: string;
  locale: string;
  permissions: string[];
  entitlementDeniedPermissions?: Record<string, string>;
  /** Company feature entitlements; absent or `null` = legacy fail-open (see LineAiTurnRequest). */
  entitledFeatureKeys?: string[] | null;
  actorDelegations?: Record<string, string[]>;
  modelPolicy?: AiModelPolicy;
  qualifier?: string;
  attachments?: ReadonlyArray<{ attachmentId: string; mimeType: string; kind: string; sha256: string }>;
  conversationContext?: LineAiConversationContext;
  inputEvidence?: LineAiTurnRequest['inputEvidence'];
  contractCapabilities?: LineAiTurnRequest['contractCapabilities'];
  budgetGrantV2?: LineAiTurnRequest['budgetGrantV2'];
  approvedKnowledge?: LineAiTurnRequest['approvedKnowledge'];
  selectedKnowledgeCardIds?: LineAiTurnRequest['selectedKnowledgeCardIds'];
  taskProjection?: LineAiTaskProjectionV2;
  responsePreferences?: LineAiResponsePreferences;
  semanticSubrequests?: LineAiTurnRequest['semanticSubrequests'];
  retainedTaskSource?: LineAiTurnRequest['retainedTaskSource'];
  valueCandidates?: LineAiTurnRequest['valueCandidates'];
  /** Optional additive fused plan (latency/autonomy §7). Already bounded by the caller's
   *  `parseLineAiPreparedPlan`; the runtime re-parses it again before any consumption. */
  preparedPlan?: LineAiPreparedPlan;
  /** Trusted outer intake provenance; the runtime re-validates it by explicit membership. */
  intakeIntent?: LineIntakeRouteIntent;
  /** Internal zero-model config probe used by the authenticated Gateway capability endpoint. */
  lineDraftEditCapabilityProbe?: true;
  /** Internal zero-model contract/usage probe; no provider or private record access occurs. */
  lineBudgetV2CapabilityProbe?: true;
};

export type AgentCoreInvokeResult = {
  turnId: string;
  replyText: string;
  plan: { status: 'ROUTABLE' | 'PARTIAL' | 'UNROUTABLE'; intents: unknown[] };
  durationMs: number;
  refused: boolean;
  sourceRefs: SourceRef[];
  webLinks: LineAiWebLink[];
  presentation?: LineAiAnswerPresentation;
  deterministicExpenseSummary?: boolean;
  deterministicExpenseCriterionConfirmation?: boolean;
  semanticCoverage?: LineAiSemanticCoverageV2[];
  toolsInvoked: Array<AgentToolCall & { sourceRefs?: SourceRef[] }>;
  /** Model calls the artifact made; absent from an artifact built before usage reporting. */
  usage?: AiUsageEntry[];
  refusalReason?: LineAiRefusalReason;
  errorCode?: string;
  runtimeIdentity?: LineAiRuntimeIdentity;
  expectedRuntimeIdentity?: LineAiExpectedRuntimeIdentity;
  runtimeBinding?: LineAiRuntimeBinding;
  stageDurationsMs?: LineAiStageDurations;
  modelCallCount?: number;
  /** Present only on a capability probe response. */
  lineDraftEditEnabled?: boolean;
  /** Present only on a budget v2 capability probe response. */
  lineBudgetV2Capability?: {
    supported: boolean;
    inputContractVersion: 2;
    providerOutputVersion: 2;
    budgetContractVersion: 2;
    profileTableDigest: string;
    estimatorVersion: string;
  };
};

export interface IAgentCoreRuntime {
  invoke(input: AgentCoreInvokeInput): Promise<AgentCoreInvokeResult>;
}
