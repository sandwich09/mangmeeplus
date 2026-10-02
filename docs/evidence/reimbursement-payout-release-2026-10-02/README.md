# Production checks for the payout release

Two read-only SQL scripts for one short `psql -f` session each.

| File | Run on | When |
|---|---|---|
| `pre-release-checks.sql` | production schema (build `908e7aab9`) | before the release |
| `post-release-checks.sql` | upgraded schema (new build; rules read at `19fe51537`, unchanged in the merged head) | after the release tasks finished |
| `compare-before-after.sh` | the two output files (no database) | after the second run |

Both scripts were proven on local copies (see "How they were proven"). `pre-release-checks.sql` has since run once on production, on 2026-10-02 at 14:03 Bangkok time, with the owner's permission: read-only, 314 lines, no error, script time 3.9 s; what it found is in `docs/agent-memory/reimbursement-payout-release-readiness.md`. `post-release-checks.sql` has not run on production.

On that day the read-only support role (`watchdog_support_ro` with an IAM token) refused the identity available on the workstation, so the script ran through an SSM port-forward with the application's own connection string, under `default_transaction_read_only=on` and the script's own READ ONLY transaction. Every such session mails the owner a security alert: announce it first, keep it to seconds, terminate it, and check that no session is left active.

## Command lines

Password from the environment (`PGPASSWORD` exported by the caller), never in a file. `-X` ignores any `~/.psqlrc`, `-w` never prompts.

```sh
PGOPTIONS='-c default_transaction_read_only=on' PGSSLMODE=require PGCONNECT_TIMEOUT=10 \
  psql -X -w -h <host> -p <port> -U <user> -d <db> -f pre-release-checks.sql  > pre-release-output.txt  2>&1

PGOPTIONS='-c default_transaction_read_only=on' PGSSLMODE=require PGCONNECT_TIMEOUT=10 \
  psql -X -w -h <host> -p <port> -U <user> -d <db> -f post-release-checks.sql > post-release-output.txt 2>&1

./compare-before-after.sh pre-release-output.txt post-release-output.txt
```

On this laptop `psql` 18.4 is at `/opt/homebrew/opt/libpq/bin/psql` (not on `PATH`). Locally the scripts were run with exactly this line, without `PGSSLMODE`.

After each run, before closing the session:

```sh
grep -c 'ERROR' pre-release-output.txt     # must print 0
tail -2 pre-release-output.txt             # must show "##### end of pre-release-checks.sql #####" and ROLLBACK
```

A block that fails prints its `ERROR` and the script goes on with the next block (`ON_ERROR_ROLLBACK`), so one bad block never costs a second session. A statement slower than 20 s is cancelled the same way.

## Run time

| | dump copy (3 companies, 31 claims) | bulk copy (303 companies, 3,033 members, 3,031 claims, 520,763 audit rows) |
|---|---|---|
| `pre-release-checks.sql` | 0.13 s | 0.61 s |
| `post-release-checks.sql` | 0.14 s | not run (its statements are block 9 again plus index reads of the audit table) |

Wall clock of the whole `psql` command locally: about 0.1 s. The last table of each output prints `script_seconds`.

## Why they cannot write

- First statement `BEGIN TRANSACTION READ ONLY`, last statement `ROLLBACK`, and `default_transaction_read_only=on` on the connection.
- Statements in the files: `BEGIN`, two `SET LOCAL`, 27 (`pre`) and 17 (`post`) `SELECT`/`WITH … SELECT`, `ROLLBACK`. No temp table, no `FOR UPDATE`, no sequence call, no function with a side effect, no `COPY`.
- Measured locally: the server's WAL position and the row-change counters were identical before and after running both scripts.
- `\set` lines only define pieces of SQL text that psql pastes into the statements (`co`, `gain`, `act`, `mp`, `bare`, `since`, `g`); they create nothing in the database.

## What is printed, and what never is

Counts, sums in satang or baht, Bangkok months, statuses, claim numbers, role keys and role names, permission keys, setting values, and ids cut to 8 characters (company, deal). An account is `admin #1`, `admin #2`. A company is its first 8 characters; `#1`, `#2` is added only when two companies share those 8 characters (locally both test companies start with `seed-loc`).

