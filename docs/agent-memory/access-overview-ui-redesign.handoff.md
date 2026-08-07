# Handoff: access-overview-ui-redesign (implementation spec)

Read `docs/agent-memory/access-overview-ui-redesign.md` first for the decision record, and
`AGENTS.md` + `.agents/skills/ponytail/SKILL.md` for the working rules.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx` (the whole page)
- `apps/web/src/features/employee-access/access-overview.model.ts` (new — pure helpers only)
- `apps/web/src/features/employee-access/access-overview.model.spec.ts` (new — node:test)
- `docs/agent-memory/access-overview-ui-redesign.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency, no new React component file, no
change to `app/(workspace)/.../access-overview/page.tsx`.

---

## THE HARD CONSTRAINT

**This is a visual/UX redesign of a screen that is already wired to a live API and covered by e2e.
The behaviour must stay identical.** Do not change any API call, payload, permission gate, guard
expression, or error-handling path. If a change you want would alter behaviour, don't make it —
note it in the report instead.

These must survive **byte-for-byte in behaviour** (line numbers refer to the current file):

1. `reload()` — same four calls in one `Promise.allSettled`: `listEmployees`, `listRoles`,
   `getAccessMatrix`, `listCompanyBranches(companyId)`. Same per-result handling: only the
   employees rejection sets `error`; the other three fail silently. Same
   `setSelectedUserId((prev) => prev ?? first?.id ?? null)`. Same `setLoading(false)` at the end.
2. The four permission booleans, read from the same keys:
   `access.employee.update`, `access.employee.disable`, `access.role.manage`,
   `access.employee.credential.issue`.
3. `activeUserId` fallback: `filteredEmployees.some(e => e.id === selectedUserId) ? selectedUserId
   : filteredEmployees[0]?.id ?? null`.
4. `filteredEmployees` matching: role filter on `employee.roles.some(r => r.id === roleFilter)`,
   query matched case-insensitively against `displayName`, `nickname ?? ''`, `phoneNumber`.
5. `toggleSelectedActive` — guard `selectedIsOwner || selectedIsDraft || !canDisableEmployee`, then
   `setEmployeeStatus(companyId, id, selectedActive ? 'SUSPENDED' : 'ACTIVE')`, then `reload()`.
6. `deleteSelectedEmployee` — guard `selectedIsOwner || !canDisableEmployee`, then the same
   `window.confirm(\`ปิดการใช้งานบัญชีของ ${employeeShortName(...)} ใช่หรือไม่?\`)`, then
   `setEmployeeStatus(..., 'DISABLED')`, then `reload()`.
7. `changeSelectedRole` — guard `selectedIsOwner || !canEditEmployee`, then
   `updateEmployee(companyId, id, { roleIds: [roleId] })`, then `reload()`.
8. The assignable-role filter, unchanged:
   `roles.filter(r => !['OWNER','SYSTEM_ADMIN'].includes(r.key) && r.status === 'ACTIVE' && (canManageRoles || !hasPrivilegedGrant(r.permissionKeys)))`
9. `toggleBranch` — guard `selectedIsOwner || !selectedActive || !canEditEmployee`; the
   "can't remove the last branch" early return (`exists && selectedBranchIds.length === 1`); and
   the exact payload:
   ```ts
   { branchScopeMode: allSelected ? 'ALL_BRANCHES' : 'SELECTED_BRANCHES',
     branchIds: allSelected ? [] : next,
     defaultBranchId: next.includes(selectedEmployee.defaultBranchId ?? '')
       ? selectedEmployee.defaultBranchId : (next[0] ?? null) }
   ```
10. `selectedBranchIds` derivation: `branchScopeMode === 'ALL_BRANCHES' ? branches.map(b => b.id)
    : branchScopeBranchIds`.
