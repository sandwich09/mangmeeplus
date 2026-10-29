# Agent Memory: Production snd LINE confirmation duplication

Status: Production cause verified; bounded delivery deduplication implemented, 944 regression tests and API typecheck passed locally. Merged into main and develop by atomic fast-forward push; both remote heads verified at integration commit `97573b50de6e524a805391146f0ceba8692fc585`. Not deployed.
Owner: Codex
Scope: Stop duplicate “ค่าใช้จ่าย ยืนยัน” cards after a repeated confirmation event for the same action. The owner supplied two cards for one 2,508.00 THB tax invoice dated 29 October 2026. Preserve business idempotency, delivery recovery and the next payment step.

Decisions:
- Preserve the original dirty checkout (`4a5817b42`, September 25). It lacks the current expense action flow. Created isolated managed worktree `line-expense-duplicate-confirm` at local main `8c112ea70003057fa3063938e859de1b945747d1`.
- Latest locally retained Production result is operation `20261028T180841Z-982f399a`, source `8c112ea70003057fa3063938e859de1b945747d1`, `ACCEPTED_LINE_DEFERRED`, finished `2026-10-28T18:16:06Z` (29 October 01:16 Bangkok). Recorded runtime source agrees on both API hosts, AI and workers. This is historical release evidence, not fresh cloud readback or snd incident correlation.
- Read `docs/runbooks/cloud-environment-operations.md` before cloud attempts. Read ponytail full from `.agents/skills/ponytail/SKILL.md` because the historical `/Users/spare058/...` path is absent.
- Existing non-root `watchdog-bedrock` STS identity is account 311414082667 / IAM user watchdog-bedrock-dev. DescribeLogStreams for `/ecs/mangmee-kamal-production-api-web` is denied. Scoped `mangmee-kamal-production` session requires fresh MFA. Requested the owner authenticate locally using `aws sts get-caller-identity --profile mangmee-kamal-production`; do not bypass the runbook's MFA requirement.
- No root profile, IAM change, service restart, business-data mutation, LINE message, deploy, or customer-gate change. UAT/READY/Production run IDs for this task: NOT_DISPATCHED.

Findings:
- Production persisted one matching expense and one confirmation audit. Two different webhook events, 2.012 seconds apart, each produced an accepted result card.
- `LineExpenseActionService.apply()` correctly binds actor/chat/token/revision and returns `replayed` for the second event, without another confirmation mutation.
- `handleExpenseActionPostback()` previously sent a full card for both `applied` and `replayed`. The patch skips the second card only after finding acceptance of the exact result for the same recipient.
- Both incident deliveries used successful primary REPLY requests; neither used a push retry or Flex fallback. Why LINE emitted two events from the reported single tap remains unobserved.

Open questions:
- Resolved: owner confirms one tap produced two separate cards and supplied the full sequence. The first says “ยืนยันแล้วค่ะ”; the second says “รายการนี้ดำเนินการแล้วค่ะ”. Owner authenticated the scoped MFA session locally.
- The reason LINE emitted two distinct events from the reported single tap is not observable from retained server data; do not assert the owner double-clicked or that LINE redelivered the same event.

Artifacts:
- `apps/api/src/modules/line-ai/application/line-expense-action.service.ts`
- `apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts`
- `apps/api/src/modules/line-ai/domain/logic/line-expense-action-card.logic.ts`
- `apps/api/src/modules/line-ai/domain/logic/line-delivery-plan.logic.ts`
- Local historical result: original workspace `.env.kamal/production/runs/20261028T180841Z-982f399a/result.json` (private; no credentials copied here).

Verification:
- Traced current source from postback parsing through action apply, card building, durable plan, reply/push handling; original checkout is not used to infer current behavior.
- Focused existing tests passed (exit 0) against clean matching source in `/Users/thawatchai/.codex/worktrees/free-expense-merge/mangmeeplus` (the diagnostic worktree has no dependencies). Command: `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=dot --test-name-pattern='Round 2 A expense action postback|freezes a bounded trusted Flex|bound path, context 4|bound path, contexts 5' src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts`. These are source-level checks, not incident reproduction or live customer acceptance.

Next:
- Branch integration complete. Deployment remains a separate authorized step under the deployment protocol, followed by actual LINE acceptance of the patched behavior.

## Production readback after MFA — 2026-10-29

