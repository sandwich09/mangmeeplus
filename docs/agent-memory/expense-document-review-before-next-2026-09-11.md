# Agent Memory: Expense document review before Next

Status: Follow-up implemented and verified locally; not merged or deployed
Owner: Codex
Scope: Expense review step 2, explicit document/tax review save, persisted acknowledgement, navigation and regression tests.
Decisions:
- Next requires a successful explicit document review for the current receipt and selected document/tax classifications. Generic step-1 saves and OCR do not count.
- Confirm unchanged AI-prefilled values with the same Save review button. NEEDS_REVIEW document/tax selections must be resolved first.
- Save acknowledgement under existing review metadata, with current attachment/extraction and classification values; no migration or dependency.
- Editing the review or changing/re-reading the receipt requires another save. Reloading an unchanged saved review does not.
- Explicitly clearing the optional header category persists null, avoiding an unsaved-state loop. Per-line categories remain independent.
- Confirming an unchanged non-tax document does not rewrite financial lines unless existing Tax Code selections actually need clearing.
- Follow-up supersedes the initial substitute shortcut: hide all new-substitute entry links in the expense review until current review is saved and no review edits are pending. Include empty-viewer and paid check-bill paths. Keep Back, cancellation, upload and existing certificate/history access available.
- Align the three classification labels using equal minimum height, including AI badge and mobile.
- Paid check bills awaiting review get an action that opens/scrolls to the existing classification form instead of creating a certificate.
- Preserve all unrelated local changes, including substitute navigation work. No merge/deploy in this follow-up.
Open questions:
- Asked whether category is mandatory before Next (header or all item categories). Pending; retain existing category requirements unless clarified.
Artifacts:
- docs/specs/expense-document-review-before-next-spec.md
Verification:
- Contracts build passed (`/tmp/expense-review-contracts.log`).
- Web and API typechecks passed (`/tmp/expense-review-web-types.log`, `/tmp/expense-review-api-types.log`).
- Web model/QA suite: 49 passed; API branch/review use-case suite: 42 passed. Logs `/tmp/expense-review-web-tests.log`, `/tmp/expense-review-api-tests.log`.
- Actual local API + Chromium: successful save persisted metadata, failed/conflicting save retained fields and kept Next disabled, unmodified prefilled Save enabled, Next/Back and reload passed. Replaced attachment/extraction identities tested using GET response variants. Initial no-receipt shortcut behavior was superseded by the follow-up below. Mobile 390x844 warning visible and no horizontal overflow. `/tmp/expense-document-review-browser.log`.
- Read-only, issued and confirmed cases covered by focused model tests; API permission/branch/CAS checks covered by use-case tests.
- Visual QA of `/tmp/expense-document-review-required-desktop.png` and `/tmp/expense-document-review-mobile.png` passed.
- Isolated API rebuilt/restarted on localhost:3001 to serve this code. No cloud/config/production data touched.
- Synthetic test fixture cleanup completed using its exact generated expense ID. User records untouched.
- git diff --check passed. Concurrent changes retained; package.json files untouched.
Follow-up verification (2026-09-11):
- All new-substitute links in the expense review are absent before explicit review, after edits, after a failed save and after source identity changes; they appear only after successful current review. Both classification card and empty-viewer paths checked in Chromium.
- Paid check-bill shortcut provides “ตรวจข้อมูลก่อนทำใบแทน” and opens the existing review fields without entering creation. Standalone creation remains unchanged.
- Existing SUPERSEDED certificate top action opens that certificate history instead of silently routing to new creation; verified with a GET response variant.
- Browser logs: `/tmp/expense-review-followup-browser.log`, `/tmp/expense-review-history-browser.log` passed.
- Dropdown top edges align within 1 px at widths 1024/1280/1440/1920, including category AI badge; 390 px mobile has no overflow. `/tmp/expense-review-layout-browser.log` passed.
- Visual checks: `/tmp/expense-review-alignment-desktop.png`, `/tmp/expense-document-review-mobile.png`, `/tmp/expense-review-check-bill-review.png`.
- Web focused suite 49 passed (`/tmp/expense-review-followup-tests.log`), web typecheck passed (`/tmp/expense-review-followup-types.log`), git diff --check passed.
- Synthetic fixture deleted by exact test-owned ID after verification. No user data, merge or deploy.
Next: User can verify locally. Retain existing category requirements pending clarification; combine merge/deploy with the intended batch.

Follow-up: remove duplicate footer reminder (2026-09-11)
- User requested only one save-review instruction beside the form. Removed the repeated footer save reminder; Next remains disabled under the same conditions and its accessible description points to the inline instruction. Other classification/loading warnings remain.
- Verification: desktop 1440 px/mobile 390 px browser check passed: exactly one inline instruction, no duplicate footer reminder, Next remains disabled and aria-describedby resolves to the inline hint. `/tmp/expense-review-single-hint-browser.log`; web typecheck `/tmp/expense-review-single-hint-types.log` passed. Synthetic fixture cleaned up; no merge/deploy.
