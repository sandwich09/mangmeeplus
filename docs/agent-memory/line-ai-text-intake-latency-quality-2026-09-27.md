# Agent Memory: LINE AI text intake latency without quality loss

Status: Root approved the implementation structure and local candidate commit after focused verification. Source checks pass; the real-model baseline/candidate pilot remains blocked on baseline admission and is not a completed acceptance gate.

Owner: Sol-5.6 xhigh implementation agent; root owns design, bug/gap/impact review; Luna-6 xhigh owns independent real-model evidence and comparisons.

Scope: Text-only LINE semantic intake compaction, first-intake context ordering, canonical expansion, focused tests and same-model evidence. No deploy, merge, push, voice, public lookup, new financial advisor module or model-default change.

Decisions:

- Use Ponytail full mode from `/Users/spare058/WatchDog-BMS/.agents/skills/ponytail/SKILL.md`.
- Work only in `/Users/thawatchai/.codex/worktrees/mangmee-ai-spec-v24/mangmeeplus`; preserve the dirty primary checkout.
- Keep compact format private to provider output; expand to existing `LineIntakeRoutePlan`, semantic inventory and prepared plan.
- Do not lower `maxTokens` as the latency mechanism.
- Do not add a flag/secret. Default behavior changes with the reviewed code version; rollback is version rollback.
- Keep the configured model for baseline/candidate comparison.
- A failed or incorrect fast response is not a latency pass.

Open questions:

- Exact narrow-run command supported by the frozen NAT harness; coordinate with Luna before any build/run.
- Candidate commit is not created until docs review and implementation approval.

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
- Luna's first frozen baseline pilot reached the local sink but stopped before Bedrock with `AI_CONTRACT_UNSUPPORTED` and zero model/tool calls. This is a harness/contract admission blocker, not latency evidence; trace is narrowed to API `validateLineV2` and Gateway evidence/grant/value-candidate/task-projection gates without bypassing the frozen contract.

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

Next:

- Create the root-approved local candidate commit from only this scoped diff and send its hash plus exact checks to root and Luna.
- Run the frozen baseline/candidate pilot only after the baseline admission issue is diagnosed, then review quality, latency and effects before any broader action. The 2–4 second aspiration and real-model quality remain unproven until that evidence exists.
