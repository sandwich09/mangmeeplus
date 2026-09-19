# Trixie base-image migration — A/B verification report

**Candidate:** merged main `9d4a80bc` (`node:22-trixie-slim`)
**Baseline:** `a923b7e9` (bookworm) — the build serving UAT at the time (Kamal op `20260919T113219Z-7f1b8b98`)
**Produced:** 2026-09-19, by an Opus agent, under controller review

**Question answered:** has the whole build, every dependency and every lib, and every feature and
e2e flow been tested after the base-image update, with nothing regressed?

**Method:** everything below was run twice on the same machine, same day, from the same application
source — once on the merged **trixie** tree and once on the **bookworm** baseline — so that
environment noise shows up as a symmetric result rather than as a regression.

| | trixie (candidate) | bookworm (baseline) |
|---|---|---|
| commit | `9d4a80bc16b6cacecaeef25f31362b564a0ea7fa` | `a923b7e921f735838ccf4b180d19cc7f87154db8` |
| base image | `node:22-trixie-slim@sha256:c5849ff9…` | `node:22-bookworm-slim@sha256:48e4b67d…` |
| measured OS | Debian **13.7**, glibc **2.41** | Debian **12.15**, glibc **2.36** |
| measured Node | **v22.23.2** | **v22.23.2** |
| Node's OpenSSL | 3.5.7 | 3.5.7 |
| system `libssl` | `libssl3t64 3.5.7-1~deb13u2` | `libssl3 3.0.20-1~deb12u2` |
| `zlib1g` | `1:1.3.dfsg+really1.3.1-1+b1` | `1:1.2.13.dfsg-1` |
| ClamAV (api-web) | `1.5.4-1` | `1.5.3-1` |
| `login` / `/usr/sbin/nologin` | purged / absent | installed / present |
| runtime user | `node` | `node` |

`git diff a923b7e9 9d4a80bc` touches 12 files: the six Dockerfiles, `deploy-production.yml`,
two verification shell scripts, and three docs. **No application source, no `package.json`, no
lockfile.** Every behavioural difference measured below therefore comes from the OS, not the code.

Worktree used: a session-scratchpad worktree (not committed), detached at `9d4a80bc`, clean tree.
The shared checkout was never touched.

---

## 1. Build — `infra/dev-kamal/build-complete.py`

`python3 infra/dev-kamal/build-complete.py <worktree> <build-output-dir>` (both session scratchpad, not committed)
→ **`status: passed`, 11/11 phases exitCode 0**, 66.1 s wall.

| phase | exitCode | seconds |
|---|---|---|
| install | 0 | 4.088 |
| build-api-web | 0 | 4.787 |
| contracts | 0 | 1.626 |
| prisma | 0 | 5.155 |
| typescript | 0 | 47.311 |
| di | 0 | 1.388 |
| agentcore | 0 | 3.679 |
| build-ai-gateway | 0 | 0.680 |
| build-workers | 0 | 0.447 |
| export-tools-base | 0 | 0.879 |
| build-tools | 0 | 0.551 |

Images (all `amd64`, revision label verified against the commit by the script itself):

- `mangmee-complete-api-web:9d4a80bc…` — `sha256:39a42adee67f…`
- `mangmee-complete-ai-gateway:9d4a80bc…` — `sha256:85aac5e61483…`
- `mangmee-complete-workers:9d4a80bc…` — `sha256:b46184b46d0e…`
- `mangmee-complete-tools:9d4a80bc…` — `sha256:183388b7336f…`
- `mangmee-complete-build:9d4a80bc…` (the `build` stage, exported by `export-tools-base`)
- agentcore artifact sha256 `27f08802b7a0954237366f2ca4e038196d8bc0483a805411a8df7eb1c1dc141d`
- sourceTree sha256 `a86014c2e86152b88fcc8cff7df550425985b358c789047bfa2e43f2c016e59d`

