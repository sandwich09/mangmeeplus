# Agent Memory: receipt-single-form-preview

Status: owner approved preview; implementing exact step 1 / DRAFT save-button rule and preparing UAT release.
Owner: root
Scope: one visible web receipt editor; reference-detail LINE receipt summary; local screenshots.
Decisions: Preview accepted. Latest owner instruction authorizes UAT only after renaming the normal review button to “บันทึกแบบร่าง” and showing it only on step 1 / exact DRAFT. The separate partial-source editor retains its existing save path for incomplete NEEDS_REVIEW and upload-only cases. Existing permission/source/financial boundaries remain. No Production deployment or outbound customer messages. Branch codex/receipt-single-form-preview-20260908.
Open questions: none for authorized local scope.
Artifacts: docs/specs/receipt-single-form-preview-spec.md; docs/plans/receipt-single-form-preview-plan.md; docs/qa/evidence/receipt-single-form-preview-2026-09-08/README.md and screenshots.
Verification:
- Focused web model/component tests: 117 passed, zero skipped.
- LINE webhook/receipt/recovery suite: 242 passed, zero skipped. Reference document number and other summary facts visible again; passive capture/recovery does not start questions.
- Real local PostgreSQL source-draft suite: 12 passed, zero skipped, including scoped source references, same-named items, explicit removal, purpose, preserved charge IDs/totals, unauthorized/invalid writes, CAS and partial saves.
- Real browser/API/DB continuity suite: 8 passed, zero skipped. Mobile 390px and desktop 1280px; ordinary one-form review/save/reload; incomplete source save/reload; stale save; legacy READY reopening; upload-only authority and unreadable item creation.
- Screenshot framing rerun: same two readable receipt journeys passed. Inspected mobile/desktop images and generated Flex preview.
- API and web typechecks, contracts build, git diff whitespace check passed.
- Initial test-environment issue: new local MinIO bucket needed versioning; enabled locally, then tests passed. Updated stale test copy/label expectations and fixed dynamic accessible labels. No cloud resources/config were touched.
- Temporary local preview bucket and object versions cleaned; synthetic expense/attachment fixtures clean themselves. Images use test data, not a live customer record. LINE image is a local rendering of the actual generated Flex payload, not device delivery acceptance.
- Owner follow-up checks: 117 web tests and 8 real local browser/API/DB journeys passed again. Browser verifies DRAFT step-1 button, step-2 omission/back, NEEDS_REVIEW and READY omission, plus unchanged partial saves. Mobile/desktop screenshots refreshed with “บันทึกแบบร่าง”.
- Owner follow-ups: shared dropdown theme including the partial-source editor; explicit draft-save success toast, friendly validation/API errors, and truthful saved-but-readback-failed warning. Eight browser journeys passed with popup bounds/theme, success toast, five injected API/network failures and saved-but-readback-failed behavior. 190 focused web/shared error/fetch/theme tests passed; final web typecheck passed. Final screenshot framing re-run: two passed. Read-only UAT rollout/secret-metadata/alarm preflight passed.
Next: focused browser checks and new screenshots; reviewed PR CI, merge develop/main, canonical UAT deployment and signed/runtime/customer OPEN acceptance. No Production deployment; mail unchanged.
