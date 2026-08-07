# Mobile Responsive Uplift — R4 Core Queue Card Views Report

Status: **IMPLEMENTED — typecheck, webpack build, source-parity checks, and Playwright spec discovery pass.** Work stops after R4.

## Scope held

- Executed Phase R4 items 1–3 only.
- Added CSS-only `md` table/card visibility splits; no runtime media-query branching was added.
- Reused `MangmeeCard`, `MangmeeBadge`, existing status/label maps, row models, formatters, and actions.
- Added no dependency and no shared card abstraction; the five queue cards have different fields/actions and are not identical by diff.
- Kept the accounting line-items table unchanged as a scrolling reading surface.
- Kept loading, empty, error, and permission output outside the table/card visibility split. The original state rows remain byte-identical inside the preserved desktop blocks but are unreachable while the shared loading/empty branch is active.
- No `git add` or commit was run.

## Every touched file

| File | R4 change |
|---|---|
| `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` | Added mobile card lists for My Requests, Approval Queue, and Finance Queue; wrapped each original desktop table block in `hidden md:block`; moved visible empty-state selection outside each split; retained full-width 44px mutation/detail actions. |
| `apps/web/src/features/expenses/ExpensesPages.tsx` | Added `data-testid="expenses-grid"` to the existing scroll container, wrapped the desktop pseudo-table in `hidden md:block`, added the mobile expense cards, and moved visible loading/empty output outside the split. KPI cards, filters, pagination, and delete dialog remain unchanged. |
| `apps/web/src/features/accounting-documents/AccountingPages.tsx` | Added mobile document cards and a `MangmeeBadge`-based mobile status renderer; wrapped only the document-list table in `hidden md:block`; moved visible loading/empty output outside the split. The line-items table is untouched. |
| `e2e/responsive.spec.ts` | Added INV-7 cases for reimbursements, expenses, and accounting: mobile table hidden/card visible/card tap URL/no overflow; desktop card list hidden/table visible/key-column-count assertion. |
| `outputs/responsive-baseline/R4-REPORT.md` | Added this report. |

## Card field and action mapping

| Queue | Line 1 identity | Line 2 status + date/age | Line 3 amount | Primary/actions |
|---|---|---|---|---|
| Reimbursements — My Requests | `requestNo` + truncated `reason` | existing `StatusBadge` (`REQUEST_STATUS_LABELS`/tones) + `incurredDate` | `amount` + `currency`, right-aligned and prominent | Whole-card overlay link uses the existing `tab=mine&focus=<id>` deep-link path. Existing Submit and Cancel actions remain explicit full-width `min-h-11` buttons when allowed. |
| Reimbursements — Approval Queue | `requestNo` + truncated `requesterDisplayNameSnapshot` | existing request status badge + `ageHours`; existing `เกิน SLA` badge retained | `amount` + `currency`, right-aligned and prominent | Existing View Details, Approve, and Reject actions are explicit full-width `min-h-11` controls. |
| Reimbursements — Finance Queue | `requestNo` + truncated `requesterDisplayNameSnapshot` | existing request status badge + `ageHours`; existing `อาจซ้ำ` badge retained | `outstandingAmount / amount` + `currency`, matching the desktop amount cell | Existing View Details and conditional Approve Payment / Record Payment actions are explicit full-width `min-h-11` controls. |
| Expenses | `expenseNumber` or `vendorDocumentNumber` + truncated vendor name (existing vendor-pending label fallback) | existing expense `StatusBadge` + `expenseDate` | `grandTotalAmount` through existing `baht`, right-aligned and prominent | Whole-card button calls the existing `onSelect`, which routes to `/expenses/<id>`. |
| Accounting documents | existing `DOCUMENT_TYPE_LABELS` value + document number | `MangmeeBadge` using existing `DOCUMENT_STATUS_LABELS` + existing Thai date formatter | `grandTotalAmount` through existing `money`, right-aligned and prominent | Whole-card link uses the existing `documentId=<id>` deep-link path to the current detail action. |

No new visible Thai strings were introduced. Card labels and action strings reuse the table's existing strings/constants.

## Desktop table subtree parity

A read-only Node check extracted the original blocks from `git show HEAD:<file>`, hashed them, and required the current source to contain each exact extracted byte string. Result:

| Desktop subtree | Result | SHA-256 prefix |
|---|---:|---:|
| Reimbursements — My Requests table block | UNCHANGED | `76a9b69a5d59` |
| Reimbursements — Approval Queue table block | UNCHANGED | `150e5fbbc289` |
| Reimbursements — Finance Queue table block | UNCHANGED | `bbeb479c6456` |
| Accounting document-list scroll/table block | UNCHANGED | `27033a25a729` |
| Expenses `min-w-[760px]` pseudo-table subtree | UNCHANGED | `2d7407534d5f` |

The reimbursement and accounting blocks are exact unchanged substrings inside new `hidden md:block` wrappers. For expenses, the required `data-testid="expenses-grid"` is the sole attribute added to the existing scroll-container tag; its complete `min-w-[760px]` pseudo-table subtree is byte-identical. No table JSX was restyled, reordered, or reformatted.

## INV-7 coverage

- Mobile `/reimbursements`, `/expenses`, and `/accounting`: assert the desktop variant is hidden, the mobile list and at least one seeded card are visible, page width does not exceed the viewport, card tap changes the URL to the existing detail/deep-link path.
- Desktop same routes: assert the table/grid variant is visible, the card list is hidden, and the preserved desktop header has the expected 8 / 5 / 7 key columns.
- Approval and finance card/action markup is implemented in the feature. The route-level seeded INV-7 reimbursement case exercises the default My Requests queue, matching the handoff's three-route test matrix.
- No MinIO-dependent card check was needed; no INV-7 check was quarantined.

## Verification

- `export PATH="$HOME/.nvm/versions/node/v22.14.0/bin:$PATH"; pnpm --filter @watchdog-bms/web typecheck` — **environment command unavailable** (exit 127: `pnpm` not found).
- Same PATH with `corepack pnpm --filter @watchdog-bms/web typecheck` — **PASS** (exit 0): Next route types generated and `tsc --noEmit` completed.
- Same PATH with `IS_WEBPACK_TEST=1 corepack pnpm --filter @watchdog-bms/web build` — **PASS** (exit 0): Next.js 16.2.11 webpack compiled, generated 11/11 static pages, finalized optimization, and collected build traces. The pre-existing unsupported `eslint` configuration warnings remained non-failing.
- `corepack pnpm exec playwright test e2e/responsive.spec.ts --list` — **PASS** (exit 0): the spec parsed and discovered all INV-7 mobile and desktop cases; no browser, server, or database-backed test executed.
- Extracted desktop-subtree byte comparison against HEAD — **PASS** for all five blocks listed above.
- `git diff --check` — **PASS**.
- Static boundary checks — **PASS**: three reimbursement desktop wrappers, five card lists, and all eight explicit reimbursement action controls use `min-h-11 w-full`; no accounting line-items-table change appears in the diff.

The Postgres-dependent E2E runner and desktop browser suite were **not run**, per the explicit sandbox instruction. R4 runtime browser status remains for the Claude gate; this report does not claim those tests green.

## Deviations

- The requested Node 22.14.0 path is absent. After applying the required PATH prefix, Node resolves to `/usr/local/bin/node` v24.14.0; bare `pnpm` is unavailable. Verification therefore used the repository-pinned pnpm 9.15.0 through Corepack, matching the accepted R1–R3 workaround.
- No product-scope deviation. The required expenses `data-testid` attribute is documented above as the only intentional change to an existing desktop scroll-container tag; the pseudo-table subtree remains byte-identical.
- No E2E run was attempted because the sandbox cannot reach Postgres, as instructed.

No git add or commit was run. Work stops at R4.

---

## Claude gate verdict (2026-08-04) — PASS, no fixes needed

- Card actions verified against REAL handlers: reimbursements cards reuse the pre-existing `?focus=<id>` deep-link (ReimbursementsPages.tsx:231-254), accounting cards the pre-existing `?documentId=` reader (:660), expenses cards call `onSelect` directly. No dead links.
- Desktop table subtree parity: reimbursements desktop screenshot **byte-identical** to R0 baseline (253704 bytes); journal/settings identical; accounting equals the accepted R3 rendering; expenses diff = smoke-seeded rows only.
- Mobile suite 56/56 green including 3 INV-7 card-view tests; desktop card-view parity suite green (cards absent on desktop).
- Desktop smoke: first run showed a 5th failure (QA-role login `read ECONNRESET`) — re-run confirmed flake; steady-state remains the pre-existing 4-failure set, no growth.
- Noted accepted change (per handoff shared-states instruction): on an EMPTY queue, desktop now shows the shared EmptyState without table headers (previously an EmptyState row inside the table). Populated queues render identically.
