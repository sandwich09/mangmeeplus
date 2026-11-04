# Expense trust and money fixes — implementation plan

Status: DRAFT — Re-anchored to develop e7c422802 on 2026-11-04; controller accepted R1–R12 and P01–P14 against code 2026-11-04; documents only; no implementation, failing test execution, database proof or browser proof yet; owner answers recorded 2026-11-04
Owner: Expense trust and money documents lane; controller assigns implementation ownership
Related: `docs/specs/expense-trust-and-money-fixes-spec.md` (requirements, complete design, evidence, impact, risks and acceptance); source-design mapping in §2 below
Baseline: HEAD `e7c4228026eec3c696fa76986420d2c97cb26676`, tree `1034bf4789c15b460ff2e293be912142f62954c9`, local worktree read on 2026-11-04; replaces `0f938a361`; no network research; source documents identified by section because other lanes are editing them

## 1. Ordered commit map

File keys resolve to exact paths in §3; test keys resolve to exact registered files in §4. Each row is one commit, including its tests. R-ids and AC-ids refer to the companion spec; its §2 is the canonical requirement → opened evidence/quote → step → named test → acceptance → discovery-source table. Do not combine unrelated fixes into one commit.

| Fix / requirement | Owner step / plan step | Commit-sized change | Production files | Tests | Acceptance |
|---|---|---|---|---|---|
| F2 / R2 | 1 / P01 | Check deletion branch before retention details or mutation | D-delete | T2 | AC2 |
| F1 / R1 | 1 / P02 | Bind pending completion to uploader and branch | D-complete | T1, T4, T5, T7 | AC1 |
| F3 / R3 | 1 / P03 | Reuse expense-detail read scope before extraction | E-extract; E-module only if wiring needs it | T3 | AC3 |
| G2 / R11 | 1 / P13; round 1 | Reject paid out-of-scope upload branch before reservation; preserve existing free source boundary | D-intent | T19, T4, T5, T7, T20 | AC11 |
| G3 / R12 | 1 / P14; round 1 | Reuse expense detail and financial-access boundaries before signature fill | E-signature; E-module only if wiring needs it | T20 | AC12 |
| F5 / R5 | 1 / P04 | Typed choices offer a decision-bound signed card; verified apply alone prepares | E-continuation, L-substitute-action, L-webhook | T9, T7 | AC5 |
| F4 / R4 | 1 / P05 | Replace unsafe PDF regex scanning with bounded strict token inspection | D-logic, D-complete, L-webhook, L-file-answer, W-error; S-m14 existing expectation only | T6, T1, T7, T8, W1 | AC4a |
| F4 / R4 | 1 / P06 | Add narrow receipt XML policy and carry it through capture/LINE parking | D-logic, D-complete, E-upload, E-capture, L-webhook, L-file-answer, W-error | T6, T1, T4, T5, T7, T8, W1, J1 | AC4b, AC4c |
| F6 / R6 | 2 / P07 | Classify current v2 calls before paid settlement; regression-prove existing free usable-persistence/refund rules | G-provider, G-budget, G-router, G-semantic, G-qa, G-controller; G-usage only if tagging needs adjustment; free quota/source writers read-only | G1–G3, T10, T3, T7, T21 | AC6 |
| F8 / R8 | 3 / P08 | Count a document's uncertified remainder; correct the mixed-count labels | L-advisor, C-ai-tools | T13 | AC8 |
| F7 / R7 | 3 / P09 | Apply linked-source replacement to the full filtered population in one snapshot | E-repository | T11, T12 | AC7 |
| F9 / R9 | 3 / P10 | Stage category in continuation; commit it only on verified decision using CAS | E-continuation, L-substitute-action; E-repository only for the existing CAS return contract | T9, T14, T7, J2 | AC9 |
| F10 / R10 | 4 / P11 | Share live source blockers across month/export/filed checks and retire obsolete WHT issues | X-validation, X-month, X-export, X-controller, X-sync, X-repository; X-establishments/X-state only for source partition/identity reuse | T15–T18 | AC10a–c, AC10e |
| F10 / R10 | 4 / P12 | Show permitted correction and historical omission states without changing filed bytes | W-withholding, X-month; C-tax only if DTO projection cannot express the required warning | W2, T15, T16, J3 | AC10b, AC10d, AC10e |

**Round 1: P01, P02, P03, P13, P14** (five independent guard commits). **Round 2: P04, P05, P06, P07, P08** (five commits). **Round 3: P09–P12** (four commits plus integration proof). P13/P14 belong to owner step 1, despite retaining appended IDs for other lanes. Round boundaries are review points; security/file safety is not complete until P01–P06 and P13/P14 pass. Small guards precede the scanner; the pure WHT projection precedes aggregate database work within owner step 3. No new feature implementation is bundled.

## 2. Source designs, dependencies and non-duplication

