# Agent Memory: substitute-navigation-wording

Status: Implemented and verified; ready for develop/main integration.
Owner: Codex.
Scope: Substitute receipt navigation labels and separation of editing actions in DIGITAL/PAPER flows.
Decisions:
- Navigation uses only Back/Next (ย้อนกลับ/ถัดไป). Retain explicit labels for certification, approval and saving edits.
- Place document/source editing and signing-method changes in a separate “จัดการข้อมูล” section above the content; navigation stays after content.
- Reviewing previous steps has one sequential Next button. Preserve the latest combined details/evidence step from PR530/531 and all its file previews.
- Keep permissions, busy states, data writes and signature/approval checks unchanged. Cancelled documents expose no editing section.
- PR528 already moved the main action row. Supersede the older develop-only PR529 with this complete follow-up; do not remove upstream step2 work or its checks.
Open questions: None.
Artifacts: wizard, paper help text, Thai/English labels, existing cancellation/step2 browser checks updated for new labels.
Verification: Real local API on port3000: DIGITAL/PAPER at 1440px/390px; short navigation labels, separate editing section, no overflow, back/next/return and edit/discard, zero business writes or page errors. Existing 40 focused web checks and web typecheck pass. Latest step2/cancelled DIGITAL/PAPER browser suite: 2 passed (11s), including retained file previews, mobile, cancellation-on-focus and no writes. git diff --check passes.
Evidence: /tmp/substitute-signing-wording-browser.cjs; /tmp/substitute-signing-navigation-results.json; /tmp/substitute-signing-wording-{tests,web-types,current-viewonly}.log; /tmp/substitute-management-{DIGITAL,PAPER}-{1440,390}.png.
Next: Merge the complete scoped changes into both branches. Local3000 already has the presentation change; other concurrent work in its checkout is preserved. No deployment.
