# Agent Memory: reimbursement-multi-payout-accounts

Status: In progress on `claude/multi-payout-accounts-20261005` (from `develop` `afcbdbaa9`). Spec and plan written 2026-10-05; implementation by Codex lanes with controller review. Not deployed.

Owner: Controller (Claude) wrote the reconciled spec and plan, reviews and runs everything; implementation by Codex lanes (`xhigh` for the money and permission rules, `high` for screens).

Scope: several saved payout accounts per member, the requester's choice of account per claim, and accounts of other people (outsiders included) with the approver's explicit acceptance. Built on the payout account and slip feature that is already live (`docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md`).

Decisions:

- Owner, 2026-10-05, to the controller: "แก้เรื่องนี้เพิ่มหน่อย # Spec: หลายบัญชีรับเงินคืน และผู้เบิกเลือกบัญชีต่อใบ". The same day he had told the design session (recorded in `reimbursement-recipient-bank-account.md` of that session, kept verbatim in the reconciled spec §2.1): several accounts in the first round with the requester choosing at claim time; "รวมบัญชีบุคคลอื่นได้ เมื่อผู้อนุมัติตรวจและยอมรับ"; "เพิ่ม บัญชีใครก็ได้ได้ ที่ไม่ได้อยู่ในระบบได้ บางครั้ง ต้องเบิกคืนคนที่ไม่ได้อยู่ใน บ".
- The design session's spec, plan and audit were written from the shared checkout, whose working tree predates the payout feature (#962/#963; its schema has neither `MemberPayoutAccount` nor `ReimbursementPayoutDestination`). They are kept in the repo with a note at the top. The controller reconciled them with the live feature: what is taken, what is not and why is in the reconciled spec §2.2 and §2.3.
- Controller's design calls (the owner delegated screen design on 2026-10-04; he was told all of these on 2026-10-05 and may overrule):
  - the default account stays preselected on a new claim (his D1 of 2026-10-01); the requester can change it on every claim;
  - the default account is always the member's own; another person's account is used only by choosing it on a claim;
  - a wrong account after approval is still corrected on the same claim (his D4), not cancel and reissue;
  - PromptPay and the full-number print for the three groups stay (his answers of 2026-10-01);
  - one required text for another person's account ("whose it is and how they relate") instead of a relationship field plus a reason per claim.
- Data model: a new table for the other saved accounts, and the default account table untouched, so the live default path (locks, tokens, legacy claims, the employee settings card) is not edited.

Open questions:

- Not in this round, told to the owner: reserving a payment so two people cannot both transfer; a substitute receipt or an expense whose recorded payer is another person still cannot be claimed by someone else.
- F08 of the design audit (a signed paper copy acknowledged against the request number only) is to be checked on current code in round 2 and reported.

Artifacts:

- `docs/specs/reimbursement-multi-payout-accounts-spec-th.md`, `docs/plans/reimbursement-multi-payout-accounts-plan-th.md`.
- The design session's documents, copied in with a note: `docs/specs/reimbursement-recipient-bank-account-spec-th.md`, `docs/plans/reimbursement-recipient-bank-account-plan-th.md`, `docs/research/reimbursement-multi-account-gap-impact-2026-10-05-th.md`.

Verification: none yet.

Next: round 1 (schema, contracts, saved accounts API), then rounds 2 and 3 in parallel, then the controller's integration and screen proof (plan).
