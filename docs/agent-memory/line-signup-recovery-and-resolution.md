# Agent Memory: LINE signup recovery and resolution

Status: Spec/plan ready; Sol xhigh workers discovering and implementing after coordinator start signal.
Owner: GPT-6 Astra coordinator; GPT-5.6 Sol xhigh implementation.
Scope: Close audited G01–G05 and related state/recovery/identity/trial/support gaps; deliver code/docs/tests via PR into develop and main using existing admin-merge authorization. No deployment in this task.
Decisions: Reuse existing flow/core/inbox; explicit add-shop intent and repeat-trial permission; no identity takeover from contact details; no-company reply and unresolved cases remain actionable. Mail provider and subscriber payment next. Read AGENTS.md/ponytail full; original user edits preserved in original checkout.
Open questions: Exact implementation contract names being coordinated; no new identity-proof method or commercial entitlement invented. Hard recovery lacking proven original access remains managed support, not an automated ownership mutation.
Artifacts: [Spec](../specs/line-signup-recovery-and-resolution-spec-th.md), [plan](../plans/line-signup-recovery-and-resolution-plan.md), [audit](../research/line-signup-rules-code-coverage-and-recovery-audit-2026-09-07-th.md).
Verification: Prior audit 4 LIFF counterexamples + 2 intake faults; baseline focused142 tests pass. Current worktree pnpm install --frozen-lockfile succeeded. Additional implementation evidence pending.
Next: Implement and validate worker lanes, coordinator review/fix gaps, source-matched CI/merge develop then main. Prepare next-topic handoff after delivery.
