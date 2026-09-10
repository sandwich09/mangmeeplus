# Agent Memory: Substitute hub view action

Status: Implementation and focused verification complete; merge pending.
Owner: Codex
Scope: Remove the duplicate Print action from the substitute receipt hub ellipsis menu, leaving View as the document-preview entry point. Continue develop/main delivery from this task; prior explicit admin-merge authorization remains applicable.
Decisions:
- Delete only the duplicate menu item. Keep the existing preview, its real print/download controls, permissions, cancellation and edit actions.
- Use a clean worktree from develop 7b689880; deliver a separate cherry-picked main branch because the branches currently contain different unrelated work.
Open questions: None.
Artifacts: SubstituteReceiptHubPage.tsx; substitute-receipt-hub-actions-spec.md.
Verification:
- `corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/substitute-receipt-hub.model.spec.ts`: 3 passed.
- `node /tmp/substitute-hub-view-browser.cjs`: passed for active/cancelled documents at 1440px and 390px. Menu is exactly Edit/View/Cancel, View opens the document with enabled print/download controls, no business writes or page errors. Document responses mocked; local seeded owner authentication remains real.
- Visually inspected `/tmp/substitute-hub-view-PREPARED-390.png`; menu fits the mobile viewport.
- `git diff --check` passed. Main and develop have identical source for the changed hub and spec files before this fix.
Next: Verify, commit and merge the scoped change into develop and main. No deployment requested.
