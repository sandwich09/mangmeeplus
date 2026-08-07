# Substitute receipt — standalone menu + hub page — Codex CLI Handoff

Status: Implement-ready 2026-08-06. Phase 2 of [[substitute-receipt-standalone-menu-plan]].
Depends on Phase 1 ([[substitute-receipt-approval-mode-20260806-codex-handoff]]) being already applied in the
working tree — `approvalMode` / `ready` exist on the policy contracts.

Executor: Codex CLI. Never commit, never `git add`/`checkout`/`restore`/`stash`, never start servers, never run
e2e (your sandbox cannot reach postgres).

## Why

ใบรับรองแทนใบเสร็จรับเงิน has no page of its own. The whole flow lives inside a collapsible block inside step
"หลักฐาน" of the expense-detail stepper, and the sidebar submenu that says **ใบรับรองแทนใบเสร็จ** actually opens
`/expenses/signatures` — the *company signature asset* manager, a different feature the substitute flow does not
even use. The owner tested it and could not find or finish the flow. This phase gives the feature a real menu
entry, a hub page listing every certificate in the company, and a "waiting on me" strip.

## 1. Contracts (`packages/contracts/src/expenses.ts`)

Add, next to the other substitute types:

```ts
export type SubstituteReceiptListItem = {
  evidenceId: string;
  expenseId: string;
  documentNumber: string;
  version: number;
  status: SubstituteReceiptEvidenceStatus;   // reuse the existing status union
  expenseNumber: string | null;
  expenseDate: string;                        // ISO
  paymentDate: string | null;                 // ISO
  payeeName: string | null;                   // expense.vendorNameSnapshot
  currency: string;
  grandTotalAmount: string;
  payerUserId: string;
  payerName: string;
  approverUserId: string | null;
  approverName: string | null;
  artifactAttachmentId: string | null;        // issued artifact, null until ISSUED
  certifiedArtifactAttachmentId: string | null;
  updatedAt: string;                          // ISO
};

export type SubstituteReceiptListFilter = {
  status?: SubstituteReceiptEvidenceStatus;
  yearMonth?: string;      // 'YYYY-MM', filters on paymentDate ?? expenseDate
  payerUserId?: string;
  page?: number;           // 1-based
  pageSize?: number;       // default 50, max 200
};

export type SubstituteReceiptListResult = {
  items: SubstituteReceiptListItem[];
  total: number;
  page: number;
  pageSize: number;
};
```

If a `SubstituteReceiptEvidenceStatus` union does not already exist in contracts, define it as
`'PREPARED' | 'PAYER_CERTIFIED' | 'ISSUED' | 'SUPERSEDED'` and reuse it — do not duplicate string literals.

## 2. Repository (`apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts`)

New `listCompanySubstituteReceipts(companyId, filter, scope)` over `ExpenseSubstituteReceiptEvidence`, joined to
its expense for `expenseNumber / expenseDate / vendorNameSnapshot / currency / grandTotalAmount`.

- Always `where: { companyId }`.
- Branch scope: when `scope.branchIds` is a non-empty array, constrain to `branchId: { in: scope.branchIds }` —
  mirror exactly how the existing expense list query scopes branches; do not invent a second convention.
- `scope.onlyPayerUserId` (string | null): when set, add `payerUserId: <that user>`.
- `status` filter when provided; `yearMonth` filters on `paymentDate` falling in that month, falling back to the
  joined expense's `expenseDate` when `paymentDate` is null (do it with an OR over the two ranges).
- Order `updatedAt desc`, then `version desc`. Return `{ rows, total }` using a `$transaction` of
  `findMany` + `count`, the same shape other paginated repo methods here use.
- Resolve `payerName` / `approverName` from the columns already denormalised on the evidence row
  (`payerName`, `approverName`) — no extra user lookups.

## 3. Use-case + route

New `ListCompanySubstituteReceiptsUseCase` in
`apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts`:

