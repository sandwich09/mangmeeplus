# Mobile-First Launch Features Implementation Plan

## Linked Spec

- Spec: [[specs/mobile-first-launch-features-spec|Mobile-First Uplift for Launch Features]]
- Task memory: [[agent-memory/mobile-first-launch-features|Agent Memory]]
- Predecessor: [[plans/mobile-responsive-uplift-plan|Mobile Responsive Uplift Plan]] (closed 2026-08-04)

## Purpose

Deliver the spec's acceptance criteria for the nine launch features, in an order that puts the largest user-felt win
first and the largest engineering effort last, so the owner can stop at any phase boundary and still have shipped
something worth shipping.

## Current Repository Context

- Apps/packages: `apps/web` only (CSS/TSX) + `playwright.config.ts` + `e2e/`.
- Patterns to reuse: `.mangmee-input` (`globals.css:412`), `Field.tsx:31`, `Button.tsx:27`, `Modal.tsx:110`,
  `.mangmee-table-scroll` (`globals.css:513`), the `md:hidden` card pattern already shipped at
  `ExpensesPages.tsx:1552` (`data-testid="expenses-card-list"`) and `ReimbursementsPages.tsx:722`.
- Dependencies: none new.
- Risks:
  - **R-1 — desktop regression.** Mitigated by D2 + existing desktop-parity tests + screenshot baseline in
    `outputs/responsive-baseline/`.
  - **R-2 — the rig cannot see the bug class this plan targets.** Mitigated by the D3 source check and by an owner
    device check per phase. Do not treat a green suite as a phase pass on its own.
  - **R-3 — card views are the expensive part** and touch the most business logic. Held to M4a, after every cheap
    structural win has already shipped, so nothing valuable is hostage to them.
  - **R-3b — evidence that lies.** The two ways this happens: a card list renders 0 rows and reports green, and a
    screenshot shows a control that is actually covered and untappable. Mitigated by the `NO EVIDENCE` failure mode and
    by `elementFromPoint` hit-testing respectively (spec §12.2, §12.3). Do not weaken either to make a run go green.
  - **R-3c — desktop scope creep.** D11 opens desktop to measurement, and measurement invites fixing. The
    `DESKTOP-FINDING` label exists precisely so a desktop defect cannot be slipped into a mobile phase's diff. If a
    desktop fix is agreed, it lands as its own commit with its own before/after baseline.
  - **R-4 — in-flight worktree.** The branch currently carries unrelated modified files
    (`ExpenseReviewPage.tsx`, `workspace-dictionary.ts`, several `docs/agent-memory/*`). Phases M1, M2 and M4c touch
    `ExpenseReviewPage.tsx` and `workspace-dictionary.ts` — diff those two per-file before committing, using
    `python difflib` (the prior project recorded that an awk-based equivalence check failed silently).

## Implementation Rules

- Follow `docs/plans/master-implementation-checklist.md`.
- Mobile-first everywhere: unprefixed class = phone value; today's value moves to `sm:`/`lg:`. Never the reverse.
- Ponytail full mode: shortest correct diff, existing patterns first, no new dependency, no speculative abstraction.
- Do not edit any `package.json` (repo rule) — the Playwright project is added in `playwright.config.ts`.
- One phase = one commit, gated before it lands.

## Scope

### In Scope

- The nine priority features in the spec's §7 table.
- Shell and branded-state structural fixes (they are the substrate for all nine).
- Test rig extensions: INV-5 route expansion, INV-9, INV-10, INV-11 + evidence harness, `mobile-webkit` project,
  the three desktop widths, D3 source check.
- **Measuring** desktop at 1280/1440/1920 (D11) — findings recorded as `DESKTOP-FINDING`.

### Out of Scope

- The 9 `*Prototype*` files.
- Non-priority features: CRM, inventory, procurement, banking, tax, ledger, reports, workflow, partners, data-rights.
  They keep whatever the 2026-08-04 project gave them. **This is a deliberate cut, not an oversight** — record it in
  the memory doc so the next reviewer does not read the gap as a regression.
- Settings matrices and GL tables: scrolling tables by design (inherited decision).
- **Fixing** desktop findings. D11 measures desktop; D2 still forbids changing it. Any `DESKTOP-FINDING` the owner wants
  fixed becomes its own scoped decision with its own baseline, not a quiet addition to a mobile phase.
- API, schema, permissions.

## Phases

