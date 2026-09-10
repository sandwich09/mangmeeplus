# Agent Memory: Substitute receipt entry and permission layout

Status: implemented and verified locally; ready for user review. Follow-up is a local checkpoint, not pushed or merged.
Owner: /root
Scope: unify all expense-review substitute receipt entry points with the canonical wizard; fix overflowing role cards in Settings → Permissions.
Decisions:
- New documents reuse the chosen expense, existing data, and check-bill routing. PREPARED/PAYER_CERTIFIED open the existing document; ISSUED opens its document page; SUPERSEDED retains history and allows explicit new preparation when the expense/permissions permit it.
- Remove embedded substitute preparation, signature, approval, cancellation and duplicate preview state from expense review. Their rules, role selection, optional positions, payment effects and DIGITAL/PAPER paths remain owned by the existing wizard/API.
- Preserve expense classification/tax/category review, its save/dirty gate, read access, and attachment controls. Do not turn navigation into a payment, signing, approval or cancellation action.
- Role layout: constrain grid/card/list/button minimum widths, keep long role names inside their card, and retain horizontal scrolling inside the permission table. No permission mutations or changed authorization.
- Browser review also found implicit grid minimum widths in RoleBuilder; fixed its mobile columns and wrapping of capability labels/badges. Kept existing role preview and save APIs.
Open questions: none.
Artifacts:
- Updated `docs/specs/substitute-receipt-paper-signing-spec.md`, expense review/action helper and routing tests, permission matrix and existing RoleBuilder layout.
- Browser scripts/results: `/tmp/permission-layout-check.cjs`, `/tmp/permission-layout-results.json`, `/tmp/expense-entry-check.cjs`, `/tmp/expense-entry-results.json`.
- Screenshots: `/tmp/permission-layout-{1440,1280,768,390}.png`, `/tmp/expense-entry-evidence.png`, `/tmp/expense-entry-mobile.png`.
Verification:
- `pnpm --filter @watchdog-bms/web typecheck` passed (Next route generation + TypeScript).
- `pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/expenses.model.spec.ts src/features/expenses/substitute-receipt-preview.spec.ts src/features/employee-access/IndividualPermissionsPrototypePage.spec.ts`: 86 passed, 0 failed.
- Earlier full web suite on the older original checkout (historical evidence, not the final current-develop tree): 1,677 passed / 1,679. Two existing failures in untouched files: API Thai error-code coverage misses 13 substitute error mappings on this older local branch, and `SubstituteReceiptWizardPage.qa.spec.ts` expects an outdated ISSUED render string. Their tested API/dictionary/wizard sources and tests are unchanged in this follow-up. Do not describe the full suite as green.
- Permission browser check: long CHRO name, all role buttons within their card at 1440/1280/768/390; internal permission-table horizontal scrolling remains reachable; edit/create layouts also checked at 1440/390. Waited for the shell's resize transitions before measuring. Only read-only role preview POST occurred; no role/permission saves.
- Expense browser check: NEW, PAPER_PREPARED, PAPER_UPLOADED, DIGITAL_PREPARED, PAYER_CERTIFIED, ISSUED, SUPERSEDED routes; paper certifier name; cancelled-history/new links; dirty classification blocks navigation until restored; 390px summary card stays within viewport; empty-viewer navigation runs the existing draft-save boundary. Scenario GET responses and draft PATCH responses were mocked over the local fixture; no business writes reached the API, no new expenses/payments/signatures/approvals/cancellations.
- Scoped `git diff --check` passed. No package.json, backend, database, permission rules or financial effects changed.
- Local web on 127.0.0.1:3000 and API on 127.0.0.1:3001 restarted with `/tmp/substitute-local-run.py`, explicit local-only environment and existing review database.
Next: user reviews local expense entry and Settings → Permissions. No new push, merge or deployment performed for this follow-up.

## Final current-develop checkpoint

Final API/web typechecks passed. Current-tree browser checks /tmp/hub-expense-entry-check.cjs and /tmp/hub-permission-layout-check.cjs passed all seven entry states, dirty-review gate, mobile layout, four permission-card widths and edit/create layouts. Read-only totals-preview/role-preview POSTs were allowed; business writes were mocked. Logs: /tmp/hub-expense-entry-browser.log and /tmp/hub-permission-layout-browser.log. No full local suite rerun.
Local 3000/3001 now serves /tmp/mangmee-receipt-three-fixes-20260910 on codex/substitute-hub-actions-20260910 via /tmp/receipt-hub-local-run.py. This preserves current develop rounding/import changes as well as all original-workspace dirty work. The old runner/source path above describes earlier verification only.
