# Production Ops Implementation Plan

## Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 24.

Implementation owner/model should implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner explicitly expands scope.

## Linked Spec

- Spec: [[specs/production-ops-spec|Production Ops Spec]]
- Roadmap item: [[plans/master-implementation-checklist|Master Implementation Checklist]] -> 24. Production Ops
- Related specs:
  - [[specs/platform-foundation-local-prod-lean-spec|Platform Foundation Local/Prod Lean Spec]]
  - [[specs/platform-environment-config-spec|Platform Environment and Runtime Config Spec]]
  - [[specs/auth-authorization-rbac-spec|Authentication, Authorization, and RBAC Spec]]
  - [[specs/permission-matrix|Permission Matrix]]
  - [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
  - [[specs/workflow-automation-spec|Workflow Automation Spec]]
  - [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
  - [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
  - [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]]
- Related guidelines:
  - [[guidelines/backend-hexagonal-code-style|Backend Hexagonal Code Style Guideline]]
  - [[guidelines/web-frontend-code-style|Web Frontend Code Style Guideline]]
  - [[guidelines/security-implementation-guideline|Security Implementation Guideline]]
- Related ADRs:
  - [[adr/0005-aws-first-hosting-and-deployment-strategy|ADR 0005 AWS-First Hosting and Deployment Strategy]]
  - [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

## Purpose

Implement the production readiness layer for WatchDog-BMS:

- Readiness checks and evidence.
- Backup policy visibility.
- Restore drill tracking.
- Monitoring and alert catalog.
- Production runbook index.
- Release and rollback visibility.
- Cost guard.
- Admin-only web UI.
- Read-only LINE/AI ops summaries when item 07 and item 17 primitives exist.

This plan should give Sonnet 4.6 enough detail to implement without reopening product or architecture decisions.

## Current Repository Context

Current docs snapshot on 2026-06-23 shows item 24 follows these foundations:

- Item 01 platform foundation owns service shells, Docker, config, local/prod lean path, and CI gates.
- Item 02 auth/RBAC/audit owns trusted request context, permission checks, and sensitive action audit.
- Item 03 web core owns workspace navigation, settings/admin patterns, tables, detail panels, and forms.
- Item 04 data model core owns company, branch, attachment, sequence, audit, and outbox primitives.
- Item 06 dashboard/notification owns notification delivery and dashboard hooks.
- Item 07 LINE AI assistant owns read-only LINE access, source refs, and web deep links.
- Item 16 workflow owns tasks, SLA, and safe automation records.
- Item 17 AI draft/suggestion owns draft-only AI suggestions and refusal boundaries.
- Item 18 reports owns safe export/report registry behavior.

Current repo structure includes:

- `apps/api`: NestJS API service.
- `apps/web`: Next.js web service.
- `apps/ai-gateway`: NestJS AI Gateway.
- `apps/workers`: worker service.
- `packages/contracts`: shared contracts.
- `packages/config`: shared config package.
- `infra/docker`: local Docker Compose and deploy contract.

Before implementation, inspect latest code again because earlier roadmap items may add Prisma, request context, auth guards, permission registry, audit, outbox, notification providers, workflow actions, report registry, AI tool registry, web shell routes, CI workflows, infrastructure code, and current package scripts.

## Implementation Readiness Status

Status: ready for implementation handoff as of 2026-06-23.

Active implementer target: Sonnet 4.6 or later.

Product decisions for first pass:

- Local/prod lean path remains active.
- AWS-first target remains ECS Fargate, RDS PostgreSQL, S3, Redis/Valkey, Secrets Manager or SSM, CloudWatch, ECR, Route 53, and ACM.
- Web/API own ops records and evidence.
- LINE and AI are read-only.
- No destructive production action from web, LINE, or AI in first pass.
- Restore drill must use isolated local or temporary target.
- Cost guard first pass uses manual evidence and optional CI-uploaded sanitized JSON summary.
- AWS Cost Explorer/Budgets adapter stays backlog until IAM/account access and tagged spend baseline are reviewed.
- `docs/runbooks/` is the canonical production ops runbook folder.
- Cost guard is required before item 24 can close.
- Master checklist item 24 stays unchecked until implementation and verification pass.

Start point:

1. Read this plan first.
2. Read `docs/specs/production-ops-spec.md`.
3. Read `docs/specs/platform-foundation-local-prod-lean-spec.md`.
4. Read `docs/specs/platform-environment-config-spec.md`.
5. Read `docs/adr/0005-aws-first-hosting-and-deployment-strategy.md`.
6. Read `docs/specs/auth-authorization-rbac-spec.md` and `docs/specs/permission-matrix.md`.
7. Read backend/frontend/security guidelines.
8. Inspect `apps/api`, `apps/web`, `apps/ai-gateway`, `apps/workers`, `packages/contracts`, `packages/config`, `infra`, CI, Dockerfiles, and current database state.
9. Start at Phase 0: Baseline and Gap Map.

Do not mark Master Implementation Checklist item 24 complete until Phase 0 through Phase 10 exit criteria pass and verification commands are recorded.

## Implementation Rules

- Reuse current repo conventions and outputs from items 01 through 23.
- Extend existing config/auth/RBAC/audit/outbox/notification/workflow/AI/web primitives. Do not duplicate them.
- Keep controllers thin. Controllers call use cases only.
- Keep infrastructure/provider calls behind interfaces/adapters.
- Do not call cloud provider mutation APIs from LINE/AI.
- Do not expose secrets, raw logs, raw database dumps, raw object payloads, raw AI prompts, payroll/bank/tax/customer-sensitive data, or production credentials.
- Treat unknown/stale provider data as warning or failure, never pass.
- Keep readiness check rules deterministic and testable.
- Evidence must be sanitized and audited.
- Restore drills must never overwrite production.
- Rollback records document actions; first pass does not auto-execute rollback.
- Cloud budget mutation is out of scope unless owner explicitly approves a later phase.
- First-pass cost guard uses manual evidence and optional CI-uploaded sanitized JSON summary, not direct Cost Explorer/Budgets integration.
- Store production ops runbooks in `docs/runbooks/`.
- Each phase must leave touched packages typecheckable.

## Scope

### In Scope

- Shared ops contracts in `packages/contracts`.
- Config additions in `packages/config` where patterns exist.
- Permission keys and default grants for production ops.
- API module for readiness, evidence, backup status, restore drill, monitoring, alert catalog, releases, rollback records, cost guard, and runbook index.
- Persistence for ops evidence/status records using current database patterns.
- Worker jobs/adapters for safe status sync where worker primitives exist.
- Web feature folder/page for admin-only production ops dashboard.
- Notification hooks for ops alerts when item 06 exists.
- Read-only AI/LINE ops summaries when current AI Gateway integration points exist.
- Runbook docs under `docs/runbooks/` or current docs pattern.
- Tests for domain logic, permissions, audit, API behavior, UI states, and AI/LINE refusal where test setup supports them.

### Out of Scope

- Kubernetes, multi-region, active-active, blue/green, canary, or full SRE stack.
- Automatic production deploy, rollback, restore, migration rollback, budget mutation, IAM mutation, or secret rotation from app UI.
- Direct AWS resource provisioning unless infrastructure code already exists and owner expands scope.
- Raw log viewer, raw SQL dump viewer, object payload browser, secret browser, or cost payment details.
- Full incident management suite, pager/on-call integration, postmortem workflow, SOC2/ISO compliance automation.
- Staging environment requirement in first pass.

## Backlog and Next-Scope Notes

### Not in First Pass

- AWS Cost Explorer read adapter.
- AWS Budgets adapter or provider-side budget mutation.
- Provider-side alert rule mutation unless current infrastructure code already supports it and owner expands scope.
- Cost anomaly detection beyond threshold comparison.
- Full incident management, pager/on-call, postmortem, or compliance automation.
- Production deploy, rollback, restore, migration rollback, secret rotation, IAM mutation, or infrastructure mutation from web, LINE, or AI.

### Recommended Next Work

- Add AWS Cost Explorer read adapter after IAM policy and tag baseline are reviewed.
- Add AWS Budgets alert ingestion after first production budget exists.
- Add CI job that uploads sanitized cost/readiness JSON into ops evidence.
- Add provider-side monitoring sync through infrastructure-as-code when production alert rules settle.

## Phase 0: Baseline and Gap Map

### Goal

Confirm current repo state and map item 24 onto existing platform primitives.

### Tasks

- [ ] Read all linked docs and guidelines.
- [ ] Inspect current API module style, web feature style, contracts, config, workers, Docker, CI, and infrastructure code.
- [ ] Identify existing auth/RBAC/audit/notification/workflow/AI primitives.
- [ ] Identify current database/migration technology.
- [ ] Identify current health endpoints and service startup config.
- [ ] Identify current deployment metadata support: version, git SHA, image digest, CI run id.
- [ ] Identify whether runbook docs folder exists; create one only if needed.
- [ ] Record a short implementation note with discovered primitives and gaps.

### Tests

- No code test required unless inspection changes docs or scripts.
- Run existing fast checks only if touched code exists.

### Exit Criteria

- Current repo primitives are known.
- Phase 1 implementation can proceed without guessing framework boundaries.
- Any missing foundation dependency is listed as a blocker or fallback.

## Phase 1: Contracts, Permissions, and Config

### Goal

Define shared item 24 API contracts, permissions, and config without provider-specific mutation.

### Tasks

- [ ] Add ops DTOs/types/enums in `packages/contracts` using current contract style.
- [ ] Add permission keys from [[specs/production-ops-spec|Production Ops Spec]].
- [ ] Update permission matrix/default grants.
- [ ] Add config keys for ops thresholds, restore drill cadence, cost budget, provider mode, and redaction controls using `packages/config` patterns.
- [ ] Add domain constants for readiness categories, check severity, status, evidence scope, target type, release status, and cost status.
- [ ] Add tests for status/severity enum mapping and config validation.

### Tests

- `pnpm --filter @watchdog-bms/contracts typecheck`
- `pnpm --filter @watchdog-bms/config typecheck`
- Relevant package tests if scripts exist.

### Exit Criteria

- Shared contracts compile.
- Production unsafe or missing required ops config fails fast where config validation exists.
- Permission keys are documented and mapped.

## Phase 2: Readiness and Evidence API

### Goal

Expose deterministic production readiness status and sanitized evidence records.

### Tasks

- [ ] Add API module following current hexagonal/backend style.
- [ ] Implement readiness check domain service.
- [ ] Implement automated checks that are safe locally: config shape, service version/git SHA presence, health endpoint availability, backup policy record presence, cost guard presence, runbook presence.
- [ ] Implement `OpsEvidence` create/list behavior.
- [ ] Add evidence redaction/rejection for obvious secret-like content where redaction helpers exist.
- [ ] Add audit events for evidence and readiness mutations.
- [ ] Add API routes from spec section 10 using current route conventions.

### Tests

- Unit readiness aggregator.
- Unit evidence redaction/rejection.
- Integration permission checks.
- Integration audit write on mutation.

### Exit Criteria

- `GET /v1/ops/readiness` returns pass/warn/fail/unknown grouped checks.
- Unknown or stale status does not pass.
- Evidence records are permission-checked, sanitized, and audited.

## Phase 3: Backup and Restore Drill

### Goal

Track backup policy and prove restore readiness through recorded restore drill.

### Tasks

- [ ] Implement `BackupPolicyStatus` and `RestoreDrill` domain models/persistence.
- [ ] Add backup status adapters with safe manual/system snapshot fallback.
- [ ] Add restore drill workflow: plan, start, complete, fail, cancel.
- [ ] Add RPO/RTO calculation and overdue status.
- [ ] Add local restore drill runbook.
- [ ] Add object storage recovery proof runbook.
- [ ] Add API routes for backup status and restore drills.
- [ ] Add audit events for restore drill mutation.

### Tests

- Unit RPO/RTO calculation.
- Unit overdue drill calculation.
- Integration restore drill permission/audit behavior.
- Manual local restore drill evidence recorded.

### Exit Criteria

- Backup status exists for database, object storage, secrets/config, images, and Redis/queue if applicable.
- At least one restore drill can be recorded with validation summary and evidence.
- Restore drill cannot target production overwrite.

## Phase 4: Monitoring and Alert Catalog

### Goal

Make production health, metrics, and alert rules visible without leaking sensitive data.

### Tasks

- [x] P9-0: add the executable customer-journey signal contract, privacy allowlist, source-evidence tests, and shared triage runbook (`docs/specs/customer-journey-observability-signal-contract.md`).
- [ ] P9-1: instrument every `PARTIAL`/`PLANNED` journey row and build dashboards without claiming unavailable coverage or setting pre-baseline targets.
- [ ] Implement monitoring signal model and summary service.
- [ ] Add signal adapters for available local health endpoints.
- [ ] Add alert rule catalog persistence.
- [ ] Add default alert rules from spec section 13.
- [ ] Add runbook link per alert rule.
- [ ] Add notification hook for alert status if item 06 primitives exist.
- [ ] Add API routes for monitoring summary and alert rules.

### Tests

- Unit signal status aggregation.
- Unit threshold evaluation.
- Integration read/manage alert permissions.
- Notification payload redaction test where notification primitives exist.

### Exit Criteria

- Monitoring summary covers web, API, AI Gateway, workers, database, Redis, object storage, queues, backup age, restore drill, and cost guard where primitives exist.
- Alert catalog exists with severity, threshold, and runbook link.
- Sensitive details are not emitted in notifications.

## Phase 5: Release and Rollback Visibility

### Goal

Record production releases and rollback readiness without auto-executing destructive actions.

### Tasks

- [ ] Implement deployment release model/persistence.
- [ ] Implement rollback record model/persistence.
- [ ] Add release metadata ingestion route for CI/manual operator.
- [ ] Add current release per service query.
- [ ] Add rollback readiness evaluator.
- [ ] Add rollback runbooks for web, API, AI Gateway, workers, failed deploy, failed migration, and queue/job recovery.
- [ ] Add migration risk fields and checks.

### Tests

- Unit rollback readiness with/without target release.
- Unit migration risk status.
- Integration release manage permission.
- Integration rollback record audit behavior.

### Exit Criteria

- Releases record service, version, git SHA, image digest where available, deployment ref, migration version, and rollback target.
- Rollback readiness is visible per service.
- Runbooks exist for rollback paths.

## Phase 6: Cost Guard

### Goal

Make production spend risk visible and thresholded.

### Tasks

- [ ] Implement cost guard model/persistence.
- [ ] Add budget/forecast/actual status service.
- [ ] Add manual evidence adapter first if Cost Explorer integration is not present.
- [ ] Add AWS tag requirements to runbook/checklist.
- [ ] Add cost alert threshold defaults.
- [ ] Add API routes for cost summary and threshold/evidence updates.
- [ ] Add notification hook for cost alerts if item 06 primitives exist.

### Tests

- Unit cost threshold status.
- Unit missing budget fails readiness.
- Integration cost read/manage permissions.
- Notification redaction test where notification primitives exist.

### Exit Criteria

- Cost guard shows budget, actual, forecast, thresholds, tags, and last sync/evidence time.
- Missing budget or stale cost data blocks readiness.
- Cost data exposes no payment method details or secrets.

## Phase 7: Production Ops Web UI

### Goal

Give owners/admins a compact admin UI for production readiness.

### Tasks

- [ ] Add web route under existing admin/settings/platform navigation pattern.
- [ ] Add readiness summary with blockers, warnings, unknown, stale, and pass states.
- [ ] Add backup/restore panel.
- [ ] Add monitoring/alert panel.
- [ ] Add release/rollback panel.
- [ ] Add cost guard panel.
- [ ] Add runbook index panel.
- [ ] Add evidence create/update UI only for users with manage permission.
- [ ] Add loading, empty, error, unauthorized, and stale states.

### Tests

- UI unit/component tests where setup exists.
- Permission/unauthorized UI test.
- Manual responsive QA for desktop and mobile.

### Exit Criteria

- Ops UI renders all item 24 status areas.
- Destructive operations are not offered as first-pass buttons.
- Text and status chips fit on mobile and desktop.

## Phase 8: Notification, Workflow, LINE, and AI Hooks

### Goal

Connect production ops to existing safe communication surfaces.

### Tasks

- [ ] Add notification events for readiness blocker, backup overdue, restore drill failed/overdue, service down, DLQ, and cost alert when item 06 exists.
- [ ] Add workflow tasks for restore drill review and runbook review when item 16 exists.
- [ ] Add read-only AI/LINE ops summary tool when item 07 and AI Gateway primitives exist.
- [ ] Add refusal behavior for deploy, rollback, restore, secret, budget, alert, and infrastructure mutation.
- [ ] Add source refs/deep links to web.

### Tests

- Notification payload redaction.
- Workflow task creation when threshold trips.
- AI/LINE allowed read summary.
- AI/LINE mutation refusal.
- Permission denial for users without `ops.read`.

### Exit Criteria

- Ops alerts can reach existing notification/workflow channels without leaking sensitive data.
- AI/LINE remains read-only and permission-checked.

## Phase 9: Runbooks and Production Evidence

### Goal

Finish operational docs and evidence needed for production readiness.

### Tasks

- [ ] Add or update runbooks listed in spec section 17.
- [ ] Create `docs/runbooks/` if it does not exist.
- [ ] Add production readiness closeout checklist.
- [ ] Add evidence examples and redaction rules.
- [ ] Add CI/deploy metadata capture instructions.
- [ ] Add restore drill execution notes.
- [ ] Add rollback verification notes.
- [ ] Add cost guard setup notes.
- [ ] Add docs links from ops UI/runbook index where current app pattern supports it.

### Tests

- Manual docs review.
- Link check with repo search where possible.

### Exit Criteria

- Runbooks exist, have owner/review metadata, and are linked from ops status.
- Production readiness closeout docs define exactly what evidence closes item 24.

## Phase 10: Verification, Documentation, and Checklist Gate

### Goal

Verify implementation, record commands, and only then close Master Implementation Checklist item 24.

### Tasks

- [ ] Run package checks for touched packages.
- [ ] Run root checks where feasible.
- [ ] Run local Docker health smoke if environment supports it.
- [ ] Record restore drill evidence.
- [ ] Record monitoring/alert evidence.
- [ ] Record rollback readiness evidence.
- [ ] Record cost guard evidence.
- [ ] Record first-pass cost guard source: manual evidence or CI-uploaded sanitized JSON summary.
- [ ] Update implementation notes with command outputs and unresolved risks.
- [ ] Update Master Implementation Checklist item 24 checkbox only after all exit criteria pass.

### Verification Commands

Use current scripts after inspecting repo:

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm docker:local
```

Targeted commands may be used when full root commands are too slow or blocked:

```bash
pnpm --filter @watchdog-bms/api typecheck
pnpm --filter @watchdog-bms/web typecheck
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/workers typecheck
pnpm --filter @watchdog-bms/contracts typecheck
pnpm --filter @watchdog-bms/config typecheck
```

### Exit Criteria

- All touched packages pass relevant checks.
- Local health smoke passes or blocker is documented.
- Restore drill evidence is recorded.
- Cost guard evidence is recorded.
- Rollback path is documented and visible.
- Item 24 remains unchecked until all verification passes.

## Risks

- Cloud provider APIs and pricing change after this docs handoff.
- Earlier items may not have audit, notification, workflow, AI tool, or web shell primitives yet.
- Full AWS Cost Explorer/Budgets integration may need credentials and account permissions not present locally.
- Restore drill automation can be dangerous if implemented as production mutation instead of isolated workflow.
- Raw logs/evidence can leak secrets if redaction is skipped.
- Migration rollback can be misunderstood as code-only rollback.

## Review Checklist

- [ ] Item 24 spec and plan are linked from master checklist.
- [ ] Implementation starts at Phase 0 and Phase 1 only unless owner expands scope.
- [ ] No destructive ops actions exist in first-pass web, LINE, or AI.
- [ ] Unknown/stale status is never green.
- [ ] Evidence is sanitized and audited.
- [ ] Restore drill cannot overwrite production.
- [ ] Cost guard exists and blocks readiness when missing/stale.
- [ ] Rollback readiness separates code rollback from data migration risk.
- [ ] LINE/AI are read-only and permission-checked.
- [ ] Master Implementation Checklist item 24 remains unchecked until verification passes.

## Sonnet 4.6 Handoff Prompt

```text
Implement Master Implementation Checklist item 24: Production Ops.

Read docs/plans/production-ops-plan.md and docs/specs/production-ops-spec.md first, then inspect the current repo. Start with Phase 0 and Phase 1 only unless owner explicitly expands scope. Reuse current platform, auth, RBAC, audit, notification, workflow, worker, config, contracts, and web patterns. Do not add destructive production actions. Keep LINE/AI read-only. Never expose secrets, raw logs, dumps, object payloads, raw prompts, or sensitive business data. Keep Master Implementation Checklist item 24 unchecked until all phases and verification pass.
```
