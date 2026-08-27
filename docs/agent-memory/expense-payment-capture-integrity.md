# Agent Memory: Expense payment capture integrity

Status: MERGED DEVELOP via PR #287 at `111532966c415fee11abb36ca1749bf1fc66ee52`,
2026-08-27T04:36:17Z; exact-head CI `33039136161` SUCCESS on
`179981a45f00a1d0b3a1898dce9f877f2457563e`. Final accounting6 + AP6 + expense21 =33/33
E2E, zero skipped/flaky; eight-suite checks128/128 (including 6 real PostgreSQL cases),
web1139/1139 and API/web/E2E typechecks pass.
Six tracked images/API proof support this scoped delivery, not main/Production approval.
Owner: `/root/ocr_platform_admin` implementation; `/root` review, browser QA and integration.
Scope: Expense payment durable retry identity, atomic audit/outbox, explicit actual paid
date, registered regressions and isolated local PostgreSQL proof. P15 remains frozen and
untouched. No subscription, bank/revenue matching/reconciliation, or P28 credit policy.

## Decisions

- Implementation started on branch `codex/expense-payment-capture-integrity`, worktree
  `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus-expense-payment-capture-integrity`,
  baseline `d2b40f37948d482c1bdd29c6047551c4258f24a7`.
- Root approved spec §19m: optional validated key, hashed request-ID legacy fallback,
  current authorized ExpenseRecord replay response, exact canonical money/civil date,
  company uniqueness, rechecked tenant/branch scope, void replay without settlement,
  transactional audit/outbox, deliberate new intent after edits.
- Permission boundary clarification after integration: `requirePerm(ctx, 'expense.payment.record')`
  runs at command entry (`expense-draft.use-case.ts:1122`). The transaction rereads the
  company-bound source and compares its branch with resolved request scopes
  (`prisma-expense.repository.ts:333–336`); it does not reread permissions from the DB.
- Ponytail full: extend existing payment transaction and validators; no new dependency,
  permission, endpoint, or payment abstraction. Read repository AGENTS and Ponytail full.
- Existing actual caller: ExpenseReviewPage → expenses.api → RecordExpensePaymentUseCase
  → PrismaExpenseRepository.recordPaymentAtomic. Before change, identical 40-baht calls
  append two rows and produce paid 80/outstanding 20 on payable 100 (in-memory probe).
- The panel omitted paidAt although the API supports it; P27 paid-ledger filters use
  ExpensePayment.paidAt. The new input preserves civil day, not browser UTC conversion.
- Legacy calls with fresh request IDs remain distinct by design; historical rows are
  unkeyed. No heuristic dedupe of legitimate equal-value payments.
- Final mutation uses company-command lock then the existing expense lifecycle lock, under
  ReadCommitted so a waiting retry sees the committed intent. Void takes only the lifecycle
  lock and never the new command lock; no reverse lock order is introduced. Existing posting
  consumes the immutable payment ID and does not take the command lock. Replay preserves a
  payment's already-posted journal/status and emits no new event.
- The outbox envelope keeps companyId/aggregateType/aggregateId/requestId/occurredAt/data,
  event type `expense.payment_recorded`, and aggregate type `expense_payment`. Only the
  dedupe key changes to the immutable payment identity, without transport request ID.
  No consumer parses the key. Canonical paidAmount in audit/event is the stored 4dp value.
- Null optional date/method/reference retains legacy omission semantics. Trimmed blank
  reference is null. The standard HTTP TrimStringsPipe still applies before DTO validation;
  supplied null/blank/non-string intent keys fail closed. Client and request-ID keys have
  distinct stored namespaces. The API now rejects unknown methods before a Prisma enum error.
- Native form validity enforces positive satang input and an actual date. Outstanding amount
  remains server-authoritative: no raw 4dp HTML max can reject the existing legitimate
  rounded-up legacy satang settlement. The UI shows the outstanding balance beside the form.
