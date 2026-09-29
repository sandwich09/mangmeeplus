# Per-Company AI Budget Override Spec

2026-09-29 add-on scope: the [AI credit and receipt-image add-on spec](chat-credit-and-receipt-addons-spec-th.md) (§16, §18) defines customer balances and admin grants separately from these operational ceilings. This writer is not a credit-grant API; adding credit is the separate reviewed "เพิ่มยอดให้ลูกค้า" operation. Preserve existing config semantics and guards. Today an explicit override in SHARED mode also acts as the company's CHAT allowance (`company-ai-budget-policy.ts:149-151`); how that value maps at a company's cut-over is an open Owner question (Q5, default: keep the resolved value as the included allowance per cycle, record its provenance, keep this ceiling as the safety cap). In the console this ceiling is labelled "เพดานเครดิต AI ต่อเดือน" (decision T-06), and writers must warn before lowering it below the commercial balance a company holds (add-on spec §5.3). This note does not implement or activate the new flow.

## 1. Status

- Date: 2026-07-28 (Asia/Bangkok)
- Owner: Platform/AI with the partner-console owner
- Status: Proposed — not implemented
- Related: `docs/specs/p1-security-remediation-m04-m18-spec.md` (M-05 lineage, M-12 abuse
  controls), `docs/specs/p2-security-hardening-l01-l15-spec.md` (L-14 security signals),
  `docs/agent-memory/ai-cost-per-message.md`

## 2. Problem

`AI_LLM_MAX_PER_COMPANY` (60) and `AI_OCR_MAX_PER_COMPANY` (20) are single global
environment values applied **per company** inside a shared Redis window:

- `apps/api/src/modules/line-ai/infrastructure/ai-gateway.client.ts:66-76` — `assertBudget`
- `apps/api/src/modules/crm-inbox/infrastructure/crm-ai-gateway.client.ts:63`
- `apps/api/src/modules/expenses/infrastructure/receipt-ocr.client.ts:24`
- `apps/api/src/modules/banking/infrastructure/statement-ai-extract.client.ts:28`

All four read `AppConfigService.aiLlmMaxPerCompany` / `.aiOcrMaxPerCompany` and call
`RedisRateLimitService.consume(scope, companyId, max, aiRateLimitWindowSeconds)`.

Two consequences:

1. **One number for every tenant.** A ten-seat shop and the busiest partner company get the
   same ceiling. Raising it for one customer today means raising it for everyone, in every
   environment, by redeploying.
2. **Hitting the ceiling is silent.** The limiter throws `429` with
   `AI_LLM_RATE_LIMITED` / `AI_OCR_RATE_LIMITED` and emits no log event, no audit row and no
   metric. The observable symptom is "the AI stopped answering", with nothing to attribute it
   to. There is currently no way to know whether any company has ever hit the limit, which
   means there is also no evidence base for choosing a better number.

## 3. Goal

Let an operator raise or lower the AI budget for a single company, from the existing partner
console, **within a ceiling the tenant cannot influence**, and make limit exhaustion visible
so the value is tuned from evidence rather than guesswork.

## 4. Non-goals

- Self-service editing by the tenant. See §5.1.
- Placing the control in the company onboarding flow. See §5.2.
- Per-user or per-branch budgets.
- Replacing the Redis window limiter, changing its algorithm, or adding a billing meter.
- Cost attribution or invoicing. This is a rate ceiling, not a spend ledger.

## 5. Decisions that shape the design

### 5.1 The tenant must not set its own ceiling

These values are an abuse control and a cost control at once. A party that can raise its own
limit does not have a limit. The spend is real and measured per message, so the ceiling is a
commercial decision belonging to whoever carries the bill, not a tenant preference. This
matches the boundary the repository already draws elsewhere: `ProcurementApprovalPolicy`
management is OWNER-only, `AI_FINAL_MUTATION_ENABLED` is refused in production, and the
existing per-company AI model is settable only through the partner console.

### 5.2 The control belongs on the partner detail page, not onboarding

Onboarding is the moment the operator knows least about the company's real usage, and a number
typed there is a guess that is rarely revisited. The value must live where it can be revised
against observed usage, next to a display of that usage.

### 5.3 Absent means inherit, not unlimited

A company with no override inherits the platform default. `null` is the normal state, so the
global default remains a single source of truth that can still be moved for everyone at once.
No code path may interpret a missing or unreadable override as "no limit".

## 6. Users and journeys

**Operator (system admin / partner console).** Opens a partner company's detail page, sees the
current LLM and OCR budgets with the window they apply to and the company's recent peak usage,
sets or clears an override, and sees the change recorded.

**Employee/customer of that company.** No visible change while under budget. When the budget is
exhausted the behaviour is exactly as today: `429` with a retry hint.

## 7. Contract

### 7.1 Data