Each phase: implement → automated gate → **evidence bundle (spec §12) → owner reviews it on iPhone 13** → commit.

**Hard rule for every phase below, no exceptions** (owner, 2026-08-19): a phase is done only when its evidence bundle
exists, contains no `NO EVIDENCE` rows, and the owner has seen it. Green tests without a bundle is not done — including
M1, whose diff is one word per site. Where a phase gate below says "desktop parity unchanged" or similar, the bundle is
still required on top.

### M0 — Guard rails first (no product change)

Built before any fix, exactly as R0 was, because the current rig cannot fail on the defect being fixed.

1. Source check for D3: fail if `100vh`/`min-h-screen`/`h-screen` appears in `apps/web/src` or `apps/web/app` outside an
   allow-list constant. Plain vitest.
2. `mobile-webkit` Playwright project — `devices['iPhone 13']` (D7).
3. Extend INV-5 to all 9 priority routes.
4. New INV-9 (sticky/fixed bars respect `env(safe-area-inset-bottom)`) and INV-10 (no `vh` in computed layout heights).
5. **INV-11 + the evidence harness (spec §12)** — the owner's hard requirement, so it is built here with everything
   else, not bolted on at M5:
   - generalise the INV-2 clip check from tables to every visible actionable element, and add the three checks it
     lacks: `overflow-x: clip`/`hidden` ancestor clipping, `elementFromPoint` hit-testing, and 44px sizing;
   - iterate **every** card in every card list, not the first — and fail with `NO EVIDENCE` when a list renders 0 rows;
   - screenshot every priority route on every device in the §12.5 matrix, and every step of every multi-step flow;
   - generate `outputs/mobile-evidence-<date>/EVIDENCE.md` as a single readable manifest.
6. Devices: add the two iPhone 13 projects (WebKit + Chromium) alongside the existing Pixel 7 and 375 floor, **plus
   the three desktop widths 1280 / 1440 / 1920 (decision D11)** — seven entries, spec §12.5.
7. **Unskip the invariants on desktop for INV-11 only.** `e2e/responsive.spec.ts:119` currently reads
   `test.skip(!isMobile, ...)`, which is why nothing in the repo checks a computer screen for off-screen or clipped
   controls. INV-1..8 stay mobile-only — they encode mobile assumptions. INV-11 runs everywhere.
8. Desktop failures are emitted as `DESKTOP-FINDING` rows, which do not fail the run (D11 — D2 outranks them).

**Pass signal:** the new checks go **red on exactly the sites §8 lists** — 30 `vh` sites, 11 sub-16px field sources, the
`ExpenseReviewPage.tsx:983` bar — and the first evidence bundle generates end to end with real screenshots, including
at least one `NO EVIDENCE` row if a fixture is thin. A green M0 means the check is wrong, not the code.

**First desktop question to answer (S5-A).** The 1280 run either confirms or kills the arithmetic that the reimbursement
queues need 980px inside 935px of content with the sidebar expanded. Whichever way it lands, record it — it is the
first thing this project will have ever measured on a computer screen.

**Effort note:** M0 is no longer the small phase it was before this requirement. INV-11 and the manifest are the bulk of
it. That cost is paid once and every later phase inherits it — but do not plan M0 as an afternoon.

### M1 — Structural sweep (S1) — smallest diff, widest reach

- `100vh` → `100dvh` across all 30 sites, `WorkspaceShell.tsx:63` and `BrandedState.tsx:16` first.
- `EmployeeAccessPages.tsx:222`: adopt `--app-header-h` instead of the stale `64px`.
- `env(safe-area-inset-bottom)` on sticky action bars via a new `.mangmee-safe-bottom` utility: `ExpenseReviewPage.tsx:983` and `PartnerDetailPage.tsx:1034` (the two INV-9 reports).
- `BrandedState` mobile-first spacing: `p-4 sm:p-6` outer, `p-6 sm:p-8 md:p-12` card, logo 56→64 at `sm:`,
  `mt-5/mt-6/mt-6` with current values restored at `sm:`; buttons `w-full` stacked on mobile, current row at `sm:`.
- `error.tsx:44`, `not-found.tsx:16`: `h-11 sm:h-10`.

**Gate:** D3 check green; INV-9/10/11 green; desktop parity unchanged; **evidence bundle across all 7 device entries** —
every branded state and every priority route screenshotted top and bottom, proving no dead scroll space; **owner
confirms the reported screen is centred.**

