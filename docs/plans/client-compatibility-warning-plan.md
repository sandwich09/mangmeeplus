# Generic Client Compatibility Notice Implementation Plan

Status: IMPLEMENTED - PR #193 open; UAT/real-device validation pending
Date: 2026-08-20

## Linked Spec

- `docs/specs/client-compatibility-warning-spec.md`
- Related: `docs/specs/user-facing-error-message-safety-spec.md`
- Related: `docs/plans/web-access-error-handling-plan.md`
- Guideline: `docs/guidelines/web-frontend-code-style.md`
- Release protocol: `docs/runbooks/uat-production-v2-deployment.md`

## Purpose

Replace indefinite unsupported-client/session loading with one generic, actionable notice. Internal
version rules still decide whether an environment is blocked, but the user never sees a case label,
device/version diagnosis, Legacy banner, or different journey for Safari, Android, LINE, LIFF, or
session timeout.

## Implementation Result

Implemented on `codex/generic-client-compatibility-notice` with the planned behavior and no new
dependency. Ponytail review collapsed the proposed model/constants split into one pure
`client-support.logic.ts`; this keeps the public three-state contract and thresholds together
without speculative files. No E2E package-script change was needed: the live route was verified
through the browser at iPhone 7 and 320px widths, while explicit user-agent/header boundaries are
covered at proxy and classifier level.

Local automated verification is complete. UAT, a real iPhone/LINE LIFF smoke, 200% zoom, release
promotion, and Production deployment remain release-stage work and are not claimed by this plan.

## Current Repository Context

- `apps/web/proxy.ts` already runs before page auth, creates the CSP nonce, applies security headers,
  and distinguishes page/API paths.
- `apps/web/src/common/auth/proxy.spec.ts` covers page redirects, CSP, API behavior, and CSRF.
- `apps/web/app/login/page.tsx` server-renders `LoginPage`.
- `apps/web/src/features/auth/LoginPage.tsx` now leaves `auth.login.checking_session` for every
  refresh outcome and reuses `GenericClientNotice` for unavailable/timeout outcomes.
- `apps/web/src/features/auth/auth.api.ts` owns the bounded 10-second typed refresh outcome, while
  retaining a boolean compatibility wrapper for existing mutation retries.
- `apps/web/src/common/i18n/workspace-dictionary.ts` owns Thai/English copy.
- `apps/api/src/common/security/liff-page.security.ts` owns the external same-origin script reused by
  account, employee, and customer LIFF pages.
- Existing LIFF tests assert no inline script, strict CSP, escaping, and token validation.
- Current browser automation covers Chromium and Pixel 7 emulation, not real-device certification.

## Implementation Rules

- Use the smallest correct diff and existing proxy/state/i18n patterns.
- Implement exactly one customer-facing compatibility notice and action set.
- Do not add a Legacy warning/banner, modal, toast, or case-specific copy.
- Do not display hardware, OS, browser, LINE version, internal reason, or raw user agent.
- Use a dependency-free pure classifier with only `SUPPORTED`, `UNSUPPORTED`, and `UNKNOWN`.
- Block only a positively unsupported signal; `UNKNOWN` must continue.
- Gate HTML navigation only. User agent is never an auth/security/permission decision.
- Make the hard notice useful in initial server HTML without hydration.
- Keep LIFF script-src strict and do not add inline executable script.
- Preserve auth cookies on refresh timeout/unavailability.
- Do not edit `package.json` or add a dependency.
- Do not deploy until the mandatory UAT/Production protocol is followed.

## Scope

### In Scope

- Internal web and LIFF minimum-version constants.
- Pure three-state compatibility classification.
- Pre-auth proxy redirect for positively unsupported HTML navigation.
- Server-rendered generic compatibility route/state.
- Ten-second login session-recovery timeout reusing the same generic state.
- Generic below-minimum notice in account, employee, and customer LIFF pages.
- Thai/English copy, accessibility, security headers, cache policy, tests, and UAT checklist.

