# LINE AI Text Intake Latency Without Quality Loss Implementation Plan

## Status

Implementation and focused source verification are complete under root review. Spec: `docs/specs/line-ai-text-intake-latency-quality-spec-2026-09-27.md`. The real-model baseline/candidate pilot remains pending and the latency goal is not yet established.

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

Capture provider duration/tokens, decoder result, tool duration, final delivery duration, semantic inventory, filters, tools, source/basis, reply and effects. Run the held-out matrix only after pilot review.

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
