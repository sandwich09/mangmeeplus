# Production Ops Spec

## 1. Status

Ready for implementation handoff. Canonical order: [[plans/master-implementation-checklist|Master Implementation Checklist]] item 24.

Active implementer target: Sonnet 4.6 or later.

Linked plan: [[plans/production-ops-plan|Production Ops Plan]]

Related specs and decisions:

- [[specs/platform-foundation-local-prod-lean-spec|Platform Foundation Local/Prod Lean Spec]]
- [[specs/platform-environment-config-spec|Platform Environment and Runtime Config Spec]]
- [[specs/auth-authorization-rbac-spec|Authentication, Authorization, and RBAC Spec]]
- [[specs/permission-matrix|Permission Matrix]]
- [[specs/dashboard-notification-spec|Dashboard and Notification Spec]]
- [[specs/workflow-automation-spec|Workflow Automation Spec]]
- [[specs/line-ai-read-only-assistant-spec|LINE AI Read-Only Assistant Spec]]
- [[specs/ai-gateway-agents-spec|AI Gateway and Agents Spec]]
- [[adr/0005-aws-first-hosting-and-deployment-strategy|ADR 0005 AWS-First Hosting and Deployment Strategy]]
- [[adr/0006-phase-1-platform-stack-defaults|ADR 0006 Phase 1 Platform Stack Defaults]]

This spec defines product and engineering behavior for production readiness. It is not a substitute for cloud provider documentation, security review, accounting/legal review, or incident-response obligations. Before production launch, re-check current AWS service availability, backup/restore features, pricing, regional support, and account limits.

## 2. Goal

Ship a minimal but trustworthy production operations layer for WatchDog-BMS:

- Production readiness checklist with evidence.
- Backup policy visibility.
- Restore drill workflow and recorded result.
- Monitoring, metrics, alert rule catalog, and alert evidence.
- Production runbook index.
- Release, deployment, and rollback visibility.
- Cost guard with budgets, forecast, and cost-spike alerts.
- Admin-only web view for operational status.
- Permission-checked, read-only LINE/AI summaries where item 07 and item 17 primitives exist.

Item 24 makes production usable and recoverable. It must not hide operational risk behind a green status. Unknown, unverified, overdue, or manually confirmed items stay visible.

## 3. Non-goals

- No Kubernetes, multi-region, active-active, blue/green, canary, or full SRE platform in first pass.
- No replacement for AWS console, CloudWatch, RDS, S3, Budgets, IAM, or CI/CD provider.
- No automatic production rollback, restore, deploy, migration rollback, account budget change, or infrastructure mutation from LINE/AI.
- No destructive production data operation from the web UI.
- No direct access to raw secrets, raw logs with PII, full SQL dumps, object payloads, or AI prompts.
- No full incident management suite, on-call scheduler, pager integration, postmortem workflow, or compliance certification automation.
- No staging environment requirement in the lean path. Staging remains future scope until owner adds it.
- No business feature changes except adding operational hooks, status, and safe evidence around existing services.

## 4. Product Decisions for First Pass

- Local and production are the only required environments in the lean path.
- AWS remains the default production target from ADR 0005.
- ECS Fargate is the first production runtime target for web, API, AI Gateway, and workers.
- Current no-real-user migration path is ECS Express Mode for public Web/API and AI Gateway services, using `infra/prod-ecs-express/deploy.sh`; App Runner remains rollback only until ECS smoke passes and LINE/LIFF endpoints are moved.
- RDS PostgreSQL is the source-of-truth database target.
- S3 is the object storage target.
- Redis/Valkey is queue/cache target, not permanent source of truth.
- Secrets live in AWS Secrets Manager or SSM Parameter Store in production.
- CloudWatch or equivalent owns primary logs and metrics.
- Web/API own production ops mutations and evidence records.
- LINE and AI are read-only for ops status and must refuse deploy, rollback, restore, cost, permission, secret, and infrastructure mutation.
- Restore drills must target isolated local or temporary environments. Never overwrite production.
- Cost guard first pass uses manual evidence and optional CI-uploaded sanitized JSON summary.
- AWS Cost Explorer/Budgets adapter is backlog, behind the same cost guard interface.
- `docs/runbooks/` is the canonical production ops runbook folder.
- Cost guard must be visible before customer data enters production.
- Restore test must be performed and recorded before item 24 can be checked complete.

