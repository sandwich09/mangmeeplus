# Agent Memory: claim-notification-fixes

Status: implemented on branch `claude/claim-notification-fixes-20261001` (from develop `f63ca3441`), not pushed, no PR. 2026-10-01.

Owner: Claude Code lane for the payout impact audit rows B8, B9, B10, B12, B15.

Scope: notification and task bugs around reimbursement claims. Production had six approved claims waiting for payment with nobody told. Changes stay in the workflow and dashboard-notifications modules, plus three small edits in the reimbursements module (listed under Decisions).

Decisions:

- B12, recipients who can act. A recipient picked by permission is put through the permission resolver (ACTIVE role, entitlement filter, branch scope) and checked against the branch of the claim or vendor bill the run is about. No second copy of the rule. Vendor bills are covered too because the query is shared. Nothing resolving at all stays a retryable failure.
- B9a, ready to pay. The notice no longer drops the actor of its event. An approver who can record the payment gets it, worded as the reader's own next step. This replaces the step-journey spec §11 rule for this one notice (spec updated). Every other claim notice keeps the no-self-notice rule.
- B9b, payment voided. New auto-enabled template `reimbursement_payment_voided`, trigger key `workflow.reimbursement_payment_voided`. No amount and no void reason in the text (the reason is free text).
- B9c, reminder. New auto-enabled SLA_SCAN template `reimbursement_payment_sla_breach`, trigger key `workflow.reimbursement_payment_sla_breach`. Same scan job, same policy deadline (`slaHours`) and same rule cooldown as approvals. A notice only, no task. It skips quietly when nobody can pay right now (`skipWhenNoRecipients`), because a scan would otherwise dead-letter every window.
- B15, code words. `decision` is put into Thai before any template is rendered, in the action runner, so an old or admin-edited rule snapshot cannot print it. The read-time repair covers notices already stored. BLOCKED on the finance notice is covered by the same map.
- B8, tasks. The event handler closes the open tasks of the two approval templates when the claim is no longer PENDING_APPROVAL: DONE after approval, CANCELED after reject, cancel or a return to draft. A resubmission supersedes older tasks first. Best effort, never fails the event. The release task's `sync-workflow-templates.ts` runs the same closing over every company (idempotent), which is the clean-up of old tasks.
- B10, paid event. Written inside `recordPaymentAtomic` through an `onPaymentPersisted` callback. The payment audit row is still written after commit.
- Reimbursements module edits: (1) the void event also carries `requestNo` and `requesterUserId`; (2) going back to draft writes a new event `reimbursement.reopened` in the same transaction; (3) B10 as above (`recordPaymentAtomic` and `RecordReimbursementPaymentUseCase`).

Open questions:

- Reminder deadline. Both reminders fire only where the company set SLA hours in its claim policy. The default policy has none, so by default nobody is reminded. A default deadline is an owner decision.
- Saved notification preferences. A preference row freezes the trigger list of the day it was saved, and the web screen has no per-trigger switch. Users with a saved row do not get LINE pushes for the two new keys (the web bell still shows them). The payout Phase 1 lane adds `ALWAYS_DELIVERED_TRIGGER_KEYS`; whether the two new claim keys belong there is an owner decision.
- SLA tasks pile up. `approval_sla_breach` creates a new task every scan window while a claim stays overdue. They are all closed when the claim moves on, but creation is not deduplicated. Not changed here.
- `RecordReimbursementPaymentUseCase` keeps its now unused `outbox` constructor argument so call sites in parallel lanes keep compiling.
- Amounts in notices still print the raw figure and "THB" (audit W15, payout plan Phase 4).

Artifacts:

- Code: `apps/api/src/modules/workflow/**`, `apps/api/src/modules/dashboard-notifications/**`, `apps/api/prisma/sync-workflow-templates.ts`, three files under `apps/api/src/modules/reimbursements/**`.
- Spec: `docs/specs/reimbursement-step-journey-spec-th.md` §11 and AC11.
- Audit: payout impact audit 2026-10-01, §3 rows B8, B9, B10, B12, B15.

Verification:

- API typecheck (native TypeScript, `tsconfig.typecheck.json`): pass.
- 27 spec files, touched and neighbouring (workflow, dashboard-notifications, reimbursements, access-control, spec-suite-coverage): 427 tests, 427 pass.
- Each fix was run against the previous code first and failed there.
- W00 manifest parity spec: pass. No changed file is in the hashed list, so the manifest was not regenerated.
- LINE-AI whole-chain acceptance: see the hand-off report of this lane.
- Test merges (`git merge-tree`) against develop and the three payout lanes: clean.
- Not run: real PostgreSQL specs, e2e, anything in a browser.

Next:

- Release: the workflow template sync in the release task creates the two new rules, re-pins the changed ready-to-pay rule where no admin edited it, and closes stale tasks. Rules an admin edited keep their old text.
- Owner decisions listed under Open questions.