11. Password-reset flow: confirm modal → `regenerateEmployeeCredential` → handoff modal showing
    `username`, `temporaryPassword`, `expiresAt` (via `toLocaleString('th-TH')`), and the
    `lineNotified` branch with both message strings. `resetError` uses
    `localizedErrorMessage(e, locale, { 403: 'error.forbidden', fallback: 'error.save_failed' })`.
12. `withBusy` error handling: `localizedErrorMessage(e, locale, { fallback: 'error.save_failed' })`.
    Load error uses `{ fallback: 'error.load_failed' }`.
13. `MVP1_INDIVIDUAL_PERMISSION_MENU_IDS` — same set, same comment, still filters which menus the
    permissions card lists.
14. `editSelectedEmployee` still pushes
    `/companies/${companyId}/settings/employees?edit=${encodeURIComponent(id)}`.

### e2e that must keep passing (`e2e/settings.spec.ts`)

- **SET-08**: `getByRole('heading', { name: /สิทธิ์รายบุคคล|Individual/ })` must resolve, and the
  literal string `สาขาที่เข้าถึงได้` must still render as the branch card heading.
- **SET-02 / SET-03A**: an employee's `displayName` must be findable via `getByText(...)` on this
  page. `employeeShortName()` returns `nickname || displayName`, so keep using it — do not switch
  the directory rows to a name that omits `displayName` for employees without a nickname.

---

## A. Shared primitives — reuse, do not re-create

```ts
import { MangmeeBadge, MangmeeCard, MangmeePage, MangmeeIconFrame, cx, getInitials } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
```

- Replace the hand-rolled header (breadcrumb `<nav>` + `<h1>` + `<p>`, current L392–400) with
  `MangmeePage`: `title="สิทธิ์รายบุคคล"`, the same description string, and `actions` = the
  `+ เพิ่มพนักงาน` link from §B7.
- Replace the loading branch (current L382–388) with
  `<div className="mangmee-page"><LoadingState label="กำลังโหลด…" /></div>`.
- Keep the local `SearchIcon`, `ShoppingCartIcon`, `SwapIcon`, `StampIcon`, `TagIcon` helpers and
  the `MENU_ICON` map — they have no shared equivalent.
- Keep `colorForRole`, `ROLE_COLOR_BY_KEY`, `FALLBACK_ROLE_COLORS` exactly as they are.
- Buttons use the existing `mangmee-btn` / `mangmee-btn-primary` / `mangmee-btn-secondary` classes
  where a real button is needed; do not invent new button classes.

## B. Page structure (top to bottom)

**B1 — `MangmeePage` header.** Title `สิทธิ์รายบุคคล`, description unchanged, `actions` slot holds
the add-employee CTA (§B7). Drop the manual breadcrumb.

**B2 — Read-only banner.** When `!canEditEmployee && !canDisableEmployee`, render one amber banner
above the grid, matching the established wording pattern in
`PermissionMatrixPrototypePage.tsx:246`:
`อ่านอย่างเดียว: บัญชีของคุณไม่มีสิทธิ์แก้ไขพนักงาน จึงเปลี่ยนตำแหน่ง สาขา และสถานะบัญชีไม่ได้`
Style: `rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800`.
The existing red `error` banner stays as-is, rendered separately.

**B3 — Summary strip (new).** Four counters above the two-column grid, in a
`grid gap-3 sm:grid-cols-2 xl:grid-cols-4`. Each is a `<button type="button">` wrapping a
`MangmeeCard` so it can filter the directory:

| label | counts | tone | filter value |
|---|---|---|---|
| พนักงานทั้งหมด | `employees.length` | slate | `all` |
| ใช้งาน | `status === 'ACTIVE'` | brand | `ACTIVE` |
| แบบร่าง | `status === 'DRAFT'` | amber | `DRAFT` |
| ปิดใช้งาน | `status !== 'ACTIVE' && status !== 'DRAFT'` | danger | `INACTIVE` |

