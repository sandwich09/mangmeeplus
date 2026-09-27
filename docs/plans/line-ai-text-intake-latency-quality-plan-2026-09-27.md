# LINE AI Text Intake Latency Without Quality Loss Implementation Plan

## Status

The first compact-intake implementation and focused source verification are complete at frozen candidate `c836e7e05c487b3677d10b6726eeb252e67b87ad`. Its two-prompt paid pilot is complete: NAT-01 candidate passed its content rubric, while NAT-02 exposed a pre-existing sales-versus-cash error under a synthetic all-module fixture. The actual paid tiers grant Starter expense/reimbursement features, so the unfinished sales/report expansion is removed from the active tree and preserved as a deferred patch. The current reviewed diff now scopes first-intake tools to the current package and actor and passes focused transport/source checks; it is awaiting combined root review and a package-real frozen run. The latency goal is not established and no release/deployment is authorized.

Implementation uses Ponytail full mode: existing types and validators first, smallest root-cause diff, no dependency, no `package.json` edit, and one focused runnable check per non-trivial boundary. Root reviewed the initial spec/plan and approved the code phase; candidate freeze still requires final diff review.

## Baseline and checkout

- Worktree: `/Users/thawatchai/.codex/worktrees/mangmee-ai-spec-v24/mangmeeplus`
- Branch: `codex/mangmee-natural-real-model-develop-20260927`
- Initial HEAD and remote branch: `abdf93b9f93fc21f4e5b79f92cd147e0bf3dd74d`
- `origin/main`: `016b43c69a88dbf8596106c366651ab95bc88e43`
- `origin/develop`: `114b90b5c573959a81ae9f7f0566e100c40c0f1e`
- All three current trees: `a6dbfe34f2eb36951affa6acef2a7824f9d7f3e5`
- Worktree was clean; the primary user checkout was dirty and remains untouched.

## Phase 1 — Freeze contract and decoder cases

Implement the provider-only compact types and decoder beside the current intake router, not in shared downstream contracts unless a canonical type is genuinely missing.

Expected primary file:

- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`

Prefer extracting a small sibling file only if the decoder makes the existing file materially harder to review. Reuse:

- `parseLineAiSemanticSubrequests` after expansion;
- `parseLineAiPreparedPlan` after expansion;
- `LINE_TOOL_REGISTRY` and the existing enabled/disabled catalog;
- `asIntakeRouteIntent`, subject and agent compatibility rules;
- accepted `inputEvidence.parts[].fullPartRef` and deterministic value candidates.

Focused tests in `line-intake-router.agent.spec.ts` must cover:

- NAT-01-shaped simple read expands to the exact canonical semantic item and prepared plan;
- filters are authored once and copied identically;
- whole-part and exact unique quote expansion;
- duplicate/nonexistent/normalized quote rejection;
- multi-clause ordering, dependencies and complete coverage;
- taskRef exact-match and stale revision rejection;
- explicit write, negation, ambiguity and mixed read/write never become prepared simple reads;
- unknown/disabled tool, incompatible subject/agent, unknown filter, ungrounded date/value, low confidence and unsupported answer shape reject the prepared lane before any tool;
- compact plus legacy response is rejected;
- legacy response alone remains compatible;
- general/advisor and route-specific hints retain existing behavior.

Exit: canonical outputs match existing contracts and every invalid compact decision has a bounded reason with zero execution authority.

## Phase 2 — Change the text intake prompt only

Update `intakeRouterSystemPrompt` so semantic-v2 text requests emit `decisionV1`. Keep image/document output unchanged because media is outside this scope. Keep the current 4,096 text ceiling; do not manufacture lower latency by truncating output.

The prompt must state:

- every user clause is preserved;
- source references select only current input parts and exact text;
- task refs select only offered current revisions;
- one simple read selects one enabled tool and canonical filter values once;
- ambiguity, compound work, write, file, open choices and unsupported formatter cases omit `simpleRead` but keep their semantic item;
- general questions remain general and do not require tool selection;
- compact output grants no permission or mutation authority.

Update prompt-contract tests and snapshots deliberately. Record old/new prompt hashes in evidence.

Exit: mock-provider outputs are shorter while semantic and prepared canonical results are unchanged.

## Phase 3 — Fix first-intake context ordering

In `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`:

1. keep the semantic decision before pending-media/draft legacy interceptors that may consume or write;
2. load authorized conversation context, revisioned task projection/preferences and deterministic value candidates before that decision;
3. call intake exactly once from this bounded read-only classification snapshot and reuse the result;
4. let pure-general delivery return before private ERP correction/draft prefetch;
5. load source-specific pending rows, correction candidates and drafts only after the route requires the existing domain flow;
6. retain existing CAS/source-current checks before dispatch and delivery;
7. if source state is needed but ambiguous or changed, refuse/clarify through the existing current-state path rather than run a second intake or guess a latest target.

Focused webhook tests must prove:

- one intake call receives conversation context, current task projection/preferences, accepted evidence and value candidates;
- general turn still avoids private ERP tool prefetch and performs zero ERP tool call;
- a general side question while two files are pending bypasses the file-selection interceptor and does not consume either row;
- “ดูอย่างเดียวยังไม่บันทึก” while a receipt is pending cannot resolve or write that receipt;
- a current-file/correction request loads the source after routing and either binds its latest allowed revision or asks without implicit mutation;
- latest revision is offered and a stale model taskRef cannot execute;
- permission/branch changes are resolved before context load and current checks still deny delivery;
- no second intake call occurs and no partial cached route is reused.

Exit: a turn is semantically classified once from the bounded authorized classification snapshot; private source rows are read only by the route that needs them.

## Phase 3a — Make first-intake tools match current authority

Use the existing registry and access helpers; do not create a second authorization framework.

1. Add optional internal `LineIntakeRouteRequest.offeredToolNames: string[]`.
2. In the API, derive the sorted names from the already resolved turn permissions and `loadEntitledFeatureKeys`, requiring `ai.tool.invoke`, `executionReady`, `hasToolPermissions` and `hasToolFeature`, with the existing runtime registry flags.
3. In the Gateway, intersect that API upper bound with the immutable static router set and trusted request capabilities. Never mutate `ROUTER_ENABLED_TOOLS` or a shared catalog.
4. Build the provider catalog from that request-scoped set and pass the exact same set to the compact decoder. Canonical sorted descriptors plus a schema/capability version form the cacheable context; do not include tenant/user ids or raw permission data in the cache key.
5. For bound semantic-v2, a missing/malformed authority list offers no ERP simple-read tool and cannot produce a prepared plan. General/business-concept semantic coverage remains available. Keep legacy non-v2 behavior for wire compatibility and retain every downstream permission/entitlement/delegation/tool recheck.
6. Confirm the full semantic CONTROL path still filters its fresh `LineAiTurnRequest.userContext` through `executionReady`, `hasToolPermissions`, `toolAccessOutcome` and runtime switches. Add parity coverage instead of replacing that implementation.
7. Gate the compact prompt's `simpleRead` schema and instructions on the existing fused-plan capability. With fused planning off, require canonical `decisionV1.subrequests` but do not ask the provider for an unusable simple-read proposal.

Focused checks must prove:

- a Starter owner/requester catalog is derived from `TIER_FEATURE_PRESETS.STARTER_249` and production role compilation/filtering, never a hand-written all-permission fixture;
- sales, report, CRM, ledger and other unpurchased tools are absent from both the provider catalog and decoder allowed set;
- an expense/reimbursement tool appears only when both its entitlement and its exact role permission pass;
- a permission/feature revoked before a resumed turn produces a newly reduced catalog, while a mid-turn revocation is still stopped by existing downstream checks;
- different authority catalogs cannot reuse the same cacheable catalog payload, and identical canonical catalogs contain no tenant identifiers;
- missing authority on bound semantic-v2 fails prepared reads closed but a no-ERP general business question still answers;
- fused-plan off prompt contains no `simpleRead` invitation and its parser never carries a compact prepared plan;
- full semantic CONTROL exposes the same effective authority result.

Exit: first intake tells the model only about tools the current actor can actually invoke under the current package and runtime; later authorization remains unchanged.

Implementation evidence in the current diff: the API derives and transports the sorted upper bound at all four intake call sites; the Gateway validates it, intersects static/runtime/permission/feature authority and uses the same set for prompt, decoder and legacy/compact prepared-plan gating. Starter `OWNER`, `STAFF` and `AUDITOR_READONLY`, revocation, malformed/missing authority, fused-off prompting, empty-catalog native capture and HTTP/client transport are covered by focused tests. An actual deployed first-intake request was not captured and live public sales availability is not verified; neither blocks local source acceptance. The paid Starter comparison remains an evidence task.

## Phase 4 — Focused verification

Run the smallest relevant checks first:

```sh
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-router.agent.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-general-v2.spec.ts src/modules/line-ai/application/use-cases/process-line-mixed-business-v2.spec.ts
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/api typecheck
```

Adapt only to scripts already present in the repository; do not edit `package.json` to add commands.

Then run the existing prepared-plan compatibility/security checks and affected webhook regression set. Record exact commands, counts and failures in task memory.

Exit: source tests and type checks pass; any unrelated existing failure is named with evidence and not hidden.

## Phase 5 — Same-model evidence

Coordinate with the Luna evidence owner before builds/runs to avoid shared artifact and service conflicts.

Pilot authorized by the owner/root review:

- baseline source frozen at `abdf93b9f93fc21f4e5b79f92cd147e0bf3dd74d`;
- candidate source frozen at the reviewed candidate commit;
- same Bedrock Sonnet 4.6 model/profile;
- same synthetic local database, Redis, storage and outgoing sink;
- NAT-01 and NAT-02;
- four provider turns total: NAT-01 and NAT-02 once on baseline, then the same two prompts once on candidate;
- no public lookup, voice, new advisor scope or model change.

Capture provider duration/tokens, decoder result, tool duration, final delivery duration, semantic inventory, filters, tools, source/basis, reply and effects. The initial pilot completed with accepted-to-sink baseline/candidate results of 8,759/6,507 ms for NAT-01 and 8,387/6,212 ms for NAT-02. NAT-01 candidate content rubric passed while baseline omitted basis; actual sink delivery was text-only despite response card/link metadata, which remains a separate delivery gap. Both NAT-02 turns failed by using cash receipts for a generic sales question, so no pairwise successful median is claimed. The runner forced 62 feature keys, 64 permission keys and three latency-related flags; it is diagnostic and must not be reported as a sold-package acceptance run.

### Phase 5a — Package-realistic evidence before held-out claims

1. Derive the common 17 Starter feature keys from `TIER_FEATURE_PRESETS.STARTER_249`; do not hand-copy broad feature lists.
2. Build an OWNER case from the production OWNER grant set after entitlement filtering, and requester/read-only cases through `compileRole` plus `evaluateEntitledFeatureKeys`. Include realistic branch scope.
3. Keep an Enterprise-only case limited to the two additional WHT features. Do not use it as an all-module package.
4. Record repository defaults, runner overrides and read-only effective UAT/Production flags separately. A runner-forced flag is not a product default or deployment claim.
5. Compare the first-intake catalog, compact decoder set, full semantic CONTROL tools, actor delegations, executed tools and delivered result for each role/package case.
6. Keep the NAT-02 sales mismatch as a deferred diagnostic. Do not activate sales/report tools or change product goldens to make an expense-package run pass.

The first Starter OWNER smoke is a manual failure despite the generic scorer's empty-oracle pass: the first turn proposed an authorized ordinary tool without an enabled deterministic formatter family and dead-ended before tool execution; the second turn failed semantic-control parsing. Before another paid run, pass the Gateway's existing active prepared-family set into intake prompting and compact decoding. Keep the full authorized catalog for ordinary semantic routing, advertise `simpleRead` only for exact active tool/shape families, and strip an unsupported prepared candidate while retaining canonical semantics so the API does not narrow the grant into the unavailable fast lane.

Add focused semantic-control coverage proving an all-forced/all-question turn skips compose and returns ordered deterministic coverage, while a mixed forced plus unresolved turn still composes once and preserves every clause in order. Add intake coverage for the `help`/`general`/`read` boundary without keyword routing. Under the standing owner authorization dated 2026-09-27, publish the existing 12-card R1 product-help pack after exact guide-hash, body and code-boundary review; keep access, source, effective-window and reviewer validation unchanged, and identify repository/AI review without implying human Product/Accounting/Tax signoff.

Exit: held-out evidence represents current sold package and role boundaries, and no latency statistic includes an unavailable module or a fast authority refusal as a success.

Exit is evidence, not a predetermined pass. A faster refusal, timeout, missing clause, wrong filter, false answer or unsafe effect fails.

## Phase 6 — Review and handoff

Update:

- this plan with completed status and verification;
- `docs/agent-memory/line-ai-text-intake-latency-quality-2026-09-27.md`;
- the real-model evidence report produced by the evidence owner;
- any existing latency checklist whose status materially changes.

Provide a reviewable diff and exact commit. Do not merge, push, deploy, change a customer gate, or bypass CI within this plan unless separately authorized after review.

## Rollback

Rollback is the previous code version. There is no new flag, secret, dependency, schema migration or persisted compact shape. Canonical downstream messages and stored task state remain readable. If the compact decoder rejects live model output too often or quality gates regress, revert prompt/decoder/context-ordering together; do not relax parsers, evidence, permissions or mutation guards to keep the latency result.

## Definition of done

- [x] Spec and plan reviewed before implementation.
- [x] Provider-only compact decision expands to the existing canonical contracts.
- [x] Text intake runs once with current authorized context.
- [x] Focused and compatibility tests plus API/Gateway type checks pass.
- [ ] Same-model pilot and held-out evidence compare successful answers and effects.
- [ ] 2–4 seconds is reported only when observed; otherwise the measured result and remaining bottleneck are recorded.
- [ ] No quality, permission, source, tenant, state or mutation boundary is weakened.
- [ ] No new dependency, flag, secret, model default or out-of-scope module is added.
