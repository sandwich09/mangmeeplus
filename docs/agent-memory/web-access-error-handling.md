# Agent Memory: web-access-error-handling

Status: DEPLOYED AND PRODUCTION-SMOKED 2026-07-13
Owner: Codex harness (acceptance); Claude Opus 4.8 (API writer/reviewer)
Scope: Password login company selection, unscoped access resolution, company access-denied UX, branded 404/runtime error pages, stable login error codes, tests, docs.

Decisions:
- `ACTIVE` membership is insufficient when its company is inactive. Login and default/unscoped resolution require both states active.
- Valid credentials without usable company access fail with `company_access_unavailable` before token issuance.
- Password reset uses the same gate before mutation/token issuance; Opus found and Codex closed this sibling path during independent review.
- Company-route 403 is intentionally generic for non-enumeration: inactive company, removed membership, and unavailable branch scope share one safe access page.
- 403 is not 404. True missing routes use branded 404; runtime/auth outages use retryable branded error UI.
- Error pages reuse Mangmee logo, brand green/gold tokens, current fonts, card and button patterns; no dependency or parallel design system.
- Next error boundaries cannot theme responses produced before Next.js (edge/ALB/web task unavailable).
- The combined production proxy falls back from an API JSON 404 to the branded Next.js 404 only for GET/HEAD browser navigations accepting HTML; API clients retain the JSON contract.
- The 404 action continues through `/login`: its server-side session gate sends authenticated users to their stored/default home and renders login for signed-out users.

Open questions:
- None.

Artifacts:
- Plan: `docs/plans/web-access-error-handling-plan.md`
- API: `apps/api/src/modules/auth/application/use-cases/password-login.use-case.ts`, `apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts`
- Web: `apps/web/app/error.tsx`, `apps/web/app/not-found.tsx`, company layout/not-found, `CompanyAccessUnavailable.tsx`, `BrandedState.tsx`, login BFF/error-code mapping.
- Tests: auth endpoints, password-reset confirmation, permission resolver, shared API error, localized error message.

Verification (2026-07-13):
- Focused API auth/access/reset tests: **40 passed, 0 failed**.
- Full web suite: **265 passed, 0 failed** across 76 suites.
- API typecheck: clean. Web typecheck: clean.
- Web production build with Node 22.14.0: compiled successfully. Sandbox-only builds hung while Next/font/Turbopack lacked network; the network-enabled build completed in 8.6 seconds.
- `git diff --check`: clean before final evidence update; rerun before commit.
- Browser visual QA against the production build: branded root 404 rendered with Mangmee logo, green/gold tokens, Thai copy and working home link at desktop and 390x844; mobile `scrollWidth === clientWidth` (no horizontal overflow).
- Independent Claude Opus 4.8 review: no P0; found password-reset token issuance P1 and smaller recovery/error-surface P2 gaps. Codex closed the P1 and added available-company recovery, bilingual system denial, one root 404, global root error, and state barrel export.
- Production ECS rollout: commit `3d6e7593`, image `ecs-api-web-3d6e7593` (digest `sha256:9a1c334dab974071d8c0a38e63c50d808e22a3da5ab5425aef1804594f94371b`), service revision `3400032038980636516`, deployment `ngCgezW8ctBGFncHTLtOE` finished `SUCCESSFUL` at 15:19:55 Asia/Bangkok. Circuit breaker and rollback alarm both `MONITORING_COMPLETE`, failure count 0, no triggered alarms.
- Production smoke: `/v1/health` returned HTTP 200 with DB `ok`; `/login` returned HTTP 200; unknown route returned HTTP 404 with branded Thai title/action in the HTML; a cookie-less protected company route returned one HTTP 307 to the exact encoded `/login?next=...` target.
- Disabled/revoked-company rendering was not forced against production data because safely reproducing it requires changing real membership/company state. Its API query/no-token behavior is covered by focused tests and the production image passed rollout monitoring.

Verification (2026-07-18):
- `node --test infra/prod-app-runner/web-api-proxy.spec.mjs`: **1 passed, 0 failed**; exercised the real proxy against mock API/Web servers for HTML GET fallback and preserved JSON, mutation, and non-404 responses.
- Focused login/session landing tests: **16 passed, 0 failed**; authenticated users resolve to their stored/default home while signed-out users remain on login.
- `node --check infra/prod-app-runner/web-api-proxy.mjs` and `git diff --check`: clean.

Next:
1. No remaining action for this scope.
