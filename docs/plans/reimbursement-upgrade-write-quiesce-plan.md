# Plan: Reimbursement Upgrade Write Quiesce

Spec: `docs/specs/reimbursement-upgrade-write-quiesce-spec.md`

Task memory: `docs/agent-memory/feature-entitlement-decoupling-implementation.md`

Working rules: ponytail full mode; smallest correct diff; no new dependency; exact files only in the
shared dirty worktree; do not claim human/accounting/live evidence that was not produced.

## Phase 0 — freeze the contract

1. [x] Audit the old/new HTTP and repository contracts. Record why database compatibility alone does
   not protect a mixed web/API canary.
2. [x] Choose controller-first write quiesce instead of a permanent dual-payload adapter. Keep reads
   open and require no customer migration or re-entry.
3. [x] Write the normative spec and this implementation/rollout plan before runtime edits.

## Phase 1 — bridge-compatible runtime slice

4. [x] Add `REIMBURSEMENT_WRITE_QUIESCE` to the shared API config with default `false`, expose one
   read-only getter and add default/true/invalid tests.
5. [x] Add one `ReimbursementWriteQuiesceGuard`; attach it to both reimbursement controllers. Allow
   only GET/HEAD/OPTIONS while enabled; otherwise set `Retry-After: 60` and throw coded `503`.
6. [x] Add focused tests proving method coverage, response code/body/header, disabled behavior and
   that guard refusal occurs before both old and new DTO validation shapes.
7. [x] Map `reimbursement_upgrade_in_progress` in the existing web error seam. Prove the create form
   and decision dialogs keep their state on refusal; never auto-retry a mutation.
8. [x] Inject the flag into api-web container configuration and add static render/readback tests.
   Default and every non-transition deploy remain `false`.

Exit: this slice compiles and can be cherry-picked onto protected `main` without the candidate
reimbursement DTO/schema changes.

## Phase 2 — forward data defense

9. [x] Keep every applied migration byte-identical, including `20260801150000_drift_forward_fix` at
   its original 5-second lock timeout.
10. [x] Add one new idempotent forward migration that backfills only line-less legacy requests and
    installs the bounded legacy-header insert defense.
11. [x] Make the final repository request+line write atomic. Use no broad adapter or customer repair
    workflow.
12. [x] Put draft header+line replacement and final submit transition behind the same
    request-scoped lock and `DRAFT + observed updatedAt` CAS. Create the approval step and request
    transition in one transaction; return `reimbursement_draft_changed` to the loser with no orphan
    transition. Cancellation uses the same lock plus status/version CAS. A safe retry may reuse only
    a `COMMITTED` number already owned by that request; it neither recommits nor duplicates number
    audits. Prior `OPEN` duplicate candidates are dismissed in the same transaction before the
    current scan is inserted, preserving their original reasons. A legacy `PENDING` approval step
    left by the pre-atomic flow is invalidated with an immutable reason before the replacement step
    is created in that same transaction, so users never have to repair or resubmit historical data.
13. [x] Run real PostgreSQL tests for zero/one/many-line cases, company/amount invariants,
    idempotency, rollback, edit-versus-submit races and a simulated legacy insert. A later valid
    header `updatedAt` change must pass.
13a. [x] Add the versioned approval-snapshot verifier and fixtures for production header-only v1
    pending rows. Accept only an exact deterministic migration fallback, keep its historical hash,
    reject every changed/forged/multi-line legacy shape, and make the private production A5 PRE/POST
    reader classify the complete pending population before unquiesce. The isolated clone separately
    runs the deterministic compatibility/race gate. No employee resubmission or blanket hash bypass.
13b. [x] Make approval/rejection step decision and final request CAS one request-locked Prisma
    transaction; approval also includes claim-expense/expense-line/attachment-link materialization
    and reimbursement-line links. Re-read status/version/self-approval/assignment under the lock,
    and validate the v2/exact-v1 hash on approval. Prove concurrent approve/approve and
    approve/reject each have one winner; injected final-transition failures roll every write back
    before a clean retry. This does not broaden the claim to finance-review or payment transitions.
