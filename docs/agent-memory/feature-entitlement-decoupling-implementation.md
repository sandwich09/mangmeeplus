# Agent Memory: feature-entitlement-decoupling implementation

Status (2026-08-03 scoped UAT U0–U4 technical closure): F2 PLAN/APPLY/VERIFY normalized
all seven UAT companies with zero incomplete/drift/provenance gaps. Application commit
`544bdd25be6ba44feb26eb7008104fffe6f7bece` passed exact CI and exact UAT deployment.
The Reports cycle and Bedrock advisory were completed before that AI-only deploy; direct
needs-data API refusal, Thai browser verification and final exact-SHA `A5-RO`/WHT were
then rechecked after it. The acceptance tenant's Reports and AI entitlements are ON
(final estate: Reports 1/7, AI 6/7); `thai_tax` remains OFF because no eligible live
tenant existed; all three
`cap.wht50bis/*` routes remain CLOSED. Production application/runtime is untouched.
This closes the owner-approved UAT technical proof only—not `enforcementReady`,
`promotionReady` or GA. No customer migration, bulk re-entry or technical choice was
introduced.
Owner: owner (product) / Fable 5 session (orchestration + business-logic verification) / Opus 5 lanes (coding, tests, survey)
Scope: implement `docs/specs/feature-entitlement-decoupling-spec.md` (CONFIRMED v5.1 + Amendment 2026-07-31) per `docs/plans/feature-entitlement-decoupling-plan.md` — F0 → F1 → F2 foundation, then FIN/CRM/INV/WF/RPT workstreams

Decisions:
- Workflow: Opus lanes produce code/tests/surveys; Fable verifies every load-bearing claim against code before accepting; commits are per piece on `develop`.
- F0.A verification result — all five lanes ACCEPTED after code spot-checks (see Verification).
- Review verdict 2026-07-31: treat the landed work as **F1.1-F1.4 foundation**, not proof that every feature can safely open/close independently. Current gate/attempt work remains shadow or unwired except the partner entitlement command and outbox claim/reclaim paths.
- Product invariant: normalization and recovery are zero-form, automatic internal operations. Never require a customer migration wizard, historical re-entry, or technical route/key decisions.
- Environment truth: `develop` is UAT application source; `main` is production application source and may hold audited neutral controllers. A UAT pass is evidence only and never clones/deploys/authorizes production automatically.
- A5/F2 read boundary: `A5-RO`, F2 PLAN and F2 VERIFY run directly as dedicated `watchdog_a5_ro`, without an ECS task role, with exact core-table SELECT-only grants plus role-default and transaction/session read-only. The guard scans every non-system schema for outside relation/sequence/DML/SECURITY-DEFINER authority, cluster ownership and core-table RLS. Their tenant-anonymous artifact is bound to environment, exact serving/source full SHA, `queryCatalogHash` and deterministic `evidenceHash`. Bootstrap requires the exact stable serving SHA plus `deploy-uat.yml` signature/OCI proof before writer-secret injection. Only F2 APPLY uses the writer secret and durable wrapper and re-plans under company lock/hash/version CAS; independent VERIFY and a final A5/WHT post-condition follow.
- PostgreSQL 18 A5 clarification: effective `MAINTAIN` on any non-system relation is forbidden and fail-closed; it is part of the versioned query catalog so stale PLAN artifacts cannot be reused after this guard change. Writer administration and reader assumption are separate invariants: require effective writer `ADMIN OPTION`, then accept zero direct members on RDS or one stock creator row with `ADMIN=true, INHERIT=false, SET=false`; reject every other member.
- Readiness is three independent predicates: `f2PrecheckReady` authorizes only F2 APPLY; `enforcementReady(feature/route)` additionally needs fixed-point/matrix/shadow/`would_block`/runoff/live-UAT/capacity evidence; `promotionReady` additionally needs journeys/rollback/security/accessibility/usability and separately reviewed production read-only preflight. Missing shadow/capacity does not block F2 but blocks enforcement/promotion.

## UAT completion correction — 2026-08-02

Decisions:

- Branch truth is fixed: `develop` → UAT; `main` → production. The workflow file may live on default `main` as a neutral dispatcher, but the executed full SHA must pass the environment-specific ancestry check in both PLAN and APPLY.
- Safe-OFF interpretation remains SCOPED, but release evidence is action-aware. `blockedRows=0` is insufficient. The temporary `IN_SCOPE_FAMILIES` set contains only `reports` after its local retained-artifact cycle passed; its live UAT cycle remains mandatory.
- Reports query/export/view creation are new roots. A retained export is immutable stored bytes, not a hash over a query that will be rerun later. OFF retains only narrow authenticated historical reads; it never retains normal report creation authority.
- Partner detail and command use one normalized predicate and one shared contract: `setVersion`, stable `commandId`, `expectedSetVersion`, `confirmCascade`, actual result and friendly per-feature `canDisable`/reason. Duplicate/empty payloads are invalid at both boundaries.
- Every remote release/F2 APPLY/retirement writer needs one durable per-environment operation lease plus ECS task and exact deployment identity. Cancellation/timeout creates UNKNOWN/reconciliation, not permission for another writer.
- WHT H4 is relabeled “infrastructure seam complete; business journey blocked”. Keep all `cap.wht50bis/*` CLOSED. Historical WHT reconciliation is deploy-owned and idempotent; ambiguity creates one accountant item without fabricating data or asking customers to migrate.

Verification baseline before implementation:

- Contracts 12/12, partner web 42/42, partner API/onboarding/controller 113/113, procurement/WHT/ledger 53/53, real PostgreSQL F2+retirement 46/46, production-image security shell test pass.
- Green tests do not close the missing business journey: current tests bless the WHT OPEN no-op and do not exercise reports retained bytes after OFF.
- Live GitHub read-only: default branch is `main`; F2 PLAN/APPLY are not registered because those files are absent from `main`; latest successful normal UAT was `45c4678`, current HEAD was 64 commits/12 migrations ahead at audit time.
- AWS profile `watchdog-bedrock` is authenticated as `watchdog-bedrock-dev` in `ap-southeast-1`; live ECS/DB preflight is the next read-only operation. User-owned edits in `docs/agent-memory/uat-environment.md` are preserved.

Historical next at the start of UAT correction (now superseded): implement U0–U3,
then run U4. Current next state is the incident checkpoint at the end of this file.
Do not OPEN WHT or promote to production as a shortcut.

Open questions (carried into F0.B matrix as decision/BLOCKED rows — not guessed):
- 39 unmapped permissions ride the default-open fallthrough at `feature-gate.logic.ts:86` (13 UNGATED_PACK, 26 NO_RULE). Spec requires unknown-fails-closed after F1 flip; each needs an owner ruling (notably `company.settings.view`, `admin.*`, `bi.*`, `system.*`, `hr.leave.read`).
- Always-on keys are a default, not an invariant: an explicit `false` row disables `employee_access`/`company_settings` (`entitlement.helper.ts` DEFAULT_ON loop). F1 partner-save must reject.
- Web re-implements the evaluator with different no-rows semantics (`apps/web/src/features/system-partners/system-partners.logic.ts:63-68`: legacy company shows all-on except `expense_auto_post`, API is fail-open all-on).
- `enabledFeatures` in AI intake routing is a dead field — producer `process-line-webhook.use-case.ts` never sets it; `route()` takes no availability input; 0/59 tools in `LINE_TOOL_REGISTRY` have availability filtering.
- WorkflowTask exact reuse impossible; smallest-additive branch applies: `businessIssueKey String?` + `@@unique([companyId, businessIssueKey])` + `acknowledgedAt DateTime?`, CAS via `updateMany` in app layer. `POST /tasks/:id/complete` is the forbidden generic completion mutation (work card must not use it). `delete-expense.use-case.ts:67-76` blocks deletion on ANY task row regardless of status. Real enum has 4th value `CANCELED`. No task↔notification seam exists for the dedupe policy.
- Sellable/SKU flag, declarative dependency table, platform-invariants constant do not exist in contracts yet (F1 additive work); canonical permission catalog lives in `apps/api/src/modules/auth/permission-registry.ts`, not contracts; submenu entitlement rows are never seeded (18 parent rows only, auto-enable-with-parent carries 42 submenus).

Artifacts (F0.A, all with file:line evidence, HEAD `ba91c102`):
- `docs/agent-memory/f0-inventory-contracts-permissions.md` (S1: 18 keys, 60 entitlement keys, 324 permissions/26 prefixes, 51 packs, 8 bypasses, 39 unmapped, 5 BLOCKED)
- `docs/agent-memory/f0-inventory-api-surface.md` (S2: 543 endpoints — READ 214 / ROOT 180 / FINAL 115 / SYSTEM 34; enforcement PERMISSION_STRIP 455 / EXPLICIT_GUARD 5 / NONE 83; twoStep 14; BLOCKED 6)
- `docs/agent-memory/f0-inventory-async-surface.md` (S3: 63 surfaces — 11 workers, 26 scanners, 7 webhooks, 1 outbox consumer with non-atomic claim, 6 system contexts; 60/63 entitlement-blind)
- `docs/agent-memory/f0-inventory-web-ai-surface.md` (S4: 77 pages, 48 nav items, 7 portal, 59 AI tools with zero availability filters, 14 BLOCKED)
- `docs/agent-memory/f0-workflowtask-reuse-survey.md` (S5: per-capability reuse verdict)
- Machine-readable row JSONs in session scratchpad `f0/` (s1-s5) feed F0.B assembly; not committed.
- `docs/specs/feature-entitlement-runoff-matrix.md` + `.json` (F0.B: 743 rows — API 543/ASYNC 63/AI 84/WEB 53 groups; policy split RESOLVED 562/BLOCKED 181; nine ordered mechanical decision rules published in-doc. Fable independently recounted all totals from JSON and sample-checked rows vs §6.3. Known conservative overshoots for family deep passes: duplicate-resolve endpoints classed BLOCK_NEW_ROOT though §6.3 allows them as runoff; webhooks double-listed API+ASYNC planes with consistent policy.)
- `docs/specs/feature-entitlement-launch-matrix.md` + `.json` (F0.B: 22 rows — 16 sellable DEFAULT ORDINARY/OPEN, 3 cap.wht50bis SPECIALIST_LEGAL/CLOSED RESOLVED, 2 namespace rows BLOCKED-catalog, [LATER] offset CLOSED; AC1-31 crosswalk §5. Owner decisions needed at F0 exit: (1) §6.3 has NO family row for product_catalog or expense_auto_post — spec amendment required; (2) correction-tuple `correctionRoute` has two competing enums in tax spec (routeKind 3 values :1497 vs returnCorrectionType 6 values :1418) — pick the tuple key; (3) `transitionKind` canonical enum does not exist anywhere — must be defined before any vat_scope_credit_transfer row can be validated; (4) 181 BLOCKED rows incl. 102 in unowned buckets (unmapped permissions/AI plane/NONE) that block EVERY disable until ruled.)
- `docs/agent-memory/f0-capacity-evidence.md` (F0.E, local Docker PG — relative evidence only, UAT rerun deferred: non-atomic claimBatch double-claims 99.5-100% at N≥2 with 7.3× delivery amplification at N=10; atomic FOR UPDATE SKIP LOCKED = 0 double-claims and 4.9× faster at N=10; claim cost O(backlog) because the (status,availableAt,priority) index cannot serve ORDER BY priority DESC,availableAt ASC — and priority is inert, 0 producers set it (verified); no PROCESSING-reclaim exists so claimer death = invisible stuck row; lock ceiling ~80 acq/s at 10ms hold ⇒ never hold entitlement/gate lock across I/O. F1 prerequisite: replace the non-atomic claim BEFORE any batch design; batch ≤25; drains ≤2 pre-atomic.)
- `docs/agent-memory/f0-entitlement-cohorts-baseline.md` (F0.F: 7 mutually-exclusive cohorts + overlay flags, BLOCK-E SQL evaluator replay with origin labels + UNEXPECTED_ORIGIN assertion, baselines B1-B8, local bare-seed run: 4×C0 fail-open + 1×C3 inheritance-dependent — NOT representative, UAT/prod run deferred pending owner ops. Key edges verified: one junk featureKey row suppresses fail-open (sellable features drop to empty; always-on survives via DEFAULT_ON), E2E harness pins a zero-row C0 company so the whole suite runs fail-open today, expense_auto_post drains bypass the evaluator with direct row queries.)
- `docs/runbooks/feature-launch-control.md` (F0.D: health-view contract with two row types — gate `OPEN|CLOSED` vs lifecycle `ON|DRAINING|OFF` aggregate; runbooks R1-R8; watch list W1-W15; 18 TBD-F1 seams; 11 OPEN items incl. APP_ENV=production on BOTH UAT and prod task defs — verified at infra/prod-ecs-express/deploy.sh:150,861,990 — so environment-CAS needs a truthful env source before F1 control-plane lands).

Verification (Fable spot-checks, all confirmed true):
- `feature-gate.logic.ts:75-88` null fail-open / ungated allow / `return true` fallthrough; `entitlement.helper.ts` DEFAULT_ON `!== false`; web divergence at `system-partners.logic.ts:63-68`.
- `crm-line-webhook.controller.ts` (crm-inbox module): zero entitle/feature hits — FINAL_MUTATION surface with enforcement NONE.
- `prisma-outbox.repository.ts:46-71` claimBatch findMany→updateMany without status guard (double-claim race).
- `prisma-workflow.repository.ts:385-388,415-418` scoped read but unscoped update; `schema.prisma:5701-5729` no `@@unique`; `delete-expense.use-case.ts:67-76` status-blind task check.
- Endpoint count independently reproduced: 543 route decorators.
- `expense-backfill.use-case.ts:89-110` real entitlement guard (ledger AND auto-post + `updatedAt` activation floor).

F1.4 (this lane) — what shipped and what it deliberately did NOT do:
- `prisma-outbox.repository.ts` claim is now ONE `UPDATE … FOR UPDATE SKIP LOCKED … RETURNING` statement, batch capped at 25, inert `priority` dropped from the ORDER BY. This is the only NON-shadow change: it fixes the F0.E-measured double-claim (99.5-100% at N>=2) without changing semantics. Proven against the real local DB in `prisma-outbox.repository.claim.spec.ts`.
- `reclaimStalledProcessing` (5-min lease) + `countDead` run at the head of the drain loop; exhausted rows terminalize at DEAD, DEAD rows are logged each sweep and never resurrected. Closes F0.E §6 F13.
- `ExecutionAttemptService` (feature-launch): `createStampedAttempt` (epochs of every required feature incl. declared dependencies + `(gateKey,routeKey,generation)` entries + `availabilityVectorHash`), `claimAttempt` (QUEUED→CLAIMED under shared advisory locks, uncached read, all four SUPPRESSED_*/SKIPPED_* terminals), DISPATCHING lease acquire/renew/`markDispatchStarted`/`markUnknownExternalOutcome`/`markSucceeded`. **Per-attempt only; no batch API exists and a test pins that.**
- Canonical lock protocol completed on both sides: the claim takes `pg_advisory_xact_lock_shared` on `entitlement:<companyId>` then each `launch_gate:<gateKey>:<routeKey>` in sorted order; `SetPartnerFeaturesUseCase` and `LaunchGateCommandUseCase` take the exclusive side (1 line each, no semantic change — nothing contends in F1).
- SHADOW (logging-only, zero behaviour change): `LaunchShadowProbe` wraps the outbox drain and the CRM campaign delivery sweep, records `{surface, companyId, featureKey, wouldBlock, reason}` per item + one summary per sweep, and both callers proceed regardless. No `ExecutionAttempt` rows are written on either hot path.
- Health view: `attempts` (exact counts by status) plus real per-route `queued`/`inFlight`/`unknownOutcome`; `counts.wouldBlock` stays NULL because the shadow counter is not persisted.

## Owner review 2026-07-31 — required corrections

### P0 before any real behavior change

1. **Safe disable is missing.** `SetPartnerFeaturesUseCase` writes entitlement false and lifecycle `OFF` immediately (`set-partner-features.use-case.ts:224-269`). Implement `ON -> DISABLE_REQUESTED -> DRAINING -> OFF`, with cutoff + immutable `RunoffSnapshot` in the request transaction and a reconciler/handoff before OFF. Until a family's close-preflight has zero BLOCKED rows, reject its OFF request with friendly temporary-unavailability copy and change no entitlement.
2. **Claim-to-dispatch race.** `claimAttempt` validates under shared entitlement/route locks, but `acquireDispatchLease` (`execution-attempt.service.ts:226-254`) mints the external dispatch token without reacquiring those locks or revalidating the availability vector. Token creation must be the fenced boundary: take the same locks, perform a fresh vector check, then mint/reuse the token atomically so CLOSE-before-token prevents dispatch.
3. **Control-plane trust boundary is incomplete.** Gate snapshot validation currently checks caller-supplied environment/build/evidence/approver ids only for shape. Derive environment, immutable build and emergency actor server-side; resolve authenticated approval/evidence records, role, exact route and matrix hash. Bind effective OPEN to the current deployment. Add durable `openPolicy=FORBIDDEN_V5_1` and hard-reject OPEN for `[LATER] cap.thai_tax.vat_credit_in_product_offset`.
4. **Outbox reclaim needs fencing.** Atomic claim fixed double-claim, but stale reclaim plus `markPublished/markFailed` by id alone (`prisma-outbox.repository.ts:100-147`) lets an expired worker overwrite the new claimant. Stamp a claim token/lease generation and complete with CAS on `id + PROCESSING + token`; add heartbeat only for legitimately long handlers.
5. **ExecutionAttempt identity is not tenant-safe.** Global `attemptKey` upsert with `update:{}` (`execution-attempt.service.ts:124-151`) can return another company/source's attempt. Tenant-scope the key or persist and compare an immutable company/source/sequence/vector fingerprint; reject any mismatch and include company in source uniqueness.

### P1 before F2 write or enforcement

