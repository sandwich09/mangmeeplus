# Expenses list — relocate export bar to the top toolbar — Codex CLI Handoff

Status: Implement-ready 2026-08-05. Owner request (desktop screenshot, green box): move the whole export section ("ส่งออกข้อมูลค่าใช้จ่ายในช่วงที่เลือกเพื่อส่งให้บัญชีหรือยื่นภาษี" + format select + ส่งออก Excel button) from its own card between the KPI row and the list up to the top-right of the page, on the same band as the period controls. **This is a DELIBERATE desktop-visible relayout** — the D2 pixel-parity rule from the responsive plans does not apply to this change (and only to this change). Executor: Codex CLI; Codex never commits, never `git add`, never runs servers.

## File

`apps/web/src/features/expenses/ExpensesPages.tsx` — component `ExpenseListPage` only. One file, nothing else (worktree is clean apart from generated `next-env.d.ts`; keep it that way).

Current structure (verified today):
- `:1216-1225` period toolbar (`finBar`): mobile scroll strip → `sm:` wrap row; segmented รายวัน/รายเดือน + ThemedDate + วันนี้/เดือนนี้ reset.
- `:1228` KPI card grid.
- `:1231-1241` the export bar card: desc text left; right group = optional `✓ ดาวน์โหลดแล้ว` + ThemedSelect (แบบย่อ/แบบเต็ม) + `ส่งออก Excel` button.

## Target layout

Replace the two blocks (period row + export card) with ONE toolbar band above the KPI grid:

```jsx
<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
  {/* left: existing period strip — keep its exact current classes and children */}
  <div className="flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">…</div>
  {/* right: export group, right-aligned on lg+ */}
  <div className="flex flex-col gap-1 lg:shrink-0 lg:items-end">
    <div className="flex flex-wrap items-center gap-2">
      {exported && <span …>✓ ดาวน์โหลดแล้ว</span>}
      <ThemedSelect … />   {/* keep min-w-0 w-auto */}
      <button …>ส่งออก Excel</button>
    </div>
    <p className="text-xs text-gray-400">{t('expenses.export_desc', locale)}</p>
  </div>
</div>
```

Rules:
- Move the existing JSX nodes verbatim (select options, aria-label, handlers, disabled/exporting states, `exported` flag) — only the wrappers change. Delete the old export card entirely (including its `rounded-2xl border` wrapper); do not leave an empty div.
- The description text becomes the small helper line under the buttons (`text-xs text-gray-400`), right-aligned on `lg+` via the parent's `lg:items-end`, left-aligned when stacked.
- Breakpoint is `lg` (not `sm`): period strip ≈446px + export group ≈330px only fit side-by-side ≥1024px. Below `lg` the export group stacks under the period strip, full-width flow, keeping the wrap behavior that shipped in the responsive follow-up (H4).
- No copy changes, no new dictionary keys, no state moves — `columnSet/exporting/exported/exportExcel` stay exactly where they are.
- KPI grid and everything below shift up one band; touch nothing else in the file.

## Verify (Codex runs ONLY this)

```
corepack pnpm --filter @watchdog-bms/web typecheck
```

Report: the before/after JSX skeleton of the toolbar band and confirmation that handlers/states are byte-identical.
