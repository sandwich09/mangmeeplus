# Agent Memory: reimbursement payout review fixes (hub list, void against a bank match, and neighbours)

Status: implemented on `claude/reimb-payout-hub-bank-fixes-20261001`, cut from the payout assembly `1d3a6dc16`. Not pushed, no PR. One commit per finding. A sibling lane builds the pay step (payment form, `recordPaymentAtomic`, the pay-step part of `ReimbursementDetailSections.tsx`, the quick-pay dialog rule) from the same commit; none of that was touched here.

Owner: Claude, hub and bank lane. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: ten review findings on the payout program (spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §12.8, §13.3, §18.1, §25.1). The program's own memory is `reimbursement-recipient-bank-account.md`; Phase 0 keeps `reimbursement-payout-phase0-ui-fixes.md`, Phase 2 keeps `reimbursement-payout-phase2-payment-slip.md`. Lines in those two that this lane changed carry a pointer to this file.

## Decisions

- **Voiding a bank-matched payment undoes the match.** The void refused and sent the user to the bank screen, which lists only unmatched, suggested and partly matched lines, so a fully matched payment could not be voided at all. The void now sets the confirmed match to VOIDED and derives the line's status again (`calculateStatementLineMatchStatus`, the banking module's rule), in its own transaction, and writes a `bank.match.void` audit row beside its own. It refuses only a line inside a COMPLETED reconciliation (`reimbursement_payment_bank_reconciled`). No bank permission is asked for: the void right is enough (recorded in `permission-matrix.md`).
- **The bank confirm is one serializable transaction.** It reads a claim payment under the lock the void takes and needs it RECORDED, then writes the match and the line's status together. The lock alone is not enough: both sides are serializable, so the one that read the other's past is rolled back by PostgreSQL and runs again. A confirm in a read-committed transaction fails both race tests, lock or no lock.
- **A back-fill grants a key to a role once** (owner decision). The sync reads its own earlier audit rows for the key in the granting transaction and skips a role that has one. It applies to every entry of `COMPANY_ROLE_BACKFILLS`. Every universal key sits in a core pack, which the role editor adds back on each save, and the editor keeps raw keys it cannot match to a pack, so a save does not drop a back-filled key by accident.
- **With a search, the hub's cards and chips count what the search found.** The search narrows the one predicate that the page and the counts both read, so the number on a card is the rows its filter returns, with a search and without one. The line above the list says so.
- **What the hub search finds:** every word typed is in the claim's number, requester name, reason or category, or is its amount. Status is left to the chips. This is `hubSearchWhere`, used by the hub list only; the LINE draft picker keeps the narrower search it had.
- **A hub list that changed between two pages is read again from page 1**, three times at most for one list.
- **One open reminder task per rule and record for a scan.** The guard is in the shared task action, so it covers every scan template, not only the approval reminder. An event-triggered task is unchanged.
- **The LINE receipt picker leaves payment slips out** with a query written as "no slip link, and no slip tag or another tag". A plain NOT over the JSON path drops every file that has no metadata.

## Open questions

- The bank matching screen still lists no fully matched line. A wrong full match against any other source (an expense, supplier or customer payment) cannot be undone from the product. Not in this list of findings.
- After a void that undid a bank match, nothing on the claim page says so. The dialog and its messages belong to the pay-step lane.
- `eligibleClaimSignatureRoles` (API) and `eligibleSignatureRoles` (web) take the latest approved step of any round as the form's approver, while `isReimbursementClaimApprover` takes this round's. After a correction and a resubmission that needs no approval the two name different people.
- The LINE picker still offers files tagged for other purposes (a claim signature image, for one) as receipts.
- `VoidMatchUseCase` and `IgnoreStatementLineUseCase` still write the line's status outside a transaction.
- A reconciliation's difference is set when it is created (closing minus opening) and never recalculated, and completing needs it to be zero. Read in the code, not run.
- `line-reimbursement-draft-adapter.pg.spec.ts` accepts only `127.0.0.1:15439/watchdog_bms_ai_reliability_20260927`, while Extended Tests hands it `…:5432/watchdog_postmark_ci`.

## Artifacts

