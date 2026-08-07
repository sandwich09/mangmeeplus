# Agent Memory: bedrock-primary-provider

Status: Complete
Owner: Codex
Scope: Align provider direction after owner chose Amazon Bedrock as primary and no longer wants OpenAI API key as the main path.
Role gate status:
- BA: Complete - goal is reduce OpenAI dependency and make AWS/Bedrock the primary paid AI path for WatchDog-BMS while retaining safe disabled mode.
- SA: Complete - AI Gateway remains provider boundary; Bedrock is primary provider, OpenAI remains optional fallback only, WatchDog API still owns data, permissions, mutations, and audit.
- DEV: Complete - Ponytail read; smallest correct diff updated env example, approved admin model defaults, and provider preference docs without deleting working fallback code.
- Integration: Complete for docs/config handoff - backend-to-frontend model selection now lists Bedrock model ids; no browser/E2E needed because no UI behavior or live provider call changed.
Decisions:
- Bedrock is the preferred production and local real-model provider.
- `MODEL_PROVIDER=disabled` stays the safe default so local boot has no paid model call.
- OpenAI adapter/config stays available only as fallback; no OpenAI API key is required for the primary path.
- Default approved model ids are Bedrock/Anthropic ids for Singapore/APAC path.
- Item 10B spec/plan must create Strands agents and deploy the proven agent service to Amazon Bedrock AgentCore Runtime on AWS after local proof.
Open questions:
- Confirm Bedrock model access approval for `global.anthropic.claude-sonnet-4-6` in `ap-southeast-1`.
- Decide whether receipt OCR should use Bedrock vision after a supported model is verified.
Artifacts:
- `.env.example`
- `packages/config/src/index.ts`
- `apps/api/src/common/config/app-config.service.ts`
- `apps/web/src/features/system-partners/PartnerDetailPage.tsx`
- `docs/runbooks/line-ai-local-agent-10b-runbook.md`
- `docs/specs/line-ai-local-agent-orchestration-spec.md`
- `docs/specs/ai-draft-suggestion-layer-spec.md`
- `docs/plans/ai-draft-suggestion-layer-plan.md`
- `docs/plans/line-ai-local-agent-orchestration-plan.md`
- `docs/plans/master-implementation-checklist.md`
Verification:
- `corepack pnpm --filter @watchdog-bms/config build`: PASS - config dist updated with Bedrock approved model defaults.
- `corepack pnpm --filter @watchdog-bms/config test`: PASS - 42 tests.
- `corepack pnpm agent:gates -- docs/agent-memory/bedrock-primary-provider.md`: PASS - memory gate evidence ok.
- `corepack pnpm --filter @watchdog-bms/api exec tsx --test src/modules/system-partner-management/presentation/http/partner.controller.spec.ts`: BLOCKED - current install tree cannot resolve `@nestjs/swagger` from partner controller import.
- 2026-06-27 docs update: AgentCore Runtime deployment path added to item 10B spec, plan, and checklist; verification is docs-only.
Next:
- Confirm Bedrock model access in AWS console, run a real `MODEL_PROVIDER=bedrock` smoke, then deploy the Strands agent service to AgentCore Runtime.
