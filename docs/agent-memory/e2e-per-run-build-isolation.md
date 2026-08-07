# Agent Memory: e2e per-run build isolation

Status: implemented and verified (not committed)
Owner: main thread (worktree `unruffled-goodall-b0b058`)
Scope: `apps/api/package.json`, `playwright.config.ts`

## Problem

`playwright.config.ts`'s API webServer runs
`pnpm --filter @watchdog-bms/api build && node apps/api/dist/apps/api/src/main.js`,
and `apps/api`'s build script emits to a single fixed `dist/apps/api/src` per
checkout. Two Playwright runs in one checkout — routine in this multi-agent repo,
and not prevented by `reuseExistingServer: !CI` — compile into that same directory
while the other run's `main.js` is still being loaded from it. Reading half-written
dist files produced a NestJS DI boot crash:
`Cannot read properties of undefined (reading 'name')` inside `addController`.

Confirmed live during this task: in the main checkout, PID 92507 was running the
webServer build into `apps/api/dist` while PID 67518 (launch.json `api-verify-3012`)
was serving `main.js` out of the same directory.

## Decisions

- Isolate per run with an env var, `API_DIST_DIR`, defaulting to `dist`. Every
  hard-coded consumer keeps working unchanged because the default is the current path.
- Put the per-run directory **under** `dist/` (`dist/e2e-<API_PORT>`), not beside it
  (`dist-e2e-<port>`). Root `.gitignore` already ignores `dist/` and `.next/`, so
  nested dirs need no gitignore change and cannot be swept into a dirty-tree deploy.
  A sibling directory would be untracked-but-not-ignored — the same trap that caused
  the Tailwind/globals.css corruption via un-ignored `.next-e2e-*` dirs
  (`docs/agent-memory/tailwind-source-scan-corruption.md`).
- Key the directory on the port, not a pid/timestamp: deterministic across reruns, so
  incremental rebuilds still work and the tree doesn't accumulate garbage dirs.
- `turbo.json` declares `outputs: ["dist/**"]`, which still covers the nested path.
- **The config sets no web dist dir at all** — this was tried, measured, and reverted.
  A concurrent pair does need separate `.next` dirs, but deriving `NEXT_DIST_DIR` per port
  inside `playwright.config.ts` is a known-bad move in this repo: `next dev` rewrites the
  *tracked* `apps/web/next-env.d.ts` to import route types from its distDir (this task
  produced `./.next/e2e-3020/dev/types/routes.d.ts` in it), a deploy ships the dirty tree,
  and it breaks typecheck for other lanes — the main checkout already sits modified from
  `web-verify-3004`. `localEnv` spreads `process.env`, so an operator-supplied
  `NEXT_DIST_DIR` already reaches both webServers with no config change; the second
  concurrent run passes it explicitly and restores the file afterwards (HANDOFF.md).
  The API side has no tracked-file side effect, so its isolation is unconditional.

## Accepted assumptions

- pnpm runs package scripts through a POSIX shell, so `${API_DIST_DIR:-dist}` expands.
  Probed directly, not assumed — see Verification.
- Nothing in `apps/api/src` resolves runtime paths via `__dirname`/`process.cwd()`
  (only three spec files do), so an extra path segment is safe.

## Scope boundaries

Blast radius kept working on the default value, unchanged:
`apps/api/Dockerfile`, `apps/api/start-production.sh`,
`apps/api/start-combined-production.sh`, `infra/prod-app-runner/deploy-api.sh`,
`infra/prod-app-runner/start-api-web-runtime.sh`, `.claude/launch.json`
(`api-built`, `api-verify-3011`, `api-verify-3012`).

## Open questions

- Residual, not fixed here: both runs also rebuild the shared `@watchdog-bms/config`
  and `@watchdog-bms/contracts` packages into one `dist` each, via plain
  `tsc -p tsconfig.json` with no `incremental`/`composite`, so every run rewrites
  those outputs. A run booting while a sibling run rewrites `packages/contracts/dist`
  is the same corruption class, on a narrower window (contracts builds early, boot
  happens late). Cheapest guard if it ever bites: add `"incremental": true` to those
  two tsconfigs so unchanged sources emit nothing.