- Opus found the initial UI incorrectly treated a definitive first 4xx as an uncertain
  payment. The existing model now classifies status/code (including existing nested details):
  initial 4xx except 408 clears intent/notice and keeps the translated error + normal CTA;
  network/408/5xx/missing status retains the exact intent. A later 4xx after uncertainty
  still retains it, since the earlier call may have committed. Explicit idempotency
  conflict is a separate check-history state with same-key submit disabled, never an
  automatic new key. An explicit edit clears the retained attempt with the existing
  new-intent warning; confirmed success clears all intent/failure/notice state.
- Separate audit finding handed to root: legacy AccountingPages payment intent excludes
  paidAt from its signature while creating a fresh timestamp on retry; not edited here.
- EXP-28 scope: use an owned confirmed receipt-backed expense, intercept only its payment
  POST, and render the real page through initial 400/403 → network failure → 403 retry →
  explicit idempotency conflict → edit reset. Response envelopes follow the repository's
  BadRequest/ConflictException objects and the guard's Nest ForbiddenException body;
  no request is forwarded for payment. Assert the method's accessible name; the custom
  select's summary needs an explicit aria-label because its outer label is not associated.
  Cleanup uses the supported void endpoint in finally for this fixture only; a setup
  failure before CONFIRMED is reported/preserved, never force-mutated. Receipt bytes and
  the voided document remain evidence, with no payment rows. This is mocked-error UI
  evidence only, not a claim of backend replay/authorization correctness (EXP-27 and PG
  regressions cover real commits). This agent may list/typecheck, but may not run browsers.
- Root verified another payment-only seam: shared `load()` catches failed GET internally,
  so it cannot establish refresh success after a POST. Keep the committed payment's exact
  intent/input until a direct getExpense succeeds, with persistent saved/refresh-pending
  guidance and safe original-key retry. Do not misclassify a failed refresh as failed save
  or clear its key on a later POST refusal. Edit remains an explicit new intent. The local
  onRefresh is literally `() => undefined`, not an injected callback; keep it outside the
  payment error catch after refreshed success, with no speculative wrapper. No shared load,
  classifier, backend, schema, or server change. EXP-29 must prove a real POST plus failed
  follow-up GET, safe same-key replay, one payment row, and supported own-fixture void.

## Open questions

- None for this bounded contract. Production rollout timing must account for the validating
  CHECK's existing-row full scan under ACCESS EXCLUSIVE and the non-concurrent unique
  index's write lock. Scheduling belongs to operator review; no shared DB migration is
  authorized. No migration change was made in response to this review note.

## Artifacts

- `docs/specs/expense-receipt-upload-spec.md` §19m.
- `docs/plans/expense-receipt-upload-plan.md` capture-first follow-up.
- `apps/api/prisma/schema.prisma` ExpensePayment and additive migration
  `20260827190000_expense_payment_idempotency` (nullable intent pair, pair check, company uniqueness).
- `packages/contracts/src/expenses.ts`, registered `prisma-enum-parity.spec.ts`.
- Existing expense DTO, payment use-case/repository and their three registered specs.
- Existing expense review panel/API/model and specs; shared Thai error translator and spec.
- `e2e/expenses.spec.ts` EXP-28 mocked-error rendered-UI and EXP-29 real payment/failed
  detail-refresh regressions. EXP-27 is separately authored real-payment evidence;
  EXP-27/28 were not modified while adding EXP-29.
- `.github/workflows/ci.yml` existing PostgreSQL job, with
  `EXPENSE_PAYMENT_REQUIRE_POSTGRES=true` and the registered payment repository spec.

## Verification

- `pnpm install --offline --frozen-lockfile`: passed, reused cached dependencies.
- Contracts/config builds, Prisma generation and `prisma validate`: passed.
- `pnpm --filter @watchdog-bms/api typecheck` and web `typecheck`: passed. Final API
  typecheck also passed after the last test-only additions. `git diff --check`: passed.
