# Handoff: reimbursements-ui-fixes-round2 (implementation spec)

Read `docs/agent-memory/reimbursements-ui-fixes-round2.md` (decision record) and
`docs/agent-memory/reimbursements-ui-redesign.handoff.md` (round 1 — its **THE HARD CONSTRAINT** and
its 11 invariants still apply in full). Also `AGENTS.md` + `.agents/skills/ponytail/SKILL.md`.

**Scope: `apps/web` only.** Only these files may change:

- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` (+ its `.spec.ts`)
- `apps/web/app/(workspace)/companies/[companyId]/reimbursements/page.tsx`
- `docs/agent-memory/reimbursements-ui-fixes-round2.results.md` (your report)

No API, no Prisma, no `packages/contracts`, no new dependency, no new component file.

**Do NOT attempt to fix the `Internal server error`.** It was a stale generated Prisma client and is
already fixed in the main thread (see the decision record). It is not a UI bug. If you see it, the
API just needs restarting — do not change frontend code because of it.

## Carried-over constraints (round 1, still binding)

All 11 invariants from the round-1 handoff must still hold. The ones these changes get near:

- Tab gating flows through `visibleHubTabs` / `parseHubTab`; the `?tab=` initial-tab-only rule and the
  `?focus=<id>` deep link must keep working.
- `handleCreate` — payload, line mapping, `validateRequestForm` call, and the partial-failure branch
  (draft created but attachment upload failed) must not change.
- The zero-tabs guard still short-circuits before any queue renders.
- No API call, payload, permission gate, or action-visibility conditional may change behaviour.

---

## A. `ตั้งค่านโยบาย` tab: admin + company owner only

Today `HUB_TAB_PERMISSIONS.policy = ['reimbursement.policy.manage']`. That permission is also grantable
through the assignable capability pack `pack.reimbursement.policy`, so a custom role can see the tab.
The tab must now additionally require the `OWNER` or `ADMIN` **role**.

**Keep the permission check.** The new role check is an *additional* narrowing, never a replacement —
the server still authorises on the permission alone, and we must not offer a tab the server would 403.

### A1. `reimbursements.logic.ts`

Give `visibleHubTabs` a second parameter and gate `policy` on both. Follow the house pattern at
`apps/web/src/features/crm/CustomersPrototypePage.tsx:458`.

```ts
/** Roles allowed to manage company-wide reimbursement policy (UI narrowing; server checks the permission). */
const POLICY_ROLE_KEYS = ['OWNER', 'ADMIN'] as const;

export function visibleHubTabs(permissions: readonly string[], roles: readonly string[] = []): HubTab[] {
  return HUB_TABS.filter((tab) => {
    if (!HUB_TAB_PERMISSIONS[tab].some((key) => permissions.includes(key))) return false;
    // ตั้งค่านโยบาย is company-wide configuration: owner/admin only, even if a custom
    // capability pack granted the permission.
    if (tab === 'policy') return roles.some((role) => (POLICY_ROLE_KEYS as readonly string[]).includes(role));
    return true;
  });
}
```

`roles` **must** default to `[]` so any existing call site keeps compiling; with no roles the policy tab
simply hides, which is the safe direction.

Update the existing `visibleHubTabs` tests and add cases:
- OWNER with the permission → `policy` present.
- ADMIN with the permission → `policy` present.
- A role holding the permission but neither OWNER nor ADMIN (e.g. `['FINANCE']`) → `policy` **absent**,
  while the tabs it does have permission for are still returned.
- Empty roles → `policy` absent.
- Missing the permission but holding OWNER → `policy` absent (permission is still required).

### A2. Thread `roles` through

- `page.tsx`: pass `roles={session?.roles ?? []}` alongside the existing props. `WebSession.roles` is
  `string[]` of role **keys** — it already exists, do not add anything to the session model.
- `ReimbursementsHubPage` props gain `roles: readonly string[]`, passed into the
  `useMemo(() => visibleHubTabs(permissions, roles), [permissions, roles])`.

That `useMemo` already feeds `parseHubTab`, so a deep link to `?tab=policy` from a non-admin falls back
to their first visible tab automatically. Do not add a separate redirect.

---

## B. `รายการที่ขอเบิก`: collapsible line cards

In `MyRequests`' create form (the `MangmeeCard` headed `รายการที่ขอเบิก`, around L393–L440).

**Everything about the fields, `FormLine`, `setLine`, `emptyLine`, `handleCreate` and the payload stays
exactly as it is.** This is presentation only.

### B1. State

```ts
// Collapsed line indices. Lines stay MOUNTED when collapsed (see B3) — this only hides them.
const [collapsedLines, setCollapsedLines] = useState<Record<number, boolean>>({});
```

Reset it to `{}` wherever `form` is reset to `emptyForm()` (successful create, and the
`ยกเลิก`/toggle paths) so a fresh form never opens with stale collapse state.

### B2. Card header

Replace the bare `<h3>รายการที่ขอเบิก</h3>` with a header row:

- left: `รายการที่ขอเบิก` + a count badge `<MangmeeBadge tone="slate">{form.lines.length} รายการ</MangmeeBadge>`
- right: a single `ghostClass` toggle button, compact (`!min-h-9 !px-3 !py-1.5 !text-xs`), labelled
  `ย่อทั้งหมด` when at least one line is expanded, `ขยายทั้งหมด` when all are collapsed. It sets
  `collapsedLines` to all-true or `{}` respectively. Hide this button when `form.lines.length < 2`.

### B3. Per-line block

The line header becomes the collapse toggle:

```tsx
<div className="flex items-center justify-between gap-3">
  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left"
    aria-expanded={!collapsedLines[i]} onClick={() => setCollapsedLines(c => ({ ...c, [i]: !c[i] }))}>
    <span className={cx('text-gray-400 transition-transform', !collapsedLines[i] && 'rotate-90')}>▶</span>
    <span className="text-sm font-bold text-gray-700">รายการที่ {i + 1}</span>
    {collapsedLines[i] && <span className="truncate text-xs text-gray-500">{lineSummary(l)}</span>}
  </button>
  {form.lines.length > 1 && (
    <button type="button" aria-label="ลบรายการ" className="shrink-0 text-error-600 hover:text-error-700"
      onClick={…unchanged filter…}>{ICON.trash}</button>
  )}
