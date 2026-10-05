# LINE AI Text Intake Latency Without Quality Loss Spec

## 1. Status and decision

Status: the first compact-intake candidate is frozen at `c836e7e05c487b3677d10b6726eeb252e67b87ad` and its two-prompt same-model pilot is complete. NAT-01 passed its independent content rubric; NAT-02 exposed a pre-existing sales-versus-cash error under a synthetic all-module authority fixture. The actual paid tiers grant the Starter expense/reimbursement feature set, not sales documents or reports. Sales/report expansion is therefore deferred. The current reviewed diff makes the first-intake tool catalog match current package entitlements and actor permissions and passes focused source/transport checks; it still requires root full-diff review and package-real evidence. This spec does not authorize deployment, a model change, a package change, or a new product module.

The implementation decision is:

1. Keep one semantic model call for ordinary text intake.
2. Ask the provider for one compact, evidence-bound decision instead of duplicating the same read inside `semanticSubrequests` and a full nested `preparedPlan`.
3. Decode that private provider response on the AI Gateway and expand it into the existing canonical `LineIntakeRoutePlan`, `LineAiSemanticSubrequestV2[]`, and `LineAiPreparedPlan` contracts.
4. Load the authorized bounded conversation/task snapshot before the first intake call and reuse that one result; do not prefetch source-specific private ERP rows for every turn.
5. Keep permissions, entitlements, tenant/branch scope, source evidence, source-state rechecks, task revision checks, and final-mutation boundaries unchanged.
6. Derive a request-scoped effective tool catalog from the API's authenticated permission/entitlement snapshot, then intersect it with the Gateway's existing static/runtime tool availability. The prompt and compact decoder use that same immutable set.
7. Offer compact `simpleRead` output only when the existing fused-plan capability is true. Canonical semantic coverage remains required when fused planning is off.

This path is the default text behavior after the code version is deployed. It does not add an opt-in flag or secret. Rollback is a code-version rollback. The existing configured model remains unchanged until same-model quality evidence passes.

## 2. Product goal and user journey

For a short text question such as `เดือนนี้ค่าไช้จ่ายไปเท่าไหร่แล้ว`, the user should receive a grounded answer as soon as the permission-checked ERP read completes. The assistant must still understand natural Thai, typos, follow-ups, corrections, negation, relative dates, compound requests, pending work, and references such as “อันเมื่อกี้”.

The target journey is:

```text
durable LINE acceptance
  -> existing buffer/coalescing boundary
  -> resolve current identity, tenant, membership, permissions and branch scope
  -> load one bounded, revisioned pre-intake context snapshot
  -> one semantic intake model call using compact provider-only output
  -> strict decoder expands canonical semantic inventory and optional prepared read
  -> existing permission/entitlement/delegation/tool-input checks
  -> permission-checked ERP tool
  -> existing deterministic grounded formatter with source/basis/completeness
  -> existing delivery and task-state commit
```

For ambiguous, compound, write, file, analytical, or unsupported requests, the decoder preserves every clause and the existing full path remains responsible for answering, clarifying, or refusing it. A fast failure is not a successful latency result.

## 3. Evidence and diagnosis

The frozen real-provider evidence is `docs/research/mangmee-natural-model-evidence-2026-09-27/primary.json`.

NAT-01 turn 1 records:

| Boundary | Observed |
| --- | ---: |
| accepted to intake HTTP start | 1,148 ms |
| intake provider call | 7,132 ms |
| intake output | 592 tokens |
| ERP tool | 22 ms at captured tool boundary; 27 ms in turn response |
| gateway turn after intake | 48 ms HTTP; 34 ms internal |
| accepted to model/tool completion | 8,458 ms |
| accepted to sink receipt | 8,522 ms |

The 1,148 ms before intake is consistent with the frozen runner's 1,000 ms debounce cohort plus roughly 148 ms of admission and request preparation. It is not evidence of a slow ERP read. This change does not remove the existing coalescing boundary; the benchmark must report it separately.

The intake response repeats the same decision in three places:

- outer route: `BUSINESS_READ_QUESTION`, language, confidence and reason;
- canonical semantic item: kind, goal, requested filters and full evidence reference including a 64-character hash;
- full prepared plan: language, intent, subject, agent, tool name, filters, response mode and answer shape.

