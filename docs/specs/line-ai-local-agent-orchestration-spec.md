# LINE AI Local Agent Orchestration Spec

## 1. Status

Partially implemented locally on 2026-06-27. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 10B.

Follow-up (2026-07-07): item 10F [[specs/line-ai-multi-intent-completion-spec|LINE AI Multi-Intent Completion and Value Grounding Spec]] extends this design — it replaces the JSON one-tool-at-a-time orchestration loop with a native tool-use loop plus coverage critic, adds a per-chat Redis Streams turn ledger (ADR 0010), and adds Thai money/date value grounding with a canonical วัน/เดือน/ปี พ.ศ. convention (ADR 0011). The safety boundaries in this spec (allowlists, grounding, fail-closed, no mutations) are unchanged and inherited there.

Current verified state: TypeScript AI Gateway agents, provider-disabled fail-closed path, provider JSON routing, per-agent tool allowlists, governed ERP tool policy path, AgentCore-compatible `/ping` and `/invocations`, and CodeZip config are in repo. Item 10B is not complete until real local LINE smoke and AgentCore Runtime deploy/invoke evidence or owner-accepted external blockers are recorded.

Active implementer target: Sonnet 4.6 or later.

## 2. Goal

Create a local-playable AI agent slice where a real LINE message can reach WatchDog-BMS, run through Strands agents, call permission-checked WatchDog tools, use a real Bedrock model credential, and reply to LINE. After the local loop is proven, package the same logical agent service and deploy it to Amazon Bedrock AgentCore Runtime on AWS.

This item proves the product agent architecture locally first, then promotes the agent runtime to AWS. It must be useful for local demos, pilot testing, and first production AgentCore Runtime deployment, but it must keep the current WatchDog safety boundary:

- LINE is a daily assistant channel.
- Web remains the source-of-truth workspace.
- AI can read, summarize, suggest, and create draft/evidence capture only.
- AI cannot perform final accounting, stock, tax, approval, payment, permission, export, close-period, or external publishing mutations.

## 3. Why Item 10B Exists

Items 07 and 09 already support LINE AI read/report/capture boundaries. Item 10A gives partner onboarding, feature entitlement, approved AI model selection, and shared LINE OA context. Item 10B adds the next product capability: real agent orchestration with one orchestrator and one specialist per job, then deploys that governed service boundary to Bedrock AgentCore Runtime after local safety proof.

This item is intentionally before Thai Tax MVP because it gives later modules a stable AI runtime/tool pattern.

## 4. Non-goals

- Production AgentCore Gateway, Memory, Browser, or Code Interpreter wiring beyond the minimum AgentCore Runtime hosting path.
- Autonomous final business actions.
- Direct database access from AI Gateway or agents.
- Free-form SQL, arbitrary tool execution, or model-generated API paths.
- New public customer chatbot.
- CRM, employee, payroll, tax, procurement, bank, manufacturing, or marketing specialist agents beyond stubs/refusals unless the source modules and tools already exist.
- Long-term personal memory beyond current conversation and auditable turn records.
- Replacing item 17 AI Draft and Suggestion Layer.

## 5. Users

- Owner: asks in LINE for business summary, low-stock risks, receipt review status, and what needs attention.
- Accountant/finance: asks for receipt OCR/draft evidence status and accounting summaries that existing modules can support.
- Inventory staff: asks for low stock, stock balance, and movement summaries within location/branch permission scope.
- Manager: asks for daily summary and open alerts within allowed scope.
- Unlinked LINE user: receives account-link guidance only.
- Unauthorized linked user: receives safe refusal without hidden record counts.

## 6. User Journey

### Linked LINE Text

1. User sends a LINE message such as "สรุปยอดวันนี้ เช็คของใกล้หมด และมีบิลไหนต้องตรวจบ้าง".
2. `apps/api` verifies LINE webhook signature with raw body.
3. API resolves LINE identity, active company membership, selected company context, feature entitlement, approved model, and permission grants.
4. API forwards sanitized turn input to AI Gateway using the existing internal secret boundary.
5. AI Gateway calls the local Orchestrator Agent.
6. Orchestrator calls LINE Intake Router Agent.
7. LINE Intake Router Agent semantically classifies message, attachment, and conversation context into intake routes such as read-only question, expense-document capture, business-document reference, signature-upload ticket, unsupported mutation, or clarify.
8. LINE Intake Router Agent returns a structured multi-intent plan.
9. Orchestrator dispatches each intent to one specialist agent or source-module intake use case.
10. Specialist agents can call only their allowlisted tools.
11. Tools call permission-checked API endpoints/use cases, never Prisma directly.
12. Response Composer Agent merges specialist outputs into short Thai LINE text with source refs or web links.
13. API replies to LINE and writes audit/turn records.