</div>
```

Wrap **only the fields grid** in the hidden toggle — the header always shows:

```tsx
<div className={cx('mt-3 grid gap-3 sm:grid-cols-2', collapsedLines[i] && 'hidden')}>…unchanged fields…</div>
```

`hidden`, **not** conditional rendering. Unmounting would drop in-progress values and skip the native
`required` constraints — the same failure mode as the expenses stepper in the previous task.

Add a small pure helper next to the component (not exported, or exported + tested if you prefer):

```tsx
/** One-line preview of a collapsed row: date · description · amount. */
function lineSummary(line: FormLine): string {
  const parts = [line.incurredDate, line.description.trim(), line.amount ? `${formatMoney(line.amount)} บาท` : '']
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'ยังไม่ได้กรอกข้อมูล';
}
```

### B4. Newly added lines must open

`+ เพิ่มรายการ` keeps its existing `setForm` exactly as-is; just also clear the new index's collapsed
flag (the new line is at `form.lines.length`, which is absent from the map, so it is expanded by
default — verify this and add no code if so). Default state for every line is **expanded**, preserving
today's behaviour for anyone who never touches the toggles.

### B5. Submit must expand everything first — REQUIRED, do not skip

A `required` input inside a `display:none` ancestor makes the browser throw
*"An invalid form control with name='' is not focusable"* and silently refuse to submit. So the submit
button in the `สรุปคำขอ` card must expand all lines **before** constraint validation runs:

```tsx
<button type="submit" className={cx(btnClass, 'w-full')} disabled={busy === 'create'}
  onClick={() => setCollapsedLines({})}>…</button>
```

`onClick` on a submit button fires before the form's validation/submit, which is exactly what we need.
Do not remove any `required` attribute, and do not touch `validateRequestForm`.

---

## C. `ตั้งค่านโยบาย`: full-width professional layout

Today it is `max-w-3xl space-y-4` — three cards stacked in a narrow column that leaves most of a wide
screen empty. Rebuild the layout to match the create form's proven two-column shape.

**Every field, its `value`/`onChange`, `form` state, `save()`, the `updateReimbursementPolicy` payload,
`load()`, `busy`, `saved`, and the loading/error early-returns stay exactly as they are.** Regroup and
restyle only — do not add, remove, or rename a single setting.

### C1. Shell

```tsx
<form onSubmit={save} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
  <div className="grid gap-4 xl:grid-cols-2">…the three setting cards…</div>
  <aside>…sticky summary…</aside>
