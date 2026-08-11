# Feature Launch Control — Health-View Contract and Route Runbooks

generated 2026-07-31; maintained through 2026-08-03 on `develop` | status **ACTIVE-PRE-ENFORCEMENT**

Deliverable for `docs/plans/feature-entitlement-decoupling-plan.md` §3 F0 ("Define the internal launch-health view and per-family/exact-route runbooks…") and `docs/specs/feature-entitlement-decoupling-spec.md` AC29 / FR-G5.

Normative sources: Spec §5 CC1, §6.1–6.2, §9, FR-G2.1/G3/G5, AC17/AC29. Plan §3 F1, §6, §8.3–8.4, §9.
Evidence for real seams: `docs/agent-memory/f0-inventory-async-surface.md` (63 async surfaces, 60 with no entitlement check, outbox `DEAD` has no reconciler).

**This document binds launch/recovery operations.** It defines what the health view
must expose and what an operator must do. Landed implementation status is maintained
in §6; unresolved policy remains in §7 rather than being invented locally.

---

## 0. Scope, audience and hard invariants

| | |
|---|---|
| Audience | Release owner, on-call operator, support (read-only), Thai tax specialist (evidence columns only) |
| Not an audience | Customers, partners, tenant users, AI/agent surfaces — Spec CC1: "Customers, partners, tenant users and AI never read or mutate route state" |
| Read-only | Spec §9: the health view "cannot call domain mutations or reveal customer records without the normal scoped support path". Every action in §4 runs through the control-plane command API, never the view |
| Environment scope | One control-plane row set per environment. `infra/prod-ecs-express/deploy.sh:28-36` gives each `DEPLOY_ENV` its own `/watchdog-bms/${DEPLOY_ENV}` param/secret prefix, so UAT and production rows live in separate databases. Cross-environment promotion state has no defined home (OPEN-7) |
| Source boundary | `develop` is the UAT application source. `main` is the production application source and may hold the byte-reviewed neutral workflow controller. A UAT result is evidence only: never clone a role/secret/artifact, deploy production, or infer production authority from it |
| Canary meaning | Spec CC1/FR-G5: environment + immutable build only. No tenant cohort, no percentage rollout, no per-customer route override — a health view that exposes any per-tenant route control is a contract breach |

### 0.1 Spec/Plan reconciliation notes (no OPEN raised)

| # | Tension | Resolution used here |
|---|---|---|
| R-a | `FeatureLaunchGate.state ∈ {CLOSED, OPEN}` (Spec CC1) vs the `ON \| DRAINING \| OFF` lifecycle (Spec §2.3, CC1 disable path) | They are different objects. The view has **two row types**: a global launch-gate row (§2.1) and a tenant-anonymous feature-lifecycle aggregate (§2.2). `DRAINING` age is reported on row type B, never on a gate row |
| R-b | Spec CC1 defines a **normal CLOSE** ("records environment/build/expected generation and the release authority under the ordinary command policy"); Plan §6 checklist mentions only emergency CLOSE | Spec §1 is "the sole normative source" — R3 below carries both a normal-CLOSE and an emergency-CLOSE path |
| R-c | Spec FR-G5 requires the view to show an "explicit recovery action"; Plan §3 F1 says "runbook/owner" | Modelled as two fields: `runbookRef` (section id in this file) + `recoveryActionKey` (the `FEATURE_LAUNCH_MATRIX` Resume/Reissue path) |

### 0.2 Readiness and execution authority

| State | Minimum evidence | Allows | Does not allow |
|---|---|---|---|
| `f2PrecheckReady` | Exact UAT serving/source full SHA; verified dedicated A5 read-only guard; tenant-anonymous artifact with matching `queryCatalogHash`/`evidenceHash`; clean reviewed F2 PLAN | F2 APPLY through the durable writer wrapper only | Feature enforcement, route OPEN, production promotion |
| `enforcementReady(feature/route)` | Normalized fixed point plus that row/family's complete matrix, shadow/`would_block`, runoff, live UAT and applicable capacity evidence | The exact feature/route enforcement decision | A sibling feature/route, any WHT route without specialist evidence, production promotion |
| `promotionReady` | Enforcement evidence plus journeys, rollback/recovery, security, accessibility/usability and a separately provisioned/reviewed production read-only preflight | Submit an explicit production promotion decision | Automatic clone/deploy or reuse of UAT role/secret/artifact |

Shadow/capacity gaps are advisory for the current per-company F2 APPLY and therefore do not make `f2PrecheckReady` false by themselves. They are hard blockers for enforcement and promotion. All `cap.wht50bis/*` rows remain CLOSED. Normalization is deploy-owned and requires no customer migration, historical re-entry or new form.

---

## 1. Roles (contract names; real identities are OPEN-1)

| Role | May do | May never do |
|---|---|---|
| **RO** Release owner | Normal OPEN, normal CLOSE, approve `releaseApprovedByUserId`, promote build across environments | Approve a SPECIALIST_LEGAL row alone |
| **OC** On-call operator | Emergency CLOSE of one exact `(gateKey, routeKey)` with `incidentRef`; read everything | Any OPEN, in any circumstance (Spec CC1: emergency snapshot "forbids OPEN") |
| **TS** Thai tax specialist | Produce/refresh `validationEvidenceRef`+`Hash`; approve `specialistApprovedByUserId` | Execute a control-plane command |
| **SU** Support | Read the health view | Any command; any tenant-identifying drill-down outside the scoped support path (OPEN-4) |
| **PSO** Platform/security owner | Own the control-plane authority, audit review, break-glass credential path | Substitute for RO/TS approval |

---

## 2. Health-view contract

### 2.1 Row type A — launch-gate row (one per `(gateKey, routeKey)` in this environment)

