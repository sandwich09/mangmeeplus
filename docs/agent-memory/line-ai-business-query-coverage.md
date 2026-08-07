# Agent Memory: line-ai-business-query-coverage

Status: Core, the cross-tool forbidden-versus-empty hotfix, Mangmee-themed LINE answer cards, and the owner company-card picker are deployed to production. ECS rollout and post-deploy health/log checks passed on 2026-07-15; real LINE OA journeys remain open.
Owner: WatchDog-BMS owner / implementation agent.
Scope: Business-feature-complete LINE AI read/query coverage, subject-safe routing, structured clarification continuity, direct LINE answers, and feature-to-tool governance.
Decisions:
- Tools map to distinct business question capabilities, not one-to-one HTTP APIs.
- Production read features must be LINE-covered or explicitly classified web-only/feature-gated.
- The model returns a structured business subject; deterministic policy blocks subject-incompatible tools before execution. No semantic keyword router is added.
- Every `ask_user` clarification uses the existing Redis turn ledger as structured `waiting_user` work, including zero-tool turns.
- CRM customer summary/search/360 is the first implementation slice and must never route to employee tools.
- LINE answers useful data directly; web links are optional drill-down or final-mutation handoff.
- Existing API trust resolution, AI Gateway separation, ERP permission/ABAC re-check, audit, source-state, grounding, and final-mutation blocks remain unchanged.
- Permission metadata now supports both all-of (`requiredPermissions`) and source-policy any-of (`anyOfPermissions`) semantics, so `read` versus `read_own` access is filtered correctly before tool offer and re-checked in ERP Core.
- CRM report periods remain source-supported presets; booking summaries/lists remain canonical ISO-week views.
- Procurement summary returns exact record counts and explicitly marks monetary aggregation unavailable because the canonical list source has no bounded currency aggregate.
- Ledger report summaries preserve canonical period/basis and return `currency: null` with a reason until the source contract exposes company base currency.
- `ToolResult.status` is the result-state authority across all LINE business tools: `forbidden` is data-free, `ok + explicit zero/empty/found:false` is a grounded successful read, and `unavailable/error` is a real source/execution failure.
- Successful zero-item adapters use aggregate/query source refs instead of deriving all refs from returned rows. The Gateway rejects invalid `ok` payloads, scrubs every non-`ok` payload, and keeps deterministic zero/no-record wording rather than allowing the model to relabel it unavailable.
- Owner decision 2026-07-15: every successful business data query should render as a Mangmee-themed LINE Flex answer card. One answer uses one bubble; multiple completed answers use a carousel. Clarification/forbidden/unavailable/error remain honest text, and empty successful reads remain zero/no-record cards.
- Owner decision 2026-07-15: `บริษัทของฉัน` is a deterministic owner control surface. `/companies` renders one company card per selectable company; tapping reuses the existing `/company <selection>` membership/owner re-check. The main Quick Reply exposes `🏢 บริษัทของฉัน` only for the resolved `OWNER` role.
Open questions:
- Operational follow-up: production Redis reports `volatile-lru`; BullMQ recommends `noeviction`. Ledger drains are succeeding, but the deploy principal lacks `cloudwatch:GetMetricStatistics`, so eviction and memory-pressure metrics were not verified. Do not change the shared Redis parameter group without a separate blast-radius review.
- Proposed tool merges are allowed only under the merge criteria in the spec and must be recorded in the coverage manifest.
Artifacts:
- `docs/specs/line-ai-business-query-coverage-spec.md`
- `docs/plans/line-ai-business-query-coverage-plan.md`
- `docs/product/business-use-cases.md` BUC-07
- `docs/plans/master-implementation-checklist.md` item 10G
- `docs/plans/implementation-roadmap.md` item 10G
- `packages/contracts/src/ai-tools.ts` canonical tool metadata and permission policy
- `apps/ai-gateway/src/modules/line-ai/agents/line-ai-feature-coverage.ts` executable coverage manifest
- `apps/ai-gateway/src/modules/line-ai/agents/business-read-result-semantics.spec.ts` registry-wide forbidden/empty/invalid/unavailable matrix
- `apps/api/src/modules/line-ai/application/use-cases/erp-empty-result-semantics.spec.ts` zero-item source-grounding matrix
- `apps/api/src/modules/line-ai/application/use-cases/erp-crm-tools.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-crm-operational-tools.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.ts`
- `apps/api/src/modules/line-ai/application/use-cases/erp-procurement-ledger-tools.use-case.ts`
Verification:
- Answer-card production deploy `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all`: pass on commit `55f89a40`. API/Web task definition `:158`, AI Gateway `:63`, and Workers `:18` each reached `COMPLETED` with running/desired `1/1`; public `/v1/health` and `/login` returned HTTP 200, and the three CloudWatch log groups had no `ERROR` entry in the 10-minute post-deploy window.
- Answer-card implementation: contracts build pass; focused API LINE/business suite 142/142; focused Gateway/AgentCore presentation suite 61/61; full API 1,999/1,999; full AI Gateway 413/413; API/Gateway typechecks pass; `git diff --check` pass.
- Answer-card cases covered: one successful answer bubble, multiple-answer carousel bounded to 12, explicit zero card, forbidden/refused text fallback with no presentation leak, tenant-scoped link allowlist, Unicode bounds, reply-token push fallback, ledger replay, owner-only Quick Reply, one/many company picker, current-company marker, immutable company-id action, non-owner denial, and switch re-check/audit path.
- Result-semantics hotfix: focused API business coverage 121/121 and full API 1,993/1,993 pass.
- Result-semantics hotfix: focused AI Gateway business coverage 354/354 and full AI Gateway 405/405 pass.
- Contracts build, API/Gateway typecheck, Gateway build, and `git diff --check`: pass after the result-semantics integration.
- Production hotfix deploy `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all`: pass on commit `c2860d0e`. API revision `5627467118035593069`, AI Gateway revision `3320135993916327377`, and Workers revision `6954441693663406953` reached terminal `SUCCESSFUL` under the canary strategy.
- Post-hotfix health: API ECS `/v1/health`, AI Gateway ECS `/v1/health`, Workers ECS `/health`, public `https://mangmeeplus.com/v1/health`, and public `/login` returned HTTP 200. No `ERROR` entries were found in the 15-minute post-deploy log window for the three service log groups.
- Contracts build: pass.
- API typecheck: pass.
- Workers typecheck after ledger contract change: pass.
- Full API suite after the final Decimal receivable summation refinement: 1,991/1,991 pass.
- `corepack pnpm test:line-ai-business-coverage` in `apps/api`: 82/82 pass.
- AI Gateway focused business-coverage suite: 174/174 pass.
- Full AI Gateway suite after the permission-denied fallback closure: 402/402 pass.
- Contracts build, API typecheck, Workers typecheck, and AI Gateway typecheck/build: pass.
- Local compiled API + seeded Postgres internal-tool smoke: `crm.get_customer_summary` returned exact scoped total `14`, active `14`, CRM source ref, and direct customer path; a caller without current authoritative `ai.tool.invoke` returned `forbidden` with no data/source refs.
- Direct Bedrock Haiku converse smoke returned `ok`.
- Real-model standalone orchestrator smoke routed `ลูกค้าทั้งหมดมีกี่คน` to subject `customer` and only `crm.get_customer_summary`, returning the stubbed total `42` without an employee tool.
- Local end-to-end compiled API + AI Gateway + real Bedrock + seeded Postgres smoke returned the canonical scoped customer total `14`, CRM source, and one secondary web link in 8.8 seconds; the same journey without permission returned only `🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้`, with no count, source ref, link, or tool result.
- `.env.example` documents safe defaults. Production ECS task definitions now enable orchestration, native tool use, coverage critic, and Redis ledger; runtime remains `strands-local` and final mutation remains disabled.
- Production deploy `AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh all`: pass on commit `0e640770`. ECS deployments for `watchdog-bms-api-web-pub`, `watchdog-bms-ai-gateway-v2`, and `watchdog-bms-workers` reached terminal `SUCCESSFUL` with image tag `0e640770` and 100% production traffic.
- Post-canary smoke: API, AI Gateway, Workers, `https://mangmeeplus.com/v1/health`, and `https://mangmeeplus.com/login` returned HTTP 200. Runtime logs show AI Gateway startup, Redis configured on Workers, and repeated `/v1/internal/ai/line-ledger/drain` HTTP 201 without ledger/provider/worker failure.
- `git diff --check`: pass at the latest integration checkpoint.
Next:
- Exercise real production LINE: one zero expense card, one data card, a multi-answer carousel, owner `บริษัทของฉัน` picker/tap, and a non-owner menu; review post-journey logs.
- Re-run the reported owner journey `ดูค่าใช้จ่ายเดือนนี้`; with no records it must answer zero/no expenses, not forbidden or unavailable.
- Exercise the production LINE OA owner, sales, inventory, finance, forbidden, multi-turn, and multi-company journeys.
- Review wrong-tool, unavailable, forbidden, clarification-repeat, no-source, tool-error, ledger, and latency logs after real LINE traffic.
- Resolve or explicitly accept the shared Redis eviction-policy risk before broad multi-user rollout.
- Keep checklist item 10G unchecked until those user-journey and post-journey observation gates pass.
