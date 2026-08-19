/** AgentCore Runtime invoke port – spec section 9.2. */
import type { AgentToolCall, AiModelPolicy, AiUsageEntry, LineAiAnswerPresentation, LineAiConversationContext, LineAiExpectedRuntimeIdentity, LineAiRefusalReason, LineAiRuntimeBinding, LineAiRuntimeIdentity, LineAiStageDurations, LineAiWebLink, SourceRef } from '@watchdog-bms/contracts';

export type AgentCoreInvokeInput = {
  turnId: string;
  companyId: string;
  userId: string;
  membershipId?: string;
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
};

export interface IAgentCoreRuntime {
  invoke(input: AgentCoreInvokeInput): Promise<AgentCoreInvokeResult>;
}
