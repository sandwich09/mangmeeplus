# Receipt reliability remediation verification

Status: Combined local candidate passed; GitHub CI and develop/main delivery pending. This records implementation evidence; it does not claim a live deployment or LINE device delivery.

[Spec](../specs/receipt-reliability-and-draft-continuity-spec.md) · [Plan](../plans/receipt-reliability-and-draft-continuity-plan.md) · [Original incident and impact inventory](line-receipt-reliability-ux-review-2026-09-07-th.md)

## Traceability

All tests below are permanent repository files. Local commands and results are recorded below; GitHub PRs provide the final CI and merge record.

| Entry | Implemented boundary | Regression evidence |
|---|---|---|
| T01 | Printed zero is a valid non-negative amount; unknown/invalid amounts cannot become zero or NaN | OCR apply service regression first failed with `NaN`, then passed; `receipt-truth.pg.spec.ts` persists real Decimal rows |
| T02 | A send failure cannot turn a committed receipt into a processing-failed/resend answer | `process-line-webhook.use-case.spec.ts`: actual orchestration with commit followed by delivery failure, both outcome flag states |
| T03 | First durable business outcome is retained; recovery sends its result without rerouting the mutation | Webhook/recovery suites plus real PostgreSQL delivery recovery composition |
| T04 | LINE message identity precedes attachment reservation; interrupted or concurrent retry reuses the original capture | `receipt-reliability.pg.spec.ts`: unique constraint, reservation loss, concurrent retry, existing ACTIVE object and scope checks |
| T05 | Exact stored bytes can point to the existing own capture; similarity remains a duplicate review decision | Webhook tests distinguish new event/same message and new message/same exact image; existing duplicate detection remains in place |
| T06 | Customer admission compensation is atomic and separate from actual provider spending | Gateway and PostgreSQL admission/compensation tests; no retroactive customer quota edits |
| T07 | Push identity includes operation, recipient and canonical payload from its first request | Adapter and recovery tests include response loss, accepted-request conflict, JSONB key ordering and permanent failures |
| T08 | Safe error class/cause/status and receipt stages replace raw exception bodies | Webhook/adapter/gateway fault tests; raw receipt, Prisma request bodies and credentials are excluded from these logs |
| T09 | The failed boundaries have runnable regression coverage in CI | Existing listed API tests plus explicit source draft/continuation and PostgreSQL CI invocations; no package.json edits |
| T10 | All missing document/item facts are computed together; partial input remains saved | Shared question/formatter tests, 40-item message bounds, real browser source-form journey |
| T11 | Purpose, pause/resume and no-field turns cannot replace financial rows | Source draft PostgreSQL test retains discounted 90 total, charge rows, identities and tax snapshots |
| T12 | All 21/40 staged OCR items survive persistence and continuation | Shared parser/formatter and PostgreSQL tests; over 40 is rejected explicitly |
| T13 | Stale answers fail; resume refreshes current web facts before the next answer | PostgreSQL two-turn stale/resume test; real browser PATCH conflict preserves the newer vendor |
| T14 | Existing image and incomplete staged facts can be saved and reloaded in the web | Real HTTP/Playwright at 390 and 1280 pixels; unknown quantity/price remains null, financial rows are not fabricated |
| T15 | Shared source completeness drives prompts, clearing and final guards | Source patch tests cover omitted/null/empty fields and question projection; repository confirmation guards reject incomplete state |
| T16 | Active originating uploader can fill ordinary source facts without finance authority | PostgreSQL cross-scope/revoked/non-owner negatives and actual browser login with upload-only expense permissions |
| T17 | Ordinary Thai save-for-later controls preserve work; unrelated turns do not mutate it | Control/parser plus stateful PostgreSQL pause/resume/no-field tests; saving never confirms |
| T18 | Explicit old target lookup is independent of recent-five discovery | PostgreSQL collection test opens an older scoped draft after newer drafts exist |

## Review findings resolved during integration