Never printed: names, e-mails, usernames, phones, LINE ids, user ids, bank account data, reasons, notes, descriptions, file names. Tested: 241 such values stored in the local copies, none found in any output file.

## Script 1, block by block: how to read it, and what is a warning

| Block | How to read the answer | A warning is |
|---|---|---|
| 1a pay-right table | One line per company role that gains `reimbursement.payment.record` and/or `.void` at the release: company, role key and name, whether the company made it or edited a system role, what it gains, how many active members hold it. | A role nobody expected on the list, or one with many members: each of them can record and void claim payments after the release. A `DISABLED` role also gains the keys (the task does not look at status). |
| 1b totals | Roles, companies and people changed. Must equal B2 after the release. | `company_roles_that_approve` larger than `roles_changed` is fine: the rest already hold both keys. |
| 1c system roles | Expected 0 rows. | Any row: a system role in production lacks a key the code grants; the registry sync adds it without an audit row. |
| 1d back-fill table | Every key the same release task adds to company roles, roles per key. The two `reimbursement.payment.*` lines repeat 1b. | Any other line: an older back-fill key is missing on that many roles (role made or edited since the last deploy) and comes back now, with an audit row each. Large numbers deserve a look before the release. |
| 2a | The number the data-rights single-admin mode counts. `1` = one person may take a step alone, with a reason. | `0` = nobody can take a data-rights step. `2` or more = the two-person rule stands and a self-step is refused. |
| 2b | One line per account holding the system role: counted or not, statuses (membership/company/role), credential status, sign-in methods. `counted = no` with credential `DISABLED` is a retired admin. | An account counted `yes` that should not be able to sign in; or counted `yes` with `temporary password expired` and no other method (counted, yet locked out). |
| 3a | Deals whose stored menu list names a parent menu with none of its submenus. `changed_by_the_new_rule` = deals whose list the new build expands. | `of_them_paid_or_applied` above 0: those shops paid for a menu and got every submenu switched off. `of_them_still_open` above 0: an open offer changes (the customer is asked to re-check at checkout). |
| 3b | The deals (8-character id, status, month, the stored keys). Not printed when 50 or more. | – |
| 3c | Companies of paid or applied deals: is the deal the current contract, and which bare parent is still "menu on, every submenu off" today. | Anything but `none` in the last column: the release does not repair it; the menus of that company need a manual fix. |
| 4 | Roles holding `expense.delete` without `expense.update`, and people: holding such a role; of them with no other role giving update (they really got the refusal); people refused because their shop has the manual-entry menu off. | `system_roles` above 0 (the code gives system roles both keys). The other numbers say how many people get a working delete button. |
| 5 | Per payment month: attribution rows, flagged and reviewed (cut out of the total by the new build), flagged and waiting, flags cleared by review; satang that leave the month's total at release; rows already carrying a refund. | `satang_leaving_the_total_at_release` above 0 in a month already reported to the sales team: that month's figure drops at release. |
| 6a | Each dated change on a paid invoice: money went back, dispute opened; split by 60 days from the payment. | `later_than_60_days` above 0 (takes no credit back). Any `dispute opened`. |
| 6b | Paid invoices per payment month: with a refund, refunded in full, disputed. Last column: refunds or disputes that have no dated change in 6a. | Last column above 0: for those the date is unknown to the database. |
| 6c | Refunds made from the admin screens, by state, with the 60-day split. | A state that is not final (`QUEUED`, `RUNNING`, `UNKNOWN`, `BLOCKED`, `AWAITING_APPROVAL`): a refund in progress during the release. |
| 6d | Refunds and disputes the provider told the system about, by status. | `open` disputes; `with_an_event_not_processed_yet` above 0. |
| 7a | Tax mode in force and whether a provider tax rate is attached. | `(not set)`, or a mode the owner does not expect. |
| 7b | Paid invoices by the tax mode frozen in their contract: how many have total = subtotal + tax, total = subtotal, tax on top of the price, total = the price. | `tax_added_on_top_of_the_price` above 0: referral credit of the new build is the total minus that tax. `another_amount` = discount or proration. `(no contract snapshot)` rows count as "no tax on top". |
| 8a | Workflow notification rules a person made or edited, per trigger, with `ALL` lines. `keep_their_own_definition` = rules the release will not re-pin. | `keep_their_own_definition` above 0 on a `claim` line: that shop keeps the old wording and recipients of that notice. |
| 8b | For each of the four new claim notices: how many active companies get it switched on, switched off, or already have it. | `to_be_created_switched_off` above 0: those shops get no such notice until an admin switches it on. |
| 8c | Bell rules (`NotificationRule`) edited by an admin, per trigger. | – (the release does not touch them) |
| 9 table 1 | Claims not finished, by company and status. | `cancellation_pending` above 0. |
| 9 table 2 | Each claim waiting for payment: approval steps, receipts per line, files on the claim, signed copy, signatures, whether its approver can record the payment today and after the back-fill, finance step (company and the claim's frozen policy), payments, reminder. | `approver_can_pay_after_back_fill = no`; `cancellation_pending = yes`; `OVERDUE` (a payment reminder goes out at the first scan after the release); `PARTIALLY_PAID`; a shape the upgrade test did not finish. |
| 10 | Per company: finance step, reminder hours, active members, who can approve, who can record a payment today and after the back-fill, claims in flight. | `can_record_payment_after_back_fill = 0` with `waiting_for_payment` above 0: nobody can pay. `reminder_hours` set: payment reminders start with the release. |
| 11 | Server version, last applied migration, row counts. | Last migration not `20260930150000_signup_discovery_source_sales`; `not_finished_or_rolled_back` above 0. |

## Script 2, block by block

| Block | How to read the answer | A warning is |
|---|---|---|
| A migrations | Seven lines, each `applied`, with start and finish in Bangkok time. | `MISSING`, `NOT FINISHED`, `ROLLED BACK`; or a line with `expected = no` (a newer migration this list does not know). |
| B1 pay-right table | The roles the back-fill really gave a pay right to in this release (from the audit row it writes with each grant). Same columns as 1a. | Any difference from 1a (`compare-before-after.sh` shows it). |
| B2 totals | Same columns as 1b. | Numbers different from 1b. |
| B3 | Roles that approve claims but lack a pay right now. Expected 0 rows. | A row: the role was left out because a right had been granted before, or an admin took the right away since. Its claims stop at the pay step for that approver. |
| B4 back-fill table | Every key the task added to company roles, roles per key. Same columns as 1d. | Any difference from 1d. |
| C1 | Claims in a payout-correction round: waiting for the requester, waiting for the approver again, and the `ALL` line. | **`ALL` above 0 before a rollback.** The old build has no such state: it reads the claim as waiting for approval. Finish or clear those rounds first. |
| C2 | Claims with a pending cancellation; claims decided and waiting for the system, with the oldest time. | A "waiting for the system" line that stays above 0 for more than a few minutes (the scheduled run takes decisions older than one minute). |
| D | Counts: default payout accounts by method, claims by payout method, account snapshots, payments with a slip, with a payer confirmation, paid by another method, voided. | Right after the release everything new is 0 and every claim reads `none: claim of before the release`. Later: payments by transfer without a slip. |
| E1 | Sales credit deduction rows by month recorded and kind. | Rows right after the release (nothing is back-filled). |
| E2 | Data-rights steps one person took alone. | More self-steps than the owner took. |
| F | The same two tables as block 9. | See comparison below. |
| G | The four new notices: `have_it_switched_on` / `have_it_switched_off` per notice. | Not equal to 8b's `to_be_created_switched_on` / `…_off`; any `to_be_created_*` still above 0 (the task did not reach that company). |
| Z | Last applied migration must be `20261002120000_data_rights_single_admin_mode`. | `not_finished_or_rolled_back` above 0. |

## Comparing before and after

`./compare-before-after.sh pre-release-output.txt post-release-output.txt` prints `SAME` or `DIFFERENT` for three tables:

- pay-right table (1a = B1) and back-fill table (1d = B4): must be `SAME`. The prediction and the audit rows of the release agree line by line.
- claims in flight (9 = F): `DIFFERENT` is expected in one column only: `approver_can_pay_today` turns from `no` to `yes` on the claims whose approver was back-filled, and it must then equal the `approver_can_pay_after_back_fill` column of the run before. Any other changed line is a claim that moved between the two runs.

## What the database cannot answer

| Question | What is stored | What would be needed |
|---|---|---|
| Disputes by status (won, lost, under review) | `BillingInvoice.disputed` (true/false) and the event types received (created, updated, closed) | The provider's dispute objects (status, reason, amount). The new build reads them at observation time; the old schema keeps none of it. |
| The date of each refund | Only the running total `refundedSatang`. 6a uses the time this system noticed the change (its audit row), which is the clock the old build's 60-day rule used. | The provider's refund list (its own time per refund). From this release on it is stored in `SalesAttributionDeduction.occurredAt`. |
| The exact payment time of an invoice | No column. The scripts use the invoice row's creation (the moment the payment was verified), or the attribution's `paidAt` when the invoice has one. | The provider invoice's paid time. The difference is minutes; it matters only on day 60. |
| The tax rate as a number | The mode (`taxTreatment`) and the id of the provider's tax rate. | The provider's tax-rate object. The mode names carry "7". |
| Whether a file under "signed copy" is a signed form or a misfiled slip | Purpose label and file type only (the owner's case reads `claim_form.signed: image 1, PDF 1`). | Opening the file. |
| Whether a counted System Admin can really sign in | Statuses and which methods exist. | LINE-side state and the mailbox are outside the database. |
| Whether an approver is inside the claim's branch | Block 9 and 10 read role rights only. | The member's branch scope against the claim's branch (not evaluated). |

## Lists copied from the code (update them if the new build moves)

Generated from the new build at `19fe51537` (none of these lists changed between that commit and the merged head): the 24 back-fill keys and their anchors (1d, B4), the four system roles holding the pay keys (1c, B3), the nine menus with submenus and how many a deal may sell (3), the four new notices and the notices they follow (8b, G), the seven migration names (A). Block A marks a newer migration it does not know with `expected = no`.

## How they were proven (local Docker only)

Container `prodchk-pg-20261002` (PostgreSQL 18.3), five databases, removed at the end:

1. `watchdog_bms`: the dump of build `908e7aab9` as it is. `pre-release-checks.sql` -> `sample-output-pre.txt`.
2. `watchdog_bms_upgraded`: the same dump + the new build's `prisma migrate deploy` and release tasks in release order. `post-release-checks.sql` -> `sample-output-post.txt`.
3. `watchdog_bms_edge`: the dump + made-up rows for every block the dump leaves empty (odd roles, five admin accounts, seven deals, invoices of every tax mode, refunds, disputes, flags, edited rules). -> `sample-output-pre-edge.txt`; every number was checked against what was planted.
4. `watchdog_bms_edge_upg`: copy 3 + the release tasks + rows in the new tables. -> `sample-output-post-edge.txt`.
5. `watchdog_bms_bulk`: copy 3 enlarged about a hundred times, for run time and `EXPLAIN` (`explain-heaviest-block.txt`).

Proofs: `proof-block-1.txt` (roles predicted on the production schema = role permissions the release tasks really added: 4 of 4 on the dump, 15 of 15 on the odd roles), `proof-block-2.txt` (block 2a = the application's own Prisma count), block 8b = block G on both pairs, `compare-before-after.sh` on both pairs.

## Files

- `pre-release-checks.sql`, `post-release-checks.sql`: the two scripts.
- `compare-before-after.sh`: compares two output files (no database).

The local proof files (sample outputs on the dump and on copies with made-up rows, the `EXPLAIN` of the heaviest block, the two proofs) were kept outside the repository with the session that wrote the scripts; rerun the proof the same way if a list below is regenerated.
