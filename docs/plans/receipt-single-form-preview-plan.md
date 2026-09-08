# Receipt single form and detailed LINE summary plan

## Date-verification corrective pass — 2026-09-08

1. Reproduce explicit stale dateStatus using existing browser and PostgreSQL fixtures; keep the actual final UI click and API/DB assertions.
2. Synchronize manual date resolution at UpdateExpenseDraftUseCase for ordinary, source-only, combined and voluntary LINE saves; preserve unrelated findings and optimistic transaction boundaries. Enforce the same date rule in existing final source guard and repository transitions.
3. Correct misleading complete-data copy and wrong step number without changing the stable form; verify themes, optional purpose, blank/omitted dates and legacy draft recovery.
4. Run focused API/PG/web/browser checks and typechecks; review diff and full required PR CI, merge develop/main. New source supersedes the previously held candidate; freeze the new controller for its release.
5. Deploy UAT once via canonical protocol, verify signed Passport, runtime/OPEN/deep DB/provider checks and automatic READY; repeat live Drtb UI through submission. Keep Production unchanged pending owner approval.

1. Verify the current two-form render and source/financial save contracts; identify shared receipt formatter and recovery callers.
2. Select exactly one editor from source completeness and existing permissions. Restore the normal review layout for readable receipts, including purpose/category resolution; keep partial saves and the original image for unreadable receipts.
3. Remove raw question fallback from web labels and replace long initial missing lists with concise, accessible field guidance.
4. Restore seven receipt summary facts in initial/recovered LINE replies without restarting draft questions; test shared rendering/fallback output.
5. Run focused model, component, API and browser checks. Inspect local screenshots, record evidence and limitations in task memory. Capture owner-review evidence before deployment.

Completed locally: all five steps. The ordinary review form now includes purpose and item category inputs, staged rows without a financial counterpart, and one shared save function. Scoped source references/removals prevent same-named items or deleted staged rows from reappearing after review. Browser acceptance passed at 390px and 1280px, including real API save/reload. Owner screenshot review was accepted; UAT release preparation is now authorized. Production remains held.

6. Owner approved the preview: rename the explicit financial-review action to “บันทึกแบบร่าง” and gate it to step 1 / DRAFT; verify save/reload, other-status omission and navigation. Refresh screenshots, merge reviewed CI-passing code into develop/main, then deploy UAT through the canonical protocol. Record candidate/controller, UAT/auto READY IDs, signed evidence and customer OPEN acceptance. Do not deploy Production.

7. Owner follow-ups: audit dropdown theme (including the partial editor), replace the remaining native category select with the shared themed control, retain disabled authority and add accessible item labels. Add explicit draft-save success toast and truthful refresh-failure warning. Verify browser popup bounds/theme, API validation/permission/conflict/server/network errors and saved-but-readback-failed behavior.

## Corrective plan after live Drtb comparison (2026-09-08)

The completeness-based editor switch in step 2 is superseded by the owner's stable PANDA MALA form requirement. The added missing-data overview in step 3 is removed.

1. Restore permission-based form selection. Reuse the existing financial review component for incomplete owner/reviewer receipts, preserving blank unknown source facts and accepted financial values/category/tax.
2. Reuse source-draft input with the financial review save under reviewer-only authority where needed. Persist incomplete facts and financial changes in one transaction with revision checks; keep upload-only scope and strict completion/finalization gates.
3. Remove the overview/list; retain field labels/inline warnings, themed controls and existing three-step layout. Keep draft-save step/status rules and truthful toast/error behavior.
4. Verify Drtb-shaped unknown date + 55/VAT3.60 alongside PANDA MALA; incomplete quantities/prices, save/reload, conflict/failure, original attachment and row identities. Update actual component screenshots and record live test limitations.
5. Let prior auto READY 34174423705 finish and prove cleanup. Merge the correction with passing exact-head CI into develop/main, fresh read-only preflight, then one UAT all-target dispatch and signed/runtime/customer OPEN acceptance. Prepare full UAT/Production config comparison and readiness evidence. Wait for owner approval before Production deployment; keep current Production live and mail unchanged.

6. Owner asks to verify Next and hidden mandatory fields: check complete visible inputs through all three steps, preserve the WHT/payee conditional visibility predicate, and bind purpose/category completeness to their existing visible fields and error-focus action. Verify no-financial-row partial tax omission without discarding explicit tax edits.

7. Follow-up supersedes the purpose mandate in step 6: make businessPurpose optional end-to-end while preserving financial category rules. Remove the generated purpose requirement, normalize legacy continuation projections and verify API/DB/READY behavior with blank purpose. Keep voluntary purpose entry/storage; test complete visible financial fields advancing without entering purpose.

Corrective implementation/verification complete: stable three-step form, optional purpose end-to-end, source/finance atomic save, Next mandate/visibility, stale-write/error handling and legacy reopen/read normalization. Evidence: 11 browser, 13 real PostgreSQL, 1328 broader API/LINE (two environment-only skips), 1678 web, scoped checks and API/web typechecks passed. Current release preparation and exact run IDs are tracked in receipt-stable-review-release-2026-09-08 memory.
