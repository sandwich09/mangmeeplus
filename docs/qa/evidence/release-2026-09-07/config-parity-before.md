# UAT / Production config audit — ก่อน release 7 ก.ย. 2026

ตรวจเมื่อ 2026-09-06T17:30:41.008913+00:00 (UTC)

รายงานนี้เป็นสถานะก่อน deploy ไม่ใช่หลักฐานว่าปล่อย release สำเร็จแล้ว ค่า secret ไม่ถูกบันทึก; `[configured]` หมายถึงมีค่าและได้เทียบความเท่ากันในหน่วยความจำแล้ว โดยไม่แสดงเนื้อหา

## จุดที่แก้ใน release นี้

- Production เปิด LINE signup, web signup, AUTO_FREE, receipt quota และ LINE draft edit ตาม UAT; EMAIL_PROVIDER ยังคง disabled ตามคำสั่งล่าสุด
- AgentCore Production เปิด prepared/fused และ deterministic families 4 ตัวให้เหมือน UAT; เพิ่มการส่ง draft-edit flag เข้า AgentCore ทั้งสองฝั่ง
- API ของ prod รุ่นเก่าขาด 18 keys (signup/quota/budget/draft และ email metadata); deploy script รุ่นใหม่มีการสร้างครบ
- AI gateway, orchestration, registry และ tool policy/audit เปิดอยู่จริง; final mutation กับ prompt logging ปิดอยู่จริงตาม boundary เดิม
- Model ทั้ง chat/document ตรงกัน: global.anthropic.claude-sonnet-4-6

## ความต่างที่มีเหตุผล

- SHA, image/artifact และ service version จะเปลี่ยนตาม release เดียวกัน
- URLs, LINE/LIFF channels, JWT issuer/audience, DB/Redis/S3, roles และ secret references เป็นของ environment นั้น
- Production ใช้ log retention 14 วัน พร้อม KMS/security alerts; UAT 3 วัน ตาม deploy contract
- Production OA add/QR มีค่าอยู่แล้ว; UAT ว่าง ไม่ใช้ค่าว่างนี้ทับ Production
- GitHub UAT LINE_AI_AGENT_RUNTIME ยังเป็น strands-local แต่ all-target workflow แทนค่าด้วย agentcore + candidate binding ก่อน deploy; actual ECS เป็น agentcore ทั้งสองฝั่ง
- GitHub UAT บาง numeric settings ไม่มี variable แต่ workflow/defaults ทำให้ค่าที่ใช้งานจริงเท่ากับ prod
- Email delivery เป็นข้อยกเว้นที่เจ้าของเลื่อนไว้ เส้นทาง claim ทางอีเมลจึงยังไม่ใช่ journey ที่พร้อมครบใน prod

## ขอบเขตหลักฐาน

- ECS ใช้ describe-express-gateway-service และตรวจ singleton; ทั้ง 6 services ACTIVE
- AgentCore ใช้ ECS qualifier เทียบ endpoint mapping ที่อ่านจาก AWS Console: UAT version 53, Production version 17 แล้ว get-agent-runtime ด้วย version นั้น ไม่ใช้ latest version แทน
- Exact UAT/READY/Production ของ release ใหม่ยังไม่เริ่ม ต้องตรวจ snapshot หลัง deploy และ signed/customer acceptance อีกครั้ง
- LINE callback/LIFF endpoint/QR ตรง Production และ webhook Verify ผ่าน; พบ Login channel ยังไม่ linked กับ OA สำหรับ Add friend option ต้องแก้ในรอบ config
- READY รอบก่อน 34022420598 ผ่าน 7 checks และ clone rehearsal ของ migrations 15 ตัว; migration files ปัจจุบันยังตรงกัน นี่เป็น preflight context ไม่ใช่ READY สำหรับ release ใหม่

## จำนวน key ต่อ layer

| Layer | Equal | Different | Missing prod | Missing UAT |
| --- | ---: | ---: | ---: | ---: |
| github | 29 | 8 | 0 | 12 |
| api-web | 54 | 22 | 18 | 0 |
| ai-gateway | 41 | 12 | 1 | 0 |
| workers | 10 | 6 | 0 | 0 |
| agentcore | 24 | 14 | 0 | 0 |