- `pnpm --filter @watchdog-bms/api test:boot`: passed; Nest resolved every provider (639ms).
- Registered API focused command (from repository root):

  ```sh
  DATABASE_URL="$EXPENSE_PAYMENT_QA_DATABASE_URL" EXPENSE_PAYMENT_REQUIRE_POSTGRES=true \
    pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
    src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts \
    src/modules/expenses/application/use-cases/record-expense-payment.use-case.spec.ts \
    src/modules/expenses/presentation/http/expense.dtos.spec.ts \
    src/modules/expenses/infrastructure/prisma-expense.repository.void.spec.ts \
    src/modules/expenses/application/use-cases/void-expense-true-reversal.use-case.spec.ts \
    src/modules/expenses/infrastructure/prisma-expense.repository.posting-source.spec.ts \
    src/modules/ledger/application/use-cases/expense-auto-post.use-case.spec.ts \
    src/modules/expenses/application/use-cases/expense-branch-scope.use-case.spec.ts
  ```

  Result: **128/128 passed, zero skipped**, including six real PostgreSQL cases:
  same-key concurrent clients; same-key different targets (one success/one 409);
  distinct concurrent intents with preserved unkeyed history; real audit FK and outbox
  unique failures with full rollback/retry; current branch/tenant checks plus actual
  `voidExpenseTrueReversal` then replay. Synthetic company/user fixtures were removed.
- Existing `expense-payment-posting.use-case.spec.ts`: **10/10 passed**, including
  settlement-date period selection and existing-journal replay.
- Strict negative test: `env -u DATABASE_URL EXPENSE_PAYMENT_REQUIRE_POSTGRES=true`
  with the repository spec and `--test-name-pattern='Expense payment intent integrity'`
  exits **1**, explicitly reporting missing DATABASE_URL; it cannot silently skip in CI.
- `pnpm --filter @watchdog-bms/api test` (pretest + default registered list): passed.
  A final reporter-only rerun executes the exact package pretest/test commands with
  `--test-reporter=spec`: pretest **30 total / 16 passed / 14 skipped**; API **5,416 total /
  5,318 passed / 98 skipped**, zero failures/cancellations. Default-run skips are DB/external
  gated tests; the six new PostgreSQL tests ran separately above with zero skips. No package
  script was changed. Static assertion confirms all three edited API specs remain in the
  default script and the strict PostgreSQL env/command are present in CI.
- `pnpm --filter @watchdog-bms/web test`: initially **1,128/1,128 passed, zero skipped**;
  after the Opus UI correction, **1,133/1,133 passed, zero skipped**. Includes exact BFF
  payment payload/date, stable-intent edit/retry, definitive versus uncertain failure,
  network→403, conflict, timeout, and success/edit reset tests. The focused existing
  `expenses.model.spec.ts`, `expenses.api.spec.ts`, and `api-error-message.spec.ts` command
  passed **110/110, zero skipped**; web typecheck passed after the correction.
- `pnpm --filter @watchdog-bms/contracts test`: **197/197 passed, zero skipped** after
  root-approved one-line enum parity registry addition; production source stayed frozen.
- EXP-28 authoring verification only (no fixtures executed, browser or server started):

  ```sh
  API_PORT=3003 WEB_PORT=3000 E2E_API_BASE_URL=http://127.0.0.1:3003/v1 \
    E2E_WEB_BASE_URL=http://127.0.0.1:3000 S3_E2E=1 \
    pnpm exec playwright test e2e/expenses.spec.ts --project=chromium --grep 'EXP-2[78]' --list
  ```

  Lists exactly EXP-27 and EXP-28. TypeScript no-emit via the installed compiler API,
  reading `tsconfig.base.json`, with this file as the sole entry, ESNext/Bundler, strict
  inherited options, `types: ['node']`, returned **0 diagnostics**. Web `typecheck` and
  `git diff --check` passed after the one-line accessible method label change. No new
  package/config/harness was added. EXP-27 block SHA-256 before/after is unchanged:
  `5979999aee219c52d73a11e7da5e2f7b2a6ce2c8375fd427214daa48301a98fe`.
  Its supported finally-void preserves the document/receipt as voided evidence and
  checks zero payment rows; it does not delete attachments or mutate seed records.
