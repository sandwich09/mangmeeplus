# Agent Memory: U5 production owner-authority wiring

Status: 5 gaps closed on branch `fix/u5-production-authority-wiring`; BLOCKED on a design decision
about where production migrations run. Not merged, not pushed.
Owner: original work `a3fb68cc` (thawatchai.phuchana, 2026-08-04 02:34); this follow-up by Claude.
Scope: `infra/docker/production-image-security.spec.sh` fails in CI, so `Typecheck and Test` is red
on `develop`.

## How this surfaced

`a3fb68cc` shipped the evidence scripts, the chain validator and the spec assertions, but not the
`deploy-production.yml` wiring they assert. Nobody saw it because `pnpm test` failed earlier in the
same CI job (the reimbursement fakes, fixed in `7bbfbead`). With tests green, the next latent
failure surfaced.

Not a regression from the LINE or reimbursement work: at `979105f3` the spec already asserted the
step (1 match) and the workflow already lacked it (0 matches).

## Closed here (5)

1. **`Wait for and fully verify independent U5 owner authority`** — this was a LIVE BREAK, not just
   a missing check: five later steps already read `$U5_OWNER_APPROVAL_FILE` and nothing set it, so
   under `set -u` any promotion deploy died at the first recheck. The step waits for an approval
   artifact named for this exact run+attempt, reads every producer run id out of the signed
   approval (`preAggregateRef`, `productionA5PreMutationRef`, `productionA5CloneRef`,
   `securityPreflightRef`), fetches each, then runs `validate-pre`.
2. **`Recheck release authority immediately before AWS`** — the approval lives 1800s and the work
   between the wait and the credentials can burn it.
3. **Dropped `u5_capacity_result_run_id`** as a dispatch input (spec forbids `inputs.u5_`). Capacity
   reaches the deploy only as `.payload.u5Capacity.resultRef` inside the owner-approved aggregate,
   which `validate-pre` rebuilds and compares. **Workflow interface change**: a saved dispatch
   payload carrying that input must drop it.

4. **The fifth validator pin** (`production-image-security.spec.sh:229` counts 5, tree had 4) —
   ANSWERED from the commit's own arithmetic: before `a3fb68cc` the pin existed twice, both in
   `deploy-uat.yml`; the commit added two production pins and asserted five in the same breath, so
   it was writing **three** production pins and shipped two. The third belongs to the authority
   step it also failed to ship. Added there with a real assertion, not a bare env: the chain rests
   on a UAT acceptance verdict, so the validator that produced it must be the reviewed one.
5. **The deploy called a mode its own script forbids** — a second live break. `run-release-task.sh`
   refuses `release` in production since `a3fb68cc`, but `deploy-production.yml` invoked it with no
   mode argument, i.e. the default. Promotion now runs `release-prepare` (the no-migration path,
   gated on `RELEASE_DATABASE_AUTHORITY=U5_REVIEWED_APPLY`, which the authority step above proves)
   and an incident runs `incident-preflight` — the two paths the refusal message itself names.

## Open question (blocking) — production migrations have no path

`production-image-security.spec.sh` (line ~813, written earlier by `96e16c64`) still requires the
production release task to render `prisma migrate deploy` + `sync-permissions.ts` +
`sync-thai-address-master.ts`. `a3fb68cc` forbade exactly that. The two cannot both hold.

The reason this is a design decision and not a spec port: **after `a3fb68cc` nothing applies
migrations in production at all.**

- `prisma migrate deploy` appears in one place only — the `release` mode's `task_command`
  (`run-release-task.sh:554`), which production now refuses.
- `release-prepare` only *verifies* the applied catalog and attests the launch build.
- `f2-apply` and every A5 mode are locked to isolated UAT.
- No workflow performs "the reviewed U5 apply" the refusal message points at; `u5-owner-approval`
  and `u5-shadow-evidence` produce evidence, `f2-normalize-apply` runs the entitlement normalizer.

So a pending production migration (e.g. `20260804190000_line_webhook_orphan_recovery`) currently
has no way to reach production. **Decide the intended model, then the spec follows:**

- (a) production deploys still migrate → revert the `release` prohibition in `run-release-task.sh`;
- (b) migrations move to a separate reviewed apply → that path has to be built (mode + workflow +
  evidence kind), and the spec's release-task section ported to the no-migration render.

`production-image-security.spec.sh` was deliberately left byte-identical to `a3fb68cc`'s version —
half-porting a 1,900-line security contract to match code would hide this decision rather than
surface it.

## Verification

| Check | Result |
|---|---|
| `production-image-security.spec.sh` | still exit 1 — the fifth-pin assertion only |
| the 6 U5 wiring assertions + `validate-pre` + recheck-before-AWS ordering | PASS |
| `infra/security/u5-production-chain.spec.sh` | PASS |
| workflow YAML parse + step order (wait@9 → recheck@11 → aws@12) | PASS |
| `bash -n` on the new run blocks | PASS |

Not run: any real production deploy. The gate only executes with live signed artifacts, so the new
step has never run end to end — review it before the next production promotion.

## Next

1. Answer the fifth-pin question, add it, re-run the spec, push the branch.
2. Review the new step against `a3fb68cc`'s intent before any production promotion.
