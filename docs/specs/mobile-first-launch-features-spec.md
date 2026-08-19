# Feature: Mobile-First Uplift for Launch Features

## 1. Status

- Date: 2026-08-19
- Owner: product owner (priority list) + Claude (audit, spec, plan)
- State: SPEC — audit complete, no code changed yet.
- Trigger: owner report from a real iPhone (UAT, 2026-08-19 19:10) — `uat.mangmeeplus.com` error screen sits low on the
  screen with a large empty band above it. Owner then asked for a full-app review under a new standing constraint:
  **users work on phones, not desktops.**
- Linked plan: [[plans/mobile-first-launch-features-plan|Mobile-First Launch Features Plan]]
- Task memory: [[agent-memory/mobile-first-launch-features|Agent Memory]]

## 2. Goal

Make the **nine features the business opens with** usable, fast, and pleasant on a phone held in one hand — where
"usable" is measured by the user finishing the real job (record a spend, approve a claim, issue a substitute receipt),
not by the page merely fitting inside the viewport.

The prior project ([[plans/mobile-responsive-uplift-plan|Mobile Responsive Uplift]], closed 2026-08-04) made the app
*fit*. This project makes it *work*.

## 3. Source Docs

- Prior project plan: [[plans/mobile-responsive-uplift-plan|Mobile Responsive Uplift Plan]]
- Prior Thai summary: `docs/mobile-responsive-uplift-summary-th.md`
- Prior task memory (R0–R5 + 2 follow-ups): `docs/agent-memory/mobile-responsive-uplift.md`
- Existing guard rail: `e2e/responsive.spec.ts` (INV-1..8), `playwright.config.ts` project `mobile-chromium`
- Related: [[specs/expense-receipt-upload-spec|Expense Receipt Upload Spec]]

## 4. Why this is not a repeat of the 2026-08-04 project

That project was done properly: audit → invariant rig built *before* fixes → 6 phases → 53/53 mobile invariants green at
412px and 375px, desktop pixel-parity proven. Two follow-ups (2026-08-05) closed defects it missed. It is not the
problem. **The problem is what its rig structurally cannot see.**

### Blind spot 1 — the height axis and the iOS engine

`playwright.config.ts:93` defines exactly one mobile project: `devices['Pixel 7']` on **chromium**. Headless chromium has
no collapsing browser toolbar, so `100vh` and `100dvh` resolve to the same number in every test. On a real iPhone they
do not:

| | iPhone 13, Safari, toolbars shown |
|---|---|
| `100vh` (what a centred layout is measured against) | ~745px |
| `100dvh` / actually visible | ~659px |

Every `min-h-screen` in the app therefore adds ~86px of empty, scrollable, content-free space — and any
`items-center` inside it pushes content ~43px below the optical centre. This is precisely the defect the owner
photographed, and the suite is green on it and always will be.

No mobile defect found since R0 was found by the rig. F1–F5 (2026-08-05) came from owner iPhone screenshots taken
2026-08-04 22:14; this report came from an owner iPhone screenshot on 2026-08-19; the full-app sweep (2026-08-05) came
from the owner asking for another audit. Two device reports and one requested re-audit — zero from the suite. That is a
signal about the rig, not about the reviewers.

### Blind spot 2 — invariants measure damage, not quality

INV-1..8 ask "does anything overflow, clip, or become unreachable?" They cannot ask "is this the right screen for a
person holding a phone?" The single clearest example, on the app's most-frequent mobile task:

`apps/web/src/features/expenses/ExpensesPages.tsx:332` renders the receipt-upload dropzone, 88px tall (`py-11`), in the
prime area of the screen, wired to `onDragEnter`/`onDragOver`/`onDrop`. Its label
(`workspace-dictionary.ts:681`) reads **"ลากไฟล์มาวาง หรือคลิกเพื่อเลือก"** — *drag a file here, or click to select.*

On a phone there is no drag, no file, and no click. And `grep -rn 'capture=' apps/web/src` returns **nothing**: the app
never offers the camera directly, although photographing a receipt is the entire job. Every invariant on that page is
green.