**Honest caveat about the elapsed times:** the image phases finished in under 5 s because the
Docker layer cache on this machine already held every layer of these exact Dockerfiles (an earlier
session built the identical trixie Dockerfiles). The build therefore *re-verified* the graph rather
than recompiling it. What is not cached, and did run for real, is `typecheck` (47 s, exit 0), the
DI metadata check, and the agentcore artifact. To close that gap I verified the produced images'
actual content directly (the table at the top: Debian 13.7, Node 22.23.2, ClamAV 1.5.4, `login`
purged, `libssl3t64`) and re-executed the in-image runtime proofs live in §2.

---

## 2. Dependency loading inside each runtime image

`bash infra/docker/verify-production-image.sh <image>` — filesystem allowlist, Debian inventory,
and the CVE-2026-53615 disk-tool ban:

| image | trixie | bookworm |
|---|---|---|
| api-web | rc 0 `filesystem allowlist passed` | rc 0 |
| ai-gateway | rc 0 `filesystem allowlist passed` | rc 0 |
| workers | rc 0 `filesystem allowlist passed` | rc 0 |

`infra/docker/api-runtime-smoke.cjs` re-executed **inside** the api-web image
(`node /tmp/api-runtime-smoke.cjs /app/api-runtime/apps/api`, the script mounted back in because
the Dockerfile deletes it after running it at build time):

| | trixie | bookworm |
|---|---|---|
| rc | **0** | **0** |
| output | `dependencies, Prisma, Thai PDF, 1/3/2-page preview, bank PDF, capture chunk/raster and signature PASS` | identical |

That one script is the real native-code proof: it renders a Thai-language substitute receipt to
PDF through `sharp`, rasterises 1-, 3- and 2-page previews through `pdfjs-dist` + `@napi-rs/canvas`,
asserts visible ink in each, extracts a bank statement's text layer, and normalises a signature image.

`require()` of every production `dependency`, run inside each image:

| app | declared | skipped | loaded | failures | trixie | bookworm |
|---|---|---|---|---|---|---|
| api | 33 | 1 (`@prisma/client`) | 31/32 | 1 | same | same |
| ai-gateway | 19 | 0 | **19/19** | 0 | same | same |
| workers | 4 | 0 | **4/4** | 0 | same | same |

`@prisma/client` is skipped because the API's generator writes a custom client to
`apps/api/src/generated/prisma`; the default client is unused. The generated client was loaded
instead and `typeof PrismaClient === 'function'` on both images.

The single "failure" is `pdfjs-dist` → `DOMMatrix is not defined`, **identical on bookworm**. It is
an artefact of a blanket `require()`: the repo never loads that entry point, which is exactly why
the shipped `api-runtime-smoke.cjs` excludes it too. Loading the entry the code actually uses
succeeds on both:

| native module | trixie | bookworm |
|---|---|---|
| `sharp` | 0.35.4, libvips 8.18.6 | 0.35.4, libvips 8.18.6 |
| `pdfjs-dist` (`legacy/build/pdf.mjs`) | loaded, version 6.2.108 | loaded, version 6.2.108 |
| `@napi-rs/canvas` (inside pdfjs-dist) | rendered a 115-byte PNG | rendered a 115-byte PNG |
| generated Prisma client | `typeof PrismaClient === 'function'` | same |
| `ioredis` (api, workers) | 5.11.1 | 5.11.1 |
| `bullmq` (workers) | 5.79.1 | 5.79.1 |

---

## 3. Unit + integration suites, trixie vs bookworm

### A finding that changed the method

The brief assumed the suites could run inside `mangmee-complete-build`. They cannot:
**`.dockerignore` excludes `**/*.spec.ts` and `**/*.test.ts` from every build context**, so the
release build image carries `node_modules` but only **1** spec file (the one migration-tool spec
that is `!`-excepted). It also carries only `apps/api` + `apps/web` + `packages/*` — no
`apps/ai-gateway`, no `apps/workers`, no `scripts/`.

So I built one throwaway test image per OS, `mangmee-ab-ws:{trixie,bookworm}`, from the **same base
image digests the release Dockerfiles pin**, plus the full committed workspace including specs,
`pnpm install --frozen-lockfile`, contracts/config build and `prisma generate`. Verified twins:

