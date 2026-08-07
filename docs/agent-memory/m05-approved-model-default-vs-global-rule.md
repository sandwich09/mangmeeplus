# Agent Memory: M-05 approved-model default vs global-profile rule

Status: Code + deploy config done and locally verified. NOT COMMITTED, not deployed.
Commit deferred by owner 2026-07-28: every touched file is co-mingled with the
still-in-progress P1 M-04–M-18 changeset (233 dirty files + 6 untracked migrations,
Codex actively editing). This fix rides that commit rather than splitting it.
Owner: Codex `/root` owns P1 M-05 (`docs/agent-memory/p1-security-remediation-m04-m18.md`).
This task reconciled the safe default with the rule. Owner decision 2026-07-28:
production uses Claude Sonnet 4.6 through the recorded global-profile exception.

Scope:
- `packages/config/src/index.ts` — `APPROVED_AI_MODEL_IDS` default contradicted the
  M-05 production rule that rejects `global.` Bedrock inference profiles.
- `apps/api/src/common/config/app-config.service.ts` — 4th copy of the same string.
- `.env.example` — local-only allowlist, now labelled as such.
- `infra/prod-ecs-express/deploy.sh` — production model pin.

Decisions:
- **The safe default remains regional; production deliberately takes the audited
  exception for Sonnet 4.6.** Evidence:
  - `docs/security-remediation-checklist-merged-2026-07-17.md:280` names
    "global Bedrock profile อาจประมวลผลข้าม region" as the M-05 root cause and
    `:282` names "geographic/single-region profile" as the fix.
  - Production pins `global.anthropic.claude-sonnet-4-6`, passes the approval
    flag/reference to runtime, and grants its global inference-profile family.
  - The `global.` default is **pre-existing** (committed at old line 126). M-05 added
    the rule and copied the stale default into the new ai-gateway schema.
- Replaced 4 duplicated literals with one exported `DEFAULT_APPROVED_AI_MODEL_IDS`
  so the default cannot drift from the rule again.
- Local keeps `global.` profiles explicitly (`.env`, `.env.example`,
  `compose.local.yml`). The allowlist is enforced at call time in every environment
  (`provider.factory.ts:43`), so local must list what it actually runs. Production
  pins Sonnet 4.6 and replaces the allowlist only after a non-empty approval
  reference is present, so no workstation `.env` can silently select the model.

**Availability is invocability, not listing** (the finding that changed the target):
- `bedrock list-inference-profiles` in ap-southeast-1 lists
  `apac.anthropic.claude-sonnet-4-20250514-v1:0`, but a live `InvokeModel` probe
  returns `ResourceNotFoundException` — "marked by provider as Legacy and you have
  not been actively using the model in the last 30 days". It is NOT usable here.
- Probed every candidate with a 5-token InvokeModel (profile `watchdog-bedrock`):

  | profile (ap-southeast-1) | invocable |
  |---|---|
  | `apac.anthropic.claude-sonnet-4-20250514-v1:0` | NO — legacy-gated |
  | `apac.anthropic.claude-3-5-sonnet-20241022-v2:0` | yes |
  | `apac.anthropic.claude-3-5-sonnet-20240620-v1:0` | yes |
  | `apac.anthropic.claude-3-haiku-20240307-v1:0` | yes |
  | `apac.anthropic.claude-3-sonnet-20240229-v1:0` | yes |
  | `global.anthropic.claude-sonnet-4-6` (prod today) | yes |

- So the newest **usable** APAC profile is Claude 3.5 Sonnet v2 (2024-10-22).
  Compliance costs two model generations, not one. Receipt OCR stage 2 was tuned and
  verified 4/4 on Sonnet 4.6 (`project_receipt_ocr_pipeline_fixed`) and must be
  re-verified on 3.5 Sonnet v2 before this is trusted in production.

Failure mechanism (confirmed):
- Config services validate the **parsed** config
  (`safeParse(process.env)` → `validateProductionConfig`), so schema defaults reach
  production boot. `deploy.sh` drops empty env vars (`map(select(.value != ""))`),
  so an unset `APPROVED_AI_MODEL_IDS` really does fall through to the default.
- The rule lives inside `if (isAiConfig)`, and only `aiGatewayConfigSchema` carries
  `MODEL_PROVIDER`/`AI_GATEWAY_ENABLED` — so this was an **AI Gateway** boot failure.
  The API never reached the check despite carrying the same bad default.

Model-split correction (2026-07-28, after live task-def read):
- Production runs TWO global profiles — chat `global.anthropic.claude-haiku-4-5-20251001-v1:0`,
  documents `global.anthropic.claude-sonnet-4-6`. Evidence: THIS session's own
  `aws ecs describe-express-gateway-service` read of the live service env
  (2026-07-28, profile watchdog-bedrock). An uncommitted register §2.1 edit by an
  unidentified concurrent lane records the same split independently — corroboration,
  not the source; do not cite it as verification. The earlier deploy.sh pin set BOTH roles to
  Sonnet 4.6 — the next deploy would have silently moved every chat turn to Sonnet
  pricing. Fixed in `2f8b3e50`: PROD_CHAT_MODEL/PROD_DOC_MODEL, allowlist names both,
  UAT mirror reproduces the split. The §5 approval must name both models.
