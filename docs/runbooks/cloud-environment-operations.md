# Cloud Environment Operations — start, stop, inspect, and what it costs

สร้าง 2026-08-07; ตรวจ live ล่าสุด 2026-08-15 | ทุกตัวเลขและสถานะในเอกสารนี้ **อ่านจาก AWS จริง** ไม่ได้อ่านจากโค้ด
บริบทเต็มของเหตุการณ์ที่ทำให้เกิดเอกสารนี้: `docs/agent-memory/aws-cost-spike-2026-08.md`

เอกสารนี้มีไว้ให้ agent ตัวถัดไป **ไม่ต้องไล่โค้ดซ้ำ** เพื่อตอบคำถามว่า "ตอนนี้อะไรรันอยู่ ปิดยังไง
เปิดยังไง ดูตรงไหน และอะไรที่หลอกตา" ถ้าตัวเลขในเอกสารขัดกับ AWS ให้เชื่อ AWS แล้วมาแก้เอกสาร

Account `311414082667`, region `ap-southeast-1` ทั้งหมด — ไม่มี resource ในภูมิภาคอื่นเลย (สแกนแล้ว 7 region)

---

## Current UAT — demo-link management + accountant export pack, 2026-11-09 21:24 Bangkok

UAT serves exact main `976971d8a8041d5a08b00547a5a659dad53630de` (same tree as develop `e44765620`): the
17:51 release below plus the sales demo-link management menu (edit credit, document quota and expiry, clear
shop, delete) and the accountant export round (one PDF per record, formatted workbook). One additive
migration `20261109120000_sales_demo_link_read_limit` (`readLimit INTEGER NOT NULL DEFAULT 3`). Owner's
words: "มีของเข้า main มาใหม่ fetch และเอาเข้า uat ไปพร้อมของคุณเลย". Fresh controller worktree
`release-uat-20261109c` from origin/main (`.env.kamal` symlinked); cached MFA session still valid. Prepare
`20261109T141236Z-e6787198` (`--publish-images --uat-smoke-acceptance`) `PREPARED_NO_DEPLOYMENT` in
394.118 s; apply `20261109T141920Z-d4e92f09` signed/verified `ACCEPTED_LINE_DEFERRED` in 306.814 s, 12/12
phases. Production untouched (`884ba5307`). Workflow UAT/READY/PROD IDs `NOT_DISPATCHED`; native LINE not
exercised.

## Current UAT — admin demo-link button, 2026-11-09 17:51 Bangkok

UAT serves exact main `c14b429599221454326f85136470482871b9b62d`: the 17:14 release below plus the admin
ทีมขาย page's "สร้างลิงก์เดโม่" button (one web file) and two runbook notes. API, gateway, workers, packages,
infra and `infra/kamal/config.json` are identical to `737fa2ef0`; no migration. Owner's words: "เอาขึ้นเลย",
then "ไปต่อ". Fresh controller worktree `release-uat-20261109b` from origin/main (`.env.kamal` symlinked);
the cached MFA session from the 17:14 release was still valid. Prepare `20261109T104107Z-184921e3`
(`--publish-images --uat-smoke-acceptance`) `PREPARED_NO_DEPLOYMENT` in 348.325 s; apply
`20261109T104704Z-3eb87dfb` signed/verified `ACCEPTED_LINE_DEFERRED` in 282.239 s, 12/12 phases.
Production untouched (`884ba5307`). Workflow UAT/READY/PROD IDs `NOT_DISPATCHED`; native LINE not exercised.

## Current UAT — LINE speed rounds 25–28, 2026-11-09 17:14 Bangkok

UAT serves exact main `737fa2ef0bdd7d7af2e73c16884638017f8a93ba`; Production still serves
`884ba5307468111c48a2bd2c01a3c27c438d33a6` (not mutated). UAT prepare `20261109T100531Z-370d5a56`
passed in 203.247s (`--uat-smoke-acceptance`; without it the run stops at "Acceptance credentials
file is missing"). Apply `20261109T100919Z-472a068c` completed signed/verified `ACCEPTED_LINE_DEFERRED`
in 308.045s: all 12 phases, five additive migrations, AgentCore `kamal_uat_b` v38 (UPDATED_PINNED,
artifact `3bbce1dd…`), readiness api-web/db, ai-gateway, workers/redis/internal API, retirement 19/19,
owned SSM cleanup 2/2. Only changed settings versus the 10-30 UAT: version fields and
`LINE_AI_BUFFER_DEBOUNCE_MS` 1000 → 500. AgentCore now receives the gateway's `APPROVED_AI_MODEL_IDS`
and global-profile approval at release (still Sonnet 4.6 only). Claude Haiku 5.5 is NOT available to
this account: one owner-authorized Bedrock playground prompt on `global.anthropic.claude-haiku-5-5`
returned `AccessDeniedException … not available for this account` and the account has no Haiku 5.5
Marketplace subscription, so Haiku stays out of `infra/kamal/config.json` for both environments.
Release ran from worktree `release-uat-20261109` (origin/main, `.env.kamal` symlinked). Workflow
UAT/READY/PROD IDs are `NOT_DISPATCHED`; native LINE was not exercised. Before this release a clean
`infra/dev-kamal/build-complete.py` dry run found four build blockers (next-env.d.ts dev form, a
workers spec import, a workers import of `@watchdog-bms/contracts`, stale pins), all fixed on main.

**Bedrock quotas found and requested (2026-11-09, owner-approved, Service Quotas ap-southeast-1):** the
"not available for this account" answer for Haiku 5.5 is an account quota of **0** for "Global
cross-region model inference tokens per minute for Anthropic Claude Haiku 5.5" (AWS default
10,000,000). Sonnet 4.6, which serves UAT and Production, has "Global cross-region model inference
requests per minute" applied at **10** (default 10,000) — about 3–5 AI-answered LINE messages per
minute across all shops. Requests at the form's minimum (the AWS default): Haiku 5.5 TPM
10,000,000 = case `179421967600426`; Sonnet 4.6 RPM 10,000 = case `179421971300520`; both "Case
Opened". Re-add Haiku to `infra/kamal/config.json` (both environments) only after the Haiku quota
reads non-zero.

## Current UAT and Production — concise expense history, 2026-10-30 21:12 Bangkok

UAT and Production serve exact source `884ba5307468111c48a2bd2c01a3c27c438d33a6`. Expense history
now shows actor/action/time without field tables; upload bookkeeping is projected to one proven
activity while preserving actual separate uploads and durable audits. UAT prepare
`20261030T135245Z-27d48a21` passed in279.977s; UAT apply `20261030T135750Z-ad421006` completed
signed/verified `ACCEPTED_LINE_DEFERRED` in287.233s. Production prepare
`20261030T140338Z-402fb17c` passed in50.517s; apply `20261030T140443Z-887ba584` promoted the exact
UAT images without rebuild and completed signed/verified acceptance in441.606s (website ready
290.562s; browser stage122.628s). All12 phases, deep readiness, customer live/OPEN, current
administrator identity/permission, login200/logout204/postlogout401, retirement19/19 and owned
SSM cleanup (2 UAT,4 Production) passed. Workflow UAT/READY/PROD IDs are `NOT_DISPATCHED`.

The owner authorized root `thawatchai` solely for this revision's read-only Alarm checks and
retained the instruction to ignore unchanged old alarms. Pre/post/final reads show29OK and the
same October9 API-security Alarm, no new/changed non-OK and no missing baseline alarms. No
Alarm, gate or permission was changed. Native LINE/LIFF/provider messaging was not exercised.
[Exact ledger, signed hashes, browser/status evidence and limits](../agent-memory/expense-activity-history-concise-release-2026-10-30.md).

## Previous Production release — 2026-10-30 19:27 Bangkok

Production and UAT now serve exact source `a02b9ccca8047caf951ff83dbc4f82e5bf3e062c`, including
expense activity history and the new-shop LINE advisor. Preparation `20261030T120335Z-bc2072d4`
verified the signed UAT bundle and complete Production configuration/capacity in 48.532 seconds.
Apply `20261030T121827Z-e64994ae` promoted the exact immutable UAT images without rebuilding and
completed signed/verified `ACCEPTED_LINE_DEFERRED` in 520.362 seconds (website ready 302.541 seconds;
browser acceptance stage 190.892 seconds). All 12 phases, exact runtime/config on four hosts, deep
readiness, customer live/OPEN, current administrator/permissions, logout 204/post-logout 401,
retirement 19/19 and owned SSM cleanup 4/4 passed. Workflow UAT/READY/Production IDs are
`NOT_DISPATCHED`. No gate or Alarm was changed.

The owner authorized root `thawatchai` only for this release's read-only Alarm checks, and expressly
accepted unchanged old alarms while requiring checks for this release. Fresh pre/post/final reads
show 29 OK and the one unchanged API-security Alarm from 9 October; no new/changed non-OK alarm.
This is a scoped current-release exception, not authority for future releases. Native LINE/LIFF and
external-provider messaging were not exercised.
[Exact ledger, signatures, browser/status evidence and limits](../agent-memory/expense-activity-history-production-2026-10-30.md).

## Previous UAT release — 2026-10-30 18:43 Bangkok

UAT is running and customer `OPEN`, serving exact source
`a02b9ccca8047caf951ff83dbc4f82e5bf3e062c` (expense activity history and new-shop LINE advisor).
Local Kamal apply `20261030T113901Z-99a9da2f` completed signed/verified `ACCEPTED_LINE_DEFERRED`
in 277.582 seconds. All 12 phases, exact source/image/config, API/DB/AI/workers/Redis/internal API,
retirement 19/19 and owned SSM cleanup 2/2 passed. Public health/login and customer `OPEN` passed
again after acceptance. Workflow UAT/READY/Production IDs are `NOT_DISPATCHED`; Production was
not mutated. Login/logout and native LINE are outside the documented UAT smoke acceptance.

Preparation `20261030T112603Z-3d7cab43` stopped before publication/deployment at API-host capacity.
The documented cleanup removed 13 old unused tools tags, preserving current+previous tools and
every container; free space rose from 3.55 GB to 27.10 GB (5.08 GB required). Preparation
`20261030T113607Z-8daff7a6` then validated and published the same build without rebuilding.

**Reusing a reused preparation:** the current controller copies `build/` but does not create a
sibling `source/` in the second preparation directory. The apply loader requires that clean checkout.
First apply `20261030T113747Z-9e276b76` stopped safely at this boundary; use the original validated
build directory with its original `source/`, after verifying identical build/image identities.
Do not copy source into the run, rebuild, delete locks or alter the controller to skip validation.
The successful apply above used the original `20261030T112603Z-3d7cab43/build`.
[Exact ledger, hashes and limits](../agent-memory/expense-activity-history-uat-2026-10-30.md).

## Previous UAT power state — paused 2026-10-29 01:26 Bangkok

UAT is intentionally paused by owner request. Canonical power operation
`20261028T182046Z-2b8ad842` completed `UAT_POWER_PAUSED_WITH_DATABASE` in 338.118 seconds. Both
retained EC2 hosts and RDS are `stopped`, desired state is `paused`, no data was deleted, no release
workflow was dispatched, and Production was not mutated. The retained runtime baseline for API/Web,
AI Gateway and Workers is exact source `8c112ea70003057fa3063938e859de1b945747d1`, all with
`unless-stopped`; owned SSM cleanup passed 2/2 and both the local operation guard and cloud mutex are
clear. Public UAT health returns 504 while paused, as expected. Production remained health 200 and
customer `OPEN` before and after the operation. Use the canonical `power-uat start` path to resume;
do not deploy directly while desired state is `paused`.
[Exact power-operation evidence](../agent-memory/uat-power-pause-2026-10-29.md).

## Previous UAT and Production release — 2026-10-29 01:15 Bangkok

UAT and Production now serve exact source `8c112ea70003057fa3063938e859de1b945747d1`, including the
unusual expense-document-date discovery correction and every earlier latest-main feature. UAT
`20261028T175531Z-b3c61d8a` completed signed/verified `ACCEPTED_LINE_DEFERRED` in277.510 seconds.
Production `20261028T180841Z-982f399a` promoted the exact immutable UAT bundle without rebuild and
completed signed/verified `ACCEPTED_LINE_DEFERRED` in445.030 seconds. All12 phases, deep readiness,
customer `live`/`OPEN`, administrator identity/permission, logout/postlogout401, retirement19/19 and
owned SSM cleanup (2 UAT,4 Production) passed. Workflow UAT/READY/PROD IDs are `NOT_DISPATCHED`.

The first Production prepare `20261028T180203Z-17f9f69c` stopped before publication/mutation because
the API host had3.07GB free. The documented bounded cleanup retained current+previous rollback
releases, removed only older stopped containers/image tags, raised free space to27.89GB and closed4/4
SSM sessions. Clean prepare `20261028T180652Z-51394b31` then passed; apply measured28.56GB available
against5.08GB required. Actual UAT browser evidence proves receipt `OR670318000742` is now found in
March2024 under its printed18March date while retaining its unusual-date warning.

Fresh pre/post Alarm reads each have29OK, zero insufficient and the one unchanged9October API-security
Alarm. The owner authorized root `thawatchai` only for current-release Alarm reads and explicitly
accepted only that unchanged Alarm for this release; no Alarm or gate was changed. Production LINE,
native LINE/LIFF and external providers were not exercised.
[Exact operations, hashes, browser proof and limits](../agent-memory/latest-main-uat-production-2026-10-29.md).

## Production LINE expense duplicate confirmation — 2026-10-29 (read-only)

Owner reported one press producing two confirmation cards for snd. Scoped MFA + enrolled SSM/SSH
readback verifies both API hosts on `8c112ea70003057fa3063938e859de1b945747d1`. The 13:13 Bangkok
incident has two distinct inbound webhook events, 2.012 seconds apart, on different API hosts.
The first applied the action; the second replayed its existing result. Both separate result plans
were accepted via LINE REPLY, with zero push attempts/errors. One matching expense and one
`expense.confirm` audit exist: duplicate presentation, not a second expense confirmation.
The retained data does not establish why LINE emitted the second event from the reported one tap.
The local fix suppresses an action replay only with prior accepted delivery for the exact
actor/chat/channel/recipient/token/result. It is **not deployed**. No data/service/gate change;
2/2 owned SSM sessions terminated. UAT/READY/Production run IDs: `NOT_DISPATCHED`.
[Evidence and regression checks](../agent-memory/prod-snd-line-confirm-duplicate-2026-10-29.md).

## Previous UAT latest-main release — 2026-10-29 00:05 Bangkok

UAT now serves application source `56cdb4ee50bedf3f0c22451faf1583ffb6ec252c`, which was exact
main/develop at dispatch, while Production remains on the previous
`0d4c915d48c62af26cb39660999c0454943c1b48` candy release. Main/develop advanced afterward only
with this `docs/**` release ledger; no runtime byte changed and no redeploy is required. The UAT
candidate contains the three-free-expense-document feature with additive migration
`20261028090000_free_expense_monthly_documents` and the completed third-door escape game. No
Production, customer-gate or alarm mutation was performed.

UAT was intentionally paused. Read-only preflight `20261028T164340Z-bda91715` stopped at target
preflight before mutation and is retained. Power start `20261028T164508Z-4420d7ca` completed
`UAT_RUNNING_OPEN` in 342.385 seconds with retained-runtime equality and2/2 SSM cleanup. Fresh
preflight `20261028T165128Z-ef733e4b` passed. Prepare/publish
`20261028T165147Z-fa6b78fb` completed `PREPARED_NO_DEPLOYMENT` in317.413 seconds. Apply
`20261028T165734Z-fcdabc54` completed signed/verified `ACCEPTED_LINE_DEFERRED` in288.906 seconds;
all12 phases, migration/authority, deep API/DB/AI/worker/Redis/internal-API readiness, public OPEN,
retirement19/19 and2/2 SSM cleanup passed. Workflow UAT/READY/PROD IDs are `NOT_DISPATCHED`.

Actual UAT Chromium at390/1280 proves each upcoming door is grey, native-disabled and non-openable
1 ms before its own Asia/Bangkok deadline. Door2 opens exactly29 October00:00 while door3 remains
locked; door3 opens exactly30 October00:00. The actual29 October state is door2 open and door3
grey/disabled. The production build ignores `previewGame`; no browser errors or horizontal overflow.
The signed smoke proves migration/catalog authority but does not claim an authenticated free-cohort
web/native-LINE/provider journey. [Exact ledger, hashes and limits](../agent-memory/uat-latest-main-2026-10-29.md).

## Previous UAT / current Production Halloween candy-game release — 2026-10-28 18:38 Bangkok

UAT and Production now serve source `0d4c915d48c62af26cb39660999c0454943c1b48`. The orange door
remains grey and natively disabled until 29 October 2026 00:00 Asia/Bangkok, then its countdown
disappears and the 30-second candy game becomes available; the green door remains locked until its
separate 30 October cutoff. The same release adds tab-scoped no-repeat normal-card cycles while the
Backend keeps the independent 1% SECRET roll and final selection.

UAT prepare `20261028T111404Z-f7317899` passed; apply `20261028T111943Z-7c71429f` is signed/verified
`ACCEPTED_LINE_DEFERRED` in 241.035 s. Production preflight `20261028T112530Z-49d9140c` and promotion
prepare `20261028T112600Z-65f8badc` passed without mutation. Production `20261028T112816Z-e632d00a`
promoted the exact signed UAT image IDs and AgentCore artifact without rebuild, then completed signed
`ACCEPTED_LINE_DEFERRED` in 591.098 s (website ready 278.655 s; browser acceptance 284.712 s).
All 12 phases, deep readiness, customer live/OPEN, current administrator identity/permission,
logout/postlogout401, build retirement and 2 UAT + 4 Production owned SSM-session cleanup passed.

Actual UAT and Production checks pass at 390/1280, Android Chromium and WebKit iPhone: disabled at
23:59:59, enabled at exactly 00:00:00, complete game/pacing/finale/replay and 1080×1920 share output,
with no browser errors or horizontal overflow. The owner accepted only the unchanged 9 October API
security Alarm for this release; fresh pre/post snapshots each have 29 OK, zero insufficient and that
one unchanged Alarm. Root `thawatchai` was authorized only for `DescribeAlarms`; scoped roles performed
the release, and no Alarm was changed. Workflow UAT/READY/PROD IDs are `NOT_DISPATCHED` (local Kamal).
[Exact ledger, tests and limitations](../agent-memory/halloween-candy-game.md).

## Previous Halloween campaign popup release — 2026-10-28 14:06 Bangkok

UAT and Production now serve source `8ee5e737e0b90ded61fb7955a5fe9c583dfd2f3c`: `/halloween`
opens the existing three-door chooser over the real homepage, ordinary `/` stays manual, and shared
links/QR return to the campaign. Closing preserves the URL and usable homepage. The release also
protects three public contact anchors from Cloudflare email rewriting/hydration recovery without
changing Cloudflare configuration. First UAT's application failure was retained and corrected before promotion.

Corrected UAT `20261028T064018Z-08c3a82d` is signed/verified `ACCEPTED_LINE_DEFERRED` in251.606s.
Production `20261028T064841Z-6cd1214c` is signed/verified in1,038.175s (website ready272.065s;
operator/browser stage739.921s). Exact four UAT published digests and AgentCore artifact promoted
without rebuild. Customer live/OPEN, current administrator identity/permission, login200, authenticated
read200, no password/legal action, logout204 and postlogout401 verified. HTTP statuses are corroborated
by current-container logs; no browser BFF Network row or raw login-response capture is claimed.
Final runtime and deep readiness passed;2UAT and4Production owned SSM sessions terminated.
Actual390/1280 popup/dismiss/reopen/refresh and real card draw pass with zero browser error logs.

The owner explicitly accepted the unchanged October9 API-security alarm for this release;15other
alarms OK, no alarm/gate/theme mutation. Root `thawatchai` was authorized only for alarm reads;
scoped non-root deployment/log access remained in use. LINE messaging and physical-device social
posting were not exercised. Workflow UAT/READY/PROD IDs are NOT_DISPATCHED (local Kamal).
[Exact evidence, timing, signed hashes and limitations](../agent-memory/halloween-event-popup.md).

## Previous Halloween release — 2026-10-28 04:13 Bangkok

