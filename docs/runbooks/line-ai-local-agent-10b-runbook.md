# LINE AI Local Agent Orchestration – Local Demo Runbook (Item 10B)

## Prerequisites

- Node.js 20+, pnpm 9+
- AWS CLI v2 for the primary Bedrock smoke; OpenAI API key is optional fallback only
- ngrok or Cloudflare Tunnel
- Local LINE Developer account with Messaging API channel

---

## 1. Model Provider Setup

Primary local real-model path uses Bedrock:

```bash
MODEL_PROVIDER=bedrock
BEDROCK_REGION=ap-southeast-1
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6
LINE_AI_AGENT_ORCHESTRATION_ENABLED=true
```

Never commit `.env` with AWS credentials, profile secrets, or provider keys.

Bedrock path uses AWS profile:

```bash
aws configure --profile watchdog-bedrock
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region name: ap-southeast-1
# Default output format: json
```

Verify:
```bash
aws sts get-caller-identity --profile watchdog-bedrock
```

---

## 2. Anthropic Use-Case Access Note

Bedrock model `global.anthropic.claude-sonnet-4-6` (or `global.anthropic.claude-haiku-4-5-20251001-v1:0`) requires:

1. Go to AWS Console → Amazon Bedrock → Model access (ap-southeast-1).
2. Request access for Anthropic Claude models.
3. If `PROVIDER_ACCESS_NOT_READY` error appears, submit the Anthropic use-case form via the console.
4. Approval takes 1–5 business days.

Fallback during wait: use `apac.anthropic.claude-3-haiku-20240307-v1:0` if available in your account.

---

## 3. Env Configuration

Copy `.env.example` to `.env` and fill in:

```bash
# AI Gateway – item 10B
MODEL_PROVIDER=bedrock
BEDROCK_REGION=ap-southeast-1
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6
LINE_AI_AGENT_ORCHESTRATION_ENABLED=true
LINE_AI_AGENT_RUNTIME=strands-local

# Optional fallback only:
# MODEL_PROVIDER=openai
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4.1-mini
AWS_PROFILE=watchdog-bedrock
# Must be true/false (the config schema rejects 1/0); "true" still enables AWS profile/config loading.
AWS_SDK_LOAD_CONFIG=true

# Keep all existing values (LINE channel, internal secrets, etc.)
AI_FINAL_MUTATION_ENABLED=false
AI_MAX_TOOL_CALLS=8
AI_TOOL_TIMEOUT_MS=15000
```

For safe no-model local run (tests only, no Bedrock calls):
```bash
MODEL_PROVIDER=disabled
LINE_AI_AGENT_ORCHESTRATION_ENABLED=false
```

---

## 4. Quota and Throttle Handling

- `PROVIDER_THROTTLED` → reduce concurrent LINE messages; orchestrator returns Thai safe message.
- `PROVIDER_ACCESS_NOT_READY` → check Bedrock console for use-case approval status.
- `PROVIDER_TIMEOUT` → increase `AI_TOOL_TIMEOUT_MS`; default 15000ms recommended for Sonnet.
- All provider errors are logged in AI Gateway with `msg: 'Orchestrator error'`; LINE reply is always safe Thai text.

---

## 5. Start Local Services

```bash
# Terminal 1: API (PostgreSQL, Redis must be running)
pnpm --filter @watchdog-bms/api dev

# Terminal 2: AI Gateway
pnpm --filter @watchdog-bms/ai-gateway dev

# Terminal 3: Web (optional, for receipt review deep-links)
pnpm --filter @watchdog-bms/web dev
```

---

## 6. Tunnel Setup

### ngrok:
```bash
ngrok http 3001
# Copy HTTPS URL: e.g. https://abc123.ngrok-free.app
```

### Cloudflare Tunnel:
```bash
cloudflared tunnel --url http://localhost:3001
```

---

## 7. LINE Webhook URL

1. Go to LINE Developers Console → Your Messaging API channel → Messaging API tab.
2. Set Webhook URL: `https://<tunnel-url-or-api-url>/v1/line/webhook`
3. Enable **Use webhook**.
4. Click **Verify** to confirm handshake.

---

## 8. Sample LINE Messages (Thai Multi-Command)

Send these to your LINE OA after linking your account:

```
ดูสต็อกสินค้าใกล้หมด
```
Expected: สินค้าใกล้หมด: X รายการ

```
สต็อกคงเหลือสินค้าทั้งหมด
```
Expected: สต็อกคงเหลือ: X รายการ

