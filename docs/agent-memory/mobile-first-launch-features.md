# Agent Memory: mobile-first-launch-features

Status: M0 COMPLETE 2026-08-19 (guard rails + evidence harness built and run). Owner authorised execution.
Branch `feat/mobile-first-launch-features` off `origin/develop`.

Owner: product owner set the priority feature list and the mobile-primary constraint on 2026-08-19; Claude authored the
audit, spec, and plan.

Scope: `apps/web` (CSS/TSX) + `playwright.config.ts` + `e2e/`. Nine launch features only. No API, schema, permission, or
dependency change. Desktop pixel-parity is a hard rule inherited from the 2026-08-04 project (D2).

Decisions:
- Reference device iPhone 13 (390x844, ~659px visible height). Existing rig already covers 375 and 412 width, so no new
  width tier — the uncovered axis is height.
- `vh` banned in app code, `dvh` only, enforced by a source-level vitest rather than a browser test, because no browser
  automation available here reproduces the iOS collapsing toolbar.
- Tier-2 mobile card views extend from the prior project's 5 queues to the owner's priority queues only; non-priority
  features are a deliberate cut, not an oversight.
- Camera-first capture (`capture="environment"`) on mobile; desktop drag-and-drop untouched.
- Dead shared components (`DataTable` et al.) stay dead — prior decision D6 stands.

Key finding (the reason this project exists rather than being a repeat):
The 2026-08-04 uplift was executed correctly and closed green (53/53). Its rig defines exactly one mobile project,
`devices['Pixel 7']` on chromium (`playwright.config.ts:93`). Headless chromium has no collapsing toolbar, so `100vh`
and `100dvh` are identical under test and the ~86px iOS discrepancy is invisible to every invariant. All three mobile
defect reports since R0 came from owner iPhone screenshots, never from the rig. Second blind spot: invariants measure
damage (overflow, clipping, reachability), not fitness — `/expenses/upload` is fully green while telling a phone user to
"ลากไฟล์มาวาง หรือคลิกเพื่อเลือก" and never offering the camera.

Open questions (in the plan, none blocking M0/M1):
1. RESOLVED 2026-08-19 — owner chose "A+2" for แจ้งเตือน (decision D9, phase M4b): keep the structure and fix mechanics,
   plus two changes from the fuller redesign that land on the same lines — whole row becomes one real `<Link>`
   (replacing the `<div role="link">` at `NotificationPages.tsx:157`) and the two action links at `:168-177` collapse
   into one 44px `⋮` menu. Swipe actions, day grouping, and severity-badge-as-dot are deferred by decision.
2. RESOLVED 2026-08-19 — owner confirmed ทดแทนใบเสร็จ is a live feature, so the 6-step issuance wizard is in scope as
   its own phase M4b (decision D8), validated as a flow on device rather than swept as a class. Note the audit found its
   two most device-dependent parts already correct (`SignaturePad.tsx` touch/DPR handling, `ThemedSteps.tsx` sizing), so
   M4b starts with no defect list by design.
3. Non-priority features — follow-up round after M5, or leave as the 2026-08-04 project left them?

Owner requirement added 2026-08-19 (decision D10, spec section 12): evidence per card, per flow step, per device —
"อย่าให้เจอว่าตกขอบ หายจากจอ". Key points the executor must not soften:
- Screenshots alone are NOT evidence. A control covered by a sticky bar or the home indicator photographs perfectly; a
  control clipped by `.mangmee-content { overflow-x: clip }` photographs as simply absent. The machine half is INV-11.
- INV-11 generalises the existing INV-2 (`e2e/responsive.spec.ts:138`, tables only) to every visible actionable
  element, and adds the three checks INV-2 lacks: `overflow-x: clip`/`hidden` ancestor clipping, `elementFromPoint`
  hit-testing, and 44px sizing. Today INV-2 passes an element clipped with no scroller unless it is a table.
