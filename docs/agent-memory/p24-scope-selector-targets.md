# Agent Memory: P24-2b scope selector targets

Status: ROOT ACCEPTED scoped source and real-Chrome evidence; integrated onto develop `d8f1a8536145beb24118dff901f18a4b92b08583`. Final61/61 local E2E includes long-list scrolling; phase PR/exact-head CI pending. Not full P24/main acceptance.
Owner: `/root/ocr_platform_admin`; root owns manual Chrome, integration and PR.
Scope: Existing company/branch selector triggers, retries and options in WorkspaceScope;
44px targets and visible keyboard/forced-colors focus, plus bounded readable retry text
and label-in-name containment using existing translations.

## Decisions

- New clean worktree `mangmeeplus-p24-scope-selector-targets`, branch
  `codex/p24-scope-selector-targets`, base
  `d8d9808e41d15360810ed67e9169ade0cd5605ab`. AI/P11/primary/other worktrees untouched.
- Read full repo AGENTS and Ponytail full (repo path; legacy `/Users/spare058` reference
  is stale), P24/mobile/UI specs and relevant existing responsive plan. Traced
  WorkspaceLayout → selectors → cookie-session APIs, scope intersection/locked state,
  local selection storage and original company dashboard navigation.
- Static baseline: seven button templates; `sm:h-10` shrinks triggers/branch retry,
  options are `py-2 text-sm`, company retry has no target minimum. Do not change the two
  noninteractive single-company/locked-branch label states into controls.
- Use existing shell focus classes including `outline-hidden`, not an invisible
  `outline-none` fallback in forced colors. No shared component extraction or new deps.
- Existing registered responsive test supplies real cookie auth. Local read-only API
  probe on3003 returned200 for health, two OWNER companies and four active branches with
  unrestricted scope. Names/IDs come from this source, not invented permission fixtures.
- Read `/tmp/expense-payment-capture-local-20260827.cjs` with sensitive values redacted:
  isolated DB `watchdog_expense_payment_capture_20260827` on127.0.0.1:15432, MinIO bucket
  `expense-payment-capture-20260827` on127.0.0.1:19000, existing API3003. Never run this
  script's bootstrap/serve or change its services. Only our web3004 may be started.
- Test-only display labels/errors/locked-state responses will be labelled as mocked UI
  evidence. No authentication, permission or feature-grant proof is inferred from them.
  No data seeding/migration, cloud, live provider, LINE, commit/push or PR operation.
- Root inspected the simultaneous503 mobile screenshot and approved a scoped copy fix.
  The first attempt used `state.error.retry` (`ลองอีกครั้ง` / `Try again`), with full
  failure name/title and desktop text preserved. That attempt is superseded: root found
  Thai visible `ลองอีกครั้ง` is absent from accessible `โหลดข้อมูลไม่สำเร็จ · ลองใหม่`.
  Use existing `client_notice.retry` (`ลองใหม่` / `Try again`) instead, so each real
  dictionary's full failure name contains its visible action; handlers stay unchanged.
- Source checked directly on2026-08-27: [W3C Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html)
  describes visible text containment in the accessible name, case-insensitive comparison,
  and `aria-label` overriding native text. This supports the bounded retry-name correction,
  not whole-WCAG certification or actual voice-control/physical-device acceptance.

## Artifacts

- [Spec](../specs/p24-scope-selector-targets-spec.md)
- [Plan](../plans/p24-scope-selector-targets-plan.md)
- `apps/web/src/features/web-core-workspace/WorkspaceScope.tsx`
- `apps/web/src/features/web-core-workspace/web-core-workspace.spec.ts`
- `e2e/responsive.spec.ts`
- Root-owned `docs/evidence/p24-scope-selector-targets/README.md` and `chrome-before-*.jpg`
  are preserved; this agent does not edit root's manual proof or binaries.

## Verification

- `git worktree add -b codex/p24-scope-selector-targets ... d8d9808e...`: clean base.
- `pnpm install --offline --frozen-lockfile`: passed,754 packages reused,zero downloads.
- `pnpm --filter @watchdog-bms/contracts build` and config build: passed.
- Registered unit before production change: **75/76 passed,1 failed,zero skipped**;
  the new seven-template target/focus check fails on the old classes.
