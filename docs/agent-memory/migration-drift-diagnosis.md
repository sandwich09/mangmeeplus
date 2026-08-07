# Agent Memory: migration-drift-diagnosis

Status: Diagnosis complete. Proposals **applied to the dev DB and landed in the repo** (2026-07-31,
owner-approved) — see "Applied outcome" at the end. UAT/prod untouched.
Owner: migration-drift forensics lane
Date: 2026-07-31
Repo HEAD: `83c369c1f282f6ebddcbb712791114424dd10ce7` (branch `develop`)
Scope: Diagnose + classify three pre-existing migration problems (P1 checksum drift, P2 orphan
migration row, P3 history-vs-schema divergence) and propose fixes. Read-only against the shared
dev DB; all destructive experiments confined to a scratch DB that was created and dropped.

---

## Method and ground truth

- Prisma checksum algorithm confirmed as **plain sha256 of `migration.sql` bytes**: 91 of the 96
  applied rows in the dev DB match their on-disk file exactly. That makes the 5 mismatches and the
  1 orphan real, not an artifact of a different hashing scheme.
- Full 96-migration history was replayed onto an empty scratch DB (`f0_drift_scratch`), then
  compared against both `schema.prisma` and the live dev DB.
- Catalog-level comparison (not just `prisma migrate diff`) between replay and dev DB:
  constraints, indexes (709), columns (3158), enums (232), triggers (6).

**Load-bearing caveat:** `prisma migrate diff` has no concept of CHECK constraints, so the two
genuine P1 differences are *invisible* to every Prisma drift report. They were only found by
diffing `pg_constraint` directly.

---

## P1 — Five migrations "modified after applied"

**Mechanism (four of five):** git holds exactly **one** version of each file across all refs *and
the reflog*, and it equals the on-disk file. The checksum recorded in the dev DB therefore
corresponds to a version that was **never committed** — applied by `prisma migrate dev` from a
local working-tree draft, then edited before the commit landed. The applied text is unrecoverable
from git; impact was established empirically instead, by catalog comparison.

| Migration | Commits | DB checksum matches | What actually changed | Verdict |
|---|---|---|---|---|
| `20260712110000_company_booking_buffer` | `3073e38e` only (2026-07-11 17:56:52Z) | no git version — pre-commit draft | Committed file **adds** `CHECK ("bookingBufferMinutes" IN (0,30,60,90,120))`; the applied draft had none | **REAL** |
| `20260712130000_crm_product_service_catalog` | `3073e38e` only | no git version — pre-commit draft | Committed file **tightens** `Product_bookingDurationMinutes_check` lower bound `30 → 60` | **REAL** |
| `20260718090000_h02_coa_company_or_system_check` | `a0ac5bae` only (2026-07-18 07:03:57Z) | no git version — pre-commit draft | Idempotency hardening only (`DROP CONSTRAINT IF EXISTS` + triage `DO $$` pre-check). File itself says "Idempotent: safe to re-run" | COSMETIC |
| `20260718160000_h07_procurement_approval_policy` | `a9e381aa` only (2026-07-18 09:37:25Z) | no git version — pre-commit draft | Idempotency hardening (`CREATE TABLE IF NOT EXISTS`, `IF NOT EXISTS` index, `EXCEPTION WHEN duplicate_object`). File says "Idempotent: safe if a dirty-tree deploy already recorded a partial apply" | COSMETIC |
| `20260728120000_stock_movement_single_reversal` | `1d3820a6` (2026-07-28 10:12:44Z) → `b6352550` (10:30:20Z) | `1d3820a6` version exactly | **Comment prose only**, no SQL change (git-proven diff) | COSMETIC |

**Empirical proof of the split.** Replay-vs-dev catalog comparison found exactly **two**
differences in the entire database, both CHECK constraints, both attributable to the two 07-12
migrations:

- `Company_bookingBufferMinutes_check` — present in replay, **absent in dev DB**.
- `Product_bookingDurationMinutes_check` — replay `>= 60`, dev DB `>= 30`.