### Out of Scope

- Case-specific or Legacy UI.
- Browser polyfills or a lower Next.js target.
- Device-model detection.
- Native LINE notification before link open.
- LINE Login to ERP.
- Database, API DTO, permission, audit, AI Gateway, worker, or infrastructure changes.
- Redesign of login, toast, maintenance, legal pages, or the LIFF linking journey.
- Production deployment during implementation.

## Expected File Boundary

The implementer must re-check current repository state before editing. Intended files are:

### Web

- `apps/web/src/common/client-support/client-support.logic.ts`
- `apps/web/src/common/client-support/client-support.logic.spec.ts`
- `apps/web/src/common/client-support/GenericClientNotice.tsx`
- `apps/web/app/unsupported-browser/page.tsx`
- `apps/web/proxy.ts`
- `apps/web/src/common/auth/proxy.spec.ts`
- `apps/web/src/features/auth/auth.api.ts`
- `apps/web/src/features/auth/auth.api.spec.ts`
- `apps/web/src/features/auth/LoginPage.tsx`
- `apps/web/src/common/i18n/workspace-dictionary.ts`
- Live browser/curl verification plus focused proxy/classifier/session specs

### API/LIFF

- `apps/api/src/common/security/liff-page.security.ts`
- `apps/api/src/modules/auth/presentation/auth.controller.ts`
- `apps/api/src/modules/auth/presentation/auth.controller.spec.ts`
- `apps/api/src/modules/crm-inbox/presentation/http/customer-line-register.controller.ts`
- `apps/api/src/modules/crm-inbox/presentation/http/customer-line-register.controller.spec.ts`

No root layout banner, `package.json`, migration, shared DTO, or deploy workflow change is expected.

## Phase 0: Reconfirm Baseline and Worktree Safety

### Goal

Confirm support thresholds, file boundaries, and unrelated work before implementation.

### Tasks

- [x] Read the linked spec, error-safety spec, and web guideline; defer the release runbook until an
  actual UAT/Production action is requested.
- [x] Confirm Next.js/browser and LINE/LIFF minimums from official current documentation.
- [x] Inspect `git status`; preserve the existing untracked `output/` PDF and unrelated user work.
- [x] Confirm no concurrent overlap in proxy, login, dictionaries, or LIFF files.
- [x] Reconfirm that no internal minimum changed after implementation started.

### Exit Criteria

- Internal thresholds and generic customer copy are unambiguous.
- No unresolved worktree overlap remains.

## Phase 1: Pure Internal Classifier

### Goal

Create deterministic, dependency-free classification shared by web server/client tests without
creating customer-visible case distinctions.

### Tasks

- [x] Define `SUPPORTED`, `UNSUPPORTED`, and `UNKNOWN`.
- [x] Define named internal constants for iOS/iPadOS 16.4, Android 10,
  Chrome/Edge/Firefox 111, Safari 16.4, and LIFF vendor minimums.
- [x] Parse iOS/iPadOS before browser branding.
- [x] Parse Edge/Chrome/Firefox tokens and desktop Safari through `Version/x.y`.
- [x] Recognize Android and LINE context without hardware inference.
- [x] Return `UNKNOWN` for missing, malformed, bot, and ambiguous user agents.
- [x] Keep classification functions pure, total, and non-throwing.
- [x] Do not expose a reason string to customer presentation.

### Tests

- [x] Boundary cases immediately below and at every internal minimum.
- [x] iOS browser branding still resolves by iOS/WebKit version.
- [x] Missing, malformed, bot, custom, and ambiguous signals return `UNKNOWN`.

### Exit Criteria

- Tests prove positive block and conservative fail-open behavior.
- No React, DOM, request, or customer-copy dependency exists in classifier logic.

## Phase 2: Generic Pre-hydration Web Notice

