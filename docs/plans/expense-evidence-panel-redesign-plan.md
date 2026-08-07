# Plan: หลักฐานทางบัญชี (Evidence Panel) Redesign

Status: PLANNED — 2026-07-28
Owner: Claude (harness engineer) → Codex (implementation)
Scope: `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` (EvidencePanel) + `evidence-audit.logic.ts` (+ spec). Presentation and pure logic only.
Surface: `/companies/{companyId}/expenses/evidence`

## Problem — what the screenshot actually shows

Observed on a real company with 30 confirmed documents, 27 needing review:

1. **Five columns all say the same thing.** `เลขที่ค่าใช้จ่าย` = "รายการเดิมไม่มีเลขที่", `ประเภท` = "รอตรวจประเภทเอกสาร", `หลักฐานภาษี` = "รอตรวจหลักฐานภาษี", `ผู้ขาย` = "ไม่ระบุ", `ไฟล์` = "ไม่มีไฟล์" — repeated near-identically down 27 of 30 rows. Five columns of screen space carry one bit of information: *not done yet*.
2. **The most useful data on the screen is invisible.** `deriveEvidenceRowFlags()` (`evidence-audit.logic.ts:22`) already computes exactly which things are missing per row, with severity and Thai labels. It is rendered only into a `title` tooltip on the status cell (`ExpensesWorkspacePanels.tsx:549`) — unreachable on touch, unscannable by eye.
3. **Ten columns do not fit.** The screenshot shows a horizontal scrollbar; `ยอดรวม` and `ไฟล์` sit at the clipped edge.
4. **Rows are ~3× taller than needed.** Long Thai labels in narrow columns wrap to 2–3 lines ("รายการเดิมไม่มีเลขที่", "ไม่ระบุ", "ไม่มีไฟล์"), so only 10 rows fit per screen on a 30-row dataset.
5. **Alarm fatigue.** An attention row carries an amber left border *and* amber row background *and* an amber badge *and* amber text in the vendor cell *and* two amber status strings. When 90% of rows scream, nothing stands out.
6. **`0.00` reads as a real amount.** Most rows are unpriced drafts showing `0.00` while the header says `฿41,095.98`. The column is mostly noise that looks like data.
7. **The same count three times.** "30 รายการ" appears in the stat card, the folder rail, and the footer.
8. **"27 ต้องตรวจ" is not a work plan.** It says how many, never which kind. The user cannot tell whether this is one bulk fix or 27 individual ones.

## Design

### A. One "สิ่งที่ต้องแก้" chip cell replaces four status columns

Chips render `deriveEvidenceRowFlags` output directly — the data already exists, it just stops being hidden.

To avoid saying the same thing twice, chips carry only the gaps **not** already shown by a dedicated column:

| flag | shown as |
|---|---|
| `NO_FILE` | chip `ไม่มีไฟล์` (amber) |
| `NO_VENDOR` | chip `ไม่มีผู้ขาย` (amber) |
| `NO_CATEGORY` | chip `ยังไม่จัดหมวด` (slate) |
| `TAX_NEEDS_REVIEW` / `NOT_TAX_EVIDENCE` / `SUPPORTING_ONLY` | the existing `หลักฐานภาษี` badge — **no chip** |
| `LEGACY_NO_NUMBER` | the `เอกสาร` cell already reads "รายการเดิม" — **no chip** |

Empty cell when a row is clean; the `✓ ครบถ้วน` badge already carries that.

### B. Column set: 10 → 7, no horizontal scroll at ≥1280px