- Root subsequently reported the exact eight focused API suites rerun on the isolated
  database with `EXPENSE_PAYMENT_REQUIRE_POSTGRES=true`: **128/128 passed, zero skipped**,
  including six real PG tests and scoped UUID fixture cleanup. Root also reported a real
  local EXP-27/28 browser run: **2/2 passed, zero skipped, 4.9s**, against API3003, isolated
  MinIO and root's web3000 session 10981. Root owns those run artifacts and final paths.
- Post-write-refresh follow-up: EXP-29 uses real un-intercepted payment POSTs, records
  their actual 201 responses, and fails only the first matching detail GET after the
  first successful POST. It checks persistent saved/refresh-pending copy without an
  alert, unchanged input, exact replay body/key, one real payment row, current history
  and 40 paid/60 outstanding after refresh. Finally voids only its owned fixture through
  the supported endpoint, preserving the document/receipt and voided payment evidence.
  Two PNGs plus JSON API/cleanup attachments will be produced when root executes it;
  this agent has not run EXP-29 or claimed its browser acceptance.
- Final authoring checks: the command above with `--grep 'EXP-2[789]' --list` discovers
  exactly EXP-27, EXP-28, EXP-29; the same E2E TypeScript no-emit check has **0 diagnostics**.
  `pnpm --filter @watchdog-bms/web exec tsc --noEmit` and `git diff --check` pass. No
  `next typegen` was run after root started web; its generated `next-env.d.ts` change
  belongs to root's dev process and must stay out of the delivery diff. EXP-27/28 combined
  block SHA-256 before/after is unchanged:
  `3481a552c90784250134d46ca80cdacfef4a757ee5bc43941211970d9124cc53`.
  Full web unit suite rerun after this production correction: **1,133/1,133 passed,
  zero skipped** (4.87s); EXP-29 itself remains pending root browser execution.
- Initial failures were reported and corrected, not suppressed: Date-object equality in
  the new test (compare milliseconds); expected BFF URL `/v1` versus actual `/api/v1`;
  typed fixture branch assignment; five missing Thai error translations; contracts parity
  registration (195/196 initially, 197/197 final). An initial full API invocation exited 1
  with its failure detail truncated from the tool output; the default rerun and final exact
  reporter-only rerun both passed. The initial failure's cause is not claimed as diagnosed.
- No cloud, browser, shared-database change, commit, push, or PR performed. No screenshots
  are claimed here; root owns actual browser evidence and its final location.

## Root acceptance — supersedes pending browser notes above

- Root reran the exact eight API suites on the isolated DB: **128/128 passed, zero
  skipped**, including six actual PostgreSQL concurrency/rollback/void cases. This is
  not the default API suite's skipped-DB result. Full web suite **1133/1133**, and root
  web `typecheck` passed with the local server stopped; generated next-env excluded.
- Full local `e2e/expenses.spec.ts` via real web/BFF/API3003/MinIO: **21/21 passed,
  zero skipped**. The first full attempt was 20/21: EXP-29's global alert-count also
  found Next's empty shadow-DOM route announcer, not an expense failure. Root inspected
  actual Chrome DOM: host `NEXT-ROUTE-ANNOUNCER`, empty text, outside main. Scoped the
  assertion to the real main expense error surface and reran the full suite successfully.
- Root visually inspected all six images in the [evidence README](../evidence/expense-payment-capture-integrity/README.md).
  Replaced tall full-page captures with viewport images; final EXP-27 success capture
  explicitly waits for the deliberately induced earlier network-error toast to expire.
  No error is hidden by editing an image. The negative screenshot deliberately retains it.