- R1/R2 reuse `docs/specs/receipt-authenticity-signals-spec.md` §13 B4/B8 and §18 MC7. Completion is **uploader only plus branch scope**; callers create/resume/complete with the same actor (companion §3.4). A reviewer can complete their own replacement upload. File ownership is not inferred from record edit permission.
- R3 consolidates `docs/specs/accountant-export-cleanup-spec.md` B26 / Phase S. Inject existing `GetExpenseUseCase`; do not invent another permission matrix or require a new permission key.
- R4 reuses `docs/specs/e-tax-invoice-email-intake-spec.md` §10.5 and its plan **P1 plus P2.1**. P1 explicitly keeps receipt policy strict (source plan §P1); the XML exception is §2.1. This plan preserves the synchronous compatibility export and uses no new dependency. No email intake, signature validation, XSD tax extraction or C2PA work.
- R5/R9 together discharge workflow-first **A10**, split around the owner's security/number order. The current `docs/plans/line-ai-workflow-first-plan.md` §A10 explicitly moves its work to P04/P10 here. P04 retains the failing-test-first requirement; A10 is not complete after P04 alone.
- R6 discharges workflow-first **A9**, now explicitly moved to P07 in that plan's §A9. No dependency on A1's future budget profile, M-series evaluation budget, A2 postback/router, A3–A6 workflows or A7 task-run schema. Use the existing signed substitute action token, not the proposed general workflow token. Do not move the webhook dispatcher while fixing these guards. Later A2–A8 reuse these tested boundaries, with no duplicate settlement/confirmation logic.
- R7 takes only `docs/specs/expense-budget-and-limits-spec.md` §5.2's filtered-population linked-source correction / B7. No budget, limit, alert, branch allowance or new summary endpoint.
- R8 reuses `docs/plans/e-withholding-tax-payment-plan.md` §4.3's remainder projection / spec B13. R10 reuses its §2.3 and decision 19 / spec §7.4, B11/B12, BL2/BL3. Neither depends on `whtRemittance` or an e-WHT setting.

R11/R12 promote this spec's G2/G3 to owner step 1 (moved to R11/R12 2026-10-26). P13 uses the already imported branch helper; P14 uses existing detail and financial-access helpers. Neither adds a permission, dependency or schema.

**Develop disposition:** companion §1.1 records every requirement's free/paid coverage and opened current evidence. `049aa51de` already protects free source upload branch/provenance, restricts free extraction to own mutable drafts, and commits/refunds free OCR by usable persistence. Adapt P03/P13 and retain those checks; P07 adds free regression proof, not another quota implementation. R7 remains unfixed after repository history/date/free changes; draft replay is now `prisma-expense.repository.ts:905`–915 and payment replay is `:683`–705, both outside P09. R1/R2/R4/R5/R8/R9/R10/R12 remain current defects. Preserve `9036b8552` welcome/advisor, `1fbba874e`/`884ba5307` history, `3f6db1729` delivered-confirmation suppression and `48295b57c` picker commands; no repeated feature work. No original requirement is dropped; the free portions are narrowed to existing-behavior acceptance.

Technical dependencies: P01/P02/P03/P13/P14 independent; P04 independent; P05 independent of card/billing work; P06 depends on P02/P05; P07 has no code dependency on P04/P06 but ships after all owner-step-1 work; P08/P09 independent; P10 depends on P04; P11 independent of future tax work; P12 depends on P11. P14 uses the existing reader, not P03's injection, so it need not wait for P03 implementation. Rebase/retest shared files after adjacent steps; no concurrent agent edits or legacy role gates.

## 3. Exact production file locator

These keys avoid repeating long paths in every step. Existing functions are named in the step/spec. A shortened filename in the spec resolves to its unique module path here or to the fully qualified caller table there. Files listed here are **planned implementation targets/references**, not files edited during this documents round. Read-only supporting files remain read-only unless explicitly named as targets in §1.

