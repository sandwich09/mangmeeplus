# UAT / Production configuration comparison — 2026-09-07

Verified effective runtime settings against both environments. Secret values are omitted.

- Application source: `604ac785479ced5b9858d0b46d89f8d11cf2b9f6`
- Collected at: `2026-09-07T04:01:10.814112+00:00`
- Signup, AUTO_FREE, receipt quota, draft editing, prepared/fused AI and orchestration are enabled in both environments.
- Production email remains disabled by owner instruction. Email-dependent claim/verification is deferred.
- URLs, LINE apps, storage, internal identities and security resources remain environment-specific.
- GitHub variables are inputs; signed release bindings override historical AgentCore/runtime inputs. The effective ECS/AgentCore rows below are the runtime proof.

Compared 253 configuration entries and 17 secret-reference entries.

## github

| Key | UAT | Production | Assessment |
| --- | --- | --- | --- |
| `AGENTCORE_INVOKE_TIMEOUT_MS` | — | 20000 | UAT workflow defaults to the same 20000 ms; effective runtime compared below |
| `AGENTCORE_MAX_ATTACHMENTS` | 10 | 10 | Equal |
| `AGENTCORE_MAX_BODY_BYTES` | 1048576 | 1048576 | Equal |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | 16 | 16 | Equal |
| `AGENTCORE_MAX_MESSAGE_CHARS` | 8000 | 8000 | Equal |
| `AGENTCORE_REGION` | — | [configured] | Signed deployment binding uses each environment runtime in the approved AWS region |
| `AGENTCORE_RUNTIME_ARN` | — | [configured] | Signed deployment binding overrides this historical input |
| `AGENTCORE_RUNTIME_QUALIFIER` | — | [configured] | Signed deployment binding overrides this historical input |
| `AI_DATA_RETENTION_DAYS` | [configured] | [configured] | Equal |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | [configured] | [configured] | Equal |
| `AI_LLM_MAX_PER_COMPANY` | 60 | 60 | Equal |
| `AI_MONTHLY_BUDGET_SATANG` | 200000 | 200000 | Equal |
| `AI_MONTHLY_BUDGET_SATANG_CEILING` | 1000000 | 1000000 | Equal |
| `AI_OCR_MAX_PER_COMPANY` | 20 | 20 | Equal |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | 60 | 60 | Equal |
| `AI_THB_PER_USD` | [configured] | [configured] | Equal |
| `APPROVED_AI_PROVIDERS` | [configured] | [configured] | Equal |
| `APPROVED_AI_REGIONS` | [configured] | [configured] | Equal |
| `AWS_ACCOUNT_ID` | [configured] | [configured] | Equal |
| `AWS_DEPLOY_ROLE_ARN` | [configured] | [configured] | Separate deployment roles for each environment |
| `AWS_REGION` | [configured] | [configured] | Equal |
| `AWS_ROLE_ARN` | [configured] | [configured] | Separate AWS authority for each environment |
| `BEDROCK_REGION` | [configured] | [configured] | Equal |
| `CLAMAV_HOST` | [configured] | [configured] | Equal |
| `CLAMAV_PORT` | [configured] | [configured] | Equal |
| `CLAMAV_TIMEOUT_MS` | [configured] | [configured] | Equal |
| `CRM_AI_MIN_CONFIDENCE` | — | [configured] | UAT workflow default and Production input; effective runtime compared below |
| `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` | [configured] | [configured] | Environment-specific outbound allowlist |
| `CRM_AUTO_REPLY_ENABLED` | true | true | Equal |
| `DOCUMENT_AI_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | Equal |
| `LINE_AI_AGENT_RUNTIME` | strands-local | agentcore | UAT historical variable is overridden to agentcore by the release binding |
| `LINE_LIFF_ID` | [configured] | [configured] | Separate registered LINE app |
| `LINE_LOGIN_CHANNEL_ID` | [configured] | [configured] | Separate registered LINE app |
| `LINE_MESSAGING_CHANNEL_ID` | [configured] | [configured] | Separate registered LINE OA |
| `LINE_OA_ADD_URL` | — | [configured] | Production OA add-friend URL configured |
| `LINE_OA_QR_IMAGE_URL` | — | [configured] | Production OA QR configured |
| `LOG_KMS_KEY_ID` | — | [configured] | Mandatory Production log encryption |
| `MODEL_PROVIDER` | bedrock | bedrock | Equal |
| `PASSWORD_RESET_RESPONSE_MIN_MS` | [configured] | [configured] | Equal |
| `PUBLIC_DOMAIN_URL` | [configured] | [configured] | Environment-specific public domain |
| `REDIS_REPLICATION_GROUP_ID` | — | [configured] | Production hardened Redis replication group |
| `SECURITY_ALERT_TOPIC_ARN` | — | [configured] | Mandatory Production security notification topic |
| `SESSION_REFRESH_MAX_PER_SESSION` | [configured] | [configured] | Equal |
| `SESSION_REFRESH_REUSE_GRACE_SECONDS` | [configured] | [configured] | Equal |
| `SESSION_REFRESH_WINDOW_SECONDS` | [configured] | [configured] | Equal |
| `SES_FROM_ADDRESS` | — | [configured] | Production explicit sender; UAT deploy default is the same sender; Production email remains disabled |
| `SWAGGER_ENABLED` | false | false | Equal |
| `TYPHOON_PROCESSING_REGION` | [configured] | [configured] | Equal |
| `WEB_LINE_ACCOUNT_LINK_URL` | — | [configured] | Production registered link URL; UAT uses its environment default |
| `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` | — | [configured] | Environment-specific webhook host boundary |

## api-web

| Key | UAT | Production | Assessment |
| --- | --- | --- | --- |
| `AI_DATA_RETENTION_DAYS` | [configured] | [configured] | Equal |
| `AI_GATEWAY_ENABLED` | true | true | Equal |
| `AI_GATEWAY_INTERNAL_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `AI_LLM_MAX_PER_COMPANY` | 60 | 60 | Equal |
| `AI_MONTHLY_BUDGET_SATANG` | 200000 | 200000 | Equal |
| `AI_MONTHLY_BUDGET_SATANG_CEILING` | 1000000 | 1000000 | Equal |
| `AI_OCR_MAX_PER_COMPANY` | 20 | 20 | Equal |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | 60 | 60 | Equal |
| `AI_THB_PER_USD` | [configured] | [configured] | Equal |
| `API_PORT` | [configured] | [configured] | Equal |
| `APP_ENV` | [configured] | [configured] | Equal |
| `AUDIT_ENABLED` | true | true | Equal |
| `AUTH_PROVIDER` | [configured] | [configured] | Equal |
| `CLAMAV_HOST` | [configured] | [configured] | Equal |
| `CLAMAV_PORT` | [configured] | [configured] | Equal |
| `CLAMAV_TIMEOUT_MS` | [configured] | [configured] | Equal |
| `CORS_ALLOWED_ORIGINS` | [configured] | [configured] | Expected environment identity / infrastructure |
| `CRM_AI_MIN_CONFIDENCE` | [configured] | [configured] | Equal |
| `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` | [configured] | [configured] | Expected environment identity / infrastructure |
| `CRM_AUTO_REPLY_ENABLED` | true | true | Equal |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | Expected environment identity / infrastructure |
| `DEV_AUTH_ENABLED` | false | false | Equal |
| `EMAIL_LOGO_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `EMAIL_PROVIDER` | ses | disabled | Owner-deferred email |
| `EXTERNAL_SIGNUP_ENABLED` | true | true | Equal |
| `GIT_SHA` | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | Equal |
| `GLOBAL_MAINTENANCE_MODE` | false | false | Equal |
| `HOST` | [configured] | [configured] | Equal |
| `INTERNAL_API_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `LINE_ACCOUNT_LINK_QR_IMAGE_URL` | [empty] | [empty] | Equal |
| `LINE_ACCOUNT_LINK_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `LINE_AI_ADVISOR_MODE` | social | social | Equal |
| `LINE_AI_BUFFER_DEBOUNCE_MS` | 1000 | 1000 | Equal |
| `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED` | false | false | Equal |
| `LINE_AI_DRAFT_EDIT_ENABLED` | true | true | Equal |
| `LINE_AI_EXACT_GREETING_ENABLED` | true | true | Equal |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | true | true | Equal |
| `LINE_AI_LEDGER_ENABLED` | true | true | Equal |
| `LINE_AI_LOADING_ON_ACCEPT_ENABLED` | true | true | Equal |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | true | true | Equal |
| `LINE_FREE_AI_BUDGET_SATANG` | 8000 | 8000 | Equal |
| `LINE_LIFF_ID` | [configured] | [configured] | Expected environment identity / infrastructure |
| `LINE_LOGIN_CHANNEL_ID` | [configured] | [configured] | Expected environment identity / infrastructure |
| `LINE_MESSAGING_CHANNEL_ID` | [configured] | [configured] | Expected environment identity / infrastructure |
| `LINE_OA_ADD_URL` | [empty] | [configured] | Expected environment identity / infrastructure |
| `LINE_OA_QR_IMAGE_URL` | [empty] | [configured] | Expected environment identity / infrastructure |
| `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` | 5 | 5 | Equal |
| `LINE_SIGNUP_ADMIN_REMINDER_MINUTES` | 60 | 60 | Equal |
| `LINE_SIGNUP_APPROVAL_MODE` | AUTO_FREE | AUTO_FREE | Equal |
| `LINE_SIGNUP_AUTO_DAILY_CAP` | 20 | 20 | Equal |
| `LINE_SIGNUP_BUSINESS_DAYS` | MON-SAT | MON-SAT | Equal |
| `LINE_SIGNUP_BUSINESS_HOURS` | 09:00-18:00 | 09:00-18:00 | Equal |
| `LINE_SIGNUP_ENABLED` | true | true | Equal |
| `LINE_SIGNUP_WARMUP_SLIPS` | 10 | 10 | Equal |
| `LINE_WEB_HANDOFF_ENABLED` | true | true | Equal |
| `LINE_WEB_LOGIN_ENABLED` | true | true | Equal |
| `LOG_FORMAT` | [configured] | [configured] | Equal |
| `LOG_REDACTION_ENABLED` | true | true | Equal |
| `NEXT_PUBLIC_AI_GATEWAY_BASE_URL` | [configured] | [configured] | Equal |
| `NEXT_PUBLIC_API_BASE_URL` | [configured] | [configured] | Equal |
| `NEXT_PUBLIC_API_URL` | [configured] | [configured] | Equal |
| `NEXT_PUBLIC_APP_ENV` | [configured] | [configured] | Equal |
| `NEXT_PUBLIC_LIFF_ID` | [configured] | [configured] | Expected environment identity / infrastructure |
| `NEXT_PUBLIC_LINE_ACCOUNT_LINK_QR_IMAGE_URL` | [empty] | [empty] | Equal |
| `NEXT_PUBLIC_LINE_ACCOUNT_LINK_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `NEXT_PUBLIC_LINE_OA_ADD_URL` | [empty] | [configured] | Expected environment identity / infrastructure |
| `NEXT_PUBLIC_LINE_OA_QR_IMAGE_URL` | [empty] | [configured] | Expected environment identity / infrastructure |
| `NODE_ENV` | [configured] | [configured] | Equal |
| `PASSWORD_RESET_RESPONSE_MIN_MS` | [configured] | [configured] | Equal |
| `PORT` | [configured] | [configured] | Equal |
| `PRODUCTION_SERVING_MODE` | live | live | Equal |
| `PUBLIC_BASE_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `RATE_LIMIT_ENABLED` | true | true | Equal |
| `RATE_LIMIT_MAX_REQUESTS` | [configured] | [configured] | Equal |
| `RATE_LIMIT_WINDOW_SECONDS` | [configured] | [configured] | Equal |
| `RECEIPT_QUOTA_ENFORCED` | true | true | Equal |
| `REIMBURSEMENT_WRITE_QUIESCE` | false | false | Equal |
| `S3_BUCKET` | [configured] | [configured] | Expected environment identity / infrastructure |
| `S3_REGION` | [configured] | [configured] | Equal |
| `SERVICE_NAME` | [configured] | [configured] | Equal |
| `SERVICE_VERSION` | [configured] | [configured] | Equal |
| `SESSION_REFRESH_MAX_PER_SESSION` | [configured] | [configured] | Equal |
| `SESSION_REFRESH_REUSE_GRACE_SECONDS` | [configured] | [configured] | Equal |
| `SESSION_REFRESH_WINDOW_SECONDS` | [configured] | [configured] | Equal |
| `SES_CONFIGURATION_SET` | [configured] | [empty] | Owner-deferred email |
| `SES_EVENTS_TOPIC_ARN` | [configured] | [empty] | Owner-deferred email |
| `SES_FROM_ADDRESS` | [configured] | [configured] | Equal |
| `SES_REGION` | [configured] | [configured] | Equal |
| `SWAGGER_ENABLED` | false | false | Equal |
| `WATCHDOG_JWT_AUDIENCE` | [configured] | [configured] | Expected environment identity / infrastructure |
| `WATCHDOG_JWT_ISSUER` | [configured] | [configured] | Expected environment identity / infrastructure |
| `WEB_BASE_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `WEB_PORT` | [configured] | [configured] | Equal |
| `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` | [configured] | [configured] | Equal |

