# Agent Memory: Unblock UAT deploy CI (2026-08-07)

Status: UAT is deployed and healthy on `5dec5bcd` — all three services running 1/1. Three open
items remain, all listed under "Still open": prod Redis at 100%, the wrong maxmemory-policy on both
clusters, and the retention fix (`9bb78ed6`) not yet shipped.

Owner: Opus 5 (this session), 2026-08-07.

Scope: `UAT Deploy` of `origin/develop` tip `f0332e04` failed CI
([run 31141322429](https://github.com/MangmeeDev/mangmeeplus/actions/runs/31141322429)) in three
jobs — Security Audit, Typecheck and Test, Production Image (api-web). The `Deploy` job was skipped,
so UAT was never mutated and stays on `c015de63` from 2026-08-05.

## Decisions

- **`expense.confirm` missing from the expenses menu binding** (`packages/contracts/src/menu-entitlements.ts`)
  was the one production defect, not a spec problem. At the last green commit `3282d758` both
  `MENU_ENTITLEMENT_BINDINGS[expenses].gatePermissions` and
  `WORKSPACE_MODULES[expenses].requiredAnyPermissions` held the same 7 keys. `expense.confirm` was
  later added to the module side only, so `WORKSPACE_MODULES stays aligned with menu entitlement
  bindings` failed. Fixed by adding it to the binding: a pure approver holds only that permission,
  and without it the expenses module hides and the substitute-receipt submenu it gates
  (`web-core-workspace.logic.ts:223`) becomes unreachable.
- **`expense.read_own` was claimed by two catalog submenus** (`expenses.list` and
  `expenses.substitute_receipt`), breaking the one-owner-per-permission invariant asserted by
  `apps/api` `feature-gate.logic.spec.ts`. `featureKeyDeniedByEntitlement` resolves a permission
  through `SUBFEATURE_RULES.find(...)` — first match wins — so the `expenses.substitute_receipt`
  claim never gated anything. Removed it from that submenu; runtime behaviour is unchanged.
- **Four spec updates, not code changes**, for the ใบรับรองแทนใบเสร็จ feature (`265f8578`), whose
  author verified 27 targeted web specs rather than the full suite:
  - `settings-menu.logic.spec.ts` gained the `ตั้งค่าใบรับรองแทนใบเสร็จ` card.
  - Its wizard test now asserts `accounting-tax-setup` is absent instead of pinning an empty menu —
    `company.setup.manage` legitimately owns the new card, and the old assertion would re-break on
    every unrelated always-on card.
  - `web-core-workspace.spec.ts` gained the `expenses.substitute_receipt` submenu (a solo owner
    reaches it on `expense.read_own` alone — that is the intended gate, not a leak).
  - `system-partners.logic.spec.ts` gained `expenses.signatures`, which `265f8578` deliberately made
    sellable again ("the signatures page gets its own entry back so it does not become unreachable")
    even though its nav entry stays hidden by the 2026-08-05 owner decision.
- **Security advisories** cleared with the override pattern already in the repo: root
  `pnpm.overrides` `js-yaml` `4.3.0` → `4.3.1`, and `apps/api` `pdfjs-dist` `^6.1.200` → `^6.2.108`.
  Both are dependency-version edits, the one `package.json` change AGENTS.md allows.
- **api-web Docker build** (`apt-get install fonts-noto-core fontconfig`, exit 100) was initially
  written off as incident fallout. That was wrong — see the third pass below. It is a real,
  deterministic defect and had never built, on CI or locally.

## Second pass — sweep and the substitute-receipt entitlement (same day)

A cross-check of every pair of lists that must mirror each other (nav ↔ `FEATURE_CATALOG` ↔
`MENU_ENTITLEMENT_BINDINGS` ↔ the API permission registry) found **one** real defect repo-wide.
Zero permissions referenced anywhere are missing from the registry, and zero nav top-level keys lack
a binding. The two large mismatch lists are structural, not bugs: the nav builds sub-items for only
four modules (`employees`, `expenses`, `roles`, `settings`) while the catalog carries 18 features'
worth of purchasable sub-features for the partner UI, and settings/roles use a different naming
scheme (`settings.*` vs `company_settings.*`, `roles.*` vs `employee_access.*`).

The defect: disabling `expenses.substitute_receipt` disabled nothing. `expense.review` and
`expense.confirm` were stripped, but `expense.read_own` survived because `expenses.list` owns it, so
both the nav entry and `GET /companies/:companyId/substitute-receipts` — which carries
`@RequireAnyPermission('expense.review','expense.confirm','expense.read_own')` and no
`assertFeatureEnabled` — kept working. Dropping `expense.read_own` from the gate was not an option:
SALES, INVENTORY, MARKETING and STAFF hold it without review/confirm and are exactly the payers the
feature exists for.

Owner's ruling: ใบรับรองแทนใบเสร็จ rides along with บิล/ใบเบิก — whoever can work an expense can work
its substitute receipt. So it should never have been a separately-sellable sub-feature. Removed its
`FEATURE_CATALOG` submenu and its `STARTER_FEATURE_KEYS` entry. All four capability packs holding
those permissions (`pack.expense.view/self/review/finance`) are keyed to the parent `expenses`
feature, so the permissions now fall through to it — turning `expenses` off turns the whole thing
off, which is the intended behaviour.

`apps/web` gained a guard for the invariant that had none: a submenu must never be revealed by a
permission another submenu owns. Verified both ways — it fails on the pre-fix catalog with
`expenses.substitute_receipt is revealed by expense.read_own, owned by expenses.list`, and passes
after.

## Open questions

- `FEATURE_CATALOG` still sells `expenses.signatures` while `web-core-workspace.logic.ts` renders no
  nav entry for it (feature-disabled by owner decision 2026-08-05). A company can buy a sub-feature
  it cannot reach. Documented as deliberate in both files; flagged as a product question, not changed.

## Artifacts

- `packages/contracts/src/menu-entitlements.ts`, `packages/contracts/src/feature-entitlements.ts`
- `apps/web/src/features/web-core-workspace/{settings-menu.logic,web-core-workspace}.spec.ts`
- `apps/web/src/features/system-partners/system-partners.logic.spec.ts`
- `package.json`, `apps/api/package.json`, `pnpm-lock.yaml`

## Verification

Run on the host, 2026-08-07:

- `pnpm test` → exit 0. web 741/741, ai-gateway 518/518, contracts 99/99, config 117/117,
  workers 15/15, api pass.
- `pnpm typecheck` → exit 0.
- `pnpm security:audit` → exit 0 (6 moderate, 0 high).
- `api test:m01` 35/35, `test:p1` 23/23, `test:boot` resolved every provider.
- `infra/docker/production-image-security.spec.sh` pass, `pnpm config:validate`,
  `api prisma:validate`, `api migration:review` all exit 0.
- `infra/ai-gateway/build-agentcore-artifact.sh` → `sha256=8428872b22512f21b98d0c90b5af2542badedbd839600c0d1c256b60f2ef8f4f`.
- Five of six production images build locally. `api-web` did **not** — see the third pass.
- Not run locally: the trufflehog secret scan (tool absent).

## Third pass — the api-web image never built at all

The second UAT dispatch (run 31144781668) put every fixed job green — Security Audit, Typecheck and
Test, Secret Scan, Migration Review, Production Config Validation — and failed on `Production Image
(api-web)` alone, the same step as before.

It was never transient. The earlier "builds locally" claim came from reading the wrong exit code: the
build ran in a compound command and the reported status belonged to the trailing `tail`, not to
`docker build`. The local log had failed with the identical error the whole time.

Root cause, two lines apart in `infra/api-web/Dockerfile.api-web`: the ClamAV layer ended with
`apt-get purge -y --allow-remove-essential perl-base`, and the very next `RUN` installed
`fonts-noto-core fontconfig`. `fontconfig-config`'s postinst runs `ucf`, a Perl script, so dpkg
failed with exit status 127 (command not found) and apt returned 100. Fixed by moving the purge to
the end of the font layer instead of the ClamAV layer — the final image is byte-for-byte equivalent
in what matters, and both properties were checked on the built image: `perl: absent`,
`NotoSansThai-{Regular,Bold}.ttf` present, `fc-list` finds 2 Thai faces, and
`infra/docker/verify-production-image.sh` reports `filesystem allowlist passed`.

Two local-only obstacles hit on the way, neither a code defect: `node_modules` was stale against the
lockfile (`pdf-lib` unresolvable until `pnpm install`), and the generated Prisma client predated the
`approvalMode`/`payee*` schema fields (`prisma generate` fixed 13 TS errors). CI installs and
generates fresh, which is why it saw neither. `apps/workers` `retry-schedule.spec.ts` is timer-flaky
on this Mac (pass 0/0/1 over three runs) but is 15/15 in CI — not chased.

## Fourth pass — the ECR scan gate

With the dpkg ordering fixed, run 31145498921 built all six images and published ai-gateway and
workers, then failed api-web at `Enforce ECR vulnerability policy`:

```
ERROR: ECR scan gate rejected watchdog-bms-api@sha256:d9e8a95a… critical=0 high=1
```

`infra/docker/verify-ecr-scan.sh` is fail-closed at zero CRITICAL and zero HIGH, with no allowlist.
The font layer added by `a47ae8f6` pulled in nine packages, and api-web is the only image carrying
any of them — ai-gateway and workers, both of which passed the gate, have neither `libexpat1` nor
`libpng16-16`. `libexpat1 2.5.0-1+deb12u2` carries CVE-2024-28757 and CVE-2025-59375, both
CVSS 7.5 `AV:N/AC:L/PR:N/UI:N/A:H`, and Debian 12 ships no fixed version — `apt-cache policy` inside
the image reports Candidate identical to Installed, so upgrading is not an option. (The exact CVE
ECR flagged could not be read directly: this workstation has no AWS credentials.)

The fix is that the Debian `fontconfig` package was never needed. sharp 0.35.3 loads
`@img/sharp-libvips-linux-x64`, whose `libvips-cpp.so.8.18.3` names no external fontconfig, expat,
freetype, png, pango or cairo — it statically links them. The distro packages contributed nothing but
their dependency chain. Installing `fonts-noto-core` alone and writing a three-line
`/etc/fonts/fonts.conf` by hand drops `libexpat1`, `libpng16-16`, `libfontconfig1`, `libfreetype6`
and `fontconfig` from the image.

Proven, not assumed: the same Thai SVG (`ใบรับรองแทนใบเสร็จ` at 40px through
`sharp(svg, {density}).png()`, the exact path `substitute-receipt-pdf.logic.ts` uses) rasterises to
**11189 dark pixels in both images** — the original with fontconfig and the stripped one. The
hand-written `fonts.conf` also silences the `Fontconfig error: Cannot load default config file`
warning that the bare-fallback variant emitted. `verify-production-image.sh` still passes.

## Fifth pass — the deploy reached AWS and left UAT mixed

Run 31146571215 cleared every gate: all CI jobs, all six images, all three ECR publishes (the scan
gate passed, so removing the fontconfig chain was the right call), and the digest manifest. It then
ran `Deploy UAT/all` for ~25 minutes and failed at `Deploy immutable UAT manifest`.

**UAT is in a mixed state and needs an operator decision:**

- Database **migrated** — `20260806100000_substitute_receipt_approval_mode` and
  `20260807100000_substitute_receipt_payee_identity` applied, permission sync wrote 335 permissions /
  12 roles / 1280 grants, workflow templates and Thai address master synced, entitlement
  normalization ran dry-run only (`total=0 planned=0`).
- `api-web` → `deployment=SUCCESSFUL` on `5dec5bcd`.
- `ai-gateway` → `deployment=SUCCESSFUL` on `5dec5bcd`.
- `workers` → `ROLLBACK_SUCCESSFUL`; it is back on the previous revision.
- Launch-build retirement ran in `reconcile` mode and retired 16 routes of `c015de63`.
- Release operation `346328c0-3f4c-467f-9a16-12b3bc121e2c` finished `FAILED_CONFIRMED`.
- `Verify active UAT digest and health` was skipped, so no health check ran for any service.

The workers containers failed their rollout and ECS rolled back. `deploy.sh` reports only the ECS
deployment status — no `stoppedReason`, no container logs — so the cause is in CloudWatch and
unreachable from this workstation, which has no AWS credentials. Next diagnostic step for someone who
does: `bash infra/prod-ecs-express/logs.sh workers`, or `aws ecs describe-tasks` against cluster
`watchdog-bms-uat` for the stopped tasks of service-deployment `c50Vqske0ugFJKl5MMdRg`.

Booting `apps/workers`'s image locally proves nothing about this: with no environment it exits 1 on
its own config validation (`APP_ENV`, `SERVICE_NAME`, `DATABASE_URL` required), which is expected.

## Sixth pass — why workers died, and the deploy landing

`EssentialContainerExited exit=1`, and the container log named it:

```
IMPORTANT! Eviction policy is volatile-lru. It should be "noeviction"
ReplyError: OOM command not allowed when used memory > 'maxmemory'
```

Every worker started, then died on its first BullMQ command. Not the release: `apps/workers`,
`packages/config` and the workers Dockerfile are unchanged since `c015de63`, `js-yaml` is not in the
workers dependency tree, and `pdf-lib`/`pdfjs-dist` are api-only. api-web and ai-gateway deployed
fine on the same release because they do not drive queues.

Root cause: only `scan-worker` ever set `removeOnComplete`/`removeOnFail`. The other six queues drive
nineteen repeating jobs, and BullMQ keeps completed and failed records forever by default, so UAT's
400 MB Redis held **270,576 keys** at 100% memory. `volatile-lru` can only evict keys with a TTL and
job keys have none, so nothing could be freed.

Targeted deletion was impossible: the `watchdog-bedrock-dev` IAM user has `elasticache:Modify*` and
CloudWatch/ECS read access but no `ecs:RunTask`, so nothing could reach Redis inside the VPC. With
the owner's explicit approval, `watchdog-bms-uat-redis` node `0001` was rebooted instead
(`SnapshotRetentionLimit=0`, so a reboot wipes) — 05:16:07Z→05:18:09Z, taking it from 100% to 2%,
403 MB to 7 MB, 270,576 keys to ~124. `watchdog-bms-uat-workers` went from 1/2 to 2/2 immediately,
which is the proof the OOM was the cause. Rate-limit counters, the actor-delegation replay store and
AI budget meters were cleared with it; all are transient and rebuild themselves.

Run 31150340613 then went green end to end — 19/19 jobs. Verified against AWS, not just the workflow:
all three services report running 1/1 with 0 pending, and all three carry
`GIT_SHA=5dec5bcd0b33312591aadffbe67017a2da8a1e12`.

The durable fix is `9bb78ed6`: all seven queues now build through `createQueue`, the only place
allowed to call `new Queue` and the only place that knows the retention numbers, guarded by
`apps/workers/src/common/queue.spec.ts`. **That spec is not wired in** — the workers `test` script
names its files individually and AGENTS.md forbids `package.json` script edits, so adding
`src/common/queue.spec.ts` to it is the owner's one-line call.

## Still open

- **Prod Redis is also at 100%.** `watchdog-bms-workers` sits at `desiredCount=0`, so nothing is
  crashing there, but the memory is already consumed and the same code fills it.
- **`maxmemory-policy` is `volatile-lru` on both clusters.** BullMQ needs `noeviction`. Both use
  `default.redis7`, which cannot be edited — this needs a custom parameter group, and the dev IAM
  user cannot even read parameter groups.
- **Retention is deployed only once `9bb78ed6` ships.** UAT Redis is refilling at ~17 keys/min, so
  the 270k that filled it returns in roughly 11 days.

## Next

1. ~~Add `src/common/queue.spec.ts` to the workers `test` script.~~ Done — the owner directed the
   `package.json` script edit that AGENTS.md otherwise forbids. Workers now run 17 tests, not 15.
2. Ship the retention fix to UAT before UAT Redis refills, roughly 11 days out. Push
   `develop` — this Mac has no push credentials — then
   `gh workflow run deploy-uat.yml --ref main -f release_ref=<sha> -f target=all -f run_m01_acceptance=false`.
   Watch runner assignment within ~3 min and cancel rather than waiting out the 15-minute queue
   timeout if GitHub Actions is degraded again.
3. Decide on prod: its Redis is already at 100% with workers at `desiredCount=0`. Turning them on
   before the retention fix ships there reproduces the UAT failure exactly.
4. Move both clusters off `default.redis7` onto a custom parameter group with
   `maxmemory-policy=noeviction`, which is what BullMQ requires.
