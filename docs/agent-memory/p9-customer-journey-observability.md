# Agent Memory: P9 Customer Journey Observability

Status: P9-0 is in PR #267; P9-1a is in PR #268; P9-1b is in PR #269; P9-2 local failure matrix implemented and verified
Owner: Platform Operations with per-stage owner in executable catalog
Scope: Four product lanes; subscription/payment excluded
Decisions:
- Reuse structured log, audit, outbox, and domain state; no new telemetry dependency.
- Mark evidence `LIVE`, `PARTIAL`, or `PLANNED`; do not infer end-to-end coverage from a terminal-only audit or free-text error log.
- Keep funnel/SLO targets null until a representative baseline cohort exists.
- Treat missing, duplicate, and orphan terminal correlation as correctness failures.
- Keep financial commit separate from downstream outbox publication; telemetry recovery must never duplicate a legal/accounting mutation.
- Build the first dashboard only from metrics already emitted in deployed code; show durable-source and unimplemented rows as coverage gaps instead of fabricating zeroes.
- CloudWatch dashboards are account-global, so IAM and verification use the regionless dashboard ARN while metric widgets pin `ap-southeast-1`.
- Reuse durable `AuditLog` for request-boundary accepted/terminal pairs; the helper rethrows the original error and never retries the observed mutation.
Open questions:
- P9-1 thresholds remain unset until baseline evidence exists.
- P10/P11/P12 provider and owner policy gates remain in their canonical specs; P9 does not decide them.
- Existing shell touch targets below 44 px (32 px menu, 36 px notification) remain a P24 accessibility follow-up; P9-0 adds no UI surface.
- Receipt upload intents abandoned before the completion endpoint remain `PARTIAL`; there is no current expiry reconciler to invent a terminal from.
Artifacts:
- `apps/api/src/common/observability/customer-journey-signal.catalog.ts`
- `apps/api/src/common/observability/customer-journey-audit.ts`
- `apps/api/src/common/observability/customer-journey-failure-matrix.catalog.ts`
- `apps/api/src/common/logger/security-event.spec.ts`
- `docs/specs/customer-journey-observability-signal-contract.md`
- `docs/runbooks/customer-journey-signal-triage.md`
- `docs/plans/production-ops-plan.md`
- `infra/monitoring/runtime-alarms.spec.sh` (aligned stale UAT Redis fake fixture with the current standalone runtime contract)
- `infra/monitoring/runtime-alarms.sh` (environment journey dashboard install/exact verification)
- `infra/production/monitoring-bootstrap-policy.template.json` (dashboard-scoped IAM)
Verification:
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/common/logger/security-event.spec.ts` — 18/18 pass.
- `corepack pnpm --filter @watchdog-bms/api test` — full API suite pass.
- `corepack pnpm --filter @watchdog-bms/api typecheck` and `corepack pnpm --filter @watchdog-bms/api lint` — pass after generating the clean-worktree Prisma client.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — pass.
- `bash infra/monitoring/runtime-alarms.spec.sh` — pass; the stale UAT Redis fixture and metric-filter expectations were aligned with the current runtime contract.
- Local Chrome desktop 1440×900 — authenticated dashboard, 7-day range interaction, and receipt-upload page loaded with no console error or horizontal overflow.
- Local Chrome mobile 390×844 — authenticated dashboard, responsive menu navigation, and receipt-upload page loaded with no console error or horizontal overflow.
- P9-1a `bash infra/monitoring/runtime-alarms.spec.sh` — pass for UAT/Production install, exact dashboard read-back, privacy assertions, IAM scope, and existing metric-filter evidence.
- P9-1a shell syntax and monitoring IAM JSON validation — pass.
- P9-1a focused journey contract — 18/18 pass; full API suite, API typecheck/lint, web typecheck, and production config validation (48/48) pass.
- P9-1a local Chrome 1440×900 and 390×844 — authenticated dashboard, mobile navigation, and receipt-upload CTA/page pass with no console error or horizontal overflow; mobile primary actions are at least 44 px high.
- P9-1b focused journey/auth/OCR/upload/document tests — 92/92 pass.
- P9-1b API typecheck — pass after generating the clean-worktree Prisma client.
- P9-1b full API suite and spec-suite coverage gate — pass.
- P9-1b `bash infra/monitoring/runtime-alarms.spec.sh` — pass.
- P9-1b targeted Playwright E2E — ACCT-04, EXP-05, EXP-06, and EXP-07 pass (4/4) against the local API, PostgreSQL, Redis, and MinIO stack.
- Local audit reconciliation after E2E — sales issue 1 accepted/1 terminal, expense confirmation 1/1, receipt upload completion 3/3, and receipt OCR 1/1; zero correlations had accepted or terminal cardinality other than one.
- Local browser at 1440×900 and 390×844 — dashboard, receipt upload, sales-document list, and expense list render without console errors or horizontal overflow. The local database first exposed a missing applied revenue-category migration; `prisma migrate deploy` applied the committed migration and the sales page then passed.
- P9-2 focused API failure-matrix, request logging, Redis degradation, LINE signature, OCR client, audit persistence, outbox failure/fencing tests — pass; runtime alarm contract — pass.
- P9-2 LINE provider/hosted-AI targeted API and AI Gateway suites — pass.
- P9-2 full API suite, API typecheck, and AI Gateway typecheck — pass. No UI surface changed; P9-1b browser evidence remains the applicable journey-page check.
Next:
- Commit/push/open the P9-2 stacked PR to `develop` (depends on PR #269).
- UAT must still prove one synthetic alert per severity with acknowledged delivery. P10-P12 must land before the `PLANNED` signup/claim/SES rows can truthfully become live.
