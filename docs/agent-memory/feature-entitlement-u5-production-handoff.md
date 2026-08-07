# Agent Memory: feature-entitlement U5 production handoff

Status: IN PROGRESS — handoff snapshot 2026-08-04. Production promotion and reimbursement
write-unquiesce are **not authorized by evidence yet**. No production mutation was made in this
workstream.

## Receiving session update — 2026-08-04

- Audited the A2 `Branch.isVatEstablishment` write paths and found a real invariant gap: normal
  branch create/update and seed upserts wrote `taxBranchCode` without the coupled boolean. This
  could make a tax establishment invisible to seller-establishment resolution after a normal
  settings write or a fresh seed.
- Fixed the repository boundary to derive both fields together, preserve both on unrelated edits,
  and accept explicit `null` to clear both. Updated branch DTO/contracts/web types and settings
  clear behavior. Seed upserts now write the same invariant; onboarding already did so.
- Added focused repository/use-case/DTO coverage. Verified 53 focused tests, API and contracts
  typechecks, Prisma validation, contracts build, web typecheck and `git diff --check` on the
  current local bytes.
- This closes only the A2 branch write-path defect. It does not accept the migration catalog,
  CC2 projection, end-to-end branch ABAC, U5 controller/network evidence, capacity, Safe-OFF,
  human acceptance or production promotion. Reimbursement write-quiesce remains the safe state.

Owner: product owner / next implementation session

Scope: finish feature-entitlement production readiness through U5; close shadow, capacity,
safe-OFF, VAT/WHT, accessibility/usability and production preflight gates; then promote the exact
approved image to production with signed evidence, independent review and rollback safety.

Publication note: the first handoff snapshot entered remote history inside tax-identity A3a commit
`9654779e` and merge `3c18af84` because two sessions shared one Git index. That co-location records
the memory only; it does **not** accept A3a, CC2, U5 controller/network code, production readiness or
promotion. Review each scope against its own spec, tests and evidence before reusing it.

## Product outcome and non-negotiable UX

- `develop` is UAT. `main` is production.
- Feature families must be independently switchable. Turning one family OFF must not make an
  unrelated family fail, leak data or present a generic/incorrect permission error.
- Normalization, compatibility repair and accounting projection are deploy/system-owned. Do not
  ask customers to run a migration wizard, re-enter history, choose route keys or supply technical
  fields.
- Preserve historical artifacts and legally required runoff. New roots/sends must stop when OFF;
  approved retained reads and compensation may continue only through the matrix-defined path.
- Friendly UI remains part of correctness: hide unavailable navigation, preserve honest deep-link
  errors, auto-select a valid branch when possible, and never equate entitlement denial with an
  employee permission denial.
- WHT specialist routes stay CLOSED until statutory/business acceptance is real. UAT or production
  shadow deployment does not imply VAT/WHT acceptance or GA.

## Owner approvals already given

- The owner authorized continuing through U5 and, once every gate is proven, promoting the exact
  reviewed build to production.
- U5-C workload is explicitly approved as **100 operations for smoke** and **5,000 operations for
  the full capacity run**. Do not silently increase either number.
- This is not permission to bypass protected `main`, mutate unrelated infrastructure, weaken a
  security baseline, or accept recurring AWS cost that was not separately approved.

## Current Git/worktree truth

- At handoff creation local `develop` was at `26425590`, one commit ahead and fourteen
  commits behind `origin/develop`; the observed remote tip was `2e27ca53`.
- Both tips contain tax-identity Release A2 under different commit topology. Release A2 is therefore
  already part of the remote UAT line; do not assume it can be ignored when building the exact U5
  candidate.
- The shared worktree is intentionally very dirty: controller, A5 network, CC2, specs/plans and
  tests are in flight. Do **not** reset, stash, checkout files, stage all, or commit by directory.
  Preserve every unrelated edit and stage only an audited file list.
- Three implementation lanes were interrupted at the handoff request. Their files remain in the
  worktree and are not accepted merely because they exist.

