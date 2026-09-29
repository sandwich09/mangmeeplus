# Agent Memory: account-email-stepper-2026-09-29

Status: Complete locally; no deployment performed.
Owner: Codex.
Scope: Make the shared account email editor easier to follow by showing one step at a time in profile and account security.
Decisions:
- Journey: email → identity confirmation and OTP request → OTP confirmation. Show progress, Next and Back controls; preserve the address when navigating back.
- Returning from OTP to edit the address cancels the existing challenge through the current API first. A failed cancellation stays on OTP. The current verified email remains unchanged until confirmation succeeds.
- Keep existing password/LINE reauthentication, revision/idempotency, resend limits and server errors. No API, permission, database, dependency or deployment change.
- Reuse the shared panel and existing browser suite. Preserve concurrent unrelated working-tree changes.
Open questions: None.
Artifacts:
- `apps/web/src/features/auth/AccountEmailOtpPanel.tsx`; existing profile QA/browser and OTP smoke coverage updated for step navigation.
- Spec §5.3 and plan P5 updated; no package.json or dependency changes.
- Local preview harness and screenshots: `/tmp/account-email-stepper-qa/`. It bundles the actual component and app styles; only the network and authentication fixture are simulated.
Verification:
- `cd apps/web && pnpm exec tsx --test src/features/company-profile/CompanyProfilePage.qa.spec.ts`: 30 passed, 0 failed. Initial outdated first-step password assertion was moved to the identity step.
- `cd apps/web && pnpm exec tsc --noEmit --incremental false`: passed.
- `pnpm exec playwright test e2e/account-email-otp-ux.spec.ts --project=chromium --workers=1`: could not reach the form; all six cases in that initial run stopped at the existing local customer-access CLOSED response (503 during dev-login). No service/gate configuration was changed.
- `pnpm exec playwright test --config=/tmp/account-email-stepper-qa/playwright.config.cjs`: same browser scenarios against the isolated real component, 7 passed, 0 failed. Covers 1280/390/320px, invalid/same email, step focus, back/draft retention, duplicate-submit guard, OTP errors/success, cancellation failure/success, LINE return, request failures/rate limit and expired reauthentication on resend. Initial cancellation assertion was corrected to the existing standardized 503 message.
- Visually inspected desktop/mobile screenshots, including 320px navigation wrapping with no horizontal overflow. `git diff --check` passed.
- Full authenticated page integration, actual LINE/mail providers and backend OTP smoke were not run successfully in this environment; the component browser results do not imply those passed.
Next: Ready for source review. Re-run the existing authenticated browser suite when the local test environment is available; no UAT/Production release is claimed.

## Interactive preview requested

- Opened `http://127.0.0.1:19329/` in the Codex browser and kept the tab open for the user. `/tmp/account-email-stepper-qa/run.cjs` serves the actual component/styles with local in-memory email/LINE/OTP responses; sends no email and changes no account. Demo OTP: `012345`.
- Preview server remains running for review (exec session `85471`). Screenshot: `/tmp/account-email-stepper-qa/live-preview.png`. User interaction had reached step 2 when verified. No application source changes in this follow-up.

## Identity layout feedback

- Simplified the password label to “รหัสผ่านปัจจุบัน”; placed a centered “หรือ” divider before a full-width LINE verification button. Reused the same layout for pending-code reauthentication and the email login-method editor.
- Moved “ปิดการแก้ไข” from below the navigation to a 44px close icon at the top right of the card, retaining the accessible name and existing clearing/busy behavior.
- Rebuilt the running preview and restored step 2 with the user's draft address. Visually checked the live browser; screenshot `/tmp/account-email-stepper-qa/identity-layout-updated.png`. Profile QA 30/30 and web TypeScript passed; `git diff --check` passed. No authentication or API changes.

## Source delivery preparation

- User authorized merging this change into develop and main. Prepared isolated managed worktree `account-email-steps`, based on origin/develop `3d7b4d6c`; root checkout and unrelated work remain untouched.
- Preserved upstream LINE in-app-browser recovery, required email marker and the new account/billing recipient copy and rules. Updated the existing LINE source assertions to accept the shared divider wrapper; browser selectors use the accessible textbox name, ignoring the visual required marker.
- Integrated validation: full web suite **2,204 passed, 0 failed/skipped** (`/tmp/account-email-stepper-qa/integrated-web-tests-final.log`), web TypeScript passed, and seven isolated Chromium journeys passed at 1280/390/320px. Fixed three busy-state accessibility gaps reported by the full suite before delivery. Native auth/page integration remains subject to PR CI; no real mail/LINE provider or deployment was invoked.
- Create one narrowly scoped PR per target branch; do not merge the unrelated develop/main history. Required CI and merge IDs are pending.
