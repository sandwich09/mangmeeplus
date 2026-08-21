# Plan: Expense Owner Journey — Number Correctness and Decision Clarity

Spec: `docs/specs/expense-owner-journey-correctness-spec.md`
Status: Draft for review

## Sequencing principle

Wrong numbers first, because an owner who catches the app lying once stops trusting every other
figure. Silent rules second, because they cause wrong data that later has to be unpicked. Polish
last. Each phase is independently shippable and independently revertable.

## Phase 1 — Wrong numbers (F1, F2, F3)

Smallest diffs, highest trust impact. No schema change expected.

| # | Change | Where | Check |
|---|---|---|---|
| 1.1 | Reclaimable-VAT total counts only crediting tax-evidence statuses; add a separate non-crediting figure | expenses summary use-case + list header | unit: mixed period of ใบกำกับภาษีอย่างย่อ + เต็มรูป returns credit=only-full, cost=only-short |
| 1.2 | Exclude cancelled from `ยอดรวมที่ขอเบิก`; caption names counted states | reimbursement summary use-case | unit: 4-request fixture mirroring UAT returns 40 (pending) / 329 (pending+paid), never 409 |
| 1.3 | Add `ยกเลิก` tab; assert tab counts sum to total | reimbursement list | unit: sum(tabs) == total for every fixture |
| 1.4 | Cancelled requests keep their document number | reimbursement domain | unit: cancel() preserves docNumber |
| 1.5 | One menu-count computation shared by both screens, or each labelled with its basis | access-overview + permissions | unit: same role → same count from both call sites |

**Risk.** 1.1 touches tax arithmetic. Mitigate by writing the failing test from the exact UAT figures
(`฿180` short-form receipt → credit `฿0`, cost `฿11.78`) before changing any code.

**Do not** silently change what `ยอดรวมที่ขอเบิก` means without updating its caption — a number that
changes with no visible explanation is its own trust bug.

## Phase 2 — Silent rules (F4, F6, F7)

| # | Change | Where | Check |
|---|---|---|---|
| 2.1 | Category picker shows hidden count + reason; hidden entries disabled with tooltip | expense review + substitute wizard | UI test: no-VAT document lists 12 entries, 7 disabled with reason |
| 2.2 | Category column on `หลักฐานทางบัญชี`, `ยังไม่จัดหมวด` rendered in-row | evidence table | UI test: uncategorised row shows the chip |
| 2.3 | Split "ยืนยันแล้ว" from "พร้อมส่ง"; export warns on not-ready documents | evidence header + export | unit: 3 confirmed / 1 needing review → ready=2, warning raised |
| 2.4 | Blocking message names the policy and links to settings for the entitled | substitute wizard | UI test: message contains policy name; link only for entitled |
| 2.5 | `(ค่าเริ่มต้น)` label sits on the true default | substitute settings | unit: default option carries the marker |

**Owner decision required before 2.4 lands:** does a zero-file substitute receipt exist at all? The
guide (topic 7) documents two evidence types as intentional, and the most permissive setting still
demands one file. Options: (a) keep one file mandatory and say so in the wizard and the guide;
(b) allow zero files behind a typed declaration plus signature. **Do not implement (b) without an
accounting sign-off** — it changes what the company can defend in an audit.

## Phase 3 — Clarity polish (F5, F8)

| # | Change | Check |
|---|---|---|
| 3.1 | Single Thai role-name catalogue used by every screen | unit: no English role label reachable from owner UI |
| 3.2 | Explain the 13-vs-10 assignable-role gap | UI test |
| 3.3 | Labels on the inline substitute form, or route it into the 4-step wizard | UI test: every control has a label |
| 3.4 | Upload page: disabled button + reason | UI test |
| 3.5 | Errors after interaction, not on first paint | UI test |
| 3.6 | Name the actual missing fields | unit |
| 3.7 | AI panel wording respects confirmed state | unit |
| 3.8 | พ.ศ./ค.ศ. handling on date of birth | unit: 2529 and 1986 both resolve |
| 3.9 | National-ID checksum, or drop mandatory | unit: 1234567890123 rejected |
| 3.10 | Guide step count matches the wizard | doc edit |

3.3 is the largest item: prefer deleting the inline form and linking to the wizard over adding
labels to a second implementation of the same feature.

## Verification

Per AGENTS.md, at least one runnable check per non-trivial change; the table above names it. After
each phase, re-run the persona journey on UAT and confirm the specific figures: reclaimable VAT,
`ยอดรวมที่ขอเบิก`, the two menu counts, and the category picker contents.

## Task memory

`docs/agent-memory/uat-smoke-2026-08-22.md`