- Business rules: zero-priced items must remain distinguishable from unknown prices; quantity must be greater than zero. `Decimal.isPositive()` includes positive zero, so staged quantity validation uses an explicit greater-than-zero comparison.
- Data integrity: a financial summary row such as `1 × 100` cannot overwrite OCR source facts such as `2 × 50`, or supply missing quantity/price. Matching requires proven identity, reviewed/reconciled rows, or matching numerical facts; ambiguous rows require review.
- Architecture: source updates use the existing ExpenseRecord metadata, permission-checked update use case and transactional revision guard. Preserved line identities survive insertion ahead of charge rows. No schema migration, new service or dependency is introduced.
- AI engineering: retrying a notification must not invoke OCR or reroute the original business action. Provider acceptance is separate from device delivery/read. Canonical JSON serialization keeps retry identity stable after PostgreSQL JSONB reload.
- Accessibility: helper text nested in a label changed the accessible field name; explicit source header labels make the actual browser and assistive technology identify the same inputs.
- Permissions and navigation: the web route and shared menu entitlement must recognize existing LINE upload capability without granting review/confirmation/payment authority.
- Entrepreneur UX: a user with only upload permission needs the image, editable source facts and save action, without disabled accounting panels. Unknown totals/dates must not appear as a zero amount or a known receipt date. When OCR yields no items, the user needs an explicit add-item action.
- Full review: deleting a reviewed financial row must preserve the remaining row IDs and charges, remove only its proven staged counterpart, and retain unrelated unfinished items. Foreign/repeated row IDs are rejected.
- Finalization: missing source state cannot be treated as complete merely because the user has not saved the partial form yet. The same source facts shown by GET must be checked at the final mutation boundary. Legacy READY records have a reviewer-only “กลับไปเติมข้อมูลบิล” action through the existing revision-checked review update; reopening and partial saving require no fabricated financial rows.
- Attempt isolation: an internal saved-receipt marker must not survive reuse of the same event object across separate invocations and turn a later pre-storage failure into a false saved-image claim.

## Local integration boundary

Tests use a dedicated disposable PostgreSQL database on loopback port 15439 with all 176 baseline migrations. Browser fixtures create synthetic records and a generated test image in a dedicated versioned bucket on local MinIO at port 19000, use real authentication, HTTP GET/PATCH, original-image retrieval, source permissions and database persistence, then remove their records and image versions. Upload-only expense fixtures retain the normal baseline account-session and attachment-read permissions, which grant no finance authority. No production database, AWS resources, customer receipt or outbound LINE message is involved.

The initial browser run failed because helper text polluted exact labels and the synthetic upload role lacked the baseline `account.session.read` permission. The corrected run passed all four initial cases. Visual inspection then identified the compact-layout and unknown-summary fixes and an additional empty-OCR case. A fixture storage mismatch (local files against an API configured for S3) was corrected by using the local versioned MinIO bucket, and image preview was asserted rather than only checking the attachment ID. The final six-case run, including the legacy READY correction path, passed in 14.6 seconds.

Rendered evidence from synthetic fixtures: [upload-only mobile](../evidence/receipt-reliability-remediation-2026-09-07/upload-only-mobile.png), [empty OCR with a newly entered item](../evidence/receipt-reliability-remediation-2026-09-07/empty-ocr-mobile.png), [desktop partial draft](../evidence/receipt-reliability-remediation-2026-09-07/partial-draft-desktop.png). The one-pixel generated image exercises actual retrieval without copying a customer receipt; the screenshots demonstrate the form layout rather than OCR visual accuracy.

## Runtime acceptance still required

Dedicated LINE conversation and terminal outcome replay switches retain their existing defaults. The source web fallback works independently of the conversation switch. Replay uses stable ordinary web links so a replay cannot mint different expiring handoff-token bytes; web authentication still applies. Before a later runtime rollout, follow the existing deployment and feature acceptance protocols, test the actual OA/device experience, and record the UAT/READY/production evidence.

LINE's documented retry contract requires the key on the first supported push request, identical recipient/content and retry within 24 hours; an accepted request does not prove device delivery. The worker retains its stricter one-hour recovery bound. [LINE retry API documentation](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/).

## Final verification and delivery

