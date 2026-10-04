# Agent Memory: claim-self-approval-and-words-2026-10-04

Status: Lane implementation complete, uncommitted; focused and required locked checks pass. Controller real-database/browser verification pending.
Owner: Codex expense-claims lane; controller reviews and commits.
Scope: Claims self-approval switch, truthful shared words, duplicate-payment control. No procurement/substitute-receipt change, schema, migration, dependency, package manifest or cloud work.
Decisions:
- Owner 2026-10-04: self-approval switch applies to everyone. Existing submit-time solo exception and frozen assignments stay executable.
- Reuse the claims guard for routing, endpoints, queue/detail and locked repository writes.
- Self-approval refusal and both approval notes name the policy this claim uses, not today’s company switch.
- Self-approved document note states only the known fact; no invented policy reason for older claims.
- Duplicate payment already refused by shared validator in preflight and locked write, under the submitted claim policy. LINE contract has no claim payment tool and directs payments to web.
Open questions:
- Browser claim/payment and its frozen policy not checked: no network/browser/database in this lane. Controller must identify the snapshot and open candidates at payment time to explain the reported payment.
Artifacts:
- Specs: reimbursement-step-journey-spec-th.md, reimbursement-payout-account-and-payment-slip-spec-th.md, reimbursement-approver-routing-policy-spec.md.
Verification:
- Commands below run as `pnpm --filter @watchdog-bms/<api|web> exec node --import tsx --test --test-reporter=spec <package-relative path>`; no tsx CLI, servers, browser, network or database used.
- API `src/modules/reimbursements/application/use-cases/reimbursement-approval.use-case.spec.ts`: final old-production red exit 1, 96 pass/17 fail of 113; restored fix green exit 0, 113 pass initially; final retained unrelated-claim audit control: exit 0, 114 pass/0 fail. Independent tests exercise OWNER/ADMIN/MANAGER detail, queue, approve, reject off/on; frozen-route audit, self-account attestation, existing solo full journey.
- API `src/modules/reimbursements/application/use-cases/reimbursement-request.use-case.spec.ts`: red exit 1, 207 pass/6 fail of 213; green exit 0, 213 pass. Role/named routing off/on, peers, owner recovery, solo exception for each standard approver role.
- API `src/modules/reimbursements/domain/logic/claim-form.logic.spec.ts`: final old renderer red exit 1, 46 pass/2 fail of 48 (sentence and self-approved print digests); green exit 0, 48 pass.
- API `src/modules/reimbursements/application/use-cases/reimbursement-claim-form.use-case.spec.ts`: red exit 1, 38 pass/1 fail of 39; green exit 0, 39 pass.
- Web `src/features/reimbursements/reimbursements.model.spec.ts`: red exit 1, 31 pass/3 fail of 34; green exit 0, 34 pass (first signature, replacement, another actor's signature).
- Web `src/features/reimbursements/reimbursement-payout-correction.qa.spec.ts`: old production red exit 1, 131 pass/5 fail of 136; additional partial-self-signer red with `--test-name-pattern='asks a self-approver'`, exit 1, 0 pass/1 fail; green exit 0, 137 pass (both signers rendered, step names, self-approved fact, pay note, partial signer).
- Web `src/features/reimbursements/reimbursements.logic.spec.ts`: red exit 1, 115 pass/2 fail of 117; green exit 0, 117 pass.
- Web `src/features/reimbursements/ReimbursementPayout.qa.spec.ts`: red exit 1, 32 pass/2 fail of 34; green exit 0, 34 pass.
- Web `src/features/reimbursements/ReimbursementPages.plain-thai.qa.spec.ts`: red exit 1, 54 pass/2 fail of 56; green exit 0, 56 pass (mobile/table receiving method and policy wording).
- Web `src/features/user-guide/user-guide.content.spec.ts`: final old guide red exit 1, 31 pass/4 fail of 35; green exit 0, 35 pass (draft instructions, shared policy in three locations, signer labels, stale expectations updated). Additional policy-table-only red exit 1, 0 pass/1 fail before table correction.
- Final frozen-policy wording: old text red for logic spec exit 1, 115 pass/2 fail of 117; correction QA exit 1, 136 pass/1 fail of 137. Restored shared new wording green: exit 0, logic 117 pass and correction QA 137 pass.
- C is existing behavior, not a newly found/fixed API bypass: API finance spec baseline exit 0, 102 pass; payment-mirror spec baseline exit 0, 8 pass. Added submitted-policy/pre-reservation and locked duplicate/clear regressions. Deliberately disabling the existing shared duplicate refusal gave finance mutant-red exit 1, 100 pass/2 fail and payment-mirror mutant-red exit 1, 7 pass/1 fail; restored guard green exit 0, 102 and 8 pass. This is mutation evidence, not a claim that original production failed C.
- `pnpm --filter @watchdog-bms/contracts build`: exit 0 after adding the shared note.
- Old sentence/exact label scan across all API, ai-gateway, web specs and e2e found the focused specs above; no stale e2e expectation for those words. `e2e/reimbursements.spec.ts` read, not run (browser/server unavailable).
- Final API typecheck via heavy.sh after unused role reads removed: exit 0. Final web typecheck via heavy.sh: exit 0. Final whole web suite with all S3_* removed via heavy.sh: exit 0, 2976 pass/0 fail/0 skip (576 suites). Initial whole web run also passed 2974 tests before two final guide regressions were added.
- API additional focused checks: domain reimbursement.logic.spec.ts exit 0, 147 pass; approval-backlog spec exit 0, 10 pass; LINE erp-reimbursement-tools spec exit 0, 11 pass; capability manifest spec exit 0, 4 pass, no drift or regeneration.
- Production A5 evidence collector spec (a fake-client test despite its pg.spec.ts name): `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/scripts/production-a5-evidence.pg.spec.ts`, exit 0, 12 pass/0 fail/0 skip.
- Web reimbursements.api.spec.ts (stale refusal wording check): exit 0, 35 pass.
- `git diff --check`: exit 0 after final memory/doc review; no whitespace errors. Temporary verification logs removed from the worktree.
- All six modified API specs verified listed in apps/api/package.json test; manifests/protected paths unchanged.
- Relevant Next local client-component guide read per apps/web/AGENTS.md.
Next:
- Controller reviews the uncommitted diff, runs the real-database/browser checks below and commits. No lane git mutation performed.
- Controller: run CI's real PostgreSQL proofs with the configured dedicated database: `REIMBURSEMENT_PG_GATE_REQUIRED=true pnpm --filter @watchdog-bms/api run test:reimbursement-compatibility` (production-a5-reimbursement-compatibility.pg.spec.ts and prisma-reimbursement.repository.draft-submit-race.spec.ts), and `pnpm --filter @watchdog-bms/api exec tsx --test src/modules/ledger/application/use-cases/claim-payment-posting.pg.spec.ts` with CLAIM_PAYMENT_POSTING_TEST_DATABASE_URL. No new API spec files created. Run the full API package test suite through the heavy lock; the tsx CLI cannot run in this lane.
- Controller browser: owner/admin/manager with a peer, switch off/on; solo submit/approve; old frozen self-route; requester/approver first signing and replacement, partial self-signer; multiple pending names; cash/transfer/missing-method list actions; transfer slip+tick; BLOCK_PAYMENT open candidate refusal and audited clear then payment.
- Controller inspect the reported claim's submitted duplicate policy and candidates at payment time. No payment tool exists over LINE; the existing tool contract directs paying to web.
- Procurement still exempts OWNER/ADMIN/MANAGER via `canSelfApprove` and substitute receipts use that list for `OWNER_SELF`; intentionally unchanged.
