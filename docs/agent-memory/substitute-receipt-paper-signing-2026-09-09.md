# Agent Memory: substitute-receipt-paper-signing

Status: implemented and verified locally; awaiting user review. No deployment.
Owner: /root
Scope: signing-method choice after common facts/evidence; blank paper signer fields; upload signed scan and authorized acceptance; company-specific payment wording. Company full / personal advance full only.
Decisions:
- Reuse PAPER, attachment storage, PDF generation and final issue transaction. No new dependencies or reimbursement changes.
- New PAPER has nullable payerUserId and approverUserId. The preparer/uploader/reviewer are authenticated actors; handwritten identities are separately transcribed names, positions and dates. No fabricated account identity or digital signature on behalf of paper signers.
- Frozen paperFormSnapshotJson keeps form facts stable. Submission stays PREPARED and makes no payment. Only acceptance issues the document. Source/version/hash/tenant/branch/authority checks and payment locks remain enforced.
- DIGITAL still requires the actual selected account and its owned signature. Legacy LINE PAPER remains distinguishable by its non-null account payer.
- Same person signing both capacities requires explicit declaration plus existing OWNER_SELF exemption policy. Reviewer attests paper approver authority; the app does not authenticate handwriting or replace the original paper.
- New PDF wording identifies the registered company. Historical stored SVG/scans remain unchanged; derived PDFs may have different creation timestamps, so do not claim byte-identical regenerated PDFs.
- Two additive local migrations applied: 20260909230000_substitute_paper_signing and 20260909231000_substitute_paper_signing_constraints. Existing DB checks required digital account signatures even for PAPER; new checks preserve DIGITAL requirements and enforce the separate paper scan/reviewer conditions.
- Browser QA found data-URL PDF frames blocked and iframe load incorrectly counted as review. Blob PDF works in Chrome but the in-app browser has no working native PDF reader here. Reused existing API pdfjs-dist to render actual composed PDF pages as images; no CSP weakening or dependency addition. Reviewer must open every page and explicitly confirm reading before attesting. Closing alone does not count. Same page viewer supports issued PAPER from wizard and hub; actual PDF remains downloadable.
Open questions: none blocking. Handwritten content and signers' authority require human verification; no OCR/automatic signature-authenticity claim.
Artifacts:
- docs/specs/substitute-receipt-paper-signing-spec.md
- docs/plans/substitute-receipt-paper-signing-plan.md
- Previous dirty diff saved before this scope: /tmp/substitute-before-paper-flow.patch. Preserve unrelated dirty changes.
Verification:
- Prisma generate and both new migration deploys passed against isolated local PostgreSQL (127.0.0.1:15432/substitute_receipt_only_review).
- Contracts build, API SWC build, API typecheck (existing 8 GB setting), and web tsc --noEmit passed. Logs /tmp/substitute-paper-final-{contracts,build,api-types,web-types}.log.
- Broad focused API suite: 310/310 passed, zero skips, including seven real PostgreSQL cases (digital/paper funding, company vs personal, concurrent accept, wrong uploader, cancelled submission, document corrections). /tmp/substitute-paper-final-api-tests.log.
- After PDF viewer follow-up: renderer suite 14/14 passed (includes real three-page rendering with visible ink), usecase suite 46/46 passed. /tmp/substitute-paper-preview-render-tests.log and /tmp/substitute-paper-usecase-final.log.
- Web model/API/preview suites: 56/56 passed, zero skips. /tmp/substitute-paper-web-tests-final.log.
- Issued download/preview suite: 11/11 passed, including read-permission/egress/multi-page checks; /tmp/substitute-paper-issued-preview-tests.log.
- Actual local HTTP/DB/storage smoke: COMPANY accepts exactly one payment of 20; PERSONAL_ADVANCE accepts no payment. Prepare/upload/submit leave payment count zero. Digital missing payer rejected, digital certify-preview for accountless paper rejected, wrong preview hash/acks rejected, repeated submit safe, repeat acceptance does not pay twice. /tmp/substitute-paper-smoke.log, /tmp/substitute-paper-smoke-results.json.
- Actual paper document-only correction issued successfully, retains the original payment IDs and paidAmount=20. /tmp/substitute-paper-correction.log, new evidence cmtuaqvf80003ybk146jntw71.
- Browser CUA: common facts/evidence precede method choice; DIGITAL requires account; PAPER has no account selector; preparation succeeds. In-app scan+attestation pages visibly render, confirm disabled until both pages loaded, close without confirm leaves acknowledgements disabled, reopening resets review, explicit read + three acknowledgements enables acceptance, accepted fixture reaches success screen. Issued PAPER opens with the page image reader from both success screen and hub; user review tab left on unsigned SRC-202609-00014.
- Visual QA of real one-page blank forms and scan+attestation PDFs in /tmp/substitute-paper-*.pdf; new footer and blank certification/name/position/date/signature areas inspected in /tmp/substitute-paper-preview-live-page1.jpg.
- Test records and scans are explicitly simulated LOCAL TEST fixtures, not real signed documents or financial transactions. Original user drafts were not signed by this task.
- Scoped git diff --check passed; no package.json or reimbursement diffs.
Next:
- User can review http://127.0.0.1:3000/companies/seed-local-company/expenses/substitute-receipts.
- Fresh unsigned paper fixture: cmtua58b8002238k1fqmh9woa (SRC-202609-00014), /tmp/substitute-paper-ui-fixture.json.
- Local web port 3000 and API port 3001 remain running. API runner /tmp/substitute-local-run.py, built output dist/substitute-review, log /tmp/substitute-paper-local-api.log. Do not load real .env or touch cloud services for this review.

