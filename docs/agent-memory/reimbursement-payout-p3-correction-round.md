# Agent Memory: reimbursement payout Phase 3, the correction round (server side and web)

> The words of a round changed after this note was written (2 Oct 2026): they follow what the claim held when it was sent back and what was answered, and the reasons follow what the claim holds. The labels, reasons, notices and assistant words quoted below are those of the first build. The current ones, with the fields that carry the facts, are in [reimbursement-payout-round-wording.md](reimbursement-payout-round-wording.md).

Status: server side and web done on `claude/reimb-payout-p3-correction-round-20261002`, not pushed. Plan tasks 3.1 to 3.13; nothing is ticked in the plan. The web is described under "What the web does" below.
Owner: payout lane, Phase 3 (spec `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §14, §17, §19; plan `docs/plans/reimbursement-payout-account-and-payment-slip-plan-th.md` Phase 3).
Scope: contracts, API, workflow notices, notification state, the assistant's two reads, the A5 evidence classifier, the printed form. Web: the claim page, the hub rows and the approval queue of a round, and two Thai sentences for payment refusals that had none. The web lane touched no file outside `apps/web/` and `e2e/`.

## What a correction round is

A claim that waits for payment with a wrong payout account is fixed on the same claim and number.

| Where the claim stands | `status` | `payoutCorrectionPhase` | Approval step | With whom |
|---|---|---|---|---|
| Before | `READY_FOR_PAYMENT` | absent | the approval it stands on | whoever pays |
| Phase A | `PENDING_APPROVAL` | `AWAITING_REQUESTER` | none open; the earlier approval carries `invalidatedAt` and `invalidatedReason: 'payout_account_correction'` | the requester |
| Phase B | `PENDING_APPROVAL` | `AWAITING_APPROVAL` | a new `PENDING` step for the same approvers | those approvers |
| After | `READY_FOR_PAYMENT` | absent | the new step, `APPROVED` | whoever pays |

No new status, enum value, permission key or switch. A claim in a round is `PENDING_APPROVAL`, so anything that does not know about rounds reads it as waiting for approval and refuses its payment.

Only the account changes. Lines, amounts, evidence, number, duplicate state, finance result, expense records and journals are the same rows before and after (proven against PostgreSQL).

## Decisions taken here

- Six columns, not five. The spec's five (`payoutCorrectionRequestedAt`, `…RequestedByUserId`, `…ReasonCode`, `…Note`, `…SubmittedAt`) are cleared when the round ends, and the timeline of spec §17.2 needs who sent the claim back and why after that. `payoutCorrectionLogJson` keeps every step of every round. All nullable, no backfill.
- A scan declared as signed stops counting at the send-back itself (its declaration gets `supersededAt`), not by comparing account versions at read time. That also covers a round that ends with the same version (cash to cash) and declarations made before this release, which carry no version. New declarations do store `payoutDestinationVersion`. While a round is open a declaration is refused under the claim's lock; filing a scan without the declaration still works.
- The DTO of the send-back holds only the shape. Which reasons exist, the note length and the account-number guard are refused by the use case with codes the web has words for.
- Phase A is in the hub bucket `review` (รออนุมัติ/ตรวจสอบ), because the cards and the list filter count by status. The row's desk is still the requester.
- The round's approval creates no task-list entry. The spec asks for notices only; the claim is in the approval queue of the new step's approvers.
- A claim nobody has to approve (and a legacy finance-passed claim with no approval step) is `READY_FOR_PAYMENT` in the same call that gives the account. Nobody attested that account, so the existing pay-step rule applies: the payer confirms it and is recorded as who checked it.
- A legacy claim (sent before claims carried an account) may be sent back and given an account. From then on its approval hash includes the account like any claim sent with one, and its in-system signatures are removed at the send-back like any other claim's. A legacy claim that is never sent back keeps its hashes byte for byte (the golden-hash tests are unchanged).

## Hand-off for the web (plan task 3.10)

Everything below is in `packages/contracts/src/reimbursements.ts`. The web can decide every button from the flags; it does not need to know roles or permissions.

### On a list or queue row (`ReimbursementRequestSummary`)

- `payoutCorrectionPhase?: 'AWAITING_REQUESTER' | 'AWAITING_APPROVAL'`. Badge words: `REIMBURSEMENT_PAYOUT_CORRECTION_PHASE_LABELS` ("รอผู้เบิกแก้บัญชีรับเงิน", "รออนุมัติบัญชีรับเงินใหม่").
- `currentDesk`: `{ kind: 'REQUESTER' }` in phase A, `{ kind: 'APPROVER', names }` in phase B.
- `reimbursementHubBucket(row)` answers `review` for both phases. Do not special-case the desk kind `REQUESTER` as a draft; use this function.
- An approval queue row (`GET approval-queue`) exists only in phase B, with `ageHours` counted from when the account was given. The finance queue (`GET finance-queue`) holds no claim in a round.

### On a claim detail (`ReimbursementRequestDetail`)

| Field | When | What it is |
|---|---|---|
| `payoutCorrectionPhase` | in a round | as on the row |
| `payoutCorrection` | in a round, on every detail the API returns | `phase`, `requestedAt`, `requestedByUserId`, `requestedByName`, `reasonCode`, `note?`, `submittedAt?` (phase B), `previous?` (the masked account the claim was approved with: `payoutMethod`, `payoutKind`, `bankName`, `accountName`, `accountLast4`, `version`), `previouslyApprovedAt?` |
| `payout` | as before | phase A: still the account the claim was approved with (the one in question, the same as `payoutCorrection.previous`, with its old attestation). Phase B and after: the new account. `payout.version` is what an approval attests |
| `payoutCorrectionActions` | GET detail only | `{ canRequest, canSubmit, requesterDefault? }`. Absent means neither |
| `payoutCorrectionHistory` | GET detail only, when the claim was ever in a round | the timeline rows, oldest first: `kind` `SENT_BACK` (`reasonCode`, `note?`), `ACCOUNT_SUBMITTED` (`payoutMethod`, `payoutVersion?`), `REAPPROVED` (`approvalStepId`), each with `at`, `byUserId`, `byName?` |
| `approvalSteps` | always | in the order they were assigned. A step with `invalidatedReason: 'payout_account_correction'` is history: status `APPROVED` for the approval the round replaced, `CANCELLED` for a round step that was refused or replaced |
| `approvalActions` | GET detail | `{ canApprove, canReject }` both false in phase A; in phase B true for whoever decides the new step |
| `signedCopies[].beforePayoutCorrection` | a scan declared before a round | label it "สำเนาก่อนแก้บัญชีรับเงิน"; it has no `acknowledgedAt` and does not count for `documentSignedVia` |
| `signatures`, `documentSignedVia` | after a send-back | empty and `null` until signed again after the round |
| `awaitingSystem`, `paymentDesk` | in a round | absent |

The responses of the two new calls, of approve and of reject are a claim detail with `payoutCorrection`, but without `payoutCorrectionActions` and `payoutCorrectionHistory`. Read the claim again after each action, as the page does today.

Reason words: `REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS` (`ACCOUNT_NUMBER_WRONG` "เลขบัญชีไม่ถูกต้อง", `ACCOUNT_NAME_MISMATCH` "ชื่อบัญชีไม่ตรงกับผู้เบิก", `BANK_WRONG` "ธนาคารไม่ถูกต้อง", `ACCOUNT_UNUSABLE` "บัญชีปิดหรือโอนไม่ได้", `REQUESTER_ASKED` "ผู้เบิกขอเปลี่ยนบัญชี", `OTHER` "อื่น ๆ"). Note length: `REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH` (500).

### Endpoints

All under `companies/:companyId/reimbursements`.

1. `POST :requestId/payout-correction` (200). Body `{ reasonCode, note? }` (`RequestReimbursementPayoutCorrectionInput`). Sends a claim at `READY_FOR_PAYMENT` back (phase A). In phase B, from whoever decides the waiting step, sends it back again. Answers the claim detail.
2. `PUT :requestId/payout-destination` (200). Body `SubmitReimbursementPayoutCorrectionInput`: `{ mode: 'CASH' }`, or `{ mode: 'DEFAULT', defaultToken }` with `payoutCorrectionActions.requesterDefault.token`, or `{ mode: 'SPECIFIED', payoutKind, bankName?, accountName, accountNumber, saveAsDefault? }` (the fields of a draft's payout form). Phase A or phase B (in phase B it replaces the waiting step). Answers the claim detail: phase B, or `READY_FOR_PAYMENT` at once for a claim nobody has to approve.
3. `POST :requestId/approve`, unchanged shape: `{ comment?, approvalSnapshotHash, payoutVerifiedVersion? }`. In phase B it approves the account alone and the claim is `READY_FOR_PAYMENT` in the answer. Send `approvalSnapshotHash` of the detail the card showed, and for a transfer `payoutVerifiedVersion: payout.version`.
4. `POST :requestId/reject`, unchanged shape plus `payoutCorrectionReasonCode?`. In phase B it never rejects: it sends the claim back to phase A, `reason` (still required by this endpoint) becomes the round's note, and without a code the reason is `OTHER`. The first endpoint does the same with an optional note; use that one for a "ส่งกลับให้แก้อีกครั้ง" button.
5. Cancel (`POST :requestId/cancel`) works in both phases as for any claim.

### Who may do what

| | Before (`READY_FOR_PAYMENT`, no payment recorded) | Phase A | Phase B |
|---|---|---|---|
| Send back (`canRequest`) | whoever holds `reimbursement.payment.record` for the claim's branch; the approver the claim stands on (also without the pay right); the requester with `reimbursement.update_own_draft` | nobody | whoever may reject the waiting step (`approvalActions.canReject`) |
| Give the account (`canSubmit`) | nobody | the requester with `reimbursement.update_own_draft`, or a holder of `reimbursement.finance_review` on their behalf, in the claim's branch | the same people (it replaces the waiting step) |
| Approve | nobody | nobody | the approvers of the new step, by the ordinary rules (permission or frozen assignment, self-approval rule, attestation) |
| Pay | whoever may | refused | refused |
| Sign or declare a signed scan | as before | nobody | nobody |
| Cancel | as before | as before | as before |

When someone other than the requester types the account, the requester gets the existing notice "… ระบุบัญชีรับเงินคืนในใบเบิกของคุณ", in the same transaction.

### Refusal codes

| HTTP | Code | Thai sentence (in `apps/web/src/common/api/api-error-message.ts`) | When |
|---|---|---|---|
| 409 | `payout_correction_in_progress` | ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน | paying, approving or rejecting in phase A; sending back in phase A; reopening or withdrawing to a draft, the old approve transaction, declaring a signed scan, in either phase |
| 409 | `payout_correction_not_allowed` | ใบนี้ส่งกลับแก้บัญชีไม่ได้ในสถานะปัจจุบัน | sending back a claim that is not `READY_FOR_PAYMENT`, or has a recorded payment (void it first) |
| 403 | `payout_correction_denied` | คุณไม่มีสิทธิ์ทำรายการแก้บัญชีรับเงินของใบนี้ | the caller is none of the people in the table above |
| 409 | `payout_correction_not_requested` | ใบนี้ไม่ได้ถูกส่งกลับให้แก้บัญชีรับเงิน กรุณาเปิดใบใหม่เพื่อดูสถานะล่าสุด | giving an account to a claim that is in no round |
| 400 | `payout_correction_reason_required` | กรุณาเลือกเหตุผลที่ส่งกลับให้แก้บัญชีรับเงิน | no reason, or one outside the list |
| 400 | `payout_correction_note_too_long` | หมายเหตุต้องไม่เกิน 500 ตัวอักษร | note over 500 characters |
| 400 | `note_contains_account_number` | (existing) | the note carries an account number |
| 409 | `reimbursement_changed` | (existing) | someone paid, cancelled or sent the claim back since the page read it; reload |
| 409 | `reimbursement_cancellation_pending` | (existing) | a cancellation was started and has not completed |
| 409 | `payout_method_required` | (existing) | `mode: 'DEFAULT'` and the requester has no default account |
| 409 | `payout_destination_changed` | (existing) | `mode: 'DEFAULT'` with a token of a default that changed since; or an approval that attests another version than the claim has |
| 409 | `payout_verification_required` | (existing) | approving a transfer account without `payoutVerifiedVersion` |
| 409 | `stale_approval_snapshot` | (existing) | approving with the hash of another state of the claim, or twice |
| 409 | `reimbursement_payment_state_changed` | (existing) | a payment that lost its race against a send-back; reload |
| 409 | `reimbursement_correction_has_projection` | (existing) | rejecting or reopening any claim whose expense records still stand |
| 403 | `claim_signature_role_not_eligible` | (existing) | signing during a round |
| 400/409 | the payout form's own codes | (existing) | `mode: 'SPECIFIED'` with an incomplete or malformed account, exactly as on a draft |

### Example details

From a real run against PostgreSQL, shortened to the fields that differ. Names are the fixture's.

Phase A, as the requester sees it:

```json
{
  "requestNo": "RB-202610-00001",
  "status": "PENDING_APPROVAL",
  "paymentStatus": "NOT_PAYABLE",
  "payoutCorrectionPhase": "AWAITING_REQUESTER",
  "currentDesk": { "kind": "REQUESTER" },
  "payout": {
    "payoutMethod": "BANK_TRANSFER", "payoutKind": "BANK_ACCOUNT", "bankName": "ธนาคารกสิกรไทย", "accountName": "นาย สมชาย ใจดี",
    "accountLast4": "5678", "version": 1, "source": "DEFAULT_ACCOUNT",
    "verifiedByName": "สมศรี ผู้จัดการ", "verifiedAt": "2026-10-01T20:54:39.792Z", "canRevealAccountNumber": true
  },
  "payoutCorrection": {
    "phase": "AWAITING_REQUESTER",
    "requestedAt": "2026-10-01T20:54:40.078Z", "requestedByUserId": "…", "requestedByName": "วราภรณ์ การเงิน",
    "reasonCode": "ACCOUNT_NUMBER_WRONG", "note": "ธนาคารแจ้งว่าไม่พบบัญชีนี้",
    "previous": { "payoutMethod": "BANK_TRANSFER", "payoutKind": "BANK_ACCOUNT", "bankName": "ธนาคารกสิกรไทย", "accountName": "นาย สมชาย ใจดี", "accountLast4": "5678", "version": 1 },
    "previouslyApprovedAt": "2026-10-01T20:54:39.792Z"
  },
  "approvalSteps": [
    { "id": "step-1", "sequenceNo": 1, "status": "APPROVED", "decidedByName": "สมศรี ผู้จัดการ", "decidedAt": "2026-10-01T20:54:39.792Z",
      "invalidatedAt": "2026-10-01T20:54:40.078Z", "invalidatedReason": "payout_account_correction" }
  ],
  "signatures": [], "documentSignedVia": null,
  "approvalActions": { "canApprove": false, "canReject": false },
  "payoutCorrectionActions": { "canRequest": false, "canSubmit": true },
  "payoutCorrectionHistory": [
    { "kind": "SENT_BACK", "at": "2026-10-01T20:54:40.078Z", "byUserId": "…", "byName": "วราภรณ์ การเงิน", "reasonCode": "ACCOUNT_NUMBER_WRONG", "note": "ธนาคารแจ้งว่าไม่พบบัญชีนี้" }
  ]
}
```

With a default account set, `payoutCorrectionActions` also carries `"requesterDefault": { "payoutMethod": "BANK_TRANSFER", "payoutKind": "BANK_ACCOUNT", "bankName": "…", "accountName": "…", "accountLast4": "6789", "token": "<32 hex>" }`. The approver of the first approval sees `payoutCorrectionActions` absent in phase A.

Phase B, as the approver sees it:

```json
{
  "status": "PENDING_APPROVAL",
  "paymentStatus": "NOT_PAYABLE",
  "payoutCorrectionPhase": "AWAITING_APPROVAL",
  "currentDesk": { "kind": "APPROVER", "names": ["สมศรี ผู้จัดการ"] },
  "approvalSnapshotHash": "486772cf235f4afd77658baaab4468f2",
  "payout": {
    "payoutMethod": "BANK_TRANSFER", "payoutKind": "BANK_ACCOUNT", "bankName": "ธนาคารไทยพาณิชย์", "accountName": "นาย สมชาย ใจดี",
    "accountLast4": "1112", "version": 2, "source": "REQUESTER", "canRevealAccountNumber": true
  },
  "payoutCorrection": {
    "phase": "AWAITING_APPROVAL",
    "requestedAt": "2026-10-01T20:54:40.078Z", "requestedByName": "วราภรณ์ การเงิน", "reasonCode": "ACCOUNT_NUMBER_WRONG", "note": "ธนาคารแจ้งว่าไม่พบบัญชีนี้",
    "submittedAt": "2026-10-01T20:54:40.212Z",
    "previous": { "payoutMethod": "BANK_TRANSFER", "payoutKind": "BANK_ACCOUNT", "bankName": "ธนาคารกสิกรไทย", "accountName": "นาย สมชาย ใจดี", "accountLast4": "5678", "version": 1 },
    "previouslyApprovedAt": "2026-10-01T20:54:39.792Z"
  },
  "approvalSteps": [
    { "id": "step-1", "sequenceNo": 1, "status": "APPROVED", "invalidatedAt": "2026-10-01T20:54:40.078Z", "invalidatedReason": "payout_account_correction" },
    { "id": "step-2", "sequenceNo": 1, "status": "PENDING", "approverName": "สมศรี ผู้จัดการ", "assignedAt": "2026-10-01T20:54:40.212Z" }
  ],
  "approvalActions": { "canApprove": true, "canReject": true },
  "payoutCorrectionActions": { "canRequest": true, "canSubmit": false },
  "payoutCorrectionHistory": [
    { "kind": "SENT_BACK", "at": "2026-10-01T20:54:40.078Z", "byName": "วราภรณ์ การเงิน", "reasonCode": "ACCOUNT_NUMBER_WRONG", "note": "ธนาคารแจ้งว่าไม่พบบัญชีนี้" },
    { "kind": "ACCOUNT_SUBMITTED", "at": "2026-10-01T20:54:40.212Z", "byName": "สมชาย พนักงาน", "payoutMethod": "BANK_TRANSFER", "payoutVersion": 2 }
  ],
  "payoutHistory": [
    { "version": 1, "bankName": "ธนาคารกสิกรไทย", "accountLast4": "5678", "source": "DEFAULT_ACCOUNT", "verifiedByName": "สมศรี ผู้จัดการ", "approvalStepId": "step-1" },
    { "version": 2, "bankName": "ธนาคารไทยพาณิชย์", "accountLast4": "1112", "source": "REQUESTER" }
  ]
}
```

The approval card compares `payoutCorrection.previous` with `payout`, says the lines and amounts are what was approved on `previouslyApprovedAt`, and approves with `approvalSnapshotHash` and `payoutVerifiedVersion: 2`. The requester sees `{ "canRequest": false, "canSubmit": true }` in phase B.

After the approval, as whoever pays sees it:

```json
{
  "status": "READY_FOR_PAYMENT",
  "paymentStatus": "UNPAID",
  "currentDesk": { "kind": "PAYMENT" },
  "payout": {
    "payoutMethod": "BANK_TRANSFER", "bankName": "ธนาคารไทยพาณิชย์", "accountLast4": "1112", "version": 2, "source": "REQUESTER",
    "verifiedByName": "สมศรี ผู้จัดการ", "verifiedAt": "2026-10-01T20:54:40.286Z", "canRevealAccountNumber": true
  },
  "approvalSteps": [
    { "id": "step-1", "status": "APPROVED", "invalidatedAt": "2026-10-01T20:54:40.078Z", "invalidatedReason": "payout_account_correction" },
    { "id": "step-2", "status": "APPROVED", "decidedByName": "สมศรี ผู้จัดการ", "decidedAt": "2026-10-01T20:54:40.286Z" }
  ],
  "approvalActions": { "canApprove": false, "canReject": false },
  "payoutCorrectionActions": { "canRequest": true, "canSubmit": false },
  "payoutCorrectionHistory": [
    { "kind": "SENT_BACK", "at": "2026-10-01T20:54:40.078Z", "byName": "วราภรณ์ การเงิน", "reasonCode": "ACCOUNT_NUMBER_WRONG", "note": "ธนาคารแจ้งว่าไม่พบบัญชีนี้" },
    { "kind": "ACCOUNT_SUBMITTED", "at": "2026-10-01T20:54:40.212Z", "byName": "สมชาย พนักงาน", "payoutMethod": "BANK_TRANSFER", "payoutVersion": 2 },
    { "kind": "REAPPROVED", "at": "2026-10-01T20:54:40.286Z", "byName": "สมศรี ผู้จัดการ", "approvalStepId": "step-2" }
  ]
}
```

`payoutCorrection` and `payoutCorrectionPhase` are absent. The payment is recorded as before, confirming `payout.version` (2).

### For the page

- The step strip goes back to the approval step with the same number of steps; the finance step of a claim finance passed stays passed (`financeReviewStatus` is kept).
- Timeline (spec §17.2): the first approval as history, then one row per `payoutCorrectionHistory` entry: "ส่งกลับให้แก้บัญชีรับเงินโดย {byName} : {reason label}", "ผู้เบิกแก้บัญชีรับเงิน" (name the person when `byUserId` is not the requester), "อนุมัติบัญชีรับเงินใหม่โดย {byName}".
- The printed form during a round prints "รับเงินคืนทาง: อยู่ระหว่างแก้ไขบัญชีรับเงิน" and an empty approver block; that is the API's own output, nothing for the web to do.

## What the web does (plan task 3.10, and the web of 3.11 to 3.13)

Every button of a round is shown from a flag the server sent: `payoutCorrectionActions.canRequest` and `.canSubmit`, `approvalActions.canApprove` on the claim, `approvalActions` on a queue row. No role, permission or status decides one. "บันทึกจ่าย" is as before this work (the session's pay permission and the claim's status).

### On the claim page

- Pay step, before a round. "ส่งกลับให้แก้บัญชีรับเงิน" beside "บันทึกจ่าย" for whoever `canRequest` names. Its form opens inside the step card, never in a dialog, closes a payment form left open, and takes the focus at its heading. Six reasons from the contract's list as radio buttons, an optional note of 500 characters, and what is lost said before the confirm: signatures made in the system, a paper copy declared as signed, and for a claim sent before claims carried an account, that it gets one this way. A refusal or a lost race is said in the form's own banner in the server's sentence, the reason and the note stay, and no global toast is raised.
- Phase A. The step strip is back at "อนุมัติ" with the same number of steps, drawn as a step to put right. Badge "รอผู้เบิกแก้บัญชีรับเงิน", header "อยู่ที่ ผู้เบิก", step note "ส่งกลับให้แก้บัญชีรับเงินโดย {name} : {reason} · หมายเหตุ: {note} · รอผู้เบิกแก้บัญชีรับเงิน". The requester reads "รอคุณแก้บัญชีรับเงิน …" and has "แก้บัญชีรับเงิน"; anyone else `canSubmit` names (a finance reviewer) has "แก้บัญชีรับเงินแทนผู้เบิก". The form offers the requester's default account (only when the server sent `requesterDefault` with a transfer account; it is sent back by its token), cash, or an account typed for this claim. Nothing is chosen in advance. "บันทึกเป็นบัญชีประจำ" is offered only when the default-account endpoint answers `canEdit`. The card "การรับเงินคืน" says the account under it is the one in question and that the claim cannot be paid meanwhile.
- Phase B. Badge "รออนุมัติบัญชีรับเงินใหม่", header "อยู่ที่ {approvers}", step note "รอ {approvers} อนุมัติบัญชีรับเงินใหม่" (the approver reads "รอคุณอนุมัติบัญชีรับเงินใหม่ …"). The step card carries "สิ่งที่เปลี่ยน: บัญชีรับเงินคืน": the account the claim was approved with (last 4 digits; "ไม่มี ใบนี้ส่งก่อนมีช่องบัญชีรับเงิน" for a legacy claim) beside the new one, the sentence that the lines and the amount are what was approved on {date}, who sent the claim back and why, and who gave the new account and when. The approver ticks the attestation for the new version (a transfer; cash has nothing to attest) and has "อนุมัติ" and "ส่งกลับให้แก้อีกครั้ง". The second is the first endpoint again, not reject. "ปฏิเสธ" and "แก้ไข (เปิดกลับเป็นร่าง)" are not offered in a round. Whoever `canSubmit` names may give the account again ("แก้บัญชีรับเงินอีกครั้ง"), drawn without the look of the next thing to do.
- After the approval the claim is at its pay step with the new account and "ตรวจบัญชีแล้วโดย {the approver of the round}". A claim nobody approves is there in the same call that gives the account, and its payer reads "ยังไม่มีผู้ตรวจบัญชีนี้ คุณเป็นผู้ตรวจ" (the rule that existed).
- An approval that lost its race. Where the viewer may still approve the claim as it now stands, the compare dialog that existed opens. Where they may not (it was sent back, decided or cancelled meanwhile), the page shows the claim as it is and says "ยังไม่ได้อนุมัติ เพราะมีผู้ทำรายการกับใบนี้ไปก่อนแล้ว หน้านี้แสดงสถานะล่าสุดของใบ".
- Journey ("เส้นทางของใบเบิก"). The approval a round set aside stays as history. One row per `payoutCorrectionHistory` entry, in time order with payments that were voided. While a round is open the waiting row uses the words of the badge.
- Finance step of a claim finance passed, during a round: passed, "ตรวจแล้ว ไม่ต้องตรวจซ้ำ". Five steps before, during and after.
- Signing. While a round is open there is no sign button and no declaration of a signed copy, and the page says why; a file is still attached as an ordinary attachment. A copy declared before the round reads "สำเนาก่อนแก้บัญชีรับเงิน · ไม่นับว่าลงนามแล้ว". Print stays for every reader. Who signs as approver, and who the card "ขั้นตอนอนุมัติ" shows as in force, follow the approval that is not set aside (`invalidatedAt`).

### In the hub

- A row or card of a round reads its phase on the badge, and "อยู่ที่ ผู้เบิก" in phase A. It is counted under "รออนุมัติ/ตรวจสอบ" by the server's bucket.
- Approval queue: a row of a round has one button, "ตรวจบัญชีรับเงินใหม่", which opens the claim page. It approves nothing in place and offers no "ปฏิเสธ". Ordinary rows are as before.

### Decisions on the web

- "ผู้เบิก", not the pool word "ผู้ยื่น", for the desk of phase A: the badge, the note and the journey name the requester, and a draft may be filed by someone else.
- The two forms do not read the claim again when the API refuses, so what was typed stays. The page under the form then still shows the claim as it was until it is opened again. The payment form behaves the same way.
- A journey row for an account given says who gave it, not which account. A requester who gives the account twice on one day gets two rows that read alike.

### Words and tests

- `payment_amount_invalid` and `payment_over_approved_amount` have sentences in `apps/web/src/common/api/api-error-message.ts`.
- `e2e/reimbursements.spec.ts` has `REIMB-12` (send back, correct, approve again, pay into the new account under the same number). It is type-checked and was not run with Playwright.

## Notices

- `reimbursement.payout_correction_requested`, to the requester alone: "ใบเบิกต้องแก้บัญชีรับเงิน: {เลขที่ใบ}" and "เหตุผล: {reason label} · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน". Not sent to a requester who asked for it themselves. A claim with no account of its own is sent back with the reason "ใบนี้ยังไม่มีบัญชีรับเงิน" (2 Oct 2026, `NO_ACCOUNT_ON_CLAIM`, taken from such a claim only), and its body ends "เปิดใบเบิกเพื่อเพิ่มบัญชีรับเงิน"; the title is the template's and is the same for every reason.
- `reimbursement.payout_correction_submitted`, to the approvers of the new step alone: "รออนุมัติบัญชีรับเงินใหม่: {เลขที่ใบ}" and "ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติบัญชีรับเงินใหม่".
- After the approval: the existing `reimbursement.ready_for_payment`, same payload as an ordinary approval.
- Both templates are auto-enabled, follow the switch of `reimbursement_correction_requester` and `reimbursement_pending_approval`, and are in the implemented and always-delivered trigger lists.

## What the assistant is told

- `reimbursement.get_approval_backlog`: a claim in phase A is on a desk of its own, `kind: 'requester_correction'`, `label: 'รอผู้เบิกแก้บัญชีรับเงิน'`, with `oldestSentBackOn`, `longestWaitDays` and the note "ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงินคืน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้". Its item has `waitingOn: 'รอผู้เบิกแก้บัญชีรับเงิน'`, `submittedOn`, `sentBackOn`, `waitDays`. It is not counted in `awaitingApprovalCount`. In phase B the item names the approver, with `resubmittedOn` and `waitDays` from that day.
- `reimbursement.list_pending_approvals`: lists a claim only in phase B, as an ordinary row.
- `reimbursement.get_summary`: phase A is not counted as waiting for approval; phase B is late only by its own wait. A claim being cancelled is in none of its four figures (it waits for the system, and no approver or payer can act on it): closed on 2 Oct 2026 with `reimbursement.get_detail`, whose `status` for such a claim is the claim page's own "รอระบบปรับสถานะ" (`REIMBURSEMENT_SYSTEM_WAIT_LABEL`) and never the status it has not left yet.
- No field of an account, the reason code or who sent the claim back is in any of them.

## Open questions

- After the approval of a round on a claim finance passed, the ready-to-pay notice prefers its actor (the approver, bell only) and then the finance reviewer. The claim page names the finance reviewer first. Unchanged template; say if the finance reviewer should be told first.
- A declaration names the claim by its number only, so a paper printed before a round can be declared after it. The declaration then stores the new account version.
- `reimbursement.get_detail` (LINE, a hashed file, not touched) shows a claim in a round as `PENDING_APPROVAL` with an approved step and says nothing of the round.
- The note is optional for every reason, `OTHER` included.
- Web: after a lost race the form keeps what was typed and shows the server's sentence, and for `payout_correction_in_progress` that sentence ("ใบนี้อยู่ระหว่างแก้บัญชีรับเงิน") names nothing to do next. Say if the form should offer to open the claim again.
- Web: the approval queue table is 980 px wide in a 901 px card at 1280 px with the side menu open, so its action column scrolls inside the card. It was so before this work, for every row.
- Rollback: the previous build knows nothing of rounds. A claim in phase A is safe with it (no step to decide). A claim in phase B can be rejected, or withdrawn to a draft by its requester, by the previous build while its expense records stand. Check that no claim is in phase B before rolling back.

## Artifacts

- Contracts: `packages/contracts/src/reimbursements.ts`.
- Migration: `apps/api/prisma/migrations/20261002100000_reimbursement_payout_correction/migration.sql`.
- API: `apps/api/src/modules/reimbursements/application/use-cases/reimbursement-payout-correction.use-case.ts` (new), `reimbursement-approval.use-case.ts`, `reimbursement-request.use-case.ts`, `reimbursement-finance.use-case.ts`, `reimbursement-claim-form.use-case.ts`, `reimbursement-claim-signature.use-case.ts`, `reimbursement-summary.use-case.ts`, `application/dto/reimbursement.mapper.ts`, `domain/logic/reimbursement.logic.ts`, `domain/logic/claim-form.logic.ts`, `domain/logic/payout-destination.logic.ts`, `infrastructure/prisma-reimbursement.repository.ts`, `infrastructure/reimbursement-payout.ts`, `presentation/http/reimbursement-payout.controller.ts`, `presentation/http/reimbursement.dtos.ts`.
- Outside the module: `workflow/application/use-cases/workflow-scan-candidates.use-case.ts`, `workflow/domain/workflow-template-catalog.ts`, `workflow/domain/logic/workflow-claim-task.logic.ts`, `workflow/infrastructure/prisma-workflow.repository.ts`, `dashboard-notifications/domain/models/notification.model.ts`, `dashboard-notifications/infrastructure/document-notification-state.ts`, `scripts/production-a5-evidence.pg.ts`.
- Web: `apps/web/src/common/api/api-error-message.ts` (six sentences from the server lane, two from the web lane), and under `apps/web/src/features/reimbursements/`: `ReimbursementPayoutCorrection.tsx` (new: the two forms and the comparison card), `ReimbursementJourneyPage.tsx`, `ReimbursementDetailSections.tsx`, `ReimbursementsPages.tsx`, `ReimbursementPayout.tsx`, `reimbursements.logic.ts`, `reimbursement-payout.logic.ts`, `reimbursements.model.ts`, `reimbursements.api.ts`. Specs: `reimbursement-payout-correction.qa.spec.ts` (new), and additions in `reimbursements.logic.spec.ts`, `reimbursements.model.spec.ts`, `reimbursements.api.spec.ts`, `ReimbursementPages.plain-thai.qa.spec.ts`, `ReimbursementPayout.qa.spec.ts`, `reimbursement-stranded-claims.qa.spec.ts`, `apps/web/src/common/api/api-error-coverage.spec.ts`.
- E2E: `e2e/reimbursements.spec.ts` (`REIMB-12`).

## Verification

Run on 2026-10-02 at the lane head, before the commit that adds this note (that commit changes one comment in contracts and documents only).

- Typechecks, the package scripts: contracts, API (heap flag), web and workers all exit 0.
- API specs without a database: every registered spec under reimbursements, workflow and dashboard-notifications, the LINE reimbursement tools and the A5 scripts, plus two unregistered ones run by hand (`reimbursement-approval-backlog.use-case.spec.ts`, `document-notification-state.spec.ts`): 53 files, 1244 tests, 1244 pass.
- New tests: 67 in the 19 touched unit spec files (919 tests there, 852 before), one of them in the by-hand backlog spec. Run against the production code of the merge base `d1fd10a57` with the new spec files, every new test and group fails (81 names, none passing); the 852 old tests are unaffected apart from the pins that had to change.
- Real PostgreSQL 18.3, a throwaway container removed afterwards, `migrate deploy` from empty (271 migrations): the gate `REIMBURSEMENT_PG_GATE_REQUIRED=true … test:reimbursement-compatibility` 89 of 89, none skipped, three runs in a row (82 before; seven cases new, two extended). On the merge-base code the seven new and two extended cases fail. `claim-payment-posting.pg.spec.ts` on a database of its own: 16 of 16.
- Contracts tests 343 of 343; `packages/contracts/src/reimbursements.spec.ts` by hand 3 of 3.
- Whole web suite `pnpm --filter @watchdog-bms/web test`: 2419 of 2419.
- `test:boot`: Nest resolved every provider. `migration:review` exit 0, `prisma validate` exit 0.
- Maintenance pins `--check`: current, no pinned file touched. W00 manifest parity 4 of 4 with no regeneration (no hashed file touched). `node scripts/run-line-ai-whole-chain-acceptance.mjs`: exit 0, 12 suites.
- `git diff --check` clean. No `package.json` edit.

Not run by the server lane: Playwright E2E, a browser pass, and any real-model check (no model call was made).

Web lane, run on 2026-10-02 at `201c21776`, the last code commit before the one that adds these lines:

- Whole web suite `pnpm --filter @watchdog-bms/web test`: 2508 of 2508 (2419 before). The reimbursement specs are 415 (327 before); the new spec file holds 79.
- Thirty faults put into the committed web code one at a time (a round offers "ปฏิเสธ", a button read from a permission, signing offered in a round, and so on), the reimbursement specs run against each: every one makes at least one test fail.
- Typechecks: contracts (package script), web (the native compiler CI uses, and the package script), and `e2e/reimbursements.spec.ts` on its own: all exit 0. The API was not touched.
- Maintenance pins `--check`: current. W00 manifest parity 4 of 4 with no regeneration; no hashed file was touched, so the whole-chain run was not needed. `git diff --check` clean. No `package.json` edit.
- A real run in a browser on a throwaway stack made from nothing (PostgreSQL 18.3, Redis, MinIO; 271 migrations, the seed; the API and `next dev` of this branch), removed afterwards: 92 steps in one pass, all holding. A claim paid by transfer through the whole round as six viewers (requester, approver, payer, finance reviewer, read-only auditor, a reader of another branch) at each of four points, the buttons of the step card held against what the API takes from that viewer; a claim finance had passed; a claim nobody approves; a claim sent before claims carried an account; lost races and refusals; the printed form in a round; the saved default, giving the account again, and cash. 390 px and 1280 px throughout, 700 px for the forms, the approver's card and the approval queue. No page was wider than its screen, and nothing to press in the step card was under 44 px on the phone (the app's own buttons and fields are 40 px from 640 px wide).
- `REIMB-12` walked by hand on that stack with the locators and API calls of the spec: 16 of 16 checks. Playwright itself was not run, and no real-model check was made (the web makes no model call).

## Next

- A real-model check of the two assistant reads above.
- Run `REIMB-12` with Playwright where the E2E suite runs.
- The user guide (`apps/web/src/features/user-guide/reimbursement-guide.content.ts`) is being rewritten on another branch and says nothing of a round yet.
- The open questions above, then tick Phase 3 in the plan.