The observed bottleneck boundary is the provider call: its 7,132 ms includes network, queueing, prefill and generation, and the trace has no time-to-first-token split. The 592-token response proves the returned object is broad, but does not prove how much of 7,132 ms each provider phase consumed. A second captured read used the prompt cache and still spent about 6,988 ms in the provider call; those two samples show that cache alone did not meet the goal, not a general performance benchmark. Compact output is therefore a measured hypothesis that requires same-model A/B evidence, not a confirmed root cause. `maxTokens: 4096` is only a ceiling and is not itself the cause. Lowering that ceiling alone risks truncation and is forbidden by this spec.

There is also a correctness-ordering gap in `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`: the reliability-v2 early intake runs before `loadConversationContext`, open clarifications, recent correction candidates, active drafts, and pending-media resolution are loaded. Its result is cached in `intakePlansV2` and reused by the later call that supplies those fields. This means the only semantic model call can be based on less context than the later code appears to pass.

## 4. Scope

### 4.1 Definite implementation scope

- text-only LINE intake under the existing reliability-v2 path;
- provider-only compact semantic decision and strict decoder;
- server expansion to the existing canonical route, semantic inventory, and prepared simple-read plan;
- first-intake context ordering and single pre-intake snapshot use;
- focused contract, router, webhook-ordering, and compatibility tests;
- request-scoped first-intake tool availability that reflects the current paid package, actor role and deployment capabilities;
- parity with the already permission/feature-filtered full semantic-control tool catalog;
- same-model local synthetic benchmark and held-out semantic comparison;
- observability for compact decode outcome, fallback reason, provider tokens, provider duration, and successful end-to-end duration.

### 4.2 Explicitly deferred existing gaps

- image/PDF read quality, evidence-span failures, and delivery recovery;
- voice;
- public lookup;
- new financial-advisor behavior or modules;
- model downgrade or default-model change;
- reimbursement writer, approval, payment, ledger posting, tax filing, permissions changes, or any other final mutation;
- new debounce policy;
- UAT/Production deployment or customer-gate changes;
- unrelated NAT failures listed in `docs/research/mangmee-natural-real-model-results-2026-09-27-th.md`.
- issued-document sales/report routing and formatting while those features are outside the current paid-tier grants;

Passing this scoped change must not be reported as closing those gaps.

## 5. Compatibility and ownership boundaries

The compact shape is private to the provider response inside the AI Gateway. No API, AgentCore, tool, ledger, delivery, or persisted task consumer receives it.

The decoder emits the existing canonical types:

- `LineIntakeRoutePlan`;
- `LineAiSemanticSubrequestV2[]`;
- optional `LineAiPreparedPlan` version 1;
- existing route-specific fields such as capture/correction/reimbursement hints and `advisorAnswer`.

The existing legacy provider response remains decodable when the compact field is absent, so replay fixtures and version skew keep working. A response containing both compact and legacy semantic/prepared representations is rejected as ambiguous rather than choosing one silently.

AI Gateway remains separate from ERP core. It proposes and decodes. The API and tool executor continue to own tenant, membership, permission, entitlement, delegation, branch scope, authoritative state, audit, source evidence, and final mutation.

No dependency or `package.json` change is required.

### 5.1 Authority-scoped tool catalog contract

`LineIntakeRouteRequest` gains one optional API-issued field, `offeredToolNames: string[]`. It carries names only, sorted and deduplicated. It contains no tenant id, role name, permission list or customer data beyond fields already present in the internal request.

The API derives it from the access snapshot already resolved for this accepted turn:

- the actor must hold `ai.tool.invoke`;
- the tool must be execution-ready in the existing `lineToolRegistryFor(...)` runtime view;
- `hasToolPermissions` must pass for the actor's current effective permissions;
- `hasToolFeature` must pass for the company's current `loadEntitledFeatureKeys` result;
- existing runtime capability switches continue to hide draft, reimbursement-draft and public-lookup tools.

The Gateway treats that list as an upper bound and intersects it with its own static enabled-tool registry and trusted capability flags. It does not mutate `ROUTER_ENABLED_TOOLS` or any singleton catalog. The resulting immutable set is used for both the provider catalog and `parseLineIntakeCompactDecision`; a tool absent from the provider catalog cannot reappear through the decoder's global fallback.

For a bound semantic-v2 request, missing or malformed `offeredToolNames` fails closed for compact prepared reads: the model receives no ERP simple-read choices and the decoder cannot emit a prepared plan. It may still return complete canonical semantic coverage, and general/business-concept questions that need no ERP data remain answerable. Legacy non-v2 callers keep their existing static route compatibility; all downstream authorization checks remain mandatory.

