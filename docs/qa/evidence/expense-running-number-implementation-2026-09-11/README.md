# Expense running number implementation — 2026-09-11

Status: implementation complete and locally verified; no merge, deployment or customer-gate change. Draft issuance defaults OFF until compatibility rollout enables `EXPENSE_DRAFT_NUMBERING_ENABLED=true`.

Spec: [กฎและขอบเขต v1](../../../specs/expense-running-number-flowaccount-spec-th.md). Plan: [implementation and remaining release checks](../../../plans/expense-running-number-implementation-2026-09-11-th.md). The [earlier proof](../../../research/expense-running-number-proof-2026-09-11-th.md) describes the pre-implementation baseline; its failures are not the current status.

## Behavior delivered

| Finding | Result |
| --- | --- |
| B01: number issued at confirmation using confirmation month | Manual draft saves issue EXP from document month; raw upload/LINE capture stays unnumbered until explicit date review. Claim projections use each line's date. Confirmation preserves an existing EXP. |
| B02: paper EXP displaced SRC | New paper/downloaded forms show SRC and EXP in separate fields. Existing stored/signed files are not rewritten. |
| B03: backfilling a snapshot changes its approval hash | Additive nullable draft key/hash migration, no number or snapshot backfill. Drafts with any retained SRC or linked claim preserve their legacy null EXP on review. Existing confirmation guards can issue a display number without rewriting retained facts. |
| B04: successful payout void retried as 422 | Permission-checked replay returns current success. Payment state, projection balances, posted reversal, JV registry, audit and outbox commit together. Concurrent retries create one reversal/event. |
| B05: paper payer without account cannot claim | Guidance appears when choosing paper + personal advance. No guessed payer or expanded eligibility. This remains an explicit v1 boundary. |
| B06: source locks and approver rules | Retained. Actual API rejects editing a submitted source. RB reject/reopen and finance-return paths remain available to the correct user. |
| B07: browser baseline failed | Corrected policy DTO, branch selection and manager fixture. Local Next server used its actual hostname; no product configuration workaround. Verified cancelled view-only and editable Back 3→2→1 paths. |
| B08: compatibility/acceptance absent | Local additive migration, identity, concurrent mutation and reverse-flow evidence now exists. Full target-environment acceptance remains separately listed below. |

Additional defects found and corrected during implementation:

- Manual create now saves header, lines, audit and committed number together. Tenant/key/actor/payload/branch scope are checked on replay. A deleted numbered draft cannot be recreated by replaying its key.
- Lost save responses retain the exact command in the open manual form. Changed or cleared inputs cannot block retry or create a second expense. Upload after recovery uses the returned expense's branch. Explicit 400/422 validation refusal allows correcting the payload.
- Same-number confirmation and audit are atomic. Existing Serializable isolation remains, with at most five attempts for rolled-back P2034 conflicts only.
- EXP allocations serialize per company, including custom monthless templates. Retained registry/expense numbers supply a high-water mark: imported `00100` with no registry is retained and the next number is `00101`. No decrement or gap reuse.
- The LINE detail link `/reimbursements/:id` previously returned 404. A redirect now opens the existing permission-checked `?focus=:id` drawer.
- Date labels distinguish document date from payment date; null EXP has explicit text, vendor receipt numbers are not presented as EXP, and detail supports copying EXP.

## Environment and identity

- Isolated branch `codex/expense-running-number-20260911`, based on `origin/main` `8f988a16`. Worktree `/tmp/mangmee-expense-running-number-20260911`; unrelated dirty shared checkout was not edited.
- Fresh locked offline dependencies, generated Prisma client, built contracts/config and fresh API build. API 3011 / web 3012; Redis DB14 and local MinIO. This is a local dirty-source build, not a release artifact or deployed SHA attestation.
- Working DB `expense_number_impl_20260911` cloned from local `reimbursement_source_review`; second independent restore `expense_number_impl_migration_20260911` used only for additive migration rehearsal. Existing review servers/DBs were untouched.
- Tests use synthetic company/user/document data. Direct repository fixtures deliberately isolate launch/tax or workflow prerequisites where stated. No real OCR/LINE provider or live ledger worker is claimed.
- `manifest.json` records source/evidence hashes. Raw browser traces, cookies, bearer credentials, presigned URLs and the environment runner are excluded.

## Verification results