- API: `prisma-reimbursement.repository.ts` (`voidPaymentTrueReversal`, `hubSearchWhere`, `listRequestPage`), `reimbursement-request.use-case.ts` (bucket check, search), `reimbursement.controller.ts` (`search`), `prisma-banking.repository.ts` (`createMatch`), `matching.use-case.ts`, `prisma/sync-permissions.ts`, `company-role-backfill.registry.ts`, `prisma-attachment.repository.ts` (`NOT_REIMBURSEMENT_PAYMENT_SLIP_WHERE`), `line-reimbursement-draft-adapter.service.ts`, `workflow-action-runner.use-case.ts`, `prisma-workflow.repository.ts` (`findOpenTaskOfRuleForSource`).
- Web: `reimbursements.logic.ts` (`withHubPage`, `hubListStatusText`, `buildJourneySteps`), `reimbursements.api.ts`, `ReimbursementsPages.tsx` (`MyRequests` only), `common/api/api-error-message.ts`.
- Contracts: `ListReimbursementsFilter.search`, comments.
- CI: `.github/workflows/extended-tests.yml` (step "Reimbursement claim proofs against PostgreSQL").
- Docs: spec §12.8, §13.3, §18.1, AC28, I1; `permission-matrix.md`.
- New error codes with Thai text: `reimbursement_payment_bank_reconciled` (replaces `reimbursement_payment_bank_matched`), `bank_match_payment_not_recorded`, `bank_match_state_changed`, `reimbursement_list_bucket_invalid`.

## Verification

Every new test was run against the code before its fix and failed there. No new spec file: every API test sits in a file already named in `apps/api/package.json` (`test`, or `pretest` for the real-PostgreSQL file); web specs are picked up by the web package's glob.

Run on 2026-10-02 at the code head `fb523c518`:

- Typecheck by the package scripts: contracts, API (8 GB heap) and web all exit 0 with 0 errors. These three ran at `77ff853b4`; the one commit after it (the placeholder wording, web only) was checked with the native compiler: 0 errors.
- Web suite `pnpm --filter @watchdog-bms/web test` at `fb523c518`: 2344 pass, 0 fail.
- API specs run directly, 56 files (every reimbursement, banking and workflow spec, the ledger reversal spec, `sync-permissions.spec.ts`, the attachment specs, `spec-suite-coverage.spec.ts`, the LINE reimbursement and banking tool specs): 1057 pass, 0 fail.
- Real PostgreSQL 18.3 (throwaway container, removed afterwards): `REIMBURSEMENT_PG_GATE_REQUIRED=true … test:reimbursement-compatibility` 54 of 54, none skipped, eight runs in a row. The new CI step was rehearsed on a freshly created and migrated database: 54 of 54. With no database and the gate required it exits 1; without the flag every case skips.
- Real PostgreSQL probes, not committed: the back-fill granted once and respected a removal (an anchored key and a universal one); the JSON forms of "not a slip".
- `line-reimbursement-draft-adapter.pg.spec.ts` and `line-reimbursement-draft.pg.spec.ts` on a second throwaway container at port 15439: pass.
- W00 manifest parity: 4 of 4, no regeneration (no hashed file touched). `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0. Maintenance pins `--check`: current.
- Headless Chromium at 390 px, a replica of the status row's layout classes with the app's fonts, not the app page: the line above the list wraps to two lines with no horizontal overflow; the placeholder needs 248 px of the 265 the field leaves.
- Mutation checks: the bank confirm in a read-committed transaction fails both race tests; the plain NOT form of the slip query returns no file at all.

Not run: the full API suite, the API boot smoke, Playwright E2E, a browser pass of the real hub page, any AI model call.

## Next

- Coordinator: merge with the pay-step lane. Shared files: `prisma-reimbursement.repository.ts`, `prisma-reimbursement.repository.draft-submit-race.spec.ts`, `reimbursements.logic.ts` and its spec, `ReimbursementsPages.tsx`, `api-error-message.ts`, `packages/contracts/src/reimbursements.ts`.
- `extended-tests.yml` changed; the release process compares workflow files between develop and main.
- Release note: a void now undoes the payment's bank match; a back-fill is granted once; the hub search runs on the server and no longer matches status words; a scan creates one open task per record.
