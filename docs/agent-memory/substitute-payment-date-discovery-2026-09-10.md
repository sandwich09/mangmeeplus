# Agent Memory: substitute payment date discovery

Status: Revised layout complete and verified locally: original expense-date field restored; certificate editing moved to primary actions. No new merge or deploy.
Owner: Codex
Scope: Expense review date section and existing substitute editor entry point. No deploy/merge in this follow-up.
Decisions:
- User rejected the side-by-side date section as mixing distinct meanings. Restore the original expense-date field and remove the payment-date section/slot added in this follow-up.
- Put a visible, touch-sized “แก้ไขใบแทนใบเสร็จ” button in the persistent primary-action area for editable linked certificates. Payment-date changes remain in the existing certificate editor.
- Reuse the existing save-before-navigation handler, permissions, financial lock, month confirmation and immutable document number. No financial/date synchronization changes.
- Preserve unrelated in-progress signing/navigation edits in this worktree.
Open questions: None.
Artifacts: ExpenseReviewPage.tsx. ExpensesPages.tsx restored to HEAD after confirming its only local edits were the rejected date group/slot.
Verification (previous layout, superseded; fresh verification below):
- Web typecheck passed: /tmp/substitute-date-discovery-types.log.
- Existing focused review/form/number-policy checks: 47 passed, 0 failed: /tmp/substitute-date-discovery-checks.log. Includes month/year change and same-month rules.
- Actual local API/browser on a separately created, test-owned expense: desktop adjacent dates; mobile stacked dates without horizontal overflow; one visible edit button >=44px; source save -> same editor; same-month no popup; month confirmation cancel/Escape retain other inputs and do not write; final save preserves ID/number, updates canonical date; PDF download; source roundtrip; no page errors. /tmp/substitute-date-discovery-browser.log and /tmp/substitute-date-discovery-browser-results.json.
- Separate day-only save: Aug14 -> Aug17 updates certificate and source payment-date display, no popup, same number; expenseDate/paidAt/paidAmount unchanged. /tmp/substitute-date-discovery-day-only.log.
- Simulated GET variants using local API shape: no linked evidence, issued, superseded, missing date. Correct date/button/guidance state, zero writes/errors. /tmp/substitute-date-discovery-states.log.
- Visually inspected /tmp/substitute-date-discovery-synthetic-mobile.png and /tmp/substitute-date-discovery-dialog-mobile.png. Existing global button CSS overrides ordinary min-height utilities; reused repository ! utility convention to guarantee a 44px tap target.
- Test-owned fixture cleaned up using /tmp/substitute-date-discovery-fixture.cjs cleanup. User's expense was only read, not edited.
- git diff --check passed. Unrelated signing/navigation/i18n working changes remain untouched. Browser script selectors follow the concurrently changed “ถัดไป” label; fresh mobile navigation used to avoid a dev viewport/hot-reload transition artifact.
Verification (final revised layout):
- Web typecheck passed (/tmp/substitute-footer-types.log); focused review/form/policy suite 47 passed (/tmp/substitute-footer-checks.log); git diff --check passed.
- Actual local source -> certificate browser flow passed (/tmp/substitute-footer-browser.log, script /tmp/substitute-footer-browser.cjs). Persistent 44px CTA is beside Next on mobile/desktop. No payment-date panel in source. Source expense date Aug14 -> Sep7 had no payment-month popup and persisted before editor navigation; purpose synchronized; certificate payment date, document number, paidAt and paidAmount stayed unchanged. Certificate payment month change still prompts; cancel does not persist. Simulated 409 on source save retains unsaved inputs and stays in source with an alert.
- Read-only GET variants passed (/tmp/substitute-footer-states.log): no certificate -> no edit CTA; ISSUED/SUPERSEDED -> view action retained, no edit CTA. No writes in these variants.
- Visually inspected /tmp/substitute-footer-desktop.png and /tmp/substitute-footer-mobile.png. Existing expense-date field/layout restored; the mobile edit/Next buttons share one row.
- Local test-owned fixture cleaned after final run. No user record modifications, no backend/financial-rule changes. Unrelated worktree edits preserved.
Next: User can refresh the running local expense page and review this placement. No merge/deploy performed.
