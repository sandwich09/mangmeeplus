# Agent Memory: line-ai-operator-intent-and-answer-depth

Status: Core intent-depth and feature-availability honesty implemented and verified locally;
real-provider semantic eval pending network access; no deployment performed
Owner: Product owner / Codex
Scope: Fix LINE AI monthly-expense over-routing to daily closing; align answer depth and web action;
add a 220-case operator-language corpus across expense and other owner-decision topics.
Extension scope: distinguish company feature off, real permission denial, unsupported advice,
missing bill reference, empty data, and source failure; keep bill-item questions out of inventory;
add >=128 availability cases spanning every current tool family and >=100 real-provider semantic
invocations.
Decisions:
- `AgentIntentItem.requiredTools` becomes the authoritative executor boundary; no new intent schema.
- No keyword router and no new dependency.
- No dedicated daily-closing page in this patch; generic expense destination uses a truthful button
  label.
- Real-provider language eval uses fixed read-only fixtures and never writes API/DB/LINE state.
- Reuse server-resolved `entitlementDeniedPermissions` and exact `entitledFeatureKeys`; the model
  never decides entitlement or permission, and disabled tools are not invoked only to choose reply
  copy. Exact feature keys close the cross-feature shared-permission gap.
- `ขายอะไรดี` is unsupported with current sources; no inventory/sales-summary substitution.
- `บิลนี้จ่ายค่าสินค้าอะไร` is expense/accounting-document semantics, not inventory semantics.
- `product_catalog` and `inventory` remain distinct: inventory OFF does not block product search
  when the product catalog is ON.
- Core company/branch/employee and reimbursement tools have no company feature gate; bank/leave/CRM
  suggestion business tools are build-disabled and must not use company-feature-off copy.
Open questions:
- None for local implementation. UAT/Production remain separate release work.
Artifacts:
- `docs/specs/line-ai-operator-intent-and-answer-depth-spec.md`
- `docs/plans/line-ai-operator-intent-and-answer-depth-plan.md`
- `scripts/line-ai-operator-language.corpus.ts` (220 intent-depth + 216 availability/failure cases)
- `scripts/run-line-ai-operator-language-replay.ts`
- `scripts/run-line-ai-operator-language-eval.ts`
Verification:
- Post-fix local full-flow replay:
  `TSX_TSCONFIG_PATH=apps/ai-gateway/tsconfig.json node --import tsx scripts/run-line-ai-operator-language-replay.ts`
  -> 436 passed, 0 failed in 104 ms; 216 availability/failure cases; 83 noisy cases; zero forbidden
  tool invocations. Corpus SHA-256
  `c0b4ab4dcac776c4e43c8ef03aa2e91e9b7a1b9fdbe41c576643a27f18d51842`.
- Post-fix AI Gateway focused suites -> 146 passed, 0 failed.
- Post-fix API focused suites -> 137 passed, 0 failed.
- Corpus integrity -> 2 passed, 0 failed.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck`,
  `pnpm --filter @watchdog-bms/api typecheck`, and
  `pnpm --filter @watchdog-bms/contracts typecheck` -> passed.
- AgentCore runtime HTTP spec attempted but sandbox-blocked: `listen EPERM: operation not permitted
  0.0.0.0`; not counted as passing. Runtime parser/wire changes pass typecheck.
- `TSX_TSCONFIG_PATH=apps/ai-gateway/tsconfig.json node --import tsx scripts/run-line-ai-operator-language-replay.ts`
  -> 220 passed, 0 failed.
- AI Gateway LINE business coverage suite plus corpus integrity -> 401 passed, 0 failed.
- Focused orchestrator boundary/presentation suite -> 51 passed, 0 failed.
- API LINE business-card renderer -> 8 passed, 0 failed.
- `pnpm --filter @watchdog-bms/ai-gateway typecheck` -> passed.
- `pnpm --filter @watchdog-bms/contracts typecheck` -> passed.
- `git diff --check` -> passed.
- Real-provider runner invoked the Bedrock path, then failed as `PROVIDER_UNAVAILABLE`; read-only
  `aws sts get-caller-identity` confirmed the managed sandbox could not connect to the regional STS
  endpoint. The runner now performs one preflight and does not repeat the unavailable call.
- Availability baseline 2026-08-19:
  - `node --import tsx --test src/modules/line-ai/presentation/http/internal-tools.controller.spec.ts`
    from `apps/api` -> 33 passed, 0 failed.
  - `node --import tsx --test src/modules/line-ai/application/use-cases/line-ai-turn.use-case.spec.ts src/modules/line-ai/agents/response-composer.agent.spec.ts`
    from `apps/ai-gateway` -> 59 passed, 0 failed.
  - local operator replay -> 220 passed, 0 failed, 146 ms.
  - local registry inventory -> 60 total tools, 55 router-enabled, five build-disabled, eight with
    no company feature gate.
  - direct local `InventoryAgent` characterization with
    `unsupported_module + FEATURE_NOT_ENABLED` -> `FAILED` and
    `ไม่สามารถดึงข้อมูลสต็อกได้ในขณะนี้`; this reproduces the orchestrated wording defect.
  - direct `tsx --test` was not usable in the managed sandbox because its IPC socket returned
    `EPERM`; `node --import tsx --test` is the working equivalent used above.
Next:
- From a network-enabled terminal, load `.env` and run
  `TSX_TSCONFIG_PATH=apps/ai-gateway/tsconfig.json node --import tsx scripts/run-line-ai-operator-language-eval.ts`.
- Review any semantic failures and rerun all 436 before UAT. Follow the mandatory deployment
  protocol separately; do not deploy from this task state.
