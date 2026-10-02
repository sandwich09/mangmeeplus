# Agent Memory: reimbursement payout release readiness

Status: Built, reviewed and verified locally on 2026-10-02. Not deployed: UAT and production wait for the owner. Production runs `908e7aab9`.

Owner: controller session of 2026-10-01 and 2026-10-02 (implementation by lane agents; each lane has its own note, listed under Artifacts).

Scope: the expense-claim payout feature as one release unit: member default payout account, the claim's frozen payout snapshot and the approver's check, the pay step with payer confirmation and payment slip, the payout-account correction round, stuck-claim recovery, the hub paged in the database, notifications to the person concerned only, ledger posting of claim payouts, the printed form, the history and paid notice, the in-app guide and the approved-help pin, the assistant's claim tools.

Decisions:

- Spec: `docs/specs/reimbursement-payout-account-and-payment-slip-spec-th.md` (owner decisions of 2026-10-01 and 2026-10-02 are recorded there).
- A claim sent before the release is approved and paid as before: no account check for its approver, a slip required for a transfer. The release must not strand such a claim (owner condition, 2026-10-02).
- The approver can record the payment; a company with no finance-review step never reads "ฝ่ายการเงิน" on a claim.
- Roll forward, not back: the previous build cannot read a claim in a correction round (spec §14.9).
- The release task grants each back-fill permission once per role; the audit row of the grant is the record, so a right an admin removes later stays removed.

Open questions:

- Production facts not read yet (need the owner's go for a read-only session): which company roles gain the pay and void rights, how many members hold them, claims in flight and their shape, notification rules a person edited. The scripts are ready (Artifacts).
- Wording left as it is, all in rare paths: a round on a claim that never had an account says "เพิ่ม" in some places and "แก้" in others (the phase label is shared with the assistant's backlog answer); the send-back form of such a claim still lists the five reasons that presume a wrong account; the approver's compare card is titled "สิ่งที่เปลี่ยน" when the requester kept the same account.
- `e2e/settings.spec.ts` SET-08E expects the tab "คิวรอจ่าย", true for the seeded company. REIMB-03 and REIMB-13 turn the finance step on for a moment, so a whole-suite run with parallel workers can make SET-08E read "คิวการเงิน". No workflow runs these two files, and nothing typechecks `e2e/`.
- Outside the claim screens, not done: the role page matrix scrolls sideways at every width and has English labels; the dashboard card says "เกิน SLA".
- For the accountant and for legal review: the posting accounts of a claim payout; the privacy notice for stored bank accounts.

Artifacts:

- Lane notes: `docs/agent-memory/reimbursement-payout-*.md`, `claim-notification-fixes.md`, `claim-payment-ledger-posting.md`, `claim-stranded-recovery-20261001.md`.
- Production checks, read-only: `docs/evidence/reimbursement-payout-release-2026-10-02/` (`pre-release-checks.sql`, `post-release-checks.sql`, `compare-before-after.sh`, `README.md` with the command lines and how to read each block). Proven on local copies only.
- Seven migrations stand between production and this build: `20261001100000_reimbursement_payout_account`, `20261001110000_reimbursement_payout_snapshot_delete_guard`, `20261001130000_reimbursement_payment_slip`, `20261001150000_reimbursement_payment_payout_confirmation`, `20261002100000_reimbursement_payout_correction`, and from earlier merges `20261002100000_sales_credit_deductions`, `20261002120000_data_rights_single_admin_mode`. All additive.

Verification (product tree of `b70dc2abe`; the commits after it change one e2e line and add docs):

- 17-step local verification, all green: contracts build, Prisma generate and validate, maintenance pins, migration review, config validation, DI, typechecks, unit suites (web 2,598; contracts 344; ai-gateway 1,529; config 153; workers 46; the API `test` script, 11,532 at its last count), acceptance sets, the LINE-AI whole-chain script, boot, and six real-PostgreSQL suites (169 tests, none skipped), the reimbursement proofs in REQUIRED mode among them (101 of 101).
- Browser tests on a freshly reset stack: `e2e/reimbursements.spec.ts` 17 of 17, `e2e/settings.spec.ts` 20 of 20.
- Upgrade test: 30 claims of every shape were created with the production build (`908e7aab9`) through its API; the same database was migrated and the release tasks run in release order; before anyone acted every claim, payment, signature and printed form read the same; then every claim was finished on the web screens at 390 px: 30 of 30. The owner's case (ready to pay, both signatures made, a slip misfiled under the signed copies) finishes in one step for every approver variant, including approvers who could approve but not pay under the old build. A forced race of approval against the scheduled scan: 0 of 40 false refusals (7 of 40 before the scan learned to skip decisions younger than one minute).
- Real-model evaluation of the assistant's claim answers, one pass: 22 of 22 (two new states among them: a claim with its requester for the account, a claim being cancelled), 23.10 THB. A model-free rehearsal on the same build replayed every tool call and checked every oracle first.
- GitHub Actions start with zero jobs on PRs at the moment, so none of this ran in CI.

Next:

1. With the owner's go: the pre-release read-only checks on production (announce the session first; it emails a security alert).
2. UAT when the owner starts the hosts, then the production promotion on the owner's explicit go, by `docs/runbooks/uat-production-v2-deployment.md`. A hotfix path is not available for this build (migrations).
3. After the release: `post-release-checks.sql`, compare with the first output, and tell the owner which roles gained the pay right.
4. Tell the owner before early December: the approved-help pack review date is 2026-12-27.
