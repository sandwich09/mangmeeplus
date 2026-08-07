# Agent Memory: reimbursements-queue-polish-round3

Status: planned — handoff written, implementation delegated to Codex
Owner: main thread (design + verification), Codex (implementation)
Scope: `apps/web` only. Queue tables and KPI cards on `การเบิกจ่ายและอนุมัติ`, plus the shared
`StatCard` primitive (which the user asked to change **everywhere it appears**).

Follows `reimbursements-ui-redesign.md` (round 1) and `reimbursements-ui-fixes-round2.md` (round 2).
Their invariants still bind.

## Findings from the user's screenshot (คิวอนุมัติ)

| # | Issue | Evidence |
|---|---|---|
| 1 | `StatCard` stacks icon-above-value, all left-aligned. User wants **icon left, number + unit right**. | `ExpensesUi.tsx:51-64` |
| 2 | KPI row is unbalanced: `xl:grid-cols-4` renders only **3** cards on คิวอนุมัติ and คิวการเงิน, leaving a dead 4th column. | `ReimbursementsPages.tsx:845`, `:934` |
| 3 | `จำนวนรายการ` shows a bare number with no unit. | `:872` |
| 4 | `อายุ (ชม.)` puts the unit in the header instead of the value, and is left-aligned. | `:857`, `:874` |
| 5 | `การกระทำ` — three full-width buttons wrap and get clipped at the right edge. | `:876-881` |
| 6 | `ดู` is a text button; should be an eye icon (also frees the width causing #5). | `:546`, `:878`, `:966` |
| 7 | No pagination on any of the three queues — every row renders at once. | all queues |
| 8 | Search matches only 3 fields (`requestNo`, `reason`, requester). User wants **universal search**. | `:837` |

## Decisions

- **D1 — `StatCard` changes globally, as asked.** It is consumed by the expenses list (5 cards,
  `ExpensesPages.tsx:1544`) and all three reimbursement queues. The user's instruction
  ("ทุกหน้าที่เป็นการ์ดแบบนี้") is explicit, so the change lands in the shared primitive and both
  features inherit it. **Flagged:** the expenses list will change appearance too — that is intended.
- **D2 — `MangmeeStatCard` is NOT touched.** It is a different component with a different visual
  (`MangmeePage.tsx:84`, used only in `ExpensesWorkspacePanels.tsx`). It is already icon-left, and the
  user pointed at the card in the screenshot. Changing it would be scope creep; recorded as an open
  question instead.
- **D3 — Grid columns must match card count.** 3-card queues get `lg:grid-cols-3`, the 4-card queue
  keeps `xl:grid-cols-4`. This is the actual cause of the imbalance, not the card widths.
- **D4 — "Universal search" = every value the user can see, not every field on the object.** Matching
  raw ids and `approvalSnapshotHash` would produce confusing hits on meaningless strings. The helper
  takes the row's *displayed* values plus resolved Thai status labels. Multi-term AND matching, so
  `RB-2026 อนุมัติ` narrows rather than widens.
- **D5 — Pagination is client-side over already-loaded rows.** The queue endpoints return the full
  queue and take no paging params; adding server paging would be an API change. Page size 10, matching
  `LIST_PAGE_SIZE` on the expenses list.
- **D6 — One shared `TablePager` + one pure paging helper.** Three queues need identical paging; a
  local component in the same file matches how `StatusBadge` / `RejectDialog` are already organised,
  and the arithmetic goes in `reimbursements.logic.ts` so it can be unit-tested.

## Invariants (carried from rounds 1–2)

No API call, payload, permission gate, or action-visibility conditional may change behaviour. Filters
and paging are pure projections over loaded data and must not enter any `load()` dependency array.
KPI cards keep reading the **unfiltered** row set.

## Artifacts

- Implementation spec: `docs/agent-memory/reimbursements-queue-polish-round3.handoff.md`
- Codex report (expected): `docs/agent-memory/reimbursements-queue-polish-round3.results.md`

## Open questions

- Should `MangmeeStatCard` (evidence panel) adopt the same icon-left / value-right treatment for
  consistency? Not done in this round — see D2.
