# Handoff: expenses-nav-ux-redesign (implementation spec)

Read `docs/agent-memory/expenses-nav-ux-redesign.md` first for the decision record, and
`AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Scope: `apps/web` only.** No API, no Prisma, no `packages/contracts` changes. No new dependencies.
Reuse existing primitives (`MangmeeCard`, `MangmeePage`, `mangmee-*` CSS classes, `ICON`, `KPI`,
`StatCard`, `ThemedDate`, `ThemedSelect`, `LoadingState`, `CoverLoader`, `inputClass`, `btnClass`,
`ghostClass`). Every user-facing string goes through `t()` with keys added to **both** `th` and `en`
blocks of `apps/web/src/common/i18n/workspace-dictionary.ts`. Prefer reusing existing keys.

Anchor files:
- `apps/web/src/features/expenses/ExpensesPages.tsx` (hub, upload panel, detail modal, list, manual)
- `apps/web/src/features/expenses/ExpensesUi.tsx` (StatCard, ICON, banners)
- `apps/web/src/features/web-core-workspace/web-core-workspace.logic.ts` (`buildNavItems`)
- `apps/web/src/features/web-core-workspace/WorkspaceLayout.tsx` (`ICON_MAP`, nav order)
- `apps/web/src/common/components/app-shell/AppSidebar.tsx`
- `apps/web/src/features/dashboard-notifications/NotificationBell.tsx`
- `apps/web/app/(workspace)/companies/[companyId]/expenses/`

---

## A. Move the five tabs into the sidebar sub-menu, delete the tab bar

### A1. Nav sub-items

In `buildNavItems` (`web-core-workspace.logic.ts`), add a branch for `mod.key === 'expenses'` shaped
exactly like the existing `mod.key === 'roles'` branch. Sub-items, in this order, each pushed only when
the permission gate passes (gates mirror `expenseCapabilities` in `expenses.model.ts`):

| key | label key | href suffix | permission gate |
|---|---|---|---|
| `expenses.list` | `expenses.tab_list` | `/expenses` | always |
| `expenses.upload` | `expenses.tab_upload` | `/expenses/upload` | `expense.receipt.upload` |
| `expenses.manual` | `expenses.tab_manual` | `/expenses/manual` | `expense.create` |
| `expenses.categories` | `expenses.tab_categories` | `/expenses/categories` | `expense.category.manage` |
| `expenses.signatures` | `expenses.tab_signatures` | `/expenses/signatures` | `expense.signature.manage` |
| `expenses.evidence` | `expenses.tab_evidence` | `/expenses/evidence` | `expense.read` |

Icons come from the `iconMap` argument (the same map `roles` uses): list `DocsIcon`, upload `FileIcon`,
manual `PlusIcon`, categories `TagIcon`, signatures `StampIcon`, evidence `ShieldIcon`. `tone: 'slate'`
for all, matching the `roles` children.

`getActiveModuleKey` already returns `expenses` for every `/expenses/*` path — do not change it.

### A2. Sidebar active-state fix (required, or รายการค่าใช้จ่าย highlights on every child page)

`AppSidebar.isActiveSubItem` currently returns true whenever `pathname` starts with `sub.href`, so
`/expenses/upload` marks the `/expenses` list item active too. Change sub-item matching so the
**longest matching sibling href wins**: a sub-item is active only if `isPathMatch(sub.href)` and no
sibling of the same parent has a longer href that also matches. Keep the `sub.key === activeKey` branch.
Keep the change local to `AppSidebar.tsx`; do not alter `NavItem`'s shape.

### A3. Routes

Add five server pages mirroring the existing `expenses/page.tsx` (await `params`, `fetchServerSession`,
render the hub with a fixed tab):

```
app/(workspace)/companies/[companyId]/expenses/upload/page.tsx
app/(workspace)/companies/[companyId]/expenses/manual/page.tsx
app/(workspace)/companies/[companyId]/expenses/categories/page.tsx
app/(workspace)/companies/[companyId]/expenses/signatures/page.tsx
app/(workspace)/companies/[companyId]/expenses/evidence/page.tsx
```

`expenses/[expenseId]/page.tsx` is a redirect route; static segments win in Next.js, so these five
literal segments take precedence. Leave that file alone.

### A4. Hub component

`ExpensesHubPage` gains a `tab?: ExpensesTab` prop (default `'list'`) and:

- **Deletes** the `mangmee-segmented` tab bar from `MangmeePage actions` and the `tabs` /
  `visibleExpensesTabs` UI wiring. Keep the per-tab title/description via `TAB_META` (the page header
  description is what tells the user where they are now that chips are gone).
- Renders only the panel for the incoming `tab`.
- If the incoming tab's permission gate fails, render the existing forbidden/empty state pattern
  (`StateBanner` / the `🔒 คุณไม่มีสิทธิ์เข้าถึงส่วนนี้` style already in `ExpensesUi.tsx`) instead of
  silently falling back to the list.
- On `/expenses` only: if `?tab=<key>` is present, `router.replace()` to the matching route
  (preserve any other query params). This keeps the LINE deep link
  `/companies/{id}/expenses?tab=signatures&signatureId=…` working.
- `?expenseId=` handling on the list route is unchanged.
- Cross-panel navigation that used `setTab('list')` becomes a `router.push` to
  `/companies/{id}/expenses?expenseId=<id>` so the detail modal opens on the list route:
  - `UploadPanel onSuccess` — the extraction notice must still reach the modal. Carry it through
    `sessionStorage` under a single key keyed by expenseId, or keep the upload panel's success state and
    render the modal in place — pick the smaller diff and say which in the report. Do not lose the notice.
  - `ManualExpensePanel onSuccess`, `EvidencePanel onOpenExpense` — same route push.

`visibleExpensesTabs` may be deleted or kept as the permission gate for A4; if any spec references it,
update the spec rather than leaving dead code.

---

## B. Balance the รายการค่าใช้จ่าย layout

In `ExpenseListPage` / `ExpensesUi.tsx`:

1. **KPI row.** `flex flex-wrap gap-3` with five `flex-1 min-w-[180px]` cards produces a 3+2 row where
   the last two stretch to half the page. Replace with an equal-width responsive grid
   (`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3`), and drop `flex-1
   min-w-[180px]` from `StatCard`'s wrapper in favour of `h-full` so cards in a row match height.
2. **Table columns.** `GRID = 'grid grid-cols-[minmax(0,1.6fr)_.9fr_.8fr_auto]'` lets the status column
   size itself from badge text, so the right edge and the header labels drift. Use fixed trailing
   columns, e.g. `grid-cols-[minmax(0,1fr)_140px_150px_180px]`, with the amount and status columns
   right-aligned in both header and rows. Header and rows must use the same constant.
3. Wrap the rows region in `overflow-x-auto` with a `min-w-[760px]` inner track so narrow viewports
   scroll instead of crushing the columns.
4. Keep the chips/search row, pagination, export bar, and all data logic untouched.

---

## C. Shrink the notification bell

`NotificationBell.tsx`: the trigger is `h-10 w-10` with a 24px glyph and an `h-5 min-w-5` badge offset
`-right-1.5 -top-1.5`, which reads oversized next to the avatar. Take it to a `h-9 w-9` button, an
18px icon (pass `className="h-[18px] w-[18px]"` to `DesignIcons.bell`), and a badge at
`h-4 min-w-4 text-[10px] -right-1 -top-1`. Do not change the dropdown panel, polling, or API calls.

---

## D. Redesign the บันทึกด้วยมือ page

`ManualExpensePanel` today is a single `max-w-3xl` card floating in a wide empty page. Rebuild the
layout (fields, payload, and `createExpenseDraft` call stay exactly as they are):

- Two-column on `lg:` — `grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4`, single column below.
- **Left**: the three existing sections (ข้อมูลเอกสาร / จำนวนเงิน / ภาษี) as `MangmeeCard`s with an
  `ICON`-framed section heading and a one-line helper under each heading in plain Thai.
- **Right**: a `sticky top-4` summary card showing, live from the current form state — ยอดก่อนภาษี,
  VAT (derived from the selected tax code's `vatRate` / `vatMode`; ฿0.00 when no tax code), ยอดรวมสุทธิ
  in the large `tabular-nums` treatment the detail modal uses, the selected tax-code name as a
  `MangmeeBadge` (or "ไม่ใช้ Tax Code"), the submit button, and the existing
  "ระบบจะบันทึกเป็นฉบับร่างให้ตรวจสอบก่อนยืนยันลงบัญชี" note. The submit button moves here; remove the
  full-width one at the bottom of the form.
- Keep the disabled/`canCreate` gating, `ErrorBanner`, and forbidden-character validation identical.
- VAT math must be a pure helper in `expenses.model.ts` (or a local exported function) with a unit test
  — see Verification.

---

## E. The stepper must remember what the user typed

In `ExpenseDetailModal`, guided mode renders `{step === 'details' && <>…</>}` etc. Every step change
unmounts the panel, so `ExpenseReviewEditSection`'s `values` and `DocumentReviewSection`'s
`docType`/`taxStatus`/`categoryId` reset to whatever the server last returned — this is the reported
"Step ใน pop-up ไม่จำค่า".

1. Render all four guided panels and hide the inactive ones (`className={step === 'x' ? undefined :
   'hidden'}` on the wrapper) so component state survives step navigation. Keep the non-guided
   continuous-scroll branch exactly as it is.
2. `ExpenseReviewEditSection` has `useEffect(() => setValues(reviewValues(detail)), [detail])`. `detail`
   is a fresh object on every `load()`, so an unrelated refresh wipes in-progress edits. Re-initialise
   only when the record identity or server version changes — key the effect on
   `detail.id` + `detail.updatedAt` (both exist on `ExpenseDetail`), not the object reference.
3. Leave the existing save-on-leave for the details step (`goToStep` → `reviewSaveRef`) in place.
4. `DocumentReviewSection` keeps its own save button; with the panel mounted its pending edits now
   survive a step switch. Do not add a second auto-save path.

---

## F. Plain-Thai step wording

The stepper labels are accountant-speak (`เอกสาร & AI`, `หลักฐานภาษีและเอกสาร`, `สรุปและส่งตรวจ`) and
give no instruction. Add dedicated step keys (th + en) and a one-line helper rendered under the step
chip bar for the active step:

| step | label (th) | helper (th) |
|---|---|---|
| document | `1. รูปใบเสร็จ` → use label `รูปใบเสร็จ` | `ดูว่า AI อ่านข้อมูลจากรูปครบหรือยัง ถ้ายังไม่ครบให้กดอ่านอีกครั้ง` |
| details | `ผู้ขายและรายการ` | `ตรวจชื่อร้าน วันที่ และรายการสินค้า/บริการให้ตรงกับใบเสร็จ` |
| evidence | `ภาษีและเอกสาร` | `เลือกว่าเอกสารนี้เป็นใบกำกับภาษีหรือไม่ เพื่อให้ระบบคิดภาษีถูกต้อง` |
| review | `ตรวจก่อนส่ง` | `ดูสรุปทั้งหมดอีกครั้ง แล้วส่งให้ผู้อนุมัติ` |

Write natural English equivalents in the `en` block. Keep `STEP_LABEL_KEYS` as the mapping point.
Also plain-language the upload flow strip (`expenses.flow_upload` / `flow_ai_read` / `flow_confirm`) if
the wording is jargon — short verb phrases a shop owner reads once.

---

## G. Show the AI working

1. **`UploadPanel` CTA** (`expenses.upload_cta` = "ให้ AI อ่านใบเสร็จ"): the button already swaps its
   label but shows no motion. Add an inline spinner (the `animate-spin` ring used by `LoadingState`,
   size `sm`) inside the button while `preparing || loading || extracting`, and render a phase line
   under the button — กำลังอัปโหลดไฟล์… → AI กำลังอ่านใบเสร็จ (ประมาณ 10–20 วินาที) — driven by the
   existing `preparing` / `loading` / `extracting` flags. Do not change the upload/extract control flow
   (including the existing single retry).
2. **`อ่านเอกสารอีกครั้ง` in the detail modal footer**: same inline spinner while `extractionLoading`,
   and wrap the document step panel in `CoverLoader` (`scope="section"`,
   `label={t('expenses.ai_reading', locale)}`) while extraction runs, so the user sees the panel is busy.

---

## Constraints

- Shortest correct diff. No speculative abstractions, no new dependencies, no refactor of untouched code.
- Do not change permission gates, API calls, payload shapes, or business logic anywhere in this task.
- Do not delete or weaken existing tests.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Add unit tests (co-located `*.spec.ts`, matching existing style):
- nav sub-item construction: `buildNavItems` yields the expected `expenses` sub-items for a full-
  permission user, and drops each sub-item when its permission is absent.
- sidebar longest-match: the `/expenses` list sub-item is not active for `/expenses/upload`.
- the manual-entry VAT/total helper from D.

## Report back

Write `docs/agent-memory/expenses-nav-ux-redesign.results.md` with: files touched (one line each, what
changed and why), the extraction-notice approach chosen in A4, verification commands with real output,
and anything you could not do with the reason. Do not claim a check passed that you did not run.
