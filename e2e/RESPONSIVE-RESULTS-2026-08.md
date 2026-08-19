# Mobile-first uplift — results (2026-08-19)

Branch `feat/mobile-first-launch-features`, phases M0–M5.
Spec: `docs/specs/mobile-first-launch-features-spec.md` · Plan: `docs/plans/mobile-first-launch-features-plan.md`

## Why this project existed

The 2026-08-04 responsive project (`e2e/RESPONSIVE-RESULTS.md`) closed green at 53/53 and was executed
correctly. The problem was what its rig could not see: `playwright.config.ts` defined one mobile project,
Pixel 7 on **chromium**, which has no collapsing browser toolbar. `100vh` and `100dvh` measure identically
there, so the ~86px iOS overshoot behind the owner's screenshot could never fail a run. Every mobile defect
reported since came from owner iPhone screenshots; none came from the suite.

## Final state

| Gate | Result |
|---|---|
| INV-9 / INV-10 source checks | green (were red on 30 and 2 sites at M0) |
| `e2e/evidence.spec.ts` — 7 device entries | **366 subjects, 0 blocking, 0 DESKTOP-FINDING** |
| `e2e/responsive.spec.ts` — INV-1..8 | **283 passed, 0 failed**, 82 project-scoped skips |
| Web typecheck | pass |

Evidence bundle: `outputs/mobile-evidence/EVIDENCE.md` (manifest + `results.jsonl` committed; the ~170MB of
screenshots are local artefacts, `.gitignore`d).

Device matrix (spec §12.5): iPhone 13 WebKit 390 · iPhone 13 chromium 390 · Pixel 7 412 · 375 floor ·
desktop 1280 / 1440 / 1920. Desktop rows are measured, never blocking (decision D11 — D2 outranks them).

## What shipped

- **M0** guard rails: INV-9/INV-10 source checks, INV-11 + evidence harness, manifest builder, 7-entry matrix,
  INV-5 widened from 2 sampled routes to 16.
- **M1** structural: 21 files `100vh`→`dvh`, `.mangmee-safe-bottom` on the two bottom-anchored bars,
  `--app-header-h` instead of a stale 64px, BrandedState mobile-first.
- **M2** camera-first receipt capture, desktop dropzone untouched.
- **M3 + M4b** every control on a launch route reachable by a thumb; notifications get decision D9's "A+2".
- **M4a** card views for หลักฐานทางบัญชี and ทดแทนใบเสร็จ.
- **M4c** the substitute-receipt wizard walked and measured rather than assumed.

## Claims the evidence overturned

Recorded because the corrections are the substance of the work, not footnotes.

1. **iOS-zoom findings (S3-A, S3-B) — withdrawn.** `apps/web/app/globals.css:431-437` already forces
   `font-size: max(1rem, 1em) !important` on every form control below 640px. The class-level audit never read
   the global stylesheet. A source check written to catch those fields was a false-positive generator against
   that rule and was deleted rather than kept. M3 shrank to tap targets alone.
   *Residual, recorded not scheduled:* the media query ends at 639.98px, so tablet widths are uncovered.
2. **Desktop arithmetic (S5-A) — settled as not a defect.** 935px of content against a 980px table is real,
   but the table sits in a scroller and INV-11 found nothing unreachable at any desktop width.
3. **พนักงาน card view (S2-F) — withdrawn.** The list it named lives in `MatrixView`, reachable only from
   `EmployeeAccessWorkspacePage`, which has **zero consumers**. All three employee-access routes render
   `*Prototype*` components. A card view was built there and reverted under decision D6.
   *Consequence:* the spec's blanket "prototypes are out of scope" is wrong for employee-access, where those
   files are the product on three priority routes.

## Failures classified

| Failure | Verdict | Evidence |
|---|---|---|
| `responsive.spec.ts` reimbursements desktop parity expected 8 `<th>`, found 9 | **NOT OURS** — pre-existing on develop | the `<thead>` region is byte-identical to `origin/develop`; the constant had gone stale. Corrected to 9. |

INV-11 itself needed four corrections before its output could be trusted, all commented where they were fixed:
collapsed accordions (`AppSidebar.tsx:348` keeps `height:0` children's layout rects) reported as "covered";
rows inside a scroller reported as "clipped" because the ancestor walk did not stop at the first scroller;
`<nextjs-portal>`, the `next dev` overlay, reported as covering a button; and card-list presence checked with
`isVisible()` rather than `count()`, which hid an empty queue behind a layout message.

**A new invariant's first runs test the invariant, not the app.**

## Residual risk

- The height axis still has no runtime guard and cannot have one here: `dvh` and `vh` are equal in every
  browser this repo can drive. The source check plus an owner device pass is the whole defence.
- Tablet widths (640–1024px) are outside both the mobile rule set and the device matrix.
- Completing a real substitute-receipt issuance on a phone, signature included, remains an owner gate.

## How to reproduce

The seeded database is docker postgres on **15432** on this machine, not the native 5432 that
`e2e/run-local.sh` assumes, and `psql` is not on PATH, so its preflight fails. Committed defaults were left
alone; pass the URL explicitly:

```
DATABASE_URL="postgresql://watchdog:watchdog_local_password@localhost:15432/watchdog_bms?schema=public" \
  npx playwright test e2e/evidence.spec.ts
node scripts/build-evidence-manifest.mjs
corepack pnpm --filter @watchdog-bms/web test   # INV-9 / INV-10 source checks
```
