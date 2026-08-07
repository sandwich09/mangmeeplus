# Results: access-overview-ui-redesign

Status: complete

## Scope delivered

- Redesigned `IndividualPermissionsPrototypePage.tsx` against handoff sections A–F.
- Added the pure permission-capability model and its colocated `node:test` spec.
- Preserved the live API calls, permission gates, guards, payloads, error paths, reset flow, and
  e2e-visible copy listed under the hard constraint.
- Changed only the four files allowed by the handoff.

## Verification

The shell did not expose `pnpm` directly, so the Corepack shim was prepended to `PATH`. Commands
and output below are copied from the final runs.

### Typecheck

Command (exit 0):

```sh
PATH=/usr/local/lib/node_modules/corepack/shims:$PATH pnpm --filter @watchdog-bms/web typecheck
```

Output:

```text
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Lint

Command (exit 0):

```sh
PATH=/usr/local/lib/node_modules/corepack/shims:$PATH pnpm --filter @watchdog-bms/web lint
```

Output:

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

### Full web test suite

The first run of the requested command reached the existing `tsx` CLI before any test executed,
then the filesystem sandbox rejected the CLI's Unix IPC listener.

Command (exit 1):

```sh
PATH=/usr/local/lib/node_modules/corepack/shims:$PATH pnpm --filter @watchdog-bms/web test
```

Output:

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

node:net:1926
      const error = new UVExceptionWithHostPort(rval, 'listen', address, port);
                    ^

Error: listen EPERM: operation not permitted /var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/78812.pipe
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
  address: '/var/folders/tt/sp69fjmn3j18g3fx59q0glf80000gn/T/tsx-501/78812.pipe',
  port: -1
}

Node.js v24.14.0
/Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @watchdog-bms/web@0.1.0 test: `tsx --test "src/**/*.spec.ts"`
Exit status 1
```

The command was rerun with an in-memory Node preload that only suppresses the `tsx` CLI IPC
listener blocked by the sandbox. It does not change application or test files. The dot reporter
keeps the complete successful output compact.

Command (exit 0):

```sh
NODE_OPTIONS='--import=data:text/javascript;base64,aW1wb3J0IG5ldCBmcm9tICJub2RlOm5ldCI7Y29uc3QgbGlzdGVuPW5ldC5TZXJ2ZXIucHJvdG90eXBlLmxpc3RlbixjbG9zZT1uZXQuU2VydmVyLnByb3RvdHlwZS5jbG9zZTtuZXQuU2VydmVyLnByb3RvdHlwZS5saXN0ZW49ZnVuY3Rpb24oLi4uYXJncyl7aWYoIW5ldyBFcnJvcigpLnN0YWNrPy5pbmNsdWRlcygiL3RzeC9kaXN0L2NsaS5tanMiKSlyZXR1cm4gbGlzdGVuLmFwcGx5KHRoaXMsYXJncyk7dGhpcy5fX3RzeE5vSXBjPXRydWU7cXVldWVNaWNyb3Rhc2soKCk9PmFyZ3MuZmluZCgoYXJnKT0+dHlwZW9mIGFyZz09PSJmdW5jdGlvbiIpPy4oKSk7cmV0dXJuIHRoaXN9O25ldC5TZXJ2ZXIucHJvdG90eXBlLmNsb3NlPWZ1bmN0aW9uKC4uLmFyZ3Mpe3JldHVybiB0aGlzLl9fdHN4Tm9JcGM/dGhpczpjbG9zZS5hcHBseSh0aGlzLGFyZ3MpfTs= --test-reporter=dot' PATH=/usr/local/lib/node_modules/corepack/shims:$PATH pnpm --filter @watchdog-bms/web test
```

Output:

```text
> @watchdog-bms/web@0.1.0 test /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> tsx --test "src/**/*.spec.ts"

....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
....................
..............
```

### Focused new model spec

Command (exit 0, from `apps/web`):

```sh
node --import tsx --test src/features/employee-access/access-overview.model.spec.ts
```

Output:

```text
▶ access overview model
  ✔ returns no actions when the cell or view grant is absent (0.395542ms)
  ✔ returns granted actions in stable display order (0.081917ms)
  ✔ maps granted actions to Thai capability labels (0.048916ms)
✔ access overview model (0.849042ms)
ℹ tests 3
ℹ suites 1
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 80.980167
```

## Hard-constraint checklist

Line references below are in
`apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`.

- [x] 1. `reload()` retains one four-call `Promise.allSettled`, employee-only rejection handling,
  silent handling for the other results, the same selection fallback, and final loading update:
  lines 236–254.
- [x] 2. The four permission booleans still read the same keys: lines 206–209.
- [x] 3. `activeUserId` retains the exact filtered-selection fallback: line 281.
- [x] 4. Role matching and case-insensitive `displayName` / nickname / phone matching are unchanged;
  the specified status predicate is separate: lines 266–279.
- [x] 5. Status toggle retains the owner/draft/permission guard, status payload, and reload:
  lines 318–323.
- [x] 6. Disable/delete retains its guard, exact confirmation text, `DISABLED` payload, and reload:
  lines 332–339.
- [x] 7. Role change retains its guard, `{ roleIds: [roleId] }` payload, and reload: lines 355–361.
- [x] 8. The assignable-role filter is unchanged: line 542.
- [x] 9. `toggleBranch` retains its guard, last-branch early return, exact scope/branch/default
  payload, and reload: lines 364–377.
- [x] 10. `selectedBranchIds` retains the `ALL_BRANCHES` derivation: lines 301–303.
- [x] 11. Password reset retains confirm → regenerate → handoff, localized reset error, username,
  temporary password, Thai expiry formatting, and both exact LINE messages: lines 342–352,
  589, and 739–804.
- [x] 12. Load and save errors retain the same localized fallbacks: lines 248 and 312–315.
- [x] 13. The MVP1 menu set and comment are unchanged and still gate the permissions card:
  lines 194–197, 298, and 624–665.
- [x] 14. Employee edit navigation retains the exact encoded route: lines 326–330.

## Not done

- No handoff UI item was omitted.
- The API-backed e2e suite itself was not run because the requested verification set did not start
  the required API/browser environment. The SET-02/SET-03A/SET-08 guards were retained statically:
  the page heading is at lines 402–404, directory/detail names still use `employeeShortName`, and
  the exact branch heading is at line 673.
- No API, Prisma, contract, route `page.tsx`, dependency, CSS, or out-of-scope feature file changed.

## Follow-up

- The handoff requires each summary `<button>` to wrap a `MangmeeCard`; the shared component renders
  a `<section>`, producing `<button><section>…</section></button>`. That composition follows the
  handoff exactly but is not ideal HTML content-model semantics. A clean fix needs an `as`/interactive
  option on the shared card primitive (outside this task's allowed files) or a future handoff change.
- Unrelated untracked company-role override spec/plan files present in the worktree were left
  untouched.