*This phase alone resolves the owner's original report and removes dead scroll space from every page in the app.*

### M2 — Camera-first receipt capture (S2-A, S2-B)

The highest-value change in the plan and the reason it is this early.

- Mobile-only primary action "ถ่ายรูปใบเสร็จ" using `capture="environment"`, with "เลือกจากคลังภาพ" secondary.
- Dropzone and its drag handlers become `sm:`-and-up; mobile copy stops instructing the user to drag or click.
- New i18n keys — **do not repurpose `expenses.upload_dropzone_title`**, desktop still needs it verbatim.
- `ThemedFile.tsx`: `accept`/`capture` passthrough; clear button `h-7 w-7` → 44px target on mobile.

**Gate:** at 390px the first action is the camera; desktop drag-and-drop byte-identical; **evidence: every step of the
upload flow screenshotted on all 7 device entries with INV-11 green**; owner takes a photo through the flow on a real iPhone
and reaches a draft.

### M3 — Control-level sweep (S3)

- Fold the `EmployeeAccessPages.tsx:127` constant into `.mangmee-input` — for its `h-10` height, not for font size.
- ~~Fix the 8 inline sub-16px fields~~ — withdrawn by M0 evidence (S3-A/S3-B): the global rule at
  `globals.css:431-437` already covers them below 640px. M3 is now tap targets only, which makes it a smaller phase.
- Raise the 38 sub-44px targets, priority features first; `ThemedDate`'s 40px exception documented and kept.

**Gate:** INV-5 green on all 9 routes; INV-11 confirms no control under 44px, off-screen, clipped, or covered on any
priority route; desktop parity unchanged; **evidence bundle across all 7 device entries.**

### M4a — Card views for priority queues (S2-C, S2-C2, S2-D, S2-F, S2-G) — largest effort

Extends decision D3's Tier 2 from 5 queues to the owner's set. Reuse the shipped pattern
(`ExpensesPages.tsx:1552`) rather than inventing a component; extract a shared card only if the third implementation
still wants one.

Three queues, in owner-priority order: หลักฐานทางบัญชี (`ExpensesWorkspacePanels.tsx:747`, inside `EvidencePanel`) →
ทดแทนใบเสร็จ hub (`SubstituteReceiptHubPage.tsx`) → พนักงาน (`EmployeeAccessPages.tsx`).

**Do not** fold in `ExpensesWorkspacePanels.tsx:181` and `:416`. They are tables in the same file but belong to
`CategoryManagePanel` (`/expenses/categories`) and `SignaturePanel` (`/expenses/signatures`) — different screens,
in scope under priority-1 expenses, but separate jobs. An early draft of this plan listed all three as one item.

แจ้งเตือน is **not** in this phase: it is already a list, not a table. It gets its own phase M4b.

**Gate:** INV-7 per new card view; desktop table DOM byte-identical; owner completes one real task per queue on device.

**Evidence (the phase this requirement was written for):** every card in every one of the three queues, on all 5
devices, with INV-11 green inside each card — the primary action on screen, unclipped, hit-testable, >=44px. Any queue
rendering 0 cards under the fixture fails as `NO EVIDENCE`; fix the fixture, do not waive the row.

### M4b — แจ้งเตือน layout pass plus two interaction changes (S2-E, decision D9)

Owner chose "A+2" on 2026-08-19: keep the structure, fix the mechanics, and take exactly two changes from the fuller
redesign because they land on lines this phase already has to touch.

Mechanical (option A):

1. Header buttons (`:105-124`) and filter chips (`:132`) to 44px; chips become a horizontal scroll strip (recipe A).
2. `truncate` at `:164` becomes a 2-line clamp.
3. ~~`:258,:269` inputs to 16px~~ — dropped: M0 evidence showed `globals.css:431-437` already forces >=16px below
   640px, so there was never a zoom defect here (spec S3-B, withdrawn).

The two taken from the redesign:

4. **Whole row is one real `<Link>`**, covering the severity badge, replacing the `<div role="link" tabIndex={0}>` at
   `:157-162`. Reuses the existing `handleOpen` (`:92`) and `internalHref` (`:88`) — no new logic. Tap area
   ~180×60px → ~334×60px, and long-press/new-tab/focus behave like a real link for the first time.