## github — config ทุก key

| Key | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `AGENTCORE_INVOKE_TIMEOUT_MS` | ไม่มี | 20000 | UAT ไม่มี variable/key |
| `AGENTCORE_MAX_ATTACHMENTS` | 10 | 10 | เท่ากัน |
| `AGENTCORE_MAX_BODY_BYTES` | 1048576 | 1048576 | เท่ากัน |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | 16 | 16 | เท่ากัน |
| `AGENTCORE_MAX_MESSAGE_CHARS` | 8000 | 8000 | เท่ากัน |
| `AGENTCORE_REGION` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `AGENTCORE_RUNTIME_ARN` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `AGENTCORE_RUNTIME_QUALIFIER` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `AI_DATA_RETENTION_DAYS` | [configured] | [configured] | เท่ากัน |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | [configured] | [configured] | เท่ากัน |
| `AI_LLM_MAX_PER_COMPANY` | 60 | 60 | เท่ากัน |
| `AI_MONTHLY_BUDGET_SATANG` | 200000 | 200000 | เท่ากัน |
| `AI_MONTHLY_BUDGET_SATANG_CEILING` | 1000000 | 1000000 | เท่ากัน |
| `AI_OCR_MAX_PER_COMPANY` | 20 | 20 | เท่ากัน |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | 60 | 60 | เท่ากัน |
| `AI_THB_PER_USD` | [configured] | [configured] | เท่ากัน |
| `APPROVED_AI_PROVIDERS` | [configured] | [configured] | เท่ากัน |
| `APPROVED_AI_REGIONS` | [configured] | [configured] | เท่ากัน |
| `AWS_ACCOUNT_ID` | [configured] | [configured] | เท่ากัน |
| `AWS_DEPLOY_ROLE_ARN` | [configured] | [configured] | ต่างกัน |
| `AWS_REGION` | [configured] | [configured] | เท่ากัน |
| `AWS_ROLE_ARN` | [configured] | [configured] | ต่างกัน |
| `BEDROCK_REGION` | [configured] | [configured] | เท่ากัน |
| `CLAMAV_HOST` | [configured] | [configured] | เท่ากัน |
| `CLAMAV_PORT` | [configured] | [configured] | เท่ากัน |
| `CLAMAV_TIMEOUT_MS` | [configured] | [configured] | เท่ากัน |
| `CRM_AI_MIN_CONFIDENCE` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` | [configured] | [configured] | ต่างกัน |
| `CRM_AUTO_REPLY_ENABLED` | true | true | เท่ากัน |
| `DOCUMENT_AI_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | เท่ากัน |
| `LINE_AI_AGENT_RUNTIME` | strands-local | agentcore | ต่างกัน |
| `LINE_LIFF_ID` | [configured] | [configured] | ต่างกัน |
| `LINE_LOGIN_CHANNEL_ID` | [configured] | [configured] | ต่างกัน |
| `LINE_MESSAGING_CHANNEL_ID` | [configured] | [configured] | ต่างกัน |
| `LINE_OA_ADD_URL` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `LINE_OA_QR_IMAGE_URL` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `LOG_KMS_KEY_ID` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `MODEL_PROVIDER` | bedrock | bedrock | เท่ากัน |
| `PASSWORD_RESET_RESPONSE_MIN_MS` | [configured] | [configured] | เท่ากัน |
| `PUBLIC_DOMAIN_URL` | [configured] | [configured] | ต่างกัน |
| `REDIS_REPLICATION_GROUP_ID` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `SECURITY_ALERT_TOPIC_ARN` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `SESSION_REFRESH_MAX_PER_SESSION` | [configured] | [configured] | เท่ากัน |
| `SESSION_REFRESH_REUSE_GRACE_SECONDS` | [configured] | [configured] | เท่ากัน |
| `SESSION_REFRESH_WINDOW_SECONDS` | [configured] | [configured] | เท่ากัน |
| `SWAGGER_ENABLED` | false | false | เท่ากัน |
| `TYPHOON_PROCESSING_REGION` | [configured] | [configured] | เท่ากัน |
| `WEB_LINE_ACCOUNT_LINK_URL` | ไม่มี | [configured] | UAT ไม่มี variable/key |
| `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` | ไม่มี | [configured] | UAT ไม่มี variable/key |