Counts below refer to distinct suites/flows; do not add overlapping reruns.

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| Focused domain/use-case/repository mock checks | **149 pass**, 0 fail/skip | `focused-final.log`: sequence/branch, expense permissions/tax confirmation, LINE grounding/security, rendering and reimbursement void/mirror. These are not PG integration tests. |
| Real PostgreSQL integration | **70 pass**, 0 fail/skip | `postgres-final.log`: 13 new numbering tests + 31 SRC edit + 7 funding + 16 RB race/source + 3 existing migration compatibility. Allocation, rows, constraints, rollback and concurrency use real PG. |
| Final allocator check | 27 pass | `allocator-highwater.log` is an earlier overlapping subset: 12 PG + 15 mocks. The final 70-test run includes the extra multi-month projection test. |
| Cancelled SRC DIGITAL/PAPER | **2 pass** | `cancelled-src.log`: desktop/mobile view-only, no revision/edit business writes, historical preview access. Baseline already contained the product fix. |
| Editable SRC DIGITAL/PAPER | **2 pass** | `editable-src.log`: Back 3→2→1 keeps values; no-op navigation retains signed metadata; source/certificate edits retain the same EXP/SRC; actual paper download. |
| Existing reimbursements | **6 pass** | Six tests in `reimbursements-and-old-link.log`; the seventh, separate new linked test failed on the now-fixed detail-route 404. Do not label this entire historical run green. |
| Linked source journey, latest backend | **1 pass** | Linked test in `linked-final-and-retry-validation.log`: reject/reopen/edit → submit/approve → finance NEEDS_INFO/edit → resubmit/approve → August projection → pay/retry → void/retry → cancel. Browser checks cover direct link/edit and mobile finance return; most mutations use real API. `linked-api-summary.json` contains reduced status observations. |
| Manual response-loss + staged date review | **2 pass** | `save-ui-final.log`: actual save succeeds, first response is dropped, required input is cleared, retry recovers the same ID/EXP/payload. Staging has no EXP; explicit Aug date review issues Aug EXP; July correction retains it. No external OCR called. |
| Migration rehearsal | **13 tables equal**, 0 backfilled rows | `migration-result.json`: all before/after hashes equal excluding the two added nullable columns. 37 expenses, 33 SRC, 2 RB; payments/journals are not all populated cohorts in this clone. |
| Actual paper PDF | Passed visual inspection | `paper-form.pdf`: SRC-202608-00006 and EXP-202608-00007 visible separately, Thai text and layout readable after Poppler rendering. New rendering only. |
| Responsive/text checks | Passed tested layouts | `expense-number-1440.png`, `expense-number-390.png`, `expense-number-large-text.png`: no horizontal overflow, 200% root text, keyboard Tab exercised. This is not full WCAG or real participant approval. The intentionally injected network-error toast can still be visible briefly in immediate post-recovery screenshots; the persisted row/EXP and original data are verified separately. |
| API/web typecheck + API build | Passed | `typechecks.json`, `api-build.log`; API tsc needed a larger local heap. No package.json edits. |

The final new PG suite includes number/audit/line rollback, retained imported/deleted numbers, closed-period confirmation, legacy signed snapshot preservation, flag-off compatibility, simultaneous confirmation and a two-month/two-projection rollback/retry. The posted payout test seeds a real POSTED journal, verifies closed-period refusal and injected-outbox rollback, then verifies one balanced reversal/JV/audit/event under three concurrent voids. It does **not** run a real ledger worker from capture to posting.

Failures used during diagnosis are retained honestly. Early Next hydration failures were resolved by a fresh install and correct local hostname. The final manual retry negative case also exposed native `required` validation intercepting a replay; the retry button now bypasses that local validation only when replaying its already-validated command. `save-ui-final.log` proves the correction. A PG fixture previously used an actor ID without a User row; the fixture now creates that user and asserts the real atomic confirmation audit.

## Reproduce

Use a disposable **local** PostgreSQL database and local object storage with synthetic seed identities. Generate the Prisma client and apply migrations through the repository's normal migration history. Do not point these mutation tests at customer environments. The local environment wrapper is intentionally not checked in because it reads local credentials.

With `DATABASE_URL` and repository test env configured:

```sh
EXPENSE_NUMBER_PG_TEST=1 REIMBURSEMENT_PG_GATE_REQUIRED=true pnpm --filter @watchdog-bms/api exec tsx --test src/modules/expenses/infrastructure/expense-number.pg.spec.ts src/modules/expenses/infrastructure/substitute-expense-edit.pg.spec.ts src/modules/expenses/infrastructure/substitute-funding.pg.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts

pnpm --filter @watchdog-bms/api exec tsx --test src/modules/data-model-core/infrastructure/repositories/document-sequence-branch-collision.spec.ts src/modules/data-model-core/infrastructure/repositories/prisma-document-sequence.repository.spec.ts src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts src/modules/expenses/domain/logic/line-draft-update.logic.spec.ts src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts src/modules/reimbursements/application/use-cases/reimbursement-branch-scope.use-case.spec.ts src/modules/reimbursements/application/use-cases/void-reimbursement-payment-reversal.use-case.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.payment-mirror.spec.ts

NODE_OPTIONS=--max-old-space-size=10240 pnpm --filter @watchdog-bms/api exec tsc --noEmit
pnpm --filter @watchdog-bms/web exec tsc --noEmit
pnpm --filter @watchdog-bms/api build

EXPENSE_NUMBER_LIVE=1 pnpm exec playwright test --project=chromium --workers=1 e2e/expense-number-save.spec.ts
SUBSTITUTE_NAVIGATION_LIVE=1 S3_E2E=1 pnpm exec playwright test --project=chromium --workers=1 e2e/substitute-editable-navigation.spec.ts e2e/substitute-cancelled-view-only.spec.ts e2e/reimbursements.spec.ts
```

