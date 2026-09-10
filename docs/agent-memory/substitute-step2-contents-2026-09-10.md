# Agent Memory: Substitute step 2 contents

Status: Implementation and focused/local verification complete; scoped PR delivery pending.
Owner: Codex
Scope: Returning from substitute receipt step 3 to step 2 must display the saved certificate facts and actual selected supporting/payment files together, with working file previews. Continue scoped develop/main delivery under this task's existing merge/admin authorization.
Decisions:
- Root cause: the prepared-document back button selects the evidence substep, whose read-only renderer showed counts only. The details substep was separate despite both sharing journey step 2.
- Combine saved details and evidence on read-only step 2, reached by either the step indicator or Back. Keep step 1 and return-to-signing navigation; remove the redundant navigation between read-only details/evidence substeps.
- Resolve only IDs selected on this certificate to attachment metadata, show filenames and reuse the existing authenticated attachment preview/lifecycle. Missing metadata is explicitly unavailable; never show unrelated expense attachments or manufacture file contents.
- Keep editable draft/prepared-edit forms, permission/state guards, cancellation view-only behavior and signatures unchanged. Navigating or viewing must not write business data.
- Work from main bfff04f0 (matching the screenshot's newer prepared-edit workflow), then port the same scoped UI change to develop without promoting unrelated branch differences. Original dirty checkout remains preserved.
Open questions: None.
Artifacts: SubstituteReceiptWizardPage.tsx; e2e/substitute-cancelled-view-only.spec.ts.
Verification:
- Focused wizard QA/model/preview checks: 40 passed (`corepack pnpm --filter @watchdog-bms/web exec tsx --test src/features/expenses/SubstituteReceiptWizardPage.qa.spec.ts src/features/expenses/substitute-receipt-wizard.model.spec.ts src/features/expenses/substitute-receipt-preview.spec.ts`).
- `corepack pnpm --filter @watchdog-bms/web typecheck`: passed.
- `WEB_PORT=3021 E2E_WEB_BASE_URL=http://127.0.0.1:3021 corepack pnpm exec playwright test e2e/substitute-cancelled-view-only.spec.ts --project=chromium`: 2 passed. DIGITAL/PAPER at 1440px/390px; step-3 Back and step-2 indicator show saved facts plus selected files; previews open real validated fixture bytes; unrelated files excluded; missing metadata explicit; cancellation/focus refresh remains view-only; zero business writes/client errors. Business responses mocked, local owner auth real.
- Mirrored the exact scoped UI patch into the active local review worktree `/tmp/mangmee-substitute-step3-edit-20260910`, preserving its existing changes. No service restart.
- `node /tmp/substitute-step2-local-browser.cjs`: real local document SRC-202609-00040 shows saved purpose/details and its one payment attachment, opens that attachment through the real API, then returns to signing with zero business writes. Desktop/mobile screenshots `/tmp/substitute-step2-local-00040-{desktop,mobile}.png`; mobile reload has no horizontal overflow.
- Visually inspected mocked desktop/mobile and real local mobile screenshots. `git diff --check` passed.
Next: Verify and merge both scoped branches. No deployment requested.
