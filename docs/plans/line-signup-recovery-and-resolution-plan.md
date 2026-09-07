# Plan: LINE signup recovery and resolution

Status: Implementation authorized; discovery complete and spec established before application edits.
Spec: [LINE signup recovery/resolution](../specs/line-signup-recovery-and-resolution-spec-th.md)
Memory: [task state](../agent-memory/line-signup-recovery-and-resolution.md)

## Scope and working tree

- Base origin/develop `d03c1761932d19abc019afaaf10a8f75674ff0b4`; origin/main `700a6414a0915ac800e42bd1b0d2c1e2fb9e1523` fetched before work.
- Branch `codex/line-signup-recovery-20260907`, isolated worktree `../mangmeeplus-line-signup-recovery-20260907`.
- Original checkout has unrelated user documentation; hash snapshot kept under original output/line-signup-recovery-20260907. No stash, cleanup or unrelated commits.
- No package.json changes, no new dependency, no cloud mutation or deployment. Existing feature flags/presets remain; bug fixes do not need another opt-in flag.

## Implementation ownership

1. `signup_backend` — GPT-5.6 Sol xhigh: intake resume/idempotency, email routing, explicit admin outcomes/trial guard, proof/current-state checking. Own external-signup API/domain/tests, signup contract sections and CompanySignupRequest migration/schema.
2. `signup_ui` — GPT-5.6 Sol xhigh: truthful LIFF state renderer, large actions/input/retry, signup admin review UI, associated tests/mobile browser journey. Align exact contracts with backend owner.
3. `support_resolution` — GPT-5.6 Sol xhigh: request-bound support reply for no-company, assignment/resolution/pagination, pause-expiry impact, API/UI/tests. Own support contract sections/LineSupportRequest schema and separate migration.
4. Coordinator — GPT-6 Astra: spec/plan, challenge assumptions and adjacent impact, inspect diff, build combined contracts/Prisma, real PG/browser integration, final source-matched CI, PRs/admin merge develop then main.

Workers share this worktree with disjoint file/section ownership and send proposed contracts before touching shared sections. Only coordinator commits/pushes/merges. Each worker records commands/results and known gaps; completed lane is not overall acceptance.

## Steps and evidence checklist

- [x] Read current docs/code/contracts and reproduce G01/G02 before implementation (audit artifact).
- [x] Fetch branches, isolate worktree, preserve original user files.
- [x] Write spec with product rules, proof/permission boundaries, customer and admin outcomes.
- [ ] Agree exact new DTO/action/fields between workers; record below.
- [ ] Implement scoped fixes and focused regression tests in each lane.
- [ ] Integrate schema/contracts/API/UI; review all callers and state/retention/cap/permission effects.
- [ ] Apply migrations on task-owned temporary PostgreSQL, regenerate Prisma and run required real-PG specs; preserve unrelated user containers.
- [ ] Test backend-to-frontend journey including fault/replay, existing-shop target, trial authorization, and no-company support reply/failure.
- [ ] Run relevant workspace tests/typecheck and existing browser acceptance on isolated local services; inspect mobile result.
- [ ] Update support playbook (remove weak proof assumption and stale email/trial wording), research status and memory with evidence.
- [ ] Freeze commit, push feature branch; review diff and CI of that exact source, create/review develop PR and admin merge.
- [ ] Promote same tested source to main via PR; resolve/retest any intervening change, admin merge, verify final trees and exact CI/merge IDs.
- [ ] Record mail provider and subscriber payment flow as next task, with boundaries and relevant existing modules. No implementation of those future tasks yet.

## Integration contract decisions

Exact field/action names will be inserted here as workers agree them. They must implement spec outcomes without inventing broad identity recovery/financial merge or silently bypassing old controls. Any difference between implemented behavior and spec is a review finding to close before Git delivery.

## Validation and delivery evidence

Pending. Store local logs/screenshots under `output/line-signup-recovery-20260907/`; record exact commands, source SHA, tests, migrations, browser evidence, CI run IDs, PR IDs and merge SHAs here/memory. Never claim a production rollout from Git merge evidence.