| Key | Exact file |
|---|---|
| D-delete | `apps/api/src/modules/data-model-core/application/use-cases/delete-attachment.use-case.ts` |
| D-complete | `apps/api/src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.ts` |
| D-logic | `apps/api/src/modules/data-model-core/domain/logic/attachment.logic.ts` |
| D-intent | `apps/api/src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.ts` |
| D-repository (reference) | `apps/api/src/modules/data-model-core/infrastructure/repositories/prisma-attachment.repository.ts` |
| Branch (reference) | `apps/api/src/modules/data-model-core/domain/logic/branch.logic.ts` |
| E-extract | `apps/api/src/modules/expenses/application/use-cases/expense-extraction.use-case.ts` |
| E-detail (reference) | `apps/api/src/modules/expenses/application/use-cases/expense-draft.use-case.ts` |
| E-module | `apps/api/src/modules/expenses/expenses.module.ts` |
| E-upload | `apps/api/src/modules/expenses/application/use-cases/expense-upload.use-case.ts` |
| E-capture | `apps/api/src/modules/expenses/application/use-cases/expense-capture-group.use-case.ts` |
| E-continuation | `apps/api/src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.ts` |
| E-repository | `apps/api/src/modules/expenses/infrastructure/prisma-expense.repository.ts` |
| E-signature | `apps/api/src/modules/expenses/application/use-cases/signature-asset.use-case.ts` |
| E-controller (reference) | `apps/api/src/modules/expenses/presentation/http/expense.controller.ts` |
| L-webhook | `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts` |
| L-substitute-action | `apps/api/src/modules/line-ai/application/line-substitute-receipt-action.service.ts` |
| L-file-answer | `apps/api/src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.ts` |
| L-advisor | `apps/api/src/modules/line-ai/application/use-cases/erp-advisor-document-tools.use-case.ts` |
| L-settle (reference) | `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts` |
| G-provider | `apps/ai-gateway/src/modules/line-ai/infrastructure/provider/provider.port.ts` |
| G-budget | `apps/ai-gateway/src/common/usage/ai-budget-provider.ts` |
| G-usage | `apps/ai-gateway/src/common/usage/usage-context.ts` |
| G-router | `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts` |
| G-semantic | `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts` |
| G-qa | `apps/ai-gateway/src/modules/line-ai/application/document-qa.use-case.ts` |
| G-controller | `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.ts` |
| G-document-read (reference) | `apps/ai-gateway/src/modules/line-ai/agents/document-advisor-read.ts` |
| X-validation | `apps/api/src/modules/tax/application/services/withholding-filing-validation.ts` |
| X-establishments | `apps/api/src/modules/tax/application/services/withholding-establishments.ts` |
| X-state | `apps/api/src/modules/tax/application/services/withholding-filing-state.ts` |
| X-month | `apps/api/src/modules/tax/application/use-cases/generate-wht-report.use-case.ts` |
| X-export | `apps/api/src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.ts` |
| X-controller | `apps/api/src/modules/tax/presentation/http/tax.controller.ts` |
| X-sync | `apps/api/src/modules/tax/application/use-cases/sync-tax-events.use-case.ts` |
| X-repository | `apps/api/src/modules/tax/infrastructure/repositories/prisma-tax.repository.ts` |
| X-source (reference) | `apps/api/src/modules/tax/infrastructure/adapters/expense-source.adapter.ts` |
| X-handoff (reference) | `apps/api/src/modules/tax/application/use-cases/wht-certificate-handoff.use-case.ts` |
| C-tax | `packages/contracts/src/tax.ts` |
| C-ai-tools | `packages/contracts/src/ai-tools.ts` |
| W-error | `apps/web/src/common/api/api-error-message.ts` |
| W-withholding | `apps/web/src/features/tax/WithholdingPage.tsx` |
| S-m14 | `scripts/m14-scanner-evidence.ts` (only existing unsupported-embedded reason expectation, if the scanner string changes) |
| D-free (reference) | `apps/api/src/modules/data-model-core/application/use-cases/free-expense-attachment.ts` |
| E-commercial (reference) | `apps/api/src/modules/expenses/application/expense-commercial-access.ts` |
| E-read-runner (reference) | `apps/api/src/modules/expenses/application/services/expense-capture-read-runner.service.ts` |
| E-ocr-apply (reference) | `apps/api/src/modules/expenses/application/services/receipt-ocr-apply.service.ts` |
| L-free-quota (reference) | `apps/api/src/modules/line-ai/application/free-expense-quota.ts` |
| L-ocr-governance (reference) | `apps/api/src/modules/line-ai/application/company-ocr-governance.ts` |
| Free-access (reference) | `apps/api/src/modules/system-partner-management/application/free-expense-access.ts` |

## 4. Registered tests and command definitions

API paths below are relative to `apps/api/`. Registration counts were actually checked in this documents round with **`grep -c "<relative file>" apps/api/package.json`**. A positive count means at least one package script lists the file; it is not runtime evidence. Every new API case belongs to one of these existing files. Do not create an unregistered `.pg.spec.ts` or edit package.json to register one.