```
assertWeb(ctx)
const canSeeAll = ctx.permissions.includes('expense.review') || ctx.permissions.includes('expense.confirm');
if (!canSeeAll && !ctx.permissions.includes('expense.read_own')) throw new ForbiddenException(...)
onlyPayerUserId = canSeeAll ? null : ctx.userId
```
Clamp `pageSize` to 1..200 (default 50) and `page` to ≥1. Map rows to `SubstituteReceiptListItem` with ISO date
strings and `grandTotalAmount` stringified the same way the other expense read models do it (find the existing
decimal→string helper in this module and reuse it — do not call `.toString()` on a Prisma Decimal directly if the
module has a helper).

Controller (`apps/api/src/modules/expenses/presentation/http/expense.controller.ts`): the substitute routes live
under the `expenses` controller prefix, but this list is company-wide, not per-expense. Add it to whichever
controller owns `/v1/companies/:companyId` paths that are **not** nested under `:expenseId` — the existing
`/expense-settings/substitute-receipt` routes show where that is. Route:

```
GET /v1/companies/:companyId/substitute-receipts
```

guarded with the same permission decorator style used by the neighbouring routes, requiring any of
`expense.review`, `expense.confirm`, `expense.read_own`. Query params bind to `SubstituteReceiptListFilter`.
Register the use-case in the expenses module providers.

## 4. Web API client (`apps/web/src/features/expenses/expenses.api.ts`)

```ts
export async function listCompanySubstituteReceipts(
  companyId: string,
  filter: SubstituteReceiptListFilter = {},
): Promise<SubstituteReceiptListResult> {
  return apiFetch(`/v1/companies/${companyId}/substitute-receipts${qs(filter)}`);
}
```
Use the existing `qs()` helper in that file.

## 5. Menu wiring

### 5a. `packages/contracts/src/feature-entitlements.ts` (~line 111-118)
The submenu `expenses.substitute_receipt` is mislabelled and mis-routed. Fix it, and give the signatures page
back its own entry so it does not become unreachable:

```ts
{
  key: 'expenses.substitute_receipt',
  labelTh: 'ใบรับรองแทนใบเสร็จ',
  descriptionTh: 'จัดทำใบรับรองแทนใบเสร็จรับเงินตั้งแต่ต้นจนออกเอกสาร',
  route: '/expenses/substitute-receipts',
  permissionKeys: ['expense.review', 'expense.confirm', 'expense.read_own'],
},
{
  key: 'expenses.signatures',
  labelTh: 'ลายเซ็นบริษัท',
  descriptionTh: 'จัดการลายเซ็นและตราประทับที่ใช้ในเอกสารของบริษัท',
  route: '/expenses/signatures',
  permissionKeys: ['expense.signature.manage', 'expense.signature.approve'],
},
```

Add `'expenses.signatures'` to **every** feature-package preset in that file that already lists
`'expenses.substitute_receipt'` (STARTER and any others) so no company loses the signatures page.

Adding a submenu key has two known downstream guards — check both, do not skip:
`apps/api/src/modules/feature-launch/domain/runoff-matrix.catalog.spec.ts` (and the generated
`docs/specs/feature-entitlement-runoff-matrix.json`), and
`apps/api/src/modules/employee-access/domain/logic/menu-entitlement-binding.spec.ts`. If either asserts a closed
set of submenu keys, extend the catalog/fixture the same way previous submenu additions did — find the last
commit that added a submenu key and copy its shape. Report what you had to touch.

### 5b. `packages/contracts/src/menu-entitlements.ts`
Wherever `'expenses.substitute_receipt'` appears in the nav↔entitlement binding, add `'expenses.signatures'`
alongside it so both submenus resolve.

### 5c. `apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts`
The `expenses` module's `requiredAnyPermissions` must also admit a user who only has `expense.confirm`
(an approver with no other expense rights would otherwise never see the menu). Add `'expense.confirm'` to that
list. Change nothing else about the module.

### 5d. `apps/web/src/features/web-core-workspace/settings-menu.logic.ts`
Add a settings card so the policy page stops being URL-only:

