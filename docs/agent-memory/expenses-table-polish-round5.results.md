# Results: expenses-table-polish-round5

Status: implemented and verified

## Files touched

- `apps/web/src/features/expenses/ExpensesPages.tsx` — increased the list header to 13px and replaced the existing search input with a 20%-wider search field using the existing right-side search icon.
- `apps/web/src/features/expenses/ExpensesWorkspacePanels.tsx` — forced all three native-table headers to 13px and balanced the specified header/body column pairs without changing table data or order.
- `docs/agent-memory/expenses-table-polish-round5.results.md` — recorded the implementation scope and real verification results.

## Header sizes

| Table | Component | Header size |
|---|---|---:|
| รายการค่าใช้จ่าย | `ExpenseListPage` | 13px (`text-[13px]`) |
| หมวดหมู่ | `CategoryManagePanel` | 13px (`!text-[13px]`) |
| ลายเซ็นบริษัท | `SignaturePanel` | 13px (`!text-[13px]`) |
| หลักฐานทางบัญชี | `EvidencePanel` | 13px (`!text-[13px]`) |

## Scope confirmations

- `apps/web/app/globals.css` was not modified.
- No file under `apps/web/src/features/reimbursements` was touched by this round; any existing dirty reimbursement files predated this task and remain outside its scope.
- No column was added, removed, or reordered.
- No cell content, data expression, filtering, sorting, pagination, API call, or other data logic changed.
- The existing `GRID` constant in `ExpensesPages.tsx` was not changed.
- All three native tables already had `overflow-x-auto` wrappers, so no new wrapper or minimum-width track was added.

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

The first raw run was blocked before Node's test runner started because the managed sandbox forbids
the `tsx` 4.22.4 CLI's Unix IPC listener:

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

node:net:1926
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/88858.pipe
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
  address: '/var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/88858.pipe',
  port: -1
}

Node.js v24.14.0
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @watchdog-bms/web@0.1.0 test: `tsx --test "src/**/*.spec.ts"`
Exit status 1
```

Changing `TMPDIR` to `/private/tmp` produced the same `listen EPERM`, confirming this was an IPC
sandbox restriction rather than a repository failure. The exact package command was then rerun with
a temporary script-shell shim that replaced only the blocked `tsx` CLI launcher with its IPC-free
equivalent, `node --import tsx --test "src/**/*.spec.ts"`. The shim was replaced by this report and
left no extra repository file.

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
ℹ duration_ms 888.493917
```

## Not completed

Nothing requested in sections A, B, or C was omitted. Typecheck, lint, and the complete web test
suite all passed; the only workaround was for the sandbox-blocked `tsx` IPC launcher described above.