5. **The two action links (`:168-177`) collapse into one 44px `⋮` menu**, reusing the recipe-E sheet pattern from
   `IndividualPermissionsPrototypePage.tsx:582`. Handlers already exist (`handleMarkRead` `:55`, `handleDismiss` `:66`).
   Reclaims ~40px of row width, moves destructive `ปิด` behind a deliberate step, and ends the busy-label reflow at
   `:171,:175`.

Nesting rule: a `<button>` cannot live inside the row `<Link>`. Render the menu control as a sibling of the link, not a
child.

**Deferred by decision, not oversight:** swipe actions, day grouping, severity badge → dot.

**Gate:** whole row opens the item at 390px; no target under 44px on the page; owner reads a full notification title
without it being cut off; desktop unchanged. **Evidence: every notification row in the list on all 7 device entries** — the row
link and the `⋮` control both hit-testable via `elementFromPoint`, which is the only way to prove the `⋮` is not
covering the row link it sits beside.

### M4c — ทดแทนใบเสร็จ issuance flow, end to end on device (S2-H, decision D8)

Owner confirmed 2026-08-19 that this feature is live, so it is validated as a flow rather than swept as a class.

This phase deliberately starts with **no defect list**. The audit checked the two parts most likely to break on a phone
and found both already correct: `SignaturePad.tsx:195-201` (`touch-none`, pointer events, DPR scaling) and
`ThemedSteps.tsx:74-108` (mobile-first sizing). Writing a fix list before walking the flow would be inventing work.

1. Walk all 6 steps on iPhone 13 with a real expense: `expense` -> `details` -> `evidence` -> `certify` -> `approve` ->
   `done` (`SubstituteReceiptWizardPage.tsx:448` onward). Record per step: taps, scrolls, anything reached for and not
   found, anything unclear.
2. Judge specifically: signing with a finger in the 176px pad (`h-44`); the 6-step stepper at ~65px per label; the
   `xl:sticky` guide card (`:192`) once it drops inline on mobile; the read-only summaries between steps
   (`:1255-1279`); and canvas export at `:1035-1051` on a phone's memory.
3. Fix what the walk finds, inside this phase, mobile-first with desktop parity.
4. Settings (`SubstituteReceiptSettingsPage.tsx`) and the hub table are already covered by M3 and M4a — do not redo here.

**Gate:** owner issues one real substitute receipt start to finish on device, signature included, without switching to a
computer. **Evidence: all 6 steps screenshotted on all 7 device entries with INV-11 green per step** — a wizard clean at steps
1 and 6 and broken at step 4 must not be able to report clean.


### M5 — Close out

- Full run across the 7-entry device matrix (spec §12.5), both engines, mobile and desktop widths.
- Publish the consolidated evidence bundle: every priority route, every card, every flow step, every device.
- Write `e2e/RESPONSIVE-RESULTS-2026-08.md`; classify every failure as ours or not-ours with evidence, as R5 did.
- Update the memory doc with what shipped, what was cut (non-priority features), evidence paths, and residual risk.

## Phase Summary

| Phase | Content | Effort | User-felt value | Can stop after? |
|---|---|---|---|---|
| M0 | Guard rails + evidence harness | **M–L** | none directly | no |
| M1 | `dvh`, safe-area, BrandedState | S | **high** — fixes the report, every page | **yes** |
| M2 | Camera-first upload | M | **highest** — the daily task | **yes** |
| M3 | Inputs + tap targets | M | medium — removes constant friction | **yes** |
| M4a | Card views for 3 queues | **L** | high, per queue | yes, per queue |
| M4b | แจ้งเตือน layout + 2 interaction changes | S–M | high — one screen, one file | yes |
| M4c | ทดแทนใบเสร็จ flow on device | M | high — live feature, unvalidated | yes |
| M5 | Close out | S | none directly | — |

## Open Questions

1. ~~Notifications~~ — **RESOLVED 2026-08-19: owner chose "A+2" — layout pass plus the row-as-link and `⋮`-menu
   changes. Phase M4b, decision D9. Swipe/day-grouping/dot-badge deferred.**
2. ~~Substitute-receipt wizard~~ - **RESOLVED 2026-08-19: owner confirmed the feature is live; it is in scope as
   phase M4b, validated as a flow on device.**
3. Should the non-priority features (CRM, inventory, banking, tax, ledger, reports) get a follow-up round after M5, or
   stay as the 2026-08-04 project left them until they are actually opened to users?
