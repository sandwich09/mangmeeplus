# Receipt preview evidence — 2026-09-08

Owner-approved local implementation and UAT release evidence. Production remains held. Read-only UAT deploy preflight passed before release preparation.

## Screenshots

- `receipt-one-form-390.png`: actual modified web, one seller/date/purpose editor on mobile.
- `receipt-purpose-390.png`: same saved purpose and original tax controls.
- `receipt-one-form-1280.png` / `receipt-purpose-1280.png`: actual desktop layout.
- `line-card-preview.png`: local approximation of LINE Flex layout using the exact current formatter and shared card builder. `line-card.json` is the generated payload, including the canonical fallback text. This is not a screenshot of LINE device delivery.

Web screenshots use synthetic PANDA MALA receipt facts, four financial rows, a 300-baht total, the existing local seeded company and a tiny generated test image attachment. Real local API, database, session/permissions, optimistic concurrency and save/reload were exercised. Successful save/reload journeys use the real local API. Failure cases deliberately intercept only local browser requests to verify validation, permissions, conflicts, server/network errors and failed readback after a successful write. The empty desktop attachment pane is the one-pixel fixture, not failed access to a customer receipt.

## Verification

| Check | Result |
| --- | --- |
| Focused web/model/component + shared error/fetch/theme suites | 190 passed |
| LINE intake + webhook/receipt/recovery suites | 446 passed |
| PostgreSQL source continuity/authority suite | 12 passed |
| Browser continuity suite | 8 passed (390px and 1280px included) |
| Screenshot framing rerun | 2 passed |
| Contracts build, API/web typecheck, diff whitespace | Passed |

The browser suite exercises partial source save/reload, unknown values remaining blank, original image retention, stale writes, legacy READY correction, upload-only permissions, one ordinary editor for readable receipts, one saved purpose, preserved four rows and 300-baht total. The PG test additionally covers same-named staged rows, original financial/charge identity and explicit source removal.

Commands used the existing Playwright configuration with local API port 3041, web port 3040, PostgreSQL port 15432 and MinIO port 19000. `RECEIPT_CONTINUITY_TEST_DATABASE_URL`/`RECEIPT_SOURCE_DRAFT_TEST_DATABASE_URL` selected the local test database explicitly. The temporary `receipt-remediation-preview` bucket required local versioning and was cleaned after verification. No production credentials or message recipient were used.

UAT deployment is authorized. The reviewed source branch is `codex/receipt-single-form-preview-20260908`; exact release IDs will be recorded after dispatch. Production remains held.

Owner follow-up 2026-09-08: preview approved and UAT deployment authorized (Production held). The normal-review action now reads “บันทึกแบบร่าง”, only on step 1 / exact DRAFT. Refreshed mobile/desktop screenshots show this rule. `verification.txt` records eight passing real local API/DB/browser cases including step/status visibility and partial-save continuity; `verification.txt` records 190 passing focused checks.

Dropdown and feedback follow-ups: both category editors use the shared themed dropdown, explicitly disabled while read-only/saving. Eight real browser journeys passed with popup theme and mobile/desktop bounds, success toast, exactly one friendly error toast for validation/permission/conflict/server/network failures, preserved inputs and a truthful saved-but-readback-failed warning. Receipt detail screenshots remain synthetic. Final screenshot capture waits for the toast animation to finish. Production is still held.

Initial PR CI 34171244080 found three intake tests that still expected the prior compact card. They now assert the requested detailed card while retaining persistence, routing and passive-questionnaire checks. Expanded intake/webhook tests passed 446/446. No runtime behavior was changed to satisfy the obsolete copy assertions.
