# Main verification after direct merge — 2026-10-28

Source tested: `049aa51dea4e69307f35e3f82adda544141ec5fb`, verified identical on remote main and develop before testing. No PR or deployment. This report supersedes the earlier old-checkout browser evidence for the merged feature.

## Actual Chrome journey

- Real local web3080 + API3081 + current-schema PostgreSQL + MinIO. Fresh disposable synthetic database `free_expense_main_ui_20261028`; previous counters/evidence were not reset.
- Password sign-in for never-paid opened shop lands in expenses. Navigation offers list/upload and authorized billing; no finance/module/export actions.
- Upload PNG1, PNG2, PNG3 individually through the file chooser and send button. First two return source drafts without quota/sales interruption. Third displays the exhausted allowance and next Bangkok-month date.
- Clear first draft unit price, save, reload: unknown stays omitted/null, never zero. Source edits do not rewrite the historical OCR financial row.
- At390×844, edit the third draft after exhaustion, save, then sign in again and reopen it: purpose persists. Open original receipt fullscreen on mobile.
- Fourth PNG is rejected; no fourth provider call, draft, pending attachment or orphan is created.
- Direct manual-expense route shows access denial/back link and resolves back through the free expense boundary; blank creation is unavailable.
- Canonical previously-paid expired shop lands at renewal with expired-package copy. Human-admin-held and no-usable-membership password accounts stay blocked with existing membership/access wording.
- The no-shop password fixture has an existing credential with no usable membership; it is not an anonymous LINE guest test.
- Inspected390,1280,1536 widths; no horizontal page overflow after responsive layout settles. Sample file-open button heights44px mobile/40px desktop recorded in layout-metrics.json. Existing unrelated controls were not restyled.

## Verification

- API root1063 passed; access447 passed; quota301 passed. These are scoped suites, not a claim that every repository test ran.
- Real PostgreSQL22 passed: access6, freequota5, existing paid receipt-add-on ledger11.
- Web484 passed across13 focused files; web TypeScript passed. API TypeScript passed at8GiB before push; no code changes occurred after that check. Config/contracts builds passed.
- DB proof: exactly3 provider calls/documents,3 new draft records,3 active attachments,0 pending uploads,0 additional financial/vendor/paid-grant rows. All new drafts remain unconfirmed. Provider returns deterministic fixtures with no actual model usage.
- Browser console error/warning capture is empty. Transient CDP timeouts recovered through the supported browser API; no app policy or data bypass was used.
- GitHub returned no workflow runs for this commit; no hosted CI success is claimed.

## Scope limits and cleanup

No native LINE/LIFF, PDF/HEIC asynchronous browser path, real OCR/model provider, live migration, UAT or Production deployment was performed in this rerun. Existing automated LINE/worker guards and provider-independent integration tests passed.

Signed out, restored normal viewport, stopped local web/API/OCR and task PostgreSQL/Redis/MinIO services. Synthetic databases/dump and evidence remain available. Restored only Next-generated AGENTS.md/next-env.d.ts changes in the clean verification worktree. Original dirty checkout was never changed by the merge operation.
