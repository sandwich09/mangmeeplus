# Agent Memory: client-compatibility-warning

Status: IMPLEMENTED / LOCALLY VERIFIED / COMMITTED - push, PR, UAT, and real-device smoke pending
Owner: Codex
Scope: Define one generic customer notice for a positively unsupported main-web/LIFF environment or
a bounded login boot failure, without device/version/case-specific UI.

Decisions:
- Customer UX is one generic state: `ไม่สามารถเปิด Mangmee Plus ได้` plus update, retry,
  alternate-device, and support guidance.
- Do not render a Legacy banner, device/model name, detected OS/browser/LINE version, internal
  reason, compatibility modal, or compatibility toast.
- Internal classification has only `SUPPORTED`, `UNSUPPORTED`, and `UNKNOWN`.
- Main web blocks only positively below-minimum signals before auth/hydration. Unknown signals
  continue normally and see no warning.
- Main-web minimums remain internal: iOS/iPadOS 16.4, Android 10 with current Chrome/WebView,
  Chrome/Edge/Firefox 111, and Safari 16.4.
- Session refresh has a 10-second UI timeout; unavailable/timeout reuses the same generic state and
  preserves cookies. Only real 401 follows signed-out behavior.
- Normal web links opened from LINE use the same main-web journey and generic copy.
- LIFF uses its separate vendor minimum internally. Positively below minimum disables the action and
  shows the same generic copy; supported/unknown continues without a Legacy warning.
- LINE Messaging API cannot provide recipient device/OS/LINE version before link open, so no native
  proactive device-specific warning is possible in scope.
- No dependency, `package.json`, database, permission, audit, API DTO, AI Gateway, worker, or deploy
  change was made.

Open questions:
- None blocking. Case-specific customer guidance requires a future explicit product decision.

Artifacts:
- Spec: `docs/specs/client-compatibility-warning-spec.md`
- Plan: `docs/plans/client-compatibility-warning-plan.md`
- Communication PDF: `output/pdf/mangmeeplus-device-version-support-summary.pdf`
- Web gate/state: `apps/web/proxy.ts`, `apps/web/src/common/client-support/*`,
  `apps/web/app/unsupported-browser/page.tsx`, and dictionary copy.
- Session recovery: `apps/web/src/features/auth/LoginPage.tsx`,
  `apps/web/src/features/auth/auth.api.ts`, and focused specs.
- LIFF gate/state: `apps/api/src/common/security/liff-page.security.ts`, account/employee/customer
  controllers, and their registered specs.

Verification:
- `pnpm --filter @watchdog-bms/web test`: PASS, 982/982.
- Focused web classifier/proxy/session specs: PASS, including iOS/Android/browser boundaries,
  auth-ordering, API/legal/static exemptions, 204/401/500/network/timeout, and timer cleanup.
- The expanded browser-brand matrix found and fixed an Edge precedence bug (`Chrome/111` appearing
  before `Edg/110`); the classifier now resolves Edge, then Firefox, then Chrome.
- Focused registered API controller specs: PASS, 19/19, including iOS 14/15, Android 7/8,
  LINE 13.20.0/13.20.1, unknown fail-open, all LIFF targets, CSP, escaping, DTO, and rate limits.
- `pnpm --filter @watchdog-bms/api test`: PASS (pretest and full registered suite).
- Web and API typecheck: PASS after the required contracts/config builds and non-mutating
  `prisma generate`; generated outputs are ignored and produced no tracked diff.
- Web and API production builds: PASS; Next route table includes dynamic `/unsupported-browser`.
- Live server/curl: old iOS/LINE UA `/login` -> 307 generic notice; `/privacy` and the notice remain
  200; supported iOS 16.4 login remains 200; API POST keeps its existing 401 behavior; notice
  headers are CSP + private/no-store + noindex and canonical copy/actions are in raw server HTML.
- Browser skill QA: generic state visually verified at iPhone 7 size (375x667), retry reaches
  `/login`, unavailable session recovery reuses the same `role=alert` state, supported
  `?recovered=1` shows the normal login with no notice, and 320px has no horizontal overflow.
- `pnpm exec playwright test e2e/client-support.spec.ts --project=chromium`: PASS, 3/3; covers old
  iOS/LINE pre-auth redirect with zero refresh calls, no-JavaScript initial HTML, 320px overflow,
  canonical actions/no technical detail, and supported iOS 16.4 normal login.
- Not run/claimed: 200% zoom, UAT, a physical iPhone/LINE LIFF smoke, real-device certification,
  Production deployment, or customer `OPEN` acceptance.

Next:
- Push the feature branch and open a PR to `develop`; keep `output/` untracked. UAT/Production must
  follow the mandatory release runbook in a separate step.
