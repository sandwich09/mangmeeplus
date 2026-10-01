# Agent Memory: Reimbursement payout Phase 1 part A (default account, claim snapshot, attestation, masking)

Status: Implemented on branch `claude/reimb-payout-p1-default-account-20261001` (base `219c2369`). Not pushed, no PR. Part B (pay step) not started.

Owner: Claude (lane P1), for the payout coordinator. Spec and plan: `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md`, `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md` (docs worktree commit `2909024b`). Impact audit: payout-impact-audit-20261001 (coordinator scratchpad).

Scope: member default payout account; the claim's own account snapshot frozen at submit; "ตรวจบัญชีแล้ว" at approval; masking and the audited reveal; the notice to an account owner when someone else sets their account. Not in scope: showing the account at the pay step, the payer's confirmation, `PaymentForm`, the payment-record use case and contract, the printed form (Phase 4), send-back for an account fix (Phase 3).

Decisions:

- Product
  - A claim follows the REQUESTER's default account until it is sent. The claim page shows the account that will be frozen, and the submit is bound to what was shown: the detail of a draft carries `payout.submitToken`, the submit sends it back, and a claim whose account comes from the default is refused (`payout_destination_changed`, 409) when no token is sent or the default changed since. A list row that follows the default opens the claim page instead of submitting.
  - Humans verify. A claim paid by transfer is approved only with `payoutVerifiedVersion` equal to the claim's own snapshot version. Cash and legacy claims take none. An approval must also name the claim hash it saw (queue rows now carry it); one that names none is refused as stale.
  - Everyone sees bank, account name and last 4 digits. The full number leaves only through two audited POSTs: the member's own default (`payout-accounts/me/reveal`) and a claim's snapshot (`:requestId/payout-destination/reveal`), the latter for the requester, that claim's approver and whoever may record its payment.
  - Whose account an editor may set: an owner or admin any employee's; any other holder of `access.employee.update` only members who do not manage people themselves and only inside the editor's branches. A member's own account is theirs to set from any screen. The business owner has no employee record, so only the owner sets the owner's.
  - The notice to the account owner is `critical` (not held by quiet hours; a failed push is recorded), always delivered (a preference list saved earlier cannot drop it; LINE switched off is respected), one per change, and written in the same transaction as the change.
- Architecture
  - Tables: `MemberPayoutAccount` (composite FK to `CompanyMembership(companyId, userId)`, cascade on delete and update) and `ReimbursementPayoutDestination` (one row per claim and version; a trigger makes a frozen row immutable except the attestation columns). Request columns `payoutMethod`, `payoutDestinationVersion`, `payoutFingerprint`.
  - "Has a payout snapshot" is decided by `payoutFingerprint`, the one value only the payout-aware submit writes (cash gets the marker `cash`), never by the method a draft chose. A claim sent before the field existed, or by an older build during a rollback, is legacy for the hash, the display, the attestation and the reveal alike.
  - One builder, `claimSnapshotFields`, feeds the hash at submit, at the live approval check, for the signature acknowledgement and in the production A5 gate. Golden literals for a legacy claim were committed before the hash edit (`4752c48ca`).
  - The payout side of a submit runs wholly inside `submitDraftAtomic`: lock the default row, plan, check the token, freeze, then hash. Payout refusals on submit and approve are 409 so a stale browser tab reads "load the latest".
  - The number is sealed in one place (`sealPayoutDestination`): ciphertext (AES-256-GCM, `CREDENTIAL_ENCRYPTION_KEY`), last 4 and a keyed fingerprint from the same digit string.
- Deliberately not done
  - Cash stays cash after a claim returns to draft (no row says whether it followed a cash default).
  - The hub banner that counts drafts not ready to send still counts receipt and date blockers only.
  - No notice to the requester when a preparer types an account into one claim (audit §2.2); the approver sees "กรอกโดย …" and attests. Needs an owner decision.
  - The free-text account-number guard covers the finance note only (the one note copied into a notification). Grouped digits count from 10 up so a date such as `01-10-2569` still passes.
  - Log and audit key-name redaction patterns were not widened: the log pattern lives in a W00-hashed file, the audit pattern is shared by every module, and no payout path hands the number to either.

