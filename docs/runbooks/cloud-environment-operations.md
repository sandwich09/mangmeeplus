# Cloud Environment Operations — start, stop, inspect, and what it costs

สร้าง 2026-08-07; ตรวจ live ล่าสุด 2026-08-15 | ทุกตัวเลขและสถานะในเอกสารนี้ **อ่านจาก AWS จริง** ไม่ได้อ่านจากโค้ด
บริบทเต็มของเหตุการณ์ที่ทำให้เกิดเอกสารนี้: `docs/agent-memory/aws-cost-spike-2026-08.md`

เอกสารนี้มีไว้ให้ agent ตัวถัดไป **ไม่ต้องไล่โค้ดซ้ำ** เพื่อตอบคำถามว่า "ตอนนี้อะไรรันอยู่ ปิดยังไง
เปิดยังไง ดูตรงไหน และอะไรที่หลอกตา" ถ้าตัวเลขในเอกสารขัดกับ AWS ให้เชื่อ AWS แล้วมาแก้เอกสาร

Account `311414082667`, region `ap-southeast-1` ทั้งหมด — ไม่มี resource ในภูมิภาคอื่นเลย (สแกนแล้ว 7 region)

---

## Hotfixes 2026-09-30 afternoon — signup constraint and promotion poster (current)