- Three-case rendered baseline at the old styling: **0/3 passed** (not environment
  failures). Desktop triggers40px and options36px; company retry20px; long unbroken
  labels overflow their option boxes425–457px. Brand focus rings are absent.
  Baseline HTML `playwright-report/p24-scope-baseline/index.html`, JSON
  `test-results/p24-scope-baseline.json`, traces `test-results/p24-scope-baseline/`.
- Initial14-case post-CSS run was **10/14 passed**. The remaining hit-test failures
  came from the test focusing the fixed skip-to-main link with its first Tab and then
  measuring the company control underneath. A diagnostic run captured its real covering
  `<a href="#workspace-main">` at z100000 over a119×44px company button. Keep the skip
  link unchanged; focus the actual control before measuring. Diagnostic trace retained
  under `test-results/p24-scope-hit-diagnostic/`; do not misreport this as a product fix.
- Historical geometry stage, not final acceptance: after the test precondition correction
  and realistic mobile heights, combined P24-2a/2b
  Chromium+mobile-Chromium: **44/44 passed,zero skipped/flaky**, 64.3s. Includes28 new
  selector cases and16 existing shell cases; mobile360×740/390×844, tablet768×900,
  desktop1280×900. Full popup viewport assertions are scoped only to P24-2b.
  Report `playwright-report/p24-scope-final/index.html`, JSON
  `test-results/p24-scope-final.json`; screenshots are attached with `real-*` versus
  `mock-*` names. Reports are local untracked artifacts (this worktree does NOT ignore
  `playwright-report/`); never stage them or auth-bearing traces.
- Focused unit suite (workspace/branch-label/sidebar): **89/89 passed,zero skipped**.
  Full `pnpm --filter @watchdog-bms/web test`: **1140/1140 passed,zero skipped**.
  `pnpm --filter @watchdog-bms/web exec tsc --noEmit`: passed; avoid `next typegen` while
  own dev server is active. Strict standalone E2E TypeScript check passed:
  `pnpm exec tsc --noEmit --moduleResolution bundler --module esnext --target es2022
  --skipLibCheck --types node --strict e2e/responsive.spec.ts`.
- Existing real BSC-03 (dashboard chip, subtitle and branch-scoped200 read): **1/1 passed**.
  No added branch/company record or identity/permission/feature mutation.
- Visual inspection of that historical mock503 mobile screenshot found both retries truncate the
  action words: `playwright-report/p24-scope-final/data/44711a886731f00466a824eed06b2bbfb1956163.png`.
  Geometry is correct but readability is not thereby accepted. Raised to root before
  changing copy. The first approved copy attempt was subsequently superseded as above.
- First copy attempt (`state.error.retry`) passed focused89/89, full web1140/1140,
  both type checks and combined P24-2a/2b+BSC-03 **49/49 passed,zero skipped/flaky**.
  Its report `test-results/p24-scope-readable-report/index.html` and JSON
  `test-results/p24-scope-readable-final.json` are historical readability evidence only:
  they did not assert label-in-name and do not accept the final production copy.

### Label-in-name correction, historical pre-long-list freeze (2026-08-27)

- Docs/spec amended first. Registered unit red on the first copy attempt:75/76 passed,
  one failure,zero skips (`client_notice.retry` usage0 rather than2). Changed only the
  two production translation references, not error names, titles, desktop text or reloads.
- Focused command from `apps/web`:
  `pnpm exec tsx --test src/features/web-core-workspace/web-core-workspace.spec.ts
  src/features/web-core-workspace/branch-scope-label.logic.spec.ts
  src/common/components/app-shell/AppSidebar.spec.ts`: **89/89 passed,zero skipped**.
- Full `pnpm --filter @watchdog-bms/web test`: **1140/1140 passed,zero skipped**,6.52s.
  Web `tsc --noEmit` and the strict standalone E2E TypeScript command above: passed.
