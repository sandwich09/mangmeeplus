import { Injectable } from '@nestjs/common';
import { aiGatewayConfigSchema, validateProductionConfig } from '@watchdog-bms/config';

type AiGatewayConfig = ReturnType<typeof aiGatewayConfigSchema.parse>;

/**
 * Validates process.env against aiGatewayConfigSchema at bootstrap time.
 * Throws on first invalid configuration so the process exits early.
 */
@Injectable()
export class AiGatewayConfigService {
  private readonly config: AiGatewayConfig;

  constructor() {
    const result = aiGatewayConfigSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`AI Gateway config validation failed:\n${result.error.message}`);
    }
    this.config = result.data;

    if (this.config.APP_ENV === 'production') {
      // ponytail: validateProductionConfig checks API-specific rules (DEV_AUTH_ENABLED etc);
      // safe to call here - checks that don't apply to ai-gateway are no-ops
      validateProductionConfig(this.config as unknown as Record<string, unknown>);
    }
  }

  get port(): number { return this.config.PORT; }
  get host(): string { return this.config.HOST; }
  get serviceName(): string { return this.config.SERVICE_NAME; }
  get appEnv(): string { return this.config.APP_ENV; }
  get isProduction(): boolean { return this.config.APP_ENV === 'production'; }
  get logLevel(): string { return this.config.LOG_LEVEL; }
  get logRedactionEnabled(): boolean { return this.config.LOG_REDACTION_ENABLED; }
  get corsAllowedOrigins(): string[] {
    return this.config.CORS_ALLOWED_ORIGINS.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  get bodyLimit(): string { return this.config.HTTP_BODY_LIMIT; }
  get swaggerEnabled(): boolean { return this.config.SWAGGER_ENABLED; }

  get modelProvider(): string { return this.config.MODEL_PROVIDER; }
  get openAiApiKey(): string | undefined { return this.config.OPENAI_API_KEY; }
  get openAiModel(): string { return this.config.OPENAI_MODEL; }
  get openAiProcessingRegion(): string | undefined { return this.config.OPENAI_PROCESSING_REGION; }
  get bedrockRegion(): string | undefined { return this.config.BEDROCK_REGION; }
  get bedrockModelId(): string | undefined { return this.config.BEDROCK_MODEL_ID; }
  get documentAiModelId(): string | undefined { return this.config.DOCUMENT_AI_MODEL_ID; }
  get typhoonOcrApiKey(): string | undefined { return this.config.TYPHOON_OCR_API_KEY; }
  get typhoonProcessingRegion(): string | undefined { return this.config.TYPHOON_PROCESSING_REGION; }
  get approvedAiModelIds(): string[] { return this.config.APPROVED_AI_MODEL_IDS.split(',').map((value) => value.trim()).filter(Boolean); }
  get approvedAiProviders(): string[] { return this.config.APPROVED_AI_PROVIDERS.split(',').map((value) => value.trim()).filter(Boolean); }
  get approvedAiRegions(): string[] { return this.config.APPROVED_AI_REGIONS.split(',').map((value) => value.trim()).filter(Boolean); }
  get aiGatewayEnabled(): boolean { return this.config.AI_GATEWAY_ENABLED; }
  get aiAgentRegistryEnabled(): boolean { return this.config.AI_AGENT_REGISTRY_ENABLED; }
  get aiToolPolicyEnforced(): boolean { return this.config.AI_TOOL_POLICY_ENFORCED; }
  get aiToolAuditEnabled(): boolean { return this.config.AI_TOOL_AUDIT_ENABLED; }
  get aiFinalMutationEnabled(): boolean { return this.config.AI_FINAL_MUTATION_ENABLED; }
  get aiPromptLoggingEnabled(): boolean { return this.config.AI_PROMPT_LOGGING_ENABLED; }
  get aiMaxToolCalls(): number { return this.config.AI_MAX_TOOL_CALLS; }
  get aiToolTimeoutMs(): number { return this.config.AI_TOOL_TIMEOUT_MS; }
  // Item 10B local agent orchestration
  get lineAiAgentOrchestrationEnabled(): boolean { return this.config.LINE_AI_AGENT_ORCHESTRATION_ENABLED; }
  get lineAiAgentRuntime(): string { return this.config.LINE_AI_AGENT_RUNTIME; }
  // Item 10F native tool-use loop + coverage critic
  get lineAiTooluseLoopEnabled(): boolean { return this.config.LINE_AI_TOOLUSE_LOOP_ENABLED; }
  get lineAiCoverageCriticEnabled(): boolean { return this.config.LINE_AI_COVERAGE_CRITIC_ENABLED; }
  get awsProfile(): string | undefined { return this.config.AWS_PROFILE; }
  get awsSdkLoadConfig(): boolean { return this.config.AWS_SDK_LOAD_CONFIG; }
  // AgentCore runtime invoke config
  get agentcoreRegion(): string | undefined { return this.config.AGENTCORE_REGION; }
  get agentcoreRuntimeArn(): string | undefined { return this.config.AGENTCORE_RUNTIME_ARN; }
  get agentcoreRuntimeQualifier(): string | undefined { return this.config.AGENTCORE_RUNTIME_QUALIFIER; }
  get agentcoreExpectedSourceCommit(): string | undefined { return this.config.AGENTCORE_EXPECTED_SOURCE_COMMIT; }
  get agentcoreExpectedArtifactSha256(): string | undefined { return this.config.AGENTCORE_EXPECTED_ARTIFACT_SHA256; }
  get agentcoreExpectedContractVersion(): number | undefined { return this.config.AGENTCORE_EXPECTED_CONTRACT_VERSION; }
  get agentcoreInvokeTimeoutMs(): number { return this.config.AGENTCORE_INVOKE_TIMEOUT_MS; }
  // L-12: AgentCore invocation bounds (byte cap enforced while streaming, never after buffering)
  get agentcoreMaxBodyBytes(): number { return this.config.AGENTCORE_MAX_BODY_BYTES; }
  get agentcoreMaxMessageChars(): number { return this.config.AGENTCORE_MAX_MESSAGE_CHARS; }
  get agentcoreMaxAttachments(): number { return this.config.AGENTCORE_MAX_ATTACHMENTS; }
  get agentcoreMaxConcurrentInvocations(): number { return this.config.AGENTCORE_MAX_CONCURRENT_INVOCATIONS; }

  // ponytail: prefer watchdog secret (prod ARN value); fall back to dev secret (local)
  get jwtSecret(): string | undefined { return this.config.WATCHDOG_JWT_SECRET_ARN ?? this.config.DEV_AUTH_SECRET; }
  get jwtIssuer(): string | undefined { return this.config.WATCHDOG_JWT_ISSUER; }
  get jwtAudience(): string | undefined { return this.config.WATCHDOG_JWT_AUDIENCE; }
  get jwtClockToleranceSeconds(): number { return this.config.JWT_CLOCK_TOLERANCE_SECONDS; }
  get aiGatewayInternalSecret(): string | undefined { return this.config.AI_GATEWAY_INTERNAL_SECRET; }
  get erpCoreInternalUrl(): string { return this.config.ERP_CORE_INTERNAL_URL; }
}
