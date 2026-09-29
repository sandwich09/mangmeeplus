# LINE AI API integration regression rerun — 2026-09-27

Status: Original failures are preserved below; approved test-only fixture and local-database guard corrections now pass 4/4, 83/83, and 1/1. A stale Gateway output assertion was corrected and its focused file passes 80/80. This report records the API integration, delivery, permission, task-state, fallback, and PostgreSQL suites assigned to the delivery-integrity lane from candidate `f9438828f397550634dc29b27aa13935d84d63a9`. Contracts, the remaining AI Gateway tests, and API helper/unit batches belong to the parallel latency lane and are not duplicated here.

## Isolation

- Execution is local and synthetic. No customer, UAT, Production, LINE, or model-provider request was made.
- PostgreSQL is the task-owned container on loopback port `15439`. No existing evidence or smoke database was reset.
- Fresh databases were migrated before tests. Four unique databases (`watchdog_line_ai_regression_[a-d]_20260927`) demonstrated that several older specs reject otherwise disposable databases by exact path/port. The compatible task-owned databases `watchdog_bms_ai_reliability_20260927` and `watchdog_bms` were therefore created only after confirming that they did not already exist.
- `prisma/sync-permissions.ts` ran only against the fresh `watchdog_bms` database because the onboarding spec explicitly requires the same role sync as CI. No demo/customer seed ran.
- Logs and wrappers are under `/tmp/mangmee-latency-pilot-20260927/`; database credentials are not copied into this report or logs.

## Coverage inventory

This lane executed 50 unique API spec files: 32 non-PostgreSQL integration/delivery/security specs and 18 PostgreSQL reliability/workflow specs. It also enumerated three adjacent browser specs and excluded them for the reasons recorded below. The one stale Gateway assertion discovered by the parallel full-Gateway batch was corrected and rerun as a focused 80-case file. Corrected fixture reruns overlap this inventory and therefore are reported separately rather than added to a misleading grand total.

The parallel latency lane owns contracts, all remaining Gateway specs, and API helper/unit batches. Its results must be combined with this report before claiming repository-wide AI coverage. Within this lane, only the source-frozen W00 manifest refresh and parity check remain.

The parallel static batches from the same frozen candidate are consolidated here so their failures are not lost or double-counted:

| Batch | Result | Evidence |
| --- | --- | --- |
| contracts plus authority/document-QA contracts | **288 passed** | `/tmp/line-ai-regression-contracts.log`; `/tmp/line-ai-regression-contracts-authority-docqa.log` |
| Gateway agent specs | **843 passed, 1 failed** | `/tmp/line-ai-regression-gateway-agents.log` |
| Gateway non-agent specs | **441 passed** | `/tmp/line-ai-regression-gateway-nonagents.log` |
| API domain/infrastructure | **159 passed, 1 failed** | `/tmp/line-ai-regression-api-domain-infra.log` |
| API application units | **400 passed, 2 skipped** | `/tmp/line-ai-regression-api-application-units.log` |
| API tools | **514 passed, 1 skipped** | `/tmp/line-ai-regression-api-tools.log` |
| local scripts | **112 passed, 1 skipped** after correcting the standalone runner configuration | `/tmp/line-ai-regression-scripts.log`; `/tmp/line-ai-regression-script-runtime-cli-corrected.log` |

The Gateway failure is the stale broad-summary assertion corrected below. The API domain/infrastructure failure is the intentionally stale W00 digest awaiting final source freeze. The scripts batch first passed 111, skipped one, and failed the runtime-CLI case because its ad-hoc transform did not load decorator settings; the same runtime-CLI case passed once under the repository TypeScript runner configuration, so it replaces that setup failure rather than increasing the unique-test total.

## Executed non-PostgreSQL suites

| Area | Files | Result | Log |
| --- | ---: | --- | --- |
| webhook and orchestration integration | 8 | **557 passed, 0 failed, 0 skipped** | `/tmp/mangmee-latency-pilot-20260927/api-line-ai-integration-nonpg.log` |
| delivery, permission, long-output, frozen fallback, replay | 13 | **252 passed, 0 failed, 0 skipped** | `/tmp/mangmee-latency-pilot-20260927/api-line-ai-delivery-nonpg.log` |
| expense/reimbursement LINE security and continuation | 10 | **357 passed, 1 failed, 0 skipped** | `/tmp/mangmee-latency-pilot-20260927/api-line-ai-expense-security-nonpg.log` |
| queued ledger delivery and source/actor fences | 1 | **62 passed, 0 failed, 0 skipped** | `/tmp/mangmee-latency-pilot-20260927/api-line-ai-drain-nonpg.log` |