```
กำไรเดือนนี้เท่าไหร่
```
Expected: กำไรสุทธิ: X, สินทรัพย์รวม: Y

```
มีแจ้งเตือนอะไรบ้าง
```
Expected: • ข้อมูล... หรือ ไม่พบข้อมูลที่ตรงกัน

**Mutation refusal test:**
```
สั่งซื้อสินค้าเพิ่ม 100 ชิ้น
```
Expected: ⚠️ ขออภัย WatchDog AI ไม่สามารถดำเนินการนี้ผ่าน LINE ได้

**Unsupported module:**
```
คำนวณภาษีให้หน่อย
```
Expected: 📋 ขออภัย ฟีเจอร์นี้ยังไม่พร้อมใช้งานผ่าน LINE ในขณะนี้

**Receipt image upload:**
Send a receipt photo → Expected: 📋 รับรูปภาพแล้ว กรุณาตรวจสอบและบันทึกผ่านเว็บแอป

---

## 9. Rollback

To disable orchestration and revert to item 07 deterministic path:

```bash
LINE_AI_AGENT_ORCHESTRATION_ENABLED=false
```

Restart AI Gateway. No database migration required. Item 07 behavior is fully restored.

---

## 10. Known Limitations (Item 10B Local Demo)

| Limitation | Details |
|------------|---------|
| Receipt OCR/authenticity tools unimplemented | `receipt.*` tools return `unsupported_module`; manual web review required |
| `accounting.get_summary` unimplemented | Returns `UNSUPPORTED`; uses `ledger.get_financial_summary` as fallback |
| Single intent routing only | Multi-intent parallel dispatch can be added after provider/tool schema tests pass |
| Provider disabled path | `MODEL_PROVIDER=disabled` returns feature-unavailable output; no business keyword fallback |
| No final mutation | `AI_FINAL_MUTATION_ENABLED=false` enforced; no payments/approvals via LINE/AI |
| AgentCore Runtime artifacts added | `apps/ai-gateway/src/agentcore/runtime.ts` (GET /ping, POST /invocations) and `apps/ai-gateway/agentcore.json` (CodeZip config) are in repo. Local ai-gateway test/build pass. AWS deployment blocked by missing credentials/IAM role. AI Gateway invoke adapter (ARN + qualifier) not yet implemented. When credentials are available: `aws bedrock-agentcore create-runtime --region ap-southeast-1` then add ARN adapter in AI Gateway, invoke by ARN + qualifier only. |
| Receipt authenticity | Always returns LOW risk when tools unimplemented; upgrade when receipt endpoints exist |

---

## 11. Production Hosting (Phase 3 – Direct AI Gateway on ECS Fargate)

### Prerequisites

- AWS CLI v2 with admin or deploy role for ap-southeast-1
- Docker 24+
- ECR repository: `watchdog-bms-ai-gateway` (create once)
- ECS Fargate cluster already running (shared with API service)
- Secrets stored in Secrets Manager / SSM (see §11.2)

### 11.1 Build and Push Image

```bash
# Set your account id and desired image tag (use Git SHA in CI)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
IMAGE_TAG=$(git rev-parse --short HEAD)
REGION=ap-southeast-1
ECR_REPO="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/watchdog-bms-ai-gateway"

# Authenticate docker to ECR
aws ecr get-login-password --region $REGION | \
  docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"

# Build and push with immutable tag (never overwrite a sha tag)
docker build -f apps/ai-gateway/Dockerfile . --tag "$ECR_REPO:$IMAGE_TAG"
docker push "$ECR_REPO:$IMAGE_TAG"
```

Immutable tags must be enabled on the ECR repo:
```bash
aws ecr put-image-tag-mutability \
  --repository-name watchdog-bms-ai-gateway \
  --image-tag-mutability IMMUTABLE \
  --region $REGION
```

### 11.2 Required Secrets

Create these in Secrets Manager before first deploy. Replace values with real secrets (never commit):

| Secret / Parameter | Store | Key |
|--------------------|-------|-----|
| Redis connection string | Secrets Manager | `watchdog-bms/production/redis-url` |
| AI Gateway internal secret | Secrets Manager | `watchdog-bms/production/ai-gateway-internal-secret` |
| ERP Core internal URL (private API) | SSM Parameter | `watchdog-bms/production/erp-core-internal-url` |
| AI Gateway public base URL | SSM Parameter | `watchdog-bms/production/ai-gateway-public-base-url` |
| Service version | SSM Parameter | `watchdog-bms/production/service-version` |