Open questions:

- Owner or legal: add the two tables to the ROPA, the retention register, the data-rights runbook and the public privacy notice (`docs/security-evidence/ropa-register-v1.md`, `docs/security-evidence/data-retention-deletion-register-v1.md`, `docs/runbooks/user-company-data-rights.md`, `apps/web/app/privacy/page.tsx`). No code enumerates personal-data tables; both tables cascade with their parents.
- Owner: should a requester be told when a preparer types an account into their claim?
- Release: `CREDENTIAL_ENCRYPTION_KEY` must exist on every environment before the first write; deploy the API before the web.

Artifacts:

- Migration `apps/api/prisma/migrations/20261001100000_reimbursement_payout_account/` (additive).
- API: `apps/api/src/modules/reimbursements/domain/logic/payout-destination.logic.ts`, `infrastructure/reimbursement-payout.ts` (+ `.fixture.ts` for specs), `application/use-cases/reimbursement-payout.use-case.ts`, `reimbursement-payout-reveal.use-case.ts`, `presentation/http/reimbursement-payout.controller.ts`.
- Web: `apps/web/src/features/reimbursements/ReimbursementPayout.tsx`, `ReimbursementPayoutAccountPage.tsx`, `reimbursement-payout.logic.ts`, `reimbursement-payout.api.ts`, route `reimbursements/payout-account`.
- Touched outside the module: `account-merge.use-case.ts` (carries "who last set it"), `notification.model.ts` and `notification.use-cases.ts` (trigger key, always-delivered list), `production-a5-evidence.pg.ts` (hash builder), `body-validation-coverage.spec.ts` (148 to 147), `sales-console.logic.ts` (bank list re-export only), `api-error-message.ts` (Thai text for the new codes).

Verification (2026-10-01, on the branch head):

- API registered suite, run as CI runs it (no database): 10,759 passed, 0 failed. Web suite: 2,239 passed, 0 failed.
- Real PostgreSQL on a throwaway `postgres:18.3-alpine`, `REIMBURSEMENT_PG_GATE_REQUIRED=true`: `production-a5-reimbursement-compatibility.pg.spec.ts` and `prisma-reimbursement.repository.draft-submit-race.spec.ts`, 32 passed, none skipped (16 existing, 13 payout, 3 compatibility). These do not run in CI: rerun them by hand when this code changes.
- The two LINE claim-draft pg specs on a second throwaway database at their fixed port 15439: 2 passed.
- Typecheck api and web (TypeScript native, as CI), other packages' typecheck, `prisma validate`, migration deploy on an empty database, boot DI smoke, DI metadata check, LINE AI whole-chain acceptance (12 suites), W00 manifest parity (no hashed file changed, nothing regenerated): all pass.
- Mutation checks: eleven guards were removed one at a time (submit token, approve without hash, legacy by method, hash keyed on method, peer rule, branch rule, always-delivered notice, grouped digits, nested redaction, merge attribution, notice period); each made a spec fail.
- Real HTTP: the built API against a seeded throwaway database, 15 steps as six seeded roles (own account, show before freeze, manager edit and its refusals, frozen snapshot, list and queue rows, approval with hash and attestation, reveal groups with audit rows, cash claim, finance note guard). The stored audit rows, notification texts and event payloads held no account number.
- Not run: Playwright e2e (the two claim helpers now choose cash so their flows still submit) and a browser pass at 390 px.

Next: part B (pay step shows the claim's snapshot through `findClaimPayout` and `claimPayoutRevealGroup`; the payer's confirmation checks version and fingerprint under the payment lock; a legacy claim shows the member's current default with a label; export last 4). Phase 4 print uses the same reveal group.