| Check | Command / environment | Result |
|---|---|---|
| Whole workspace | `pnpm test` | Passed after integration corrections; config 141, contracts 246, workers 43, gateway 1,097 and web 1,649 tests. API uses the dot reporter and also exited successfully; no inferred API count. |
| PostgreSQL receipt truth | `RECEIPT_TRUTH_TEST_DATABASE_URL=<isolated loopback database> RECEIPT_TRUTH_REQUIRE_POSTGRES=true pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/receipt-truth.pg.spec.ts` | 8 passed, 0 skipped |
| PostgreSQL source continuity | `RECEIPT_SOURCE_DRAFT_TEST_DATABASE_URL=<same local database> pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/expense-source-draft.pg.spec.ts` | 11 passed, 0 skipped |
| PostgreSQL capture/delivery | `RECEIPT_RELIABILITY_TEST_DATABASE_URL=<same local database> RECEIPT_RELIABILITY_REQUIRE_POSTGRES=true pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/receipt-reliability.pg.spec.ts` | 6 passed, 0 skipped |
| PostgreSQL existing LINE edit | `LINE_DRAFT_EDIT_TEST_DATABASE_URL=<same local database> pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/line-draft-update.pg.spec.ts` | 1 passed, 0 skipped |
| Real browser / HTTP | `pnpm exec playwright test e2e/receipt-draft-continuity.spec.ts --project=chromium --workers=1` with the explicit local DB and versioned MinIO configuration described above, AI/mail disabled | 6 passed: mobile/desktop partial save and reload, stale write, legacy READY reopen, upload-only original-image preview/save, and empty-OCR add-item/save |
| Type / build checks | API TypeScript with the existing 8 GB heap; gateway TypeScript; contracts build; `pnpm --filter @watchdog-bms/web typecheck` after the final UI change | Passed |
| Additional changed-boundary suites | Delivery orchestration/intake/signup/recovery/adapter/client; source conversation/repository/logic suites | Owners reported 537/537 delivery and 185/185 source tests; overlap with the workspace and PostgreSQL checks is not added into a headline total |
| CI suite registration | `pnpm --filter @watchdog-bms/api exec tsx --test src/spec-suite-coverage.spec.ts`; `node --test scripts/line-ai-whole-chain-acceptance-catalog.spec.mjs` | 3/3 and 4/4 passed. Shared source logic is registered in the existing whole-chain catalog; both new PostgreSQL suites are explicit CI steps. |
| Existing whole-chain runner | `node scripts/run-line-ai-whole-chain-acceptance.mjs` | Passed all eight repository suites in 7.3 seconds; catalog covers 21 repository scenarios. Its three controlled external image scenarios remain explicitly pending human-reviewed provider replay, not counted as passed. |
| Diff boundaries | `git diff --check`; review of changed paths | Passed; no package.json, dependency, lockfile, schema migration or runtime default change. The existing generator updates only the upload-intent checksum and dependent release-validator checksum; release behavior and enforcement rules are unchanged. |

Coordinator logs are retained locally under `output/receipt-remediation-20260907/`: `workspace-tests.log`, `final-postgres.log`, `browser-continuity.log`, `final-web-typecheck.log`, `spec-wiring.log` and `catalog-tests.log`. Screenshot evidence is tracked above; logs and the local browser launcher are not committed. The source PostgreSQL suite exercises the real repository/audit transaction with a passthrough tax resolver, supplemented by existing tax/confirmation suites; it does not replace live provider acceptance.

Delivery: feature branch `codex/receipt-reliability-remediation-20260907`, base develop `4b91953f`. Spec/plan preceded code in `5d7b3415`; zero-price fix and red-to-green regression are in `b76b3f33`; integrated implementation is `d4896759`. [Develop PR #473](https://github.com/MangmeeDev/mangmeeplus/pull/473) holds the final check and merge record. Its initial [CI run 34102495652](https://github.com/MangmeeDev/mangmeeplus/actions/runs/34102495652) stopped at stale maintenance pins before the test jobs. The existing generator refreshed the changed upload-intent checksum and dependent workflow checksum; its `--check` and both pin-sync/maintenance-validator contract suites pass. This initial failed run is not counted as a CI pass; wait for the updated candidate before merging.