- Actual Chrome: created and retained only an owned synthetic 100-baht DRAFT through
  manual entry, checked desktop1280×900/mobile390×844, required-field guard, saved totals,
  no horizontal overflow and no console warnings/errors. SQL readback matched NO_VAT /
  paid0/outstanding100. No confirmation/payment on that fixture. EXP-27/29 perform real
  payments through rendered Chromium UI; EXP-28 intercepts error responses only. Every
  owned E2E payment fixture is voided through its supported API afterward. Shared DB,
  live providers, cloud, primary dirty `plan` and frozen P15 worktree remain untouched.
- Opus CLI used actual `claude-opus-5 --effort max` (modelUsage verified). Initial reviews
  returned REQUEST_CHANGES for first-4xx ambiguity and lost post-write refresh; those
  verified issues were fixed and are covered by EXP-28/29. The final follow-up still
  requested wheel/arrow edit guarding or a new confirmation policy. Root did not adopt
  that policy change: §19m explicitly defines editing as a new intent with a persistent
  duplicate-risk warning, then a separate explicit Save; edits never submit themselves.
  Arrow edits are legitimate keyboard input, not an automatic payment. This acceptance
  is root's evidence-based disposition, **not an Opus APPROVE claim**. Physical-device
  input and actual 40+ usability remain P24 acceptance, not proven by Chromium emulation.
- Root added explicit rendered checks: EXP-29 focuses/hovers the amount then wheels;
  Chromium retains amount40 and saved/refresh-pending intent without a second POST.
  EXP-28 ArrowUp changes42 to42.01 with the new-intent warning still visible and POST
  count unchanged. Full suite after these checks: **21/21 passed, zero skipped, 21.6s**.
  This is observed desktop Chromium behavior, not a claim about every browser/device.
- Root's first legacy-gate invocation included this new-format memory by mistake: the
  older plan passed, while the script demanded retired BA/SA role headers from the new
  memory. Per current AGENTS, rerun that checker only on the older plan; do not add
  fictional role passes or weaken the checker. New memory uses explicit evidence here.
- Same-text saved/refresh notice on a later refused retry is not re-announced, but the
  real submit has pending/disabled feedback and shared mutation-error notification;
  existing saved state/key remain. No extra announcer or speculative shared-toaster
  change was added under Ponytail full. Post-write replay is idempotent at the DB boundary.

## Isolated browser bootstrap handoff (executed; retained for root)

### Post-rebase integration setup

- Rebased implementation onto develop `21f109d5` as `70346946`; source integration had
  no conflicts. Post-base web **1139/1139 passed, zero skipped**; web/API typecheck pass.
  Changes since the original baseline include no API production change, only its
  procurement DTO test, so the isolated compiled API remains the same tested source.
- Expanded local browser check to accounting + AP + expenses (33 cases). First run was
  **28/33**: accounting writes correctly returned422 because this fresh isolated seed
  had no company VAT fact. No guard or production code was changed. Via the normal
  permission-checked local Owner API, set only this synthetic company to NOT_REGISTERED
  effective2026-07-01, command `expense-capture-qa-vat-notregistered-20260827`, version0→1.
  This describes the NO_VAT test fixture, not the Owner's real tax status or the pending
  P27 unknown-document-VAT policy. No live/shared DB was touched.
- Next run was **32/33**: all accounting6 and AP6 passed; legacy EXP-04 incorrectly
  required a VAT-base row even when the real capture-policy endpoint returned SIMPLE.
  Code `showsTaxCapture()` intentionally hides VAT rows on untaxed SIMPLE documents.
  Root changed only that test to read the policy for the actual expense civil date and
  assert the corresponding visible/absent VAT row; totals/transition assertions remain.
  The same test already passed FULL mode before this fixture configuration; no production
  behavior or financial expectation was weakened. Final combined run follows below.