</form>
```

- `เกณฑ์การอนุมัติ` has the most fields → give it `xl:col-span-2` so it spans the full left column.
- `ใบเสร็จและรายการซ้ำ` and `การเงินและ SLA` sit side by side below it on `xl`, stacking under that.
- Each card keeps its existing heading + helper line. Give each heading an `ICON`-framed glyph to match
  the rest of the workspace: `ICON.doc` / `ICON.receipt` / `ICON.wallet` in a
  `<span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{…KPI.sky / KPI.amber / KPI.purple}}>`,
  laid out as `flex items-start gap-3` with the heading block.

### C2. Toggle rows

The three checkbox rows read as plain bordered strips today. Give each a label **and** a one-line
description, keeping the same `<input type="checkbox">` and the same `checked`/`onChange`:

```tsx
<label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
  <span className="min-w-0">
    <span className="block text-sm font-semibold text-gray-800">ต้องมีใบเสร็จ</span>
    <span className="mt-0.5 block text-xs text-gray-500">ทุกรายการต้องแนบใบเสร็จก่อนส่งอนุมัติ</span>
  </span>
  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={…} onChange={…} />
</label>
```

Descriptions (plain Thai, one line each):
- `ต้องมีใบเสร็จ` → `ทุกรายการต้องแนบใบเสร็จก่อนส่งอนุมัติ`
- `อนุญาตไม่มีใบเสร็จได้หากระบุเหตุผล` → `ผู้ขอกรอกเหตุผลแทนใบเสร็จได้ในบางกรณี`
- `อนุญาตให้อนุมัติคำขอตนเอง` → `ผู้อนุมัติกดอนุมัติคำขอที่ตัวเองสร้างได้`
- `ต้องผ่านการตรวจสอบการเงินก่อนจ่าย` → `คำขอที่อนุมัติแล้วต้องให้ฝ่ายการเงินตรวจก่อนบันทึกจ่าย`

### C3. Sticky summary rail

`<MangmeeCard className="sticky top-4 h-fit p-4">` headed `สรุปนโยบาย`, showing the **current form
state** (live, derived — no new state, no new request):

- `ต้องอนุมัติเมื่อยอด` → `≥ {formatMoney(form.approvalRequiredFromAmount)} บาท`
- `ผู้อนุมัติ` → the selected `approverMode`'s Thai label. Lift the four `<option>` labels into a
  module-level `const APPROVER_MODE_LABELS: Record<string, string>` and drive **both** the `<select>`
  options and this summary from it, so they cannot drift.
- `ใบเสร็จ` → `MangmeeBadge` `tone="brand"` `จำเป็น` / `tone="slate"` `ไม่บังคับ`
- `ตรวจการเงินก่อนจ่าย` → `MangmeeBadge` `tone="brand"` `เปิด` / `tone="slate"` `ปิด`
- `SLA` → `{form.slaHours} ชั่วโมง` or `ไม่กำหนด` when empty/null
- then `{error && <ErrorBanner …/>}`, `{saved && <InfoBanner message="บันทึกนโยบายแล้ว" />}`, and the
  submit button as `cx(btnClass, 'w-full')` with the unchanged `disabled={busy}` and label swap.

Use a small local row component or a plain `flex items-center justify-between` per row — labels
`text-xs text-gray-500`, values `text-sm font-semibold text-gray-800`.

**Delete** the old bottom `<div className="flex justify-end">` save row and the old inline
`{error}` / `{saved}` banners — the rail owns them now. The form must still have exactly one
`type="submit"` button.

---

## Constraints

- Shortest correct diff. No new files, no new dependencies, no refactor of untouched code.
- Keep every Thai string hardcoded — **no `t()` / `workspace-dictionary`** (round-1 decision D5).
- Compact button sizing in this file uses the leading-`!` important modifier
  (`!min-h-9 !px-3 !py-1.5 !text-xs`) because `.mangmee-btn` in `globals.css` is unlayered and would
  otherwise beat Tailwind utilities. Verified working on Tailwind 4.3.1 — keep that convention.
- Do not weaken or delete existing tests.

## Verification (run these; record exact output in the report)

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web lint
corepack pnpm --filter @watchdog-bms/web test
```

Tests to add/update in `reimbursements.logic.spec.ts`:
1. The five `visibleHubTabs` role cases listed in A1.
2. Existing `visibleHubTabs` / `parseHubTab` tests updated for the new signature — they must still
   pass, including any call that omits `roles`.
3. If you export `lineSummary`, cover: fully filled → `date · desc · amount`; empty → `ยังไม่ได้กรอกข้อมูล`;
   partially filled → only the present parts, no stray separators.

## Report back

Write `docs/agent-memory/reimbursements-ui-fixes-round2.results.md` with:

- Files touched, one line each: what changed and why.
- Confirmation that the round-1 invariants still hold, calling out specifically: `handleCreate`
  payload/partial-failure path unchanged, `updateReimbursementPolicy` payload unchanged, and no field
  added or removed from the policy form.
- An explicit statement of how collapsed lines avoid the non-focusable-required-control problem (B5).
- The verification commands with their **real** output. Do not claim a check you did not run.
- Anything you could not do, with the reason.