```ts
{
  key: 'substitute-receipt',
  href: '/settings/substitute-receipt',
  title: 'ตั้งค่าใบรับรองแทนใบเสร็จ',
  desc: 'เลือกรูปแบบการอนุมัติและหลักฐานขั้นต่ำสำหรับรายจ่ายที่ไม่มีใบเสร็จรับเงิน',
  iconKey: 'DollarLineIcon',
  tone: 'brand',
  requiredAnyPermissions: ['company.setup.manage'],
}
```
`canAccessWorkspacePath` already allows `${settingsBase}/substitute-receipt` for `company.setup.manage`; keep
the two lists identical, as the comment on the accounting card demands.

## 6. Route + hub page

New route file, matching the sibling expense routes exactly in shape (thin server component):
`apps/web/app/(workspace)/companies/[companyId]/expenses/substitute-receipts/page.tsx`
→ renders the new client component `SubstituteReceiptHubPage` with `companyId`, `userId`, `permissions`, the same
way `.../expenses/evidence/page.tsx` passes them.

New client component
`apps/web/src/features/expenses/SubstituteReceiptHubPage.tsx`, built from `MangmeePage` / `MangmeeCard` and the
atoms already in `ExpensesUi.tsx` (`StatCard`, `StatusBadge`, `ErrorBanner`, `inputClass`, `btnClass`). Do not
introduce a new styling idiom.

Layout, top to bottom:

1. **`MangmeePage`** — title `ใบรับรองแทนใบเสร็จรับเงิน`, description
   `จัดทำ ลงนาม อนุมัติ และดาวน์โหลดใบรับรองแทนใบเสร็จรับเงินได้ในหน้าเดียว`, with a primary action link
   `+ สร้างใบรับรองฉบับใหม่` → `/companies/{companyId}/expenses/manual` **for now** (the wizard route arrives in
   Phase 3; do not invent it here).
2. **งานที่รอดำเนินการ strip** — two cards, rendered only when their count > 0:
   - `รอคุณลงนาม (n)` — items with `status === 'PREPARED' && payerUserId === userId`.
   - `รอคุณอนุมัติ (n)` — items with `status === 'PAYER_CERTIFIED'` and the current user may approve:
     `payerUserId !== userId`, or (`payerUserId === userId` and the runtime policy's
     `approvalMode === 'OWNER_SELF'`). Requires `permissions.includes('expense.confirm')`.
     Fetch the runtime policy with the existing `getSubstituteReceiptRuntimePolicy` client function.
   Each card links to the first matching item's expense detail page
   (`/companies/{companyId}/expenses/{expenseId}`) — that is where signing lives until Phase 3.
3. **KPI row** — `ออกเอกสารแล้วเดือนนี้`, `มูลค่ารวม`, `รอลงนาม / รออนุมัติ`, `ยกเลิกแล้ว`, using `StatCard`.
   Compute from the loaded page of results; if `total > items.length`, label the KPI row
   `จากรายการที่แสดง` so it never claims to summarise more than it loaded.
4. **Filters** — status select (ทั้งหมด / รอผู้จ่ายเงินลงนาม / รอการอนุมัติ / ออกเอกสารแล้ว / ยกเลิกแล้ว) and a
   month input. Refetch on change.
5. **Table** — columns เลขที่เอกสาร / วันที่จ่ายเงิน / ผู้รับเงิน / จำนวนเงิน (right-aligned,
   `tabular-nums`) / สถานะ (`StatusBadge`) / actions. Wrap it in an `overflow-x-auto` container.

### Action buttons — icon only, with Thai `title` + `aria-label`
Owner rule, applies site-wide from now on: **eye = view-only, pencil = edit/continue.** Reuse the existing
`IconBtn` from `ExpensesWorkspacePanels.tsx` (export it if it is not exported yet) and the icon set already
imported there — do not hand-author new SVG paths if an equivalent icon already exists in the project's icon
module.