14. [ ] Regenerate the exact production A5 migration catalog/operation count, reviewed hashes,
    lock budgets and U5 workload allow-list only after all app/Prisma bytes are frozen.

## Phase 3 — release-controller gates

15. [ ] Extend signed production PRE/POST evidence with bridge/final source+image, active revision/task
    set, flag readback, quiesce start/end, invariant hashes and bounded UX-impact count.
16. [x] Add controller steps in this exact order: restore only the exact UAT-attested bridge digest →
    bridge api-web true → retire/prove → signed PRE →
    migrations/invariants → final all services with api-web true → retire/prove → api-web same image
    false → postflight.
17. [x] Make every failure path retain `true`; prohibit unquiesce when schema/invariant, digest,
    health, task retirement or exact-revision proof is missing/moving.
18. [ ] Add adversarial shell/workflow tests for skipped bridge, unguarded active task, flag mismatch,
    old task left alive, changed image during unquiesce, migration failure and stale/replayed evidence.
19. [x] Update rollback so pre-migration failure may restore the bridge, while post-migration failure
    stays quiesced until a compatible build passes. Neither path changes entitlement/route state.

## Phase 4 — integration and promotion

20. [ ] Land the bridge through a protected-main PR with a real independent review; deploy it to UAT
    first and prove read/write behavior.
21. [ ] Merge neutral `main` back into `develop`, require exact CI, deploy the exact merge SHA
    to all UAT services and produce signed acceptance.
22. [ ] UAT pairing matrix: old web→bridge API, new web→bridge API, old web→candidate API and new
    web→candidate API all refuse mutations safely while quiesced; authorized reads continue.
23. [ ] Unquiesce the final UAT candidate and prove lines-only create/update/submit plus friendly
    refusal-state retention. Restore the intended UAT state and attach exact revision/flag evidence.
24. [ ] Run the already owner-approved U5-C 100+5,000 workload only after app/Prisma/controller bytes
    and exact UAT SHA are frozen. Any changed/repeated workload needs fresh approval.
25. [ ] Complete production security/A5/clone/owner gates, then execute Phase 3 against protected
    `main`. Stop on any failed signed predicate; do not use `db execute`, `migrate resolve` or manual
    migration metadata edits.
26. [ ] Record final evidence and remaining shadow-only restrictions in task memory. Human usability,
    VAT/WHT and per-family enforcement remain honest independent gates and are never inferred from
    this quiesce.

## Verification commands

- focused API guard/controller/config tests
- focused web error/state tests
- `pnpm --filter @watchdog-bms/config test`
- `pnpm --filter @watchdog-bms/api typecheck`
- `pnpm --filter @watchdog-bms/web typecheck`
- real PostgreSQL reimbursement compatibility tests
- required production clone command (the runner supplies its in-memory child `DATABASE_URL`):
  `REIMBURSEMENT_PG_GATE_REQUIRED=true pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec src/scripts/production-a5-reimbursement-compatibility.pg.spec.ts src/modules/reimbursements/infrastructure/prisma-reimbursement.repository.draft-submit-race.spec.ts`
- fail-closed probe: the same command without `DATABASE_URL` must exit non-zero
- deploy/config renderer and production workflow adversarial shell suites
- exact CI on bridge and final candidate SHAs

## Stop conditions

- Any current reimbursement mutation surface bypasses the guard.
- The guard runs after DTO transformation/validation.
- An applied migration checksum changes.
- A rollout can migrate before all active api-web tasks are guarded+quiesced.
- A rollout can unquiesce with an old/incompatible task or without exact post-invariants.
- A user would need to repair, migrate or re-enter committed data.
- Any pending legacy approval cannot be classified as exact v1-compatible or v2-valid.
