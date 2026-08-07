# Substitute receipt — payee identity on the document — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Owner approved ("เพิ่มเข้าไป"). Follows
[[substitute-receipt-standalone-menu-plan]] §4; task state [[substitute-receipt-standalone-menu]].
Phases 1–3 are applied and committed; the PDF phase may be applied in the same tree — build on whatever is there.

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e. This phase **does** add a migration; hand-write the SQL, do **not** run `prisma migrate dev` (no DB access).

## Why

This is the tax-substance change. Revenue Department practice for an expense with no receipt is that the payment
must be traceable to an identifiable payee — otherwise it is a รายจ่ายต้องห้าม under มาตรา 65 ตรี. Today the
certificate names only the company, the payer and the amount; the payee appears only as the expense's
`vendorNameSnapshot`, which is often empty (the hub currently prints "ไม่ระบุผู้รับเงิน" for real rows).

Capture the payee on the evidence, freeze it into the immutable snapshot, and print it on the document.

## 1. Prisma

Add to `model ExpenseSubstituteReceiptEvidence`, next to the payer columns:

```prisma
  payeeName                String?
  payeeAddress             String?
  payeeTaxId               String?
```

All nullable: existing rows have no payee data and must stay readable. New migration directory
`apps/api/prisma/migrations/20260807100000_substitute_receipt_payee_identity/migration.sql`, hand-written:

```sql
ALTER TABLE "ExpenseSubstituteReceiptEvidence"
  ADD COLUMN "payeeName"    TEXT,
  ADD COLUMN "payeeAddress" TEXT,
  ADD COLUMN "payeeTaxId"   TEXT;
```

No backfill: there is nothing truthful to backfill with, and inventing a payee on a signed document is exactly
what this feature exists to prevent.

Then `corepack pnpm --filter @watchdog-bms/api exec prisma generate`.

## 2. Contracts

- `GenerateSubstituteReceiptInput` gains `payeeName?: string; payeeAddress?: string; payeeTaxId?: string;`
  — **optional**, see the validation rule below.
- `SubstituteReceiptEvidenceSummary` and `SubstituteReceiptListItem` expose the three fields so the UI can show
  what was captured. `SubstituteReceiptListItem.payeeName` already exists and is currently fed from the
  expense's vendor snapshot — change its source to `evidence.payeeName ?? expense.vendorNameSnapshot` so old
  rows keep working and new ones prefer the real capture.

## 3. Validation (prepare use-case)

- `payeeName`: trim, max 200. **Required when the expense has no `vendorNameSnapshot`**, otherwise optional and
  defaulting to the vendor snapshot. A certificate that names nobody is the failure mode being fixed, but an
  expense that already carries a vendor name must not suddenly start rejecting.
- `payeeAddress`: trim, max 300, optional.
- `payeeTaxId`: optional; **strip everything but digits** and accept only 13 digits (Thai national ID / TIN) —
  reject other lengths with a message naming the expected 13 digits. Reuse the repo's existing tax-ID helper if
  one exists (`taxIdDigits` is referenced in the expenses web code — check for a shared server-side equivalent
  before writing a new one) rather than adding a second normaliser.
- Do **not** validate the ID's checksum digit. A payee reading their ID over the phone to a shop owner is the
  normal case, and blocking a mistyped-but-plausible number stops a legitimate document from being issued.

## 4. Snapshot + rendered document

`SubstituteReceiptSnapshot` (`substitute-receipt.logic.ts`) gains a sibling to `payer`:

```ts
  payee: { name: string; address: string | null; taxId: string | null };
```

`buildSnapshot` fills it from the evidence, falling back to `expense.vendorNameSnapshot` for the name.

**Snapshot shape change and existing evidence — RESOLVED 2026-08-06, do not stop on this again.**

A previous run stopped here after finding that `ApproveSubstituteReceiptUseCase` re-hashes a stored snapshot
and compares it to `snapshotChecksumSha256` (`substitute-receipt.use-case.ts:481-482`). That observation is
correct but harmless, and the reasoning was checked by running it:

`canonicalSnapshotHash` hashes `JSON.stringify(sortJsonKeys(snapshot))` where `snapshot` is the stored
`snapshotJson` **read straight from the database and merely cast** to the type. `sortJsonKeys` walks the runtime
object's own keys; it never consults the TypeScript type. A legacy stored snapshot has no `payee` key at
runtime, so its hash is byte-identical before and after this change. Measured:

