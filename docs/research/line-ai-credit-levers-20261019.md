# LINE AI credit levers 1 + 2 — implementation evidence

Owner approval: 2026-10-19, “1 กับ 2 ก่อน”. Base `bbc73bf49fe9ae3dc38e8596dd52120734cfa9dc`, branch `claude/line-credit-levers-20261019`. No model selection, 80/100-baht allowance, permission, approval, tenant/branch guard or final-mutation gate changed. No commit/deploy/provider/network call.

## Controller follow-up P1: reach with the actual builder

The original single-prefix digest included the permission-filtered catalogue. The original measurement also used empty knowledge/prepared-read constructor options, unlike `LineAiInternalController`. The new matrix uses the actual controller options (approved prepared families and approved knowledge enabled), actual `ROLE_GRANTS`, actual `TIER_FEATURE_PRESETS`, all offered registry tool names followed by the real builder's permission/entitlement filtering, current ค่าอาหาร evidence, full role permission lists, no prior history/categories, and unchanged output 4,096. “Before” below is the reviewed single-digest X1 code; “after” is the split calibration. All seven previously missed its digest. Amounts are cold-cache holds at FX33, not actual charges. [Machine-readable matrix](../evidence/line-ai-credit-levers-20261019-role-reach.json).

| Package / role | Input bound before → after | Hold before → after, THB |
|---|---:|---:|
| STARTER_249 / OWNER | 114,688 → 56,320 | 16.23 → **9.00** |
| STARTER_249 / STAFF | 100,352 → 48,128 | 14.45 → **7.99** |
| STARTER_249 / ACCOUNTANT | 105,472 → 51,200 | 15.08 → **8.37** |
| STARTER_249 / AUDITOR_READONLY | 102,400 → 50,176 | 14.70 → **8.24** |
| PRO_999 / OWNER | 114,688 → 56,320 | 16.23 → **9.00** |
| PRO_999 / MANAGER | 108,544 → 50,176 | 15.46 → **8.24** |
| ENTERPRISE_1999 / OWNER | 115,712 → 57,344 | 16.35 → **9.13** |

Starter and Pro currently have identical feature presets in contracts; Pro manager's catalogue equals the owner's but its dynamic permission list is shorter. No role grants/presets were changed. Enterprise's additional unfamiliar catalogue entries keep bytes, yielding 9.13 THB (slightly above 9, within the requested approximate range). Larger live history/categories still add their full byte hold; these are reproducible samples, not a universal per-message price ceiling.

The following full prefix digests remain distinct and are identical before/after this follow-up (rendered prefix bytes did not change). None is the calibration key anymore:

| Package / role | SHA-256 of canonical `{systemPrompt,cacheableContext}` |
|---|---|
| STARTER_249 / OWNER | `7caea2d6cde51d31006576c0cbff407744866779ba51fae4efc62336d8905f14` |
| STARTER_249 / STAFF | `483081509c4d15c315639d6c8b9606805a07ee2f59fdb8ba896b09f2beb3eeb2` |
| STARTER_249 / ACCOUNTANT | `f2e6d4e6a8fbb76dd7cde152b57c0e29602980ac71b77e6e336938141e673c67` |
| STARTER_249 / AUDITOR_READONLY | `84aea6ac87c35388ebc078f03c3145a8d0003c5982a58cffda8a7678fc3e7844` |
| PRO_999 / OWNER | `7caea2d6cde51d31006576c0cbff407744866779ba51fae4efc62336d8905f14` |
| PRO_999 / MANAGER | `7caea2d6cde51d31006576c0cbff407744866779ba51fae4efc62336d8905f14` |
| ENTERPRISE_1999 / OWNER | `7dee45f24f565bfdf7a1250e9f3eb7df16c0dc3128d25418cd22db1ab00e1439` |