## 5. Non-goals

- No API, schema, or permission changes. `apps/web` only (CSS/TSX), plus test config.
- No desktop redesign. **Desktop pixel-parity remains a hard rule** (rule D2 of the prior project): every change is
  written mobile-first with the current value restored at `sm:`/`lg:`, except shell bugs explicitly tagged
  `[desktop-visible]`.
- No revival of dead shared components (`DataTable`, `ListPageLayout`, `PageHeader`, `ActionToolbar` — 0 consumers).
  Prior decision D6 stands.
- The 9 `*Prototype*` files are out of scope **except where a priority route actually renders one** — which M4a
  discovered is the case for all three employee-access routes. See S2-F.
- Not a rewrite of the LINE capture path — LINE stays the fastest route for photo-to-expense; this spec covers the web
  surface a user reaches when they are already in the app.

## 6. User Roles

Unchanged from existing permission model. The mobile-primary user in practice is **Staff** (records spend, uploads
receipts, files claims) and **Owner/Admin** (approves claims, reviews evidence, checks the dashboard between other
work). Accountant/finance work — GL, reconciliation, settings matrices — stays desktop-shaped by design.

## 7. Priority Features (owner-defined, 2026-08-19)

| # | Feature | Primary routes |
|---|---|---|
| 1 | ค่าใช้จ่าย (expenses) | `/expenses`, `/expenses/manual`, `/expenses/[id]` |
| 2 | อัพโหลดใบเสร็จ (receipt upload) | `/expenses/upload` |
| 3 | เบิก (reimbursements) | `/reimbursements` ×3 queues |
| 4 | ทดแทนใบเสร็จ (substitute receipt) | `/expenses/substitute-receipts`, `/new`, `/settings/substitute-receipt` |
| 5 | หลักฐานทางบัญชี (accounting evidence) | `/expenses/evidence` |
| 6 | แดชบอร์ด (dashboard) | `/dashboard` |
| 7 | แจ้งเตือน (notifications) | notification bell, `/notifications` |
| 8 | พนักงาน (employees) | `/settings/employees`, `/settings/permissions` |
| 9 | ตั้งค่า (settings) | `/settings/*` |

## 8. Findings

Severity is judged by **cost to the user finishing the job on a phone**, not by how broken the markup looks.

### S1 — Structural, affects every screen

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| S1-A | `min-h-screen` (= `100vh`) on the workspace shell | `common/components/app-shell/WorkspaceShell.tsx:63` | ~86px of dead scrollable space below the content of **every workspace page** on iOS. Users scroll to the end and find emptiness — reads as "still loading" or "something is missing". |
| S1-B | `min-h-screen` on branded full-page states | `common/components/state/BrandedState.tsx:16`, `app/global-error.tsx:14` | The reported defect. Content sits ~43px below optical centre with the gap pooled at the top. Hits error, 404, access-denied, company-unavailable — i.e. every moment the user has *already* lost confidence. |
| S1-C | `100vh` + stale header constant | `features/employee-access/EmployeeAccessPages.tsx:222` — `min-h-[calc(100vh-64px)]` while `--app-header-h: 68px` (`globals.css:65`) | vh drift plus a 4px error the shell fixed in R1 but this page never adopted. |
| S1-D | 30 `100vh`/`min-h-screen` sites total across `apps/web` | grep, 2026-08-19 | Same class. Fix once, sweep all. |
| S1-E | `env(safe-area-inset-*)` used at only 5 sites while 23 files position `fixed`/`sticky` | `globals.css:103,112,119`; `ToastProvider.tsx:64`; `AppSidebar.tsx:388` | Sticky action bars land under the iPhone home indicator. Confirmed candidate: `ExpenseReviewPage.tsx:983` on develop (`sticky bottom-0`, no inset) — the bar carrying confirm/void/delete on the review screen. |

