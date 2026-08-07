# Agent Memory: reimbursement upgrade write quiesce

Status: Local runtime/verifier/clone contract complete; production promotion remains blocked on
live signed PRE classification, reader-grant refresh and release choreography.
Owner: Production U5 promotion task.
Scope: Old header-only reimbursement writer to final multi-line writer, write quiesce, migration,
approval integrity and exact production rollout ordering.
Decisions:

- Users must not migrate, repair, re-enter or resubmit an untouched historical reimbursement.
- New submissions use the line-bound v2 snapshot hash.
- A stored header-only v1 hash is accepted only with an exact deterministic one-line migration
  fallback; the historical hash is retained as what was actually signed.
- Unknown, modified, forged or multi-line v1 shapes fail closed; hashes are never nulled or broadly
  bypassed.
- Bridge-only quiesce and retirement of every unguarded task precede migration. Unquiesce is last.
- Approval and rejection re-read status/version/self-approval/assignment under the request lock;
  approval also revalidates the v2/exact-v1 hash. Step decision and final request CAS are one
  transaction, with claim expense/line/link materialization inside approval. Approve/approve and
  approve/reject have one winner; a final-transition failure rolls every write back. Finance and
  payment transitions are not declared race-safe by this slice.

Open questions:

- Read-only UAT/production counts for v2-valid, exact-v1-compatible, missing-hash and invalid pending
  requests must be captured by the private A5 reader before promotion.
- Finance and payment transitions still require their own state/CAS review.

Artifacts:

- `docs/specs/reimbursement-upgrade-write-quiesce-spec.md`
- `docs/plans/reimbursement-upgrade-write-quiesce-plan.md`
- `apps/api/prisma/migrations/20260804150000_reimbursement_line_compatibility/migration.sql`
- `apps/api/src/modules/reimbursements/domain/logic/reimbursement.logic.ts`
- `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.ts`
- `apps/api/src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts`

Verification:

- Pure mapping/approval/domain tests: 90/90 PASS, including exact deterministic-id fallback and
  adversarial mutation rejection.
- Local required PostgreSQL compatibility gate: PASS against the Docker PostgreSQL database; final
  registered shape is 2 suites / 13 tests / 13 pass / 0 skipped. New cases prove duplicate approval
  and approve-versus-reject have one winner, invalid approval/rejection final transitions roll all
  their step/status/materialization writes back then permit retry, and an untouched exact fallback
  with a v1 hash remains approvable.
- API typecheck PASS after the final approval/rejection and PostgreSQL test additions.
- Production clone population classification/live evidence and controller chain remain pending.

Next:

- E6 must run the private reader bootstrap as `LEGACY_PRE_F1` before PRE and refresh it as
  `F1_CURRENT` after migration and before POST_MIGRATION, then run live signed PRE/clone/POST.
- Regenerate exact A5/U5 hashes only after the app, Prisma and controller bytes are frozen.