Indexes, columns, enums and triggers are identical. h07's data backfill also landed in dev
(permission row present; both roles holding `…supplier_payment.create` also hold `…release`),
confirming its draft was functionally equivalent too.

---

## P2 — Orphan `20260712130000_crm_booking_canonical_customer` row

- The folder **never existed in git**. `git log --all --full-history` on that path returns
  nothing, and the `20260712140000` folder was added as `A` (add), not `R` (rename), in
  `3073e38e`.
- **Cause: timestamp collision.** `20260712130000` was already taken by
  `crm_product_service_catalog`. The canonical-customer folder was renamed to `20260712140000`
  locally — after it had already been applied to the dev DB at 2026-07-11 17:43Z, and before the
  commit landed.
- Content is byte-identical across the rename: on-disk sha256 `c03eb746…` equals the checksum on
  all three DB rows.
- The dev DB carries three rows: the orphan `130000` (applied, steps=1), a failed `140000` attempt
  (started 07-13 12:51Z, rolled back 07-18 06:42Z), and the correct `140000`
  (`resolve --applied`, steps=0, 07-18 06:42Z).
- **Scope: dev-DB-local only.** The `130000` name never existed in any commit, so no build
  artifact or deploy could have carried it.

---

## P3 — Genuine history ↔ schema divergence

Authoritative list: **26 statements / 20 logical changes**, from replaying all 96 migrations onto
an empty DB and diffing to `schema.prisma`. The **dev DB produces a byte-identical diff**, so dev
sits exactly at the history state — meaning **P1's edited migrations contribute nothing to P3**.
P1 and P3 are independent problems. Classification bucket (a) "covered by an edited-migration
change" is **empty**.