### S2 — Task-flow, priority features (the real cost)

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| S2-A | Receipt upload is a desktop drag-and-drop metaphor; copy instructs the user to drag and click | `ExpensesPages.tsx:332-347`; `workspace-dictionary.ts:681` | The #1 mobile task opens with an instruction that is impossible to follow on the device the user is holding. |
| S2-B | No camera capture anywhere in the app | no `capture=` in `apps/web/src`; `ThemedFile.tsx:78-88` | Photographing a receipt costs an extra hop through the iOS sheet, and "Take Photo" is not the default choice. For a spend-capture app this is the single highest-leverage fix. |
| S2-C | หลักฐานทางบัญชี is a scrolling table, no card view | `ExpensesWorkspacePanels.tsx:747`, inside `EvidencePanel` (`:473-915`) | Priority-5 feature. Prior decision D3 granted card views to only 5 queues; evidence was not one of them. |
| S2-C2 | Two more scrolling tables live in the same file but belong to different screens | `:181` in `CategoryManagePanel` (`/expenses/categories`), `:416` in `SignaturePanel` (`/expenses/signatures`) | Both sit under priority-1 expenses, so they are in scope — but they are **not** the evidence table. Do not treat the three as one job. |
| S2-D | ทดแทนใบเสร็จ hub is a scrolling table; 3 responsive prefixes in 375 lines | `SubstituteReceiptHubPage.tsx` | Priority-4 feature, effectively unadapted. |
| S2-E | แจ้งเตือน is **already a list, not a table** — its problem is the row itself. At 390px the title gets ~180px of the row and is `truncate`d to one line, because the severity badge and two action links consume the rest | `NotificationPages.tsx:153` (row), `:164` (`truncate`), `:168-177` (two `text-xs` links ~16px tall, 8px apart, one of them destructive `ปิด`), `:157` (`<div role="link">`, not a real link, tappable area ~180×60px), `:132` (filter chips, no scroll strip), `:258,:269` (sub-16px inputs) | Priority-7 feature. **A card view is the wrong fix here** — the fix is the row's tap model. Busy labels at `:171,:175` also swell mid-action and reflow the row under the user's thumb. |
| S2-F | ~~พนักงาน list is a table with no card view~~ **WITHDRAWN 2026-08-19 by M4a evidence** | `EmployeeAccessPages.tsx` | The list it named lives in `MatrixView`, reachable only from `EmployeeAccessWorkspacePage`, which has **zero consumers**. All three employee-access routes render `*Prototype*` components instead: `/settings/employees` -> `AddEmployeePrototypePage`, `/settings/permissions` -> `PermissionMatrixPrototypePage`, `/settings/access-overview` -> `IndividualPermissionsPrototypePage`. A card view was built there and reverted under decision D6 (dead components stay dead) once the evidence run reported the list was not in the DOM. **Consequence for §5: the blanket "prototypes are out of scope" is wrong for employee-access — those files are the product on three priority routes**, and their tap-target fixes were kept for exactly that reason. Neither remaining screen is a queue a card list fits: one is a form, one is a permission matrix. |
| S2-G | 25 of 29 table-bearing files have no mobile card branch; `.mangmee-table-scroll` adopted by only 4 | grep, 2026-08-19 | Tables scroll (INV-2 green) but the action column is off-screen — the "drag tax" the prior plan named, still owed for every queue outside the original 5. |
| S2-H | ทดแทนใบเสร็จ issuance wizard (2306 lines, 6 steps) has never been validated on a phone end to end | `SubstituteReceiptWizardPage.tsx` | Owner confirmed 2026-08-19 this feature is live, so the flow is in scope, not deferred. **Note: no defect list — the audit found its two most device-dependent parts already correct** (see S4). The risk here is flow and feel across 6 steps in a 659px window, which only an on-device pass can judge. |

### S3 — Control-level, mechanical

