# Agent Memory: Production Stripe live config

Status: Config MERGED (#658 develop / #659 main). BILLING_MODE=live + STRIPE_ACCOUNT_ID are in tracked
infra/kamal/config.json (production.api-web), and both Stripe secrets are now enrolled in the production
Express service configuration (verified). Production deploy is NOT yet authorized.
Owner: Controller reviews/pushes/opens the PR; this prep done by Claude in worktree
codex/production-billing-live-config-20260920, branched from origin/develop.
Scope: infra/kamal/config.json production block only (uat untouched); only apps/api reads these two
keys, so ai-gateway/workers were not touched. Docs only; no build/test/deploy run (light-work task).
Decisions: STRIPE_ACCOUNT_ID stays tracked (non-secret identifier); STRIPE_SECRET_KEY/
STRIPE_WEBHOOK_SECRET stay Secrets-Manager-only, never in git.
Open questions: who/when enrolls the two secrets into the production api-web ECS Express Mode service configuration
baseline before the next deploy can actually go live — see the new runbook.
Artifacts: docs/runbooks/production-stripe-live-enablement.md (new); bullet added to
docs/runbooks/cloud-environment-operations.md §7; this memory file.
Verification: node infra/security/sync-production-maintenance-release-pins.mjs --check (and
.spec.sh) run after the edit — see commit report for result; git diff --check clean; git status
showed only the intended files. No pnpm/build/docker run (out of scope for this task).
Next: Postmark production secrets + webhook are still pending on the owner; production deploy is not yet
authorized. When it is, follow docs/runbooks/uat-production-v2-deployment.md.
