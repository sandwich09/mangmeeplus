# Agent Memory: mangmee-advisor-fx15

Status: complete — implementation and local verification; baseline failures reproduced
Owner: Fix-up 15, 2026-10-16
Scope: H1 how-to/action bridge; H2 reimbursement from words; H3 button choices and truthful list references.
Decisions:
- Implement docs/specs/mangmee-advisor-fixup-15-spec.md with the existing metered intake and turn. Nineteen server-owned action entries cover all fourteen advertised capability groups; permission, entitlement and offered-tool checks govern each offer, and API delivery checks access again.
- Preserve reviewed guide sources as secondary links. New metadata is navigation only; no model can confirm a financial write.
- Reuse company categories through PrismaExpenseRepository, LineReimbursementDraftService and existing reimbursement use-cases. Bind yesterday through its deterministic day-period candidate. Validate each new fragment against its own evidence; retain already-verified historical fields across button turns.
- Offer eligible matching bills (four plus new), receipt upload/no receipt, category buttons with the suggested category first, existing draft confirm and permission-checked submit continuation. Receipt capture continues the claim before expense confirmation. Existing evidence, payout, approver, tenant/branch and source-state guards remain authoritative.
- Payout-account setup has no supported LINE action; its existing web flow remains authoritative. Substitute-receipt certification, signing, approval and preview remain on the web.
- Replace numbered choice instructions in claim, media, file, company and recent-record replies with buttons; keep the thirteen-item quick-reply bound.
- No package.json edits, dependencies, new flags, budget/final-mutation policy changes, commits or live operations. `.live/J7/` is local evidence only and is not part of the change.
Open questions: none about product rules. Live LINE/provider/browser/database acceptance was not run in this network/Docker-restricted sandbox.
Artifacts:
- docs/specs/mangmee-advisor-fixup-15-spec.md
- /private/tmp/fx15-changed-files.json; /private/tmp/fx15-api-importer-files.json
- /private/tmp/fx15-baseline-comparison.json; /private/tmp/fixup-15-last-message.md
Verification:
- `pnpm --filter @watchdog-bms/contracts build`: passed before API/gateway typechecks.
- Package scripts are expanded unchanged, replacing the forbidden tsx CLI with `pnpm --filter <pkg> exec node --import tsx --test --test-concurrency=4 <script file list>`; TAP replaces the dot reporter for counts. API pretest is included.
- Contracts full: 440 passed, zero failed.
- Gateway full: 1,726 passed, zero failed, 46 cancelled by the sandbox socket restriction; identical 46 cancellations on archived base 84e597fe019eaf1c6fb149a7d70107a21ed1d6c7 (`listen EPERM 0.0.0.0`).
- API typecheck and gateway typecheck scripts: passed. API final full: 11,233 passed, 175 skipped, 2 baseline HTTP/socket failures out of 11,410 tests; API pretest: 16 passed, 128 skipped, zero failed. Final log: /private/tmp/fx15-api-test-finished.log.
- All 39 directly importing API specs plus required DI/delivery checks: 2,152 passed, 128 skipped, 37 failures. All 37 names and error messages match the exact archived base; zero new failures.
- Baseline failures: line-public-general (4), process-line-general-v2 (27), process-line-mixed-business-v2 (4), line-reply.adapter (2). The first 35 are existing incomplete test fixtures; the last two cannot bind 127.0.0.1 in the sandbox.
- Registered regressions: contracts feature-entitlements × capability/permission table; gateway intent-router/orchestrator help and two-round J7 proof binding; API process-line-webhook exact J7 turns, multi-turn claim through the real draft use-case, source matching, invalid-proof rejection, receipt continuation, submit access, owner-bound receipt locator and button delivery/fallback table.
- Real Nest module DI plus table-driven delivery-plan specs: 32 passed, zero failed. H3 focused registered suites and file-choice table: 969 passed, zero failed. `git diff --check`: passed; no package.json changes.
Next: review the uncommitted diff and /private/tmp/fixup-15-last-message.md (29 lines); run live acceptance in the connected environment. No local implementation work remains.