Commands used the existing runner:

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-general-v2.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-mixed-business-v2.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-task-resume.spec.ts \
  src/modules/line-ai/application/use-cases/process-line-document-qa.bridge.spec.ts \
  src/modules/line-ai/application/use-cases/line-ai-combined-regression.spec.ts \
  src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.spec.ts \
  src/modules/line-ai/line-first-signup-webhook.spec.ts
```

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-file-attempt-answer.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-ai-terminal-outcome.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-ai-reconciliation.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-message-buffer.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-draft-update-card.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.spec.ts \
  src/modules/line-ai/domain/logic/line-non-receipt-reply.logic.spec.ts \
  src/modules/line-ai/infrastructure/line-reply.adapter.spec.ts \
  src/modules/line-ai/infrastructure/actor-delegation.service.spec.ts \
  src/modules/line-ai/application/line-read-evidence.spec.ts \
  src/modules/line-ai/application/line-message-buffer.service.spec.ts
```

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts \
  src/modules/expenses/application/use-cases/line-correction.use-case.spec.ts \
  src/modules/expenses/application/use-cases/line-expense-draft-conversation.use-case.spec.ts \
  src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts \
  src/modules/expenses/domain/logic/line-correction.logic.spec.ts \
  src/modules/expenses/domain/logic/line-draft-update.logic.spec.ts \
  src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.spec.ts \
  src/modules/expenses/domain/logic/line-receipt-branch.logic.spec.ts \
  src/modules/expenses/infrastructure/prisma-expense.repository.line-continuation.spec.ts \
  src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.spec.ts
```

The unchanged failure is `LineReimbursementDraftUseCase > uses the existing preview limiter family without consuming or cancelling accepted action facts`: expected `{ status: 'blocked', errorCode: 'rate_limited', retryAfter: 300 }`, received `{ status: 'expired', actionId: ... }`. The fixture fixes `expiresAt` at `2026-09-27T04:02:00.000Z` but calls `preview` without a supplied clock; the rerun occurred later that day. No source or test was changed.

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/line-ai/application/use-cases/drain-line-ledger.use-case.spec.ts
```

## Executed PostgreSQL suites

The main compatible batch used `--test-concurrency=1` so destructive setup/cleanup within a database could not overlap. Migrations completed successfully first.

```sh
DATABASE_URL=<task-owned-loopback-db> pnpm --filter @watchdog-bms/api exec prisma migrate deploy
```

```sh
BILLING_TEST_DATABASE_URL=<watchdog_bms_ai_reliability_20260927> \
AI_BUDGET_RESERVATION_TEST_DATABASE_URL=<same> \
AI_CREDIT_HOLDS_TEST_DATABASE_URL=<same> \
LINE_DRAFT_EDIT_TEST_DATABASE_URL=<same> \
pnpm --filter @watchdog-bms/api exec tsx --test --test-concurrency=1 --test-reporter=spec \
  src/modules/line-ai/application/line-capture-delivery.pg.spec.ts \
  src/modules/line-ai/line-delivery-plan.pg.spec.ts \
  src/modules/line-ai/application/line-conversation-context.pg.spec.ts \
  src/modules/line-ai/application/line-input-buffer.pg.spec.ts \
  src/modules/line-ai/application/line-ledger-accepted-request.pg.spec.ts \
  src/modules/line-ai/application/line-pending-media.pg.spec.ts \
  src/modules/line-ai/application/line-retained-task-source.pg.spec.ts \
  src/modules/line-ai/application/line-document-qa.pg.spec.ts \
  src/modules/line-ai/application/company-ai-budget-reservation.pg.spec.ts \
  src/modules/line-ai/application/company-ai-credit-holds.pg.spec.ts \
  src/modules/line-ai/application/line-ai-budget-authority.pg.spec.ts \
  src/modules/line-ai/application/use-cases/erp-source-reliability.pg.spec.ts \
  src/modules/line-ai/application/line-reimbursement-draft-adapter.pg.spec.ts \
  src/modules/expenses/line-draft-update.pg.spec.ts \
  src/modules/expenses/expense-line-charge-kind.pg.spec.ts \
  src/modules/reimbursements/line-reimbursement-draft.pg.spec.ts
```

- First compatible batch: **73 passed, 1 failed, 0 skipped**. Log: `/tmp/mangmee-latency-pilot-20260927/api-line-ai-pg-compatible.log`.
- The one failure was `line-document-qa.pg.spec.ts` cleanup retry: expected `FAILED`, received `PENDING`.
- Immediate standalone rerun of the unchanged file: **10 passed, 0 failed, 0 skipped**. Log: `/tmp/mangmee-latency-pilot-20260927/api-line-ai-pg-document-qa-retry.log`. This is recorded as a transient failure followed by a clean rerun, not erased.