| Field | Type / values | Source of truth | Notes |
|---|---|---|---|
| `gateKey`, `routeKey` | string, string | `FeatureLaunchGate` | Separate validated fields — Spec §6.1: "`gateKey/routeKey` is documentation shorthand only". **Internal-only**; never rendered to a customer surface |
| `routeClass` | `ORDINARY \| SPECIALIST_LEGAL` | `FEATURE_LAUNCH_MATRIX` | Matrix is authoritative; the view must flag disagreement with the latest transition snapshot's `routeClass` |
| `state` | `OPEN \| CLOSED` | `FeatureLaunchGate.state` | Never `ON/DRAINING/OFF` — see R-a |
| `generation` | int | `FeatureLaunchGate.generation` | Increments on every real OPEN↔CLOSED transition of **this row only** |
| `lastSeq` | int | `FeatureLaunchGate.lastSeq` | |
| `environment` | enum \| null | runtime environment identity | `resolveDeploymentIdentity()` is live and `shadowWindow.environment` is populated, but this per-row projection is still null (T15) |
| `runningBuildReleaseId` | string \| null | deployed `GIT_SHA`/`SERVICE_VERSION` | The app reads the full `GIT_SHA`, but this per-row projection is still null (T16). `shadowWindow.builds` names evidence contributors, not the currently serving build |
| `lastTransition.{seq, action, commandId, actorUserId\|SYSTEM, createdAt, payloadFingerprint}` | | `FeatureLaunchGateTransition` | `action ∈ {OPEN, CLOSE}` |
| `snapshot.targetEnvironment` | enum | `controlPlaneSnapshot` | Required on every transition |
| `snapshot.buildReleaseId` | string | `controlPlaneSnapshot` | Immutable build that the transition was approved against |
| `snapshot.expectedGeneration` | int | `controlPlaneSnapshot` | CAS input; a stale value must have changed nothing |
| `snapshot.validationEvidenceRef` / `…Hash` | string? / string? | `controlPlaneSnapshot` | **Nullable for `ORDINARY`; required for `SPECIALIST_LEGAL`** |
| `snapshot.specialistApprovedByUserId` | id? | `controlPlaneSnapshot` | Nullable for `ORDINARY`; required for `SPECIALIST_LEGAL` OPEN |
| `snapshot.releaseApprovedByUserId` | id? | `controlPlaneSnapshot` | Required on normal OPEN/CLOSE; may be null only on emergency CLOSE |
| `snapshot.emergencyClose` | bool | `controlPlaneSnapshot` | `true` forbids OPEN |
| `snapshot.emergencyAuthorityUserId`, `snapshot.incidentRef` | id?, string? | `controlPlaneSnapshot` | Both required when `emergencyClose=true` |
| `evidenceStale` | bool \| null | derived | `true` when the current `FEATURE_LAUNCH_MATRIX` evidence hash ≠ the hash on the last OPEN. Currently null; missing evidence freshness blocks OPEN/reopen (R1/R2/R4) |
| `counts.commandConflicts` | int \| null | `EntitlementCommand` + gate command rejections | Key-reuse-with-different-payload and stale-expected-generation rejections; currently null in the health projection |
| `counts.wouldBlock` | int | `FeatureLaunchObservationBucket` (hourly, tenant-anonymous) | Meaningful pre-flip only (Plan G2.1). **After the enforcement flip any nonzero value means a missing catalog row.** Never read alone — see `shadow.observed` below |
| `shadow.{observed, wouldBlock, hoursObserved, lastObservedHourUtc, bySurface, byReason, surfacesExpected, surfacesMissing, coverageComplete}` | | same buckets, trailing 24 h **bounded on both sides** (future-dated rows are excluded — an hour that has not happened yet is not evidence, and `hoursObserved` can therefore never exceed `windowHours`) | `observed` is the denominator. **A `wouldBlock` of 0 satisfies R1 only when `observed` > 0**: "no blocks" and "no measurement" are otherwise the same number |
| `counts.fallbackServed` | int \| null | fallback counter | CLOSED-route friendly fallback rendered/handed off; currently null |
| `counts.denied` | int \| null | audit rows `AuditResult=DENIED` | Partial seam exists (`AuditResult` enum + `AuditService`); the gate dimension and projection are absent |
| `counts.terminalSuppressed` | map by reason \| null | `ExecutionAttempt` terminal states | Global terminal totals exist, but exact per-route totals are currently null |
| `inFlight.count` / `inFlight.oldestAgeSec` | int / int | open `DISPATCHING` tokens | Spec CC1: "an HTTP request already dispatched cannot be unsent" — must be visible during and after CLOSE |
| `unknownOutcome.count` / `…oldestAgeSec` | int / int | `UNKNOWN_EXTERNAL_OUTCOME` rows | Drives R7 |
| `queued.count` / `queued.oldestAgeSec` | int / int | `ExecutionAttempt` QUEUED + outbox age | Outbox age is readable today (`OutboxEvent.availableAt/attempts`) but is not gate-dimensioned |
| `runbookRef` | string | this file | e.g. `feature-launch-control#R3` |
| `recoveryActionKey` | string | `FEATURE_LAUNCH_MATRIX` | The explicit Resume/Reissue path for this row |
| `owner.releaseOwner` / `owner.specialistOwner` | role ref | `FEATURE_LAUNCH_MATRIX` | `specialistOwner` non-null iff `SPECIALIST_LEGAL` |
| `matrixRowRef`, `matrixRowStatus` | string, `RESOLVED \| BLOCKED` | `FEATURE_LAUNCH_MATRIX` | A `BLOCKED` row must never be OPEN (Plan §3 F0) |

**Pre-enforcement projection gate:** the read transport is live, but the row is still
PARTIAL. `environment`, `runningBuildReleaseId`, `evidenceStale`,
`counts.commandConflicts`, `counts.fallbackServed`, `counts.denied` and
`counts.terminalSuppressed` are null, while `runbookRef`, `recoveryActionKey`,
`matrixRowRef` and the owner fields are not projected. R1/R2 must not OPEN any row until every field required
by Spec FR-G5 is present and non-null for that operation; logs, transition history and
`shadowWindow.builds` cannot substitute for the current serving-build projection.

Route catalog covered by row type A (Spec §6.1): every sellable feature `DEFAULT` row (18 top-level keys, minus the two always-on PLATFORM keys), plus `cap.wht50bis/{SYSTEM_INITIAL_ISSUE, SYSTEM_CONTENT_CORRECTION, SYSTEM_REPLACEMENT_COPY}`, one row per `cap.thai_tax.external_filing_correction/(formType, correctionRoute, channelVersion)`, one per `cap.thai_tax.vat_scope_credit_transfer/(transitionKind)`, and `[LATER] cap.thai_tax.vat_credit_in_product_offset` seeded CLOSED with no OPEN path in v5.1.

### 2.2 Row type B — feature lifecycle aggregate (one per `featureKey`, tenant-anonymous)

| Field | Type | Source | Notes |
|---|---|---|---|
| `featureKey` | string | canonical catalog | |
| `companiesOn` / `companiesDraining` / `companiesOff` | int | canonical entitlement rows | Counts only — no `companyId`, no company name |
| `oldestDrainingAgeHours` | int \| null | latest `DISABLE_REQUESTED` + open `RunoffSnapshot` items | Spec CC1: DRAINING is *derived*, never stored as a free state. `null` = nothing draining, deliberately NOT `0` |
| `drainingOpenItems` | int \| null | `RunoffSnapshot` | Membership never widens after cutoff. `null` = nothing draining; `0` = draining with nothing left to do — R5 triages on the difference |
| `drainingReconcilerLastRunAt` / `reconcilerErrors` | ts / int | runoff reconciler | Reconciler "repairs missed completion events and alerts on DRAINING age" |
| `epochMismatchSuppressed` | int | `ExecutionAttempt` | Stale-epoch work suppressed in window |
| `nullEpochPending` | int | pre-gate NULL-stamped rows | Must reach 0 at the enforcement flip (R6) |
| `backfill.{authorized, running, needsReview, failed}` / `backfill.maxLagMin` | int | `BackfillRun`/`Item` | Plan §8.4 watch item |
| `normalizationIncomplete` | int | `CompanyEntitlementNormalization` | CC7 day-14 / seven-zero-day evidence |

### 2.3 Must never appear in the health view

- Any `companyId`, company name, tenant domain, branch name or member/user identity of a customer.
- Any customer PII or business content: LINE message text, customer name, payee, tax ID, document number, invoice/receipt image, amounts attributable to one tenant.
- Any per-tenant route state, override, cohort or percentage — none exists in v5.1 and the view must not imply one.
- Route keys, gate state or generation on any customer/partner/tenant/AI surface. The customer sees only the purchased action or its friendly fallback; a CLOSED route says *temporarily unavailable*, never "not purchased" (Spec CC1). `feature_not_enabled` keeps its existing copy **ยังไม่ได้เปิดฟีเจอร์นี้** (Spec §7); the CLOSED-route string is a distinct label and is not yet written (OPEN-9).
- Free-text `reason` as a substitute for a required snapshot field — Spec CC1: "No required field may be reconstructed later from logs or `reason`."

### 2.4 Data sources (binds F1)

