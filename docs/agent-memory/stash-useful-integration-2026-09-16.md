# Agent Memory: Useful stash integration — 2026-09-16

Status: LOCAL VERIFIED; source publication/merge status is recorded in the PRs for branch `codex/stash-useful-integration-20260916` and its main promotion.
Owner: Codex / thawatchai.
Scope: Owner selected the `.env`/regression improvements and Merchant/Bank/Postmark documents, excluded historical UAT/test/audit records, and authorized integration and cleanup. No feature implementation or deployment.

Decisions:
- Start from current develop `0e2b4937c81d75882dcb910ac9a3d003ee423071`; its tree equals main `9009a82ecd2f8e481a9357b855c46b567c3dceeb` at preparation time. Keep the original working checkout untouched.
- Restore only useful changes from stash `fbeedb5b20b53d674c3e8e1c19bf6995a2b0d81b`. Add local Postmark example comments while keeping cloud required-Postmark behavior and existing OTP key examples.
- Adapt Kamal regressions to current named/ARN secret resolution, required OTP HMAC input, native readiness projection and AWSCURRENT rotation guard. AWS and HTTP are fully simulated; runtime implementation, permissions, UI, schema and provider configuration do not change.
- Consolidate useful Postmark audit/implementation details into the current plan and research document, with source/native acceptance clearly separated. Do not import obsolete login/runtime histories or restore SES/disabled cloud defaults. Existing provider spec/plan point to the updated source checkpoint.
- Preserve the Merchant/Bank recommendation as a proposal. Merging documentation does not choose a pilot segment, authorize bank outreach/connectors or approve a new feature.
- Exclude the five historical items in the selected bundle and all 34 duplicate/superseded/generated items. Original archive and selected bundle remain outside the repo; retire the two reviewed stashes only after source preservation/merge is verified.
- No package.json, runtime source, production maintenance pins, CI workflow or deployment changes.

Open questions: None for implementation. Main requires one approving review under current branch protection; no bypass has been assumed.

Artifacts:
- [Merchant/Bank proposal](merchant-bank-killer-use-case-2026-09-15.md).
- [Postmark environment plan](../plans/postmark-environment-isolation-plan-th.md) and [research](../research/postmark-environment-isolation-review-2026-09-15-th.md).
- `.env.example`; `infra/kamal/release_test.py`; provider plan/spec source checkpoints.
- Full cleanup backup `/private/tmp/mangmee-cleanup-20260916T035523Z`; selected bundle `/private/tmp/mangmee-stash-selected-20260916T041359Z`.

Verification:
- `python3 -B infra/kamal/release_test.py`: 24 tests PASS, including UAT/Production canonical override, OTP key, exact current secret inventory, native readiness, wrong-origin rejection and secret rotation.
- `python3 -B infra/postmark/config_test.py`: 5 tests PASS; existing canonical configuration/ECS rendering contracts.
- `git diff --check`: PASS; all 38 relative links in new documents and the two updated source checkpoints resolve. Exact scope is eight files.
- Application/backend-to-frontend and browser checks are not rerun locally: no app runtime, endpoint, UI, loading/error/permission behavior or data model changed. GitHub CI status is reported per exact PR head.
- UAT_RUN_ID / READY_RUN_ID / PROD_RUN_ID: none dispatched. No native mail, provider account access, cloud reads/mutations, payment or customer-gate change.

Next: Publish exact source to develop/main with checks and branch policy respected, then remove only the reviewed stashes and temporary integration worktrees. Cleanup/merge receipts remain with the external backup.