Receipt reliability used the fresh `watchdog_bms` database accepted by its existing safety guard:

```sh
RECEIPT_RELIABILITY_TEST_DATABASE_URL=<task-owned-watchdog_bms> \
RECEIPT_RELIABILITY_REQUIRE_POSTGRES=true \
pnpm --filter @watchdog-bms/api exec tsx --test --test-concurrency=1 --test-reporter=spec \
  src/modules/line-ai/receipt-reliability.pg.spec.ts
```

Result: **6 passed, 0 failed, 0 skipped**. The combined log with the onboarding attempt is `/tmp/mangmee-latency-pilot-20260927/api-line-ai-pg-receipt.log`.

The onboarding receipt spec first failed setup because migrations alone did not create the required system role. After the documented CI-equivalent permission sync, it reached the business assertion and still failed:

```sh
DATABASE_URL=<task-owned-watchdog_bms> pnpm --filter @watchdog-bms/api exec tsx prisma/sync-permissions.ts
ONBOARDING_RECEIPT_TEST_DATABASE_URL=<task-owned-watchdog_bms> \
ONBOARDING_RECEIPT_REQUIRE_POSTGRES=true \
pnpm --filter @watchdog-bms/api exec tsx --test --test-concurrency=1 --test-reporter=spec \
  src/modules/line-ai/onboarding-receipt-allowance.pg.spec.ts
```

Result after correct setup: **0 passed, 1 failed, 0 skipped**. `RequestReceiptExtractionUseCase` returned `status: 'failed'` where the existing first-receipt test expects `status: 'ok'`. The fake success body contains neither V2 receipt evidence nor usage while reliability V2 defaults to `on`; the current client rejects an otherwise-`ok` response without valid V2 evidence. Log: `/tmp/mangmee-latency-pilot-20260927/api-line-ai-pg-onboarding-retry.log`. The test used a local fake OCR response; no external provider call occurred.

## Guard-blocked legacy PostgreSQL specs

These specs were executed against the isolated port-15439 databases and failed before test setup because their source guards accept only `127.0.0.1:15432/mangmee_billing_20260912` or the CI database:

- `src/modules/line-ai/line-delivery-access.pg.spec.ts` (8 cases cancelled by suite setup)
- `src/modules/line-ai/line-ledger-delivery.pg.spec.ts` (1 setup failure)
- `src/modules/line-ai/line-read-evidence.pg.spec.ts` (1 setup failure)

The existing port-15432 container is not owned by this task, so it was not read, reset, or mutated. The guard evidence remains in `/tmp/mangmee-latency-pilot-20260927/api-line-ai-pg-allowed-db.log`. Running these three requires an explicitly reserved database on the source-allowed endpoint or a reviewed test-guard change; neither was performed in this rerun.

The attempted command was the same source runner with `--test-concurrency=1` and the three paths above, with `BILLING_TEST_DATABASE_URL` pointing at the fresh loopback port-15439 database. It produced only guard/setup failures; no test body mutated data.

## Approved test-only follow-up

The original red and blocked results above were not erased. They were classified as stale fixtures or an overly narrow local database allowlist, then corrected without product-runtime changes:

- The reimbursement limiter case now passes its existing injected `2026-09-27T04:00:00Z` clock to `preview`, so it reaches the intended rate-limit branch before the fixture expires: **4/4 passed**.
- The three legacy PostgreSQL guards now accept only the additional exact task-owned endpoint `127.0.0.1:15439/watchdog_bms_ai_reliability_20260927`; arbitrary hosts, ports, and database names remain rejected.
- The QA cleanup fixture pins its API producer clock one minute behind PostgreSQL while creating the outbox event. This removes the host/database millisecond race where a new event could be `PENDING` until the next scheduler tick. The failure and recovery assertions remain unchanged.
- The onboarding fake remains a synthetic contract/onboarding test, not OCR-accuracy evidence. It keeps reliability V2 enabled, asserts `requireEvidenceV2`, and returns paid usage plus attachment digest, page text, and per-occurrence locators for repeated `100.00` and `0.00` values. The first-receipt and printed-zero assertions remain unchanged.
- **2026-09-29 note (Owner decision, "ลบทิ้งเลย"):** strict receipt evidence (W07A receipt grounding: `requireEvidenceV2` / `receiptEvidence` on receipt OCR, and `evidenceSource` / `fieldEvidenceVersion` on capture windows) was removed from the code. It was never tested against real receipts; its rules were too narrow for common Thai receipts; one failed field discarded the whole read; and a failed read cost about 60 s and 3 paid model calls. Receipt photos and PDF/file reads now use the normal read with its value cross-check. See `docs/agent-memory/web-receipt-evidence-v2-2026-09-29.md`.

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/reimbursements/application/use-cases/line-reimbursement-draft.use-case.spec.ts
```

Result: **4 passed, 0 failed, 0 skipped**.

```sh
BILLING_TEST_DATABASE_URL=<task-owned-15439-watchdog_bms_ai_reliability_20260927> \
AI_BUDGET_RESERVATION_TEST_DATABASE_URL=<same> \
pnpm --filter @watchdog-bms/api exec tsx --test --test-concurrency=1 --test-reporter=spec \
  src/modules/line-ai/line-delivery-access.pg.spec.ts \
  src/modules/line-ai/line-ledger-delivery.pg.spec.ts \
  src/modules/line-ai/line-read-evidence.pg.spec.ts \
  src/modules/line-ai/application/line-document-qa.pg.spec.ts