The cacheable provider catalog is keyed by its canonical sorted effective descriptors plus a catalog schema/capability version. It contains no company/user id or raw permission values, so two actors reuse a cache entry only when they see the same effective tool catalog. A task resumed on a later turn receives a newly resolved list. Permission or entitlement revocation after planning is still caught by actor-delegation creation and the internal tool controller's current authorization recheck.

The full semantic-control path already filters `LINE_TOOL_REGISTRY` through `executionReady`, `hasToolPermissions`, `toolAccessOutcome` and runtime flags before placing `tools` in its CONTROL payload. Focused parity tests must prove the first-intake catalog and full-control catalog expose no tool outside the same current authority snapshot; this change does not replace or weaken the full path.

## 6. Pre-intake context snapshot

### 6.1 Authorization before loading

The snapshot is loaded only after all existing identity, company, membership, legal, feature, permission and branch-scope gates have passed. Group/room restrictions remain unchanged.

The pre-intake snapshot contains only the bounded read-only state needed to classify safely:

- `conversationContext` from the current authorized personal chat window;
- `taskProjection` with owner-bound lifecycle epoch and task revisions;
- `responsePreferences` when already enabled;
- deterministic value/date/period candidates from accepted evidence;
- bounded current pending-task/file metadata already present in owner/revisioned state;
- for an actor who may create an expense draft (`expense.receipt.line_upload`, `expense.receipt.upload` or `expense.create`), the company's active expense-category catalogue (id and name only), because the capture-hint contract may name a category only from `activeCategories` in this one call; a question-only actor gets none and no expense read happens. The template catch-all (`expense.miscellaneous`, ค่าใช้จ่ายเบ็ดเตล็ด) is left out: its own template note says a person chooses it, so the AI never files a vague note there.

Amendment 2026-09-29 (UAT): the v2 implementation had dropped the catalogue from bound private turns, so every LINE text note and one-pass receipt was saved uncategorised; this bullet restores it. The catalogue is company configuration, not a transaction row, and group/room lanes keep their existing zero-private-prefetch rule.

Private ERP correction candidates, active expense records and other source-specific enrichment load only after the semantic route requires that source and only through their existing permission/scope checks. A general question must not prefetch those records. Where a write/correction needs source-specific selection that was not in the pre-intake snapshot, the existing domain path resolves it from current state or asks; it must not guess or make a second intake call.

It is context, never authority or business truth. Historical reply text remains excluded as today; current business facts must still come from ERP tools.

### 6.2 One semantic snapshot

The first and only intake call receives the complete bounded classification snapshot: current accepted evidence, authorized conversation context, revisioned task state and deterministic value candidates. “Complete” here means complete for semantic classification; it does not mean preloading private ERP rows for every turn. The code must not call intake once with less than this snapshot and then satisfy a later call from that cache.

Within intake, `taskRef` is valid only when it exactly matches the offered task id, revision, subrequest index, state and kind. Pending-file references must be from the latest offered task projection and current pending row. If a revision changes before dispatch, the existing CAS/source-current checks refuse or ask again; the code must not silently retarget to the newest file or record.

After the semantic inventory is persisted, a downstream request may load the newly committed task projection for its own contract. That is a new state boundary, not a second semantic classification snapshot.

## 7. Compact provider-only decision

### 7.1 Shape

Text intake continues to return outer route fields and route-specific hints. Instead of returning canonical `semanticSubrequests` plus a nested `preparedPlan`, the prompt asks for one `decisionV1` object:

```json
{
  "intent": "BUSINESS_READ_QUESTION",
  "language": "th",
  "confidence": 0.97,
  "reason": "one short sentence",
  "decisionV1": {
    "subrequests": [
      {
        "kind": "read",
        "goal": "ดูยอดค่าใช้จ่ายรวมเดือนนี้",
        "sources": [{ "part": 0, "whole": true }],
        "filters": { "fromDate": "2026-09-01", "toDate": "2026-09-27" }
      }
    ],
    "simpleRead": {
      "subrequest": 0,
      "tool": "expense.list_recent",
      "subject": "expense",
      "agent": "accounting",
      "answerShape": "single_metric",
      "confidence": 0.93
    }
  }
}
```

Optional subrequest members preserve current meaning:

- `requiredEvidence`;
- `dependsOn`, using earlier array indexes only;
- `entity`, exact live user text or the same selected original read/general/help clarification text (R1 in `line-ai-capture-correction-spec.md`); the decoder maps it to canonical `entityReference: {kind:"user_text", value}`;
- `taskRef`, selected exactly from the offered projection;
- `writeIntent`, only for an explicit write clause;
- multiple `sources` for a clause crossing accepted input parts.

`sources` identify only parts offered in this request. A whole-part reference expands from the server-provided `fullPartRef`. A narrower reference carries an exact `quote`; the decoder locates it within that offered part and accepts it only when the occurrence is unique. It then builds canonical UTF-16 offsets and copies the server-held SHA-256. The model never supplies a hash. For a read/general/help reply, R1 permits an exact quote from the selected open question and rewrites it to the whole live reply part; write/file/public remain live-only. Otherwise missing, normalized, non-unique, or cross-part text is invalid and triggers the existing bounded repair/failure behavior.

Array order becomes the canonical contiguous `index`; the model does not repeat indexes. Omitted `requiredEvidence` and `dependsOn` expand to empty arrays. `filters` is required and may be empty. No clause may be omitted because it is unsupported, blocked, negated, quoted, general, help, file, public, read, or write.

### 7.2 Single source of tool and filter intent

For an eligible simple read, `simpleRead.subrequest` points to exactly one `kind=read` item. The decoder copies that item's `filters` to both:

- canonical `semanticSubrequests[index].requestedFilters`; and
- canonical `preparedPlan.proposedCalls[0].input`.

This makes filter equality structural rather than asking the model to repeat it.

The decoder expands `simpleRead` into the existing prepared plan by using only current allowlists:

- tool must be in the currently offered enabled catalog and have category `read_summary`, `read_detail`, or `report`;
- subject must be one of that tool's `businessSubjects`;
- agent must be one of that tool's `supportedAgents`;
- canonical intent is derived from the registered tool category;
- every filter key must be in that tool's current required/optional input fields;
- every value must satisfy existing bounded input checks and amount/date/period membership rules;
- answer shape must be supported by the existing deterministic formatter family;
- confidence remains veto-only and must meet the existing simple-plan floor;
- outer intent must be the trusted `BUSINESS_READ_QUESTION`;
- there must be exactly one independent read, with no entity ambiguity, task ambiguity, write clause, attachment, open unresolved choice, mixed intent, comparison, or analysis requiring the full path.

The decoder never invents a tool, filter, value, subject, agent, date, branch, company, tenant, permission, scope, id, or evidence reference.

### 7.3 Failure behavior

- Invalid semantic coverage or invalid evidence reference: use the existing single bounded schema-repair attempt, then return typed unavailable status. No tool runs.
- A globally unknown/reserved filter key or malformed filter value invalidates the compact decision: use the bounded repair attempt, then return typed unavailable. This prevents an unsupported constraint from entering the full path as an unfiltered/default query.
- Unknown/disabled tool, incompatible subject/agent, a registry-known filter unsupported by the selected tool, ungrounded value, low confidence, unsupported formatter, or ineligible simple shape: reject `simpleRead` with a typed decoder fallback reason and preserve the valid canonical semantic inventory for the existing full path. No prepared tool runs before fallback.
- Conflicting compact and legacy representations: reject the intake response as ambiguous. No tool runs.
- Missing context or ambiguous referent: keep `taskRef`/entity ambiguity unresolved and ask; never bind “latest” by guess.
- A negated or unclear write stays clarification/refusal with zero write. A compact read proposal can never upgrade a write or mixed clause into the read lane.

Decoder logs contain request id, bounded outcome/rejection enum, subrequest count and decoder duration. Existing provider usage telemetry remains the source for token counts and provider duration. Neither log contains raw user text, quotes, filters with sensitive values, or model output.

## 8. Existing behavior that must remain intact

- Multiple intents and dependencies remain complete and ordered.
- General stable business questions that need no ERP data remain natural through the existing general/advisor composition path; this change adds no keyword router or narrow whitelist for them.
- Capability help remains permission/entitlement scoped.
- Relative dates use deterministic Bangkok-time candidates from accepted input. The model selects; code does not compute an unoffered period.
- Corrections and pending work use exact owner/revision references.
- Read answers retain canonical tool results, `queryApplied`, date basis, status basis, completeness, source refs, source labels and as-of time.
- Draft, confirmed, paid and unpaid amounts remain distinct. An expense total is not silently restated as paid, profit or cash.
- Permission denied, feature disabled, source changed, empty, unknown and partial remain distinct outcomes.
- Every final write remains behind its existing source-module preview/confirm/state gates.