| Field group | Source | Status |
|---|---|---|
| state / generation / lastSeq / transitions / approvals / evidence | `FeatureLaunchGate` + `FeatureLaunchGateTransition.controlPlaneSnapshot` | **LIVE** (T1, T2); derived `evidenceStale` projection remains null |
| command conflicts | `EntitlementCommand`, gate command rejection path | command/CAS **LIVE** (T3, T4); health counter remains PARTIAL/null |
| epochs, DRAINING, runoff | `EntitlementTransition`, `RunoffSnapshot`, reconciler | epoch storage and DRAINING/runoff **LIVE** (T5, T6); suppression/null-epoch health projections remain partial |
| in-flight / unknown outcome / queued / terminal reasons | `ExecutionAttempt` + `DISPATCHING` token | open per-route age counts **LIVE** (T7, T8); provider completion and per-route terminal totals remain PARTIAL (T9, T12) |
| would_block | `FeatureLaunchObservationBucket` — folded per sweep by `LaunchShadowSweep.flush()` (`launch-shadow.probe.ts`) | **EXISTS** (T10). Hourly, keyed by window/environment/build/surface/gate/route/reason; no companyId, no PII. Read filtered to the running environment, across every build in the window |
| fallback served | fallback counter | TBD-F1 (T11) |
| DENIED | audit rows (`AuditResult=DENIED`, `AuditRiskLevel`) — `apps/api/src/modules/audit/application/audit.service.ts` | **EXISTS**, needs a gate dimension |
| outbox age / poison | `OutboxEvent.status/attempts/availableAt` — `prisma-outbox.repository.ts:80-98` | **EXISTS**; `DEAD` has no reconciler/alert (T14) |
| build id | full `GIT_SHA` from `resolveDeploymentIdentity()` | runtime read is **LIVE**; per-row `runningBuildReleaseId` remains PARTIAL/null (T16) |
| environment id | `resolveDeploymentIdentity()` from runtime `DEPLOY_ENVIRONMENT` plus full `GIT_SHA`; deployment-manifest test requires both wherever `APP_ENV` is set | runtime **LIVE**; per-row projection PARTIAL/null (T15; OPEN-2 resolved) |
| alert transport | `emitSecurityEvent` + `SECURITY_EVENT` names (`apps/api/src/common/logger/security-event.ts`) → CloudWatch metric filter on `$.riskLevel = "HIGH"\|"CRITICAL"` → `SECURITY_ALERT_TOPIC_ARN` | **EXISTS** — a new event name at HIGH alarms with no infrastructure change |
| claim/lock wait p95/p99, throughput | none — no metrics endpoint or `prom-client` anywhere in the repo | TBD-F1 (T17) |

Known measurement caveats the release gate must not paper over: some outbox appends remain
fire-and-forget outside the caller's transaction, so an outbox-derived count can undercount.
Claiming itself is now one fenced `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING` with token/CAS
completion; the historical split-claim race is closed. `entitlement.updatedAt` is still not a
durable generation fence; epoch/generation fields are authoritative.

---

## 3. Runbook index

| Id | Class | Executor | Section |
|---|---|---|---|
| R1 | Normal OPEN — ordinary row | RO | §4.1 |
| R2 | Specialist/legal OPEN | RO + TS | §4.2 |
| R3 | CLOSE (normal and emergency) | RO / OC | §4.3 |
| R4 | Reopen after close | RO (+TS) | §4.4 |
| R5 | DRAINING stuck / runoff reconciliation | OC → RO | §4.5 |
| R6 | Stale generation / NULL-epoch work found | RO | §4.6 |
| R7 | `UNKNOWN_EXTERNAL_OUTCOME` | OC + domain owner | §4.7 |
| R8 | Operator permission/session recovery | PSO | §4.8 |
| R9 | Remote release/F2/retirement lease is `UNKNOWN` | OC + RO | §4.9 |

Universal preconditions for every command in R1–R4: the target row exists in `FEATURE_LAUNCH_MATRIX` with `matrixRowStatus=RESOLVED`; the command carries `commandId` + `payloadFingerprint` + `expectedGeneration`; locks are taken in canonical `(gateKey, routeKey)` order; and the health view is read **before and after** — never trusted as an authorization.

---

## 4. Runbooks

### 4.1 R1 — Normal OPEN, ordinary row

| | |
|---|---|
| **Trigger** | A sellable feature `DEFAULT` row or ordinary operational row has passed its own `FEATURE_LAUNCH_MATRIX` evidence, and its exit criteria in Plan §4 are green |
| **Executor** | RO only. OC may not OPEN under any circumstance |
| **Preconditions** | (1) `matrixRowStatus=RESOLVED`; (2) enforcement-flip prerequisites for this environment are already met (Plan G2.1: shadow readers deployed, 100% of the catalog materialised, NULL work reconciled per R6); (3) immutable `buildReleaseId` is deployed *in this environment* and its canary bake finished; (4) `state=CLOSED` and `expectedGeneration` = the value just read; (5) no sibling assumption — Spec CC1: "An OPEN sibling never authorizes another route" |
| **Projection gate** | Every FR-G5 health field needed by this operation is present and non-null, including the current environment/serving build, evidence freshness, command-conflict and fallback counts, owner/runbook and recovery action. The current PARTIAL projection fails this gate, so R1 and R2 remain blocked even if shadow counts are green |
| **Promotion order** | development/test → staging → production (Spec FR-G5, Plan §8.4). The same immutable `buildReleaseId` must be the one promoted; a rebuild restarts the ladder. **The `staging` rung has no environment today** (`DEPLOY_ENV ∈ {production, uat}`) — OPEN-3 |
| **Steps** | 1. Read row type A; record `generation`, `state`, `runningBuildReleaseId`, `counts.*`. 2. Confirm `counts.wouldBlock` for this row is 0 in the observation window **and `shadow.observed` for this row is > 0** — a zero out of zero observations is not evidence, it is an unrun measurement — and `matrixRowStatus=RESOLVED`. Check `shadowWindow.environment` is this environment and `shadow.hoursObserved` is not a single hour. **Coverage (piece 5):** `shadow.coverageComplete` must be `true` and `shadow.surfacesMissing` empty — a family whose async surfaces are not all instrumented has no full-shadow evidence to read. The `hoursObserved > 1` bar is per ROUTE, not per surface: a cron-cadence surface (`notifications.sweep.daily_owner_summary`) can only produce one bucket hour per day, so the per-surface bar is `observed > 0`. 3. Issue OPEN with `targetEnvironment`, `buildReleaseId`, `expectedGeneration`, `routeClass=ORDINARY`, `releaseApprovedByUserId`, `emergencyClose=false`, `commandId`, `payloadFingerprint`. Evidence fields stay null. 4. Confirm the command returned the new generation (a retry with the same key/fingerprint must return the same result, not a second transition) |
| **Verification** | `state=OPEN`, `generation` = previous + 1, `lastTransition.snapshot` carries all five required fields; sibling rows unchanged; `counts.fallbackServed` stops growing for this row; one real business action completes end to end. Do **not** probe an endpoint during a canary bake — the ALB 4xx rollback alarm treats probes as failures (`docs/runbooks/h-14-private-ingress-cutover-runbook.md`) |
| **Rollback** | Normal CLOSE (R3) on the exact row with a stated reason; if a customer-facing breach is in progress, emergency CLOSE. Reopen then follows R4 in full |
| **Escalation** | Any of: `evidenceStale=true`, `matrixRowStatus=BLOCKED`, environment mismatch, unavailable approver → do not OPEN (Plan §9 stop condition) |

### 4.2 R2 — Specialist/legal OPEN (`cap.wht50bis/*`, `cap.thai_tax.external_filing_correction/*`, `cap.thai_tax.vat_scope_credit_transfer/*`)