| Row state | Buttons |
|---|---|
| `ISSUED` | 👁 `เปิดดูเอกสาร` (opens the issued artifact) |
| `PREPARED` / `PAYER_CERTIFIED` | ✏️ `ดำเนินการต่อ` → expense detail page |
| `SUPERSEDED` | 👁 `ดูประวัติ` → expense detail page |

There is deliberately **no download button in this phase** — PDF export is Phase 4, and the artifact is an SVG
that the viewer currently opens with `hideOpenNewTab`. Do not fake one.

### Empty / loading / error states
- loading → the same skeleton/`กำลังโหลด...` idiom the other expense panels use.
- error → `ErrorBanner`.
- empty → a card reading `ยังไม่มีใบรับรองแทนใบเสร็จรับเงินในบริษัทนี้` plus one line explaining when to use it:
  `ใช้เมื่อจ่ายเงินจริงแต่ผู้รับเงินออกใบเสร็จรับเงินให้ไม่ได้ เช่น ผู้ค้ารายย่อยหรือผู้รับจ้างอิสระ`.

## 7. Copy + formatting rules (owner directives, enforce in every string you add)

- **Tone**: formal-professional Thai that a layperson understands. Official vocabulary
  (เลขประจำตัวประชาชน, ลงลายมือชื่อ), short concrete sentences, verb-first buttons. No casual particles, no emoji
  in UI copy.
- **Dates**: one format everywhere — `5 ส.ค. 2569` (day, abbreviated Thai month, Buddhist-era year). Put the
  formatter in **one** exported helper and use it for every date this page renders; if `ExpensesUi.tsx` already
  has a Thai date helper, reuse that one instead of adding a second.
- **Dictionary**: user-visible strings go through the `t()` dictionary in
  `apps/web/src/common/i18n/workspace-dictionary.ts`. Add **both** the `th` and `en` entries for every new key —
  `workspace-i18n.spec.ts` asserts locale parity and will fail otherwise.

## Files

```
packages/contracts/src/expenses.ts
packages/contracts/src/feature-entitlements.ts
packages/contracts/src/menu-entitlements.ts
apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts
apps/api/src/modules/expenses/application/use-cases/substitute-receipt.use-case.ts
apps/api/src/modules/expenses/presentation/http/expense.controller.ts   (or the sibling controller that owns
                                                                          non-:expenseId company routes)
apps/api/src/modules/expenses/expenses.module.ts                        (provider registration)
apps/web/app/(workspace)/companies/[companyId]/expenses/substitute-receipts/page.tsx   (new)
apps/web/src/features/expenses/SubstituteReceiptHubPage.tsx                            (new)
apps/web/src/features/expenses/expenses.api.ts
apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx              (only if IconBtn needs exporting)
apps/web/src/features/web-core-workspace/web-core-workspace.constants.ts
apps/web/src/features/web-core-workspace/settings-menu.logic.ts
apps/web/src/common/i18n/workspace-dictionary.ts
+ one new spec: apps/web/src/features/expenses/substitute-receipt-hub.model.spec.ts
```

Put the "waiting on me" bucketing and the KPI maths in a pure exported function in a new
`apps/web/src/features/expenses/substitute-receipt-hub.model.ts` and test *that*, rather than testing the
component — that is the pattern the rest of this feature follows.

## Verify (run exactly these, in order)

```
corepack pnpm --filter @watchdog-bms/contracts run build
corepack pnpm --filter @watchdog-bms/api lint
corepack pnpm --filter @watchdog-bms/web typecheck
cd apps/web && corepack pnpm exec tsx --test src/features/expenses/substitute-receipt-hub.model.spec.ts
cd apps/web && corepack pnpm exec tsx --test src/common/i18n/workspace-i18n.spec.ts
```

No `pnpm --filter @watchdog-bms/api test` (its `pretest` needs postgres), no e2e, no servers, no
`prisma migrate` (this phase adds no schema change).

## Report back

1. The final route path + controller it landed on, and why.
2. The repo query (paste it) and how branch scope is applied.
3. The hub page's action-button table: which icon each row state renders.
4. Test output for each verify command.
5. Anything in this handoff that was wrong about the code — say so plainly rather than working around it.
