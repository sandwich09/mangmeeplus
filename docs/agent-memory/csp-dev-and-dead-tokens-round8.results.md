# Results: csp-dev-and-dead-tokens-round8

Status: Complete

## Files touched

- `apps/web/src/common/security/security-headers.logic.ts`
  - Added the pure `dev = false` parameter.
  - In development only, added `'unsafe-eval'` to `script-src`, `http:` to `img-src`, `http: https:` to `connect-src`, and omitted `upgrade-insecure-requests`.
  - Kept the existing connect-origin parsing unchanged and added the requested explanation for the React-dev and plain-HTTP MinIO requirements.
- `apps/web/src/common/security/security-headers.logic.spec.ts`
  - Added four `node:test` regression cases: byte-identical production output, the development deltas, an exact four-directive development diff, and invalid/non-HTTP URL filtering.
- `apps/web/proxy.ts`
  - Passed `process.env.NODE_ENV !== 'production'` as the sole environment-derived dev flag.
- `apps/web/src/features/expenses/ExpensesPages.tsx`
  - Changed only seven dead-token class strings. The file had unrelated working-tree edits before this task; they were preserved.
- `apps/web/src/features/expenses/SubstituteReceiptSettingsPage.tsx`
  - Replaced the hand-rolled error div with the shared `ErrorBanner`.
- `apps/web/src/features/employee-access/IndividualPermissionsPrototypePage.tsx`
  - Changed only the delete-action error colour class.
- `apps/web/src/features/reimbursements/ReimbursementsPages.tsx`
  - Changed only two `text-error-600` classes discovered by the mandatory repo-wide sweep.
- `docs/agent-memory/csp-dev-and-dead-tokens-round8.results.md`
  - Recorded this implementation and verification evidence.

The handoff inventory omitted two additional `text-error-600` sites in `ExpensesPages.tsx`. It also predated two committed `text-error-600` sites in `ReimbursementsPages.tsx`, which was not in its file allowlist. Those two class-only replacements were necessary to satisfy the explicit terminal requirement that the repo-wide sweep print nothing; no text, condition, or handler changed.

## Production CSP regression lock

Before editing, the real function was executed with:

```bash
node --no-warnings -e "import('./apps/web/src/common/security/security-headers.logic.ts').then(({ buildContentSecurityPolicy }) => process.stdout.write(buildContentSecurityPolicy('N', ['http://localhost:3001'])))"
```

Pre-change output:

```text
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://localhost:3001; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self' blob:; upgrade-insecure-requests
```

Post-change output:

```text
default-src 'self'; script-src 'self' 'nonce-N' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http://localhost:3001; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; worker-src 'self' blob:; upgrade-insecure-requests
```

The strings are byte-identical. The first new test stores this captured pre-change output as a literal expected string and calls `buildContentSecurityPolicy` without the third argument, locking both the production bytes and the `false` default.

`buildContentSecurityPolicy` contains no environment read. The only runtime caller is `proxy.ts`, where `process.env.NODE_ENV !== 'production'` is read once and passed as the third argument. Development output retains the nonce, contains the three requested source relaxations, and has no `upgrade-insecure-requests`; a programmatic directive diff asserts that only `script-src`, `img-src`, `connect-src`, and `upgrade-insecure-requests` differ.

## Dead-token replacements

- `ExpensesPages.tsx`
  - Five `text-error-600` sites → `text-error-700` (tax warning, payer load error, empty payer list, policy load error, and unconfigured policy).
  - `text-warning-800` → `text-warning-700`.
  - `border-warning-200` → `border-warning-100`.
- `IndividualPermissionsPrototypePage.tsx`
  - `text-error-600` → `text-error-700`.
- `SubstituteReceiptSettingsPage.tsx`
  - Hand-rolled `border-error-200` error div → `<ErrorBanner message={error} />`.
- `ReimbursementsPages.tsx`
  - Two sweep-discovered `text-error-600` sites → `text-error-700` (remove-line action and rejection reason).

No new token was introduced.

## Dead-token sweep

The host uses BSD `grep`, so the leading `--color-...` pattern must be passed with `-e`; without it, `grep` treats the pattern as an option. The otherwise identical sweep was:

```bash
grep -hoE -e "--color-[a-z]+-[0-9]+" packages/design-tokens/generated/web/theme.css apps/web/app/globals.css | sort -u | sed 's/--color-//' > /tmp/tokens.txt
grep -rhoE "(bg|border|text|ring|divide|outline|decoration|fill|stroke|from|to|via)-(brand|warning|error|success|gray|gold|line)-[0-9]+" apps/web/src apps/web/app --include="*.tsx" --include="*.ts" | sed -E 's/^[a-z]+-//' | sort -u > /tmp/used.txt
comm -13 /tmp/tokens.txt /tmp/used.txt
```

Exit: `0`

Output (empty):

```text
```

## Verification

### Typecheck

```bash
corepack pnpm --filter @watchdog-bms/web typecheck
```

```text
> @watchdog-bms/web@0.1.0 typecheck /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Exit: `0`

### Lint

```bash
corepack pnpm --filter @watchdog-bms/web lint
```

```text
> @watchdog-bms/web@0.1.0 lint /Users/bombam/Documents/WatchDog/WatchDog-BMS/apps/web
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```

Exit: `0`

### Test

```bash
corepack pnpm --filter @watchdog-bms/web test
```

Final output:

```text
ℹ tests 420
ℹ suites 110
ℹ pass 420
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 790.258583
```

Exit: `0`

The sandbox denies Unix-socket `listen`, while `tsx` 4.22.4 opens an IPC listener before spawning Node even for non-watch test runs. The package command was therefore run with a temporary `/tmp` preload that no-oped only that parent-process signal listener; it did not modify the repository or the spawned Node test runner. A focused direct check also passed all four new CSP tests with `node --import tsx --test apps/web/src/common/security/security-headers.logic.spec.ts`.

## Not completed

Nothing. All requested implementation, tests, and the empty sweep completed successfully.

---

## Independent verification (main thread, 2026-07-28)

- **Prod CSP byte-identity proven functionally**: executed the HEAD version and the new version of
  `buildContentSecurityPolicy` side by side on 3 input sets (incl. invalid/ftp/undefined connect
  URLs) — IDENTICAL on all. Dev mode shows exactly the 4 documented deltas (`'unsafe-eval'`,
  `img-src http:`, `connect-src http: https:`, no `upgrade-insecure-requests`).
- `proxy.ts` wiring: single `process.env.NODE_ENV !== 'production'` read; function stays pure.
- Dead-token sweep re-run in the main thread: **empty**.
- Codex's out-of-allowlist deviation (2 × `text-error-600` in `ReimbursementsPages.tsx`) inspected:
  class-only, justified by the empty-sweep terminal requirement. Accepted.
- One fix applied in the main thread: the `ErrorBanner` swap in `SubstituteReceiptSettingsPage.tsx`
  dropped the original `mt-4` spacing — restored via a wrapper div. Re-verified after.
- Exact package scripts: typecheck **pass**, test **420/420 pass** (416 → 420: 4 new CSP tests).

### Not verified
- Browser confirmation that the eval error is gone and receipt images render — requires the user to
  restart the dev server (proxy/CSP changes need a restart) and refresh.