## api-web — config ทุก key

| Key | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `AI_DATA_RETENTION_DAYS` | [configured] | [configured] | เท่ากัน |
| `AI_GATEWAY_ENABLED` | true | true | เท่ากัน |
| `AI_GATEWAY_INTERNAL_URL` | [configured] | [configured] | ต่างกัน |
| `AI_LLM_MAX_PER_COMPANY` | 60 | 60 | เท่ากัน |
| `AI_MONTHLY_BUDGET_SATANG` | 200000 | 200000 | เท่ากัน |
| `AI_MONTHLY_BUDGET_SATANG_CEILING` | 1000000 | 1000000 | เท่ากัน |
| `AI_OCR_MAX_PER_COMPANY` | 20 | 20 | เท่ากัน |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | 60 | 60 | เท่ากัน |
| `AI_THB_PER_USD` | [configured] | [configured] | เท่ากัน |
| `API_PORT` | [configured] | [configured] | เท่ากัน |
| `APP_ENV` | [configured] | [configured] | เท่ากัน |
| `AUDIT_ENABLED` | true | true | เท่ากัน |
| `AUTH_PROVIDER` | [configured] | [configured] | เท่ากัน |
| `CLAMAV_HOST` | [configured] | [configured] | เท่ากัน |
| `CLAMAV_PORT` | [configured] | [configured] | เท่ากัน |
| `CLAMAV_TIMEOUT_MS` | [configured] | [configured] | เท่ากัน |
| `CORS_ALLOWED_ORIGINS` | [configured] | [configured] | ต่างกัน |
| `CRM_AI_MIN_CONFIDENCE` | [configured] | [configured] | เท่ากัน |
| `CRM_AI_OUTBOUND_ALLOWED_DOMAINS` | [configured] | [configured] | ต่างกัน |
| `CRM_AUTO_REPLY_ENABLED` | true | true | เท่ากัน |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | ต่างกัน |
| `DEV_AUTH_ENABLED` | false | false | เท่ากัน |
| `EMAIL_LOGO_URL` | [configured] | ไม่มี | prod ยังไม่มี |
| `EMAIL_PROVIDER` | ses | ไม่มี | prod ยังไม่มี |
| `EXTERNAL_SIGNUP_ENABLED` | true | ไม่มี | prod ยังไม่มี |
| `GIT_SHA` | f2bd38edc11449f598332910e2cd3e402a1b7916 | a768e3a27aa0ffe5aaf848c23fea720b381a76b0 | ต่างกัน |
| `GLOBAL_MAINTENANCE_MODE` | false | false | เท่ากัน |
| `HOST` | [configured] | [configured] | เท่ากัน |
| `INTERNAL_API_URL` | [configured] | [configured] | ต่างกัน |
| `LINE_ACCOUNT_LINK_QR_IMAGE_URL` | [empty] | [empty] | เท่ากัน |
| `LINE_ACCOUNT_LINK_URL` | [configured] | [configured] | ต่างกัน |
| `LINE_AI_ADVISOR_MODE` | social | social | เท่ากัน |
| `LINE_AI_BUFFER_DEBOUNCE_MS` | 1000 | 1000 | เท่ากัน |
| `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED` | false | false | เท่ากัน |
| `LINE_AI_DRAFT_EDIT_ENABLED` | true | ไม่มี | prod ยังไม่มี |
| `LINE_AI_EXACT_GREETING_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_LEDGER_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_LOADING_ON_ACCEPT_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | true | true | เท่ากัน |
| `LINE_FREE_AI_BUDGET_SATANG` | 8000 | ไม่มี | prod ยังไม่มี |
| `LINE_LIFF_ID` | [configured] | [configured] | ต่างกัน |
| `LINE_LOGIN_CHANNEL_ID` | [configured] | [configured] | ต่างกัน |
| `LINE_MESSAGING_CHANNEL_ID` | [configured] | [configured] | ต่างกัน |
| `LINE_OA_ADD_URL` | [empty] | [configured] | ต่างกัน |
| `LINE_OA_QR_IMAGE_URL` | [empty] | [configured] | ต่างกัน |
| `LINE_SIGNUP_ADMIN_ALERT_BUDGET_EXHAUSTED_PER_DAY` | 5 | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_ADMIN_REMINDER_MINUTES` | 60 | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_APPROVAL_MODE` | AUTO_FREE | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_AUTO_DAILY_CAP` | 20 | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_BUSINESS_DAYS` | MON-SAT | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_BUSINESS_HOURS` | 09:00-18:00 | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_ENABLED` | true | ไม่มี | prod ยังไม่มี |
| `LINE_SIGNUP_WARMUP_SLIPS` | 10 | ไม่มี | prod ยังไม่มี |
| `LINE_WEB_HANDOFF_ENABLED` | true | true | เท่ากัน |
| `LINE_WEB_LOGIN_ENABLED` | true | true | เท่ากัน |
| `LOG_FORMAT` | [configured] | [configured] | เท่ากัน |
| `LOG_REDACTION_ENABLED` | true | true | เท่ากัน |
| `NEXT_PUBLIC_AI_GATEWAY_BASE_URL` | [configured] | [configured] | เท่ากัน |
| `NEXT_PUBLIC_API_BASE_URL` | [configured] | [configured] | เท่ากัน |
| `NEXT_PUBLIC_API_URL` | [configured] | [configured] | เท่ากัน |
| `NEXT_PUBLIC_APP_ENV` | [configured] | [configured] | เท่ากัน |
| `NEXT_PUBLIC_LIFF_ID` | [configured] | [configured] | ต่างกัน |
| `NEXT_PUBLIC_LINE_ACCOUNT_LINK_QR_IMAGE_URL` | [empty] | [empty] | เท่ากัน |
| `NEXT_PUBLIC_LINE_ACCOUNT_LINK_URL` | [configured] | [configured] | ต่างกัน |
| `NEXT_PUBLIC_LINE_OA_ADD_URL` | [empty] | [configured] | ต่างกัน |
| `NEXT_PUBLIC_LINE_OA_QR_IMAGE_URL` | [empty] | [configured] | ต่างกัน |
| `NODE_ENV` | [configured] | [configured] | เท่ากัน |
| `PASSWORD_RESET_RESPONSE_MIN_MS` | [configured] | [configured] | เท่ากัน |
| `PORT` | [configured] | [configured] | เท่ากัน |
| `PRODUCTION_SERVING_MODE` | live | live | เท่ากัน |
| `PUBLIC_BASE_URL` | [configured] | [configured] | ต่างกัน |
| `RATE_LIMIT_ENABLED` | true | true | เท่ากัน |
| `RATE_LIMIT_MAX_REQUESTS` | [configured] | [configured] | เท่ากัน |
| `RATE_LIMIT_WINDOW_SECONDS` | [configured] | [configured] | เท่ากัน |
| `RECEIPT_QUOTA_ENFORCED` | true | ไม่มี | prod ยังไม่มี |
| `REIMBURSEMENT_WRITE_QUIESCE` | false | false | เท่ากัน |
| `S3_BUCKET` | [configured] | [configured] | ต่างกัน |
| `S3_REGION` | [configured] | [configured] | เท่ากัน |
| `SERVICE_NAME` | [configured] | [configured] | เท่ากัน |
| `SERVICE_VERSION` | [configured] | [configured] | ต่างกัน |
| `SESSION_REFRESH_MAX_PER_SESSION` | [configured] | [configured] | เท่ากัน |
| `SESSION_REFRESH_REUSE_GRACE_SECONDS` | [configured] | [configured] | เท่ากัน |
| `SESSION_REFRESH_WINDOW_SECONDS` | [configured] | [configured] | เท่ากัน |
| `SES_CONFIGURATION_SET` | [configured] | ไม่มี | prod ยังไม่มี |
| `SES_EVENTS_TOPIC_ARN` | [configured] | ไม่มี | prod ยังไม่มี |
| `SES_FROM_ADDRESS` | [configured] | ไม่มี | prod ยังไม่มี |
| `SES_REGION` | [configured] | ไม่มี | prod ยังไม่มี |
| `SWAGGER_ENABLED` | false | false | เท่ากัน |
| `WATCHDOG_JWT_AUDIENCE` | [configured] | [configured] | ต่างกัน |
| `WATCHDOG_JWT_ISSUER` | [configured] | [configured] | ต่างกัน |
| `WEB_BASE_URL` | [configured] | [configured] | ต่างกัน |
| `WEB_PORT` | [configured] | [configured] | เท่ากัน |
| `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` | [configured] | [configured] | เท่ากัน |

### api-web — secret reference names

| Name | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `AI_ACTOR_DELEGATION_SIGNING_KEY` | reference | reference | ต่างกัน (คนละ environment) |
| `AI_GATEWAY_INTERNAL_SECRET` | reference | reference | ต่างกัน (คนละ environment) |
| `CREDENTIAL_ENCRYPTION_KEY` | reference | reference | ต่างกัน (คนละ environment) |
| `DATABASE_URL` | reference | reference | ต่างกัน (คนละ environment) |
| `LINE_LOGIN_CHANNEL_SECRET` | reference | reference | ต่างกัน (คนละ environment) |
| `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` | reference | reference | ต่างกัน (คนละ environment) |
| `LINE_MESSAGING_CHANNEL_SECRET` | reference | reference | ต่างกัน (คนละ environment) |
| `PDPA_PSEUDONYMIZATION_KEY` | reference | reference | ต่างกัน (คนละ environment) |
| `PDPA_PSEUDONYMIZATION_PREVIOUS_KEYS` | reference | reference | ต่างกัน (คนละ environment) |
| `REDIS_URL` | reference | reference | ต่างกัน (คนละ environment) |
| `WATCHDOG_JWT_SECRET_ARN` | reference | reference | ต่างกัน (คนละ environment) |
| `WORKER_INTERNAL_TOKEN` | reference | reference | ต่างกัน (คนละ environment) |

## ai-gateway — config ทุก key

| Key | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `AGENTCORE_EXPECTED_ARTIFACT_SHA256` | [configured] | [configured] | ต่างกัน |
| `AGENTCORE_EXPECTED_CONTRACT_VERSION` | [configured] | [configured] | เท่ากัน |
| `AGENTCORE_EXPECTED_SOURCE_COMMIT` | [configured] | [configured] | ต่างกัน |
| `AGENTCORE_INVOKE_TIMEOUT_MS` | 20000 | 20000 | เท่ากัน |
| `AGENTCORE_MAX_ATTACHMENTS` | 10 | 10 | เท่ากัน |
| `AGENTCORE_MAX_BODY_BYTES` | 1048576 | 1048576 | เท่ากัน |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | 16 | 16 | เท่ากัน |
| `AGENTCORE_MAX_MESSAGE_CHARS` | 8000 | 8000 | เท่ากัน |
| `AGENTCORE_REGION` | [configured] | [configured] | เท่ากัน |
| `AGENTCORE_RUNTIME_ARN` | [configured] | [configured] | ต่างกัน |
| `AGENTCORE_RUNTIME_QUALIFIER` | [configured] | [configured] | ต่างกัน |
| `AI_AGENT_REGISTRY_ENABLED` | true | true | เท่ากัน |
| `AI_FINAL_MUTATION_ENABLED` | false | false | เท่ากัน |
| `AI_GATEWAY_ENABLED` | true | true | เท่ากัน |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | [configured] | [configured] | เท่ากัน |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` | true | true | เท่ากัน |
| `AI_MAX_TOOL_CALLS` | 8 | 8 | เท่ากัน |
| `AI_PROMPT_LOGGING_ENABLED` | false | false | เท่ากัน |
| `AI_TOOL_AUDIT_ENABLED` | true | true | เท่ากัน |
| `AI_TOOL_POLICY_ENFORCED` | true | true | เท่ากัน |
| `AI_TOOL_TIMEOUT_MS` | 15000 | 15000 | เท่ากัน |
| `APPROVED_AI_MODEL_IDS` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | เท่ากัน |
| `APPROVED_AI_PROVIDERS` | [configured] | [configured] | เท่ากัน |
| `APPROVED_AI_REGIONS` | [configured] | [configured] | เท่ากัน |
| `APP_ENV` | [configured] | [configured] | เท่ากัน |
| `AWS_REGION` | [configured] | [configured] | เท่ากัน |
| `BEDROCK_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | เท่ากัน |
| `BEDROCK_REGION` | [configured] | [configured] | เท่ากัน |
| `CORS_ALLOWED_ORIGINS` | [configured] | [configured] | ต่างกัน |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | ต่างกัน |
| `DOCUMENT_AI_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | เท่ากัน |
| `ERP_CORE_INTERNAL_URL` | [configured] | [configured] | ต่างกัน |
| `GIT_SHA` | f2bd38edc11449f598332910e2cd3e402a1b7916 | a768e3a27aa0ffe5aaf848c23fea720b381a76b0 | ต่างกัน |
| `HOST` | [configured] | [configured] | เท่ากัน |
| `LINE_AI_AGENT_ORCHESTRATION_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_AGENT_RUNTIME` | agentcore | agentcore | เท่ากัน |
| `LINE_AI_COVERAGE_CRITIC_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | เท่ากัน |
| `LINE_AI_DRAFT_EDIT_ENABLED` | true | ไม่มี | prod ยังไม่มี |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | true | true | เท่ากัน |
| `LINE_AI_TOOLUSE_LOOP_ENABLED` | true | true | เท่ากัน |
| `LOG_FORMAT` | [configured] | [configured] | เท่ากัน |
| `LOG_REDACTION_ENABLED` | true | true | เท่ากัน |
| `MODEL_PROVIDER` | bedrock | bedrock | เท่ากัน |
| `NODE_ENV` | [configured] | [configured] | เท่ากัน |
| `PORT` | [configured] | [configured] | เท่ากัน |
| `PRODUCTION_SERVING_MODE` | live | live | เท่ากัน |
| `PUBLIC_BASE_URL` | [configured] | [configured] | ต่างกัน |
| `SERVICE_NAME` | [configured] | [configured] | เท่ากัน |
| `SERVICE_VERSION` | [configured] | [configured] | ต่างกัน |
| `SWAGGER_ENABLED` | false | false | เท่ากัน |
| `WATCHDOG_JWT_AUDIENCE` | [configured] | [configured] | ต่างกัน |
| `WATCHDOG_JWT_ISSUER` | [configured] | [configured] | ต่างกัน |

### ai-gateway — secret reference names

| Name | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `AI_GATEWAY_INTERNAL_SECRET` | reference | reference | ต่างกัน (คนละ environment) |
| `WATCHDOG_JWT_SECRET_ARN` | reference | reference | ต่างกัน (คนละ environment) |

## workers — config ทุก key

| Key | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `APP_ENV` | [configured] | [configured] | เท่ากัน |
| `AWS_REGION` | [configured] | [configured] | เท่ากัน |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | ต่างกัน |
| `GIT_SHA` | f2bd38edc11449f598332910e2cd3e402a1b7916 | a768e3a27aa0ffe5aaf848c23fea720b381a76b0 | ต่างกัน |
| `HOST` | [configured] | [configured] | เท่ากัน |
| `INTERNAL_API_URL` | [configured] | [configured] | ต่างกัน |
| `LOG_FORMAT` | [configured] | [configured] | เท่ากัน |
| `NODE_ENV` | [configured] | [configured] | เท่ากัน |
| `PORT` | [configured] | [configured] | เท่ากัน |
| `PRODUCTION_SERVING_MODE` | live | live | เท่ากัน |
| `PUBLIC_BASE_URL` | [configured] | [configured] | ต่างกัน |
| `QUEUE_ENABLED` | true | true | เท่ากัน |
| `S3_BUCKET` | [configured] | [configured] | ต่างกัน |
| `S3_REGION` | [configured] | [configured] | เท่ากัน |
| `SERVICE_NAME` | [configured] | [configured] | เท่ากัน |
| `SERVICE_VERSION` | [configured] | [configured] | ต่างกัน |

### workers — secret reference names

| Name | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `DATABASE_URL` | reference | reference | ต่างกัน (คนละ environment) |
| `REDIS_URL` | reference | reference | ต่างกัน (คนละ environment) |
| `WORKER_INTERNAL_TOKEN` | reference | reference | ต่างกัน (คนละ environment) |

## agentcore — config ทุก key

| Key | UAT | Production | ผลเทียบ |
| --- | --- | --- | --- |
| `AGENTCORE_ARTIFACT_SHA256` | [configured] | [configured] | ต่างกัน |
| `AGENTCORE_MAX_ATTACHMENTS` | 10 | 10 | เท่ากัน |
| `AGENTCORE_MAX_BODY_BYTES` | 1048576 | 1048576 | เท่ากัน |
| `AGENTCORE_MAX_CONCURRENT_INVOCATIONS` | 16 | 16 | เท่ากัน |
| `AGENTCORE_MAX_MESSAGE_CHARS` | 8000 | 8000 | เท่ากัน |
| `AI_FINAL_MUTATION_ENABLED` | false | false | เท่ากัน |
| `AI_GATEWAY_INTERNAL_SECRET_ARN` | [configured] | [configured] | ต่างกัน |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` | [configured] | [configured] | เท่ากัน |
| `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` | true | true | เท่ากัน |
| `AI_MAX_TOOL_CALLS` | 8 | 8 | เท่ากัน |
| `AI_PROMPT_LOGGING_ENABLED` | false | false | เท่ากัน |
| `AI_TOOL_AUDIT_ENABLED` | true | true | เท่ากัน |
| `AI_TOOL_POLICY_ENFORCED` | true | true | เท่ากัน |
| `AI_TOOL_TIMEOUT_MS` | 15000 | 15000 | เท่ากัน |
| `APPROVED_AI_MODEL_IDS` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | เท่ากัน |
| `APPROVED_AI_PROVIDERS` | [configured] | [configured] | เท่ากัน |
| `APPROVED_AI_REGIONS` | [configured] | [configured] | เท่ากัน |
| `APP_ENV` | [configured] | [configured] | เท่ากัน |
| `BEDROCK_MODEL_ID` | global.anthropic.claude-sonnet-4-6 | global.anthropic.claude-sonnet-4-6 | เท่ากัน |
| `BEDROCK_REGION` | [configured] | [configured] | เท่ากัน |
| `CORS_ALLOWED_ORIGINS` | [configured] | [configured] | ต่างกัน |
| `DEPLOY_ENVIRONMENT` | [configured] | [configured] | ต่างกัน |
| `ERP_CORE_INTERNAL_URL` | [configured] | [configured] | ต่างกัน |
| `GIT_SHA` | f2bd38edc11449f598332910e2cd3e402a1b7916 | a768e3a27aa0ffe5aaf848c23fea720b381a76b0 | ต่างกัน |
| `LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES` | sales.get_sales_summary::single_metric,expense.list_recent::single_metric,accounting.get_summary::list,expense.get_daily_closing::single_metric | ว่าง | ต่างกัน |
| `LINE_AI_FUSED_PLAN_SHADOW_ENABLED` | true | false | ต่างกัน |
| `LINE_AI_PREPARED_SIMPLE_READ_ENABLED` | true | false | ต่างกัน |
| `LOG_FORMAT` | [configured] | [configured] | เท่ากัน |
| `LOG_REDACTION_ENABLED` | true | true | เท่ากัน |
| `MODEL_PROVIDER` | bedrock | bedrock | เท่ากัน |
| `NODE_ENV` | [configured] | [configured] | เท่ากัน |
| `PORT` | [configured] | [configured] | เท่ากัน |
| `PUBLIC_BASE_URL` | [configured] | [configured] | ต่างกัน |
| `SERVICE_NAME` | [configured] | [configured] | เท่ากัน |
| `SERVICE_VERSION` | [configured] | [configured] | ต่างกัน |
| `WATCHDOG_JWT_AUDIENCE` | [configured] | [configured] | ต่างกัน |
| `WATCHDOG_JWT_ISSUER` | [configured] | [configured] | ต่างกัน |
| `WATCHDOG_JWT_SECRET_SOURCE_ARN` | [configured] | [configured] | ต่างกัน |

## GitHub secret names

- UAT: TYPHOON_OCR_API_KEY
- Production: PRODUCTION_POLICY_READ_TOKEN
- Secret values ไม่ถูกอ่านจาก GitHub และไม่ถูกใส่ในรายงาน