## Local paper-form presentation follow-up (2026-09-09)

- User requested removal of the version/header number, red instructions, and all form footers shown in screenshots. Removed the entire centered “เลขที่ … · version …” line on the blank PAPER form, red instructions, grey tax note, and PDF ID/SHA256/Page footer. Trimmed unused SVG footer space; retained the separate expense reference field and all blank signer fields.
- Reused existing paperForm renderer branch and omitPageFooter PDF option. Internal version/hash, digital/legacy rendering, retained signed scans, and issued artifacts are unaffected. No schema or payment changes.
- Focused renderer/PDF/download/usecase suites: 77/77 passed, zero skips, /tmp/substitute-paper-clean-form-tests.log. API build passed, /tmp/substitute-paper-clean-form-build.log. Scoped diff check passed.
- Rebuilt/restarted local API. Downloaded the user's PREPARED SRC-202609-00017 (cmtubpcye000s99k166ggsqey) through the existing form endpoint and visually inspected /tmp/substitute-paper-clean-form.png rendered from /tmp/substitute-paper-clean-form.pdf: one page; requested text absent; title, facts, table and blank signature/name/position/date fields intact. No upload/certification/acceptance performed.
- Next: user downloads the form again from the local page; previously downloaded PDF files stay unchanged.

## Paper upload wording and position discussion (2026-09-09)

- Removed the visible version number from both the paper-panel summary and upload acknowledgement requested in the screenshot. Internal evidence version/source/concurrency checks remain.
- Web typecheck passed (/tmp/substitute-paper-hide-version-types.log); scoped diff check passed. Existing local web serves the text change through HMR. No new test for this text-only change.
- User asked whether position should be optional; no authorization to change that business rule inferred from the question. Current required-position behavior remains. Product recommendation under discussion: optional position for both handwritten signers, retaining mandatory name/date/signature, verification of actual payment and the paper approver's real authority. Company-specific requirements may still apply. Any future implementation must align UI, API validation, acknowledgements and PDF rendering.
- Reference checked: https://www.rd.go.th/827.html (actual expense/recipient evidence and specific approval requirements), https://www.rd.go.th/fileadmin/download/drugstore_manual1.pdf (illustrative substitute-receipt form). Do not claim that an optional title guarantees tax deductibility or that a filled title proves authority.

## Authorized optional positions and attestation follow-up

Status: in progress. User explicitly authorized optional positions throughout the flow, superseding the discussion-only decision above. Scope: digital and paper certifier/approver fields, API validation, web gates, PDFs, uploader name and paper attestation cleanup. Reviewer remains governed by existing approval settings. No schema, payment or reimbursement changes.

### Completed 2026-09-10 (local)