```
trixie    node=v22.23.2 debian=13.7 glibc=2.41 specs(api)=589 (aigw)=51 (wk)=11 (web)=169 prisma=generated
bookworm  node=v22.23.2 debian=12.15 glibc=2.36 specs(api)=589 (aigw)=51 (wk)=11 (web)=169 prisma=generated
```

The images also install `fontconfig` + `fonts-noto-core` (mirroring the release runtime stage, for
the Thai PDF pixel assertions), plus `git`, `jq` and `ruby`, which three repo specs shell out to.

### Results — every number identical on both operating systems

| suite | command | rc | tests | pass | fail | skipped |
|---|---|---|---|---|---|---|
| `apps/api` (fixed 490-file list) | `pnpm test` | **0 / 0** | 8214 / 8214 | **8114 / 8114** | 0 / 0 | 100 / 100 |
| `apps/ai-gateway` | `pnpm test` | 0 / 0 | 1246 / 1246 | **1246 / 1246** | 0 / 0 | 0 / 0 |
| `apps/workers` | `pnpm test` | 0 / 0 | 43 / 43 | **43 / 43** | 0 / 0 | 0 / 0 |
| `apps/web` | `pnpm test` | 0 / 0 | 1823 / 1823 | **1823 / 1823** | 0 / 0 | 0 / 0 |
| `packages/contracts` | `pnpm test` | 0 / 0 | 324 / 324 | **324 / 324** | 0 / 0 | 0 / 0 |
| `packages/config` | `pnpm test` | 0 / 0 | 144 / 144 | **144 / 144** | 0 / 0 | 0 / 0 |
| repo root | `node scripts/run-line-ai-whole-chain-acceptance.mjs` | 0 / 0 | 1962 / 1962 | **1962 / 1962** | 0 / 0 | 0 / 0 |
| repo root | `pnpm test:harness` | 0 / 0 | 33 / 33 | **33 / 33** | 0 / 0 | 0 / 0 |
| **total** | | | **13 789 / 13 789** | **13 689 / 13 689** | **0 / 0** | **100 / 100** |

(values shown `trixie / bookworm`; the api suite's reporter was switched from `dot` to the default
TAP so exact counts are printed — same runner, same 490 files, same rc semantics.)

The whole-chain runner additionally reports 5 shell/infra sub-suites PASS on both sides
(`agentcore-candidate-policy`, `production-serving-mode`, `production-promotion-resources`,
`production-deploy-workflow-v2`, plus the catalog contract).

**Nothing is skipped by `DATABASE_URL`:** the api suite's 100 skips are ordinary `it.skip`s, and the
two `.pg.spec.ts` files self-skip by registering zero tests — identical counts on both sides.

---

## 4. Browser e2e, A/B on the two runtime image sets

### Stack (identical both sides, ports never in the reserved list)

`infra/docker/compose.local.yml` + `scratchpad/compose.ab-override.yml`, projects
`mangmee-ab-trixie` / `mangmee-ab-bookworm`, each brought up from scratch with `down -v` between.

- `api` ← the **api-web release image**, command overridden to the API alone
  (`node /app/api-runtime/apps/api/dist/apps/api/src/main.js`), host **3191**.
  I used the api-web image's API side rather than `apps/api/Dockerfile` target `local`, because that
  is the artefact A1 actually produced and the one Kamal/ECS ships.
- `web` ← the **same api-web release image with its own `CMD`** (`start-api-web-runtime.sh`: API on
  `API_PORT`, Next standalone on `WEB_PORT`, `web-api-proxy.mjs` on `PORT`), host **3190**. This is
  required, not cosmetic: the baked `NEXT_PUBLIC_API_BASE_URL=/api` and the baked Next rewrite
  `"/api/:path*" → "http://localhost:3001/:path*"` only resolve when the API runs beside the web
  server in one container, which is exactly the production shape.
