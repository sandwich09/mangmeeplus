# Agent Memory: UAT latest main 2026-10-29

Status: COMPLETE UAT RELEASE — latest main is signed, OPEN and browser-verified; Production not touched
Owner: Codex
Scope: Deploy exact latest `origin/main` containing the free-expense three-document feature and the completed Halloween escape game to retained Kamal UAT only.
Decisions:
- Candidate/controller is `56cdb4ee50bedf3f0c22451faf1583ffb6ec252c`, tree `130fa7d53917871cf1567decd89197e7cbe989c8`; `origin/main` and `origin/develop` matched before prepare, apply and final readback.
- Use the existing owner-authorized local Kamal UAT smoke path with scoped profile `mangmee-kamal-uat`; workflow UAT/READY/PROD IDs are `NOT_DISPATCHED`.
- Use `mode normal` because candidate adds migration `20261028090000_free_expense_monthly_documents`; it contains only three nullable columns and one index, with no drop/delete/rename.
- UAT was intentionally paused. Retain read-only failed preflight `20261028T164340Z-bda91715`, which stopped at target preflight before mutation. Start the retained baseline once, then run one successful prepare and one apply. Do not deploy Production.
- Product clock remains the visitor device clock. The browser boundary proof changes `Date.now()` only inside isolated test contexts; it does not change UAT, server or database time.
Open questions:
- No deployment blocker remains. The signed UAT smoke proves migration/catalog authority and deep readiness, but an authenticated free-cohort web/LINE/provider journey on actual UAT was not performed in this release; native LINE/LIFF and real provider behavior remain separate acceptance work.
Artifacts:
- Private receipts under `.env.kamal/uat/runs/20261028T164508Z-4420d7ca/`, `20261028T165128Z-ef733e4b/`, `20261028T165147Z-fa6b78fb/` and `20261028T165734Z-fcdabc54/`.
- Public browser evidence: `docs/evidence/halloween-uat-main-2026-10-29/`.
Verification:
- Power start `20261028T164508Z-4420d7ca`: `UAT_RUNNING_OPEN`, 342.385 seconds; retained source/config fingerprints matched, public OPEN passed, SSM cleanup 2/2.
- Read-only preflight `20261028T165128Z-ef733e4b`: `PREFLIGHT_PASSED_NO_DEPLOYMENT`, 11.926 seconds.
- Prepare/publish `20261028T165147Z-fa6b78fb`: `PREPARED_NO_DEPLOYMENT`, 317.413 seconds; exact candidate tags/digests published for API/Web, AI, Workers and tools, no deployment or Production mutation.
- Apply `20261028T165734Z-fcdabc54`: signed/verified `ACCEPTED_LINE_DEFERRED`, 288.906 seconds. All 12 phases passed; migration/authority, API/DB, AI, Workers/Redis/internal API, public OPEN, retirement 19/19 and SSM cleanup 2/2 passed. Runtime readback for all three services is exact source `56cdb4ee50bedf3f0c22451faf1583ffb6ec252c`; KMS ECDSA verification passed.
- Result SHA-256 `5a80ca94154eebf3a46a760044bc71427724d3d2a5e450ecd81d6e9a256fe981`; accepted payload SHA-256 `ce0ac6d0490753998b786e4505db7227020eb21d48549a35b613c9262f0571ec`; signature file SHA-256 `f56ef6a7139bd8b3b59425dafab5438e974cf5dce552b09dff9718a8154ce1c6`.
- Chromium at 390×844 and 1280×900 against actual UAT proves both upcoming doors grey/native-disabled and non-openable 1 ms before their own Bangkok cutoff, door 2 opens exactly at 29 October 00:00 while door 3 stays locked, and door 3 opens exactly at 30 October 00:00. Actual 29 October state is door 2 open and door 3 grey/disabled. Production-only preview bypass is absent, with zero browser errors and no horizontal overflow.
Next:
- Leave UAT running for review. Production remains on the previous release and is outside this request.
- If the owner wants business acceptance for the free-expense feature, use an authorized synthetic free cohort on UAT and retain/clean up its evidence without calling a real LINE/provider journey unless explicitly authorized.
