# Agent Memory: LINE AI text intake latency without quality loss

Status: Root approved and froze compact-intake candidate `c836e7e05c487b3677d10b6726eeb252e67b87ad` for benchmark use. The four-turn paid pilot completed, but it used a broad synthetic authority fixture and is not customer-package acceptance. Sales/report expansion is deferred because current paid tiers grant the Starter expense/reimbursement set. The current reviewed diff implements the request-scoped first-intake tool catalog and passes focused source, transport, build and type checks; root full-diff review and a real Starter-package run remain before another frozen candidate.

Owner: Sol-5.6 xhigh implementation agent; root owns design, bug/gap/impact review; Luna-6 xhigh owns independent real-model evidence and comparisons.

Scope: Text-only LINE semantic intake compaction, first-intake context ordering, effective authority-scoped tool catalog, canonical expansion, focused tests and same-model evidence using current package/role fixtures. No deploy, merge, push, package expansion, sales/report activation, voice, public lookup, new financial advisor module or model-default change.

Decisions:

- Use Ponytail full mode from `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus/.agents/skills/ponytail/SKILL.md`; the AGENTS.md path under `/Users/spare058/WatchDog-BMS` was stale on this host.
- Work only in `/Users/thawatchai/.codex/worktrees/mangmee-ai-spec-v24/mangmeeplus`; preserve the dirty primary checkout.
- Keep compact format private to provider output; expand to existing `LineIntakeRoutePlan`, semantic inventory and prepared plan.
- Do not lower `maxTokens` as the latency mechanism.
- Do not add a flag/secret. Default behavior changes with the reviewed code version; rollback is version rollback.
- Keep the configured model for baseline/candidate comparison.
- A failed or incorrect fast response is not a latency pass.
- The active paid tiers are expense/reimbursement packages: STARTER/BASIC/PRO share `TIER_FEATURE_PRESETS.* = FEATURE_PACKAGE_PRESETS.starter`; ENTERPRISE adds only `wht_pnd53` and `wht_50bis`. Sales documents and reports are outside these tier grants.
- Preserve the unfinished sales/report diagnostic outside the active tree at `/tmp/mangmee-sales-correctness-deferred-20260927.patch` (SHA-256 `475e1fe6cdc9d1a35d7ba969c21dbed267fc1c706fc1c59ef53c732477950ae6`). It is not deployed or release-ready.
- First intake must receive a request-scoped tool-name upper bound derived from the authenticated API access snapshot. Gateway static/runtime availability intersects it per request; provider catalog and compact decoder use the same immutable set.
- Bound semantic-v2 without that authority list fails compact prepared reads closed. General/business-concept answers remain available without ERP tools. Legacy non-v2 keeps wire compatibility and downstream authorization never changes.

Open questions:

- The read-only runtime audit found the deployed fused/prepared/ledger flags enabled with the approved Sonnet 4.6 profile, while repository defaults and the broad synthetic overrides remain separately labelled. Live public sales availability is not verified, and no actual deployed first-intake request was captured; neither is required for this local source review. No live setting was changed.
- A paid Starter-package owner/requester/read-only candidate comparison has not run. The broad pilot remains diagnostic only.

Root review findings and resolutions:

- Unknown filters must fail before every full/prepared path, including absent/unknown `simpleRead`; decoder validates all compact filter keys against the registry-wide field set before building canonical semantics.
- Prototype/magic keys must not disappear; decoder rejects `__proto__`, `prototype`, and `constructor` and builds filters in a null-prototype dictionary.
- Compact sources are a strict union; malformed `quote`, false `whole`, or both modes reject the decision.
- Status enums may be model-selected only from explicit existing tool-domain allowlists; dates/periods still select deterministic candidates, and branch/vendor names must be literal current text or fall back.
- `fromDate`/`toDate` must be the same offered period tuple; cross-candidate mixes omit prepared execution.
- Exact task revision is rechecked by the existing intake parser; outer `BUSINESS_READ_QUESTION`, no attachment, no open clarification, live permission/entitlement/delegation, specialist and formatter checks remain enforced by prepared-lane eligibility immediately before any tool call.
- The pre-intake ordering uses bounded authorized conversation/task state before the single semantic call. Private correction/draft rows stay after the route so general questions do not prefetch ERP records. Pending-media/draft interceptors with possible consumption or writes remain after semantic classification.
- Compact prepared execution is emitted only when fused planning is enabled and the trusted outer route is `BUSINESS_READ_QUESTION`; `CLARIFY`, capability-off and conflicting compact/legacy outputs cannot carry it.
- Noncompact/image prompts retain their existing canonical evidence/filter instructions. Compact text uses server-derived evidence hashes/offsets and one filter source.
- Expense basis wording uses the returned summary's pending, draft and confirmed amounts. It does not infer an effective status from either proposed or executed tool input; incomplete basis fields are omitted rather than guessed.
- Bound reliability-v2 alone loads the bounded conversation context before intake. Legacy/group paths load in their prior position, and an empty bound snapshot is not loaded twice.
- `conversationContext` is forwarded into both semantic-v2 control and answer provider payloads as data. Both prompts restrict it to reference/continuity resolution; historical assistant-written figures or states are never business truth and require a current permission-checked tool result.
- Semantic-v2 unparseable logs omit raw model previews; compact decode telemetry is bounded to outcome/rejection/count/duration.

Artifacts:

- `docs/specs/line-ai-text-intake-latency-quality-spec-2026-09-27.md`
- `docs/plans/line-ai-text-intake-latency-quality-plan-2026-09-27.md`
- `docs/research/mangmee-natural-model-evidence-2026-09-27/primary.json`
- `docs/research/mangmee-natural-real-model-results-2026-09-27-th.md`
- `/tmp/mangmee-sales-correctness-deferred-20260927.patch` (deferred local diagnostic, not product source of truth)

Verification:

- `list_artifacts` confirmed the attached managed worktree.
- Initial managed worktree status clean at `abdf93b9f93fc21f4e5b79f92cd147e0bf3dd74d` on `codex/mangmee-natural-real-model-develop-20260927`, equal to its origin tracking branch.
- Current tree `a6dbfe34f2eb36951affa6acef2a7824f9d7f3e5` equals current `origin/main` and `origin/develop` trees despite different commit ancestry.
- Primary checkout at `/Users/thawatchai/Project/MangmeeYungYuen/mangmeeplus` contains extensive unrelated WIP and was not modified.
- NAT-01 turn 1: accepted-to-intake 1,148 ms; provider 7,132 ms / 592 output tokens; ERP read 22–27 ms; accepted-to-sink 8,522 ms.
- Provider duration includes network, queueing, prefill and generation; no TTFT split exists. Compact output remains an A/B hypothesis. A second cached sample still took about 6,988 ms, which only shows cache alone was insufficient in those two samples.
- Source inspection found the reliability-v2 early route before `loadConversationContext`; later `tryRouteIntake` reuses the cached partial route.
- Root approved the architecture and code phase. Review items A–F, prepared-plan gating, prompt compatibility, applied basis, context payload forwarding and snapshot isolation are addressed in the current diff.
- Focused checks passed: compact decoder 9/9; intake router 37/37; prepared security/runtime 69/69; prepared formatter 67/67; semantic-v2 integration 10/10; general-v2 plus mixed-business-v2 21/21; AI Gateway and API type checks.
- API boundary checks pass for invalid compact intake stopping before pending media/ERP/`requestLineTurn`, and for a general question with two pending files using one intake, one bounded context and no pending-file enumeration.
- Document-QA boundary check passes for “ดูอย่างเดียวยังไม่บันทึก” against an existing pending receipt: it reads the bound bytes, makes no expense-repository call, and only moves the pending-media row through its QA state back to `RESOLVED_RECEIPT`.
- The initial admission blocker was traced to mismatched approved-model bootstrap: `TENANT_AI_MODEL_NOT_APPROVED` → `ROUTER_UNREACHABLE` → `AI_CONTRACT_UNSUPPORTED`. Aligning the test processes to the same existing approved model profile fixed the harness without changing product policy.
- Paid pilot accepted-to-sink: NAT-01 baseline/candidate 8,759/6,507 ms; NAT-02 8,387/6,212 ms. NAT-01 candidate content passes while actual delivery is text-only. NAT-02 fails task correctness in both. Candidate provider output fell from 589/582 to 283/287 tokens, but both successful candidate timings remain above the 2–4 second aspiration.
- The pilot fixture forced 62 features and 64 permissions and enabled three latency-related flags. It does not represent a sold Starter package.
- Package audit: `packages/contracts/src/menu-entitlements.ts:432-500` defines 17 common Starter keys and the narrow Enterprise additions; `packages/contracts/src/billing.ts:64-79` puts those keys on offers. Live offer availability depends on the active policy/gates/price bindings and is not proven from repository defaults.
- Gap found in frozen `c836`: API passed current `permissions` and `enabledFeatures`, but `IntentRouterAgent.buildFeatureCatalog` listed the static global router tools and the compact decoder received the global set. Full semantic CONTROL already applied current permissions/features/runtime flags and remains a downstream safety boundary.
- Current catalog implementation adds the optional internal `offeredToolNames` field, derives it from the API's current permission/entitlement/runtime registry view, validates and re-intersects it in the Gateway, and uses one effective set for the provider catalog, compact decoder and every compact/legacy prepared-plan candidate. Missing or malformed bound-v2 authority produces no ERP prepared tools while native expense capture and general questions remain routable.
- Production-role fixture coverage uses Starter `OWNER`, `STAFF` and `AUDITOR_READONLY`. All AI-capable Starter writer roles also hold at least own/related expense read; there is no valid production create-with-no-read role to invent for a test. `STAFF` retains native receipt capture, while `AUDITOR_READONLY` cannot capture.
- Bounded source-wrapper audit: `dashboard.get_business_health_summary` computes only entitled providers. Starter enables the expense provider; its aggregate widget requires company `expense.read`, so own-read `STAFF` cannot see it. Inventory is not entitled. Notification tools return notification events/counts; company/branch and employee tools return their own permission-scoped metadata or counts. Their API tool controller still rechecks feature and permission gates. No sales, ledger, bank or inventory source was found through these wrappers.
- Shared business-answer renderer audit found two production callers, live webhook and ledger drain, and both pass `formatLineReply(response, webBaseUrl)` as fallback. The complete renderer preserves reply text, all source labels, safe tenant links and card text. When no safe tenant URL can be formed (missing base URL, external URL or wrong tenant), it deliberately omits both the unusable link and its navigation label rather than reviving them from fallback text; this is not a financial caveat/source loss.