`AI_GATEWAY_INTERNAL_SECRET` must match the value API reads for its `AI_GATEWAY_INTERNAL_SECRET`.

### 11.3 IAM Task Role

Create a task role (`watchdog-bms-ai-gateway-task-role`) with:

```bash
aws iam create-role \
  --role-name watchdog-bms-ai-gateway-task-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# Attach Bedrock invoke policy from repo
aws iam put-role-policy \
  --role-name watchdog-bms-ai-gateway-task-role \
  --policy-name watchdog-bms-bedrock-invoke \
  --policy-document file://infra/ai-gateway/bedrock-invoke-policy.json

# Allow task role to read the secrets defined in §11.2
aws iam attach-role-policy \
  --role-name watchdog-bms-ai-gateway-task-role \
  --policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite  # scope down in production
```

Replace `<ACCOUNT_ID>` in `infra/ai-gateway/bedrock-invoke-policy.json` with the real account ID before applying.

### 11.4 Register and Deploy

Fill `<ACCOUNT_ID>`, `<IMAGE_TAG>`, and `<GIT_SHA>` in `infra/ai-gateway/task-definition.template.json`, then:

`<GIT_SHA>` must be the full 40-hex commit, not the image-tag prefix. `APP_ENV=production` without
`DEPLOY_ENVIRONMENT` + `GIT_SHA` fails `validateProductionConfig` at boot (F1.5.1).


```bash
# Register task definition
aws ecs register-task-definition \
  --cli-input-json file://infra/ai-gateway/task-definition.template.json \
  --region $REGION

# Create or update service (private, no public ALB for ai-gateway)
aws ecs update-service \
  --cluster watchdog-bms-production \
  --service watchdog-bms-ai-gateway \
  --task-definition watchdog-bms-ai-gateway \
  --desired-count 1 \
  --region $REGION
```

Service network config: private subnets only, security group allowing inbound from API service SG on port 3002.

### 11.5 Update API Internal URL

Once the ECS service is running, update API's `AI_GATEWAY_INTERNAL_URL` to point to the private ALB or service discovery DNS:

```
AI_GATEWAY_INTERNAL_URL=http://ai-gateway.watchdog-bms.local:3002/v1
```

(Exact address depends on Cloud Map / private ALB DNS created during infra setup.)

### 11.6 Post-Deploy Smoke

```bash
# Health: should return {"status":"ok"}
curl -f http://<private-ai-gateway-url>/v1/health

# Confirm no DB connection (no Prisma, no RDS in env)
aws ecs describe-tasks --cluster watchdog-bms-production --tasks <task-arn> \
  --query 'tasks[].containers[].environment' | grep -i database  # must return empty

# Invoke real LINE AI turn via API (requires linked user + internal secret)
curl -s -X POST http://<api-url>/v1/internal/line-ai/turn \
  -H "x-internal-secret: <secret>" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"smoke-01","messageText":"ดูสรุปยอดขาย","userContext":{...}}'
```

Log check: CloudWatch log group `/watchdog-bms/production/ai-gateway` — confirm no raw prompt text, no stack traces.

### 11.7 Rollback

```bash
# Revert to previous task definition revision
aws ecs update-service \
  --cluster watchdog-bms-production \
  --service watchdog-bms-ai-gateway \
  --task-definition watchdog-bms-ai-gateway:<PREVIOUS_REVISION> \
  --region $REGION
```

Or set `AI_GATEWAY_ENABLED=false` in API env to stop routing to AI Gateway entirely.

---

## 12. LINE E2E Real Smoke (Phase 7)

### Prerequisites

| Requirement | Details |
|-------------|---------|
| Local API running | `pnpm --filter @watchdog-bms/api dev` (port 3001) |
| Local AI Gateway running | `pnpm --filter @watchdog-bms/ai-gateway dev` (port 3002) |
| Postgres + Redis running | via docker-compose or local services |
| Dev env vars | `LINE_MESSAGING_CHANNEL_SECRET`, `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN`, `LINE_MESSAGING_CHANNEL_ID` set in API `.env` |
| AI Gateway env vars | `MODEL_PROVIDER=bedrock` (or `disabled` for signature-only test), `AI_GATEWAY_INTERNAL_SECRET` matching API |
| LINE identity seeded | `ExternalIdentity` row with `provider='LINE'`, `status='ACTIVE'`, linked to a user with an active company membership that has the `line.ai.query` permission |