- Positions optional across DIGITAL and both PAPER paths: contracts allow omission; API normalizes omitted/blank values to an empty string and rejects malformed/over-120 values. Existing signer identities/dates/signatures/acknowledgements, preview hashes, source-state and approval authority remain enforced. No database migration.
- Removed position from readiness/blocker lists, required markers, and preview gate in wizard and expense review. Shared select can explicitly choose no position. Removed obsolete focus-jump and translated blocking copy. Updated signing help and user guide to optional position and the actual signature-before-review order.
- PDF omits absent position phrases and separators; blank paper form labels position “ถ้ามี”. Acceptance attestation hides displayed version, account rows and SHA-256 rows, shows uploader display name and “ผู้ตรวจรับ”. Server captures uploader display name at submission; older submissions use company-scoped member lookup without requiring that historical uploader remain active. IDs/hashes stay internal, stored issued artifacts remain unchanged.
- User asked again where the reviewer is configured. Renamed settings headings to “รูปแบบการอนุมัติและตรวจรับ” and “ผู้อนุมัติออนไลน์ / ผู้ตรวจรับฉบับกระดาษ”; option “กำหนดรายชื่อผู้อนุมัติ / ผู้ตรวจรับ”. Help explicitly says selected names only constrain reviewers in designated mode; OWNER_SELF currently uses existing expense.confirm eligibility. Did not alter or save the user's company policy.
- Focused API tests: 304/304, zero skips (substitute usecase, renderer, PDF, download, policy, LINE continuation); /tmp/substitute-optional-api-tests.log. Added omitted position digital/legacy full lifecycle and malformed input checks, paper submission required facts/name capture, and acceptance captured/fallback name tests. Existing hash, signer ownership and approval guards pass.
- Web tests: 53/53, zero skips; /tmp/substitute-optional-web-checks.log. Guide content suite passed; /tmp/substitute-optional-guide-tests.log. Contracts build, API build/typecheck and web tsc passed; /tmp/substitute-optional-{contracts,build,api-types,web-types}.log. Scoped diff check passed.
- Real local HTTP+PostgreSQL+storage: 4 new simulated records (DIGITAL/PAPER × COMPANY/PERSONAL_ADVANCE), both positions blank, all ISSUED. Each COMPANY creates one payment of 20; each PERSONAL_ADVANCE creates zero and paidAmount 0. Paper prepare/upload/submit do not pay; retry submission safe and repeat acceptance/wrong hash rejected. /tmp/substitute-optional-smoke.log, /tmp/substitute-optional-paper-smoke-results.json, /tmp/substitute-optional-digital-results.json.
- Visual QA: /tmp/substitute-optional-form.png from actual blank PDF shows clear optional fields. /tmp/substitute-optional-user-review-page2.jpg shows user's still-PREPARED SRC-202609-00017 preview with uploader Local Owner, simplified reviewer label, no version/accounts/SHA rows. Preview only; did not sign or accept the user's document.
- CUA: paper form displays optional positions; fresh DIGITAL fixture cmtucnsfz002ve4k1tr8s30y8 opened full preview with no position selected, signing remains blocked until acknowledgement. Settings new reviewer heading/help verified in a separate test tab. Original tabs and unsaved forms preserved.
- Local API rebuilt and restarted using existing isolated local runner; port 3001 and web 3000 remain available. No cloud/deployment/package.json/reimbursement changes.

Next: user refreshes local settings or reopens document preview to see updated labels. For restricted reviewers, select designated mode, choose eligible member names, then save; same list also governs digital approval.

## Paper acceptance disabled feedback (2026-09-10)

Status: in progress. User reports disabled declarations/acceptance on PREPARED SRC-202609-00024 (cmtucw4kv004we4k18s9cij77). Reproduced: no reading confirmation, all three declarations disabled without explanation. Full preview contains two pages and an explicit read-confirm button; close alone does not record review. Implementing scoped feedback/instructions and page-open progress, retaining all review/permission/final issue guards. No API or payment changes. Original user tab remains intact; testing in separate tabs only.

### Completed disabled-state feedback

- Added numbered review/acceptance sections, explicit instructions for every-page reading confirmation, highlighted prerequisite feedback while checkboxes are disabled, and remaining declaration count after reading. Review button uses primary styling until acknowledged. Preview footer shows successful page-open count and next action. Existing close/load/navigation behavior does not grant acceptance.
- CUA Chrome reproduction on a separate tab for SRC-202609-00024: page 1/2 leaves read-confirm disabled; after page 2/2 renders it becomes enabled; pressing read-confirm closes preview and enables all three declarations. Final acceptance remains disabled with all declarations unchecked. No declarations or final acceptance submitted; no document/payment state changed. The uploaded test scan references SRC-202609-00023 while this record is 00024, so no assertion that the user's file matches was made.
- Visual QA confirms progress/help and confirm action visible in the fixed preview footer. Local HMR serves the change. Web tsc passed (/tmp/substitute-disabled-web-types.log), focused preview/lifecycle tests 15/15 passed (/tmp/substitute-disabled-preview-tests.log), scoped diff check passed. No backend changes or restart needed.
- Original user tab kept intact. Next: open every page, confirm reading in the modal, then the user validates and selects the three declarations before final acceptance.