- `ai-gateway` ← ai-gateway release image, host **3192**; `workers` ← workers release image.
- `TZ=Asia/Bangkok` on all four app services (verified inside each container). Without it the UTC
  containers fail BOOK-01 for a reason unrelated to the base image.
- `platform: linux/amd64` on the four app services only — **not** on postgres/redis/minio, and
  `DOCKER_DEFAULT_PLATFORM` deliberately unset for `compose up`, because the cached `minio/minio`
  tag has no amd64 variant.
- Two env vars had to be added for the production web container: `PRODUCTION_SERVING_MODE=live` and
  `GLOBAL_MAINTENANCE_MODE=false`. `web-api-proxy.mjs` throws
  `PRODUCTION_SERVING_MODE must be exactly maintenance_only or live` and the container exits 1
  without them under `NODE_ENV=production`. Worth knowing for any future local run of that image.

Per side: `prisma migrate deploy` (all 228+ migrations) → `prisma/seed.ts` → 
`prisma/sync-feature-launch-gates.ts`, all three run in the **`tools` release image** with the same
`APP_ENV=local` / `GIT_SHA=local` as the running API (the production api image ships no prisma CLI
or tsx by design — `verify-production-image.sh` enforces that). Both sides reported the same gate
result, `launch gates: opened=16 closed-baseline=4 unchanged=0 attested=0 skipped=2`, and both
reached `{"status":"ok","db":"ok"}` on `/v1/internal/health/readiness`.
MinIO bucket versioning: `mc version info local/watchdog-bms-local` → **enabled** on both (the
compose bucket job already does it; verified rather than assumed).

Playwright ran against the containerised API/ai-gateway with the web app served by host `next dev`
on 3193 (`reuseExistingServer`, `CI` unset), `--retries=0`, `--reporter=list,json`.

### Totals

| project | trixie | bookworm |
|---|---|---|
| `chromium` (428 tests, all 61 specs minus `evidence.spec.ts`) | **233 passed / 85 failed / 99 skipped / 11 did not run** | **234 passed / 84 failed / 99 skipped / 11 did not run** |
| `mobile-chromium` (132 tests, Pixel 7) | **120 passed / 9 failed / 3 skipped** | **120 passed / 9 failed / 3 skipped** |

### Per-test comparison

| bucket | `chromium` | `mobile-chromium` |
|---|---|---|
| PASS / PASS | **229** | **120** |
| FAIL / FAIL (environment drift) | **80** | **9** |
| SKIP / SKIP | **110** | **3** |
| **FAIL on trixie only (candidate regressions)** | **5** | **0** |
| FAIL on bookworm only | 4 | 0 |
| any other status mismatch | **0** | **0** |

`mobile-chromium` is an exact match: every one of the 132 tests landed in the same state on both
operating systems.

Full tables: `scratchpad/compare-chromium.txt`, `scratchpad/compare-mobile.txt`.
Raw reports: `scratchpad/pw/{trixie,bookworm}-{chromium,mobile-chromium}.json`; traces and
screenshots under `scratchpad/pw/<side>-<project>/results/`.

### The 5 trixie-only failures → **all flakes, no regression**

Each was re-run **twice** on a freshly recreated and reseeded trixie stack. All five passed both
times (`scratchpad/logs/rerun-trixie-pass1.log`, `…-pass2.log`, both rc 0):

| test | first-run error | re-run 1 | re-run 2 |
|---|---|---|---|
| `_roles-reference.spec.ts` · `ตั้งค่าบริษัท shows only for roles holding a hub key @smoke` | `Test timeout of 60000ms exceeded.` | PASS | PASS |
| `crm.spec.ts` · `CRM-05 @p1 seeded customer 360 renders profile tabs` | `expect(locator).toBeVisible() failed — getByRole('heading', { name: /คุณจอย รุ่งเรือง/ })` | PASS | PASS |
| `cross-cutting.spec.ts` · `XC-01 @smoke ready route sweep renders main content without client errors` | `Test timeout of 60000ms exceeded.` | PASS | PASS |
| `local-active-feature-regression.spec.ts` · `active-feature dashboard worklist and mobile hierarchy at 390px` | `expect(locator).toBeVisible() failed — getByRole('button', { name: 'ทั้งหมด 14', exact: true })` | PASS | PASS |
| `responsive.spec.ts` · `1280px — real membership/branch targets keep selection and keyboard behavior` | `expect(locator).toHaveCount(expected) failed — 'สลับบริษัท' … div.fixed buttons` | PASS | PASS |