## 4.1 Backlog Notes

Do not build these in the first implementation pass:

- Direct AWS Cost Explorer or Budgets integration.
- Cloud budget creation or threshold mutation from the app.
- Provider-side alert rule mutation unless infrastructure code already supports it and owner expands scope.
- Production deploy, rollback, restore, migration rollback, secret rotation, IAM mutation, or infrastructure mutation from web, LINE, or AI.
- Raw log, dump, object payload, secret, billing payment detail, or AI prompt viewers.

Recommended follow-up when first pass is stable:

- Add AWS Cost Explorer read adapter for tagged spend, budget actuals, and forecast.
- Add AWS Budgets evidence sync or alert ingestion after IAM scope is reviewed.
- Add provider-side alert/rule sync only through infrastructure-as-code or controlled admin workflow.
- Add richer cost anomaly detection after baseline monthly spend is known.

## 5. User Roles

- Owner: sees all ops status, readiness, restore drill result, release, rollback, and cost guard information; can record manual evidence and approve checklist closure.
- Admin: sees operational status and can maintain non-destructive runbook/evidence records when granted.
- Engineer/operator: can record deployment metadata, backup evidence, restore drill evidence, alert rule evidence, and rollback readiness when granted.
- Finance/admin reviewer: can view cost guard, budgets, forecast, and tagged spend summaries where granted.
- Auditor readonly: can read ops evidence, release history, backup/restore proof, and audit trail without mutation.
- AI assistant user: can ask permission-checked read-only ops questions only.

## 6. Operating Model

### Local

Local supports:

- Docker Compose infrastructure for PostgreSQL, Redis, and MinIO.
- Health checks for web, API, AI Gateway, workers, database, Redis, and object storage.
- Restore drill rehearsal using local or disposable data.
- Readiness checks against local config and service health.
- No real production secrets.

### Production

Production supports:

- Containerized services with immutable image tags or digests.
- `SERVICE_VERSION`, `GIT_SHA`, and image digest recorded per release where available.
- Managed database backups enabled before customer data enters the system.
- S3 versioning or equivalent object recovery decision recorded.
- Log retention, metric retention, and audit retention configured.
- Budget/cost alerts configured.
- Rollback path documented per service and migration type.
- Operational evidence stored without secrets or raw customer data.

## 7. Core Business Rules

- Ops endpoints are protected by auth, company context where applicable, RBAC, and sensitive action audit.
- Ops records are system-level. If multi-company context exists, production infrastructure status is tenant-agnostic, while tenant data counts and customer-sensitive detail stay hidden unless explicitly allowed.
- Readiness status is derived from checks and evidence. Users cannot mark a failing automated check as passed; they can only attach manual evidence and override notes where policy allows.
- Unknown state is not pass.
- Restore drill state must include target environment, source backup reference, validation summary, RPO, RTO, started/completed timestamps, actor, and evidence.
- Backup status must show latest known recovery point age and retention policy. It must not expose raw snapshot credentials or dump paths containing secrets.
- Cost guard status must show budget, actual cost, forecast, threshold status, and last sync/evidence time. It must not expose billing account secrets or payment data.
- Release status must include service, environment, version, git SHA, image digest when available, deploy time, migration version when available, and rollback target when known.
- Production images are built from a committed Git snapshot, carry that commit in the OCI revision label, and are deployed by digest. Dirty, ignored, and untracked workstation files are never part of the build context.
- Runtime images contain compiled/standalone artifacts and production dependencies only. CI must export and scan the final filesystem and retain an SBOM; `.env`, application source/source maps, admin scripts, Prisma CLI, `tsx`, TypeScript, SWC, and Turbo are release blockers.
- Database migrations and registry/master-data sync run as an approved release task for the same commit before API rollout. Long-running API containers do not carry or execute migration, seed, password-reset, or other admin tooling.
- Rollback readiness is per service and per data-migration risk. Code rollback does not imply data rollback.
- Destructive or irreversible database migrations require a documented backup point and rollback/forward-fix plan before production deploy.
- AI Gateway, LINE, and notification payloads must not include secrets, raw logs, object contents, database dumps, employee/payroll sensitive fields, customer document contents, tax identifiers, bank details, or raw prompts.
- Ops notifications should include status, severity, service, timestamp, and deep link to web, not sensitive details.
- Every ops mutation is audited: evidence create/update, restore drill record, runbook status, readiness override, release record, rollback note, cost threshold config.

