# Agent Memory: Check-bill recovery completion

Status: implemented, verified and integrated into remote develop, 2026-08-27. No deployment.
Owner: delegated implementation agent.
Scope: complete same-expense check-bill recovery, preparation routing, actionable failures and separate payment-proof enforcement; integrate develop, no deployment.
Decisions:

- Worktree `mangmeeplus-check-bill-recovery-completion`, branch `codex/check-bill-recovery-completion`, base `0b611f14e03ae407d6d210790b60c3ce3d883448` (PR312). Root review of main and current code agree; PR312 did not repair these gaps.
- AGENTS and ponytail FULL read completely; legacy skill path missing, repository skill used. Independent offline dependencies; never generate/build through shared dependency symlinks.
- Check bill describes items/amount due; it cannot prove the expense/payment alone. Preserve same expense/date/vendor/amount and original classification/attachment; no replacement Manual draft or auto-cancel.
- New preparation uses canonical wizard; existing PREPARED revision/history/signature/approval behavior remains. Finance correction can still repair actual misclassification for normal receipt review, but cannot waive raw check-bill substitute proof rules.
- Require separate actual payment evidence for every raw check bill (including CASH/permissive/no policy), derived from saved classification even with omitted/false route flag or existing routing/finance resolution. Ordinary cash policy unchanged.
- Reuse evidence purpose/ACTIVE/tenant/expense-link checks; source check bill cannot become its own proof. Keep permission/branch/revision/payer/approval/tax/atomic route boundaries. No historical certificate backfill or schema change.

Open questions: none; owner explicitly approved the check-bill-only cash exception override.
Artifacts: updated `docs/specs/expense-check-bill-guided-routing-spec.md` and `docs/plans/expense-check-bill-guided-routing-plan.md`.
Verification:

- Independent install: `corepack pnpm install --offline --ignore-scripts --frozen-lockfile`; owned contracts/config builds and owned API Prisma generation. No package.json, lockfile, schema, or shared generated-artifact change.
- Broad API substitute/LINE/status suites: 356 tests passed. Subsequent prepare/repository focused run: 46 passed, including the additional stale-check-bill zero-write/zero-number-allocation guard. Payment-method/policy matrix covers CASH/BANK_TRANSFER/CARD, absent/permissive/strict policy, finance and existing routing resolutions, false/omitted flags, active-linked purpose/MIME/source checks and ordinary cash behavior.
- Retained document/upload/branch/draft-concurrency/atomic-confirm suites: 107 passed. Attachment-retention suite: 3 passed. Repository query test verifies tenant, expense target, and ACTIVE predicates; original source/date/vendor/amount/attachment fields are never replaced by routing.
- Broad web expense/API/i18n/toast suites: 369 passed. Additional canonical-route/reload/selected-evidence wiring suite: 10 passed. Error mapping/coverage/no-raw-error/i18n gate: 20 passed. Existing PREPARED/sign/approve/history/download flows remain covered.
- Contract parity/payment-proof suite: 45 passed. Contracts/config builds and API/web no-emit typechecks passed before final integration; repeat after merge.
- Initial API suite-coverage gate identified the already-known upstream password test-registration gap, not a new test file from this task. Latest fetched develop `aa003846af101976c2554b6cad71840abcf4ef0d` includes the sibling fix; rerun after merge.
- Actual local Next/browser on ports4350/4351 with synthetic fixtures and the real `PrepareSubstituteReceiptUseCase` over an in-memory repository: raw check-bill guidance, ordinary unflagged deep link, reload/draft retention, cash-proof disabled primary action, same original check-bill attachment, and valid finance-override canonical link verified. A real prepare rejection from stale evidence produced the same actionable English toast and persistent inline error. Valid separate cash proof reached PREPARED/payer-signing without issuing or signing automatically.
- Browser persisted-state inspection: same `check-expense`, date `2026-08-23`, synthetic Grand Lobby Bar–DusitThani, `2883.65`, original source/classification/attachment retained; separate payment proof; SUPPORTING_ONLY/NON_CLAIMABLE and explicit route resolution. No duplicate expense. The synthetic fixture uses a simulated repository, not PostgreSQL; normal authenticated workspace navigation is not claimed.
- Mobile limitation: 390px iframe preview was refused by existing CSP. Did not weaken CSP, use a real account, or claim physical/mobile viewport verification. Desktop responsive components and actual workflow were inspected. Temporary fixture files were removed, browser tab closed, local servers stopped, and next-env generation reverted.

Integration:

- Implementation `32ed42f2909c3f06116a9a4e819476ea41c5e25c` merged with latest develop `aa003846af101976c2554b6cad71840abcf4ef0d` as `b601472ccc8c545bd065ee56f80a4a49e4d52782`, without conflicts. Retained employee draft deletion/error copy, password test wiring and branch-default changes.
- Repeated broad API substitute/LINE/status: **357/357 passed**; web expense/API/i18n/toast: **373/373 passed**; contract parity/payment proof: **45/45 passed**; API suite-registration gate: **3/3 passed**, no skips. Earlier retained-boundary runs add 107 document/upload/branch/concurrency/confirmation tests and 3 attachment-retention tests, all passing.
- Post-merge owned contracts/config builds and API/web no-emit typechecks passed. `git diff --check` passed. Diff against latest develop contains only this task's files; no package.json/schema/lockfile or temporary fixture changes.
- Shared API exception filter forwards coded HttpExceptions through Nest unchanged; the actual-use-case synthetic browser rejection and client-toast regression cover the server-body/client-rendering seam. Unknown API errors continue using the safe fallback.

Delivery:

- Ordinary atomic non-force push updated `codex/check-bill-recovery-completion` and `develop` together to `959b1e9586f6f60bac4cd9439a9009766001ca58` (implementation `32ed42f2`, integration `b601472c`, verification/copy `959b1e95`).
- Subsequent fetch reported both remote refs at that SHA. `git merge-base --is-ancestor 32ed42f2909c3f06116a9a4e819476ea41c5e25c origin/develop` exited0. No branch protection or required check was bypassed.
- This delivery-note-only follow-up changes no runtime code; final remote note SHA is included in the handoff. Worktree has no temporary fixture, generated-file, package.json, schema or dependency diff.

Next: no remaining implementation work. Other agents must fetch current develop before integration. Physical mobile viewport/authenticated full-workspace browser validation remains an explicitly recorded limitation, not a deployment claim.