Seed the LINE identity in the dev database:

```sql
-- Replace <uuid>, <internal-user-id>, <line-user-id> with actual values
INSERT INTO "ExternalIdentity" (id, "userId", provider, "providerUserId", status, "createdAt", "updatedAt")
VALUES ('<uuid>', '<internal-user-id>', 'LINE', '<line-user-id>', 'ACTIVE', now(), now())
ON CONFLICT DO NOTHING;
```

### 12.1 Local Webhook Smoke (No LINE Account Needed)

This validates HMAC signature verification + identity resolution + AI Gateway call path **without ngrok or LINE Developer Console**.

```bash
# Thai inventory query
LINE_MESSAGING_CHANNEL_SECRET=<secret> \
LINE_LOCAL_USER_ID=<line-user-id> \
tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts

# Mutation refusal
LINE_MESSAGING_CHANNEL_SECRET=<secret> \
LINE_LOCAL_USER_ID=<line-user-id> \
SMOKE_SCENARIO=mutation \
tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts

# Company list (/companies command)
LINE_MESSAGING_CHANNEL_SECRET=<secret> \
LINE_LOCAL_USER_ID=<line-user-id> \
SMOKE_SCENARIO=companies \
tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts
```

**Expected output** — each should print `[line-smoke] PASS: status=200`. Then check API logs for:
- `LINE webhook received` (controller received it)
- `tool-policy:allow` or `tool-policy:deny` (policy gate ran)
- `LINE AI turn received` (AI Gateway got the request)
- No raw message text or LINE user ID in structured log output

**Failure codes:**
| Code | Cause |
|------|-------|
| `401 signature invalid` | `LINE_MESSAGING_CHANNEL_SECRET` mismatch between smoke script and API env |
| `401 secret not configured` | API `.env` missing `LINE_MESSAGING_CHANNEL_SECRET` |
| Connection refused | API not running on port 3001 |
| `UNLINKED_REPLY` in API logs | `LINE_LOCAL_USER_ID` not seeded in `ExternalIdentity` |

### 12.2 ngrok Tunnel Setup

```bash
ngrok http 3001
# or: cloudflared tunnel --url http://localhost:3001
# Copy HTTPS URL: e.g. https://abc123.ngrok-free.app
```

### 12.3 LINE Developer Console Configuration

1. Open LINE Developers Console → Your Messaging API channel → Messaging API tab.
2. Set Webhook URL: `https://<tunnel-url>/v1/line/webhook`
3. Enable **Use webhook**.
4. Click **Verify** → expect `200 OK` response.
5. Disable **Auto-reply messages** and **Greeting messages** to avoid noise.

### 12.4 Link LINE User to WatchDog Account

1. Open WatchDog web app → Account Settings → LINE Integration.
2. Scan the QR code or click the link LINE button.
3. Complete LINE OAuth → the `ExternalIdentity` record is created in production-shaped DB.
4. Alternatively for dev: seed `ExternalIdentity` manually (see §12 Prerequisites).

### 12.5 Smoke Messages to Send via LINE

Send these messages in order and record the response + API log evidence:

| # | Message | Expected outcome |
|---|---------|-----------------|
| 1 | `/companies` | Company list or UNLINKED message |
| 2 | `ดูสต็อกสินค้าใกล้หมด` | Inventory low stock summary or PROVIDER_DISABLED safe error |
| 3 | `สรุปยอดขายเดือนนี้` | Sales summary or PROVIDER_DISABLED safe error |
| 4 | `มีแจ้งเตือนอะไรบ้าง` | Alert list or safe error |
| 5 | `สั่งซื้อสินค้าเพิ่ม 100 ชิ้น` | **Must** return mutation refusal: `ขออภัย WatchDog AI ไม่สามารถดำเนินการนี้ผ่าน LINE ได้` |
| 6 | `คำนวณภาษีให้หน่อย` | Unsupported module message |
| 7 | Send receipt image | Draft evidence reply with web link, or `unsupported_module` notice |

**Critical pass/fail:**
- Message 5 (mutation) **must** return refusal — any other response is a blocking failure.
- All responses must be in Thai if the message is in Thai.
- Web link in responses must resolve to the correct page (if `PUBLIC_BASE_URL` is configured).

### 12.6 Evidence to Record in Agent Memory

After real LINE smoke, update `docs/agent-memory/ai-runtime-production-integration.md` Phase 7 section with:

