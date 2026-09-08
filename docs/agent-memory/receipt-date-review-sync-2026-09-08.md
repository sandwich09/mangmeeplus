# Agent Memory: receipt-date-review-sync-2026-09-08

Status: implemented and local checks passed; preparing reviewed PR CI and corrective UAT, then actual live retest.
Owner: root
Scope: explicit date save metadata, related API/DB transition guard, truthful customer copy, regression coverage, merge develop/main and UAT deployment only.
Decisions: use existing UpdateExpenseDraftUseCase and source/final mutation boundaries. Preserve the PANDA form, optional purpose, money/category/source identities, raw OCR, unrelated warnings and tenant/revision checks. No dependency, schema, feature flag, automatic historical-data update or Production deploy.
Open questions: none; Production still requires new owner approval.
Artifacts: receipt-single-form-preview spec/plan date addenda; prior live-browser-report.md; branch codex/receipt-date-review-sync-20260908 based on fetched develop21b02827 with prior documentation evidence cherry-picked.
Verification: previous live UAT67773ad3 fails at step3 after date save; explicit dateStatus fixture was missing in local tests. New PG cases first failed exactly on retained unverified status and missing API rejection; after correction15/15 pass. Focused existing API/domain/repository160/160 plus added focused14/14 pass. Web full1678/1678 and API/web typechecks pass. Real local browser11/11 pass at390/1280px, with explicit unverified fixture, blank purpose, actual final UI click/POST and DB READY_FOR_CONFIRMATION. UAT read-only preflight passed before image publication.
Next: reproduce in tests, implement, verify, merge and issue new canonical UAT release. Prior Passport/READY are superseded by any new application source; do not promote them.

## Implementation and impact evidence

- UpdateExpenseDraftUseCase captures the explicit date input before source/financial synchronization. It saves current dateStatus, resolved date/actor/time and resolved warning changes inside the existing CAS write. Raw recognizedFields and unrelated review reasons remain unchanged. Source-only and voluntary LINE collection use the same resolution path.
- Final repository transitions now pass current receipt facts to the existing source/date guard for both LINE and web receipts, including tax-finalization and confirmation CAS. Real assumed readings and legacy summaries are accepted; explicit unreadable/implausible states cannot bypass via API. Reopening REJECTED to NEEDS_REVIEW stays available.
- Kept the form/layout/dropdowns. Complete-data wording no longer claims AI supplied every field; disabled-submit guidance points to step1. Typed date errors map to readable Thai. No migration, dependencies or new flag.
- PG coverage includes equal-placeholder confirmation, changed date, omitted date, voluntary LINE answer, source/combined/reviewer saves, preserved raw evidence/unrelated reason/money/line identities, clearing, invalid date, stale write, Ready and both final confirmation seams.
- Browser first attempt hit the local synthetic MinIO bucket's missing versioning prerequisite before any receipt fixture could be created. Enabled versioning on that disposable local bucket, then11/11 passed. This was not a UAT or product failure. Initial typecheck found only JSON narrowing in the new test; corrected it and typechecks passed.