| | |
|---|---|
| **Trigger** | A Thai tax specialist has validated **only** the wording, routing, payment race, channel/rule support, surcharge/refund copy and fixtures for that exact row (Spec CC5) |
| **Executor** | RO executes; TS approves. Both approvals are recorded on the transition; neither substitutes for the other |
| **Additional preconditions** | `validationEvidenceRef` + `validationEvidenceHash` equal the **current** `FEATURE_LAUNCH_MATRIX` values (`evidenceStale=false`); `specialistApprovedByUserId` present; `routeClass=SPECIALIST_LEGAL`. A stale or missing hash must be rejected by the command, not by the operator's judgement (AC29) |
| **Rollout order (Plan §8.3)** | F0 → all CLOSED fallbacks/global-hub paths E2E (initial EXTERNAL, corrected EXTERNAL, EXTERNAL ใบแทน, manual filed-correction packet, external VAT transition) → `cap.wht50bis/SYSTEM_INITIAL_ISSUE` → `SYSTEM_CONTENT_CORRECTION` → `SYSTEM_REPLACEMENT_COPY` → validated VAT `transitionKind` rows → external-filing automation last. This is rollout order, **not** a runtime dependency: closing a later route never closes an earlier validated one |
| **Steps** | R1 steps 1–4, with the two evidence fields and the specialist approval populated, and with the fallback path re-verified as still working *before* the OPEN (the external route must never disappear when the SYSTEM route opens — Spec CC5) |
| **Verification** | R1 verification, plus: the EXTERNAL/manual fallback for the same business issue still completes; the same `businessIssueKey` card is unchanged; no historical row auto-issues (Spec CC5: "Opening `cap.wht50bis/SYSTEM_INITIAL_ISSUE` later never auto-issues historical rows") |
| **Rollback** | Close only that row. The manual/external fallback resumes as the documented behaviour — it is never removed while the SYSTEM route is open |
| **Never** | `[LATER] cap.thai_tax.vat_credit_in_product_offset` has no OPEN path in v5.1 even with specialist approval; it requires a separately confirmed v6 spec/plan (Spec §11.3, Plan §8.3) |

### 4.3 R3 — CLOSE

Two distinct paths. Both close exactly one `(gateKey, routeKey)` and increment only that row's generation.

| | Normal CLOSE | Emergency CLOSE |
|---|---|---|
| **Trigger** | Planned rollback, failed post-open verification, evidence withdrawn | Live route-specific breach: wrong artifact rendered, statutory/legal risk, runaway external sends, integrity alarm |
| **Executor** | RO | OC alone — Spec CC1: "stopping new work must not wait for a second approval" |
| **Required snapshot** | `targetEnvironment`, `buildReleaseId`, `expectedGeneration`, `releaseApprovedByUserId`, `emergencyClose=false` | `emergencyClose=true`, `emergencyAuthorityUserId`, `incidentRef`; release/specialist approval may be omitted |
| **Forbidden** | — | The emergency path may never carry `action=OPEN` |
| **Scope** | One row. A whole feature closes only when its own `DEFAULT` row or a proven shared invariant fails; only a proven shared-foundation integrity breach closes all (Plan §8.4) | same |

**What happens to work already in the system** (Spec CC1 — verify each, do not assume):

| Work state at close | Result |
|---|---|
| Not yet claimed (`QUEUED`) | Claim is refused; the row terminalises to `SUPPRESSED_LAUNCH_GATE_CLOSED` / `SKIPPED_LAUNCH_GATE_CLOSED` or the matrix-declared handoff. It never replays on reopen |
| Claimed, DB mutation not committed | The claim and the mutation share one transaction; the close either commits first (claim impossible) or sees an already-claimed attempt |
| `DISPATCHING` token committed, provider not yet called | Close prevents any *new* token; the matrix policy decides bounded wait vs. record-as-dispatched |
| Provider already called | Explicitly **in flight** — cannot be unsent. The worker records the eventual result once; no retry is permitted under a closed/mismatched generation |
| Crash/timeout after dispatch, no authoritative result | `UNKNOWN_EXTERNAL_OUTCOME` → R7 |
| Partial SYSTEM WHT work | Spec CC5: a complete valid artifact is kept/linked with only delivery handed off; a number-only DRAFT is immutably cancelled with its number consumed and an EXTERNAL handoff created |

**Verification:** `state=CLOSED`; generation +1 on this row only; every sibling row's generation unchanged; `inFlight.count` and `unknownOutcome.count` recorded at close time and monitored to zero; `counts.fallbackServed` begins increasing (customers are getting the fallback, not an error); no new `DISPATCHING` token appears after the close timestamp.
**Escalation:** if `inFlight.count` does not drain within the (undefined — OPEN-6) bound, or a retry appears under the closed generation, treat as an F1 correctness defect and page PSO.

### 4.4 R4 — Reopen after close

| | |
|---|---|
| **Trigger** | The cause of the close is fixed and re-validated |
| **Executor** | RO (+ TS for `SPECIALIST_LEGAL`) |
| **Rule** | A reopen **is** a normal OPEN. Spec CC1: "an old approval never reopens a new generation". Run R1 (or R2) from the top against the *current* build, environment, evidence hash and expected generation |
| **Steps** | 1. Confirm the incident is closed and its `incidentRef` is referenced in the new command's context. 2. Refresh evidence if `evidenceStale=true`; a `SPECIALIST_LEGAL` row needs a fresh specialist approval when the fixtures/wording changed. 3. Execute R1/R2. 4. **Do nothing else** — reopening never revives suppressed work |
| **Resume/Reissue** | Old work stays terminal. Recovering it requires an explicit Resume (ordinary work) or Reissue (external/legal artifacts) that *creates a new row* under the current availability vector, per the row's `recoveryActionKey`. External/legal mutations never auto-resume. Who is authorised to press Resume/Reissue is OPEN-11 |
| **Verification** | Zero terminal rows changed state at reopen; the same `businessIssueKey` card switches from fallback back to the primary action without auto-running (Spec AC25-FIN); one explicit Resume produces exactly one new attempt with the current `(gateKey, routeKey, generation)` |

### 4.5 R5 — DRAINING stuck / runoff reconciliation

| | |
|---|---|
| **Symptom** | Row type B `oldestDrainingAgeHours` past threshold (OPEN-6), or `drainingOpenItems` flat while `drainingReconcilerLastRunAt` advances, or `reconcilerErrors > 0` |
| **Executor** | OC triages; RO owns any product decision; domain owner completes real runoff work |
| **Expectations that must hold** | DRAINING is derived from the latest `DISABLE_REQUESTED` plus open items in the **immutable** runoff snapshot; completion appends `OFF`. The reconciler repairs missed completion events and alerts on age — Spec CC1: "it does not widen snapshot membership" |
| **Steps** | 1. Read row type B (`drainingOpenItems`, `oldestDrainingAgeHours` are now live, not reserved). 2. List the affected lifecycles: `POST /v1/internal/feature-launch/runoff/draining` with the worker token — this is the internal operator surface and DOES return `companyId`, unlike the tenant-anonymous health view. 3. Classify: (a) genuine open runoff work awaiting a human → leave DRAINING, notify the owning domain; (b) missed completion event → `POST /v1/internal/feature-launch/runoff/sweep` and confirm `OFF` is appended; (c) sweep returning `errors > 0` → treat as a defect, page PSO (an `errors` entry means a snapshot could not be READ — never that a drain was skipped for being busy). 4. Never hand-edit a snapshot, never add members, never force `OFF` while items are open — the sweep re-asks the derivation and physically cannot force OFF with open items |
| **Paging** | Both endpoints take `limit` (clamped 1–200) and `cursorId`, and return `nextCursorId`. Keep calling with the returned cursor until it comes back `null`: a lifecycle that legitimately never completes sits on page one forever, and without the cursor it would starve every drain behind it. Rows come oldest-first, so the longest-stuck drain is always seen first |
| **Cadence** | The sweep is **schedulerless by ruling (OQ-7)**: the disabling request completes an empty drain post-commit, which covers every case reachable today, so the endpoint exists for the crash window (commit succeeded, completion call died) and for future non-empty drains. Wiring a cadence is an outstanding ops item, not a code gap |
| **Tenant identification** | The health view is tenant-anonymous by design; the `runoff/draining` endpoint in step 2 is the scoped operator surface that names the company. The general "normal scoped support path" (Spec §9) still does not exist — OPEN-4 |
| **Reconciler-run metrics** | `drainingReconcilerLastRunAt` and `reconcilerErrors` remain `null` (ruling OQ-6): they describe RUNS, which nothing records durably, so filling them needs a table and therefore a migration. Use the sweep's own returned counts (`examined`/`completed`/`stillDraining`/`errors`) instead |
| **Verification** | `oldestDrainingAgeHours` decreases; `drainingOpenItems` reaches 0 and an `OFF` transition is appended in the same lifecycle; retained post-OFF compensation for an exact pre-cutoff legal artifact remains reachable (Spec CC1) and is *not* counted as ordinary runoff |
| **Escalation** | Any pressure to "just force it OFF" is a stop condition — a forced OFF strands work the snapshot still owns |