### 8.1 Current paid-package boundary and deferred sales diagnostic

The repository's public billing catalog contains `STARTER_249`, `BASIC_499`, `PRO_999` and `ENTERPRISE_1999`. `STARTER_249`, `BASIC_499` and `PRO_999` all grant the same 17-key Starter feature set: dashboard/notifications, expense subfeatures, reimbursement, the LINE AI assistant and platform employee/company settings. `ENTERPRISE_1999` adds only `wht_pnd53` and `wht_50bis`. None of these tier presets grants `sales_documents`, `reports`, CRM or ledger. Runtime sale availability is separate and requires an active billing policy, an open `new_sales` gate, a company-admitted sales cohort and an exact tier/interval price binding; repository defaults alone do not prove the live catalog is open.

The first paid pilot used a synthetic fixture with 62 feature keys and 64 permission keys, so it was intentionally broader than a customer package. NAT-02 remains useful as a diagnostic: both baseline and candidate answered generic sales with received-cash data. It is not evidence that a Starter customer should receive a sales/report feature, and it is excluded from customer-package latency acceptance.

The reviewed but unfinished sales/report correction is preserved outside the active tree at `/tmp/mangmee-sales-correctness-deferred-20260927.patch` with SHA-256 `475e1fe6cdc9d1a35d7ba969c21dbed267fc1c706fc1c59ef53c732477950ae6`. It is deferred until product packaging explicitly includes an authoritative sales source. The active change must not add `reports.get_monthly_report_summary`, sales/report formatter families or report dataset permissions to a paid tier or default deployment catalog.

For current packages, first intake exposes only tools that pass both the package entitlement and the actor's actual role permissions. Expense and reimbursement requests continue through their existing tools and final authority checks. A request for an unpurchased private ERP module receives an honest unsupported/feature-unavailable outcome; it is never silently answered from a different dataset. A general business-concept question that needs no private ERP data remains answerable through the existing general path.

## 9. Latency and quality gates

The desired 2–4 second text answer is an aspiration to test, not a guarantee and not an acceptance shortcut.

Report these separately for every measured turn:

- accepted-to-intake start;
- intake provider duration;
- intake input, cache-read/cache-write and output tokens;
- decoder duration and outcome;
- tool duration;
- gateway turn duration;
- delivery duration;
- accepted-to-successful sink receipt;
- model/tool call counts;
- exact semantic, filter, tool, source, basis and effect outcome.

The first same-model pilot compared frozen baseline `abdf93b9f93fc21f4e5b79f92cd147e0bf3dd74d` with candidate `c836e7e05c487b3677d10b6726eeb252e67b87ad` on Bedrock Sonnet 4.6, synthetic local services/sink, NAT-01 and NAT-02, four provider turns total: one prompt for each scenario on baseline and the same two prompts on candidate. Its fixture forced 62 features, 64 permissions and latency-related runtime switches rather than deriving them from a sold package, so the result is diagnostic evidence, not customer-package acceptance.

The first package-realistic `STARTER_249` OWNER smoke on frozen candidate `e51b9a59a89dd376c58fab808b72bd1593d8363f` also failed quality. The expense turn selected `expense.get_breakdown::single_metric` even though the configured executable prepared family was only `expense.list_recent::single_metric`; the prepared lane rejected it before any tool call and returned `PREPARED_READ_UNAVAILABLE`. The contextual status-concept turn returned `SEMANTIC_CONTROL_UNAVAILABLE` after three provider calls. The generic fixture scorer marked the completed delivery as semantically correct because that fixture had empty fact/tool oracles; manual acceptance therefore overrides it and records both turns as failures.

For bound fused intake, the ordinary authorized ERP catalog and the executable prepared-family catalog are distinct. The provider may retain every ordinary authorized tool for canonical semantic routing, but may emit `simpleRead` only for an exact `${toolName}::${answerShape}` family in the Gateway's compiled formatter registry intersected with the current operator allowlist. The compact decoder applies that same family set. An unsupported fast-plan candidate is removed while its canonical semantic subrequest survives, so API grant narrowing selects the existing full lane rather than issuing a two-slot prepared grant that can only terminate early.

