# R0 Verification Rig Report

Status: **PASS** (gated 2026-08-04 by Claude). Rig implemented by Codex (`gpt-5.6-sol`, xhigh); runtime verification executed by Claude because the Codex sandbox blocked localhost postgres (`Operation not permitted` over TCP and Unix socket — sandbox limitation, not an environment fault). DB preflight additionally required `prisma migrate deploy` + reseed (2 pending migrations on this branch: `remote_release_operation_lease`, `report_view_authority_snapshots`) — applied before the run.

## Files touched

- `playwright.config.ts` — added `mobile-chromium` project (Pixel 7, `testMatch: /responsive\.spec\.ts/`); existing `chromium` project untouched.
- `e2e/responsive.spec.ts` — INV-1..INV-4 (Codex) + 8 routes added at gate (crm, crm/payment-proofs, banking, accounts-payable, procurement, workflow, notifications, ai-suggestions → 45 routes total).
- `e2e/responsive-baseline.spec.ts` — opt-in (`RESPONSIVE_BASELINE=1`) desktop screenshot helper.
- `outputs/responsive-baseline/` — 6 desktop parity PNGs + this report.

No product code was changed. No files were staged or committed by Codex.

## Failing-route baseline (mobile-chromium, Pixel 7 412px) — run 2026-08-04

`e2e/run-local.sh e2e/responsive.spec.ts`: **5 failed / 42 passed / 47 skipped** (skips = desktop-project copies via the in-spec `isMobile` guard, by design).

| Route | Invariant | Finding |
|---|---|---|
| `/accounting` | INV-2 | 2 clipped tables (7-col document list + line items — audit S1: `AccountingPages.tsx:154,438`) |
| `/sales-documents` | INV-2 | 2 clipped tables (same component as `/accounting`) |
| `/inventory/products` | INV-2 | 1 clipped table (audit S1: `InventoryPages.tsx`) |
| `/settings/crm-catalog` | INV-2 | 1 clipped table — **not in the static audit; net-new finding by the rig** |
| `/dashboard` | INV-3 | Drawer opens/closes via hamburger + backdrop tap ✓; **body scroll-lock missing** ✗; **Escape-close missing** ✗ (both expected red until R1) |

INV-1 green on all 45 routes — expected: `.mangmee-content { overflow-x: clip }` masks page-level overflow (that is exactly why INV-2 exists). INV-4 green on all routes.

**Static-audit sites that passed at runtime** (latent, still wrapped in R3): `journal` trial balance + GL, `tax` issues table, `inventory` main/movements/stock. Reason: seeded data is narrow enough that these 4-col tables fit 412px, so no clipping today — they clip the moment real data widens. R3 wraps all 9 audited sites regardless; the rig will keep them honest.

## Desktop screenshot baseline

Captured 2026-08-04: `dashboard.png`, `expenses.png`, `reimbursements.png`, `accounting.png`, `journal.png`, `settings.png` (fullPage, animations disabled). These are the R5 desktop-parity comparison source.

## Desktop smoke

`e2e/run-local.sh --grep @smoke`: **32 passed / 4 failed**. All 4 failures are pre-existing on this branch and unrelated to the rig (the R0 diff touches no product code):

- `SMOKE-02` — `getByText('Trial Balance', {exact:true})` strict-mode violation (28 matches: reports catalog now renders many snapshot rows). Spec drift → product/spec, pre-existing.
- `SET-01` — settings heading strict-mode violation (2 matching headings). Spec drift, pre-existing.
- roles-matrix `ตั้งค่าบริษัท is Owner/Admin only` — MANAGER sees ตั้งค่าบริษัท in sidebar. Product/seed permission drift on this branch, pre-existing. **Worth filing separately — possible real permission bug.**
- `RPT-04` CSV export — timed out waiting for download; Redis is DOWN (ioredis ECONNREFUSED throughout the run) and the export path depends on it. Environment.

These 4 are the desktop baseline for later phases: R1–R4 must not increase this set.

## Quarantined checks

None. Screenshot helper is opt-in by env var (not a quarantine). Responsive invariants skip outside the mobile project by design.

## Gate verdict (Claude)

- Only allowed files touched; no commits/`git add` by Codex ✓
- Invariants are real (INV-2 requires an actual scrollable ancestor; INV-3 asserts scroll-lock/Escape) — no tautologies ✓
- Failing baseline captured and consistent with the audit, plus one net-new finding (`/settings/crm-catalog`) ✓
- Desktop parity source captured; pre-existing desktop failures documented as the not-to-grow set ✓

R0 = PASS. Next: commit R0, then Codex executes R1 (foundation + shell).