## 8. Permission Keys

Add permission keys to the current permission registry/matrix using existing naming style:

```text
ops.read
ops.evidence.manage
ops.readiness.manage
ops.backup.read
ops.restore_drill.manage
ops.monitoring.read
ops.alert_rule.manage
ops.release.read
ops.release.manage
ops.rollback.read
ops.rollback.manage
ops.cost.read
ops.cost.manage
ops.runbook.manage
ops.audit.read
```

Default first-pass grants:

- Owner: all item 24 permissions.
- Admin: `ops.read`, `ops.monitoring.read`, `ops.backup.read`, `ops.release.read`, `ops.rollback.read`, `ops.cost.read`; manage permissions only when explicitly granted.
- Engineer/operator: manage evidence, readiness, restore drill, alert rules, releases, rollback notes, and runbook entries when role exists.
- Finance/admin reviewer: read and manage cost guard only when granted.
- Auditor readonly: read permissions only.
- AI/LINE tool user: read-only summary through server-side permission check; no direct permission escalation.

## 9. Data Model Draft

Use current persistence conventions from earlier items. Names below are logical contracts, not forced table names if repo convention differs.

### OpsEvidence

- `id`
- `scope`: `READINESS`, `BACKUP`, `RESTORE_DRILL`, `MONITORING`, `RELEASE`, `ROLLBACK`, `COST`, `RUNBOOK`
- `subjectKey`
- `title`
- `evidenceType`: `URL`, `TEXT`, `ATTACHMENT_REF`, `SYSTEM_SNAPSHOT`, `COMMAND_OUTPUT_SUMMARY`
- `evidenceRef`
- `summary`
- `capturedAt`
- `capturedByUserId`
- `redactionStatus`: `SAFE`, `REDACTED`, `REJECTED`
- `checksum` when file/evidence service supports it
- `createdAt`
- `updatedAt`

### OpsReadinessCheck

- `key`
- `category`: `CONFIG`, `SECURITY`, `DATA`, `BACKUP`, `RESTORE`, `MONITORING`, `RELEASE`, `ROLLBACK`, `COST`, `RUNBOOK`
- `title`
- `severity`: `BLOCKER`, `HIGH`, `MEDIUM`, `LOW`
- `status`: `PASS`, `WARN`, `FAIL`, `UNKNOWN`, `NOT_APPLICABLE`
- `source`: `AUTOMATED`, `MANUAL`, `HYBRID`
- `lastCheckedAt`
- `lastPassedAt`
- `failureReason`
- `evidenceRequired`
- `evidenceIds`
- `ownerRole`
- `sortOrder`

### BackupPolicyStatus

- `id`
- `targetType`: `POSTGRES`, `S3`, `REDIS_QUEUE`, `SECRETS`, `CONFIG`, `CONTAINER_IMAGE`
- `targetName`
- `environment`
- `backupMode`: `MANAGED_AUTOMATED`, `VERSIONED_STORAGE`, `EXPORT`, `MANUAL`, `NOT_SOURCE_OF_TRUTH`
- `frequency`
- `retentionDays`
- `encryptionStatus`
- `latestRecoveryPointAt`
- `latestRecoveryPointRef`
- `recoveryPointAgeSeconds`
- `status`
- `lastSyncedAt`
- `evidenceIds`

### RestoreDrill

- `id`
- `environment`
- `targetEnvironment`
- `sourceTargetType`
- `sourceBackupRef`
- `startedAt`
- `completedAt`
- `status`: `PLANNED`, `RUNNING`, `PASSED`, `FAILED`, `CANCELED`
- `rpoSeconds`
- `rtoSeconds`
- `validationSummary`
- `validatedChecks`
- `failureReason`
- `performedByUserId`
- `reviewedByUserId`
- `evidenceIds`
- `nextDrillDueAt`

### MonitoringSignal

- `key`
- `serviceName`
- `signalType`: `HEALTH`, `METRIC`, `LOG_QUERY`, `TRACE`, `SYNTHETIC`, `MANUAL`
- `status`: `OK`, `WARN`, `ALERT`, `UNKNOWN`
- `value`
- `unit`
- `threshold`
- `period`
- `lastObservedAt`
- `sourceRef`

