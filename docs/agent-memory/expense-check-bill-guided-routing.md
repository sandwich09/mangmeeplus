# Agent Memory: Expense Check-bill Guided Routing

Status: Core Web + API + LINE implementation and low-confidence mobile hardening complete; submitted to `develop` through PR #228
Owner: Owner request 2026-08-24; scope expanded to include LINE on 2026-08-25
Scope: Shared contract, atomic API preparation route, web guided route, LINE guided route, focused tests, local browser verification, and `develop` integration. No UAT/Production deploy.
Decisions:
- Reject a check bill early as a receipt, not as proof that the real expense never happened.
- Use plain Thai and one question at a time for a low-digital-confidence mobile user.
- Open the web review directly on the recovery card, disable forward progress, and hide the unsupported inline prepare form.
- Keep the API fail closed; do not use finance override to bypass raw check-bill eligibility.
- Remove the temporary new-draft/cancel-old workaround. Reuse the same web expense; on LINE create the single expense only after an explicit paid/no-final-receipt answer.
- Add a distinct `ROUTED_TO_SUBSTITUTE_RECEIPT` resolution; do not misuse finance override.
- Commit that resolution only in the same transaction that creates prepared evidence. A failed prepare leaves the expense as a blocked check bill.
- Do not auto-cancel: no replacement expense is created.
- LINE check bills remain in pending media and do not create an expense on upload. The reply must explain that a total due without receipt number/paid wording/payment method does not prove settlement.
- Permit raw `ORDER_OR_CHECK_BILL` in substitute preparation only with a current valid route resolution and every existing evidence/tax/policy rule.
- Keep all other raw ineligible document kinds blocked.
- Retire the inline pre-prepare form; the dedicated wizard becomes canonical.
- Return stable codes for all known substitute eligibility failures.
- No dependency or schema migration is planned.
- At 390 × 844, the check-bill recovery question owns the screen: generic sticky navigation is suppressed and destructive actions remain secondary.
- LINE keeps numbered fallback but adds tappable choices; the paid continuation confirms one draft and asks one next question instead of dumping every blocker.
- Wizard prerequisite repair stacks vertically on mobile; the essential tax warning stays visible and secondary detail is disclosed on demand.
Open questions:
- None blocking implementation.
Artifacts:
- `docs/specs/expense-check-bill-guided-routing-spec.md`
- `docs/plans/expense-check-bill-guided-routing-plan.md`
- `docs/agent-memory/expense-check-bill-guided-routing.md`
Verification:
- Source docs and current code flow inspected.
- Existing focused tests before planning: web substitute/error suites 50/50 pass; API expense/substitute suites 82/82 pass.
- Documentation verification: `git diff --check` passed; headings, key contract names, cross-links, and UX copy reviewed.
- Focused web model/error regression suite passed (111 tests), including blocked check-bill routing and inline-preparation visibility.
- Focused API expense/substitute regression suite passed (107 tests), including malformed/foreign route fail-closed behavior and atomic resolution persistence.
- Focused LINE continuation/webhook regression suites passed, including Quick Reply `1/2/3`, compact paid continuation, and zero expense creation before the user's answer.
- Contracts build, API typecheck, and Web `next typegen && tsc --noEmit` passed.
- Local API/web ran at `127.0.0.1:3021` and `127.0.0.1:3020` against local-only seeded data.
- Browser QA verified: recovery card is visible immediately on open; `ถัดไป` is disabled; the plain-language blocker is rendered; paid/no-receipt opens `/expenses/substitute-receipts/new?expenseId=cmt2xhhkc017th0k1wc4n060s&route=check-bill`; the wizard selects that same expense and exposes its remaining category blocker.
- Current captures: `/tmp/mangmeeplus-check-bill-web-current-card.png`, `/tmp/mangmeeplus-check-bill-web-current-paid.png`, and `/tmp/mangmeeplus-check-bill-web-current-wizard.png`.
- `git diff --check` passed. Local API/Web services were stopped after capture.
- Low-confidence mobile audit found: recovery content covered by sticky footer, stale footer copy after selection, duplicated navigation, horizontally compressed wizard prerequisite copy, and overly long text-only LINE continuation.
- Mobile hardening browser QA at 390 × 844 passed with `scrollWidth = 390`: the heading, payment question, and all three answers are visible in the first viewport; no full-width sticky bottom action bar exists.
- Paid/unpaid states show only relevant recovery actions; finance override and document/tax/category fields are collapsed under clearly labelled finance disclosures.
- Wizard prerequisite title, full-width repair action, and return hint are visible in the first viewport without compressed text; the repair link returns to a discoverable category control.
- The essential `not a tax invoice / no input VAT` warning remains visible; the longer lost-document/WHT limits open through a native disclosure and the explicit acknowledgement remains required.
- Final mobile captures: `/tmp/mangmeeplus-check-bill-mobile-fixed-initial.png`, `/tmp/mangmeeplus-check-bill-mobile-fixed-paid.png`, `/tmp/mangmeeplus-check-bill-mobile-fixed-unpaid.png`, `/tmp/mangmeeplus-check-bill-mobile-fixed-wizard.png`, and `/tmp/mangmeeplus-check-bill-mobile-fixed-wizard-tax.png`.
- Post-hardening verification passed: API and Web typechecks, LINE webhook/continuation suites, Web expense model (55 tests), Web i18n (4 tests), and `git diff --check`.
- Desktop regression QA at 1280 px found and fixed one normal-expense UI regression: a browser-default `Details` summary appeared because the normal path rendered an open `<details>` without `<summary>`. The normal path now renders a `<div>` while the check-bill path keeps its collapsed accounting disclosure.
- Post-fix desktop QA passed for both paths: no horizontal overflow, the normal document/tax/category controls remain aligned in three columns with no stray disclosure label, and the check-bill guidance plus collapsed accountant controls remain intact. Browser console errors: 0.
- Desktop captures: `/tmp/mangmeeplus-normal-expense-desktop-fixed.png` and `/tmp/mangmeeplus-check-bill-desktop-fixed.png`.
- PR CI exposed one missing Web translation for `check_bill_route_ineligible`; the actionable Thai mapping was added and the focused API-error coverage/message suites passed (37/37).
- Local API/Web services were stopped after capture; the temporary browser viewport was reset.
Next:
- PR #228 is the integration artifact for `develop`.
- Retain no UAT/Production deployment or Production data mutation unless explicitly requested.
