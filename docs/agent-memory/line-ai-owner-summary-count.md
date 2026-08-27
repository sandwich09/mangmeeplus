# Agent Memory: LINE AI owner summary count

Status: Amount-role follow-up frozen at base `70033af22415d59424fa3415448e150404262e48`; focused118/118, gateway984/984, API/gateway types and diff check passed. PR #288 held for root review and new exact-head CI. Not shipped or live-provider accepted.
Owner: `/root/ocr_platform_admin`; root reviews/integrates.
Scope: Port the intended PR #264 response-only slice and preserve source count/amount roles.

## Decisions and inspected evidence

- Clean worktree `mangmeeplus-line-ai-owner-summary-count`, branch
  `codex/line-ai-owner-summary-count`, fetched develop
  `21f109d51e91d96836aaa3423730072378e977b7`.
- `gh pr view 264 --json ...` confirms OPEN, base develop, one commit/head
  `0edb396b1d3bf56c042fbd53194778738e4d696e`, six changed files. Read its exact
  `git show`, existing memory, operator answer contract §8, and business-query count
  contract. No cherry-pick, no old mixed stack, no edits to the old PR/expense worktrees.
- `ExpenseListRecentTool` in `erp-tools.use-case.ts` sets `data.total` to
  `summary.countedItems`, excludes REJECTED/VOIDED, carries `truncated`, and returns only
  `expenses.slice(0, 5)` as preview. Existing registered API test proves counted total
  differs from raw preview when a record is rejected. No count may come from that preview.
- Root approved source-backed count fallback and fail-closed invalid/missing counts.
  Tracing showed the composer already receives both raw source data and fallback, so the
  count line can be added there without modifying AccountingSummaryAgent or adding a
  second fact builder. The existing count-intent predicate will be shared internally.
- Ponytail full read in repository. Explicit title and safe-tenant-link renderer remain
  authoritative. No package/dependency, permission, schema or provider config change.
- Root early review identified that a global record count cannot answer distinct-vendor,
  payment or status-subset counts. These now return explicit breakdown-unavailable copy
  with original grounded details, without a model guess or global-count substitution.
  Thai/English and total-zero cases are tested. This conservative composer guard adds no
  subset query, router, distinct calculation or new owner policy.
- The expense count answer uses the canonical top-level total, not nested count keys or
  preview cardinality. Broad amounts remain concise; detail/status intent, daily closing,
  multi-tool behavior, source refs and safe links remain intact.
- Root capture-heading trace confirmed in `LineAiTurnUseCase.runDeterministicPath`: no-tools
  returns the classified capture intent plus `refused: false` and error text; failed tool
  results can also retain capture intent and no read presentation. Intent therefore is not
  proof of receiving/saving success. Remove the newly ported capture-specific heading and
  use the existing generic answering heading; preserve explicit trusted titles and bodies.
  No gateway/outcome inference or capture policy change is needed. The special capture
  heading is now removed; the generic answering heading is used without outcome inference.
- Root reproduced a role-swap despite numeric/word membership guards: source count 7 and
  amount 85 accepted `มีค่าใช้จ่าย 85 ใบ จำนวน 7 บาท` and `85 expenses total 7` unchanged
  when the preview was nonempty. Root directs the smallest correct boundary: supported
  sole-expense count answers now use canonical count line plus grounded facts before
  provider composition, just like deterministic daily closing. Count+money/date labels
  cannot be model-reassigned; no new count-unit parser, router or provider setting.
  Previous supported-count provider-called golden expectations are superseded by this
  stricter deterministic contract. Amount-only model composition was unchanged at that
  earlier freeze; it is superseded by the authoritative-amount follow-up below.
- Root then reproduced `ค่าใช้จ่ายเดือนนี้กี่บาท` being treated as a count because the
  shared count predicate matches `กี่`; `จำนวนเงิน` has the equivalent collision. Correct
  only the sole-expense predicate by removing these two Thai monetary phrases from its
  guard text. The actual question and generic routing remained untouched. At that freeze,
  the later model count guard consumed `effectiveToolData`, not a raw count excluded from
  the model's amount-only projection. That projection is now removed; mixed record-count
  plus money wording stays deterministic.