| Key | Exact API spec file | grep count | Real PostgreSQL for this plan? |
|---|---|---|---|
| T1 | `src/modules/data-model-core/application/use-cases/complete-attachment-upload.use-case.spec.ts` | 1 | No; permission/storage spies and scanner integration |
| T2 | `src/modules/data-model-core/application/use-cases/delete-attachment.use-case.spec.ts` | 2 | No; precondition plus existing retention tests |
| T3 | `src/modules/expenses/application/use-cases/expense-extraction.use-case.spec.ts` | 1 | No; scoped reader and zero side effects |
| T4 | `src/modules/expenses/application/use-cases/expense-upload.use-case.spec.ts` | 1 | No; identity and policy propagation |
| T5 | `src/modules/expenses/application/use-cases/expense-capture-group.use-case.spec.ts` | 1 | No; identity, replay and policy propagation |
| T6 | `src/modules/data-model-core/domain/logic/attachment.logic.spec.ts` | 1 | No; bounded byte fixtures/corpus |
| T7 | `src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts` | 2 | No; actual webhook dispatcher with controlled dependencies |
| T8 | `src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.spec.ts` | 1 | No; reason-to-recovery text mapping |
| T9 | `src/modules/expenses/application/use-cases/substitute-receipt.use-case.spec.ts` | 2 | No; continuation + signed action integration cases added here |
| T10 | `src/modules/line-ai/application/company-ai-usage-meter.spec.ts` | 1 | **Yes**, add settlement/holds/idempotency cases using this file's real-PG setup pattern (`:263` onward currently tests OCR admission) |
| T11 | `src/modules/line-ai/application/use-cases/erp-business-tools.use-case.spec.ts` | 2 | No; tool fact/permission projection |
| T12 | `src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts` | 1 | **Yes**, extend existing real-PG block (`:415` onward) for the three readers |
| T13 | `src/modules/line-ai/application/use-cases/erp-tax-tools.use-case.spec.ts` | 3 | No; handoff paging/permission/Decimal fixtures |
| T14 | `src/modules/expenses/infrastructure/prisma-expense.repository.substitute-payment.spec.ts` | 1 | **Yes**, extend existing real-PG block (`:174` onward) for category CAS |
| T15 | `src/modules/tax/application/use-cases/generate-tax-filing-package.use-case.spec.ts` | 2 | No for use-case matrix; transaction proof is T18 |
| T16 | `src/modules/tax/presentation/http/tax.controller.spec.ts` | 2 | No for controller/redaction matrix; transaction proof is T18 |
| T17 | `src/modules/tax/application/use-cases/sync-tax-events-wht-form.use-case.spec.ts` | 1 | No for lifecycle fixture matrix; persistence proof is T18 |
| T18 | `src/modules/tax/infrastructure/repositories/prisma-tax.repository.spec.ts` | 1 | **Yes, add a real-PG block to this registered file**; existing fake db at `:23`–32 is insufficient |
| T19 | `src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.spec.ts` | 1 | No; branch/commercial/source/reservation fixtures and zero-side-effect spies |
| T20 | `src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` | 1 | No; real detail reader with scoped repository fixture; signature preconditions and forwarding |
| T21 | `src/modules/expenses/application/services/expense-capture-read-runner.service.spec.ts` | 1 | No; free unusable/usable checkpoint and terminal paths; real quota transaction proof is T10 |

All new named tests are specified in the spec's trace table. Keep those `R<n>` names as stable acceptance handles; additional boundary cases may be nested cases under them. T7 also names `R1 LINE completion preserves uploader identity`; T5 adds `R4 capture completion uses receipt policy`.

R6 free regression name: `R6 free unusable OCR preserves allowance and usable persistence consumes once`, in **T3, T7, T21** (web/LINE/PDF use-case paths) and **T10** (real PostgreSQL transaction/refund/month/source identity). Reuse the existing free helpers and a source write in the same transaction; prove rollback and duplicate compensation, not a mock counter. T7 also adds `R5 R9 retain free deterministic gates and accepted delivery suppression`, including company selection between buffered turns. R11 forwarding tests use the same trace-table name in T4/T5/T7/T20. No new test file is needed.

| Key | Exact other test / journey file | Scope / proposed test name |
|---|---|---|
| G1 | `apps/ai-gateway/src/common/usage/ai-usage.interceptor.spec.ts` | `R6 unusable output is classified before settlement`; all invocation profiles, counters, repair, timeout |
| G2 | `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts` | `R6 invalid router and QA outputs preserve repair` (router portion); also invoke semantic runner for planner/public/compose acceptance |
| G3 | `apps/ai-gateway/src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts` | `R6 invalid router and QA outputs preserve repair` (QA portion); `R6 public general rejects are absorbed` |
| W1 | `apps/web/src/common/api/api-error-message.spec.ts` | `R4 uninspectable and embedded PDFs give truthful recovery` |
| W2 | `apps/web/src/features/tax/WithholdingPage.spec.ts` | `R10 source-only blockers and historical warnings preserve permitted actions` |
| J1 | `e2e/journeys/staff-receipt-from-phone.journey.spec.ts` | `R1 R3 R4 own receipt survives completion extraction and refusal recovery` |
| J2 | `e2e/journeys/no-receipt-certificate.journey.spec.ts` | `R5 R9 signed continuation applies the reviewed category` |
| J3 | `e2e/journeys/withholding-forms.journey.spec.ts` | `R10 missing payee data blocks paper and filing with a correction path` |
| J4 | `e2e/journeys/claim-declined-then-paid.journey.spec.ts` | Existing claim/receipt regression; `R1 own claim upload remains usable` |

Gateway files are listed in `apps/ai-gateway/package.json:12`; web `.spec.ts` files match `apps/web/package.json:10`. Browser tests prove screens; webhook/card tests prove LINE message routing. Neither substitutes for the other.

**Commands, used by every step below:**

