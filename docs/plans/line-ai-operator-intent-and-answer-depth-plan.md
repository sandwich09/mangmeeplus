# LINE AI Operator Intent and Answer Depth Plan

## Linked Spec

- [[../specs/line-ai-operator-intent-and-answer-depth-spec|LINE AI Operator Intent and Answer Depth]]
- [[../specs/line-ai-owner-daily-closing-spec|Existing Owner Daily Closing contract]]
- [[../specs/feature-disabled-error-honesty-spec|Existing feature-disabled honesty contract]]

## Objective

Fix the Production over-answer at the shared orchestration boundary: the semantic router plans the
smallest tools, the model loop cannot broaden that plan, and LINE labels its web action truthfully.
Extend the same boundary so disabled company features, real permission gaps, unsupported advice,
missing bill references, empty data, and source failures produce different truthful answers. Prove
Thai owner/operator language quality with at least 100 local real-provider invocations.

## Ponytail Decision

- Reuse `AgentIntentItem.requiredTools`; do not add a second goal/time/depth wire contract.
- Reuse the existing controlled real-provider pattern and fixed read-only ERP fixtures.
- No dependency or `package.json` change.
- Do not create a new daily-closing page in this patch.
- Reuse the permission resolver's existing `entitlementDeniedPermissions` and exact entitled feature
  set, `hasToolPermissions`/`hasToolFeature`, refusal codes, and corpus runner. Do not add a second
  availability service or let the model decide permissions/features.

## Phase 1: Authoritative Tool Boundary

- Change `availableToolsForPlan` to iterate each intent's `requiredTools`, then retain the existing
  enabled/agent/subject/permission intersections.
- Pass planned tool names in native-loop subrequest context for diagnosability.
- Keep multi-intent union and duplicate-call behavior.
- Add deterministic native and JSON loop tests where the mocked model requests
  `expense.get_daily_closing` from a plan permitting only `expense.list_recent`; assert zero daily
  ERP invocations.

Exit: the model loop cannot re-plan a business intent.

## Phase 2: Semantic Catalog and Prompt

- Describe `expense.list_recent` as the period summary/list tool for current month or explicit range;
  add the summary question kind and use the summary category.
- Narrow `expense.get_daily_closing` wording to explicit one-day operational closing/due/review use.
- Add a concise contrast rule to the router prompt without adding a keyword bypass.
- Keep daily-closing permission and API contract unchanged.

Exit: the provider receives a clear semantic distinction before it builds `requiredTools`.

## Phase 3: Answer and Link Honesty

- Preserve existing concise model composition for `expense.list_recent`.
- Assert that a monthly total case cannot contain daily-close sections.
- Override the daily-closing card action label to `ดูรายการค่าใช้จ่าย` while the path remains the
  generic expense list.
- Do not add date query parameters the current expense page does not consume.

Exit: wording, answer depth, and destination agree.

## Phase 4: 220-Case Operator Corpus

- Add a data-only corpus with stable ids, category, message, expected tools, and forbidden tools.
- Include 220 rows across normal Thai, colloquial Thai, abbreviations, typos, no-space text,
  repeated characters, Thai/English mix, expense and ten other business topics, and multi-intent
  cross-topic cases.
- Add a corpus integrity test: unique ids, >=120 cases, every case has an expectation, and required
  category minima are met.

Exit: language breadth is reviewable without reading test code.

## Phase 5: Local Invocation

- Add a standalone script following `run-line-ai-controlled-conversation.ts`:
  - loads the configured local provider from environment;
  - invokes `IntentRouterAgent.route` for every corpus row;
  - uses no API, DB, LINE, or mutation tool;
  - prints aggregate JSON and only failing case details;
  - exits non-zero on any wrong/forbidden plan.
- Invoke all corpus rows locally (>=100) against the configured provider.
- Run a bounded full-orchestrator sample across monthly, daily, typo, abbreviation, and multi-intent
  cases with fixed ERP data to verify actual invocation boundaries.
- Never print provider credentials or raw environment values.

Expected command:

```bash
set -a; source .env; set +a
pnpm exec tsx scripts/run-line-ai-operator-language-eval.ts
```