## Paper PDF footer correction

Status: in progress (2026-09-10). Root cause: prior cleanup affected the blank form only; new paper attestation still rendered a grey tax footer, and the shared compositor unconditionally added ID/Page to scan+attestation pages. Scope: new PAPER generated presentation, preview and download compositor options; retain immutable uploaded/issued source artifacts and state stamps. User now views ISSUED SRC-202609-00025 (cmtud9rpa0062e4k13lnfs1xq), issued by the user while local review continued.

### Completed paper PDF footer correction (2026-09-10)

- Accountless PAPER previews and issued downloads omit the generated ID/Page overlay. Newly rendered paper attestations omit the grey tax footer. Existing issued paper attestations remove only that exact static footer from the derived printout; stored SVGs, hashes and uploaded scans remain unchanged. Original scan content and VOID/SUPERSEDED stamps remain visible; legacy compositor defaults are preserved.
- Focused renderer/PDF/usecase/download checks: 82/82 passed, zero skips (/tmp/substitute-step3-footer-tests.log). API build and typecheck passed (/tmp/substitute-step3-footer-build.log and /tmp/substitute-step3-footer-types.log). Tests cover original scan-footer preservation, state stamps, exact generated-footer removal and unchanged source buffers.
- Rebuilt and restarted isolated local API. Read-only HTTP PDF QA: inspected both pages of issued SRC-202609-00025 (/tmp/substitute-step3-footer-issued25-page1.jpg and page2.jpg), and the attestation page of prepared SRC-202609-00017 (/tmp/substitute-step3-footer-prepared-page2.jpg). Generated footers absent; document content retained. The user's uploaded test scan references another document number; no assertion of matching content or acceptance was performed.
- No signing, acceptance, payment, company-policy or stored-artifact mutation. Local web 3000/API 3001 remain available. Next: close the existing preview and reopen or download again; previously saved PDF files stay unchanged.

## Online signing footer correction (2026-09-10)

Status: in progress. User reports the same grey tax footer and ID/SHA256/Page on digital SRC-202609-00026. Earlier cleanup explicitly preserved digital defaults; now remove the footer across newly rendered online SVG stages and derived issued PDFs, including existing issued documents. Reuse the exact static-footer removal helper; preserve immutable source artifacts, signatures, hashes and state stamps. No payment-voucher, reimbursement, policy or cloud scope.

### Completed online footer correction

- New digital preview/certified/issued SVGs no longer include the grey tax footer. Issued digital PDF composition uses the shared exact-footer removal helper (renamed withoutSubstituteReceiptFooter) and omitPageFooter. Existing issued originals remain stored unchanged; derived PDFs reflect the requested presentation. The online unsigned-form download also omits ID/SHA256/Page while retaining its explicit UNSIGNED status. Payment vouchers and legacy paper compositor defaults remain unchanged.
- Focused usecase, renderer, PDF and download suites: 82/82 passed, zero skips (/tmp/substitute-online-footer-tests.log). Download regression checks cover an old stored SVG with the former footer, unchanged source bytes, absent PDF footer text, and retained VOID/SUPERSEDED/UNSIGNED stamps. API build and typecheck passed (/tmp/substitute-online-footer-build.log, /tmp/substitute-online-footer-types.log); scoped diff check passed.
- Local API rebuilt/restarted. Actual read-only artifact-preview and artifact.pdf for SRC-202609-00026 (cmtudo0pv000nfok13ig1dpsm) both succeed. Visually inspected /tmp/substitute-online-footer-issued26-page1.jpg: grey tax note and bottom ID/SHA256/Page absent; both signatures, names, dates and expense content intact. The hub record before/after is identical; no user approval, payment or source-artifact mutation performed.
- Next: close and reopen the document preview or download the PDF again on local. Previously saved files and raw historical source artifacts retain their original bytes.