UAT and Production are running source `9a3deb73104eb9ffabf8f6f72916229801280657`, including the
Halloween game/cards, draw proxy correction and image-plus-caption social sharing. UAT apply
`20261027T204006Z-1f430a8d` is signed `ACCEPTED_LINE_DEFERRED` (248.412 s); Production promotion
`20261027T205355Z-e422dd3a` is signed/verified `ACCEPTED_LINE_DEFERRED` (1,174.921 s, including
806.372 s browser/operator acceptance; website ready at343.313 s). Production copied exact four UAT
images and AgentCore artifact, without rebuild. Customer live/OPEN, current administrator permission,
login200, no password/legal action, gate canOpen/live/OPEN, logout204 and postlogout401 passed.
The final logout HTTP status is corroborated by current container request logs; no BFF Network row
is claimed. All app/deep DB/Redis/internal API readiness passed after the human wait. Four owned
Production SSM sessions and two owned UAT sessions terminated; no theme or customer-gate change.
No power operation was performed by this release; UAT's October22 paused entry below is historical.

Owner explicitly accepted only the unchanged API security alarm: “ปล่อยต่อ บันทึกข้อยกเว้น Alarm เดิม”.
Fresh postdeploy readback has15OK and that oneALARM, with the same October9 transition and reason;
current database cause/delivery was not rechecked. This is a new release-specific exception, not reuse
of the restoration waiver and not an all-alarms-OK claim. Owner permitted root `thawatchai` only for
CloudWatch alarm reads; deploy/log readback remained on the scoped non-root role. No alarm mutation.
UAT/READY/PROD workflow IDs are `NOT_DISPATCHED`. Actual LINE messaging and physical-device social
posting remain unexercised. [Exact ledger, signed hashes, prior failures and limits](../agent-memory/halloween-release-2026-10-28.md).

## Production security readback — 2026-10-21 (read-only)