- **API(Tn):** `pnpm --filter @watchdog-bms/api exec node --import tsx --test <Tn relative file from table>`. Expand the path; run the whole registered file, including its existing tests.
- **API-PG(Tn):** same command against an isolated local PostgreSQL database. T12/T14 use `EXPENSE_PAYMENT_REQUIRE_POSTGRES=true` and local `DATABASE_URL`; T10's existing pattern uses `OCR_REQUIRE_POSTGRES=true` and `DATABASE_URL` (`apps/api/src/modules/line-ai/application/company-ai-usage-meter.spec.ts:263`–278). Reuse the repository's `pgSpecUnreachableReason` guard for new T18 cases inside the registered tax file, requiring the local DB for acceptance. Record executed case counts and **zero PG skips**; a successful process containing skipped PG cases is not acceptance. These test-only variables are not product feature switches.
- **Gateway(Gn):** `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test <path relative to apps/ai-gateway>`. Typecheck: `pnpm --filter @watchdog-bms/ai-gateway typecheck`; rebuild runtime: `pnpm --filter @watchdog-bms/ai-gateway build:agentcore` (existing script `apps/ai-gateway/package.json:8`).
- **Web(Wn):** `pnpm --filter @watchdog-bms/web exec node --import tsx --test <path relative to apps/web>`.
- **Type checks:** `bash scripts/local-proof/tsc.sh api` and, for any changed screen/error handling, `bash scripts/local-proof/tsc.sh web`.
- **Schema proof:** `pnpm --filter @watchdog-bms/api exec prisma validate --schema prisma/schema.prisma`; if the isolated proof environment lacks the current generated client, `pnpm --filter @watchdog-bms/api exec prisma generate --schema prisma/schema.prisma`. No schema change/migration is planned. A demonstrated need for one must amend this design first; any migration must be additive.
- **LINE integration:** `node scripts/run-line-ai-whole-chain-acceptance.mjs`. Keep existing catalog checks unchanged unless an existing entry needs the corrected expectation; new API cases stay in the registered files above. Run once per integrated LINE round before handoff, and again only after a relevant change/failure.
- **W00 parity:** existing `apps/api/src/modules/line-ai/line-ai-capability-manifest.spec.ts:75`–87 checks hashes. If changed source hashes require regeneration, implementation runs `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`, reviews `docs/research/mangmee-ai-capability-manifest-2026-09-27.json` (artifact path at `line-ai-capability-manifest.ts:38`), then repeats without UPDATE. Add **no new tests** to this unregistered file. No artifact regeneration occurs in this documents round.
- **Browser(Jn):** `pnpm exec playwright test <exact journey path> --project=chromium --workers=1` against the isolated local proof stack. Exercise each changed screen at 390, 1280 and 1556 px by setting viewport in the journey's width cases; capture and inspect all three. Do not change package scripts or global config merely to select widths.

Registration pitfalls rechecked on 2026-11-04: `company-ai-budget-reservation.pg.spec.ts`, `erp-source-reliability.pg.spec.ts`, `receipt-truth.pg.spec.ts`, `expense-capture.pg.spec.ts`, `line-draft-update.pg.spec.ts`, `substitute-expense-edit.pg.spec.ts`, `line-substitute-receipt-continuation.use-case.spec.ts`, and W00 still have zero package-list matches. Newly relevant `src/modules/data-model-core/application/use-cases/free-expense-attachment.spec.ts` and `src/modules/line-ai/application/free-expense-quota.pg.spec.ts` also return **0** from `grep -c`; do not add tests there. Existing whole-chain coverage may execute some files; that does not change the registration rule. Free PG cases go into registered T10 with its required local-DB setup, not the unregistered free spec's separate environment variable.

## 5. Commit instructions and proof

### P01 — deletion scope (R2; no dependency)

Add T2's failing cross-branch case before the guard. Change `DeleteAttachmentUseCase.execute` immediately after tenant lookup, before retention queries. Reuse `isBranchInScope` and DENIED audit; retain reviewer deletion and retention. Confirm hidden retention information is never returned on branch denial. Run **API(T2), API typecheck**. Accept AC2; risk is inadvertently making deletion uploader-only.

### P02 — uploader completion (R1; no dependency)

Add T1's uploader/branch/tenant matrix, then guard `CompleteAttachmentUploadUseCase.execute` before status/storage. Reuse intent resume's semantics. Update unrealistic test fixtures with the real uploader; do not add a bypass. Add identity propagation cases in T4/T5/T7 covering reviewer-own upload, own LINE uploads, central signatures, capture resume and supported ACTIVE replay. Run **API(T1/T4/T5/T7), API typecheck**. Check every caller in spec §3.4; do not fix the unrelated ACTIVE resume defect G1 inside this commit. Accept AC1.

### P03 — extraction read scope (R3; independent)

Add T3's JPEG/PDF denial cases first. Inject `GetExpenseUseCase` into `RequestReceiptExtractionUseCase`; preserve extraction-specific permission and creator upload access. Normalize only inaccessible-record errors, before storage/PDF queue/provider/admission. Update constructor fixtures and DI if needed. Run **API(T3), API typecheck**. Verify 404/403 handling retains web draft/context and existing navigation; include J1 in integrated browser proof. Accept AC3; no OCR service or capture-worker redesign.

Keep the current free commercial check and creator/DRAFT/NEEDS_REVIEW restriction in addition to the shared reader. Test free creator moved outside branch scope, another creator, non-mutable state and valid free source; paid reviewer/own/related cases remain separate. Preserve free quota callbacks and history; do not replace the whole reader or OCR pipeline.

