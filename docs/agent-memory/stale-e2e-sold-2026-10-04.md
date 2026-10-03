# Agent Memory: stale-e2e-sold-2026-10-04

## Status
Done 2026-10-04 on branch `claude/stale-e2e-sold-20261004` (from develop `930a7cc32`, not pushed; the controller pushes). Every test that
failed in the five sold-scope Playwright files now passes for a stated reason; each file passed three whole-file runs
in a row on a fresh local stack (results under Verification).

## Owner
Claude lane for the controller; the controller pushes and opens the PR.

## Scope
`e2e/billing-advance-deal.spec.ts`, `e2e/billing-preview.spec.ts`, `e2e/plan-term-billing-readiness.spec.ts`,
`e2e/profile-completeness-card.spec.ts`, `e2e/billing-admin-menu-ux.spec.ts`: for each failing test, stale test vs
product bug vs environment, and the fix. Out of scope: other e2e files, cloud, real Stripe/LINE.

## Decisions
Per test (red = develop behaviour, fix commit in brackets):
- billing-advance-deal, both modes (timed out at the checkout button): **product bug**. The quote clock (d51d23ed8)
  armed `setTimeout` with the whole time left; a browser runs any delay above 2^31-1 ms (about 24.8 days) at once, so a
  quote valid that long showed "ราคานี้หมดอายุแล้ว" instead of the checkout button. The mocked quote expires in 2030.
  Real quotes live 10 minutes, so only a device clock more than 24.8 days behind the server meets it, but then the shop
  can never pay. Clamped like the page's other deadline timers (BillingPage deadline refresh, WorkspaceLayout term end)
  with a QA source pin [d691016f2].
- billing-preview, 1280 and 390 ("เลือกแพ็กเกจใหม่" not found): **stale**. The preview's 'pending' scenario is a return
  whose Checkout attempt is still open; since 9217e6227 that page waits for the provider with no new choice, resume or
  cancel (pinned in BillingPage.qa.spec.ts). The test asserts that waiting state now; the one-tap new choice is still
  driven by billing-no-setup.spec.ts [291d21dbd].
- profile-completeness-card [ea6200da5], all **stale**:
  - completion card 390/1280: the registered-name hint, part of the textbox name, changed in 6f7451735.
  - "a LINE owner corrects an unverified account email…": b89652eed made the OTP panel the only account-email writer
    (spec signup-optional-email-otp-billing §6: the direct endpoint answers EMAIL_OTP_REQUIRED; QA spec "has no direct
    or link writer"). Renamed and kept what still exists: the unverified address in the OTP panel and a backup password
    without a username from the "รหัสผ่านสำรอง" section, with no email command sent.
  - PROFILE-FOCUS 1280/390: 14df7093c added the aria-hidden " *" to the "อีเมลที่ต้องการยืนยัน" label, so an exact
    `getByLabel` no longer matches; the test uses the accessible name, as account-email-otp-ux.spec.ts does.
- plan-term-billing-readiness [db6b8f55b]:
  - BR01 (**stale**): the branch list renders a table and a card list below md (630b6cae0), so the new name matched
    twice (strict mode); asserts the table cell.
  - BR14 (**stale**): since 02b7a15bd nothing business-shaped mounts before the plan-term notice answers, so with A's
    notice held the page is only "กำลังเปิดหน้า…" and has no company switcher. The owner reaches B by address (the
    switcher is a full document navigation too); the RG05 invariant (A's late notice never changes B, back/refresh keep
    the selected company) is unchanged.
  - BR16 (**stale**): same aria-hidden required mark as PROFILE-FOCUS.
  - BC03 and GW02/GW04 (**needs environment**): the API must run with `LINE_WEB_HANDOFF_ENABLED=true` and a synthetic
    `LINE_LIFF_ID`, as `docs/evidence/stripe-line-web-gap-2026-09-11/README.md` runs it; otherwise the exchange answers a
    bare 403 and the handoff lands on `/login?line=handoff-expired`. Found on the way: the three passing "GW04 handoff
    rechecks …" tests passed on that same bare 403 without any recheck; they now also assert that the refusal names
    the token's target (red with the handoff off, green with it on). Recorded in `e2e/HANDOFF.md`.
- billing-admin-menu-ux [3d5e0149a]: **needs environment** plus one **stale** count. It needs a database named
  `mangmee_ux` and a synthetic `STRIPE_ACCOUNT_ID` (e2e/HANDOFF.md), and the API also needs `BILLING_MODE=test`
  (billing-admin.service lists issues and settings only when billing is not disabled); HANDOFF said that mode mattered
  only for the directory suite, corrected. With that, the route sweep's page-count tripwire was 37 against 39: 57d90305d
  added the two recipient-change pages, which the sweep visits and passes. No Stripe call is possible: without
  `STRIPE_SECRET_KEY` the client refuses before any network request.

No migration, package.json, paid-invoice.ts or billing-schedule.ts change; API untouched.

## Open questions
- Noticed, not changed (wording/state, outside this brief): after a backup password is set on the profile page, the
  OTP panel keeps its earlier `hasPassword` and still says "…ให้ตั้งชื่อผู้ใช้และรหัสผ่านสำรองในหน้าบัญชีของฉัน", which
  also names a username the page no longer asks for when the account has an email.
- `plan-term-billing-readiness` and `billing-admin-menu-ux` run in no GitHub workflow; they stay manual with the env above.

## Artifacts
- Product: `apps/web/src/features/billing/BillingPage.tsx` (one line), `apps/web/src/features/billing/BillingPage.qa.spec.ts`.
- Tests: the five e2e files above; `e2e/HANDOFF.md` (environment of the two manual suites).
- Lane scratch (not in git): stack scripts, logs and probes under the session scratchpad `stalee2e/`.

## Verification
Local throwaway stack only (own PostgreSQL/Redis/MinIO containers, API and `next dev` on free ports, web with no `S3_*`
variable, a fresh migrate + seed before each file). Red runs reproduced every failure listed in the brief at the same
step. Final: each file three whole-file runs in a row after one fresh stack, head `3d5e0149a`, all rc 0:
- billing-advance-deal 2/2 ×3; billing-preview 2/2 ×3; profile-completeness-card 5/5 ×3 (default environment).
- plan-term-billing-readiness 33/33 ×3 (API with `LINE_WEB_HANDOFF_ENABLED=true LINE_LIFF_ID=1234567890-test
  MODEL_PROVIDER=disabled`).
- billing-admin-menu-ux 12/12 ×3 (database `mangmee_ux`, `STRIPE_ACCOUNT_ID=acct_TESTONLYLOCAL`, API `BILLING_MODE=test`).
- `BillingPage.qa.spec.ts`: 5/6 before the clamp, 6/6 after. GW04 with the targetPath assertion: 3 failed with the
  handoff off, 3 passed with it on.
- Web typecheck rc 0; whole web suite rc 0 (2791/2791, no `S3_*`); `git diff --check 930a7cc32..HEAD` rc 0. API not
  touched, so no API typecheck.

## Next
Controller: review, push, PR. Run the two manual suites with the environment in e2e/HANDOFF.md when touching
`/system/billing/*`, the LINE handoff or the plan-term shell.
