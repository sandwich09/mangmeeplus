# Agent Memory: tailwind-source-scan-corruption

Status: Fixed (root cause confirmed by reproduction; fix verified byte-identical + live).
Owner: build/tooling lane (flagged by the e2e lane in worktree `sharp-cori-1a6e2e`).
Scope: `apps/web/app/globals.css`, `.gitignore`. No application source touched.

## Symptom

`next dev` (and any `@tailwindcss/postcss` consumer) intermittently fails to compile
`apps/web/app/globals.css`:

```
⨯ ./apps/web/app/globals.css:3327:24
Parsing CSS source code failed
  .shadow-\[var\(--\e ���\7 �e-sm\)\] { --tw-shadow: var(--  ��e-sm); }
Unexpected token Delim('\u{e}')
```

`globals.css` is 748 lines on disk and clean — the corruption is in the *generated*
stylesheet. Because `app/layout.tsx` imports it, every page breaks, so Playwright's
`webServer` readiness probe can time out and a whole e2e run executes zero tests.

## Root cause

Tailwind v4 automatic source detection scans the **entire checkout minus `.gitignore`**
and reads every non-ignored file as text.

`.gitignore` ignored `.next/` but **not** sibling dist dirs like `.next-e2e-*`. A lane
setting `NEXT_DIST_DIR=.next-e2e-3050` therefore left ~550 MB of Turbopack persistent
cache (`dev/cache/turbopack/v16.2.11/*.sst`) in Tailwind's scan path.

Those SST files are block-compressed. A repeated string becomes a back-reference token,
so the raw bytes of a real class name read as:

```
73 68 61 64 6f 77 2d 5b 76 61 72 28 2d 2d | 0e 00 af | 74 68 65 6d 65 2d 6d 64 29 5d
"shadow-[var(--"                            match tok   "theme-md)]"
```

Oxide extracts that as a candidate, and Tailwind emits it as a rule containing raw
`0x0E` / `0x00` / `0x07`. Lightningcss (Turbopack's CSS parser) then refuses it.

This is **not** a race, not concurrency, not a poisoned incremental cache, and not
dev-only — it reproduces in a standalone `postcss([tailwind()])` run with no Next.js in
the process. Production `next build` uses the same plugin and is affected identically.

The isolation workaround was the trigger: each fresh `NEXT_DIST_DIR=.next-e2e-*` dir
created *more* un-ignored scan input, so "5 of 5 fresh dirs failed" was expected.

## Fix

1. `apps/web/app/globals.css` — bound the scan to our own source:
   `@import 'tailwindcss' source(none);` + `@source '../app'; @source '../src';`
   Kills the whole class of bug regardless of artifact directory naming. (Scanning a
   few MB instead of the whole checkout should also be faster; observed timings were
   too FS-cache-noisy to quote a figure.)
2. `.gitignore` — added `.next-*/`, replacing the two hand-listed
   `apps/web/.next-customer-*-build/` entries. Also stops ~550 MB of build output
   sitting untracked in a repo whose deploys ship the dirty tree.

## Verification

- Standalone Tailwind compile, poison dir present, **before** fix: 87 control chars /
  36 broken rules — including the exact reported `--tw-shadow: var(--^N^@^@…e-sm)`.
- **After** fix, poison dir still present: 0 control chars, output **byte-identical**
  to a clean-tree baseline (124,759 chars / 5,373 lines) — nothing gained or lost.
- Re-run from a foreign cwd: still byte-identical, so `@source` resolves relative to
  the CSS file and the Docker build (different WORKDIR) is safe.
- Live `next dev` on :3070 with the poison dir present: 200 rules, 0 with control
  chars; `shadow-[var(--shadow-theme-sm)]`, `flex`, `rounded-2xl` all resolve.
- `playwright test --list`: 112 tests in 28 files, config unaffected.

## Deliberately not changed

- **Per-port `NEXT_DIST_DIR` in `playwright.config.ts`.** Tried and reverted. `next dev`
  rewrites the *tracked* `apps/web/next-env.d.ts` to point at the active dist dir, so
  every e2e run would dirty a tracked file and break `typecheck` for lanes using a
  different dir. Already visible in the main checkout, which sits modified at
  `import "./.next/verify-3004/dev/types/routes.d.ts"` from the `web-verify-3004`
  launch config. Cross-lane `.next` contention was never shown to cause the reported
  failure, so this trades a proven cost for an unproven benefit.
- **Shared `apps/api/dist`.** Real and separate: `playwright.config.ts` runs
  `pnpm --filter @watchdog-bms/api build` into one `apps/api/dist` for every concurrent
  run in a checkout, then boots `dist/apps/api/src/main.js` — a plausible source of the
  one-off `addController` / "Cannot read properties of undefined (reading 'name')" DI
  crash. Not fixed here: the path is hard-coded in the Dockerfile and deploy scripts,
  so parameterizing it is its own change with real blast radius.

## Rules for other lanes

- Need a second dev server? Use a dist dir **nested under `.next/`**
  (`NEXT_DIST_DIR=.next/verify-3004`, as `.claude/launch.json` already does).
  Never a sibling `.next-*` dir. See [[project_next16_dev_server_lock]].
- Adding a new build/artifact directory means adding it to `.gitignore` in the same
  change. Un-ignored build output is Tailwind input.