### 4.6 R6 — Stale generation / NULL-epoch suppressed work discovered

| | |
|---|---|
| **Symptom** | `epochMismatchSuppressed` or `counts.terminalSuppressed` rises unexpectedly; `nullEpochPending > 0` after the enforcement flip; a support report of "queued work that never ran" |
| **Executor** | RO decides disposition; domain owner executes |
| **Absolute rule** | **Never back-stamp.** Spec CC1: "Never back-stamp old work with current epochs/generations, even before the first disable/close" |
| **Steps** | 1. Classify each row against the fixed cutover cutoff. 2. Default disposition is terminal or handoff. 3. Only an enumerated safe internal projection, or an explicitly approved **Reissue** that creates a new row with a current vector, may proceed. 4. Record the disposition; the old row stays terminal |
| **Verification** | `nullEpochPending` reaches 0 and stays there; no attempt row's stored vector was mutated (append-only); each approved Reissue produced exactly one new attempt |
| **Escalation** | If NULL-stamped rows still exist at the enforcement flip, the flip is not ready — Plan G2.1 requires reconciliation *before* the atomic flip |

### 4.7 R7 — `UNKNOWN_EXTERNAL_OUTCOME`

| | |
|---|---|
| **Symptom** | `unknownOutcome.count > 0`, or `unknownOutcome.oldestAgeSec` past threshold (OPEN-6). Cause: crash/timeout after dispatch with no authoritative provider result |
| **Executor** | OC triages; the owning domain performs the reconciliation; the user-facing card shows **กำลังตรวจสอบผล** (Spec FR-D) |
| **Absolute rule** | Spec CC1: "poll the provider or require one prefilled manual reconciliation, **never blind-retry or claim failure/success**". A resend is a duplicate legal or customer-facing action |
| **Steps** | 1. Identify the provider and the durable attempt/dispatch token — the token doubles as the provider idempotency key wherever supported. 2. Poll the provider for the authoritative result. 3. If the provider cannot answer, route one prefilled manual reconciliation to the owning domain; a human records the actual outcome once. 4. Record the result on the original attempt. Never mint a second attempt to "check" |
| **Verification** | The attempt reaches a terminal recorded result exactly once; no second external call was made; the card leaves กำลังตรวจสอบผล; in-flight and unknown counts both return to baseline |
| **F1 dependency this runbook is blocked on** | **Outbox `DEAD` rows have no reconciler, no dead-letter handler and no alert** (`prisma-outbox.repository.ts:83,90`; `docs/agent-memory/f0-inventory-async-surface.md` §6a, §10). Workflow action runs already have the correct shape (`DEAD_LETTERED` + replay path, `workflow-action-runner.use-case.ts:104-121`). Until F1 gives outbox `DEAD` the same support-visible reconciliation item, steps 3–4 have no queue to land in for outbox-carried work — see T14 / OPEN-5 |

### 4.8 R8 — Operator permission/session recovery

| | |
|---|---|
| **Symptom** | The release owner is unavailable, an approver's session/credentials fail mid-incident, or a command is rejected for missing authority |
| **Rule 1** | A missing approver is **never** a reason to skip a required field. Spec CC1: no required field may be reconstructed later from logs or `reason`. If `releaseApprovedByUserId` cannot be obtained, the OPEN does not happen |
| **Rule 2** | Stopping is always available: OC can emergency CLOSE alone with `incidentRef`. Availability problems therefore degrade toward *closed*, never toward *open* |
| **Steps (RO unavailable)** | 1. If the need is to stop harm → OC emergency CLOSE (R3), then reconvene. 2. If the need is to OPEN → wait for a valid RO, or PSO designates a standing deputy RO **in advance**; an in-incident self-designation is not an approval. 3. Record the substitution in the incident record |
| **Steps (session/credential failure)** | Re-authenticate through the normal path; on repeated failure PSO uses the break-glass credential path and rotates afterwards (`docs/runbooks/p1-production-security-operations.md`). Support keeps read-only access throughout — the view is the diagnostic, not a workaround |
| **Blocked on** | No platform-level (non-company) authority exists in the codebase today; company RBAC cannot express "release owner" or "on-call" — OPEN-1 |

### 4.9 R9 — Remote release/F2/retirement operation is `UNKNOWN`