All seven share **constant-part digest `1239bb8e4d0a8bb627c2af19c048931f33455f0857581a65b2a3644fc6ba5fae`**, over canonical `{systemPrompt,businessGlossary,chatActions}` (66,609 bytes), additionally gated by `global.anthropic.claude-sonnet-4-6`. The smaller no-knowledge/no-prepared-read fixture used in the first report has separate digest `8fdc539be3ca76063b05343c87cbf7b633a4f105834f2ba3cc5df8ac5fddf9aa` (61,057 bytes). It gets the same conservative constant bound. Permission/feature/family lists never enter the constant digest.

## Split estimator, recorded maxima and margin

The [audit](../evidence/line-ai-credit-levers-20261019-estimator-evidence.json) hashes all 25 read-only eval files: 2,059 intake entries, maximum total input33,559, entire cached prefix23,655; control40 entries/max9,977; compose566/max37,888. Usage-basis labels distinguish reported, estimated and absorbed rows. Across them, **44 mixed read/write intake checkpoints** isolate system reads from catalogue writes. Maximum system-only cache read is16,650. At source `66cafe805df3956c3b0d42deeaaf9bd81672cea1`, staff writes5,837, accountant6,270, auditor5,595 after the same16,650-token system read. Bedrock's checkpoints follow system then cacheable context; `generateText` has no native tool config before these checkpoints. Conservatively allocate23,655−16,650=7,005 tokens to the catalogue, including its glossary overhead. Registry metadata `packages/contracts/src/ai-tools.ts` is unchanged between that eval source and HEAD. The reconstructed system differs by one reviewed English status-filter wording edit (net seven bytes smaller) (61,709→61,702 bytes), not a new prompt mode.

Preserve the original minimum margin factor32,768/23,655 = **1.385246248**:

- System bound = ceil(16,650 × factor) = **23,065**, margin38.5285%. Add every byte of the glossary/chatActions and constant-object framing: **26,681** total constant bound.
- Variable catalogue class: only duplicate-free subsets of the **32 exact reviewed server-owned Starter owner feature objects** qualify. Each object's entire canonical SHA-256 must match. Bound = min(its full encoded byte bound, ceil(7,005 × factor)) = at most **9,704**; that is38.5296% above the conservative catalogue maximum and54.8% above the largest isolated write6,270. A complete finite reviewed superset covers the smaller recorded role catalogues. No ratio is transferred to arbitrary JSON; duplicate reviewed entries disable this catalogue discount. Unknown/new/edited entries, prepared-family names and other context fields retain bytes. Enterprise's extra entries retain bytes.
- Dynamic permissions, tasks, current/retained evidence, IDs/hex, messages, schemas/results and other models retain UTF-8 bytes. Keep4,096 framing, round up1,024, add2,000/image and3,000/provable PDF page. Payload/schema digests still seal the full original input/media. Unknown constant digest safely falls back to the original byte bound.

This is an empirical bound for finite reviewed text, **not a tokenizer theorem or a global character-class divisor**. Thai's3-byte UTF-8 representation alone proves no tokenizer merges. Prefixes mix English prose, Thai examples and ASCII JSON/identifiers; arbitrary ASCII/hex remains worst-case one token/byte. There are no captured rendered-body digests paired to the old provider usage. Source reconstruction plus checkpoints justify the finite calibration and margin; paired live usage/quality validation remains a release risk. Every one of the158 recorded text shapes from16 replay files keeps a bound above the entire recorded intake maximum33,559; tasks/current evidence survive. The real-controller samples' smallest bound48,128 has43.41% headroom over that maximum.

## P2: prompt drift guard and recalibration

The registered `intent-router.agent.spec.ts` guard constructs all seven roles with the actual controller options and fails if the **current constant digest is absent from the calibration table**. Editing system prompt or glossary now fails the test; the failure message includes the recalibration command and live-measurement conditions. It also compares byte counts and the real rendered hold against the matrix, catching catalogue changes that increase fallback holds.

```sh
pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx ../../scripts/recalibrate-line-intake.cjs 1239bb8e4d0a8bb627c2af19c048931f33455f0857581a65b2a3644fc6ba5fae
```