## Intervening tax-identity impact

- Release A2 originally landed while its task memory still recorded unresolved QP1/QP2/QC1 owner
  questions. It adds migration `20260804180000_company_tax_identity_step0` and changes Prisma,
  onboarding, CI, enum parity and a real-PostgreSQL test.
- The current production A5 reviewed migration catalog previously ended before `180000`. An exact
  manifest will fail, or worse become incomplete, unless the next session explicitly reviews A2,
  resolves its owner questions, adds it to the reviewed catalog and reruns all UAT evidence.
- CC2 schema changes are logically independent of A2, but both touch adjacent Prisma/package
  hunks. Resolve using an audited merge or a clean candidate branch; never use a destructive reset
  in the shared worktree.
- Audit the A2 `Branch.isVatEstablishment` write paths. Schema presence alone is insufficient if
  onboarding/update writers omit the coupled `taxBranchCode` invariant.

## CC2 reimbursement state

Why it is in this promotion: existing reimbursement approval could materialize accounting expense
rows before a durable two-phase projection completed. Production must remain write-quiesced until
the replacement is proven.

Implemented but uncommitted/incomplete:

- Spec, plan and memory for source-line projection, neutral VAT, cancellation and reconciliation.
- Additive `ExpenseRecord.sourceReimbursementLineId`, cancellation intent fields, composite
  company/request/line/branch relations and migration preflights.
- Root fixed Prisma's one-to-one relation requirement by adding
  `@@unique([companyId, sourceReimbursementRequestId, sourceReimbursementLineId])` and the matching
  unique migration index.
- Manager and finance phase-A/phase-B methods, in-transaction audit/outbox hooks, projection
  orchestrator/reconciler, explicit reimbursement-owned expense confirm/void, payment/accrual
  guards and cancellation intent are present in the worktree.
- The legacy `approveRequestAtomic` entry point was changed to fail closed with
  `legacy_reimbursement_approval_path_disabled`; its unreachable compatibility body still needs
  deletion after tests/callers are updated.
- Neutral default for unresolved external evidence is:
  `cc2VatClaimClassification=EXTERNAL_OR_UNRESOLVED`, `vatMode=NEEDS_REVIEW`,
  `inputVatClaimStatus=NEEDS_REVIEW`, and source/tax evidence `NEEDS_REVIEW`. Do not infer VAT
  claimability from an employee receipt.

Evidence and gaps:

- `corepack pnpm --filter @watchdog-bms/api prisma:validate` passed after the composite unique fix.
- An API typecheck process eventually returned exit 0, but the repository was edited while it was
  running. Treat that result as non-authoritative and rerun on frozen bytes.
- Focused CC2 tests, DI boot, migration replay and real-PostgreSQL race/rollback tests have not been
  completed on the current bytes.
- Remove the old materializer body, update remaining specs, prove retry/crash/cancel/duplicate
  behavior and keep production write-quiesced until all pass.

## Reimbursement branch/ABAC P0 scope

The current implementation is not yet end-to-end branch safe. Close this class, not only one route:

- Auto-resolve a valid active branch on create: selected/default in scope first, then active
  `HEAD_OFFICE`; use company-central `NULL` only when the company has no branch. Do not add a
  required user form field.
- Reuse one branch-scope predicate for create/list/detail/update/submit/cancel, approval and finance
  queues/decisions, payment, form/signature/export and AI tools.
- Enforce an approval step assigned to either the exact user or its stored role snapshot in both
  the queue and locked mutation.
- Validate payment `bankAccountId` through the banking domain: same company, active and compatible
  branch/scope. Financial mutation, audit and outbox must share the transaction.
- The web should send the selected branch silently, display an understandable branch chip/filter,
  and show a friendly inaccessible-deep-link message. AI Gateway must call the same permission-
  checked use cases, never a raw repository.
- Add real-PostgreSQL cross-tenant, cross-parent, cross-branch, stale-decision and payment-bank race
  tests. Mock-only evidence is insufficient.

## U5 controller/A5 network state

