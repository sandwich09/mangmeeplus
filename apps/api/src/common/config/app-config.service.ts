import { Injectable } from '@nestjs/common';
import { configureLineSignedInOpen } from '@watchdog-bms/contracts';
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
    if (this.config.LINE_OFFICIAL_REPLY_ENABLED &&
      (!this.config.LINE_OFFICIAL_CHANNEL_SECRET?.trim() ||
       !this.config.LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN?.trim() ||
       !this.config.WEB_BASE_URL?.startsWith('https://'))) {
      throw new Error('Official OA replies require dedicated channel credentials and an HTTPS WEB_BASE_URL.');
    }
    validateProductionConfig(this.config as unknown as Record<string, unknown>);
    // The start page's exchange needs both the handoff route and WEB_BASE_URL; without them the
    // links stay plain. Here, because every process that can send a LINE message builds this service.
    configureLineSignedInOpen(this.config.LINE_WEB_HANDOFF_ENABLED
      ? { webBaseUrl: this.config.WEB_BASE_URL, liffId: this.config.LINE_LIFF_ID } : null);
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
  get lineLoginChannelSecret(): string | undefined { return this.config.LINE_LOGIN_CHANNEL_SECRET; }
  /** P12-1: web LINE login (OAuth code + PKCE). Off = channel hidden and the callback stays 403. */
  get lineWebLoginEnabled(): boolean { return this.config.LINE_WEB_LOGIN_ENABLED; }
  /** P12-3b: LINE deep-link session handoff. Off = no token minted, plain links, exchange 403. */
  get lineWebHandoffEnabled(): boolean { return this.config.LINE_WEB_HANDOFF_ENABLED; }
  /** P10 Flow B: public self-service signup. Off = form closed and POST 403; already-issued
   *  status and claim links stay readable so an approved applicant is never stranded mid-flow. */
  get externalSignupEnabled(): boolean { return this.config.EXTERNAL_SIGNUP_ENABLED; }
  /** P10-L: LINE-first signup. Off = the LIFF endpoints 403 `line_signup_disabled` and no
   *  `line-oa` application can be created; shops already provisioned are ordinary companies. */
  get lineSignupEnabled(): boolean { return this.config.LINE_SIGNUP_ENABLED; }
  get lineSignupApprovalMode(): 'MANUAL' | 'AUTO_FREE' { return this.config.LINE_SIGNUP_APPROVAL_MODE; }
  get lineSignupAutoDailyCap(): number { return this.config.LINE_SIGNUP_AUTO_DAILY_CAP; }
  get lineSignupWarmupSlips(): number { return this.config.LINE_SIGNUP_WARMUP_SLIPS; }
  /** Per-shop AI spend cap for a free trial, in satang (spec §10). */
  get lineFreeAiBudgetSatang(): number { return this.config.LINE_FREE_AI_BUDGET_SATANG; }
  get lineSignupAdminReminderMinutes(): number { return this.config.LINE_SIGNUP_ADMIN_REMINDER_MINUTES; }
  /** §15.6: trial shops that must exhaust their AI budget in one Bangkok day before ops is told. */
  get lineSignupAdminAlertBudgetExhaustedPerDay(): number {
    return this.config.LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY;
  }
  /** Hold spec §5: how old an UNRESOLVED AI credit hold must be before ops is told. */
  get aiCreditHoldAlertAfterHours(): number { return this.config.AI_CREDIT_HOLD_ALERT_AFTER_HOURS; }
  get lineSignupBusinessDays(): string { return this.config.LINE_SIGNUP_BUSINESS_DAYS; }
  get lineSignupBusinessHours(): string { return this.config.LINE_SIGNUP_BUSINESS_HOURS; }
  /** Review G-01: enforcing the monthly slip ceiling is a first for every existing shop, so it
   *  gets its own switch rather than riding on the signup flag. */
  get receiptQuotaEnforced(): boolean { return this.config.RECEIPT_QUOTA_ENFORCED; }
  get lineLiffId(): string | undefined { return this.config.LINE_LIFF_ID; }
  get lineMessagingChannelId(): string | undefined { return this.config.LINE_MESSAGING_CHANNEL_ID; }
  get lineMessagingChannelSecret(): string | undefined { return this.config.LINE_MESSAGING_CHANNEL_SECRET; }
  get lineMessagingChannelAccessToken(): string | undefined { return this.config.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN; }
  get lineOfficialReplyEnabled(): boolean { return this.config.LINE_OFFICIAL_REPLY_ENABLED; }
  get lineOfficialChannelSecret(): string | undefined { return this.config.LINE_OFFICIAL_CHANNEL_SECRET; }
  get lineOfficialChannelAccessToken(): string | undefined { return this.config.LINE_OFFICIAL_CHANNEL_ACCESS_TOKEN; }
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
  // DB-backed neutral intake state (§8.3). Default 'off' = the durable state is never touched and the
  // fail-open Redis ledger stays the only continuation state; 'shadow' measures divergence without
  // changing behavior; 'on' makes it authoritative and fails CLOSED with zero writes.
  get lineAiIntakeStateMode(): 'off' | 'shadow' | 'on' { return this.config.LINE_AI_INTAKE_STATE_MODE; }
  // Advisor staged capability (default 'off' = the `advisor` router capability is never sent, so the
  // intake prompt/payload/parser are byte-exact legacy). Only 'off' and 'social' are buildable today.
  get lineAiAdvisorMode(): 'off' | 'social' | 'knowledge' | 'company' { return this.config.LINE_AI_ADVISOR_MODE; }
  // Advisor direct-answer kill switch. RESERVED / INERT: parsed and exposed for a stable env contract,
  // but NO consumer reads it yet — the prepared direct-answer lane is a later phase. Off = the reply
  // always comes from the existing reference path.
  get lineAiAdvisorDirectAnswerEnabled(): boolean { return this.config.LINE_AI_ADVISOR_DIRECT_ANSWER_ENABLED; }
  // Durable terminal-outcome replay (§8.3). Default false = no outcome row is written or read and the
  // orphan sweep selects exactly today's rows; true = the rendered messages are persisted before the
  // first send (fail-closed) and a retry pushes THEM instead of re-routing the input.
  get lineAiTerminalOutcomeReplayEnabled(): boolean { return this.config.LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED; }
  // Flex→text delivery fallback (§14.3). Default false = a rejected Flex payload takes the exact
  // legacy push path; true = one retry with each Flex message's own altText.
  get lineAiFlexTextFallbackEnabled(): boolean { return this.config.LINE_AI_FLEX_TEXT_FALLBACK_ENABLED; }
  get lineExpenseDraftConversationEnabled(): boolean { return this.config.LINE_EXPENSE_DRAFT_CONVERSATION_ENABLED; }
  // S-4 draft edit over LINE (preview card → confirm postback → apply). OFF = the five
  // `draft_update` tools are refused by the executor and the webhook renders no preview card.
  get lineAiDraftEditEnabled(): boolean { return this.config.LINE_AI_DRAFT_EDIT_ENABLED; }
  get lineAiReliabilityV2Mode(): 'off' | 'shadow' | 'on' { return this.config.LINE_AI_RELIABILITY_V2_MODE; }
  get lineAiReliabilityV2CompanyIds(): string[] { return [...this.config.LINE_AI_RELIABILITY_V2_COMPANY_IDS]; }
  get lineAiDeliveryPlanV2Enabled(): boolean { return this.config.LINE_AI_DELIVERY_PLAN_V2_ENABLED; }
  get lineAiDeliveryPlanV2WriteCompanyIds(): string[] { return [...this.config.LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS]; }
  get lineAiDeliveryPlanV2PublicChannelIds(): string[] { return [...this.config.LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS]; }
  get lineAiReimbursementDraftWriteEnabled(): boolean { return this.config.LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED; }
  get lineAiDocumentQaEnabled(): boolean { return this.config.LINE_AI_DOCUMENT_QA_ENABLED; }
  get lineAiApprovedKnowledgeEnabled(): boolean { return this.config.LINE_AI_APPROVED_KNOWLEDGE_ENABLED; }
  get lineAiPublicLookupEnabled(): boolean { return this.config.LINE_AI_PUBLIC_LOOKUP_ENABLED; }
  get lineAiPreferencesEnabled(): boolean { return this.config.LINE_AI_PREFERENCES_ENABLED; }
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
  /** Appendix §6: OFF refuses new capture groups and files; reads and recovery keep working. */
  get expenseCaptureGroupIntakeEnabled(): boolean { return this.config.EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED; }
  get expenseCapturePdfMaxPages(): number { return this.config.EXPENSE_CAPTURE_PDF_MAX_PAGES; }
  get expenseCaptureReadConcurrency(): number { return this.config.EXPENSE_CAPTURE_READ_CONCURRENCY; }
  get expenseCaptureRetentionDays(): number { return this.config.EXPENSE_CAPTURE_RETENTION_DAYS; }
  get expenseCaptureDerivativeMaxBytes(): number { return this.config.EXPENSE_CAPTURE_DERIVATIVE_MAX_BYTES; }
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
  get emailProvider(): 'disabled' | 'local-console' | 'ses' | 'postmark' { return this.config.EMAIL_PROVIDER; }
  get billingMode(): 'disabled' | 'test' | 'live' { return this.config.BILLING_MODE; }
  get stripeAccountId(): string | undefined { return this.config.STRIPE_ACCOUNT_ID; }
  get stripeSecretKey(): string | undefined { return this.config.STRIPE_SECRET_KEY; }
  get stripeWebhookSecret(): string | undefined { return this.config.STRIPE_WEBHOOK_SECRET; }
  get postmarkServerToken(): string | undefined { return this.config.POSTMARK_SERVER_TOKEN; }
  get postmarkServerId(): number | undefined { return this.config.POSTMARK_SERVER_ID; }
  get postmarkMessageStream(): string { return this.config.POSTMARK_MESSAGE_STREAM; }
  get postmarkFromAddress(): string | undefined { return this.config.POSTMARK_FROM_ADDRESS; }
  get postmarkFromName(): string { return this.config.POSTMARK_FROM_NAME; }
  get postmarkUatAllowedRecipients(): string[] {
    return this.config.POSTMARK_UAT_ALLOWED_RECIPIENTS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  }
  get postmarkWebhookUsername(): string | undefined { return this.config.POSTMARK_WEBHOOK_USERNAME; }
  get postmarkWebhookPassword(): string | undefined { return this.config.POSTMARK_WEBHOOK_PASSWORD; }
  get sesRegion(): string | undefined { return this.config.SES_REGION; }
  get sesFromAddress(): string | undefined { return this.config.SES_FROM_ADDRESS; }
  /** SES links require an explicit frontend URL, never the public API-origin fallback. */
  get sesWebBaseUrl(): string | undefined { return this.config.WEB_BASE_URL; }
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
  get emailOtpHmacKey(): string | undefined { return this.config.EMAIL_OTP_HMAC_KEY; }
  get emailOtpHmacKeyVersion(): string | undefined { return this.config.EMAIL_OTP_HMAC_KEY_VERSION; }
  get emailVerificationRequestWindowSeconds(): number { return this.config.EMAIL_VERIFICATION_REQUEST_WINDOW_SECONDS; }
  get emailVerificationConfirmMaxPerIp(): number { return this.config.EMAIL_VERIFICATION_CONFIRM_MAX_PER_IP; }
  get emailVerificationConfirmWindowSeconds(): number { return this.config.EMAIL_VERIFICATION_CONFIRM_WINDOW_SECONDS; }
  get lineLoginCallbackMaxPerIp(): number { return this.config.LINE_LOGIN_CALLBACK_MAX_PER_IP; }
  get lineLoginCallbackWindowSeconds(): number { return this.config.LINE_LOGIN_CALLBACK_WINDOW_SECONDS; }
  get lineQrCreateMaxPerIp(): number { return this.config.LINE_QR_CREATE_MAX_PER_IP; }
  get lineQrCreateWindowSeconds(): number { return this.config.LINE_QR_CREATE_WINDOW_SECONDS; }
  get lineQrPollMaxPerIp(): number { return this.config.LINE_QR_POLL_MAX_PER_IP; }
  get lineQrPollWindowSeconds(): number { return this.config.LINE_QR_POLL_WINDOW_SECONDS; }
  get lineHandoffExchangeMaxPerIp(): number { return this.config.LINE_HANDOFF_EXCHANGE_MAX_PER_IP; }
  get lineHandoffExchangeWindowSeconds(): number { return this.config.LINE_HANDOFF_EXCHANGE_WINDOW_SECONDS; }
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
  get aiGlobalInferenceProfileApproved(): boolean { return this.config.AI_GLOBAL_INFERENCE_PROFILE_APPROVED; }
  get aiGlobalInferenceProfileApprovalRef(): string | undefined { return this.config.AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF; }
}