### Linked LINE Receipt Image

1. User sends image/PDF receipt or slip in LINE.
2. API verifies signature, downloads media server-side, hashes attachment, and stores evidence through existing attachment/expense primitives.
3. AI Gateway sees attachment metadata and routes to Receipt OCR Agent.
4. Receipt OCR Agent extracts draft fields with confidence and provenance.
5. Receipt Authenticity Agent scores risk using available signals.
6. Draft/evidence capture can be created or updated only through existing permission-checked draft APIs.
7. High-risk or low-confidence result requires human review in web.
8. LINE reply summarizes draft status and links to review page.

### Unlinked or Ambiguous Company Context

1. API must not call AI Gateway or ERP tools.
2. LINE reply asks user to link account or select company through LIFF/web.
3. Audit records denied/ambiguous access without business data.

## 7. Agent Map

Item 10B defines logical agents first and runtime packaging second. The first pass can keep the current TypeScript AI Gateway adapter, then package the same orchestration boundary with the current Strands/AgentCore SDK that is verified at implementation time.

| agent | owns | may call tools | may not do |
| --- | --- | --- | --- |
| Orchestrator Agent | turn control, policy enforcement, agent dispatch, result merge | intent router, specialist agents, response composer | domain calculation, direct DB, final mutation |
| LINE Intake Router Agent | first-stage LINE context and intent classification across text, images, PDFs, and conversation context; routes to read question, expense-document capture, cross-domain business-document reference, signature-upload ticket, unsupported mutation, or clarify | none in first pass; may request model vision/text classification through provider port | answer user, call ERP tools, create records, approve/apply signatures, use keyword-only routing |
| Intent Router Agent | split already-classified business requests into one or more specialist intents; may be the same implementation file as LINE Intake Router in first pass | none in first pass | answer user, call ERP tools |
| Accounting Summary Agent | accounting/finance summaries from implemented read tools | accounting/ledger/report read tools where implemented | post journal, approve, pay, close, export |
| Inventory Agent | stock balance, low stock, movement summary, reorder suggestion | inventory read tools | stock adjustment, transfer, count approval |
| Receipt OCR Agent | OCR/extraction into draft fields | attachment/media read, receipt draft/evidence tools | mark paid, post expense, approve, delete evidence |
| Receipt Authenticity Agent | risk scoring for receipt/slip image | duplicate/hash/ref validation tools | absolute fraud verdict, law/audit certification |
| Response Composer Agent | Thai-first LINE answer, source refs, safe next action | none in first pass | call business tools or invent data |

Reference patterns from the local AWS-eval AgentCore samples:

- Use a supervisor/orchestrator for conversation and dispatch. Keep regulated outcomes — facts, numbers, decisions, and mutations — deterministic or human-reviewed. A model language layer may improve the reply's wording and readability, but it must use only tool-provided facts and must never add or change any number, id, decision, or outcome; it falls back to the grounded deterministic reply whenever the model is unavailable or breaks grounding.
- Expose one governed delegation path to tools. Specialist agents must not receive raw API, MCP, Prisma, SQL, or arbitrary HTTP access.
- Put LINE Intake Router Agent before all specialist agents for LINE turns. It should decide context semantically from text plus attachment/image signals before any source-module use case runs. It must not use static keyword dictionaries as the primary router; deterministic logic remains for validation, permissions, idempotency, and final-mutation blocking.
- The model may drive tool selection (choosing the next read-only tool one at a time), but only from the routed agent's allowlist ∩ enabled tools (domain isolation). Any tool named outside that set is refused, and selection falls back to deterministic dispatch when the model is unavailable. Fact-shaping stays deterministic — the model decides which tool runs, never the returned numbers.
- Authorize and audit every tool call before execution. Denials must be logged, not silent.
- Treat tool schemas as contracts. Runtime/gateway input schemas must match the real tool/API signature exactly.
- Use AgentCore Memory only for conversation preferences later, never as accounting, inventory, tax, or permission truth.
- Prefer fast AgentCore CodeZip deployment for iteration when dependency size fits; keep container/ECR deployment as fallback for production or heavier dependencies.

