# Substitute receipt — approval mode (solo owner by default) — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Phase 1 of [[substitute-receipt-standalone-menu-plan]].
Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run e2e
(your sandbox cannot reach postgres).

## Owner decision this implements

Today a one-person SME **cannot finish** a ใบรับรองแทนใบเสร็จรับเงิน at all: `PrepareSubstituteReceiptUseCase`
hard-throws when no policy row exists, and both prepare and approve require an approver who is a *different user*
from the payer. Owner directive: **the default must be "the owner signs as both payer and approver, with zero
prior setup"**, and companies that want segregation of duties opt in to designated approvers.

So: introduce an explicit `approvalMode` on the company policy, defaulting to `OWNER_SELF`.

| Mode | Who may approve | Approver list required |
|---|---|---|
| `OWNER_SELF` (**default**, also the behaviour when no policy row exists) | any user with `expense.confirm` eligible for the branch; **may be the payer themself only if `ctx.roles` includes `OWNER`** | no |
| `DESIGNATED_APPROVERS` | must be in `policy.approverUserIds`, eligible for the branch, **and ≠ payer** (today's rule, unchanged) | yes, ≥1 |

Self-approval never extends past the owner: a non-OWNER payer always needs a second person, in both modes.

## 1. Prisma (`apps/api/prisma/schema.prisma` + new migration)

Add enum and column:

```prisma
enum ExpenseSubstituteReceiptApprovalMode {
  OWNER_SELF
  DESIGNATED_APPROVERS
}
```

On `model ExpenseSubstituteReceiptPolicy`, after `approverUserIds`:

```prisma
  approvalMode             ExpenseSubstituteReceiptApprovalMode @default(OWNER_SELF)
```

New migration dir `apps/api/prisma/migrations/20260806100000_substitute_receipt_approval_mode/migration.sql`.
**Hand-write the SQL** — do not run `prisma migrate dev` (it needs a DB you cannot reach). Table name is
`"ExpenseSubstituteReceiptPolicy"` (no `@@map`).

```sql
CREATE TYPE "ExpenseSubstituteReceiptApprovalMode" AS ENUM ('OWNER_SELF', 'DESIGNATED_APPROVERS');

ALTER TABLE "ExpenseSubstituteReceiptPolicy"
  ADD COLUMN "approvalMode" "ExpenseSubstituteReceiptApprovalMode" NOT NULL DEFAULT 'OWNER_SELF';

-- Existing rows were created under the mandatory two-person rule and already name approvers.
-- Keep their control in force; only companies created from now on get the solo-owner default.
UPDATE "ExpenseSubstituteReceiptPolicy" SET "approvalMode" = 'DESIGNATED_APPROVERS';
```

That backfill is deliberate and must not be dropped — silently loosening an existing company's segregation of
duties is a control regression.

Then regenerate the client so the API typechecks:
`corepack pnpm --filter @watchdog-bms/api exec prisma generate`

## 2. Contracts (`packages/contracts/src/expenses.ts`)

- `export type SubstituteReceiptApprovalMode = 'OWNER_SELF' | 'DESIGNATED_APPROVERS';`
- `SubstituteReceiptPolicySettings`: add `approvalMode: SubstituteReceiptApprovalMode;` and `ready: boolean;`
  — **keep `configured` exactly as it is** (it still means "a policy row exists" and drives the
  ตั้งค่าแล้ว/ยังไม่ตั้งค่า badge). `ready` is the new "prepare is allowed" signal:
  `ready = approvalMode === 'OWNER_SELF' || approverUserIds.length > 0`.
- `SubstituteReceiptRuntimePolicy`: extend the `Pick<...>` to include `'ready'` and `'approvalMode'`.
- `UpdateSubstituteReceiptPolicyInput`: add `approvalMode: SubstituteReceiptApprovalMode;` (required) and make
  `approverUserIds` semantically optional-but-present (`string[]`, may be empty in `OWNER_SELF`). Keep the
  property required in the type so every caller states its intent.

## 3. Policy use-cases (`.../use-cases/substitute-receipt-policy.use-case.ts`)

`GetSubstituteReceiptPolicyUseCase.execute` / `.executeRuntime`: read `approvalMode` from the row, defaulting to
`'OWNER_SELF'` when there is no row, and compute `ready` per the formula above.

`UpdateSubstituteReceiptPolicyUseCase.execute`:
- validate `approvalMode` against the two literals (`BadRequestException('Invalid approvalMode.')`).
- when `approvalMode === 'DESIGNATED_APPROVERS'` → today's rule stands (1..20 approvers, unique, all eligible).
- when `approvalMode === 'OWNER_SELF'` → `approverUserIds` **may be empty**; if non-empty still validate
  uniqueness + eligibility (they are kept so switching modes back doesn't lose the selection).
- persist `approvalMode` through `repo.upsertSubstituteReceiptPolicy` (add the field to the repo method's input
  type and its prisma `create`/`update` payloads in
  `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`).
- add `previousApprovalMode` / `approvalMode` to the existing audit `metadataJson`.

## 4. Guards (`.../use-cases/substitute-receipt.use-case.ts`)

**`PrepareSubstituteReceiptUseCase.execute`** (~line 160-168):
- delete the `if (!policy) throw new BadRequestException('Configure substitute-receipt approvers…')` — a missing
  row now simply means `OWNER_SELF`. Derive `const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';`.
- `DESIGNATED_APPROVERS` → keep the current
  `!policy.approverUserIds.some((id) => id !== payer.userId && eligibleApproverIds.has(id))` throw verbatim.
- `OWNER_SELF` → require `eligibleApproverIds.size > 0`, else throw
  `BadRequestException('No active member with expense.confirm is eligible to approve for this branch.')`.
  Do **not** try to prove the payer is an OWNER here; ownership is enforced at approve time (below). A
  non-owner who is the only eligible approver will therefore pass prepare and be stopped at approve — that is
  accepted, and the approve-time message must say so plainly.
- everything else in prepare (cash evidence policy read, attachment rules) keeps using
  `policy?.cashEvidencePolicy ?? 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE'`.

**`ApproveSubstituteReceiptUseCase.execute`** (~line 340-352):
- **move** the existing `if (evidence.payerUserId === ctx.userId) throw …` to *after* the policy load — it must
  become mode-aware. Replace with:
  ```ts
  const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
  const selfApproved = evidence.payerUserId === ctx.userId;
  if (selfApproved && !(approvalMode === 'OWNER_SELF' && ctx.roles.includes('OWNER'))) {
    throw new ForbiddenException('Only the company owner may approve a substitute receipt they paid themselves.');
  }
  ```
- delete `if (!policy) throw new ForbiddenException('Substitute-receipt company policy is not configured.')`.
- `DESIGNATED_APPROVERS` → keep the current
  `!policy.approverUserIds.includes(ctx.userId) || !eligibleApproverIds.has(ctx.userId)` throw.
- `OWNER_SELF` → require `eligibleApproverIds.has(ctx.userId)` only, throwing
  `ForbiddenException('You do not have expense.confirm for this branch.')`.
- add `selfApproved` to the approve audit `metadataJson`.

**`assertSignatureActor`** (~line 566-577) — the per-certificate signature upload gate. `isApprover` currently
hard-requires `evidence.payerUserId !== ctx.userId`, which would block the owner from uploading their approver
signature. Make it mirror the approve rule: load the policy, derive `approvalMode`, and allow
`evidence.payerUserId === ctx.userId` only when `approvalMode === 'OWNER_SELF' && ctx.roles.includes('OWNER')`.
Keep the `expense.confirm` permission requirement and the eligible-for-branch check; apply the configured-list
check only in `DESIGNATED_APPROVERS`. Role still resolves by status (`PREPARED` → payer, `PAYER_CERTIFIED` →
approver), so one owner signs twice in sequence and each signature is stored under its own role.

## 5. Document footnote (`.../domain/logic/substitute-receipt.logic.ts`)

When the approver and payer are the same user, `renderSubstituteReceiptSvg` must print, under the two signature
blocks, the line:

`ลงนามโดยเจ้าของกิจการในฐานะผู้จ่ายเงินและผู้อนุมัติ`

Use the data the renderer already receives (payer userId vs approver userId); do not add a parameter if an
existing one already carries both. Keep the existing layout maths intact — the footnote is one extra line under
the signature row, and the SVG height must account for it so nothing overlaps or clips.

## 6. Web

**`apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx`** — add a mode selector card *above*
ผู้อนุมัติที่ได้รับมอบหมาย, two radios, `approvalMode` state wired into the `input` memo:

- `OWNER_SELF` — **เจ้าของกิจการลงนามและอนุมัติด้วยตนเอง (ค่าเริ่มต้น)** /
  "เหมาะกับกิจการเจ้าของคนเดียว ระบบจะระบุในเอกสารว่าเจ้าของลงนามทั้งในฐานะผู้จ่ายเงินและผู้อนุมัติ และบันทึกประวัติไว้ตรวจสอบย้อนหลัง"
- `DESIGNATED_APPROVERS` — **กำหนดผู้อนุมัติแยกจากผู้จ่ายเงิน** /
  "เหมาะกับกิจการที่ต้องการแบ่งหน้าที่ ระบบจะบังคับให้ผู้จ่ายเงินและผู้อนุมัติเป็นคนละคน"

In `OWNER_SELF` the approver checkbox grid stays visible but is explained as optional ("เลือกไว้ล่วงหน้าได้
ระบบจะใช้เมื่อสลับไปโหมดกำหนดผู้อนุมัติ"); in `DESIGNATED_APPROVERS` it is required as today. Update the
ก่อนเปิดใช้งานจริง checklist so step 1 and step 3 no longer assert that two separate accounts are mandatory.

**`apps/web/src/features/expenses/substitute-receipt-policy.model.ts`** — `validateSubstituteReceiptPolicy` only
demands ≥1 approver when `input.approvalMode === 'DESIGNATED_APPROVERS'`; the uniqueness and 500-char rules stay.

**`apps/web/src/features/expenses/ExpensesPages.tsx`** — lines ~709 and ~743 gate the prepare form on
`substitutePolicy?.configured`. Switch **both** to the new `ready` flag, so the red "ไปหน้าตั้งค่า" line and the
disabled button now appear only when a `DESIGNATED_APPROVERS` company has no approvers — never for a fresh
company on the default mode.

### UI copy rules for anything you write here
Formal-professional Thai that a layperson still understands: official vocabulary (เลขประจำตัวประชาชน,
ลงลายมือชื่อ), short concrete sentences, verb-first buttons (บันทึกการตั้งค่า, ดำเนินการต่อ). No casual particles,
no emoji. Dates displayed as `5 ส.ค. 2569` (abbreviated Thai month, Buddhist year); only the rendered official
document uses the full month.

## 7. Tests to update/extend

- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.spec.ts` — add: saving
  `OWNER_SELF` with an empty approver list succeeds; `DESIGNATED_APPROVERS` with an empty list still throws;
  `ready` is true for a company with no policy row.
- `apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` — add: prepare
  succeeds with **no policy row**; owner self-approve succeeds under `OWNER_SELF`; non-owner self-approve is
  rejected; `DESIGNATED_APPROVERS` still rejects a payer approving their own evidence.
- `apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts` — the self-signed footnote
  appears when payer === approver and is absent otherwise.
- Keep every existing case passing; repoint expectations only where this change intentionally alters behaviour,
  and rename descriptions truthfully.

## Files (nothing outside this list)

```
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/20260806100000_substitute_receipt_approval_mode/migration.sql   (new)
packages/contracts/src/expenses.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts
apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts
apps/api/src/modules/expenses/domain/logic/substitute-receipt.logic.ts
apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx
apps/web/src/features/expenses/substitute-receipt-policy.model.ts
apps/web/src/features/expenses/ExpensesPages.tsx
+ the four spec files listed in §7
```

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/api exec prisma generate
corepack pnpm --filter @watchdog-bms/contracts run build
corepack pnpm --filter @watchdog-bms/api lint
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/api && corepack pnpm exec node --import tsx --test \
  src/modules/expenses/application/use-cases/substitute-receipt-policy.use-case.spec.ts \
  src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts \
  src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts
```

Do **not** run `pnpm --filter @watchdog-bms/api test` (its `pretest` needs postgres), any e2e, or any server.
Run the node test command **from `apps/api`** — from the repo root tsx misses `experimentalDecorators` and Nest
specs fail to transform.

## Report back

1. The final prepare/approve/assertSignatureActor guard bodies (paste them).
2. The migration SQL.
3. Test output (counts, pass/fail) for each verify command.
4. Anything in this handoff that turned out to be wrong about the code — state it plainly instead of working
   around it silently.
