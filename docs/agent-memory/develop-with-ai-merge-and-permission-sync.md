# Agent Memory: develop merge + UAT permission sync

Status: PR open — https://github.com/MangmeeDev/mangmeeplus/pull/61 (base `develop`, head `20260728`)
Owner: Claude
Scope: merge 82 commits from `origin/develop`, resolve 17 conflicts, extend
`prisma/sync-permissions.ts` so the two new expense keys reach existing company roles.

## Decisions

- **`expense_auto_post` added to `FEATURE_CATALOG`.** `develop` added the key to the
  hardcoded `APPROVED_FEATURE_KEYS` while this branch made that list derive from the catalog.
  Either side alone drops it, and without a catalog entry the Partner toggle cannot be rendered
  or set, so auto-posting could never be enabled. No submenus — it is background behaviour.
- **Evidence panel merged, not picked.** Kept the 9-column redesign and folded in the posting
  column, post/JV action cell, `postingStatus` filter and backfill button. Their `attentionOnly`
  checkbox dropped: `flagFilter` already has an `attention` chip, and the stat card now drives
  that same state so the card and chip row cannot disagree.
- **`COMPANY_ROLE_BACKFILLS` registry.** A `Role` stores materialized `RolePermission` rows and
  does not persist its capability-pack selection, so a permission added to a pack can never reach
  a role created earlier — there is nothing to recompile from. Each entry carries an anchor
  permission proving the role came from the same pack.
- **`expense.delete` anchored on `expense.void`, not granted universally.** It is CRITICAL and
  destroys a draft permanently, so it lands only on roles already holding its sibling in
  `pack.expense.finance`.

## Open questions

- Whether `expense.delete` should be backfilled at all, or left for the operator to grant
  deliberately per company. Current choice: backfill, anchored — it restores pack intent rather
  than widening anyone. Reversible by removing the entry (removing it stops future backfills; it
  does not revoke what was already granted).

## Artifacts

- `apps/api/src/modules/employee-access/domain/registries/company-role-backfill.registry.ts`
- `apps/api/prisma/sync-permissions.ts`
- `apps/api/src/modules/employee-access/domain/logic/capability.logic.spec.ts` (anchor invariants)
- `packages/contracts/src/feature-entitlements.ts` (`expense_auto_post`)
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` (merged evidence panel)

## Verification

Merged tree, API run alone (`line-message-buffer.service.spec.ts` flakes under CPU contention):

- `contracts` + `config` build: pass
- API suite: 0 failures
- web: 520 pass / 0 fail · ai-gateway: 507 pass · config: 100 pass
- `config:validate`: 37/37
- API typecheck: pass (needed `prisma generate` — the merge brought four migrations)
- web typecheck + production build: pass
- `sync-permissions.ts` typechecks and loads; fails only at DB connect against an unreachable host

Not run: UI/E2E. Nothing here has been exercised against a running stack.

## Next

1. Merge PR #61 into `develop`.
2. Deploy UAT with `deploy-uat.yml` (`workflow_dispatch`), `release_ref` = the resulting merge
   commit SHA (lowercase, full) or a `uat-*` tag on it. `resolve-production-release-ref.sh`
   rejects any ref that is not an ancestor of `origin/develop`, so the merge must land
   first.
3. The release task runs `migrate deploy` then `sync-permissions.ts` automatically — no manual
   permission step. Confirm the run log line `Company-role backfills:` shows non-zero counts for
   `expense.evidence.read` on a tenant that uses custom roles.
4. Then verify on UAT: the หลักฐานทางบัญชี menu is visible to an existing custom role, and
   attaching a receipt on a reimbursement draft returns 200.