Worktree implementation exists but is not yet accepted:

- Generic production `release` is intended to be hard-blocked. Incident mode must be DB read-only,
  use an exact already-applied migration catalog and require an already accepted/unretired build;
  it must not attest, write a release intent or create a service.
- The full workflow still required a rewrite at last checkpoint. Required order:
  prior UAT-attested bridge proof → stage context → H2 PRE/aggregate → H5 → exact H2A reviewed apply
  → H2 POST_MIGRATION/aggregate → same-image final quiesced deploy → prove bridge retired/quiesced
  → H5 recheck → same exact image unquiesce → H2 POST_DEPLOYMENT/aggregate → success.
- Every failure after quiesce must keep or restore quiesce and produce rollback/reconciliation
  evidence. Never fabricate `RELEASE_TASKS_APPLIED_SHA`.
- U5-C evidence must fetch and independently verify the exact signed child bytes and workload
  manifest; a ref-only PASS is not evidence.
- Endpoint-only A5 work is in flight: ECR API/DKR, Logs and Secrets Manager interface endpoints
  with private DNS; S3 gateway endpoint for the exact ECR layer bucket; dedicated endpoint/task
  security groups; no task IPv4/IPv6 CIDR egress. NAT may exist in the route table but must be
  unreachable from the task SG and reported honestly.
- Before applying the S3 gateway endpoint policy to shared route tables, inventory every consumer
  and prove the policy will not break serving workloads.
- H3 must independently verify the exact migration-tool ECR digest, trusted workflow identity,
  registry SBOM/provenance/signature and ECR scan (`HIGH=0`, `CRITICAL=0`) against H2A.
- Rerun all shell/JQ/workflow adversarial tests. Existing files and partial passing tests do not
  prove the workflow chain.

## Known readiness gaps to close

- Shadow coverage was last known as only 3/20 launch routes; persist `would_block`, prove mapped
  denominator and close every required route/family deep pass.
- `A5-CAPACITY-MUTATING` has not run on the final UAT bytes. Run only the approved 100/5,000
  workloads and record p95/p99 locks, throughput, failures, duplicates and recovery.
- Safe-OFF is proven only for Reports. Every promoted family needs close-preflight, runoff and
  retained-artifact evidence; do not generalize from Reports.
- VAT needs a real eligible UAT tenant with `thai_tax` actually ON, then calculation/export and
  OFF/cross-family behavior on the exact candidate.
- WHT needs business/statutory acceptance and durable handoff. Keep all
  `cap.wht50bis/*` launch routes CLOSED until then.
- Accessibility needs WCAG 2.2 AA checks, keyboard/screen-reader and 44×44 targets. Usability still
  requires two rounds × five real users aged 40+, at least 4/5 completing each journey unaided and
  zero serious misconceptions (for example, “assigned” must never be understood as “filed”).
- A separately reviewed production read-only preflight and independent protected-`main` approval
  are mandatory. UAT never clones/promotes to production automatically.

## Live AWS truth (read-only evidence only)

- Account: `311414082667`, region `ap-southeast-1`, thawatchai/root session was confirmed. Do not
  commit, paste, decode or replay any OAuth callback/token; the next session should log in afresh.
- Production ECS Express resources were ACTIVE but desired/minimum capacity was zero, no tasks were
  serving and public health was 503. Do not revive the old unquiesced build as a shortcut.
- Production RDS PostgreSQL 18.3 is encrypted/private but single-AZ, 7-day retention and deletion
  protection OFF. Latest observed automated snapshot was available; recheck age/state live.
- A Redis secret exists by metadata, but no managed ElastiCache replication group/serverless cache
  was found. No secret value was read.
- No SNS alert topic and no VPC endpoints were found. Production task environment did not yet show
  `SECURITY_ALERT_TOPIC_ARN` or `CLAMAV_HOST`.
- UAT was healthy on an older exact SHA at the last read. Another partial UAT deploy existed; the
  final all-target deploy must supersede it only after the candidate bytes freeze.