### P13 — upload-intent branch scope (R11; round 1; no dependency)

First add T19's paid branch-B failure and zero-side-effect assertions; retain free source/mismatch tests as passing controls. Change only D-intent `CreateUploadIntentUseCase.execute`: use the existing `isBranchInScope` import immediately after permission, then existing DENIED audit/403 before commercial/quota/storage/persistence work. Keep current free source derivation, branch mismatch, live membership and LINE reservation validation; no new bypass argument. Central uploads, undefined scope, reviewer-owned replacements and the actual uploader survive. Add T4/T5/T7/T20 forwarding cases for receipt, capture, LINE resume/admitted free source and branchless personal signatures; cross-check all 17 creation/three resume sites in spec §3.5. Generic endpoint catches the untrusted branch; record wrappers retain their own checks. Do not edit unsold callers.

Run `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/data-model-core/application/use-cases/create-upload-intent.use-case.spec.ts`, **API(T4/T5/T7/T20)** and `bash scripts/local-proof/tsc.sh api`. Unit/use-case fixtures suffice; no new DB or schema behavior. Integrated J1/J2/J4 at 390/1280/1556 prove existing upload/recovery paths; no synthetic signature-fill screen. Accept AC11. Risk: wrongly rejecting central signatures or dropping free provenance/reservation data. This commit complements P02 but can be implemented independently.

### P14 — signature-fill record scope (R12; round 1; no dependency)

First add T20's out-of-scope expense with the actor's own ACTIVE signature, with and without a rendered file. In E-signature `FillSignatureUseCase.execute`, retain review/web-only gates, apply existing E-commercial financial gate, then use injected `GetExpenseUseCase` before state/asset/storage/link/fill. Reuse its detail read rules and normalize inaccessible expense as R3 specifies; do not add a separate permission matrix or require `expense.read` alongside review. Keep central/unrestricted behavior, valid reviewer-on-another-creator's-record, own ACTIVE asset and existing state rules. Free direct/stale-review contexts must still fail before writes. Adjust E-module only if constructor wiring requires it, and T20 fixtures; the reader is already a provider.

Run `pnpm --filter @watchdog-bms/api exec node --import tsx --test src/modules/expenses/application/use-cases/expense-document.use-case.spec.ts` and `bash scripts/local-proof/tsc.sh api`. No PostgreSQL needed: this is a precondition over existing persistence; tests spy on optional completion/link, fill and success audit. Retain J1/J2/J4 upload/signing regressions at the three widths; direct fill route has no current UI caller. Accept AC12. Risk: over-restricting reviewer access or accidentally granting free signing. No dependency on P03's implementation; both independently reuse the existing detail boundary.

### P04 — signed final substitute decision (R5; independent)

First run T7/T9 baseline regressions for typed `1`, `2`, `ใช่`; record semantic/clarification route and whether prepare/review/number allocation occurred. Then add server-only `confirmedDecision`, offered decision, token decision/digest, and `rememberSubstituteDeliverySource` propagation. Preserve binding to actor/membership/chat/branch/epoch/revision; old cards need a new offer. FORM does not need ISSUE's reusable signature. Do not change dispatch order or apply A2. Run **API(T9/T7), API typecheck, LINE integration/W00 parity**. Retain existing accepted-result suppression, company-picker command bytes and buffer order; free text must exit before the model/continuation. Run T7's `R5 R9 retain free deterministic gates and accepted delivery suppression`. Accept AC5; R9 remains explicitly open.

### P05 — bounded strict PDF inspection (R4a; independent)

Add adversarial T6 cases before scanner replacement: escaped names, mixed case, NUL, nested strings, fake stream delimiters, incorrect/indirect length, compressed actions, filter/expansion/depth/time limits and decoded URI schemes. Implement the bounded grammar and limits reproduced in spec R4; keep strict synchronous compatibility export. Distinguish proven active/malware from uninspectable/unsupported attachment in D-complete/L-webhook and their current recovery renderers; no false HIGH security alert. All strict consumers continue rejecting embedded content. Run **API(T6/T1/T7/T8), Web(W1), API/web typechecks** and the isolated M-14 proof command `CLAMAV_HOST=127.0.0.1 CLAMAV_PORT=13310 pnpm security:m14-evidence` with the local scanner already available, following `docs/security-evidence/m14-upload-scanner-isolated-corpus.md:20`–32. Its existing embedded-file fixture at `S-m14:74` expects “Active PDF content”; if scanner reason text changes, update only this expectation to the truthful unsupported/uninspectable refusal and record the deliberate difference. Keep rejection and every active-content/EICAR assertion; all new API cases remain in T6. The owner's truthful-message rule supersedes the old source-plan instruction to keep this particular message unchanged. Accept AC4a only. Do not edit banking/CRM files or claim the XML problem fixed yet.

### P06 — receipt-only XML (R4b/c; depends P02/P05)