Exit: report records provider, total, passed, failed, category counts, and duration.

Local result 2026-08-19:

- full orchestration fixture replay: 220/220 passed;
- real Bedrock semantic preflight: `PROVIDER_UNAVAILABLE` because the managed local sandbox could
  not connect to `sts.ap-southeast-1.amazonaws.com`; rerun from a network-enabled terminal remains
  required before UAT.

## Phase 6: Verification and Handoff

- Run focused AI Gateway routing/native-loop/model-loop/business regression tests.
- Run API LINE business-card tests.
- Run AI Gateway and contract typechecks if the focused suites pass.
- Run `git diff --check`.
- Record exact commands/results in task memory.
- Stop before UAT/Production. Deployment requires a fresh read of both mandatory runbooks, one signed
  UAT candidate, READY, and Production protocol.

## Phase 7: Propagate the Server-Derived Cause

- Add optional `entitlementDeniedPermissions` and `entitledFeatureKeys` to internal
  `LineUserContext`. The exact set is required for cross-feature tools whose shared permission can
  remain effective while the tool's owning feature is off.
- Populate it from the existing resolver in direct webhook turns and ledger re-resolution; preserve
  it through the API -> AI Gateway -> AgentCore payload contract.
- Keep the field out of model prompts, logs, customer replies, source refs, and presentation cards.
- Do not issue actor delegation for a tool that is disabled or genuinely forbidden. The API tool
  boundary continues to re-resolve live access for every actual invocation.

Exit: the Gateway can distinguish feature stripping from a real role gap without a database read or
a model guess.

## Phase 8: Normalize Access Once Before Every Executor

- Add one shared plan-normalization function using `hasToolPermissions` twice: first with effective
  permissions, then with only server-resolved entitlement-denied keys restored.
- Convert stripped-by-feature intents to `feature_disabled`; convert still-missing permissions to
  `forbidden`; preserve answerable clauses as `PARTIAL`.
- Feed the normalized plan to native tool use, JSON model loop, and deterministic dispatch.
- Keep a late-change guard: specialist/composer handling of tool results with
  `errorCode=FEATURE_NOT_ENABLED` must produce the same feature-disabled outcome if entitlement
  changes between planning and invocation.
- Apply the same cause distinction to text/media receipt intake guards so an expenses-off company is
  not told it lacks upload permission.

Exit: all runtime paths agree, and disabled tools are not invoked merely to choose copy.

## Phase 9: Outcome-Specific Intent and Copy

- Add bounded Thai customer labels for current tool families (for example `ระบบสินค้าและบริการ`,
  `ระบบคลังสินค้า`, `ระบบค่าใช้จ่ายและเอกสาร`) without exposing internal feature keys. Keep
  `สินค้าและบริการ` (`product_catalog`) separate from `คลังสินค้า` (`inventory`).
- Implement the complete family matrix in spec §6.5, including core/no-feature-gate families and
  build-disabled tools; do not create one custom branch per individual tool.
- Split build/source-not-ready copy from company-feature-disabled copy.
- Tighten the router prompt/catalog examples so product recommendation advice (`ขายอะไรดี`) is
  `unsupported_module`; it must not substitute inventory search or aggregate sales summary.
- Route bill item questions to expense/accounting-document semantics. Expand grounded recent-receipt
  reference wording to cover `บิลนี้` and item questions.
- When a selected bill has lines, answer those lines first. When the reference is absent/ambiguous,
  ask one selection question. Never infer line items from vendor, category, or inventory.
- Emit no source reference or hidden-feature web button for a disabled response.

Exit: the three owner examples in spec §6.1 produce three distinct, truthful journeys.

## Phase 10: 128+ Availability Cases and Evidence

- Extend the existing corpus/runner with at least 128 unique availability-honesty questions and
  server-derived access fixtures; do not create a parallel runner.
- Assert semantic subject, planned tools, invoked tools, terminal outcome, required copy, forbidden
  copy, source refs, and links per row.
- Include at least 40 typo/short/abbreviation/no-space/repeated-character/Thai-English cases.
- Run every new row through full local orchestration with fixed read-only ERP results.
- From a network-enabled local terminal, invoke at least 100 exact new rows through the configured
  real semantic provider before UAT.