Add `const [statusFilter, setStatusFilter] = useState<'all' | 'ACTIVE' | 'DRAFT' | 'INACTIVE'>('all')`
and extend `filteredEmployees` with the status predicate — keep the existing role and query
predicates unchanged. Clicking the active tile resets it to `'all'` (toggle). The selected tile gets
`border-brand-300 bg-brand-25`; give it `aria-pressed`. Counts get `tabular-nums`.
Use `MangmeeIconFrame` + `MangmeeCard` composition rather than `MangmeeStatCard`, because
`MangmeeStatCard` renders its own card and can't take the pressed state.

**B4 — Directory (left rail).** Keep the existing card, search input, role `ThemedSelect`, and
`EmployeeRow`. Three changes only:

- Wrap the card in `xl:sticky xl:top-6` and change the list's `max-h-[718px]` to
  `max-h-[min(60vh,640px)] xl:max-h-[calc(100vh-320px)]` so it stops pushing the dossier below the
  fold on laptop screens.
- `EmployeeRow` gains a third line: branch count (`ทุกสาขา` when `branchScopeMode === 'ALL_BRANCHES'`,
  else `${branchScopeBranchIds.length} สาขา`) in `text-[11px] font-semibold text-gray-400`.
- The empty state keeps its current wording but should say `ไม่พบพนักงานที่ตรงกับตัวกรอง` now that
  status filtering exists.

**B5 — Identity card (dossier, first).** Keep today's layout (avatar, name, phone, status switch,
`…` menu) with these changes:

- The role badge becomes a labelled control. Above it, a `text-xs font-bold text-gray-400` label
  `ตำแหน่ง`. The trigger is a real button: `inline-flex h-9 items-center gap-2 rounded-lg border
  border-gray-200 bg-white px-3 hover:border-brand-200 hover:bg-brand-25` containing the
  `RoleBadge` (no `withCaret`) plus a separate `ChevronDownIcon`. Add
  `aria-haspopup="listbox"`, `aria-expanded={rolePickerOpen}`. When the role can't be changed
  (`selectedIsOwner || !canEditEmployee`) render the bare `RoleBadge` with no button wrapper at
  all — no disabled button, nothing to click. For OWNER add the muted note
  `ตำแหน่งเจ้าของกิจการเปลี่ยนไม่ได้`.
- The popover gets `role="listbox"` and each option `role="option"` + `aria-selected`.
- Account status: keep `ToggleSwitch`, but the label column becomes a stacked
  `สถานะบัญชี` / value where the value is a `MangmeeBadge` — tone `brand` for ใช้งาน, `amber` for
  Draft, `danger` for ปิดใช้งาน. Encode state in form, not only in text.
- The `…` menu button gets `aria-haspopup="menu"` + `aria-expanded`, and the panel `role="menu"`
  with `role="menuitem"` on each entry. Contents and gating unchanged.

**B6 — Permissions card (replaces BOTH the green chips card and `สิทธิ์เฉพาะบุคคล`).**

Heading: `สิทธิ์การใช้งานของ {employeeShortName(selectedEmployee)}`.
Sub-line, one of:
- OWNER: `เจ้าของกิจการเป็น super-admin เข้าถึงทุกเมนูเสมอ ปรับสิทธิ์ไม่ได้`
- otherwise: `สิทธิ์มาจากตำแหน่ง {role.name} — พนักงานทุกคนที่อยู่ตำแหน่งนี้ได้สิทธิ์ชุดเดียวกัน`
  followed by a `next/link` to `/companies/${companyId}/settings/permissions` reading
  `แก้สิทธิ์ของตำแหน่งนี้ →` (`text-sm font-extrabold text-brand-700 hover:underline`).
  Render the link only when `canManageRoles`.

Header-right: a `MangmeeBadge` tone `brand` reading `{grantedCount}/{accessMenus.length} เมนู`.

Body: menus from `accessMenus` (same MVP1 filter), grouped by `menu.group`, groups in the fixed
order `main → shop → fin → settings`, each group preceded by a
`text-xs font-extrabold uppercase tracking-wide text-gray-400` label using this map:
`{ main: 'ทั่วไป', shop: 'หน้าร้าน', fin: 'การเงิน', settings: 'ตั้งค่า' }`.
Omit a group entirely when it has no menus after the MVP1 filter.