```
- Date/time of smoke: YYYY-MM-DD HH:MM UTC+7
- Environment: local / ECS / AgentCore
- Provider/model: bedrock / global.anthropic.claude-sonnet-4-6 / disabled
- Runtime mode: strands-local / agentcore / disabled
- Smoke results:
  - /companies: PASS | FAIL | UNLINKED (reason)
  - Thai inventory query: PASS | FAIL (errorCode if any)
  - Mutation refusal: PASS | FAIL (CRITICAL)
  - Unsupported module: PASS | FAIL
  - Receipt image: PASS | FAIL | unsupported_module (expected)
- Audit log verified: yes | no
- Prompt text in logs: not present | FOUND (BLOCKING)
- Web link verified: yes | not configured
```

### 12.7 Rollback

```bash
# Disable AI Gateway routing (API falls through to deterministic item 07 path)
# In API .env:
AI_GATEWAY_ENABLED=false

# Disable local orchestrator entirely
LINE_AI_AGENT_ORCHESTRATION_ENABLED=false

# Restore: set both back to true and restart API + AI Gateway
```

---

## 13. Observability, Cost Guard, and Secret Rotation (Phase 8)

### 13.1 Structured Log Events (AI Gateway)

Every production-relevant event emits a structured JSON log. Use these for CloudWatch metric filters.

| msg field | When emitted | Key fields |
|-----------|-------------|------------|
| `ai.turn.complete` | Every completed turn (both paths) | `requestId`, `companyId`, `intent`, `agent`, `refused`, `refusalReason`, `toolCount`, `durationMs` |
| `ai.turn.error` | Orchestrator or AgentCore unhandled error | `requestId`, `companyId`, `error` |
| `tool-policy:allow` | Tool passed policy gate | `toolName`, `userId`, `companyId` |
| `tool-policy:deny` | Tool blocked by policy gate | `toolName`, `userId`, `reason` |
| `ai.tool.invoke.error` | ERP API timeout or network error (was `ERP tool call timeout/error` before L-14) | `toolName`, `error` |
| `AgentCore invoke error` | AgentCore invocation failed | `code`, `error` |
| `LINE AI turn received` | Turn received by controller | `requestId` |

**Log redaction:** `pino` with `AI_LOG_REDACTION_ENABLED=true` (default in production) redacts `prompt`, `secret`, `token`, `password`, `key`, `credential`, `cookie`, `authorization` — both at root level and nested. Verified by `src/common/logger/logger.spec.ts`.

### 13.2 CloudWatch Metric Filters

Apply these on log group `/watchdog-bms/production/ai-gateway`:

```json
[
  {
    "filterName": "AiTurnCount",
    "filterPattern": "{ $.msg = \"ai.turn.complete\" }",
    "metricName": "AiTurnCount",
    "metricNamespace": "WatchDog/AIGateway",
    "metricValue": "1"
  },
  {
    "filterName": "AiTurnRefused",
    "filterPattern": "{ $.msg = \"ai.turn.complete\" && $.refused = true }",
    "metricName": "AiTurnRefused",
    "metricNamespace": "WatchDog/AIGateway",
    "metricValue": "1"
  },
  {
    "filterName": "AiMutationBlocked",
    "filterPattern": "{ $.msg = \"ai.turn.complete\" && $.refusalReason = \"mutation_blocked\" }",
    "metricName": "AiMutationBlocked",
    "metricNamespace": "WatchDog/AIGateway",
    "metricValue": "1"
  },
  {
    "filterName": "AiToolPolicyDeny",
    "filterPattern": "{ $.msg = \"tool-policy:deny\" }",
    "metricName": "AiToolPolicyDeny",
    "metricNamespace": "WatchDog/AIGateway",
    "metricValue": "1"
  },
  {
    "filterName": "AiToolTimeout",
    "filterPattern": "{ $.msg = \"ai.tool.invoke.error\" }",
    "metricName": "AiToolTimeout",
    "metricNamespace": "WatchDog/AIGateway",
    "metricValue": "1"
  },
  {
    "filterName": "AiRuntimeError",
    "filterPattern": "{ $.msg = \"AgentCore invoke error\" || $.msg = \"Orchestrator error\" }",
    "metricName": "AiRuntimeError",
    "metricNamespace": "WatchDog/AIGateway",
    "metricValue": "1"
  }
]
```

Apply via CLI:

