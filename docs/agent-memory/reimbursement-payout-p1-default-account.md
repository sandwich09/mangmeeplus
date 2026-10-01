# Agent Memory: Reimbursement payout Phase 1 part A (default account, claim snapshot, attestation, masking)

Status: Implemented on branch `claude/reimb-payout-p1-default-account-20261001` (base `219c2369`), with the security-review fixes of 2026-10-01 on top (M1, S1 to S7 and three nits; see "Security review" below). Not pushed, no PR. Part B (pay step) not started.

Owner: Claude (lane P1), for the payout coordinator. Spec and plan: `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md`, `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md` (docs worktree commit `2909024b`). Impact audit: payout-impact-audit-20261001 (coordinator scratchpad).

Scope: member default payout account; the claim's own account snapshot frozen at submit; "ตรวจบัญชีแล้ว" at approval; masking and the audited reveal; the notice to an account owner when someone else sets their account. Not in scope: showing the account at the pay step, the payer's confirmation, `PaymentForm`, the payment-record use case and contract, the printed form (Phase 4), send-back for an account fix (Phase 3).

Decisions:

- Product
  - A claim follows the REQUESTER's default account until it is sent. The claim page shows the account that will be frozen, and the submit is bound to what was shown: the detail of a draft carries `payout.submitToken`, the submit sends it back, and every claim paid into an account (the default, or one typed into the claim) or following the default is refused (`payout_destination_changed`, 409) when no token is sent or the account changed since. Only cash the draft itself chose needs no token. The list row of any draft that is not such cash opens the claim page instead of submitting.
  - Humans verify. A claim paid by transfer is approved only with `payoutVerifiedVersion` equal to the claim's own snapshot version. Cash and legacy claims take none. An approval must also name the claim hash it saw (queue rows now carry it); one that names none is refused as stale.
  - Everyone sees bank, account name and last 4 digits. The full number leaves only through two audited POSTs: the member's own default (`payout-accounts/me/reveal`) and a claim's snapshot (`:requestId/payout-destination/reveal`), the latter for the requester, that claim's approver and whoever may record its payment.
  - Whose account an editor may set: an owner or admin any employee's; any other holder of `access.employee.update` only members who do not manage people themselves and only inside the editor's branches. A member's own account is theirs to set from any screen. The business owner has no employee record, so only the owner sets the owner's.
  - Nobody sets the account of a member who is not ACTIVE, the owner included (`payout_account_member_not_active`, 409): the notice reaches active members only. The same holds for an account typed into a claim filed for someone. The employee page shows the payout card only for an active employee.
  - "Owner or admin" is the product's own OWNER or ADMIN role, looked up on the member (`holdsSystemOwnerOrAdminRole`), never the role key. A custom role named "Admin" carries the key ADMIN too. So does the copy a company gets when it edits the Admin role (company scope, same key, not a system role): the two are stored alike and cannot be told apart, so such admins are held to the rule for everyone else and the owner keeps the unrestricted path. Needs an owner decision if edited-Admin companies should get the admin path back (it takes a marker on the role row).
  - The notice to the account owner is `critical` (not held by quiet hours; a failed push is recorded), always delivered (a preference list saved earlier cannot drop it; LINE switched off is respected), one per change, and written in the same transaction as the change.
  - A notice goes only to the person it concerns (owner rule 2026-10-01): the account owner, or the requester. Never the shop owner or other role holders.
  - When someone else types the account on a claim filed for the requester, the requester gets the same kind of notice (who, when, last 4 digits, link to the claim), with the draft save. Cash and "follow the default" type no account and tell nobody.
  - The approver is told who entered the account whenever it was not the requester: the typist of a per-claim account, or whoever last set the default the claim copied ("ใช้บัญชีประจำของผู้เบิก ซึ่งตั้งโดย …"). When the name can no longer be resolved the page says "กรอกโดยผู้จัดทำ" / "ตั้งโดยผู้อื่น".
  - The requester is told on a sent, unpaid claim when their default is no longer the account the claim copied (spec §22 row 1), and how to change it: the withdraw button while it is theirs to take back, otherwise tell the approver or the payer.
