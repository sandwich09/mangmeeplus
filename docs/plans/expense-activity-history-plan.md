# Expense activity history implementation plan

Spec: `../specs/expense-activity-history-spec.md`
Date: 2026-10-30

1. [x] Sol: trace existing audit writes and expense access; add shared response, scoped GET history, allowlisted persisted field diffs, and focused API/security tests.
2. [x] Luna: add the detail-page menu and shared history modal, Thai action/field labels, pagination and complete UI states; use the shared contract and existing API/date/modal patterns.
3. [x] Parent: review both diffs against the task-start copies, especially authorization, audit correctness, preserved edits and accessible UI; fix integration defects.
4. [x] Run focused tests and type checks. Actual Next page tested with local API fixtures; database-backed E2E unavailable (no local PostgreSQL).
5. [x] Update task memory with implementation and verification evidence. No deployment, commit, push, package.json change or cloud access in this task.

## Approved compact-table revision — 2026-10-30

- [x] Sol: return the actual expense creator name and exclude automatic activity before pagination/count; focused query/contract checks.
- [x] Luna: actor/action heading, creator in modal title, one compact three-column table per event; preserve loading/error/pagination/focus behavior.
- [x] Parent: inspect query boundaries and complete desktop/mobile browser review; update evidence and memory.

## Direct integration — 2026-10-30

- [x] Port only history changes onto current main/develop, preserving unrelated local and newer mainline work.
- [x] Verify current-base contracts/types, focused API tests19/19, web54/54, browser18 checks; record unchanged baseline fixture failures.
- [x] Atomic fast-forward push of `1fbba874e` to origin/main and origin/develop, no PR. Verify both remote refs. No deployment.