| ID | Finding | Evidence | Impact |
|---|---|---|---|
| S3-A | ~~3 local `inputClass` constants cause iOS zoom~~ **WITHDRAWN 2026-08-19 by M0 evidence** | `EmployeeAccessPages.tsx:127`, `DataRightsDetailPage.tsx:63`, `CustomersPrototypePage.tsx:109` | The zoom claim was wrong: `globals.css:431-437` already forces `font-size: max(1rem, 1em) !important` on every input/select/textarea below 640px, so `text-sm` cannot reach the user on a phone. INV-5 passes on all 16 priority routes at 390px (iPhone 13 WebKit), which is what settled it. The `h-10` height in the employee-access constant is still a tap-target issue and stays under S3-C. |
| S3-B | ~~8 inline sub-16px inputs~~ **WITHDRAWN 2026-08-19 by M0 evidence** | same sites as originally listed | Same reason as S3-A — the global rule at `globals.css:431-437` overrides every one of them below 640px. **Residual gap, recorded not scheduled:** that media query stops at 639.98px, so a tablet-width Safari session (640–1024px) is not covered. Out of scope here because the reference device is a phone (D1). |
| S3-C | 38 clickable `<button>`/`<a>` with a fixed height below 44px and no responsive escape | grep, 2026-08-19; worst: `ExpensesWorkspacePanels.tsx` (7), `DocumentPreviewModal.tsx` (3), `ThemedFile.tsx:102` (28px clear button) | Mis-taps on the two hands-busy screens. `ThemedDate`'s 40px target is a documented deliberate exception and stays. |
| S3-D | `error.tsx:44`, `not-found.tsx:16` hand-roll `h-10` anchors beside `h-11` `Button`s | both files | Mismatched button heights in one row, below tap-target minimum. |

### S5 — Desktop, to be confirmed by M0 evidence (decision D11)

Arithmetic only — nothing here has been rendered. M0's first desktop run either confirms or kills each item.

| ID | Finding | Arithmetic | Impact if confirmed |
|---|---|---|---|
| S5-A | **SETTLED 2026-08-19 — not a defect.** The queues do sit inside a horizontal scroller, so nothing is unreachable; INV-11 found zero offscreen/clipped/covered controls at 1280, 1440 and 1920. What the arithmetic predicted (a scrollbar) is real; what it implied (an unreachable action column) is not. | viewport 1280 − sidebar 289 (`WorkspaceShell.tsx:43`) − `.mangmee-content` padding 56 at ≥1024 (`globals.css:115-118`) = **935px** of content, against `min-w-[980px]` at `ReimbursementsPages.tsx:724, 1133, 1340` | The "action column off-screen" problem the plan treats as a mobile issue would also exist on the most common laptop size. Note `devices['Desktop Chrome']` is 1280×720, so the desktop suite already runs at exactly this width and has never checked for it. |
| S5-B | **SETTLED 2026-08-19 — clean, as predicted.** | `ExpensesPages.tsx:1515` `min-w-[760px]`, `AccountingTaxSetupPage.tsx:102` `min-w-[36rem]` (576px) | Both fit inside 935px, so these are expected to pass — listed so the M0 run states them as checked rather than silent. |

### S4 — Assessed and explicitly cleared (do not spend effort here)

- **`grid-cols-2` without breakpoints, 16 sites** — two columns at 390px is acceptable for short fields; `ThemedDate`'s
  `grid-cols-7` is a calendar and is correct. Not a defect.
- **`.mangmee-input`** (`globals.css:412-420`) is already correct: 44px min-height, 16px font. 17 files use it properly.
- **`Field.tsx:31`** (`h-11 text-base sm:h-10 sm:text-sm`, `min-h-11 min-w-11` at `:155`) is the best mobile-first code in
  the repo and is the pattern everything else should converge on.
- **`Button.tsx:27`**, **`Modal.tsx:110`** (bottom sheet), **shell drawer + backdrop + scroll-lock**, **`use-media-query`**,
  **`use-body-scroll-lock`** — all already correct.
- **`globals.css:431-437`** — a `!important` media rule already guarantees >=16px form controls below 640px, which is
  why no runtime iOS-zoom defect exists on a phone. The 2026-08-04 project shipped this; the audit missed it and
  produced two findings (S3-A, S3-B) that M0 evidence then withdrew. Read the global stylesheet before trusting a
  class-level audit.