### OpsAlertRule

- `id`
- `key`
- `serviceName`
- `source`
- `metricOrQuery`
- `condition`
- `threshold`
- `severity`
- `enabled`
- `notifyChannels`
- `runbookKey`
- `lastTriggeredAt`
- `createdByUserId`
- `updatedAt`

### DeploymentRelease

- `id`
- `environment`
- `serviceName`
- `version`
- `gitSha`
- `imageDigest`
- `deploymentRef`
- `migrationVersion`
- `status`: `PLANNED`, `DEPLOYED`, `FAILED`, `ROLLED_BACK`, `SUPERSEDED`
- `deployedAt`
- `deployedBy`
- `rollbackTargetReleaseId`
- `rollbackRunbookKey`
- `evidenceIds`

### RollbackRecord

- `id`
- `environment`
- `serviceName`
- `fromReleaseId`
- `toReleaseId`
- `reason`
- `dataMigrationRisk`: `NONE`, `FORWARD_ONLY`, `REVERSIBLE`, `UNKNOWN`
- `status`: `PLANNED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCELED`
- `startedAt`
- `completedAt`
- `performedByUserId`
- `evidenceIds`

### CostGuardStatus

- `id`
- `environment`
- `serviceOrTag`
- `currency`
- `monthlyBudgetAmount`
- `monthToDateAmount`
- `forecastAmount`
- `thresholdPercent`
- `status`: `OK`, `WARN`, `ALERT`, `UNKNOWN`
- `lastSyncedAt`
- `sourceRef`
- `evidenceIds`

### OpsRunbookEntry

- `key`
- `title`
- `category`
- `filePath`
- `ownerRole`
- `lastReviewedAt`
- `reviewedByUserId`
- `status`: `DRAFT`, `READY`, `STALE`
- `linkedAlertRuleKeys`

## 10. API Behavior

Use current API route conventions. Suggested routes:

### Readiness

- `GET /v1/ops/readiness`
  - Permission: `ops.read`
  - Returns grouped checks, status summary, blockers, overdue items, and evidence refs.
- `POST /v1/ops/readiness/checks/:key/evidence`
  - Permission: `ops.evidence.manage`
  - Adds sanitized evidence to a manual or hybrid check.
- `POST /v1/ops/readiness/run`
  - Permission: `ops.readiness.manage`
  - Runs safe automated checks only. No infrastructure mutation.

### Backup and Restore

- `GET /v1/ops/backups`
  - Permission: `ops.backup.read`
  - Returns policy/status for database, object storage, Redis/queue, secrets/config, images.
- `GET /v1/ops/restore-drills`
  - Permission: `ops.backup.read`
  - Returns restore drill history and next due date.
- `POST /v1/ops/restore-drills`
  - Permission: `ops.restore_drill.manage`
  - Creates planned drill record. Does not run destructive restore automatically.
- `PATCH /v1/ops/restore-drills/:id`
  - Permission: `ops.restore_drill.manage`
  - Records started/completed/failed status, RPO/RTO, validation summary, evidence.

### Monitoring and Alerts

- `GET /v1/ops/monitoring`
  - Permission: `ops.monitoring.read`
  - Returns health, metric, alert, queue, backup-age, and cost status.
- `GET /v1/ops/alert-rules`
  - Permission: `ops.monitoring.read`
  - Returns alert catalog.
- `POST /v1/ops/alert-rules`
  - Permission: `ops.alert_rule.manage`
  - Creates non-secret alert catalog record. Provider mutation is future/adaptor scope unless infrastructure code supports it.
- `PATCH /v1/ops/alert-rules/:id`
  - Permission: `ops.alert_rule.manage`
  - Updates threshold/enabled/runbook link.

### Release and Rollback

- `GET /v1/ops/releases`
  - Permission: `ops.release.read`
  - Returns release history.
- `POST /v1/ops/releases`
  - Permission: `ops.release.manage`
  - Records deployment metadata from CI/CD or manual operator.
- `GET /v1/ops/rollback`
  - Permission: `ops.rollback.read`
  - Returns rollback readiness per service and latest known rollback target.
- `POST /v1/ops/rollback-records`
  - Permission: `ops.rollback.manage`
  - Records rollback plan/result. Does not perform rollback automatically.

### Cost Guard