- Record source commit, corpus SHA-256, provider/model id (no credentials), counts, duration, and
  forbidden-tool count in task memory. A report with any skipped case or forbidden tool call fails.

Exit: fixture replay is 100%, real-provider semantic evaluation is >=100 unique questions and 100%,
and all negative wording/link assertions pass.

Local status 2026-08-19: phases 7-9 and the fixture half of phase 10 are complete. The corpus now has
216 availability/failure rows (83 noisy), and the combined full-flow replay passes 436/436 with zero
forbidden tool calls. Real-provider semantic evaluation remains required before UAT.

## Verification Matrix

| Concern | Evidence |
|---|---|
| planner authority | model asks unplanned tool; ERP invocation remains zero |
| monthly language | exact incident + typo/short/abbreviation corpus rows |
| daily closing | explicit operational daily corpus rows |
| multi-intent | planned union only; no unrelated third tool |
| answer depth | monthly response excludes daily sections |
| link honesty | button label/path renderer test |
| security | existing permission/subject/tenant tests remain green |
| real model | >=100 local provider routing invocations |
| feature off vs permission | same tool/role fixture with only entitlement cause changed |
| feature off vs source failure | `FEATURE_NOT_ENABLED` and `SOURCE_MODULE_NOT_READY` produce different copy |
| unsupported advice | `ขายอะไรดี` variants invoke zero nearby tools |
| bill semantics | bill item question invokes expense/document detail, never inventory |
| missing bill | one clarification and zero ERP calls |
| line/link honesty | disabled response has no source ref and no hidden-feature button |
| product vs stock | product search succeeds with catalog ON/inventory OFF; stock reads refuse honestly |
| supplier vs customer bill | expense and sales-document fixtures route to different tools |
| bank vs ledger | bank question never substitutes a ledger balance |
| leave vs employee | leave question never substitutes an employee headcount/detail |
| core/no gate | company/branch/employee/reimbursement never fabricate `feature_disabled` |

## Evidence Gates

| Gate | Required proof |
|---|---|
| Baseline | current focused tests plus a local reproduction of the orchestrated inventory wording defect |
| Unit | API context propagation; three-way access classifier; late `FEATURE_NOT_ENABLED`; copy/link assertions |
| Integration | direct local orchestrator and serialized AgentCore payload produce the same terminal outcome |
| Corpus | >=128 new unique fixture cases covering every spec §6.5 family, all pass; >=100 exact real-provider semantic invocations, all pass |
| Controlled UAT | same role across feature ON/OFF companies plus a feature-ON role-without-permission control; exact candidate/run ids recorded |
| Release | mandatory UAT/READY/Production v2 protocol, signed result, customer `OPEN`; no deployment is authorized by this plan |

Baseline captured 2026-08-19:

- API authoritative tool boundary: 33/33 passed.
- AI Gateway deterministic turn + composer: 59/59 passed.
- Existing operator replay through real local orchestration code: 220/220 passed, 0 failed, 146 ms.
- Local registry inventory: 60 tools total, 55 router-enabled, five build-disabled, eight with no
  company feature gate.
- Direct `InventoryAgent` characterization reproduced the gap: the tool returned
  `FEATURE_NOT_ENABLED`, but the specialist returned `FAILED / ไม่สามารถดึงข้อมูลสต็อกได้ในขณะนี้`.

These results prove the current boundary and the defect. They do not count as post-fix acceptance.

Post-fix local result 2026-08-19:

- full local replay: 436/436 passed (220 intent-depth + 216 availability/failure), 104 ms;
- AI Gateway focused suites: 146/146 passed;
- API focused suites: 137/137 passed;
- corpus integrity: 2/2 passed; contracts/API/AI Gateway typechecks and `git diff --check` passed;
- AgentCore HTTP test is sandbox-blocked by `listen EPERM`; real-provider evaluation is
  network-blocked and remains a pre-UAT gate.

## Rollback

The code change is additive metadata plus a narrower executor set. Rollback is the previous AI
Gateway/AgentCore artifact. No schema, database, or customer data migration is introduced.