Commands run from the managed worktree:

```sh
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-compact-decision.spec.ts # 9/9
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-router.agent.spec.ts # 37/37
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/prepared-simple-read-security.spec.ts # 69/69
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/prepared-simple-read-formatter.spec.ts # 67/67
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/application/use-cases/line-ai-turn-v2.integration.spec.ts # 10/10
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-general-v2.spec.ts src/modules/line-ai/application/use-cases/process-line-mixed-business-v2.spec.ts # 21/21
pnpm --filter @watchdog-bms/api exec tsx --test --test-name-pattern='fails a bound semantic turn|answers a bound general question' src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts # 2/2
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-document-qa.bridge.spec.ts # 25/25
pnpm --filter @watchdog-bms/ai-gateway typecheck # pass
pnpm --filter @watchdog-bms/api typecheck # pass
git diff --check # pass
```

Current authority-scoped catalog checks:

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-name-pattern='LINE intake offered tool authority|fails a bound semantic turn|answers a bound general question|advertises substitute semantics' src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts # 6/6
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/agents/line-intake-router.agent.spec.ts # 41/41
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/infrastructure/ai-gateway.client.spec.ts # 39/39
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/modules/line-ai/presentation/http/line-ai-internal.controller.spec.ts # pass
pnpm --filter @watchdog-bms/contracts build # pass
pnpm --filter @watchdog-bms/api typecheck # pass
pnpm --filter @watchdog-bms/api build # pass
pnpm --filter @watchdog-bms/ai-gateway build # pass
git diff --check # pass
```

Next:

- Root reviews the combined catalog, delivery integrity and deadline-narrowing diff before creating the next frozen candidate; the deferred sales patch remains outside the active tree.
- Luna rebuilds the held-out fixture from production-derived Starter OWNER/requester/read-only authority before any paid comparison; the unavailable deployed-request capture remains an explicitly unverified operational fact.
- Run the frozen Starter candidate only after source hashes and authority fixtures are reviewed. The 2–4 second aspiration and release quality remain unproven.