| | |
|---|---|
| **Symptom** | A release task reports `UNKNOWN`, its heartbeat lease expires without a terminal result, or the next release/F2/retirement task exits 75 naming a blocking `RemoteReleaseOperation` id and exact ECS task ARN |
| **Absolute rule** | `UNKNOWN` is authority to **stop**, never authority to retry. Do not delete/update the row, do not launch another writer, and do not infer success from a GitHub timeout or a stopped task alone. The partial unique DB index intentionally keeps the environment blocked |
| **Normal release lifecycle** | A successful pre-deploy `release` task intentionally remains `RUNNING` for the rollout; this is not an incident by itself. Each service rollout appends its exact service/deployment/revision record to `deploymentManifestJson` through `release-bind`. Bootstrap/config refresh can append more than one record for the same service. Only an `all`/`api-web` target attests launch-gate authority; AI/worker-only hotfixes must not attest an API build that will not serve. Only health verification plus `release-finalize`, or api-web retirement/reconciliation, makes the parent terminal. Cancelling the workflow leaves this parent blocking and it eventually becomes `UNKNOWN` |
| **Controller proof** | Ordinary release/bind/finalize/retirement and UAT M-01 tasks accept only the exact environment deploy workflow on `main`; F2 PLAN and APPLY/VERIFY accept only their respective F2 workflow paths. UAT application SHA still has to be reachable from `develop`; production SHA from `main`. An arbitrary workflow path is rejected. `MANUAL` is reserved solely for audited `operation-reconcile` break-glass because a workstation cannot supply durable branch-ancestry evidence |
| **Identify** | Query `RemoteReleaseOperation` for the target environment with `status IN ('RUNNING','UNKNOWN')`. Record its `id`, `mode`, `sourceBranch`, full `buildReleaseId`, GitHub/manual controller fields, original `ecsTaskArn`, current `leaseOwner`, the complete append-only `deploymentManifestJson`, optional retirement deployment/revision/active-build fields, heartbeat and reason. The source branch must be `develop` for UAT and `main` for production |
| **Evidence required** | The default historical authority is `ecs describe-tasks` for each **exact original task ARN**, including STOPPED status, `startedBy`, task definition, overrides and every container exit code; see the incident-only exception below when all three task records have expired. Also require (2) the exact CloudWatch task log stream; (3) operation-specific post-condition: migration/sync version for release, independent `f2-verify`/company hashes for F2, or append-only retirement rows tied to the stored deployment ARN; (4) exact SSM identity, two stable ACTIVE service reads and two stable unpaginated `ListServiceDeployments(maxResults=100)` reads. The named deployment must be the unique newest record and terminal state must have one active configuration. For two SGs, prove the fixed requested egress SG plus the one same-VPC ECS-managed SG whose description names the exact service ARN. Never edit/recompute a hash by hand. Missing/conflicting/paginated/moving evidence leaves `UNKNOWN` |
| **Settled null rule** | `currentDeployment=null` is neither success nor failure by itself. Accept it only when the exact bound deployment is SUCCESSFUL, unique-newest, the service is ACTIVE with one exact target revision/full SHA/configuration, SSM is exact and both reads agree. `verify-serving-api-build.sh` compares the complete canonical `DescribeServiceDeployments` response or complete exhaustive unpaginated history across both reads, not only the selected row. Any other non-null pointer, dual active state, later/equal-time deployment, malformed timestamp, pagination, equal-time newest tie, or movement in any history row stops recovery/retirement/F2 |
| **Exact release-intent recovery** | Dispatch `recover-release-intent.yml` from `main` with `release_ref` = the held target SHA and `recovery_ref` = a newer reviewed executor SHA. The executor must descend from the target and the pinned environment fix floor, belong to the environment source branch, have exact successful pull-request CI for UAT or an explicit manual CI run for production, signed digest and OCI revision. Audit stores both SHAs, executor digest, CI run, signer/workflow/run/task and platform evidence. The controller never updates an application service. CREATE recovery may fill an absent intent-owned SSM cache only with `Overwrite:false`; it never overwrites. `ParameterAlreadyExists` is accepted only when two subsequent exact reads both equal the intended service ARN; a different or moving value blocks. A replay freshly derives the remote decision and may return the stored result only when terminal intent status and evidence exactly match; any mismatch blocks. For non-terminal recovery, finish exact SSM proof/repair first, then durably close the recovered intent, then run any cleanup/retirement child, then persist its marker. A closed recovered intent therefore implies SSM proof; its cleanup marker additionally implies successful cleanup. Terminal replay performs fresh two-read validation but is read-only: no repair, intent mutation, child, or marker. Rollback/cutover authority cleanup is api-web-only; AI/worker recovery never retires launch authority. A successful legacy api-web BOUND result remains unresolved until exact recovery retires superseded launch authority and durably sets `legacyCutoverCompletedAt`; a failed child cannot be bypassed by recovering another intent. If the parent has multiple API deployments, select the latest successful non-no-op BOUND intent. After exact retirement, its transaction may also mark earlier successful legacy BOUND rows of the same environment/build/parent, excluding rollback-observed rows. Never recover an older intent by ignoring an unexpected later deployment. A successful individual recovery may leave the parent UNKNOWN until every target service and required cleanup is complete |
| **Recovery floor** | UAT is pinned to reachable imported recovery floor `668a2d0827921257d6412a5edc0598d5aeb9a0fa`, the repository's initial commit containing the reviewed PRE_INTENT/intent recovery implementation. The older pre-import floor/executor SHAs are historical evidence only and are not reachable in this repository. Production keeps its separate floor; never copy either environment's value to the other or infer approval from ancestry alone |
| **Recovery test gate** | The registered real-PostgreSQL recovery suite is strict whenever `DATABASE_URL` is explicitly supplied: connection/schema/setup failures fail the run and no real-DB case may skip. A developer-only skip is permitted only without an explicit URL when no local PostgreSQL server is reachable |
| **Missing non-api intent (bounded ORPHAN)** | Use `intent_id=ORPHAN` only for the proven historical non-api UPDATE defect. The operator supplies only the exact parent/intent/binder task ARNs; the controller derives payload/manifest from immutable stopped tasks, verifies exact task shapes, exit `0/75/75`, shared old signed image + OCI target revision, original controller/SHA and bounded chronology. The task then proves the exact successful unique-newest deployment, singleton runtime/config/network/SSM twice and absence of any same-service intent before atomically inserting one normalized BOUND intent, manifest evidence and CRITICAL audit. Caller-supplied JSON, a different defect shape, or generic missing intent is forbidden |
| **Expired stopped-task exception (this UAT incident only)** | Retained stopped tasks remain the default. Use the fallback only when `DescribeTasks` returns zero tasks and exactly three `MISSING` failures for the supplied parent/intent/binder ARNs; any partial retained/missing set blocks. It is hard-bound to UAT parent `bf131086-6055-4143-a77c-579bc7d58b57` and service `watchdog-bms-uat-ai-gateway`. The neutral `main` workflow byte-pins `infra/uat/recovery-evidence/bf131086-6055-4143-a77c-579bc7d58b57.json` at SHA-256 `f152c3da1b7d6cb54d1d51b6714f8028fb2c43f8dd324efbc829142906fc7cfb`. It must then live-read the three exact task-definition registrations and validate shape/env, common signed image + OCI revision, exact CloudWatch timestamp/message, chronology, and the same current two-read platform/network/SSM proof. Manifest CloudTrail event IDs are corroborating audit metadata, not live authority, because the deploy role lacks `LookupEvents`. There is no production or generic fallback; any future expiry requires a separately reviewed contract |
| **Release failed before api-web intent** | Use the same controller with `intent_id=PRE_INTENT`, never generic reconcile. This is valid only for an UNKNOWN `all|api-web` parent with no api-web intent and every other intent resolved. Two stable reads must prove the incoming SHA absent from every active api-web configuration. The task then idempotently retires only the parent's incoming build, persists the cleanup marker and concludes `RECONCILED_FAILED_CONFIRMED`. For `all`, zero durable service intents plus that exact cleanup marker also proves the rollout stopped before every ECS mutation because `deploy.sh` persists each service intent first. Any active incoming build, moving/malformed/non-ACTIVE service, SSM mismatch, open intent, partial cleanup or partial service coverage still leaves the parent blocked. Replay freshly reads the platform and succeeds only when its canonical evidence exactly equals the stored cleanup marker; mismatch blocks rather than widening or returning stale success |
| **Service coverage and this UAT incident** | `all` requires API, AI Gateway and workers evidence; zero OPEN intents is insufficient. Live closure completed under neutral `main` controller `b91fb84b` with executor `60dfc12b` against held SHA `605a52e…`: run `30772897816` created AI Gateway BOUND intent `73bb4f20-1274-4ee0-a22a-edd6ac73b045` through bounded ORPHAN and left the parent nonterminal; run `30773062124` replay-validated API BOUND intent `483aa70a-5a4c-4263-98a3-27ad6635c160`, ran the launch-authority cleanup/cutover path (`active=605a52e…`, 16 routes, zero builds retired because the held build was still active), and left the parent nonterminal; run `30773209171` recovered workers intent `2def7974-c2e1-4c60-b270-a66389af0b8d` and terminalized the parent, which indirectly proves the API cutover marker no longer blocked terminalization. All three workflows concluded exact recovery success. Next deploy a new fixed SHA with `target=all`; do **not** normal-retry `605a52e…` because ordinary deploy code comes from its old commit. Only after new-SHA health/finalization, `A5-RO` and an approved fresh artifact may the per-company state-only F2 APPLY run |
| **Run `30774515157` — drain race, not acceptance** | The candidate reached exact API/AI/workers revisions, but ECS reported deployment `SUCCESSFUL` before the prior active configuration had finished draining. The old waiter made one singleton/latest read pair and stopped safely; health, retirement acceptance and M-01 did not complete. Reconciliation left the parent failed-confirmed, no route opened and no UAT release was accepted. Patch the waiter to poll a bounded transient drain/moving state, while failing immediately on target/deployment mismatch, pagination, missing/duplicate/not-unique-newest history, rollback or `currentDeployment` pointing elsewhere. Then deploy a new full SHA; never relabel this run as acceptance evidence |
| **Reconcile** | With current environment deploy credentials and the exact release-task image/SHA, run `run-release-task.sh ... operation-reconcile` with `RELEASE_RECONCILE_OPERATION_ID`, `RELEASE_RECONCILE_TASK_ARN` (the original task), `RELEASE_RECONCILE_OUTCOME=SUCCEEDED\|FAILED_CONFIRMED`, an immutable `RELEASE_RECONCILE_EVIDENCE_REF`, and a plain-language `RELEASE_RECONCILE_REASON`. The script derives the reconciler's AWS actor and the new reconciler task ARN; neither may be copied from the original. Manual reconcile cannot bypass an unresolved successful legacy api-web BOUND intent: missing `legacyCutoverCompletedAt` still blocks until exact API recovery completes retirement |
| **Verification** | The original row becomes `RECONCILED_SUCCEEDED` or `RECONCILED_FAILED_CONFIRMED`; one CRITICAL `AuditLog` row names the original task, reconciler task, actor, evidence and reason. Replaying the exact same reconciliation is a no-op and creates no second audit; different evidence is rejected. Only then may the next writer start |
| **Bootstrap prerequisite** | Before the first UAT run, apply `infra/uat/setup-control-plane.sh`. If the dedicated release-task role is the only missing role and the operator cannot read the two inline policies yet, the explicit `UAT_IAM_BOOTSTRAP_APPLY_UNVERIFIED=true` bridge may create only that role with exact ECS-task trust and write only `watchdog-bms-uat-deploy` plus `watchdog-bms-uat-release-task-ecs-read`; it exits 75. The next GitHub controller must exact-readback both policies before any ECR/S3/ECS/SSM/database mutation. AccessDenied or any other role/trust drift is a stop condition |
| **Optional UAT M-01** | In `UAT Deploy`, select `target=all` and explicitly enable `run_m01_acceptance`. It runs only after health and release finalization for the same full SHA. Failure invalidates the acceptance evidence even if health was green; the task does not sync launch gates and cannot open any route/feature. It is unavailable in production |
| **F0 A5 evidence boundary** | UAT `A5-RO`, F2 PLAN and F2 VERIFY run directly as `watchdog_a5_ro`, with no ECS task role, role-default plus transaction/session read-only, no DML or sequence authority, database/schema `CREATE`, executable application `SECURITY DEFINER`, ownership, membership or inherited privilege, and `SELECT` on exactly `_prisma_migrations`, `Company`, `CompanyFeatureEntitlement`, `CompanyEntitlementNormalization`, `EntitlementTransition`, `AuditLog`, `CompanyOnboardingRun`, `FeatureLaunchGate`, `FeatureLaunchGateTransition`, `FeatureLaunchObservationBucket`, `ExecutionAttempt`, `RunoffSnapshot`, and `WorkflowTask`. Scan effective relation/function/schema authority across every non-system schema, cluster ownership through `pg_shdepend`, and reject RLS on a core relation. Bootstrap only after fetching current `develop`, proving the exact stable UAT serving SHA, verifying the `deploy-uat.yml` keyless signature and OCI revision. The A5 artifact is tenant-anonymous aggregate evidence bound to environment, exact serving/source full SHA, `queryCatalogHash` and deterministic `evidenceHash`; company ids/names must not appear. These paths are UAT-only until production is separately provisioned and reviewed. `A5-CAPACITY-MUTATING` remains a separately approved UAT-only load/concurrency operation. Missing A5 blocks F2 APPLY; missing capacity evidence blocks a bounded batch, enforcement and promotion, not the current per-company state-only APPLY |
| **A5 bootstrap credentials** | Use a per-run temporary `DOCKER_CONFIG` for the ECR login, signature verification, pull and OCI-label check; remove its credential file on every exit so the operator's keychain/config is not mutated. The read-only secret's exact name, account/region ARN and description are the identity boundary. Tags are intentionally non-authoritative inventory metadata: do not request `TagResource`, add best-effort tagging or widen IAM. Reusing an existing secret with the wrong ARN or description stops before the release task. Never print the secret value or pass it directly in process arguments |
| **PostgreSQL 18 A5 privilege** | Treat effective `MAINTAIN` on any non-system relation as forbidden write-like authority. The RDS master is non-superuser: bootstrap must not issue `NOSUPERUSER`, `NOREPLICATION` or `NOBYPASSRLS`; before and after hardening it proves those and all other privileged flags false and separately requires effective writer `ADMIN OPTION`. Accept either zero direct reader members (live RDS 18.3) or exactly one writer row with `ADMIN=true, INHERIT=false, SET=false` (stock PostgreSQL 18); every foreign, inheriting or SET-capable member blocks. Stop for a privileged/unmanaged role. Then verify committed defaults/grants through a fresh reader login. Stop A5/F2 on any mismatch, rotate the query-catalog hash after an authority-query change, and produce a fresh PLAN; never approve an earlier artifact |
| **F2 PLAN/APPLY/VERIFY** | PLAN uses only the direct A5 read role. Download the restricted full PLAN and require exact build/controller provenance, `approvalReady=true`, valid per-company `cohortKind`/`cohortEvidence`, reconciled cohort/unresolved/orphan totals, reviewable 64-hex hashes and an understood exact list of every orphan `{featureKey,enabled}`. `UNRESOLVED`, `PLAN_FAILED`, dependency exception, unknown write reason, hidden/unreviewed orphan or count/hash mismatch is a STOP. `f2PrecheckReady` authorizes only APPLY. APPLY alone receives the writer secret and durable remote-operation wrapper, then re-plans under each company lock and expected-version/hash CAS; drift refuses that company/run rather than accepting a new plan. VERIFY returns to the direct read-only role, and a final A5 artifact must again prove the authority/catalog guard clean and all WHT routes CLOSED. Never copy/edit a hash or treat F2 success as enforcement/promotion authority |

