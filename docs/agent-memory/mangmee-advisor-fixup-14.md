# Agent Memory: mangmee-advisor-fixup-14

Status: implementation and sandbox verification complete; uncommitted diff. No live release/acceptance.
Owner: Codex, one lane, ponytail full.
Scope: U1–U4; docs/specs/mangmee-advisor-fixup-14-spec.md. Preserve J1–J5 through existing regression suites.

Decisions:
- U1: inventoried all three expense-vendor autosave callers and all five ReceiptOcrApply callers. The shared registry use case skips transfer-slip source/OCR types before lookup/write/audit. Draft saves guard stored/requested type and saved classification. LINE post-commit saves guard target type/classification. OCR apply additionally guards saved classification, and callers pass available OCR classification explicitly. CreateExpenseDraft, capture handoff and createExpense do not create registry counterparties; explicit registry/supplier/customer commands retain their existing guards.
- U2: approved-product-help's WHT/voucher cards are DRAFT/access-restricted, so definitions use the existing general-knowledge model composer. Bounded meaning/why questions become general subrequests, including a read/help misclassification, before prepared-read dispatch. No shop tool runs. Append owner-requested 1,999-baht package note when feature absent; package-page button requires company.plan.manage. Shop data and issuance remain subject to existing package/permission guards. No budget contract or model-free route change.
- U3: both shared substitute templates now use the exact owner-provided web-signing sentence; old sentence absent from application/contracts sources.
- U4: parsed acceptedValues.payeeName wins over expense vendor in preparation cards and every shared continuation/selection/resume label. Prepared evidence payee is authoritative for web signing. Regression uses คุณเอ อินฟลู versus expense vendor อินฟลู.
- Refreshed existing W00 artifact with its existing generator; only webhook hash, digest and checkout/generation metadata changed. No capability changes.
- No package.json edits, dependencies, new flags, final-mutation/budget changes, commits, process termination, cloud actions or deployment.

Open questions:
- Full suites are not all green: 37 pre-existing API failures remain (2 listen EPERM, 35 existing fixture/undefined get/add/has failures), plus gateway 46 and API-extra 38 cancellations. All remaining failed/cancelled names, failure types, codes and messages reproduce identically on exact starting commit 614286776c7d15b509d5e3ba8becf0454fd85f6b, after normalizing checkout paths. Table-driven delivery's 27 failures are a subset of the 35, not additional failures.
- Sandbox has no network/Docker/live LINE or database acceptance. J1–J5 have not been replayed against live providers in this turn.

Artifacts:
- Scoped spec above and /private/tmp/fixup-14-last-message.md (at most 40 lines).
- /tmp/fx14-inventory.py and /tmp/fx14-*-specs.json: 516 API declared pretest/test files, 220 transitive API importers, 64 additional files; 580-file union includes required DI and table-driven frozen delivery.
- /private/tmp/fx14-base-614286776: exact git archive baseline, identical installed dependencies/generated Prisma/unchanged contracts output; no Git checkout mutation.
- /tmp/fx14-baseline-comparison.json: zero new failed/cancelled entries across API, extra, gateway and required delivery suites.

Verification:
- pnpm --filter @watchdog-bms/contracts build: PASS (/tmp/fx14-contracts-build.log).
- pnpm --filter @watchdog-bms/api typecheck and pnpm --filter @watchdog-bms/ai-gateway typecheck: PASS; final gateway command returned exit 0.
- Tests use pnpm --filter <pkg> exec node --import tsx --test <declared files>; broad runs add --test-concurrency=4. Full-suite runners and inventories are /tmp/fx14-run-suites.py, /tmp/fx14-run-extra.py, /tmp/fx14-inventory.py.
- Contracts full test list: 419 pass, 0 fail (/tmp/fx14-contracts-full.log).
- Gateway full test list: 1,684 pass, 0 fail, 46 cancellations; base 1,674 pass, identical cancellations (/tmp/fx14-gateway-full-final.log, /tmp/fx14-base-gateway-full.log).
- API full pretest/test list: 11,242 pass, 2 fail, 303 skipped; base 11,235 pass, identical failures/skips (/tmp/fx14-api-full-final.log, /tmp/fx14-base-api-full.log).
- API additional importer/required specs: 497 pass, 35 fail, 38 cancelled, 12 skipped; base identical (/tmp/fx14-api-extra-final.log, /tmp/fx14-base-api-extra.log).
- Eight changed registered API specs: 1,544 pass, 0 fail (/tmp/fx14-focused-api-final.log); includes imported substitute continuation specs. Changed gateway specs: 123 pass, 0 fail (/tmp/fx14-focused-gateway-final.log).
- Real-module DI + delivery-plan logic: 32 pass, 0 fail (/tmp/fx14-di-final.log).
- DI + delivery-plan logic + table-driven frozen delivery: 46 pass, 27 fail; exact base identical (/tmp/fx14-di-delivery.log, /tmp/fx14-base-di-delivery.log).
- W00 regenerated through existing UPDATE_LINE_AI_CAPABILITY_MANIFEST mode, then rerun without update mode: 5 pass, 0 fail (/tmp/fx14-manifest-final.log).
- git diff --check: PASS. No package.json diff. New regressions are in already-registered test files.

Next: review/integrate the diff, then rerun harness J1–J5 and U1–U4 in the authorized live environment; sandbox evidence is not deployment acceptance.
