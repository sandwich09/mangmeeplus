# Agent Memory: Main local QA fixes — 2026-08-28

Status: F01–F09 fixed and locally verified; preparing develop integration and main PR. Not an all-scenarios certification.
Owner: Codex
Scope: Fix findings F01–F09, repeat local default-feature journeys, integrate into develop and open a PR to main. No production deployment or main merge.

## Product and architecture

- Baseline: main `0d96b01973ac465ee91d48f8c85dd51d71ef4b5c`; origin/develop `b5327356dc84cb602b183b50a1d12284f5c0af98` has the same tree. Isolated QA worktree; original `plan` worktree and its unrelated changes are excluded.
- Follow existing accounting-documents, dashboard-notification, branch-scope and auth specs. Preserve server authorization, quotation separation of duties, final-mutation boundaries, tenant/branch scope and default feature flags.
- Ponytail full: correct existing UI/state/error mappings; reuse API response fields and current helpers. No dependency, schema, package.json, business-policy or cloud changes planned.

## Fix / acceptance checklist

- [x] F01 Expense confirmation: never claim ledger posting merely because confirmation succeeded.
- [x] F02 Branch read-only: session without company.branch.manage has no create/edit controls; server permission remains authoritative.
- [x] F03 Quotation self-approval: explain why a submitter cannot approve, disable their approval action, preserve other-user approval and rejection rules; map server denial for stale clients.
- [x] F04 Duplicate expense category: create/update show duplicate-name guidance, not concurrency/reload guidance.
- [x] F05 Branch tax code: optional empty or exactly five ASCII digits; create/edit validate inline and server errors retain useful guidance.
- [x] F06 Notifications: unread rows disappear after successful read/read-all; failed read/dismiss/read-all retain state and report failure in both center and bell.
- [x] F07 Sales documents: Thai posting labels and customer-facing heading/description; show existing unapplied customer-credit amount.
- [x] F08 Password: normal change and forced temporary-password change have accurate, distinct guidance without changing navigation guards.
- [x] F09 Employee filter: distinguish no matching selection from a genuinely empty company.

Additional same-flow correction: a draft quotation no longer offers issue before approval. Other document issue states and backend policy are unchanged.

## Verification plan

1. Focused regression tests for UI decisions/error translations and existing backend policy tests.
2. Full web test suite, API suite and type checks; inspect every scoped diff.
3. Browser retest on local API/web and isolated `watchdog_main_qa_20260828` database. Start new QA-tagged records, repeat enabled default navigation and key mutation/validation flows as Owner and Finance; include mobile, notification network failure, and cross-user quotation approval.
4. Record passed, failed and not-executed cases separately. External LINE/AI delivery, legal acceptance/signatures, account activation/password change require their real prerequisite or action-time user participation; do not fabricate acceptance or claim these passed.
5. Refresh remote refs, integrate only this change into develop, open develop → main PR, inspect CI. Do not deploy or merge main.

Open questions: No unresolved product decision for the nine fixes. Human acceptance/activation/signing, real integrations and remaining browser permutations are not certified. One browser tab crashed during later role-page retesting; the replacement loaded the role page, then browser control rejected further access under its URL policy. No workaround or role mutation was attempted after that denial; the cause of the tab crash is not established.

Artifacts:
- Follow-up matrix, screenshots and navigation results: `docs/evidence/main-local-qa-fixes-2026-08-28/README.md`.
- Prior audit remains in the original worktree at `docs/evidence/main-local-feature-qa-2026-08-28/README.md` (36 screenshots), excluded from this change.
- Local download `expense-index-all (2).xlsx` inspected read-only; 5 expense records, 43 columns, numeric amounts match the new confirmed expense. JSON manifest parsed with 2 attachments; signed URLs and credentials excluded from repository artifacts.

Verification:
- Full web `pnpm test`: 1213 tests / 256 suites; pass1213, fail0, skipped0.
- Full API `pnpm test` including pretest: exit0. Focused accounting/expense/branch backend regression: 103 tests / 21 suites, fail0.
- Web and API `pnpm typecheck`: exit0. Web `NODE_ENV=production pnpm build`: exit0. `git diff --check`: clean.
- Browser: Owner20/Finance14 observed navigation targets, F01–F09 affected UI paths, cross-user quotation approval/issue, invoice conversion and partial/overpayment credit, immediate/deferred income, upload/manual expense and partial/overpayment rejection, branches/categories, employee draft validation, credit/debit notes, notification success/failure/retry and mobile390x844.
- SQL: EXP-202608-00049 confirmed/paid163.25, posting pending/journalNULL; quotation137.50 approved by Finance, invoice paid137.50 and credit1; income400/WHT12 and deferred225; CN10/DN5; feature flags unchanged16ON/44OFF.
- Final API `/v1/health` statusok, web `/login` HTTP200. Runtime tested the working diff on the main baseline; no cloud deployed SHA claimed.

Next: Commit the scoped fix/evidence, inspect PR CI, merge into develop, open develop → main PR without merging main or deploying. Keep the coverage limits visible in both PRs and final handoff.