After this section, UAT and Production both serve `main` `7b1b1c11`. Every run used the local Kamal path from a clean `main` controller worktree, and GitHub workflow IDs are `NOT_DISPATCHED`. Times are Bangkok.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20260930T075925Z-c2ca32d0` (prepared by `1c2365fd`, 150 s) | `2d3202e6` (signup hotfix, #929 twin = develop `76fe8766` via #930: migration `20260930150000_signup_discovery_source_sales`. The signup form's "เซลล์ของมั่งมี" source `SALES` was refused by check constraint `CompanySignupRequest_discovery_source_check`; the owner reported 5 errors at 14:40–14:41) | ACCEPTED_LINE_DEFERRED 15:04, smoke (owner urgency), 2 SSM sessions closed. Preflight `20260930T080458Z-d06e2152` PREFLIGHT_PASSED_NO_DEPLOYMENT (31.1 s). | 320.6 |
| Production | `20260930T080539Z-c0fec60b` | `2d3202e6`, promoted from UAT `c2ca32d0` with no rebuild, after preflight `d06e2152` | ACCEPTED_LINE_DEFERRED 15:13, website ready 15:11:24 (345.4 s), acceptance written 15:12:58. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally; 4 SSM sessions closed. It applied migration `20260930150000`; nothing else changed since `e52c151a`, as the owner asked. | 484.6 |
| UAT | `20260930T083206Z-0c27be3d` (prepared by `7c5fb548`, 300 s) | `7b1b1c11` (promotion-poster hotfix, #931 twin = develop `994acf5e` via #932: the rich-menu "โปรโมชั่น" reply sends the owner's package poster `apps/web/public/assets/line/package-poster-20260930.png` before the card, and the "ให้ทีมงานติดต่อกลับ" button is removed) | **FAILED** 15:38 before any mutation: "UAT pre-mutation budget exceeded; reuse the exact validated --prepared-build". `publish-and-pull` took 307.5 s, so pre-mutation work reached 365.8 s against the 360 s cap. No lock or `active.json` was left behind; 2 SSM sessions closed. | 368.2 |
| UAT | `20260930T083847Z-867eb170` (prepared by `7c5fb548`, 300 s; the same prepared build as `0c27be3d`) | `7b1b1c11` | ACCEPTED_LINE_DEFERRED 15:43, smoke, 2 SSM sessions closed. `publish-and-pull` took 22.4 s and pre-mutation work 70.2 s. Preflight `20260930T084354Z-3d7d675e` PREFLIGHT_PASSED_NO_DEPLOYMENT (27.9 s). | 294.4 |
| Production | `20260930T084428Z-be573e55` | `7b1b1c11`, promoted from UAT `867eb170` with no rebuild, after preflight `3d7d675e` | ACCEPTED_LINE_DEFERRED 15:55, website ready 15:52:46 (497.6 s), acceptance written 15:54:19. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally; 4 SSM sessions closed. No migration. The poster URL returned 200 `image/png`, 265474 bytes, before login. | 634.2 |

**The hotfix path refuses migrations and non-source files.** `deploy-prod-hotfix` rejects schema changes: `infra/kamal/README.md` says "hotfix mode requires an unchanged catalog". Its path allowlist (`infra/kamal/release_source.py`) accepted only application `src/` files (ts, tsx, js, jsx, css), e2e specs and `docs/`, so both fixes went through UAT and `promote-prod`. A controller change that allows `apps/web/public/assets` images on the hotfix path was in progress on 2026-09-30; the owner wants future posters to ship that way.

**The UAT pre-mutation budget.** The apply stops before any mutation when pre-mutation work passes 360 s, and a slow `publish-and-pull` (307.5 s on `0c27be3d`) tripped it. The documented fix is to re-run the apply with the same `--prepared-build`: the layers are already pushed, so `867eb170` needed only 22.4 s for that phase. This is not a duplicate dispatch to discover a new error.

**Owner-directed speed on a critical fix.** The owner said "ไม่ต้องตรวจแล้ว ต้องขึ้นเลย", so the controller's 17-step check was stopped after step 08 (typecheck passed). The migration was proven instead on a throwaway Postgres 18.3: the old rule refuses `SALES`, and the new rule accepts `SALES` and still refuses bad values. UAT then applied the migration before Production.

**Poster file names are versioned.** LINE and Cloudflare cache images by URL, so a new poster needs a new file name; the current one is `package-poster-20260930.png`.

---

## Release 2026-09-29 night to 2026-09-30 morning — UAT rounds 7–11 and Production

After this section, UAT and Production both serve `main` `e52c151a`. Every run used the local Kamal path from a clean `main` controller worktree, and GitHub workflow IDs are `NOT_DISPATCHED`. Times are Bangkok.

- Round 7 used `--uat-browser-acceptance`, with the owner typing the credentials themselves in the Claude built-in browser.
- Rounds 8–11 used `--uat-smoke-acceptance` (customer-acceptance kind `owner_authorized_uat_config_readiness_smoke`), with no admin login. The owner authorised it for rounds 8 and 9 while asleep and chose it for round 10; round 11, the urgent photo fix, kept that choice.
- The Production release used `--production-browser-acceptance`, with the owner signing in personally. The owner first reviewed the list of changes since the previous Production release and then gave an explicit go.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20260929T151224Z-ddc79adc` (prepared by `0b833881`, 216 s) | `b72cab2f` (main-only hotfix #906 carrying #905: LINE text-note draft key) | ACCEPTED_LINE_DEFERRED 22:18, website ready 22:16:38 (253 s), browser acceptance written 22:17:49 with the owner signing in personally, 2 SSM sessions closed. **Not promoted**: the owner's LINE test created the draft with no category, and the owner held Production until the category fix. | 347.3 |
| UAT | `20260929T171047Z-d88af0f2` (prepare only) | `4244add6` (#913 twin = develop `8cafabcc`) | PREPARED_NO_DEPLOYMENT 00:17 on 09-30. Never applied: superseded so that #914 PDF categories could ride along. | 410.0 |
| UAT | `20260929T173136Z-bbeda54d` (prepared by `0f75908b`, 245 s) | `07c5be1c` (#915 twin = develop `5c2bd5aa`: #903 document Q&A, #904 ledger, #905 text-note draft key, #909 Codex expense review lock, #910 general knowledge, #911 expense categories on LINE text and photos, #912 assumed-year note, #914 PDF categories) | ACCEPTED_LINE_DEFERRED 00:35 on 09-30, smoke, 2 SSM sessions closed. Production preflight `20260929T173615Z-6f93ff70` PREFLIGHT_PASSED_NO_DEPLOYMENT (17.6 s). Not promoted; superseded by round 9. | 257.4 |
| UAT | `20260929T175952Z-445f673f` (prepared by `3e5b1ff4`, 280 s) | `e7643d91` (#917 twin = develop `2f5d26f5`: adds #916 regression fixes: file questions stay document questions, the as-of line uses the Bangkok day, bare Thai month names) | ACCEPTED_LINE_DEFERRED 01:04, smoke, 2 SSM sessions closed. Preflight `20260929T180425Z-ebe8d3ab` PREFLIGHT_PASSED_NO_DEPLOYMENT (19.2 s). Not promoted: the owner chose to test round 10 in one pass. | 264.0 |
| UAT | `20260929T234807Z-8679ae44` (prepared by `ab1a6cd1`, 255 s) | `74748a06` (#925 twin = develop `cf783811`: adds #918 LINE reimbursement drafts, #919 answer preferences, #920 plain-Thai LINE claim card, #921/#922 plain-Thai web reimbursement pages, #923 claim locator and raw-path sanitiser, #924 bill-linked evidence wording) | ACCEPTED_LINE_DEFERRED 06:53, smoke, 2 SSM sessions closed. Preflight `20260929T235405Z-295f589a` PREFLIGHT_PASSED_NO_DEPLOYMENT (25.1 s). **Not promoted**: in the owner's LINE test, caption-less receipt photos were intercepted by a week-old open substitute-receipt state on the test shop. | 344.4 |
| UAT | `20260930T003118Z-4da29c2e` (prepared by `c1200a77`, 244 s) | `e52c151a` (#927 twin = develop `0f97a148`: adds #926, where a caption-less photo is read and drafted, and substitute-receipt work claims a photo only after an explicit ask within the last 30 minutes) | ACCEPTED_LINE_DEFERRED 07:37, smoke, 2 SSM sessions closed. Preflight `20260930T003728Z-2aa69227` PREFLIGHT_PASSED_NO_DEPLOYMENT (26.4 s). | 347.5 |
| Production | `20260930T011743Z-e16962f3` | `e52c151a`, promoted from UAT `4da29c2e` with no rebuild, after preflight `2aa69227` | ACCEPTED_LINE_DEFERRED 08:28, website ready 08:24:44 (420.7 s), acceptance written 08:28:02. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally; 4 SSM sessions closed. No migration and no `infra/kamal` change since the previous Production release (`0cb704db`). | 659.8 |

**Smoke acceptance is promotable; Production acceptance is never smoke.** A `--uat-smoke-acceptance` run needs no admin login, yet it still signs ACCEPTED_LINE_DEFERRED with a promotion bundle, and `promote-prod` accepts that receipt for 24 hours. Use smoke only with the owner's consent. Production promotion still needs the owner's own sign-in and the 10 browser checks.

**Superseded UAT rounds need no cleanup.** Rounds 7–10 were never promoted. Each later round replaced the release on the UAT hosts, and the prepare and apply that followed the unapplied prepare `d88af0f2` ran without any cleanup.

**macOS has no `timeout`.** A `promote-prod` preflight wrapped in `timeout` exits 127 before the controller starts, so nothing runs. Run the controller without it.

---

## Release 2026-09-29 — UAT and Production Kamal

The owner started both UAT hosts at about 09:24 Bangkok; they had been stopped since 2026-09-26. Every release below used the local Kamal path from a clean `main` controller worktree, with `--uat-browser-acceptance` or `--production-browser-acceptance`. In each case the owner typed the credentials themselves in the Claude built-in browser. The controller then verified `/auth/me` identity and permissions, the platform-access page, public `OPEN`, logout, and the 401 after logout. GitHub workflow IDs are `NOT_DISPATCHED`.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20260929T024943Z-22bb5a1e` | `a521e2c8` (purchase-without-setup + review fixes) | ACCEPTED_LINE_DEFERRED 10:01 | 680.8 |
| UAT | `20260929T040700Z-6f8f3bd2` | `a2d11e89` (LINE AI fix #865–#868) | ACCEPTED_LINE_DEFERRED 11:15 | 515.3 |
| UAT | `20260929T044840Z-9356f353` | `c4513ddd` (photo fix #872/#873, partner retry #870) | ACCEPTED_LINE_DEFERRED 11:55 | — |
| Production | `20260929T045818Z-2a6d7b34` | `c4513ddd`, promoted from `9356f353` with no rebuild | ACCEPTED_LINE_DEFERRED 12:07, serving `live`, `OPEN`, 10/10 checks, 4 SSM sessions closed | 547.9 |
| UAT | `20260929T074435Z-d5922ed9` (prepared by `02543f19`, 222 s) | `a8ab3bfe` (#880/#881: sales-event SD-A–E, add-on PR B/C, LINE fixes) | ACCEPTED_LINE_DEFERRED about 15:06, website ready 14:48 (239 s), 2 SSM sessions closed. **Browser acceptance was an owner waiver**: the owner said "การตรวจรับ UAT อันนี้ถือว่าฉันเข้าไปเช็คแล้ว ไม่ต้องเข้าเอง". The checks were recorded as owner-attested, and `owner-waiver-observation.txt` in the run dir lists what Claude did and did not observe. It is not authority for production. | 1232.0 |
| UAT | `20260929T083801Z-65843d3d` (prepared by `e19259b5`) | `d34df4b4` (#883/#884: LINE discount answer, 25 s text router, QR valid until batch close + PNG save, AiTurn terminal status) | ACCEPTED_LINE_DEFERRED 15:44, website ready at 249.6 s. The owner signed in personally; Claude observed the checks. 2 SSM sessions closed. | 372 |
| UAT | `20260929T093654Z-061ae420` (prepared by `5eb0a754`, 230 s) | `4a9856ab` (#885/#886: event discount on any one-time payment, once per event per shop) | website ready 16:41 (238 s). The owner signed in about 25 minutes later; the 6 checks were then observed, and the owner-approved clearing of the ฿80 total AI override on 4 shops was done through the admin UI. The run then ended **FAILED_RECONCILIATION_REQUIRED** in the customer-acceptance phase ("ssh: command failed"): the SSM port-forward died during the long acceptance wait. Reconciled in place at about 17:10 Bangkok: all services were re-inspected on `4a9856ab` (restarts 0); the remote release lock was released with the controller's owner-assert script; `active.json` was removed; the evidence is in `reconciliation.md` in the run dir; no service changed. | 1789 |
| UAT | `20260929T104018Z-c1803f71` (prepared by `3dfd3e3f`, 216 s) | `f1cb7b02` (#887/#888/#890 via #889/#891: card-auto and PromptPay-renew first-bill discount, choose which held discount, LINE claim page one tap and versioned script, card advance-deal checkout cancel fix) | ACCEPTED_LINE_DEFERRED about 17:46, website ready about 17:44. Browser acceptance was written 1 minute after ready. The owner's session had been opened at 17:33, before this release was ready; this is recorded as such in the observation. | 314.6 |
| Production | `20260929T104616Z-b88c9c29` | `f1cb7b02`, promoted from UAT `c1803f71` with no rebuild, after preflight `20260929T104549Z-9859a904` (PREFLIGHT_PASSED_NO_DEPLOYMENT, 20.7 s) | ACCEPTED_LINE_DEFERRED 17:52, website ready 17:51 (289.5 s). Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally; acceptance was written 69 s after ready. It applied migrations `20260929120000`, `150000`, `160000`, `180000` and `190000` (the last one drops the lifetime one-discount-per-shop index). | 390.1 |
| UAT | `20260929T130656Z-01211e37` (prepared by `0c4ce3c9` from `66f7cd16`, 541 s) | `66f7cd16` prepared; the apply selected `68f0de58` | **FAILED** before any mutation: "Prepared build is not the selected successful candidate". Another session merged #901 into `main` during the prepare, so the build no longer matched `main` HEAD. No lock, `active.json` or container was left behind; re-prepared from `68f0de58`. | 16.4 |
| UAT | `20260929T131212Z-73a70aca` (prepared by `1e278e02`, 243 s) | `68f0de58` (#892–#897 via #898: card advance-deal invoice routes, split switch removed, admin tab "เครดิต AI และอ่านรูป" with the chat-credit migration, strict receipt evidence deleted; plus #901 account-email steps from another owner-directed session) | ACCEPTED_LINE_DEFERRED 20:19, website ready 20:16:52, acceptance written 2 minutes after ready. The owner signed in personally while the pane was hidden (the tab's network log shows the login); Claude observed the checks after that. | 429.3 |
| Production | `20260929T132006Z-c613a67f` | `68f0de58`, promoted from UAT `73a70aca` with no rebuild, after preflight `20260929T131931Z-0318ed09` (PREFLIGHT_PASSED_NO_DEPLOYMENT, 28.2 s) | ACCEPTED_LINE_DEFERRED 20:29, website ready 20:26:14, acceptance written 20:28:58. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally. It applied migration `20260929200000_admin_chat_credit_explicit`. | 568.2 |
| UAT | `20260929T135109Z-752ebf75` (prepared by `394d939d`, 257 s) | `0cb704db` (#900 via #902: LINE photo bursts acknowledged on arrival, caption-less photos read directly, staff OA contact-card button) | ACCEPTED_LINE_DEFERRED 20:59, website ready 20:55:54, acceptance written 20:59:16, with the owner signing in personally. | 510.9 |
| Production | `20260929T140650Z-b8cb2eaa` | `0cb704db`, promoted from UAT `752ebf75` with no rebuild, after preflight `20260929T140621Z-48255f68` (PREFLIGHT_PASSED_NO_DEPLOYMENT, 23.1 s) | ACCEPTED_LINE_DEFERRED 21:18, website ready 21:11:40, acceptance written 21:18:05. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally. No migration. | 704.9 |

**Owner waiver on a UAT browser acceptance (2026-09-29, op `d5922ed9`).** The controller has no waiver path, and a failed acceptance after mutation leaves `FAILED_RECONCILIATION_REQUIRED` plus `active.json`, which blocks the next deploy. So when the owner explicitly waives the admin login for a UAT run, record their words and the observed facts in an evidence file, and state in `observer` that the checks are owner-attested and were not observed. Production promotion still requires the owner's own 10-check browser acceptance.

These releases applied 12 pending migrations (`20260926120000` … `20260929030000`) with `migrate deploy`; none contained destructive SQL. Production was previously `a2b926c6`.

**AgentCore env is copied forward.** `infra/kamal/release.py` `agentcore()` builds the runtime env as `{**deployed env, **identity keys}`. Any `LINE_AI_*` value set when the runtime was created stays in AgentCore forever, and a key that was never set falls back to its code default. On 2026-09-29 this left AgentCore on a stale four-family prepared-read list, with the tool-use loop off, on both UAT and production. The AI turn path now reads no capability switches (#865). Do not rely on changing AgentCore env through a release.

**UAT API host disk.** The prepare capacity check requires 2 × (api-web + tools image) + 2 GiB free on the Docker filesystem. On 2026-09-29 the API host `i-0eb581c5ac3b3d7ba` had 3.5 GB free (38 GB disk, 91% used). The cause was 20 retained `releases:*-tools` images from earlier releases.

Remediation, read-only first:
1. Open an SSM port-forward and run strict-host-key SSH with the enrolled key and the latest run's `known_hosts`.
2. Run `docker system df` and `docker images`.
3. `docker rmi` the old `-tools` tags, keeping the current and previous release (api-web images of retained Kamal containers stay), plus unused `kamal-proxy:v0.8.0`.
4. `docker image prune -f`.

Free space went to 28 GB. The prepare that failed there (`20260929T035053Z-e4a71e64`, FAILED before any mutation) was followed by a clean prepare. Always terminate the SSM sessions afterwards. A script that starts port-forwards in a `$(…)` subshell loses their PIDs and session ids for cleanup, so keep them in the parent shell.

**Acceptance must follow website-ready within about 5 minutes (again).** UAT round 3 lost its SSM transport during a 25-minute wait and needed an in-place reconciliation, the same failure as the Production hotfix of 2026-09-23. Ask the owner to sign in only when the controller prints "website ready", and finish the checks within about 5 minutes. If the owner cannot, use `--uat-smoke-acceptance` with their consent.

**LIFF script caching.** Cloudflare replaced the origin's `Cache-Control: no-cache` on `/v1/auth/line/link-page.js` with its 4-hour browser TTL (`max-age=14400`), so phones ran the previous claim-page script for hours after a deploy. Since #888 the page loads `link-page.js?v=<sha256[:12]>`, served `public, max-age=31536000, immutable` for the matching version and `private, no-store, max-age=0` otherwise.

**Keep `main` still from prepare to promotion.** The apply selects `main` HEAD as its candidate and refuses a prepared build of any other commit. The refusal is safe, because it fails before any mutation, but it costs a new prepare. On 2026-09-29 a parallel session merged #901 into `main` during UAT round 5's prepare. Before preparing, tell other sessions not to merge into `main` until the Production promotion is accepted. If a merge has to ride along, merge it first and prepare after it.

**A hidden browser pane renders late.** When the owner has another panel open, the Claude built-in browser keeps working, but client-rendered parts of a page, such as the platform-access card, can stay empty for many seconds. Before recording a check as failed, read the page again after a short wait or take a screenshot. An empty card on the first read is not a failure.

---

## Read-only timing/inventory checkpoint — 2026-09-26

This live read supersedes the September25 running-host snapshot for UAT: API
`i-0eb581c5ac3b3d7ba` and AI/workers `i-011918b0d49534d1c` were both `stopped`.
All four enrolled Production application hosts were `running`; both RDS instances were `available`.
No host, service, flag, IAM policy or deployment was changed for this audit. Production health wasOK.
AgentCore endpoints `kamal_production_b` v12 and `kamal_uat_b` v33 were READY/sourcea2b926c6;
endpoint readiness does not mean the stopped UAT application is serving.

Timing logs need migration-aware inspection: Production groups now include
`/ecs/mangmee-kamal-production-{api-web,ai-gateway,workers}`. Existing scoped operator/deploy profiles
could discover groups but were denied streams/events. AgentCore log groups exist for both environments,
but event reads were also denied. UAT native_config at sourcea2 adds awslogs only forProduction;
zero recent events in the old UAT ECS group is not proof of absent instrumentation. Inspect retained
Docker logs when UAT is open under an authorized operation; do not start hosts merely to make a
read-only audit appear complete. Existing DB timing was readable through the documented support paths.
ProductionT1 and UATreadonlytunnel sessions were closed; owned active-session readback waszero.
[Evidence, query windows and limitations](../research/mangmee-ai-live-timing-readback-2026-09-26-th.md).

## Current UAT Kamal — 2026-09-23 01:37 UTC

Main source `abd2b4a37da242669a04a6e5a4506e0caf2e95a9` is serving all three UAT services after Kamal
operation `20260923T013213Z-a576cd15`, terminal `ACCEPTED_LINE_DEFERRED` in 323.562 seconds.
All 12 phases passed: exact prepared source/config/image readback, provider preparation, safe pending
migrations, API/DB, AI Gateway, Workers/Redis/internal API, native rollout, public customer `OPEN`,
build retirement, and KMS ECDSA signature verification. The owner-authorized UAT smoke passed all
service config/readiness plus public `/api/v1/auth/platform-access` and `/login`; live LINE acceptance
remains `DEFERRED_BY_OWNER`. The operation terminated both controller-owned SSM sessions. GitHub
UAT/READY/Production workflow IDs are `NOT_DISPATCHED` because this is the local Kamal release path.

The durable UAT target now retains its enrolled EC2 identities: API `i-0eb581c5ac3b3d7ba` at private
`10.92.0.10`, and AI/workers `i-011918b0d49534d1c` at private `10.92.0.42`. Explicit reconciliation
`20260922T104435Z-e8813d9a` verified the same VPC/stack/IMDS identities and installed current host
keys; it never replaced an instance. A stale-public-address preflight failure
`20260922T101352Z-8758c338` is retained as history only. The controller uses SSM/private addresses,
never public TCP/22. Its SSM transport now snapshots one deploy-role STS credential session for tunnel
start and termination, so own-session cleanup passes without broadening IAM: preparation
`20260922T110517Z-e5d0e109` passed in 107.258 seconds and terminated 2/2 sessions; the accepted
release also terminated 2/2 and a privileged readback found zero active sessions and no active deploy.

Permanent remediation completed on 2026-09-21. CloudFormation change sets
`uat-ssm-transport-20260921` and `uat-ssm-session-cleanup-20260921` completed without instance
replacement. Both hosts are `Online` in Systems Manager, the private UAT target uses
`sshTransport: ssm`, the deploy role can open only the enrolled host tunnels and terminate only its
tag-bound sessions, and all public TCP/22 rules were removed from both UAT security groups. Read-only
operation `20260921T112636Z-1b2d1eff` passed in 11.197 seconds with no public SSH, terminated both
controller-owned sessions, and left zero active sessions. Do not add a workstation CIDR as a
shortcut; use the enrolled Session Manager path and treat any unproved session cleanup as a failed
operation requiring reconciliation. After the controller was merged to both long-lived branches,
main-tree read-only operation `20260921T115422Z-608cb7e4` passed in 11.761 seconds, terminated 2/2
owned sessions, and a privileged readback again found zero active sessions and zero public TCP/22
rules.

---

## Current Production Kamal — 2026-09-18 14:42 UTC

This checkpoint supersedes the staging/ECS inventory below. The owner-authorized migration and
first isolated hotfix0b0058ad completed as20260918T113740Z-2b1e04fa under explicit browser HTTP waiver.
Current serving source is`1406d3825db2eb7d70987b207c80f89ae05edb3b`, operation
`20260918T143800Z-e6c3b860`, state`ACCEPTED_WITH_BROWSER_HTTP_WAIVER`, KMSverified/publicOPEN.
All four containers (API in two AZs, AI, workers) match exactsource/config/deepreadiness.
AgentCore`watchdog_orchestrator_production_kamal-Ik7N9qDX8R` uses`kamal_production_a`, version5;
previous0b provider remains version4 onb. Hosts/IPs in the table below remain current.

All three original ECS services are parked0/0 and have no running task. Actual API/AI stopped
13:17:57/13:18:31UTC; retain oldworker signedSTOPPED evidence because its task record expired.
The ECS rollback window was explicitly closed, obsolete build authority retired through existing
audit path, temporary`first-migration-20260918` IAM policy removed, and signed closure installed.
Subsequent recovery uses native Kamal prior-container/provider snapshots, not the closed migration
rollback procedure. Shared ALB/RDS/Redis and oldECS configs/images/history remain retained;
both legacy Production workflows remain disabled. No DNS/Cloudflare change.

Operator changed Wi-Fi: the existing three TCP22 rules now allow only`49.228.220.223/32`
in place of`49.229.201.224/32`. This authorized drift is not yet reflected in CloudFormation's old
OperatorCidr parameter; preserve it during future stack updates. Ordinary release/signing uses
non-root`mangmee-kamal-production`; infrastructure bootstrap/retirement used owner`thawatchai`.

Full failure retention, acceptance limitations, exact times and integration results:
[Two-hotfix release evidence](../evidence/production-two-hotfixes-2026-09-18.md).
Do not interpret waived browser identity/logout checks as standard protocolPASS or reuse the
old owner acceptance as proof of future candidates. The release-specific override hash is signed.

## Production Kamal staging — 2026-09-18, no application cutover

Latest operation checkpoint09:46UTC: the first app handover20260918T085755Z-860908a6 failed at
CloudFormation AMI permission validation. AWS restored the original staging template/rules and
stack isUPDATE_ROLLBACK_COMPLETE. Explicit recovery20260918T091745Z-318a0d41 restored all3
ECS services tofc2838c4 and provider37; candidate containers are stopped with restartdisabled.
Customer traffic remains on ECS. Recovery is stillAWAITING_BROWSER_ACCEPTANCE, with its process
and release lock alive; do not start a second recovery or forward run. Current admin identity is
proved; freshcanOpen/logout204/postlogout401 and signed rollback completion remain outstanding.
The inventory below predates this failed handover. New hosts still incur cost. Retain failed
containers/evidence until signed recovery, then reconcile only those exact stopped containers.
[Consolidated rehearsal and correction](../agent-memory/production-kamal-cutover-rehearsal-2026-09-18.md).

The owner authorized ECS-to-Kamal migration with isolated application candidate
`0b0058adbc7353ec906a33746867af2a235b0934`. Latest read-only proof at08:19UTC still finds all three
ECS services running one task each on `fc2838c4cb691033f41595c0d43587f10377d33c`; capacity remains1/2.
API/AI original listener rules retain weighted target groups100/0. Inspect `ForwardConfig.TargetGroups`
and the healthy task IPs; do not assume every forward action has a top-level `TargetGroupArn`.
Old AgentCore remains READY/version37. Customer traffic has not been switched to Kamal.

New stack `mangmee-kamal-production` is CREATE_COMPLETE (63Add, no replacement/deletion), executed
once as `hotfix-infrastructure-20260918T070019Z`; VPC`vpc-033eebb5100e0dbbf`10.93.0.0/24.

| Role | Instance | Public IP | Private IP |
| --- | --- | --- | --- |
| API AZa | `i-04afe07799fd19f5d` |54.169.102.70|10.93.0.10|
| API AZb | `i-01951e536e32a875d` |13.213.1.94|10.93.0.42|
| AI AZc | `i-0e04890bef2ec1bfb` |18.140.237.182|10.93.0.74|
| workers AZa | `i-028c8f2e05fe5cd84` |13.212.141.178|10.93.0.106|

These four hosts are running and incur cost; only Docker/Kamal proxies were bootstrapped. Host keys
were verified from AWS console output. No app/consumer is running there. Separate runtime roles,
encrypted disks, IMDSv2, DB/cache boundaries,14-day log groups and host alarms are provisioned.
Two new ALB rules require the exact operator49.229.201.224/32; original ECS rules remain intact.
Do not start application containers or workers as an untracked test against Production queues.

Ordinary non-root profile`mangmee-kamal-production` assumes the new scoped deploy role from
`watchdog-bedrock`. Bootstrap-only owner profile`thawatchai` provisioned the new stack and temporary
inline policy`first-migration-20260918`. That policy expires2026-09-18T13:53:49.513914Z and permits
only the original worker service/family/pass-roles, new stack/owned listener rules, and exact old
provider readback. Existing API/AI service mutation is excluded. GetAgentRuntimeEndpoint also checks
the parent runtime ARN; both exact read resources must be authorized. No ordinary app deploy uses root.

Private target remains`cutoverComplete:false`; do not manufacture enrollment. Use the reviewed
[first-migration command and recovery procedure](../../infra/kamal/README.md#first-ecs-to-kamal-migration).
Local preparation`20260918T080339Z-c854a9c3` passed64.852s/425focused app tests using the independently
completed360.504s candidate build. These are not live deploy/rollback timings. Signed Production
acceptance and actual SYSTEM_ADMIN/customer OPEN remain outstanding.
[Full inventory, retained failures and operation ledger](../agent-memory/production-kamal-two-release-paths-2026-09-18.md).

## Production first-migration output reads — 2026-09-18

A conditions-only CloudFormation update can complete both listener rules and then roll back while
resolving an unchanged output. Operation `20260918T101611Z-1069a958` failed on `iam:GetRole` for the
stack's `DeployRoleArn` after both rules switched. Read every output provider before worker handover;
valid change-set scope and runtime deployment permissions alone do not prove this boundary.

The staged stack has15outputs from EC2, IAM, ECR, KMS and AgentCore. Read-only AWS registry schema
inspection identified each native resource READ permission set. Grant only bounded metadata reads
under the existing migration expiry, and verify actual nonroot calls; IAM simulation alone is not
live permission proof. KMS's provider soft-fails some optional metadata reads, so an audit denial is
not automatically a fatal GetAtt failure. ECR policy-not-found is distinct from access denied.

Explicit recovery `20260918T103003Z-7bfbc4ef` is signed `ROLLED_BACK_TO_ECS`; all three ECS services
read back original source `fc2838c4cb691033f41595c0d43587f10377d33c`, customer OPEN/live and logout
acceptance passed. No Kamal Production enrollment or completed hotfix is implied. See
[output audit and verification](../agent-memory/production-kamal-output-preflight-2026-09-18.md).

## Isolated AWS rehearsal completed — 2026-09-14

Later owner-requested UAT power resume: both retained Kamal hosts are running again (API
`i-0eb581c5ac3b3d7ba` at `13.212.80.73`, AI/workers `i-011918b0d49534d1c` at `13.213.14.149`).
Verified EC2 identity and preserved SSH keys before updating private enrollment; private ALB targets
remain `10.92.0.10`/`10.92.0.42`. Dev remains stopped. The stopped-state read below is historical.
Owner approved permanent TCP22 ingress `27.130.60.231/32` for both UAT groups only, preserving
`27.130.53.193/32`: API `sg-021fe21a46c0fcb88` rule `sgr-0e4dfb75cc6543bff`, AI
`sg-089ddbf86bd4251a1` rule `sgr-0d133747833e0c6e0`. Exact `DescribeSecurityGroups` readback confirms
both /32 rules on both groups; no broader/IAM access change. Account-scoped non-root operator used.
This manual ingress is owner-approved drift; do not remove it as temporary rehearsal access or
overwrite it with the older CloudFormation allowlist without preserving the approved rule.

Substitute artifact-preview500 was reproduced in the exact serving API image: PDF.js optional
`@napi-rs/canvas` was stripped by `--no-optional`, causing `DOMMatrix is not defined`; bank PDF text
extraction silently returned `unreadable` for the same omission. It is image packaging, not a missing
running host. [Hotfix/audit and release ledger](../agent-memory/runtime-dependency-hotfix-20260914.md).

The earlier hotfix and shared HEIC/HEIF upload-source consistency were deployed: operation
`20260914T165647Z-f9ecf83a`, main source `038eb55409cf18db587c4e93b93d91492a20bf2e`, terminal
`ACCEPTED_LINE_DEFERRED`,298.538s, all config/readiness checks and KMS signature verified, customer
`OPEN`. Existing previously failing Drtb paper-form preview renders its PDF page after fresh reload;
the original The sun coffee item was not re-tested with the Drtb account. API/DB, AI, Workers/Redis/
internal API passed; new-container bounded logs show no missing-module/DOMMatrix/5xx/timeout pattern.
AgentCore is now `kamal_uat_a` version5. Both UAT hosts retain the enrolled addresses above, Dev is
stopped, and Production is unchanged. PR561/develop and PR562/main passed full exact-head CI before
merge; owner explicitly authorized admin merge for main's missing reviewer approval only. See the
linked release ledger for exact immutable image digests and signed artifact hash.

Previous serving UAT loading hotfix: operation `20260914T182800Z-e3b8bc63`, main source
`f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9`, accepted 2026-09-14T18:34:03.090095Z,
`ACCEPTED_LINE_DEFERRED`,364.651s, all eleven phases PASSED and KMS signature verified, customer
`OPEN`. Exact API/DB, AI and Workers/Redis/internal API configs/readiness passed. AgentCore
`kamal_uat_b` version6. Fresh Chrome Drtb reload shows route loading and preview loading with
duplicate row actions disabled, then readable PDF page and enabled print. The earlier PDF/HEIC
fixes remain included. Both UAT hosts retain enrolled addresses; Dev remains stopped and Production
unchanged. PR565/develop CI34876912709 and PR566/main CI34878949174 passed full actual checks
before owner-authorized admin merges. [Loading scope, exact digests and signed evidence](../agent-memory/action-loading-hotfix-20260915.md).
Login/logout is NOT_REQUIRED_BY_OWNER, live LINE DEFERRED_BY_OWNER under retained UAT smoke
authorization; CI LINE fixture acceptance is separate. Earlier serving-operation entries below
are historical, not the currently deployed source.

Latest serving UAT preview-cover/performance hotfix: operation `20260914T192255Z-e036fe7a`, main
source `5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c`, finished2026-09-14T19:30:05.252048Z,
`ACCEPTED_LINE_DEFERRED`,429.541s; all11 phases PASSED, KMS signature verified, customer `OPEN`.
Exact API/DB, AI and workers/Redis/internal API source/config/readiness passed; AgentCore now
`kamal_uat_a` version7. Fresh Drtb View shows an immediate centered document-area cover, disabled
print, then a readable page and enabled print; early-close prevents late response reopening.
The PDF.js RGB-tail offset patch removes repeated prior-chunk work: paired isolated serving-image
synthetic pipeline median5.688s→1.609s (~72% faster), with identical page size/encoding quality.
No source/checksum/tenant permission change. PR569/develop CI34884275830 and PR570/main CI34884441376
passed full actual checks before owner-authorized admin merges; main reviewer waiver only.
Both UAT hosts retain enrolled addresses and permanent SSH rules, Dev is stopped and Production
unchanged. [Exact digests, signed artifact and verification](../agent-memory/preview-cover-performance-hotfix-20260915.md).
Login/logout and live LINE remain covered only by the retained UAT smoke exception above.
Old zero-phase `RUNNING` shell `20260911T164143Z-49739d4d` has two historical snapshot copies,
unchanged since Sep11 with no active lock or mutation phase; targeted process check finds no old
controller. Do not count stale receipt labels/snapshot duplicates as live queued/running operations,
or rewrite/delete historical evidence; verify active lock, process and mutation evidence instead.

Latest verified state at **00:41:22.152660 UTC**: Dev `i-0883f1ff88440ca07` and both UAT Kamal hosts
are **stopped**. Owner approved exact temporary SSH access for this rehearsal; rule
`sgr-0a12dbd8f66e96575` was removed and absence verified. Preserve the original allowlist.
The last Dev public IP47.129.159.150 is historical and must be re-enrolled after any restart.
Production services and the existing bastion were not changed. Earlier pending-approval entries
below are historical. No IAM policy was changed.

Shared core operation `20260914T003123Z-1f9c690a` passed on main00cbaa8b, then powered off Dev
immediately. Main-to-core-proof507.797s; command including fixture setup/shutdown569.800s. This is
not Production acceptance: synthetic credentials/data, single Dev host, customer gate CLOSED, no
AgentCore update or real Production topology/provider/customer proof. Original failed Redis fixture
setup is retained: official entrypoint UID999 could not read owner1000 mode0600 config. Correct
fixture uses non-root UID1000 plus private writable data; TLS PONG/SAVE and clean core run passed.
Private fixtures/app containers remain on the stopped volume; restarting Dev may restart them.
[Full timing, scope and evidence](../agent-memory/kamal-prod-simulation-2026-09-13.md).

## Production configuration readback — 2026-09-13

Read-only preparation used the existing non-root reader to capture all three Production ECS Express
`activeConfigurations`, beginning 14:40:53 UTC. All advertise source
`fc2838c4cb691033f41595c0d43587f10377d33c`; this is configuration evidence, not running-container or
customer acceptance proof. All 12 distinct secret references resolved at their current versions;
metadata/versions remained unchanged on the final read. New main `00cbaa8b` builds and its three
service config schemas passed against this baseline plus tracked Production overrides, in local
network-disabled validation containers. No Production resource or traffic was changed.

No Production Kamal target is enrolled locally. The prepared command/example is not infrastructure
or cutover completion. [Scope, checks and evidence](../agent-memory/kamal-prod-preparation-2026-09-13.md).

Fresh 15:17–15:20 UTC rehearsal inspection: both UAT Kamal hosts and Dev are **stopped**, with no
assigned public IP; the old addresses below must not be reused. The bastion remains running.
Production RDS is available on PostgreSQL **18.3**, `db.t4g.small`, Multi-AZ, private/encrypted,
35-day backups and deletion protection. Complete ECS config/12 secret-version metadata matches the
earlier baseline. Existing reader credentials deny even the Dev start dry-run, CF/IAM discovery and
Redis discovery. Owner subsequently restored root Console and authorized its use for isolated testing,
requiring immediate simulation-host shutdown. Root readback confirms Production Redis **7.1.0**, two
`cache.t4g.micro` nodes, Multi-AZ/failover, TLS, at-rest encryption and auth. The Dev SSH allowlist has
the previous workstation address; an exact temporary /32 approval is pending. No host or IAM state
changed. [Simulation evidence and pending access](../agent-memory/kamal-prod-simulation-2026-09-13.md).

Actual Production DB support read at **16:05:09 UTC**, using existing `watchdog_support_ro` IAM auth,
verified TLS and a read-only transaction: PostgreSQL18.3, **182 applied migrations, 0 unfinished**.
Ordered migration names/SQL checksums exactly match source `fc2838c4...`; main `00cbaa8b...` contains
188. Its six pending migrations require normal mode before any hotfix-only promotion. No data or DDL
was changed. Support session `root-l5tdyxu2594req3e72dhhl6lze` is verified **Terminated**. The local
PostgreSQL18.3/TLS rehearsal passed the actual normal upgrade and subsequent hotfix, but does not
establish AWS deployment timing, managed Redis parity, multi-AZ readiness or customer acceptance.

## UAT Kamal update — 2026-09-19 11:44 UTC

Hosts stopped 2026-09-18 16:00Z, started by the owner 2026-09-19 10:48Z. Both public IPs changed: API
`i-0eb581c5ac3b3d7ba` to 13.212.206.250, AI/workers `i-011918b0d49534d1c` to 47.129.64.91; private
10.92.0.10 / 10.92.0.42 unchanged. Strict SSH verified host keys unchanged before the enrollment
addresses were rewritten. The owner added TCP-22 rules for operator IP 27.130.73.105/32
(`sgr-0ce574158b952a153` on `sg-021fe21a46c0fcb88`, `sgr-06108438c7157474d` on
`sg-089ddbf86bd4251a1`) — authorized drift not yet in the CloudFormation OperatorCidr parameter.
Read-only preflight `20260919T110007Z-8ced8a31` PREFLIGHT_PASSED_NO_DEPLOYMENT. Main `a923b7e9`
(Node 22.23.2 digest, still bookworm) then deployed as Kamal operation `20260919T113219Z-7f1b8b98`,
mode normal, `--uat-smoke-acceptance`, ACCEPTED_LINE_DEFERRED in 718.444 s: all 11 phases passed, KMS
signature verified, customer OPEN, 8 pending migrations applied (catalog now 228). UAT/READY/PROD
workflow IDs NOT_DISPATCHED. The trixie image is NOT on UAT yet.


Round 2 (2026-09-19 18:02Z): main `d6a290c4` (trixie base + login purge + ClamAV 1.5.4, retry tap-target fix, production Stripe config) deployed as Kamal operation `20260919T180242Z-52148508`, ACCEPTED_LINE_DEFERRED in 496.042 s, 11 phases, KMS verified, customer OPEN, no new migration; in-container readback Debian 13.7 / Node v22.23.2 / ClamAV 1.5.4 / `login` purged; AgentCore kamal_uat_a v13. The owner then had the two UAT hosts stopped at 18:12:58Z (public IPs will change on the next start — re-enroll before deploying); this signed bundle is the candidate for a later `promote-prod`.

## UAT read-only inventory — 2026-09-16

All three serving Kamal containers were read back running source
`5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c`, operation label
`20260914T192255Z-e036fe7a`. API, AI and workers still use the enrolled UAT hosts below.
Public health/login/signup return200 and customer access is OPEN. This observation does not
recover or certify the September14 operation's signed release evidence.

September16 main update `8c277dea4504b18e9537243ade031770d78ead4e` is deployed on allthree as
Kamal operation `20260916T064124Z-125e1228`, ACCEPTED_LINE_DEFERRED in325.455s, KMS signature
verified and customerOPEN. AgentCorekamal_uat_b/version8. Normal mode applied31pendingmigrations
after188previous, verified complete219ledger/sync authority and allservice config/readiness.
Initial operation20260916T061822Z-7342e27f failed before cloud/DB mutation because Postmark import
created untracked Python bytecode. Retry used PYTHONDONTWRITEBYTECODE=1 without weakening the
clean-source guard. Isolated Docker config avoided the shared desktop credential-helper delay;
shared Docker settings stayed unchanged. Both attempts and reconciliation timing are retained.

Latest serving hotfix: main `ee2f55421dde0edc0fb7226aadea66c3cc52b2d0`, operation
`20260916T080218Z-b9eb3d90`, finished08:08:54.787838UTC, ACCEPTED_LINE_DEFERRED in396.159s.
All11phases/KMS signature/customerOPEN passed; complete219migration catalog verified with no new
migration. AgentCorekamal_uat_a/version9; exact3service source/config/readiness passed.

Seven UAT Postmark/Stripe secrets and canonical parked ECS baseline use non-root profiles.
UAT Stripe is Sandbox; Postmark20950027 sends real allowlisted test mail. Original Postmark
webhook25832029 now verifies all3triggers200. First post-hotfix OTP request succeeded; real message
91c088a1-fde8-4c57-aef3-cdec45a1f648 delivered08:10:40UTC, callbackPUBLISHED08:11:00.258 and
matching app deliveredAt. New serving-image Redis instance proves firstcall success/nextcall limit.

Later single-admin hotfix main `7ccff81178e547817d5d21571aa88ee2dde94628` now serves all3services:
operation `20260916T103914Z-350853d8`,443.532s,11phases passed, KMS signature verified and fresh
customerOPEN. AgentCorekamal_uat_b/version10;219migration catalog verified,0new/pending. Full
source CI35080266183 passed before PR595/admin develop merge and identical main fast-forward;
only one full source CI was dispatched. [Exact release and native status](../evidence/billing-single-admin-uat-release-2026-09-16.md).

UAT Sandbox sales are now enabled through native Admin current-password proof and explicit
single-admin confirmation: request69214c53-9bab-48ed-99fe-c2767421a777/version2, settingsversion1.
Published native Stripe check0fd91395-5017-475a-ae05-c37315db87b4 passed10:55:10UTC for policy,
account,6paid/6zero prices,Portal and tax. VAT/refunds remainoff. The original customer company
requires its separate owner login for an actual test purchase. Existing tester passwordless login
still needs explicit opt-in. No Sandbox payment/new signup or liveLINE acceptance claimed, and no
Production deployment in this task.
CI35066936157 passes the identical PR591/592 head; failed duplicate35066933135 and two passing
local replays are retained without claiming its transient Nextdev404 root cause fixed.
See [complete release evidence and timing](../evidence/uat-main-readiness-2026-09-16.md).

## UAT Kamal update — 2026-09-11 20:28 UTC (historical proof)

Owner-authorized UAT Kamal proof is separate from the ECS V2 Production protocol. Production remains
on ECS and was not changed. Dev instance `i-0883f1ff88440ca07` remains stopped. Existing UAT ECS
services are parked at0/0; UAT traffic uses stack `mangmee-kamal-uat` (VPC `vpc-061922f7174f90a70`).

- API: `i-0eb581c5ac3b3d7ba`, public `52.77.223.9`, private `10.92.0.10`.
- AI/workers: `i-011918b0d49534d1c`, public `47.129.248.19`, private `10.92.0.42`.
- UAT origin: `https://uat.mangmeeplus.com`; existing ALB private targets unchanged.
- Current serving main `6b95e505` passed two complete smoke deployments `20260911T170623Z-c8d84820`
  and `20260911T171058Z-8c83ebfc`, verified KMS signatures and full config/readiness/OPEN. Full times
  4m14.836s and4m25.786s; AgentCore `kamal_uat_b` version4. See the linked task memory/report.
- Latest serving operation `20260911T201637Z-cb364f03` rebuilt the same main with an initially empty
  isolated BuildKit/dependency store and passed full config/readiness/OPEN plus KMS signature once,
  without error or retry. Deploy command 11m14.699s; including operator checks/builder setup
  11m32.827s; including isolated-builder cleanup 11m39.039s. Existing UAT hosts/images were retained;
  this is cold build cache, not new hosts. AgentCore remains `kamal_uat_b` version4; dev was freshly
  confirmed stopped. [Full cold-cache evidence](../research/kamal-uat-cold-cache-proof-2026-09-12.md).
- UserData-only bootstrap correction completed15:48:07.379Z after49.251476s. EBS instances restarted
  in place; public IPs changed. Enrollment was updated only after AWS identity and original SSH host
  keys matched. Existing containers preserve old `KAMAL_HOST` metadata; do not rewrite it for rollback.
- Actualtemplate equals the reviewedv2 with corrected HOME ownership and pinnedproxyv0.9.2. Both
  actual `cloud-init schema` checks pass. Fresh OS boot of the new script has not been exercised.
- Read-only operation `20260911T155433Z-2e90e0bd` proved all3 original container IDs/image/full config,
  proxy routes and deep health after restart; source `120256910c9a320409e9cfabfe3ec5ae377c4e18`.
- Bootstrap is initial environment setup, never part of `infra/kamal/deploy-uat` or `deploy-prod`.
  Do not rerun bootstrap on serving hosts. See `docs/agent-memory/kamal-stability-2026-09-11.md` for
  the subsequent application update/rollback/restore ledger. The older inventory below is historical.

## 1. อะไรรันอยู่ (live read-back 2026-08-15)

| Resource | ตัวตน | สถานะ |
| --- | --- | --- |
| ECS cluster | `watchdog-bms-prod`, `watchdog-bms-uat` | ทั้งคู่ ACTIVE |
| prod services | `watchdog-bms-api-web-pub`, `watchdog-bms-ai-gateway-v2`, `watchdog-bms-workers` | **ACTIVE, capacity 1/2 และมี task รันครบ 3 ตัว**; source `748f1fa…`; serving mode `maintenance_only` ทั้งหมด |
| uat services | `watchdog-bms-uat-api-web` (2 vCPU/6 GB), `-ai-gateway` (1/2), `-workers` (0.5/1) | **ACTIVE, capacity 1/2 และมี task รันครบ 3 ตัว**; serving mode `live` |
| RDS UAT | `watchdog-bms-uat-db` — `db.t4g.micro`, 20 GB, Single-AZ, backup 1 วัน | encrypted, `PubliclyAccessible: false` |
| RDS Production | `watchdog-bms-prod-db` — `db.t4g.small`, 20 GB, Multi-AZ, backup 35 วัน, deletion protection | encrypted, `PubliclyAccessible: false` |
| ElastiCache UAT | `watchdog-bms-uat-redis` — standalone `cache.t4g.micro`, engine 7.1 | pg `watchdog-bms-uat-redis7`, **ไม่ได้เข้ารหัส/ไม่มี auth** |
| ElastiCache Production | replication group `watchdog-bms-prod-redis` — 2× `cache.t4g.micro` | available, encrypted at rest/in transit, auth, automatic failover, snapshot 35 วัน |
| ALB | `ecs-express-gateway-alb-ff8c07dd` | ใช้ร่วมกันทั้ง prod และ uat, 3 ENI/EIP |
| EC2 | `i-0f3b3881690dcf874` `watchdog-bms-ssm-bastion` `t3.nano` | เปิดค้าง มี public IP |
| ECR | `watchdog-bms-api` / `-ai-gateway` / `-workers` / `-web` | lifecycle เก็บ 20 images; `watchdog-bms-migration-tool` ยังไม่มี policy |
| AgentCore | runtime `watchdog_orchestrator` | READY |
| App Runner | 2 service legacy | PAUSED — pause หยุดคิดเงินจริง ($11.95 → $0) |

**ถูกลบไปเมื่อ 2026-08-07:** NAT gateway `nat-06303bcc18968c82d` และ Production Redis ก้อนเดิม;
Production Redis ถูกสร้างใหม่เป็น replication group ตาม M-17 เมื่อ 2026-08-08

Network: subnet public 3 อัน (main route table → IGW) และ private 2 อัน (`rtb-07f3ced2ad683cd23`) ซึ่งตอนนี้
เหลือ route `local` อย่างเดียวหลังลบ NAT — ในนั้นมีแค่ ENI ของ UAT RDS กับ UAT Redis ซึ่งไม่ออกอินเทอร์เน็ต
Fargate ปกติรันใน **public subnet** ออกทาง IGW ไม่ใช่ NAT แต่ production A5 สร้าง interface endpoint
ECR API/DKR, Logs และ Secrets Manager พร้อม `PrivateDnsEnabled=true` ใน VPC เดียวกันเมื่อ 2026-08-10
จึงทำให้ชื่อ AWS service เหล่านี้ของ UAT วิ่งเข้า private endpoint ด้วย ไม่ได้ออก IGW. Endpoint SG และ policy
ต้อง allowlist execution role พร้อม SG ของทุก runtime ที่ยังใช้ VPC นี้: UAT ใช้
`watchdog-bms-uat-app-egress-sg`/`watchdog-bms-uat-ai-egress-sg`; production ใช้
`watchdog-bms-prod-app-egress-sg`/`watchdog-bms-prod-ai-egress-sg`. ถ้าขาด role, policy หรือ SG จุดใด
task จะ timeout ก่อนเริ่ม container แม้ public route ปกติ. Task production เก่าที่ยังรันอยู่ไม่ใช่หลักฐานว่า
พร้อม deploy เพราะมัน pull image/secret ก่อนสร้าง endpoint เหล่านี้

---

## 2. เครื่องมือหลอกตาตรงไหน — อ่านก่อนเชื่อ output

นี่คือส่วนที่กิน context ของ agent มากที่สุดถ้าไม่รู้มาก่อน

**`aws ecs describe-services` ใช้กับ Express Mode ไม่ได้** มันคืน `desiredCount: 0`, `runningCount: 0`,
`taskDefinition: null` ให้ทุก service ไม่ว่าจริง ๆ จะรันอยู่หรือไม่ — เคยทำให้สรุปผิดว่า production ล่ม
ใช้ `aws ecs describe-express-gateway-service --service <arn>` แทน แล้วอ่าน `activeConfigurations[0]`

**Express Mode ไม่มี `desiredCount`** capacity อยู่ที่ `activeConfigurations[0].scalingTarget`
(`minTaskCount` / `maxTaskCount`) คำสั่ง `--desired-count` จะได้ `Unknown options` กลับมา

**`update-express-gateway-service` เป็น full replace ไม่ใช่ patch** ต้องส่ง 9 key ครบทุกครั้ง
(`serviceArn`, `executionRoleArn`, `healthCheckPath`, `primaryContainer`, `taskRoleArn`,
`networkConfiguration`, `cpu`, `memory`, `scalingTarget`) ห้ามพิมพ์เอง — ให้ round-trip จาก
`describe-express-gateway-service` แล้วเปลี่ยนเฉพาะฟิลด์ที่ต้องการ ไม่งั้น env/secret หายทั้งชุด

**CI ที่ conclusion เป็น `success` ไม่ได้แปลว่าเทสรัน** commit ที่แตะแต่ docs จะ skip ทุก job
รวมถึง Typecheck and Test แล้วยังจบเป็น success — และ `deploy-uat` ยอมรับ run แบบนั้น
ถ้าจะยืนยันว่าโค้ดถูกเทสจริง ต้องเปิดดู job ไม่ใช่ดูแค่ conclusion

---

## 3. เปิด / ปิด

การ deploy release ใหม่ทั้ง UAT และ Production ใช้ canonical flow ที่
`docs/runbooks/uat-production-v2-deployment.md`. ส่วนนี้อธิบาย cloud operation และ capacity;
ห้ามใช้คำสั่ง Production V1 จากเอกสาร historical.

### UAT — deploy

Deploy ทำผ่าน GitHub workflow เท่านั้น ไม่ใช่จากเครื่อง (`infra/prod-ecs-express/README.md`)
controller ต้องรันจาก `main` ส่วน `release_ref` เป็น SHA เต็มที่ reachable จาก `develop`

```sh
gh workflow run deploy-uat.yml --ref main \
  -f release_ref=<lowercase-40-char-sha> -f target=all -f run_m01_acceptance=false
```

warm all-target คาด 17–19 นาที; run `31468653715` attempt 2 ที่ reuse image แล้วใช้เวลา
14m51s ใน deploy job. ตรวจผลด้วย **digest จริง** ไม่ใช่แค่สถานะ workflow:

```sh
aws ecs describe-tasks --cluster watchdog-bms-uat --tasks <arn> \
  --query 'tasks[0].[group,containers[0].image]' --output text
aws ecr describe-images --repository-name watchdog-bms-workers \
  --image-ids imageDigest=<digest> --query 'imageDetails[0].imageTags'
```

tag จะเป็น `git-<full-sha>` ต้องตรงกับ SHA ที่สั่ง deploy

ก่อน reusable CI/build เริ่ม workflow จะใช้ deploy role เดิมทำ read-only early preflight:
exact-read deploy/release-task policies, ตรวจสาม service ให้ stable/singleton พร้อม canary,
rollback alarm และ circuit breaker เดิม, ตรวจ metadata ของ secret ที่ runtime ต้องใช้ และบังคับ
rollback alarms ทั้งสามเป็น `OK`. ถ้า fail จะหยุดก่อน publish image; exact IAM readback ยังรันซ้ำ
ใน deploy job ก่อน mutation เพื่อกัน policy drift ระหว่าง build. Script ที่ใช้จริงคือ
`infra/uat/verify-deploy-readiness.sh`; ห้ามแก้ให้ต้อง health ผ่าน เพราะ UAT ที่ pause หรือ app เสีย
ต้องยัง deploy ตัวแก้ได้

**Release task network (พิสูจน์ 2026-08-11):** ต้นเหตุของ run `31408125154` attempts 1/2 ไม่ใช่
subnet เสีย แต่เป็น production A5 interface endpoints ด้านบน: private DNS มีผลทั้ง VPC ขณะที่ endpoint
SG/policy เดิมรับเฉพาะ A5 task ทำให้ UAT release task ติดต่อ Secrets Manager ไม่ได้ทุก AZ. หลังเพิ่ม
execution role ของ UAT ลง policy แบบจำกัดเฉพาะ UAT secrets/ECR repos/log groups และเพิ่ม UAT app SG
ใน endpoint SG, release task/migration ผ่าน; AI Gateway ยัง rollback เพราะใช้ AI SG แยก จึงเพิ่ม SG นั้น
ด้วย. Run `31418060978` attempt 3 จาก source `aca76203239feac359988938768ab66132c2018a`
ผ่าน all-target, health/digest verification และ signed UAT acceptance ครบ. `run-release-task.sh` ยังมี
subnet failover เป็น safety net เฉพาะ `TaskFailedToStart` ก่อน container เริ่มและไม่มี exit code เท่านั้น;
ห้าม retry เมื่อ container เริ่มแล้วเพราะอาจทำ mutation ซ้ำ

**Production preflight (พบ 2026-08-11):** production runtime ใช้ execution role
`ecsTaskExecutionRole` และ SG สองตัวด้านบน แต่ endpoint policy/SG ที่แก้ UAT รอบแรกยังไม่รวมสามจุดนี้.
ก่อน rollout production ครั้งแรกต้องเพิ่ม role แบบจำกัดเฉพาะ runtime ECR repositories,
`watchdog-bms/production/*` secrets และ `/ecs/watchdog-bms-prod-*` log groups พร้อม SG สองตัว แล้ว
read-back policy และ endpoint boundary ให้ตรง template; ห้ามใช้ task เก่าที่ยัง ACTIVE เป็นหลักฐานแทน

### UAT — ปิด (จอดที่ศูนย์)

วิธีที่ถูกต้องคือผ่าน deploy script ซึ่งรองรับตั้งแต่ commit `333e711`:

```sh
ECS_EXPRESS_MIN_TASKS=0 ECS_EXPRESS_MAX_TASKS=0 \
  bash infra/uat/deploy-with-runtime-mutex.sh all
```

default คือ `1`/`2` และ **production ปฏิเสธค่าอื่นทันที** เพราะ
`infra/security/collect-production-a5-current-health.sh` เทียบ service จริงกับ literal
`{minTaskCount:1,maxTaskCount:2,AVERAGE_CPU,70}` ตอนเก็บ signed evidence

ถ้าจำเป็นต้องทำตรง ๆ กับ API ให้ round-trip ตามข้อ 2 อย่าพิมพ์ payload เอง

**ไทม์ไลน์หลังสั่งปิด** (วัดจริง): task drain หมดใน ~4 นาที แล้ว ENI กับ public IPv4 ถูกคืนอีก
~6 นาทีหลังจากนั้น service ยังคงเป็น `ACTIVE` พร้อม image และ config เดิม — เปิดกลับคือการปรับ
capacity ไม่ใช่ deploy ใหม่

### UAT — เปิดกลับ

**ตั้งแต่ 2026-09-05 ห้ามใช้ `deploy.sh` จากเครื่องเพื่อเปิดกลับ:** `deploy.sh` รุ่นที่ deploy อยู่ (ตั้งแต่ `71263dd0`)
ปฏิเสธ service rollout ทุกแบบถ้าไม่มี `RELEASE_PARENT_OPERATION_ID`, `RELEASE_TASK_IMAGE` และ
`DEPLOYMENT_EVIDENCE_DIR` จาก release task (พิสูจน์แล้ว: `bash infra/uat/deploy-with-runtime-mutex.sh all`
จาก checkout ที่ `71263dd0` จบด้วย rc=2 พร้อมข้อความนั้น) ให้ใช้ API round-trip ตามข้อ 2 แทน:

```sh
export AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 AWS_REGION=ap-southeast-1
for arn in $(aws ecs list-services --cluster watchdog-bms-uat --query 'serviceArns[]' --output text); do
  aws ecs describe-express-gateway-service --service "$arn" --output json > before.json
  jq '.service.activeConfigurations[0] as $c | {serviceArn: .service.serviceArn,
        executionRoleArn: $c.executionRoleArn, healthCheckPath: $c.healthCheckPath,
        primaryContainer: $c.primaryContainer, taskRoleArn: $c.taskRoleArn,
        networkConfiguration: $c.networkConfiguration, cpu: $c.cpu, memory: $c.memory,
        scalingTarget: ($c.scalingTarget | .minTaskCount = 1 | .maxTaskCount = 2)}' before.json > payload.json
  aws ecs update-express-gateway-service --cli-input-json file://payload.json >/dev/null
done
```

คัดลอก 9 key จาก describe ทั้งชุด เปลี่ยนเฉพาะ `scalingTarget` (image/env/secrets ต้องเหมือนเดิม byte-for-byte —
ตรวจด้วย jq ก่อนยิง) หลัง update แต่ละ service จะมี **`activeConfigurations` สองตัว** (revision เก่า 0/0 กับใหม่ 1/2)
ประมาณ 3 นาทีจน deployment ของ revision ใหม่จบ (`aws ecs list-service-deployments --service <arn>` เป็น
`SUCCESSFUL`) ต้องรอจน `length(service.activeConfigurations) == 1` ทั้งสาม service **แล้วรัน
`infra/uat/verify-deploy-readiness.sh` จากเครื่อง (read-only, env `DEPLOY_ENV=uat ECS_CLUSTER_NAME=watchdog-bms-uat`)
ให้ผ่านก่อน** ค่อย dispatch `deploy-uat.yml` — สั่งเร็วไปจะล้มที่ preflight ด้วย
`api-web is not a stable singleton UAT service` (run `33946705432`, 2026-09-05) และเสีย dispatch ไปหนึ่งครั้ง
**`run-a5-capacity-mutating.sh` ต้องการ `minTaskCount >= 1`** ต้องเปิดก่อนรัน U5 capacity

### Production

**Promotion poster by hotfix (owner 2026-09-30: short path, no console yet).** Ship a new poster
with `infra/kamal/deploy-prod-hotfix` on top of the serving Production SHA, not through UAT and
`promote-prod`. Add the image under `apps/web/public/assets/` with a new versioned file name (for
example `package-poster-YYYYMMDD.png`) and never overwrite a served one, because LINE and Cloudflare
cache images by URL. LINE needs PNG or JPEG under 1 MB, because the same URL is also the preview.
The code change that points to it is ordinary `.ts` (today `PACKAGE_POSTER_PATH` in
`line-staff-menu.logic.ts`). Declare the image, the `.ts` and each changed spec with `--hotfix-path`,
pass each changed spec with `--regression-test` ([rules](../../infra/kamal/README.md)), and land the
same change on develop and main so the next release keeps it.

Production release ใหม่ต้องผ่าน signed UAT Passport และ Production READY แล้ว dispatch
`deploy-production-v2.yml` ตาม `uat-production-v2-deployment.md`; ห้ามเรียก `deploy.sh` จาก
workstation เพื่อทำ promotion. ค่า capacity/status ด้านล่างเป็น inventory/diagnostic context เท่านั้น.

ณ 2026-08-15 ทั้งสาม service มี capacity `1/2`, source SHA เดียวกัน `748f1fa…` และมี task รันครบ
แต่จงใจอยู่ใน `maintenance_only`; App Runner legacy ทั้งคู่ยัง PAUSED

> **Production Redis topology/hardening ของ M-17 พิสูจน์แล้ว:** CloudTrail `CreateReplicationGroup` วันที่ 2026-08-08
> บันทึก 2 nodes, Multi-AZ/automatic failover, encryption at rest/in transit, auth token และ snapshot
> retention 35 วันโดยไม่มี error. Production readiness run `31789220329` วันที่ 2026-08-14
> (`sourceCommit=748f1fa87f57e4c7b899e7dfec5bd62ea2d8c916`) ผ่าน
> `productionRuntime=PASS` และ artifact integrity; `production-runtime.json` SHA-256
> `17148172d4157d19333684c3b84d362c3de53e4de053c76e4f4e62bf8798f8f7` อ่านค่าครบตรงกับ
> live cache nodes ที่ `available`. Workstation ยังไม่มี `DescribeReplicationGroups` โดยตั้งใจ;
> ไม่ต้องขยายสิทธิ์หรือ rebuild ก้อนนี้ ให้ใช้ dedicated readiness role เป็น canonical read-back ต่อไป
> แต่ M-17 รวมยังห้ามปิดจน restore/RTO/RPO, post-restore re-erasure และ secret rotation/revocation ผ่าน

---

## 4. ดูตรงไหน

**Production API boot กับอีเมลที่ปิดอยู่ (2026-09-07):** run `34072334980` ล้มก่อน migration เพราะ
`deploy.sh` render `SES_FROM_ADDRESS=""` แต่ `apiConfigSchema` ยอมให้ละ field นี้ได้ ไม่ยอมรับค่าว่าง.
`EMAIL_PROVIDER=disabled` ไม่ข้าม schema validation. Production workflow ต้องส่ง sender ที่ถูกต้อง
ผ่าน `SES_FROM_ADDRESS` (fallback `contact@mangmeeplus.com` เหมือน UAT); ค่านี้ไม่เปิดส่งอีเมลหรือเพิ่ม
สิทธิ์ SES. เมื่อวิเคราะห์ task ที่ exit ก่อน health ให้ดู startup log และตรวจ environment กับ schema
จริงด้วยค่าลับจำลอง ไม่เก็บ runtime secret ลง log. หลักฐาน: `docs/agent-memory/production-disabled-email-env-2026-09-07.md`.

```sh
# service จริง ๆ เป็นยังไง (อย่าใช้ describe-services)
aws ecs describe-express-gateway-service \
  --service arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-workers

# task ที่รันอยู่ + ขนาด
aws ecs describe-tasks --cluster watchdog-bms-uat --tasks <arn> \
  --query 'tasks[].{group:group,cpu:cpu,mem:memory,started:startedAt}'

# มี restart loop ไหม — นับ stream ต่อวัน ปกติคือหลักหน่วย
aws logs describe-log-streams --log-group-name /ecs/watchdog-bms-uat-workers \
  --order-by LastEventTime --descending --max-items 10

# ค่าใช้จ่ายแยก service
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=<YYYY-MM-DD>,End=<YYYY-MM-DD> \
  --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE

# เจาะว่า usage type ไหนกิน
aws ce get-cost-and-usage --region us-east-1 --time-period Start=...,End=... \
  --granularity DAILY --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["AmazonCloudWatch"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE
```

Cost Explorer คิด **$0.01 ต่อ request** และข้อมูล **ทยอย post ข้าม 24 ชม.** — ยอดที่ query ตอนเช้าอาจ
ต่ำกว่าความจริงมาก (ใน session นี้ตัวเลขเดียวกันขยับจาก $173 เป็น $263 ระหว่าง query สองครั้ง)

### Employee LINE webhook — UAT + Production (ตรวจ live 2026-08-18)

Webhook ของ OA `uat-mangmeeplus` ต้องชี้ไปที่ค่า SSM
`/watchdog-bms/uat/ecs-express-api-web-url` ต่อท้าย `/v1/line/webhook`. อย่าใช้
`https://uat.mangmeeplus.com/v1/line/webhook` จนกว่าจะแก้ POST timeout: custom domain ตอบ
`GET /v1/health` เป็น 200 แต่ LINE provider webhook test ได้ `REQUEST_TIMEOUT`; URL ของ ECS Express
โดยตรงได้ `success=true`, `statusCode=200`, `reason=OK` และถูกตั้งเป็น live endpoint แล้ว.

หลังเปลี่ยนหรือ deploy UAT ให้ read-back endpoint และรัน provider test เสมอ; health GET อย่างเดียว
ไม่พิสูจน์ webhook POST. อ่าน access token จาก Secrets Manager แบบไม่พิมพ์ค่า แล้วใช้ Messaging API
`GET/PUT /v2/bot/channel/webhook/endpoint` และ `POST /v2/bot/channel/webhook/test`. หลักฐาน acceptance
และเหตุการณ์ synthetic ที่จบ `completed` อยู่ใน `docs/agent-memory/uat-ai-not-responding.md`.

Production เคยชี้ `https://mangmeeplus.com/v1/line/webhook` และ LINE provider test ได้
`REQUEST_TIMEOUT` แบบเดียวกัน ขณะที่ ECS Express origin โดยตรงผ่าน. หลัง owner อนุมัติ live endpoint
ของ OA `มั่งมี Plus` ถูกเปลี่ยนเป็นค่า SSM
`/watchdog-bms/production/ecs-express-api-web-url` ต่อท้าย `/v1/line/webhook`; exact read-back ได้
`active=true` และ configured-endpoint test ได้ `success=true`, `statusCode=200`, `reason=OK`.
การแก้นี้ไม่ใช่ ECS deploy และไม่เปลี่ยน customer gate. ห้ามยิง synthetic business message ใน
Production เพื่อพิสูจน์ต่อเอง; ให้ใช้ข้อความจริงของพนักงานที่ได้รับอนุญาต.

โปรไฟล์ local แยกชัดเจน: `thawatchai` คือ AWS root ส่วน `watchdog-bedrock` และ
`watchdog-bedrock-dev` คือ IAM user `watchdog-bedrock-dev`. จาก audit 2026-08-12 ไม่มี platform
หรือ bootstrap role ที่ user นี้ assume ได้; GitHub OIDC roles ทั้งหมดก็ไม่มีสิทธิ์แก้ IAM. User
อ่าน `GetRole` และเขียน `PutRolePolicy/CreateRole` บางส่วนได้จาก policy เก่า แต่ขาด
`GetRolePolicy`, `UpdateRole` และ `UpdateAssumeRolePolicy` สำหรับ promotion roles จึงห้ามใช้ root
สร้าง boundary หรือแก้ target roles. ต้องให้ owner/provider จัด non-root platform-admin session
ชั่วคราว แล้วใช้ temporary non-root boundary ที่สร้างและถอดได้ตาม
`docs/runbooks/production-promotion-prerequisite-bootstrap.md`; Readiness จะ exact-readback ซ้ำ
ก่อนออก READY. ถ้าโดน AccessDenied แล้วอยากรู้ว่า policy ไหนบล็อก ใช้ Policy Simulator แบบ
read-only ได้

Audit promotion prerequisite วันที่ 2026-08-12 พบ drift ที่ทำนายได้ก่อน rollout: deploy role
ยังมี `MaxSessionDuration=3600`, workers cleanup policy ยังไม่มี, A5 execution trust/policies บางตัว
ยังเป็น contract เก่า, API/AI runtime task policy ยังเป็น generated contract รุ่นเก่า และ Production
S3 lifecycle ขาด `NoncurrentVersionExpiration` ใน rule `expire-uncompleted-uploads`. Readiness V2
จึงต้อง exact-read ทั้ง IAM/runtime roles, secret metadata, SSM pointers, cluster/network,
S3/log/KMS/SNS และ fail ก่อนออก READY; ห้ามไปค้นทีละ error ระหว่าง deploy. การซ่อม drift ทั้งหมด
ใช้ consolidated non-root ceremony เดียวตาม runbook ด้านบน แล้วลบ temporary authority.

Live RDS source ที่ยืนยันใน audit เดียวกันคือ `watchdog-bms-prod-db`, DB name `watchdog_bms`,
master username `watchdog`, port `5432`; clone runner ต้อง derive `PGDATABASE`, `PGHOST` และ
`PGPORT` จาก `DescribeDBInstances` ของ clone ห้าม hardcode หรืออ่านจาก workstation.

> **A5 security-group read-back:** `describe-security-groups` อาจ canonicalize กฎ egress
> TCP/443 ที่มี endpoint security group และ S3 prefix list เป็น `IpPermission` เดียว แม้ส่งคำสั่ง
> authorize แยกกันสองครั้ง ให้ตรวจ resource targets ทั้งสองแบบ semantic; อย่าเทียบจำนวน
> `IpPermissions` ว่าต้องเป็นสอง object

### UAT DB จากเครื่อง dev (เพิ่ม 2026-08-10)

UAT RDS ไม่ public — เข้าโดย port-forward ผ่าน SSM bastion `watchdog-bms-ssm-bastion`
ต้องมี `session-manager-plugin` (`brew install --cask session-manager-plugin`) และ psql
(`brew install libpq` ได้ client อย่างเดียว keg-only ที่ `/opt/homebrew/opt/libpq/bin/psql`)

**แท็บที่ 1 — เปิดอุโมงค์ค้างไว้** (Ctrl-C ปิด):

```sh
infra/uat/db-port-forward.sh                        # 127.0.0.1:55432 → UAT RDS:5432
```

**แท็บที่ 2 — ใช้งาน** อุโมงค์ต้องเปิดอยู่:

```sh
psql "$(infra/uat/db-port-forward.sh --url)"        # URL จาก secret ชี้อุโมงค์ให้แล้ว
infra/uat/db-port-forward.sh --fields               # host/port/db/user/password สำหรับ DBeaver
```

`--url` แก้ URL ที่เก็บใน secret สองจุดเพราะ libpq ไม่รับของ Prisma: ตัด `schema=public`
(psql ตอบ `invalid URI query parameter: "schema"`) และลด `verify-full` เป็น `require`
เพราะ cert ของ RDS ไม่ match ชื่อ `127.0.0.1` — ยังเป็น TLS อยู่ แค่ไม่ตรวจชื่อโฮสต์

DBeaver ต้องชี้ **Host `127.0.0.1` Port `55432`** ไม่ใช่ RDS host ที่ `--fields` พิมพ์ออกมา
(ช่องนั้นมีไว้ดูว่าอุโมงค์ปลายทางไปไหน) ส่วน database/user/password ใช้ตามที่พิมพ์ได้ตรง ๆ

script ตรวจ SG ให้ก่อนเปิด: ถ้า UAT DB SG ยังไม่รับ bastion SG บน 5432 จะพิมพ์คำสั่ง
`authorize-security-group-ingress` ให้ copy ไปรัน (รูปแบบเดียวกับ production support path)

**ล้าง LINE link รายบัญชีเพื่อเทสซ้ำ** — survey ก่อนเสมอ แล้วค่อย `--apply`:

```sh
# 1. หาว่ามีบัญชี LINE ไหน link อยู่
psql "$(infra/uat/db-port-forward.sh --url)" -c 'SELECT ei."providerUserId", ei.status, u.email FROM "ExternalIdentity" ei JOIN "User" u ON u.id = ei."userId" WHERE ei.provider = $$LINE$$ ORDER BY ei."linkedAt" DESC;'

# 2. ดูว่าจะโดนอะไรบ้าง (ไม่ลบ)
scripts/heal/line-link-reset.sh "$(infra/uat/db-port-forward.sh --url)" <LINE_USER_ID>

# 3. ลบจริงใน transaction เดียว
scripts/heal/line-link-reset.sh "$(infra/uat/db-port-forward.sh --url)" <LINE_USER_ID> --apply
```

ลบเฉพาะ `ExternalIdentity` (provider=LINE), `LineCompanyContext`, `LineWebhookEventLog`
ของ LINE id นั้น — webhook log จับคู่ด้วย sha256 hex 16 ตัวแรก ตรงกับ `hashMessagePreview()`
**ไม่แตะ** `EmployeeLineLinkToken` (ผูกกับ membership ไม่ใช่บัญชี LINE — ออก QR ใหม่แทน)
และ identity ฝั่ง CRM ลูกค้า; ปฏิเสธ URL ที่มีคำว่า `prod` ทันที

### CloudWatch log retention — policy ปัจจุบัน (อัปเดต 2026-08-09)

| ขอบเขต | Log group/prefix | เก็บไว้ |
| --- | --- | ---: |
| UAT | `watchdog-bms-uat-*` | **3 วัน** |
| Production | `watchdog-bms-prod-*` | **14 วัน** |
| Production support session | `/aws/ssm/session-logs/watchdog-bms-production` | **14 วัน** |
| กลุ่ม production เดิม | กลุ่ม legacy ที่ชื่ออยู่ใต้ `watchdog-bms-*` และ App Runner production เดิม | **14 วัน** |

ตารางนี้คือ policy ที่ต้องถือเป็นค่าปัจจุบันสำหรับ CloudWatch logs; ไม่ใช่ retention ของ AI data,
database backup หรือ GitHub artifact ซึ่งมีนโยบายแยกกัน ไฟล์นี้แก้จากค่าที่เคยระบุ UAT 30 วัน,
production 90 วัน และบางกลุ่มไม่จำกัดเวลา

AWS read-back วันที่ 2026-08-09 ยืนยันแล้วว่า log group ที่ใช้งาน 14 กลุ่มตรงตาม policy:
กลุ่ม UAT ที่มีอยู่ 3 กลุ่มเป็น 3 วัน และกลุ่ม production/legacy/support ที่มีอยู่ 11 กลุ่มเป็น
14 วัน ส่วน `/probe/invalid/xyz-does-not-matter-if-denied` เป็นกลุ่มทดสอบที่ยัง `None`
โดยตั้งใจและไม่อยู่ใน service log retention baseline

Alarm install/read-back วันที่ 2026-08-15 เวลา 01:10 น. (UTC+7): Production มี contract ที่
verify กับ datapoint จริงผ่านแล้วครบ 9 alarms จาก `infra/monitoring/runtime-alarms.sh` ได้แก่
`IncomingBytes` 3 app groups, Redis memory แบบ per-node 2 nodes, RDS storage/memory/connections/
CPU credit และทุก alarm ชี้ไป confirmed SNS subscription. Script SHA-256 ที่ใช้คือ
`12a21225a68a133b953490a7fd66764031ff0190e14333b265006063bb126157`.
SNS accepted a sanitized canary publish with MessageId
`198e9125-6a84-5124-866b-f3dc35bfe21e`. Owner-supplied inbox evidence on 2026-08-15 confirmed
delivery; only screenshot SHA-256 `f524646240c97510a4a500e1bcfecedf064e2549f620081dbd586605d09451bb`
is retained because the image exposes the mailbox and unsubscribe endpoint.

Alarm Redis เดิม `watchdog-bms-prod-redis-memory-high` ที่ใช้ `ReplicationGroupId` และไม่มี datapoint
ถูก retire แล้วเมื่อ 2026-08-15 02:54:25 UTC+7 หลัง valid per-node alarms verify ผ่าน; CloudTrail event
`b7ab5aed-5fda-43e0-ba26-ea15da175ce1` และ post-delete `DescribeAlarms=0` เป็นหลักฐาน.
**UAT ยังไม่มี alarm ชุดใหม่** เพราะ encrypted Redis v2 ยังไม่ถูกสร้าง. เหตุการณ์ UAT workers
วันที่ 6 ส.ค. ingest 214,075,786,774 bytes ในวันเดียว แต่ 24 ชั่วโมงก่อน audit เหลือประมาณ
2,984,094 bytes แปลว่า incident หยุดแล้วแต่ UAT preventive control ยังต้องเพิ่มตาม
`docs/plans/uat-production-runtime-config-remediation-plan.md` Phase 3

---

## 5. Redis / BullMQ — memory

**สร้าง Queue ได้ที่เดียว** `apps/workers/src/common/queue.ts` เท่านั้น มี `defaultJobOptions`
คุม `removeOnComplete: {count: 48}` / `removeOnFail: {count: 100}` และ
`apps/workers/src/common/queue.spec.ts` บังคับว่าห้ามไฟล์อื่นเรียก `new Queue(` — ถ้าเพิ่มคิวใหม่แล้ว
เรียกเอง เทสจะแดง นี่คือผลจากเหตุการณ์ที่ 6 ใน 7 คิวลืมตั้ง retention จน Redis 400 MB มี 270k key

**`maxmemory-policy` ต้องเป็น `noeviction`** UAT ใช้ parameter group `watchdog-bms-uat-redis7` แล้ว
ตั้งแต่ 2026-08-07 (`default.redis7` แก้ไม่ได้ จึงต้องสร้าง custom) วิธีทำอยู่ใน `infra/uat/README.md`

เหตุผลที่ลึกกว่าคำเตือนของ BullMQ: `volatile-lru` ลบเฉพาะ key ที่มี TTL ซึ่งในระบบนี้คือ
**rate-limit counters กับ actor-delegation replay store** ส่วน job record ของ BullMQ ที่ไม่มี TTL
และเป็นตัวที่ทำให้เต็มจริงกลับไม่เคยเป็นเป้า — cache จะทิ้ง security state เงียบ ๆ ก่อนแล้วค่อย OOM อยู่ดี

Live metric วันที่ 2026-08-15 หลังแก้ retention: UAT ใช้ ~18.3 MB (`DatabaseMemoryUsagePercentage`
~4.54%); Production สอง node ใช้ ~17.3/~17.1 MB (~4.30/~4.24%); eviction เป็นศูนย์ทุก node.
UAT เปิดอยู่ที่ capacity 1/2 ในรอบตรวจนี้ จึงต้องจอดกลับเมื่อ acceptance จบ ไม่ใช่อาศัยสมมติฐานว่า
ยังจอดอยู่

**อย่าเชื่อ Redis alarm เดิมแม้ state เป็น `OK`:** `watchdog-bms-prod-redis-memory-high` ใช้
dimension `ReplicationGroupId=watchdog-bms-prod-redis`, แต่ `DatabaseMemoryUsagePercentage` ของก้อนนี้
ออกด้วย `CacheClusterId`/`CacheNodeId`. Query 24 ชั่วโมงด้วย dimension ของ alarm ได้ 0 datapoints และ
state reason ระบุชัดว่า missing 2 จุดถูกนับเป็น non-breaching. ตอนนี้ per-node alarms มี datapointจริง
และตัวเดิมถูก retire แล้วตาม remediation plan Phase 3; ห้ามสร้าง alarm แบบ `ReplicationGroupId` กลับมา

**crash ถูกจำกัดขนาด log แล้ว** `fatalDetail()` ใน `apps/workers/src/common/log.ts` ตัดที่ 2,000 chars
และ `main.ts` ดักทั้ง `unhandledRejection` / `uncaughtException` ก่อน parse config — ถ้าไม่มีตัวนี้
Node จะ inspect error object ทั้งก้อนซึ่งมี Lua script ของ BullMQ แปะมาด้วย (~162 MB ต่อ crash)

---

## 6. ค่าใช้จ่าย

Cost Explorer วันที่ 2026-08-15 สำหรับ 1–14 ส.ค. ได้ pre-tax **$362.08**, tax **$25.32**,
รวม **$387.397**. รายการใหญ่คือ CloudWatch $180.83, ECS $81.32, RDS $30.07, VPC $22.95,
ElastiCache $18.53 และ ELB $8.10. CloudWatch ส่วนใหญ่เป็น incident log ingest วันที่ 5–7 ส.ค.;
ไม่ใช่ steady-state ใหม่ทั้งหมด

AWS Budget มีอยู่แล้วชื่อ `WatchDog-BMS Monthly Cost Budget`, limit $100, actual $387.397,
forecast $787.792 พร้อม email subscriber สำหรับ actual 85%/100% และ forecast 100%. ไม่ต้องสร้างซ้ำ;
ให้ปรับ baseline/threshold หลังแยก tag และมีเดือนที่ไม่มี incident ตาม remediation plan

Platform-admin pass วันที่ 2026-08-15 tag live cost-bearing inventory 49 resources ครบ
`Environment`/`Component`/`ManagedBy`: production 21, shared 16, UAT 12 และ aggregate read-back
มี invalid contract ศูนย์. `Environment` cost-allocation tag เป็น `Active`; `Component` ยังรอ Billing
discover key ก่อน activate. ค่าใช้จ่ายเดิม $387.397 ยังอยู่ช่อง blank เพราะ tag ไม่ย้อนหลัง และต้องรอ
ค่าใช้จ่ายใหม่ post ก่อนยืนยัน Cost Explorer แยกสาม environment ได้จริง.

Cost Anomaly Detection มีอยู่แล้ว: SERVICE monitor หนึ่งตัวและ DAILY confirmed email subscription
หนึ่งตัว ไม่ต้องสร้างซ้ำ. Threshold live เป็น absolute impact >= $100 **AND** percentage impact >= 40%;
จะลด threshold หรือไม่เป็น tuning decision แยกจากการพิสูจน์ว่า control มีอยู่จริง.

Bedrock **ไม่เคยเป็นต้นเหตุ** — $3.20 ทั้งเดือน แม้ IAM user จะชื่อ `watchdog-bedrock-dev`

### กับดักการวัดที่เคยทำให้ประเมินผิด 20–100 เท่า

- **CloudWatch คิดเงินจาก raw ingest แต่ `storedBytes` คือขนาดหลังบีบอัด** (~20 เท่า) log group
  แสดง 7.15 GB แต่ ingest จริง ~152 GB = $179 **ห้ามประเมินค่า log จาก `describe-log-groups`**
- **`imageSizeInBytes` ของ ECR นับ shared layer ซ้ำทุก image** รวมได้ 113 GB แต่บิลจริง $0.52
- **`NatGateway-Hours` กับ `NatGateway-Bytes` แยกกัน** NAT ที่ไม่มี traffic เลยก็ยังจ่าย $43.90/เดือน
  ตรวจว่ามีใครใช้จริงไหมด้วย `-Bytes` ไม่ใช่การมีอยู่ของ gateway

---

## 7. ระวัง

1. **ลบ NAT จาก Console ไม่ปลด Elastic IP ให้** EIP จะกลายเป็น unassociated แต่ยังถูกคิดเงิน $3.65/เดือน
   และเหลือ route `0.0.0.0/0` สถานะ `blackhole` ค้างใน route table — ต้องเก็บเองทั้งสองอย่าง
2. **explicit Deny ชนะ Allow เสมอ** การแนบ policy ใหม่ไม่ได้ลบ Deny ใน policy เดิม ต้องแก้ policy เดิม
   ด้วย `create-policy-version --set-as-default` ไม่ใช่แค่แก้ไฟล์ในเครื่อง
3. **`elasticache:ModifyCacheCluster` ตรวจสิทธิ์ทั้ง cluster ARN และ parameter-group ARN**
   scope แค่ cluster จะได้ AccessDenied ที่พูดถึง parameter group ทำให้ไล่ผิดทาง
4. **การลบ data store ของ production ควรทำด้วยสิทธิ์คน** guardrail บน user อัตโนมัติมีไว้แบบนั้นตั้งใจ
   ใช้ Console แทนการรื้อ policy
5. **workflow ทุกตัวเป็น `workflow_dispatch` ไม่มี cron** ไม่มีอะไรสร้าง resource เองตามเวลา
6. **`ECS_EXPRESS_SUBNET_MODE` default เป็น `public`** และ `deploy.sh` ยังปฏิเสธ `private` สำหรับ
   api-web ตรง ๆ ส่วน A5 clone/audit ใช้ endpoint-only private network แยกต่างหากและไม่ต้องสร้าง NAT
   คืนแล้ว: `bootstrap-production-a5-private-network.sh` สร้าง ECR API/DKR, Logs,
   Secrets Manager และ S3 endpoints พร้อม narrow SG/route read-back เมื่อ 2026-08-10. เพราะ interface
   endpoint ใช้ private DNS ระดับ VPC bootstrap จึงต้องรักษา execution-role policy และ task SG ของทั้ง
   UAT และ production runtime ใน boundary ด้วย; อย่าลบ allowlist เหล่านี้ขณะ endpoint ยังอยู่
   AWS CLI v2.36.15 ไม่มี waiter `vpc-endpoint-available`; bootstrap จึง poll `State` แบบ bounded
   และรับเฉพาะ `available` โดย fail ทันทีเมื่อเจอ terminal failure state
7. **UAT Redis ตัวที่รันอยู่ยังไม่ได้เข้ารหัส** ทั้ง at-rest, in-transit และไม่มี auth token — secret
   เก็บเป็น `redis://`. ห้ามใช้ขั้นตอนเก่าที่ลบ node และ force-delete secret ก่อนสร้างใหม่;
   helper `infra/uat/redis-blue-green.sh` ทำ blue/green แบบรักษา secret ARN/version rollback และใช้
   mutex ร่วมกับ deploy แล้ว แต่ยังไม่ได้ run กับ AWS; ลบ node เก่าหลัง soak เท่านั้น
8. **Production มี `IncomingBytes` alarm แล้ว แต่ UAT ยังไม่มี**. เพิ่ม UAT per-log-group alarm ก่อน
   acceptance รอบยาว; อย่าใช้ข้อความเก่าว่าไม่มี alarm ทั้ง account

### ECR scan gate — CVE ใหม่ใน base image

`infra/docker/verify-ecr-scan.sh` รันใน CI ทุก build แล้วส่ง finding จาก ECR เข้า
`infra/docker/ecr-scan-blocking-findings.jq` เกตนี้ **fail-closed**: HIGH/CRITICAL ทุกตัวที่ไม่มี waiver
ตรงเป๊ะจะบล็อก deploy และ `coverageComplete` ยังบังคับให้จำนวน finding ที่อ่านได้ตรงกับ severity count
ของ ECR ด้วย (กันกรณี ECR รายงานตัวเลขแต่ไม่ส่งรายละเอียด)

**bump base image ไม่ช่วย เมื่อ Debian ยังไม่มี fix** ฐานคือ `node:22-bookworm-slim` pin ด้วย digest
CVE ที่เจอส่วนใหญ่เป็นแพ็กเกจ Debian (openssl, zlib) ไม่ใช่โค้ดเรา ถ้า security-tracker บอกว่า bookworm
ยังไม่มี fixed version การดึง digest ใหม่ก็ได้แพ็กเกจเวอร์ชันเดิมกลับมา — เสียเวลา build ฟรี
เช็คก่อนเสมอที่ `https://security-tracker.debian.org/tracker/<CVE>` ดูช่อง bookworm ว่าเป็น
`vulnerable` หรือมีเลขเวอร์ชันที่ fix แล้ว

**bump digest 2026-09-19 — Node 22.23.2** เปลี่ยน pin ทั้ง 6 Dockerfile จาก `6c74791e…` เป็น `48e4b67d…`
รับ Node 22.23.1 → 22.23.2 (security release ก.ค. 2026 ปิด 3 HIGH: HTTP/2 สองตัว + Permission Model)
ชั้น Debian ไม่ขยับ — ยัง bookworm 12.15, 0 upgradable packages และ 5 CVE ที่ waive ไว้ยังไม่มี fixed
version ของ bookworm (อ่าน security-tracker 2026-09-19) เป็น bump ตามข้อ 2 ข้างล่าง ไม่ใช่ปลด waiver
(มี task แยกกำลังย้ายฐานไป `node:22-trixie-slim`/Debian 13 เพื่อปิด openssl 4 CVE นั้น) ระหว่างทางเจอว่า
path Kamal ไม่มีเกตนี้: `infra/kamal/release.py` ไม่เรียก `verify-ecr-scan.sh`, `mangmee-kamal-uat/releases`
ตั้ง `scanOnPush=false`, image production ที่ push 2026-09-18 ไม่มีผล scan — **เจ้าของตัดสิน 2026-09-19:
ยังไม่เพิ่ม scan gate ใน Kamal path (ต้องการความเร็วในการ deploy ช่วงแรก) จะสั่งสแกนเองเป็นรอบ ๆ**

**ย้ายฐานเป็น `node:22-trixie-slim` แล้ว (2026-09-19)** ทั้ง 6 Dockerfile ใช้
`node:22-trixie-slim@sha256:c5849ff9…` (Debian 13.7 / Node v22.23.2) เหตุผล: Debian 12 หมด regular
security support ไปแล้ว 2026-06-11 (เหลือ LTS ถึง 2028) ส่วน Debian 13 มี regular support ถึง
2028-08-09 CVE openssl 4 ตัวที่ waive อยู่ (CVE-2026-54874, CVE-2026-63072, CVE-2026-63076,
CVE-2026-75803) fix แล้วใน trixie `openssl 3.5.7-1~deb13u2` และ image ที่ build จริงก็ขึ้น
`libssl3t64 3.5.7` แล้ว — แถว waiver ผูกกับ `package_version 3.0.20-1~deb12u2` จึงหยุดแมตช์เอง
**ปลดแถวทิ้งได้เมื่อ ECR/Inspector ยืนยันว่า finding หายจริงบน image ที่ build แล้ว** (คอมมิตนี้ยังไม่ปลด)
ส่วน CVE-2026-85091 (zlib) ยังไม่มี fix ใน suite ไหน ต้องคงแถวไว้ — แต่ `zlib1g` ขยับจาก
`1.2.13.dfsg-1` เป็น `1.3.dfsg+really1.3.1` แล้ว จึงต้องเช็คด้วยว่า finding ยังรายงานเวอร์ชันเดิมอยู่ไหม
(ถ้าเวอร์ชันขยับ แถว waiver จะหยุดแมตช์และกลับไปบล็อกทันที)
ผล A/B เต็ม (unit/integration 13,689 เท่ากันทั้งสอง OS, e2e ทั้งชุด, web image ผ่าน login จริง) อยู่ใน `docs/qa/evidence/base-image-trixie-ab-verification-2026-09-19.md` และผลรอบเปิด flag ทุกตัวอยู่ใน `docs/qa/evidence/base-image-trixie-ab-flags-on-2026-09-19.md`

Trivy `--scanners vuln --severity CRITICAL,HIGH` บน image ที่ build จาก `Dockerfile.api-web`
(bookworm = tag ที่ build ไว้ก่อนหน้า `1406d382`, trixie ก่อนปิด login = `25591949`,
trixie หลังปิด login + ClamAV 1.5.4 = `a5a090e1`):

| Class | bookworm | trixie (ก่อน) | trixie (หลังปิด login) |
| --- | --- | --- | --- |
| `os-pkgs` (debian) | 1 CRITICAL / 19 HIGH | 0 CRITICAL / 26 HIGH | **0 CRITICAL / 18 HIGH** |
| `lang-pkgs` (node-pkg ใน base npm) | 1 CRITICAL / 10 HIGH | 1 CRITICAL / 10 HIGH | 1 CRITICAL / 10 HIGH |

ที่หายไป: `zlib1g` CVE-2023-45853 (CRITICAL ตัวเดียวของ image) และ `gzip` CVE-2026-41992

**trixie แยก `login` กับ `liblastlog2-2` ออกจาก `util-linux` — ต้อง purge เพิ่มสองชื่อ** รอบแรก
(`25591949`) โดน CVE-2026-76642 / 78408 / 78409 / 78410 เพิ่มมา 8 HIGH (4 CVE × 2 แพ็กเกจ) เพราะ
bookworm นับ CVE ชุดนี้เป็นของ `util-linux` ที่ purge ออกไปแล้ว แต่ trixie ย้ายมาอยู่คนละแพ็กเกจที่ list
เดิมไม่ครอบ เกต ECR fail-closed ทุก HIGH ที่ไม่มี waiver จึงจะบล็อก **ตัดสินใจ 2026-09-19: purge
เพิ่มเพื่อให้เท่ากับ runtime image เดิมของ bookworm** (ไม่ออก waiver ใหม่) — `login` บน trixie build
มาจาก source `util-linux` (`1:4.16.0-2+really2.41.5-0+deb13u1`) ไม่ใช่ Essential มีแค่
`/usr/bin/login`, `newgrp`, `sg`, `/usr/sbin/nologin` และ `liblastlog2-2` มี `util-linux` เป็น reverse
dependency เดียว runtime ไม่ได้ใช้เลย (ทุก process รันเป็น user `node` ไม่มี interactive login / su)
เติมชื่อไว้ท้ายบรรทัด purge เดิมทุก stage โดยคง `e2fsprogs` และลำดับเดิม assertion สองจุดใน
`infra/docker/production-image-security.spec.sh` (≈ บรรทัด 244/255) จึงยังผ่าน

**ClamAV 1.5.3 → 1.5.4 (2026-08-07) แล้ว** (pin sha256 `28d6efc5…`) ปิด CVE-2026-20339 (PESpin
integer overflow) กับ CVE-2026-20337/20338/20345/20346/20347/20348 และ CVE-2025-8088 ตาม upstream
**แต่ Trivy ยังรายงาน 12 HIGH เดิมครบทุกตัวบน `clamav 1.5.4-1`** เพราะ .deb ของ Cisco-Talos ลงทะเบียน
ตัวเองเป็นแพ็กเกจ Debian ชื่อ `clamav` แล้ว Trivy จับคู่กับ **Debian Security Tracker** ที่ไม่มี fixed
version ของ trixie เลย ทุก finding จึงเป็น `status: affected` / `FixedVersion: null` — bump เวอร์ชัน
upstream ไม่ทำให้ตัวเลขลด (18 HIGH เท่ากันทั้งก่อนและหลัง) เป็นรูปแบบเดียวกับ "bump ไม่ช่วยเมื่อ Debian
ยังไม่มี fix" ข้างบน ส่วน CVE-2026-20213…20217/20243/20244 นั้น upstream ปิดไปแล้วใน 1.5.3
ถือเป็น over-attribution ของ tracker เลข 12 HIGH นี้เท่ากันทั้ง bookworm และ trixie
(ของเดิม ไม่ได้เกิดจากการย้ายฐาน)

**t64 transition** Debian 13 เปลี่ยนชื่อ `libssl3` เป็น `libssl3t64` guard
`dpkg-query -W libssl3` ใน `apps/api/Dockerfile` กับ `infra/api-web/Dockerfile.api-web` จึงเปลี่ยนตาม
(ชื่อเดิมยัง exit 0 แบบ virtual package เลยไม่ fail ให้เห็น แต่ไม่ได้ยืนยันอะไรอีก) และ stage ที่ purge
ตระกูล util-linux ต้อง `apt-get update -y` ก่อน เพราะฐาน trixie ไม่ได้ติดตั้ง `e2fsprogs` มาด้วย
apt จึง resolve ชื่อไม่ได้เมื่อ list ว่าง (`E: Unable to locate package e2fsprogs`) ชื่อแพ็กเกจอื่นทั้งหมด
และ ClamAV 1.5.3 .deb ใช้ได้เหมือนเดิม

**กติกา waiver** (ดูตัวอย่างจริงในไฟล์ `.jq`): ทุกแถวต้องมี CVE ตรงตัว + `severity` + `package_name` +
`package_version` + anchor ที่คัดลอกจาก description ของ provider แบบคำต่อคำ + epoch หมดอายุ +
approval id ของ Owner ทั้งหมดต้องแมตช์พร้อมกัน — drift ตัวใดตัวหนึ่ง (เวอร์ชันขยับ, severity เปลี่ยน,
provider แก้ข้อความ) กลับไปบล็อกทันที `severity`/`package`/`version` เก็บระดับแถว จึงเพิ่มแถว CRITICAL
ได้โดยไม่ทำให้แถว HIGH เดิมหลวม และแต่ละชุดมี `def` หมดอายุของตัวเอง หมดอายุแยกกันได้
แก้ไฟล์แล้วต้องรัน `bash infra/docker/ecr-scan-blocking-findings.spec.sh` เสมอ

**กระบวนการที่ต้องมี ไม่ใช่ waive ไปเรื่อย ๆ**

1. re-scan ทุกคืนแล้วแจ้งเตือน — ให้รู้ CVE ใหม่ก่อนถึงวัน deploy ไม่ใช่ตอน pipeline แดง
2. คง base pin ไว้ แต่ bump digest เป็นรอบ ๆ เพื่อรับ fix ที่ Debian ปล่อยจริง
3. ใส่ `apt-get upgrade` ตอน build **เฉพาะเมื่อ** Debian มี fixed version แล้วเท่านั้น
4. ถึงวันหมดอายุให้ประเมินใหม่ — ถ้ายังไม่มี fix ต้องขออนุมัติต่ออายุใหม่ ไม่ใช่ยืด epoch เงียบ ๆ

> ⚠️ waiver หนึ่งแถวต้องเพิ่ม **สองไฟล์**: `infra/docker/ecr-scan-blocking-findings.jq` (เกต UAT/CI) และ
> `e0_ecr_waiver_rows` ใน `infra/security/evidence-contracts.jq` (production security preflight) —
> ใส่แค่ไฟล์แรก UAT ผ่านแต่โปรโมต production ถูกปฏิเสธ แก้แล้วรัน
> `bash infra/security/production-security-preflight.spec.sh` ด้วย

#### Waiver ledger

ทุกครั้งที่ออก ต่ออายุ หรือปลด waiver ให้เพิ่มแถวที่นี่ ห้ามแก้ epoch เงียบ ๆ โดยไม่มีแถว

| วันที่ | CVE | expiry เดิม → ใหม่ | approval id | หลักฐาน tracker (อ่านวันนั้น) |
| --- | --- | --- | --- | --- |
| 2026-08-27 | CVE-2026-14456, CVE-2026-54874, CVE-2026-63072, CVE-2026-63076 (HIGH, `openssl 3.0.20-1~deb12u2`) | — → `1788998400` (2026-09-10) | `CHAT-OWNER-DIRECTIVE-2026-08-27-FIX-ALL-UNTIL-DEPLOY-SUCCEEDS` | bookworm ยัง `vulnerable`, base ที่ pull ใหม่ 2026-08-27 ยังเป็น 3.0.20-1~deb12u2 |
| 2026-09-05 | CVE-2026-75803 (CRITICAL, `openssl 3.0.20-1~deb12u2`), CVE-2026-85091 (HIGH, `zlib 1.2.13.dfsg-1`) | — → `1789776000` (2026-09-19) | `CHAT-OWNER-DIRECTIVE-2026-09-05-UAT-DEPLOY-WAIVER` | bookworm openssl + zlib `vulnerable`, digest `node:22-bookworm-slim` ใหม่สุดก็ยังได้แพ็กเกจเดิม |
| 2026-09-05 | CVE-2026-54874, CVE-2026-63072, CVE-2026-63076, CVE-2026-75803, CVE-2026-85091 (ต่ออายุครบทั้ง 5 แถว) | `1788998400` / `1789776000` → `1791158400` (2026-10-05T00:00:00Z) | `CHAT-OWNER-DIRECTIVE-2026-09-05-CVE-WAIVER-RENEWAL-2026-10-05` | security-tracker อ่าน 2026-09-05: bookworm `openssl 3.0.20-1~deb12u2` ยัง `vulnerable` ทั้ง 4 CVE ไม่มี fixed version ของ bookworm (fix เฉพาะ trixie-security `3.5.7-1~deb13u2` และ sid `3.6.4-1`); CVE-2026-85091 **ไม่มี fixed zlib ใน suite ไหนเลย** — bump digest ไม่ช่วย |
| 2026-09-05 | CVE-2026-14456 — **ปลดแถวทิ้ง (retired)** ไม่ต่ออายุ | `1788998400` → ไม่มีแถวแล้ว | (ปลดตามกติกา M-18 ใน `p1-production-security-operations.md`) | ECR ไม่รายงาน finding นี้อีก และ tracker ขึ้น bookworm openssl เป็น `<not-affected> (Vulnerble code introduced later)` |
| 2026-09-21 | CVE-2026-85091 (HIGH, `zlib 1.3.dfsg+really1.3.1-1`) — trixie exact mapping แยกจากชุดเดิม | — → `1792540800` (2026-10-21T00:00:00Z) | `CHAT-OWNER-DIRECTIVE-2026-09-21-CVE-2026-85091-TRIXIE-WAIVER-2026-10-21` | ECR รายงาน finding หลังย้ายฐาน; Debian source `1:1.3.dfsg+really1.3.1-1` ไม่มี downstream patch และเก่ากว่า non-blocking gz* ที่ทำให้เกิด CVE แต่ tracker ยังขึ้น `vulnerable`. จำกัด waiver ด้วย CVE/severity/package/version/provider anchor ตรงตัวและยัง fail-closed เมื่อ drift |

ครั้งหน้าหมดอายุ **2026-10-05T00:00:00Z** ถ้าถึงวันนั้นแล้ว Debian ยังไม่มี fix ต้องขอ approval id ใหม่
อีกรอบ (ไม่ใช้ id เดิมซ้ำ) — เกตจะบล็อกทั้ง 5 แถวทันทีที่ `now >= 1791158400`

### โค้ดกับ AWS sync กันแล้ว (2026-08-09)

ก่อนหน้านี้ AWS กับเอกสารตรงกัน (UAT 3 / production 14) แต่ **โค้ดยังเป็น 90/30** และแย่กว่านั้นคือ
`deploy.sh` ไม่ได้แค่ตั้ง default ผิด — มัน **ปฏิเสธนโยบายจริง**:

| จุด | เดิม | ผล |
| --- | --- | --- |
| `deploy.sh:110` | `>= 30` | UAT 3 ถูกปฏิเสธ |
| `deploy.sh:114` | production `= 90` เป๊ะ | production 14 ถูกปฏิเสธ |
| `deploy.sh:624` | เขียน retention ทุก deploy | ทับค่าที่ตั้งด้วยมือทุกครั้ง |

ตั้ง `LOG_RETENTION_DAYS=14` แล้ว deploy production จะ **fail ทั้งรอบ** ไม่ใช่แค่ใช้ค่าเก่า

แก้แล้วให้ pin ทั้งสองฝั่ง: production ต้องเป็น **14 เป๊ะ** UAT ต้องเป็น **3 เป๊ะ** ปฏิเสธทั้งค่าที่ต่ำกว่า
และสูงกว่า เหตุผลที่ pin สองทางไม่ใช่ทางเดียว: `ensure_log_group()` เขียนค่าลง log group ทุกกลุ่ม
ที่มันแตะในทุก deploy ถ้าปล่อยไม่ pin ค่าที่ใครก็ตามใส่มาจะกลายเป็นนโยบายใหม่ในรอบถัดไป
โดยไม่มีใครตัดสินใจ — ซึ่งเป็นสาเหตุที่ทำให้ค่าจริงกับเอกสารหลุดจากกันตั้งแต่แรก

- **Production Stripe live enablement (2026-09-20)** — ดู
  [production-stripe-live-enablement.md](production-stripe-live-enablement.md); `BILLING_MODE`/`STRIPE_ACCOUNT_ID`
  อยู่ใน tracked `infra/kamal/config.json` (production) แล้ว แต่ service configuration ของ ECS Express Mode
  (`watchdog-bms-api-web-pub`) ต้อง enroll secret `watchdog-bms/production/stripe/*` (API round-trip) ก่อน deploy ถึงจะใช้ live ได้จริง

## 8. Delivery links ของใบรับรองแทนใบเสร็จ (`/d/{token}`) — ❌ ยกเลิกแล้ว (D15, 2026-08-20) ไม่ต้องทำ

> **ฟีเจอร์นี้ถูกถอดออกทั้งชุด** ตามมติ owner D15: เอกสารไม่ถูกส่งกลับ LINE เป็นลิงก์อีกต่อไป ผู้ใช้ไป
> โหลดเองที่เว็บ (ซึ่งเขา login อยู่แล้วเพื่อ certify/approve) จึง **ไม่มี prefix `line-delivery/`, ไม่มีสำเนา PDF
> ชั่วคราวบน S3, ไม่ต้องตั้ง lifecycle/noncurrent-version/no-`ListBucket` อะไรทั้งสิ้น** ตัดภาระ ops ก้อนนี้ทิ้ง
> เนื้อหาด้านล่างเก็บไว้เป็นบันทึกของสิ่งที่เคยมีและถูกถอด — ไม่ต้องดำเนินการใด ๆ

Feature branch `codex/line-substitute-receipt-assisted-issuance` ส่งเอกสารเข้า LINE เป็นลิงก์
`{web}/d/{token}` ที่ 302 ไปยัง presigned GET ของ **สำเนาชั่วคราว** ใน bucket แนบไฟล์เดิม
(`S3_BUCKET`) ใต้ prefix `line-delivery/` — key เป็น base64url สุ่ม 43 ตัวอักษร ไม่มี id บริษัท/
เอกสาร/ผู้ใช้/วันที่ปน ต้นฉบับไม่ถูกย้ายหรือลบ

สิ่งที่ระบบ **ไม่ทำเอง** และต้องตั้งที่ AWS ก่อนใช้จริง:

1. **Lifecycle rule บน prefix `line-delivery/`**: expire ที่ **3 วัน** (อายุ token ตายตัว 72 ชม.
   ฝั่งแอปจะปฏิเสธเองหลังหมดอายุ — lifecycle มีไว้ลบ bytes) และเพราะ bucket เปิด versioning
   (`putObject` ของแอป assert VersionId) ต้องตั้ง **NoncurrentVersionExpiration (1 วัน)** ด้วย
   ไม่งั้นการ revoke (ลบ object → เกิด delete marker) จะทิ้ง noncurrent version ที่มีข้อมูลส่วน
   บุคคลค้างไว้ตลอด บวก **AbortIncompleteMultipartUpload** กัน marker สะสม
2. **IAM**: role ที่แจก presigned GET ต้อง **ไม่มี `s3:ListBucket`** บน prefix นี้ (spec §12.3);
   create ใช้ `s3:PutObject`, revoke ใช้ `s3:DeleteObject`
3. Presigned GET อายุ **120 วินาที**, `disposition: inline`, ชื่อไฟล์กลาง `substitute-receipt.pdf`
4. **Local dev**: `LocalStorageAdapter` ไม่มี lifecycle เลย — สำเนาใน `$TMPDIR/watchdog-bms-local-storage/`
   อยู่จนกว่าจะล้าง temp เอง และมัน ignore อายุ presign (คืน path relative บน API origin)
5. **Platform access = CLOSED**: route `/v1/document-delivery/:token` เป็น `@Public()` แต่ไม่อยู่ใน
   `CLOSED_PUBLIC_PATHS` → ช่วงปิดระบบ ลิงก์จะขึ้นหน้า "ลิงก์นี้ใช้ไม่ได้แล้ว" แทนเอกสาร
   (ตั้งใจ fail-closed; ถ้า owner อยากให้ลิงก์รอดช่วงปิดระบบ ให้เพิ่ม path เข้า allowlist นั้น)
6. **Log hygiene**: path ที่มี token ถูก mask เป็น `/v1/document-delivery/:token` ในทุกจุดที่ log
   path (request logger / exception filter / rate-limit security event) — ถ้าเพิ่มจุด log ใหม่
   ที่แตะ `req.path` ต้องผ่าน `maskLoggedPath()` เสมอ token เป็น bearer credential ของเอกสารกฎหมาย

---

## Visitor IP through the api-web container (review R06) — 2026-09-06

Rate limits that are keyed on the visitor (the 20/hour signup-claim bucket, the password-login
failure bucket) depend on one assumption about the ingress chain, recorded here because breaking it
silently collapses every visitor into one key rather than failing loudly:

- prod chain is browser → Cloudflare Worker → **ECS Express gateway** → `web-api-proxy.mjs` →
  Nest (or Next), all inside one container over loopback.
- `trustedClientIp()` honours `x-forwarded-for` only when the TCP peer is the private/loopback tier
  and walks the chain **from the right**, skipping every hop our own tier or Cloudflare appended.
  The first hop that is neither is the answer.
- **The assumption:** the ECS Express gateway appends the peer it actually observed. That appended
  hop is what makes a visitor-supplied `x-forwarded-for` unusable as a self-chosen key — a forged
  value always sits to the LEFT of the observed one and is skipped.
- The claim BFF (`apps/web/app/api/auth/signup-claim/route.ts`) calls the API server-to-server, so
  it forwards the chain verbatim with `forwardedClientHeaders()`. Without it every applicant in the
  country shares the container's loopback address as one bucket.

**If the ingress is ever changed** — a different gateway, a direct-to-ALB path, Cloudflare removed —
re-check that the rightmost hop is still infrastructure-appended before trusting these buckets. The
symptom of a broken assumption is not an error: it is a shared key (everyone throttled together) or
a spoofable one (nobody throttled). `apps/api/src/common/security/trusted-client-ip.spec.ts` holds
the property tests for both directions.

Known gap: `apps/web/app/api/auth/login/route.ts` has the same shape and does NOT forward the chain
yet. It is in the production maintenance pins, so changing it needs a pin re-sync in the same PR.

## LINE ledger incident readback — 2026-09-17

UAT source `1468ea7088a961af81ebce173df9a5d4028c96bd`, operation
`20260917T103812Z-23d4190c`, returned the generic temporary-error reply at19:12Bangkok because
`openWaitingUser` received Redis NOGROUP and the newer read guard failed closed before AI. This
does not by itself distinguish expired/absent stream from an existing stream with a missing group.
Do not flush Redis or recreate consumer groups as an unreviewed recovery shortcut.

Production's running API task `3ea062c2ef024284b23ae384ef5d5c9d` remains source
`fc2838c4cb691033f41595c0d43587f10377d33c`, ledger enabled, serving mode live; actual task digest,
ECR source tag and Express active configuration agree. That source still logs Redis read failures
and continues, so UAT's failure must not be assumed to explain a Production report. A complete
19:00–19:20Bangkok API log window confirms a menu greeting at19:06 and a casual free-text reply
accepted by LINE at19:10 after13.27s, despite NOGROUP. The reported screenshot's exact failed message
is not yet correlated. A successful menu greeting never proves the AI path: it is deterministic.

Existing non-root `watchdog-bedrock` reader can use `DescribeLogStreams`/`GetLogEvents` for this
inspection; `StartQuery` was denied. A broad filtered scan timed out. Use bounded actual task-stream
reads and check pagination; an empty filtered page with a next token is not absence of incidents.
No cloud state changed. [Diagnosis, source/digest, private-log location and pending correlation](../agent-memory/uat-line-chat-nogroup-2026-09-17.md)
and [remediation spec](../specs/line-ai-ledger-lifecycle-remediation-spec-th.md).

Later owner timezone clarification: the image uses Korea time. Requested18:00–22:00KST equals
09:00–13:00UTC; at collection time the complete available range ended12:30:29UTC/21:30:29KST.
All8paged windows reconcile16accepted LINE events to16terminal outcomes. At20:29:00 and20:29:11KST,
two real text turns were refused by monthly AI budget admission: the same company's metered spend
was8062satang against an explicit company override of8000satang. The preceding NOGROUP was nonfatal
on this deployed source. Menu/promotion replies at20:28–20:29 bypass model admission by design and
still succeeded. The later21:10casual success is a different company; do not claim it proves recovery
for the capped company. Exact screenshot actor is unverified, but the event timing/menu sequence
matches. No budget, usage history, Redis or runtime setting changed. `ai_budget_exceeded` currently
maps to generic `failed_terminal`; distinguish policy refusal from outage when triaging these logs.