- Root reproduced a remaining amount-role failure at clean HEAD `70033af2`: source
  count 7, current total 85 and nonempty preview amount 40 accepted `ค่าใช้จ่ายทั้งหมด
  2026 บาท` when 2026 came from the question or `currentDate`. Existing numeric guards
  also admit prior-context and value-candidate amounts; membership is not monetary-role
  authority. This supersedes the amount-model/projection contract in the history below.
  Reuse the existing concise grounded total as an authoritative early return for the
  already-classified sole-expense amount-only path, and delete its unreachable projection.
  Detail/status/vendor, multi-tool and other model paths retain full source and their
  existing context/value-candidate guards. No new role parser, router or provider config.
- The current AccountingSummaryAgent expense total fact is `ยอดทั้งหมด` plus its
  existing formatted value and `บาท`; the composer only relabels it `ยอดรวม`. Keep that
  line even for English questions rather than inventing currency/formatting or claiming
  full translation. Generic context tests must still exercise a reachable model path;
  separate nonempty-source regressions prove amount-only answers cannot reuse an old sum.

## Artifacts

- `docs/specs/line-ai-owner-summary-count-spec.md`
- `docs/plans/line-ai-owner-summary-count-plan.md`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts`
- `apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts`

Only two production files changed. No AccountingSummaryAgent or API query change was
needed; source count semantics are proved by the existing API contract test.

## Verification

### Current refreeze: authoritative amount roles (PR #288 hold)

- Read-only start confirmed clean HEAD `70033af22415d59424fa3415448e150404262e48`.
  Read repo AGENTS and Ponytail full; traced AccountingSummaryAgent facts and composer
  caller. Spec/plan updated before implementation. No P11, API, DB, package or live changes.
- Registered composer/orchestrator tests ran red before the production change:
  **106/118 passed, 12 failed, zero skipped**. Five nonempty-preview cases returned the
  wrong monetary total unchanged: 2026 from Thai/English question or `currentDate`, 150
  from prior conversation and 60 from an extracted Thai-word value candidate. Seven
  additional failures were the new zero-provider contract for broad/Thai/English amounts.
- Production change is the early-return condition plus deletion of the unreachable
  projection/alias. It introduces no new intent rule, role parser, formatter or provider
  configuration. Existing detail/vendor/status, unsupported subset, missing/truncated,
  count/money, multi-tool and daily-closing tests remain green. Generic context tests now
  explicitly request expense detail to exercise the still-reachable full-source model
  path; generic number reformatting is checked with the existing sales-summary tool.
  Amount-only context/candidate questions are separately proved canonical, not model-led.
- Final focused command:
  `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test --test-reporter=spec
  src/modules/line-ai/agents/response-composer.agent.spec.ts
  src/modules/line-ai/agents/orchestrator.agent.spec.ts`: **118/118 passed, zero skipped**.
- `pnpm --filter @watchdog-bms/ai-gateway test`: **984/984 passed, zero skipped**, including
  registered response, orchestration, native/model-loop, permission, context, value-candidate
  and local graph-boot tests. Read-only script inspection confirms both focused specs are
  in the default test and LINE business-coverage registries; no standalone test/package edit.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`,
  `pnpm --filter @watchdog-bms/api typecheck`, and `git diff --check`: **passed**.
  API production/tests are unchanged; no new full-API run is claimed for this follow-up.
- Six amount-wording goldens assert zero provider calls and the exact existing Thai
  `• ยอดรวม: 85.00 บาท` line, including the two English questions. No unrequested count,
  vendor or status appears. This is a scoped grounding repair, not full translation,
  arbitrary-language NLU, live model/LINE quality or end-to-end latency acceptance.