- Architecture
  - Tables: `MemberPayoutAccount` (composite FK to `CompanyMembership(companyId, userId)`, cascade on delete and update) and `ReimbursementPayoutDestination` (one row per claim and version; a trigger makes a frozen row immutable except the attestation columns). Request columns `payoutMethod`, `payoutDestinationVersion`, `payoutFingerprint`.
  - "Has a payout snapshot" is decided by `payoutFingerprint`, the one value only the payout-aware submit writes (cash gets the marker `cash`), never by the method a draft chose. A claim sent before the field existed, or by an older build during a rollback, is legacy for the hash, the display, the attestation and the reveal alike.
  - One builder, `claimSnapshotFields`, feeds the hash at submit, at the live approval check, for the signature acknowledgement and in the production A5 gate. Golden literals for a legacy claim were committed before the hash edit (`4752c48ca`).
  - The payout side of a submit runs wholly inside `submitDraftAtomic`: lock the default row, plan, check the token, freeze, then hash. Payout refusals on submit and approve are 409 so a stale browser tab reads "load the latest".
  - The number is sealed in one place (`sealPayoutDestination`): ciphertext (AES-256-GCM, `CREDENTIAL_ENCRYPTION_KEY`), last 4 and a keyed fingerprint from the same digit string.
  - `ReimbursementPayoutDestination.createdByUserId` is who ENTERED the account: the typist, or for a copy of the default whoever last set that default (not who pressed send; the submitter is on the claim). Not part of the claim hash; the golden literals are untouched.
  - A second, additive migration (`20261001110000_reimbursement_payout_snapshot_delete_guard`) refuses deleting a frozen snapshot while its claim exists. The cascade still removes snapshots with their claim or company.
  - The detail carries `payout.enteredByUserId` (with `enteredByName` when resolvable) and, for the requester only, `payout.defaultAccountChanged` (a fingerprint comparison made on the server; no fingerprint is exposed).
  - The per-claim notice reuses the trigger key `reimbursement.payout_account_set_by_other` (source type `reimbursement_request`), so no trigger registration changed.
  - Employee update (`update-employee.use-case.ts`): a branch-limited editor changes the scope only of an employee whose CURRENT branches are all inside the editor's. A draft nobody has scoped yet (the column default the create wizard narrows in its next call) is the one exception. Both employee pages already lock the branch picker for such an employee.
- Deliberately not done
  - Cash stays cash after a claim returns to draft (no row says whether it followed a cash default).
  - The hub banner that counts drafts not ready to send still counts receipt and date blockers only.
  - The account-number guard (`looksLikeAccountNumber`, one function) covers the finance note, the bank name and the account name. It is a heuristic for what people type by accident: 6 digits in a row, or 10 digits in groups joined by spaces, dashes, dots or slashes, Thai digits included. It lets through the product's own document numbers and one plain number of up to 9 digits said to be baht. A date next to a time ("01-10-2569 09:30") is still refused, as before.
  - The default-changed hint covers claims that copied a default ACCOUNT. A cash claim gets none (no row says whether it followed a cash default), and a removed default is not treated as a change.
  - A claim sent again with the same account keeps its frozen version and with it the first "entered by", also when someone else re-saved the identical account in between.
  - A branch-limited editor may still edit the profile (not the scope) of an employee of another branch; only scope changes were in question.
  - Log and audit key-name redaction patterns were not widened: the log pattern lives in a W00-hashed file, the audit pattern is shared by every module, and no payout path hands the number to either.

Open questions:

- Owner or legal: add the two tables to the ROPA, the retention register, the data-rights runbook and the public privacy notice (`docs/security-evidence/ropa-register-v1.md`, `docs/security-evidence/data-retention-deletion-register-v1.md`, `docs/runbooks/user-company-data-rights.md`, `apps/web/app/privacy/page.tsx`). No code enumerates personal-data tables; both tables cascade with their parents.
- Owner: in a company that edited its Admin role, admins no longer set the payout account of members who manage people (see Decisions). Keep, or mark edited copies of the Admin role so they count?
- Release: `CREDENTIAL_ENCRYPTION_KEY` must exist on every environment before the first write; deploy the API before the web.

Artifacts:

- Migration `apps/api/prisma/migrations/20261001100000_reimbursement_payout_account/` (additive).
- API: `apps/api/src/modules/reimbursements/domain/logic/payout-destination.logic.ts`, `infrastructure/reimbursement-payout.ts` (+ `.fixture.ts` for specs), `application/use-cases/reimbursement-payout.use-case.ts`, `reimbursement-payout-reveal.use-case.ts`, `presentation/http/reimbursement-payout.controller.ts`.
- Web: `apps/web/src/features/reimbursements/ReimbursementPayout.tsx`, `ReimbursementPayoutAccountPage.tsx`, `reimbursement-payout.logic.ts`, `reimbursement-payout.api.ts`, route `reimbursements/payout-account`.
- Second migration `apps/api/prisma/migrations/20261001110000_reimbursement_payout_snapshot_delete_guard/` (additive: one function, one trigger).
- Touched outside the module: `account-merge.use-case.ts` (carries "who last set it"), `notification.model.ts` and `notification.use-cases.ts` (trigger key, always-delivered list), `production-a5-evidence.pg.ts` (hash builder), `body-validation-coverage.spec.ts` (148 to 147), `sales-console.logic.ts` (bank list re-export only), `api-error-message.ts` (Thai text for the new codes), `employee-access/.../update-employee.use-case.ts` (current-scope rule, security review S3), `AddEmployeePrototypePage.tsx` (payout card for active employees only).

Security review (2026-10-01, after `a7e24d03f`; one commit per finding):

- M1 `5a47188d6`: the account owner's notice was written for nobody when the member was not ACTIVE. Refused for everyone; the card is hidden for a non-active employee.
- S2 `bafe9b26d`, `6a808e866`: token for every transfer plan; list rows open the claim page; requester notice for an account typed by someone else (to the requester alone, one per save); mode and source on the draft audit rows; "กรอกโดยผู้จัดทำ" fallback.
- S3 `c2407fd8c`: employee update checks the scope the employee holds now, not only the result.
- S6 `c633dbf30`: owner or admin by the system role.
- S1 `c54863b8b`: who set the default is frozen with the copy and shown to the approver.
- S4 `ac0a1612a`, S5 `027fa4ee8`: the account-number guard on the two name fields; document numbers and amounts pass, dots, slashes, several spaces and Thai digits are caught.
- S7 `382c4caaa`: hint for the requester when their default changed after the claim was sent.
- Nits `822f475d3` (no delete of a frozen snapshot), `c221c346f` (reveal state), `d89130caa` (save-as-default box follows the server).
- Not done: checking the notice INSIDE the transaction. The member's status is read before the write, so a member who stops being active in between still gets a change without a notice. A patch that makes the transaction fail when its notice reached nobody is drafted but not applied.

Verification (2026-10-01, on the branch head):

- API registered suite, run as CI runs it (no database): 10,759 passed, 0 failed. Web suite: 2,239 passed, 0 failed.
- Real PostgreSQL on a throwaway `postgres:18.3-alpine`, `REIMBURSEMENT_PG_GATE_REQUIRED=true`: `production-a5-reimbursement-compatibility.pg.spec.ts` and `prisma-reimbursement.repository.draft-submit-race.spec.ts`, 32 passed, none skipped (16 existing, 13 payout, 3 compatibility). These do not run in CI: rerun them by hand when this code changes.
- The two LINE claim-draft pg specs on a second throwaway database at their fixed port 15439: 2 passed.
- Typecheck api and web (TypeScript native, as CI), other packages' typecheck, `prisma validate`, migration deploy on an empty database, boot DI smoke, DI metadata check, LINE AI whole-chain acceptance (12 suites), W00 manifest parity (no hashed file changed, nothing regenerated): all pass.
- Mutation checks: eleven guards were removed one at a time (submit token, approve without hash, legacy by method, hash keyed on method, peer rule, branch rule, always-delivered notice, grouped digits, nested redaction, merge attribution, notice period); each made a spec fail.
- Real HTTP: the built API against a seeded throwaway database, 15 steps as six seeded roles (own account, show before freeze, manager edit and its refusals, frozen snapshot, list and queue rows, approval with hash and attestation, reveal groups with audit rows, cash claim, finance note guard). The stored audit rows, notification texts and event payloads held no account number.
- Not run: Playwright e2e (the two claim helpers now choose cash so their flows still submit) and a browser pass at 390 px.

