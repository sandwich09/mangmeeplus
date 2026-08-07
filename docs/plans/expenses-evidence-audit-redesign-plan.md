# Plan: Evidence Tab (หลักฐานทางบัญชี) — Audit-Focused UX/Layout Redesign

Status: PLANNED — 2026-07-26
Owner: Claude (harness engineer) → Codex (implementation)
Branch: `fix/permissions-system` (working tree also carries uncommitted stepper-UX + expenses-ux-hardening work — do NOT disturb; anchor on symbols)
Scope: `apps/web` only — `EvidencePanel` in `ExpensesWorkspacePanels.tsx` + one new pure-logic module + tests. **No API/contract changes** — every signal below is computable from fields already in `SharedEvidenceRow` / `SharedEvidenceFolder`.

## Product goal (from owner, Thai)

The evidence tab serves someone auditing the books (owner or accounting office). Today it feels hard to use: unclear what each button does, no visual difference between normal and problematic entries. Redesign UX/UI + layout so an auditor can (1) instantly see what needs attention, (2) understand every control, (3) drill into a problem row in one click.

## Design method

Applied the dataviz skill's procedure (form → color-by-job → status rules):
- The data's job here is **headline counts + a scannable table** → KPI row of stat tiles + table. No charts needed.
- **Status colors are reserved and never color-alone**: every state ships icon + Thai label (⚠ ต้องตรวจ / ✓ ครบถ้วน), using existing Mangmee tones (`amber` = attention, `brand` = good, `danger` = serious, `slate` = neutral). No new palette → no validator run needed (no categorical series anywhere).
- **Emphasis over decoration**: problem rows get the accent; normal rows stay quiet. Never tint everything.
- **Filters: one row, above the content they scope; labeled; date basis first.**
- **Refetch keeps the frame**: while reloading, the table holds its previous render at reduced opacity — no layout jump (today it swaps to a "กำลังโหลด…" line).

## Current pain points (verified in code, `ExpensesWorkspacePanels.tsx:370-525`)

1. The export action lives inside a gradient card seated in the KPI row (L434-441) — it reads as a statistic, not an action; the second button ("ดาวน์โหลดรายการหลักฐาน (JSON)") appears conditionally with no explanation of what it is.
2. Filters (L444-457): two unlabeled `<select>`s + a segmented toggle whose click silently resets the selected folder. Nothing says what each control does.
3. Table (L470-501): every cell is plain text. `taxEvidenceStatus` — the single most audit-relevant field — renders as an unstyled string; `taxEvidenceReasonCode` is fetched but never shown; rows with **zero attachments** (no evidence file!) show a quiet "-".
4. No anomaly signal anywhere: an auditor cannot answer "which entries need my attention?" without opening every row.
5. Folder sidebar (L461-466): raw `2026-07` codes with 📁 emoji; `SharedEvidenceFolder.evidenceCount` and `totalAmount` are fetched but unused — the "this month has expenses with missing files" signal is already in the payload and thrown away.

## Workstream A — anomaly logic (pure, unit-tested)

New file `apps/web/src/features/expenses/evidence-audit.logic.ts` + `evidence-audit.logic.spec.ts` (node:test style, like `expense-review-steps.logic.spec.ts`).

```ts
export type EvidenceFlagKey = 'NO_FILE' | 'TAX_NEEDS_REVIEW' | 'NOT_TAX_EVIDENCE' | 'SUPPORTING_ONLY' | 'NO_VENDOR' | 'NO_CATEGORY' | 'LEGACY_NO_NUMBER';
export type EvidenceFlag = { key: EvidenceFlagKey; severity: 'warn' | 'info'; label: string };
export function deriveEvidenceRowFlags(row): EvidenceFlag[]
export function evidenceRowState(flags): 'attention' | 'ok'   // attention = any warn-severity flag
export function summarizeEvidenceRows(rows): { attention: number; ok: number }
```