- Frozen source SHA-256: composer
  `fcc5bea96b9fea612f91b13296d9ffe14397069fe30604961ee788764f7f03e3`;
  registered composer spec
  `9b4a395da4fade450017ed04f8451906a14521a2be4098923e76357e7ff1f858`.
  Exactly five current dirty files: composer, its registered spec and these three docs.
- Root reports old-head `70033af2` CI `33040537029` succeeded, but it predates these red
  cases and cannot clear the hold. Root will integrate the later develop/P11 merge only
  after this freeze, then obtain a new commit/exact-head CI. No rebase/commit/push, P11
  modification, cloud, browser, live provider or DB operation was performed here.
- Root independently reviewed the frozen five-file diff and reran the registered
  composer/orchestrator pair: **118/118 passed, zero skipped**. The original nonempty
  source counterexample (count7/total85/preview40) now returns exactly
  `• ยอดรวม: 85.00 บาท` with zero provider calls for Thai explicit-year, Thai current-month
  with currentDate2026-08-27, and English August2026 questions. All29 incoming paths
  from develop `d8d9808e41d15360810ed67e9169ade0cd5605ab` are disjoint from the eight
  phase files. This accepts the scoped source fix for integration/new CI, not live AI,
  main promotion or the old green CI as proof of this correction.

### Previous refreeze: narrow Thai amount wording

- New registered amount goldens ran red before production changes: **107/111 passed,
  4 failed, zero skip**, all because monetary questions skipped the amount-only provider
  path. Two mixed money+record-count goldens already passed and remain deterministic.
- Production follow-up is two changed expressions plus a comment: sole-expense count
  detection removes only `กี่\s*บาท` / `จำนวน\s*เงิน`; the later count guard consumes
  `effectiveToolData`, matching the actual model payload. Actual question text, generic
  router, provider configuration, API and count/money-role safety are unchanged.
- Final focused composer/orchestrator: **111/111 passed, zero skip**. Four amount goldens
  assert one provider call, unchanged question, amount-only payload, an accepted 85-baht
  model answer without count/vendor/status output, and concise provider-failure fallback.
  The two mixed forms retain canonical count 7 plus the grounded amount with no provider.
- Full `pnpm --filter @watchdog-bms/ai-gateway test`: **977/977 passed, zero skip**;
  gateway `typecheck` and `git diff --check`: **passed**. Same commands as recorded below.
- API code/tests did not change during this follow-up: the previous **37/37** source/card,
  **345/345** API LINE and API typecheck evidence still applies. No API rerun is claimed.
- This recognizes only the documented Thai money wording, including whitespace; it is
  not a general currency parser or arbitrary-language NLU guarantee. Source is refrozen
  for root review, with no commit/push or external/live operations.

### Previous combined refreeze: authoritative count and safe capture heading

- Capture regression first ran red: **30/31 card tests passed, 1 failed** because the
  header said `น้องมั่งมีรับข้อมูลแล้วนะคะ` despite capture intent with no tool/failure.
  Removed only that special header branch. Final source-contract plus card suite:
  **37/37 passed, zero skip**; the new registered case checks refused-false no-tool and
  failed-tool envelopes, unchanged error body, and preservation of explicit trusted title.
- Count-role regression ran red before the deterministic early return: Thai/English
  swapped count/money, count-as-date and new no-provider expectations failed. The fixtures
  deliberately have a nonempty preview so the empty-data guard cannot hide the defect.
  Changed only the early count-return condition and restored the unchanged generic-tool
  count guard; no unit/role parser was introduced.
- Latest focused composer/orchestrator run: **105/105 passed, zero skip**.
- Latest full `pnpm --filter @watchdog-bms/ai-gateway test`: **971/971 passed, zero skip**.
- Latest `env -u DATABASE_URL pnpm --filter @watchdog-bms/api test:line-ai-business-coverage`:
  **345/345 passed, zero skip**.
