# Agent Memory: deploy-time-reduction

Status: Spec+plan authored; execution blocked until in-flight 2026-08-17
release reaches customer `OPEN` (see `production-deploy-2026-08-17.md`) and
GitHub Actions/API incident resolves.
Owner: Product owner / Claude (Fable 5 orchestrating, Opus 5 implementing)
Scope: 3-phase deploy-time reduction to ≤10m UAT and ≤10m production promote,
per `docs/specs/deploy-time-reduction-spec.md` and
`docs/plans/deploy-time-reduction-plan.md`.
Decisions:
- Sequencing: complete in-flight promotion (UAT `32038712267`, READY
  `32041268834`, then Production V2 live + stage E OPEN) before any controller
  change lands. Rationale: Passport/READY pin exact workflow blobs; a
  controller change now would strand the signed chain.
- Live post-shift bake (3m) is retained in phase 1; only canary bakes and
  maintenance-mode bakes go to 0. Owner may revisit with traffic growth.
Open questions:
- Live production bake values + RollbackAlarm period read-back (phase-1 step 1)
  — blocking, not yet performed (no local AWS credentials; use read-only path
  when GitHub/AWS access available).
Artifacts:
- Evidence run set: UAT `31901904745` (22m, step table), UAT `31816168613`
  (32m full-CI), READY `31903027707` (6m), prod live `31903336753` (38m, step
  table), failed prod `31897008213` (1h30m: close 23m / rollout-fail 25m /
  recovery 27m).
Verification:
- Spec §1 tables derived from GitHub Actions job/step timestamps via `gh api`
  on 2026-08-17.
Next:
- After stage E OPEN: phase 1 per plan §1 (read-back first), Opus 5 implements,
  Fable 5 reviews, admin merge, verify on next real promote.