- **`SignaturePad.tsx:195-201`** is already correct for touch: `touch-none` (blocks page scroll while drawing), pointer
  events with `onPointerCancel`, and `devicePixelRatio` scaling at `:47,:76,:151`. Signing with a finger should work;
  what needs judging on device is whether a 176px (`h-44`) drawing area feels big enough one-handed.
- **`ThemedSteps.tsx:74-108`** is already mobile-first (`text-[11px] sm:text-xs`, `min-w-0 flex-1`, 40px targets). At 6
  steps on 390px each label gets ~65px — cramped but legible. Judge on device; do not pre-emptively rebuild.
- **First audit pass over-counted sub-16px inputs at 42**; the regex was matching the `<label>` sharing a line with the
  input. Verified count is 8 inline + 3 constants. Banking's 15 apparent hits use `.mangmee-input` correctly.

## 9. Design Decisions

- **D1 — Reference device is iPhone 13 (390×844, ~659px visible).** Between the existing 375px floor and 412px Pixel 7,
  so no new width tier is needed. The uncovered axis is height, not width.
- **D2 — Desktop pixel-parity stays a hard rule.** Inherited unchanged from the prior project.
- **D3 — `vh` is banned in app code; `dvh` only.** Enforced by a source-level check (below), because no browser
  automation available to this repo reproduces the iOS collapsing toolbar. Honest guard rails beat theatrical ones.
- **D4 — Extend Tier-2 card views to the owner's priority queues**, not to all 25. Adds two: evidence
  (`EvidencePanel`) and the substitute-receipt hub. Employees was dropped during M4a — see S2-F. **Notifications is deliberately not on this list** — it is
  already a list, so it gets D9 instead. Settings matrices and GL stay scrolling tables by design.
- **D5 — Camera-first capture on mobile.** `capture="environment"` plus a distinct "ถ่ายรูปใบเสร็จ" action; the dropzone
  becomes `sm:`-only and the mobile copy stops describing dragging. Desktop keeps drag-and-drop exactly as-is.
- **D6 — Dead components stay dead.** Inherited.
- **D7 — Add a WebKit mobile project (`devices['iPhone 13']`) to Playwright** for engine-level differences, while
  recording in the results doc that it still cannot reproduce dynamic-toolbar height. It closes the engine half of
  blind spot 1; the height half is closed by D3's static check plus a device checklist.
- **D8 — ทดแทนใบเสร็จ is validated as a flow, not swept as a class.** Owner confirmed it is a live feature, so the
  6-step issuance wizard gets a step-by-step on-device pass with its own phase, separate from the mechanical sweeps.
  Findings from that pass are fixed inside the same phase.
- **D9 — แจ้งเตือน gets a layout pass plus two interaction changes, not a redesign** (owner decision 2026-08-19,
  "A+2"). Keep the current structure — header, filter chips, row list. Mechanically: 44px targets on the header buttons
  and row actions, filter chips become a horizontal scroll strip (recipe A), `truncate` at `:164` becomes a 2-line
  clamp, the `:258,:269` inputs go to 16px. Plus two changes taken from the fuller redesign because they land on the
  same lines: **(1)** the whole row becomes one real `<Link>` covering the badge too, replacing the
  `<div role="link">` at `:157` — tap area goes from ~180×60px to ~334×60px; **(2)** the two action links at
  `:168-177` collapse into a single 44px `⋮` menu reusing the recipe-E sheet pattern from
  `IndividualPermissionsPrototypePage.tsx:582` — this reclaims ~40px of row width, puts the destructive `ปิด` behind a
  deliberate step, and stops the busy-label reflow. **Explicitly deferred:** swipe actions, day grouping, and replacing
  the severity badge with a dot — those need new state, gesture handling, and desktop branching.
- **D10 — Nothing ships without evidence, per card, per flow step, per device** (owner requirement 2026-08-19). No
  phase passes on "the suite is green". Every card in every card list, every step of every flow, and every priority
  route must produce a recorded artifact on each supported device showing that no actionable control is off-screen,
  clipped, or covered. See §12.