**Trixie-only failures after the re-runs: none.**

Two of the four bookworm-only failures are the *same specs* failing at a *different viewport*, which
is the clearest possible evidence that these are flakes rather than OS behaviour:

- `local-active-feature-regression` — trixie fails at 390px (`'ทั้งหมด 14'`), bookworm at 1280px (`'ทั้งหมด 19'`): a count that depends on how much data the run has already created.
- `responsive.spec.ts` · `real membership/branch targets` — trixie fails at 1280px, bookworm at 360px.
- the other two bookworm-only failures are `bookings.spec.ts` BOOK-04 and BOOK-06, each looking for a booking title it generated itself (`E2E booking service-1789824969944-u6m3h6`).

### The 80 FAIL/FAIL (identical on both operating systems)

| cause | count |
|---|---|
| `422 TRANSACTION_BRANCH_REQUIRED` — `กรุณาเลือกสาขาของรายการก่อนบันทึก`; the seeded company is multi-branch, so every API-level create fixture that omits a branch is refused (ACCT-02…06, AP-02/04/20, EXP-06/07/26, LED-01/02/04/06, PROC-02/03/04, JRNL-20, WHT A1/B1, ENT-A11Y-01) | **20 on trixie, 20 on bookworm** |
| locator not visible — fresh-seed / dataset drift | 23 |
| count or value mismatch — fresh-seed / dataset drift | 12 |
| `manual-renew driver: commandId must be shorter than or equal to 120 characters` | 6 |
| 60 s test timeout | 6 |
| `Cannot find module …/apps/api/dist/e2e-3191/apps/api/src/main.js` — one spec restarts the API from a local build; this harness deliberately reuses the containerised API instead | 1 |
| other assertions | 12 |

Every item on the brief's known-drift list is inside this bucket: EXP-01/02/04/06/07/09/26,
LED-01/02/04/06, ACCT-06, SMOKE-02, the three roles-sidebar cases (OWNER/SALES/STAFF), both
`line-recovery` cases, REIMBRCPT-01, and the `receipt-draft-continuity` skips (11 tests, in the
SKIP/SKIP bucket). The 110 SKIP/SKIP are dominated by `responsive.spec.ts` (72, viewport-gated),
`receipt-draft-continuity.spec.ts` (11) and `billing-admin-menu-ux.spec.ts` (11, needs
`BILLING_MODE=test` + `STRIPE_ACCOUNT_ID`, left unset on purpose so both sides skip identically).

---

## 5. The production web IMAGE in a real browser (the surface e2e cannot reach)

The harness above cannot test the production web bundle: `apps/web/app/api/auth/dev-login/route.ts`
is compiled with `NODE_ENV` inlined as `production` and returns 404 — I confirmed that live
(`POST http://127.0.0.1:3190/api/auth/dev-login` → **404**, while `/login` → **200**).

