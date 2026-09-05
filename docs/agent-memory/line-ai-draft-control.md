# Agent Memory: line-ai-draft-control

Status: docs approved (Owner 2026-09-05, 5 decisions) → building slices A/B in parallel, then C, then D
Owner: Owner (product) · Fable (control) · Opus (implementation)
Scope: spec `docs/specs/line-ai-draft-control-spec-th.md`, plan `docs/plans/line-ai-draft-control-plan-th.md`
Decisions: service charge first-class (chargeKind), no silent today-date, receipt-mode BE dates with recorded assumptions, `unsupported_yet` refusal split from `unsupported_module`, LINE draft edits behind preview+confirm postback and `LINE_AI_DRAFT_EDIT_ENABLED` (default off), one UAT deploy after everything.
Open questions: Q1 (no-VAT-evidence charge → NEEDS_REVIEW), Q2 (edit allowed up to READY_FOR_CONFIRMATION) — spec defaults stand unless the Owner objects.
Artifacts: branches `codex/line-ai-truth-and-dates` (A), `codex/expense-charge-kind` (B), `codex/line-ai-explain-record` (C), `codex/line-ai-draft-edit` (D)
Verification: per slice — api fixed-list, typecheck, prisma validate, pins --check, web test/build when web touched, mutation table, security eval (D), local LINE-fake drive (J2–J4)
Next: A + B implementation → review → PR develop; C after B; D after C; single develop→main PR; UAT deploy on Owner order.
