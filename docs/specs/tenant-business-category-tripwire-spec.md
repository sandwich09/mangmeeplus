# Spec: Tenant business-category tripwire (health-adjacent onboarding alert)

Status: Historical; superseded by owner decision 2026-09-23 and
`docs/specs/company-business-type-single-source-spec-th.md`. The seven-value field and its
onboarding alert are retired; this document records the former design only.
Owner: Platform/AI Security.
Date: 2026-07-28.

## Why

On 2026-07-28 the owner **deliberately deferred** two PDPA questions in the M-05 register
§5: s.41 limb (b) (core activity = regular monitoring on a large scale) and the
controller-vs-processor question. The deferral is only safe under one stated assumption —
that the tenant base stays **general retail / trading / service**.

A single health-adjacent tenant (clinic, wellness, spa, medical retail) breaks that
assumption on its own, because `CrmBooking.serviceName` is chosen by the *tenant*: for a
clinic the service name alone is s.26 health data, and §4.1's "incidental s.26 only"
finding stops holding. The register says it plainly: *"Deferring the deferral's own
safeguard is how this becomes permanent."*

This spec is that safeguard. It does not answer the deferred questions; it guarantees the
deferral cannot expire silently.

## Constraint that shapes the design

`Company` in `apps/api/prisma/schema.prisma` has **no industry/business-type field**
(verified 2026-07-28, re-verified against the merged schema for this build). So the
tripwire cannot key off a declared industry today — the field has to exist first.

The register records the preferred route and the rejected one:

- **Chosen:** ask the business category at onboarding, alert on the health-adjacent values.
- **Rejected fallback:** classify `CrmBooking.serviceName` or `CrmMessage.contentText`.
  Weaker (free text, per-tenant vocabulary, Thai/English mixed) *and* more invasive — it
  would mean reading customer message content to answer a question about the tenant's
  business type. Declared category asks the party who actually knows.

## Product behaviour

### G1 — Business category is captured at onboarding

- **Data:** `Company.businessCategory CompanyBusinessCategory?` — a Prisma enum, so the
  tripwire's input is a closed set (a typo'd free-text `"clinic "` cannot slip past the
  health check).
- **Nullable column, required field.** The column is nullable because companies onboarded
  before this change have no category and are not being backfilled by this work. The
  *onboarding command* requires it, so every company created from now on carries one.
- **Values:** `RETAIL`, `TRADING`, `SERVICE`, `CLINIC`, `WELLNESS_SPA`, `MEDICAL_RETAIL`,
  `OTHER`. The list is deliberately short: the only distinction this feature needs is
  health-adjacent vs not. It is not a market-segmentation taxonomy.
- **Health-adjacent set:** `CLINIC`, `WELLNESS_SPA`, `MEDICAL_RETAIL` — exactly the four
  business types the register names, with spa and wellness sharing one value because the
  PDPA consequence is identical.
- **UI:** a required `<select>` on the system-admin onboarding form, **no pre-selected
  value**. The system admin has to make an actual choice; a default would be the value
  everyone ships past.

### G2 — A health-adjacent onboarding alerts the dev team

- **Mechanism (reused, not new):** `emitSecurityEvent(...)` from
  `apps/api/src/common/logger/security-event.ts`, at `riskLevel: 'HIGH'`.

  The production metric filter installed by `infra/prod-ecs-express/deploy.sh` already
  keys on `{ ($.riskLevel = "CRITICAL") || ($.riskLevel = "HIGH") || ... }` and routes
  the alarm to `SECURITY_ALERT_TOPIC_ARN`. Emitting a root-level `riskLevel` therefore
  reaches the dev team **with no infrastructure change** — no new topic, no new alarm, no
  new AWS provisioning (which matters: platform provisioning is currently constrained, and
  an unrun provisioning script is not a tripwire).
- **Event name:** `pdpa.tenant.health_adjacent_onboarded`, added to the `SECURITY_EVENT`
  catalogue. That file is duplicated byte-identically in `apps/api` and `apps/ai-gateway`
  and guarded by a cross-app test — **edit both or neither.**
- **Fields:** `companyId`, `businessCategory`, `onboardingRunId`, `actorUserId`,
  `requestId`. No company name, no owner name: the alert says *go look*, and the audit row
  carries the rest. Keeping personal data out of an alarm path is the same rule §4.1 relies
  on elsewhere.
- **Timing:** emitted **after** the onboarding transaction commits. A rolled-back
  onboarding must not page anyone, and telemetry must never be able to fail the mutation
  it observes (`emitSecurityEvent` already swallows logger errors for this reason).
- **Non-health categories emit nothing.** A tripwire that fires on every onboarding is a
  tripwire nobody reads.

### G3 — The category is on the durable record

`businessCategory` joins the existing `system.company_onboarding.create` audit row's
`metadataJson`. This is the part that survives log retention, and it is what makes a later
"which tenants are health-adjacent / uncategorised?" question answerable without a new
report.

## Rules / boundaries

- **Scope is the alert, not the answer.** When the tripwire fires, a human re-opens §5
  limb (b) and the controller/processor question. Nothing in this change decides them,
  gates onboarding, or blocks a clinic from being onboarded — the product deliberately
  still allows it.
- No new permission key (rides `system.company_onboarding.create`), no new dependency,
  no new notification channel, no `deploy.sh` edit.
- The tenant `NotificationRule`/`NotificationEvent` system is deliberately **not** used:
  every model in it is tenant-scoped (`companyId`, cascade-deleted with the company) and
  its recipients are users *inside* the tenant. The dev team is not a member of the tenant,
  and a compliance-internal concern does not belong in a customer's notification feed.
- Nullable column, idempotent migration (`ADD COLUMN IF NOT EXISTS`), no NOT NULL — the
  established pattern after the prod migration-drift incident.

## Accepted residual risk

An admin who picks `OTHER` (or `SERVICE`) for a clinic defeats the tripwire. This is
accepted rather than engineered around:

- Alerting on `OTHER` too would fire on genuinely-other tenants and train the dev team to
  ignore the alert, which costs more than it buys.
- The mitigation is that every onboarding's category is on the audit row (G3), so a
  periodic review can spot `OTHER`/uncategorised tenants. No sweep is built for that today.

This is a real hole and is named here rather than discovered later. It is still strictly
better than the current state, which is no signal at all.

## Acceptance

1. Onboarding a company with `businessCategory: 'CLINIC'` emits exactly one
   `pdpa.tenant.health_adjacent_onboarded` line with root-level `riskLevel: 'HIGH'`,
   carrying `companyId` and `businessCategory`, after the transaction commits.
2. Onboarding with `RETAIL` (or any non-health value) emits no such line.
3. The category reaches the `Company` row and the onboarding audit `metadataJson`.
4. A request with a missing or unrecognised `businessCategory` is rejected 400 by the DTO.
5. `security-event.ts` stays byte-identical across `apps/api` and `apps/ai-gateway`, and
   the existing alarm-coverage guard still passes.
6. Register §6 tripwire checkbox ticked with the verification evidence recorded.