- Final combined run at 2026-08-27T04:17:41Z: **33/33 passed, zero skipped/flaky**, 33.7s.
  Accounting6 + AP6 + expense21, including the real receive/payment retry and two real
  expense-payment retries. E2E TypeScript no-emit for all three files: **0 diagnostics**.
  Updated four PNG and payment-api-proof.json to this same final run; recaptured both
  Chrome JPEG after rebase and the synthetic company setup. Root inspected all six.
  Actual Chrome no main error alerts, warning/error logs empty, no horizontal overflow
  at1280×900/390×844; viewport reset afterward. `playwright-report/index.html` is the
  full generated 33-case report. The earlier failed environment/test attempts above are
  retained in this log rather than represented as passing. No production code changed
  after the implementation rebase; final delta is E2E fixture-aware assertions/evidence.

- Retain DB `watchdog_expense_payment_capture_20260827` on local `docker-postgres-1`,
  `127.0.0.1:15432`, for root's requested browser QA. URL pattern (do not log the password):
  `postgresql://watchdog:<LOCAL_DB_PASSWORD>@127.0.0.1:15432/watchdog_expense_payment_capture_20260827`.
  All migrations in this worktree were applied to this disposable DB only. Shared
  `watchdog_bms` and P15 were not migrated. Do not drop this DB while root is using it.
- Read-only seed audit: `seed.ts` main rejects APP_ENV=production (line 2643), calls the
  existing permission reconciler, then creates Owner and 11 QA role accounts (lines 178–254,
  2842). Passwords are repository-owned development fixtures, not reproduced here.
  `qa.finance`/OWNER can record payments; `qa.staff` cannot. Company is `seed-local-company`;
  the second company is `seed-local-company-2`. Prefer a newly entered manual expense for
  financial assertions: old demo fixtures include header-only paid amounts without payment rows.
- **Seed is not inherently network-free**: `seed-attachment-storage.ts` writes S3 when
  S3_BUCKET is set. Pin S3_ENDPOINT and S3_PUBLIC_ENDPOINT to local MinIO
  `http://127.0.0.1:19000`, pass explicit local credentials, and use a new versioned bucket
  `expense-payment-capture-20260827` for isolation. Do not inherit cloud/LINE/AI credentials.
  Created only that new local bucket and verified versioning is Enabled.
  Seed with S3_BUCKET empty writes tmp files, but API config requires a nonempty bucket and
  selects S3; that mismatch would break previews, so do not mix those two modes for this QA.
- Root explicitly authorized the isolated targets and API port 3003. Rebuilt contracts/config,
  generated Prisma, built API, and ran both commands below in a clean allowlisted environment
  against only the isolated DATABASE_URL and explicit local MinIO:

  ```sh
  pnpm --filter @watchdog-bms/api exec tsx prisma/seed.ts
  pnpm --filter @watchdog-bms/api exec tsx prisma/sync-feature-launch-gates.ts --verify-specialist-closed
  ```

  Seed completed: 346 permissions, 13 roles, 1,452 grants, OWNER and 11 QA role accounts.
  Launch sync completed: opened 16, closed baseline 4, unchanged 0, attested 0, skipped 2
  unmaterializable specialist routes; specialist-closed verification passed. DB reads
  confirmed expenses/DEFAULT and sales_documents/DEFAULT OPEN at generation 1. `seed.ts`
  alone does not initialize launch gates. No production launch gates were touched.
- Local-only bootstrap/serve helper (outside git):
  `/tmp/expense-payment-capture-local-20260827.cjs`. Exact commands:

  ```sh
  node /tmp/expense-payment-capture-local-20260827.cjs bootstrap
  node /tmp/expense-payment-capture-local-20260827.cjs serve
  ```

  Bootstrap was already run; do not rerun it on the seeded DB. It intentionally requires
  the migrated DB to have zero companies, a new bucket, and unused Redis DB15. The helper
  asserts Docker loopback bindings before reading local credentials in memory; no secret
  is written or printed. It passes only explicit application variables, never inherited
  `.env`, S3, LINE, AI, or cloud credentials. The serve mode runs the compiled API entry
  `apps/api/dist/apps/api/src/main.js`; it does not run web or migrate the database.