## External owner/security decisions still required

These are not safe to infer from the broad “promote when ready” instruction:

1. Confirm the human security-alert destination (candidate previously discussed:
   `thawatchai.phuchana@scbtechx.io`) and acknowledge a synthetic SNS delivery.
2. Approve recurring cost/change for RDS Multi-AZ, 35-day backups and deletion protection.
3. Approve managed encrypted/authenticated Redis with at least two nodes, automatic failover and
   35-day snapshots.
4. Approve VPC PrivateLink endpoint cost/policy for the endpoint-only clone/read-only tasks.
5. Provide a repo-scoped fine-grained `PRODUCTION_POLICY_READ_TOKEN` (Administration read-only) or
   an equivalent GitHub App credential; never use a broad personal token.
6. Obtain a real independent reviewer for protected `main`; do not weaken protection, self-approve
   or add access merely to pass the gate.

## Safe next sequence for the receiving session

1. Freeze the shared worktree and inventory exact file ownership. Fetch remote; do not pull/rebase
   over dirty files. Use a clean worktree/candidate branch for integration if needed.
2. Review Release A2 owner questions and migration-catalog impact before accepting it into the U5
   candidate. Because it is already on remote UAT, either close it fully and re-evidence or produce
   an explicit reviewed revert; never silently omit its migration.
3. Finish CC2 and branch/ABAC, then run Prisma generate/validate, API/contracts/web typechecks,
   focused suites, DI boot, migration replay and real-PostgreSQL race tests.
4. Finish the U5 controller/network/H3 chain and run every adversarial shell/JQ/workflow test.
5. Truth-up specs, plans and memory. Stage exact reviewed files, inspect `git diff --cached`, commit
   in scoped pieces and push `develop` only after reconciling remote changes safely.
6. Deploy one exact all-target candidate to UAT. Verify OCI signature/SBOM/provenance/scan and exact
   full SHA, then run normalization, 20/20 shadow, Reports and per-family safe-OFF, VAT/WHT,
   accessibility/usability and U5-C 100/5,000 evidence.
7. Resolve the six external decisions, run signed production read-only preflight, obtain protected
   `main` review, and promote the exact same image through the quiesced U5 state machine.
8. Keep enforcement flips CLOSED unless each family separately satisfies its deep-pass criteria.
   Production shadow-only deployment is not GA and does not authorize WHT.

## Authoritative artifacts

- `docs/specs/feature-entitlement-decoupling-spec.md`
- `docs/plans/feature-entitlement-decoupling-plan.md`
- `docs/agent-memory/feature-entitlement-decoupling-implementation.md`
- `docs/specs/reimbursement-cc2-projection-spec.md`
- `docs/plans/reimbursement-cc2-projection-plan.md`
- `docs/agent-memory/reimbursement-cc2-projection.md`
- `docs/specs/reimbursement-upgrade-write-quiesce-spec.md`
- `docs/plans/reimbursement-upgrade-write-quiesce-plan.md`
- `docs/agent-memory/production-u5-live-prerequisites.md`
- `docs/specs/deploy-wave-rollout-and-prod-promotion-spec.md`
- `docs/plans/deploy-wave-rollout-and-prod-promotion-plan.md`

## Minimum verification commands after bytes freeze

Run the repository-defined scripts rather than copying old result counts. At minimum:

```bash
corepack pnpm --filter @watchdog-bms/api prisma:validate
corepack pnpm --filter @watchdog-bms/api typecheck
corepack pnpm --filter @watchdog-bms/api test:boot
corepack pnpm --filter @watchdog-bms/api test:reimbursement-compatibility
corepack pnpm --filter @watchdog-bms/api test:a5-bootstrap
git diff --check
```

Also run every new `infra/security/*.spec.sh`, `infra/uat/*capacity*.spec.sh`, the exact
production-A5 PostgreSQL suites, contracts/web typechecks and the registered CI suite. Record exact
commands, exit codes and candidate SHA; a prior green run on different bytes is not transferable.