Secret references: matching key sets are checked separately; each runtime reference must belong to its own environment.

- `AI_ACTOR_DELEGATION_SIGNING_KEY`: configured in both environments; values not collected.
- `AI_GATEWAY_INTERNAL_SECRET`: configured in both environments; values not collected.
- `CREDENTIAL_ENCRYPTION_KEY`: configured in both environments; values not collected.
- `DATABASE_URL`: configured in both environments; values not collected.
- `LINE_LOGIN_CHANNEL_SECRET`: configured in both environments; values not collected.
- `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`: configured in both environments; values not collected.
- `LINE_MESSAGING_CHANNEL_SECRET`: configured in both environments; values not collected.
- `PDPA_PSEUDONYMIZATION_KEY`: configured in both environments; values not collected.
- `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS`: configured in both environments; values not collected.
- `REDIS_URL`: configured in both environments; values not collected.
- `WATCHDOG_JWT_SECRET_ARN`: configured in both environments; values not collected.
- `WORKER_INTERNAL_TOKEN`: configured in both environments; values not collected.

## ai-gateway

| Key | UAT | Production | Assessment |
| --- | --- | --- | --- |
| `AGENTCORE_EXPECTED_ARTIFACT_SHA256` | [configured] | [configured] | Equal |
| `AGENTCORE_EXPECTED_CONTRACT_VERSION` | [configured] | [configured] | Equal |
| `AGENTCORE_EXPECTED_SOURCE_COMMIT` | [configured] | [configured] | Equal |
| `AGENTCORE_INVOKE_TIMEOUT_MS` | 20000 | 20000 | Equal |
| `AGENTCORE_MAX_ATTACHMENTS` | 10 | 10 | Equal |
| `AGENTCORE_MAX_BODY_BYTES` | 1048576 | 1048576 | Equal |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | 16 | 16 | Equal |
| `AGENTCORE_MAX_MESSAGE_CHARS` | 8000 | 8000 | Equal |
| `AGENTCORE_REGION` | [configured] | [configured] | Equal |
| `AGENTCORE_RUNTIME_ARN` | [configured] | [configured] | Expected environment identity / infrastructure |
| `AGENTCORE_RUNTIME_QUALIFIER` | [configured] | [configured] | Expected environment identity / infrastructure |
| `AI_AGENT_REGISTRY_ENABLED` | true | true | Equal |
| `AI_FINAL_MUTATION_ENABLED` | false | false | Equal |
| `AI_GATEWAY_ENABLED` | true | true | Equal |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | [configured] | [configured] | Equal |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` | true | true | Equal |
| `AI_MAX_TOOL_CALLS` | 8 | 8 | Equal |
| `AI_PROMPT_LOGGING_ENABLED` | false | false | Equal |
| `AI_TOOL_AUDIT_ENABLED` | true | true | Equal |
| `AI_TOOL_POLICY_ENFORCED` | true | true | Equal |
| `AI_TOOL_TIMEOUT_MS` | 15000 | 15000 | Equal |
| `APPROVED_AI_MODEL_IDS` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | Equal |
| `APPROVED_AI_PROVIDERS` | [configured] | [configured] | Equal |
| `APPROVED_AI_REGIONS` | [configured] | [configured] | Equal |
| `APP_ENV` | [configured] | [configured] | Equal |
| `AWS_REGION` | [configured] | [configured] | Equal |
| `BEDROCK_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | Equal |
| `BEDROCK_REGION` | [configured] | [configured] | Equal |
| `CORS_ALLOWED_ORIGINS` | [configured] | [configured] | Expected environment identity / infrastructure |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | Expected environment identity / infrastructure |
| `DOCUMENT_AI_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | Equal |
| `ERP_CORE_INTERNAL_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `GIT_SHA` | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | Equal |
| `HOST` | [configured] | [configured] | Equal |
| `LINE_AI_AGENT_ORCHESTRATION_ENABLED` | true | true | Equal |
| `LINE_AI_AGENT_RUNTIME` | agentcore | agentcore | Equal |
| `LINE_AI_COVERAGE_CRITIC_ENABLED` | true | true | Equal |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | Equal |
| `LINE_AI_DRAFT_EDIT_ENABLED` | true | true | Equal |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | true | true | Equal |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | true | true | Equal |
| `LINE_AI_TOOLUSE_LOOP_ENABLED` | true | true | Equal |
| `LOG_FORMAT` | [configured] | [configured] | Equal |
| `LOG_REDACTION_ENABLED` | true | true | Equal |
| `MODEL_PROVIDER` | bedrock | bedrock | Equal |
| `NODE_ENV` | [configured] | [configured] | Equal |
| `PORT` | [configured] | [configured] | Equal |
| `PRODUCTION_SERVING_MODE` | live | live | Equal |
| `PUBLIC_BASE_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `SERVICE_NAME` | [configured] | [configured] | Equal |
| `SERVICE_VERSION` | [configured] | [configured] | Equal |
| `SWAGGER_ENABLED` | false | false | Equal |
| `WATCHDOG_JWT_AUDIENCE` | [configured] | [configured] | Expected environment identity / infrastructure |
| `WATCHDOG_JWT_ISSUER` | [configured] | [configured] | Expected environment identity / infrastructure |

Secret references: matching key sets are checked separately; each runtime reference must belong to its own environment.

- `AI_GATEWAY_INTERNAL_SECRET`: configured in both environments; values not collected.
- `WATCHDOG_JWT_SECRET_ARN`: configured in both environments; values not collected.

## workers

| Key | UAT | Production | Assessment |
| --- | --- | --- | --- |
| `APP_ENV` | [configured] | [configured] | Equal |
| `AWS_REGION` | [configured] | [configured] | Equal |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | Expected environment identity / infrastructure |
| `GIT_SHA` | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | Equal |
| `HOST` | [configured] | [configured] | Equal |
| `INTERNAL_API_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `LOG_FORMAT` | [configured] | [configured] | Equal |
| `NODE_ENV` | [configured] | [configured] | Equal |
| `PORT` | [configured] | [configured] | Equal |
| `PRODUCTION_SERVING_MODE` | live | live | Equal |
| `PUBLIC_BASE_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `QUEUE_ENABLED` | true | true | Equal |
| `S3_BUCKET` | [configured] | [configured] | Expected environment identity / infrastructure |
| `S3_REGION` | [configured] | [configured] | Equal |
| `SERVICE_NAME` | [configured] | [configured] | Equal |
| `SERVICE_VERSION` | [configured] | [configured] | Equal |

Secret references: matching key sets are checked separately; each runtime reference must belong to its own environment.

- `DATABASE_URL`: configured in both environments; values not collected.
- `REDIS_URL`: configured in both environments; values not collected.
- `WORKER_INTERNAL_TOKEN`: configured in both environments; values not collected.

## agentcore

| Key | UAT | Production | Assessment |
| --- | --- | --- | --- |
| `AGENTCORE_ARTIFACT_SHA256` | [configured] | [configured] | Equal |
| `AGENTCORE_MAX_ATTACHMENTS` | 10 | 10 | Equal |
| `AGENTCORE_MAX_BODY_BYTES` | 1048576 | 1048576 | Equal |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | 16 | 16 | Equal |
| `AGENTCORE_MAX_MESSAGE_CHARS` | 8000 | 8000 | Equal |
| `AI_FINAL_MUTATION_ENABLED` | false | false | Equal |
| `AI_GATEWAY_INTERNAL_SECRET_ARN` | [configured] | [configured] | Expected environment identity / infrastructure |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | [configured] | [configured] | Equal |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` | true | true | Equal |
| `AI_MAX_TOOL_CALLS` | 8 | 8 | Equal |
| `AI_PROMPT_LOGGING_ENABLED` | false | false | Equal |
| `AI_TOOL_AUDIT_ENABLED` | true | true | Equal |
| `AI_TOOL_POLICY_ENFORCED` | true | true | Equal |
| `AI_TOOL_TIMEOUT_MS` | 15000 | 15000 | Equal |
| `APPROVED_AI_MODEL_IDS` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | Equal |
| `APPROVED_AI_PROVIDERS` | [configured] | [configured] | Equal |
| `APPROVED_AI_REGIONS` | [configured] | [configured] | Equal |
| `APP_ENV` | [configured] | [configured] | Equal |
| `BEDROCK_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | Equal |
| `BEDROCK_REGION` | [configured] | [configured] | Equal |
| `CORS_ALLOWED_ORIGINS` | [configured] | [configured] | Expected environment identity / infrastructure |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | Expected environment identity / infrastructure |
| `ERP_CORE_INTERNAL_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `GIT_SHA` | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | 604ac785479ced5b9858d0b46d89f8d11cf2b9f6 | Equal |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | Equal |
| `LINE_AI_DRAFT_EDIT_ENABLED` | true | true | Equal |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | true | true | Equal |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | true | true | Equal |
| `LOG_FORMAT` | [configured] | [configured] | Equal |
| `LOG_REDACTION_ENABLED` | true | true | Equal |
| `MODEL_PROVIDER` | bedrock | bedrock | Equal |
| `NODE_ENV` | [configured] | [configured] | Equal |
| `PORT` | [configured] | [configured] | Equal |
| `PUBLIC_BASE_URL` | [configured] | [configured] | Expected environment identity / infrastructure |
| `SERVICE_NAME` | [configured] | [configured] | Equal |
| `SERVICE_VERSION` | [configured] | [configured] | Equal |
| `WATCHDOG_JWT_AUDIENCE` | [configured] | [configured] | Expected environment identity / infrastructure |
| `WATCHDOG_JWT_ISSUER` | [configured] | [configured] | Expected environment identity / infrastructure |
| `WATCHDOG_JWT_SECRET_SOURCE_ARN` | [configured] | [configured] | Expected environment identity / infrastructure |

