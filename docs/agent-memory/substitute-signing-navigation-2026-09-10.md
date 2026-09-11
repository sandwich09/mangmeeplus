# Agent Memory: substitute-signing-navigation

Status: Implemented and verified; ready for branch integration.
Owner: Codex.
Scope: Place substitute-receipt signing navigation after the step content in both DIGITAL and PAPER flows.
Decisions:
- The shared back/edit action row was rendered before the active step content. Move the existing row below that content, before version history, and label it as navigation for accessibility.
- Keep existing permissions, handlers, busy state, source-edit links and signing checks unchanged. Read-only previous-step back/next controls already follow their content.
- Update the paper flow's help text to point to the new location.
- No API, database, financial state, document rendering or package manifest changes.
Open questions: None.
Artifacts: SubstituteReceiptWizardPage.tsx; SubstitutePaperSigningPanel.tsx.
Verification:
- User-facing local port3000 updated with the exact scoped patch in its active worktree; API and data unchanged.
- Chromium against the real local API: DIGITAL and PAPER, desktop1440 and mobile390. Action row follows the step content, no horizontal overflow, back/next/return-to-signing work, edit/discard returns correctly, zero business-write requests and zero page errors. Screenshots inspected.
- Existing focused web suites: 40 passed (preview, wizard QA and wizard model); git diff --check passed.
- Temporary browser script initially used list-item id rather than the contract's evidenceId for paper routing; corrected the test and all four real journeys passed. No application workaround was needed.
- Evidence: /tmp/substitute-signing-navigation-browser.cjs, /tmp/substitute-signing-navigation-results.json, /tmp/substitute-signing-navigation-tests.log, /tmp/substitute-signing-navigation-{DIGITAL,PAPER}-{1440,390}.png.
Next: Integrate under the existing develop/main authorization. Develop currently has the older single back-button row; apply the same placement fix there without pulling in the separately managed step3-edit feature.