- Retained API exec session **11601**, child PID **95550**, listening on
  `127.0.0.1:3003`. Initial health evidence at `2026-08-27T03:23:42Z`:
  `/v1/health` HTTP 200/status ok; token-authenticated `/v1/internal/health/readiness`
  HTTP 200 with `db: ok`. No token is recorded here. The Opus correction touches only
  UI/model/tests/docs, so this API was not restarted. The post-write refresh follow-up
  likewise has no backend/schema/server change.
- Safe runtime configuration: `APP_ENV=local`, `DEPLOY_ENVIRONMENT=local`,
  `NODE_ENV=development`, `GIT_SHA=d2b40f37948d482c1bdd29c6047551c4258f24a7`,
  `HOST=127.0.0.1`, `PORT=3003`,
  `CORS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000`,
  `REDIS_URL=redis://127.0.0.1:6379/15` (verified unused before bootstrap; no flush),
  `S3_BUCKET=expense-payment-capture-20260827`, `S3_REGION=local`,
  `S3_ENDPOINT=S3_PUBLIC_ENDPOINT=http://127.0.0.1:19000`, `S3_FORCE_PATH_STYLE=true`,
  `AWS_EC2_METADATA_DISABLED=true`, `EMAIL_PROVIDER=disabled`,
  `AI_GATEWAY_INTERNAL_URL=http://127.0.0.1:1`, and log redaction enabled. S3/DB credentials
  come only from the validated local Docker containers. JWT/worker secrets are random
  local process values; no AWS secret lookup is configured.
- No web server was started by this agent; root owns web3000 and points its INTERNAL_API_URL
  to `http://127.0.0.1:3003/v1`. Existing API3001 and shared DB were left untouched. Retain
  the isolated DB, versioned bucket, and API session for root's desktop/mobile browser QA.

## Delivery provenance — supersedes pre-PR/authoring state above

- Read-only GitHub verification on 2026-08-27: [PR287](https://github.com/MangmeeDev/mangmeeplus/pull/287)
  is MERGED to develop at `111532966c415fee11abb36ca1749bf1fc66ee52`, merged
  2026-08-27T04:36:17Z. [CI33039136161](https://github.com/MangmeeDev/mangmeeplus/actions/runs/33039136161)
  completed SUCCESS on exact head `179981a45f00a1d0b3a1898dce9f877f2457563e`.
- Final post-rebase browser run began2026-08-27T04:17:41Z: accounting6 + AP6 + expense21
  **33/33 passed, zero skipped/flaky**, web1139/1139 and eight-suite checks128/128
  (including 6 real PostgreSQL cases). Six selected
  desktop/mobile images plus [payment-api-proof.json](../evidence/expense-payment-capture-integrity/payment-api-proof.json)
  are tracked in the merged commit; [README](../evidence/expense-payment-capture-integrity/README.md)
  distinguishes real EXP27/29 commits from EXP28 mocked POST errors and physical-device limits.
- This superseding docs audit did not rerun browser/DB tests or alter runtime. Earlier
  failures, author-only notes and root's Opus disposition remain historical evidence;
  there is no invented final Opus APPROVE or live rollout claim.

## Next

No implementation/PR work remains for this bounded capture fix. Preserve the isolated
fixtures/evidence while root uses them; do not rerun bootstrap or apply migration to a
shared/live DB from this audit. Main promotion remains gated by the remaining active scope;
production migration lock timing, deployment protocol, physical-device/40+ acceptance and
P27/P28 Owner policies remain separate decisions.