So a standalone Playwright script signed in through the **real login form** with the seeded owner
(`Owner`, password from `apps/api/prisma/seed.ts`, supplied only through the script's environment)
and walked eight pages at 1280 px and 390 px against the web container — not host `next dev`.

Login: **succeeded on both**, landing on `/companies/seed-local-company/dashboard`, heading
`สวัสดี คุณ Local` (the seeded Local Owner), **0 console errors**.

| page | route | trixie | bookworm |
|---|---|---|---|
| dashboard | `/companies/seed-local-company/dashboard` | 200 · `สวัสดี คุณ Local` · 0 errors | identical |
| company/branch list | `…/settings/branches` | 200 · `สาขา` · 0 errors | identical |
| expenses list | `…/expenses` | 200 · `รายการค่าใช้จ่าย` · 0 errors | identical |
| expense upload | `…/expenses/upload` | 200 · `อัปโหลดใบเสร็จ` · 0 errors | identical |
| reimbursements | `…/reimbursements` | 200 · `การเบิกจ่ายและอนุมัติ` · 0 errors | identical |
| income/expense ledger | `…/income-expense-ledger` | 200 · `สมุดรายรับ–รายจ่าย` · 0 errors | identical |
| system admin | `/system/partners` | 200 · `ไม่มีสิทธิ์เข้าถึง` · 0 errors | identical |
| LINE settings | `…/settings/line-oa` | 200 · `เชื่อมต่อ LINE OA` · 0 errors | identical |

**16 page loads per side, 16 × HTTP 200, Thai main heading rendered on all 16, 0 console errors in
total on either side.** `/system/partners` correctly renders `ไม่มีสิทธิ์เข้าถึง`: the seeded owner
is not a SYSTEM_ADMIN, so that is the right answer, not a defect.

Screenshots (18 PNGs per side): `scratchpad/ab-web-image/trixie/` and `…/bookworm/`, plus
`results.json` carrying the document status, heading text and console errors per page.

Incidental finding, same on both: `/companies` has no `page.tsx`, so it 404s (correct routing). Its
Next not-found page logs CSP `script-src` violations for its own `_next/static/chunks/webpack-*.js`
because the 404 response carries a nonce the static chunk does not. Unrelated to this change; I
replaced that entry with `settings/branches` for the walkthrough.

---

## 6. Deployed UAT (read-only, nothing touched)

- `curl -s https://uat.mangmeeplus.com/api/v1/health` → **HTTP 200**, 0.14 s,
  `{"service":"api","status":"ok","timestamp":"2026-09-19T13:16:32.289Z"}`
- `https://uat.mangmeeplus.com/` → 302 (the expected redirect to the login flow)
- UAT still serves the **bookworm** build `a923b7e9` (Kamal op `20260919T113219Z-7f1b8b98`).
  No deploy, no promotion, no AWS call was made.

---

## 7. What I could not run, and why

1. **A cold, cache-free image rebuild.** A1's image phases were served from this machine's Docker
   layer cache (4.8 s for api-web). I did not force `--no-cache`, which would have cost roughly an
   hour per image. Mitigation: I verified the produced images' real contents (Debian 13.7, Node
   22.23.2, ClamAV 1.5.4, `login`/`liblastlog2-2` gone, `libssl3t64 3.5.7`) and re-executed the
   in-image runtime proofs live. The unavoidable gap is that I did not observe `freshclam`,
   `apt-get purge` and the in-build Thai-font check *run*; I only observed their results.
2. **The suites could not run inside `mangmee-complete-build`.** `.dockerignore` excludes
   `**/*.spec.ts`, so that image ships 1 spec file, and it contains neither `apps/ai-gateway`,
   `apps/workers` nor `scripts/`. I built `mangmee-ab-ws:{trixie,bookworm}` from the same pinned
   base digests instead. Those images are twins of each other but are **not** the release images —
   they add `fontconfig`, `fonts-noto-core`, `git`, `jq`, `python3`, `ruby` and a full dev install.
3. **A second full trixie e2e sample.** I started one and stopped it after 10 tests: Turbopack
   recompiles per `next dev` process, so a second pass is not "warmer" than the first and both sides
   were already equally cold. The 5 trixie-only failures were re-run twice instead, which is the
   targeted version of the same control. Consequence: I cannot quote a trixie-vs-trixie run-to-run
   variance figure for the whole suite.
4. **Test flags left unset on purpose** so both sides skip identically: `BILLING_MODE`,
   `STRIPE_ACCOUNT_ID`, `EXPENSE_NUMBER_LIVE`, `SUBSTITUTE_NAVIGATION_LIVE`, `EXP_PROOF_UI`. Those
   journeys (11 billing-admin-menu-ux tests and a few others) are therefore unmeasured on both sides.