Flag rules (all from `SharedEvidenceRow`, no new data):
| key | severity | condition | Thai label |
|---|---|---|---|
| NO_FILE | warn | `attachments.length === 0` | ไม่มีไฟล์หลักฐานแนบ |
| TAX_NEEDS_REVIEW | warn | `taxEvidenceStatus === 'NEEDS_REVIEW'` | ยังไม่ได้ตรวจหลักฐานภาษี |
| NOT_TAX_EVIDENCE | warn | `taxEvidenceStatus === 'NOT_TAX_EVIDENCE'` | เอกสารใช้เป็นหลักฐานภาษีไม่ได้ |
| NO_VENDOR | warn | `!vendorNameSnapshot?.trim()` | ไม่ระบุชื่อผู้ขาย |
| SUPPORTING_ONLY | info | `taxEvidenceStatus === 'SUPPORTING_ONLY'` | เป็นหลักฐานประกอบ (ขอคืน VAT ไม่ได้) |
| NO_CATEGORY | info | `!categoryName` | ยังไม่จัดหมวดหมู่ |
| LEGACY_NO_NUMBER | info | `!expenseNumber` | รายการเดิมไม่มีเลขที่เอกสาร |

`attention` is driven by warn flags only — info flags render in the tooltip/detail but do not turn a row amber (avoid alarm fatigue).

Also export tone maps (single source for the panel):
```ts
export const TAX_EVIDENCE_TONE: Record<TaxEvidenceStatus, MangmeeTone> =
  { USABLE_FOR_TAX: 'brand', SUPPORTING_ONLY: 'slate', NOT_TAX_EVIDENCE: 'danger', NEEDS_REVIEW: 'amber' };
```

Unit tests: each flag fires on its condition and not otherwise; a fully-clean row → `[]` + state `ok`; summarize counts; NEEDS_REVIEW+0 files row yields 2 warn flags and state `attention`.

## Workstream B — layout restructure

Target layout (top → bottom):

```
┌─ HowItWorks (เดิม แก้ข้อความ step ให้ตรง flow ใหม่) ────────────────────────┐
┌─ KPI row (3 stat tiles — ตัวเลขล้วน ไม่มีปุ่ม) ───────────────────────────┐
│ [📄 เอกสารยืนยันแล้ว n]  [💰 มูลค่ารวม ฿x]  [⚠ ต้องตรวจเพิ่ม n  ← amber] │
┌─ Filter toolbar (แถวเดียว มี label ทุกตัว; ปุ่ม export ชิดขวา) ────────────┐
│ เกณฑ์วันที่ [ส่งเข้า|เอกสาร]  ประเภทเอกสาร [▾]  สถานะหลักฐานภาษี [▾]      │
│ [☑ เฉพาะรายการที่ต้องตรวจ]                    [⬇ ส่งออกชุดเอกสารให้บัญชี] │
┌─ Body: [Folder sidebar]  [Table] ─────────────────────────────────────────┐
│ ก.ค. 2569        │ สถานะ | เลขที่ | วันที่ | ประเภท | หลักฐานภาษี | ผู้ขาย │
│  12 รายการ ⚠2    │ ⚠ ต้องตรวจ … (แถว attention มีขอบซ้าย+พื้น amber อ่อน) │
│                  │ ✓ ครบถ้วน …  (แถวปกติ สีเงียบ)                        │
┌─ Export result banner (เดิม + ปุ่ม JSON ย้ายมาที่นี่พร้อมคำอธิบาย) ────────┘
```

Concrete changes in `EvidencePanel`:

1. **KPI row** — three `MangmeeStatCard`s only:
   - `เอกสารยืนยันแล้ว` (tone `brand`, icon doc, sub = เดือนที่เลือก/ทั้งหมด) — as today.
   - `มูลค่ารวม` (tone `indigo`, icon wallet) — retoned from `amber` so amber is reserved for attention.
   - `ต้องตรวจเพิ่ม` (tone `amber`, icon ⚠, value = `summarize.attention` รายการ, sub = "คลิกเพื่อดูเฉพาะรายการที่ต้องตรวจ"). The whole tile is clickable → toggles the attention filter (aria-pressed; visible pressed state, e.g. ring).
   - The gradient export card is **removed** from this row.