- `GET /v1/ops/cost`
  - Permission: `ops.cost.read`
  - Returns budget status, month-to-date, forecast, thresholds, and sync/evidence time.
- `PATCH /v1/ops/cost/:id`
  - Permission: `ops.cost.manage`
  - Updates internal budget threshold/evidence. Cloud budget mutation needs explicit future scope.

### Runbook

- `GET /v1/ops/runbooks`
  - Permission: `ops.read`
  - Returns runbook index and review status.
- `PATCH /v1/ops/runbooks/:key`
  - Permission: `ops.runbook.manage`
  - Updates owner/review/status metadata, not arbitrary file contents unless repo already supports doc editing safely.

## 11. Web UI Behavior

Add a production ops page under the existing admin/settings/platform navigation pattern.

Primary screens:

- Readiness: grouped checks, blockers, warnings, evidence links, last checked time.
- Backup and Restore: backup target status, latest recovery point age, restore drill history, next drill due date.
- Monitoring: service health, queue health, alert status, latest incidents/alerts.
- Releases: current release per service, release history, rollback target, migration risk.
- Cost Guard: budget, month-to-date, forecast, threshold status, tagged spend summary.
- Runbooks: runbook index, owner, review status, linked alert rules.

UI rules:

- Do not show raw secret values, raw logs, raw SQL, database dumps, object payloads, or raw AI prompts.
- Use status, timestamps, service names, summaries, links, and evidence refs.
- Mutation buttons require explicit permissions and should be limited to evidence/status records.
- Unknown/overdue states must be visually distinct from pass.
- Destructive operations are not buttons in first pass. Use runbook links and recorded evidence instead.

## 12. LINE and AI Behavior

LINE and AI can answer:

- "Production status?"
- "Latest backup age?"
- "When was last restore drill?"
- "Any active ops blockers?"
- "Which service is currently deployed?"
- "Are costs over budget?"

LINE and AI must refuse:

- Deploy production.
- Roll back service.
- Restore database.
- Rotate secret.
- Change budget.
- Change alert thresholds.
- Download logs, backups, or files.
- Reveal secrets, raw logs, customer data, prompts, tax IDs, bank details, or payroll data.

All AI/LINE answers must:

- Use permission-checked API/tool calls.
- Cite internal status/evidence IDs or web deep links.
- Summarize status only.
- Avoid raw sensitive payloads.

## 13. Monitoring Signals

First-pass signal catalog:

- Web health.
- API health.
- AI Gateway health.
- Worker process health.
- Database connectivity.
- Redis/Valkey connectivity.
- Object storage connectivity.
- HTTP 5xx rate.
- HTTP latency p95.
- Request volume.
- Auth failure spike.
- Rate limit spike.
- Database connection pool pressure.
- Slow query count where available.
- Migration status.
- Queue lag.
- Dead-letter queue count.
- Worker job failure rate.
- S3/object operation error rate.
- LINE webhook failure rate.
- AI Gateway model/tool error rate.
- AI tool refusal count.
- Backup recovery point age.
- Restore drill overdue status.
- Log ingestion status.
- Cost budget status.

Alert thresholds must be config-driven. Suggested default severity:

- Blocker: service down, database unavailable, backup overdue, restore drill failed, production secret/config unsafe, migration failed.
- High: 5xx rate above threshold, queue DLQ above zero, database storage/free capacity warning, forecast cost above 100 percent budget.
- Medium: p95 latency above threshold, restore drill overdue, log ingestion delayed, AI Gateway degraded.
- Low: runbook stale, evidence missing, non-critical cost tag missing.

## 14. Backup and Restore Requirements

Production must have documented backup policy for:

- RDS PostgreSQL database.
- S3 object storage.
- Secrets/config references.
- Container images.
- Important deployment metadata.
- Redis/Valkey queue state only if it holds important in-flight work.

First-pass restore targets:

- Database restore to isolated local or temporary environment.
- Object storage recovery proof through versioned object or sample restore.
- Config/secret recovery proof by reference inventory, not plaintext export.

Default first-pass targets:

- RPO: 24 hours or better for database source of truth.
- RTO: 8 hours or better for solo-dev MVP.
- Restore drill cadence: at least before first production launch, then every 90 days until owner changes policy.

Restore drill must verify:

- Restored app can start against restored database.
- Critical tables/records are present by count/checksum/known fixture.
- Attachments/object refs still resolve for sample records.
- Auth and tenant boundaries still work in smoke test.
- No production system is overwritten.
- Evidence is recorded.

## 15. Release and Rollback Requirements

Each production deploy should record:

- Service name.
- Environment.
- Version.
- Git SHA.
- Image digest when available.
- Deployment reference.
- Migration version/status when available.
- Actor/source.
- Time.
- Previous release/rollback target.

Rollback runbook must cover:

- Web service rollback.
- API service rollback.
- AI Gateway rollback.
- Worker rollback.
- Failed migration response.
- Failed deployment response.
- Queue/job pause or drain.
- AI/model disable switch.
- External integration disable switch where supported.

Migration policy:

- Prefer expand-contract migrations.
- Back up before destructive migrations.
- Block deploy when migration plan is unknown for high-risk schema/data changes.
- Block API deploy unless release-task evidence is bound to the exact Git SHA being deployed.
- Data rollback must be explicit. Code rollback alone is not enough after irreversible migration.

## 16. Cost Guard Requirements

Cost guard must show:

- Monthly budget.
- Month-to-date spend.
- Forecast spend.
- Threshold status.
- Last sync/evidence time.
- Service/tag breakdown where available.
- Missing tag warnings.

Required tags for AWS resources where supported:

```text
app=watchdog-bms
env=production
service=<web|api|ai-gateway|workers|database|redis|storage|networking|observability>
owner=<owner-or-team>
cost-center=<cost-center-or-project>
```

First-pass alerts:

- Forecast >= 80 percent of budget.
- Forecast >= 100 percent of budget.
- Any untagged production resource found by inventory/evidence.
- AI/model spend over configured threshold where provider data is available.
- Log storage retention or ingestion cost spike over threshold where available.

## 17. Runbook Requirements

Create or update runbook docs for:

- Production deployment.
- Rollback per service.
- Database backup and restore drill.
- Object storage recovery.
- Queue/DLQ triage.
- Service down triage.
- High error rate triage.
- High latency triage.
- Secret rotation.
- AI Gateway disable/recovery.
- LINE webhook failure triage.
- Cost spike triage.
- Production readiness closeout.

Each runbook needs:

- Owner role.
- Last reviewed date.
- Trigger.
- Preconditions.
- Steps.
- Verification.
- Rollback/stop condition.
- Evidence to record.

## 18. Audit and Security Requirements

- Ops mutations must write audit events.
- Evidence attachment/upload must reuse current file safety rules.
- Evidence text must reject obvious secret patterns when redaction helpers exist.
- API responses must redact secret-like keys and raw payloads.
- Logs must include request id and actor id but not sensitive data.
- Admin UI must not expose infrastructure credentials.
- Cost data must not expose payment method details.
- LINE/AI must not reveal sensitive ops details beyond permission-checked summaries.

## 19. Edge Cases

- Cloud provider API unavailable: show stale/unknown with last sync time.
- Backup status unavailable: status is unknown or fail depending severity; not pass.
- Restore drill failed: keep blocker until resolved and new drill passes.
- Rollback target missing: release status warns; rollback readiness fails for that service.
- Migration version unknown: release status warns or fails based risk.
- Cost API unavailable: show stale/unknown, not green.
- Budget not configured: cost guard fails production readiness.
- Monitoring provider missing: monitoring readiness fails.
- Logs too noisy or too expensive: cost guard warns and runbook points to retention/sampling decision.
- Evidence contains secrets: reject or mark `REJECTED`.
- Multi-company user asks AI for production ops: answer only if user has ops read permission; no tenant data leak.

## 20. Acceptance Criteria