- **D11 — "device" includes desktop widths; desktop is measured but not redesigned** (owner decision 2026-08-19,
  option C). INV-11 runs on 1280 / 1440 / 1920 as well as the mobile matrix, and desktop gets the same evidence bundle.
  Today no invariant runs on desktop at all — `e2e/responsive.spec.ts:119` skips the whole suite unless `isMobile`, so
  "อย่าให้เจอว่าตกขอบ หายจากจอ" is currently enforced on phones only. **Desktop findings are recorded as
  `DESKTOP-FINDING` in the manifest and are not fixed inside this project without explicit owner sign-off** — D2
  (desktop pixel-parity) outranks them. Fixing them is a separate decision with its own baseline.

## 10. Acceptance Criteria

1. No `100vh`/`min-h-screen`/`h-screen` remains in `apps/web` outside a documented exception list; a check fails the
   build if one returns.
2. On iPhone 13, every branded full-page state is optically centred, and no workspace page has dead scroll space at
   its end.
3. Every sticky/fixed action bar in the priority features clears the home indicator.
4. Zero form fields below 16px on the 9 priority routes (INV-5 extended from 2 sampled routes to all of them).
5. Every priority-feature queue offers a mobile card view whose primary action is reachable without horizontal scroll.
6. On `/expenses/upload` at 390px, the first action offered is taking a photo, and no visible copy instructs the user
   to drag a file.
7. No clickable target below 44px on the priority routes, `ThemedDate` excepted.
8. Desktop: `e2e/responsive.spec.ts` desktop-parity tests and the desktop screenshot baseline show no change.
9. On แจ้งเตือน at 390px: the whole row is one link, actions sit behind a single 44px control, and no title is cut
   off mid-line.
10. The substitute-receipt issuance wizard is completed end to end on a real iPhone 13 — including drawing a signature
   with a finger — and every step is judged usable by the owner.
11. Every acceptance criterion above is backed by the §12 evidence set — not by a passing test count. A phase with
    green tests and no evidence bundle is not done.
12. `docs/agent-memory/mobile-first-launch-features.md` records run IDs, results, evidence paths, and anything deferred.

## 11. Verification

- Extend `e2e/responsive.spec.ts`: INV-5 across all 9 priority routes; INV-7 for each new card view; new INV-9
  (sticky bars respect safe-area) and INV-10 (no `vh` unit in computed layout heights).
- New source-level check for D3 — a plain vitest over the source tree, not a browser test.
- New `mobile-webkit` Playwright project (D7).
- **Owner verification on a real iPhone 13 remains a required gate for each phase.** The rig has never been what found
  these defects; the plan should stop pretending otherwise.

## 12. Evidence Protocol (owner requirement, 2026-08-19)

> "ทุกการ์ด ทุก flow ทุก device ต้องมีหลักฐานด้วย อย่าให้เจอว่าตกขอบ หายจากจอ"

### 12.1 Why screenshots alone are not evidence

A control covered by a sticky footer, or sitting under the iPhone home indicator, **photographs perfectly**. A control
clipped by `.mangmee-content { overflow-x: clip }` (`globals.css:107`) is not merely hard to reach — it is invisible and
unscrollable, and a screenshot simply shows it absent, which reads as "that button does not exist on mobile" rather than
as a defect. Screenshots are the human-readable half. The machine-checkable half is what proves reachability.

Both halves are required. Neither substitutes for the other.

### 12.2 INV-11 — the machine-checkable half

Generalises INV-2 from `table, [data-testid="expenses-grid"]` (`e2e/responsive.spec.ts:138`) to **every visible
actionable element**: `button, a, input, select, textarea, summary, [role="button"], [role="link"]`.

For each such element, on each device in §12.5 — **including the three desktop widths, per D11** — on each priority
route, assert all four:

1. **On screen horizontally** — `rect.left >= -1` and `rect.right <= innerWidth + 1`, or it lives inside an ancestor
   whose `overflow-x` is `auto`/`scroll` (reuse the existing ancestor walk at `:142-153`).
