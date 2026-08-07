# Agent Memory: fixed-assets-21

Status: Docs readiness complete for implementation handoff; implementation not started.

Owner: WatchDog-BMS item 21.

Scope: Fixed Assets was pulled forward from roadmap backlog on 2026-07-05 for docs readiness. The handoff now covers asset register, capitalization, depreciation, transfer/custody, impairment/adjustment, disposal/write-off, ledger/tax/report hooks, permission boundaries, web workflow, and read-only AI/LINE behavior.

Decisions:
- Web/API own all fixed-asset mutations.
- LINE and AI are read-only for fixed assets and must refuse capitalization, approval, depreciation run, disposal/write-off, export, posting, tax treatment, and policy mutation.
- First pass supports one accounting depreciation book.
- Straight-line monthly depreciation is required in first pass.
- Capitalization requires source evidence from procurement/AP, expenses, accounting/manual evidence, or attachments.
- Supplier/AP and expense modules may expose asset candidates, but item 21 owns final asset register creation.
- Disposal/write-off and impairment/adjustment require approval by default.
- Fixed Assets emits source posting inputs and tax review candidates; item 10 owns journals and item 11 owns tax filing/export lifecycle.

Open questions:
- Which company asset capitalization threshold should be the default recommendation, if any, after accountant review?
- Should first-pass asset tags be auto-generated only, or allow user-entered tags with uniqueness validation?
- Which manager/owner approval route should apply for low-value disposal/write-off when no workflow rule exists?

Artifacts:
- `docs/specs/fixed-assets-spec.md`
- `docs/plans/fixed-assets-plan.md`
- `docs/agent-memory/fixed-assets-21.md`
- `docs/plans/master-implementation-checklist.md`
- `docs/plans/implementation-roadmap.md`
- `docs/product/business-use-cases.md`
- `docs/specs/permission-matrix.md`
- `docs/agent-memory/business-use-cases.md`

Verification:
- Docs-only handoff update. No code/test implementation in this update.
- `git diff --check -- docs`: pass.
- Targeted stale wording sweep for old item-21 backlog/spec-plan blockers: pass. Remaining roadmap-backlog wording is for item 19 and item 23, not item 21.

Next:
- Implement item 21 from Phase 0 and Phase 1 first: repo integration reconciliation, contracts, permission constants, and pure domain logic/tests.