1. **Plan F1 hot paths are not complete.** Only outbox drain and CRM campaign have logging-only probes; no hot path creates `ExecutionAttempt`. Scanner/outbox attempt coverage, retained-artifact compensation, UNKNOWN reconciliation, poison-work support item, runoff reconciler, metrics and NULL-work reconciliation remain required.
2. **Legacy partner save has a semantic cliff.** The backend composes final state from stored rows only; a partial direct-API update against a zero/partial-row company can suppress legacy fail-open access. A company with incomplete normalization must be read-only in the partner UI and normalized automatically under the same entitlement lock before a command can apply. Shared web/API contracts must carry `commandId`, `expectedSetVersion`, `confirmCascade` and the actual command result.
3. **Onboarding seeds only the 18 parent `FEATURE_KEYS`.** Seed all canonical `ALL_FEATURE_ENTITLEMENT_KEYS`, set epoch/setVersion/origin consistently, and create `CompanyEntitlementNormalization=COMPLETED` in the onboarding transaction so rollout cannot create new partial-legacy tenants.
4. **Canonical evaluator drift.** Partner validation, web projection and `LaunchShadowProbe` must call one canonical effective-entitlement evaluator covering zero rows, platform invariants, parent/submenu inheritance and dependencies. Unmapped input is `coverage_missing/BLOCKED`, never a shadow allow.
5. **F0 matrix is stale after the amendment.** Spec §6.3 now includes `product_catalog` and `expense_auto_post`, while the runoff MD/JSON still marks their rows as having no family decision. Regenerate MD/JSON/runtime catalog from the amended spec and review the diff; do not redo the whole F0 survey.
6. **Gate idempotency is not linearizable.** Same-command lookup/no-op occurs outside the exact-route transaction/lock. Persist no-op results too, and decide replay/current generation while holding the route lock so concurrent retries return one durable result.
7. **Health is not a release gate yet.** `wouldBlock`, environment/build/fallback are null; queries scan broad historical state and DEAD outbox work has only a log. Health must expose observed denominator, mapped coverage, would-block rate/count, current deployment mismatch, bounded oldest-age values and a support-visible reconciliation item.

## Locked decisions for F1.5/F2

1. **Migration drift — approved fix-forward before F2 migrations/deploy.** Land one idempotent catalog-state forward migration and restore `EVIDENCE_CAPTURE`, `SIGNATURE_REQUEST`, `CLARIFY` in `AiTurnIntent`; remove the escaping `as any`. In dev, re-record the three cosmetic checksums immediately, the two real-difference checksums only after the forward fix, and delete only the diagnosed orphan row. UAT/prod get read-only checksum/CHECK/FK inspection first; never reset, edit applied migrations or blindly mutate metadata.
2. **Enforcement stays OFF.** A family may enforce independently only after its concrete catalog is 100%, BLOCKED close-preflight rows are zero, canonical shadow coverage/evidence passes, NULL work is reconciled, safe disable/runoff works, and the UAT scenario passes. Specialist/legal routes remain CLOSED until their exact evidence passes.
3. **Persist shadow evidence in an internal aggregate.** Add an additive `FeatureLaunchObservationBucket`-style table keyed by observation window, environment, build, surface, gate, route, metric/reason. Store denominator, mapped/coverage count and would-block count/rate; no companyId/PII and no per-request log-service query.
4. **Disposition is catalog-owned, never caller-owned.** Canonical values: customer outbound/LINE/email stale side effects -> `SUPPRESS`; notification/digest/AI suggestion/ephemeral internal work -> `SKIP`; accounting/tax/legal proven pre-cutoff work -> `SAFE_RUNOFF`; human/accountant recovery -> `HANDOFF`; missing/unknown -> `BLOCKED`. Stamp `executionPolicyKey`, policy version and treatment into each attempt so later catalog edits do not reinterpret old work.
5. **NULL epoch/generation reconciliation is automatic and pre-enforcement.** Fixed cutoff -> inventory all pre-gate durable work -> dry-run counts/hash -> terminalize, safe-runoff or durable handoff according to the canonical policy. Never backstamp old work to generation 0/current. Only explicit Resume/Reissue creates a current vector. Require `nullEpochPending=0`; unmapped/BLOCKED work blocks the affected company/family without asking the customer.
6. **F2 is state-only and zero-form.** It must preserve current effective access, create no enable/backfill side effects and fall back to unchanged legacy behavior on failure. It may proceed to code/read-only dry-run after the immediate safety fixes; UAT/prod write waits for drift convergence, onboarding/partner/normalizer fixes, hash/CAS revalidation and `A5-RO` evidence. `A5-CAPACITY-MUTATING` separately gates introducing/increasing a bounded batch and promotion/GA, not the current per-company F2 APPLY. Independent OFF remains locked until safe runoff is complete.
7. **Normalization defaults:** zero-row -> materialize the current effective canonical set with `grantOrigin=LEGACY`; explicit false stays false except platform invariants; `employee_access`/`company_settings=false` heals to true automatically with internal audit; inherited child materializes its effective value; child=true masked by parent OFF becomes false; unknown/orphan rows are audit-snapshotted then excluded atomically. New future keys absent from a normalized company default OFF. Renewal changes only after normal package impact preview + confirmation.
8. **Expense auto-post default is OFF unless proven.** `JournalEntry.sourceType='expense.record'` is not evidence because manual `/posting/generate` creates the same source. Preserve ON only for an explicit enabled row or verified worker-specific provenance (system worker plus exact auto-post request/trace); ambiguity goes to internal review, never the customer.
9. **Truthful deployment identity:** retain `APP_ENV` for runtime/security mode; add authoritative `DEPLOY_ENVIRONMENT=local|uat|production` and immutable full `GIT_SHA`/image digest injected server-side. Caller values are expected-value CAS only and cannot establish authority.
10. **WHT/VAT/accounting boundaries:** keep WHT specialist routes CLOSED until certificate source truth, exact route, external handoff and correction/reconciliation work without requiring the Tax package. VAT source facts may exist with Tax off; TaxEvent requires Tax on; Ledger-off projections wait without re-entry. Standard Thai charts auto-bind only exact verified 1154/1155/1156/2135/2137 roles. Never infer a custom chart mapping by account name. Bank evidence supplements but does not block source accounting/tax truth.

## UX defaults

- Incomplete normalization: read-only effective state with `ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ`; background retry/internal support handles failure.
- Disable preview shows only: what new work stops, count of old work that continues/hands off, and dependent features; one confirmation performs the atomic cascade.
- Say `จะปิดใช้งาน — ข้อมูลเดิมยังอยู่`, not `ข้อมูลจะหาย`; switches have at least a 44x44 px target; technical feature/route keys stay under support details.
- UNKNOWN external outcome: `คำขออาจถูกส่งแล้ว กำลังตรวจสอบผล กรุณาอย่ากดส่งซ้ำ`; never blind retry.
- F2 success produces no customer notification. Failure is internal ops/support only. Emergency close is contextual; notify owner/finance only when work or a deadline is affected. Reopen never auto-runs old work; an authorized tenant user chooses Resume/Reissue.
- 50 ทวิ fallback: `ระบบเตรียมข้อมูลให้แล้ว กรุณาออก 50 ทวิในระบบภายนอก แล้วแนบไฟล์กลับมา ระบบยังไม่ได้ออกหรือยื่นให้`. VAT transition says explicitly that no automatic balance transfer occurred and assigns the accountant.

## Required execution order

1. F1.5 safety: migration drift, outbox fencing, attempt identity, dispatch recheck, gate authority/build binding, `[LATER]` hard prohibition.
2. Regenerate matrices; unify evaluator; fix partner contracts/onboarding/normalizer and disable guard.
3. Implement F2 read-only dry-run with deterministic hash/CAS and automatic NULL-work planning.
4. Run `A5-RO` UAT cohort/drift/catalog/health/shadow/`WorkflowTask` evidence with a read-only role.
5. Run F2 state-only normalization only after the clean fixed-SHA, `A5-RO` and artifact write gates pass; no user form or re-entry.
6. Obtain separate explicit owner approval before `A5-CAPACITY-MUTATING` concurrency/load evidence on an isolated non-customer fixture; it gates a future bounded batch and promotion/GA, not current per-company F2 APPLY.
7. Finish Plan F1 hot-path attempts, reconciliation/support/metrics and safe runoff.
8. Enforce independently per family only when that family's blockers reach zero; keep WHT/tax specialist routes CLOSED until exact specialist evidence passes.

Review verification 2026-07-31: focused API/web/contracts suites (226 tests), their typechecks and Prisma validation passed; these tests do not cover PostgreSQL claim/dispatch races, stale-worker fencing, cross-tenant attempt collisions or the complete runoff lifecycle. Review was read-only; no implementation claims are accepted solely from green mocked tests.

## F1.5.1 item 1 — legacy-company command bypass CLOSED (2026-07-31)

Status: implemented, verified locally, not deployed.
Scope: `set-partner-features.use-case.ts`, `entitlement.helper.ts`, `create-company-onboarding.use-case.ts`, `get-partner-detail.use-case.ts`, `packages/contracts/partner-management.ts`, web partner screen + error map, spec §CC7.

Decisions (owner-ruled):

