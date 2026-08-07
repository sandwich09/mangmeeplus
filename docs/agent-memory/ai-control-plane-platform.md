# Agent Memory: AI Control Plane Platform

Status: brainstorm complete → draft spec written; no plan, no implementation yet.
Owner: thawtchai phuchana
Scope: system-neutral platform to control/monitor/manage AI runtimes; WatchDog-BMS is consumer #1.
Decisions:
- Neutral multi-system platform; WatchDog is tenant #1, no domain coupling.
- Constraints: cheap (single small VM class, OSS self-host, $0 license) and practical (every phase ships usable value).
- Buy the Monitor pillar (Langfuse preferred, Phoenix fallback); build only a thin Control API (kill switch/flags/budgets).
- Platform decides policy, each system's own gateway enforces; platform never inline on request path; fail to last-known-good.
- Phases: 1 See (tracing+cost) → 2 Stop (kill switch/budgets) → 3 Tune (prompt registry+evals) → 4 Scale out (system #2, alerting).
Open questions: see spec §13 (backend validation/licenses, deploy account, PII masking default, admin UI home).
Artifacts: docs/specs/ai-control-plane-platform-spec.md
Verification: n/a (docs only).
Next: validate Langfuse v3 self-host footprint/license vs Phoenix, then write implementation plan for Phase 1 if approved.