---

## 5. Alert / watch list (Plan §8.4 → concrete seams)

`EXISTS` = usable today. `PARTIAL` = a seam exists but lacks the launch-control dimension. `TBD-F1` = must be built in F1; do not assume it exists.

| # | Plan §8.4 watch item | Signal | Concrete source | Status |
|---|---|---|---|---|
| W1 | Entitlement/gate command conflicts | `counts.commandConflicts` per row, per hour | `EntitlementCommand` + gate command rejection path | PARTIAL — commands/CAS live; health counter null (T3, T4) |
| W2 | Stale epoch/generation suppression | `epochMismatchSuppressed`, `counts.terminalSuppressed` | `ExecutionAttempt` terminal reasons | PARTIAL — attempts live; required projections null (T7, T12) |
| W3 | DRAINING age | `oldestDrainingAgeHours` | derived from `EntitlementTransition` + `RunoffSnapshot` | **live** (T6 closed) |
| W4 | Runoff errors | `reconcilerErrors`, `drainingOpenItems` flat | runoff reconciler | TBD-F1 (T6) |
| W5 | BackfillRun review/failure/lag | `backfill.needsReview/failed/maxLagMin` | `BackfillRun` / `BackfillRunItem` | TBD-F1 (T13) |
| W6 | Unresolved pending-role aging/balance | aged `INPUT_VAT_PENDING` balance, unresolved `VatClaimResolution` | FIN track (Plan §4 FIN.3) | TBD-F1 (FIN-owned) |
| W7 | VAT-resolution/event mismatches | resolution vs `TaxEvent` contribution divergence | FIN track | TBD-F1 (FIN-owned) |
| W8 | Certificate reconciliation / outbox / number gaps | unlinked `LEGACY_UNRESOLVED`, WHT outbox lag, reserved-but-unused numbers | CC5 tables + outbox rows | TBD-F1 (FIN-owned); outbox lag readable today |
| W9 | Payment-reconciling age | age in `PAYMENT_RECONCILING` | CC5 filing states | TBD-F1 (FIN-owned) |
| W10 | Refund/correction external wait | age of open external correction/refund branches | CC5 correction case | TBD-F1 (FIN-owned) |
| W11 | DENIED / would_block / fallback | `counts.denied`, `counts.wouldBlock` + `shadow.observed`, `counts.fallbackServed` | audit `AuditResult=DENIED` exists; would_block is durable in `FeatureLaunchObservationBucket`; fallback does not exist | PARTIAL / TBD-F1 (T11) |
| W12 | In-flight + unknown-outcome age (Spec CC1) | `inFlight.oldestAgeSec`, `unknownOutcome.oldestAgeSec` | `DISPATCHING` token, `UNKNOWN_EXTERNAL_OUTCOME` | PARTIAL — route age live; provider-specific completion remains catalog/domain work (T8, T9) |
| W13 | Outbox poison | `OutboxEvent.status='DEAD'` count and age | rows exist (`prisma-outbox.repository.ts:83,90`); **no handler, reconciler or alert** | TBD-F1 (T14) — R7 depends on it |
| W14 | Claim/lock wait, throughput | p95/p99 claim wait, attempts/min | nothing — no metrics endpoint or `prom-client` in the repo | TBD-F1 (T17); Plan §9 forbids any batch claim until this evidence exists |
| W15 | Normalization completeness (CC7) | `normalizationIncomplete` at day 14, then seven zero days | `CompanyEntitlementNormalization` | TBD-F1 |