Next: part B (pay step shows the claim's snapshot through `findClaimPayout` and `claimPayoutRevealGroup`; the payer's confirmation checks version and fingerprint under the payment lock; a legacy claim shows the member's current default with a label; export last 4). Phase 4 print uses the same reveal group.

## Merged into the payout assembly (2026-10-01)

Merged into `claude/reimb-payout-assembly-20261001` at `565b1727f` (assembly `ebe0bb988`: Phase 0, Phase 2, their follow-ups, the claim notification fixes and the claim payout posting; lane `503b2d85e`). The memory update `526a39f76` followed at `359b0ef0a`. Not pushed, no PR.

Twelve content conflicts, both sides kept, no test dropped:

- Contracts: an approval queue row carries `approvalActions` (assembly) and `approvalSnapshotHash` (this lane).
- `reimbursement.mapper.ts`: `detailWithFileNames` keeps the required viewer and the slip facts, and adds the claim's masked payout snapshot.
- Approval use case: queue rows come from `pendingApprovalActions` and name the claim hash the row showed.
- Request use case: GET detail keeps `paymentDesk` and adds the draft's default account, the submit token, the default-changed hint and `canRevealAccountNumber`.
- Repository, controller, DTOs and the four specs: import unions.
- Hub page: the queue's approve button shows only where `approvalActions` allows it, and reads "ตรวจบัญชีและอนุมัติ" for a transfer claim.

Six specs failed after the merge on fake repositories only (each side's detail and list paths now read through the other's repository calls); the fakes were completed and no assertion changed.

What changed for this lane's own decisions:

- `isEffectiveClaimApprover` is gone. The one definition of a claim's own approver is `isReimbursementClaimApprover` in contracts; `claimPayoutRevealGroup` asks it, with whoever may decide the pending step. `payoutRevealGroup` keeps its own conditions (there is an account, a draft is its requester's alone, branch scope, a payer must be able to read the claim). The payment reminder's query (`findClaimApprovers`) cannot call the rule: its round test now matches it exactly (no submission in force, no approver), and the three places point at each other. The approver a ready-to-pay notice asks after finance (`claimApproverUserId`, from the notification review fixes) asks the same rule since `6a203e826`; before, it took the latest approval of any round.
- `ALWAYS_DELIVERED_TRIGGER_KEYS` also holds `workflow.reimbursement_payment_voided` and `workflow.reimbursement_payment_sla_breach`. The spec pins the whole list.
- The hub list the assembly rewrote (paged, lazy) carries `payoutMethod` on its rows, so the row rule (`draftRowSubmitsFromItsPage`) holds on it unchanged.
- The permission matrix (`docs/specs/permission-matrix.md` §5.6) has the payout routes, who may set someone else's account and who may see a full number.
- The approved help pack's pin on the claim guide did not move: the merge does not touch that file.

Checks added where the two sides meet (all in spec files already registered): the reveal, its flag and the slip rule asked about the same viewers; the reminder's approver against the contracts rule; a transfer claim's queue row (API and rendered); the paged list row and the hub's send button; the payment form and the claim page for a claim with a frozen account; one submit that freezes the account and names the would-be approvers; one detail read as eight readers for the two viewer flags; the two payment notices past a saved preference list.

Noticed and left alone:

- An approver of the claim's current round who has lost every way to read the claim is refused the claim detail and the slip (their read gate comes first) and is still answered by the reveal endpoint, which asks for branch scope only. Spec §11.1 asks "can read the claim" of the payer alone. Needs a decision if the reveal should have the same gate.
- The audit rows of a payment and of a slip opening carry the slip's attachment id (the slip lane's decision). An audit reader outside the slip group learns that id; no route serves the file to them.
- Part B is unchanged: the payment form does not show the claim's account or start from its method, the export carries nothing of the account, and the printed form does not print it.

The notification lane's review fixes (`claude/claim-notification-fixes-20261001` at `23da6998e`, built on this assembly at `6711ebf1c`) were merged after it at `7bbcbed77`. One conflict, in that lane's memory note; both texts kept.

Verification of the merge is in its hand-off report (unit suites, the real PostgreSQL gate, the 17-step CI-equivalent run). Not run: Playwright e2e (the merged spec files type-check), a browser pass at 390 px, live HTTP.