### Goal

Show the one generic notice before auth/session work when the browser is positively unsupported.

### Tasks

- [x] Gate only `GET`/`HEAD` HTML navigation in `proxy.ts` after CSP creation and before auth-cookie
  routing.
- [x] Exempt API, assets, `/unsupported-browser`, maintenance, privacy, terms, data deletion, and
  legal releases.
- [x] Redirect without raw UA/internal reason; carry only a same-origin relative path and sanitize it
  again before rendering retry.
- [x] Preserve existing security headers and add private/no-store plus noindex behavior.
- [x] Add a thin server route and shared `GenericClientNotice` whose complete Thai/English content
  renders without client JavaScript.
- [x] Provide only `ลองใหม่` and `ติดต่อเจ้าหน้าที่`, plus alternate-device guidance.
- [x] Do not provide “continue anyway”, version details, Legacy state, modal, toast, or banner.

### Tests

- [x] Unsupported navigation redirects before auth presence checks.
- [x] Supported/unknown navigation preserves existing auth behavior.
- [x] Route exemptions and compatibility route cannot loop.
- [x] API/assets/non-HTML/unsafe methods are unchanged.
- [x] Security headers and private/no-store remain present.
- [x] Server HTML contains only the canonical generic diagnosis/actions and works with JavaScript
  disabled.

### Exit Criteria

- A below-minimum client sees the generic initial HTML and makes no refresh request.
- A supported/unknown client sees no compatibility UI.

## Phase 3: Bounded Session Recovery Using the Same State

### Goal

Remove the endless spinner without introducing a second error journey.

### Tasks

- [x] Replace boolean refresh collapse with typed internal outcomes: `restored`, `signed_out`,
  `unavailable`, and `timeout`.
- [x] Add a 10-second `AbortController` timer and clear it in every path.
- [x] Keep success redirect behavior and treat only real 401 as signed out.
- [x] Treat 5xx, non-401 failures, network failure, and abort as unavailable/timeout without clearing
  cookies.
- [x] Exit checking state for every outcome.
- [x] For unavailable/timeout, render the same `GenericClientNotice`; do not add a timeout/network
  title or separate copy.
- [x] Keep retry and normal sign-in available as appropriate.
- [x] Keep the change-password boolean compatibility caller from converting unavailable refresh into successful
  recovery.

### Tests

- [x] Refresh success, 401, 5xx, network rejection, timeout, and timer cleanup.
- [x] Every outcome exits the spinner.
- [x] Unavailable/timeout reuse the canonical generic copy and preserve cookies.
- [x] Real 401 retains normal signed-out behavior.

### Exit Criteria

- No settled client/network outcome leaves `checkingSession=true` indefinitely.
- Users see no separate session/network compatibility case.

## Phase 4: Generic LIFF Notice

### Goal

Use the same customer copy below the LIFF vendor minimum while leaving supported/unknown LIFF
journeys unchanged.

### Tasks

- [x] Add one shared generic notice target/markup pattern to account, employee, and customer LIFF
  HTML responses.
- [x] Extend the existing external same-origin `LIFF_PAGE_SCRIPT` to check available vendor-minimum
  signals before action.
- [x] Positively below minimum: disable link/register and show the canonical generic copy.
- [x] Supported/unknown: continue existing flow with no Legacy banner or compatibility message.
- [x] Keep notice text in trusted static markup; do not interpolate untrusted data into script.
- [x] Preserve CSP, same-origin API base, token validation, consent, rate limiting, and escaping.

### Tests

- [x] All three pages contain the same notice target and approved external script tags only.
- [x] Below-minimum signals disable the action and render canonical generic copy.
- [x] Supported/unknown signals continue without a warning.
- [x] Existing H-08 XSS/CSP, DTO, token, consent, and rate-limit tests remain green.

### Exit Criteria

- Main web, login fallback, and LIFF present the same message without weakening LIFF security.