- `pnpm --filter @watchdog-bms/api typecheck`,
  `pnpm --filter @watchdog-bms/ai-gateway typecheck`, and `git diff --check`: **passed**.
  API typecheck was run after the last API/card edit; gateway checks after the last
  composer edit. Read-only script assertions confirm new cases stay in the default API,
  gateway and API LINE test registries. No package edit.
- Supported count questions now make **zero provider calls**. Canonical source count
  and grounded amount labels are authoritative; amount-only questions still compose
  through the model with the original safety checks. Missing/invalid/truncated/subset
  boundaries and possessive/matching-exclusion regression cases remain green.
- Source is frozen for root review. No commit/push/PR, live AI/LINE, browser, DB or cloud
  operation. These synthetic boundary tests do not claim arbitrary-language NLU quality.

### Earlier verification history (superseded counts/contracts are retained honestly)

- Root reproduced two missed over-refusal cases against the first frozen source, both
  with `total: 7` and zero provider calls: `ค่าใช้จ่ายของร้านเรามีกี่ใบ` and
  `เดือนนี้มีค่าใช้จ่ายกี่ใบ ไม่รวมยกเลิกหรือถูกปฏิเสธ`. The keyword guard incorrectly
  treated possessive store context and the tool's own exclusions as unsupported subsets.
  The earlier green test counts did not cover these cases. This follow-up normalizes
  only those guard phrases, not the model question or permission-checked source data;
  regression and final rerun evidence follow below.
- Follow-up red run before the guard fix: **95/101 passed, 6 failed, zero skip**.
  All six failures prove source-backed questions were refused before provider composition;
  company-only possessive wording already worked. The first normalization attempt reached
  **99/101**, exposing a second cause: `จ่ายกี่` matched the suffix of `ค่าใช้จ่ายกี่ใบ`.
  Added a narrow negative lookbehind for `ค่าใช้`, so genuine payment-count wording is
  still guarded. An intermediate full gateway run also failed these two same golden
  cases. An intermediate typecheck found one TS18046 in the new test's unknown payload;
  replaced field access with a whole-payload equality assertion, without a production cast.
- Earlier over-refusal follow-up on that refrozen source: focused composer/orchestrator **102/102**,
  full gateway **968/968**, both **zero skip**, and gateway `typecheck` plus
  `git diff --check` passed. Commands are identical to the focused/full gateway commands
  recorded below. At that stage, eight named supported-scope golden cases verified provider
  invocation and unchanged question/source payload. They now assert zero provider calls
  under the stronger deterministic contract above. The existing unsupported
  case matrix now also covers distinct shops, owner-store plus pending status, a single
  exclusion, and matching exclusions plus an additional paid/pending subset.
- This follow-up changed only the existing composer helper, its registered test and these
  scoped docs. API/card code is unchanged from the verified first freeze; its prior test
  and typecheck evidence below remains applicable. No new provider/router/query behavior,
  package change, live test or external operation was introduced.
- `pnpm install --offline --frozen-lockfile`: passed, 733 packages reused, no downloads.
- `pnpm --filter @watchdog-bms/contracts build` and
  `pnpm --filter @watchdog-bms/config build`: passed.
- `DATABASE_URL=postgresql://local_only:unused@127.0.0.1:1/line_ai_generation_only pnpm
  --filter @watchdog-bms/api exec prisma generate`: passed. Generation only; no database
  connection, migration or seed. The explicit unreachable local URL prevents inherited
  database configuration being used.
- Initial gateway focused run: **91/92 passed, 1 failed**. The test-only `planFor` stub
  recognized Thai expenses but routed English `how many expenses` to ledger. Added English
  expense recognition and language selection in that stub, not the production router.
- Initial API typecheck: **failed with two TS2339 errors** in new card assertions. Added
  explicit `assert.equal(result.type, 'flex')` union narrowing before reading contents;
  no production fix was needed. Final API typecheck passed.
- First-freeze focused gateway command (latest follow-up counts above):
  `pnpm --filter @watchdog-bms/ai-gateway exec tsx --test --test-reporter=spec
  src/modules/line-ai/agents/response-composer.agent.spec.ts
  src/modules/line-ai/agents/orchestrator.agent.spec.ts`: **94/94 passed, zero skip**.