- Root cause of the wrong pin: trusting `.env`/register/memory instead of the live
  task definition. Availability was probed live earlier; the running config should
  have been too.
- SUPERSEDED same day by a second owner decision ("แชทใช้ sonnet-4-6 global ได้เลย"):
  chat is deliberately upgraded haiku→Sonnet 4.6, cost implication accepted. `2af5d258`
  pins Sonnet 4.6 on both roles; the two role variables remain separate with a
  divergence-safe allowlist. The §5 approval now needs to name Sonnet 4.6 only —
  UNLESS prod deploys before the approval lands, in which case live prod (haiku chat)
  and the register §2.1 still describe the pre-decision state.

Fail-open fixed in the exception control (found while making production depend on it):
- `AI_GLOBAL_INFERENCE_PROFILE_APPROVED` was `z.coerce.boolean()`, and coercion makes
  EVERY non-empty string true — so `=false` (the value `.env.example` ships), `0`, or
  `no` all parsed as **true**. With any approval reference present, an operator
  explicitly disabling the exception would have switched cross-border processing ON.
  The mandatory-reference design masked the common case (no ref ⇒ still refused),
  which is why it survived; the existing exception tests pass a real boolean and so
  cannot see it at all.
- Fixed to the file's own `envBoolean` (true/false only, anything else hard-fails) in
  both schemas, plus a test that parses the flag from env **strings** the way a
  container actually boots. Verified: `true`→on, `false`→refused, `0`/`no`→rejected.
- Deploy-time guard added: production refuses to deploy without a non-empty approval
  reference, rather than boot-failing mid-canary (a boot failure during bake trips the
  rollback alarm instead of reporting the missing reference).

UAT resolved (was an open question):
- UAT's task definition also sets `APP_ENV=production`, so the M-05 rule applies there
  too. It previously fell through the production branch and inherited a workstation
  `.env` pinning a `global.` model with no approval keys — a guaranteed gateway
  boot-fail. `deploy.sh` now branches for UAT: with an approval reference it mirrors
  production (global Sonnet 4.6); without one it falls back to the regional profile and
  prints a warning that UAT AI behaviour is then NOT evidence about production. UAT is
  never blocked on DPO sign-off, and it never spends an approval it does not hold.
- UAT IAM needed no separate fix: `AI_POLICY_NAME` for UAT is the same policy name
  `infra/uat/setup-control-plane.sh` writes, so `deploy.sh` overwrites it every deploy
  with both inference-profile families. The bootstrap script was widened to match so the
  window between bootstrap and first deploy is not narrower than the gateway needs.

Open questions:
- DPO/legal must issue the approval reference and complete the processor register;
  owner model selection alone is not data-protection approval.

Artifacts:
- `packages/config/src/index.ts` (`DEFAULT_APPROVED_AI_MODEL_IDS`)
- `packages/config/src/index.test.ts` ("ships an approved-model default that passes
  production validation")
- `apps/api/src/common/config/app-config.service.ts`, `.env.example`
- `infra/prod-ecs-express/deploy.sh` (production `BEDROCK_MODEL_ID` /
  `DOCUMENT_AI_MODEL_ID` pin + empty `APPROVED_AI_MODEL_IDS` so the default applies)

Verification:
- `packages/config`: 92/92 pass. Guard proven: temporarily restoring the old
  `global.` default fails the new test with the exact M-05 error, twice
  (allowlist + bedrock MODEL_ID); restored and re-verified green.
- `apps/ai-gateway`: 484/484. `apps/api`: 2665/2665.
- `tsc --noEmit` clean for `packages/config`, `apps/api`, `apps/ai-gateway` (run
  sequentially — concurrent typecheck is a known trap). `bash -n` clean on deploy.sh;
  the rendered AI task IAM policy parses as JSON.
- Simulated the exact production ai-gateway task-def env through
  `aiGatewayConfigSchema.parse` → `validateProductionConfig`, all six paths:
  approved+ref BOOTS; ref missing, flag off with a stale ref, junk flag value,
  exception keys absent, and model-not-in-allowlist are each refused.
- Deploy guard exercised directly: ref missing → exit 2 with remediation text;
  ref present → `BEDROCK_MODEL_ID`/`APPROVED_AI_MODEL_IDS`/flag set as intended.
- NOT verified (needs the real deploy): that the production task role can actually
  invoke `global.anthropic.claude-sonnet-4-6` under the widened IAM. Only the dev
  `watchdog-bedrock` principal was probed.

Next:
- DPO/legal records the Sonnet 4.6 transfer approval and supplies its reference to
  the production deployment environment.
- Verify rendered task definition, IAM resources, stored lineage, and receipt/bank
  OCR after immutable deployment.
- Do not tick M-05 until that governance/live evidence is attached.
