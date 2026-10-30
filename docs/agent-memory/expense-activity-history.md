# Agent Memory: expense-activity-history

Status: Integrated into origin/main and origin/develop by atomic fast-forward push (2026-10-30); no PR and no deployment.
Owner: Parent reviewer; Luna frontend; Sol backend.
Scope: Expense detail → เพิ่มเติม → ดูประวัติ; who/what/when and recorded field changes.
Decisions:
- Follow `../specs/expense-activity-history-spec.md` and `../plans/expense-activity-history-plan.md`.
- Prior premature changes were fully removed before approval. This is the approved implementation.
- Preserve unrelated dirty-tree changes; task-start copies are in `/tmp/expense-activity-history-baseline`.
- Ponytail full: existing audit, permissions, modal, API and date helpers; no dependencies/migrations/package.json edits.
Open questions: None.
Completed revision: User approved replacing repeated value cards with one change table per save (`ข้อมูล | ก่อนแก้ไข | หลังแก้ไข`), creator in modal title, actor/action together, automatic activities omitted from the user-facing feed before pagination. Durable audit stays intact.
Artifacts:
- `ExpenseHistoryModal.tsx`, `expense-history.logic.ts`, detail header menu and API adapter.
- Shared `ExpenseHistoryResult` contract, `GetExpenseHistoryUseCase`, scoped repository query, existing WEB/LINE audit enrichment.
- `../evidence/expense-activity-history/desktop.png`, `mobile.png`, `browser-result.json`, `unsaved-edit-result.json`, backend/web test logs.
Implementation/review evidence:
- Document history reuses all detail access checks; company-scoped record/payment/substitute targets. Free-draft GET route allowlist also permits history, while the existing use case still rejects final records without financial access.
- Before/after snapshots run under existing expense locks, around the persisted header/line writes. Allowlisted fields include printed vendor identity, dates, document/tax status, notes, totals, line values and resolved company-scoped branch/category names. Line labels refer to displayed row numbers.
- Existing audit failure semantics preserved: generic WEB log remains post-commit; LINE transactional audits still roll back on failure and do not produce duplicate generic events.
- Parent review corrected emitted action labels, transient pagination retry, pagination end detection, disappearing-control focus/Escape, and fractional VAT/WHT display (0.07 → 7%).
- History opening does not save/discard unsaved form edits. Actor names are current linked user display names; absent names are explicitly unknown. No historical field values are synthesized. Existing audit text truncation marker remains visible for long text.
- Follow-up 2026-10-30: user requested no arrows. Luna replaced the value arrow with explicitly labeled `เดิม` and `ใหม่` cards, side by side on desktop and stacked on mobile; parent reviewed the component and screenshots.
Verification:
- Contracts build and API/web TypeScript checks: PASS.
- Backend focused suite: 120/120 PASS. Specs: `expense-draft-concurrency`, `expense-related-access`, `expense-branch-scope`, `line-draft-update.security`, `line-expense-draft-conversation`, `prisma-expense.repository.tax-snapshot`, `free-expense-access`.
- Web: `corepack pnpm exec tsx --test --test-reporter=spec src/features/expenses/expense-history.logic.spec.ts src/features/expenses/ExpenseReviewPage.qa.spec.ts src/features/expenses/expenses.api.spec.ts` from `apps/web`: 39/39 PASS.
- Actual Next expense route with local mock auth/API, Chromium 1440×1000 and 390×844: PASS for lazy fetch, loading, actor/action/Bangkok time, field diffs, failed events, load more/dedup, retry, forbidden/empty states, Escape/focus, close, narrow/long-content bounds, no mutation requests and no page errors. Separate editable-form check preserved an unsaved vendor-name edit and issued no save.
- `git diff --check` on task code: PASS. Task diffs compared with task-start copies to preserve unrelated edits.
- No local PostgreSQL service/client was available; database-backed full E2E was not run. Browser checks use fixtures; backend tests exercise permission/query/audit transaction behavior with test doubles.
- Luna accidentally invoked the broader web suite while targeting one test: reported 2089 pass and 2 failures in untouched `api-error-coverage.spec.ts`; these are outside this task and not claimed fixed. Scoped final suites above pass.
- Local QA servers stopped and Next's generated `next-env.d.ts` restored to its task-start contents after verification.
- No-arrow follow-up: six targeted browser checks PASS (old/new labels, no arrow, desktop columns, mobile stack, overflow and close); `value-labels-result.json` records the result and screenshots were refreshed. No logic/API changes or new unit tests for this presentation-only edit.
Next: Integration complete. Deployment is separate work and requires the repository deployment protocol.