| # | column | content |
|---|---|---|
| 1 | สถานะ | `⚠ ต้องตรวจ` / `✓ ครบถ้วน` badge, `whitespace-nowrap` |
| 2 | เอกสาร | line 1 = expense number bold (or muted `รายการเดิม`); line 2 = document type, muted `text-xs` |
| 3 | วันที่ | line 1 = `expenseDate`; line 2 = muted `ส่งเข้า {uploadedAt}`; `whitespace-nowrap` |
| 4 | ผู้ขาย | name, or muted `—` (not amber — the chip already flags it) |
| 5 | ยอดรวม | right-aligned tabular; **`—` muted when the amount is 0**, never `0.00` |
| 6 | หลักฐานภาษี | existing badge + tone, `whitespace-nowrap` |
| 7 | สิ่งที่ต้องแก้ | the chips from §A; this is the only cell allowed to wrap |
| — | `›` | unchanged open affordance |

`ประเภท`, `ส่งเข้า`, and `ไฟล์` disappear as standalone columns — folded into cells 2, 3, and the chips.

### C. Problem-type filter bar — turn the wall of orange into a queue

Above the table, a row of toggle chips built by aggregating the same flags:

```
[ ทั้งหมด 30 ]  [ ⚠ ต้องตรวจ 27 ]  [ ไม่มีไฟล์ 24 ]  [ ยังไม่ตรวจภาษี 26 ]  [ ไม่มีผู้ขาย 25 ]  [ ยังไม่จัดหมวด 30 ]
```

Selecting one filters the loaded rows. This is what makes the screen answer "what work is in front of me", and it replaces the current single `attentionOnly` checkbox + the duplicate stat-card toggle.

Client-side only — the rows are already loaded. Two new pure functions in `evidence-audit.logic.ts`, both spec'd:

```ts
export function summarizeEvidenceFlags(rows: SharedEvidenceRow[]): Array<{ key: EvidenceFlagKey; label: string; count: number }>
export function filterRowsByFlag(rows: SharedEvidenceRow[], key: EvidenceFlagKey | 'all' | 'attention'): SharedEvidenceRow[]
```

Chips with a zero count are not rendered — an accountant should not see "ไม่มีไฟล์ 0".

### D. Calm the palette

An attention row keeps **only** the amber left border + the status badge. Remove the amber row background (`bg-warning-50/40`) and the amber vendor text (`text-warning-700`). Severity now lives in the chips, where it is specific.

### E. Deduplicate counts

Stat cards keep `เอกสารยืนยันแล้ว` and `มูลค่ารวม`. The `ต้องตรวจเพิ่ม` stat card becomes redundant with the filter bar — remove it, and let the `⚠ ต้องตรวจ` chip own that number. Footer keeps the range line; drop the trailing duplicate total row.

### F. Preserve

Row click → `onOpenExpense`, keyboard `Enter`/`Space`, `role="link"`, `aria-label`, folder rail behavior, all filters, the export button, and the package result card. Filter chips need `aria-pressed`.

## Constraints

- **No API or contract change.** Every value is already on `SharedEvidenceRow`.
- No new dependency. Reuse `MangmeeBadge`, `MangmeeCard`, `MangmeeStatCard`, existing `ICON`, and the `mangmee-table` class.
- Pure logic goes in `evidence-audit.logic.ts` with cases in `evidence-audit.logic.spec.ts`; JSX stays presentational (repo rule: web runner only picks up `*.spec.ts`).
- Do not touch the entitlement/sub-menu work in flight elsewhere in this repo.

## Verification

1. `corepack pnpm --filter @watchdog-bms/web test` — 0 fail, new spec cases visible in output
2. `corepack pnpm --filter @watchdog-bms/web typecheck`
3. `corepack pnpm --filter @watchdog-bms/web build`
4. Column count is 7 and the table does not scroll horizontally at 1280px
5. A row with no file, no vendor, no category renders exactly three chips and no duplicate of the tax badge
6. Zero-count filter chips are absent; selecting a chip narrows the rows and `aria-pressed` flips

## Out of scope

Sequential "ตรวจรายการถัดไป" review flow, bulk edit, server-side filtering, and changes to the export package. Note the sequential-review idea as the natural follow-up: with 27 same-shaped fixes, a next/prev walker would beat click-back-click.