Implement exactly the spec's 1–2 stream, ETDA-namespace, 3 MiB XML exception, with structural XML recognition and no DTD/entity resolution/new dependency. Add valid XML **plus** hidden active content tests before accepting any exception. Keep inspection limits global. Pass policy only through trusted receipt/capture calls and LINE receipt-compatible parking/resume; preserve strict support, QA, payment-slip and signature routes. User metadata/model output cannot select policy. Preserve bytes. Add T5/T7 end-to-end policy propagation and refusal recovery cases. Run **API(T6/T1/T4/T5/T7/T8), Web(W1), API/web typechecks, LINE integration/W00 parity, Browser(J1/J4)** and inspect at least three consented real receipt PDFs including PDF/A-3 XML. Missing real corpus is recorded as incomplete proof, never assumed passed. Accept AC4b/c; only now is owner security/file-safety step complete.

### P07 — settle usable output only (R6; owner step 2)

Write G1–G3 and real-PG T10 money assertions first. Add local `acceptOutput` to both provider input shapes, apply it before `settleV2`, and annotate only the current invocation's recorded usage; retain every real counter and price. Implement acceptance at all six rows of spec R6, including original/repair QA and newly found public-general. Compose acceptance includes existing help selection, allowed prose and source/number grounding (`G-semantic:1209`–1235, `:1370`–1391); a schema-only success is insufficient. Keep consumer repair behavior and deterministic fallbacks; acceptance must be pure and use the same parsed result to avoid drift. Assert invalid complete/output-limit/blocked/validator-throw/late-timeout cost zero, hold release, complete absorbed cost, duplicate and concurrent settlement, and usable controls. API settlement already recognizes `ok:false`; do not rewrite financial tables to compensate for a late flag. Run **Gateway(G1/G2/G3), API-PG(T10), API/gateway typechecks, AgentCore rebuild, LINE integration/W00 parity**. Accept AC6.

Free coverage is a regression gate for existing `049aa51de`, not another settlement implementation: add/reuse T3/T7/T21 cases for unusable web/LINE/PDF output, zero usable persistence, stale apply, failed transaction and valid persisted partial result. T10 proves FREE_MONTHLY_3 release exactly once, no `succeededAt` after rollback, commit with the source, no refund after successful persistence even if reply fails, and original month/source during purchase. Run **API(T3/T7/T21)** and the registered T10 real-PG cases with zero skips. Free typed questions must hit the deterministic gate before any provider. A quota regression discovered by these cases must be evidenced and amend this step before changing the read-only free helpers; do not keep a speculative fix for behavior already correct.

### P08 — WHT remainder projection (R8; independent)

Add T13 fixtures first: 10,000/100 total with 5,000/50 issued; prior-month payment-date row; >100 handoffs; cancelled/reissued/external; payment-specific rows; scope/permissions. In `WhtGetMonthSummaryTool.execute`, collect accessible current rows before month filtering, subtract certificates only from their own document-level REQUIRED remainder using Decimal, and then project the requested month using paymentDate. Keep event-based totals untouched. Use the source's exact renamed worklist fields/countBasis and one short Thai sentence without changing saved handoffs, tax events or future remittance fields. Correct the misleading paid-income description at `C-ai-tools:1351` using the spec's wording, without adding its future e-WHT clause. The Gateway document formatter consumes `data.message` unchanged (`G-document-read:6`–9), so no Gateway parser change is required. Run **API(T13), contracts build (`pnpm --filter @watchdog-bms/contracts build`), API typecheck, LINE integration/W00 parity**. Accept AC8; PostgreSQL is not needed for this pure projection.

### P09 — linked source replacement (R7; independent)

Write real-PG T12 money/scope fixtures before changing queries. Add proposed `replacedLinkedSourceIds(tx, baseWhere)` and use it within the same RepeatableRead transaction in summary, breakdown and groups. The third reader exists but a production invocation beyond its wrapper was not found; keep the shared repository contract consistent without inventing a new caller. Preserve the full where using AND; remove sources before aggregation/pagination, based on visible matching projections only. T11 exercises visible facts; T12 tests actual repository queries under tenant/branch/related/creator/date/status/category/vendor/payment filters, multiple currencies, projection outside page and concurrent projection insertion. Run **API(T11), API-PG(T12), API typecheck, LINE integration/W00 parity**. Accept AC7. Ordinary web list, exports and source statuses stay unchanged.

### P10 — category proposal then CAS (R9; depends P04)

First show in T9/T7 that merely answering category mutates the baseline. Stop collection writes to the real category, retaining acceptedValues; evaluate proposed category in memory. Bind displayed proposal to P04's token/revision. Verified apply revalidates active company category and uses existing continuation CAS before review, then its returned revision for subsequent operations. T14 proves a concurrent web edit wins and duplicate application cannot overwrite it. Cover pause/decline/cancel/expiry, FORM without signature, archived category and failure after category commit; copy says exactly what has happened. Run **API(T9/T7), API-PG(T14), API typecheck, LINE integration/W00 parity, Browser(J2)**. Accept AC9; together P04/P10 satisfy A10 without introducing A2's future router.

### P11 — live blockers at every paper mutation (R10; independent)