```

Result: **83 passed, 0 failed, 0 skipped**.

```sh
ONBOARDING_RECEIPT_TEST_DATABASE_URL=<task-owned-15439-watchdog_bms> \
ONBOARDING_RECEIPT_REQUIRE_POSTGRES=true \
pnpm --filter @watchdog-bms/api exec tsx --test --test-concurrency=1 --test-reporter=spec \
  src/modules/line-ai/onboarding-receipt-allowance.pg.spec.ts
```

Result: **1 passed, 0 failed, 0 skipped**. The local fake intercepted the OCR boundary; no provider call was made.

## Focused Gateway assertion correction

The broad expense-summary regression had one stale expectation: it required the period to immediately follow the headline and prohibited the grounded word `ยืนยันแล้ว`, even though the current deterministic formatter must disclose the pending/draft/confirmed basis before the period. The test now checks the headline, exact basis, and period separately. It still rejects pending-review wording, paid-state claims, vendor leakage, item ids, raw dates, and source/card divergence.

```sh
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test --test-reporter=spec \
  src/modules/line-ai/agents/orchestrator.agent.spec.ts
```

Result: **80 passed, 0 failed, 0 skipped**.

## E2E applicability

Repository inventory found no browser suite for LINE AI answer delivery. `e2e/ai-suggestions.spec.ts` covers the separate AI-draft suggestion inbox; `e2e/line-recovery.spec.ts` and `e2e/line-signup-contact-email.spec.ts` cover auth/signup. Their 13 cases were enumerated with the command below and excluded rather than claimed as LINE AI evidence. The standard E2E runner would build API/Web and sync a shared seeded database, so it was not started for unrelated coverage.

```sh
pnpm exec playwright test \
  e2e/ai-suggestions.spec.ts \
  e2e/line-recovery.spec.ts \
  e2e/line-signup-contact-email.spec.ts \
  --project=chromium --list