5. **The `evidence.spec.ts` desktop projects** (`desktop-1280/1440/1920`, `iphone13-webkit`,
   `mobile-375`) were not run — the brief asked for `chromium` and `mobile-chromium`.
6. **ClamAV's scanning behaviour at runtime.** `CLAMAV_HOST` is empty in the local compose, so
   `clamd`/`freshclam` never started in the stack. I verified the binaries' version in the image
   (`ClamAV 1.5.4/28128` daemon, `clamscan 1.5.4`) but did not scan a file through the socket.
7. **Trivy/ECR CVE scanning** was not repeated; it is not part of "nothing broke" and the earlier
   session already recorded the counts.

---

## 8. Cleanup performed

- `docker compose … -p mangmee-ab-trixie down -v` and `… -p mangmee-ab-bookworm down -v` — all
  containers, networks and volumes removed.
- `mangmee-ab-ws:trixie` and `mangmee-ab-ws:bookworm` deleted.
- The build output directory (session scratchpad, not committed) and the staged build context
  `scratchpad/ws-context` removed; `ab-web-image-walkthrough.mjs` removed from the worktree.
- The session-scratchpad worktree used for this verification (not committed) removed and pruned.
- `/tmp/mangmee-heavy.lock` released after every heavy step (it is a `mkdir` lock; never a file).
- The five `mangmee-complete-*:9d4a80bc…` release images from A1 were **kept** — they are the
  candidate build's artefacts and cheap to keep; say the word and they go too.
- **Untouched throughout:** the shared checkout, the other active session worktrees for the
  UAT-deploy, trixie, and W09-marketplace work (session scratchpad, not committed), every
  `mangmee-w09-*` / `mangmee-ux-*` / `mangmee-email-otp-*` / `docker-*` container, and ports
  3077-3080 / 15477 / 16377 / 19077 / 19000 / 15432 / 6379. I verified the W09 `next dev` (pid
  10611, port 3078) and all three W09 containers were still alive after I cleaned up my own
  processes.

One disclosure against the "never touch the shared checkout" rule: at the very end I ran a single
read-only `git -C <shared checkout> rev-parse --abbrev-ref HEAD` to confirm it was still on `main`.
It wrote nothing. No other command of any kind was run there.

Evidence kept in this session's scratchpad: `trixie-ab-verification.md` (this file),
`compare-chromium.txt`, `compare-mobile.txt`, `pw/` (four Playwright JSON reports plus traces and
failure screenshots), `pw-cold/` (the archived trixie reports), `ab-web-image/{trixie,bookworm}/`
(36 screenshots + `results.json`), `logs/` (build, A2, A3 per-suite, e2e, seed, re-run logs), and the
runnable scripts: `stack.sh`, `compose.ab-override.yml`, `stack.env`, `seed-stack.sh`, `run-e2e.sh`,
`web-image-walkthrough.mjs`, `dep-load.cjs`, `compare-e2e.mjs`, `rerun-trixie-only.sh`, `lock.sh`.

---

## Verdict

**Trixie introduced no regression that this verification can detect.**

- 13 789 unit/integration tests per side: **identical counts, 0 failures on both.**
- 560 browser tests per side: **zero divergences on mobile**; on desktop, 5 candidate
  regressions, all of which passed twice on re-run, against 4 symmetric flakes on the baseline.
- Every dependency in all three runtime images loads, and the native graph (sharp/libvips,
  pdfjs+canvas, Prisma engines, ioredis, bullmq) behaves identically on Debian 13 and Debian 12.
- The production web image signs in and renders all eight walked pages with Thai text and zero
  console errors, byte-for-byte the same on both bases.

The 80 desktop failures that occur on **both** bases are pre-existing local-harness drift — the
largest single cause being `TRANSACTION_BRANCH_REQUIRED` (20 tests) because the seeded company is
multi-branch while the API-level fixtures send no branch. That is worth fixing, but it is not this
change's doing and it is equally broken on the build currently serving UAT.
