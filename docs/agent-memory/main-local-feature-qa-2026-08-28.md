# Agent Memory: Main local active-feature QA 2026-08-28

Status: Original audit delivered — NOT an all-scenarios pass. User subsequently authorized fixes, retesting, develop merge and main PR; see follow-up below.
Owner: Codex / root.
Scope: User requested real local clicking through all initially enabled features and reachable scenarios; blockers, errors, incorrect rendering/data. Target verified remote main 0d96b01973ac465ee91d48f8c85dd51d71ef4b5c (git ls-remote). Original checkout remains branch plan, existing dirty/untracked user work preserved.
Decisions:
- Isolated detached worktree `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-qa-20260828`; frozen/offline dependency install, no package.json edits.
- Isolated PostgreSQL database `watchdog_main_qa_20260828`, cloned from existing local `watchdog_active_regression_20260827_r1`. Only local fixtures/test data may be mutated. No cloud, deployments, external messages, production financial actions, or real integrations.
- Source local company has 16 enabled of 60 explicit switches. Code's newly-onboarded default package is different (12 parent features); report this distinction rather than claim production or new-company defaults are identical.
- Keep feature configuration and human launch decisions intact. Standard local bootstrap may re-attest only SYSTEM-seeded gates using existing code. Blocked paths are not passed.
- Browser skill used for actual UI; code/SQL/tests corroborate findings. Ponytail full: existing tests/bootstrap, no app refactoring. Machine-specific ponytail path in AGENTS.md was unavailable; read repo-local ponytail skill instead.
- Owner and Finance use real password login. Staff stopped at legal acceptance, without bypass or acceptance on behalf of user. Final account activation/deletion/password changes/legal signing were not performed.
- Secondary Bloom company has no explicit entitlement rows and broader legacy defaults. Company switch + 14 extra pages smoke-tested only, not full lifecycles.
Open questions:
- User must complete any required Staff legal acceptance before full role-matrix UI testing can continue.
- Tax/ledger profile decisions, real LINE/OCR providers, export file verification, final sensitive actions, and untested scenario combinations remain outside verified coverage.
Artifacts:
- The original report, 36 JPEG screenshots, and `browser-page-smoke.json` were intentionally removed from `docs/evidence/` during repository cleanup on 2026-08-29; this memory preserves their conclusions and limitations.
- QA isolated worktree/database kept for reproduction; API3003/Web3000 remain running, temporary local env file `/tmp/mangmee-main-qa-20260828-env.sh`.
Verification:
- Remote main re-verified at end: unchanged 0d96b01973ac465ee91d48f8c85dd51d71ef4b5c.
- Dependencies, Prisma/packages/API build and health successful. One pending migration applied on clone; permission sync346/13roles; SYSTEM gate re-attestation succeeded. Flags still16ON/44OFF.
- Web1201tests/252suites; selected API319tests/73suites; both rerun exit0, fail0, skip0. Total1520 unique tests in final combined runs.
- Real UI: expense mixed-VAT250.25 ready; upload/manual recovery111.25 confirmed/paid; invoice201 payment202 allocated201/unapplied1; income300/WHT9/cash291 creates invoice+receipt; quotation cross-user approve/issue→billing99.50; credit10/debit5 issued; test category/branch/signature/employee draft/unassigned role persisted.
- SQL corroborated amounts, posting pending/journalNULL, denied Finance branch create, notification readAt, unchanged16flags; old branchless157 fixtures not guessed/backfilled.
- Browser desktop/mobile390x844 checked; no error/warn returned at inspected log checkpoints; no claim of complete network-console or real-device coverage.
- Final handoff checks: QA worktree clean after restoring Next-generated next-env.d.ts; API health OK; Web /login HTTP200; report30absolute links all exist,36JPEGs/9findings verified. Original user checkout changes preserved.
Next:
- Address report F01–F06 (false posting success, branch write controls, self-approval explanation, duplicate-name and tax-branch validation, unread filter refresh), then F07–F09 copy/empty states.
- Retest affected paths and close explicitly listed gaps before a full-clean claim. No deployment/PR/commit/push performed.

## Authorized follow-up — 2026-08-28

- F01–F09 implemented in the isolated QA worktree on `codex/main-local-qa-fixes`, commit `f9f2402d23a4770d3b8570905b7643d9afda1de8`. Also prevents issuing draft quotations before approval; no backend policy/schema/package/feature-flag changes.
- Develop PR: https://github.com/MangmeeDev/mangmeeplus/pull/329 merged at 2026-08-28T09:04:06Z after CI run33156817132 succeeded. Merge commit `f734a04373520860bc9a2cc599a1e0e351e5c615`; its tree matches the locally tested fix commit exactly.
- Main PR: https://github.com/MangmeeDev/mangmeeplus/pull/330, OPEN, develop → main, mergeable; its independent CI queued/starting at handoff. Main remains `0d96b01973ac465ee91d48f8c85dd51d71ef4b5c`. No main merge or deployment.
- Full web1213tests/256suites, full API pretest+test, both typechecks and production web build passed. New real browser cases and SQL checks recorded in the follow-up report.
- Export gap closed for XLSX parsing/amounts/rendering and JSON manifest parsing; signed attachment downloads themselves not verified.
- Follow-up evidence: `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-main-qa-20260828/docs/evidence/main-local-qa-fixes-2026-08-28/README.md` (23 screenshots and navigation JSON); follow-up memory in the same worktree's `docs/agent-memory/main-local-qa-fixes-2026-08-28.md`.
- Explicit remaining limits: real integrations, Staff legal acceptance, final activation/password/deletion/certification/signatures and untested permutations. Later role retest was interrupted by a tab crash then browser URL-policy refusal; stopped without bypass. Not all initial mutation scenarios were repeated; no universal all-flows pass claimed.
- Original `plan` worktree's unrelated user changes remain untouched.
