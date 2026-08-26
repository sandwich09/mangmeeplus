# Agent Memory: P9 Customer Journey Observability

Status: P9-0 implemented and verified; ready for review
Owner: Platform Operations with per-stage owner in executable catalog
Scope: Four product lanes; subscription/payment excluded
Decisions:
- Reuse structured log, audit, outbox, and domain state; no new telemetry dependency.
- Mark evidence `LIVE`, `PARTIAL`, or `PLANNED`; do not infer end-to-end coverage from a terminal-only audit or free-text error log.
- Keep funnel/SLO targets null until a representative baseline cohort exists.
- Treat missing, duplicate, and orphan terminal correlation as correctness failures.
- Keep financial commit separate from downstream outbox publication; telemetry recovery must never duplicate a legal/accounting mutation.
Open questions:
- P9-1 thresholds remain unset until baseline evidence exists.
- P10/P11/P12 provider and owner policy gates remain in their canonical specs; P9 does not decide them.
- Existing shell touch targets below 44 px (32 px menu, 36 px notification) remain a P24 accessibility follow-up; P9-0 adds no UI surface.
Artifacts:
- `apps/api/src/common/observability/customer-journey-signal.catalog.ts`
- `apps/api/src/common/logger/security-event.spec.ts`
- `docs/specs/customer-journey-observability-signal-contract.md`
- `docs/runbooks/customer-journey-signal-triage.md`
- `docs/plans/production-ops-plan.md`
- `infra/monitoring/runtime-alarms.spec.sh` (aligned stale UAT Redis fake fixture with the current standalone runtime contract)
Verification:
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/common/logger/security-event.spec.ts` — 18/18 pass.
- `corepack pnpm --filter @watchdog-bms/api test` — full API suite pass.
- `corepack pnpm --filter @watchdog-bms/api typecheck` and `corepack pnpm --filter @watchdog-bms/api lint` — pass after generating the clean-worktree Prisma client.
- `corepack pnpm --filter @watchdog-bms/web typecheck` — pass.
- `bash infra/monitoring/runtime-alarms.spec.sh` — pass; the stale UAT Redis fixture and metric-filter expectations were aligned with the current runtime contract.
- Local Chrome desktop 1440×900 — authenticated dashboard, 7-day range interaction, and receipt-upload page loaded with no console error or horizontal overflow.
- Local Chrome mobile 390×844 — authenticated dashboard, responsive menu navigation, and receipt-upload page loaded with no console error or horizontal overflow.
Next:
- Commit, push, and open a PR to `develop`.
- P9-1 adds missing emitters/adapters and dashboards row by row; it must not relabel `PARTIAL`/`PLANNED` as live without source evidence.