2. **Not clipped by a `clip`/`hidden` ancestor** — walk ancestors; if one has `overflow-x: clip` or `hidden` and the
   element's rect falls outside that ancestor's rect, fail. **This is the check that catches "หายจากจอ"** and the
   existing INV-2 does not perform it — it only accepts a scroller, so an element clipped with no scroller inside a
   non-table container passes today.
3. **Actually hit-testable** — after `scrollIntoViewIfNeeded`, `document.elementFromPoint(centre)` returns the element
   or one of its descendants. Catches controls buried under a sticky action bar, a toast, or the home indicator.
4. **Big enough** — `>= 44 x 44` CSS px, against the documented exception list (`ThemedDate` at 40px).

Failures report the element's `outerHTML` head, its rect, and which of the four failed — so the report is actionable
without re-running.

### 12.3 Per card, not per page

"ทุกการ์ด" is explicit and is not satisfied by checking the first card. For every card list
(`[data-testid$="-card-list"] > *` plus each new list added in M4a), iterate **every rendered card** and run INV-11
inside it.

**A list with zero rows produces zero evidence and must fail, not pass.** Assert a minimum row count per queue and, if
the fixture yields none, fail with `NO EVIDENCE: <queue> rendered 0 cards` rather than recording a green tick. Silent
empty states are the most common way an evidence bundle lies. The prior project's R5 already hit seed-data drift
between environments; treat a thin fixture as a blocker, not a curiosity.

### 12.4 Per flow step

For each multi-step flow — substitute-receipt wizard (6 steps), expense review, receipt upload, reimbursement create —
capture INV-11 **plus a screenshot at every step**, not only at the start and the end. A wizard that is clean on steps
1 and 6 and broken on step 4 currently reports as clean.

### 12.5 Per device

| # | Device | Width | Engine | Purpose |
|---|---|---|---|---|
| 1 | iPhone 13 | 390 | WebKit (D7) | owner's reference device |
| 2 | iPhone 13 | 390 | Chromium | isolates engine-specific findings |
| 3 | Pixel 7 | 412 | Chromium | existing rig, keeps history comparable |
| 4 | 375 floor | 375 | Chromium | narrowest supported |
| 5 | Laptop 13" | 1280 | Chromium | D2 parity **and** INV-11 (D11). Also the width `devices['Desktop Chrome']` already uses |
| 6 | Laptop 15" | 1440 | Chromium | INV-11 (D11) |
| 7 | Desktop | 1920 | Chromium | INV-11 (D11) |

Seven entries. Rows 5–7 are new under D11: rows 1–4 prove the mobile work, row 5 additionally carries the existing
desktop parity duty, and rows 5–7 together answer "does anything fall off the edge on a computer screen" — a question
nothing in the repo asks today.

**Sidebar state matters on rows 5–7.** Run them with the sidebar expanded (`lg:ml-[289px]`), which is the narrower and
therefore worse case, not collapsed (`lg:ml-[86px]`).

### 12.6 Artifacts

- `outputs/mobile-evidence-<date>/<device>/<route>.png` — full-page screenshot per route per device.
- `outputs/mobile-evidence-<date>/<device>/<flow>-step<N>.png` — per flow step.
- `outputs/mobile-evidence-<date>/EVIDENCE.md` — generated manifest: device x route x cards checked x controls checked
  x verdict x screenshot link. One table the owner can read top to bottom without opening the repo.
- Every failure carries element HTML + rect + failed check.

### 12.7 Gate rule

A phase is done when its evidence bundle exists, is complete (no `NO EVIDENCE` rows), and the owner has seen it.
**Green tests with no bundle is not done.** This applies to every phase including M1, whose diff is one word per site.

`DESKTOP-FINDING` rows do **not** block a phase (D11) — they are recorded for the owner to triage. A phase blocks only
on mobile failures and on `NO EVIDENCE`. This keeps D2 intact: the project measures desktop honestly without quietly
starting to redesign it.