| # | Change | Stmts | Class | Root cause | Impact |
|---|---|---|---|---|---|
| 1 | `AlterEnum AiTurnIntent` — drop `EVIDENCE_CAPTURE`, `SIGNATURE_REQUEST`, `CLARIFY` | 7 | **(b) genuine** | Merge-conflict resolution `43ec4513` (PR #3 merge `32e5010a`), 2026-07-05, silently reverted the enum block that `e9f33568` had added hours earlier | **Dangerous — see verdict** |
| 2 | `AddForeignKey CrmCampaignRecipient_companyId_fkey` (add, no matching drop) | 1 | **(b) genuine** | Hand-written `20260712090000_crm_campaign_broadcast` created only `campaignId` + `channelIdentityId` FKs | Real tenant-integrity gap |
| 3 | Crm\* FK drop + re-add ×4 | 8 | (c) cosmetic | Same hand-written migration omitted `ON UPDATE CASCADE`; DB has `ON UPDATE NO ACTION`. `ON DELETE` already matches schema | None — ids are immutable cuids |
| 4 | `CrmDataSubjectRequest.updatedAt` DROP DEFAULT | 1 | (c) cosmetic | `20260728150000_p1_pdpa_durable_cases` wrote `DEFAULT CURRENT_TIMESTAMP`; Prisma `@updatedAt` implies no DB default | None — client always writes |
| 5 | `ThaiAddressMaster.updatedAt` DROP DEFAULT | 1 | (c) cosmetic | `20260711190000_thai_address_master`, same cause | None |
| 6 | `RenameForeignKey ExpenseSubstituteReceiptEvidence_certifiedArtifact…` | 1 | (c) cosmetic | Hand-written name truncated at 63 chars without preserving the `_fkey` suffix | None |
| 7 | `RenameIndex` ×7 | 7 | (c) cosmetic | Same truncation issue; `_key` / `_idx` suffixes lost | None |

**Counts: 8 statements genuine (2 items), 18 statements cosmetic (5 items), 0 unknown.**

### AiTurnIntent verdict

- **Removal commit:** `43ec4513` "merge: resolve develop conflicts and preserve employee
  access requirements" (2026-07-05), surfaced through PR #3 merge `32e5010a`. Only visible with
  `--full-history` — ordinary `git log -S … -- <path>` hides it via history simplification.
- **Reason: not a deliberate removal.** `e9f33568` (2026-07-05) added the three values *and* the
  additive migration `20260705150000_item10b_intake_turn_intents`. The merge took the other
  branch's copy of the enum block. The migration survived; the schema edit did not.
- **In-use rows:** dev DB `AiTurn` is **empty (0 rows)**; only `AiTurn.intent` uses the type. No
  risk in dev.
- **But production code still writes all three values.** `persistIntakeTurn` in
  `/Users/spare058/WatchDog-BMS/apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
  has 7 call sites passing these literals. The write escapes the narrowed Prisma enum type through
  an explicit cast at line 1021:

  ```ts
  intent: input.intent as any,
  ```

  That cast is the seam that let schema and database diverge silently for four weeks. The other
  write path is safe: `AI_TURN_INTENTS` (line 257) holds only the 6 values.
- UAT and prod therefore almost certainly hold rows with these values (LINE AI intake is live).
  Dropping them would break intake-turn memory **silently** — `persistIntakeTurn` wraps the create
  in try/catch and only logs "Intake turn memory persist failed", so multi-turn follow-ups would
  quietly stop resolving rather than erroring.
- **Verdict: fix the schema, not the database.** Restore the three values to `enum AiTurnIntent`
  in `schema.prisma`. Verified: with them restored, the diff against the healed replay is empty.

---

## UAT / prod inference

Direct read was not possible: AWS credentials are **expired** (`ExpiredToken` on
`sts get-caller-identity`), and the UAT DB is VPC-internal regardless. Inference from git plus
recorded deploy state:

**Anchors**
- UAT was created by `de2a0923 ci(uat): add isolated acceptance deployment` on **2026-07-20** —
  after every P1 migration commit except `stock_movement`. Its DB was built by replaying committed
  files.
- Prod runs `GIT_SHA=6d66bdc7` (2026-07-19 15:55Z), is scaled to zero, and nothing newer has been
  deployed (recorded 2026-07-28).
- The immutable release pipeline (`600214e2`, `6d66bdc7`, 2026-07-19) means post-07-19 deploys
  build from committed refs, not the working tree.

| Item | UAT | Prod |
|---|---|---|
| P1 `company_booking_buffer` (CHECK added) | **(ii) new version** — built 07-20, 8 days after `3073e38e` | **(ii) new version** — deployed 07-19, after the 07-11 commit. Residual **(iii) unknown**: a workstation deploy inside the 45-minute window 07-11 17:11Z→17:56Z would have shipped the draft |
| P1 `crm_product_service_catalog` (CHECK 30→60) | (ii) new version | (ii) new version, same 45-minute residual window |
| P1 `h02` / `h07` | (ii) new version | (ii) new version — and moot, end state identical either way |
| P1 `stock_movement` | (ii) new version if deployed ≥07-28; comment-only so moot | **not present** — prod is at 07-19, migration is 07-28 |
| P1 checksum mismatches themselves | none expected — UAT/prod recorded the committed files | none expected |
| P2 orphan `…130000_crm_booking_canonical_customer` | **absent** — the name never existed in git | **absent** — same reason |
| P3 (all 26 statements) | **present, identical** | **present, identical** |

P3 is environment-independent by construction: it follows from committed migrations plus committed
`schema.prisma`, so every environment that replayed history has it.

**Read-only query to settle the prod residual risk once credentials are refreshed:**

```sql
SELECT conname, pg_get_constraintdef(oid)
  FROM pg_constraint
 WHERE conname IN ('Company_bookingBufferMinutes_check', 'Product_bookingDurationMinutes_check');
```

A missing `Company_bookingBufferMinutes_check`, or `>= 30` on the Product check, means that
environment applied the draft and needs the forward-fix migration below (which handles it anyway).

---

## Proposals (drafts — none applied)

### (a) P1 checksum re-record

`prisma migrate resolve --rolled-back` is **not usable here**: it only accepts migrations in a
*failed* state, and all five succeeded. The supported remedy is a metadata-only update.

Three end-state-equivalent migrations — safe to re-record immediately:

```sql
UPDATE "_prisma_migrations" SET checksum = 'a84a790dcf6b4ab5a4f5eb0561c4148294965aff8b4cd0626fcfeadc20c1e488'
 WHERE migration_name = '20260718090000_h02_coa_company_or_system_check' AND rolled_back_at IS NULL;
UPDATE "_prisma_migrations" SET checksum = '8b8736cb9b210635b32a6aea53e9dd5e0f736918328c2d150a6d66ea68d4a4cf'
 WHERE migration_name = '20260718160000_h07_procurement_approval_policy' AND rolled_back_at IS NULL;
UPDATE "_prisma_migrations" SET checksum = 'ee9947ce37d308ec81241936f1a34ec703dd46d09b11dbca438175b11bef1276'
 WHERE migration_name = '20260728120000_stock_movement_single_reversal' AND rolled_back_at IS NULL;
```

The two with real SQL differences — re-record **only after** the forward-fix migration (c) has run
in that environment:

```sql
UPDATE "_prisma_migrations" SET checksum = 'a469e27aa2fa3fbdb1dcf017a13cf2ab7f3bb40b9f1621c1973a259aba3866d8'
 WHERE migration_name = '20260712110000_company_booking_buffer' AND rolled_back_at IS NULL;
UPDATE "_prisma_migrations" SET checksum = 'daed55620cfb4b7c93f702697f0b6f00f477b3c9436d165d3ac37991982dacbf'
 WHERE migration_name = '20260712130000_crm_product_service_catalog' AND rolled_back_at IS NULL;
```

Dev DB only. UAT/prod should already match; running it there is a harmless no-op.

### (b) P2 orphan row

```sql
DELETE FROM "_prisma_migrations"
 WHERE migration_name = '20260712130000_crm_booking_canonical_customer';
```

Safe: the identical migration is already recorded as applied under
`20260712140000_crm_booking_canonical_customer` (same checksum `c03eb746…`, matching the on-disk
file). Dev DB only. **Do not rename the folder back** — `140000` is the name every other
environment recorded. Leaving the row is also acceptable; Prisma reports it as a warning
("applied migration not found in local directory"), not a `migrate deploy` failure.

### (c) One idempotent forward-fix migration

Landed at `apps/api/prisma/migrations/20260801150000_drift_forward_fix/migration.sql`
(timestamp moved off `20260801140000` to avoid colliding with concurrently authored lanes).

Covers: the missing tenant FK; the four `ON UPDATE CASCADE` re-assertions (guarded on
`confupdtype <> 'c'`); the two `updatedAt` DROP DEFAULTs; the eight identifier renames (guarded on
old-present / new-absent); and the two CHECK-constraint heals (drop-if-exists + add, behind
fail-closed data guards). Every step is guarded on **catalog state, never on migration history**,
which is what makes it safe on prod despite prod lagging several migrations behind.

Pair it with restoring the three enum values to `schema.prisma` — the migration deliberately does
**not** touch `AiTurnIntent`.

**Verification performed** (on the scratch DB, since dropped):

- Applied to a fresh full-history replay → OK. Re-applied → OK (idempotent).
- Scratch mutated into the dev-DB state (no Company check, `>= 30` Product check, missing recipient
  FK, `NO ACTION` on update, un-renamed index), then applied → OK.
- `prisma migrate diff` from healed scratch → `schema.prisma` with the enum restored:
  **"This is an empty migration."** in both the fresh and dev-like paths.
- Fail-closed guard proven with a BEGIN/ROLLBACK fixture: a Product row with
  `bookingDurationMinutes = 30` aborts with the triage message.
- Dev DB pre-checked read-only: **0** violating Product rows, **0** violating Company rows, **0**
  orphan `CrmCampaignRecipient` rows — the migration applies cleanly there today.

---

## do NOT do

- **Never `prisma migrate reset` or `migrate dev` against the shared dev DB**
  (`127.0.0.1:15432 / watchdog_bms`), UAT, or prod. `migrate dev` sees the checksum drift and
  offers to reset — that destroys the shared local dataset.
- **Never use `DATABASE_URL` from `apps/api/.env`** — it still points at
  `johndoe@localhost:5432/mydb`. Root `.env` is the real one.
- **Do not let Prisma auto-generate the enum fix.** `migrate dev` emits the DROP direction
  (removing the three values). That is the dangerous direction — the code writes them.
- **Do not rename** `20260712140000_crm_booking_canonical_customer` back to `130000`.
- **Do not "fix" P1 by editing the migration files again** — they are already deployed. Forward-fix
  migrations plus checksum re-records only.
- **Do not rely on `prisma migrate diff` to prove convergence** — it cannot see CHECK constraints,
  so the two real P1 differences are invisible to it. Compare `pg_constraint` directly.
- **Do not use `git log -S … -- <path>` alone** to prove a value was never removed; history
  simplification hid the `AiTurnIntent` removal. Use `--full-history`.
- **Do not run the checksum re-record for the two 07-12 migrations** before the forward-fix
  migration has run in that environment.

---

## Artifacts

Scratchpad `…/43926035-0e2c-488a-854d-1b42e51887fd/scratchpad/drift/`:
`replay-diff.sql`, `devdb-diff.sql` (byte-identical to replay), `post-fix-diff.sql` (empty),
`forward-fix-migration.sql`, `schema-with-enum-restored.prisma`, `db-checksums.txt`,
`mismatch.txt`, and `constraints|indexes|columns|enums|triggers-{f0_drift_scratch,watchdog_bms}.txt`.

## Verification

- Scratch DB `f0_drift_scratch` created, used for all destructive experiments, and **dropped**
  (`pg_database` shows no `f0_drift*` remaining).
- Dev DB untouched: `_prisma_migrations` at 100 rows / `max_started = 2026-07-31 11:53:43.997047+00`
  before and after.
- `apps/api/prisma/` untouched in the working tree (other modified files belong to a concurrent
  session working on feature-entitlement decoupling).

## Applied outcome (2026-07-31, owner-approved)

1. `20260801150000_drift_forward_fix` landed. Same body as the verified draft, plus the three
   `ALTER TYPE "AiTurnIntent" ADD VALUE IF NOT EXISTS` re-assertions (no-ops everywhere today).
2. The three enum values restored to `enum AiTurnIntent` in `schema.prisma`; the
   `intent: input.intent as any` cast in `persistIntakeTurn` removed — that write is now type-checked.
3. Rehearsed on two scratch DBs before touching dev: fresh 97-migration replay, and a full
   `pg_dump` clone of the dev DB (which carries the pre-edit CHECK variants). Empty
   `migrate diff` on both; migration re-applied twice in-transaction with no effect; both
   fail-closed guards proven to abort with the triage message under BEGIN/ROLLBACK fixtures.
   Both scratch DBs dropped.
4. Dev DB: 3 cosmetic checksums re-recorded, then `migrate deploy`, then the 2 real-divergence
   checksums re-recorded and the orphan `…130000_crm_booking_canonical_customer` row deleted.
   `prisma migrate deploy` does **not** refuse on edited checksums or orphan rows (Prisma 7.8) —
   confirmed on the clone before running it on dev.
5. Dev DB result: 0 checksum mismatches, 0 orphans, `Company_bookingBufferMinutes_check` present,
   `Product_bookingDurationMinutes_check` at `>= 60`, tenant FK added, 4 FKs at `ON UPDATE CASCADE`,
   both `updatedAt` defaults dropped, all 8 identifiers renamed.

## Next

1. When AWS credentials are refreshed, run the read-only `pg_constraint` query above against
   UAT and prod to close the 45-minute residual-risk window on the two 07-12 CHECK constraints.
   The forward-fix migration handles either variant, so this is a confirmation step, not a gate.
2. Deploy gate: `20260801150000_drift_forward_fix` must be in the migration preflight for the next
   UAT/prod deploy. The metadata heal (checksum re-records, orphan delete) is **dev-only** — UAT and
   prod recorded the committed files and have no orphan row.
3. One `as any` remains on the other AiTurn write
   (`process-line-webhook.use-case.ts`, `toAiTurnIntent(...) as any`). Type-safe at its source, so it
   was left outside the approved scope; removing it would close the last untyped seam on that table.