## Artifacts

- `apps/api/package.json` — `build`, `dev`, `start`, `test:boot` honour `${API_DIST_DIR:-dist}`.
- `playwright.config.ts` — `apiDistDir` / `nextDistDir` derived from the ports, exported
  into the webServer env, and interpolated into the API boot command.

## Verification

Run in this worktree (`unruffled-goodall-b0b058`), fast-forwarded to `origin/develop`
(90291cbd) with its own `pnpm install` + `prisma generate`, so the main checkout — which had
a live Playwright run of its own — was never touched.

1. **Shell expansion is real, not assumed.**
   `API_DIST_DIR=dist/probe-a corepack pnpm --filter @watchdog-bms/api build`
   → produced `apps/api/dist/probe-a/apps/api/src/main.js`, and `apps/api/dist/`
   contained *only* `probe-a` (default path untouched).
2. **Default path unchanged.** `corepack pnpm --filter @watchdog-bms/api build`
   → `apps/api/dist/apps/api/src/main.js` present, as the Dockerfile / infra scripts /
   launch.json expect.
3. **Two concurrent `e2e/run-local.sh`, different `API_PORT`:**
   `API_PORT=3021 WEB_PORT=3020` and `API_PORT=3023 WEB_PORT=3022`, started together.
   (Run with the config deriving `NEXT_DIST_DIR` per port, before that part was reverted;
   the equivalent today is passing `NEXT_DIST_DIR=.next/e2e-<WEB_PORT>` on the command line,
   which produces the same two dirs.)
   - Separate trees created: `apps/api/dist/e2e-3021`, `apps/api/dist/e2e-3023` (57M each),
     `apps/web/.next/e2e-3020`, `apps/web/.next/e2e-3022`.
   - **Both APIs served `/v1/health` 200 simultaneously.**
   - **Zero DI crash signatures** (`Cannot read properties|addController|UnknownDependencies|
     Nest can't resolve`) across all four run logs.
   - Second pair booted through to test execution: 3 passed each.
4. **DI boot smoke on both paths** — the check that catches the original `addController` crash:
   - `API_DIST_DIR=dist/iso-a … test:boot` → `Nest resolved every provider in 857ms`, exit 0.
   - default `… test:boot` → `Nest resolved every provider in 506ms`.
   - `dist/` held `apps`, `e2e-3021`, `e2e-3023`, `iso-a` concurrently without interference.

### Not attributable to this change

The workstation was saturated by other sessions (load avg 18–25, three other Next dev
servers, another checkout's Playwright suite, 651k pageouts). Consequences seen:

- `Timed out waiting 120000ms from config.webServer` on the web server. **A single,
  non-concurrent run hit the same timeout**, which rules out both concurrency and this
  change as the cause.
- `Killed: 9` (SIGKILL under memory pressure) on both web dev servers and on run B's API
  — the kill line named `node apps/api/dist/e2e-3023/apps/api/src/main.js`, itself
  confirming the isolated path was in use. The 2 login-spec failures per run trace to
  these kills plus both runs sharing one seeded DB and one seeded OWNER.

Re-running on a quiet machine is the way to get a fully green concurrent pair; the boot
claim this task is about is already evidenced above. Note each new port pays one cold
compile, which makes the pre-existing 120s webServer budget slightly easier to hit on
first use of a port — consider raising it if that becomes routine.

## Next

- Commit (not done — no request to commit).
- `.claude/launch.json` is gitignored and local, so it was left alone. Its `api-verify-3011`
  and `api-verify-3012` entries still call `npx swc … -d dist/apps/api/src` directly and so
  collide with each other and with `api`/`api-built` — one of them (PID 67518) was half of
  the live collision observed at the start of this task. Fix per entry when convenient:
  `export API_DIST_DIR=dist/verify-<port>` and boot from `$API_DIST_DIR/apps/api/src/main.js`.
