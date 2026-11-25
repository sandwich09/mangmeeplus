# Agent Memory: typhoon-leftover-removal

Status: Local/dev/test leftovers removed and merged. Production release-gate leftovers NOT touched — waiting on owner decision.
Owner: Owner (request 2026-11-25: "ลบ Typhoon ที่ค้างอยู่ออกให้หมด")
Scope: Typhoon has not read documents since the 2026-08-28 vision decision; no app code calls it. This task removes the names still left behind.
Decisions:
- `infra/docker/compose.local.yml` now passes `ANTHROPIC_API_KEY` to ai-gateway (no default, so an unset key stays unset; an empty string fails the boot schema).
- Removed from `.env.example`, local compose, `infra/uat/bootstrap-data.sh` (optional secret creation), comments and test names/fixtures in ai-gateway and api, `e2e/HANDOFF.md`, `infra/prod-ecs-express/README.md`, one line of software-documentation 08.
- Kept on purpose: `apps/web/src/common/legal/legal-content.spec.ts` (guard that the privacy notice names no AI vendor), published legal releases, dated evidence, old specs/plans/memory (history), PDPA/ROPA/processor registers (compliance records).
Open questions:
- Production release gates still model Typhoon as a live control: `infra/security/evidence-contracts.jq` and `collect-production-a5-current-health.sh` require the running task's `APPROVED_AI_PROVIDERS` to be exactly `bedrock,openai,typhoon`; `validate-production-release-ready-v2.sh`, `validate-production-runtime-secret-inventory.sh`, `collect-production-promotion-resources.sh` and their specs carry a `typhoon` resource block and the optional `typhoon-ocr-api-key` secret; deploy workflows pass `TYPHOON_PROCESSING_REGION`; `infra/ai-gateway/task-definition.template.json` and `infra/production/compare-env-keys.sh` name it too. Removing these changes the evidence contract and must land together with a production value change (`APPROVED_AI_PROVIDERS`) and deletion of the AWS secret, or the next health/READY check fails. Owner to decide when.
- Whether the PDPA/ROPA/processor registers should record Typhoon as a retired processor.
Artifacts: branch `claude/affectionate-cori-kngs8h`.
Verification: `tsx --test` on `line-ai-internal.controller.spec.ts` (234 pass), `statement-import.use-case.spec.ts` + `ai-gateway.client.spec.ts` (89 pass); ai-gateway `tsc --noEmit` clean; `docker compose config` resolves with and without the key; `bash -n infra/uat/bootstrap-data.sh`.
Next: owner decision on the production release-gate removal.