- [ ] Production Ops spec and plan are linked from Master Implementation Checklist item 24.
- [ ] Permission keys are added to permission matrix/registry.
- [ ] Ops API exposes readiness, backup, restore drill, monitoring, release, rollback, cost, and runbook status.
- [ ] Ops UI shows production readiness blockers, warnings, evidence, and unknown states.
- [ ] Backup policy status exists for database, object storage, secrets/config, container images, and Redis/queue if applicable.
- [ ] At least one restore drill can be recorded with RPO/RTO, validation summary, and evidence.
- [ ] Monitoring signal catalog covers services, DB, Redis, object storage, queues, logs, AI Gateway, LINE webhook, backup age, restore drill, and cost.
- [ ] Release records capture service, version, git SHA, image digest where available, migration version where available, and rollback target.
- [ ] Rollback runbooks exist for web, API, AI Gateway, workers, failed deploy, failed migration, and queue/job recovery.
- [ ] Cost guard shows budget, actual, forecast, thresholds, tags, and last sync/evidence time.
- [ ] LINE/AI ops tools are read-only and refuse deploy/rollback/restore/secret/budget/alert mutation.
- [ ] All ops mutations are audited.
- [ ] No ops response, log, notification, or AI answer exposes secrets, raw logs, raw dumps, raw object payloads, or sensitive customer/business data.
- [ ] Local and production verification commands are recorded in the implementation notes.
- [ ] Master Implementation Checklist item 24 remains unchecked until implementation and verification pass.

## 21. Test Cases

- Unit: readiness aggregator maps pass/warn/fail/unknown correctly and treats unknown as not pass.
- Unit: backup recovery point age computes status from policy threshold.
- Unit: restore drill RPO/RTO and overdue status calculations.
- Unit: cost guard threshold status from budget/actual/forecast.
- Unit: secret-like evidence is rejected/redacted.
- Unit: release rollback readiness fails when target release missing.
- Integration: `GET /v1/ops/readiness` requires `ops.read`.
- Integration: evidence creation requires `ops.evidence.manage` and writes audit event.
- Integration: restore drill update requires `ops.restore_drill.manage` and writes audit event.
- Integration: cost threshold update requires `ops.cost.manage`.
- Integration: read-only roles cannot mutate ops records.
- Integration: AI/LINE read tool returns summary for allowed user and refuses mutation request.
- UI: ops page renders blocker, warning, pass, unknown, stale, and overdue states.
- UI: unauthorized user cannot access ops page.
- UI: evidence and runbook links display without raw secrets.
- E2E/manual: local docker stack health checks pass.
- E2E/manual: restore drill proof recorded against isolated target.
- E2E/manual: rollback runbook can identify previous release without performing destructive action.

## 22. Implementation Handoff Checklist

- [ ] Read [[plans/master-implementation-checklist|Master Implementation Checklist]] item 24.
- [ ] Read [[plans/production-ops-plan|Production Ops Plan]].
- [ ] Read this spec.
- [ ] Read [[specs/platform-foundation-local-prod-lean-spec|Platform Foundation Local/Prod Lean Spec]].
- [ ] Read [[specs/platform-environment-config-spec|Platform Environment and Runtime Config Spec]].
- [ ] Read [[adr/0005-aws-first-hosting-and-deployment-strategy|ADR 0005 AWS-First Hosting and Deployment Strategy]].
- [ ] Read [[specs/auth-authorization-rbac-spec|Authentication, Authorization, and RBAC Spec]] and [[specs/permission-matrix|Permission Matrix]].
- [ ] Inspect current `apps/api`, `apps/web`, `apps/ai-gateway`, `apps/workers`, `packages/contracts`, `packages/config`, `infra`, CI, and Docker files.
- [ ] Implement Phase 0 and Phase 1 from the plan first unless owner expands scope.
- [ ] Use `docs/runbooks/` for production ops runbooks.
- [ ] Use manual evidence and optional CI-uploaded sanitized JSON summary for first-pass cost guard.
- [ ] Keep item 24 unchecked until all phases and verification pass.

## 23. Suggested Handoff Prompt

```text
Implement Master Implementation Checklist item 24: Production Ops.

Read docs/plans/production-ops-plan.md and docs/specs/production-ops-spec.md first, then inspect the current repo. Start with Phase 0 and Phase 1 only unless owner explicitly expands scope. Reuse current platform, auth, RBAC, audit, notification, workflow, worker, config, contracts, and web patterns. Do not add destructive production actions. Keep LINE/AI read-only. Never expose secrets, raw logs, dumps, object payloads, raw prompts, or sensitive business data. Keep Master Implementation Checklist item 24 unchecked until all phases and verification pass.
```

## 24. Open Questions

- Should first production launch require staging, or is local/prod lean still the owner-approved path at launch time?
- Should restore drill cadence stay 90 days after first customer data, or move to monthly once paid customers exist?
- Should production ops evidence be stored only in database, or can approved sanitized attachments be stored through existing object storage primitives?
