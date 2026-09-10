# Agent Memory: Substitute receipt hub actions

Status: implemented and verified; ready for local user review. Feature remains local, not pushed or merged.
Owner: Codex
Scope: Themed ellipsis action menu, state-aware print/view, cancellation with reason and double confirmation. This checkpoint also includes canonical expense entry and permission-card overflow fixes documented separately.
Decisions:
- Follow docs/specs/substitute-receipt-hub-actions-spec.md. Reuse current authorization, PDF rendering and supersede rules; no financial reversal, schema or cloud change.
- Keep assigned certifiers/approvers able to continue their existing task. Cancellation remains permission/state/revision checked on the server.
- Use retained artifacts and checksum checks for signed/history previews. Missing history returns a localized error; do not fabricate it from the current expense.
- Portal keyboard focus waits for visible placement. PDF download decodes its data URL into a Blob without a CSP-blocked fetch. All page images must load before printing; object URLs are revoked on close.
Open questions: none.
Artifacts: hub menu, read-only preview, two cancellation dialogs; state-aware PDF read path and list canCancel flag; scan-only PDF composition/stamps; six state tests added to the existing download test file; existing hub lifecycle test updated.
Verification:
- API and web typecheck passed on the final current-develop-based tree; logs /tmp/hub-final-api-types.log and /tmp/hub-final-web-types.log. Final API build passed (/tmp/hub-final-api-build.log).
- Earlier focused PDF/download/use-case check: 81/81 passed. No additional full local suite was run after the owner's CI-only instruction.
- Browser: /tmp/hub-actions-browser.cjs passed desktop/tablet/mobile menu, keyboard/outside/Escape, all seven preview/history cases, two-page printing, both confirmation exits and focus restoration, stale response handling and one cancellation request after both confirmations. All business writes were mocked. Result: /tmp/hub-actions-browser.log.
- Visual review: /tmp/hub-menu-390.png, /tmp/hub-preview-review.png, /tmp/hub-double-confirm.png and /tmp/hub-AWAITING-APPROVAL.jpg. Browser print output /tmp/hub-browser-two-page.pdf contains exactly two pages. Scratch fixtures are synthetic layout data, not issued business documents.
- Entry and role layout browser checks passed on this same tree; see companion memory.
- Local web http://127.0.0.1:3000 and API http://127.0.0.1:3001 now run this isolated worktree using /tmp/receipt-hub-local-run.py and the existing local review database. API health returned 200. Original workspace's unrelated dirty files are preserved.
Next: user reviews local. Continue from /tmp/mangmee-receipt-three-fixes-20260910, branch codex/substitute-hub-actions-20260910. Do not confuse this local feature checkpoint with the four already merged fixes.

## Separate merged delivery and CI follow-up

Four requested fixes merged through PRs 506/507: yellow AI warning, receipt removal, step-back/source synchronization with re-signing under the same number, and new numbering by payment year/month. Commit d9212aa38eb7fc0256add2d8f448105d7656318b.
Automatic runs 34442624025 and 34442634870 failed the runner-registration guard, not a receipt assertion. Minimal correction fc2838c4cb691033f41595c0d43587f10377d33c registered the removal unit test and signing synchronization PostgreSQL suite without changing package.json.
PR 510 merged develop at cb8cdd0f796331b93ffb6ee767a0b823516ff796; PR 511 merged main at 118b7e5dabb91945165f1c20aa853a67f2e348ed. Automatic follow-up CI 34444027917 and 34444266394 was still running at handoff. No manual duplicate run or deployment dispatched.

User's OCR question: read-only investigation of S__35209253.jpg (expense cmtv3d3ul000mhsk1vzkowmdu) found expense.ocr.request audit status not_configured, errorCode AI_GATEWAY_SECRET_MISSING, recognizedFieldCount 0. Local runner omits AI Gateway credentials; no OCR result was applied. No cloud/config/expense mutation performed.
