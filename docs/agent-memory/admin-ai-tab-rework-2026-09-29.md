# Agent Memory: admin AI tab rework (2026-09-29)

Status: PR 1 (split switch removal) ready for review; PR 2 (admin tab) in progress.
Owner: Claude (controller-delegated), Owner decisions 2026-09-29.
Scope:
- PR 1 — remove `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` ("สวิตช์เป็นเปิด", "no switches, always on").
- PR 2 — make the System Admin company tab "AI และโควตา" consistent with the credit + receipt-image model.

Decisions:
- PR 1: the switch is deleted, not defaulted on. SPLIT is savable whenever the ADR 0013 §8 money
  rules hold. `splitActivationEnabled` is dropped from `PartnerAiBudgetPolicyDto` (an older web reads
  `=== false`, so an absent field already means "not blocked"). The Thai text for
  `partner_ai_budget_split_not_enabled` is removed with the code.
- PR 1: `infra/kamal/config.json` drops the key in both stages. The running ECS baseline still
  carries `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true`; the api schema is a plain `z.object`, so the
  captured leftover key is stripped at parse (listed in `keysOutsideSchema`, not an error). No `null`
  delete entry was added: it would fail a release whose baseline no longer has the key.
- PR 1: legacy `deploy.sh` no longer reads, validates, forces or writes the key; the serving-mode
  spec now fails if the key comes back. `deploy.sh` is pinned, so the maintenance pins were re-synced
  in the same commit (validator + `deploy-production.yml`).

Open questions: none for PR 1.
Artifacts:
- PR 1 branch `claude/ai-split-always-on-20260929` (worktree `/private/tmp/mangmee-ai-switch-20260929`).
Verification (PR 1):
- `packages/config` tests: 149/149.
- API: set/get partner AI use-case specs 76 pass, 3 skipped (need Postgres).
- Web: ai-budget.logic, api-error-coverage, api-error-message, action-loading, partner QA and logic specs 169/169.
- Infra: production-serving-mode, validate-production-maintenance-release, sync pins (and `--check`),
  h15-trust-boundary, release-safety, production-image-security specs, Kamal unittest (82) all pass.
- W00 capability manifest regenerated (`packages/config/src/index.ts` is hashed) and re-verified.
- API + web typecheck (native tsc script): rc 0.
Next: PR 2 on branch `claude/admin-ai-tab-rework-20260929` from PR 1's branch.