**Alert transport (real, reusable):** emit through `emitSecurityEvent(logger, name, 'HIGH'\|'CRITICAL', fields)` — `apps/api/src/common/logger/security-event.ts`. The deployed CloudWatch metric filter keys on `$.riskLevel = "HIGH" || "CRITICAL"`, so a *new* launch-control event name alarms with **no infrastructure change**; the alarm routes to `SECURITY_ALERT_TOPIC_ARN` (`docs/runbooks/p1-production-security-operations.md`). Fields must stay tenant-anonymous (§2.3). Whether launch-control alerts should share the security topic and its rotation is OPEN-10. Every numeric threshold above is undefined by both Spec and Plan — OPEN-6.

---

## 6. Implementation seam register — 18 original seams

| Id | Seam | Needed by | Today |
|---|---|---|---|
| T1 | `FeatureLaunchGate` rows (state, generation, lastSeq) | row type A | **live** — additive control-plane schema + seed |
| T2 | `FeatureLaunchGateTransition` + immutable `controlPlaneSnapshot` | R1–R4, audit | **live** |
| T3 | Control-plane OPEN/CLOSE command with `commandId` + expected-generation CAS | every runbook | **live** — internal launch-gate command |
| T4 | `CompanyEntitlementSet` / `EntitlementCommand` + conflict counter | W1 | **partial** — durable partner command/CAS live; health conflict counter null |
| T5 | `EntitlementTransition` epoch/seq + canonical epoch on the entitlement row | W2, W3 | **live** |
| T6 | `RunoffSnapshot`, DRAINING derivation, completion reconciler, stuck alert | R5, W3, W4 | **CLOSED 2026-08-01** — `runoff-lifecycle.ts` (derivation + completer + sweep), `runoff-internal.controller.ts` (R5 actions), health row type B live. Reconciler-RUN metrics stay reserved (OQ-6); cadence is an ops item (OQ-7) |
| T7 | `ExecutionAttempt` with availability vector + linearized claim | R3, R6, W2 | **live** — stamped attempt + fenced claim |
| T8 | Durable `DISPATCHING` token/lease (owner, expiry, attempt, provider idempotency key, lastCheckedAt) | R3, R7, W12 | **live** — token + fenced lease generation |
| T9 | `UNKNOWN_EXTERNAL_OUTCOME` state + provider-poll / manual-reconciliation queue | R7, W12 | **partial** — durable state and reconciliation surface exist; provider-specific completion remains catalog/domain work |
| T10 | `would_block` shadow counter | R1 precondition, W11 | **shipped** — `FeatureLaunchObservationBucket` (migration `20260804120000`), written by the two shadow sweeps only. Coverage is observation/catalog/temporal/surface; **no tenant coverage is derivable and none is claimed**. No retention prune ships with it |
| T11 | CLOSED-route fallback-served counter | R3 verification, W11 | absent |
| T12 | Terminal suppression reason counters (4 reason codes) | R3, R6, W2 | **partial** — global attempt totals live; exact per-route counter null |
| T13 | `BackfillRun` / `BackfillRunItem` status, lag, review counts | W5 | absent |
| T14 | Outbox `DEAD` reconciler + support-visible item + alert | R7, W13 | rows exist, handler does not |
| T15 | Trustworthy runtime environment identity for `targetEnvironment` validation | R1–R4 | **partial health projection** — `DEPLOY_ENVIRONMENT` validation and `shadowWindow.environment` are live; per-row field null |
| T16 | App reads its own build/release id | row type A, R1 | **partial health projection** — full `GIT_SHA` is read by `resolveDeploymentIdentity()`; per-row serving-build field null |
| T17 | Claim/lock wait p95/p99 + throughput metrics | W14, batch-claim gate | no metrics surface at all |
| T18 | The health-view read surface itself (transport + operator authN) | all | **live** — internal read-only controller with `system.launch_gate.read` |

---

## 7. OPEN/decision register — historical IDs

Each needs an owner decision. None may be resolved inside F1 by inference.

| Id | Open question | Why it is open | Suggested owner |
|---|---|---|---|
| OPEN-1 | What identity/authority backs Release Owner, On-call, Specialist? | Spec §9 requires "a separate internal operational authority, not a company permission or sellable entitlement"; the codebase has only company-scoped RBAC and no platform-admin concept | Platform/security owner + release owner |
| OPEN-2 | **RESOLVED:** running service environment identity | `DEPLOY_ENVIRONMENT=uat|production` plus full `GIT_SHA` is injected into every runtime definition and validated by `resolveDeploymentIdentity()`; `APP_ENV=production` continues to mean production-strength security mode | Release owner (deploy script) |
| OPEN-3 | Does UAT satisfy the "staging" rung, or is a third environment required before any production OPEN? | Spec FR-G5 and Plan §8.4 both require dev/test → staging → production; `deploy.sh:28-32` supports `production\|uat` only | Release owner + product owner |
| OPEN-4 | What is the "normal scoped support path" that lets on-call identify the tenant behind an anonymized stuck row? | Spec §9 permits revealing customer records only through it; no such path exists in the repo. R5 and R7 need it | Security owner + DPO |
| OPEN-5 | Who owns outbox `DEAD` reconciliation, and does close-time terminalization write `DEAD` or a distinct terminal? | No handler/reconciler/alert exists; R7 depends on the answer | F1 implementer + platform on-call |
| OPEN-6 | Numeric thresholds and rolling windows for every count and age (DRAINING, in-flight, unknown-outcome, outbox, queue, claim wait) | Neither Spec nor Plan states a number; Plan §3 F0 requires capacity evidence that this lane did not produce | F0 capacity lane + release owner |
| OPEN-7 | Where is cross-environment promotion evidence recorded ("this build passed staging")? | Gate rows are per-environment by database; nothing spans environments | Release owner |
| OPEN-8 | Where does the health view live (in-product internal route vs ops-only surface) and how are its readers authenticated? | Plan §3 F1 requires the view but names no transport; support must reach it without domain access | Release owner + platform |
| OPEN-9 | What fallback applies to a row still `BLOCKED` in the F0 matrices, and what exact Thai copy does a CLOSED route show? | Spec CC1 requires "temporarily unavailable", explicitly not "not purchased"; the string is unwritten and 17 async surfaces are still BLOCKED (`f0-inventory-async-surface.md` §9) | F0 matrix lane + product/UX owner |
| OPEN-10 | Do launch-control alerts share `SECURITY_ALERT_TOPIC_ARN` (security-owner routed) or need their own channel/rotation? | The only alarm path today is security-scoped; paging the wrong rotation delays R3 | Platform on-call + security owner |
| OPEN-11 | Who may execute Resume/Reissue after a reopen — internal operator or tenant user with the domain permission? | Spec CC1 requires explicit Resume/Reissue but assigns no authority; R4 cannot state an executor | Product owner + security owner |