The helper calls the real current builder offline, selects the previous table entry, and prints a candidate `{digest,bytes,tokenBound}`. New bound = ceil(oldBound × max(1,newBytes/oldBytes)); shrinking never lowers it, and proportional growth preserves the old bound/byte margin. It rejects invalid counts or growth over10%. It **does not edit/accept the table automatically**. For small same-mix wording edits, inspect character mix, review the suggestion, update the table, rerun the guard/matrix/evidence, then version/recompute the shared contract pins. Different model, changed character mix (especially more ASCII/hex/JSON), new prompt semantics/mode, changed catalogue vocabulary, or >10% growth requires paired live token measurements instead of scaling. The registered scaling spec proves growth, shrink and rejection behavior. Exact catalogue metadata changes retain bytes until separately reviewed; do not automatically add their hashes.

## Intake model: repository deployment paths

- Production live: `infra/prod-ecs-express/deploy.sh:510` pins `PROD_CHAT_MODEL=global.anthropic.claude-sonnet-4-6` and assigns it to `BEDROCK_MODEL_ID`. Maintenance-only's regional model does not serve live chat.
- Pinned AgentCore UAT candidate: `.github/workflows/deploy-uat.yml:607` explicitly sets **the same global Sonnet4.6 model**. Production readiness workflow also pins it. This path qualifies for the calibration when its constants match.
- ECS UAT: `deploy.sh` uses global Sonnet4.6 **only when** `AI_GLOBAL_INFERENCE_PROFILE_APPROVAL_REF` exists; otherwise it explicitly falls back to `apac.anthropic.claude-3-5-sonnet-20241022-v2:0`. That fallback does not qualify and retains byte holds. The UAT ECS workflow delegates model choice to this script.

These are repository configuration checks, not a claim about the currently deployed task/runtime or company override. No cloud query or model-selection change was made.

## Original per-profile builder comparison, refreshed

These fixtures retain the original analysis recipe (registry permission union, no prepared-read/knowledge options) for like-for-like X2 byte comparisons. Use the seven-role table above for controller reach. Baseline is original HEAD before X, not the intermediate single-digest revision. [Measurements](../evidence/line-ai-credit-levers-20261019-measurements.json).

| Profile / rendered sample | Input before → after | Output requested | Hold before → after, THB |
|---|---:|---:|---:|
| intake text 4 turns pending task | 100,352 → 47,104 | 4,096 | 14.45 → 7.86 |
| intake image one page | 55,296 → 55,296 | 8,000 | 10.81 → 10.81 |
| intake text 15 turns | 103,424 → 47,104 | 4,096 | 14.83 → 7.86 |
| intake text 15 turns pending task | 104,448 → 51,200 | 4,096 | 14.96 → 8.37 |
| claim control | 41,984 → 41,984 | 2,048 | 6.21 → 6.21 |
| line.public.lookup | 5,120 → 5,120 | 4,096 | 1.16 → 1.16 |
| line.compose | 31,744 → 31,744 | 1,536 | 4.69 → 4.69 |
| document QA one page (unchanged builder) | 13,312 → 13,312 | 3,000 | 3.14 → 3.14 |

Output/profile ceilings, maxCalls, repair limit and deadlines are unchanged: recorded intake output reaches4,096. Representative sequential intake/control/compose admission still fits an initial10 baht with warm actual settlement between calls; arbitrary cold/long/repair turns can need more.

## Per-message cost and continuity

| Warm intake scenario | Dynamic bytes before → after | Estimated THB/message before → after |
|---|---:|---:|
| 15 turns, ordinary history | 11,917 → 5,087 | 0.916 → **0.600** (about 35% less) |
| 15 turns, pending task without retained source | 12,742 → 9,590 | 0.916 → **0.787** (about 14% less) |
| 4 turns, open claim | 9,064 → 5,912 | same moved catalogue; savings depend on actual uncached usage |

