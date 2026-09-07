# Signup UI lane evidence

Date: 2026-09-07 (Asia/Bangkok)

Scope: API-served LIFF signup page/script, system signup review UI, Thai signup error mappings, and signup browser journeys.

## Focused checks

1. `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/auth/line-liff-signup.spec.ts`
   - PASS: 61 tests, 10 suites, 0 failures.
2. `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/system-signup-requests/signup-queue.logic.spec.ts src/features/system-signup-requests/SignupRowActions.spec.ts src/features/system-signup-requests/SignupQueuePage.qa.spec.ts src/common/api/api-error-message.spec.ts`
   - PASS: 104 tests, 14 suites, 0 failures.
3. `corepack pnpm --filter @watchdog-bms/web typecheck`
   - PASS: Next route generation and `tsc --noEmit`.
4. `corepack pnpm --filter @watchdog-bms/api typecheck`
   - PASS: `tsc --noEmit`.
5. `corepack pnpm exec playwright test e2e/line-signup-contact-email.spec.ts e2e/system-admin.spec.ts e2e/system-support-resolution.spec.ts --list`
   - PASS: 14 project-expanded tests discovered; this checks the Playwright TypeScript/config surface without starting a second server set.

## Final combined browser run

Root ran the scoped cases from `e2e/line-signup-contact-email.spec.ts`, `e2e/system-admin.spec.ts`, and `e2e/system-support-resolution.spec.ts` on API port 3169 and web port 3069 with the isolated task PostgreSQL/Redis services.

- PASS: 9/9 Chromium tests in 10.6 seconds.
- Log: `output/line-signup-recovery-20260907/browser-ux-final.log`
- Final support mobile rerun after the long-message assertions: PASS 2/2 in 29.9 seconds.
- Support rerun log: `output/line-signup-recovery-20260907/browser-support-final.log`
- Screenshot artifacts:
  - `./signup-contact-email-390.png`
  - `./signup-contact-email-1280.png`
  - `./signup-duplicate-email-pending-390.png`
  - `./signup-completed-390.png`
  - `./signup-completed-reopen-add-shop-390.png`
  - `./support-no-company-claimed-390.png`
  - `./support-no-company-resolved-390.png`

The browser cases use the real API-served signup HTML, external CSP script loading, and real page JavaScript. They mock only the LINE SDK/identity and public signup boundary. Covered outcomes: field retention, POST `COMPLETED`, reopen without an unintended new request, explicit `ADD_SHOP` with a fresh submission id, and proof-bound intake retry after browser storage is cleared.

The system admin cases use the actual web frontend, API, and PostgreSQL task database. They cover owner permission denial and `REQUEST_INFO` persistence with the complete note and version, including the linked no-company support case assigned to the deciding admin. Cleanup removes that support case and its request-scoped outbox row before the signup fixture. The support cases seed and clean a no-company request, verify full multiline original and latest messages without hover, 44px actions, no mobile overflow, claim assignment, explicit resolution, closed-state persistence, owner API/UI denial, and mobile screenshots. They deliberately do not call the real LINE Messaging API; the API PostgreSQL suite owns that delivery boundary.

The completed and post-add-shop LIFF screenshots are both 390×844. Browser assertions verify that collapsing the long form resets `scrollY` to zero and returns document height to the viewport instead of retaining a blank scroll canvas. Public status cards render no internal request ID or backend diagnostic. The completed card gives `เริ่มใช้งาน` the primary action and keeps `เปิดร้านเพิ่ม` secondary.