Extend `CompanyAiConfiguration` (`apps/api/prisma/schema.prisma:2369`) — it is already the
per-company AI configuration record, already carries `updatedBySystemAdminUserId`, and is
already written only from the partner console:

- `llmMaxPerCompany Int?` — null means inherit
- `ocrMaxPerCompany Int?` — null means inherit

No new table. Note that `modelId` is currently non-nullable, so creating a row for a company
that only needs a budget override must not invent a model — resolve this explicitly during
implementation rather than defaulting a model silently.

### 7.2 Ceiling

Two new platform values, environment-only and never tenant-editable:
`AI_LLM_MAX_PER_COMPANY_CEILING`, `AI_OCR_MAX_PER_COMPANY_CEILING`.

- An override above the ceiling is **rejected at the API with 422**, never silently clamped —
  a clamped value would display back as accepted and mislead the operator.
- An override must be a positive integer; zero is rejected. Disabling AI for a company is a
  separate concern with its own switch and must not be expressed as a budget of nothing.
- The ceiling itself must be ≥ the corresponding default, validated at boot alongside the
  existing production config rules.

### 7.3 Resolution at enforcement time

A single resolver returns the effective budget for `(companyId, kind)`:

1. company override when present,
2. otherwise the platform default.

Requirements, in priority order:

- **Fail closed.** Any failure to read the override falls back to the platform default. A
  lookup error must never widen or remove the limit.
- **Cheap.** This sits on every AI call, which already performs a Redis round trip. The
  resolver must not add a database query per call; cache per company with a short TTL and a
  documented staleness bound. State that bound in the implementation notes — an operator
  raising a budget should know when it takes effect.
- **One seam.** All four call sites resolve through the same function. No call site keeps
  reading the raw config getter.

### 7.4 API and permission

Extend the existing partner endpoint surface rather than adding a new one:
`PUT /:partnerCompanyId/ai-model` already exists at
`apps/api/src/modules/system-partner-management/presentation/http/partner.controller.ts:217`
behind `@RequirePermissions('system.partner_ai_model.manage')`.

Either extend that route's DTO with the two optional budgets, or add a sibling route under the
same permission. No new permission is introduced. The partner metadata lock
(`partnerMetadataLockError`) applies exactly as it does to the model change.

### 7.5 Audit

Every change writes a `CRITICAL` audit row **inside the same transaction as the update**,
carrying the previous and new values for both budgets and the acting admin — the shape
`SetPartnerAiModelUseCase` already uses. A cleared override records the transition to
inherited, not an empty diff.

### 7.6 Observability (prerequisite, not an extra)

Before or with the editable field, exhaustion must become visible:

- Emit a named security/telemetry event when an AI company budget is refused, carrying
  `companyId`, which bucket, the effective limit and whether it came from an override. Use the
  emitter and naming convention established by L-14
  (`apps/api/src/common/logger/security-event.ts`), with a root-level `riskLevel` so the
  existing production metric filter can see it.
- Surface recent peak usage against the limit on the partner detail page so the operator can
  choose a number from evidence.

Without this, an override is a number set blind and never revisited — the same failure mode as
the single global value, moved.

### 7.7 Web

`apps/web/src/features/system-partners/PartnerDetailPage.tsx` and
`system-partners.api.ts` already carry the AI model control; the budgets join it.

- Both fields display the window they apply to. A bare "60" is meaningless and will be read as
  a monthly or daily quota; it is a per-window ceiling governed by `AI_RATE_LIMIT_WINDOW_SECONDS`.
- Empty input means inherit, and the inherited value is shown so the operator can see what they
  are departing from.
- The ceiling is shown, and a value above it surfaces the API's 422 message rather than being
  corrected client-side.
- Loading, error, and permission-denied states follow the page's existing patterns.

## 8. Acceptance criteria

1. A company with no override is limited at exactly the platform default, unchanged from today.
2. An override raises or lowers only that company's budget; a second company in the same window
   is unaffected.
3. An override above the ceiling is refused with 422 and nothing is persisted.
4. Clearing an override returns the company to the platform default.
5. A resolver failure falls back to the platform default and never to unlimited.
6. Every change produces a CRITICAL audit row with before and after values, written atomically
   with the update.
7. A refused AI call emits the named event with the company and the effective limit.
8. No tenant-facing route can read or write these values.
9. The four enforcement sites all resolve through the single resolver.

## 9. Risks

- **Operator error raises spend.** Mitigated by the ceiling, the audit trail, and showing usage
  next to the field — not by trusting the input.
- **Cache staleness confuses the operator.** Mitigated by a short TTL and stating the bound in
  the UI copy.
- **`CompanyAiConfiguration.modelId` is required**, so a budget-only override forces a decision
  about what that row's model means. Resolve deliberately; do not default it.