Estimates allocate the supplied 5,850 uncached / 23,653 cached / 208 output midpoint proportionally by the same builder's dynamic bytes. Moved bytes become cache reads; removed history disappears. They are not new provider usage, and cold writes/repairs/extra calls can change savings. Tightening a hold alone saves no actual usage cost.

Intake caches chatActions and the glossary; the permission-filtered feature catalogue remains keyed by exact content. The semantic answer puts chatActions, conversation guidance, conditional static tax guidance and the constant product-offer rule into its stable system prefix so Bedrock's real 4,000-character checkpoint applies. Fresh permissions, entitlements, categories, task projection, current/retained evidence, approved help and permitted productActionFacts remain per turn. Cross-company specs assert identical prefix bytes for the same catalogue and zero tenant/private data in it; different effective tool catalogues have different content identities.

Four recent user turns are the default, consistent with the short J7 continuation chain and existing three-read memory. This is a bounded default, not evidence that older conversations are universally irrelevant. Keep all open questions, task projection, resumable references and verified retained source. Without a retained source, a nonterminal task keeps its older user history; one retained source never permits dropping another unfinished task's history. Open clarifications retain history. Read-context candidates use exactly the same trimmed context as intake/semantic planning; the latest three read descriptors, quoted references and existing source guards remain. The J7 spec preserves the original 350-baht/yesterday claim, delivered question refs, current evidence hash and exact task revision reference.

## Money-rule changes, in plain words

1. The reviewed constant intake blocks and finite catalogue class now need a smaller temporary hold, independently of role/package identity. Cold-cache pricing and actual-cost settlement stay the same; the hold is never a flat charge.
2. Using more than the hold now creates the existing HIGH alert and an operator review row; it never requires an operator acknowledgement before new work can start. Normal caps/available-credit checks still apply. Admin text/status and acknowledgement copy now describe an alert rather than a stopped shop.
3. A successful funded v2 overrun may debit more than its hold, up to actual provider cost and available eligible customer credit. It cannot consume another invocation's held money. Additional eligible lots can cover the actual; the company absorbs the remainder. Provider cost stays complete in the usage ledger/aggregates; `customerChargedSatang` and `companyAbsorbedSatang` record the split in reservation evidence and the HIGH alert.
4. Settlement now takes the existing company-configuration lock before the month lock so extra debits serialize with reservations/revocations across months. Funding time/cycle is pinned on the reservation. Settlement's invocation fence prevents replay/double debit. Late evidence after an operator release cannot debit the released credit again.
5. Failed/time-out calls still debit zero and release their holds; this existing rule was preserved and tested. Credit grants, package allowances, approvals and final mutation policy were not changed.

## Pins that moved

- Controller follow-up moves the intermediate v3/aa17f73a… pin to v4/eeea47e8… because the estimator now separates constant and catalogue classes.
- `AI_BUDGET_ESTIMATOR_VERSION_V2`: `utf8-v2` → `utf8-split-prefix-v4`. The v2 wire/grant schema stays v2; estimator semantics changed.
- `AI_BUDGET_PROFILE_TABLE_DIGEST_V2`: `bb983780…` → `eeea47e84c77574a300a88b69eee65cd164535364733950b2b5cfa78bfa7d0b6`, recomputed from canonical version/estimator/profiles. Profile table version/data remain unchanged. API, runtime and gateway all import this shared constant, so no independent production literal pin exists. Contract and PG-authority fixtures move to the new estimator; an old estimator invocation is explicitly refused. Historical evidence retains its old values.
- Current provider/budget spec, ADR 0013, hold reconciliation spec, plan and memory describe the owner amendment. Prisma edits are comments only; no data migration.
- The mandatory W00 parity spec required refreshing its source-hash artifact: provider-source hash, manifest digest and checkout observations changed, with zero capability/menu/handler inventory changes. The regeneration spec passes 5/5; this is source parity refresh, not a new W00 product audit.

## Verification (rerun after P1/P2)