Short-term multi-turn context:

- API may attach `conversationContext` to LINE AI requests only after the current event passes LINE signature, active user, active company membership, selected-company context, and current `line.ai.query` permission checks.
- The context window is bounded to the previous 15 stored `AiTurn` rows from the same `companyId + userId`, and only when those rows are within the last 15 minutes. A gap longer than 15 minutes starts a fresh short-term chat context.
- `LineCompanyContext` is not part of this short-term window. It remains the server-side selected-company control-plane context and can persist beyond 15 minutes, subject to active membership re-checks.
- Context payload contains only bounded turn metadata: timestamp, user message preview, intent, agent, refused state, and assistant reply preview. Assistant reply preview is included only when the current permissions still cover the tools invoked by that previous turn.
- Context must not contain raw LINE user ids, secrets, source refs with hidden ids, full tool data, or direct database rows.
- Models may use context only to resolve follow-up wording such as "อันนั้น", "อันที่สอง", or "จากเมื่อกี้". Business facts, numbers, permissions, company selection, and final actions must still come from current permission-checked tools and server-derived context.
- The same bounded context must flow through LINE Intake Router, Intent Router, Orchestrator tool loop, model answer composer, and AgentCore Runtime payloads so local and deployed runtime behavior stay aligned.

Later agents can be added only when source modules exist:

- CRM Repeat Customer Agent
- Employee/HR Summary Agent
- Tax Summary Agent
- Procurement/AP Agent
- Bank/Cash Agent

## 8. LINE Intake Router Contract

The first implementation may reuse the existing `IntentRouterAgent` file/class, but the logical contract is a LINE Intake Router in front of specialist agents. It classifies context before any source-module intake or read tool runs.

Owner follow-up 2026-07-13: the route plan must distinguish accepted expense evidence from quotation, appointment/booking/reservation, quantity-only order/check bill, non-financial, unreadable, ambiguous, and multi-document images. Add one bounded `BUSINESS_DOCUMENT_REFERENCE` route plus document hints; do not add one intent per document kind. The deterministic API decision in [[specs/business-document-image-intake-spec|Business Document Image Intake Spec]] remains authoritative before expense creation.

Input:

```json
{
  "turnId": "uuid",
  "companyId": "uuid",
  "userId": "uuid",
  "locale": "th-TH",
  "message": "สรุปยอดวันนี้ เช็คของใกล้หมด และดูบิลนี้จริงไหม",
  "captionOrQuotedText": "ช่วยอัปโหลดลายเซ็นนี้ให้หน่อย",
  "attachments": [
    {
      "attachmentId": "uuid",
      "mimeType": "image/jpeg",
      "kind": "LINE_IMAGE",
      "sha256": "hex",
      "visionHint": "signature-like marks on white paper"
    }
  ],
  "permissions": ["line.ai.query", "inventory.read", "expense.receipt.upload", "expense.signature.manage"],
  "enabledFeatures": ["ai_line_assistant", "inventory", "expenses"],
  "policy": {
    "finalMutationEnabled": false,
    "maxToolCalls": 8
  },
  "conversationContext": {
    "windowMinutes": 15,
    "maxTurns": 15,
    "lastTurnAt": "2026-07-05T10:14:00.000Z",
    "recentTurns": [
      {
        "at": "2026-07-05T10:13:30.000Z",
        "userMessagePreview": "ดูสินค้าใกล้หมด",
        "assistantReplyPreview": "มีสินค้าใกล้หมด 2 รายการ",
        "intent": "READ_DETAIL",
        "agent": "inventory",
        "refused": false
      }
    ]
  }
}
```

Output:

```json
{
  "status": "ROUTABLE",
  "language": "th-TH",
  "routerAgent": "line-intake-router-agent",
  "intents": [
    {
      "intent": "SIGNATURE_UPLOAD_TICKET",
      "agent": "line-intake-router-agent",
      "target": "expense-signature-intake-use-case",
      "priority": 1,
      "confidence": 0.91,
      "requiredPermissions": ["expense.signature.manage"],
      "handoff": {
        "attachmentIds": ["uuid"],
        "createPendingTicket": true,
        "lifecycle": "PENDING_OWNER_APPROVAL"
      },
      "missingContext": []
    },
    {
      "intent": "ACCOUNTING_SUMMARY",
      "agent": "accounting-summary-agent",
      "priority": 2,
      "confidence": 0.87,
      "requiredTools": ["accounting.get_summary"],
      "missingContext": []
    },
    {
      "intent": "INVENTORY_LOW_STOCK",
      "agent": "inventory-agent",
      "priority": 3,
      "confidence": 0.84,
      "requiredTools": ["inventory.list_low_stock"],
      "missingContext": []
    },
    {
      "intent": "RECEIPT_OCR_AUTHENTICITY",
      "agent": "receipt-ocr-agent",
      "priority": 4,
      "confidence": 0.76,
      "requiredTools": ["receipt.extract_draft", "receipt.score_authenticity"],
      "missingContext": []
    }
  ],
  "refusals": [],
  "requiresHumanReview": false
}
```

Supported first-pass intake route intents:

- `EXPENSE_DOCUMENT_CAPTURE`: route receipt, tax invoice, transfer slip, handwritten bill, marketplace screenshot, PDF/photo/file, or text expense note to item 09 expense draft capture.
- `SIGNATURE_UPLOAD_TICKET`: route signature-like image or signature-upload request to item 09 pending signature candidate plus web owner-approval ticket.
- `BUSINESS_READ_QUESTION`: route read-only summary/detail questions to specialist read agents.
- `MUTATION_REQUEST_REFUSAL`: refuse final money, stock, accounting, approval, export, permission, or signature activation requests.
- `CLARIFY`: ask a short follow-up when image/text context is ambiguous.
- `UNSUPPORTED`: safe refusal or web deep-link when no route is available.

Routing rules:

- The router must use model-driven semantic classification for image/text/conversation context when provider is available. It may use attachment presence and MIME type as validation signals, but not as the whole classifier.
- Static keyword dictionaries, regex-only routing, or single-phrase checks are not acceptable as the primary intent splitter.
- Deterministic code is still required for trust boundaries: LINE signature verification, linked identity, active company, permissions, attachment MIME/size, idempotency, tool allowlists, and mutation blocking.
- If confidence is low or multiple routes conflict, output `CLARIFY` rather than creating an expense draft or signature ticket automatically.
- `SIGNATURE_UPLOAD_TICKET` must never activate, approve, background-remove, fill, or administer signatures. It creates only a pending ticket through a permission-checked API use case.

If the message requests final mutation, output must include refusal:

```json
{
  "status": "PARTIAL",
  "intents": [],
  "refusals": [
    {
      "request": "อนุมัติจ่ายเงิน",
      "reason": "LINE AI cannot approve payments. Open web approval flow."
    }
  ]
}
```

## 9. Specialist Agent Output Contract

Every specialist returns:

```json
{
  "agent": "inventory-agent",
  "status": "SUCCEEDED",
  "summary": "มีสินค้า 3 รายการต่ำกว่า reorder point",
  "facts": [
    {
      "label": "Low stock count",
      "value": 3,
      "sourceRef": {
        "type": "inventory_product",
        "id": "uuid",
        "permissionChecked": true
      }
    }
  ],
  "suggestions": [
    {
      "kind": "REORDER_REVIEW",
      "text": "ควรเปิดหน้า inventory เพื่อทบทวนรายการที่ต่ำกว่า reorder point"
    }
  ],
  "toolCalls": [
    {
      "name": "inventory.list_low_stock",
      "status": "SUCCEEDED",
      "durationMs": 120
    }
  ],
  "risks": [],
  "requiresHumanReview": false
}
```

## 10. Tool Scope For Local Playable Version

First pass must reuse or wrap existing tool primitives. If a tool does not exist, return unsupported-module, not fake data.

All tools must be registered through a single governed registry with:

- stable tool name
- input schema matching the API/use-case contract
- required permission key
- allowed agent list
- final-mutation classification
- audit/source-ref behavior

The first implementation can use the existing AI Gateway `ErpToolClient` and `ToolPolicyEnforcerService`. A later AgentCore Gateway/MCP cutover is allowed only after schema parity and fail-closed auth are verified.

Required first-pass tools:

```text
company.get_current_context
dashboard.get_business_health_summary
notifications.list_open_alerts
inventory.list_low_stock
inventory.get_stock_balance
inventory.summarize_stock_movements
receipt.get_attachment_metadata
receipt.create_or_update_evidence_draft
receipt.find_duplicate_by_hash
receipt.score_authenticity
```

Optional tools if already implemented:

```text
accounting.get_summary
ledger.get_profit_and_loss_summary
expenses.list_receipt_drafts_needing_review
sales.get_sales_summary
crm.suggest_sales_followups
```

## 11. Receipt Authenticity Rules

The system must not claim a receipt is "real" or "fake" with certainty. It returns a risk score and reasons.

Risk levels:

- `LOW`: no obvious anomaly; still draft/human-reviewable.
- `MEDIUM`: missing fields, low OCR confidence, suspicious date/amount/ref consistency.
- `HIGH`: duplicate hash/ref, edited-looking image, impossible totals, invalid QR/ref where validation exists, or merchant/tax-id mismatch where validation exists.

Signals:

- Image hash duplicate.
- OCR confidence.
- Amount math consistency.
- Date plausibility.
- Merchant/tax-id/reference presence.
- QR/ref validation if supported.
- Existing draft/expense duplicate.
- EXIF/image metadata where available.

High-risk output must link to web review. No final expense/payment/posting is allowed from LINE.

## 12. Model Provider Rules

Local item 10B supports three provider modes:

- `disabled`: safe default; no paid model call.
- `bedrock`: primary AWS model path for local smoke and later AgentCore production.
- `openai`: optional fallback path only when Bedrock quota/use-case approval is blocked.

Primary local Bedrock smoke:

```text
MODEL_PROVIDER=bedrock
AWS_PROFILE=watchdog-bedrock
AWS_SDK_LOAD_CONFIG=1
BEDROCK_REGION=ap-southeast-1
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6
```

Optional OpenAI fallback:

```text
MODEL_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

Local fallback model can be:

```text
BEDROCK_MODEL_ID=global.anthropic.claude-haiku-4-5-20251001-v1:0
```

Rules:

- Never put AWS credentials in frontend, LINE, docs examples with real secrets, git, or logs.
- Provider keys/credentials remain server-side only.
- Config must support `MODEL_PROVIDER=disabled` so the app can run without paid AI.
- OpenAI mode must fail safely when `OPENAI_API_KEY` is missing or invalid.
- Anthropic use case form and Bedrock quota issues must fail gracefully with a typed provider error.
- The local playable path can use AWS inference profiles.
- Production AgentCore Runtime deploy is in scope after local agent/tool/policy proof. AgentCore Gateway, Memory, Browser, Code Interpreter, and formal evaluations remain later scope unless explicitly pulled forward.

## 13. Security And Permission Rules

- API verifies LINE signature before trusting any event.
- API resolves user/company/membership from server context only.
- Active membership is required.
- Enabled feature `ai_line_assistant` is required.
- Permission `line.ai.query` is required before AI Gateway call.
- Tool-specific permissions are required before every tool call.
- AI Gateway must not import Prisma or source repositories.
- All tool calls go through permission-checked API/use-case boundary.
- Orchestrator enforces an allowlist per agent.
- Tool policy decision and audit record happen before tool execution.
- Unknown tool, unknown agent, agent/tool mismatch, schema mismatch, and missing permission fail closed.
- `AI_FINAL_MUTATION_ENABLED=false` blocks final mutation even if model suggests it.
- Prompt and raw LINE user id logging are off/redacted by default.
- Sensitive read and receipt draft operations are audited.
- Tool call count and timeout limits are enforced.
- Short-term multi-turn context requires current `line.ai.query`, same user/company scope, a 15-minute active window, and permission coverage before assistant reply previews are reused.

## 14. Configuration

Required local env placeholders:

```text
LINE_AI_AGENT_ORCHESTRATION_ENABLED=false
LINE_AI_AGENT_RUNTIME=strands-local
MODEL_PROVIDER=disabled
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
AWS_PROFILE=
AWS_SDK_LOAD_CONFIG=1
BEDROCK_REGION=ap-southeast-1
BEDROCK_MODEL_ID=
AI_FINAL_MUTATION_ENABLED=false
AI_MAX_TOOL_CALLS=8
AI_TOOL_TIMEOUT_MS=5000
AI_PROMPT_LOGGING_ENABLED=false
```

Existing LINE env remains required for real LINE testing:

```text
LINE_MESSAGING_CHANNEL_SECRET=
LINE_MESSAGING_CHANNEL_ACCESS_TOKEN=
LINE_LOGIN_CHANNEL_ID=
LINE_LIFF_ID=
AI_GATEWAY_INTERNAL_SECRET=
AI_GATEWAY_INTERNAL_URL=
```

## 15. Local Demo Requirements

Local playable means:

1. API and AI Gateway run locally.
2. A tunnel such as ngrok or Cloudflare Tunnel points LINE webhook to local API.
3. Real LINE OA sends text/image events.
4. Local API verifies signature.
5. Local AI Gateway calls Strands local agents.
6. Agents call selected provider (`bedrock` primary, `openai` optional fallback only).
7. Agents call local/staging BMS tools only through API boundary.
8. Reply reaches LINE.
9. Audit/turn logs show agent, intent, tool calls, and refusal/provider errors.

## 16. Error Behavior

| condition | behavior |
| --- | --- |
| provider disabled | typed feature-unavailable response with no model call or business keyword fallback |
| Bedrock quota exhausted | friendly "AI quota temporarily unavailable" LINE reply; audit provider error |
| Anthropic use case not submitted | typed provider setup error, no retry storm |
| model timeout | partial response if tools succeeded; otherwise retry-safe error |
| tool permission denied | omit restricted data and explain permission issue |
| unsupported module | say module not ready; do not fake numbers |
| high-risk receipt | create/reuse draft if allowed; require web review |
| mutation request | refuse and deep-link to web action if available |

## 17. Acceptance Criteria

- [ ] Strands local runtime is documented and feature-flagged.
- [ ] Real LINE text can route to local Orchestrator Agent.
- [ ] Intent Router handles at least one multi-command Thai message.
- [ ] Inventory and dashboard/notification tools can be called when permissions allow.
- [ ] Receipt image can route to OCR/authenticity draft flow or typed "provider unavailable" result.
- [ ] Bedrock provider config supports Sonnet 4.6 inference profile and disabled fallback.
- [ ] Provider quota/use-case errors are handled without crashing LINE webhook.
- [ ] Each agent has one responsibility and an allowlisted tool set.
- [ ] No AI path can perform final money, stock, accounting, tax, approval, export, permission, or external publishing mutation.
- [ ] Audit records include turn id, agent, intent, tool calls, policy decisions, provider model id, and redacted errors.
- [ ] Tool registry schemas match real API/tool signatures; mismatch fails closed and is covered by tests.
- [ ] Local demo runbook explains LINE tunnel setup and rollback flag.
- [ ] Agent service exposes AgentCore-compatible `/ping` and `/invocations` endpoints when packaged for AWS.
- [ ] AgentCore Runtime deployment creates or updates a runtime in AWS, reaches ready status, and can be invoked with a permission-safe test payload, or records exact AWS/IAM/quota blocker.
- [ ] Short-term multi-turn context is bounded to 15 previous turns/15 active minutes, is not used as business truth, and is verified across API, local orchestrator, and AgentCore runtime payloads.

## 18. Test Cases

- Linked OWNER asks "สรุปวันนี้ เช็คของใกล้หมด" and receives combined answer.
- Linked inventory staff asks low-stock question and sees only allowed locations.
- Unauthorized linked user gets refusal before tool calls.
- Unlinked LINE user gets link guidance and no AI Gateway call.
- Multi-company OWNER without selected context gets selector guidance.
- User asks "อนุมัติจ่ายบิลนี้" and receives final-mutation refusal.
- Receipt image upload creates/reuses draft only when permission allows.
- Duplicate receipt image returns medium/high risk and web review link.
- Bedrock throttling returns typed temporary-unavailable reply.
- `MODEL_PROVIDER=disabled` keeps local services runnable and returns typed feature-unavailable output without business keyword routing.
- User asks a follow-up such as "อันที่สองล่ะ" within 15 minutes; the model receives bounded prior turn context, but any returned facts still come from current permission-checked tools.
- User asks after a gap longer than 15 minutes; no short-term conversation context is sent, while `LineCompanyContext` still selects the company after active membership re-check.
- User loses an inventory/ledger permission after a prior turn; the next context may include the user's old question preview, but omits the previous assistant reply preview for tools the current permission set no longer covers.

## 19. Production AgentCore Runtime Deployment Path

Item 10B local proof must lead to an AWS-hosted runtime path:

1. Keep WatchDog API, data, permissions, source-module validation, audit, and final mutations outside the agent runtime.
2. Package the Orchestrator Agent service with required AgentCore HTTP endpoints:
   - `GET /ping` for health.
   - `POST /invocations` for runtime invocation.
3. Prefer CodeZip/direct-code runtime deployment for fast iteration when the verified Node/Python dependency package fits AgentCore size/runtime limits.
4. Keep container/ECR deployment as fallback for production, native/system dependencies, or package size issues.
5. Create a least-privilege AgentCore Runtime execution role with Bedrock invoke, artifact access, CloudWatch Logs, CloudWatch metrics, and X-Ray permissions as needed.
6. Create or update a Bedrock AgentCore Runtime using the code artifact or container image, role ARN, HTTP protocol, and the selected region.
7. Configure API -> AgentCore Runtime invocation through a server-side adapter; LINE and web never call AgentCore directly.
8. Runtime input must include only sanitized turn context, selected company/user ids, scoped permissions, bounded short-term conversation context, allowed tool set, and attachment refs. No raw secrets, unrestricted customer data, or Prisma/database handle enters AgentCore.
9. Runtime tools must call WatchDog API/tool endpoints through internal auth or future AgentCore Gateway/MCP; no direct database, arbitrary HTTP, free-form SQL, or model-selected endpoint paths.
10. Verify deployed runtime with a safe read-only LINE-like payload and a denied mutation payload.
11. Store runtime ARN/id, artifact id or image tag, model id, region, IAM role, and verification evidence in runbook or agent memory.

Later hardening can add:

- AgentCore Gateway or MCP server for production tool exposure.
- AgentCore Observability or OpenTelemetry export for traces.
- AgentCore Memory only for conversation preference, not accounting truth.
- Formal eval suite for intent, refusal, OCR, and permission cases.

Production upgrade must not change the source-of-truth rule: WatchDog API/modules own data, permissions, mutations, and audit.

## 20. Open Questions

- Which tunnel tool should be the default local runbook: ngrok or Cloudflare Tunnel?
- Should local demo use staging tenant data by default or seeded local data only?
- Should receipt OCR use Bedrock vision first, or keep OCR typed-unavailable until a vision model is verified?

## 21. M-01 Actor Delegation Boundary

### Product and security outcome

An internal AI tool call must prove both the AI workload and the server-resolved actor delegation. Possession of `AI_GATEWAY_INTERNAL_SECRET` alone must not let a compromised Gateway or AgentCore runtime select another active user or company.

### Main journey

1. API resolves the active LINE user, company membership, permission set, request id, and permitted registered tools.
2. API creates a bounded pool of eight short-lived, single-use signed delegations per permitted tool, matching the maximum tool-call budget. The signing key is dedicated, 256-bit, and available only to API.
3. The opaque delegation map travels API → AI Gateway → AgentCore when enabled. Model/provider prompts never receive the signing key.
4. AI Gateway selects the exact token for the tool and sends it in `X-Actor-Delegation` when calling ERP Core.
5. ERP Core first verifies workload identity, then verifies that the token binds issuer, workload/audience, actor, company, membership, request, tool, issued-at, expiry, and unique delegation id.
6. ERP Core atomically consumes the delegation id in shared Redis before execution, re-resolves current membership/permissions from the database, and refuses stale, substituted, expired, cross-company, wrong-tool, wrong-audience, or replayed calls.
7. A durable audit event correlates the accepted workload delegation id and tool with the actor/company/membership/request without storing the token.

### Rules and exceptions

- Each delegation expires after 120 seconds and is valid for exactly one tool invocation; a turn receives at most eight delegations for any one tool.
- API must fail closed when the signing key is absent. ERP Core must fail closed when signature verification or Redis replay protection is unavailable.
- AI Gateway and AgentCore receive signed tokens but never the signing key.
- The existing permission/ABAC re-resolution remains authoritative; delegation does not carry trusted permission or scope claims.
- No raw LINE identity, secret, token body, or signature may be logged.
- Rollback must disable AI tool execution until the signing-key and replay boundary are restored; reverting to shared-secret-only actor selection is not an acceptable live rollback.

### Acceptance criteria

- [x] Actor substitution, cross-company substitution, wrong tool/audience, expiry, and replay are denied before tool execution.
- [x] Local, deterministic, and AgentCore paths preserve the same delegation unchanged to the ERP boundary.
- [x] Successful consumption is auditable from workload → delegation id → actor/company/membership/request/tool.
- [x] API and AI Gateway typechecks and focused security/runtime tests pass.
- [ ] An immutable production API revision receives the dedicated signing key while AI Gateway and AgentCore do not; sanitized live verification is retained as release evidence.