Each menu is a row: `MenuIconFrame` + `menu.labelTh` on the left, capability pills on the right.
- Granted row (`cell.view === true`): white background, `text-gray-900` label, pills for every
  action the cell grants.
- Not-granted row: `bg-gray-50/60`, `text-gray-400` label, icon frame at `opacity-50`, and a single
  muted pill `ไม่เห็นเมนูนี้`.

Capability pills come from the new pure helper (§C). Pill styling:
`inline-flex h-6 items-center rounded-full px-2 text-[11px] font-extrabold`; granted pills
`bg-brand-50 text-brand-700`; the not-granted pill `bg-gray-100 text-gray-400`.

Rows are laid out `flex flex-wrap items-center justify-between gap-3 rounded-xl px-3 py-2.5`,
groups separated by `gap-1` inside a `grid`. **No toggles anywhere in this card.**

**B7 — Add-employee CTA.** In `MangmeePage`'s `actions`, when
`viewerPermissions.includes('access.employee.create')`:
```tsx
<Link href={`/companies/${companyId}/settings/employees`} className="mangmee-btn mangmee-btn-primary">
  <PlusIcon className="h-4 w-4" /> เพิ่มพนักงาน
</Link>
```
`PlusIcon` is already imported; add `import Link from 'next/link'`.

**B8 — Branch card.** Heading stays exactly `สาขาที่เข้าถึงได้` (e2e depends on it). Keep the
description and the `branchCountLabel` badge. Add above the chips a `mangmee-segmented` mode switch
with two buttons, `ทุกสาขา` and `เลือกสาขา`, reflecting
`selectedEmployee.branchScopeMode === 'ALL_BRANCHES'`:

- `ทุกสาขา` → `updateEmployee(companyId, id, { branchScopeMode: 'ALL_BRANCHES', branchIds: [],
  defaultBranchId: selectedEmployee.defaultBranchId ?? null })` then `reload()`. This is the same
  payload shape `toggleBranch` already produces when every branch is ticked.
- `เลือกสาขา` → no write. It only reveals the chips for editing; the mode flips to
  `SELECTED_BRANCHES` on the next `toggleBranch` write, exactly as today. When the employee is
  currently `ALL_BRANCHES`, treat this as a local "editing" intent: add
  `const [branchPickerOpen, setBranchPickerOpen] = useState(false)` and show the chips when
  `branchScopeMode === 'SELECTED_BRANCHES' || branchPickerOpen`. Reset it to `false` whenever
  `activeUserId` changes.
- Both buttons disabled under the same guard as `toggleBranch`
  (`selectedIsOwner || !selectedActive || busy || !canEditEmployee`).

Keep `BranchAccessChip` and the per-chip disabled logic (including the last-branch lock) unchanged.
When a chip is disabled *only* because it is the last one, add
`title="ต้องมีอย่างน้อย 1 สาขา"` so the reason is discoverable.

**B9 — Save feedback.** Add `const [savedAt, setSavedAt] = useState<string | null>(null)` holding a
card key (`'role' | 'branch' | 'status'`). Extend `withBusy` to take that key:
`withBusy('branch', async () => {...})` — on success set `savedAt` to the key and clear it after
2000ms via a `setTimeout` cleared in a `useEffect`. Each of the three cards renders, in its header,
`busy && pendingKey === k ? 'กำลังบันทึก…' : savedAt === k ? 'บันทึกแล้ว' : null` as a
`text-xs font-bold` line (`text-gray-400` while saving, `text-brand-600` when saved), wrapped in
`aria-live="polite"`. Do not change `withBusy`'s error path.

## C. New pure helpers — `access-overview.model.ts`

Only pure functions, no React, no imports from the API module. Types come from
`@watchdog-bms/contracts`.