All full scripts used their complete registered file lists via `pnpm --filter <pkg> exec node --import tsx --test --test-concurrency=4 ...`; `.live/run-package-tests.cjs` preserves package pretest/test membership and expands the existing web glob. No package.json edits. Commands and logs are captured in [task memory](../agent-memory/line-ai-credit-levers-20261019.md) and `.live/verification-summary.json`.

| Check | Result |
|---|---|
| Contracts build; API/gateway/web typecheck | pass |
| Full API pretest |16pass/132DB skips |
| Full API main |12,053pass/2baseline socket failures/199DB skips |
| Full gateway (complete rerun) |2,518pass/0fail/46baseline socket cancellations |
| Full contracts |487pass |
| Full web |4,975pass |
| Focused router, including158 shapes and P1/P2 |119pass |
| Pricing/reservation + actual DI/delivery-plan specs |122pass (84money,38DI/delivery) |
| W00 source-parity refresh and final check |5pass each |
| Whole-chain API reliability/behavior |474/2,417pass |
| Whole-chain gateway behavior |1,313pass |
| Whole-chain contracts/evaluation, web, catalogue, image harness |232/8/4/5pass |
| Whole-chain gateway reliability |589pass/12baseline socket failures/46baseline cancellations |
| Four infrastructure shell suites |exit0 each |
| AgentCore tsc build + esbuild bundle |pass |
| AgentCore startup; official packager |listen EPERM; dirtyworktree rejected |
| Diff whitespace; package.json untouched |pass |

The same socket failures/cancellations were rerun on the exact starting-commit archive in `/private/tmp/line-credit-baseline-20261019`. The first full gateway attempt also hit the unchanged1ms in-flight timeout test (`bedrock.provider.spec.ts:1099`, false!==true); the complete gateway rerun passed. That exact timing assertion reproduced7/24 targeted runs on the starting commit; `.live/baseline-bedrock-timing-failure.log` preserves it. No new failing assertion remains. PostgreSQL checks skip without DB; no network/docker/provider/cloud access used. The startup smoke cannot listen in this sandbox and the official packager requires a clean commit, which is out of scope. This is no release/startup acceptance claim.

## Changed files

- `apps/ai-gateway/src/common/usage/ai-budget-provider.ts`
- `apps/ai-gateway/src/common/usage/intake-token-calibration.ts`
- `scripts/recalibrate-line-intake.cjs`
- `docs/evidence/line-ai-credit-levers-20261019-role-reach.json`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/line-model-context.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.spec.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/semantic-turn-v2.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/modules/line-ai/application/ai-credit-ledger.ts`
- `apps/api/src/modules/line-ai/application/ai-model-pricing.spec.ts`
- `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.pg.spec.ts`
- `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.spec.ts`
- `apps/api/src/modules/line-ai/application/company-ai-budget-reservation.ts`
- `apps/api/src/modules/line-ai/application/company-ai-credit-holds.pg.spec.ts`
- `apps/api/src/modules/line-ai/application/line-ai-budget-authority.pg.spec.ts`
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
- `apps/web/src/features/system-partners/ai-budget.logic.spec.ts`
- `apps/web/src/features/system-partners/ai-budget.logic.ts`
- `docs/adr/0013-ai-budget-split-reservations.md`
- `docs/agent-memory/line-ai-credit-levers-20261019.md`
- `docs/evidence/line-ai-credit-levers-20261019-estimator-evidence.json`
- `docs/evidence/line-ai-credit-levers-20261019-measurements.json`
- `docs/plans/line-ai-credit-levers-20261019.md`
- `docs/research/line-ai-credit-levers-20261019.md`
- `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`
- `docs/specs/line-ai-credit-hold-reconciliation-spec-th.md`
- `docs/specs/line-ai-credit-levers-20261019.md`
- `docs/specs/mangmee-ai-input-provider-budget-contract-2026-09-27.md`
- `packages/contracts/src/ai-budget-bounds-v2.spec.ts`
- `packages/contracts/src/ai-budget-bounds.ts`
