# Agent Memory: Web number input spinners

Status: Implemented and visually verified on local; no deploy.
Owner: /root
Scope: User reiterated that native number-input arrows must be removed throughout the application after finding them in substitute receipt quantity/unit-price fields.

Decisions:
- Root search found no global number-spinner suppression in this checkout. Root app/layout.tsx imports globals.css, so one unscoped input[type="number"] rule applies to every web route, plain control and modal.
- Added appearance:textfield with Firefox fallback and WebKit inner/outer spin-button suppression in apps/web/app/globals.css. Preserve type=number, keyboard input, min/max/step, decimal handling, permissions and monetary behavior. No JavaScript handlers, dependency or package.json changes.
- Added the shared appearance rule to docs/guidelines/web-frontend-code-style.md to prevent feature-local workarounds.

Open questions: None for this local visual fix.

Artifacts:
- apps/web/app/globals.css
- docs/guidelines/web-frontend-code-style.md
- This memory.

Verification:
- Source inventory found numeric input declarations across 19 source files; no previous spinner-hiding rules elsewhere in the repo. No claim that every route was manually opened.
- CUA initially reproduced arrows despite the edited source: browser CSSOM and generated CSS both lacked the new rule. A plain dev-server restart still served stale CSS. Stopped the local web process, retained its Turbopack cache at /var/folders/vc/hbfllfl96mn49byp8f0q_cpr0000gn/T/substitute-number-css-cache-jkbjnfv5/turbopack, then restarted with a fresh cache. New compiled CSS and browser computed styles contain appearance:textfield.
- Actual focused-field screenshots: substitute receipt quantity/unit price have no arrows; 2 × 100.1234 remains editable, native validity true, min/step 0.0001 retained.
- Second route /companies/seed-local-company/expenses/manual: quantity, unit price, discount and service-charge fields all compute appearance:textfield; focused price field has no arrows. No draft saved or submitted.
- Browser verification used the in-app browser. Firefox/Safari rules are included, but separate browser engines were not run.
- Scoped git diff --check passed. CSS-only change; no TypeScript/API tests needed. Generated next-env.d.ts restored after dev restart.

Next:
- User can refresh local to review. Web remains at 127.0.0.1:3000, API remains at 127.0.0.1:3001. Web runner /tmp/substitute-local-run.py web, latest log /tmp/substitute-spinner-local-web.log, exec session 88326.
- No deployment requested; changes remain in working tree with prior authorized receipt work and unrelated existing docs preserved.
