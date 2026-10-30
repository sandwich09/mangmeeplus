# New-shop welcome and package advisor: local verification

Date: 2026-10-30, Asia/Bangkok
Scope: [spec](../../specs/new-shop-welcome-package-advisor-spec-th.md), [plan](../../plans/new-shop-welcome-package-advisor-plan-th.md)
Outcome: implemented and locally verified. No real LINE messages, customer mutations, cloud operations or deployment.

## Product and implementation

- The welcome replaces the existing signup completion notification for newly created LINE shops only. An atomic creation audit binds both welcome version and originating signup request. Recovering that same request retains delivery; another request adopting the same company does not qualify.
- Existing event key, outbox and LINE retry key handle repeat delivery. Current owner, identity, company context, free policy, receipt permissions and remaining allowance are checked before composing the welcome.
- Three choices: send a receipt in the system OA, open the four-question LIFF advisor, or contact the separate support OA. Used/in-flight/exhausted allowances do not promise a fresh set of three receipts.
- The public form reads the real catalog contract. Only monthly AVAILABLE offers covering people, receipt volume and the chosen feature are eligible. Workflow affects the explanation, not price. Unknown volume is explicitly provisional; over-capacity or unavailable offers lead to support without an invented price.
- Catalog is refreshed before results, before billing and after a company picker. Changed price/limits/tax/offer require another review. Explicit billing navigation reuses token verification, live memberships and tenant-scoped handoff; no purchase occurs in the form.
- The approved mascot asset is copied unchanged; no dependencies or package.json changes. Shared LIFF CSP and existing pages remain in their existing shell.

## Automated evidence

| Check | Result |
| --- | --- |
| Signup notify, provision, onboarding, receipt webhook and menu regression | 555 tests / 69 suites passed |
| Registered LIFF signup + imported advisor client, free expense handoff, shared contrast/start, token handoff and destination logic | 152 tests / 27 suites passed |
| Full API TypeScript, 8 GB heap | Passed, no diagnostics |
| SWC security-source build with `--copy-files`, then load compiled mascot/page and parse client JS | Passed; PNG bytes present and embedded |
| `git diff --check` | Passed |
| Repository spec-registration guard | Fails on 10 pre-existing orphan specs listed below; no new advisor orphan |

Commands (from repository root unless stated):

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/external-signup/application/line-signup-notify.service.spec.ts \
  src/modules/external-signup/application/provision-signup.use-case.spec.ts \
  src/modules/system-onboarding/application/use-cases/create-company-onboarding.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/line-ai/domain/logic/line-staff-menu.logic.spec.ts

pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/auth/line-liff-signup.spec.ts \
  src/modules/auth/free-expense-handoff.spec.ts \
  src/common/security/liff-page-contrast.spec.ts \
  src/common/security/liff-start-handoff.spec.ts \
  src/modules/auth/line-handoff.spec.ts \
  src/modules/auth/domain/logic/line-handoff.logic.spec.ts

NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @watchdog-bms/api exec tsc --noEmit --pretty false
# From apps/api, matching its existing build's asset-copy mode:
pnpm exec swc src/common/security -d /tmp/mangmee-advisor-build --strip-leading-paths --copy-files -q
git diff --check
```

The advisor checks live in `line-package-advisor.check.ts` and are imported by the already-registered `line-liff-signup.spec.ts`; package scripts were not changed. Initial full typecheck exhausted the default Node heap; the 8 GB run completed. Initial fixture duplicate-property diagnostics were fixed before final verification.

The registration guard's existing orphan files, relative to `apps/api/src/`:

- `modules/auth/free-expense-handoff.spec.ts`
- `modules/auth/free-expense-password-login.spec.ts`
- `modules/billing/application/billing-deal-chat-credit.spec.ts`
- `modules/billing/application/billing-deal-subscription-cancel.spec.ts`
- `modules/billing/application/billing-plan-manage.spec.ts`
- `modules/data-model-core/application/use-cases/free-expense-attachment.spec.ts`
- `modules/expenses/application/use-cases/expense-free-access.use-case.spec.ts`
- `modules/line-ai/domain/logic/free-expense-line.logic.spec.ts`
- `modules/system-partner-management/application/free-expense-access.spec.ts`
- `scripts/cleanup-archived-local-files.spec.ts`

These existed in the dirty checkout; this task does not rewrite unrelated runners. The touched free-expense handoff test was explicitly run above.

## Browser evidence

Used the actual exported page, shared shell, CSP and client via a loopback HTTP harness. Catalog fixtures were built with canonical `billingOffer()` and explicit local availability/tax; these are not a readback of deployed prices or billing readiness. No authenticated provider call, external support contact or payment was performed.

- 390 px: completed all four questions; 3–5 people, 31–50 receipts, expense gathering and spreadsheet workflow produced BASIC with canonical 499 THB/month, 5 people/50 receipts. The first snapshot included an agent-selected VAT fixture; the correction below supersedes that wording.
- 320 px: edited answers, selected unknown volume and obtained a provisional STARTER recommendation; no horizontal overflow. Over 30 people produced no offer and a support option.
- 1280 px: result centered in the existing shell; no horizontal overflow.
- Closed-sales fixture: no buy recommendation after assessment. HTTP 503 fixture: warm error and usable retry/support controls, no fallback price.
- Arrow-key selection initially revealed an HTMLCollection/Array mismatch absent from the VM mock. Fixed the real client and strengthened the regression. Actual browser now preserves focus, selected value and selection through next/back.
- Unit tests additionally execute the real client for stale prices, malformed/expired catalog, different goals, blocked handoff origins, company selection and the current system OA URL format.

Temporary browser tab was closed, viewport override reset, and loopback server stopped after verification.

Screenshots: [question, mobile](question-mobile.jpg), [result, mobile](result-mobile.jpg), [result, desktop](result-desktop.jpg), [catalog error](catalog-error-mobile.jpg).

## Native LINE and release boundary

Native LINE primary/secondary redirects, consent, actual push acceptance, device camera/close behavior and deployed billing handoff still need UAT device acceptance. No claim of live delivery or production readiness is made from browser fixtures. Before any release, follow the repository's mandatory UAT/Production protocol and record its required run IDs and customer acceptance.

Provider checks used the official [LIFF API reference](https://developers.line.biz/en/reference/liff/), [LIFF URL redirect documentation](https://developers.line.biz/en/docs/liff/opening-liff-app/), and [Messaging API action label specification](https://developers.line.biz/en/reference/messaging-api/#action-object-label-spec). They confirm pre-init environment/close support, endpoint subpath routing and the current 40-character Flex button / 20-character quick-reply label limits; real device behavior remains unverified here.

## Owner copy correction after review

- Owner confirmed the company is not VAT registered and asked to remove all VAT mentions from this screen. Removed the tax element, rendering function and styling, and changed local test/preview fixture to NOT_VAT_REGISTERED. No billing policy or calculation was changed.
- Replaced ambiguous spreadsheet-migration wording with “เริ่มจากส่งใบเสร็จสักใบ แล้วตรวจข้อมูลที่มั่งมีอ่านให้ก่อนบันทึกได้เลยค่ะ”. The form does not migrate existing spreadsheets.
- Registered LIFF suite rerun:82 tests /13 suites passed. `git diff --check` passed. Actual browser completed the spreadsheet scenario and verified the new sentence and absence of VAT/tax copy. Mobile/desktop result screenshots above were refreshed from the real rendered page.
- Earlier in-conversation design preview contains neither removed phrase; it required no changes. Temporary test tab/server were closed.

## Owner theme correction

- Replaced seasonal purple with the standard shared LIFF green theme in the advisor and welcome receipt CTA. Updated earlier inline design preview to green as well. No behavior changes or new tests for color-only edits.
- Existing registered LIFF, signup-notify and shared contrast checks:126 tests /22 suites passed. Actual browser completed the4 questions in green with the previous copy corrections retained; question/result screenshots refreshed.


## Owner button correction

- Inline preview: removed every mm-text-button/underline style and reused existing theme buttons. Actual API advisor already has non-underlined button styling.
- Browser: result actions text-decoration:none, visible borders, green text on secondary controls, 47px target height. At320px viewport, preview clientWidth and scrollWidth both288px. Edit answers and support navigation passed. Screenshot: preview-theme-buttons-mobile.jpg.
- Styling-only pass: no new tests; git diff --check passed. Preview server restarted to show current output. No deploy.


## Verification on current main/develop baseline before direct integration

- Base: `994a55fa1` (origin/main and origin/develop). Feature-only port in an isolated worktree; retained newer code in all shared files.
- `pnpm install --offline --frozen-lockfile`, contracts build and Prisma generate passed without manifest/lockfile changes.
- Combined eleven-file regression command from the two original command groups above:1,094 tests /117 suites passed (0 failed, skipped or cancelled).
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @watchdog-bms/api exec tsc --noEmit --pretty false`: passed. `git diff HEAD --check`: passed.
- Current `STAFF_OA_URL` used for both welcome and advisor. New client validation/fallback follows the same exact URL. Shared LIFF client retains its current versioned URL and existing landing/deep-link behavior.
- Browser rerun on integrated source completed all4 questions and rendered the current canonical BASIC fixture with green buttons, revised spreadsheet copy, no VAT, and current staff link. Screenshot: [integrated result](merge-result-desktop.jpg). No real LINE or checkout calls.
- Owner requested direct merge/push without PR. No release workflow or cloud operation was invoked.