- Final combined P24-2a/2b+BSC-03: **49/49 passed,zero skipped/unexpected/flaky**,71.035s,
  started2026-08-27T05:38:51.977Z. This is32 new selector cases,16 existing shell cases
  across Chromium/mobile-Chromium and one registered real BSC-03 on Chromium (the mobile
  project's existing testMatch excludes that file; no skipped test is counted as proof).
- Retry360/390/1280 asserts both real rendered accessible names contain the complete
  visible action, full title/name remain, the two actions fit their buttons, then releases
  the synthetic503 and checks original reloads restore real options. Forced-colors360/390/
  1280 and all four-width real/long-label cases pass.38 screenshot attachments:16 real
  company/branch and22 explicitly mocked display/error screenshots.
- Final HTML `test-results/p24-scope-label-in-name-report/index.html`; JSON
  `test-results/p24-scope-label-in-name-final.json`; execution artifacts
  `test-results/p24-scope-label-in-name-final/`. These paths are gitignored (verified),
  unlike the earlier local `playwright-report/`; never stage reports or auth-bearing traces.
- Viewed the final mobile-Chromium screenshots, not just DOM geometry. Both simultaneous
  retry actions read `ลองใหม่` completely at360×740 and390×844; long branch text wraps
  within the full popup. PNGs under `test-results/p24-scope-label-in-name-report/data/`:
  - Mock503360: `830bc07cf81c9299e20f8d59db9088a165ebf9d2.png`.
  - Mock503390: `f196b514912feb94751e5c9c887fd1b6bdfbd3da.png`.
  - Mock long branch360: `59df08ec30f8c80385f9b72e8adb7db2ee6cbb6a.png`.
  - Real company390: `d502a9d3208e51d488ada182f8e5b22060d09080.png`.
  - Real branch390: `3080b2c49110229663023162b40df4aad7dded8f.png`.
- Locale limit: `WorkspaceLayout.tsx:56` fixes `locale` to `th`; existing XC-02 in
  `e2e/cross-cutting.spec.ts` is fixme because no workspace language control exists.
  Unit assertions use both real Thai/English dictionaries and case-normalized containment;
  browser evidence is Thai only, not English workspace/voice-control/device acceptance.
- `next-env.d.ts` was regenerated by Next dev, restored via apply_patch to its original
  route-types import, and has no diff. `git diff --check` passes. No backend, schema,
  package, feature, provider or shared-service change; no API suite claim for this UI slice.
- Frozen base/HEAD remains `d8d9808e41d15360810ed67e9169ade0cd5605ab`. Source SHA256:
  - `WorkspaceScope.tsx`: `06ccfe77acbaedaae2f1c14d727574970f4a5138522cbf3002a530307baf5091`.
  - `web-core-workspace.spec.ts`: `f770ddbf6444fa624b3946f096ed2ab2329c6bfc3d7268c66c7ea1fd9f714aca`.
  - `e2e/responsive.spec.ts`: `69dfe160d466a8198006f0abcf440edfc7370a0b045da77c9dc99f4870e2a1cc`.

### Reopened many-options boundary

- Independent reviewer `/root/phase6_lock_design` found the fixed popups use
  `overflow-hidden` without max-height;44px options cross mobile viewport sooner than
  the previous36px options. The branch caller requests100, company list is unbounded.
  This was a source/CSS finding; actual rendered red is required before claiming proof.
- Root approved geometry-only synthetic long-list responses at360×740/390×844. Preserve
  original real IDs and rows, add clearly labelled synthetic rows to20 companies/100
  branches, move a valid original option to the end, and never click a synthetic ID.
  No backend membership/permission, API contract or selection-policy change is implied.
- Rendered red: **0/4 passed** at360×740/390×844, all fail full-popup bounds. Top76px;
  20 company options bottom966px/height890px;100 branches+all bottom4530px/height4454px.
  Both had `overflowY:hidden` and clientHeight=scrollHeight, so no bounded internal
  scrolling. HTML `test-results/p24-scope-long-list-red-report/index.html`, JSON
  `test-results/p24-scope-long-list-red.json`, traces `test-results/p24-scope-long-list-red/`.
  These synthetic high-count cases establish the current overflow, not a rendered
  old36px-vs-new44px threshold comparison; the threshold was reviewer source analysis.
- After this red, root approved only two popup class changes:
  `max-h-[calc(100dvh-var(--app-header-h)-1rem)]` plus `overflow-y-auto` instead of
  `overflow-hidden`. Existing header is68px; mobile top76px leaves8px bottom clearance,
  desktop top64px also fits. Preserve position/width/padding and all handlers. Add the
  same long-list assertions at1280×900 and select original options with keyboard Enter.

### Final many-options correction and refreeze

- Added the two max-height/vertical-scroll classes only. Static regression was75/76
  before CSS (both popup bounds missing), then focused89/89 passed. The6 focused long-list
  cases passed on Chromium at360×740/390×844/1280×900,8.294s. Added no-horizontal-overflow
  assertion while still scrolled/open before the final combined run.
- Final `pnpm --filter @watchdog-bms/web test`: **1140/1140 passed,zero skipped**,6.186s;
  web `tsc --noEmit`, strict E2E TypeScript and `git diff --check` passed. No `next typegen`
  during dev; no generated `next-env.d.ts` diff, package/API/schema or shared-service change.
- Final combined **61/61 passed,zero skipped/unexpected/flaky**,88.055s, started
  2026-08-27T05:46:45.613Z.44 P24-2b cases (including12 long-list cases) plus16 existing
  P24-2a cases across both projects, and one real BSC-03. Earlier44/49 stages are retained
  as historical evidence, not substituted for this result.
- Final measured popup bottoms:732px in740px viewport;836px in844px;879.5px in900px.
  All have `overflowY:auto`, scrollHeight greater than clientHeight, actual scrollTop>0
  before last-option hit-test. Keyboard modality is established with Tab before focus;
  Enter closes the current-company option and selects the real last branch with200
  dashboard read. Synthetic IDs are never selected or sent to a mutation API.
- HTML `test-results/p24-scope-long-list-final-report/index.html`; JSON
  `test-results/p24-scope-long-list-final.json`; artifacts
  `test-results/p24-scope-long-list-final/`.62 screenshot attachments (16 real,46 explicitly
  mocked UI) and12 geometry JSON attachments. All are local gitignored artifacts.
- Viewed final-run scrolled company360 and branch360/390/1280 PNGs: last original option
  and focus ring are visible within the viewport. Selected final-run PNGs under
  `test-results/p24-scope-long-list-final-report/data/`:
  - Real company390: `be8e76df06a21597dccc23195163693b2e3ce789.png`.
  - Real branch390: `1f989da6d7d7eb93b7538def6b87af988e3072a8.png`.
  - Mock503360/390: `830bc07cf81c9299e20f8d59db9088a165ebf9d2.png` /
    `f196b514912feb94751e5c9c887fd1b6bdfbd3da.png` (fresh run, bytes match prior stage).
  - Mock20-company360 scrolled: `638d5b8eee3742e88ddd7742b25ee42f2549204b.png`.
  - Mock100-branch360 scrolled: `2ea5381bd453e45269f540bdb9b92a45df1f1be6.png`.
  - Mock100-branch390 scrolled: `b7ce57b174c00fa12a3c0e2c6e395bb323f8f4ee.png`.
  - Mock100-branch1280 scrolled: `c34aed2d0a4729771465af88bec39b4c7ee0c024.png`.
- Independent `/root/phase6_lock_design` source-only follow-up: NO new blocker; reversing
  just the two approved popup class replacements reconstructs prior06ccfe77 source hash.
  Reviewed68px header offsets, padding for2px ring+2px offset and unchanged wrap/width/
  handlers. Reviewer did not run browser/tests; this is not manual/CI acceptance.
- Final source SHA256 (base/HEAD still `d8d9808e41d15360810ed67e9169ade0cd5605ab`):
  - `WorkspaceScope.tsx`: `9181d1970c85a844a049e9137a9a642302b4389bbb703eece1812af326ce242f`.
  - `web-core-workspace.spec.ts`: `af5842b12be54596dabbc94f41694cbb7f5875cdb87f028c7aacfdf0a65c8c91`.
  - `e2e/responsive.spec.ts`: `0a48de63f775ed018f52cd70e465c21b2482da4fb8aa285aff825935da057978`.
  Root reports develop now `d8f1a8536145beb24118dff901f18a4b92b08583`; this agent has not
  fast-forwarded/rebased while tests ran. Root owns post-freeze integration/checks.

### Root review and integration — 2026-08-27

- Reviewed the complete production/test diff and bounded spec/plan, including the
  independent many-options finding and its two-class correction. Root independently
  read the final JSON:61 expected,0 skipped/unexpected/flaky, no report errors; reran
  the focused registered unit command above:89/89,0 skipped.
- Repeated the final-source real Chrome journey at native1126×796: keyboard opens/closes
  menus, all actual targets44px, branch selection updates dashboard scope, company
  switch updates route/header/main and leaves no stale old-company navigation links.
  Restored original company/all branches; error-level browser logs empty on real paths.
  [Eight selected images and evidence limits](../evidence/p24-scope-selector-targets/README.md)
  include baseline, recaptured final desktop and byte-identical final-run mobile PNGs.
  Root visually inspected them; mocked503 and synthetic long-list cases remain labelled.
- After agent freeze, fetched develop and fast-forwarded `d8d9808e→d8f1a853`.
  All17 incoming AI/docs paths were disjoint from15 owned source/test/docs/image files;
  SHA256 checks proved all15 byte-identical immediately after integration. No stash,
  reset, primary checkout edit, DB/bootstrap or API service replacement.
- Post-integration web typecheck, strict E2E TypeScript and diff checks passed.
  Production hash remains `9181d1970c85a844a049e9137a9a642302b4389bbb703eece1812af326ce242f`.
  Incoming changes touch no frontend or dependency file;61 E2E/1140 web results retain
  their stated exact frontend source and original local API baseline, not a new backend run.
- Docs checkpoint PR291 is already merged at `d8f1a853`, exact headbd88a14e /
  CI33043341836 SUCCESS (docs-only runtime jobs skipped as designed). That result does
  not replace this UI phase's own forthcoming CI.

### Reproduce local checks (no service bootstrap)

- Own web retained as exec session49397 on127.0.0.1:3004. Command uses an environment
  allowlist, not an inherited `.env`:

```sh
env -i PATH="$PATH" APP_ENV=local NODE_ENV=development HOST=127.0.0.1 PORT=3004 \
  WEB_BASE_URL=http://127.0.0.1:3004 INTERNAL_API_URL=http://127.0.0.1:3003 \
  NEXT_PUBLIC_API_URL=http://127.0.0.1:3003/v1 NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3003/v1 \
  NEXT_PUBLIC_AI_GATEWAY_BASE_URL=http://127.0.0.1:1 EMAIL_PROVIDER=disabled \
  AI_PROVIDER=disabled MODEL_PROVIDER=disabled NEXT_TELEMETRY_DISABLED=1 \
  pnpm --filter @watchdog-bms/web dev
```

- `/tmp/p24-scope-selector-targets.playwright.config.ts` imports the repo config and only
  sets absolute `testDir` plus `webServer: undefined`. This prevents the normal config
  from booting/replacing root-owned API or web services if a health check fails; it is
  not a new test harness or committed repo config. Exact combined command:

```sh
env -i PATH="$PATH" API_PORT=3003 WEB_PORT=3004 \
  E2E_WEB_BASE_URL=http://127.0.0.1:3004 E2E_API_BASE_URL=http://127.0.0.1:3003/v1 \
  NEXT_TELEMETRY_DISABLED=1 \
  PLAYWRIGHT_HTML_OUTPUT_DIR="$PWD/test-results/p24-scope-long-list-final-report" \
  PLAYWRIGHT_JSON_OUTPUT_NAME="$PWD/test-results/p24-scope-long-list-final.json" \
  pnpm exec playwright test --config=/tmp/p24-scope-selector-targets.playwright.config.ts \
  e2e/responsive.spec.ts e2e/branch-scope.spec.ts --project=chromium --project=mobile-chromium \
  --grep 'P24-2[ab]|BSC-03' --workers=1 --reporter=list,html,json \
  --output=test-results/p24-scope-long-list-final
```

The baseline uses the same local config with project `chromium` and grep
`P24-2b.*(1280px — real|390px — mocked long|390px — mocked lookup)`; its report/output
names are `p24-scope-baseline`. BSC-03 uses `e2e/branch-scope.spec.ts --grep BSC-03`.
The long-list red/focused runs use the same local config, only `e2e/responsive.spec.ts`,
project `chromium`, grep `P24-2b.*synthetic long`, with `p24-scope-long-list-red` /
`p24-scope-long-list-focused` report/output names respectively. Red ran before adding
desktop1280; final command above includes all six long-list cases in both projects.

## Open questions

No open policy question: root approved the bounded mobile retry label. No new
retry/permission behavior is proposed. Full P24 and actual physical-device/40+ acceptance remain outside this slice;
root owns those decisions and manual evidence.

## Next

Root delivers the accepted scoped source and eight images through its own phase PR and
exact-head CI. Keep web3004/session49397 and API3003 available; do not stage generated
reports or auth-bearing traces. Broader P24/physical40+ and other active owner gates remain.
