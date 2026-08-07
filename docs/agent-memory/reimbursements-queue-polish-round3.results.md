# Results: reimbursements-queue-polish-round3

Status: Sections A–E implemented and verified. Typecheck and lint pass. The complete web test suite
passes 398/398 through the IPC-free `tsx` loader path; the repository's exact `test` script is
blocked by the managed sandbox before test discovery because the `tsx` CLI cannot open its local IPC
socket.

## Files touched

- `apps/web/src/features/expenses/ExpensesUi.tsx` — added the shared eye icon and changed `StatCard`
  to the requested icon-left, value/label-right layout.
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx` — balanced the three-card KPI grids,
  polished all queue columns/actions/scroll tracks, added displayed-value search, and wired one
  shared client-side pager across all three queues.
- `apps/web/src/features/reimbursements/reimbursements.logic.ts` — added the pure `matchesSearch` and
  clamped `pageBounds` helpers plus the shared page size.
- `apps/web/src/features/reimbursements/reimbursements.logic.spec.ts` — added all specified universal
  search and pagination edge-case tests without weakening existing coverage.
- `docs/agent-memory/reimbursements-queue-polish-round3.results.md` — records scope, parity, and real
  verification evidence.

No API, Prisma, contract, dependency, new component file, or `MangmeeStatCard` changed. Unrelated
pre-existing worktree changes were preserved.

## Required confirmations

- **API call inventory unchanged.** No reimbursement API import, call, argument, payload, or
  cancellation/duplicate-resolution value changed.
- **Load dependencies unchanged.** All four `load` callbacks still depend on `[companyId]` only.
  The three queue refresh effects remain `[load, refreshKey]`; search and paging do not trigger a
  refetch.
- **KPI source unchanged.** Every queue summary still reads unfiltered `data`. MyRequests status
  counts also still read `data`, never `filteredData` or `pagedData`.
- **Action visibility unchanged.** No row or drawer action render condition changed. Approval still
  receives the same `approvalSnapshotHash`, finance actions retain their exact status conditions and
  duplicate-resolution payload, and every row action still stops propagation.
- **Displayed-value search only.** Each queue passes exactly the values rendered in its table,
  including resolved Thai status labels. Raw rows, ids, and snapshot hashes are not searchable.
- **Pagination is a pure projection.** Every table maps `pagedData`; empty states still key off
  `filteredData`/`data`; `pageBounds` supplies the clamped displayed page, with no extra clamping
  effect.
- **Expected shared-card effect.** The expenses-list KPI row inherits the new shared `StatCard`
  layout, as required by decision D1.

An independent read-only audit found no remaining Section A–E or carried round-one invariant
deviations.

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

### Test command from the handoff

Command:

```bash
corepack pnpm --filter @watchdog-bms/web test
```

Real output (exit 1 before test discovery):

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

node:net:1926
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/84073.pipe
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
  address: '/var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/84073.pipe',
  port: -1
}

Node.js v24.14.0
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @watchdog-bms/web@0.1.0 test: `tsx --test "src/**/*.spec.ts"`
Exit status 1
```

This is the same managed-sandbox `tsx` IPC restriction recorded in rounds one and two. It occurs
before any test or application module is imported. Changing `TMPDIR` to `/tmp` produced the same
`listen EPERM`, so it is unrelated to the implementation.

The IPC-free equivalent ran the same glob and complete suite:

```bash
corepack pnpm --filter @watchdog-bms/web exec node --import tsx --test "src/**/*.spec.ts"
```

Real output summary (exit 0):

```text
ℹ tests 398
ℹ suites 107
ℹ pass 398
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 868.897333
```

The run includes all new `matchesSearch` and `pageBounds` cases.

## Could not perform

- The exact package `test` script cannot bind the `tsx` IPC socket inside this managed sandbox. No
  test failed: the complete IPC-free run passed 398/398. The package script was not changed because
  `package.json` is outside this task's strict allowlist.