2. **Filter toolbar** — one flex row (wrap), each control with a `text-xs font-semibold text-gray-600` label above it: เกณฑ์วันที่ (segmented, unchanged behavior), ประเภทเอกสาร, สถานะหลักฐานภาษี, plus checkbox `เฉพาะรายการที่ต้องตรวจ` (client-side filter over `view.rows` using `evidenceRowState`). Right-aligned in the same row: primary button `ส่งออกชุดเอกสารให้บัญชี` (= existing `exportPackage`; busy label กำลังสร้าง…). The JSON manifest button moves into the result banner (it already requires `packageResult`) with an explanation line: "รายการหลักฐาน (JSON) — ลิงก์ดาวน์โหลดไฟล์แนบทุกไฟล์ มีวันหมดอายุ".
3. **Folder sidebar** — `FolderBtn` upgraded: label = `formatThaiMonth(yearMonth)` (drop the raw code + 📁 emoji), right side = `expenseCount` รายการ; when `evidenceCount < expenseCount` append an amber `⚠` with `title="บางรายการไม่มีไฟล์หลักฐาน"`. Keep "ทั้งหมด" first.
4. **Table** —
   - New first column `สถานะ`: `MangmeeBadge` — attention → tone `amber` "⚠ ต้องตรวจ", ok → tone `brand` "✓ ครบถ้วน". `title` attribute lists all flag labels (warn + info) joined with " · ".
   - Attention rows get `border-l-4 border-warning-500 bg-warning-50/40` (emphasis); ok rows unchanged.
   - `หลักฐานภาษี` cell → `MangmeeBadge tone={TAX_EVIDENCE_TONE[...]}` with the existing label; `title` = reason label from `TAX_EVIDENCE_REASON_LABELS[taxEvidenceReasonCode]` when present.
   - `ไฟล์` cell: 0 → `MangmeeBadge tone="danger"` "ไม่มีไฟล์"; else `📎 n`.
   - `ผู้ขาย` cell: missing → `text-warning-700` "ไม่ระบุ".
   - Last cell: add a trailing `›` (text-gray-400) so the row reads as clickable; row link behavior/aria unchanged.
   - Footer line additionally shows `· ต้องตรวจ n รายการ` when n > 0.
5. **Loading state** — replace the text-swap with keep-frame: wrap the body grid in a container that gets `opacity-50 pointer-events-none` while `loading && view` (first load with no `view` keeps the current "กำลังโหลด…" line).
6. **Copy** — HowItWorks steps updated to mention the check step: `['ยืนยันเอกสารในแท็บรายการ', 'ตรวจแถวที่ขึ้น ⚠ ให้ครบ (คลิกเปิดแก้ได้ทันที)', 'ส่งออกชุดเอกสาร Excel + ไฟล์หลักฐานให้สำนักงานบัญชี']`.

Strings stay Thai literals (this file's established style). Sanitization N/A (no free-text inputs here).

## Out of scope

- API/contract changes (pagination, server-side anomaly filter, new columns).
- Charts/trends (no time-series need identified); other tabs; export column set changes.
- Renaming/re-ordering existing filter semantics (dateField reset-on-switch behavior stays).

## Verification protocol (harness re-runs independently)

1. `corepack pnpm --filter @watchdog-bms/contracts build`
2. `corepack pnpm --filter @watchdog-bms/web test` — baseline 338/0; must include new `evidence-audit.logic.spec.ts`, 0 fail
3. `corepack pnpm --filter @watchdog-bms/web typecheck` — clean
4. `corepack pnpm --filter @watchdog-bms/web build` — succeeds
5. Full-diff review: changes confined to `EvidencePanel` + `FolderBtn` + new logic file; no other panel touched; scope apps/web + docs only; no new deps
6. Manual walk (stack up): attention tile toggles filter, badges/tooltips render, folder ⚠, export button + JSON in result banner, keep-frame reload

## Acceptance checklist (harness signs off)

- [ ] A: `deriveEvidenceRowFlags`/`evidenceRowState`/`summarizeEvidenceRows` implemented per table above, unit-tested, no API change
- [ ] B1: KPI row = 3 stat tiles, no buttons inside; attention tile amber, clickable toggle with visible pressed state; export card removed from row
- [ ] B2: filter toolbar = one labeled row + attention checkbox + right-aligned export button; JSON manifest moved to result banner with explanation
- [ ] B3: folders show Thai month + count + ⚠ when evidenceCount < expenseCount
- [ ] B4: table has สถานะ badge column (icon+label, tooltip lists flags), amber emphasis on attention rows only, tax-evidence badge with tone + reason tooltip, ไม่มีไฟล์ danger badge, ผู้ขาย ไม่ระบุ, trailing ›, footer count
- [ ] B5: refetch keeps previous table at reduced opacity (no layout jump)
- [ ] Status is never conveyed by color alone (icon + Thai label everywhere)
- [ ] All verification commands green; row-click → `onOpenExpense` และ export behavior unchanged
