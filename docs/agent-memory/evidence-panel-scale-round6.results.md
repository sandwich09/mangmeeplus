# Results: evidence-panel-scale-round6

Status: Sections A–D implemented and verified.

## Files touched

- `apps/web/src/common/table/paging.logic.ts` — added the single shared `pageBounds` implementation and its default page size.
- `apps/web/src/common/table/paging.logic.spec.ts` — moved the five existing pagination boundary assertions into the shared helper suite unchanged.
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` — replaced the local paging implementation with compatibility re-exports so existing reimbursement imports continue to work.
- `apps/web/src/features/reimbursements/reimbursements.logic.spec.ts` — removed only the migrated `pageBounds` import and test block; all other reimbursement tests remain intact.
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` — added table and folder projections/pagers plus the specified table and compact folder empty states.
- `docs/agent-memory/evidence-panel-scale-round6.results.md` — recorded scope confirmations and real verification output.

## Required confirmations

- `pageBounds` now has exactly one implementation:

  ```text
  apps/web/src/common/table/paging.logic.ts:4:export function pageBounds(...)
  ```

  `reimbursements.logic.ts` re-exports that function and aliases `DEFAULT_PAGE_SIZE` as
  `QUEUE_PAGE_SIZE`. The existing reimbursement import in `ReimbursementsPages.tsx` is unchanged,
  and its three previous call sites still resolve at lines 501, 1040, and 1198.
- The evidence table body maps `pagedRows`; its empty state still keys off
  `visibleRows.length === 0` and keeps `colSpan={10}`.
- Table pager actions use `bounds.page`, and folder pager actions use `folderBounds.page`; neither
  pager uses its raw page state for previous/next calculations.
- Folder pagination applies only to `view.folders` at 12 items per page. The `ทั้งหมด` control stays
  outside the paged list, and the glyph buttons have `หน้าก่อนหน้า` / `หน้าถัดไป` labels.
- Table page resets only for `yearMonth`, `attentionOnly`, and `view.dateField`. Folder page resets
  only for `view.dateField`, not `yearMonth`.
- Paging remains a pure client-side projection. The `load` callback and dependency array remain
  unchanged:
  `[companyId, dateField, yearMonth, taxEvidenceStatus, sourceDocumentType]`.
- No fetch call, filter expression, export behavior, heading, column, or column order changed. The
  table still has exactly 10 headers.
- A read-only scoped review found no behavior, TypeScript/React, stale-page, accessibility, or
  preservation issue. Pre-existing dirty edits in the scoped files were preserved.

## Verification

### Typecheck

Command:

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
```

Real output (exit 0):

```text
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Lint

Command:

```bash
corepack pnpm --filter @watchdog-bms/web lint
```

Real output (exit 0):

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Test

Command:

```bash
corepack pnpm --filter @watchdog-bms/web test
```

The first unmodified launch was blocked before test discovery because the managed sandbox forbids
the `tsx` 4.22.4 CLI's Unix IPC listener:

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

node:net:1926
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/92536.pipe
    at Server.setupListenHandle [as _listen2] (node:net:1926:21)
    at listenInCluster (node:net:2005:12)
    at Server.listen (node:net:2127:5)
    at file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:53:31537
    at new Promise (<anonymous>)
    at createIpcServer (file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:53:31515)
    at async file:///Users/bombam/Documents/WatchDog/WatchDog-BMS/node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/cli.mjs:55:459 {
  code: 'EPERM',
  errno: -1,
  syscall: 'listen',
  address: '/var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/92536.pipe',
  port: -1
}

Node.js v24.14.0
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 test: `tsx --test "src/**/*.spec.ts"`
Exit status 1
```

Changing `TMPDIR` to `/private/tmp` produced the same `listen EPERM`, confirming that the failure was
the sandbox's IPC restriction rather than a repository or test failure.

The literal package test command was then rerun with a temporary script-shell shim that replaced
only the blocked `tsx` CLI launcher with the IPC-free equivalent,
`node --import tsx --test "src/**/*.spec.ts"`. The glob and test workload were unchanged. The shim
was replaced by this report and left no extra repository file.

Real final output summary (exit 0):

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

ℹ tests 404
ℹ suites 109
ℹ pass 404
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1070.70075
```

The passing run includes the new shared `pageBounds` suite (3 cases / 5 unchanged assertions) and
the complete reimbursement logic suite.

## Not completed

Nothing requested in Sections A–D or the verification scope was omitted. The only workaround was
for the sandbox-blocked `tsx` IPC launcher described above; the complete web suite passed 404/404.

---

## Independent verification (main thread, 2026-07-28)

`typecheck` → pass. `test` → **404 pass / 0 fail** (exact package scripts, no shim needed outside the
Codex sandbox).

| Claim | Verified |
|---|---|
| `pageBounds` has exactly one implementation | only `common/table/paging.logic.ts:4` defines it |
| Reimbursements call sites still resolve | `reimbursements.logic.ts:113` re-exports `pageBounds` + `DEFAULT_PAGE_SIZE as QUEUE_PAGE_SIZE`, so no consumer changed |
| `<tbody>` maps `pagedRows`; empty state keys off `visibleRows.length` | L528 / L520 |
| Clamped page drives both pagers | table L570/L573 use `bounds.page`; folders L502/L505 use `folderBounds.page` |
| `ทั้งหมด` is not paginated away | rendered at L490, outside `pagedFolders.map` at L491 |
| Paging is absent from every fetch dependency array | the only page effects (L439–L440) reset page state; no fetch dep mentions page/bounds |
| Empty states | table uses shared `EmptyState` with a context-aware description; folder list uses a compact icon+text block sized for the 220px rail |

### Not verified
- No visual check. The table pager, the compact `‹ / ›` folder pager, and both empty states have not
  been seen rendered.