```ts
import type { ActionId, MenuGroup, PermissionMatrixCell } from '@watchdog-bms/contracts';

export const ACTION_LABEL_TH: Record<ActionId, string> = {
  view: 'ดู', create: 'เพิ่ม', edit: 'แก้ไข', del: 'ลบ', approve: 'อนุมัติ',
};

export const MENU_GROUP_LABEL_TH: Record<MenuGroup, string> = {
  main: 'ทั่วไป', shop: 'หน้าร้าน', fin: 'การเงิน', settings: 'ตั้งค่า',
};

export const MENU_GROUP_ORDER: MenuGroup[] = ['main', 'shop', 'fin', 'settings'];

/** Actions this cell actually grants, in a stable display order. `view` first. */
export function grantedActions(cell: PermissionMatrixCell | undefined): ActionId[];

/** Thai capability labels for a cell — [] when the menu is not visible at all. */
export function capabilityLabels(cell: PermissionMatrixCell | undefined): string[];
```

`grantedActions` returns `[]` for `undefined`, for `{}`, and for any cell whose `view` is not
`true` (a menu you cannot open grants nothing, even if a write key is technically mapped — this
is the rule the sub-line "สิทธิ์มาจากตำแหน่ง" promises the user). Otherwise it returns the actions
present-and-true, ordered `view, create, edit, del, approve`.

`capabilityLabels` maps `grantedActions` through `ACTION_LABEL_TH`.

### `access-overview.model.spec.ts`

`node:test` + `node:assert/strict`, matching the style of the sibling
`discount-policy.model.spec.ts`. Cover at minimum:

- `grantedActions(undefined)` → `[]`
- `grantedActions({})` → `[]`
- `grantedActions({ create: true })` (no view) → `[]`
- `grantedActions({ view: true })` → `['view']`
- `grantedActions({ view: true, create: true, edit: false, approve: true })` →
  `['view', 'create', 'approve']` (order asserted, `false` excluded)
- `capabilityLabels({ view: true, del: true })` → `['ดู', 'ลบ']`

## D. Delete when done

- `AccessRow` (current L197–213) — the dead-toggle row.
- `MenuChip` (current L172–179) — the green chips card that duplicated it.
- The `visibleMenus` derivation, once B6 renders from `accessMenus` + the cell directly.
- `ToggleSwitch` stays — the account-status switch still uses it.

## E. Accessibility and responsive

- Every popover trigger: `aria-haspopup` + `aria-expanded`; panels get `role="listbox"`/`"menu"`.
- The search input keeps its placeholder but gains `aria-label="ค้นหาพนักงาน"`.
- Summary tiles: `aria-pressed`.
- Save-state line: `aria-live="polite"`.
- Grid breakpoint moves from `xl:` to `lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]`
  so 1024–1279px gets the two-column layout instead of a 700px-tall list above the dossier.
- Nothing may cause horizontal page scroll; long branch/menu names truncate.

## F. Do NOT

- Do not add a dependency, a CSS file, or a new component file.
- Do not touch `page.tsx`, the API module, contracts, or any other feature.
- Do not add per-employee permission *editing* — the backend has no override model. The card is
  read-only by design; the link to the roles page is the escape hatch.
- Do not rename `IndividualPermissionsPrototypePage` or change its props.
- Do not change the Thai copy of anything listed under the hard constraint.

## G. Verify before reporting

Run and paste real output:

1. `pnpm --filter @watchdog-bms/web typecheck`
2. `pnpm --filter @watchdog-bms/web lint`
3. The new spec, however the repo runs colocated node:test specs (check
   `apps/web/package.json`'s `test` script and follow it).

Then write `docs/agent-memory/access-overview-ui-redesign.results.md` with:

- Status + the exact commands run and their output (or the exact reason one could not run).
- A checklist confirming each of the 14 hard-constraint items still holds, with the line number in
  the new file where each now lives.
- Anything in this spec you did **not** do, and why.
- Anything you noticed that is worth a follow-up but was out of scope.