- Every card, not the first card. A list rendering 0 rows must fail as `NO EVIDENCE`, never pass silently — that is the
  most likely way this bundle ends up lying.
- Every step of every multi-step flow, not just first and last.
- 5-device matrix: iPhone 13 WebKit + Chromium (390), Pixel 7 (412), 375 floor, desktop.
- Built in M0 with everything else, which makes M0 an M-L phase rather than the small one it was originally scoped as.

Decision D11 added 2026-08-19 (owner chose option C when asked whether desktop was covered): "device" includes desktop
widths 1280 / 1440 / 1920, so the matrix is 7 entries, not 5. Rationale — `e2e/responsive.spec.ts:119` skips the entire
invariant suite unless `isMobile`, so nothing in the repo has ever checked a computer screen for off-screen or clipped
controls; the owner's "อย่าให้เจอว่าตกขอบ หายจากจอ" would otherwise apply to phones only. INV-11 is unskipped on
desktop; INV-1..8 stay mobile-only because they encode mobile assumptions. **Desktop findings are recorded as
`DESKTOP-FINDING` and do not block a phase and are not fixed inside this project** — D2 (desktop pixel-parity) outranks
them, and R-3c exists to stop a desktop fix being slipped into a mobile phase's diff.

First desktop item to settle is S5-A, arithmetic only so far: 1280 − 289 sidebar − 56 content padding = 935px against
`min-w-[980px]` at `ReimbursementsPages.tsx:724, 1133, 1340`, i.e. the reimbursement queues may scroll horizontally on
a 13" laptop with the sidebar expanded. `devices['Desktop Chrome']` is 1280x720, so the desktop suite has been running
at exactly that width all along without checking. Run rows 5-7 with the sidebar EXPANDED (the narrower, worse case).

Artifacts:
- Spec: `docs/specs/mobile-first-launch-features-spec.md`
- Plan: `docs/plans/mobile-first-launch-features-plan.md`
- Predecessor memory: `docs/agent-memory/mobile-responsive-uplift.md`
- Prior rig: `e2e/responsive.spec.ts` (INV-1..8), `playwright.config.ts` project `mobile-chromium`

Review pass 2026-08-19 (owner asked for a second read of spec + plan) corrected four real errors in the docs
themselves, all of which would have misdirected the executor:
1. S2-C had claimed หลักฐานทางบัญชี was three tables at `ExpensesWorkspacePanels.tsx:181, 416, 747`. Only `:747` is the
   evidence table (`EvidencePanel`, `:473-915`); `:181` is `CategoryManagePanel` (`/expenses/categories`) and `:416` is
   `SignaturePanel` (`/expenses/signatures`) — different screens, split out as S2-C2.
2. D4 listed notifications as a card-view target, but it is already a list, not a table; a card view was the wrong fix.
   Corrected, and D9 now covers it.
3. S3-A/S3-B counted prototype and non-priority files into the work; each finding now states in-scope vs recorded-only
   (3 of 8 inline sub-16px inputs are in scope, 1 of 3 rogue `inputClass` constants).
4. "Three for three" overstated how the prior defects were found — two came from owner iPhone screenshots, one from an
   owner-requested re-audit. Zero from the suite either way, which is the point that matters.

Verification: audit is static analysis of the tree at 2026-08-19 on branch `fix/line-ai-capability-help-entitlement`;
every file:line in the spec was read at authoring time. Nothing has been run in a browser and no device check has been
done for this project yet. One correction already recorded during the audit: an initial regex counted 42 sub-16px
inputs by matching `<label>` elements sharing a line with the input; the verified count is 8 inline plus 3 `inputClass`
constants.

Caution for the executor: the branch carries unrelated in-flight edits to `ExpenseReviewPage.tsx` and
`workspace-dictionary.ts`, both of which phases M2/M4 touch. Verify per-file equivalence with python difflib — the prior
project recorded that an awk-based check failed silently.