Set API `EXPENSE_DRAFT_NUMBERING_ENABLED=true` and use compatible local launch attestation. The local web command was `next dev --webpack --hostname 127.0.0.1`, not a change to `next.config`.

For the linked fixture, copy `fixture-seed.probe.ts` to `apps/api/expense-number-impl-seed.ts`, then run `pnpm --filter @watchdog-bms/api exec tsx expense-number-impl-seed.ts <unique-suffix>`. Its guards require the named local DB and local S3. Run the linked test with `EXPENSE_NUMBER_LIVE=1 EXP_PROOF_UI=1 EXPENSE_NUMBER_SOURCE_ID=qa-exp-number-impl-<unique-suffix>` and `E2E_API_BASE_URL=http://127.0.0.1:3011/v1`. Seed identities/branch must exist; use a new suffix because this journey ends cancelled. Test policy changes are restored with the latest revision token.

For migration rehearsal, restore a pre-change clone to `expense_number_impl_migration_20260911`, copy `migration-rehearsal.probe.ts` to `apps/api/expense-number-impl-migration.ts`, and run from `apps/api` using the configured local impl DATABASE_URL. This probe redirects to the second clone, executes only the new additive SQL and compares raw rows. It is a one-run probe, not an idempotent production migration runner. Production rollout must use Prisma migration history; do not execute this probe there.

## Release boundaries and remaining acceptance

Implemented local behavior does not establish “every possible route never blocks.” Permission, source ownership, linked claims and closed periods intentionally refuse disallowed mutations; those guards were retained.

| Scope | Local evidence / remaining work |
| --- | --- |
| L01–L05 navigation/edit/lock/reject/return | Tested PG/API and selected desktop/mobile browser paths. End-to-end historical signed-file retrieval across every prior version still needs target data. |
| L06 source unlink/reselect | Existing source guards retained; this complete browser interaction was not newly proven. |
| L07 multiple projections/months | New real PG test proves per-line month, second-allocation failure rolls everything back, concurrent retry reuses each projection. Live browser journey used one source. |
| L08 partial cancellation / L09 payout reversal | Single-source cancel and repeated pay/void pass live API. Posted reversal and closed period pass seeded PG. Real worker posting plus interruption partway through cancelling several posted projections remains a release check. |
| L10–L11 SRC restrictions / closed periods | Cancelled view-only and linked-source guards pass. Closed-period tests do not automatically reopen periods or bypass accounting permissions. |
| L12–L14 legacy/migration/rollback | Additive no-backfill rehearsal and legacy compatibility suites pass. Full cohorts A–H, old deployed clients, queued external jobs, mixed-version cutover and real downgrade/replay need the intended target environment. Flag OFF preserves existing EXP; the old overwrite-on-confirm runtime is not a valid rollback target. |
| L15 no-account paper payer | Explicitly unsupported for linked reimbursement in v1; choose supported digital/account-linked workflow. No inferred beneficiary. |
| L16 discoverability/permissions/module combinations | Branch/actor/tenant checks pass and the missing detail link is fixed. Full search/export and expenses OFF/reimbursements ON browser matrix remain target acceptance. |

Other limits: the pending manual command is kept in the currently open form, not durable storage across refresh/closed tabs. Old clients that omit the optional idempotency key cannot guarantee the same replay identity across a new HTTP request; compatibility rollout must refresh/retire those clients. Users must check the expense list after abandoning an uncertain save before creating another. No manual renumber or automatic deleted-number reuse is enabled. Historic numbers that have no surviving row/registry/counter cannot be reconstructed by the allocator. Production-size performance of the retained-number query and real older/nontechnical participant feedback remain unmeasured.

Before activation: inventory/reconcile the authorized target data, deploy additive schema and compatible writers everywhere, validate the remaining target journeys, then enable draft issuance. Follow the mandatory deployment runbook if a release is requested. Turning the flag off stops new draft issuance while keeping every already-issued EXP and the compatible confirmation behavior.

Cleanup: stopped only task-owned API 3011/web 3012 after checks and restored generated `next-env.d.ts`. Cloned databases and evidence remain for reproduction. No package.json, shared checkout, existing review server, customer gate or cloud environment mutation.
