# Agent Memory: Reimbursement payout Phase 4.1 (the printed claim form)

Status: Implemented on branch `claude/reimb-payout-print-20261002`, cut from the pay step's trial merge with the payout assembly at `ae14805df`. Not pushed, no PR.

Owner: Claude (lane P4.1), for the payout coordinator. Push, PR, deploy and owner communication stay with the coordinator session.

Scope: spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §17.1 (the printed form), §11.1 and §11.2 (who sees the full number), §15 (legacy claims), §23 (AC36 and the print part of AC17), §25.1; plan Phase 4 task 4.1. What the claim already carries is in `reimbursement-payout-p1-default-account.md` (the frozen snapshot, the reveal group, the audit row before the decrypt) and `reimbursement-payout-p1b-pay-step.md` (a payment stores the account version it went into). Not in scope and untouched: the wording and the blank approver block of the account-correction round (it needs Phase 3), the claim page's history and the paid notice (4.2, 4.3), the user guide (4.5), the web (the print call still sends `{}` and reads the same three fields).

## Decisions

Product:

- **What the two-signer form gains.** Under the requester's name: "รับเงินคืนทาง: โอนเข้าบัญชี <ธนาคาร> ชื่อบัญชี … เลขบัญชี …", or "รับเงินคืนทาง: พร้อมเพย์เบอร์ … ชื่อบัญชี …", or "รับเงินคืนทาง: รับเป็นเงินสด". Under it, once someone attested the account: "ผู้ตรวจบัญชี … วันที่ …". The payment line gains "เข้าบัญชีลงท้าย 1234" for a transfer the payer confirmed into an account. The box "หลักฐานการชำระเงิน" is ticked when the latest standing payment has a slip (that part was already built with the slip; it is unchanged and now pinned beside the account lines).
- **Who gets the full number** is decided by the API for the person who asked for that print, with the function the "แสดงเลขบัญชี" command uses (`claimPayoutRevealGroup`): the requester, that claim's approver, whoever may record its payment. The web sends no option; the endpoint has no new field in or out. Everyone else who may open the claim gets "… เลขบัญชีลงท้าย 1234": not refused, no audit row.
- **The audit row** is the reveal's own: action `reimbursement.payout.reveal`, the same target, risk and facts (group, version, kind, bank, last 4), plus `channel: 'CLAIM_FORM_PRINT'`. It is written before the decrypt and is fail-closed (no row, no print). It is written only for a print that goes on to carry the number: the number is asked for after everything that can refuse the print (the read guard, a draft, a stored signature that cannot be read). A reader outside the group leaves no row at all, not a refusal row either: they were not refused.
- **The number is printed as stored**: digits only, no grouping, leading zeros kept. It is on the "รับเงินคืนทาง" line and nowhere else. The payment line carries the last 4 digits for every reader; the snapshot has no field that could hold more there.
- **No account line, so nothing asked**: a cash claim, a claim sent before claims carried an account, and the four-block form. They decrypt nothing and write no row. A legacy claim reads nothing of the payout tables and prints the bytes it printed before.
- **A legacy claim's payment line stays as it was**, also when its payment kept a copy of the requester's default account (spec §15). The claim page shows that copy on the payment row; the printed form of a legacy claim shows none of it, because that form is to stay unchanged letter for letter.
- **PromptPay on the payment line** reads "เข้าพร้อมเพย์เบอร์ลงท้าย 1234", the words the claim page's history uses. The spec's example ("เข้าบัญชีลงท้าย 1234") is the bank-account case.
- **The attestation line names whoever the account version records**, the requester included. For a requester who approved their own claim it reads "ผู้ตรวจบัญชี <ชื่อผู้เบิก> วันที่ …", one line under "ผู้ขอเบิก: <ชื่อเดียวกัน>", and the form's same-person note is at its foot. The claim page says "ผู้เบิกยืนยันบัญชีของตนเอง" for that case; the form does not have that sentence (see Open questions).
- **Layout.** The lines are body text (15 px, dark), wrapped at the sheet's text width, 22 px apart, and push the table down by their own height. On the A4 pages they are part of the header, so they repeat on every page with the document number and the requester. The signature row stays at the foot of the sheet. A number that does not fit the end of a line moves to the next line whole; it is never split.

Architecture:

- **The renderer does not know who asked.** `ClaimFormPayout` is a union by method; the transfer member has an optional `accountNumber`. Handed one, the renderer prints it; otherwise it prints the last 4 digits. The use case builds the snapshot with the last 4 digits and adds the number as the last step before rendering (`withAccountNumber`). The number lives in one local value on its way to the renderer. It is in no log line, audit field, event payload or field of the answer; the answer's shape is pinned (`svgDataUrl`, `pageSvgDataUrls`, `checksumSha256`).
- **One source.** The masked account and who attested it come from `findClaimPayout` (the claim's own version row), the number from `findClaimPayoutSecret` for that same version, the payment line's last 4 digits from `listPaymentPayoutDestinations` for the version the printed payment itself stored. These are the readers the claim page and the reveal use. Nothing reads the member's current default account; the print's spec fake has no reader of one.
- **The acknowledgement hash** is made from the claim record and is untouched: one value for both variants. The answer's checksum differs between the variants; nothing reads it (the web only types it).
- **Nothing was added for storage.** The print is built per request. The API already answers every route with `Cache-Control: private, no-store`, has no response interceptor, and the web keeps the pages in component state.
- **For Phase 3 (the correction round).** Two places, on purpose: `approvedStep` in `buildSnapshot` is the only thing the ผู้อนุมัติ block, its signature and the same-person line read, and the account lines read no step, so "this claim's approval no longer stands" is one rule there (skip an invalidated step; the block then prints blank). The wording "อยู่ระหว่างแก้ไขบัญชีรับเงิน" is one more member or flag of `ClaimFormPayout`, and `withAccountNumber` must return early for it so that no number is decrypted and no row is written during the round.

Deliberately not done:

- The correction-round wording and its tests (plan 4.1's last clause, AC32's print half).
- The plan's checkboxes were left as they are, as in the other lanes.
- No e2e spec and no web change.
- The spec file was not edited for the two wordings above; they are listed under Open questions.

## Open questions

- The attestation line for a requester who attested their own account: keep "ผู้ตรวจบัญชี <ชื่อผู้เบิก>", or print the page's sentence "ผู้เบิกยืนยันบัญชีของตนเอง"? One line in `payoutLines`; the snapshot would need to say that the verifier is the requester.
- The account lines repeat on every A4 page. A full-number print of a long claim therefore has the number on each sheet. Say if it should be on the first page only (the table would then start lower on page 1 than on the others).
- A name that can no longer be resolved prints the user id, on the attestation line as in the signer blocks today.

## Noticed, outside this task

- **The ผู้อนุมัติ block reads the latest APPROVED step of any round.** `buildSnapshot` takes the newest step with status APPROVED and a decision time; it does not ask whether that step is invalidated or was decided before the claim was last sent. A claim approved, sent back by finance (which returns it to a draft and leaves the APPROVED step as it is), corrected and sent again prints the earlier approver's name and date in the ผู้อนุมัติ block while it waits for approval, and still does after the new round is rejected. Run on a hand-built record of that state (`approver-block-probe.ts`, coordinator scratchpad): the block read "( มานี ผู้จัดการ ) วันที่ 21 ก.ค. 2569" in both cases, while the rule the claim page, the reveal and the slip use (`isReimbursementClaimApprover` in contracts) says that person did not approve the round. `eligibleClaimSignatureRoles` picks the step the same way, so that earlier approver may also sign the ผู้อนุมัติ block of a claim waiting in the new round. With the account lines this now shows on one sheet: an approver is named, no "ผู้ตรวจบัญชี" line is printed (the attestation is cleared when the claim is sent again), and that earlier approver gets the last-4 print. `selfApproved` reads the same step. Reaching the state needs the finance review step, which is off by default; the path through the real send-back and resubmission was read, not run. Phase 3 marks an APPROVED step invalidated for the first time, so plan 3.6 has to change this selection in any case.
- **The print is narrower than the claim page for one person.** The route asks for one of the three read permissions and the use case for `assertCanReadRequest`. The claim detail and the reveal also let in whoever the pending step waits on after they lost every read permission (`assertCanReadRequestOrAssignment`). That person opens the claim and reveals the number, and cannot print the form. The comment in the use case ("same read guard as GET detail") is no longer true of the detail.

## Artifacts

- API: `apps/api/src/modules/reimbursements/domain/logic/claim-form.logic.ts` (`ClaimFormPayout`, `payoutLines`, `claimFormHeader` now also says where the table starts, `repaymentText`), `application/use-cases/reimbursement-claim-form.use-case.ts` (`withAccountNumber`, the payout part of `buildSnapshot`, `claimFormPayout`). The use case now takes `AuditService` and `AppConfigService`.
- Tests, both files registered in `apps/api/package.json`: `claim-form.logic.spec.ts`, `reimbursement-claim-form.use-case.spec.ts`.
- Docs: `docs/specs/permission-matrix.md` (the payout section: the print is the third way a full number leaves, and its route row).
- Sample prints and the scripts that made them, in the coordinator scratchpad: `print-shots/` (14 samples, 34 images each as SVG and PNG, with `samples.txt` and `measure.txt`) and `print-lane/` (`render-samples.ts`, `shoot-and-measure.cjs`, `mutate.py`, `approver-block-probe.ts`).

## Verification

Run on 2026-10-02 at the lane's code head `626a800ec` (the commit after it is this note and the permission matrix).

- Typechecks, the package scripts: contracts exit 0; API (heap flag) exit 0. The native compiler, as CI runs it (`tsconfig.typecheck.json`), also passes for the API. The web was not touched.
- The two touched specs: 81 tests, 81 pass (45 renderer, 36 use case). Every spec of the reimbursement module: 759 tests, 704 pass, 0 fail, 55 skip (the real-PostgreSQL specs skip themselves without a database).
- Unchanged prints. Nine renderer prints (four blocks and two blocks; signed, waiting, skipped by policy, cancelled, paid with a slip, 65 lines over several pages), each as the tall image and as the A4 pages, and the use case's whole answer for a legacy claim on both layouts, are compared with sha256 digests taken from the untouched code and committed first (`51947cb22`). They hold at the head.
- Both specs also pass with Thai word segmentation degraded to single characters (a preload that replaces `Intl.Segmenter`), so no assertion or digest depends on a dictionary.
- Mutation checks (one edit, run both specs, restore): 27 of 27 make a spec fail. Renderer, 11: the four-block form prints the payout, the number is never printed, the payment line drops the account, the table is not pushed down, the number is grouped, the attestation line is dropped, a legacy header gains a line, PromptPay worded as a bank account (both lines), no wrapping, cash worded as a transfer. Use case, 16: everyone gets the number, no row, the decrypt before the row, no channel, a legacy claim reads the payout table, the four-block form reveals, the payment line reads the claim's current version, a legacy payment line reads its copy, the row carries the ciphertext, a non-throwing audit write, the attestation read from the approval step, a row for a reader outside the group, the number asked for before the print can still be refused, the number handed to the payment line, the read guard skipped, a draft printed. The last one stayed green at first and has its own test now. Two further edits are equivalent rewrites and change nothing observable.
- One assertion was found to depend on chance by these runs (a digit-run pattern over the hex checksum) and was replaced.
- Dependency injection: `check-di-metadata.mjs` (1083 files, all carry their metadata), `injectable-di-token.spec.ts` 3 of 3, `test:boot` (the swc build, "Nest resolved every provider").
- `sync-production-maintenance-release-pins.mjs --check`: current. W00 manifest parity: 4 of 4, nothing regenerated (no hashed file touched). `git diff --check`: clean. No `package.json` touched.
- Sample prints: made by the real use case over the real payout readers and the in-memory payout tables, with test numbers, shown in Chromium as the claim page shows them (an `<img>`), and looked at one by one: a transfer and a PromptPay claim (full number and last 4), cash, a legacy claim on both layouts, the four-block form of a claim that carries an account (identical bytes to the legacy one), the longest account the product accepts (80, 140 and 20 characters) on one sheet and over the four pages of a 65-line claim, a claim waiting for approval, an owner's own claim.
- Measured in Chromium, every text of every sample under three font stacks (as printed, Tahoma, the browser's sans-serif): nothing is right of the margin at x=805; the widest account line ends at x=745.8; nothing is below the sheet.

Read, not run: the response cache header, the absence of a response interceptor or logger, and what the web does with the answer. Not run: the whole registered API suite, the real-PostgreSQL gate, live HTTP against a database, Playwright e2e, the web suite, the LINE whole-chain acceptance.

## Next

- Coordinator: merge into the assembly. The lane touches the two claim-form files, their specs, the permission matrix's payout section and this note.
- Phase 3: the correction-round wording and the blank approver block, at the two places named above, with the use-case case "no number and no row during the round".
- Decide the approver-block step (first item under "Noticed"): the print, the signing right and the page should name the same person.
- Decide the two open wordings.