## Phase 5: Integration and Browser Verification

### Goal

Prove the single journey from early routing through timeout and LIFF.

### Tasks

- [x] Add focused Playwright coverage with explicit user-agent contexts.
- [x] Assert a below-minimum context sees generic copy and no refresh request.
- [x] Assert a supported context reaches login and has no warning/banner.
- [x] Make `/api/auth/refresh` unavailable and assert spinner exit into the same generic state.
- [x] Verify the notice title and both actions exist in raw server HTML without JavaScript.
- [x] Check 320px width with no horizontal overflow.
- [ ] Check 200% zoom during UAT accessibility smoke.
- [x] Verify visible DOM contains no model/version, `Legacy`, raw UA, case label, alternate warning,
  modal, or compatibility toast.
- [ ] Manually smoke a supported and below-minimum main-web environment and one LIFF environment in
  UAT.

### Commands

```bash
corepack pnpm --filter @watchdog-bms/web test
corepack pnpm --filter @watchdog-bms/web typecheck
corepack pnpm --filter @watchdog-bms/web build
corepack pnpm --filter @watchdog-bms/api exec tsx --test \
  src/modules/auth/presentation/auth.controller.spec.ts \
  src/modules/crm-inbox/presentation/http/customer-line-register.controller.spec.ts
corepack pnpm exec playwright test e2e/client-support.spec.ts
git diff --check
```

If coverage is added to `e2e/login.spec.ts`, run that file instead. Do not edit a package script only
to register a test.

### Exit Criteria

- Focused unit, typecheck, build, API, and browser checks pass.
- Visual inspection confirms one generic journey, no indefinite spinner, and no hydration dependency
  for the hard notice.
- Unrun real-device checks are recorded and block a certification claim.

## Phase 6: Documentation and Release Readiness

### Tasks

- [x] Update `docs/agent-memory/client-compatibility-warning.md` with exact files and results.
- [x] Mark the spec implemented after local acceptance criteria pass, while retaining UAT limits.
- [x] Keep the generated PDF as communication material, not product source of truth.
- [ ] Before UAT/Production, re-read `docs/runbooks/uat-production-v2-deployment.md` and record exact
  UAT, READY, and Production run IDs.
- [ ] Do not call Production complete until signed result and customer `OPEN` acceptance both pass.

### Exit Criteria

- Docs/code/release status agree, and remaining real-device limitations are explicit.

## Integration Verification Checklist

- [x] One canonical title/body/action set across web hard notice, login fallback, and LIFF.
- [x] Supported/unknown clients have no compatibility UI.
- [x] No Legacy banner, modal, toast, detected version, or case-specific copy exists.
- [x] Proxy ordering preserves auth behavior while unsupported navigation avoids session work.
- [x] Session timeout is bounded and non-destructive.
- [x] LIFF security controls remain unchanged.
- [x] Legal/privacy/maintenance/API/assets continue normally.
- [ ] Server HTML, accessibility roles, mobile width, zoom, and retry/contact actions are verified
  locally except 200% zoom, which remains a UAT accessibility check.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| False block from ambiguous UA | Block only positive old versions; unknown continues |
| Generic copy hides useful support detail | Keep internal thresholds/tests; Support asks for OS/LINE version separately |
| Shared-cache poisoning | Private/no-store compatibility response |
| Redirect loop/open redirect | Exempt route and sanitize same-origin return path twice |
| CSP regression | Server HTML hard notice and existing external LIFF script only |
| Timeout destroys valid session | Abort client wait only; clear cookies only on real 401 |
| Multiple UX variants reappear | DOM/source tests assert canonical copy and absence of banners/case labels |
| Support overclaim | Separate internal framework/vendor compatibility from real-device QA evidence |

## Open Questions

None blocking. A future request for case-specific guidance requires an explicit product decision and
spec update; it must not be added ad hoc during implementation.
