# Agent Memory: expenses-nav-ux-redesign

Status: IMPLEMENTED + VERIFIED (unit level) 2026-07-28 — Codex (gpt-5.5) implemented A–G per the
handoff spec; Claude reviewed the full diff, fixed two findings, re-ran checks. Live browser pass
still pending (needs local docker infra).
Owner: Product owner (supapron) · plan+verify: Claude (Opus 5) · implementation: Codex.
Scope: Web-only UX rework of the ค่าใช้จ่าย + ใบเสร็จ module (`apps/web`). No API, no Prisma, no contract changes.

## Product goal

SME users get lost in the expenses hub: six in-page tabs duplicate navigation, the list table looks
lopsided, the manual-entry form is a narrow column in an empty page, the guided stepper in the detail
popup loses what they typed, its step wording is accountant-speak, and the "ให้ AI อ่านใบเสร็จ" button
gives no visible progress while the AI runs.

## Decisions

1. **Sub-menu, not tabs.** The five non-list tabs become real routes under `/companies/{id}/expenses/*`
   and appear as sidebar sub-items of the ค่าใช้จ่าย module (same `subItems` mechanism `roles` already
   uses). Real routes are required because `AppSidebar` resolves sub-item active state from `pathname`.
2. **Parent becomes a toggle.** `AppSidebar` renders a `<button>` (not a `<Link>`) for any nav item that
   has `subItems`, so รายการค่าใช้จ่าย must itself be the first sub-item pointing at `/expenses`.
3. **`?tab=` deep links stay alive.** `process-line-webhook.use-case.ts:164` sends
   `/companies/{id}/expenses?tab=signatures&signatureId=…` to LINE users. `/expenses` keeps a
   client-side redirect from `?tab=<key>` to the matching route. `signatureId` is not read anywhere in
   web today — no behaviour to preserve beyond landing on the signatures page.
4. **Stepper keeps panels mounted.** The "step doesn't remember values" defect is structural: each step
   is conditionally rendered, so `ExpenseReviewEditSection` / `DocumentReviewSection` unmount and their
   local state dies. Fix = render all panels, hide the inactive ones. Do not add a state-lifting layer.
5. **No new create fields on manual entry.** `CreateExpenseDraftInput` has no `vendorNameSnapshot`;
   adding vendor capture would need a backend change. Manual entry is a *layout* redesign only.

## Work items

- A — sidebar sub-menu + 5 routes + tab bar removal (`web-core-workspace.logic.ts`, `AppSidebar.tsx`,
  `app/(workspace)/companies/[companyId]/expenses/*`, `ExpensesPages.tsx`).
- B — list page balance: KPI row on an equal-width grid, expense table on fixed trailing columns.
- C — notification bell shrunk in the header.
- D — manual entry redesigned as form + sticky live summary.
- E — stepper values persist across steps.
- F — plain-Thai step labels + per-step "what to do here" helper line.
- G — visible loading while the AI reads a receipt (upload CTA + อ่านเอกสารอีกครั้ง).

Full acceptance criteria: `docs/agent-memory/expenses-nav-ux-redesign.handoff.md`.

## Open questions

None blocking. Live browser verification needs local Postgres/Redis/MinIO (docker compose.local),
which is not running in this session — recorded as a verification gap if not run.

## Review findings (fixed by Claude after Codex handback)

1. `AppSidebar.spec.ts` imported `isActiveNavSubItem` from `AppSidebar.tsx`, which pulls SVG imports
   the node test runner can't load → whole spec file failed. Fixed by moving the pure function to
   `app-shell/app-sidebar.logic.ts` (structural `{key, href}` type) and importing it from both the
   component and the spec.
2. `calculateManualExpenseTotals` VAT_INCLUDED returned `subtotal` = gross, so the summary card showed
   "ยอดก่อนภาษี" 107 for a 107-inclusive entry. Fixed to `gross − vat` (100/7/107); spec updated.

## Verification (2026-07-28, local)

- `pnpm --filter @watchdog-bms/web test` → 381/381 pass (includes 4 new specs: expenses submenu ×2,
  sidebar longest-match, manual VAT helper).
- `pnpm --filter @watchdog-bms/web typecheck` → fails only on 4 pre-existing errors
  (`BookingsPrototypePage.tsx` ×3, `expense-upload.logic.ts` heic2any ×1) — confirmed pre-existing by
  stashing the diff and re-running; no errors in touched files. `lint` script runs the same tsc.
- Extraction-notice handoff across the upload→list route change: `sessionStorage`
  (`expenses.extractionNotice.<expenseId>`), consumed+removed by the list hub on open.
- Live browser pass (2026-07-28, dev servers on :3000/:3001, seeded OWNER via dev-login BFF,
  Playwright headless): ALL PASS —
  sidebar shows the 6 sub-items in order; old header tab bar gone; `/expenses` marks only
  รายการค่าใช้จ่าย active and `/expenses/upload` only อัปโหลดใบเสร็จ (longest-match works);
  `?tab=signatures&signatureId=x` redirects to `/expenses/signatures?signatureId=x`;
  KPI cards render 5-equal-width (209px each @1440w); bell button 36×36; manual page two-column with
  sticky summary and live total (1×250 → ฿250.00); saving a manual draft routes to
  `/expenses?expenseId=…` and opens the guided modal; step helper line renders; vendor text typed in
  the details step survives details→evidence→details round-trip (E fix confirmed); no page errors.
  Not exercisable live: AI extraction spinner end-to-end (needs a receipt upload + OCR provider);
  covered by code review only.
- Env fixes needed to run locally (not code changes): `pnpm install` (heic2any was missing from
  node_modules and 500'd the page build), `prisma migrate deploy` (native :5432 DB was behind —
  TaxCodeDefinition / ExpenseSubstituteReceiptEvidence tables missing, so POST /expenses 500'd).
- `e2e/expenses.spec.ts` asserts on the old hub surface (`?tab=` URLs still redirect, so most pass),
  worth a follow-up sweep.

## Codex harness notes

- `codex exec` in a background shell must have stdin closed (`< /dev/null`) or it hangs on
  "Reading additional input from stdin...".
- CLI 0.143.0 rejected `gpt-5.6-sol` (400, needs newer CLI); run was done with `-m gpt-5.5`.
  CLI upgraded to 0.145.0 afterwards — `gpt-5.6-sol` now works; user config unchanged.