**Node security follow-up — 2026-10-22 14:46 Bangkok:** latest recorded Production operation
`20261021T175544Z-f4f52630` (source `733f77864`, finished 01:02 Bangkok) still contains Node 22.23.2
in API/Web, AI, Workers and tools. Verified by executing the exact immutable images locally with
network disabled and matching their IDs to the release's recorded runtime readback. Node's Oct21
security release fixes High Brotli RCE CVE-2026-111497 in 22.23.4. A benign local compressed-JSON
probe exercised the API image's decoder before route denial; no exploit or Production test.
Owner chose latest-release evidence after the scoped MFA session was unavailable; this is **not a
fresh live container read**. No deploy or AWS mutation. [Assessment and evidence](../research/nodejs-security-review-2026-10-22-th.md) (kept on the owner's laptop, not in git).

Owner requested a security report against real code and settings. At approximately 13:44–13:55
Bangkok, all four running containers (two API/Web, AI Gateway, workers) reported source
`29b1eab65fe852db0abcd7b2f69d45d64a1ae540`; API replicas matched image/config security fields.
Non-root read APIs and SSM reads confirmed private/encrypted/MultiAZ/deletion-protected RDS with
35-day backups, PostgreSQL client verify-full, Redis client TLS/auth, disabled dev auth/Swagger,
and API-only actor-delegation signing-key presence (absent from the Next process and AI container).

Open findings: public AI-origin requests reach the JSON parser before internal authentication
(deployed parser limits 16/96 MB, effective AI app rate-limit flag false); shipped dependency versions
match newly reported advisories; all four containers lack explicit cap-drop/no-new-privileges and
have writable root filesystems; all three current Kamal application log groups retain 14 days but
have no customer-managed KMS association. CloudWatch default at-rest encryption still applies.
API security alarm remains ALARM; its current cause/delivery was not re-established in this audit.
Initial non-root reads denied Redis/S3/RDS-parameter/WAF access. At 14:14–14:15 Bangkok,
the owner explicitly authorized `thawatchai` (STS identity is account root) for metadata-only reads.
Redis now independently confirms at-rest/TLS-required/auth encryption controls, two nodes across AZs,
automatic failover/MultiAZ and 35-day snapshot retention. Twelve available automated snapshots
were listed on replica `-002`; latest created 2026-10-21 04:23 Bangkok. A replication-group-only
snapshot query returned empty, so use member-cluster queries before concluding backups are absent.
The production S3 bucket has all four public-access blocks, BucketOwnerEnforced, SSE-S3/AES256 and
versioning enabled. Account-level public-access-block and bucket policy are absent (NoSuch responses,
not AccessDenied); bucket-level protection remains active, but there is no bucket-policy HTTPS deny.
WAF returns `WebACL=null` for `mangmee-production-gateway`, whose HTTPS rules route both API/AI
origins; this ALB has no AWS WAF association. Cloudflare account rules remain unreviewed.
RDS `rds.force_ssl=1` with DB parameter group in-sync and no instance pending changes; no SQL check.
Do not substitute historical ECS security closure for these findings.

Independent verification ~14:15–14:35 Bangkok (non-root reads + deployed CloudFormation template)
confirmed all five findings and added two permission findings: (1) the production deploy role trusts
the laptop's long-lived IAM user key with no MFA condition and can read every
`watchdog-bms/production/*` secret, push ECR images, update AgentCore and start SSM sessions;
(2) the HS256 user-token signing key sits in the AI container and the AgentCore role although
no AI route verifies user tokens. Both `origin` and `ai-origin` resolve straight to the ALB, so
Cloudflare does not front them, and the API reaches AI through public `ai-origin`.
Non-root profiles cannot read IAM, WAF or ALB rules; use `cloudformation get-template` on
`mangmee-kamal-production` with the deploy profile to read deployed roles/rules instead.
[Verification](../research/security-review-2026-10-21-verification-th.md) (kept on the owner's laptop, not in git).

**Changed the same night (owner-approved change sets):** the deploy user now requires MFA for
everything except read-only operations and Bedrock model calls (group `mangmee-require-mfa`), and the
Production and UAT deploy roles trust it only with MFA (8 h sessions). Local profiles carry `mfa_serial`; the
owner types the code once, then the CLI cache serves release tooling. Without that, every deploy-role
call fails AccessDenied — ask the owner for the code, never work around it. Production `ai-origin`
now admits only ApiA `13.228.157.253` / ApiB `18.139.177.255` (EIPs in the stack); anything else gets
the ALB default 503. If an API host is replaced, its EIP must follow or LINE AI/OCR stop.
[State and next steps](../agent-memory/security-fix-plan-2026-10-21.md).

**UAT release with items 3–5 — 2026-10-21 23:47 (Asia/Bangkok):** local Kamal operation
`20261021T164111Z-4f75a728` (prepared build `20261021T163219Z-6d53fe1c`), exact main
`9732cb57a8876b19a079a8367b32c6a4925df6a4`, `ACCEPTED_LINE_DEFERRED`, signed, 354.7 s, both owned SSM
sessions terminated; AgentCore UAT `kamal_uat_b` → version 24. Post-deploy readback: anonymous
`uat-ai-origin` `/v1/internal/*` (malformed JSON, empty body, upper-case path) → 401 before any body
parse; from the API container with the real key `GET /internal/ai/agents` 200, without key 401,
malformed 400, 5 MB receipt body handled (no model call). Every app container `CapDrop [ALL]`,
`no-new-privileges`, pid 1 `CapEff 0`/`NoNewPrivs 1`; ai-gateway `init=true`; only api-web keeps
`WATCHDOG_JWT_SECRET_ARN`; AgentCore v24 env has no JWT secret key. Container logs clean. Signed-in
walk after the owner logged in (2026-10-22 ~00:20): `/v1/auth/me` with a foreign company id → 403
`company_access_unavailable` with no name, own company 200; 23 sold screens at 1556 px and 11 at
375 px open with heading, no sideways overflow, no error text (tax/tax-signature = package lacks
them; settings/security redirects by design); voucher PDF (live render) and substitute-receipt
server preview image render correctly; API→AI receipt-ocr with a real phone photo returned the right
shop/number/amount in 7 s. Owner LINE conversation answered normally (owner-reported); AI log shows
a receipt read plus two routed turns (accounting read with API tools, advisor) completed, not
refused, no new errors. UAT/READY/PROD workflow IDs NOT_DISPATCHED (local Kamal path).

**Production with items 3–5 — 2026-10-22 00:26 (Asia/Bangkok):** owner's go "เอาขึ้น Production ได้เลย".
Prepare `20261021T171401Z-7794b6b8` (54 s), then operation `20261021T171504Z-6f47b232` from UAT
`20261021T164111Z-4f75a728`, main `9732cb57a8876b19a079a8367b32c6a4925df6a4`, `ACCEPTED_LINE_DEFERRED`,
signed, 665.8 s (browser acceptance: owner signed in after website-ready 17:21:23Z, checks 17:25Z,
evidence `browser-observation-20261022-production.txt` in the run); four owned SSM sessions terminated.
AgentCore `kamal_production_a` → v9, env without the JWT secret key. Readback on all four hosts: every app
container `CapDrop [ALL]` + `no-new-privileges`, pid 1 `CapEff 0`/`NoNewPrivs 1`, ai-gateway `init=true`,
only api-web keeps `WATCHDOG_JWT_SECRET_ARN`. From both API containers with the real key: agents 200,
no key 401, malformed 400, 5 MB body handled (no model call). Outside → `ai-origin` 503 (allow-list).
Public `/`, `/login`, platform access 200/OPEN. Level-50 log lines in 15 min: 0 on every container.

**Web login key rotated + festival theme — 2026-10-22 01:05 (Asia/Bangkok):** owner: "เปลี่ยน key ได้เลย …
theme เทศกาล … เอาขึ้นไปด้วยปกติได้เลย". Main `733f77864` (homepage seasonal themes #1147/#1148, one new
table `PublicHomeThemeSetting`, + pin re-sync; develop `5b3d3acf7` same tree). Deploy roles can only read
secrets, so the owner wrote new `watchdog-jwt-secret` versions with his `thawatchai` login profile (final
AWSCURRENT: UAT `7a417044…`, Production `3b81cdcf…`). UAT `20261021T174744Z-087f4a5c` (prepare
`20261021T174146Z-488b484f`) signed 245.6 s: old browser session 401, normal + Halloween homepage OK at
1556/375 (owner let me switch UAT to Halloween; UAT stays on Halloween). Production prepare
`20261021T175446Z-80ca9474`, operation `20261021T175544Z-f4f52630` signed `ACCEPTED_LINE_DEFERRED` 376.2 s,
captured key `3b81cdcf…`, AgentCore `kamal_production_b` v10, owner signed in fresh for browser
acceptance; readback unchanged (cap-drop, API→AI 200/401/400/5 MB, 0 level-50). Production theme left
on `default` (switch at /system/home-theme). **AgentRole removal:** a stack change set editing
`AgentRole` also re-evaluated `AgentRuntime`/`AgentEndpointA/B` (Dynamic, endpoints Conditional
replacement) — it would rebuild the AI runtime from the template's old artifact; it was deleted
unexecuted. Instead the Production key carries a resource policy that DENIES `GetSecretValue` to
`mangmee-kamal-production-agentrole` (validated; simulator: agentrole explicitDeny, apirole and
deployrole allowed, agentrole still allowed on the internal-tool secret). Remove with
`secretsmanager delete-resource-policy` if ever needed. The stale `ReadExactInternalToolSecret` ARN
stays in the template (harmless under the deny); never edit AgentRole through the stack without
pinning the runtime first. Owner afterwards switched Production to Halloween and sent a Production LINE
message — both passed (owner-reported). UAT key deny: owner decided not needed.
UAT was then PAUSED at 01:01:37 by a separate `power-uat pause` operation `20261021T180137Z-0ccc30e3`
(UAT_POWER_PAUSED_WITH_DATABASE; StopInstances by the shared UAT deploy-role CLI session from this laptop,
not by the release, not by a Claude scheduled task) — the owner confirmed he paused it himself ("ฉันสั่งปิด
เอง"). Public UAT answers 504 until `power-uat start`.

**Node 22.23.4 + API refuses compressed request bodies — 2026-10-22 20:36 (Asia/Bangkok):** from the verified
Node.js report (`docs/research/nodejs-security-review-2026-10-22-th.md`, CVE-2026-111497 Brotli and others).
Owner: "ตรวจดูผลกระทบก่อน" then "เริ่มลงมือแก้ไขได้เลย". Main `8d7cdca01` / develop `478b84f10` (same tree):
six Dockerfiles → `node:22.23.4-trixie-slim@sha256:8eb619e4…`, API json/urlencoded/provider-events parsers
`inflate:false`, theme body class renamed `SetHomeThemeDto` (the API body-validation audit had been red on
main since the theme PR). Local impact proof on host Node 22.23.4: suites 25,620/0, real-DB 534, journeys 88/88;
20 provider hosts TLS/fetch identical. UAT started with power-uat `20261022T125931Z-985a30f4`, prepare
`20261022T130606Z-d4ebd077`, operation `20261022T131340Z-9ad586b5` signed 406.9 s (receipt OCR via API→AI OK).
Production prepare `20261022T132205Z-5ddaa89c`, operation `20261022T132312Z-cb63c597` signed
`ACCEPTED_LINE_DEFERRED` 814.8 s, AgentCore `kamal_production_a` v11; all four hosts v22.23.4/OpenSSL 3.5.9 with
the Brotli fix marker, cap-drop kept, 0 level-50, restarts 0; public br/gzip → 415, plain → normal validation.
UAT then paused again on the owner's word ("ถ้าเสร็จทุกอย่างแล้ว ปิด uat ให้หน่อยนะ"): power-uat pause `20261022T133726Z-0bf75cba`, UAT_POWER_PAUSED_WITH_DATABASE 20:43.

No deployment, restart, customer-gate or business-data change. UAT was not started. Seven owned
SSM sessions terminated successfully; UAT/READY/PROD IDs are NOT_DISPATCHED.
[Full findings, exact evidence and limits](../research/security-review-2026-10-21-th.md) (kept on the owner's laptop, not in git).

## Historical UAT power state — paused 2026-10-22 (Asia/Bangkok)

Owner requested “ปิด uat ได้แล้ว”. Original Plan A pause operation
`20261021T180137Z-0ccc30e3` completed once with `UAT_POWER_PAUSED_WITH_DATABASE` in 336.241
seconds. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original RDS
`watchdog-bms-uat-db` independently read back stopped; desired state is paused. Workers/API/AI
were gracefully stopped before hosts and database. Both owned SSM sessions terminated; local active
guard and shared cloud mutex are absent. Production public health 200/OPEN passed before and after.
No Production mutation, release, data deletion or customer-gate change; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. Data, Redis, ALB and storage remain retained.

The saved pause baseline has source `733f77864a2ad333a781852fd95cf3c610f0a421` for all three
services, superseding the previous resume's runtime. Future resume must use this exact retained
baseline through `python3 infra/kamal/power-uat start` with a valid scoped MFA session.
The workstation is no longer needed for this completed operation.
[Pause evidence and limits](../agent-memory/uat-power-pause-2026-10-22.md).

## Historical UAT power state — running 2026-10-21 (Asia/Bangkok), second resume

Owner requested “เปิด uat” and completed MFA for the scoped UAT profile. Plan A operation
`20261021T161821Z-b5a04f57` completed once with `UAT_RUNNING_OPEN` in 343.157 seconds.
Desired state is active; original RDS `watchdog-bms-uat-db` is available; API
`i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65` are running. Database readiness
preceded host startup.

Exact retained runtime fingerprints match the latest pause baseline; all three services retain
source `29b1eab65fe852db0abcd7b2f69d45d64a1ae540`. API/DB, AI, workers/Redis/internal-API
readiness passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions
terminated; local active guard and shared cloud mutex are absent. Production public health 200/OPEN
passed before and after. No application release, data deletion, gate change or Production mutation;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.
[Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-21-second.md).

Use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT profile.
The Plan A active-intent/database-first protocol and MFA prerequisite remain mandatory.

## Historical UAT power state — paused 2026-10-21 (Asia/Bangkok), after morning use

Owner requested “ปิด uat ได้แล้ว”. Original Plan A pause operation
`20261021T044652Z-a3920c2b` completed once with `UAT_POWER_PAUSED_WITH_DATABASE` in 316.780
seconds. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original RDS
`watchdog-bms-uat-db` independently read back stopped; desired state is paused. Workers/API/AI
were gracefully stopped before hosts and database. Both owned SSM sessions terminated; local active
guard and shared cloud mutex are absent. Production public health 200/OPEN passed before and after.
No Production mutation, release, data deletion or customer-gate change; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. Data, Redis, ALB and storage remain retained.

The saved pause baseline has source `29b1eab65fe852db0abcd7b2f69d45d64a1ae540` for all three
services, superseding the morning resume's runtime. Future resume must use the exact retained
baseline through `python3 infra/kamal/power-uat start`. Interim evidence remains preserved but is
superseded by final completion. The workstation is no longer needed for this operation.
[Pause evidence and limits](../agent-memory/uat-power-pause-2026-10-21-second.md).

## Historical UAT power state — running 2026-10-21 (Asia/Bangkok)

Owner requested “เปิด uat”. Plan A power operation `20261021T022345Z-77d13f74` completed once
with `UAT_RUNNING_OPEN` in 264.038 seconds. Desired state is active; original RDS
`watchdog-bms-uat-db` is available; API `i-0248e3a31d9b75ad1` and AI/workers
`i-0ef193d594e475a65` are running. Database readiness preceded host startup.

Exact retained runtime fingerprints match the latest pause baseline; all three services retain
source `1e25d673db5d3f19997176eeab8ea54533d1a57f`. API/DB, AI, workers/Redis/internal-API
readiness passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions
terminated; local active guard and shared cloud mutex are absent. Production public health 200/OPEN
passed before and after. No release, data deletion, gate change or Production mutation;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.
[Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-21.md).

Use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT profile.
The Plan A active-intent/database-first protocol remains mandatory.

## Historical UAT power state — paused 2026-10-21 (Asia/Bangkok)

Owner requested “ปิด uat ได้แล้ว”. Original Plan A pause operation
`20261020T173137Z-bc14ee85` completed once with `UAT_POWER_PAUSED_WITH_DATABASE` in 322.010
seconds. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original RDS
`watchdog-bms-uat-db` independently read back stopped; desired state is paused. Workers/API/AI
were gracefully stopped before hosts and database. Both owned SSM sessions terminated; local active
guard and shared cloud mutex are absent. Production public health 200/OPEN passed before and after.
No Production mutation, release, data deletion or customer-gate change; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. Data, Redis, ALB and storage remain retained.

The saved pause baseline exactly matches the preceding resume; all three services retain source
`1e25d673db5d3f19997176eeab8ea54533d1a57f`. Future resume must use the exact retained baseline
through `python3 infra/kamal/power-uat start`. Interim evidence remains preserved but is superseded
by final completion. The workstation is no longer needed for this operation.
[Pause evidence and limits](../agent-memory/uat-power-pause-2026-10-21.md).

## Historical UAT power state — running 2026-10-20 (Asia/Bangkok), second resume

Owner requested “เปิด uat” after the afternoon pause. Plan A power operation
`20261020T160539Z-de10d81d` completed once with `UAT_RUNNING_OPEN` in 368.013 seconds.
Desired state is active; original RDS `watchdog-bms-uat-db` is available; API
`i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65` are running. Database readiness
preceded host startup.

Exact retained runtime fingerprints match the latest pause baseline; all three services retain
source `1e25d673db5d3f19997176eeab8ea54533d1a57f`. API/DB, AI, workers/Redis/internal-API
readiness passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions
terminated; local active guard and shared cloud mutex are absent. Production public health 200/OPEN
passed before and after. No release, data deletion, gate change or Production mutation;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.
[Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-20-second.md).

Use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT profile.
The Plan A active-intent/database-first protocol remains mandatory.

## Historical UAT power state — paused 2026-10-20 (Asia/Bangkok), after afternoon use

Owner requested “ปิด uat ได้แล้ว” after the afternoon resume. Original Plan A pause operation
`20261020T103122Z-f350d84f` completed once with `UAT_POWER_PAUSED_WITH_DATABASE` in 567.907
seconds. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original RDS
`watchdog-bms-uat-db` independently read back stopped; desired state is paused. Workers/API/AI
were gracefully stopped before hosts and database. Both owned SSM sessions terminated; local active
guard and shared cloud mutex are absent. Production public health 200/OPEN passed before and after.
No Production mutation, release, data deletion or customer-gate change; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. Data, Redis, ALB and storage remain retained.

The saved pause baseline has source `1e25d673db5d3f19997176eeab8ea54533d1a57f` for all three
services, superseding the afternoon resume's runtime. Future resume must use the exact retained
baseline through `python3 infra/kamal/power-uat start`. Interim evidence remains preserved but is
superseded by final completion. The workstation is no longer needed for this operation.
[Pause evidence and limits](../agent-memory/uat-power-pause-2026-10-20-second.md).

## Historical UAT power state — running 2026-10-20 (Asia/Bangkok)

Owner requested “เปิด uat”. Plan A power operation `20261020T075416Z-a832c5b2` completed once
with `UAT_RUNNING_OPEN` in 360.837 seconds. Desired state is active; original RDS
`watchdog-bms-uat-db` is available; API `i-0248e3a31d9b75ad1` and AI/workers
`i-0ef193d594e475a65` are running. Database readiness preceded host startup.

Exact retained runtime fingerprints match the latest October20 pause baseline; all three services
retain source `458ec9aab594b41ca272aceb99e6c26ec3042b41`. API/DB, AI, workers/Redis/internal-API
readiness passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions
terminated; local active guard and shared cloud mutex are absent. Production public health 200/OPEN
passed before and after. No release, data deletion, gate change or Production mutation;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.
[Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-20.md).

Use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT profile.
The Plan A active-intent/database-first protocol remains mandatory.

## Historical UAT power state — paused 2026-10-20 (Asia/Bangkok)

Owner requested “ปิด uat ได้แล้ว”. Original Plan A pause operation
`20261019T221356Z-5759cebe` completed once with `UAT_POWER_PAUSED_WITH_DATABASE` in 441.820
seconds. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original RDS
`watchdog-bms-uat-db` independently read back stopped; desired state is paused. Workers/API/AI
were gracefully stopped before hosts and database. Both owned SSM sessions terminated; local active
guard and shared cloud mutex are absent. Production public health 200/OPEN passed before and after.
No Production mutation, release, data deletion or customer-gate change; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. Data, Redis, ALB and storage remain retained.

The saved pause baseline has source `458ec9aab594b41ca272aceb99e6c26ec3042b41` for all three
services, superseding the October19 resume's runtime. Future resume must use the exact retained
baseline through `python3 infra/kamal/power-uat start`. Interim evidence remains preserved but is
superseded by final completion. The workstation is no longer needed for this operation.
[Pause evidence and limits](../agent-memory/uat-power-pause-2026-10-20.md).

## Historical UAT power state — running 2026-10-19 (Asia/Bangkok)

Owner requested “เปิด uat”. Plan A power operation `20261019T044422Z-5614625c` completed once
with `UAT_RUNNING_OPEN` in 387.455 seconds. Desired state is active; original RDS
`watchdog-bms-uat-db` is available; API `i-0248e3a31d9b75ad1` and AI/workers
`i-0ef193d594e475a65` are running. Database readiness preceded host startup.

Exact retained runtime fingerprints match the October18 pause baseline; all three services retain
source `ee0d65ccc93ab344e32d363ec48171f57c271809`. API/DB, AI, workers/Redis/internal-API
readiness passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions
terminated; local active guard and shared cloud mutex are absent. Production public health 200/OPEN
passed before and after. No release, data deletion, gate change or Production mutation;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.
[Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-19.md).

Use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT profile.
The Plan A active-intent/database-first protocol remains mandatory.

## Historical UAT power state — paused 2026-10-18 (Asia/Bangkok)

Owner requested “ปิด uat ได้แล้ว”. Original Plan A pause operation
`20261018T091319Z-f5484b30` completed once with `UAT_POWER_PAUSED_WITH_DATABASE` in 426.474
seconds. API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65` and original RDS
`watchdog-bms-uat-db` independently read back stopped; desired state is paused. Workers/API/AI
were gracefully stopped before hosts and database. Both owned SSM sessions terminated; local active
guard and shared cloud mutex are absent. Production public health 200/OPEN passed before and after.
No Production mutation, release, data deletion or customer-gate change; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. Data, Redis, ALB and storage remain retained.

The saved pause baseline has source `ee0d65ccc93ab344e32d363ec48171f57c271809` for all three
services, superseding the earlier resume's runtime. Future resume must use the exact retained
baseline through `python3 infra/kamal/power-uat start`. Owner-requested interim evidence remains
preserved, but is superseded by final completion. The workstation is no longer needed for this
operation. [Pause evidence and limits](../agent-memory/uat-power-pause-2026-10-18.md).

## Historical UAT power state — running 2026-10-18 (Asia/Bangkok)

Owner requested “เปิด uat”. Plan A power operation `20261018T083826Z-a125e134` completed once
with `UAT_RUNNING_OPEN` in 597.466 seconds. Desired state is active; original RDS
`watchdog-bms-uat-db` is available; API `i-0248e3a31d9b75ad1` and AI/workers
`i-0ef193d594e475a65` are running. Database readiness preceded host startup.

Exact retained runtime fingerprints match the October12 pause baseline; all three services retain
source `de8389ce304dd96dcaba0104a2a09b8d609072fa`. API/DB, AI, workers/Redis/internal-API
readiness passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions
terminated; local active guard and shared cloud mutex are absent. Production public health 200/OPEN
was verified before and after. No release, data deletion, gate change or Production mutation;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.
[Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-18.md).

Use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT profile.
The Plan A active-intent/database-first protocol remains mandatory.

## Historical UAT power state — paused 2026-10-12 (Asia/Bangkok)

Owner requested “ปิด uat ได้แล้ว”. Plan A power operation `20261012T102746Z-fe821dd6` completed
once with `UAT_POWER_PAUSED_WITH_DATABASE` in 428.073 seconds. API `i-0248e3a31d9b75ad1`,
AI/workers `i-0ef193d594e475a65` and original RDS `watchdog-bms-uat-db` independently read back
stopped; desired state is paused. Workers/API/AI were gracefully stopped before hosts and database.
Data, Redis, ALB and storage are retained. Both owned SSM sessions terminated; local active guard
and shared cloud mutex are absent. Production public health 200/OPEN was verified before the pause
and after UAT application hosts stopped. No Production mutation, release or customer-gate change;
UAT/READY/PROD run IDs are `NOT_DISPATCHED`.

The current saved pause baseline has source `de8389ce304dd96dcaba0104a2a09b8d609072fa` for
all three services, superseding the morning resume's runtime. Use the exact retained baseline with
`python3 infra/kamal/power-uat start`; do not restore the older source described below.
[Pause evidence](../agent-memory/uat-power-pause-2026-10-12.md).

## Historical UAT power state — running 2026-10-12 (Asia/Bangkok)

Owner requested “เปิด uat”. Plan A power operation `20261012T085508Z-5950c4d7` completed once
with `UAT_RUNNING_OPEN` in 480.850 seconds. Desired state is active; original RDS
`watchdog-bms-uat-db` is available; API `i-0248e3a31d9b75ad1` and AI/workers
`i-0ef193d594e475a65` are running. Database readiness preceded host startup.

Exact retained containers/images/config/source/restart policies match the last successful pause;
serving release remains `20261010T051819Z-2efb43f7`, source
`9d9473b55f30f31bd78720274c9d1d3cc94eb644`. API/DB, AI, workers/Redis/internal-API readiness
passed, as did public health/login 200 and customer OPEN. Both owned SSM sessions terminated;
local active guard and shared cloud mutex are absent. Production public health 200/OPEN was
verified before and after. No release, gate change or Production mutation; UAT/READY/PROD run IDs
are `NOT_DISPATCHED`. [Resume evidence and limits](../agent-memory/uat-power-resume-2026-10-12.md).

Continue to use `python3 infra/kamal/power-uat status`, `start`, or `pause` with the scoped UAT
profile. The Plan A active-intent/database-first protocol below remains mandatory.

## Historical UAT power state — Plan A, paused 2026-10-10

Owner-authorized Plan A is complete with verified KMS-signed evidence. API`i-0248e3a31d9b75ad1`
and AI/workers`i-0ef193d594e475a65` are stopped, and original RDS`watchdog-bms-uat-db` is now
also stopped. Desired state is paused; local/cloud guards released. Redis, EBS/S3 and data retained.
Automation stack`mangmee-uat-power` checks every30minutes and re-stops only the exact UAT DB
when intended paused and both hosts stopped, under the shared deploy/Redis mutex. Unknown outcomes
retain the guard. The dedicated UAT ALB maps only existing1a/1csubnets and resolves2IPv4 addresses;
Production's separate ALB and all shared subnet resources remain unchanged.

Cold DB/host resume passed in7m14s with identical signed application containers/images/config and
API/DB/AI/workers/Redis/internal-API/publicOPEN readiness. Read-only DB inspection found269tables/
124397rows; exact344S3versions/6delete markers and storage identity/config matched baseline.
Final pause took7m31s. All four Production hosts running, health200/OPEN and unchanged ALB were
verified after completion. No application release or gate/data mutation. UAT/READY/PROD run IDs
remainNOT_DISPATCHED. [Signed evidence, operation IDs and limits](../agent-memory/uat-cost-plan-a-2026-10-10.md).

Current serving UAT is signed release`20261010T051819Z-2efb43f7`, source
`9d9473b55f30f31bd78720274c9d1d3cc94eb644`, preceding this maintenance. The October9 restoration
source below is historical, not the current release. The new power controller preserves current
containers/images/config, never restores the older images. Use `python3 infra/kamal/power-uat status`,
`python3 infra/kamal/power-uat start` or `python3 infra/kamal/power-uat pause` with the default scoped
UAT profile. Wait at least30seconds between completed operations (SSM parameter recreation).
Do not use bare EC2 starts after Plan A: active intent and RDS readiness must precede app start.
The first startup may take several minutes; a failed guard requires reconciliation of that exact
operation before retry. [Commands and recovery boundaries](../../infra/kamal/README.md#uat-power-and-cost-plan-a--october10).

## Historical UAT power state — paused 2026-10-10 (Asia/Bangkok)

Owner requested “ปิด uat”. One normal stop request paused API `i-0248e3a31d9b75ad1` and
AI/workers `i-0ef193d594e475a65`. Both independently read back **stopped**, without public IPs;
EBS volumes and data retained. Canonical target and signed restoration evidence unchanged.
No active deployment or executable release workflow overlapped; no deployment/customer-gate change.

All four Production hosts remain running; public health200 and PlatformAccessOPEN verified.
UAT RDS, Redis, ALB and storage are retained and remain billable. Before reopening, start the exact
two hosts and verify current IP/SSM/host identity, deep readiness and public OPEN. The public IPs in
the historical resume below are stale. [Pause evidence](../agent-memory/uat-power-pause-2026-10-10.md).

## Historical UAT cost baseline — 2026-10-10, before Plan A

For the owner's20hours/month UAT cost plan, non-root readback before Plan A confirmed both application hosts
still stopped: API t3.large in1a, AI/workers t3.medium in1c; gp3 EBS40GiB each. RDS db.t4g.micro,
PostgreSQL/gp3/20GiB/SingleAZ/1-day backup is available with no read replica. Redis cache.t4g.micro
one node is available. Dedicated ALB is active in1a/1b/1c; its DNS resolves3IPv4 addresses.24active
UAT Secrets Manager entries and13CloudWatch metric alarms remain; no NAT gateway or VPC endpoint
in the UAT VPC. Secret values and database records were not read; no resource changed.

Cost consequence: EC2 downsizing only saves1.584USD at20runninghours, whereas pausing RDS and
reducing ALB to its two host AZs could save20.90USD/month under the plan's30EC2/40RDS/730month-hour
assumptions. The existing stopped-EC2 pattern must be used as the baseline, not always-on EC2 or
September's transition-month total. Remaining24secret charges must not be omitted just because
historical environment tags attributed only one secret to UAT. These are public-rate forecasts,
not newly observed monthly billing. [Plan, acceptance, costs and rollback](../plans/uat-cost-reduction-plan-2026-10-10-th.md) (kept on the owner's laptop, not in git).

## Historical UAT power state — running 2026-10-09 19:47 (Asia/Bangkok)

Owner requested “เปิด uat”. One start request resumed retained API `i-0248e3a31d9b75ad1` and
AI/workers `i-0ef193d594e475a65`; both independently running and SSM Online. Private IPs remain
10.92.0.10/10.92.0.42; current public IPs are13.212.240.142/13.214.139.226. Existing SSH host keys
match; canonical SSM target is unchanged. Use enrolled private addresses, not old public addresses.

The same original API/AI/workers containers, images, source and configurations passed strict runtime
readback and deep API/DB, AI, worker/Redis/internal-API readiness. Both ALB targets healthy;
RDS/Redis available. UAT public health/login200 and PlatformAccessOPEN; LINE UAT @234jrspv's
configured webhook passed LINE's empty-event test200. No new real conversation was exercised in
this resume. Production public health200/OPEN verified. Both owned SSM sessions terminated.

This is a power resume, not a new release or customer-gate mutation. Original signed restoration
evidence is unchanged; UAT/READY/Production workflow IDs remainNOT_DISPATCHED. EC2 compute charges
resume. [Power-resume evidence](../agent-memory/uat-power-resume-2026-10-09.md).

## Historical UAT power state — paused 2026-10-09 (Asia/Bangkok)

Owner requested “ปิด uat ก่อน” after confirming actual LINE UAT AI use. The established reversible
power-pause procedure stopped only API `i-0248e3a31d9b75ad1` and AI/workers `i-0ef193d594e475a65`
in restored VPC `vpc-062e5bf61b966285d`. Both independently read back **stopped**, without public IPs;
EBS volumes and all data are retained. Public UAT health returns504 while the origin is off.
No deployment or customer-gate mutation; canonical target and signed restoration evidence are unchanged.

RDS, Redis, ALB, EBS/S3/ECR and other retained storage/services continue to incur charges. This is an
application power pause, not zero-cost retirement. Production's four hosts remain running and public
health200/PlatformAccessOPEN were verified. No Production resource changed.

Before reopening, start the exact two retained UAT hosts, verify current IPs/SSM identity and deep
API/AI/workers readiness, then public health/OPEN. Former public addresses must not be reused blindly.
[Power-pause result and evidence](../agent-memory/uat-power-pause-2026-10-09.md).

## UAT disaster restoration completed — 2026-10-09 (before subsequent power changes)

Owner requested “แยก agent กู้ UAT ต่อเลย”. Separate operation `20261009-uat-restore` restored
last accepted source `67c270d3cf5e46bff367d2e84e76f8efd6bb9e27` and exact retained images/configuration.
UAT was **online and OPEN, with verified KMS-signed smoke acceptance** at09:34:56UTC; the later
owner-requested power changes above supersede its runtime state.
UAT/READY/PROD workflow IDs are `NOT_DISPATCHED`. Production is accepted separately below.

- Stack `mangmee-kamal-uat` UPDATE_COMPLETE, VPC `vpc-062e5bf61b966285d`. API
  `i-0248e3a31d9b75ad1` / `10.92.0.10`; AI/workers `i-0ef193d594e475a65` / `10.92.0.42`.
  Original two-host sizes retained; enrolled SSM/strict SSH, public TCP22 closed.
- Private RDS `watchdog-bms-uat-db`, PostgreSQL18.3/db.t4g.micro/SingleAZ/1-day backup, is available.
  Remote restoration matched all268tables/120575rows, sequences, extensions and original owners/ACLs.
  All342S3versions/261.8MB and6delete markers restored;332attachment and6read-job version references
  reconciled with no other business-field changes before runtime. All310ACTIVEattachments covered.
- Redis `watchdog-bms-uat-redis` recovered5738keys; PING and queue comparison pass. Dedicated
  AgentCore `watchdog_orchestrator_uat_kamal-GcmkRKD5k3`, qualifier `kamal_uat_a`, is READY.
- Dedicated ALB `mangmee-uat-gateway`; DNS-only origins `uat-origin.mangmeeplus.com` and
  `uat-ai-origin.mangmeeplus.com`, ACM62790bc6-3cd6-4516-8d85-28b93e9e2fd4 ISSUED.
  Both ALB targets healthy; API/AI/workers exact image/config/deep readiness passed. Public UAT proxied
  CNAME and Worker now use uat-origin.mangmeeplus.com; Worker789e0268 is100%Ready. Public health/login
  return200 and PlatformAccess isOPEN. Existing browser session renders the WatchDog UAT dashboard;
  no fresh login/logout was performed or required by the retained UAT smoke protocol.
- LINE UAT channel2010784371/bot@234jrspv now points to
  https://uat-origin.mangmeeplus.com/v1/line/webhook. LINE new-endpoint and configured-endpoint
  tests both pass200. After signed acceptance, the owner confirmed a successful actual LINE UAT AI
  conversation: “ใช้ได้แล้ว เมื่อกี้ลองแล้ว” (October9, Asia/Bangkok). This is owner-reported verification;
  the original signed smoke evidence remains unchanged. Postmark20950027 and Stripe test callbacks
  retain their public UAT URLs; unauthenticated empty requests reach their expected401boundaries.
  This proves routing/auth rejection, not email delivery or payment processing.
- Three Kamal log groups retain3days,8metricfilters and13original alarms restored with unchanged
  thresholds/actions. Existing confirmed SNS topic is reused without changing its policy/subscription;
  M01/M14 alarms retain their original empty action lists. UAT bucket browser CORS and original
  SSE-C blocking are restored; real OPTIONS preflight200. Final infrastructure readback has13/13alarmsOK.
- Canonical UAT target enrolled under the operation lock; only matching active guard released.
  Exact Redis seed/grant, remote transfer files, local isolated fixtures and owned transports cleaned.
  All10SSMtermination calls accepted, zero active owned sessions and zero local transport processes;
  History has EndDate for all10, with6Terminated and4staleTerminating labels retained in evidence.
  Original archives remain unchanged. No application rebuild, schema change or customer-gate mutation.

Signed result `RESTORED_UAT_OPEN_SMOKE_ACCEPTED`, receipt SHA256
`50a77dc299b39b70e6ebc539f721dcbadbc6ad3ac98d228a52f7e5d4b97084e1`.
Restoration resumed AWS charges; the later temporary UAT power pause and resume are recorded above.

[UAT signed restoration evidence and acceptance limits](../agent-memory/uat-offline-restore-2026-10-09.md).
Private evidence: `~/.codex/offline-restores/20261009-uat/`. Dev/Official OA remain retired.

## Public website redirect preparation — 2026-10-21

Owner clarified that the future promotional homepage belongs to the existing `mangmeeplus`
application at `/`, with login at `/login`. Cloudflare Single Redirect
`Official to MangmeePlus homepage` (`eba5af4a671a42e7a428e8f9ae190131`) is enabled:
exact hostname `official.mangmeeplus.com` → `https://mangmeeplus.com/`, HTTP301,
preserving query strings. Existing proxied DNS remains in place; the Pages project was not deleted.
HTTP/HTTPS and old-path checks pass; login200, health200/ok, public platform stateOPEN and
anonymous auth/me401 remain intact. Rollback: disable only this rule.

Owner subsequently added UAT and authorized Wrangler. Both exact-root Worker redirects were
removed, UAT first with HTTP/browser acceptance before Production. UAT version
`d14cb6b4-e26a-4c46-90c6-c8133940b19b` and Production version
`07f7396e-9007-4d9d-9320-d5e5433477b0` serve100%. Origins and all existing runtime settings
are preserved. Both roots now200 and render the separately released promotional homepage;
homepage→login navigation, health200/ok, customerOPEN, anonymous auth/me401 and static assets pass.
Wrangler logged out and unauthenticated state confirmed. This task performed no application release,
AWS or customer-gate change; UAT/READY/PROD IDs `NOT_DISPATCHED`.
[Exact versions, rollback and evidence](../agent-memory/mangmee-root-homepage-cloudflare-2026-10-21.md).

## WWW canonical redirect — 2026-10-21

During the SEO audit, the owner explicitly requested `www.mangmeeplus.com` forwarding.
Added CNAME `www` → `mangmeeplus.com`, Proxied, TTL Auto, and enabled native Single Redirect
`WWW to MangmeePlus canonical` (`9f7c0a3d1f634a48a764b7370f02b715`), order2 after official.
Exact hostname match; dynamic target `concat("https://mangmeeplus.com", http.request.uri.path)`,
301 and preserve query. HTTP/HTTPS root, login/query and sitemap paths passed; TLS verification
passed and Chrome navigation landed on the main homepage. Public DNS1.1.1.1/8.8.8.8 readback passed;
an initial local negative DNS cache is retained in evidence. Existing Workers/apex/origins/UAT
remain unchanged. No application deploy or gate change; all workflow IDs `NOT_DISPATCHED`.
[SEO findings and www evidence](../research/mangmee-live-seo-audit-2026-10-21-th.md) (kept on the owner's laptop, not in git).

## Public SEO edge remediation — 2026-10-21

Owner explicitly requested sitemap submission/homepage indexing, official crawler-file redirects,
HTTPS apex, and UAT/auth search exclusion. UAT Worker published once at04:09:29UTC, version
`727e5434-99ae-4174-ba0b-979fb4be6b07`, deployment`0b7ffb7a-4524-4b82-8261-104c148bd62d`.
Production followed UAT HTTP/browser acceptance at04:10:58UTC, version
`bd2f5710-1554-4492-973c-4959c4838d29`, deployment`3d10e899-533f-4e80-ab89-6edaabf48883`.
Source and all previous runtime settings independently read back exactly; only source/version
annotations changed. Auth/API forwarding and origins retained, no app image/AWS/gate mutation.
UAT/READY/PROD workflow IDs remain`NOT_DISPATCHED` for this edge operation.

- UAT Worker sends`X-Robots-Tag: noindex, nofollow` and crawlable robots.txt. Private data still
  requires the original application authentication/authorization. Google Live Test explicitly
  detects header noindex; do not replace this with robots Disallow-all, which hides the directive.
- Production Worker sends the same header only for public login/signup/forgot-password paths
  and removes only their Disallow lines from robots.txt. Google Live Test detects login noindex;
  homepage remains200/indexable. Both health200, customerOPEN, anonymous auth/me401 pass.
- Single Redirect`73fd8ac558ae44c3bd06432f7d5cd781`, first, maps official `/sitemap.xml` and
  `/robots.txt` to the same paths on HTTPS apex with301/query preservation. Existing official
  homepage rule and www rule follow unchanged.
- Single Redirect`d79db641ecf345e9bc71211ab3de5467`, last, matches
  `(http.host eq "mangmeeplus.com" and not ssl)` and308 redirects to HTTPS apex preserving
  method/path/query. Do not broaden to every subdomain/webhook without reviewing its owner.
- Main sitemap processed successfully by Google (5URLs); homepage indexing requested once.
  Ranking/index refresh remains Google's processing outcome, not a deployment acceptance claim.

Rollback only affected Worker to its saved previous version: UAT`d14cb6b4-e26a-4c46-90c6-c8133940b19b`,
Production`07f7396e-9007-4d9d-9320-d5e5433477b0`; disable only the named new rules if necessary.
Keep older www and official homepage rules. [Task evidence and limits](../agent-memory/mangmee-seo-remediation-2026-10-21.md).

## Legacy Pages and direct-origin SEO routing — 2026-10-21

Owner explicitly requested completing legacy pages.dev/direct origins without affecting homepage,
login or API. Cloudflare Bulk Redirect rule `4cbf7ea2778f49a69be93b9f175c88ec`, list
`c2231f3334ab4d91a2ab544a6306c1df` (`mangmee_retired_pages`), now301 redirects
`mangmeeplus-web.pages.dev` and its deployment subdomains to HTTPS apex, preserving path/query.
The specific retired `/ai-read-receipt` subtree maps to the homepage without path suffix.
Existing official/www/HTTPS rules and Pages deployments remain retained.

Both DNS-only API origins retain their original ALBs/targets and live LINE webhook URLs.
Two CloudFormation-managed ListenerRules now precede normal origin forwarding:

- `SeoPublicProxyForward`, priority2: exact API-origin host plus exact public X-Forwarded-Host
  → original ApiTargets. Existing Cloudflare Workers already set this header. It is a routing
  marker, not authentication or an origin-access restriction.
- `SeoDirectPublicRedirect`, priority3, DependsOn proxy-forward: exact API-origin host,
  GET/HEAD, bounded public/auth/SEO-file path patterns →301 same path/query on the matching
  public HTTPS host (Production apex; UAT public host with existing noindex).
- API/webhook/other methods and unmatched paths keep their original forwarding rule. UAT
  fallback260 remains unchanged; Production `ApiStagingRoute` moved only priority1→4 after
  both new rules were staged/read back. AI routes remain unchanged. Never remove proxy-forward
  while the redirect is active, or proxied public pages could loop.

Executed once each: UAT change set `seo-legacy-20261021-uat/8e002332-8ce0-4a65-928e-498f0f65d017`
(2Add); Production stage `seo-legacy-20261021-prod-stage/def4c652-5e4d-4a70-8b42-09ac7592d52b`
(2Add); Production activation `seo-legacy-20261021-prod-active/e23d2d07-a5aa-4734-8137-eafb6bffaa34`
(1Modify priority only, no replacement). Both stacks UPDATE_COMPLETE, exact template readback,
all5original targets healthy. UAT46 and Production46 origin/public acceptance checks pass;
Pages52public+6deployment checks and browser navigation pass. Homepage remains indexable;
auth/UAT noindex and OPEN remain. No app/IAM/data/gate change; workflow IDs NOT_DISPATCHED.

Rollback: disable only the named Bulk Redirect. For Production, reviewed CF priority4→1 on the
original fallback deactivates the new rules; then remove only the two Seo rules if desired.
UAT rollback removes only the two Seo rules through a reviewed CF change set. Compare current
template first; retain intervening changes. Full private templates/intents:
`~/.codex/edge-operations/20261021-legacy-seo/`.
[Exact evidence, scope and limitations](../agent-memory/mangmee-legacy-domain-seo-2026-10-21.md).

## Release 2026-10-12 16:54 — Production and UAT (superseded by the 2026-10-20 to 2026-10-22 releases recorded above): the Official OA is `@695ultfm`

Production and UAT serve `main` source `de8389ce3` since 2026-10-12 16:54 and 16:48 Bangkok: the serving source of 2026-10-10 14:06 plus the Official OA move (#1081; twin #1082 on `develop`). The three billing merges of 2026-10-10 (#1075, #1077, #1079) are reverted on `main` and are NOT deployed; `develop` keeps them. How to put them back: `docs/agent-memory/line-official-oa-move-2026-10-12.md`. GitHub workflow ids are `NOT_DISPATCHED`: local Kamal path. PR CI was down (`startup_failure`, zero jobs); the API test list, the LINE whole-chain acceptance, the API typecheck and the release tool's tests were run locally.

| Env | Operation | Result | Seconds |
|---|---|---|---|
| UAT | `20261012T093703Z-ebd816b7` (prepare, images published) | PREPARED_NO_DEPLOYMENT | 376.2 |
| UAT | `20261012T094319Z-7989f55b` (prepared by `ebd816b7`) | ACCEPTED_LINE_DEFERRED, smoke, no migration | 285.5 |
| Production | `20261012T094806Z-fe95e8a1` (promotion of UAT `7989f55b`) | ACCEPTED_LINE_DEFERRED at the first try; the two Official OA secrets read and the token checked with LINE before any mutation (`official-oa-readiness.json`: `@695ultfm`); website-ready about 16:52; ten acceptance checks 16:53:07–16:53:45 with the owner signed in himself; observation file in the run directory | 380.9 |

After the release, with the channel token read into memory only: LINE reports the token's bot as `@695ultfm` (premium id `@mangmeeplus`); the new channel's webhook is `https://origin.mangmeeplus.com/v1/line/official/webhook`, active; LINE's own test call answered success, 200. The unsigned probe of the route answers 401. From this moment the old account `@107ewccg` gets no card from the ERP: its webhook calls are signed with the old secret and are refused. The owner replaced the two secret values himself and copied nothing else; the new account's rich menu, two keyword replies, greeting (video and two texts) and response settings were copied from the old account in his Chrome on his word. Sections below that name `@107ewccg` are history.

## Isolated Official OA live service — 2026-10-04

MangmeePlus Official @107ewccg now uses stack/function/role watchdog-bms-line-official-oa-prod
in ap-southeast-1/account311414082667. It serves only three public PNG icons and a dedicated
HMAC webhook, using immutable staging/live version1. Dedicated secret names are
watchdog-bms/production/line-official/channel-secret and channel-access-token; IAM reads only
those two ARNs and writes its own14-day log group. No ERP/DB/UAT/system OA resources changed.
Owner explicitly chose local validation, OA-only scope and thawatchai provisioning after
non-root denial; both acceptance signatures use existing non-root Production KMS authority.
Provider webhook active:true, Contact/Social native replies stopped, how-to/package retained.
Owner confirmed both cards received and actions working; supplemental acceptance signature verified. [Exact IDs, hashes, proof and recovery](../evidence/line-official-oa-isolated-publication-2026-10-04.md).

**No longer true since 2026-10-07:** this separate service and its function were deleted with the cost shutdown of 2026-10-07 and were not restored. Since 2026-10-10 10:07 the Official OA webhook points at the ERP route instead; see "Release 2026-10-10 10:07" below.


## Release 2026-10-09 22:52 — UAT only (superseded for UAT by the sections below)

UAT serves `main` `7cb86fa0e` since 2026-10-09 22:52 Bangkok: promotion campaigns release 1 (#1047/#1048, one migration `20261009120000_billing_promotion_campaigns`; inert until an Admin publishes a campaign), the LINE link sign-in fix (#1045/#1046) and everything else merged after `67c270d3c`. Production is NOT touched by this round and needs the owner's own go. Local Kamal path from the clean controller worktree; GitHub workflow ids (`UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`) are `NOT_DISPATCHED`. Times are Bangkok. Owner's words: "merge ขึ้น uat เลย ไวๆ", then "งั้นหยุดก่อน ค่อยทำต่อ" on hearing of the blocker below, then "ทำต่อเลย".

**Both environments were rebuilt on 2026-10-09** from the offline backup of 2026-10-07, by another session on the owner's word. Its records (`docs/agent-memory/uat-offline-restore-2026-10-09.md`, `production-offline-restore-2026-10-09.md` and the UAT power pause and resume notes) were in a local checkout and not on `main` when this section was written; they say Production serves `bdb65d8e8`. What the rebuild changed for a release: new hosts (UAT API `i-0248e3a31d9b75ad1`, AI/workers `i-0ef193d594e475a65`; private addresses unchanged), new origins behind a dedicated load balancer, a new AgentCore runtime, a recreated image registry, and **no ECS services**. The older sections of this file that name the earlier instance ids or read the ECS services describe resources that no longer exist.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261009T125820Z-58b5d41f` (preflight) | controller at `aedaad5f5` | PREFLIGHT_PASSED_NO_DEPLOYMENT 19:58. | 23.1 |
| UAT | `20261009T125859Z-15befebd` (prepare only) | `aedaad5f5` (#1047 twin = develop `48b5ef5f9` via #1048) | **FAILED** 20:03 at `fresh-config-and-image-validation`: "capture: command failed". The three ECS services the controller read its configuration baseline from are retired ("Service not found"). The build itself passed (270.6 s). Nothing published, nothing changed. | 294.3 |
| UAT | `20261009T152210Z-2b78fee0` (prepare only) | `7cb86fa0e` (#1049 twin = develop `853f6d4ad` via #1050: the enrolled configuration baseline) | PREPARED_NO_DEPLOYMENT 22:24; capture source `enrolled-baseline`. | 160.8 |
| UAT | `20261009T152531Z-a1dc90cc` (prepared by `2b78fee0`) | `7cb86fa0e` | **FAILED** 22:33 at `publish-and-pull`: the local push of the tools image reached its 240 s limit. Three images pushed; no pull, no lock, no `active.json`. | 474.8 |
| UAT | `20261009T153414Z-54c9f0b9` (prepared by `2b78fee0`) | `7cb86fa0e` | **FAILED** 22:39 at the same boundary: 42 of the tools image's layers were in the registry and one 1.4 GB layer could not upload inside the limit. No pull, no lock, no `active.json`. Not retried as it was. | 294.2 |
| UAT | `20261009T154644Z-822c9df4` (prepared by `2b78fee0`) | `7cb86fa0e` | ACCEPTED_LINE_DEFERRED 22:52, smoke, 12/12 phases, **1 migration** (database phase 74.3 s, rollout 129.7 s, publish-and-pull 48.9 s), AgentCore `kamal_uat_b` v2, signature verified, 19 builds retired, 2 SSM sessions closed. Public probes 22:52:58: health 200, platform-access 200 OPEN, `/login` 200. | 353.3 |

**The configuration baseline of a rebuilt environment is enrolled, not read from ECS** (#1049/#1050, `infra/kamal/README.md`, "Each release"). Where `.env.kamal/<environment>/config-baseline/<service>.configuration.json` exists, the capture reads the three configuration bodies from it; secret versions are still resolved fresh, `config.json` still supplies tracked changes, and the second read before mutation still compares bodies and versions. UAT was enrolled at 22:16 from the bodies of the last accepted release `20261005T155337Z-20348016`, with the one plain value that had changed on the new hosts (`CORS_ALLOWED_ORIGINS` of ai-gateway). Two reads from the hosts proved it, by key name and value hash only: before the change, the three serving containers ran that release's environment exactly except five keys (four of them computed by the controller from the target); after the prepare, the prepared environments equalled the serving ones except `GIT_SHA`, `SERVICE_VERSION` and `AGENTCORE_EXPECTED_SOURCE_COMMIT`. All 14 secret references still resolved to the same ARNs. **Production needs the same enrollment and the same proof before its next release**; the restore records forbid recreating ECS to supply a baseline. A plain value that is not in `config.json` is from now on changed in the enrolled body.

**A recreated registry is cold, and the tools image does not fit the 240 s push limit on this uplink.** Every layer had to be uploaded again; an interrupted layer upload restarts from zero, so applying again with the same prepared build (the remedy of "The UAT pre-mutation budget" below) could not pass: the last 1.4 GB layer needed 384 s. Remedy used: push the prepared tools image tag once by hand with the deploy role and a throw-away registry login directory, then apply again with the same prepared build (48.9 s for the phase). Expect the same on the first Production release after the rebuild.

**A host that no longer exists reads like a missing permission.** `ssm:StartSession` on the earlier instance ids answers AccessDenied for the deploy role; with the new instance ids the same call works. Read the enrolled target for the current ids before concluding anything about the role.

**Not proven by this round.** The acceptance is the config and readiness smoke: nobody signed in, no campaign was created and no payment was made. Before a campaign is opened to real customers: a TEST campaign from the Starter template on UAT, a purchase with a test card in the pay-once and the auto-renew card modes, and the bound subscription's trial end (`docs/plans/starter-249-bonus-month-promotion-plan.md` §9).

## Release 2026-10-10 01:02 — UAT only (superseded for UAT by the section below)

UAT serves `main` `c1774b798` since 2026-10-10 01:02 Bangkok: the seven fixes from the UAT walk of the promotion campaign (#1053/#1054; no migration) on top of the section below. Production is NOT touched. Local Kamal path; GitHub workflow ids `NOT_DISPATCHED`. Owner's words: "เทสให้จบก่อน ค่อยแก้ทีเดียว", then "เสร็จแล้วขึ้น uat เลย". The walk itself is recorded in `docs/plans/starter-249-bonus-month-promotion-plan.md` §9.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261009T173354Z-f5a65473` (prepare only) | `c1774b798` (#1053 twin = develop `f3211301f` via #1054) | PREPARED_NO_DEPLOYMENT 00:38. | 289.3 |
| UAT | `20261009T173927Z-1d787897` (prepared by `f5a65473`) | `c1774b798` | **FAILED** 00:47 at `publish-and-pull`: the tools image push reached the 240 s limit with its 1 GB build layer still uploading; then the failure handler could not reach the host to release its lock ("ssh: command failed"), so `active.json` and the remote lock stayed. Nothing changed on UAT. | 483.3 |
| UAT | `20261009T175711Z-4c26cc39` (prepared by `f5a65473`) | `c1774b798` | ACCEPTED_LINE_DEFERRED 01:02, smoke, 12/12 phases, no migration (database phase 76.0 s, rollout 100.1 s, publish-and-pull 46.5 s), AgentCore `kamal_uat_a` v3, signature verified, 19 builds retired, 2 SSM sessions closed. Probes 01:02:47: health 200, platform-access 200, `/login` 200. | 308.5 |

**On a slow uplink every release trips the 240 s push limit, not only the first one after a registry rebuild.** The tools image carries its own 1 GB build layer, which changes with every source change; from this machine it needed 436 s that night (the 1.4 GB install layer had needed 384 s the evening before). The api-web image fitted with seconds to spare. Until the limit or the image changes, the working order is: prepare, push the prepared tools image tag once by hand (deploy role, throw-away registry login directory), then apply. Applying first only costs eight minutes and proves nothing.

**A failed run that cannot release its own lock leaves two things behind, and both are its own.** When the failure handler's ssh fails, the remote lock directory `~/.kamal/<service prefix>-release-lock` on the API host keeps the operation id in its `owner` file and `.env.kamal/<env>/active.json` keeps the same id; the next ordinary deploy refuses to start. Reconciliation used here, in this order: read the result (`changed` empty, the failed phase before any pull), read the host (lock owner equals the operation id; the serving containers are the previous release), then do the handler's own two steps by hand — remove the lock with the owner assertion, move `active.json` into the run directory. Do not remove a lock whose owner is another operation, and never when `changed` is not empty.

**A pre-check that counts release processes with a pattern naming the script counts the shell that runs it** (again; see the note of 2026-10-05 below): chained before the apply, it stopped the apply from starting at 00:39 and cost five minutes. Check processes in a separate command and read the run directories.

**The controller worktree must be fresh.** The system's temp cleaner removed files older than a few days from `/private/tmp/mangmee-release-controller-20261005` around midnight, its `.git` pointer among them. A release controller worktree is created from `origin/main` for the round (with `.env.kamal` linked in), not kept for days.

## Release 2026-10-10 04:46 — UAT only (superseded for UAT by the section below), and the Production preparation

UAT serves `main` `e1425bf02` since 2026-10-10 04:46 Bangkok: the LINE event-discount sentence per renewal mode and the release tool's `--prepare --publish-images` (#1057/#1058; no migration), on top of the section above. Production is NOT touched: it still serves `bdb65d8e8` (restored 2026-10-09). Local Kamal path; GitHub workflow ids `NOT_DISPATCHED`. Owner's words: "ทำต่อเลย", "เสร็จแล้วขึ้น uat เลย", then at about 04:30 "ขึ้น uat เสร็จแล้ว ทดสอบซ้ำ อนุญาตทั้งหมด ให้กรอกข้อมูลเอง ถ้าผ่านแล้วทั้งหมด ให้ขึ้น prod ได้เลย". That is a conditional go for this promotion only, after the UAT re-test passes; the agent still does not type a password or a card number, and the Production acceptance needs the owner's own sign-in.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261009T212934Z-9f4b56d6` (prepare, images published) | `e1425bf02` (#1057 twin = develop `02427f3b7` via #1058) | PREPARED_NO_DEPLOYMENT 04:41; the four `prepared-` tags published: first use of `--publish-images`. | 721.2 |
| UAT | `20261009T214200Z-1f694b27` (prepared by `9f4b56d6`) | `e1425bf02` | ACCEPTED_LINE_DEFERRED 04:46 at the first try, smoke, 12/12 phases, no migration (publish-and-pull 35.6 s, database phase 57.7 s, rollout 97.0 s), AgentCore `kamal_uat_b` v4, signature verified, 19 builds retired, 2 SSM sessions closed. Probes 04:46: health 200, platform-access 200 OPEN, `/login` 200. | 255.3 |
| Production | `20261009T214957Z-4708ca2b` (prepare only) | `e1425bf02` | **FAILED** 04:53 at `fresh-config-and-image-validation`: "AWS secretsmanager:get-secret-value failed". Preflight (16.9 s) and build (195.1 s) passed; capture source `enrolled-baseline`. Nothing published, nothing changed. | 220.8 |
| Production | `20261009T215722Z-ccdd4e4b` (rehearsal of the prepare, one setting dropped in memory; marked by a file in its run directory) | `e1425bf02` | PREPARED_NO_DEPLOYMENT 04:57: config validation, host storage and the second configuration read passed. | 39.5 |

**Uploading the prepared images first makes the apply pass at the first try on this uplink.** `--prepare --publish-images` took the upload out of the apply's 240 s limit: `publish-and-pull` needed 35.6 s, where the two rounds before it had each lost an apply at that boundary. The working order is now two commands (README, "Each release").

**Production's configuration baseline is enrolled and proven** (private `.env.kamal/production/config-baseline/`, same method as UAT in the 22:52 section). Bodies: the capture of the last accepted release `20261005T180652Z-3f9b6aa1`, with ai-gateway `CORS_ALLOWED_ORIGINS` set to the new AI origin. Proof by key name and value hash only, one read-only session per host: the four serving containers ran that release's environment except the keys the controller sets from the enrolled target (API and AI internal origins, AgentCore ARN and qualifier; each equals the target's value) and that one CORS value; the two API hosts are equal. After the rehearsed prepare, the prepared environments equalled the serving ones except `GIT_SHA`, `SERVICE_VERSION`, `AGENTCORE_EXPECTED_SOURCE_COMMIT`, the keys an image supplies itself (`PATH`, `NODE_VERSION`, `YARN_VERSION`, `NEXT_TELEMETRY_DISABLED`) and the three Official OA keys below. Also read: the Production deploy role answers; both AgentCore endpoints (`kamal_production_a`, `kamal_production_b`) are READY; the registry exists; the trusted UAT signing key is enabled and the UAT images are readable with the Production role; each host has 31–37 GB free against at most 4.7 GB needed; no remote release lock on API host A and no `active.json`.

**A normal Production release asked for the retired Official OA credentials.** `infra/kamal/config.json` still set production `LINE_OFFICIAL_REPLY_ENABLED` to `true`, so a release on the normal path (a UAT promotion is one) reads the secrets `watchdog-bms/production/line-official/channel-secret` and `channel-access-token` and checks the token with LINE. Both secrets were deleted on 2026-10-07 10:16 with the Official OA retirement and were left out of the Production restore on purpose. The last Production release before the retirement that ran this read was the promotion of 2026-10-06 00:18; the hotfix after it preserved the serving configuration and never asked. What serves: the restored API containers still carry the old values in their environment and map the route, but since they started (2026-10-09 14:50) neither API host has logged one request on `/v1/line/official/webhook`, while other requests are logged. The route was never the Official OA's live path: the owner chose the separate Official OA service on 2026-10-04 (`docs/specs/line-official-oa-flex-replies-spec-th.md`). Fix: the entry is removed from the production settings (same change as this record). The next Production release therefore starts the API without the three `LINE_OFFICIAL_*` keys and the route answers 404; the code and the release tool's check stay, and setting the entry back brings the route back once the credentials exist again. Restoring the two secrets instead is the owner's call (account authority, inside the deletion recovery window).

**A Production `--prepare` needs the acceptance mode on its command line.** `deploy-prod --prepare` alone stops in argument validation with "Acceptance credentials file is missing", before a run directory or a cloud read; add `--production-browser-acceptance` (README corrected).

**Find the stops of a rebuilt environment before the owner is at the keyboard.** The Production prepare is read-only, takes four minutes with a warm build cache, and found a stop that the promotion would otherwise have hit with the owner waiting to sign in. When a stop is a tracked setting, rehearse the rest of the prepare with that one value changed in memory before merging, so that one merge and one UAT round carry every fix (the protocol's "inspect the next steps read-only").

## Release 2026-10-10 05:10 — UAT only (superseded for UAT by the 10:07 section below); Production prepared (promoted in the section below)

UAT serves `main` `e414d3a24` since 2026-10-10 05:10 Bangkok: the production settings without the retired Official OA entry and the phone-width fixes for long names (#1059/#1060; web and settings only, no API change, no migration), on top of the section above. This run is the candidate for Production; its receipt is valid for promotion until 2026-10-11 05:09. Production is NOT touched and still serves `bdb65d8e8`. Local Kamal path; GitHub workflow ids `NOT_DISPATCHED`.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261009T220107Z-b5865c95` (prepare, images published) | `e414d3a24` (#1059 twin = develop `512f462fe` via #1060) | PREPARED_NO_DEPLOYMENT 05:05. | 279.8 |
| UAT | `20261009T220600Z-1be0d474` (prepared by `b5865c95`) | `e414d3a24` | ACCEPTED_LINE_DEFERRED 05:09:58 at the first try, smoke, 12/12 phases, no migration (publish-and-pull 32.0 s, database phase 57.1 s, rollout 88.3 s), AgentCore `kamal_uat_a` v5, signature verified, 19 builds retired, 2 SSM sessions closed. Probes 05:10: health 200, platform-access 200, `/login` 200. | 238.2 |
| Production | `20261009T221020Z-c854916b` (prepare, images published) | `e414d3a24` | PREPARED_NO_DEPLOYMENT 05:13 with the merged settings: capture from the enrolled baseline, config validation, host storage, second read, then the four `prepared-` tags uploaded to the Production registry (16.1 s). Nothing installed. | 163.3 |
| Production | `20261009T221329Z-c4a7dd96` (promotion preflight, UAT run `1be0d474`) | controller at `e414d3a24` | PREFLIGHT_PASSED_NO_DEPLOYMENT 05:14. | 15.7 |

**What the Production preparation proves, and what it does not.** Proven: the enrolled baseline renders the serving configuration (prepared against serving, by key and hash: only `GIT_SHA`, `SERVICE_VERSION`, `AGENTCORE_EXPECTED_SOURCE_COMMIT`, and the three `LINE_OFFICIAL_*` keys that now go); the layers of the four prepared images equal the layers of the four signed UAT images (36, 22, 17 and 43 layers), so the promotion's push inside its 240 s limit finds every layer in the registry; the UAT receipt's signature verifies with the trusted UAT key under the Production role, and its AgentCore archive hash matches. Not proven until the promotion runs: the one migration against Production data (`20261009120000_billing_promotion_campaigns`, additive; applied on UAT on 2026-10-09), the AgentCore update on the spare endpoint, the rollout on four hosts, and the acceptance with the owner signed in.

**The promotion waits for the owner twice.** His go of about 04:30 is conditional on the UAT re-test, and the re-test needs two things only he types: his password at the campaign's re-authentication and a shop-owner sign-in. The Production acceptance needs his own sign-in on Production within minutes of website-ready. `main` stays at `e414d3a24` until then.

## Release 2026-10-10 09:41 — Production (superseded for Production by the section below)

Production serves `main` source `e414d3a24` since 2026-10-10 09:41 Bangkok, promoted with no rebuild from the signed UAT round of 05:10 above. Before it Production served `bdb65d8e8` (the hotfix of 2026-10-06, restored on 2026-10-09). UAT serves the same source. What it carries: promotion campaigns release 1 with every fix round (#1047, #1053, #1057, #1059; ONE migration `20261009120000_billing_promotion_campaigns`; inert until an Admin publishes a campaign on Production — none exists), the LINE link sign-in fix (#1045), the release tool changes (#1049, #1057) and the production settings without the retired Official OA entry (#1059). GitHub workflow ids (`UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`) are `NOT_DISPATCHED`: local Kamal path. Times are Bangkok.

| Env | Operation | Source | Result | Seconds |
|---|---|---|---|---|
| Production | `20261010T023632Z-1320dce9` (promotion of UAT `20261009T220600Z-1be0d474`) | `e414d3a24` | ACCEPTED_LINE_DEFERRED 09:41:46 at the first try, 12/12 phases, UAT signature verified, mode normal, **1 migration** (database phase 62.6 s), publish-and-pull 40.4 s (every layer was already in the registry), rollout 74.5 s on four hosts, AgentCore `kamal_production_b` v2, receipt signed and verified, 19 builds retired, 4 SSM sessions closed, no `active.json`. Probes 09:41:56: health 200, platform-access 200 OPEN, `/login` 200. | 314.1 |

**The owner's go and the re-test it was conditional on.** At about 04:30 he made the promotion conditional on a UAT re-test; back at about 07:00 he typed his password at the campaign re-authentication and signed in as the shop owner, and at about 07:13 wrote "ถ้าเสร็จทุกเคส ไม่มีปัญหาแล้ว ให้เอาขึ้น prod เลย". The re-test on source `e414d3a24` (customer side 07:04–07:25, Admin side 09:30–09:45) is recorded in `docs/plans/starter-249-bonus-month-promotion-plan.md` §9: every case of the promotion work passed. One older defect was found and reported before the promotion (the in-app refund review cannot open for an invoice paid by PromptPay QR; see below); asked whether to promote now or fix first, he chose "ขึ้นเลย แก้ตามหลัง". He signed in on Production himself at about 09:38 ("เข้าแล้ว").

**Acceptance.** Website-ready at 09:40:36, 244 s after the start. Ten checks from the page context of the built-in browser between 09:40:48 and 09:41:06: public platform-access 200 OPEN; `/login` 200; `/api/v1/auth/me` 200 with the bound administrator id, role SYSTEM_ADMIN, no password change or legal acceptance pending; a System Admin read 200; system platform-access OPEN, `servingMode` live, `canOpen` true; the click on "ออกจากระบบ"; then 401 on the three authenticated reads and public OPEN again. The observation file and `browser-acceptance.json` are in the run directory; the browser stage took 58 s. No password, token or cookie value was read or typed by the agent.

**Read back after the release** (one read-only session per host): all four containers run `e414d3a24` with exactly the release's environment (no differing key; only the keys an image supplies itself are extra); no `LINE_OFFICIAL_*` key is left, `/api/v1/line/official/webhook` answers 404, and the System OA webhook answers 401 to an unsigned request.

**Not exercised on Production by this release:** a LINE AI turn (`lineAcceptance` NOT_EXERCISED, as every promotion), and any promotion purchase. The new LINE event-discount sentence for a QR-bill shop has not been seen in a real LINE turn on either environment. **Rollout rule:** after the first promotion purchase on Production, never roll back past this release (an older binary fails closed on a `PROMOTION` receipt lot).

**Found on the UAT re-test, older than this work, NOT fixed by this release: the in-app refund review answers 409 for every invoice paid by PromptPay QR.** `GET …/invoices/<id>/refund-review` returned `CONTROL_REFUND_SOURCE_CHANGED` ("หลักฐานการคืนเงินเปลี่ยนหรือยังไม่ครบ") for all seven QR-paid invoices read on UAT — five promotion purchases and two normal purchases of 2026-09-29 — and 200 for the card-paid ones (with the promotion block where a promotion applies). Likely cause, read from the code and not yet proven against Stripe: `billing-refund-source.ts` accepts only a stored charge id that starts with `ch_`, and `billing-settlement.service.ts` has the same pattern, while Stripe gives a PromptPay payment an id that starts with `py_`. It fails closed: no refund can be created in the app for a QR payment and nothing wrong is paid out. Production runs the same code, so the same is expected there (not read). Until it is fixed, a refund of a QR payment is not possible through the Admin screen, and one made outside the app would bypass the entitlement and promotion-right handling: do not make one without reading the invoice first.

## Release 2026-10-10 10:07 — Production (superseded for Production by the 14:06 section below): the Official OA reply route is back

Production and UAT serve `main` source `9f8ad6924` since 2026-10-10 10:07 and 10:00 Bangkok. The only difference from the section above is `infra/kamal/config.json`: the production entry `LINE_OFFICIAL_REPLY_ENABLED` is back (#1063/#1064; the file is byte-equal to the version before #1059). Since 10:07:51 the LINE Official OA (`@107ewccg`) sends its webhook to the ERP route `https://origin.mangmeeplus.com/v1/line/official/webhook`, and the owner confirmed on his phone that both cards arrive ("กดแล้วผ่าน"). GitHub workflow ids are `NOT_DISPATCHED`: local Kamal path. Times are Bangkok.

| Env | Operation | Source | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261010T025416Z-fa22e6af` (prepare, images published) | `9f8ad6924` (#1063 twin = develop `503038b48` via #1064) | PREPARED_NO_DEPLOYMENT 09:57. | 166.7 |
| UAT | `20261010T025703Z-dbea40f9` (prepared by `fa22e6af`) | `9f8ad6924` | ACCEPTED_LINE_DEFERRED 10:00:40 at the first try, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_b` v6, signature verified. | 217.4 |
| Production | `20261010T030308Z-7580ebbc` (promotion of UAT `dbea40f9`) | `9f8ad6924` | ACCEPTED_LINE_DEFERRED 10:07:41 at the first try, 12/12 phases, no migration, the two Official OA secrets read and the token checked with LINE before any mutation (`official-oa-readiness.json`: `@107ewccg`), publish-and-pull 17.1 s, rollout 72.2 s, AgentCore `kamal_production_a` v3, receipt signed and verified, 4 SSM sessions closed. Website-ready 10:06:41; ten acceptance checks 10:06:49–10:07:07 with the owner signed in himself; observation file in the run directory. Probes 10:08: health 200, platform-access 200, `/login` 200. | 272.8 |

**Why, and what the 09:41 release got wrong about the Official OA.** #1059 removed the entry because a normal Production release could not read the two deleted Official OA secrets, and the ERP route had not received one request since the restore. Both facts were true, but the conclusion drawn in the owner message — "it affects nobody" — hid the real state: the separate Official OA service that sent the two cards (contact, social) was deleted on 2026-10-07 and never restored, the two native auto-replies it replaced had been switched off on 2026-10-04, so the Official OA's "ติดต่อมั่งมีทีม" and "โซเชียล" buttons had answered nothing for three days. Told that at about 09:50, the owner wrote "เอากลับมาด่วนที่สุด". When a retired dependency is found, say what the customer sees today, not only that the release is unaffected.

**How it was brought back (about 17 minutes from the order to LINE's successful test call; the owner's phone check followed within minutes).** (1) The owner restored the two secrets himself with his own profile after `aws login` (the deploy role is denied `secretsmanager:RestoreSecret` by design and that was not worked around); both were inside the deletion recovery window, with their values intact. (2) The settings entry was put back, one UAT round signed the source, and the promotion read the secrets and checked the token with LINE in its configuration phase. No separate Production prepare was run this time: the promotion validates the same things before any mutation, and the upload had fitted easily that morning. (3) After the release the unsigned probe of the route answered 401 instead of 404. (4) The Official OA webhook was read at LINE (still the deleted service's function URL, active true), set to the ERP route, tested by LINE's own test call (success, 200 OK) and read back. The channel token was read from Secrets Manager under the deploy role into memory only, never printed and never on a command line. (5) The three icons of the social card are served by the Production website (`/assets/line/official-oa-*.png`, 200).

**What the Official OA depends on from now on.** Its two cards are answered by the ERP API, so: the production settings entry `LINE_OFFICIAL_REPLY_ENABLED`, the two secrets `watchdog-bms/production/line-official/channel-secret` and `channel-access-token` (every normal Production release reads them and checks the token), and the webhook address at LINE. Deleting those secrets again stops every normal Production release at `fresh-config-and-image-validation` and, after the next release, the cards. The separate Official OA service of 2026-10-04 (section "Isolated Official OA live service" at the top of this file) no longer exists.

## Release 2026-10-10 10:22 — UAT only (superseded by the 14:06 section below): the QR refund fix, first round, not promoted

UAT serves `main` `f32871073` since 2026-10-10 10:22 Bangkok: the refund review, refund observation and settlement check accept the provider ids of a PromptPay QR payment (#1067/#1068; API only, no migration). Production is NOT touched and stays on `9f8ad6924`. Local Kamal path; GitHub workflow ids `NOT_DISPATCHED`.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261010T031258Z-d905de9b` (prepare, images published) | `f32871073` (#1067 twin = develop `e3f423e71` via #1068) | PREPARED_NO_DEPLOYMENT 10:17. | 292.6 |
| UAT | `20261010T031751Z-5f306c35` (prepared by `d905de9b`) | `f32871073` | ACCEPTED_LINE_DEFERRED 10:22 at the first try, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_a` v7, signature verified. | 253.4 |

**Cause of the defect, proven on the UAT database (read-only):** every paid invoice bought in a PromptPay mode stores a charge id that starts with `py_` (9 rows), every card one `ch_` (17 rows); the refund-source code accepted only `ch_` charges and `re_` refunds, and the settlement read knew only the `charge` and `refund` movement types while Stripe books a PromptPay payment as `payment`.

**UAT acceptance, 10:23–11:40, with real sandbox data:**
- Refund review: 200 for all six QR-paid invoices read (five promotion purchases, one normal purchase of 2026-09-29), with the promotion block. Before the fix: 409 for every one.
- Settlement check of 2026-10-09 run again: SUCCEEDED, 5 of 5 MATCHED, the three QR payments mapped to their shops and invoices. Before the fix the same day gave 2 MATCHED and 3 MANUAL ("other items in the Stripe account"), so QR receipts were missing from "ลูกค้าชำระเงิน".
- Refund preview on a QR invoice: accepted by the provider.
- **A real sandbox refund of a QR payment FAILED** (100 THB of 249, keep the package): submit and approve passed, the request was dispatched, and 0.7 s later the operation was `UNKNOWN` with `CONTROL_REFUND_PROVIDER_UNAVAILABLE`, no credit note, a review case opened, the invoice unchanged. The provider rejected `POST /credit_notes` with a 4xx. The Stripe client drops the provider's error body on purpose ("never forward Stripe's body"), and neither the logs nor the operation journal said why; the owner read it in the Stripe sandbox Workbench (Developers → Logs).

**The provider's reason (not a fault of our request):** "Failed to create credit note due to error creating a refund: Cannot send email. In order to complete this refund, we must collect refund details through email. To send email to the email address registered with your account, verify the email address first. To send email to other email addresses, submit your account application." (`type invalid_request_error`, `param refund_amount`, no `code`.) So a PromptPay refund is not pushed back the way a card refund is: **Stripe e-mails the customer to collect bank details, and the refund completes only after the customer answers.** A sandbox can only write to the account's own address. A second attempt at 11:51, after the shop's customer address had been changed to the account's own (verified) address, got the same answer: the provider writes to the address used when the payment was made, so no existing QR charge on UAT can be refunded; a new QR purchase paid with that address is needed for the proof. (An earlier guess in this record, that the refund needed available balance, was wrong.)

**What the two attempts showed about our own code:** a definite 400 on the create was kept as `UNKNOWN`, retried every five minutes with the same idempotency key (the provider only replays the stored 400), aged out after 23 hours, and meanwhile blocked every other refund of that company (`assertNoPendingRefund`). Two UAT test shops were blocked that way.

**Why it is not promoted.** With this source a QR refund request is accepted, approved and then sits in "รับคำขอแล้ว รอตรวจผลจาก Stripe" with a review case, retried every five minutes with the same idempotency key until it ages out after 23 hours; Production today refuses at the review, which is clearer. The settlement part is proven and safe, but it is in the same source. Before a promotion: read the provider's reason; then either make the refund work, or refuse a QR refund at the review with a sentence that says what to do instead. **Note for any other Production release in the meantime: `main` carries this change.**

**Follow-up change (same day, after this round):** the provider's own error code, type and HTTP status are kept on a rejected call (never its message, param or ids), stored on the refund operation journal and shown to staff in the reference section of the request; a create that the provider answers with 400 or 402 ends the request as `FAILED` / `CONTROL_REFUND_PROVIDER_REJECTED` with the mutation resolved, so it no longer blocks the company and `run` is no longer offered for it (409, 429, 5xx, no answer and any error of a read stay unknown as before); the refund review and request pages tell staff that a PromptPay refund goes through an e-mail from the provider to the customer.

## Release 2026-10-10 14:06 — Production and UAT (superseded by the 2026-10-12 section above): refunds of PromptPay QR payments

Production serves `main` source `9d9473b55` since 2026-10-10 14:06 Bangkok and UAT since 12:22: the QR refund fix (#1067) and its follow-up (#1071). API, contracts and web; no migration. What it does: the Admin refund review, refund request and settlement check work for an invoice paid by PromptPay QR; a create the provider rejects ends the request as failed with the provider's error identifiers kept; staff are told that a QR refund goes through an e-mail from the provider to the customer. GitHub workflow ids are `NOT_DISPATCHED`: local Kamal path. Times are Bangkok. Owner's go: "ขึ้นเลย" at about 13:58, after the UAT acceptance below was reported complete.

| Env | Operation | Source | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261010T050153Z-630f68b7` (prepare, images published) | `9d9473b55` (#1071 twin = develop `32e5bf613` via #1072) | PREPARED_NO_DEPLOYMENT 12:07. | 312.3 |
| UAT | `20261010T050705Z-67c7cb9e` (prepared by `630f68b7`) | `9d9473b55` | **FAILED_RECONCILIATION_REQUIRED** 12:15 at `native-rollout-and-readback`: ai-gateway replaced and ready, the new api-web container booted and the proxy switched to it after 98 s, then the ssh channel to the API host timed out while the superseded api-web container was being stopped ("Net::SSH::Timeout"). Workers were not reached. A transport drop, not the source. | 505.0 |
| UAT | `20261010T051819Z-2efb43f7` (prepared by `630f68b7`, after the reconciliation below) | `9d9473b55` | ACCEPTED_LINE_DEFERRED 12:22 at the first try, smoke, 12/12 phases, AgentCore `kamal_uat_b` v8 reused, signature verified. | 226.1 |
| Production | `20261010T065842Z-cbad8a65` (promotion of UAT `2efb43f7`) | `9d9473b55` | ACCEPTED_LINE_DEFERRED 14:06:15 at the first try, 12/12 phases, no migration, publish-and-pull 128.8 s (no separate upload this time; inside the 240 s limit but more than half of it), rollout 97.5 s, AgentCore `kamal_production_b` v4, receipt signed and verified, 4 SSM sessions closed. Website-ready 14:04:58; ten acceptance checks 14:05:09–14:05:27 with the owner signed in himself; observation file in the run directory. Probes 14:06: health 200, platform-access 200, `/login` 200; the Official OA route still answers 401 unsigned. | 452.2 |

**Reconciling a rollout that lost its connection after the proxy had switched (12:16–12:18).** State read first, read-only: on the API host the new api-web container was up and the proxy served it, the superseded api-web container was still up (the stop never reached the host), Kamal's own deploy lock `~/.kamal/lock-<service prefix>` named this deploy's version, and the release lock's owner was this operation; on the AI host ai-gateway was new and workers old; `active.json` was this operation's. The run was mode normal, so the tool's rollback did not apply. Done in one host session, each step after its own check: confirm the proxy target is the new container; stop (not remove) the superseded api-web container, detached so a dropped session cannot interrupt it again (it took about 75 s to exit); release Kamal's deploy lock only because its details named this deploy; release the release lock only because its owner was this operation; then move `active.json` into the run directory as `active.reconciled.json`. The next apply with the same prepared build rolled everything forward and signed. Note for the future: two api-web containers of different versions running side by side also means two sets of background loops; stop the superseded one before judging anything that a worker loop does.

**UAT acceptance with real sandbox data (13:07–13:40), the owner signing in and typing his password where needed:**
- The refund review opens for every QR-paid invoice, with the promotion block where one applies and two lines telling staff that the provider e-mails the customer for the bank account.
- **A QR refund seen to its end.** New sandbox QR purchase (249 THB) by a shop whose address at payment time was the Stripe account's own verified address; refund of 100 THB, keep the package: accepted by the provider, credit note issued, the refund id starts with `pyr_`, state `requires_action`, our operation `QUEUED` with a review case; the owner received the provider's e-mail, entered the sandbox's sample bank account on the provider's page; the refund became `succeeded` and five minutes after the first observation the worker's next observation ended the operation `SUCCEEDED` with nobody pressing anything. Invoice: paid 249.00, refunded 100.00; the shop's package unchanged.
- **A rejected create ends.** Refund of an older QR payment (the sandbox cannot e-mail that address): `FAILED` / `CONTROL_REFUND_PROVIDER_REJECTED` within a second of the dispatch, the provider's `type` shown in the reference section (`invalid_request_error`; this error has no `code`), `run` not offered, and the shop not blocked (the refund review can create again).
- **Settlement check** over 9 Oct 00:00 – 10 Oct 13:30: 11 of 11 MATCHED — eight payments (card and QR), two card refunds, and the QR refund as a refund matched to its invoice.

**What a QR refund is in real life (from the provider's own page and error text).** The provider does not push the money back as it does for a card: it e-mails the customer, at the address used when the payment was made, a link to enter the bank account; the customer has about 45 days; the refund completes after that. Until then our request stays in "รับคำขอแล้ว รอตรวจผลจาก Stripe" and is observed every five minutes. A sandbox can only write to the account's own verified address, which is why no existing sandbox QR charge could be refunded and a fresh purchase was needed for the proof.

**Not proven on Production:** no refund of a QR payment has been made there (none exists yet); the first one should be watched. Not exercised by this release: the settlement check, a LINE AI turn.

**Left open, older than this work:** a refund operation that was dispatched, was not created at the provider, and whose preview has gone stale stays `UNKNOWN` for good: it is retried every five minutes, never reaches the provider again (it stops on `CONTROL_PREVIEW_STALE`), and keeps `assertNoPendingRefund` blocking every other refund of that company. Nothing in the code ends it except a success and, since #1071, a create the provider rejects on that very attempt. Two UAT test shops are in that state (operations of 11:32 and 11:51, made before #1071). It needs a staff action that ends such a request after the provider has been checked.

## Release 2026-10-06 00:18 — Production (superseded for Production by the sections above)

Production serves `main` source `67c270d3c` since 2026-10-06 00:18 Bangkok. Before it Production served the hotfix `0c6e888a8` (2026-10-05 13:19), which is an ancestor of this source. UAT serves the same source (round 2k). `main` HEAD was `a97a88fe8` at the promotion: docs only ahead of the source, which the promotion accepts (the signed UAT source must be an ancestor of `origin/main`; the controller files are compared with `origin/main`). GitHub workflow ids (`UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`) are `NOT_DISPATCHED`: local Kamal path, as every release since 2026-09-18.

What it shipped: everything merged after the morning release of 2026-10-05 — the small follow-ups (#1008/#1009), the LINE System OA cards and assistant rounds 2a–2k of the section below (cards of the locked design, periods as people type them, the comparison and summary cards, replies to a photo or a file, the contact and package card buttons to the staff OA, the readiness answer remembered for five minutes) and the claims batch (several payout accounts chosen per claim, another person's account, claims held by a duplicate, with the follow-up screen fixes). The two routes that answered without a model call are NOT in it (withdrawn in round 2k).

| Env | Operation | Source | Result | Seconds |
|---|---|---|---|---|
| Production | `20261005T170015Z-db077806` (promote preflight, read-only) | from UAT `20261005T155337Z-20348016` | PREFLIGHT_PASSED_NO_DEPLOYMENT 00:00. | 18.5 |
| Production | `20261005T171004Z-ed0e56d7` (promote-prod `--production-browser-acceptance --apply`) | `67c270d3c`, signed UAT promotion from `20261005T155337Z-20348016`, no rebuild | ACCEPTED_LINE_DEFERRED 00:18, 12/12 phases; website ready 00:14:47 (282.7 s); browser stage 180.6 s, 10/10 checks observed 00:17:13–00:17:32 with the owner signing in himself; **1 migration** `20261005100000_reimbursement_saved_payout_accounts` (database phase 68.1 s, rollout 84.5 s); AgentCore `kamal_production_a` v23; signature verified; 4 SSM sessions closed; 19 builds retired; no `active.json`. | 490.1 |

- Owner's go: "ยังไงไม่ต้องทำ เอาของขึ้น prod ได้เลย" (2026-10-05 about 23:55; "ไม่ต้องทำ" is the budget-rule amendment below), "พร้อม" (00:09), "เข้าแล้ว" (about 00:15).
- Verification of the exact tree: the source's tree equals the tree of `4c2a6ffe3`, on which the full 17-step local verification passed at 22:41–22:48. The UAT acceptance promoted was the smoke acceptance of round 2k (22:57).
- After the release, one read-only bastion session (00:19:03–00:19:10, terminated, no listener left): 280 migrations completed, 0 unfinished; `MemberSavedPayoutAccount` exists with 0 rows; `reimbursement_duplicate_confirmed` and `reimbursement_duplicate_sla_breach` are AVAILABLE with 21 ENABLED rules each for 21 active companies; claims 9 (1 pending approval, 6 ready for payment, 1 paid, 1 cancelled). Public probes 00:18:30: platform-access 200 OPEN, `/login` 200, `/api/v1/health` 200.
- Not proven by a real turn before Production: no photo or file was sent to LINE UAT after round 2i changed the replies to them (22:09). The owner was told and chose to proceed. The first Production photo reply is the first real one: read its `line.ai.terminal` line.
- Decided and NOT done: amending the budget rule so that a turn routed without a model call can proceed. The owner asked what the rules are and what a change would touch, was told that a turn with no model call at all would also pass the credit gate (the gate is the intake's reserve), and said not to do it.

## LINE card rounds 2026-10-05 afternoon — UAT only (current for UAT)

After the last row below, UAT serves `main` `67c270d3c` (LINE System OA cards parts 1 and 2a, the assistant rounds 2b–2f and 2h–2k, and the claims batch of round 2g with its one migration and its follow-up fixes) and no longer the `2aa87ac68` of the section that follows. Production is NOT touched by these rounds: it serves the morning release plus another session's hotfix `0c6e888a8` (`20261005T060824Z-6f2c3d60`, 13:19 Bangkok). Every run used the local Kamal path from the clean controller worktree; GitHub workflow IDs are `NOT_DISPATCHED`. Times are Bangkok. Owner's words: "เร่งแก้ของ ไลน์หน่อยได้ไหม จะได้ทดสอบจริงบน line uat" (UAT only; Production needs his own go).

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261005T065816Z-e41796d8` (preflight) | controller at `54c4cae73` | **FAILED** 13:58: "Host identity/state changed: i-0eb581c5ac3b3d7ba". Both UAT hosts had been stopped at 09:29 (user initiated). | 1.3 |
| UAT | `20261005T070634Z-09f0d57b` (preflight) | — | PREFLIGHT_PASSED_NO_DEPLOYMENT 14:06, after the owner started both hosts at 14:01. | 13.1 |
| UAT | `20261005T072445Z-424f6a64` (prepare only) | `54c4cae73` (#1013 twin = develop `1ad8d59d1` via #1012) | PREPARED_NO_DEPLOYMENT 14:31; `main-typescript-build` 338.8 s. | 383.8 |
| UAT | `20261005T073126Z-e63ad874` (prepared by `424f6a64`) | `54c4cae73` | ACCEPTED_LINE_DEFERRED 14:37, smoke, 12/12 phases, no migration (database phase 78.0 s, rollout 99.3 s), AgentCore `kamal_uat_b` v53, signature verified. | 350.4 |
| UAT | `20261005T083915Z-f63676fe` (preflight) | controller at `ea5a98344` | PREFLIGHT_PASSED_NO_DEPLOYMENT 15:39. | 12.4 |
| UAT | `20261005T084047Z-d5c616e7` (prepare only) | `ea5a98344` (#1015 twin = develop `2b30ab1ba` via #1014: LINE cards part 2a, row cards and named buttons) | PREPARED_NO_DEPLOYMENT 15:48. | 430.0 |
| UAT | `20261005T084812Z-4694f13f` (prepared by `d5c616e7`) | `ea5a98344` | ACCEPTED_LINE_DEFERRED 15:54, smoke, 12/12 phases, no migration (database phase 62.4 s, rollout 98.3 s), AgentCore `kamal_uat_a` v54, signature verified, 2 SSM sessions closed. | 363.1 |
| UAT | `20261005T092229Z-071239f5` (preflight) | controller at `8edb735ec` | PREFLIGHT_PASSED_NO_DEPLOYMENT 16:22. | 11.8 |
| UAT | `20261005T092247Z-b0b6152d` (prepare only) | `8edb735ec` (#1017 twin = develop `cf13b7607` via #1016: periods as people say them, a reply completes the question, every month in a comparison, no bare text) | PREPARED_NO_DEPLOYMENT 16:29. | 399.9 |
| UAT | `20261005T092928Z-8c27754e` (prepared by `b0b6152d`) | `8edb735ec` | ACCEPTED_LINE_DEFERRED 16:37, smoke, 12/12 phases, no migration (database phase 71.0 s, rollout 255.4 s), AgentCore `kamal_uat_b` v55, signature verified, 2 SSM sessions closed. The full 17-step verification of this exact tree passed afterwards (16:38–16:44). | 480.2 |
| UAT | `20261005T100001Z-6b679804` (preflight) | controller at `f25bf2db1` | PREFLIGHT_PASSED_NO_DEPLOYMENT 17:00. | 21.6 |
| UAT | `20261005T100033Z-24a7d2db` (prepare only) | `f25bf2db1` (#1019 twin = develop `4c0a3380f` via #1018: a range written with days is one period, "ตั้งแต่" with no end runs to today) | **FAILED** 17:10 at `host-storage-capacity`: "Insufficient Docker filesystem capacity before publication: i-0eb581c5ac3b3d7ba" (3.7 GB free of 38 GB, 24 retained `-tools` images). Nothing published, nothing changed. | 609.0 |
| UAT | host cleanup, one SSM session | — | 17:11: `docker rmi` of 22 old `-tools` tags (the newest two kept), `docker image prune -f`; 27 GB free. The serving containers were not touched. | — |
| UAT | `20261005T101253Z-947039ac` (prepare only, same candidate) | `f25bf2db1` | PREPARED_NO_DEPLOYMENT 17:15. | 183.8 |
| UAT | `20261005T101557Z-61e459ac` (prepared by `947039ac`) | `f25bf2db1` | ACCEPTED_LINE_DEFERRED 17:22, smoke, 12/12 phases, no migration. | 397.9 |
| UAT | `20261005T110657Z-08a3eac0` (preflight) | controller at `470ccb4d7` | PREFLIGHT_PASSED_NO_DEPLOYMENT 18:07. | 18.1 |
| UAT | `20261005T110822Z-b651e1e2` (prepare only) | `470ccb4d7` (#1021 twin = develop `3874ce74a` via #1020: month abbreviations typed without dots, "กค. สค. กย.") | PREPARED_NO_DEPLOYMENT 18:16. | 498.5 |
| UAT | `20261005T111641Z-247fb5e8` (prepared by `b651e1e2`) | `470ccb4d7` | ACCEPTED_LINE_DEFERRED 18:24, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_b` v57. | 455.4 |
| UAT | `20261005T112547Z-b1477296` (preflight) | controller at `a6107ea59` | PREFLIGHT_PASSED_NO_DEPLOYMENT 18:26. | 16.5 |
| UAT | `20261005T112611Z-76e76d1d` (prepare only) | `a6107ea59` (#1023 twin = develop `cf7062b7a` via #1022: "this picture is a bill already kept" as a row card; the month and year typing family) | PREPARED_NO_DEPLOYMENT 18:33. | 431.0 |
| UAT | `20261005T113322Z-05c5fe60` (prepared by `76e76d1d`) | `a6107ea59` | ACCEPTED_LINE_DEFERRED 18:37, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_a` v58, 19 builds retired. | 266.9 |
| UAT | `20261005T131117Z-1a56667b` (preflight) | controller at `64649fdfa` | PREFLIGHT_PASSED_NO_DEPLOYMENT 20:11. | 20.2 |
| UAT | `20261005T131146Z-b19b926a` (prepare only) | `64649fdfa` (#1025 twin = develop `384bbf4eb` via #1024: the comparison of months with no percentage or rank lines, as a card of rows) | PREPARED_NO_DEPLOYMENT 20:14. | 183.1 |
| UAT | `20261005T131449Z-d72f25d6` (prepared by `b19b926a`) | `64649fdfa` | ACCEPTED_LINE_DEFERRED 20:19, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_b` v59. | 262.0 |
| UAT | `20261005T132241Z-167accdd` (preflight) | controller at `373af5ce1` | PREFLIGHT_PASSED_NO_DEPLOYMENT 20:22. | 11.5 |
| UAT | `20261005T132706Z-7b1de5c4` (prepare only) | `373af5ce1` (#1027 twin = develop `a0bbd7e3e` via #1026: the claims batch — several payout accounts chosen per claim, claims held by a duplicate) | PREPARED_NO_DEPLOYMENT 20:34. | 434.0 |
| UAT | `20261005T133420Z-eb7ec35f` (prepared by `7b1de5c4`) | `373af5ce1` | ACCEPTED_LINE_DEFERRED 20:38, smoke, 12/12 phases, **1 migration** `20261005100000_reimbursement_saved_payout_accounts` (database phase 63.4 s, rollout 84.3 s), AgentCore `kamal_uat_a` v60. | 268.0 |
| UAT | `20261005T140215Z-ac44ca21` (preflight) | controller at `9bf64e450` | PREFLIGHT_PASSED_NO_DEPLOYMENT 21:02. | 17.9 |
| UAT | `20261005T140250Z-c3a298c0` (prepare only) | `9bf64e450` (#1029 twin = develop `1a29f9d48` via #1028: a plain comparison of expenses routed without a model call; timing lines) | PREPARED_NO_DEPLOYMENT 21:10. | 470.4 |
| UAT | `20261005T141041Z-b0051518` (prepared by `c3a298c0`) | `9bf64e450` | ACCEPTED_LINE_DEFERRED 21:15, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_b` v61. | 265.7 |
| UAT | `20261005T145802Z-bbf61a00` (preflight) | controller at `f46aa37df` | PREFLIGHT_PASSED_NO_DEPLOYMENT 21:58. | 11.9 |
| UAT | `20261005T145821Z-5ce10fe6` (prepare only) | `f46aa37df` (#1031 twin = develop `bce31f099` via #1030: every reply to a photo or a file on the locked card; the contact and package cards open the staff OA; these records) | PREPARED_NO_DEPLOYMENT 22:04. | 391.2 |
| UAT | `20261005T150453Z-6b299661` (prepared by `5ce10fe6`) | `f46aa37df` | ACCEPTED_LINE_DEFERRED 22:09, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_a` v62. | 267.0 |
| UAT | `20261005T151838Z-223098d4` (preflight) | controller at `621d7ba44` | PREFLIGHT_PASSED_NO_DEPLOYMENT 22:18. | 11.7 |
| UAT | `20261005T151857Z-d0386418` (prepare only) | `621d7ba44` (#1033 twin = develop `ad5e47b32` via #1032: the runtime readiness answer remembered for five minutes; four claims screen defects) | PREPARED_NO_DEPLOYMENT 22:25. | 392.4 |
| UAT | `20261005T152530Z-81a5390f` (prepared by `d0386418`) | `621d7ba44` | ACCEPTED_LINE_DEFERRED 22:30, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_b` v63. | 278.6 |
| UAT | `20261005T154937Z-533beff4` (preflight) | controller at `67c270d3c` | PREFLIGHT_PASSED_NO_DEPLOYMENT 22:49. | 12.8 |
| UAT | `20261005T154958Z-12212f4f` (prepare only) | `67c270d3c` (#1037 twin = develop `cb4b42aeb` via #1036: **correction** — the two routes that answered without a model call are withdrawn) | PREPARED_NO_DEPLOYMENT 22:53. | 219.1 |
| UAT | `20261005T155337Z-20348016` (prepared by `12212f4f`) | `67c270d3c` | ACCEPTED_LINE_DEFERRED 22:57, smoke, 12/12 phases, no migration, AgentCore `kamal_uat_a` v64. The owner's next comparison (23:07) completed in 10.4 s. | 237.0 |

**Stopped UAT hosts stop a release at the first step, and the agent cannot start them.** The deploy role (`mangmee-kamal-uat`) and the dev profile have no `ec2:StartInstances`; only the owner's own profile does, and the controller does not use it. Ask the owner to start the two hosts, then run the read-only preflight again before preparing.

**Ask LINE before the customer sees a card.** `POST https://api.line.me/v2/bot/message/validate/reply` accepts a Flex payload and answers 200 or names the invalid field, and sends nothing to anyone. It was called from inside the UAT API container with that container's own channel token (`scratchpad/uat-line/validate.js` piped through one SSM port-forward and one ssh command), 49 payloads before part 1 went out. UAT and Production run with the text fallback on, so a card LINE refuses reaches the customer as plain text: validate every NEW card structure before a round.

**A UAT round verified with the short gate hid a real-database failure.** Part 2a went out on typechecks, the capability manifest, the whole-chain acceptance and LINE's validator (about three minutes) because the owner asked for speed. The full run on the next round then failed in `line-capture-delivery.pg.spec.ts`: its link count assumed every address under the web base was a link, and the receipt result is now the locked card, whose pictures are served from that base. The product was right and the test was stale, but only the real-PostgreSQL step could say so. The full 17-step run takes about seven minutes on this machine: run it for every round that changes what a pushed message contains.

**A lane killed in mid-typecheck leaves the machine lock behind.** At 15:51 a Codex lane died with "Selected model is at capacity" while its typecheck held `/tmp/mangmee-heavy.lock`; every other job waited ten minutes on a lock nobody owned. The wrapper (`scratchpad/codex/heavy.sh`) now records its pid in the lock and a waiter removes a lock whose holder is gone.

**The UAT API host fills with `-tools` images on a day of many rounds.** Six rounds in an afternoon left 24 of them; the seventh prepare stopped at `host-storage-capacity` after ten minutes of build. The remedy is the procedure under **UAT API host disk** further down this file: remove the old `-tools` tags, keep the newest two, prune dangling images, in one session, and run the same candidate again. Check `docker system df` on the host before the first round of a day with many rounds.

**The container that served a turn is still readable after the next deploy.** A deploy stops the old containers and keeps them until they are retired: `docker ps -a` on the host lists them by source commit and operation id, and `docker logs <old name>` still answers. That is how the owner's 20:36 comparison turn was timed after round 2g had replaced both containers: 11.1 s in all — message buffer 1.0 s, the routing stage before the model about 1.9 s, the router's model call 4.6 s, the turn 2.1 s (0.45 s of it work; the rest is the AgentCore round trip), delivery to LINE 1.0 s. Round 2h removed the model call for a plain comparison and added `line.ai.intake_timing` (API) and `routeMs`/`handlerMs` on "LINE intake routed" (gateway) to find the two seconds before the model. Its first reading (21:57) named them: `grantMs` 1,505 — issuing the budget grant asks the gateway for its capabilities, and the gateway answered by invoking the AgentCore runtime once per message. Round 2j remembers a YES for five minutes per gateway process (a NO or a failed probe is never remembered). Read a turn's stages with `docker logs` of the API container, lines `line.ai.stage` and `line.ai.intake_timing`.

**A LINE turn routed without the intake's model call is refused by the budget authority, and the smoke acceptance cannot see it.** Round 2h (21:15) shipped a route that decides a plain comparison of expenses in code. Its tests called the router directly. On UAT the gateway routed the owner's message in 3–7 ms (`line.intake_route.compact_decode`, attempt 0, `ROUTED`) and no "LINE AI turn received" followed: the API could not narrow the grant, because `LineAiBudgetAuthorityService.narrow` accepts `nextOrdinal` 1 or 2 only (after the intake's one paid call), and answered "ยังตรวจสอบเครดิต AI ของร้านไม่ได้" (`AI_BUDGET_UNAVAILABLE`) at 22:33 and 22:35. The period-only reply route of round 2b (16:37) was built the same way. Both were withdrawn in round 2k (22:57). The release's acceptance is a config and readiness smoke: it sends no LINE message, so a path like this is unproven until a real turn has gone through it. After a round that changes how a turn is routed or budgeted, read the first real turn on both hosts: the API's `line.ai.terminal` line for its `errorCode`, the gateway's `compact_decode` and "LINE AI turn received".

**A new notice template has no rule until `prisma/sync-workflow-templates.ts` has run.** A release runs it (`infra/kamal/release.py`); a stack moved forward by hand with `prisma migrate deploy` and `sync-permissions.ts` alone does not get it. The symptom is exactly a broken notice: the outbox event is PUBLISHED and nobody is told. On 2026-10-05 a screen walk on a local stack reported "no notice after a duplicate is confirmed"; the local database had 12 claim templates and not the two new ones, while UAT had both, AVAILABLE, with an ENABLED rule for each of its 11 active companies. Check `WorkflowTemplate` and `WorkflowRule` before reading a missing notice as a defect.

**Counting release processes with a pattern that names the script counts yourself.** `ps aux | grep '[r]elease.py'` printed 3, and later 2, immediately before a preflight: the shell that ran the check carried the script's name elsewhere in its own command line. No other operation existed (every run directory had its result). Use a pattern that cannot match its own line, for example `kamal/[d]eploy-|kamal/[r]elease`, and read the run directories as well.

**What only a real phone showed** (owner, 14:45–15:07): the fixtures covered the designed states, not the real routes. A compound question arrived on the card from before the design, the list and the grouped summary were prose, and a short reply to the assistant's own question was rejected by the router's decoder (`line.intake_route.compact_decode rejection=decision_shape_invalid`, two model calls, ten seconds) and answered with a plain-text apology. The gateway and API container logs on the UAT hosts named that cause in minutes; read them before designing a fix.

## Release 2026-10-05 — UAT rounds 1–2 and Production (morning; superseded for UAT by the section above)

After this section, UAT and Production both serve `main` `2aa87ac68` (tree equal to develop `6ac6d8a63`). Production served the hotfix `908e7aab` before it and UAT served `7b1b1c11`. Every run used the local Kamal path from a clean `main` controller worktree, and GitHub workflow IDs are `NOT_DISPATCHED`. Times are Bangkok. What the release changes for people, and the counts read before and after it, are in `docs/agent-memory/owner-preview-batch-2026-10-04.md` ("Release record") and `docs/agent-memory/release-readiness-2026-10-04.md`.

- Both UAT rounds used `--uat-smoke-acceptance`. The owner chose it for round 1 ("ตรวจอัตโนมัติ"); round 2 kept that choice.
- Production used `--production-browser-acceptance`, with the owner signing in personally. His go: "แก้อันนี้ด้วย ต้องตอบเป็นการ์ด แล้ว เอาขึ้น uat หลังจากนั้น promote prod ได้เลย", then "พร้อม เริ่มเลย" right before the apply.

| Env | Operation | Source (main) | Result | Seconds |
|---|---|---|---|---|
| UAT | `20261004T182131Z-e92a39e3` (preflight) | controller at `963c3c4da` | PREFLIGHT_PASSED_NO_DEPLOYMENT 01:21, 2 SSM sessions closed. | 12.2 |
| UAT | `20261005T000027Z-7d775b7d` (prepare only) | `69e8e5f21` (#1003 twin = develop `8a4de3b35` via #1002: the owner-preview batch, 13 migrations since Production) | PREPARED_NO_DEPLOYMENT 07:20. `main-typescript-build` took 1,144.0 s; the same phase took 197.1 s in round 2. | 1,182.6 |
| UAT | `20261005T002032Z-8cf8f08c` (prepared by `7d775b7d`) | `69e8e5f21` | ACCEPTED_LINE_DEFERRED 07:25, smoke, 12/12 phases, 13 migrations applied (database phase 70.8 s, rollout 104.8 s), AgentCore `kamal_uat_b` v51, signature verified, 2 SSM sessions closed, 19 builds retired. **Not promoted**: the owner's own check on UAT found the two defects below. | 304.6 |
| UAT | `20261005T015756Z-d893f55c` (prepare only) | `2aa87ac68` (#1005 twin = develop `6ac6d8a63` via #1004: Thai file names on downloads, the LINE pending-approval card) | PREPARED_NO_DEPLOYMENT 09:01. | 234.7 |
| UAT | `20261005T020153Z-ab52b619` (prepared by `d893f55c`) | `2aa87ac68` | ACCEPTED_LINE_DEFERRED 09:06, smoke, 12/12 phases, no migration (database phase 69.2 s, rollout 91.0 s), AgentCore `kamal_uat_a` v52, signature verified, 2 SSM sessions closed. | 278.0 |
| Production | `20261005T020723Z-9af0be8a` (preflight) | — | PREFLIGHT_PASSED_NO_DEPLOYMENT 09:07, 4 SSM sessions closed. | 18.4 |
| Production | `20261005T020935Z-c3166cc2` | `2aa87ac68`, promoted from UAT `ab52b619` with no rebuild, after preflight `9af0be8a` | ACCEPTED_LINE_DEFERRED 09:20, website ready 09:14:35 (299.8 s), acceptance written 09:19:35. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally. 13 migrations applied (database phase 80.7 s, rollout 84.9 s), AgentCore `kamal_production_a` v21, signature verified, 4 SSM sessions closed, 19 builds retired, no `active.json`. | 628.4 |

**Two defects that only the real storage and the real LINE path showed.** Both were found by the owner on UAT after round 1 and fixed before Production.
- "เปิดดูไฟล์นี้" failed for a file with a Thai name. S3 answers 400 `InvalidArgument` ("Header value cannot be represented using ISO-8859-1") when a presigned `response-content-disposition` holds characters outside Latin-1. Local MinIO accepts the same request, so no local check can see it. The header now carries an ASCII fallback name plus the RFC 5987 form `filename*=UTF-8''…`.
- The LINE answer to "รายการรออนุมัติ" arrived as text. The V2 delivery plan sends a flex card only when the message carries the completeness proof, and that card was built without it; otherwise the plan sends the card's text.

**The owner may sign in before website-ready.** He signed in during the rollout, and the session was still valid after it. Every check was observed after the controller printed website-ready, and the observation file records the early sign-in. The browser stage took 300.9 s, against 93–198 s in the four Production releases of 2026-09-30: the checks themselves ran in 25 s, the rest was the controller reading the log and writing the evidence. Have the page-context check and the evidence writer ready before website-ready.

**One bastion session for all the count files.** Every `start-session` on the Production bastion mails the owner a security alert, and this release sent four. The first attempt failed with `psql: invalid URI query parameter: "connection_limit"`: the stored database URL carries Prisma-only parameters, so drop its whole query string and add `sslmode=require`. The PRE file, the POST file, and the PRE file again with one support count then each used a session of 8–9 s. Run every file through one tunnel: the after-release read needs the PRE file again (P1, P3, P4) and the POST file together.

**UAT's active companies fell from 19 to 11 before the deploy, not because of it.** A scheduled job of the build already on UAT (`system.company_plan_term.expired_trial_reset`) disabled eight expired-trial companies at 06:33, 47 minutes before round 1.

**UAT hosts.** Both were already running at round 1 (since 2026-10-04 17:03, not started by this release) and were left running; the owner decides when to park them.

## Hotfix 2026-09-30 evening — claim lines on a phone

After this section, Production serves hotfix source `908e7aab`. `main` `b7d86eb8` (#937) merges it and has the same tree. UAT still serves `7b1b1c11`, which does not have this web fix. This is the first live use of the isolated `deploy-prod-hotfix` path since the Kamal cutover, run from a clean `main` controller at `7b1b1c11`. The GitHub workflow ID is `NOT_DISPATCHED`. Times are Bangkok.

| Env | Operation | Source | Result | Seconds |
|---|---|---|---|---|
| Production | `20260930T104206Z-2a3baa82` (preflight) | `908e7aab` on baseline `7b1b1c11` | PREFLIGHT_PASSED_NO_DEPLOYMENT | 29.3 |
| Production | `20260930T104258Z-3c7568ae` | `908e7aab`: isolated hotfix, no UAT, no migration. Changed paths: `apps/web/src/features/reimbursements/ReimbursementDetailSections.tsx` and the regression spec `ReimbursementPages.plain-thai.qa.spec.ts`. Below `sm`, the claim-detail "รายการเบิก" lines show as cards, because the seven-column table squeezed Thai text to one letter per row on the owner's phone. From `sm` up, the table is unchanged inside `.mangmee-table-scroll`. | ACCEPTED_LINE_DEFERRED 17:54, website ready 17:51:59 (540.5 s), acceptance written 17:53:41. Serving `live`, `OPEN`, 10/10 browser checks, with the owner signing in personally; 4 SSM sessions closed. The controller reran typecheck and the regression spec in its isolated build. Phases: build 173.2 s, publish-and-pull 83.6 s, rollout 117.0 s. | 678.6 |

**The hotfix path took about 11 minutes end to end, with no UAT.** Owner go: "แต่เอาใบเบิกขึ้น hotfix prod ให้ลูกค้าก่อน ส่วนตัวอื่นตามไปทีหลังได้".
- The claim hub was left out because its queues already had phone cards below `md`.
- The same round's other phone fixes went to develop and main without a release:
  - the expense category table moved to the shared scroller;
  - the LINE draft-claim page got line cards.
- The draft-claim page is a W00-hashed file, so that change regenerated `docs/research/mangmee-ai-capability-manifest-2026-09-27.json`.

## Hotfixes 2026-09-30 afternoon — signup constraint and promotion poster

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
## Production disaster restoration completed with owner exception — 2026-10-09

Owner explicitly requested restoration and reopening of Production. This supersedes the October7
zero-resource inventory for Production. Production is
**online and OPEN, signed and owner-accepted with one preexisting email security-alarm exception**.
The owner subsequently requested a separate UAT restoration; see
[UAT restoration state](../agent-memory/uat-offline-restore-2026-10-09.md). Dev and Official OA remain retired.
Private operation `20261009-production-restore` reused serving
source `bdb65d8e8f6153b83d83783c930e96e3a38c2a7b` and its exact retained image digests, not rebuilding
latest main. UAT/READY/PROD workflow IDs: `NOT_DISPATCHED`.

- Stack `mangmee-kamal-production` recreated; VPC `vpc-0582cab8f997af7b0`. API hosts
  `i-05a63210c38c20d10` / `i-09c35998d5141fa72`, AI `i-0d1129ba60aedd07e`, workers
  `i-0aa479f24c2bb3e85`; SSM transport, public TCP22 remains closed.
- Private RDS `watchdog-bms-prod-db` and Redis `watchdog-bms-prod-redis` are available with their
  former DNS names. PostgreSQL18.3/db.t4g.small/MultiAZ and Redis7.1/2cache.t4g.micro/MultiAZ
  restored. All268tables/355102rows initially matched the offline DB, then rehearsed replacement
  of S3VersionIds matched exactly. Redis TLS/auth/PING passed,1680nonexpiredkeys restored.
-297businessobjectversions restored and downloaded/hash-verified; all255ACTIVEattachments
  covered.295DBobject-versionreferences reconciled; no other business columns changed.65oldSSM
  logobjects stay in the offline backup. Original backup archives remain unchanged.
- New ALB `mangmee-production-gateway`; permanent origins `origin.mangmeeplus.com` and
  `ai-origin.mangmeeplus.com`, ACM certificate44e7e2ba-738d-4a7b-8b71-4533c5da0624. Listener
  now forwards both origins through exactly2Add listener rules after runtime readiness. All3ALB
  targets healthy; both API replicas, AI and workers run exact original images/configs. Cloudflare
  apex/Worker now use origin.mangmeeplus.com (Worker active9461df17); public health/login/OPEN pass.
- Original23ERPsecrets and Production signing key7bb5d36e restored; old acceptance signature
  verifies. Stale db-password alias was reconciled to the database-url credential.7current
  runtimeSSMparameters restored; obsolete ECS/A5 endpoint/role IDs must not be copied back.
- AgentCore `watchdog_orchestrator_production_kamal-VGIuTzFjOP`, qualifier `kamal_production_a`
  version1 READY, exact original source/artifact; only runtime topology bindings changed.
- Production CloudTrail/private log bucket,12DB/Redis/log/securityalarms,3securityfilters and
  existing4EC2statusalarms restored. Owner email SNS subscription confirmed. DB CPU-credit
  alarm is currently low after fresh provisioning/restoration (original threshold50); do not
  weaken the alarm to report acceptance. Latest14/16alarmsOK: API security alarm reflects one
  unchanged September25 DEAD auth.email.security_notice from the original backup. Linked Postmark
  attempt remainsSENDING/no nextRecoveryAt; exact provider lookup returns0results, which does not
  prove non-delivery. Do not replay, delete or mark it delivered solely to clear the alarm.
- Current owner administrator identity/permissions and authenticated page200/live/canOpen/OPEN
  verified, logout204 and same revoked session401. No duplicate customer-gate mutation. Exact login
  HTTP response was not retained; browser owner-login/no-password-or-legal-prompt observation only.
- LINE AI webhook repair08:21UTC: ERP channel2011037770, bot@458wpnio still pointed to deleted
  wa-d522885832ce41a5aa7f8d1ffbaaa84b ECS endpoint. LINE's own empty-event test to
  https://origin.mangmeeplus.com/v1/line/webhook passed200 before the single endpoint update;
  readback active:true/newendpoint; configured-endpoint test also passed200. Owner confirmed
  “ตอบแล้ว”; correlated real-message logs show errorCode:null, one tool, deliveryResult:ok and
  completed/delivered through the expected runtime qualifier. Official OA is a separate retired
  service and was not changed.

Owner's final decision: “ยอมรับข้อยกเว้นเดิมและปิดงานกู้คืน”. The signed result is
`OWNER_ACCEPTED_WITH_EXISTING_EMAIL_ALARM`, receipt SHA256
`240d3bb2db22abf946fd04489262dc868d33a22086c62e00cefd1df6a8dc1df3`, KMS ECDSA_SHA_256 verified
using the scoped Production deployment role. Private evidence is under
`~/.codex/offline-restores/20261009-production/`. Canonical Production target enrollment now matches
the restored hosts/origins and retains the receipt hash; the previous target and signed HOLD checkpoint
remain preserved. This scoped exception does not assert email delivery or waive future release checks.
Before a future feature release, reconcile the controller's retired ECS baseline; do not recreate old
ECS resources to bypass it. Running Production resources incur AWS charges again.

Restoration findings: RDS rejects explicit NOSUPERUSER/NOREPLICATION/NOBYPASSRLS in a roles
restore even when false. Verify protected attributes, omit those clauses and restore original
remaining privileges transactionally; never rerun a successfully committed DB restore. Recreated
S3 bucket needs the app's browser CORS and original SSE-C blocking configuration as well as objects,
versioning/lifecycle. Heavy workstation uploads can prevent SSM handshake; separate bulk publication
from DB transfer and reconcile/terminate exact failed sessions before resuming. See
[restoration memory and current next step](../agent-memory/production-offline-restore-2026-10-09.md).

## AWS runtime and storage retired — 2026-10-07 10:26 Bangkok

Owner authorized deletion after the verified offline backup, then explicitly included Dev,
Official LINE OA and the local bucket. Final readback at 03:26:14 UTC: **all 42 infrastructure,
storage and active-service checks returned zero**. A scan of 18 enabled regions found no core
infrastructure/storage resources outside Singapore. This supersedes all older live inventories
and start instructions below; recovery now requires provisioning and offline restoration.

All eight EC2 instances and 308 GiB EBS, both RDS instances and their backups, three Redis nodes
and all snapshots, ALB/EIPs/endpoints, ECS/AgentCore/ECR, Official OA Lambda, all five S3 buckets,
CloudWatch logs/alarms, project secrets/parameters and monitoring producers have been retired.
All five CloudFormation stacks are DELETE_COMPLETE. There is no automatic RDS restart left.

49 secrets and four customer KMS keys are scheduled for deletion on/after October 14. They have
no storage charge while pending deletion ([Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/manage_delete-secret.html),
[KMS pricing](https://aws.amazon.com/kms/pricing/)). Free IAM/network settings and AWS-managed keys
may remain; this is not account closure. No reservations/Savings Plans were found. Already accrued
charges and delayed billing reports remain; external provider subscriptions were not cancelled.

Original offline archive: `/Users/thawatchai/Downloads/mangmeeplus-prod-uat-backup-20261007.tar.gz`
(573721632 bytes). Five PostgreSQL dumps restored with every table/content hash and sequence
matching source; 704 S3 versions verified, covering all ACTIVE attachments. Supplemental backup
preserves Dev files/Docker volumes (10736 files verified), both Redis RDBs (checksums verified),
Official OA code, AgentCore artifacts, CloudTrail and CloudWatch logs, credentials and recovery
configuration. Supplemental archive `/Users/thawatchai/Downloads/mangmeeplus-retirement-supplement-20261007.tar.gz`
is 884725809 bytes; all 107580 payload hashes matched after archive readback. ECR/OS images were
not archived; source/configuration are retained for rebuilding.

No release workflows dispatched (UAT/READY/Production: NOT_DISPATCHED). Existing owner authority
performed retirement without identity-policy expansion. [Exact scope, backup hashes, verification
and restoration limits](../agent-memory/prod-uat-offline-backup-retirement-2026-10-07.md).

## Production AI feature readback — 2026-10-06 11:17 Bangkok

Read-only enrolled SSM/SSH inspection confirms both API replicas and AI Gateway run source
`bdb65d8e8f6153b83d83783c930e96e3a38c2a7b` in live mode. The Gateway selects AgentCore
`kamal_production_b` v24, READY with the same source; public customer gate returns OPEN.
Both deployed API schemas resolve reliability/delivery v2, document Q&A, reimbursement drafts,
approved knowledge, response preferences, expense draft conversation/edit and CRM auto-reply as
enabled. Public lookup is disabled; final AI mutation remains disabled. Customer entitlement,
permission and channel/conversation checks still apply. The pinned runtime source makes native
tool loop, coverage critic and approved prepared families always on; retained environment flags
alone cannot establish their effective behavior.

The latest local release receipt `20261005T180652Z-3f9b6aa1` still says
`AWAITING_BROWSER_ACCEPTANCE`; running/OPEN is not signed release completion. This inspection
did not retry, accept or alter that release. No provider calls or customer-content reads; all
5 owned SSM sessions terminated. [Feature readback and limits](../agent-memory/mangmee-ai-live-feature-structure-2026-10-06.md).

## September cost readback — 2026-10-05

Owner requested actual AWS and Production economics. Existing non-root `watchdog-bedrock`
successfully reads Cost Explorer, unlike the scoped deployment role's earlier denial.
September1 inclusive–October1 exclusive UnblendedCost is **USD755.7957298706**, Estimated=false:
Claude model inference154.85837595 and non-model infrastructure600.9373539206 (including
AgentCore0.6199909016). Tax group0; do not invent VAT or call this a downloaded invoice.
Non-model Environment tags: production323.0783276928, UAT125.0474460712,
shared100.0914657378, dev4.535883011, untagged48.1842314078. Claude model costs are untagged.
Last7 September days extrapolated to a30-day non-model run rate give620.73501052USD;
this is an extrapolation, not an invoice or capacity guarantee.

T1 read-only Production aggregates retain557 September Bangkok AI events/523.08THB across30
companies. UTC-aligned token cost15.610844USD does not reconcile to the account-wide154.85837595USD;
attribution of the difference remains unresolved. September live payment249THB was fully refunded.
No runtime/IAM/gate/payment/data mutation. Owned support session independently Terminated.
[Evidence, unit-cost samples and limitations](../agent-memory/server-ai-actual-economics-2026-10-05.md).

## Production legacy trial adjustment completed — 2026-10-05 Asia/Bangkok

Owner-authorized operation `3c2146e8-270a-419d-bba5-16296dd2eb53` adjusted60companies created
before2026-09-05T00:00+07:00 to expired FREE_TRIAL_15 terms and normal machine-expired DISABLED
status. These60ACTIVE legacy companies had no term. Preserved24newer companies,2pending-package
companies and1SYSTEM_ADMIN company. No data deletion, provider call/charge or notifications.
Fresh26293087-byte backup restored/rehearsed locally; exact UAT-tested bundle applied once.
Live preservation matched348849rows/258tables outside the exact adjusted columns/new terms/
60audit rows. All60targets and60audits verified; repeat preview0changes.

Both API replicas, AI and workers retain original containers/images/start times/source908e7aab.
Deep readiness, publichealth/OPEN/login and authenticated admin package UI passed. No service
stop/start, deployment, gate or IAM change. All12ownedSSM sessions closed; owned remote backup/CA/
manifest copies and local clone container/volume retired. Verified local backup/evidence retained.
UAT/READY/Production workflow IDs NOT_DISPATCHED; this is an operator data adjustment.
[Exact scope, backup, recovery and verification](../agent-memory/expire-legacy-company-trials.md).

## Production archived cleanup completed — 2026-10-05 Asia/Bangkok

Owner-authorized operation `archived-cleanup-prod-171739Z` completed the exact28ARCHIVED-company
manifest:32private users,58,738DB rows and19exactS3versions removed. Shared user1 and14immutable
legal records retained. Fresh frozen DB/object backups restored/rehearsed locally; all346,400
preserved rows across257tables matched before services resumed. Maintenance17:34:51–17:54:13UTC
onOctober4 (19m22s). Same four containers/images/source908e7aab resumed; API/AI readiness passed
before workers. Public health, PlatformAccessOPEN, login open-marker and signupHTTP200 passed.
No application deployment, customer-gate change, IAM change or root use during execution.
UAT/READY/Production workflow IDs NOT_DISPATCHED; this is operator maintenance, not a release.

First exact-version S3 delete rejected VersionId+IfMatch after the DB commit. Corrected only that
operator header after15/15actual-migration PostgreSQL18/MinIO/Redis tests and API typecheck.
Reverified frozen preservation/object hashes, then resumed external stores from the committed
receipt. DB apply invoked once; external resume once. No authority expansion or unversioned delete.
Post-audit:392FK checks have0orphans,0newDLQs and0error-like application log lines. One unassigned
global SalesEventTicket referenced a removed LINE identity. The owner separately approved this
100-baht coupon after identifying historical shop อินทิรา; guarded one-row cleanup completed
2026-10-04T18:12:04Z without downtime. Other7coupons, lifetime issuedCount and issuance audit
unchanged; no remaining tickets for the removed private LINE IDs. Recovery row backup retained.
Real provider signup not tested. [Recovery and exact evidence](../agent-memory/archived-test-company-cleanup.md).

## Production archived cleanup preparation — 2026-10-04 (historical HOLD)

Initial phase: owner authorized read-only preparation only; deletion requires a new explicit command. Live
snapshot:28 ARCHIVED companies,36 memberships,32 private users eligible for deletion and1 shared
user to preserve. Full execution is blocked by3 legacy local attachments,15 literal S3 `null`
versions and13 old object keys outside the worker role's declared version-delete scope. The
exact-key authority supplement is a local proposal only. Excluding the5 legacy-storage companies
also blocks on cross-company LINE history; no partial scope is approved.

Both API replicas, AI and workers retain original containers/start times and source
`908e7aab9b15561317609a67bac770b7ca8a2886`. Deep readiness, public health/login and OPEN pass;
legacy ECS has0 running tasks. No data deletion, Production backup, stop/start, deployment, gate
or IAM change.28/28 owned SSM sessions closed. UAT/READY/Production workflow IDs NOT_DISPATCHED.
The256MiB operator preview exceeded its own heap; after capacity inspection, the read-only1024MiB
preview passed without application restart/OOM. Recheck capacity before future previews.
[Preparation evidence and required next steps](../agent-memory/archived-test-company-cleanup.md).

Follow-up16:18UTC: owner authorized code hardening and live isolated cleanup IAM preparation,
sessions10800seconds, then explicitly root only for temporary bootstrap creation/retirement.
Non-root configured `watchdog-bms-prod-archived-cleanup-20261004`, trusted only to
`watchdog-bedrock-dev` with session prefix `archived-cleanup-prod-`. Exact19key/version deletion
policy,19 allowed/7 denied simulations and real3h AssumeRole+read of all19versions pass. Read
bucket metadata and exact19key content only; no application IAM changes. Temporary role/inline/
user bridge independently absent at16:17:57UTC. The role remains;3hours is each session's limit.
Root never mutated a durable role or data. No S3 write/delete probe or Production data mutation.

Local PostgreSQL18/MinIO/Redis hardening regression15/15 pass; added guarded legacy-null object
support and explicit local roots, broader legacy company-root inventory, sharing/ownership guards
and v2 DB-bound manifests. Updated read-only Prod review retains28companies/58,738rows/19versions,
no new blocker, current containers/readiness/OPEN unchanged.8 additional owned SSM sessions closed.
DB privileges and Redis ACL DRYRUN pass. Execution still requires a new command, accessible live
temp roots for both API containers/hosts, fresh frozen preview and backup/restore/preservation
proof. No backup, stop/start, deploy or gate change; workflow IDs remain NOT_DISPATCHED.

Subsequent pre-deletion checkpoint (owner requested preparation, pause before deletion, keep Prod
OPEN): a consistent read-only pg_dump was taken beside RDS with the pinned PostgreSQL18 client.
31,507,821bytes transferred with identical SHA256, then restored/rehearsed only in local PostgreSQL.
28companies/32privateusers/58,738rows matched the live review; all346,150 preserved rows across
257tables remained identical after local rehearsal.19S3versions/6,866,834bytes backed up and hashed.
3local references absent at all4currenthost/container locations; actual mounts still required
before future apply.4runtimecontainers/starttimes/images unchanged, deep readiness and OPEN pass.
Task-owned remote dump/CA/staging and release lock retired,4/4additional SSM sessions closed.
No Production data deletion, service restart, gate/IAM change or deployment in this follow-up.
Await explicit deletion command, then obtain a fresh frozen plan/backup; do not use the live
preparation snapshot as frozen authorization. [Checkpoint evidence](../agent-memory/archived-test-company-cleanup.md).

## UAT archived test-fixture cleanup — 2026-10-04 14:35 UTC

Owner-authorized operator cleanup `archived-cleanup-20261004-uat-15` completed against the
existing UAT DB/stores:43 ARCHIVED companies,21 private users,40,352 DB rows and64 S3 versions
removed. Protected M14 company and22 immutable legal records retained. Full DB and exact-version
object backups saved privately; DB restore/rehearsal passed. All116,529 preserved rows matched
before/after across257 application tables. Original API/AI/workers containers were stopped during
mutation and restarted with unchanged IDs/images. Deep API/DB, AI, worker/Redis/internal-API,
public health, PlatformAccess OPEN and login open-marker acceptance passed. Release lock absent.
No deployment, customer-gate/IAM change or Production operation; UAT/READY/PROD workflow IDs
NOT_DISPATCHED. A real email/LINE re-registration was not exercised. Impact audit subsequently
found workers started before API readiness:42 recurring-job DLQ records during14:35:20–14:35:33Z;
all28 affected kinds completed later. Wait for API/AI readiness before starting workers in future
maintenance.392 FK checks found no orphans; all305 remaining ACTIVE S3 attachments resolve.

Operator finding: dump beside RDS with TLS verify-full, then transfer the dump over strict SSM/SSH;
workstation pg_dump through the tunnel timed out and its partial output is not a recovery backup.
Runtime API dependencies live at `/app/api-runtime/apps/api/node_modules`. S3 roles intentionally
split reads (API) and exact-version deletes (worker); separate temporary deletion credentials
avoid changing application IAM. Legacy ECS ListTasks is readable with existing `watchdog-bedrock`,
not the scoped deploy profile. [Operation and backup evidence](../agent-memory/archived-test-company-cleanup.md).

## Historical UAT power state — 2026-10-05 17:29 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were stopped from `running`. Both independently read back `stopped`
with no public IP. Legacy UAT ECS has no running tasks; UAT RDS `watchdog-bms-uat-db` and
Redis `watchdog-bms-uat-redis` remain `available` under the established power-pause procedure.
No UAT deploy process was active when the hosts were stopped; no Production resource or
deployment was changed. The former UAT public IPs are stale; check host identity before a
future Kamal operation.

## Historical UAT power state — 2026-10-05 17:24 UTC

Owner requested UAT startup; both Kamal hosts were already `running`, so no start mutation
was needed. API `i-0eb581c5ac3b3d7ba` at `10.92.0.10` / `13.250.17.146` and AI/workers
`i-011918b0d49534d1c` at `10.92.0.42` / `47.129.193.127` were `Online` in Systems Manager.
Both ALB targets were `healthy`; public API health returned `status:ok` (HTTP 200), and
`/login` returned HTTP 200. No Production or deployment change was made. Check host identity
before a future Kamal operation; these public IPs can change after a stop/start.

## Historical UAT power state — 2026-10-05 07:03 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were started from `stopped`. Both read back `running` in the enrolled
VPC at private IPs `10.92.0.10` / `10.92.0.42` and new public IPs `13.250.17.146` /
`47.129.193.127`; both were `Online` in Systems Manager. Read-only SSM inspection confirmed
API, AI and workers containers running from UAT operation `20261005T020153Z-ab52b619`.
Both ALB targets became `healthy`, the public UAT API health endpoint returned `status:ok`
(HTTP 200), and `/login` returned HTTP 200. Legacy UAT ECS had no running tasks; RDS and
Redis remained `available`. No deploy was performed. Check host identity before a future
Kamal operation; the former public IPs are stale.

## Historical UAT power state — 2026-10-05 02:29 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were stopped from `running`. Both independently read back `stopped`
with no public IP. Legacy UAT ECS has no running tasks; UAT RDS `watchdog-bms-uat-db` and
Redis `watchdog-bms-uat-redis` remain `available` under the established power-pause procedure.
No UAT deploy process was active when the hosts were stopped; no Production resource or
deployment was changed by this shutdown. The former UAT public IPs are stale; check host
identity before a future Kamal operation.

## Historical UAT power state — 2026-10-04 10:04 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were started from `stopped`. Both read back `running` in the enrolled
VPC at private IPs `10.92.0.10` / `10.92.0.42` and new public IPs `175.41.177.9` /
`47.129.169.115`; both were `Online` in Systems Manager. Read-only SSM inspection confirmed
API, AI and workers containers running. After startup, both ALB targets became `healthy`,
the public UAT API health endpoint returned `status:ok` (HTTP 200), and `/login` returned
HTTP 200. Legacy UAT ECS had no running tasks; RDS and Redis remained `available`.
No deployment or Production resource was changed. Check host identity before a future
Kamal operation; the former public IPs are stale.

## Historical UAT power state — 2026-09-30 11:02 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were stopped from `running`. Both independently read back `stopped`
with no public IP. Legacy UAT ECS has no running tasks; UAT RDS `watchdog-bms-uat-db` and
Redis `watchdog-bms-uat-redis` remain `available` under the established power-pause procedure.
No Production resource or deployment was changed. The former UAT public IPs are stale;
check host identity before a future Kamal operation.

## Historical UAT power state — 2026-09-30 10:33 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were started from `stopped`. Both read back `running` in the enrolled
VPC at private IPs `10.92.0.10` / `10.92.0.42` and new public IPs `46.137.225.87` /
`13.212.30.239`; both were `Online` in Systems Manager. Read-only SSM inspection confirmed
API, AI and workers containers running. Both ALB targets became `healthy`, the public UAT
API health endpoint returned `status:ok` (HTTP 200), and `/login` returned HTTP 200.
Legacy UAT ECS had no running tasks; RDS and Redis remained `available`. No deployment or
Production resource was changed. Check host identity before a future Kamal operation.

## Historical UAT power state — 2026-09-30 10:07 UTC

At the owner's request, Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were stopped using the owner profile. Both independently read back
`stopped` with no public IP. Legacy UAT ECS has no running tasks. UAT RDS
`watchdog-bms-uat-db` and Redis `watchdog-bms-uat-redis` remain `available` under the
established power-pause procedure. No Production resource or deployment was changed.
The former UAT public IPs are stale; check host identity before a future Kamal operation.

## Production Redis stalled-connection readback — 2026-10-01

Cost-impact follow-up, same date: the existing `mangmee-kamal-production` scoped profile passed
expected-account STS identity check but one September monthly SERVICE/UnblendedCost query was
denied for `ce:GetCostAndUsage`. No billing total was obtained and no owner/role escalation was
attempted. Client recovery can reuse existing instances, but logs/metrics, transfer, database load,
AI retries and delayed LINE push delivery may add usage costs; do not label the full change free.
See the cost/impact audit in the linked research report below. No cloud resource was changed.

Read-only follow-up after LINE recovery fix PRs #940/#941. The September 30 ApiA auth 503s took
1,503–1,509 ms while ApiB reached password validation in 78 ms in the same window. ApiA logged
`read ETIMEDOUT` at 14:37:37 Bangkok; workers had a timeout burst at 14:42:31. A localhost test of
the actual RedisRateLimitService/ioredis 5.11.1 reproduces command-timeout 503s while the client
remains `ready`; a fresh connection works and the old client recovers after its socket closes.
The limiter has commandTimeout=1500 but no socketTimeout. This establishes a recovery defect,
not the exact external event that first disrupted Production TCP.

Fresh primary readback: uptime 4,677,463 seconds (~54 days), PONG, 29,725,904/402,653,184 bytes,
noeviction, zero rejected connections/evictions, one replica. Host TCP keepalive uses 7200s/75s/9
and tcp_retries2=15. Retained incident metrics show low CPU/memory; do not label this a proven
Redis capacity failure or restart the store from these observations. Scope a recovery fix to the
non-blocking rate-limit client; BullMQ blocking clients need separate timeout reasoning.

Scoped role denied DescribeEvents, LookupEvents and GetMetricStatistics; existing September 30
metric files supplied the historical metrics. No IAM escalation. Enrolled SSM/SSH readback closed
2/2 owned sessions; no service/data/gate changes. [Evidence and remaining uncertainty](../research/redis-connection-stall-2026-10-01.md) (kept on the owner's laptop, not in git).

## Production LINE login diagnostic readback — 2026-10-01

Read-only enrolled SSM/SSH inspection confirmed both API hosts running source `908e7aab`,
operation label `20260930T104258Z-3c7568ae`. Current and retained September 30 API containers
have LINE web handoff enabled and matching web/public origins `https://mangmeeplus.com`.
No AI/worker readback or release acceptance is claimed by this diagnostic.

Retained September 30 logs contain eight automatic LINE-login starts without an access cookie,
and four handoff-exchange HTTP 503 requests at 14:21–14:27 Bangkok from unavailable abuse-control
storage. Three other handoff exchanges were refused as non-PENDING. Logs lack browser identity
and cannot attribute these events to a specific customer's iPhone. Historical coverage is partial;
an empty current-container historical query is not proof of no customer traffic.

Owner subsequently confirmed the customer report occurred in that 14:21–14:27 window. Three
503 responses are followed within 1–2.5 seconds by automatic LINE-login events labelled
`handoff-expired`, consistent with the web route mapping upstream failures to token expiry.
The failed rate-limit check occurs before token exchange; do not interpret these 503s as evidence
that the token expired or was consumed. The precise Redis connection failure and per-device
visibility difference remain unresolved; no remediation was applied in this diagnosis.

CloudWatch `FilterLogEvents` remains denied to the scoped deployment role. The existing enrolled
SSM transport allowed container reads with strict host keys; all four owned sessions across two
diagnostic passes were terminated. API Docker service label is the bare `servicePrefix`, unlike
its CloudWatch group suffix `-api-web`; filtering on `servicePrefix + '-api-web'` incorrectly returns
no containers. No deployment, restart, gate, database, account/session or LINE message change occurred.
[Diagnosis, code findings and evidence limits](../agent-memory/iphone-line-repeat-login-diagnosis-2026-10-01.md).

## Production LINE incident readback — 2026-09-30

Follow-up at approximately 08:32 UTC: owner cancelled the signup hotfix after resolving it;
all four current containers now serve `2d3202e6`, operation label `20260930T080539Z-c0fec60b`.
Current-container samples have no 5xx or Redis timeout. For the separately reported slow computer
web navigation, in-container login rendering was 32–109 ms while workstation public requests
occasionally took 5–6 seconds, including slow TCP/TLS setup. CPU, memory, DB and Redis metrics did
not show saturation. This points toward an intermittent client-to-edge network path, but no
authenticated browser waterfall or exact ISP/CDN attribution was obtained; do not treat it as a
proven Cloudflare or IPv6 defect. Full measurements and scope limits are in the incident memory below.

Initial readback before the owner's fix:

Read-only inspection found all four Kamal application containers running source `e52c151a`,
zero restarts and no OOM, while customer journeys were failing. Public API health was 200.
Two LINE turns at 07:30 UTC failed in intake with `ServiceUnavailableException` /
`ROUTER_UNREACHABLE`; the same API host also reported Redis-dependent abuse-control failures
and ioredis timeout. Fresh Redis PING/INFO from both API containers later passed (40/52 ms,
zero evictions/rejected connections), which does not prove existing application sockets recovered.
Five LINE signup requests at 07:40–07:41 UTC separately failed the discovery-source database
constraint; the deployed application accepts SALES but its migration constraint does not.
Do not use healthy containers or public liveness as acceptance for either customer journey.

Scoped CloudWatch event reads were denied and the owner login had expired. Existing enrolled
SSM/SSH transport under `mangmee-kamal-production` allowed read-only Docker log/status and Redis
inspection without IAM changes; all eight owned sessions across three passes were terminated.
No service, database, gate or release mutation occurred.
[Incident evidence and limitations](../agent-memory/prod-line-incident-2026-09-30.md).

## Historical UAT power state — 2026-09-29 02:33 UTC

Owner requested UAT startup. The existing Kamal API `i-0eb581c5ac3b3d7ba` and AI/workers
`i-011918b0d49534d1c` were started from `stopped` through the owner AWS Console after both
non-root profiles denied an exact `ec2:StartInstances` dry run. They read back `running` in the
enrolled VPC at private IPs `10.92.0.10` / `10.92.0.42` and new public IPs
`13.212.250.255` / `18.142.114.170`; both were `Online` in Systems Manager. API and AI ALB
targets became `healthy`, the public UAT health endpoint returned `status:ok`, and `/login`
returned 200. Read-only SSM inspection found API, AI and workers containers running from source
`a2b926c6ee80f26065aecef6998415db1d1a379f`. Legacy UAT ECS had no running tasks; RDS and
Redis remained `available`. No deployment or target enrollment was performed. Public IPs from
before this restart are stale; run host identity preflight before any future Kamal operation.

---

## Historical UAT power state — 2026-09-25 06:56 UTC

At the owner's request to reopen UAT, both retained Kamal hosts were already `running` when
inspected: API `i-0eb581c5ac3b3d7ba` at `47.129.185.109` / `10.92.0.10`, and AI/workers
`i-011918b0d49534d1c` at `13.214.145.8` / `10.92.0.42`. Both matched the enrolled VPC and
were `Online` in Systems Manager. Read-only SSM inspection found Docker active and all three
current application containers running on source `0f3a14ad1af69854ccacbda33a5570ac325de57f`.
Both UAT Kamal ALB targets became `healthy`; the first API read returned 502 during startup, then
`https://uat.mangmeeplus.com/api/v1/health` returned `status:ok` and the login page returned 200.
Legacy UAT ECS has no running tasks; RDS and Redis remain `available`. No EC2 start command,
deployment, private target edit, or host-key reconciliation was performed in this inspection.
The September 22 host-key discrepancy remains a stop condition for any future Kamal operation
until the owner reconciles provenance and the verified keys.

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
