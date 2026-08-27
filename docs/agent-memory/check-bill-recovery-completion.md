# Agent Memory: Check-bill recovery completion

Status: implementation and focused verification complete; latest-develop integration pending, 2026-08-27.
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

Next: commit scoped files; merge latest origin/develop, preserve sibling dictionary/error keys and password test wiring, rerun affected checks, then ordinary non-force atomic feature/develop push and remote containment verification. No deployment.