```
legacy hash               8cbf6eb8814e6a8f
legacy + payee: undefined 8cbf6eb8814e6a8f   (sortJsonKeys already filters undefined)
new snapshot with payee   1bdda46966508f25   (different, as intended)
```

So **legacy certificates keep their checksum and stay approvable**; no supersede-and-redo is needed, and no
owner decision is required.

The one real compatibility requirement is in the renderer, not the hash: **make `payee` optional on
`SubstituteReceiptSnapshot`** (`payee?: { … }`) and have `renderSubstituteReceiptSvg` omit the whole block when
it is absent. A snapshot certified before this change is rendered again at approval time, and an unconditional
`snapshot.payee.name` would throw there — that is the failure to avoid. Add a test that renders a
payee-less snapshot without throwing.

`renderSubstituteReceiptSvg` prints the payee under the company block, formatted as:

```
ผู้รับเงิน: <name>
ที่อยู่: <address>                     (omit the line entirely when null)
เลขประจำตัวประชาชน/เลขประจำตัวผู้เสียภาษี: <13 digits, formatted 0-0000-00000-00-0>   (omit when null)
```

Reuse the existing `multilineText` / word-wrap helpers and grow the SVG height for the lines actually rendered —
do not overlap the block below. The document already word-wraps Thai with `Intl.Segmenter`; follow that.

## 5. Wizard step 2

`SubstituteReceiptWizardPage` step 2 ("ระบุเหตุผลและข้อมูลผู้จ่ายเงิน") gains a payee block **above** the reason
fields, and the step heading becomes `ระบุผู้รับเงินและเหตุผล`:

- `ชื่อผู้รับเงิน` — required when the expense has no vendor name, else prefilled from it and editable.
- `ที่อยู่ผู้รับเงิน` — optional.
- `เลขประจำตัวประชาชน / เลขประจำตัวผู้เสียภาษี` — optional, with the helper line
  `ระบุเพื่อให้หลักฐานการจ่ายเงินสมบูรณ์ตามหลักเกณฑ์ของกรมสรรพากร`. Digits only as the user types; show the
  count when incomplete rather than blocking keystrokes — an input that silently refuses characters was already
  a reported problem on the vendor tax-ID field.

Put the field-level rules in the existing wizard model file as pure functions with unit tests, not inline in the
component.

## 6. Hub

The `ผู้รับเงิน` column already exists and prints `ไม่ระบุผู้รับเงิน` when empty; once §2 repoints the source
it will show real names with no further change. Verify that and say so — do not restyle the column.

## 7. Copy, icons, dates (unchanged owner directives)

Formal-professional Thai a layperson understands; official vocabulary (เลขประจำตัวประชาชน, ลงลายมือชื่อ);
verb-first buttons; no casual particles or emoji. Eye = view-only, pencil = edit/continue. Dates `5 ส.ค. 2569`
via the shared `formatThaiDate`; the rendered document keeps the full month. Every new string goes through the
`t()` dictionary with **both** `th` and `en` entries.

## Files

```
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20260807100000_substitute_receipt_payee_identity/migration.sql   (new)
packages/contracts/src/expenses.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts
apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts
apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts
apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts
apps/web/src/features/expenses/SubstituteReceiptWizardPage.tsx
apps/web/src/features/expenses/substitute-receipt-wizard.model.ts
apps/web/src/features/expenses/substitute-receipt-wizard.model.spec.ts
apps/web/src/common/i18n/workspace-dictionary.ts
```

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/api exec prisma generate
corepack pnpm --filter @watchdog-bms/contracts run build
corepack pnpm --filter @watchdog-bms/api lint
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/api && corepack pnpm exec node --import tsx --test \
  src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts \
  src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts
cd apps/web && corepack pnpm exec node --import tsx --test src/features/expenses/substitute-receipt-wizard.model.spec.ts
```

No `pnpm --filter @watchdog-bms/api test` (its `pretest` needs postgres), no e2e, no servers, no
`prisma migrate`.

## Report back

1. The migration SQL and the final Prisma field block.
2. The payee validation rules as implemented, and which tax-ID normaliser you reused or why you added one.
3. Confirmation that a payee-less snapshot still renders and approves (§4 is already resolved — do not stop
   on it), and the test you added for it.
4. The rendered document's payee block and how the SVG height was adjusted.
5. Test output for each verify command.
6. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
