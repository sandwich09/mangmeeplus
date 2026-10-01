# Agent Memory: claim-notification-fixes

Status: implemented on branch `claude/claim-notification-fixes-20261001` (from develop `f63ca3441`), not pushed, no PR. 2026-10-01. Two rounds: the audit rows, then the owner's follow-up on who is notified.

Owner: Claude Code lane for the payout impact audit rows B8, B9, B10, B12, B15.

Scope: notification and task bugs around reimbursement claims. Production had six approved claims waiting for payment with nobody told. Changes stay in the workflow and dashboard-notifications modules, plus small edits in the reimbursements module (listed under Decisions).

Decisions:

- B12, recipients who can act. A recipient picked by permission is put through the permission resolver (ACTIVE role, entitlement filter, branch scope) and checked against the branch of the claim or vendor bill the run is about. No second copy of the rule. Vendor bills are covered too because the query is shared. Nothing resolving at all stays a retryable failure.
- B9a, ready to pay. The notice no longer drops the actor of its event, and it is worded as the reader's own next step. This replaces the step-journey spec §11 rule for this one notice. Every other claim notice keeps the no-self-notice rule.
- Whose turn it is (owner, 2026-10-01 evening: "แจ้งเตือนไปเจ้าของตลอดแบบนี้น่ารำคาญ"). Action notices go to the person whose turn it is, not to everyone who holds the right. A notification action may name payload fields in order of preference (`preferRecipientPayloadKeys`); the first one that names somebody able to act narrows the permission group to them, and when none does the whole group stands. `neverPreferRecipientPayloadKeys` names people who are never the preferred ones but stay in the whole group. A rule snapshot without the key behaves as before.
  - Ready to pay: (a) the actor of the event when not the requester (approver, finance reviewer, or whoever filed on someone's behalf a claim that needed no approval); (b) for a claim that needed no approval, the people who would have approved it under the policy; (c) everyone able to record the payment.
  - Payment reminder: the finance reviewer who passed the claim, else whoever approved it in the round it was last sent in, else everyone able. The scan reads this from the claim's own records.
  - `approval_sla_breach` and the pending-approval notice are unchanged.
- B9b, payment voided. New auto-enabled template `reimbursement_payment_voided`, trigger key `workflow.reimbursement_payment_voided`. No amount and no void reason in the text (the reason is free text).
- B9c, reminder. New auto-enabled SLA_SCAN template `reimbursement_payment_sla_breach`, trigger key `workflow.reimbursement_payment_sla_breach`. Same scan job, same policy deadline (`slaHours`) and same rule cooldown as approvals. A notice only, no task. It skips quietly when nobody can pay right now (`skipWhenNoRecipients`), because a scan would otherwise dead-letter every window.
- Reminder deadline (owner): there is NO default. A company that set no deadline in its claim policy is not reminded, for approvals or for payments. Nothing to build.
- B15, code words. `decision` is put into Thai before any template is rendered, in the action runner, so an old or admin-edited rule snapshot cannot print it. The read-time repair covers notices already stored. BLOCKED on the finance notice is covered by the same map.
- B8, tasks. The event handler closes the open tasks of the two approval templates when the claim is no longer PENDING_APPROVAL: DONE after approval, CANCELED after reject, cancel or a return to draft. A resubmission supersedes older tasks first. Best effort, never fails the event. The release task's `sync-workflow-templates.ts` runs the same closing over every company (idempotent), which is the clean-up of old tasks.
- B10, paid event. Written inside `recordPaymentAtomic` through an `onPaymentPersisted` callback. The payment audit row is still written after commit.
- Reimbursements module edits: (1) the void event also carries `requestNo` and `requesterUserId`; (2) going back to draft writes a new event `reimbursement.reopened` in the same transaction; (3) B10 as above; (4) the ready-to-pay event of a claim that needed no approval carries `approverRecipientUserIds`, from a new read-only method `resolveWouldBeApproverUserIds` on the approver route resolver, written by the live submit and by the projection reconciler alike.

Integrator steps:

- Add `workflow.reimbursement_payment_voided` and `workflow.reimbursement_payment_sla_breach` to `ALWAYS_DELIVERED_TRIGGER_KEYS` (decided by the owner side; the constant lives on the payout Phase 1 branch and its spec pins the list, so update that assertion too). Until then a user with a saved preference row gets these two only on the web bell, not on LINE.
- Unify `PrismaWorkflowRepository.findClaimApprovers` with `isReimbursementPayoutParty` from the payout assembly: both mean the decider of the claim's latest APPROVED step still in force.

Open questions:

- SLA tasks pile up. `approval_sla_breach` creates a new task every scan window while a claim stays overdue. They are all closed when the claim moves on, but creation is not deduplicated. Not changed here.
- `RecordReimbursementPaymentUseCase` keeps its now unused `outbox` constructor argument so call sites in parallel lanes keep compiling.
- Amounts in notices still print the raw figure and "THB" (audit W15, payout plan Phase 4).
- The reconciler replays a claim that needed no approval with `decision: 'APPROVED'` and the requester as actor, where the live submit writes `BELOW_APPROVAL_THRESHOLD` and the submitter. Older than this lane and not changed; the new `approverRecipientUserIds` field is consistent in both.

Artifacts:

- Code: `apps/api/src/modules/workflow/**`, `apps/api/src/modules/dashboard-notifications/**`, `apps/api/prisma/sync-workflow-templates.ts`, and under `apps/api/src/modules/reimbursements/**` the repository, the finance, request and policy use cases and the projection reconciler.
- Specs: `docs/specs/reimbursement-step-journey-spec-th.md` §11 and AC11; `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` §17.3.
- Audit: payout impact audit 2026-10-01, §3 rows B8, B9, B10, B12, B15.

Verification: see the hand-off report of each round for the numbers. In short: API typecheck, the touched and neighbouring spec files, the boot DI smoke (constructors changed), test merges against develop and the payout lanes. Each fix was run against the previous code first and failed there. Not run: real PostgreSQL specs, e2e, anything in a browser.

Next:

- Release: the workflow template sync in the release task creates the two new rules, re-pins the changed ready-to-pay rule where no admin edited it, and closes stale tasks. Rules an admin edited keep their old text and their old recipients.