M0 RESULTS 2026-08-19 — what shipped and, more importantly, what the evidence overturned.

Shipped:
- `apps/web/src/common/styles/viewport-units.spec.ts` (INV-10 source check) — RED on exactly 30 sites, entries 0 and 1
  being `WorkspaceShell.tsx:63` and `BrandedState.tsx:16`. Matches spec S1-D exactly. This is M1's worklist.
- `apps/web/src/common/styles/safe-area.spec.ts` (INV-9 source check) — RED on 2 sites: `ExpenseReviewPage.tsx:983`
  and `PartnerDetailPage.tsx:1034`. (The spec said `:991`; the line moved on develop.)
- `e2e/harness/inv11.ts` + `e2e/evidence.spec.ts` + `scripts/build-evidence-manifest.mjs` — INV-11 and the evidence
  bundle. Final baseline: 281 subjects across all 7 device entries, 160 of them individual cards (40 cards x 4 mobile
  entries), checked one card at a time. The 9 NO EVIDENCE rows are all the legitimate "card list is md:hidden at this
  width" on the three desktop entries, not coverage gaps.
- `playwright.config.ts` — 7-entry matrix (iphone13-webkit, iphone13-chromium, mobile-chromium, mobile-375,
  desktop-1280/1440/1920). WebKit had to be installed (`npx playwright install webkit`); only chromium was present.
- INV-5 extended from 2 sampled routes to 16, and scoped to `#workspace-main`.

Overturned by evidence — three of the audit's own claims did not survive:
1. **S3-A and S3-B (iOS zoom) are WITHDRAWN.** `apps/web/app/globals.css:431-437` already forces
   `font-size: max(1rem, 1em) !important` on every input/select/textarea below 640px. The class-level audit never read
   the global stylesheet. INV-5 passes on all 16 routes at 390px. A source-level INV-5 companion was written, found to
   be a false-positive generator against this rule, and deleted rather than kept. M3 is now tap targets only.
   Residual, recorded not scheduled: that media query ends at 639.98px, so tablet widths are uncovered.
2. **S5-A (desktop) is SETTLED as not-a-defect.** The reimbursement queues do sit in a horizontal scroller; INV-11
   found zero offscreen/clipped/covered controls at 1280/1440/1920. The arithmetic was right that it scrolls, wrong
   that anything becomes unreachable.
3. INV-11 itself produced three false-positive classes, all fixed and all commented in the harness:
   (a) collapsed accordions — `AppSidebar.tsx:348` keeps `height:0` children's layout rects — reported as "covered";
   (b) scrollable table rows reported as "clipped" because the ancestor walk did not stop at the first scroller;
   (c) `<nextjs-portal>`, the `next dev` overlay, reported as covering a pagination button — a rig artefact, since the
   e2e web server runs in dev mode. Lesson worth keeping: a new invariant's first runs test the invariant, not the app.

Remaining real mobile finding: `too-small` x269 element instances per mobile entry across the priority routes (spec
S3-C) — M3's worklist. Zero offscreen, clipped or covered controls on any device entry, and zero DESKTOP-FINDING.
That is a genuinely good result for the app and it belongs to the 2026-08-04 project: the width axis is sound. What
this project is left with is the height axis (M1, invisible to any browser here) and tap targets (M3).

Also found: the local environment has drifted from `e2e/HANDOFF.md`. The seeded database is now docker postgres on
**15432**, not native 5432, and `psql` is not on PATH, so `e2e/run-local.sh` preflight fails. Run playwright directly
with `DATABASE_URL=...localhost:15432/watchdog_bms?schema=public`. Committed defaults were left alone deliberately.

Next:
1. M1 structural sweep — 30 `vh` sites + 2 safe-area bars + BrandedState mobile-first spacing. Worklist is whatever
   the two source checks print.
2. M2 camera-first upload.
3. M3 tap targets only (smaller than planned, see above).