Write T15–T18 permission/tax tests first. Add the shared `withholdingPaperBlockers` projection described in spec R10; include no-event sources, cross-form unknown-kind issues, live payment state and establishment partition. Use it for month/validation/export/markFiled, including accountant-prepared early return. Unknown kind blocks both possible forms for its payer; separate branch papers remain independent; hidden shared-payer sources yield only a redacted generic blocker. Include blocker-only establishments before empty-state/selection logic. Retire obsolete **expense WHT** issues with company/source/period/form scope; do not change VAT or supplier-payment behavior.

The first preflight rejects before artifact/number/storage. Re-evaluate current sources/blockers inside the existing `recordWithholdingDownload` transaction before publishing a package (`X-repository:83`–120), and inside markFiled's Serializable transaction. If a source change is committed before that transaction's checked snapshot, reject the stale write and use existing unlinked-object cleanup (`X-export:147`–150); do not claim external storage and numbering are rolled back atomically. Preserve the existing period lock and serialization-conflict handling. Assert no package/filed transition on a visible blocker or conflict and never delete an earlier paper. Add real-PG tests in **T18**, with barriers placing a blocker before the checked snapshot and testing conflicting writes, plus explicit no-skip evidence; the registered file may import the use cases/controller. A later transaction ordered after filing follows the historical warning/correction path, not a retroactive promise that the filing never occurred. Check source corrections, void and date move clear stale blockers without clearing unrelated form issues.

Run **API(T15/T16/T17), API-PG(T18), API typecheck, Prisma validate**. Accept AC10a–c/e at API level. No e-WHT migration, rate change, PP30/PP36 feature or notification dispatch.

### P12 — correction and historical truth (R10; depends P11)

In X-month/W-withholding show applicable source-only blockers, permission-checked correction links, loading/error states and a truthful old-FILED omission warning. Keep old filed bytes/checksum downloadable; warning appears only when frozen rows do not cover the source/payment. Reuse current same-form additional-paper/different-form normal-paper sequence logic; no refiling automation. Add W2/T15/T16 and J3 cases for one good + one missing/unknown payee, zero events, hidden branch, read-only user, correction, FILED preservation and additional paper. Show a return action when edit is not permitted; no dead end or false empty month.

Run **Web(W2), API(T15/T16), API/web typechecks, Browser(J3)** at 390/1280/1556. Run the existing withholding journey on its required fresh isolated proof database (`e2e/journeys/withholding-forms.journey.spec.ts:8`–10). Complete a read-only historical FILED audit during implementation with only permitted local/sanitized data; production/cloud access must follow the repository runbooks and separate authorized release procedure. Record affected paper ids securely, coverage basis and assigned data owner/accountant for follow-up; do not send messages or alter old filings in this plan. Accept AC10b/d/e after evidence, not merely a UI snapshot.

## 6. Integration, limitations and next state

The product/architecture acceptance is the companion spec: 12 requirements, including upload-intent and signature-fill scope in owner step 1, with explicit free/paid coverage. No schema/permission/dependency expansion is planned. The requirements are implementation-ready designs, not claims that proposed functions or tests exist today.

For each implementation commit record the exact revision, failed baseline test, passing command/output, executed PG cases, relevant screenshots and accepted AC ids. Run focused checks listed above; broaden only for a new failure or changed shared contract. Before handoff, replay web receipt/capture/claim/substitute/withholding journeys at all widths and the complete LINE acceptance chain. Preserve one primary button, equal grouped button sizing/order, Thai one-line recovery and permitted navigation. Do not count static source-text web tests as real browser evidence.

No cloud operation/deploy is part of this documents round. Any later deployment must first follow `docs/runbooks/cloud-environment-operations.md` and `docs/runbooks/uat-production-v2-deployment.md`, including their exact run-id and signed acceptance requirements; a green local suite is not a live release.

Additional bugs are logged with evidence in spec §8: G2/G3 moved to R11/R12 2026-10-26 and are now in round 1; known ACTIVE retry defect remains outside this scope. Extra aggregate reader, public-general billing caller, LINE second scan/severity and source-issue lifecycle remain in their original requirements. Registration gap now also includes two free-feature spec files; new tests remain in registered files. No additional current-code defect beyond the promoted gaps was established during re-anchor; new free-path checks are preserved behavior.

Owner question Q1 — **answered 2026-11-04**: no historical credit/refund, separate audit/remediation task or data correction; R6/P07 remains forward-only and has no owner-answer gate.

Task state for this two-file lane: re-anchored to develop e7c422802 on 2026-11-04; required instructions/source designs and current code/callers read; API registration rechecked (21 registered files, ten relevant unregistered files); 12 traceability rows, 18 acceptance rows, 14 stable commit IDs. No runtime tests, PG, browser, scanner corpus, historical audit or cloud operation performed. The docs-only constraint forbids editing agent memory; this section carries state. Next: controller validates this baseline, assigns round 1 P01/P02/P03/P13/P14, and records execution evidence here or in authorized task memory. Only these two documents are authorized changes in this round.
