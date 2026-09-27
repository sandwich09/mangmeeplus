# Agent Memory: Mangmee AI default activation

Status: implementation and local integration verification complete; authorized main/develop merge follows. No cloud access or deployment.
Owner: root; Astra dependency/review audit; implementation worker.
Scope: remove manual activation setup for implemented built-in AI capabilities; public lookup remains off. Follow-up to PR824/825.

## Decisions

- Reuse clean managed worktree `mangmee-ai-spec-v24/mangmeeplus`, branch `codex/mangmee-ai-default-activation-20260927` from main `0617d914`; preserve original dirty workspace.
- User explicitly superseded the earlier OFF/empty-denies policy. Built-in switches default ON; valid empty lists impose no extra rollout restriction. Explicit OFF and nonempty restrictions remain operational overrides, not secrets.
- Keep actual permission/tenant/current owner, preview/confirm, model/budget, consent and maintenance controls. Public web lookup is deferred; ordinary general questions are separate.
- AgentCore must share draft-edit default validation. Test all cohort consumers, including receipt evidence, notifier and buffered private/public separation.
- Existing provider credentials, approved content, real-provider/native LINE acceptance and deployment protocol are not bypassed or declared complete.
- Read repository AGENTS and ponytail full; no dependency/package.json changes.

## Open questions

None for source defaults. Live settings were not read and are not claimed changed.

## Artifacts

- Parent spec owner update and implementation-index config table.

## Verification

- Config build and 153 tests passed; all builtin defaults ON except public lookup, malformed values rejected and explicit overrides retained.
- AgentCore runtime 44 tests passed. API targeted 198 tests and webhook/buffer 422 tests passed (overlap; do not sum).
- Full API package test exited 0. Full Gateway package: 1,367 passed, zero skipped. New exact-model capability/client focused set: 42 passed.
- Replay fixture/runtime/corpus 26 tests passed. W00 regenerated and independent 4-test verification passed.
- Final API/Gateway type checks and AgentCore compilation passed.
- Human packet verified against exact 12 card bodies, 13 conversation messages/10 cases, 3 asset labels, all local links and source hashes. Every item remains UNREVIEWED; no real-provider run occurred.

## Next

Merge main/develop under standing authorization; exact GitHub receipts are recorded in the task handoff. Next product step is human review and a versioned scoped real-provider evaluation, not another feature-secret setup. No deployment is implied.

## Dependency findings closed in source

- Empty lists now add no cohort restriction, but private company restrictions cannot fall through a public-channel OR. Keep original payer company for budget/debounce accounting and pass public admission identity separately.
- Bound v2 substitute mode was primary downstream but omitted from upstream capability metadata when legacy mode was off; both admission and earlier-work checks now agree.
- AgentCore direct environment read was inconsistent with shared schema defaults; use the validated parser and return unavailable for malformed overrides.
- Configured Sonnet 4.6 global model was absent from v2 capacity/tariff and rejected by an APAC-only prefix. Add exact reviewed ID, existing standard tariff and existing named global-approval gate. AWS official model card supports capacity; the integration deliberately caps context at200,000 and output64,000. This is not live quality evidence.
- Existing API approved model/global approval environment values must match Gateway for v2 grant issuance. Full-release configuration propagates missing values from the resolved Gateway configuration; explicit API restrictions remain authoritative and hotfix preserve-serving-config stays unchanged.

## Review and rollout limits

- Public lookup deferred, voice deferred, current rollout16capabilities; historical225case corpus includes public success scenarios, so a new versioned scoped evaluation is needed without silently dropping errors.
- Human packet exposes existing oracle questions (sales vs received cash; mixed expense+write expectation) for business review, not silent golden edits.
- Normal maintenance suppresses customer HTTP and queue execution. Existing authenticated internal-worker routes bypass platform access; this change does not assert that a manually invoked valid worker token is universally suppressed by serving mode.
- Actual provider quality/cost/latency, human approval, native LINE and signed release/customer OPEN acceptance remain unverified. No new credentials, feature secrets, cloud reads or deployments were introduced.

## Final verification commands

All commands exited0; overlapping focused/package counts are not summed.

- `pnpm --filter @watchdog-bms/config build` and config test:153 pass.
- `pnpm --filter @watchdog-bms/api test`: exit0 (existing dot reporter); `/tmp/mangmee-default-api-full.log`.
- `pnpm --filter @watchdog-bms/ai-gateway test`:1367 pass,0 fail,0 skipped; `/tmp/mangmee-default-gateway-full.log`.
- `pnpm --filter @watchdog-bms/api typecheck`; `pnpm --filter @watchdog-bms/ai-gateway typecheck`; `pnpm --filter @watchdog-bms/ai-gateway build:agentcore`: pass.
- AgentCore runtime focused44; API targeted198; webhook/buffer422: pass,0 skipped.
- `pnpm exec tsx --test scripts/line-ai-reliability-runtime.spec.ts scripts/line-ai-reliability-corpus.spec.ts scripts/line-ai-reliability-fixtures.spec.ts`:26 pass.
- `UPDATE_LINE_AI_CAPABILITY_MANIFEST=1 pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/line-ai-capability-manifest.spec.ts`, then the same command without the update environment:4 pass on independent parity check.
- Sonnet capability4/API client38 tests pass: exact deployed model, missing/blank approval, unapproved provider/model/region, stale runtime, pinned prices and rejected wider context tier.
- `python3 infra/kamal/release_test.py`:41 pass; `python3 infra/kamal/release_paths_test.py`:8 pass. Existing ECS generator executed with synthetic secret resolver; Kamal tests cover missing-only approval propagation, explicit restrictions and hotfix preservation.
- `bash -n infra/prod-ecs-express/deploy.sh` and `git diff --check`: pass.
- Original workspace tracked binary diff and all recorded untracked file hashes match the previous preservation snapshot. No package.json/dependency/lock edits.

No new PostgreSQL/Redis or paid-provider acceptance run was performed in this follow-up; previous actual-database evidence remains historical. This change primarily modifies admission/configuration, model negotiation and release config propagation. Human review packet content and links were verified against source; review status remains UNREVIEWED.
