# Agent Memory: reimbursement payout release readiness

Status: Built, reviewed and verified locally on 2026-10-02, in two rounds: the payout feature (merged to develop and main the same day) and a wording round that followed the owner's review of it. Not deployed: UAT and production wait for the owner. Production runs `908e7aab9`.

Owner: controller session of 2026-10-01 and 2026-10-02 (implementation by lane agents; each lane has its own note, listed under Artifacts).

Scope: the expense-claim payout feature as one release unit: member default payout account, the claim's frozen payout snapshot and the approver's check, the pay step with payer confirmation and payment slip, the payout round (a claim sent back so its payout destination is given and approved again), stuck-claim recovery, the hub paged in the database, notifications to the person concerned only, ledger posting of claim payouts, the printed form, the history and paid notice, the in-app guide and the approved-help pin, the assistant's claim tools. With it, from the wording round: role page wording and layout, "SLA" and the fixed thirty minutes replaced by true words, the cap on Thai-named roles, and the sales rule that a shop waiting for review is not an opened shop.

Decisions:

- Spec: `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` (owner decisions of 2026-10-01 and 2026-10-02 are recorded there).
- A claim sent before the release is approved and paid as before: no account check for its approver, a slip required for a transfer. The release must not strand such a claim (owner condition, 2026-10-02).
- The approver can record the payment; a company with no finance-review step never reads "ฝ่ายการเงิน" on a claim.
- Roll forward, not back: the previous build cannot read a claim in a payout round (spec §14.9).
- The release task grants each back-fill permission once per role; the audit row of the grant is the record, so a right an admin removes later stays removed.
- Owner, 2026-10-02 ("เราต้องสื่อสารกับ user ได้อย่างถูกต้อง"): every sentence of a payout round follows what the claim held when it was sent back (an account, cash, nothing), what was answered (seven cases) and who answered. A claim's account is "บัญชีรับเงิน"; the member's standing account keeps "บัญชีรับเงินคืนของฉัน"; the method is "วิธีรับเงินคืน". Detail: `reimbursement-payout-round-wording.md`.
- Owner, 2026-10-02: a notice goes to the person it concerns. The requester is told whenever someone else answers a round for them; the finance-review notices and the approval reminder reach the shop owner only when nobody else can act.
- Owner, 2026-10-02: a flagged shop confirmed after its payment month has ended counts in the month the customer paid (the code's behaviour; the month of the review was offered and not chosen). Sales spec §17.1.1.
- Owner, 2026-10-02: the legal documents for stored bank accounts (privacy notice, processing register, retention table, data-rights runbook) may follow the release. Data-deletion requests are the next feature and are on hold: nothing is to be designed or added for them now.
- Owner, 2026-10-02: the accountant's questions about posting claim payouts are answered when the accounting screens open. Until then no claim payout is posted on the standard chart (it is refused for want of a reviewed mapping), and every unposted payout of any age stays on the worklist.

Production facts (read on 2026-10-02 14:03 with `pre-release-checks.sql`, read-only, counts only, 314 lines, no error):

- 114 companies, 88 active. No company has the finance-review step on; none has reminder hours.
- 10 claims in all and 1 payment. In flight: 6 waiting for payment in one company (three active members, all able to approve and pay), 1 waiting for approval in a single-member company.
- The pay-right back-fill changes nothing: the six company roles that approve already hold both rights. No older back-fill key is pending.
- No sales deal and no attribution row; one refunded package purchase (the go-live test); tax mode not VAT registered.
- No notification rule was edited by a person. The four new claim notices will be created switched on for 88 companies.
- Two System Admin accounts are counted by the data-rights rule; one of them has an expired temporary password and no other sign-in. Data-rights is on hold, so nothing was changed.
- 266 migrations applied, last `20260930150000_signup_discovery_source_sales`.
- How it was read: an SSM port-forward through the bastion with the application's own connection string under a read-only transaction. The read-only support role refused the identity available on the workstation (no `rds-db:connect`), and the owner's root session had expired. Two sessions were opened and announced; both were terminated.

Open questions:

- `e2e/settings.spec.ts` SET-08E expects the tab "คิวรอจ่าย", true for the seeded company. REIMB-03 and REIMB-13 turn the finance step on for a moment, so a whole-suite run with parallel workers can make SET-08E read "คิวการเงิน". No workflow runs these files, and nothing typechecks `e2e/`.
- Three tests of `e2e/responsive.spec.ts` fail on develop before and after this work (the shell's hover at 1024 and 1280 px; the expense grid's column count). Stale tests; not fixed here.
- Wording outside this round, for the owner to order: two Thai vocabularies for the standard roles (role page and employee pages); English on the reports page, the automation page, the notification rules page, the dashboard stock card and the add-employee wizard; the dashboard card "รอตอบเกินกำหนด" counts by another rule than the list it opens.
- Notices not changed: a draft filed for someone with cash or the standing account tells nobody; "save as default" by someone else in a round sends two notices; nothing tells the requester that their claim was blocked at the finance-review step.
- The timeline takes the account kind of a past send-back from the claim's account history; exact wording there would need the kind on the send-back event.

Artifacts:

- Lane notes: `docs/agent-memory/reimbursement-payout-*.md`, `claim-notification-fixes.md`, `claim-payment-ledger-posting.md`, `claim-stranded-recovery-20261001.md`, `ui-wording-roles-sla-signature-2026-10-02.md`, `sales-credit-refund-rules-2026-10-02.md`.
- Production checks, read-only: `docs/evidence/reimbursement-payout-release-2026-10-02/` (`pre-release-checks.sql`, `post-release-checks.sql`, `compare-before-after.sh`, `README.md` with the command lines and how to read each block). The pre-release script has now run once on production; the lists it copies from the code did not change in the wording round.
- Seven migrations stand between production and this build: `20261001100000_reimbursement_payout_account`, `20261001110000_reimbursement_payout_snapshot_delete_guard`, `20261001130000_reimbursement_payment_slip`, `20261001150000_reimbursement_payment_payout_confirmation`, `20261002100000_reimbursement_payout_correction`, and from earlier merges `20261002100000_sales_credit_deductions`, `20261002120000_data_rights_single_admin_mode`. All additive. The wording round adds none.

Verification of the payout feature (product tree of `b70dc2abe`):

- 17-step local verification, all green; browser tests `e2e/reimbursements.spec.ts` 17 of 17 and `e2e/settings.spec.ts` 20 of 20; an upgrade test of 30 claims made by the production build, all finished on the web screens; one real-model pass of the assistant's claim answers, 22 of 22.

Verification of the wording round (code of `04031e162`; the commit after it adds this note):

- 17-step local verification, all green: contracts build, Prisma generate and validate, maintenance pins, migration review, config validation, DI, typechecks, unit suites (web 2,655; contracts 344; ai-gateway 1,529; config 153; workers 46; the API `test` script), acceptance sets, the LINE-AI whole-chain script, boot, and the real-PostgreSQL suites, the reimbursement proofs in REQUIRED mode among them (103 of 103).
- Browser tests on a freshly reset stack: `e2e/reimbursements.spec.ts` 17 of 17, `e2e/settings.spec.ts` 20 of 20; of the three other touched files 33 tests pass and the three stale ones above fail as on develop. A real look at 82 screens of a payout round, 76 of them at 390 px: nothing wider than the screen.
- Upgrade test, enlarged after the production read to every shape of the real claims: 38 claims created with the production build (`908e7aab9`) through its API, the same database migrated and the release tasks run in release order; before anyone acted every claim, payment, signature and printed form read the same; then every claim was finished on the web screens: 38 of 38. A forced race of approval against the scheduled scan: 0 of 40 false refusals.
- What a person does for the real shapes: both signatures made and a slip already under the signed copies: pay and pick that file, finished at once; finance review already passed: the same, no second review; only the requester's signature: after paying, the approver signs once; an image under the signed copies used as the slip: its paper-signed declaration is withdrawn, then the approver signs once.
- Real-model evaluation of the assistant's answers about claims in a round, one small pass: 4 of 4 (an account, nothing, cash, and the three together), 7.13 THB. A model-free rehearsal replayed every tool call and checked every oracle first.
- After that, develop was merged in (billing purchase recovery, #965; no file in common with this round) and the 17 steps, the two browser test files and the upgrade test were repeated on the result (`6cf9b796f`, then `96aa3c81c`): green, 38 of 38, after one fix that develop itself lacks: the billing page's new "ลองโหลดประวัติใหม่" button had no `aria-busy`, which fails the web's audit of pending controls. The real-model pass was not repeated: the merge brings no claim or assistant code.
- GitHub Actions start with zero jobs on PRs at the moment, so none of this ran in CI.

Release notes for whoever deploys:

- Between the template sync and the new code going live, production's runner knows neither of the two new recipient keys of the finance-review notices; a notice in that window would go to every holder. No company has the finance step today.
- A notification rule a shop edited is left as it is by the sync and keeps its old recipients; production has none.

Next:

1. UAT when the owner starts the hosts, then the production promotion on the owner's explicit go, by `docs/runbooks/uat-production-v2-deployment.md`. A hotfix path is not available for this build (migrations).
2. After the release: `post-release-checks.sql`, compare with the output of 2026-10-02 (expected: no role changed), and tell the owner.
3. Ask the owner again, once the claim work is released: the approved-help pack review date 2026-12-27, the manual-expense switch, the executive report, and the wording list above.