## Compact-table revision review — 2026-10-30

- Luna replaced per-field value cards with one semantic table per event, using a single `ข้อมูล / ก่อนแก้ไข / หลังแก้ไข` header. Actor/action share a heading; each save shows a change count. Long cell values wrap on mobile.
- Creator appears in the modal title area after the history response succeeds, and clears on permission loss. Null names are explicitly unknown; loading and failed initial reads do not invent a creator.
- Parent inspected desktop/mobile screenshots and ran 17 browser checks (`table-browser-result.json`), including permission revocation during pagination and preserving unsaved expense edits. No mutation requests/page errors.
- Frontend follow-up checks: contracts build, web TypeScript, history formatter 4/4, scoped diff check all PASS.
- QA servers stopped; generated `next-env.d.ts` restored to its exact pre-revision contents.
- Sol returns `creatorDisplayName` from the authorized record’s creator via existing tenant membership lookup. Creator metadata is independent of event pagination and unknown names stay null.
- Human projection excludes SYSTEM/SERVICE, journey telemetry, OCR processing, tax-finalization/substitute-refresh follow-ons, and LINE initialization/state bookkeeping. Actual creation, user edits/LINE answers/confirmed AI edits, direct uploads and document actions stay visible. Automatic reimbursement confirmation/cancellation is identified by exact positive authority metadata; manually initiated events are retained.
- Parent review required scope IDs, automatic-event lookup, page and count in one RepeatableRead transaction to prevent an automatic event slipping into a page between reads. Original audits are never altered.
- Final backend revision check: `corepack pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/expenses/application/use-cases/expense-related-access.use-case.spec.ts src/modules/expenses/application/use-cases/expense-draft-concurrency.use-case.spec.ts` — 27/27 PASS. Log: `../evidence/expense-activity-history/human-projection-tests.log`. API TypeScript and contracts build PASS; final scoped diff check PASS.
- Revision code scope: one frontend modal, shared contract, expense read use case, history repository query, and existing access/query test file. No schema, dependency or package.json changes. Local fixture verification only; database-backed end-to-end test still unavailable.
- Current screenshots show the approved table layout. Ready for user review; no deployment performed.

## Direct branch integration — 2026-10-30

- User explicitly requested merge to main and develop without PR.
- Both remote branches start at `994a55fa1`; original source checkout is far behind with unrelated local work. A clean managed worktree at current remote is used to port only this feature and preserve newer code.
- Worktree: `/Users/thawatchai/.codex/worktrees/expense-history-integration/mangmeeplus`; integration branch: `codex/expense-activity-history`.
- Sol adapts backend/contracts; Luna adapts frontend; parent reviews and verifies against the current base before atomic push. Original checkout is preserved.
- Current-base verification: frozen lockfile install, Prisma generation, contracts build, API/web TypeScript, history API tests19/19 and formatter tests4/4 passed. Browser18 checks passed on real Next route with local fixtures at390/1280 plus360/768/1536 layout and button sizes; screenshots reviewed.
- Current broader backend checks retain19 unrelated commercial-access fixture failures:12 reviewer/disbursement cases reproduced with the original HEAD spec, and7 VAT-decision cases whose complete caller chain/spec were verified byte-identical to HEAD. Logs are under `docs/evidence/expense-activity-history/integration-*`. No unrelated fixture patches were introduced.
- Newer category/security/VAT/correction changes preserved. Web uses existing shared button classes, current action vocabulary and monetary formatting. No package/schema/lock changes; no PR or deploy dispatch.
- Temporary QA services stopped; generated web metadata restored. Parent reviewed scoped diffs before commit.
- Final current-base frontend suite (`expense-history.logic`, `ExpenseReviewPage.qa`, `expenses.api`) passed; full output saved as `integration-web-tests.log`.
- Atomic push succeeded to both `origin/main` and `origin/develop`, advancing from `994a55fa1` to feature commit `1fbba874e`. Both remote refs independently verified with `git ls-remote`. This documentation commit records the completed integration. Frontend current-base suite:54/54 PASS.