- Scoped deploy-role identity, both EC2 instances and enrolled SSH host keys verified. Both running API containers report source `8c112ea70003057fa3063938e859de1b945747d1`.
- Read bounded API logs 06:05–06:20 UTC and queried the database inside `BEGIN READ ONLY`, with a 10-second statement timeout. No application API mutation or message send.
- Exact shop `Snd Prd`: one matching expense `EXP-202610-00001`, vendor document `FTMR-DCP6910290002`, amount 2508.00. One `expense.confirm` SUCCESS audit at 13:13:17.766 Bangkok; one `expense.evidence.review`. The subsequent payment flow is separate.
- First inbound confirmation event `01M634N4PK7NPM80N5TW0JVK7P` was accepted on API A at 13:13:17.103, action applied once, result accepted by LINE at 13:13:18.330 (message `638244042345284193`).
- Second distinct inbound event `01M634N6Z7WCN7819NKAGXYBTH` was accepted on API B at 13:13:19.115, action returned `replayed`, result accepted by LINE at 13:13:19.816 (message `638244044543623210`). Both sends used REPLY, primary representation, zero push attempts and no provider error. The first receipt card was already accepted before both.
- Root cause in our code: `handleExpenseActionPostback()` builds/delivers a full success card for both `applied` and `replayed` with no cross-event check that the same action result was already delivered. Existing business idempotency works; presentation deduplicates only by webhook event, not action token.
- 2/2 owned SSM sessions terminated, zero cleanup failures. Private raw evidence and SQL/transport scripts: `/tmp/snd-line-confirm-20261029/`. Local wrapper originally named `inspect.py` shadowed the Python standard library and raised an import error after the nested diagnostic completed and cleanup passed; renamed to `readback.py`. No duplicate diagnostic run was dispatched to clear that local error.

## Local remediation and verification

- Added an accepted-result lookup after the existing action service returns `replayed`, only for `expense_action_confirm`. The lookup binds company, user, chat hash, LINE channel and recipient, applied token and exact preview hash. Both actual incident plans have matching actor fields, token and preview hash; first acceptance preceded the second event.
- A matching accepted delivery terminates the second event as `expense_action_duplicate` / `intentional_noop`; the generic no-answer fallback is explicitly excluded. No new message is falsely marked delivered. Missing/unknown prior acceptance keeps existing result delivery; preparing payment and other next steps remains unchanged.
- Reproduced before implementation: the new two-event regression failed with `2 !== 1` cards. After implementation the focused regression/classification checks passed 12/12.
- Ran full existing webhook, terminal-outcome, delivery-plan and expense-action security suites: **944 tests / 69 suites, all passed**. Command: `pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/domain/logic/line-ai-terminal-outcome.logic.spec.ts src/modules/line-ai/domain/logic/line-delivery-plan.logic.spec.ts src/modules/expenses/application/use-cases/line-draft-update.security.spec.ts`.
- Installed locked dependencies offline, built existing contracts/config packages and generated the existing Prisma client locally. No package manifest, lockfile, schema or dependency change. `git diff --check` passed.
- `pnpm --filter @watchdog-bms/api typecheck` passed (exit 0). Reviewed the final diff; only action delivery, no-answer fallback classification, focused tests and incident docs changed.
- Read the Thai UX standard. No screen layout, button, Thai copy or rendered card changes; the fix is a server delivery decision, so 390/1280 browser screenshots would not exercise it. Native LINE acceptance of the patched code awaits a future authorized release.
- Limit: this deliberately does not suppress results whose original delivery is still unknown/in-flight. Confirmed delivery is required to avoid silently losing a financial result. It fixes the observed sequence where the original acceptance already exists.

## Main/develop integration — 2026-10-29

- Owner explicitly requested merging into both branches. Fetched `origin/main` and `origin/develop`, both `6160fabe01adac120e74d7591925b6601cb22b90`, with zero divergence. Rebased the fix as `3f6db17298447c7186632ebae01c22a665b80de0`; resolved only the cloud runbook insertion, preserving the newer release and UAT pause entries. Application source was unchanged by the rebase.
- Refreshed the W00 capability manifest. Reviewed changes are source hashes/provenance only: this webhook fix and the existing public-policy change from `049aa51de`. Registry, operations and capability shapes did not change.
- CI's maintenance pin check exposed five stale hashes already present on main from `049aa51de` (password login, auth guard, session landing, upload and download). Reviewed those existing source diffs and regenerated their hashes plus the validator digest in the release workflow. No enforcement logic or workflow behavior changed.
- Additional checks passed: capability manifest plus staff-menu/business-card suites **185 tests / 27 suites**; `node infra/security/sync-production-maintenance-release-pins.mjs --check`; maintenance validator and pin-sync shell specs; `bash infra/docker/production-image-security.spec.sh`; `git diff --check`. Logs retained under `/tmp/snd-line-confirm-20261029/`.
- GitHub reports both branches unprotected. No protection or required check was removed or bypassed. There is no in-progress Actions run; the sole queued row is the documented stale READY `31611733340`, unchanged since 2026-08-12, freshly checked with zero jobs, check runs and pending deployments. It was not cancelled or retried.
- Atomic fast-forward push succeeded for both remote branches; independent `git ls-remote` readback confirmed both at `97573b50de6e524a805391146f0ceba8692fc585`, containing fix `3f6db1729`. This final memory update follows as documentation only. Current CI has no push trigger; these are local verification results, not a claim of a successful new Actions run. UAT/READY/Production run IDs remain `NOT_DISPATCHED` for this task.
