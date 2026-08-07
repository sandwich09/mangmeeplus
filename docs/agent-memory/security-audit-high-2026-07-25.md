# Agent Memory: security-audit-high-2026-07-25

Status: Done — merged via PR https://github.com/MangmeeDev/mangmeeplus/pull/33 into `develop`

Owner: main thread

Scope: Clear the 9 high advisories failing `pnpm security:audit` (`pnpm audit --prod --audit-level=high`, CI job `security-audit` in `.github/workflows/ci.yml:110`). Dependency manifests + lockfile only; no application code changed.

## Advisories and root cause

| Advisory | Package | Root cause | Fix |
| --- | --- | --- | --- |
| GHSA-6gpp-xcg3-4w24, GHSA-m99w-x7hq-7vfj, GHSA-89xv-2m56-2m9x, GHSA-p9j2-gv94-2wf4 | `next` 16.2.10 | Lockfile behind the patch release (`^16.2.10` already permitted 16.2.11) | `apps/web` floor raised to `^16.2.11`; lockfile → 16.2.11 |
| GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 | `postcss` 8.5.10 | **Our own exact-pin override.** `next` pins `postcss: 8.4.31`; the root override `"postcss": "8.5.10"` (from `bb077e8b`, foundation scaffolding) held it below the patched 8.5.18 | Override changed from exact pin `8.5.10` to floor range `^8.5.18`; lockfile → 8.5.23. Same change in `apps/web` devDependency |
| GHSA-f88m-g3jw-g9cj | `sharp` 0.34.5 (libvips CVE-2026-33327/33328/35590/35591) | `next` declares `sharp: ^0.34.5` as an optionalDependency; no patched 0.34.x exists, so the caret can never reach the fix | New root override `"sharp": "^0.35.3"` (out of next 16.2's declared range — see verification below) |
| GHSA-v2hh-gcrm-f6hx, GHSA-4c8g-83qw-93j6 | `fast-uri` 3.1.2 | Stale transitive resolution. `ajv@8.20.0` already declares `fast-uri: ^3.0.1` and 3.1.4 is published | `pnpm update -r --depth Infinity fast-uri` → 3.1.4. **No override added** — upstream range already allows the fix |

## Decisions

- Overrides now use floor ranges (`^8.5.18`), not exact pins. The exact `postcss` pin is what re-introduced the vulnerability; pinning a security fix to an exact version guarantees it rots.
- `sharp` override is deliberately out of next 16.2's declared `^0.34.5`. Next 16.3.0-preview.9 declares `sharp: ^0.35.3`, so the 0.35 API is what upstream itself moves to. Verified empirically rather than assumed (below).
- `js-yaml: 4.3.0` and `multer: 2.2.0` overrides left as exact pins — currently clean, out of scope. They carry the same rot risk.
- **Did not** bump `prisma`/`@prisma/client` to 7.9.0. It would not clear the remaining moderates (`@prisma/dev@0.24.14` still pulls `valibot@1.2.0`), and a Prisma minor bump is a larger blast radius than this fix warrants.

## Remaining moderates (3, below the `--audit-level=high` gate)

`@hono/node-server` ×2 and `valibot` ×1, all via `@prisma/client → prisma (optionalDependency "*") → @prisma/dev`.

These do **not** ship to production: `apps/api/Dockerfile:23` installs prod deps with `pnpm install --frozen-lockfile --prod --no-optional --filter @watchdog-bms/api...`, so the `prisma` CLI and `@prisma/dev` are excluded from the runtime image. `pnpm audit --prod` does not model `--no-optional`, so it reports them anyway. Same applies to the `fast-uri` chain — fixed regardless, since it is present in the CI/dev tree.

By contrast `sharp` **is** shipped: confirmed traced into `apps/web/.next/standalone/node_modules/.pnpm/sharp@0.35.3…`, and `/_next/image` is served unauthenticated by the standalone server, so the vulnerable libvips was reachable attack surface in prod.

## Artifacts

- `package.json` — overrides: `postcss` → `^8.5.18`, added `sharp` → `^0.35.3`
- `apps/web/package.json` — `next` → `^16.2.11`, `postcss` devDep → `^8.5.18`
- `pnpm-lock.yaml` — only 5 resolution changes: `next` 16.2.10→16.2.11, `postcss` 8.5.10→8.5.23, `sharp` 0.34.5→0.35.3, `fast-uri` 3.1.2→3.1.4, `nanoid` 3.3.15→3.3.16 (pulled by postcss 8.5.23)

## Verification

| Check | Result |
| --- | --- |
| `pnpm security:audit` | exit 0 — 9 high → 0 high (3 moderate remain, below gate) |
| `pnpm install --frozen-lockfile` | exit 0 — lockfile consistent with manifests (this is what CI and both Dockerfiles run) |
| `pnpm -r --if-present typecheck` | 7/7 projects Done, 0 errors |
| `pnpm -r --if-present test` | exit 0 — 2978 pass / 0 fail (api 2180, ai-gateway 415, web 297, config 55, contracts 24, workers 7) |
| `turbo run build --filter=@watchdog-bms/web` | succeeded on next 16.2.11 + postcss 8.5.23 + sharp 0.35.3 |
| sharp native load | `sharp 0.35.3 / libvips 8.18.3`, WebP encode OK |
| next image optimizer through sharp 0.35.3 | `GET /_next/image?url=/assets/line/mangmeeplus-staff-menu-2500x843.png&w=256&q=75` → `200 image/webp`, 2.1 MB PNG → 3050 B WebP at 256×86. This is the check that the out-of-range sharp override is safe |
| Tailwind v4 through postcss 8.5.23 | `@tailwindcss/postcss` compiled `app/globals.css` → 124759 bytes with preflight |
| Cross-platform sharp binaries in lockfile | all `@img/sharp-{linux,linuxmusl,darwin,win32}-*@0.35.3` + `@img/sharp-libvips-*@1.3.2` present; no `0.34` refs left, so Docker `--frozen-lockfile` on `node:22-bookworm-slim` resolves |

Not run: the API image's `pnpm install --prod --no-optional --filter` path and a full Docker image build. Reason: this checkout is a shared worktree with concurrent sessions and a `--prod` install would destroy the dev `node_modules`. `--frozen-lockfile` consistency is verified, which is the failure mode that path would hit.

## CI observations found while opening the PR

**PR #33 will not get CI checks, and that is expected.** `.github/workflows/ci.yml:40` declares:

```yaml
  pull_request:
    branches: [main]
```

`branches:` filters on the *base* branch, so CI only runs for PRs targeting `main`. PRs into `develop` (this one, and #31 before it) get no checks; the gate fires on the `push` trigger after merge. The audit gate was therefore verified locally with the exact CI command plus `pnpm install --frozen-lockfile`. Widening the filter to `[main, develop]` would give PR-time coverage — not done here, out of scope.

**`develop` has a second, unrelated red job.** Run 30155124934 (2026-07-25 10:48) failed two jobs: `Security Audit` (fixed by this branch) and `Production Config Validation`. The latter is not touched by this work:

```
✗ accepts valid production fixture: Production config validation failed:
  - AI_ACTOR_DELEGATION_SIGNING_KEY is required in production
13 checks: 12 passed, 1 failed
```

Cause: `85943a0c fix(security): bind AI tools to actor delegations` (PR #32, merged 10:48) made `AI_ACTOR_DELEGATION_SIGNING_KEY` required in production (`packages/config/src/index.ts:277,294`) but did not add it to the valid-production fixture in `scripts/validate-prod-config.ts`. Merging this PR turns `Security Audit` green; `Production Config Validation` stays red until that fixture is updated.

`develop` is 4 commits ahead of this branch's base (PR #32), but none of them touch `package.json`, `pnpm-lock.yaml`, or `apps/web/package.json` — no conflict.

## Next

1. Merge PR #33. CI verifies on the post-merge push to `develop`, not on the PR itself (see above).
2. Separately fix the `AI_ACTOR_DELEGATION_SIGNING_KEY` fixture gap in `scripts/validate-prod-config.ts`, or CI stays red for a reason unrelated to this work.
3. On deploy, rebuild both images — the web image is the one that actually carries the sharp/next/postcss fixes.
4. When bumping Prisma next, re-check the 3 moderates; they clear only when `@prisma/dev` ships `valibot >= 1.4.2` and `@hono/node-server >= 2.0.5`.
