# Agent Memory: payroll-hr-compliance-20

Status: Docs readiness updated for new LINE leave request and warning scope; implementation not started.

Owner: WatchDog-BMS item 20.

Scope: Payroll and HR Compliance docs now include linked-employee LINE leave request intake, HR/manager web approval ticket, employee LINE/web leave notifications, and frequent-leave warning with default threshold 5 requests per employee per payroll period/month.

Decisions:
- LINE can create only the linked employee's own `PENDING_APPROVAL` leave request through the same permission-checked leave request use case.
- HR/manager approval and rejection stay web/API-owned; LINE/AI must refuse leave approval/rejection and payroll-sensitive mutations.
- Frequent-leave warning is notification-only and must not auto-reject leave.
- Default frequent-leave warning threshold is 5 leave requests per employee per payroll period/month until company policy overrides it.
- Notification payloads must not expose sensitive leave reason, salary, tax, bank, health, or benefit details.

Open questions:
- Should the leave-frequency warning count reset by payroll period only, or should later company policy support rolling 30/60/90-day windows?
- Which manager/HR recipient policy should be default when an employee has no assigned manager?

Artifacts:
- `docs/specs/payroll-hr-compliance-spec.md`
- `docs/plans/payroll-hr-compliance-plan.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
- `docs/product/business-use-cases.md`
- `docs/specs/permission-matrix.md`
- `docs/specs/line-ai-read-only-assistant-spec.md`
- `docs/plans/line-ai-read-only-assistant-plan.md`

Verification:
- `git diff --check -- docs/specs/payroll-hr-compliance-spec.md docs/plans/payroll-hr-compliance-plan.md docs/plans/master-implementation-checklist.md docs/plans/implementation-roadmap.md docs/product/business-use-cases.md docs/specs/permission-matrix.md docs/specs/line-ai-read-only-assistant-spec.md docs/plans/line-ai-read-only-assistant-plan.md`: pass.
- Targeted `rg` sweep found no remaining absolute "LINE read-only" wording that conflicts with own leave-request intake exception.
- Trailing whitespace sweep on this memory file: pass.
- No code/test implementation in this update.

Next:
- Implement item 20 from Phase 0 and Phase 1 first, then wire LINE leave intake in the HR/leave API and notification phase.