```bash
REGION=ap-southeast-1
LOG_GROUP=/watchdog-bms/production/ai-gateway

for filter in AiTurnCount AiTurnRefused AiMutationBlocked AiToolPolicyDeny AiToolTimeout AiRuntimeError; do
  aws logs put-metric-filter \
    --log-group-name "$LOG_GROUP" \
    --filter-name "$filter" \
    --filter-pattern "$(jq -r ".[] | select(.filterName==\"$filter\") | .filterPattern" metric-filters.json)" \
    --metric-transformations metricName="$filter",metricNamespace="WatchDog/AIGateway",metricValue=1 \
    --region "$REGION"
done
```

### 13.3 Recommended Pilot Alarms

For a limited pilot (not full production SLA), watch these manually or set low-severity alarms:

| Alarm | Condition | Action |
|-------|-----------|--------|
| High refusal rate | `AiTurnRefused / AiTurnCount > 0.5` for 5 min | Check provider health |
| Mutation blocked anomaly | `AiMutationBlocked > 0` in 1 min | Verify refusal is working; investigate if unexpected |
| Tool deny spike | `AiToolPolicyDeny > 10` in 5 min | Check AI_TOOL_POLICY_ENFORCED env; may indicate config drift |
| Runtime errors | `AiRuntimeError > 5` in 5 min | Check AgentCore status; check provider errors |
| Tool timeouts | `AiToolTimeout > 3` in 5 min | Check ERP Core API health; check AI_TOOL_TIMEOUT_MS |

### 13.4 AWS Cost Guard

**Before sustained testing**, set an AWS budget alert:

```bash
aws budgets create-budget \
  --account-id $(aws sts get-caller-identity --query Account --output text) \
  --budget '{
    "BudgetName": "watchdog-ai-gateway-pilot",
    "BudgetLimit": { "Amount": "50", "Unit": "USD" },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST",
    "CostFilters": { "Service": ["Amazon Bedrock"] }
  }' \
  --notifications-with-subscribers '[{
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [{ "SubscriptionType": "EMAIL", "Address": "ops@watchdog-bms.com" }]
  }]'
```

**Bedrock cost factors** (ap-southeast-1, Claude Sonnet 4.6):
- Input tokens: ~$3 / million
- Output tokens: ~$15 / million
- Typical LINE turn: ~500 input + ~200 output tokens ≈ $0.0045 / turn
- 1000 turns/day ≈ $4.50/day ≈ $135/month → set budget at $50/month for pilot (≈ 330 turns/day cap warning)

**Model provider fallback**: if Bedrock costs exceed threshold, set `MODEL_PROVIDER=disabled` in AI Gateway env (no redeploy required if using Secrets Manager/SSM for the value).

### 13.5 Log Leak Verification

After first real deployment, verify no prompt text appears in logs:

```bash
# Check most recent 100 AI gateway log events for any 'prompt' field content
aws logs filter-log-events \
  --log-group-name /watchdog-bms/production/ai-gateway \
  --filter-pattern "prompt" \
  --max-items 20 \
  --region ap-southeast-1 \
  --query 'events[].message' | grep -i prompt

# Expected: zero results. Any result containing actual Thai/English text is a BLOCKING issue.
# '[REDACTED]' is acceptable (shows redaction is working but the field was present).
```

### 13.6 Secret Rotation Schedule

| Secret | Rotation | Method |
|--------|----------|--------|
| `AI_GATEWAY_INTERNAL_SECRET` | 90 days | Rotate in Secrets Manager; update both API and AI Gateway task definitions simultaneously; verify health after rotation |
| `LINE_MESSAGING_CHANNEL_ACCESS_TOKEN` | Per LINE policy (long-lived) | Rotate in LINE Developers Console; update API secret; restart API task |
| `LINE_MESSAGING_CHANNEL_SECRET` | On compromise only | Rotate in LINE Developers Console; update API secret; verify HMAC verification still works with local smoke |
| AWS Bedrock credentials | Per IAM key rotation policy | Use IAM role for ECS tasks (no static key); role credentials rotate automatically |
| `OPENAI_API_KEY` (if used) | 90 days | Rotate in OpenAI dashboard; update API Gateway secret |

**Rotation procedure for `AI_GATEWAY_INTERNAL_SECRET`:**
1. Generate new secret: `openssl rand -base64 32`
2. Update Secrets Manager value.
3. Force new ECS task revision for both API service and AI Gateway service.
4. Wait for both services healthy.
5. Run local webhook smoke to verify: `SMOKE_SCENARIO=query tsx apps/api/src/modules/line-ai/line-webhook-local-smoke.ts`.
6. Record rotation date.