After semantic control, if every subrequest already has a deterministic forced outcome or required question, return those ordered coverage items directly and do not call the compose model. A `help` item is also deterministic at this boundary: render only its currently eligible reviewed guide or the honest missing-guide/capability fallback, without buying model prose that will be discarded. If any non-help clause remains unresolved, keep one composition pass so independent general clauses are preserved rather than dropped. A Mangmee product meaning/workflow question is `help`; a business-domain definition independent of product behavior is `general`; a question about an actual company figure, record, or current status stays `read` and requires a permission-checked source. Owner authorization on 2026-09-27 permits publication of basic source-verified knowledge. The existing 12-card R1 product-help pack is therefore eligible only after every body, guide hash and applicable code boundary passes repository/AI source review; its reviewer metadata must identify that review truthfully and must not imply Product, Accounting or Tax human signoff. This publication adds no tax corpus or case-specific tax advice.

| Turn | Baseline accepted→sink | Candidate accepted→sink | Quality outcome |
| --- | ---: | ---: | --- |
| NAT-01 expense | 8,759 ms | 6,507 ms | Candidate content rubric passes and states draft/pending and confirmed basis; baseline omits the basis. Actual sink delivery is text-only, so card/link delivery is a separately tracked gap. |
| NAT-02 sales | 8,387 ms | 6,212 ms | Both fail task correctness by returning received cash instead of issued-document sales. |

Candidate provider durations were 5,099 ms and 4,883 ms with 283 and 287 output tokens, down from baseline 7,364 ms/589 tokens and 7,081 ms/582 tokens. Both candidate turns remain above the 2–4 second aspiration. Because NAT-02 fails and NAT-01 baseline is not independently correct, this pilot does not support a pairwise successful-latency median or release acceptance. The held-out matrix must run against the next reviewed correctness commit and include:

- typo and paraphrase simple reads;
- relative dates and Bangkok boundaries;
- multi-clause read/general/write mixes;
- negated and ambiguous writes;
- follow-up referents and corrected prior wording;
- multiple pending tasks/files and stale revisions;
- permission, feature and branch-scope changes;
- unknown tool/filter/malformed compact payloads;
- general questions needing no ERP read;
- empty, partial, unknown and source-changed tool results.
- a request for an unpurchased private module, which must not expose or execute that module's tools;
- actual Starter owner and requester roles derived from `TIER_FEATURE_PRESETS.STARTER_249`, `evaluateEntitledFeatureKeys`, `ROLE_GRANTS.OWNER`/entitlement filtering and `compileRole`, including branch scope;
- the Enterprise-only WHT additions as a separate narrow case rather than an all-feature fixture;
- fused-plan off, where intake must not ask the model for an unusable `simpleRead` field;
- configuration evidence that distinguishes repository defaults, the synthetic runner's overrides and the read-only effective UAT/Production flags.

Acceptance requires all of the following:

1. every candidate main question passes its golden rubric independently of baseline; comparison also records regressions in route, complete clause inventory, filters, task/file references, permission result, tool calls, source/basis, effects and delivered content;
2. zero unexpected mutation and zero prepared tool call on any decoder rejection;
3. every successful simple read uses the same canonical downstream plan/result contract as baseline;
4. median and p95 are reported from successful comparable turns; failures are counted separately and never improve latency;
5. simple-read provider output tokens materially decrease; no hard token ceiling is lowered to manufacture the result;
6. the 2–4 second goal is claimed only if successful accepted-to-delivery observations actually fall there under the stated environment;
7. all focused tests, type checks and frozen evidence hashes pass.
8. the first-intake provider catalog and decoder allowed-tool set are identical and contain no tool outside the current permission/feature/runtime intersection; the full semantic-control catalog has the same authority outcome.

For NAT-01 the delivered answer must state the applied expense basis. The current default total includes pending statuses and confirmed records while excluding rejected/voided records; the pending amount includes the draft component. The candidate must state that the pending basis includes the 900-baht draft amount and state the confirmed component. It may use confirmed-only only when the user explicitly requests that basis or the authoritative tool contract changes and reports it. A silent confirmed-only reinterpretation is a failure.

If correctness, completion rate, permission behavior, source honesty, or mutation safety regresses, the candidate fails even when faster.

### 9.1 Canonical read filters and bounded follow-up candidates

