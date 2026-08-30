# Agent Memory: prod-parity-uat-flags-2026-08-30

Status: Complete — production promoted live 2026-08-30 with UAT-identical LINE-AI flag configuration; on-device behavioral check by Owner pending.

Owner: thawatchai

Scope: Close the UAT-vs-production flag divergence found after the Owner's "rich อัพเดตแล้ว แต่ทำไม AI คุยไม่เหมือน uat" report. Full audit found 8 divergent flags; Owner decided ("รวมเลย จัดไป") to align all of them and keep only the debounce cohort experiment UAT-only.

Decisions:

- Owner parity decision 2026-08-30, after a week of UAT measurement: production runs the SAME conversational and speed lanes as UAT. Aligned defaults in `infra/prod-ecs-express/deploy.sh` for both environments: `LINE_WEB_HANDOFF_ENABLED=true`, `LINE_AI_EXACT_GREETING_ENABLED=true`, `LINE_AI_LOADING_ON_ACCEPT_ENABLED=true`, `LINE_AI_FUSED_PLAN_SHADOW_ENABLED=true`, `LINE_AI_PREPARED_SIMPLE_READ_ENABLED=true`, `LINE_AI_ADVISOR_MODE=social`, `LINE_AI_BUFFER_DEBOUNCE_MS=1000`, and the four deterministic response families.
- The seven production fail-closed blocks for those flags were removed. `LINE_AI_DEBOUNCE_EXPERIMENT_ENABLED` keeps its production rejection (experiment stays UAT-only).
- `production-serving-mode.spec.sh` fixtures for the aligned flags flipped from `assert_rejected …-not-activated` to contract greps proving each default exists with no environment branch and no fail-closed block (same pattern as the LINE_WEB_LOGIN activation). Boolean/charset validation fixtures and the debounce-experiment rejection fixture remain.
- Flag placement (matches UAT): api-web container carries ADVISOR_MODE / HANDOFF / EXACT_GREETING / LOADING_ON_ACCEPT / BUFFER_DEBOUNCE_MS / DEBOUNCE_EXPERIMENT / WEB_LOGIN; ai-gateway container carries PREPARED_SIMPLE_READ / FUSED_PLAN_SHADOW / DETERMINISTIC_RESPONSE_FAMILIES.

Artifacts:

- PR #368 (`codex/prod-parity-uat-flags` → develop, commit 31aeb642), release PR #369 (develop → main, merge 1fd111e4). Maintenance pins re-synced in the same commit.

Verification:

- `bash infra/prod-ecs-express/production-serving-mode.spec.sh` → PASS; `node infra/security/sync-production-maintenance-release-pins.mjs --check` → status=current.
- Release ledger (candidate `a768e3a27aa0ffe5aaf848c23fea720b381a76b0`, no-stray verified): UAT_RUN_ID=33300034490 success → READY_RUN_ID=33301031588 success (live, legal OWNER_OVERRIDE ref `OWNER-DIRECTIVE-2026-08-30-UAT-PARITY`, 7/7 checks pass) → PROD_RUN_ID=33301552984 `PROMOTED_LIVE`.
- E-step readback only (gate already OPEN): `GET /api/v1/auth/platform-access` → `{"state":"OPEN"}`, `/login` 200. No re-PUT.
- ECS readback: prod tasks run images tagged `git-a768e3a2…` (api + ai-gateway); task defs `…api-web-pub:210` and `…ai-gateway-v2:98` carry all aligned values above; workers env unaffected as expected.

Next:

- Owner tests on-device that production AI now handles jokes/casual chat and handoff links like UAT.
- If production ever needs a flag rolled back, edit deploy.sh defaults + spec contract greps + re-sync pins in one commit (activation pattern in reverse); no per-env override path exists.