1. `CompanyEntitlementNormalization` not COMPLETED (including absent) → every partner entitlement command shape is refused as a no-write 409 `company_entitlement_normalization_pending` / `ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ`. The gate runs before the lazy `CompanyEntitlementSet` upsert and before idempotency replay; `setVersion` never moves.
2. After COMPLETED, the before-state comes from the ONE canonical evaluator (`evaluateEntitledFeatureKeys`, extracted from `entitlement.helper.ts` so the resolver and the command cannot drift), read inside the write transaction after `exclusiveEntitlementLock`. It drives the ON→OFF refusal, the epoch bump and the audited `fromEnabled`. Row writes still key off the STORED value so a materialization lands and a submenu the operator turned off cannot pop back on when its parent is re-enabled.
3. Onboarding seeds all 60 canonical keys (submenu inherits its parent's package decision) + the CAS root + COMPLETED normalization (`grantOrigin` null, `runId` = onboarding requestId) in the company transaction.

Verification: `pnpm --filter api test` exit 0 (full list, 0 fail) · `test:boot` exit 0 (Nest resolved every provider) · api typecheck clean except pre-existing `feature-launch/application/execution-attempt.service.spec.ts` errors owned by another lane · `pnpm --filter web test` 583/583 · web typecheck clean.

Open for the owner:

- RESOLVED (r5-r7 + 2026-08-03 artifact hard-stop): the F2 normalizer exists (`normalize-entitlements.ts` service + CLI + `f2-normalize.yml` PLAN / `f2-normalize-apply.yml` APPLY+VERIFY dispatches). Release-task/generic deploys run dry-run `--allow-exceptions` only; real writes happen solely through the artifact-bound F2 APPLY (per-company planHash map, membership freeze, no retry-with-new-plan, `approvalReady` gate, verify-always, `cohortKind` durable, NORMALIZER_VERSION=1). The full artifact now includes closed cohort evidence and exact orphan rows, binds cohort into each plan hash, reconciles aggregate counts and makes unresolved cohort evidence non-appliable; non-dry unresolved normalization returns before CAS/marker/entitlement writes. GitHub summary contains counts only. Dependency-exception companies resolve via the internal audited resolver (`/v1/system/entitlement-exceptions`), never SQL. Remaining sequencing: deploy the final SHA, collect `A5-RO`, then run F2 PLAN→resolve/re-plan as needed→APPLY→VERIFY on UAT.
- Legacy `explicit false` rows on platform-invariant keys still win inside the evaluator (unchanged); CC7 decision 7 heals them, not this lane.

## r8 — external review loop (codex gpt-5.6-sol@xhigh), 2026-08-02

Owner directive 2026-08-01: reviews now run through codex-cli sol (xhigh) instead of owner rounds; Opus 5 lanes code/test, coordinator verifies, commit+push allowed, ALL deploy work skipped.

Codex r8 verdict on 3e497101: CHANGES_REQUIRED — 3 P0 + 4 P1, all 7 coordinator-confirmed against code before fixing (full report: session scratchpad `codex-r8-verdict.md`; substance restated here):

1. P0 PLAN never persists exception markers while resolver/APPLY require them → PLAN→resolve→APPLY unreachable on estates with zero markers (UAT/prod). FIX: resolver is marker-independent — list/resolve from the live `pendingCompanyWhere` predicate, CAS = live plan hash recomputed under the company lock; marker reset (STARTED) only if one exists, cohortKind preserved; PLAN stays read-only.
2. P0 cohort misderivation both directions (`isLegacyCohort = !alreadyCompleted`; null-cohort stamp-inference defaulting EXPLICIT). FIX: cohort from durable evidence only (normalize AuditLog → LEGACY, CompanyOnboardingRun → EXPLICIT, else null/INCOMPLETE pending human heal — never guessed); FAILED markers carry cohortKind; first-ever = no marker at all.
3. P0 retire-mode incoming-in-active check existed only in the shell caller. FIX: enforced in `retireLaunchBuilds` survey phase against server deployment identity; reconcile exempt.
4. P1 partner gate accepted stale normalization. FIX: requires COMPLETED + `normalizerVersion >= NORMALIZER_VERSION` + valid cohortKind; 409 payload names the failing field.
5. P1 grantOrigin survived explicit no-op confirms. FIX: every submitted already-ON key with an origin is cleared via raw SQL (updatedAt byte-preserved — auto-post cutoff) + `EntitlementTransition` (ENABLE, reasonJson.noopConfirm, real actor) as durable decision evidence; audit metadata gains `confirmedLegacyKeys`.
6. P1 cohortKind free-text. FIX: migration `20260803160000_cohort_kind_check` (idempotent CHECK), verify reports INVALID(value) by name, closed-set helpers exported.
7. P1 legacy replay left no durable command result. FIX: backfill under the route lock using the ORIGINAL env/build from the transition snapshot (coordinator amend: replay-time snapshot would misattribute the build).

Coordinator adjudication D1 (recorded ruling): cohort-driven stamping accepted, but human decisions are PERMANENT — `humanDecidedKeys` (EntitlementTransition actor != 'SYSTEM') excluded from `provenanceKeys` IN THE PLAN HASH and from the write-path stamp; verify exemption = same set, window-free (the old `updatedAt`/completedAt window reset on every repair, silently erasing operator decisions). Consequence for the release runbook: a human decision landing between PLAN and APPLY moves that company's hash → APPLY refuses it for that run (expected, correct drift).

Codex recommendations: Q1 transition-based exemption ADOPTED (above); Q2 dedicated `system.entitlement_exception.manage` ADOPTED (granted to the same SYSTEM_ADMIN role — who, not what, changes); Q3 S3 approved-plan projection DEFERRED (deploy-scoped, owner skipped deploys; 32KiB fail-closed guard is safe today); Q4 FAILED-exception support notification DEFERRED (collides with PLAN-read-only ruling; workflow summary + resolver GET already surface exceptions; codex to re-adjudicate in r9).

Known residual (for r9): resolver hash intentionally computed with `isLegacyCohort=false` (cohort-independent CAS, never cross-compared with artifact planHashes); a COMPLETED-at-current-version company that drifts into exception is not listed by the resolver (no writer can produce that state today — latent); replay identity already binds env/build via payloadFingerprint, so the B4 amend is defensive provenance.

Evidence: full api suite exit 0 (stable tree, root-.env DB); lane-level — typecheck 0 ×2 lanes, normalize+exception specs 39/39, partner/launch specs 63+40+12, cross-lane partner sweep 116/116, real-DB race/seed specs exit 0; migration applied + constraint verified on local DB (23514 on junk value), pre-checked data (only LEGACY×5).

## r9 — second codex round (on 0f2d0d18), 2026-08-02

Verdict CHANGES_REQUIRED but sharply narrowed: all 7 r8 findings CLOSED; residuals R1 (resolver cohort-independent hash) / R2 (drifted-COMPLETED latent) / R3 (B4 backfill defensive vs fingerprint) ACCEPTED; Q3/Q4 deferrals ACCEPTED ("no correctness requirement presently justifies a new writer or dedup store" for Q4); rulings 8/9 back to MATCHES. Two new P1s, both coordinator-confirmed:

1. P1 heal dead-end: an evidence-less company completes at current version with cohort null; the then-documented heal (`UPDATE cohortKind` alone) left a COMPLETED-current marker that neither the normalizer early-returns nor `pendingCompanyWhere` selects — verify demanded stamps no pass could apply. FIX: ONE `isNormalized` predicate (COMPLETED + current version + valid cohort) used by BOTH early-return gates (entry + under-lock — the second gate was initially missed and caught by the partner lane cross-checking mid-flight) and mirrored by `pendingCompanyWhere` (two OR clauses; NOT IN never matches NULL). A null-cohort company stays pending and is re-planned idempotently (updatedAt byte-identical across passes — asserted); later-derivable evidence auto-heals with zero operator action. Documented heal = one statement setting cohort AND reopening (`status=STARTED, completedAt=NULL`) — coordinator's original "no reopen needed" instruction was WRONG (recording the cohort is exactly what removes the company from the pending set) and the lane's pushback was accepted with test evidence.
2. P1 permanence hole for null-origin confirms: r8's rule recorded a decision transition only when clearing a non-null origin, so an operator confirming an unstamped provenance-gap ON row on a LEGACY company left no durable evidence — a later repair would re-stamp a human-decided row and the decision never moved the plan hash (codex R4). FIX: partitioned confirm logic in `SetPartnerFeaturesUseCase` — origin!=null → clear+transition (unchanged); origin null + LEGACY cohort + not already human-decided (deduped via the SAME exported `humanDecidedKeys` reader, loaded in-txn only when needed) → fence-bumping raw SQL (`lastSeq` only, updatedAt untouched) + transition with `reasonJson {noopConfirm:true}` (no `clearedGrantOrigin` — nothing was cleared); origin null + EXPLICIT → true no-op. Second identical confirm writes nothing.

Evidence: normalize spec 34/34; partner spec 67/67; marker-touching neighbor sweep 127/127; typecheck 0 ×2; full api suite exit 0 pre-commit. Ruling-5 deviation and R4 both resolve via fix 2.

## r10 — codex APPROVE (on 6d977710), 2026-08-02

Zero findings. Both r9 findings CLOSED with citations; R4 + ruling 5 RESOLVED; all four coordinator-flagged adversarial items adjudicated SAFE (under-lock loser now CAS-conflicts instead of silently skipping a still-pending company; null-cohort companies reach every pending consumer with coherent APPLY accounting and are omitted from the resolver listing when nothing is unmet; confirm/changed key families share one locked fence snapshot and one set CAS; `legacyCohort` staleness is time-only because no writer ever changes a valid recorded cohort). Spec/task-memory alignment verified by the reviewer. The r8→r10 external loop on the F0/F1.5.x state is complete: develop @ 6d977710 is externally reviewed and approved, still NOT deployed anywhere (owner has deferred all deploy work).

## H4 — WHT durable prefilled handoff (codex-loop piece 2), 2026-08-02

COMPLETE — externally APPROVED at codex r14 (zero findings) after four rounds: r11 (3 P0 + 4 P1 + 1 P2 on `43a30667` → fixed `2bf297ba`), r12 (1 P1 + 3 P2 → fixed `71f52a82`), r13 (1 P2: ISO hour-24 date rollover — the fix exposed that the r12 calendar check was VACUOUS, comparing a probe against its own components; all datetimes persisted time components → fixed `fb47a9fa`, issuedDate strict YYYY-MM-DD stored from validated components via Date.UTC), r14 APPROVE on `97e184a7`. Same r14 also approved the owner-initiated 409-audit piece (`97e184a7`): the HttpClient path serves only 5 auth call sites; the one dead conflict code (password_reuse) died on the VALIDATION branch (also stripped `code` — now forwarded); the LIVE bugs were reverse drift (`instanceof ApiError`/`statusCode` tested against authedApiFetch plain-Error+`status`) killing ForbiddenState on 4 screens — revived; reimbursements text-matching deliberately retained (bare-string ConflictExceptions carry no code — 182 api sites). Implemented per plan-first flow (Opus discovery plan → coordinator rulings OQ-1..OQ-6 → implementation). Full record, rulings, deviations and evidence: `docs/agent-memory/wht-durable-prefilled-handoff.md`. Summary: `WhtCertificateHandoff` table (migration `20260804100000`, idempotent additive SQL), decoupled ungated `pack.wht.certificate.manage` carrying new `wht.certificate.read` + `wht.external_certificate.link` (proven to survive a no-thai_tax entitlement set while `tax.certificate.*` stays stripped), handoff persistence at the CLOSED-route 409 seam (the Thai "บันทึกข้อมูลไว้แล้ว" promise is now true; 409 enriched with handoffId/handoffStatus), settlement wiring — a supplier payment with whtAmount>0 while `cap.wht50bis` is CLOSED records the handoff atomically inside the payment transaction with real source identity, never blocking the payment — plus read/link endpoints under `wht/payment-handoffs` and an AP-screen panel with prefilled statutory facts + link-back form. Prefill is honestly incomplete (income category/rate null when not derivable — never fabricated). The CLOSED-path zero-writes safety test became a named allow-list (stronger, per R1 sign-off). Discovered en route: pre-existing migration drift (`20260728120000_stock_movement_single_reversal` modified after being applied) blocks `prisma migrate dev` for every future lane — the H4 migration was hand-written idempotent + `migrate resolve --applied` on local; the drift itself remains unhealed and needs an owner-approved heal like the F1.5a round.

## would_block persistence — `FeatureLaunchObservationBucket` (codex-loop piece 3), 2026-08-01

Implements locked decision 3. Before this, the two shadow probes only LOGGED, so the evidence an enforcement flip is approved from (runbook R1 step 2) evaporated with the log retention window. Plan-first flow (Opus discovery plan → coordinator rulings OQ-1..OQ-6 all accepted as recommended → implementation).

Shape: hourly aggregate keyed `(hourStartUtc, targetEnvironment, buildReleaseId, surface, gateKey, routeKey, reason, wouldBlock)`, one counter `observedCount`, migration `20260804120000_feature_launch_observation_bucket` (hand-written idempotent additive SQL + `migrate resolve --applied`; `migrate dev` is still blocked by the `20260728120000` drift). NO companyId and no PII — there is no tenant-shaped column to leak, which is what makes runbook §2.3 structural here instead of conventional.

Decisions and their reasons:

1. **One counter, not four.** The ruling's literal wording says store denominator, mapped count and would-block count/rate. Because `reason` and `wouldBlock` are IN the key, all four are exact SUMs over the reason dimension; a stored total is a second bookkeeping that can disagree with its own rows. Coordinator approved the storage-shape deviation (OQ-1). The *view* still exposes all four.
2. **`wouldBlock` is stored although it is derivable from `reason`.** These rows outlive the build that wrote them; a later build that changes the reason→block set must not reinterpret old evidence. Within a build the mapping cannot drift either — `decideReason()` returns the reason and `wouldBlock` is derived from the exported `SHADOW_BLOCKING_REASONS`, never hand-written per branch.
3. **Fold at `flush()`, one upsert per distinct (gate, route, reason) per sweep.** Measured load: outbox drain ≤25 items/30 s at concurrency 2, campaign ≤50/15 s at concurrency 1 ⇒ ~0.3 rows/sec against the F0.E ~80/sec contended-key ceiling. No lock, no per-observation write. Writing inside `LaunchShadowSweep` means both callers got it for one `await` each.
4. **Prisma `upsert`, scalar-only where + non-empty update** = one native `INSERT … ON CONFLICT DO UPDATE`, the `CompanyAiMonthlyUsage` pattern. The table therefore keeps EXACTLY ONE unique index (beyond the cuid pkey, which cannot collide): a second unique would send the concurrent loser to a non-arbiter index and raise unique_violation instead of incrementing.
5. **Persist never throws.** A shadow surface that is entitlement-blind must stay exactly as blind; a failed fold warns (`launch.shadow.would_block.persist_failed`) and shows up afterwards as a hole in `hoursObserved`.
6. **Coverage carries no tenant dimension and never will.** Expressed as observation (`mapped/observed`), catalog (`routesObserved/routesInMatrix`), temporal (`hoursObserved/windowHours`) and surface. Per-tenant reach stays row type B's `companiesOn/Draining/Off`; nothing about it is derivable from these buckets, and the code comment says so.
7. **Read = trailing 24 h, filtered to the running environment, across every build.** Environment because a `uat` observation never authorized production (CC1); all builds because filtering to the running build would zero the evidence after every deploy and block R1 for a full window — `shadowWindow.builds` names what the window actually spans instead. Window length is fixed, not caller-selectable: an operator who picks the window can pick the one that reads 0.
8. **`counts.wouldBlock` is never reported without `shadow.observed`.** "0 blocks out of 5,000" and "0 blocks because nothing ran" must not be the same answer to R1; that is why the field was `null` before, and a bare `0` would have been the same lie. R1 step 2 in the runbook now demands `observed > 0`.
9. **Scope: the two existing shadow sweeps only.** `claimAttempt` is deliberately NOT instrumented — nothing calls it on a hot path yet, its outcomes are already durable `ExecutionAttempt` terminal rows counted under `attempts`, and a bucket write there would put I/O inside the shared advisory-lock critical section (against F0.E recommendation 4). Broader shadow COVERAGE remains the separate outstanding item.
10. **No retention prune.** ~10-100 rows/day realistic (9.6k/day absolute worst case) and this is release-decision evidence that should outlive an ordinary retention window; `@@index([hourStartUtc])` makes a later range delete cheap. Deferred with the ceiling documented in the model, per OQ-4.

Per-row `environment`/`runningBuildReleaseId` stay null — they belong to T15/T16's owner (OQ-6); the environment the counts were filtered to is reported once under `shadowWindow.environment`.

### codex r15 fixes (2 P1, on af212029)

11. **Buffered evidence must survive a mid-sweep failure.** Both callers ended with a trailing `await sweep.flush()`, so any throw between the first `sweep.record` and the flush dropped the whole sweep's counts — no bucket row AND no `persist_failed` warn, after which later healthy sweeps left the health view looking normal (`observed`>0, `wouldBlock`=0, ordinary `hoursObserved`) while a BLOCKING observation had silently vanished. The drain's per-event `try/catch` covers ingestion only; a throw from `sweep.record`, `complete`, or the outbox repository on the platform-level branch escapes it. Fix: the sweep body is wrapped and `await sweep.flush()` runs in a `finally` in BOTH callers. `flush()` swallows and warns, so the `finally` cannot mask the original error; the hour is still stamped inside flush. Proved by mutation: with the pre-fix shape both new tests FAIL (2 tests, 0 pass), with the fix both pass.
12. **The window is bounded on both sides.** The read had only `gte`, so a future-dated bucket (clock-skewed writer, malformed insert) counted immediately, `hoursObserved` could exceed `windowHours`, and R1's "0 in the observation window" could be satisfied by an hour that has not happened yet. Fix: `shadowBucketHour()` is captured once (so the two bounds cannot straddle an hour tick) and the query is `gte: windowStart, lte: currentHour`. Future evidence is not evidence. The health spec's fake now APPLIES the where clause instead of returning every fixture — without that, every "row X is excluded" assertion would have been vacuous.

Verification: full api suite exit 0, zero failures · typecheck exit 0 · probe 11/11 · health 17/17 · both caller specs + controller 52/52 combined · real-DB concurrency probe RAN (not skipped, 0 skipped) 2/2 — 8 concurrent sweeps × 25 observations converged on 1 row with `observedCount` exactly 200 and 0 persist failures, and 25 rounds of first-insert races each produced 1 row at 50 with no unique violation. Zero literal NUL bytes in all 13 touched files (`LC_ALL=C tr -cd '\000'`).


## Piece 3 closure — codex r17 APPROVE, 2026-08-02

Piece 3 closure: r15 found 2 P1 (buffered evidence lost on mid-sweep throw → finally-flush both callers, mutation-proved; 24h window unbounded above → gte+lte from one clock snapshot) fixed in 19bd2065; r16 found 1 P2 test-flake (hourFloor recomputed in assertions) fixed in 052d24f1 including a second unflagged instance of the same class; r17 APPROVE zero findings. Would_block persistence is DONE — the r2 ruling's outstanding item closes. Deploy preflight now carries three new migrations (20260804100000, 20260804110000, 20260804120000) on top of the unhealed 20260728120000 drift.

## Piece 4 — safe OFF / runoff lifecycle, 2026-08-01

Implements CC1 `ON -> DISABLE_REQUESTED -> DRAINING -> OFF` (spec:59-60, 69). Lifts the F1.5b
blanket disable refusal for **`reports` only**; every other family still refuses, now for a
truthful per-family reason. Plan-first flow (Opus discovery plan -> coordinator rulings OQ-1..OQ-7
all accepted as recommended -> implementation). NOT deployed, NOT committed by this lane.

**ZERO MIGRATIONS.** `RunoffSnapshot`, the `DISABLE_REQUESTED` enum value, the unique index and the
FK all landed in F1.1 (`20260801130000_feature_launch_control_plane_additive`) and were never used.
The deploy preflight does not grow a fourth migration on top of the unhealed `20260728120000` drift.

### Decisions and the evidence behind them

1. **DRAINING writes `enabled=false`** (ruling OQ-2). spec:60 says a disable rejects new roots and
   external sends IMMEDIATELY; with the row left enabled that is simply false. **Mutation-proved
   against the real DB**: a queued `ExecutionAttempt` under a "draining but enabled" row is granted
   `CLAIMED` and would dispatch; under `enabled=false` it terminalizes
   `SUPPRESSED_FEATURE_DISABLED`. Option B (a third evaluator state) would have re-forked the one
   canonical evaluator r8/r9 spent four rounds unifying, and a `Set<string>` cannot express "no for
   new roots and sends, yes for approved runoff children" anyway.
   Three consequences fall out free and were verified in code, not assumed: the re-enable epoch bump
   (`wasOn()` is false, so the ordinary enable path bumps), both direct row readers already filter
   `enabled: true` (`chart-template-query.service.ts:260`, `expense-auto-post.use-case.ts:100-113`),
   and `humanDecidedKeys` filters on actor not action so the operator's DISABLE_REQUESTED stays
   permanent while the SYSTEM completion does not.
2. **Completion is a separate command — forced by the schema, not preference.**
   `EntitlementTransition @@unique([companyId, featureKey, commandId])` (schema.prisma:6956) makes
   two transitions for one feature under one command id impossible. Derived id
   `runoff-complete:<featureKey>:<disableSeq>` is therefore the idempotency fence itself.
   No `setVersion` bump, no `EntitlementCommand` row (ruling OQ-5), no epoch move, `lastSeq`-only
   raw SQL so `updatedAt` survives byte-identical.
3. **Post-commit, never throwing** (coordinator non-negotiable). The disable is already durable;
   reporting failure would tell the operator nothing happened while the feature is really off, and
   the web treats any rejection as "nothing was written"
   (`PartnerDetailPage.tsx:501-508`). A failure there IS the missed completion event R5 repairs.
4. **A materialization is not a disable.** Writing a row for an already-effectively-off feature
   appends plain `OFF`, no cutoff, no snapshot. Caught by two PRE-EXISTING tests when the first
   draft gave every `!enabled` write a DISABLE_REQUESTED — the guard is `!enabled && wasOn`,
   mirroring the epoch rule's `enabled && !wasOn`.
5. **Preflight is per family, and scope is separate from coverage** (rulings OQ-1, OQ-4). Coverage
   comes from the approved matrix (`BLOCKED = 0`); release comes from an explicit in-scope list.
   `workflow_automation` and `ai_line_assistant` are fully covered and STILL refused — otherwise
   regenerating the matrix would silently widen what a partner can switch off.
6. **Submenu inherits its parent verdict** (ruling OQ-3). 42 of 60 keys are submenus and the matrix
   has rows for none; inheriting over-refuses (a sibling's BLOCKED row blocks this one), which is
   the safe direction, and inventing a submenu verdict is the inference spec:334 forbids.
7. **Empty snapshots are the truth here, not a shortcut.** Every preflight-clear family provably has
   zero `PRE_CUTOFF_RUNOFF_ONLY` rows (asserted in the catalog spec); the six families that DO have
   them are all BLOCKED. `buildRunoffRoots` throws for those six rather than record `[]`, so a
   future preflight widening cannot silently strand real roots.

### Documentation contradiction — coordinator-resolved, owner may veto

`runoff-matrix.md:10` says the non-feature BLOCKED rows "block every feature's disable"; the same
file's §5 table calls three families "clear". Scoped reading adopted (see the spec amendment for the
full reasoning and the revert path). **Erratum: 103 such rows, not the 100 the approved doc states**
— its parenthetical omits `PLATFORM`x1, `UNGATED`x1, `PLATFORM_CONTROL_PLANE`x1. The approved matrix
files were NOT edited. **SUPERSEDED 2026-08-04 — the owner ruled on the disable question directly
(freeze in place, see `docs/agent-memory/line-ai-expense-prod-readiness-2026-08-04.md` item C and
decoupling-spec §1). `RUNOFF_PREFLIGHT_MODE`, `runoffPreflight`, `IN_SCOPE_FAMILIES` and
`canEnumerateRunoffRoots` NO LONGER EXIST; the veto lever below is not actionable and the erratum
survives only as a survey correction.** Historical text: **Owner-veto revert = set `RUNOFF_PREFLIGHT_MODE = 'GLOBAL_BLOCK'` in
`apps/api/src/modules/feature-launch/domain/runoff-matrix.catalog.ts:132`** — a real switch the
production preflight consults, which charges all 103 non-feature BLOCKED rows to every family and
refuses every disable including `reports`. No call site changes. (The earlier instruction said
"delete `NON_FEATURE_BUCKETS`", which was wrong twice over: that set was test-only at the time, and
it is now referenced by the switch, so deleting it would break compilation.)

### Real-DB bug this piece's own tests found

`AuditLog.actorUserId` is a real FK to `User` (schema.prisma:629), so the completer's first draft
(`actorUserId: 'SYSTEM'`) violated it. Fixed to `actorType: 'SYSTEM'` with a null actor, matching
`normalize-entitlements.ts:722-727`. `EntitlementTransition.actorUserId` has NO FK and correctly
keeps the literal (spec:54) — the two genuinely differ. Invisible to every mocked test.

### Deferred (explicit)

Non-empty snapshot builders for the six `PRE_CUTOFF_RUNOFF_ONLY` families; snapshot CONSUMERS (the
approved child/compensation read-side); retained-artifact post-OFF compensation; disable-preview UX
and the cascade-confirm dialog (`confirmCascade` still unreachable from web — harmless for `reports`,
which has no dependents); `drainingReconcilerLastRunAt` / `reconcilerErrors` (need durable run
storage = a migration, ruling OQ-6); scheduler cadence for the sweep (ruling OQ-7); enforcement
flips; regenerating the matrix after the §6.3 amendment.

### Verification (all local, nothing deployed)

- Real-DB race spec 9/9, 0 skipped, against docker `15432/watchdog_bms`. Both ordered halves of the
  claim/disable dichotomy proved deterministically (`DISABLE-THEN-CLAIM` -> SUPPRESSED with a
  terminal; `CLAIM-THEN-DISABLE` -> the committed claim survives), because the free race is won by
  the claim ~every time (20/20) and leaving suppression to chance would have proved nothing.
  20-round races for claim-vs-disable, two concurrent disables (one winner, ONE snapshot) and three
  concurrent completions (exactly one OFF).
- Full cycle ON -> DRAINING -> OFF -> ON -> DRAINING -> OFF on the real DB with the epoch advancing
  on the resume and two distinct immutable snapshots.
- Unit: runoff lifecycle 21, catalog drift 12, partner 80 (all 10 pre-existing refusal assertions
  RE-POINTED at BLOCKED families, none deleted), health 18.
- Full api suite, `test:boot`, web test + typecheck, zero literal NUL bytes — see the lane report.

### NEW spec files needing registration in `apps/api/package.json` (NOT edited by this lane)

- `src/modules/feature-launch/domain/runoff-matrix.catalog.spec.ts`
- `src/modules/feature-launch/application/runoff-lifecycle.spec.ts`
- `src/modules/feature-launch/application/runoff-lifecycle.race.spec.ts` (real DB; self-skips without one)

### codex r18 fixes (4 P1 + 3 P2)

**F1 — resolver bypass (P1).** The proposed exemption was TESTED AND IS FALSE. A probe with
`procurement.vendor_bills=false, procurement.supplier_payments=true` and
`double_entry_ledger=false, expense_auto_post=true` returns BOTH CHILDREN AS ENTITLED:
`evaluateEntitledFeatureKeys` applies platform invariants, legacy inheritance and parent->submenu
masking but NEVER `FEATURE_DEPENDENCIES`. `DEPENDENCY_MASK` is a normalizer WRITE decision (CC7),
not a runtime read mask. The resolver's own `fromEnabled` is read from that evaluator and comes back
`true` — the codebase already calls this a real disable — and `assertFeatureEnabled` therefore
permits live root mutations on the child right up to the write. (`expandRequiredFeatureKeys` DOES
carry the prerequisite, so stamped attempts would be fenced; that covers only work that went through
`createStampedAttempt`, and nothing on a hot path calls `claimAttempt` yet.)
So: no exemption. But the FIRST fix was also wrong and has been WITHDRAWN at r19 — it let the
resolver park an "unenumerated" drain that could never complete. A `RunoffSnapshot` is IMMUTABLE, so
a future builder could never repair it, and runbook R5 would have inherited a permanent alarm with
no action attached.

**Final design (r19):** `DISABLE_DEPENDENT` on a family whose runoff snapshot builder does not exist
is REFUSED before any write — 422 `repair_disable_pending_enumeration`, Thai copy naming the safe
path. No parked state, no new persistence: the entitlement stays enabled and normalization stays
honestly incomplete, which is the truthful interim. `ENABLE_PREREQUISITE` is untouched and remains
always available — and today it is the ONLY answer, because the resolver's only live targets are
`procurement.supplier_payments` / `procurement.ap_aging` and `procurement` carries
`PRE_CUTOFF_RUNOFF_ONLY` rows. The listing marks `DISABLE_DEPENDENT` `available: false` with Thai
copy so the screen leads with the action that works instead of offering one that will 422. When a
family DOES have a builder, the resolver takes the full lifecycle (DISABLE_REQUESTED + cutoff +
snapshot + post-commit completion) without the COMMERCIAL preflight — repair authority is not
commercial authority.

**F2 — commandId namespace collision (P1).** Fixed at both ends. `assertCallerCommandId` refuses any
caller command id starting `runoff-complete:` (422 `reserved_command_id_prefix`) before any write,
including before idempotency replay; and completion now verifies the SHAPE of what it finds under
the deterministic id (action OFF + actor SYSTEM + `seq === disableSeq + 1`) — anything else raises
`runoff_completion_command_id_squatted` instead of silently answering ALREADY_COMPLETED. Exposed a
pre-existing unfaithful fixture (an ALREADY_COMPLETED test whose OFF row had no `actorUserId`).

**F3 — the veto path was fake (P1).** `NON_FEATURE_BUCKETS` was test-only, so the documented
"delete the set to revert" did nothing. Added `RUNOFF_PREFLIGHT_MODE: 'SCOPED' | 'GLOBAL_BLOCK'` and
`NON_FEATURE_BLOCKED_ROWS = 103`; under `GLOBAL_BLOCK` every family's `blockedRows` gains all 103, so
`reports` is refused with `blockedRows: 103`. Tested in both modes, including that a non-feature
bucket is not double-charged against itself and that the veto carries through submenu inheritance.

**F4 — health used the bounded page (P1).** Added `aggregateDrainingByFeature`, which walks every
DISABLE_REQUESTED candidate untruncated; `listDrainingLifecycles` stays bounded for ops only. Tested
at 201 live drains: the aggregate counts all 201 and finds a true oldest that a newest-first page
would have missed entirely.

**F5 — unbounded ops work (P2).** `clampDrainingLimit` (1..200, junk lands on the ceiling never on
zero) at the controller, and the bound pushed into the DB read (`take`) ordered `createdAt: 'asc'` —
oldest first, so a steady stream of new drains cannot starve a genuinely stuck old one.

**F6 — vacuous race case (P2).** RACE 3 was racing an ALREADY-completed lifecycle (the post-commit
completion won before the race began), so all three callers trivially answered NOT_DRAINING. Rebuilt
with `rewindToDraining()` (delete the OFF, restore the fence to the request seq — the real crash
shape), asserts the fixture is genuinely DRAINING before racing, and asserts exactly ONE `COMPLETED`
plus exactly one OFF at `disableSeq + 1`. Also added a real-DB test that a partner command cannot
squat the completion namespace.

**F7 — stale status line (P2).** Top-of-file status corrected to the reports-only-released reality.

### codex r19 fixes (1 P1 + 2 P2 + design replacement)

**R19-1 (P1) — sweep paging was structurally broken.** The `take` bounded HISTORICAL
DISABLE_REQUESTED rows BEFORE the live-fence check, so 200 completed historical requests ahead of one
live drain produced a page of ZERO live rows and the sweep re-read that same dead page forever; and
a STILL_DRAINING row blocked every row behind it because there was no cursor. Fixed by moving the
LIVE predicate INTO the database — `JOIN "CompanyFeatureEntitlement" e ON ... AND e."lastSeq" =
t."seq"` — which is a cross-table column comparison Prisma's builder cannot express, so raw SQL by
necessity (commented as such). Keyset pagination on `(createdAt, id)` ordered OLDEST FIRST, with
`nextCursorId` threaded through `listDrainingPage` / `sweepDrainingLifecycles` and both controller
endpoints. Proved against Postgres (a fake would only test the fake): 200 historical + 1 live -> the
live one is on page one; a STILL_DRAINING row + a completable row behind it -> both reachable across
pages, and the stuck one is never forced OFF.

**DESIGN REPLACEMENT — the uncompletable repair drain is withdrawn.** See the rewritten F1 paragraph
above. `buildRepairRunoffRoots`, the `rootsEnumerated` field and the Infinity path in
`countOpenRunoffItems` are all gone; `canEnumerateRunoffRoots` replaces them as a pre-write gate.

**R19-2 (P2) — unknown never becomes a count.** `countOpenRunoffItems` now THROWS
(`runoff_snapshot_unreadable`) on a payload with neither a numeric `openCount` nor a `roots` array;
it used to fall through to 0, which is the most dangerous default in the file ("I cannot read this"
silently becoming "nothing left to run off"). The `Infinity -> 1` coercion in the health aggregate is
deleted. Discovered while wiring it: an unreadable snapshot would have taken the WHOLE sweep down,
so `resolveDrains` catches per ROW and marks `readError`; the sweep counts it as an error and skips
completion, while a DIRECT caller still throws loudly.

**R19-3 (P2)** — the task-memory owner-veto instruction now points at
`RUNOFF_PREFLIGHT_MODE = 'GLOBAL_BLOCK'` (`runoff-matrix.catalog.ts:132`) instead of "delete
`NON_FEATURE_BUCKETS`", which would now break compilation.


## Piece 4 closure — codex r22 APPROVE, 2026-08-02

Piece 4 (safe OFF/runoff) closed after five external rounds: r18 (7 findings incl. the resolver bypass and the fake veto switch) -> b409e3de; r19 (pagination + the uncompletable-drain design withdrawn in favour of refuse-not-park) -> efd4d697; r20 (legacy sentinel structural guard + tuple-bound cursor) -> d9ffd479; r21 (strict canonical cursor decoding) -> a7bc1d3f; r22 APPROVE zero findings. Final shape: reports is the first commercially disableable family (DISABLE_REQUESTED with enabled=false + cutoff + seq-keyed snapshot + SYSTEM completion, refuse-not-park for builderless repair disables, RUNOFF_PREFLIGHT_MODE owner-veto switch, DB-side live-drain paging with opaque tuple cursors). The F1.5b blanket refusal is narrowed, not removed: every BLOCKED family still refuses. Zero migrations. Standing coordinator ruling flagged for the owner: the scoped reading of the matrix's non-feature BLOCKED rows (owner may veto via RUNOFF_PREFLIGHT_MODE = GLOBAL_BLOCK).

## Piece 5 — shadow coverage expansion (codex-loop piece 5), 2026-08-01

Closes the "shadow evidence beyond the 2 probes (coverage, not durability)" item in the status line.
Piece 3 made would_block evidence DURABLE; this piece makes it COMPLETE per family, and makes
"complete" auditable instead of a judgement call. Plan-first flow (Opus discovery plan → coordinator
rulings OQ-1..OQ-6 → implementation → codex r23 fix round). NOT deployed.

**ZERO MIGRATIONS.** `FeatureLaunchObservationBucket` landed in piece 3
(`20260804120000_feature_launch_observation_bucket`). The deploy preflight does not grow a fourth
migration on top of the unhealed `20260728120000` drift.

### The baseline was wrong, and that mattered

"2 of 63 instrumented" counted CALL SITES, not discharged rows. `outbox.drain` records the PRODUCING
feature per event (`OUTBOX_EVENT_FEATURE_BY_PREFIX`), so it was already the evidence for 10 outbox
producer rows across 9 gates — not for one surface. Recounting first is what turned a 60-surface
programme into a 3-family one.

### Coordinator rulings

1. **OQ-1 proxy discharge ACCEPTED.** 18 rows (11 WORKER + 1 CRON + 5 SYSTEM_CONTEXT, excluding
   `assertWorkerToken`) have no code seam: `apps/workers` is a pure HTTP dispatcher (verified in
   `workflow-worker.ts`, `common/scan-worker.ts`, `crm-sla-worker.ts`, `notification-jobs.ts`) and
   system-context rows are permission arrays. Instrumenting the API-side scanner IS instrumenting
   the worker. Mapping is durable in the catalog so "full" stays auditable.
2. **OQ-2 producer discharge ACCEPTED.** The 7 FIN families' ASYNC plane
   (`double_entry_ledger`, `expenses`, `sales_documents`, `thai_tax`, `procurement`,
   `reimbursement`, `bank_reconciliation`) closes on `outbox.drain` alone, with zero new code.
   `inventory` closes the same way on a shipped attribution.
3. **OQ-3 shipped attribution stays, never extends.** Four rows carry a gateKey the approved matrix
   still records UNRESOLVED (campaign worker, campaign scan, crm-inbox producer, inventory
   producer) because piece 3 shipped and codex approved them. Every ownership-undecided surface
   added after piece 3 records `null` → `unmapped_feature` → `UNMAPPED_GATE_KEY`, i.e. inside the
   coverage denominator and attributed to no route. `shadow-surface.catalog.spec.ts` fails if a new
   row acquires a gate without an explicit OQ-3 note.
4. **OQ-4 `callWebhook` seam ACCEPTED** (`workflow.webhook.dispatch`) — the one point every
   dispatch path converges on (retry sweep, synchronous rule run, both replay paths).
5. **OQ-5 `expense_auto_post` DEFERRED.** Its drain filters companies by entitlement BEFORE the
   loop, so a probe inside the loop could only ever record `available`. The Group-E warning is
   recorded verbatim at the head of the catalog: *instrumenting after an existing filter produces
   evidence that reads perfect and means nothing.*
6. **OQ-6 ACCEPTED.** Per-surface bar is `observed > 0`; the `hoursObserved > 1` bar stays per
   ROUTE, because a cron-cadence surface can only produce one bucket hour per day. Runbook R1
   step 2 amended.

### Scope and family order

Ruled order: `workflow_automation` → `ai_line_assistant` → (stretch) `dashboard_notifications`.
All three landed. **The owner may still override the family order before deploy** — it is a
commercial priority, not a technical one. These are the two families
`runoff-matrix.catalog.ts:151-167` holds out of `IN_SCOPE_FAMILIES` pending exactly this evidence.

### Coverage arithmetic (all 63 ASYNC rows, derived from the catalog)

`INSTRUMENTED 19 · PRODUCER 10 · PROXY 9 · EXEMPT 4 · PENDING 8 · BLOCKED_OWNERSHIP 13`

ASYNC plane now COMPLETE for 11 of 16 sellable families:

| Family | Rows | Composition | Diffs |
|---|---:|---|---:|
| `workflow_automation` | 7 | 5 instrumented + 2 proxy | 4 |
| `ai_line_assistant` | 8 | 5 instrumented + 3 proxy | 4 |
| `dashboard_notifications` | 11 | 8 instrumented + 3 proxy | 3 |
| 7 FIN families + `inventory` | 1 each | producer, via `outbox.drain` | 0 |

Still INCOMPLETE by design: `crm` (9 rows — 1 instrumented + 1 proxy + 2 producer + **5 PENDING**:
sla worker, sla scan, new-conversation scan, inbox-retry scan, SYSTEM_ACTOR) and
`expense_auto_post` (3 PENDING). 13 rows stay `BLOCKED_OWNERSHIP` pending the matrix §9 owner
rulings (PDPA ×5, booking ×2, CRM-AI ×2, company-OA webhook, AI tool bridge, customer PDPA
endpoints, customer LINE registration).

### New instrumentation — 11 code seams → 16 new surface names → 17 newly INSTRUMENTED rows

The three counts differ on purpose and none of them is "9" (a round-1 wording error, codex r24):
a seam can mint several surface names, and a surface can discharge several matrix rows.

| Code seam | Surface name(s) minted |
|---|---|
| `workflow-scan.use-case.ts` | `workflow.scan` |
| `workflow-retry.use-case.ts` | `workflow.action.retry` |
| `workflow-internal.controller.ts` (events/ingest) | `workflow.events.ingest` |
| `workflow-action-runner.use-case.ts` (`callWebhook`) | `workflow.webhook.dispatch` |
| `drain-draft-requests.use-case.ts` | `ai.draft.drain` |
| `ai-draft-internal.controller.ts` (generate) | `ai.draft.generate` |
| `drain-line-ledger.use-case.ts` | `ai.ledger.drain` |
| `process-line-webhook.use-case.ts` (`recordShadowTurn`, 2 call sites) | `line.webhook.employee` |
| `notification.use-cases.ts` (delivery sweep) | `notifications.delivery.sweep` |
| `notification-sweeps.use-cases.ts` (`runSweep`) | `notifications.sweep.{snapshot,stock_low,daily_owner_summary}` |
| `internal.controller.ts` (`recordShadow` helper) | `notifications.ondemand.{snapshot,stock_low,daily_owner_summary,delivery}` |

**11 seams · 16 new names · 17 newly INSTRUMENTED rows.** With the two piece-3 surfaces
(`outbox.drain`, `crm.campaign.delivery`) the catalog now names **18 distinct emitting surfaces**
across **19 INSTRUMENTED rows** — both re-derived from the catalog, not counted by hand.

### codex r23 fixes (3 P1 + 1 P2)

**F1 — the probe contract was violated and a test enshrined it.** `record()` did not catch
entitlement/gate READ failures and `flush()` could still throw from its own summary logging (piece 3
made only `persist()` safe). Worse, the first draft's caller tests EXPECTED a probe failure to abort
a notification sweep — exactly backwards. Fix: the ENTIRE probe surface is now no-throw. A failed
READ buffers nothing and warns with a new distinct `launch.shadow.would_block.read_failed` event
(a failed read is not evidence; a bucket row claiming otherwise would let R1 read an outage as a
clean window), returning the never-persisted `read_failed` reason; a failed LOG keeps the
observation, because the measurement is real and only its narration was lost; all logger calls go
through `logSafely`/`warnSafely`. Caller tests INVERTED: with the real probe and dead launch tables,
deliveries/drains/sweeps complete normally, warns are logged, no bucket row is written. The
structural finally-flush fixtures were kept and relabelled — their doubles stand for ANY future
escape, explicitly NOT for `LaunchShadowProbe`, which can no longer throw.

**F2 — tenant identity leaked into structured logs (two rounds).** Every probe path logged `companyId` beside
surface/featureKey/decision, so the central log index would have carried a per-tenant shadow trail
on 11 surfaces even though the buckets are tenant-free. `companyId` is removed from ALL shadow log
lines; `launch-shadow.probe.spec.ts` now asserts its ABSENCE over the serialized payloads, so a
regression that reintroduces it fails.

**r24 residual — the warn path was still leaking.** `warnSafely` copied the RAW exception message
into the shadow warning, and the message of a failed entitlement read is written by whatever threw
it: a driver or repository is entirely free to embed the tenant it was querying. That is the one
path that actually fires during an incident, and no absence assertion over a SUCCESSFUL sweep could
ever have caught it, because a successful sweep emits no warns at all. Fix: warnings now carry a
STABLE tenant-free category only — `errorCategory` (the error's class) plus `errorCode` when the
error has a short driver code (`P1001`, `ECONNREFUSED`), gated by `/^[A-Za-z0-9_]{1,32}$/` so a
library that stuffs free text into `.code` cannot smuggle a value through. Never `err.message`,
never the error object, on every warn path. Log failures stay SILENT rather than warned — the
logger is the thing that failed, so there is nowhere to report it. Ops keeps event + surface (a
code constant, never tenant-bearing) + feature/route + category, which is enough to tell
`PrismaClientInitializationError` from `TypeError` and P1001 from P2002. Five new tests plant
`new Error('entitlement read failed for companyId co-secret-tenant-42')` and assert the warn IS
emitted while the serialized payload contains neither `companyId` nor the tenant value; the two
caller tests were upgraded to throw tenant-bearing messages too.

**OPEN FOR THE OWNER:** if ops genuinely needs per-tenant shadow debugging, it must be an owner
decision with its own retention/PII reasoning — it was NOT added back.

**F3 — `surfacesMissing` was satisfiable by a zero-count row.** The health view derived Missing from
KEY PRESENCE, and `observedCount` defaults to 0, so a zero-count bucket emptied Missing while the
surface had never observed work → R1 false-complete. Fix: `surfacesObserved` = expected surfaces
with `SUM(observedCount) > 0`; `surfacesMissing` = expected − observed (set complement); an
unexpected surface name stays in raw `bySurface` only and cannot reduce Missing, so instrumenting
the wrong name can never satisfy the bar for the right one.

**F4 (P2)** — this section (the first round reported docs updated when only the runbook had landed).

### Verification (all local, nothing deployed)

- api typecheck exit 0 · full api suite (no pipe, captured) exit 0, zero `not ok` · the 5 new spec
  files 35/35 as a focused rerun (they are registered, so the suite already ran them) · probe spec
  23/23 · `test:boot` exit 0 ("Nest resolved every provider").
- NUL sweep: 0 bytes across every touched file, re-checked after every mutation restore.
- **Mutation proofs, base → mutated → restored (pass, fail) — all DECISIVE:**

| Caller | base | mutated | restored |
|---|---|---|---|
| `workflow.scan` | (1,0) | (0,1) | (1,0) |
| `workflow.action.retry` | (1,0) | (0,1) | (1,0) |
| `workflow.events.ingest` | (1,0) | (0,1) | (1,0) |
| `ai.draft.drain` | (1,0) | (0,1) | (1,0) |
| `ai.draft.generate` | (1,0) | (0,1) | (1,0) |
| `notifications.sweep.*` (`runSweep`) | (1,0) | (0,1) | (1,0) |
| `notifications.delivery.sweep` | (1,0) | (0,1) | (1,0) |
| `ai.ledger.drain` | (1,0) | (0,1) | (1,0) |
| `line.webhook.employee` (Group-E ordering) | (1,0) | (0,1) | (1,0) |

- **The first `runSweep` mutation attempt was NON-DECISIVE** (passed under mutation): that sweep's
  re-throw happens in its caller, outside the helper, so the `finally` was never exercised. The test
  was rewritten to exercise what the `finally` actually guards — an escape from inside the loop —
  and re-run decisive. Same treatment for the delivery sweep and the ledger drain. Recorded because
  a green mutation table is worthless if the mutation never reached the code under test.
- No new real-DB spec: the only concurrency invariant is the bucket upsert, already pinned by
  `launch-shadow.probe.concurrency.spec.ts` against the unchanged shared writer. No new caller adds
  a lock, a transaction or an index.

### Deviations

1. **CRM marked PENDING, not INSTRUMENTED.** The discovery plan implied `crm` would complete; the
   ruled family order excluded it. Claiming it in the catalog would have been the exact
   vacuous-evidence failure the catalog exists to prevent. Its 3 surface names are reserved in
   `SHADOW_SURFACES` so the naming decision is not re-litigated. **3 small diffs from complete**
   (`scan-crm-sla-breaches`, `scan-crm-new-conversations`, `retry-crm-inbox-deliveries`;
   `CrmInboxModule` already imports `FeatureLaunchModule`).
2. **The LINE webhook probe is a private method with two callers** — the webhook has two
   company-resolving entry paths (AI query at `:626`, receipt capture at `:1231`); instrumenting
   only the one a ticket names would leave the sibling permanently unmeasured.
3. **`ProcessLineWebhookUseCase` takes the probe as a REQUIRED constructor parameter**, forcing a
   mechanical argument insertion at 6 spec sites. An `@Optional()` probe that failed to wire would
   report zero would_block — indistinguishable from "measured, never blocked". Absent evidence must
   fail at boot, not quietly.
4. **`shadowCoverageComplete` returns `false` for gates with zero async surfaces** (`reports`,
   `product_catalog`, `line_oa`): the question does not apply rather than being answered "yes". Read
   together with an empty `surfacesExpected`.

### New spec files — ALREADY REGISTERED by the coordinator at `e57374b9`

Corrected at codex r24: an earlier draft of this section said these were awaiting registration.
They were registered in `apps/api/package.json` before that commit, so the full-suite runs quoted
below already included them and the separate 35/35 figure is a focused RERUN of tests the suite
covers, not extra coverage.

- `src/modules/feature-launch/domain/shadow-surface.catalog.spec.ts`
- `src/modules/workflow/application/use-cases/workflow-scan.use-case.spec.ts`
- `src/modules/workflow/application/use-cases/workflow-retry.use-case.spec.ts`
- `src/modules/ai-draft/application/use-cases/drain-draft-requests.use-case.spec.ts`
- `src/modules/ai-draft/presentation/http/ai-draft-internal.controller.spec.ts`

### Next

Widen to `crm` (3 diffs) once the owner confirms family order; `expense_auto_post` needs the
unfiltered-candidate probe (OQ-5); the 13 `BLOCKED_OWNERSHIP` rows need the matrix §9 owner rulings
before they can be anything but `unmapped_feature`.


## Piece 5 closure — codex r25 APPROVE, 2026-08-02

Piece 5 (shadow coverage) closed after three external rounds: r23 (probe contract violated by read/log paths + tenant ids in structured logs + zero-count surfacesMissing hole) -> e47bb20e; r24 (raw exception messages could carry tenant values into warns + two doc inaccuracies) -> 698b4a7a; r25 APPROVE zero findings. Final state: ASYNC plane complete for 11 of 16 sellable families (workflow_automation + ai_line_assistant + dashboard_notifications fully instrumented — the two IN_SCOPE_FAMILIES holdouts now have their evidence; 7 FIN families + inventory closed by the outbox producer-attribution ruling); probe is no-throw across its entire surface with failure modes separated (failed read = no evidence + tenant-free warn; failed log = keep evidence); SHADOW_SURFACE_CATALOG makes full-shadow auditable (19 INSTRUMENTED / 10 PRODUCER / 9 PROXY / 4 EXEMPT / 8 PENDING / 13 BLOCKED_OWNERSHIP); health view surfacesExpected/Observed/Missing operationalizes R1. crm stays PENDING (3 diffs, blocked-ownership rulings are its critical path); expense_auto_post deferred with the Group-E trap recorded. Zero migrations. THE INITIATIVE'S NON-DEPLOY CODE PHASE IS COMPLETE: every remaining backlog item is owner-gated (matrix rulings ~166 rows + 13 async ownership, drift heal 20260728120000, family-order confirmation, RUNOFF_PREFLIGHT_MODE veto, UAT sequence, promote).

## Historical UAT completion implementation — 2026-08-02 (superseded pre-live checkpoint)

Historical status (superseded by the incident checkpoint below): local implementation and adversarial review APPROVED (`P0=0`, `P1=0`); no AWS/GitHub mutation or deploy had happened at this checkpoint. `reports` was the only commercial OFF candidate in the runtime allow-list. Every other family still refused OFF; every `cap.wht50bis/*` route remained CLOSED. Production application/runtime was untouched.

Decisions:

- UAT application source is `develop`; production application source is `main`. The protected UAT controller must be dispatched from `main` but executes only an exact full SHA reachable from `develop`.
- Main bootstrap is exactly five regular controller YAML blobs with one audited-parent `M/M/A/A/A` topology. Delete, symlink, rename, merge, replay, extra/missing path and wrong base/ref all fail closed. No application/runtime file and no production-deploy workflow is included.
- Every remote release/F2 APPLY/retirement writer shares one durable environment lease. Per-service mutation uses a durable intent, exact target→service binding, exact ECS deployment/revision, ACTIVE service, bounded/exhaustive reads and fenced SSM repair. CREATE repair is no-overwrite and accepts a concurrent existing parameter only after two exact equal reads. Unknown state blocks the next writer.
- `PRE_INTENT` recovery is the only path when an `all|api-web` release dies after api build acceptance but before an api-web intent. It requires no api intent, all sibling intents resolved, two stable exact ECS+SSM reads proving the incoming SHA absent, exact/idempotent failed-build retirement and a durable cleanup marker. It can only conclude `RECONCILED_FAILED_CONFIRMED`; generic success/retry bypass is forbidden. Its evidence label is `RemoteReleasePreIntentCleanup:<operationId>`.
- F2 PLAN/APPLY/VERIFY re-pin the exact serving api-web full SHA. PLAN/APPLY/recovery verify immutable digest, OCI revision and an environment-specific keyless signer identity. The generic deploy's F2 normalizer is dry-run only; F2 APPLY remains explicit and artifact-bound.
- Report query/view/export roots take the entitlement fence. Retained history uses captured source/scope authority; export download returns exact stored versioned bytes and SHA-256, never recomputes. CSV includes a UTF-8 BOM in the hashed bytes; current object expiry is 7 days and noncurrent cleanup is 1 day. OFF keeps only narrow authenticated history and friendly UX; ON resumes without customer re-entry.
- Partner commands use stable `commandId`, `expectedSetVersion`, cascade confirmation, durable replay and one canonical normalization/readiness predicate. Ambiguous transport retries reuse the same id; customer-facing controls explain temporary preparation versus “not purchased”.
- Live UAT currently lacks `watchdog-bms-uat-release-task-role`. The explicit one-shot IAM bridge may create only that role with exact ECS-task trust and write only the two named deploy/release policies, then exits 75 `APPLIED_BUT_UNVERIFIED`. The next GitHub controller must exact-readback both before any ECR/S3/ECS/SSM/database mutation. The local principal's write authority is not assumed; an AccessDenied is an external admin stop condition.

Artifacts:

- Controllers: `.github/workflows/{ci,deploy-uat,f2-normalize,f2-normalize-apply,recover-release-intent}.yml`.
- Durable writer/recovery: `apps/api/prisma/run-exclusive-release-operation.ts`, `run-exclusive-release-operation.spec.ts`, migration `20260804130000_remote_release_operation_lease`, and `infra/prod-ecs-express/{run-release-task,deploy,active-release-tasks,bind-express-create,bind-express-deployment,verify-serving-api-build,retirement-evidence}.sh`.
- UAT controls: `infra/uat/{neutral-main-bootstrap-files.txt,setup-control-plane.sh,verify-control-plane-policies.sh,github-deploy-role-policy.template.json}`.
- Reports/partner: `apps/api/src/modules/reports/**`, `apps/web/src/features/reports/**`, partner command/detail/controller + web files, contracts `partner-management.ts`/`reports.ts`, report authority migration `20260804140000_report_view_authority_snapshots`, and `infra/object-storage-lifecycle.json`.

Verification:

- Contracts build, API/Web typecheck, Prisma generate/validate: pass.
- Full API suite: exit 0; full Web suite: 611/611; API `test:boot`: Nest resolved every provider.
- RPT/AC26 local combined cycle: 33 pass, one deliberate rollback-guard skip; report/API/Web focused suites green. Partner API/web focused suites green.
- Remote release/recovery real-PostgreSQL suite: 17/17 after pre-intent evidence-label correction.
- Fresh scratch database: all 109 migrations applied from empty, including both new migrations; scratch database then removed.
- `production-image-security.spec.sh`, `release-safety.spec.sh`, shell syntax, workflow YAML parse/duplicate-key audit, actionlint and `git diff --check`: pass.
- Two independent adversarial reviews: neutral main bootstrap APPROVE; deploy/F2 review APPROVE with P0=0/P1=0. The prior P2 pre-intent trace label was corrected and re-tested.
- Read-only live facts: remote `develop=25e5eb416bfff3584ec84d94b0a3a4d7eb61b87c`, `main=26c8c851023764b0ccf0d2649e720acfe168a21f`; GitHub UAT temporarily allows both branches until the controller bootstrap; AWS account is reachable but the dedicated release-task role is absent. User-owned edits in `docs/agent-memory/uat-environment.md` remain excluded from this work.

Historical next (superseded; do not execute this list):

1. Commit/push the frozen implementation on `develop` without staging `docs/agent-memory/uat-environment.md`.
2. Recheck the remote main anchor, then land one direct single-parent main commit containing exactly the five neutral controller files. Require its one-shot CI to pass.
3. Remove the temporary `develop` GitHub UAT environment policy and exact-readback `main` only.
4. Run the bounded IAM bridge; if it exits 75 as designed, dispatch the normal controller only after both policies exact-read. Stop on AccessDenied or drift.
5. Deploy the exact develop SHA to UAT (shadow/fail-safe unchanged), verify lifecycle and full serving SHA, run F2 PLAN → review → APPLY → VERIFY, then run Partner and Reports ON→OFF→retained-byte/new-root-denial→ON plus A5. No production deploy and no WHT OPEN.

## UAT release incident live closure checkpoint — 2026-08-03

Status: exact live recovery is complete. UAT remains on held full SHA
`605a52e29f67d1dea5599387dbd22919799ebfe9`; entitlement enforcement is still
shadow/fail-safe and every WHT specialist route remains CLOSED. The recovery did not
deploy an application service. Production application/runtime is untouched.

Impact on feature decoupling:

- The incident did not change company entitlement data or open a feature route, but
  it proved that a healthy ECS service is insufficient release evidence. A missing
  AI intent would let `all` appear complete without durable authority for one third
  of the build, which would make later gate, retirement and F2 decisions unsafe.
- `all` therefore has an exact API/AI/workers coverage invariant. F2, launch build
  retirement and enforcement promotion refuse incomplete or unknown release state.
- Stable settled ECS state permits `currentDeployment=null` only under the shared
  singleton/unique-newest/exhaustive-history proof. This keeps ordinary feature
  enable/disable user behavior independent of provider pointer cleanup while
  refusing ambiguous operational state.
- Recovery uses a newer reviewed executor without changing the held target build.
  The executor SHA, exact CI run, signed digest/OCI revision and environment fix
  floor are audited. This is operational repair only; it cannot grant entitlement,
  reopen a route, deploy an app service or bypass specialist approval.
- The one bounded ORPHAN path normalizes only the proven historical AI evidence and
  cannot manufacture missing rows for another service or release. Idempotent replay
  revalidates live state and complete coverage. A closed intent must exactly match
  its fresh status/evidence; PRE_INTENT fresh evidence must canonically equal its
  stored cleanup marker. Any mismatch blocks.

Live evidence:

- Compatibility executor `60dfc12b6e676c98f4edfe2a755e52d3abf693f9`
  (expired ECS task ARN/task-id normalization) passed exact-SHA CI run `30772074494`.
  Neutral `main` controller `b91fb84bde33e0e073eb899f93dcefa1c6a6d6eb`
  carries the matching recovery workflow bytes; target stayed `605a52e2…`.
- Run `30772897816`: bounded AI ORPHAN created BOUND intent
  `73bb4f20-1274-4ee0-a22a-edd6ac73b045`; parent correctly remained nonterminal.
- Run `30773062124`: exact API intent
  `483aa70a-5a4c-4263-98a3-27ad6635c160` returned BOUND/replay and ran the
  launch-authority cleanup/cutover path. It observed held build `605a52e2…` active,
  16 routes and zero retired builds, then persisted the cutover completion required
  for eventual terminalization; parent correctly remained nonterminal while workers
  was still open.
- Run `30773209171`: exact workers intent
  `2def7974-c2e1-4c60-b270-a66389af0b8d` returned BOUND and terminalized parent
  `bf131086-6055-4143-a77c-579bc7d58b57`; the workflow reported that a clean release
  retry is now allowed.

Verification: current real-PostgreSQL recovery tests 29/29; API typecheck; release safety;
production image security; shell syntax; workflow YAML parse; exact-SHA CI and all
three live recovery workflows passed. The registered suite treats an explicit
`DATABASE_URL` as strict: connection/schema/setup failures cannot become skips.

A5 boundary: `A5-RO` is read-only cohort/baseline, drift, catalog, health/shadow and
`WorkflowTask` duplicate evidence and is part of the F2 APPLY gate.
`A5-CAPACITY-MUTATING` creates/claims/leases/updates fixture rows and requires separate
explicit owner approval for exact UAT-only scope, bounds, abort criteria and cleanup
proof. Deploy/recovery/F2 PLAN/APPLY/`A5-RO` permission does not authorize it; absent
capacity evidence retains per-attempt behavior and blocks a bounded batch plus
promotion/GA, not the current per-company state-only F2 APPLY.

Next: deploy one new reviewed fixed UAT SHA with `target=all`, verify exact
health/finalization/retirement, complete `A5-RO`, then execute fresh F2
PLAN/review/APPLY/VERIFY and live reports/partner acceptance. Separately obtain owner
approval and complete `A5-CAPACITY-MUTATING` before any bounded batch or promotion/GA.
No customer migration or re-entry is introduced; production deploy and WHT OPEN
remain out of scope.

## UAT candidate deploy and A5/F2 boundary checkpoint — 2026-08-03

Live outcome:

- Workflow `30774515157` targeted `all` from reviewed UAT source SHA
  `ceac8ff45e70b9e34b21b8219590da0f7332f528`. Build/test/publish/release acceptance
  passed. The release dry-run was non-writing and reported 7 pending/7 planned,
  zero failed, zero dependency exceptions and zero unresolved rows.
- API, AI Gateway and workers each reached the exact full SHA, ACTIVE singleton state
  after drain and immutable image digests. The workflow nevertheless failed before
  accepted health/M-01 because ECS first reported deployment `SUCCESSFUL` while the
  previous active configuration was still draining. The old waiter did one stable
  singleton/latest check and returned UNKNOWN rather than polling that transient state.
- Reconciliation safely finalized/reconciled the exact platform and launch authority and terminalized
  parent `ffc17360-3c48-455b-85ce-30886242d921` as `FAILED_CONFIRMED`. This preserved
  fail-safe behavior: no company entitlement changed, no route opened, WHT stayed
  CLOSED and production was untouched. The run must not be cited as UAT acceptance.
- Required retry fix: after provider `SUCCESSFUL`, poll transient drain/moving state
  within a bound. Continue to fail immediately for a target/deployment mismatch,
  pagination, missing/duplicate/not-unique-newest history, terminal rollback or
  `currentDeployment` pointing at another rollout. The next acceptance run must use
  a new full SHA and repeat complete health/finalization/retirement/M-01.

Locked A5/F2 contract:

- `watchdog_a5_ro` receives `SELECT` on exactly `_prisma_migrations`, `Company`,
  `CompanyFeatureEntitlement`, `CompanyEntitlementNormalization`,
  `EntitlementTransition`, `AuditLog`, `CompanyOnboardingRun`, `FeatureLaunchGate`,
  `FeatureLaunchGateTransition`, `FeatureLaunchObservationBucket`, `ExecutionAttempt`,
  `RunoffSnapshot`, and `WorkflowTask`; no DML, database/schema `CREATE`, executable application
  `SECURITY DEFINER`, ownership, membership or inherited privilege. `A5-RO`, F2 PLAN and F2 VERIFY run directly without a task role and
  require both role-default and transaction/session read-only.
- A5 output is tenant-anonymous aggregate evidence only. It carries environment,
  exact serving/source full SHA, versioned `queryCatalogHash`, deterministic
  `evidenceHash`, readiness blockers and advisories; it never emits company ids/names.
  The reviewed F2 artifact remains restricted where row-level review is required.
- Only F2 APPLY uses the writer secret and durable remote-operation wrapper. It accepts
  only the compact approved plan map and still re-plans under each company lock with
  expected-version/hash CAS. Drift is a refusal/fresh-PLAN condition, never permission
  to write an unreviewed plan. Independent VERIFY returns to `watchdog_a5_ro`.
- Historical erratum: `JournalEntry.sourceType='expense.record'` is shared by manual,
  backfill and auto-post paths, so it is not auto-post provenance. Preserve
  `expense_auto_post` ON only for an explicit enabled entitlement or a separately
  reviewed worker-specific provenance source.
- A5/F2 execution is UAT-only until a distinct production read role/secret and
  production read-only preflight are separately provisioned/reviewed. No UAT artifact,
  role or secret is copied forward.

Readiness now means:

1. `f2PrecheckReady`: exact serving/source SHA + true A5 guard/artifact + clean reviewed
   F2 PLAN. Authority: F2 APPLY only.
2. `enforcementReady(feature/route)`: normalized fixed point + complete applicable
   matrix + shadow/`would_block` + safe runoff + live UAT + applicable capacity.
   Authority: exact feature/route enforcement only.
3. `promotionReady`: enforcement evidence + journeys/rollback/security/accessibility/
   usability + separate production read-only preflight. Authority: an explicit
   production promotion decision only, never automatic deployment.

Shadow/capacity advisories do not block the current per-company F2 APPLY, but they do
block enforcement/promotion. Local verification passed: full workspace tests, root/API
typecheck, API DI boot smoke, focused A5 tests, release-safety waiter fixtures,
production-image security scanner, YAML/shell parse and `git diff --check`. Independent
closure reviews found no residual P0/P1/P2 in the waiter; the A5 closure review is part
of the pre-commit acceptance. Next: push a new UAT SHA and complete exact CI; then run the full UAT deploy,
`A5-RO`, fresh PLAN/review/APPLY/VERIFY and live reports/AI/tax evidence. Keep all WHT
routes CLOSED and do not deploy production.

## UAT task-definition contention checkpoint — 2026-08-03

Status: live run `30781342632` deployed source
`a3a9d1db3524305afad23af84005f8b5a3cab007` to all three UAT ECS services, but
is **not accepted UAT evidence**. The deploy wave failed before health/finalization
because the workers `release-bind` task could not register its task-definition
revision. Retirement then correctly exited 75 and M-01 did not run. Production was
untouched, no company entitlement changed and every WHT route remains CLOSED.

Exact evidence:

- Parent operation: `56706288-8f34-4e2f-b2d2-04e982e2ca0f`.
- Workers intent: `ea43e4f8-c9e2-49fa-a727-8cdd4d64e4f7` was durably OPEN before
  the ECS service update.
- ECS updated and settled API/AI/workers, but the workers binder never launched:
  `RegisterTaskDefinition` returned `ClientException: Too many concurrent attempts
  to create a new revision of the specified family` while the three metadata siblings
  shared `watchdog-bms-uat-release-task`.
- The wave propagated workers exit 254 and failed. Retirement task
  `ca29280269bc46e1b344719622247e87` returned 75 with
  `release finalization is blocked by an OPEN remote mutation intent`; it retired
  nothing. This is the intended fail-closed boundary, not a feature/runtime failure.

Decision and implementation:

- Retry only that exact ECS concurrent-revision registration error, at most five
  attempts with 1/2/4/8-second backoff, before `RunTask`. Do not retry a service
  create/update, DB operation, `RunTask`, retirement or any other Client/AccessDenied/
  network error. Exhaustion remains non-zero and the exact intent remains recoverable.
- Spec/plan truth is updated in the Deploy Wave documents and feature-decoupling
  amendments. The dedicated fake-AWS spec covers transient→success, immediate success,
  permanent failure, wrong exception class and bounded exhaustion; the full production
  image security suite executes it.

Verification at this checkpoint: focused retry spec pass; production-image security
suite pass; shell syntax and `git diff --check` pass. Next: commit/push the fix and
obtain exact green CI, recover only workers intent `ea43…` through the neutral exact-
intent workflow using this reviewed executor, prove the parent terminal, then run a
new full-SHA UAT deploy. Do not force-close the row or repeat the remote service update.

## UAT live-hold recovery checkpoint — 2026-08-03

Recovery executor SHA `b9f9cbc489e6a3267a574956a28b361730047f54` passed exact
CI run `30783111895`. Exact recovery run `30783394599` then failed closed with
exit 75 before reading/closing the workers intent because parent
`56706288-8f34-4e2f-b2d2-04e982e2ca0f` still had an unexpired heartbeat lease.
No SSM repair, intent closure, service mutation, retirement, F2 or feature command
occurred.

Live evidence shows this is a controller-hold gap, not an active task or another
intent: SSM still names `watchdog-bms-uat-workers`; the service is ACTIVE and serves
held SHA `a3a9d1db…`; original lease task
`arn:aws:ecs:ap-southeast-1:311414082667:task/watchdog-bms-uat/632667cdc5324994a84dc68c0fab838f`
is exactly `STOPPED/STOPPED` with `EssentialContainerExited` since
`2026-08-03T10:28:45.366+07:00`. The DB hold is intentionally 90 minutes, so merely
rerunning recovery before expiry repeats code 75.

Decision: preserve the 90-minute safety hold for a live controller. Only exact signed
recovery in the same non-cancelling environment concurrency group may reclaim early.
The GitHub controller uses its existing read authority for two stable
`DescribeTasks` observations of the supplied parent task and passes canonical STOPPED
evidence. The DB then locks and requires
`leaseOwner == ecsTaskArn == evidence.taskArn`, exact release/build and still-RUNNING
state before UNKNOWN plus a CRITICAL audit event. A finalizer-owned, running, missing,
moving or mismatched task blocks. Do not expand the fenced task role. Update workflow,
renderer/security and real-PostgreSQL tests; after green CI rerun exact recovery with
the retained parent task ARN, and only after parent terminalization deploy the new
SHA. Production and all WHT routes remain untouched/CLOSED.

## Accepted UAT build and A5 bootstrap checkpoint — 2026-08-03

- Recovery executor `4e47e4bf25d7cb456cc21147e149b59066cffd27` and pinned
  controller `87704a907f29af39f17b6a413bc5b519c389ae09` passed exact CI.
  Recovery run `30785901246` safely terminalized parent
  `56706288-8f34-4e2f-b2d2-04e982e2ca0f` and workers intent
  `ea43e4f8-c9e2-49fa-a727-8cdd4d64e4f7` after the provable maximum lease expiry;
  it did not replay a service update or change a feature.
- Full UAT run `30786165880` then deployed exact SHA `87704a907f…` to singleton
  API, AI Gateway and workers services. Health, durable release finalization,
  old-build launch-authority retirement and all six M-01 cases passed. Production,
  company entitlements and the three CLOSED WHT routes were untouched.
- The first A5 bootstrap attempt verified the exact signed image digest and OCI
  revision, then stopped before any secret/database mutation. On macOS, Docker tried
  to persist the temporary ECR login through the user's keychain; after isolating the
  Docker config, Secrets Manager rejected `CreateSecret --tags` because the operator
  intentionally lacks `TagResource`. A follow-up read proved the A5 secret was not
  created and the database bootstrap task never ran.
- Decision: the stable secret name, account/region ARN and exact description are the
  identity boundary. Tags are inventory metadata and are neither authorization nor
  integrity evidence, so do not expand IAM and do not add best-effort tagging. Reuse
  must validate the exact description before any release task. Use a per-run temporary
  `DOCKER_CONFIG` for login/signature/pull/label checks and delete its credential file
  on every exit. This preserves least privilege and avoids mutating the operator's
  machine credential store.
- Next: exact CI for this bootstrap correction, create/verify `watchdog_a5_ro`, run
  fresh F2 PLAN, independently audit its restricted artifact, APPLY only if every
  blocker/count/hash/orphan/WHT invariant passes, then read-only VERIFY and live
  Reports ON→OFF→retained/new-root-denial→ON, AI and VAT journeys. No capacity-writing
  A5 run, production deploy or WHT OPEN is authorized.

## PostgreSQL 18 A5 role correction — 2026-08-03

- Least-privilege bootstrap commit `27f67382d82e8ad80e11db44ad3b828f1dd59362`
  passed exact push CI run `30788751255`. Its live A5 rerun verified the serving
  `87704a907f…` release-task digest, keyless signature and OCI revision and created
  only `watchdog-bms/uat/a5-readonly-database-url`. The database task then failed
  `permission denied to alter role`; the enclosing transaction rolled back, so no
  `watchdog_a5_ro` role/grant, F2 normalization, entitlement, launch-gate or customer-
  data mutation survived.
- Live RDS metadata proves PostgreSQL 18.3 and non-superuser master `watchdog`.
  PostgreSQL 18 permits that `CREATEROLE` principal to manage the reader it creates,
  but rejects restating `NOSUPERUSER`, `NOREPLICATION` and `NOBYPASSRLS` even when
  those flags are already false. The sustainable rule is fail-closed verification,
  not wider authority: prove all privileged flags false before and after; allow exactly
  the writer's `ADMIN=true, INHERIT=false, SET=false` membership for a non-superuser
  managing an existing reader and no other member able to assume that reader; alter
  only LOGIN/NOINHERIT/connection limit/password/defaults; reject rather than silently
  demote a privileged or unmanaged role.
- Running the production bootstrap function against isolated PostgreSQL exposed a
  second pre-write defect: the A5 authority query used parameter `$1` in both
  `format()` and equality contexts without a determined type, causing `42P08`. Every
  schema reference now uses `$1::text`; this changes query typing only, not the
  authority result or business state.
- Verification: the production bootstrap passes an isolated PostgreSQL 18.3 test for
  first create, idempotent rerun, hardened flags/limit/admin option, unmanaged-role
  rejection, privileged-role rejection and unexpected reader-member rejection. API
  typecheck, A5 evidence logic 6/6,
  executable bootstrap fault-injection spec (including secret create/reuse/failure and
  macOS trailing-slash cleanup), production-image security suite, shell syntax and
  `git diff --check` pass. The existing durable release-recovery suite also passes
  31/31 on PostgreSQL 18.3. The disposable containers/databases were auto-removed
  after the tests. The role-DDL spec refuses a cluster with any other non-template
  database or pre-existing target role. CI now executes the full production bootstrap/
  fresh-reader path against a digest-pinned PostgreSQL 18.3 service.
- Next: commit/push and require exact green CI; deploy that exact SHA to all UAT
  services so API/AI/workers and the signed release-task image agree; rerun the A5
  bootstrap. Only a clean fresh-reader authority guard permits F2 PLAN. Keep all WHT
  routes CLOSED and do not deploy production.

## Live RDS creator-membership compatibility — 2026-08-03

- Commit `84d05f6fad2e40c8e5b3e8aa62cdc7f82446d596` passed exact push CI
  `30791375804`; all-service UAT run `30791796013` then passed validation, health,
  durable finalization, post-health retirement and M-01 on API/AI/workers. Production,
  entitlements, F2 and the three CLOSED WHT routes were untouched.
- The next signed A5 bootstrap task stopped fail-closed with `unexpected member
  authority`. Its transaction rolled back; no reader role/grant or business row
  survived. Task definition `watchdog-bms-uat-release-task:83` had no task role and
  used the exact signed digest for `84d05f6f…`.
- A bounded diagnostic task reused that exact definition/network and exposed no
  secrets or tenant data. In one transaction it created only a distinct probe role,
  read `pg_roles`/`pg_auth_members`, rolled back, then verified the probe absent. Live
  result: PostgreSQL `180003`; writer is non-superuser `CREATEROLE` and an
  `rds_superuser` member; the newly created role had **zero** direct member rows;
  rollback verification was true. This is safer than, but incompatible with, the old
  exact-one stock-PostgreSQL cardinality check.
- Decision: keep the effective writer-`ADMIN OPTION` check. The direct-membership
  guard accepts only zero rows or one exact writer row with `ADMIN=true`,
  `INHERIT=false`, `SET=false`; every extra/foreign/inheriting/SET-capable row still
  stops before grants. This accommodates the managed-provider shape without granting
  authority or weakening the fresh-reader guard.
- Verification after review: API typecheck passed; the production bootstrap passed
  3/3 against a disposable digest-pinned PostgreSQL 18.3 cluster, including first
  create, idempotent rerun, fresh-reader authority and rejection cases; the pure guard
  covers RDS zero-row, stock one-row, duplicate, foreign, inheriting, SET and missing-
  admin shapes. Independent review found no P0/P1 or privilege leak. Its P2 was fixed
  by rechecking effective writer `ADMIN OPTION` after hardening as well as before. The
  disposable container was auto-removed.
- Next: exact CI, deploy the resulting full SHA to every UAT service,
  rerun A5 bootstrap and proceed to F2 PLAN only after the fresh-reader guard passes.
  Production stays untouched and every WHT route stays CLOSED.

## F2 and live UAT journey checkpoint — 2026-08-03

Status:

- A5 bootstrap from exact accepted UAT SHA `e33c31596c2336da38a9be2929c811930abf1188`
  passed on live RDS with the closed zero-member provider shape. Its reader remained
  exact-table SELECT-only, role/session read-only, non-owning/non-inheriting and without
  DML, sequence, CREATE, executable application SECURITY DEFINER or outside grants.
- F2 PLAN run `30798804312` passed independent review. Aggregate plan hash was
  `7c4619f4a0ff3bb64f29cb1242d842673c9b9cda86d8d8b6cb78aa8c0b218b8b`:
  7 LEGACY companies, 315 planned rows, 0 failures/exceptions/orphans/unresolved,
  158 true→true and 157 false→false. The restricted artifact remained mode 600 outside
  the repository.
- F2 APPLY run `30799681227` completed 7/7, failed/skipped/outside-plan 0. Independent
  VERIFY returned incomplete/drifted/provenance gaps 0 and recomputed matching A5
  evidence. Launch catalog remained 20/20; WHT remained 3 total, 0 OPEN, 3 CLOSED.

Live journey evidence:

- Used an existing dedicated UAT verification owner through official password/reset/
  login APIs; no System Admin was attached as a tenant owner and no credential/token is
  stored in the repository or this memory.
- Reports started OFF at entitlement-set version 1. ON created an `expense.summary`
  run, private saved view and READY CSV. The 38 UTF-8 bytes matched both persisted size
  and SHA-256. OFF advanced the set to version 3 and emitted successful exact audit
  `system.entitlement.runoff_complete` / `runoff-complete:reports:2`. The original run,
  run list, view, export list and download all remained 200; OFF bytes and SHA were
  identical. New query/view/export each returned
  `403 feature_not_enabled featureKey=reports`. Browser UI changed the menu to
  “ประวัติรายงานเดิม”, disabled creation, kept the saved view/download and showed the
  approved Thai explanation. The first restore attempt met an expired admin access
  token and returned 401 with no state change; official refresh plus the same CAS-safe
  command restored Reports ON at version 4. A new query returned a distinct run id and
  the UI returned to “รายงานการเงิน” without re-login, migration or data entry.
- AI stayed ON. Provider status was `mode=bedrock, available=true`. One idempotent
  `workflow_review_checklist` request reached terminal `NEEDS_DATA` with a persisted
  suggestion: title/summary present, one `CHECKLIST` artifact
  `LOCKED_FOR_REVIEW modelProvider=bedrock`, one `CREATE_REVIEW_CHECKLIST/PROPOSED`
  candidate and zero reviews. This is the correct no-citation safety downgrade and
  proves a real provider call, not only configuration status.
- UAT browser then exposed a P1: the needs-data row/detail showed raw `MEDIUM`, `NEW`,
  English reason, `CREATE_REVIEW_CHECKLIST`, `PROPOSED` and JSON, while validate/create
  remained offered. Code inspection confirmed direct API creation also ignored
  `needsDataReasonsJson`, and `NO_SOURCE_DRAFT_AVAILABLE` could be recorded as a
  self-owned source draft. Decision: needs-data permits only regeneration/dismissal;
  no-source is display-only. API now refuses both before adapter mutation with stable
  codes; accept/escalate review decisions also fail with zero writes while regeneration
  and dismissal remain available, and the adapter fails closed defensively. Web uses
  exhaustive Thai labels, whitelisted checklist fields and collapsed technical detail.
- VAT eligibility preflight listed 6 ACTIVE UAT companies and 0 with `thai_tax` ON.
  Stop condition applied: do not fabricate an active profile/definition/account/PP30
  mapping and do not enable a family that cannot yet be safely turned back off. The
  deterministic 100/7/107 live preview is therefore an honest conditional gap, not an
  F2 or Reports/AI failure.

Verification:

- Focused API/web safety + presentation specs: 59/59 pass, including the independent
  review findings for direct review-decision writes and the remaining CRM reason.
- API typecheck and web typecheck pass.
- Complete registered API suite passes (pretest plus the repository's registered dot
  suite, exit 0).
- Complete web suite: 623/623 pass (required an unsandboxed local IPC pipe; no network
  mutation).
- `git diff --check` pass. Production untouched; Reports final ON; AI final ON;
  `thai_tax` unchanged OFF; WHT unchanged CLOSED.

Historical next (completed by the closure below):

1. Commit/push only the AI safety/UX + spec/plan/memory files; preserve the unrelated
   user-owned `docs/agent-memory/uat-environment.md` change.
2. Require exact push CI, deploy that exact `develop` SHA to UAT only, then use
   the existing needs-data artifact to prove Thai copy and absence of validate/create.
3. Run final A5-RO/WHT post-condition and record the deploy/run evidence. Do not run F2
   APPLY again, A5-CAPACITY-MUTATING, production deploy or any WHT OPEN.

## Final exact-SHA UAT closure — 2026-08-03

Delivery and deploy evidence:

- AI safety/UX commit `544bdd25be6ba44feb26eb7008104fffe6f7bece` passed exact push
  CI run `30804548851`: focused API/web 59/59, both typechecks, complete registered API
  suite and web 623/623 passed before push.
- Deploy attempt `30805100080` stopped during validation because `pnpm audit` lost its
  package-registry socket (`UND_ERR_SOCKET`). This was a transient transport failure,
  not a vulnerability finding; fail-closed ordering stopped before publish, deploy or
  service/database mutation.
- Full retry `30805641789` deployed the exact SHA to UAT API/AI/workers and passed image
  security, signed release-task acceptance, canary health, post-health retirement,
  durable finalization and all M-01 actor-delegation cases. The signed release-task
  digest was `sha256:3c215638fc45aec26644e30ec065e5c23fbea76e2d5b4c27a0a414fe23495192`.
  Production was not targeted or changed. A post-run read-only ECS check found the latest
  production service deployments still dated 2026-07-28 (API) and 2026-07-20
  (AI/workers), before this UAT work.

Live post-deploy acceptance:

- The existing persisted Bedrock-produced needs-data suggestion was reused; no claim is
  made that a second provider request ran after deploy. Direct validate,
  create-source-draft and `ACCEPT_AS_SOURCE_DRAFT` review calls each returned 422
  `ai_suggestion_needs_data`. A canonical GET projection before and after was identical:
  suggestion `NEW`, candidate `PROPOSED`, zero reviews.
- The UAT browser showed Thai risk/status/needs-data reason and action labels, plus only
  “สร้างใหม่” and “ปิดคำแนะนำ”. It showed neither validate nor create-draft and no raw
  `MEDIUM`, `CREATE_REVIEW_CHECKLIST` or `PROPOSED` in the primary view. Technical JSON
  remains merely collapsed for an authorized page user; it is not server-redacted or
  support-role-gated.
- Reports remained ON after the previously recorded ON→OFF→retained-byte and
  new-root-denial→ON cycle. AI remained ON. `thai_tax` remained OFF; no profile, account mapping
  or tenant state was fabricated to force the conditional VAT journey.

Final read-only authority and estate proof:

- Final A5/F2 PLAN run `30808101502` pinned the exact serving api-web SHA before and
  after evidence collection. No writer role or F2 APPLY was used. The artifact's
  deterministic hash recomputed to
  `a012d18ad051917128489f6b18cad719f842c78427cff2a53e12a57fdca3cbdc`; query-catalog
  hash was `77fc6962b278f13d45b901a31b92f8143600cfc76e95344a51c95a3d99838399`.
- Reader `watchdog_a5_ro` was role/session/transaction read-only, non-privileged,
  non-inheriting and non-owning, with zero role memberships, DML tables, sequence
  privileges, database/schema CREATE, executable application SECURITY DEFINER, outside
  core SELECT or RLS-obscured core tables. Migrations were 109/109 and the launch catalog
  20/20.
- Estate result: 7 companies, 7 current `COMPLETED/LEGACY` normalizations, zero missing
  rows/normalizations, invalid cohorts or pending normalization plans. WHT was 3 total,
  0 OPEN, 3 CLOSED. A second F2 APPLY was deliberately not run because the deployed
  commit changed only AI review safety/presentation and the final PLAN found zero pending
  companies.

Remaining gates (not UAT-closure defects):

- Durable observation persistence is shipped; the live window is still incomplete at
  3/20 launch routes. Launch-health remains a partial projection and cannot authorize an
  enforcement OPEN.
- `A5-CAPACITY-MUTATING` is not approved/run, so no bounded batch increase,
  enforcement or promotion is authorized. Seven consecutive zero-drift days are still
  required before removing legacy compatibility semantics.
- Safe OFF is proven only for Reports. Other commercial families continue to refuse OFF.
  Thai-tax/VAT live calculation stays conditional on a naturally eligible tenant.
- WHT H4 remains infrastructure-only; statutory/business acceptance is pending and all
  three specialist routes remain CLOSED.
- Accessibility, two moderated 5-person usability rounds, production read-only preflight
  and explicit U5 approval remain pending. UAT never clones or promotes to production
  automatically.

The dedicated verifier session was revoked through the official logout endpoint. All
ephemeral credentials/tokens and restricted tenant-bearing artifacts were then deleted
from their four protected temporary directories; none is stored in the repository or
this memory.

## U5 completion authorization and code re-audit — 2026-08-03

Status: IN PROGRESS. The owner authorized completing the remaining readiness work and an
evidence-backed production promotion. This is not authority to fabricate capacity,
statutory or human evidence, and it does not OPEN a route by itself.

Decisions:

- Split production shadow deployment from per-family enforcement/GA. A fully UAT-tested
  build may reach production with no entitlement/route/allow-list flip after its own
  production A5/security/migration/rollback preflight. Every commercial family remains
  independently gated; WHT may stay CLOSED without bundling unrelated features.
- Correct the misleading `3/20` headline. Materialization is 20/20; async applies to 13
  DEFAULT routes (catalog currently complete 11/13), three ordinary routes are
  synchronous-only, three are WHT specialist routes, and one is forbidden/deferred.
  A5 must retain stable tenant-anonymous route names rather than only an aggregate count.
- Reports is the only Safe-OFF family today. The stale matrix predates current HEAD and
  six runoff-root families have no collector/inspector; a stamped nonzero `openCount`
  can never fall, so admitting them would strand DRAINING. Re-survey and build the
  shared final-mutation fence, hot-path attempts, immutable members/live inspectors and
  narrow retained authority before releasing families one at a time.
- Current WHT SYSTEM behavior is incomplete: OPEN initial issuance creates neither the
  existing external handoff nor a SYSTEM certificate, correction/replacement domain
  commands do not exist, and the current English review PDF is not statutory 50 ทวิ.
  Keep all WHT rows CLOSED while the friendly external handoff remains available.
- Production A5 does not exist and UAT A5 is intentionally literal-UAT. Production
  workflow lacks a main-only controller guard and binds `promote_from_run_id` too
  weakly. Merge neutral main into the candidate, test/deploy the exact merge SHA on UAT,
  then advance main to that same SHA only after exact signed UAT acceptance and
  production-specific two-stage read-only preflight.
- The global `ActionableWorkCard` and its claimed E2E/accessibility tests do not exist.
  Implement them before recruiting. Two rounds of five representative humans and WHT
  specialist acceptance remain real external evidence and cannot be synthesized.

Artifacts:

- Spec U5 amendments: `docs/specs/feature-entitlement-decoupling-spec.md`
- Plan U5-A through U5-E: `docs/plans/feature-entitlement-decoupling-plan.md`
- Primary runtime audit: `apps/api/src/modules/feature-launch/domain/{runoff-matrix.catalog.ts,shadow-surface.catalog.ts}`
- Production trust audit: `.github/workflows/deploy-production.yml`,
  `infra/prod-ecs-express/run-release-task.sh`, `infra/uat/bootstrap-a5-readonly.sh`

Open questions / external gates:

- Exact UAT capacity workload in Plan §1.0 U5-C was explicitly approved by the owner on
  2026-08-03 with “อนุมัติ U5-C ตามตัวเลขนี้”. The approval is one-shot for exactly the
  locked 100-row smoke plus 5,000-row run, rates/concurrency/thresholds/timeouts and
  cleanup contract stated there; any changed or repeated workload needs fresh approval.
- Ten real moderated participants must be scheduled after the work-card slice exists.
- Thai accountant/statutory acceptance is required before any WHT SYSTEM OPEN.

Next:

1. Land and verify the corrected evidence/production-authority model (U5-A).
2. Build the shared Safe-OFF foundation, then release/test families in the Plan order.
3. Run the explicitly approved isolated capacity workload and disposable VAT fixture.
4. Complete accessibility/human/WHT evidence as supplied, then execute exact-SHA U5-E.

## U5 signed production evidence contracts — 2026-08-03

Status: LOCAL CONTROLLER/CONTRACT IMPLEMENTATION IN PROGRESS / NOT INTEGRATED OR DEPLOYED.
E0 canonical contracts, H2A/H3/H4/H5 chain validators, U5-C raw-workload binding and focused
adversarial suites pass locally. The exact H2 live-health producer, production E6 consumer,
clean-latest-origin integration, GitHub/AWS bootstrap and live evidence remain P0; production stays
fail-closed and no AWS/GitHub mutation is authorized by this local work.

Owner: owner (U5-E authority) / release engineering (producer and consumer controls)

Scope:

- Signed production A5 artifact family with `PRE_MUTATION`, `POST_MIGRATION` and
  `POST_DEPLOYMENT` stages.
- Signed production security preflight.
- Signed PRE/POST U5 shadow aggregate.
- Independent, attempt-bound repository-owner U5-E approval.
- Canonical content verification, child-evidence verification and exact producer /
  consumer ordering, including the approved U5-C `100/5,000` raw-marker contract. Accessibility
  and moderated-human evidence remain external signed inputs and are not manufactured here.

Decisions:

- GitHub artifact metadata/digest is transport evidence only. The consumer must safely
  download the exact attempt artifact, validate its actual canonical JSON content,
  recompute the self-hash, verify the Cosign bundle/certificate extensions and query the
  exact successful producer run metadata.
- All evidence uses Spec H1's common envelope and an artifact containing exactly
  `evidence.json` plus `evidence.bundle`. Source SHA, producer/controller/workflow blob,
  producer run/attempt, parent production run/attempt, environment and fixed expiry are
  mandatory. A rerun invalidates prior evidence.
- Production A5 uses a new `watchdog_a5_prod_ro`; existing UAT A5 is deliberately
  incompatible. Exact authority fingerprints are computed from stable-sorted full rows
  but only hashes/counts/route keys leave the database. This detects offsetting changes
  without exposing tenant rows.
- H2 health is a set-equality proof, not a liveness spot check. Exact reviewed ARNs for
  `ai-gateway`, `api-web` and `workers` must each have two equal ACTIVE/null/singleton Express
  reads, `minTaskCount>=1`, a complete unpaginated nonempty RUNNING-task set on the active task
  definition, RUNNING private IPs exactly equal to all healthy target IDs, SSM URL exactly equal
  to the active PUBLIC ingress, primary-container port equal to the sole `Main` load-balancer and
  every healthy target port, and a fresh numeric service-specific HTTP 200/status-ok response. Workers
  currently has public ingress too; nullable/no-LB workers evidence is not accepted in v1.
- `origin/main` production is legitimately pre-F1: `CompanyFeatureEntitlement` exists,
  while the reviewed launch-gate/transition/observation/normalization/runoff/attempt
  relations are absent. PRE must fingerprint that exact present/absent profile and must
  not query absent relations, require a `20/20` live catalog, or invent a launch-state
  hash. It binds the exact classified migration-operation manifest, expected schema/data
  transforms, PRE/lock-budget catalogs, 20-row seed, three-CLOSED-WHT hashes and the
  pre-existing entitlement/authority/effective-OPEN-policy baseline.
- PRE records WHT `3 total / 0 OPEN / 3 CLOSED` only as the reviewed expected CLOSED
  materialization with `actual=null`. POST_MIGRATION derives the actual three A5 route
  rows and proves the complete expected in-scope schema delta plus deterministic
  backfill/postcondition set. `UNCHANGED` exists only in POST and means no pre-existing
  entitlement/enforcement authority or effective OPEN policy changed while the exact
  reviewed CLOSED launch state was materialized; it never compares absent PRE launch
  state to present POST state. Every requested transition/admission/allow-list array
  remains empty.
- `humanEvidence.claimed=false` is an explicit signed non-claim and grants no GA or WHT
  authority. Real usability/accessibility/statutory evidence stays pending and cannot be
  replaced by an agent or boolean.
- U5-C now has a strict signed-result producer/consumer contract. The main-only controller
  emits canonical `U5_CAPACITY_RESULT_V1` only after the exact approved 100/5,000 workload,
  alarm/5xx/CPU/connection checks, cleanup and exact worker restoration pass; it embeds the
  exact signed authorization bytes/hash and binds source, release image, workload manifest,
  workflow SHA, run/attempt and owner actors. The workflow revalidates before/after Cosign
  signing and uploads exactly `evidence.json` + `evidence.bundle`; failures retain diagnostics
  but cannot emit a signed PASS. Until the one-shot live UAT attempt exists, H4 remains
  `PENDING/null/NO_BATCH_OR_ENFORCEMENT`; authorization, SSM state and plaintext log still
  cannot substitute for the signed result.
- U5-C evidence hardening after owner approval keeps the workload numerically unchanged but
  makes the result independently provable: authorization bytes are single-root canonical JSON;
  embedded duplicate-free `{path,blob}` rows must reconstruct the approved workload hash; the
  internal database evidence hash is recomputed over canonical bytes; exact smoke/full shape
  tuples, sample counts and all claim/lock p95 values are validated; and the 100-row cleanup is
  emitted/proved before the 5,000-row phase. Focused controller/SQL tests pass, including
  re-hashed high-p95, duplicate-shape and smoke-cleanup forgeries. The approved live attempt is
  still unconsumed: read-only AWS PRE on 2026-08-03 found the durable one-shot SSM record absent,
  exactly three expected UAT target-tracking scale-in-low alarms in `ALARM`, and every other UAT
  alarm observed in `OK`. This is readiness evidence only, not the live capacity result.
- Owner approval is not free-form text. An independent protected-main workflow verifies
  `actor == triggeringActor == repository.owner.login`, the waiting production
  run/attempt and verified PRE aggregate, then signs a 30-minute
  `OWNER_U5E_APPROVAL_V1`. The payload explicitly authorizes the exact H2A clone ref and immutable
  migration-tool plus candidate set, `reviewedMigrationOperationsHash`, `expectedSchemaDeltaHash`,
  `expectedDataTransformHash`, `preflightCatalogHash`, `lockBudgetPolicyHash`, route-seed
  hash and three-CLOSED-WHT hash. It is unusable by another run, rerun or changed hash.
- Live GitHub settings were checked on 2026-08-03. `main` protection is active with
  strict six-context CI, `enforce_admins`, one PR approval, stale-review dismissal,
  last-push approval, and force-push/deletion disabled. This is the mandatory
  independent code-review authority. The production environment remains `main`-only.
  Configuring an Environment required-reviewer rule returned HTTP 422 because the
  repository billing plan does not support it, so the evidence must record
  `UNAVAILABLE_BILLING_PLAN`, reviewer count `0`, and no self-review claim. The signed
  attempt-bound repository-owner H5 artifact is the deploy authority; a native
  environment reviewer becomes additive defense only if a future plan supports it.
- Production shadow may leave only Spec H4's explicit route/capacity/Safe-OFF/VAT/WHT/
  work-card/accessibility/usability gates pending, with their restrictions. Exact UAT
  acceptance, production A5/security, exact classified migration review/rehearsal,
  protected-main review and production main-only policies, zero requested flips, planned
  exact WHT CLOSED materialization before mutation, actual WHT CLOSED proof afterward,
  owner approval and POST unchanged proof are never optional.
- UAT transport is now fail-closed at content level: an all-target main controller requires
  candidate/controller CI and deploy blobs plus acceptance/manifest validator hashes to match
  before publish/AWS, validates the exact seven release files, snapshots the raw manifest hash,
  and only after health/finalization/retirement/M-01 signs canonical 24-hour
  `UAT_DEPLOYMENT_ACCEPTANCE`. It rechecks identical manifest bytes and uploads an exact two-file
  acceptance artifact plus the separately named exact accepted release. A successful run or
  GitHub artifact digest without those downloaded/verified bytes is not production evidence.

Production migration SQL audit (read-only baseline from `afde4270` `origin/main` through the
current candidate, updated 2026-08-03):

- This Git comparison contains 40 migration directories: 16 `ADDITIVE`, 12
  `BACKWARD_COMPATIBLE_NONADDITIVE`, 6 `DATA_BACKFILL`, and 6 `BLOCKING_CONTRACT`.
  Destructive customer-data loss = 0, customer manual input/re-entry = 0, unreviewed = 0.
  The forward-only reimbursement compatibility migration invalidates every earlier 39-row
  manifest/hash. These counts are an audit baseline, not live deployment authority. After the final merge to
  `main`, production PRE must derive its pending set from production `_prisma_migrations` and
  rebuild every path/name/raw-checksum/class/hash before approval.
- `ADDITIVE` (16): `20260712090000_crm_campaign_broadcast`,
  `20260712103000_company_business_policy`, `20260712130000_employee_profile_email`,
  `20260726120000_crm_booking_deposit_amounts`,
  `20260726160000_add_reimbursement_claim_signature`,
  `20260728150000_p1_pdpa_durable_cases`, `20260728180000_p1_ai_lineage`,
  `20260728200000_user_ai_assistant_opt_out`,
  `20260728210000_company_business_category`, `20260729120000_ai_usage_ledger`,
  `20260729183000_attachment_perceptual_hash`,
  `20260802150000_attempt_fence_hardening`, `20260803100000_launch_command_results`,
  `20260803150000_normalizer_cohort`, `20260804100000_wht_certificate_handoff`,
  `20260804120000_feature_launch_observation_bucket`.
- `BACKWARD_COMPATIBLE_NONADDITIVE` (12):
  `20260712120000_company_retention_consent_policy`,
  `20260728120000_m03_crm_ai_outbound_policy`,
  `20260728190000_l01_refresh_token_reuse_detection`,
  `20260728192000_l01_refresh_token_family`,
  `20260728210000_add_expense_source_reimbursement`,
  `20260730120000_company_ai_monthly_budget`,
  `20260801130000_feature_launch_control_plane_additive`,
  `20260801200000_p0_hardening`, `20260803110000_normalizer_version`,
  `20260803160000_cohort_kind_check`, `20260804110000_wht_handoff_link_hardening`,
  `20260804140000_report_view_authority_snapshots`.
- `DATA_BACKFILL` (6): `20260726120000_add_reimbursement_line`,
  `20260731120000_ai_fx_and_platform_budget`, `20260731130000_ai_usage_fx_source`,
  `20260802100000_attempt_identity_lease`,
  `20260804130000_remote_release_operation_lease`,
  `20260804150000_reimbursement_line_compatibility`.
- `BLOCKING_CONTRACT` (6): `20260728120000_stock_movement_single_reversal`,
  `20260728160000_p1_attachment_link_tenant_fk`,
  `20260728170000_p1_branch_tenant_integrity`,
  `20260728191000_l15_tombstone_durability`,
  `20260801120000_chart_of_accounts_master_bootstrap`,
  `20260801150000_drift_forward_fix`.
- Known fail-closed PRE blockers: duplicate stock reversals; invalid cross-company or invalid
  active/posting bank-ledger links; booking buffer/duration values that violate the tightened
  checks; and attempt-key/company-scope collisions before identity/index replacement. FK/index
  replacements can take locks, so clone rehearsal plus bounded maintenance window,
  `lock_timeout` and `statement_timeout` are mandatory. Each deterministic UPDATE needs an exact
  pre-count/rule hash and post-backfill invariant; no customer repair form is an allowed bypass.
- Checksum/order risks: `20260728120000_stock_movement_single_reversal` was reported changed
  after a local apply, so production's recorded checksum and raw candidate bytes must match before
  mutation. `20260804120000_feature_launch_observation_bucket` contains a historical comment that
  recommends `prisma db execute` + `prisma migrate resolve`; that path is forbidden in production
  and does not authorize metadata repair. Five timestamp prefixes are duplicated in the full tree
  (`20260712120000`, `20260712130000`, `20260726120000`, `20260728120000`,
  `20260728210000`); full directory names remain unique and must not be renamed. Production uses
  exact full names/checksums and normal ordered migration application only—never manual
  `_prisma_migrations` edits, `db execute`, or `migrate resolve`.

Open questions:

- No product choice is open for the evidence chain. H2/H2A/H3/H4/H5 fields, TTLs, exact child
  bytes, U5-C raw marker, migration tool and 30-minute failure policy are fail-closed decisions.
- P0 integration/runtime work remains: integrate these files onto clean current
  `origin/develop` without merging this diverged shared checkout; finish the E1 health/
  stage-context producer and E6 production consumer; bootstrap exact AWS/GitHub boundaries; create
  and explicitly approve a new minimum-capacity plan SHA before any apply; then produce real UAT/
  clone/PRE/security/PRE-aggregate/H5/POST evidence in order. No local artifact authorizes mutation.
- P0 live prerequisites remain: production currently needs the reviewed three-service minimum-
  capacity recovery before H2 can pass, and the approved U5-C `100/5,000` one-shot still needs its
  signed live UAT result. A5 POST must remain impossible until both exact prior bytes and a current
  H5 are verified.
- P1/explicitly allowed shadow-only pending gates remain Safe-OFF outside Reports, naturally
  eligible VAT UAT journey, WHT statutory acceptance, actionable work card, accessibility and
  moderated usability 2x5. They prohibit the corresponding enforcement/GA/WHT OPEN; they do not
  permit weakening H2-H5 or inventing human facts.
- Required GitHub state is environments `production` and main-only `production-approval`, protected
  `main`, OIDC `id-token:write`, and repository secret `PRODUCTION_POLICY_READ_TOKEN`. Billing-plan
  lack of a native environment reviewer is recorded honestly; it never replaces H5.
- Required AWS state is exact least-privilege roles
  `watchdog-bms-production-a5-readonly`, `watchdog-bms-production-security-readonly`,
  `watchdog-bms-production-a5-clone`, and
  `watchdog-bms-production-a5-clone-execution`; immutable/scan-on-push ECR repository
  `watchdog-bms-migration-tool`; 7-day clone log group; reviewed clone task/DB security groups; and
  the eight `/watchdog-bms/production/a5-clone/*` SSM parameters. Provisioning must be performed by
  reviewed bootstrap/controller code, not an operator's broad root session.

Artifacts:

- Normative schemas, identity/freshness/replay rules and order:
  `docs/specs/feature-entitlement-decoupling-spec.md` FR-H.
- Implementation slices E0–E7 and controller-first rollout:
  `docs/plans/feature-entitlement-decoupling-plan.md` §1.3.
- Canonical payload/hash contracts and fixtures:
  `infra/security/evidence-contracts.jq`,
  `infra/security/evidence-contracts.fixtures.jq`,
  `infra/security/signed-evidence.sh`.
- Chain consumers/producers:
  `infra/security/validate-u5-production-chain.sh`,
  `infra/security/validate-production-security-preflight.sh`,
  `.github/workflows/production-security-preflight.yml`,
  `.github/workflows/u5-shadow-evidence.yml`,
  `.github/workflows/u5-owner-approval.yml`.
- U5-C raw workload binding:
  `.github/workflows/a5-capacity-uat.yml`,
  `infra/uat/validate-u5-capacity-authorization.sh`,
  `infra/uat/run-a5-capacity-mutating.sh`,
  `infra/uat/validate-u5-capacity-result.sh`.

Verification:

- Local controller evidence tests PASS on 2026-08-03:
  `infra/security/signed-evidence.spec.sh`,
  `infra/security/production-security-preflight.spec.sh`,
  `infra/security/u5-production-chain.spec.sh`, and
  `infra/uat/a5-capacity-controller.spec.sh`.
- H2 adversarial coverage now rejects changed service set, non-null deployment, unequal stable
  Express reads, `minTaskCount=0`, task/target IP drift, SSM/ingress drift and HTTP non-200 even
  after recomputing nested raw hashes and the service-set hash.
- Shell syntax passes for the evidence validators/specs. Relevant workflow YAML parsed locally in
  the preceding controller slice. Rerun the full set after E1/E6 finish and again from the clean
  latest-origin integration checkout.
- No AWS/GitHub mutation, commit, push, merge or production deploy was performed by this slice.
- Read-only SQL classification covers all 40 current candidate files; class totals reconcile to
  40 and each exact directory is listed above. The final exact-main comparison and hashes must be
  regenerated after merge. Live production
  pending/checksum/PRE results remain deliberately unclaimed until the final `main` merge and
  production read-only preflight.
- Remaining end-to-end adversarial proof belongs to E1/E6: real producer payload parsing, first-AWS-
  step ordering, exact mutation-boundary freshness rechecks, expiry while reimbursement is
  quiesced, and ordered PRE → apply → POST_MIGRATION → traffic → POST_DEPLOYMENT/aggregate.

Next:

1. Finish E1 so its exact H2 payload matches E0, including all nine raw health objects and exact
   stage-context authority/clone bindings; run producer logic/workflow tests.
2. Finish E6 run-ID-only production consumption and prove the 30-minute freshness check occurs
   before every mutation; expiry after quiesce leaves writes closed and requires fresh H5.
3. Integrate onto clean current origin, rerun all focused/full static tests, then bootstrap only the
   exact listed GitHub/AWS resources under reviewed authority.
4. Generate a fresh read-only minimum-capacity plan and obtain explicit owner approval of its exact
   SHA before apply. Then create the live U5-C result and ordered H2A → H2 PRE → H3 → H4 PRE → H5 →
   H2 POST_MIGRATION → H2 POST_DEPLOYMENT → H4 POST evidence; do not substitute logs or pasted IDs.

## Reimbursement N/N-1 production compatibility — 2026-08-03

Status: RUNTIME BRIDGE + ATOMIC FINAL WRITER + REQUIRED LOCAL PG GATE IMPLEMENTED / PRODUCTION CLONE WIRING, RELEASE CHOREOGRAPHY AND LIVE EVIDENCE PENDING

Owner: product owner / release engineering

Scope:

- Prevent the old scalar-header reimbursement web/API contract and the final required-`lines[]`
  contract from accepting an unsafe mixed-revision canary.
- Keep reimbursement reads available and make the bounded write pause understandable to a normal
  Thai user without migration, re-entry or version selection.
- Preserve the forward-only line repair/trigger and atomic final writer as database defenses; do
  not misrepresent those as HTTP-contract compatibility.

Decisions:

- Use an old-schema-compatible controller bridge with `REIMBURSEMENT_WRITE_QUIESCE=true`; do not
  add a permanent dual-payload adapter. Auth/permission remains first, then one controller guard
  refuses every non-read method before DTO pipes with HTTP 503, stable code
  `reimbursement_upgrade_in_progress`, `Retry-After: 60` and friendly Thai copy saying typed data
  remains.
- Attach the gate to both request and policy controllers. GET/HEAD/OPTIONS remain available. The
  switch defaults false and is an environment release control, never a tenant entitlement.
- Production order is bridge true → retire/prove all unguarded tasks gone → signed PRE → exact
  migrations/invariants → final exact image true → retire/prove → same final image false → signed
  POST. Any failure after the bridge leaves writes closed.
- Draft edit and submit share a request lock plus `DRAFT + updatedAt` CAS. Duplicate scoring is pure;
  candidate insertion, approval-step creation, canonical number reserve+commit and the submit CAS
  are one Prisma transaction. The number repository exposes caller-transaction helpers, so there is
  no nested transaction or fallback number. A stale loser rolls every side effect and sequence
  increment back; retry receives the exact unconsumed number.
- Cancellation shares the request lock and uses observed status+`updatedAt` CAS, so cancel-versus-
  submit has exactly one winner. Pending approve/reject decisions now also share that request lock:
  each re-reads status/version/self-approval/assignment and commits its step plus request CAS in one
  transaction; approval additionally revalidates the v2/exact-v1 hash and materializes all claim
  expenses/lines/links in that transaction. Finance/payment transitions remain a separate broader
  lifecycle-hardening scope.
- A retry may reuse an idempotent `COMMITTED` document number only when its owner is the same
  reimbursement request; wrong-owner, `CANCELLED` and `VOIDED` records fail closed. Explicit reuse
  suppresses reserve/commit audits. Canonical `YYYY-MM`/`YYYY` period keys, not the wall clock, drive
  `{YYYY}`/`{YY}`/`{MM}` formatting.
- Each submit dismisses prior `OPEN` duplicate candidates inside the request transaction (actor/time
  recorded, original reason preserved) before inserting the current scan. A losing CAS rolls both
  the dismissal and inserts back.
- A retry from the pre-atomic flow also invalidates any orphan `PENDING` approval step as
  `CANCELLED` with reason `superseded_by_atomic_resubmit`, then creates the replacement inside the
  same request transaction. History remains auditable and neither the employee nor accountant must
  repair or re-enter data.
- Submit locks every attachment/linked-expense key in sorted order and repeats the live-claim check
  inside the same transaction. Different requests submitting the same evidence have exactly one
  winner; the loser remains an intact draft. The earlier non-locking lookup is advisory UX only.
- The production clone runs the two explicit reimbursement spec files with the spec reporter in
  required mode through only its in-container `DATABASE_URL`; the artifact binds exactly 2 suites /
  13 tests / 13 pass / 0 skipped. Required mode cannot read a repository `.env` file or silently
  skip.
- The new forward-only reimbursement compatibility migration changes the candidate manifest to
  40 rows (`16/12/6/6`) and invalidates all earlier 39-row hashes/evidence. Applied
  `20260801150000_drift_forward_fix` remains byte-identical with its original 5-second lock timeout.

Artifacts:

- `docs/specs/reimbursement-upgrade-write-quiesce-spec.md`
- `docs/plans/reimbursement-upgrade-write-quiesce-plan.md`
- `apps/api/src/modules/reimbursements/presentation/http/reimbursement-write-quiesce.guard.ts`
- `packages/config/src/index.ts`
- `apps/web/src/common/api/api-error-message.ts`
- `infra/prod-ecs-express/deploy.sh`
- `apps/api/prisma/migrations/20260804150000_reimbursement_line_compatibility/migration.sql`
- `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.ts`
- `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts`
- `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts`
- `apps/api/src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts`
- `apps/api/package.json` (`test:reimbursement-compatibility`)

Verification:

- Config tests: 117/117 PASS (default/true/false/invalid switch shapes included).
- Guard tests: 4/4 PASS (disabled, reads, all mutation methods coded 503/header and both
  controllers attached).
- Shared web error tests: 15/15 PASS, including no re-entry wording.
- Deployment script syntax and focused static render contract PASS.
- `infra/docker/production-image-security.spec.sh` PASS after its U5-C fixture was updated for the
  exact preflight baseline hash and main-only `a5-capacity-uat.yml` controller.
- Atomic writer focused non-PostgreSQL tests: 63/63 PASS across document numbering, request and
  approval use cases, request+line rollback boundaries, explicit number-reuse audit suppression and
  cancellation contract wiring. After adding legacy orphan-step recovery, the final impacted subset
  rerun is 60/60 PASS.
- Required real-PostgreSQL gate: 13/13 PASS, 2 suites, 0 skipped, on the local Docker PostgreSQL 16
  database. It covers zero/one/many-line data,
  byte preservation, repeat migration, legacy/current writers, rollback/corruption invariants,
  edit-versus-submit CAS, stale-loser zero writes plus exact-number retry, and shared-receipt
  one-winner behavior; plus owned-COMMITTED reuse, wrong-owner/cancelled/voided refusal, prior
  candidate dismissal/rollback, orphan approval-step invalidation/replacement, cancel-versus-submit
  exactly-one-winner races, duplicate-approval and approve-versus-reject one-winner decisions,
  atomic approval/rejection rollback+retry, and exact-v1 fallback approval.
- The required gate was repeated twice after making its Company fixture transaction-local; both
  runs PASS. It no longer depends on the race suite temporarily creating a company or on test order,
  and the fixture rolls back with the compatibility probes.
- Fail-closed probe without `DATABASE_URL`: exit 1 with
  `reimbursement_pg_gate_database_url_required`; no skip-success path remains in required mode.
- API typecheck PASS after the final P1 transaction/gate slice. Web focused mapping tests and typecheck PASS
  from the bridge slice.
- API `test:boot` PASS; Nest resolved every provider after exporting/injecting the canonical
  document-number repository.

Next:

1. E6 must run the database-reader bootstrap as `LEGACY_PRE_F1` before PRE and refresh it as
   `F1_CURRENT` after migration and before POST_MIGRATION; profile selection alone does not grant
   the new `ReimbursementLine` relation.
2. Complete live H2A/PRE/clone/POST and exact ECS active-revision/environment quiesce evidence.
3. Land/deploy the protected-main bridge before any production migration.
4. Run the four UAT old/new web/API quiesced pairings and final unquiesced journey.

## E1 private production A5 producer hardening — 2026-08-03

Status: LOCAL PRODUCER/CONTRACT COMPLETE; E6 INTEGRATION AND LIVE AWS RUNS PENDING.

Owner: E1 producer / E6 consumer owner integrates the documented seam.

Scope:

- Replaced the hosted-runner production SQL path with a dedicated private one-shot ECS reader.
  The controller can inspect only the reader secret ARN/AWSCURRENT version metadata; it never calls
  `GetSecretValue`, receives `A5_READONLY_DATABASE_URL`, or queries production PostgreSQL locally.
- Added a dedicated reader execution role, no-task-role task definition, private subnet/SG/DB rule
  validators, version-bound secret injection, bounded digest-framed CloudWatch result reconstruction,
  exact task/ENI/task-definition evidence, and a signed `readerRuntime` whose payload hash is
  independently reconstructed from final H2 facts.
- Added a root-run database-reader bootstrap that uses a separate temporary private ECS execution
  role for writer+reader secret injection. The writer URL is never downloaded locally, and the
  bootstrap role/policy is deleted after success. The persistent controller can pass only the reader
  execution role.
- Added the exact three-service `currentHealth` producer: stable duplicate Express reads, exact
  `1/2/AVERAGE_CPU/70`, one active revision, complete RUNNING task/private-IP set equality with all
  healthy target IPs/ports, exact SSM/PUBLIC ingress, service-specific HTTPS 200 and bounded complete
  canonical status-ok body. Raw responses plus independent hashes are retained.
- Added canonical stage-context producer/consumer binding. Artifact name is exactly
  `production-a5-stage-context-<STAGE>-<SOURCE_SHA>-production-<PARENT_RUN_ID>-attempt-<PARENT_RUN_ATTEMPT>`
  and contains only `context.json`. PRE binds H2A clone bytes/ref and source applied-migration hash;
  POST_MIGRATION binds exact executed migrations, execution budgets and H5 authority; POST_DEPLOYMENT
  binds the same authority/source hash. Prior refs are none → PRE-only → PRE+POST_MIGRATION.

Artifacts:

- `.github/workflows/production-a5.yml`
- `infra/security/run-production-a5-readonly.sh`
- `apps/api/prisma/production-a5/run-readonly-evidence-task.ts`
- `infra/security/reconstruct-production-a5-result.sh`
- `infra/security/collect-production-a5-current-health.sh`
- `infra/security/bootstrap-production-a5-readonly.sh`
- `infra/security/bootstrap-production-a5-database-reader.sh`
- `infra/security/build-production-a5-stage-context.sh`
- `infra/security/validate-production-a5-stage-context.sh`
- dedicated trust/policy templates and focused `production-a5-*.spec.sh` files.

Verification:

- PASS: `production-a5-readonly-bootstrap.spec.sh`, `production-a5-readonly-runner.spec.sh`,
  `production-a5-result.spec.sh`, `production-a5-current-health.spec.sh`,
  `production-a5-stage-context-producer.spec.sh`, and `production-a5-workflow.spec.sh`.
- PASS: focused production evidence logic/reviewed-manifest tests (14/14) and shell/YAML syntax.
- Adversarial cases reject public/shared/task-role tasks, wrong secret versions, wrong source image,
  SG drift, duplicate/truncated/replayed result frames, unstable/service-scaling/task-target/HTTP
  health drift, wrong parent/stage/prior refs, missing clone/H5 authority, noncanonical and extra
  stage-context fields.
- No AWS/GitHub mutation, commit, push or deploy occurred in this slice.

Next:

1. E6 owner uploads the exact one-file stage contexts from the parent production attempt and
   dispatches H2 strictly H2A → PRE → apply → POST_MIGRATION → traffic → POST_DEPLOYMENT.
2. E6 must derive/verify all child run IDs and H5 bytes, recheck H5 before every mutation boundary,
   and require the H2A migration-tool image to equal every H2 `readerRuntime.migrationImage`.
3. Bootstrap the reviewed AWS resources only after the exact controller files land on protected
   `main`. Run `LEGACY_PRE_F1` before PRE, recreate the temporary bootstrap authority after it is
   removed, then run `F1_CURRENT` after migration and before POST_MIGRATION; the post reader guard
   must fail if the exact `ReimbursementLine` grant refresh is missing.

## E1 reimbursement aggregate and clone-secret closure — 2026-08-03

Status: LOCAL P0 PRODUCER/CONTRACT COMPLETE; E6 READER-GRANT ORDERING AND LIVE RUNS PENDING.

Decisions:

- Production H2 emits only aggregate pending-approval counts
  (`v2Valid`/`exactV1Compatible`/`missingHash`/`invalid`) and requires missing/invalid to be zero.
  Its production reader catalog adds only `ReimbursementRequest` and `ReimbursementLine`; UAT's
  established 13-table catalog remains unchanged.
- The hosted clone controller never reads `SecretString` or constructs a database URL. It retains
  only the RDS-managed secret ARN and sole `AWSCURRENT` version. ECS injects exact versioned
  `host`/`username`/`password`/`dbname` JSON keys plus nonsecret port; the no-task-role container
  constructs the strict TLS URL in memory and deletes every PG variable before children/output.
- The final reimbursement writer removes only `rbl_<requestId>` with matching company/request under
  the existing aggregate advisory lock before replacing lines. This keeps an untouched deterministic
  v1 row recognizable while preventing a final v2 line from inheriting false legacy provenance.
- The reviewed post-data invariant now proves dense line numbers, header amount/earliest date/first
  category/Thai multi-category label and every deterministic fallback field. Corrupt date, category,
  label, fallback mapping, tenant, amount, line absence or line density fails closed.
- Clone reimbursement evidence binds the explicit spec-reporter command and exactly 2 suites /
  13 tests / 13 pass / 0 skipped; aliases or stale counts are rejected.

Verification:

- Required real PostgreSQL gate: 13/13 PASS, 2 suites, 0 skipped after the final fallback/invariant
  change. Untouched exact-v1 approval and current-writer fallback replacement both pass; all named
  corruption probes fail then roll back to PASS.
- PASS: clone runner TypeScript 3/3, aggregate H2 logic/collector 20/20, reader/bootstrap logic 12/12,
  repository aggregate rollback 3/3, API typecheck, signed-evidence E0 adversarial suite, clone
  bootstrap/runner/workflow suites, current-health, stage-context, private-reader, reconstruction and
  production-A5 workflow suites.
- `git diff --check` PASS. No AWS/GitHub mutation, commit, push or deploy occurred in this slice.

Remaining P0:

- `.github/workflows/production-a5.yml` selects schema profiles but deliberately has read-only AWS
  authority. E6 must invoke `bootstrap-production-a5-readonly.sh --apply` plus
  `bootstrap-production-a5-database-reader.sh` with the verified H2A digest before PRE
  (`LEGACY_PRE_F1`), recreate the removed temporary authority, and repeat after migration before
  POST_MIGRATION (`F1_CURRENT`). Without this, the post guard safely fails on the missing
  `ReimbursementLine` grant.