The frozen Starter OWNER follow-up evidence at `f9438828f397550634dc29b27aa13935d84d63a9` exposed two separate contract gaps. The first turn asked for this month restricted to confirmed expenses; intake and semantic control both emitted `documentStatus: "confirmed"`, while the ERP contract accepts the canonical value `CONFIRMED`, so the read failed with `UNSUPPORTED_FILTER`. The next turn asked to group the same result by category; intake invented `periodKey: "this_month"`, lost both the prior confirmed filter and the exact September 1–27 range, and semantic validation rejected the unoffered alias before any tool call. Both turns are manual failures even though transport completed.

Read-tool metadata must expose the exact canonical enum values accepted for each enum input. Intake and semantic-control prompts receive those values as data. At the shared Gateway read-input boundary, a string is normalized case-insensitively only when it maps to exactly one declared canonical value; `confirmed` may become `CONFIRMED`, while an unknown value remains rejected. The compact prepared path, full semantic path and model loop use the same metadata and normalization. The API controller and both expense read adapters also validate exact canonical enum membership before dispatch, return the existing bounded `UNSUPPORTED_FILTER` error for an invalid value, and make zero ERP adapter calls. Permissions and tool availability do not change.

Conversational date/period continuity uses only bounded `conversationContext.recentTurns[].userMessagePreview` supplied by the authenticated API. Candidate extraction anchors each prior turn to that turn's `at` timestamp converted to an `Asia/Bangkok` civil date, so relative dates remain correct across midnight and month boundaries. Invalid timestamps, truncated or absent user previews, overflow, and ambiguous date readings do not become candidates or defaults. Historical assistant replies, amounts, record ids, branch ids and write fields never become candidates or authority.

The provider sees the same bounded prior-user read candidates that compact and semantic validators accept. The model decides whether the current utterance is a continuation; code never applies the latest historical filter unconditionally. An explicit current period/status change or negation wins. Any current date/period evidence, including an ambiguous reading or candidate overflow, blocks historical-period fallback; ambiguity stays unresolved instead of silently reviving an older scope. If multiple valid historical periods leave the referent ambiguous, the model asks rather than choosing. Aliases such as `this_month` are not accepted as period keys unless that exact value exists in the offered candidate set; month-to-date continues to use the exact offered `fromDate`/`toDate` tuple.

Every resulting read still executes the current permission-checked ERP tool. Conversation context can narrow a query but cannot prove a balance, status, source result or prior tool success. `LineAiDeliveredExpenseSummary` remains the separate, delivery-proved descriptor for the existing `exclude_rejected_voided` criterion and is not widened to carry arbitrary status filters.

Focused acceptance covers canonical/lowercase known enums, unknown enum rejection, a confirmed-only total, a category follow-up preserving the selected status and exact date tuple, an explicit current override, current negation, a separate-topic history item that must not contaminate the new read, an ambiguous multi-period history that must clarify, and a Bangkok cross-midnight/month boundary. Tenant, branch, feature, permission and source re-read checks remain unchanged.

## 10. Observability, rollout and rollback

Add or reuse structured observations for:

- compact decode outcome: `prepared`, `semantic_only`, or `invalid`;
- bounded compact simple-read rejection enum when canonical semantics remain usable;
- subrequest count and decoder duration;
- provider/decoder/tool/turn/delivery durations and token counts;
- canonical prepared-plan version and executed lane from the service that knows it.

Do not log raw text or the compact payload.

No deployment is included. After source review and local evidence, normal UAT/Production protocol remains mandatory. Rollback is deploy of the previous code version. Canonical downstream contracts and persisted task state do not require migration or cleanup. The legacy decoder remains for wire/version compatibility, not as a second provider call.

## 11. Acceptance checklist

- [ ] Product journey and exclusions match this spec.
- [ ] Compact response is private to AI Gateway and canonical downstream contracts remain compatible.
- [ ] First intake receives the current authorized/revisioned context and is not reused from a partial call.
- [ ] Compound, negation, ambiguity, correction, relative date, task/file reference and source evidence survive expansion.
- [ ] Unknown tool/filter/malformed output causes visible typed fallback before any tool.
- [ ] Tenant, branch, permission, entitlement, delegation, audit, source-state and final-mutation checks remain active.
- [ ] General no-tool questions remain natural without keyword routing.
- [ ] Focused tests and type checks pass.
- [ ] Same-model pilot and held-out evidence report successful latency and quality without counting failures as wins.
- [ ] No new dependency, secret, opt-in flag, public lookup, voice or advisor module is added.