```

Inventory log: `/tmp/mangmee-latency-pilot-20260927/api-line-ai-e2e-inventory.log`. This is discovery evidence, not a browser pass.

## Artifact digests

| Artifact | SHA-256 |
| --- | --- |
| `api-line-ai-integration-nonpg.log` | `e2f994029df2f92d6a77d7e6d1eadee3d949413f20ff69c0b2cd5749995c29fa` |
| `api-line-ai-delivery-nonpg.log` | `d26c4b9259674e15bbf23bc960cb97c5ee2dcd688438b4ae2b033db4841e4be0` |
| `api-line-ai-expense-security-nonpg.log` | `dd37dbc5caffe220390dcec309166be36a03f03a89bdce4e6857282539d7f02f` |
| `api-line-ai-drain-nonpg.log` | `7e632a97a8ccf4060c27e44365f33ad7417254330412162475a51a8382da9f9f` |
| `api-line-ai-pg-compatible.log` | `4497202b367ca94bd6adb817047a5f121ca4696d9e868e22465d7e57d061366c` |
| `api-line-ai-pg-document-qa-retry.log` | `89510cc12e2c4c93f3c83522127ad67318d34e33b3582cd6b8f240de1b33a1d2` |
| `api-line-ai-pg-receipt.log` | `e2c21feda9f126883361446b320686142c5e6b5ec4ee0095a4ec05c2f64e2cb5` |
| `api-line-ai-pg-onboarding-retry.log` | `bef8acf6578719bcb0b5e70f300818fba133d36a52037ed84393224939a482d3` |
| `api-line-ai-pg-allowed-db.log` | `01d83669ddeee06520d887ee009019483a352c38d0437c0ca089ce090bb4f844` |
| `api-line-ai-e2e-inventory.log` | `bac9934f96ff196344b6f16e2fa43cebf8e8232316657a7238ec9c6471df2160` |
| `api-line-ai-fixture-limiter-fixed.log` | `e6e64ac51cf8d9f570181522978137ae64689cd79949631b7de0034287ae1535` |
| `api-line-ai-pg-legacy-guards-and-qa-fixed.log` | `94a9b5cd44e1b78a4c735925431ef1005d5632cb233946e8adc89e7eb7a5e1ea` |
| `api-line-ai-pg-onboarding-v2-fixed.log` | `ca96162abba64e0458812b65c765ab558c295f5365212d55f2a9f23545ee7619` |
| `gateway-orchestrator-stale-assertion-fixed.log` | `4d217ab4b1ef920b973864d3db6c6a9e71e625c629e2c8f7f0817bb77e548c8a` |
| `line-ai-regression-contracts.log` | `2b98809674c01c1e3ed7eca8838c63c547d98139bff0bac8c73e2264a46686da` |
| `line-ai-regression-contracts-authority-docqa.log` | `3a41168a4a522e87cea3c8771e945ad41a613933211bf6eb7d2c95dc8c9c6f9c` |
| `line-ai-regression-gateway-agents.log` | `d8933af82813f46ed04a3b409f9fae8ab102aad139f89741e39f6cc37b37e942` |
| `line-ai-regression-gateway-nonagents.log` | `5b329cd314d4d14cca06469f3d467f9afa72fa48d16188dd847fa243eba9d73a` |
| `line-ai-regression-api-domain-infra.log` | `5a98ca12b1327380a2c0154e46887054b685b5ce5c18ea9314baf980076ab136` |
| `line-ai-regression-api-application-units.log` | `18c96e9c57f8af5dfffdb5b235dfdbd822f64d5a053ea94de87e60ed5f59f771` |
| `line-ai-regression-api-tools.log` | `b213132ccf66d59b02ed5d7194fc4686298efb7132b706eeb54d69403d1d9f82` |
| `line-ai-regression-scripts.log` | `033c14d1b78fb1f18b044f0732cce6a3bc8904eb54a7775648a3eb8199616813` |
| `line-ai-regression-script-runtime-cli-corrected.log` | `503fe87857d3dd94d7ae05547036ddf72810d27fff36a83945a28ae518786064` |

## Current findings

The original run found the clock-dependent reimbursement fixture, transient QA outbox timing, stale onboarding response fixture, exact endpoint guards, and stale broad-summary assertion documented above. After the approved test-only corrections, the affected commands pass **4/4**, **83/83**, **1/1**, and **80/80** without changing production runtime behavior. Receipt reliability remains **6/6**. The broader webhook, orchestration, delivery, long-output, fallback, replay, permission, and queued-ledger results remain evidence from `f9438828` plus the listed test-only fixture corrections; they are not claimed as a full rerun of the later combined runtime source. The compact affected-source regression, typecheck, and final W00 verification on the frozen combined source are recorded next.

## Frozen combined-source verification

After the runtime source froze, the seven affected API files passed **484/484** together. The first attempt exposed one test fixture that lacked `expense.read` and therefore reached the permission fence before the new invalid-enum assertion; adding that existing permission produced the expected `UNSUPPORTED_FILTER` result. API typecheck passed after the onboarding V2 usage fixture added its required `durationMs` field.

The official W00 regeneration command passed **4/4**, updated `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`, and the independent command without `UPDATE_LINE_AI_CAPABILITY_MANIFEST` then passed **4/4** against the frozen artifact.

| Final artifact | SHA-256 |
| --- | --- |
| `/tmp/mangmee-latency-pilot-20260927/combined-affected-api-seven-final.log` | `ec275d2aed095b68d33a69823d5fe95d094f538f3c5ff2a51bde0774312f80ff` |
| `/tmp/mangmee-latency-pilot-20260927/combined-api-typecheck.log` | `c64d42d41c74a111a87d898b64e340dda800401871b73ead21ee5bed8ba147bd` |
| `/tmp/mangmee-latency-pilot-20260927/combined-w00-refresh.log` | `07b1fe324a1dc3a82161d0929ba1253b24e10692cd4464e5e5db5052c32387d4` |
| `/tmp/mangmee-latency-pilot-20260927/combined-w00-verify.log` | `e53670599c4db3b875dacb2121a298f15938f72693379d7b8ca72413b6ceaaaa` |
