import { Injectable } from '@nestjs/common';
import {
  DEFAULT_APPROVED_AI_MODEL_IDS,
  apiConfigSchema,
  parseWebhookAllowedHosts,
  resolveDeploymentIdentity,
  validateProductionConfig,
  type DeploymentIdentity,
} from '@watchdog-bms/config';

type ApiConfig = ReturnType<typeof apiConfigSchema.parse>;

/**
 * Validates process.env against apiConfigSchema at bootstrap time.
 * Throws on first invalid configuration so the process exits early.
 */
@Injectable()
export class AppConfigService {
  private readonly config: ApiConfig;

  constructor() {
    const result = apiConfigSchema.safeParse(process.env);
    if (!result.success) {
      throw new Error(`Config validation failed:\n${result.error.message}`);
    }
    this.config = result.data;
    validateProductionConfig(this.config as unknown as Record<string, unknown>);
  }

  get port(): number { return this.config.PORT; }
  get host(): string { return this.config.HOST; }
  get serviceName(): string { return this.config.SERVICE_NAME; }
  get appEnv(): string { return this.config.APP_ENV; }
  get databaseUrl(): string { return this.config.DATABASE_URL; }
  get corsAllowedOrigins(): string[] {
    return this.config.CORS_ALLOWED_ORIGINS.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  get logLevel(): string { return this.config.LOG_LEVEL; }
  get logRedactionEnabled(): boolean { return this.config.LOG_REDACTION_ENABLED; }
  get requestLogEnabled(): boolean { return this.config.REQUEST_LOG_ENABLED; }
  /**
   * F1.5b P0-3 — authoritative deployment identity (`DEPLOY_ENVIRONMENT` + `GIT_SHA`/`IMAGE_DIGEST`).
   * The launch control plane records this and never a caller-supplied string.
   */
  get deploymentIdentity(): DeploymentIdentity {
    return resolveDeploymentIdentity(this.config as unknown as Record<string, string | undefined>);
  }
  get isProduction(): boolean { return this.config.APP_ENV === 'production'; }
  get isLocal(): boolean { return this.config.APP_ENV === 'local'; }
  get swaggerEnabled(): boolean { return this.config.SWAGGER_ENABLED; }
  get bodyLimit(): string { return this.config.HTTP_BODY_LIMIT; }
  get uploadMaxBytes(): number { return this.config.UPLOAD_MAX_BYTES; }
  get uploadPendingMaxBytesPerCompany(): number { return this.config.UPLOAD_PENDING_MAX_BYTES_PER_COMPANY; }
  get signedUrlTtlSeconds(): number { return this.config.SIGNED_URL_TTL_SECONDS; }
  get rateLimitEnabled(): boolean { return this.config.RATE_LIMIT_ENABLED; }
  get rateLimitWindowSeconds(): number { return this.config.RATE_LIMIT_WINDOW_SECONDS; }
  get rateLimitMaxRequests(): number { return this.config.RATE_LIMIT_MAX_REQUESTS; }
  get reimbursementWriteQuiesce(): boolean { return this.config.REIMBURSEMENT_WRITE_QUIESCE; }
  get productionServingMode(): 'live' | 'maintenance_only' | undefined { return this.config.PRODUCTION_SERVING_MODE; }
  get devAuthSecret(): string | undefined { return this.config.DEV_AUTH_SECRET; }
  get lineLoginChannelId(): string | undefined { return this.config.LINE_LOGIN_CHANNEL_ID; }
  get lineLiffId(): string | undefined { return this.config.LINE_LIFF_ID; }
  get lineMessagingChannelId(): string | undefined { return this.config.LINE_MESSAGING_CHANNEL_ID; }
  get lineMessagingChannelSecret(): string | undefined { return this.config.LINE_MESSAGING_CHANNEL_SECRET; }
  get lineMessagingChannelAccessToken(): string | undefined { return this.config.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN; }
  get lineAiBufferDebounceMs(): number { return this.config.LINE_AI_BUFFER_DEBOUNCE_MS; }
  get lineAiBufferMaxWaitMs(): number { return this.config.LINE_AI_BUFFER_MAX_WAIT_MS; }
  get lineAiLoadingAnimationEnabled(): boolean { return this.config.LINE_AI_LOADING_ANIMATION_ENABLED; }
  // LINE AI latency/autonomy Phase 1 (default off; keep the current 2,500 ms / processing-start path).
  get lineAiLoadingOnAcceptEnabled(): boolean { return this.config.LINE_AI_LOADING_ON_ACCEPT_ENABLED; }
  get lineAiDebounceExperimentEnabled(): boolean { return this.config.LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED; }
  get lineAiDebounceExperimentSecret(): string | undefined { return this.config.LINE_AI_DEBOUNCE_EXPERIMENT_SECRET; }
  get lineAiFusedPlanShadowEnabled(): boolean { return this.config.LINE_AI_FUSED_PLAN_SHADOW_ENABLED; }
  // Phase 4 (default off): the API only carries the prepared plan into the turn when a downstream
  // gateway lane wants it — shadow (Phase 3) or prepared simple-read (Phase 4). Consumption is the
  // gateway's decision; this flag just decides forwarding, so the two lanes stay independent.
  get lineAiPreparedSimpleReadEnabled(): boolean { return this.config.LINE_AI_PREPARED_SIMPLE_READ_ENABLED; }
  // Substitute-receipt semantic routing mode (default 'off' = exact legacy regex-first behavior).
  get lineAiSubstituteSemanticRoutingMode(): 'off' | 'shadow' | 'primary' { return this.config.LINE_AI_SUBSTITUTE_SEMANTIC_ROUTING_MODE; }
  // Expense-vs-reimbursement semantic intake mode (default 'off' = exact legacy intake prompt/parser).
  get lineAiReimbursementSemanticMode(): 'off' | 'shadow' | 'clarify_only' | 'handoff' { return this.config.LINE_AI_REIMBURSEMENT_SEMANTIC_MODE; }
  // Exact standalone greeting 0-call lane (default false = exact legacy three-call greeting path).
  get lineAiExactGreetingEnabled(): boolean { return this.config.LINE_AI_EXACT_GREETING_ENABLED; }
  // Terminal Flex card on a multi-part reply (default false = exact legacy all-text multi-part shape).
  get lineAiMultipartTerminalFlexEnabled(): boolean { return this.config.LINE_AI_MULTIPART_TERMINAL_FLEX_ENABLED; }
  get lineExpenseDraftConversationEnabled(): boolean { return this.config.LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED; }
  // Item 10F: LINE AI turn ledger (Redis Streams; ADR 0010)
  get redisUrl(): string { return this.config.REDIS_URL; }
  get s3Bucket(): string { return this.config.S3_BUCKET; }
  get s3Region(): string { return this.config.S3_REGION; }
  get s3Endpoint(): string | undefined { return this.config.S3_ENDPOINT; }
  get s3PublicEndpoint(): string | undefined { return this.config.S3_PUBLIC_ENDPOINT; }
  get s3ForcePathStyle(): boolean | undefined { return this.config.S3_FORCE_PATH_STYLE; }
  get s3AccessKeyId(): string | undefined { return this.config.S3_ACCESS_KEY_ID; }
  get s3SecretAccessKey(): string | undefined { return this.config.S3_SECRET_ACCESS_KEY; }
  get lineAiLedgerEnabled(): boolean { return this.config.LINE_AI_LEDGER_ENABLED; }
  get lineAiLedgerMaxLen(): number { return this.config.LINE_AI_LEDGER_MAXLEN; }
  get lineAiLedgerTtlSeconds(): number { return this.config.LINE_AI_LEDGER_TTL_SECONDS; }
  get lineAiLedgerClaimMinIdleMs(): number { return this.config.LINE_AI_LEDGER_CLAIM_MIN_IDLE_MS; }
  get lineAiLedgerDeliveryCap(): number { return this.config.LINE_AI_LEDGER_DELIVERY_CAP; }
  get aiDataRetentionDays(): number { return this.config.AI_DATA_RETENTION_DAYS; }
  get crmAutoReplyEnabled(): boolean { return this.config.CRM_AUTO_REPLY_ENABLED; }
  get crmAiMinConfidence(): number { return this.config.CRM_AI_MIN_CONFIDENCE; }
  get crmAiOutboundAllowedDomains(): string[] {
    return this.config.CRM_AI_OUTBOUND_ALLOWED_DOMAINS.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  /** M-09: the deny-all sentinel yields an empty allowlist, which denies every webhook host. */
  get workflowWebhookAllowedHosts(): string[] {
    return parseWebhookAllowedHosts(this.config.WORKFLOW_WEBHOOK_ALLOWED_HOSTS);
  }
  get clamAvHost(): string | undefined { return this.config.CLAMAV_HOST; }
  get clamAvPort(): number { return this.config.CLAMAV_PORT; }
  get clamAvTimeoutMs(): number { return this.config.CLAMAV_TIMEOUT_MS; }
  get webBaseUrl(): string | undefined { return this.config.WEB_BASE_URL ?? this.config.PUBLIC_BASE_URL; }
  /** Public origin of THIS API service (tunnel/prod URL) — for LINE webhook/callback URLs. */
  get publicApiBaseUrl(): string | undefined { return this.config.PUBLIC_BASE_URL; }
  get watchdogJwtIssuer(): string | undefined { return this.config.WATCHDOG_JWT_ISSUER; }
  get watchdogJwtAudience(): string | undefined { return this.config.WATCHDOG_JWT_AUDIENCE; }
  get watchdogJwtSecret(): string | undefined { return this.config.WATCHDOG_JWT_SECRET_ARN; }
  /** Single signing/verifying secret resolver; both sides must always use the same key. */
  get authJwtSecret(): string | undefined { return this.watchdogJwtSecret ?? this.devAuthSecret; }
  get emailProvider(): 'disabled' | 'ses' { return this.config.EMAIL_PROVIDER; }
  get sesRegion(): string | undefined { return this.config.SES_REGION; }
  get sesFromAddress(): string | undefined { return this.config.SES_FROM_ADDRESS; }
  get passwordLoginMaxPerIdentifier(): number { return this.config.PASSWORD_LOGIN_MAX_PER_IDENTIFIER; }
  get passwordLoginMaxPerIp(): number { return this.config.PASSWORD_LOGIN_MAX_PER_IP; }
  get passwordLoginWindowSeconds(): number { return this.config.PASSWORD_LOGIN_WINDOW_SECONDS; }
  get sessionRefreshMaxPerSession(): number { return this.config.SESSION_REFRESH_MAX_PER_SESSION; }
  get sessionRefreshWindowSeconds(): number { return this.config.SESSION_REFRESH_WINDOW_SECONDS; }
  /** L-01: window in which a rotated refresh token is a benign concurrent refresh; 0 = strict. */
  get sessionRefreshReuseGraceSeconds(): number { return this.config.SESSION_REFRESH_REUSE_GRACE_SECONDS; }
  get aiLlmMaxPerCompany(): number { return this.config.AI_LLM_MAX_PER_COMPANY; }
  get aiOcrMaxPerCompany(): number { return this.config.AI_OCR_MAX_PER_COMPANY; }
  get aiRateLimitWindowSeconds(): number { return this.config.AI_RATE_LIMIT_WINDOW_SECONDS; }
  /** Operator-owned FX rate; prices AI usage rows in satang at write time (metering spec §7.4). */
  get aiThbPerUsd(): number { return this.config.AI_THB_PER_USD; }
  /** Platform default monthly AI cap per company, in satang; a row override wins (metering spec §7.4). */
  get aiMonthlyBudgetSatang(): number { return this.config.AI_MONTHLY_BUDGET_SATANG; }
  /** Highest per-company override the partner console may set, in satang (metering spec §7.4). */
  get aiMonthlyBudgetSatangCeiling(): number { return this.config.AI_MONTHLY_BUDGET_SATANG_CEILING; }
  get passwordResetRequestMaxPerIdentifier(): number { return this.config.PASSWORD_RESET_REQUEST_MAX_PER_IDENTIFIER; }
  get passwordResetRequestMaxPerIp(): number { return this.config.PASSWORD_RESET_REQUEST_MAX_PER_IP; }
  get passwordResetRequestWindowSeconds(): number { return this.config.PASSWORD_RESET_REQUEST_WINDOW_SECONDS; }
  get passwordResetConfirmMaxPerIp(): number { return this.config.PASSWORD_RESET_CONFIRM_MAX_PER_IP; }
  get passwordResetConfirmWindowSeconds(): number { return this.config.PASSWORD_RESET_CONFIRM_WINDOW_SECONDS; }
  /** L-06: fixed minimum response envelope for the reset request endpoint; 0 disables the floor. */
  get passwordResetResponseMinMs(): number { return this.config.PASSWORD_RESET_RESPONSE_MIN_MS; }
  /** L-08: ERP-side final-mutation switch. Named to match the gateway's aiFinalMutationEnabled. */
  get aiFinalMutationEnabled(): boolean { return this.config.AI_FINAL_MUTATION_ENABLED; }
  get customerRegisterMaxPerIpChannel(): number { return this.config.CUSTOMER_REGISTER_MAX_PER_IP_CHANNEL; }
  get customerRegisterWindowSeconds(): number { return this.config.CUSTOMER_REGISTER_WINDOW_SECONDS; }
  get emailVerificationRequestMaxPerUser(): number { return this.config.EMAIL_VERIFICATION_REQUEST_MAX_PER_USER; }
  get emailVerificationRequestWindowSeconds(): number { return this.config.EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS; }
  get emailVerificationConfirmMaxPerIp(): number { return this.config.EMAIL_VERIFICATION_CONFIRM_MAX_PER_IP; }
  get emailVerificationConfirmWindowSeconds(): number { return this.config.EMAIL_VERIFICATION_CONFIRM_WINDOW_SECONDS; }
  get aiGatewayInternalUrl(): string { return this.config.AI_GATEWAY_INTERNAL_URL; }
  get aiGatewayInternalSecret(): string | undefined { return this.config.AI_GATEWAY_INTERNAL_SECRET; }
  get aiActorDelegationSigningKey(): Buffer {
    const hex = this.config.AI_ACTOR_DELEGATION_SIGNING_KEY;
    if (!hex) throw new Error('AI_ACTOR_DELEGATION_SIGNING_KEY not configured');
    return Buffer.from(hex, 'hex');
  }
  get credentialEncryptionKey(): Buffer {
    const hex = this.config.CREDENTIAL_ENCRYPTION_KEY;
    if (!hex) throw new Error('CREDENTIAL_ENCRYPTION_KEY not configured');
    return Buffer.from(hex, 'hex');
  }
  get pdpaPseudonymizationKeyRing(): { current: Buffer; previous: readonly Buffer[] } {
    const currentHex = this.config.PDPA_PSEUDONYMIZATION_KEY;
    if (!currentHex) throw new Error('PDPA_PSEUDONYMIZATION_KEY not configured');
    const current = Buffer.from(currentHex, 'hex');
    const previousHex = (this.config.PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS ?? '')
      .split(',')
      .map((key: string) => key.trim())
      .filter((key: string) => key !== '' && key !== currentHex);
    return {
      current,
      previous: [...new Set(previousHex)].map((key) => Buffer.from(key, 'hex')),
    };
  }
  get approvedAiModelIds(): string[] {
    return (this.config.APPROVED_AI_MODEL_IDS ?? DEFAULT_APPROVED_AI_MODEL_IDS)
      .split(',').map((s: string) => s.trim()).filter(Boolean);
  }
}