- Final API source-contract/card command:
  `env -u DATABASE_URL pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec
  src/modules/line-ai/application/use-cases/erp-expense-list-recent.use-case.spec.ts
  src/modules/line-ai/domain/logic/line-business-card.logic.spec.ts`:
  **36/36 passed, zero skip**.
- First-freeze `pnpm --filter @watchdog-bms/ai-gateway test`: **960/960 passed, zero skip**, including
  local application-graph boot, native/model-loop, business-query, permission, grounding,
  daily-closing and prepared-read suites. Repeated after the last production change.
- `env -u DATABASE_URL pnpm --filter @watchdog-bms/api test:line-ai-business-coverage`:
  **344/344 passed, zero skip**. Expected fake Redis/provider failure logs are test cases,
  not live service calls.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck` and
  `pnpm --filter @watchdog-bms/api typecheck`: **passed**.
- A read-only Node assertion inspected both package scripts: all three edited specs and
  the unchanged `erp-expense-list-recent.use-case.spec.ts` are registered in default
  `test` scripts. No standalone undiscovered test and no package edit.
- `git diff --check`: passed. Working scope is five edited TS files plus the three new
  docs listed here. Generated Prisma files are ignored and not part of the diff.
- Tests use synthetic fixtures/stub providers. No live provider, browser/screenshot,
  cloud, DB operation, commit, push, PR, merge or external model review performed. Full
  repository API suite and live semantic-router/provider quality are not claimed; the
  full relevant LINE suites and API/gateway typechecks are the local evidence.

## Open questions

None for this bounded response correction. Supporting arbitrary distinct/subset count
queries needs an authoritative tool result and a separate scoped change; do not infer it
from a five-row preview. Root owns independent review and later live validation.

## Next

Keep this worktree frozen for root review. Root decides integration/rebase, follow-up
commit/exact-head PR CI and release after review; old PR #264 and expense/P15 worktrees
remain untouched.

## Earlier root integration verification — 2026-08-27 (before amount-role follow-up)

- Compared PR287's 30 incoming paths with this eight-file candidate: no overlap.
  Fast-forwarded from `21f109d5` to `111532966c415fee11abb36ca1749bf1fc66ee52`
  without stash/reset. Regenerated Prisma against an explicit unreachable local URL,
  rebuilt contracts/config and ran API/gateway typechecks: PASS. No DB connection/migration.
- Full gateway suite on this base: **977/977 passed, zero skipped**, including local
  graph boot and registered response/orchestration regressions. API source-contract/card
  suite: **37/37 passed, zero skipped**. Default maintenance pin check and diff check PASS.
- Root reproduced and reviewed the count/amount role-swap, money-wording collision and
  capture-title findings recorded above; these are corrected by bounded changes in the
  existing composer/renderer. No new endpoint, provider, schema, dependency or routing model.
- Three scoped Markdown files / one relative link target checked successfully. Existing
  live-router/LINE delivery, human 40+ and physical-device acceptance remain separate;
  these are synthetic response-boundary tests, not browser screenshots or live quality proof.
- Independent read-only review reported no P0/P1/P2 within the bounded two-file scope;
  reran composer/orchestrator111/111 and source/card37/37 with network denied, zero skipped.
  An in-memory chain using real classes (`ExpenseListRecentTool → AccountingSummaryAgent
  → composer → presentation → LINE card`) preserved count7 versus preview5 and amount140,
  zero composer-provider calls, and tenant-c1 links. The first cross-package probe needed
  an explicit gateway tsconfig for decorators; no source fix was required.
- Reviewed source SHA-256: composer `c969a00a11d9f8a4f39da15b8b5ea61b3e730c62f18957c4ca59eb5fe0cf3df9`,
  card `d274859b8a4329a362b6c9d51ca5980eb0a77987462e5337eab511267e54904d`.
