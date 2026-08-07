# AI-Assisted Period Close Implementation Plan (Item 10E)

## Status

Ready for owner review. Roadmap placement: item **10E. AI-Assisted Period Close with Accountant Review and Auditor Approval** in [[plans/master-implementation-checklist|Master Implementation Checklist]].

Implement one phase at a time. First handoff scope is Phase 0 and Phase 1 unless owner expands scope.

## Linked Specs

- [[specs/double-entry-ledger-closing-spec|Double-Entry Ledger and Closing Spec]] §22 (owner update 2026-07-06 — source of the approval-chain requirement)
- [[specs/auth-authorization-rbac-spec|Auth/RBAC Spec]] §22 (external accountant/auditor collaborators with explicit external flag)
- [[specs/ai-draft-suggestion-layer-spec|AI Draft and Suggestion Layer Spec]] (item 17 — AI-authored draft boundary this plan reuses)
- [[specs/workflow-automation-spec|Workflow Automation Spec]] (item 16 — approval-review primitives where useful)
- [[specs/bank-reconciliation-spec|Bank Accounts and Reconciliation Spec]] §19 (statement evidence input)
- [[specs/permission-matrix|Permission Matrix]] §5.1 (`ledger.period.approve_close` — granted to no system role by default)

## Owner Decisions (2026-07-06)

- AI prepares the close package as a **draft only**; AI never executes close/unclose and never posts entries.
- Approval chain: ACCOUNTANT review/approve -> auditor approve -> human executes final close under `ledger.period.close`.
- Both accountant and auditor may be internal or external (accounting office / audit firm). External collaborators use the guest/external-collaborator feature and must carry an explicit "external" flag/toggle visible in team UI, approval records, and audit.
- `AUDITOR_READONLY` stays read-only; approval uses the distinct `ledger.period.approve_close` permission assigned via a dedicated auditor collaborator role.
- Bank statements are uploadable at any time as close evidence; dedupe goal is only "no duplicated data corrupts balances" (item 13 §19).

## Dependencies (verify at Phase 0)

- Item 17 AI Draft layer: implemented in repo but unchecked — known gaps (migration deploy to live DB, notification dispatch) must be closed or accepted before Phase 2 relies on it.
- Item 13: statement import API exists; import/matching web UI and reconciliation summary read APIs are open blockers — Phase 3 consumes whatever read model exists and must not silently fake missing data.
- External-collaborator access feature does not exist yet (10C+ pillar / item 25). Phase 1 builds the minimal slice this item needs, not the full governance pillar.

## Phases

### Phase 0 — Baseline and Memory

- Verify current close flow (`RunPeriodCloseChecksUseCase`, `PeriodCloseRun`, `ledger.period.close`) and item 17/13 states against the notes above.
- Create `docs/agent-memory/ai-assisted-period-close-10e.md` from the memory template.

Exit: dependency reality recorded; no code yet.

### Phase 1 — Approval Chain Data Model + Auditor Collaborator Slice

- Prisma: extend `PeriodCloseRun` (or add `PeriodCloseApproval`) with review/approval records: accountant review (userId, decision, note, at), auditor approval (userId, decision, note, at), each immutable once written.
- Register `ledger.period.approve_close` in the permission registry; grant to no system role; create the dedicated auditor collaborator role template.
- Minimal external-collaborator slice: membership-level `isExternalCollaborator` flag (+ optional org name), settable in Settings > Employees for accountant/auditor roles, shown as a chip in team UI, embedded in approval records and audit metadata, excluded from seat counting.
- Guards: `ExecutePeriodCloseUseCase` refuses unless an accountant review approval AND an auditor approval exist for the same close-run snapshot; self-approval across steps denied (reviewer != approver != closer unless owner explicitly allows closer == reviewer; default deny approver == reviewer).

Exit: close is impossible without both approvals; approvals audited with external flag; focused tests pass.

### Phase 2 — AI Close Package Draft (item 17 reuse)

- New suggestion template `period_close_package` in the item 17 catalog: AI runs on bounded evidence (close-readiness check results, draft-journal list, TB/P&L/BS summaries, unposted-source list, bank statement/reconciliation status where available) gathered by the API; model writes the package narrative, flagged issues, and draft adjusting-entry proposals as **candidate actions** (no final-mutation type).
- Draft adjusting entries surface as reviewable proposals only; accepting one creates a normal draft manual journal through the existing ACCOUNTANT-permission path — never a posted entry.
- Provider config per platform default (Bedrock via AI Gateway; `disabled`/fake = fail-closed/CI).

Exit: accountant can request an AI close package for a period and see cited, permission-scoped draft output; no ledger state changes from generation.

### Phase 3 — Review/Approve/Close Web Flow

- Web Ledger workspace: close wizard showing AI package -> accountant review decision (approve/reject with note) -> auditor approval queue (works for internal or external collaborator login) -> final close button enabled only after both approvals; unclose keeps existing OWNER rules.
- Statement evidence panel: show bank statement/reconciliation status for the period from item 13 read APIs; show "unavailable" honestly when item 13 gaps remain.
- Notifications: pending-review and pending-approval events to the right roles via item 06.

Exit: full chain click-through passes live (draft -> review -> approve -> close); rejection paths return the run to draft with audit.

### Phase 4 — Hardening and Handoff

- Audit sweep: every step audited with external flags; no AI content in audit beyond bounded metadata.
- Tests: permission battery (AUDITOR_READONLY cannot approve; approver without permission 403; AI cannot reach close/post routes — route-table test), approval immutability, snapshot-mismatch guard (package generated for stale period state forces regenerate).
- Docs: checklist evidence, task memory finalize, permission matrix confirmation.

Exit: item 10E gate criteria all demonstrably pass; verification commands recorded.

## Verification Baseline

Per phase: `pnpm -r typecheck`, focused + full `apps/api` tests, `apps/web` tests, `prisma validate` + `migrate deploy` on local Postgres, live browser click-through for Phase 3, and recorded evidence in task memory.
