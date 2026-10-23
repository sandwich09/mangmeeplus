# UAT → Production V2 deployment

Status: canonical operator runbook for repeatable UAT and Production deployment

Default Production outcome: `PROMOTED_CLOSED` (`maintenance_closed`)

Workflows: `deploy-uat.yml` → `production-readiness.yml` → `deploy-production-v2.yml`
(หรือ `deploy-uat.yml` → `deploy-production-v2.yml` แบบ single dispatch ตามหัวข้อ 5.2)

เอกสารนี้เป็นคำสั่ง deploy ปัจจุบัน แทน ceremony V1 ใน
`production-a5-u5-promotion-ceremony.md`. การ deploy ปกติไม่แก้ Cloudflare และไม่ใช้ AWS root.
อ่าน `cloud-environment-operations.md` ก่อนตรวจหรือเปลี่ยน AWS ทุกครั้ง.

## Protocol บังคับสำหรับทุก release

ความเร็วเกิดจาก **ไม่ build/test ซ้ำ, ไม่ dispatch ซ้อน และไม่เจอ error ทีละจุด** ไม่ใช่จากการข้าม
proof. Operator และ agent ทุกคนต้องใช้ runbook นี้ก่อน UAT, READY, Production, recovery, retry หรือ
เปิด–ปิด customer gate และต้องทำตามเงื่อนไขนี้ทุกครั้ง:

1. ใช้ exact reviewed PR-head SHA ที่ required CI ผ่านเป็น UAT candidate เพื่อ reuse CI; merge SHA ที่
   ไม่มี exact PR CI จะเสียเวลารัน validation ใหม่.
2. ก่อน dispatch ทุกครั้งต้องพิสูจน์ว่าไม่มี run ของ flow เดียวกัน queued/running, จด run ID ทันที และ
   monitor run เดิมจน terminal. ห้าม dispatch ซ้ำเพื่อทดลอง.
3. Freeze `main` ตั้งแต่เริ่ม READY จน Production และ final customer acceptance จบ. Source/image หรือ
   migration เปลี่ยนต้องเริ่ม UAT ใหม่; controller-only change ใช้ Passport เดิมได้เฉพาะ validator ยอมรับ.
4. Production ใช้ exact immutable digest ที่ UAT build/test/sign แล้ว; ห้าม rebuild image ใน Production.
5. Failure ต้องหยุดที่ first failing boundary, เก็บ evidence, ตรวจ sibling/ขั้นถัดไปแบบ read-only และ
   พิสูจน์ root-cause fix ก่อน retry. ห้ามเดินต่อเพื่อหา error ต่อไปทีละตัว.
6. `PROMOTED_LIVE` หมายถึง deployment ผ่าน แต่ลูกค้าเปิดจริงต่อเมื่อขั้น E เปลี่ยน durable
   PlatformAccess เป็น `OPEN` และ acceptance หลัง logout ผ่านครบ. ห้ามใช้ Cloudflare แทน gate นี้.

Release ledger ขั้นต่ำต้องมี `candidate`, `controller`, `UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`,
Passport/READY/Result artifact digest, serving mode, legal evidence/owner reference และผล final acceptance.

## Scoped owner exception for October9 Production disaster restoration

Operation `20261009-production-restore` restores original serving source `bdb65d8e8f6153b83d83783c930e96e3a38c2a7b`
and its exact images from offline evidence, without a rebuild or workflow dispatch. After current
administrator/OPEN/logout checks and an actual successful LINE AI reply, the owner explicitly accepted
one unchanged September25 ambiguous security-email record and its retained alarm: “ยอมรับข้อยกเว้นเดิมและปิดงานกู้คืน”.
The verified KMS result is `OWNER_ACCEPTED_WITH_EXISTING_EMAIL_ALARM`; it preserves all evidence limits
and does not claim all security alarms are OK or that the old email was delivered. No resend, data
mutation or alarm suppression is authorized by this exception. It applies only to this restoration,
not future releases or UAT. [Signed result and evidence](../agent-memory/production-offline-restore-2026-10-09.md).

## Owner-authorized Production Kamal migration — 2026-09-18

The owner explicitly selected ECS-to-Kamal migration and the isolated Hotfix path first, combining
pricing8f5b508a with cancelled-certificate confirmation0b0058ad. This application candidate is based
on servingfc2838c4 and does not include the UAT/main backlog. The separate signed-UAT promotion
path continues to require exact tested image digests and no Production rebuild. This scoped choice
does not waive controller review/CI, current-administrator acceptance, signature verification,
configuration/authority checks, failure retention or customer OPEN requirements.

Use [Kamal release and first-migration instructions](../../infra/kamal/README.md) and record local
operation IDs separately from workflow IDs. UAT/READY/PROD workflow IDs are `NOT_DISPATCHED` for
the isolated local operation, never borrowed from another release. Initial infrastructure staging
and local build/preparation are not live release completion. Retain the original ECS source, routes,
provider and build authority through the first rollback window. Both signed acceptance and actual
§E administrator/live/OPEN/logout evidence must pass before `cutoverComplete:true` enrollment.
The owner named Chrome developer for the existing `prodmangmeeplus` session, and Chrome Thawatchai
company Snd Prd for the receipt/substitute/cancel/confirm business journey. Do not use seed accounts
or reset credentials, and do not mark a mocked browser regression as this live journey.

## Scoped owner browser waiver for September18 Production hotfixes

After manually trying the first release, the owner explicitly stopped further browser checks and
instructed continuing the isolated card fix and both branch integrations. This exception applies only
to source`0b0058ad` / operation`20260918T113740Z-2b1e04fa` and source`1406d382` /
operation`20260918T143800Z-e6c3b860`. The first is signed`OWNER_ACCEPTED_BROWSER_HTTP_WAIVED`;
the second is signed`ACCEPTED_WITH_BROWSER_HTTP_WAIVER`. Neither claims standard §E identity,
flags, logout204 or post-logout401 checks were completed. The second explicitly records that the
owner did not manually test the future candidate. Owner decision/override hashes are signed.

Exact source/config/readiness, public OPEN, KMS verification, failure retention and mutation guards
remain in force. The original interrupted first acceptance is retained. No generic browser bypass
was added to the controller, and this waiver is not authority for a future release. Do not resume
browser testing of these releases against the owner's stop instruction.
[Actual evidence, timing, rollback and branch integration](../evidence/production-two-hotfixes-2026-09-18.md).

## Owner-authorized UAT Kamal stability proof — 2026-09-11

The owner explicitly requires consolidated rehearsal and fixes before the next live run, followed by
one successful deployment and another latest-main deployment for timing. For these UAT proof runs,
login/logout is no longer required; complete config and system readiness are the acceptance boundary.
Use the reviewed main controller with `infra/kamal/deploy-uat --profile mangmee-kamal-uat --mode hotfix
--apply --uat-smoke-acceptance`. Keep one operation and its complete clock, exact source/config/image,
API/DB/AI/workers/Redis/internal-API readiness, public OPEN and signed smoke result. Retain every
failure and reconcile it before another operation; rehearsal evidence is never called a live deploy.
This explicit UAT exception does not change Production V2, its gate decisions, or its acceptance.
Track local Kamal operation IDs separately from UAT/READY/Production workflow run IDs.
Completed proof: `20260911T170623Z-c8d84820` and `20260911T171058Z-8c83ebfc`, signed and OPEN;
[full phase totals and scope](../research/kamal-uat-stable-hotfix-proof-2026-09-11.md).
Unchanged-main cold-build-cache proof `20260911T201637Z-cb364f03` also passed once, signed and OPEN:
11m14.699s deploy command; 11m32.827s including queue/main checks and fresh-builder setup;
11m39.039s including isolated-builder cleanup. No error/retry; this cold run exceeds the 10-minute
goal. [Complete timings, zero-cache evidence and boundaries](../research/kamal-uat-cold-cache-proof-2026-09-12.md).

The current UAT application release is `20260921T104804Z-b234bbdb`, exact main
`4fb173afbc93d81d1cddfa240de18d49d08f2a46`, signed/OPEN in 379.348 seconds. For subsequent local
Kamal UAT releases, use SSM-enrolled targets and no public TCP/22 operator rule. Prepare the exact
main build separately and pass its `build/` directory with `--prepared-build` when cache or a retry
would otherwise rebuild. The apply controller caps an unprepared build at 240 seconds, stops before
mutation after 360 seconds of pre-mutation work, and records the 600-second target in signed UAT
acceptance. Before publication it verifies that each host has twice the exact assigned candidate
image size plus 2 GiB available on the Docker filesystem. Postmark transport/5xx/429 preflight errors
use only the bounded read-only retry contract below; identity, JSON, credential, and stream-contract
errors fail immediately. After the signed release and remote lock are complete, every
controller-owned SSM session must terminate before the command can report success; unproved cleanup
returns `FAILED_TRANSPORT_CLEANUP_REQUIRED`. These limits never authorize skipping reconciliation,
exact-source/config validation, migrations, deep readiness, customer OPEN, retirement, or KMS signing.

## เส้นทางปกติ ฉบับคน deploy

จำ flow เดียวนี้: **UAT → READY → Production**. จด ID สามตัวไว้เสมอ:
`UAT_RUN_ID`, `READY_RUN_ID`, `PROD_RUN_ID`. ถ้าขั้นใด fail ให้หยุดหาสาเหตุ; ห้ามกดซ้ำเพื่อ
ลองใหม่. Flow ปกติไม่เปิด Cloudflare และจบที่ `maintenance_closed`; live ใช้ explicit owner override
หรือ verified legal bundle ตามหัวข้อ D เท่านั้น.

### A. ขึ้น UAT

1. เลือก `candidate` เป็น full SHA 40 ตัวของ reviewed PR head ที่ CI ผ่าน แล้ว merge PR เข้า `main`.
   ตรวจว่า candidate เป็น ancestor ของทั้ง `origin/main` และ `origin/develop`.
2. ตรวจว่าไม่มี UAT/Readiness/Production run อื่นกำลัง queued หรือ running แล้ว freeze `main`
   ตั้งแต่ก่อน dispatch UAT จน Production จบ. นี่คือเส้นทางปกติที่ไม่เกิด controller/source race.
3. สั่ง UAT จาก workflow บน `main`:

   ```sh
   repo=MangmeeDev/mangmeeplus
   candidate=<reviewed-lowercase-40-char-sha>

   gh workflow run deploy-uat.yml -R "$repo" --ref main \
     -f release_ref="$candidate" \
     -f target=all \
     -f run_m01_acceptance=false
   ```

4. จด `UAT_RUN_ID` แล้วรอ run เดิมจนจบ. ผ่านได้เมื่อ title/source ถูกตัว, workflow สำเร็จ,
   service ใช้ exact digest, health ผ่าน และมี signed Passport ของ candidate.
5. ตรวจ deep DB readiness ด้วยคำสั่ง secret-safe ในหัวข้อ 3. ถ้า consent หรือ journey ธุรกิจเปลี่ยน
   ให้ทดสอบ journey นั้นบน UAT จริงด้วย. ผู้ที่เคยยอมรับเอกสาร hash เดิมต้องไม่ถูกถามซ้ำ.

UAT คือจุดที่ build/test/sign image. หลังจากนี้ Production ต้องใช้ digest ชุดนี้โดยไม่ rebuild.

### B. ออก Production READY

1. UAT `all` ที่สำเร็จจะสร้าง Readiness run ให้อัตโนมัติ. อย่ากด manual ซ้อนกับ run ที่มีอยู่.
2. จด `READY_RUN_ID`; `main` ต้องยัง frozen และตรงกับ controller ที่เริ่ม UAT.
3. ผ่านได้เมื่อ Readiness สำเร็จ, controller ตรงกับ `origin/main`, ทุก check เป็น `PASS` และมี signed
   READY artifact. `EXACT_MATCH` ไม่สร้าง clone; ถ้ามี migration ค้าง ต้อง clone/rehearse และล้าง
   resource เหลือศูนย์ก่อน.

Readiness เป็นการพิสูจน์ก่อน deploy; ถ้า fail จะยังไม่เปลี่ยน Production. กรณีต้อง dispatch เองดู
คำสั่งในหัวข้อ 4.

### C. ขึ้น Production แบบปิดลูกค้า

1. ตรวจว่า `origin/main` ยังเท่ากับ controller ใน READY.
2. สั่ง Production หนึ่งครั้ง:

   ```sh
   gh workflow run deploy-production-v2.yml -R "$repo" --ref main \
     -f uat_run_id="$UAT_RUN_ID" \
     -f readiness_run_id="$READY_RUN_ID" \
     -f requested_serving_mode=maintenance_closed
   ```

3. จด `PROD_RUN_ID` แล้วรอ run เดิมจนจบ; ห้าม cancel/rerun ระหว่าง durable operation.
4. เสร็จจริงเมื่อ workflow สำเร็จ, signed result เป็น `PROMOTED_CLOSED`, maintenance proof เป็น
   `DEPLOYED_NOT_LAUNCHED`, image/source ตรง UAT, deep DB readiness ผ่าน, SYSTEM_ADMIN acceptance
   ผ่าน และไม่มี clone residue.
5. ยืนยันสุดท้ายว่าหน้าลูกค้ายังแสดง maintenance, platform access เป็น `CLOSED` และ
   `canOpen=false`. การเปิดจริงเป็น ceremony แยกหลัง legal evidence และ owner decision พร้อม.

### D. ขึ้น Production แบบเปิดลูกค้าด้วย owner override

ใช้เฉพาะเมื่อ owner ตัดสินใจรับความเสี่ยงและให้ reference ที่ตรวจย้อนหลังได้. ระบบจะไม่แก้
`legal-release-evidence.json` จาก `BLOCKED` เป็น `VERIFIED`; signed READY จะบันทึก
`legal.mode=OWNER_OVERRIDE`, `approvedBy=MangmeeDev` และ reference จริง.

1. หลัง UAT สำเร็จ อย่าใช้ READY อัตโนมัติแบบ `maintenance_closed` เป็น input ของ live. ออก READY
   ใหม่จาก Passport เดิมโดยสั่ง:

   ```sh
   OWNER_OVERRIDE_REF=<owner-approval-reference>
   gh workflow run production-readiness.yml -R "$repo" --ref main \
     -f uat_run_id="$UAT_RUN_ID" \
     -f requested_serving_mode=live \
     -f owner_legal_override_ref="$OWNER_OVERRIDE_REF"
   ```

2. ตรวจ signed READY ว่า `serving.requestedMode=live`, `legal.mode=OWNER_OVERRIDE`,
   `legal.approvedBy=MangmeeDev` และ `legal.ownerApprovalRef` ตรง input ทุก byte.
3. สั่ง Production ด้วย READY live นั้น:

   ```sh
   gh workflow run deploy-production-v2.yml -R "$repo" --ref main \
     -f uat_run_id="$UAT_RUN_ID" \
     -f readiness_run_id="$READY_RUN_ID" \
     -f requested_serving_mode=live
   ```

4. Deployment phase ผ่านเมื่อ signed result เป็น `PROMOTED_LIVE`, service ทั้งสามเป็น exact UAT
   digest + `live`, deep DB readiness ผ่านและไม่มี clone residue. นี่ยังไม่ใช่หลักฐานว่าลูกค้าเปิดใช้ได้;
   ต้องทำขั้น E ต่อ. เก็บ override reference ไว้กับ release record; เมื่อไฟล์จากทนายกลับมาให้สร้าง
   verified bundle ตาม runbook แยก.

### E. เปิด durable customer gate และยืนยันใช้งานจริง

ทำเฉพาะหลัง signed result ของ run เดียวกันเป็น `PROMOTED_LIVE`. ใช้ administrator ปัจจุบัน
`prodmangmeeplus` ผ่าน BFF หรือ session ที่เจ้าของ login ไว้ และพิสูจน์ identity/permission ก่อน mutation.
Signed cutover ADD `32840045983` / REVOKE `32843219991` ยกเลิก seed เดิมแล้ว
(หลักฐานใน `docs/agent-memory/scheduled-uat-prod-release-2026-09-07.md`). ห้ามใช้
`thawatchai.watchdog`, seed password หรือ cutover temporary password และห้าม reset เพื่อทำ acceptance.
ถ้า session/credential ปัจจุบันไม่พร้อม ให้เจ้าของ login ผ่าน UI; ไม่ขอ password ในแชท:

1. Login ต้องได้ `200`, `passwordChangeRequired=false`, `legalAcceptanceRequired=false` และ redirect
   `/system/platform-access`.
2. `/api/v1/auth/me` ต้องเป็น `cmt8k20fs00000q319isxwkc5` (`prodmangmeeplus`), มี role `SYSTEM_ADMIN` และ permission
   `system.launch_gate.manage`.
3. ก่อน mutation, `/api/v1/system/platform-access` ต้องอ่านได้, `servingMode=live` และ `canOpen=true`.
4. ถ้า `effectiveState=CLOSED` ให้ PUT `state=OPEN` พร้อม reason ที่ผูก owner/legal reference และ
   `PROD_RUN_ID`. ถ้าเปิดอยู่แล้วห้ามเขียนซ้ำ; ให้ตรวจ reason/readback แทน.
5. Readback แบบไม่ใช้ session ต้องได้ `/api/v1/auth/platform-access` เป็น `OPEN`; หน้า `/login` ต้อง
   แสดง `data-platform-access="open"`; หน้า `/system/platform-access` ด้วย session ต้องได้ `200`.
6. Logout ต้องได้ `204`, post-logout `/api/v1/auth/me` ต้องได้ `401`, แล้วทำลาย password variable,
   cookie jar และ header file. ห้าม `set -x`, `curl -v`, secret ใน argv/stdout/history หรือ artifact.
7. ตรวจบริการ Production ทั้งสามเป็น `ACTIVE` โดยไม่มี current deployment และ rollback/security
   alarms เป็น `OK`; บันทึกผลลง release ledger.

Release live เสร็จจริงเมื่อขั้น E ผ่านครบเท่านั้น. ถ้าข้อใด fail ให้ปิด/คง gate ตามสถานะที่พิสูจน์ได้,
หยุดและใช้ failure protocol; ห้ามแก้ Cloudflare เพื่อ bypass.

ถ้า source/image/migration catalog เปลี่ยน ให้เริ่ม A ใหม่. ถ้าเปลี่ยนเฉพาะ controller และ Passport
ยัง valid อาจเริ่ม B ใหม่ได้ตาม validator. ถ้าเปลี่ยนเพียงเอกสารภายใน `docs/**` ที่ไม่เข้า image/runtime
ไม่ต้อง deploy.

## 1. ตัดสินก่อนว่าต้อง deploy หรือไม่

| การเปลี่ยนแปลง | เส้นทางที่ต้องใช้ |
| --- | --- |
| `docs/**` ที่ไม่รวมใน image/runtime | ไม่ต้อง deploy |
| Workflow/controller/security validator เท่านั้น และ candidate images เดิม | ออก READY ใหม่บน `main` ปัจจุบัน; ใช้ Passport เดิมได้เฉพาะเมื่อยังไม่หมดอายุและ validator ยอมรับ |
| Application, Dockerfile, dependency, migration, runtime config contract | PR/CI → UAT `all` → Passport ใหม่ → READY → Production |
| Privacy/PDPA/legal page, legal version, consent rule หรือ API/DB behavior ที่ผู้ใช้ได้รับจริง | ถือเป็น application change: Passport ใหม่ และเพิ่ม acceptance ของ journey ที่เปลี่ยน |
| Privacy/PDPA เป็นเอกสารภายใน `docs/**` เท่านั้น | ไม่ต้อง deploy |
| IAM/network/S3/runtime prerequisite contract | ใช้ prerequisite ceremony ที่ review แล้ว จากนั้น READY ใหม่; ออก Passport ใหม่ด้วยเมื่อ image/source เปลี่ยน |

อย่า deploy เพียงเพราะ `main` มี commit เอกสารใหม่. อย่านำ Passport หรือ READY เก่ามาใช้เมื่อ
source, image digest, migration catalog หรือ controller contract ไม่ตรง. Passport และ READY อายุไม่เกิน
24 ชั่วโมง; Production ตรวจซ้ำและปฏิเสธเองเมื่อหมดอายุหรือ baseline drift.

การเปิด `live` ต้องมี independent verified legal bundle หรือ explicit owner override ตามหัวข้อ D.
ผู้รันทั่วไปสร้าง override ไม่ได้; workflow รับเฉพาะ manual dispatch โดย actor `MangmeeDev` และผูก
approval reference เข้า signed READY.

Legal release ปัจจุบันใช้ internal append-only id `v3` เพื่อรักษา history แต่แสดงต่อผู้ใช้และใน
เอกสารทนายเป็นฉบับประกาศใช้จริงครั้งแรก `ฉบับที่ 1 (1.0)`. Candidate นี้ deploy UAT และ Production
แบบ `maintenance_closed` ได้ขณะที่ manifest ยังเป็น `BLOCKED`; ห้ามตีความว่า legal gate ผ่าน.
เส้นทางปกติก่อนเปิด `live` ยังต้องผูกไฟล์ลงนามกับ exact v3 artifact hashes และ validate bundle จริง.
Owner override ไม่เปลี่ยนสถานะ legal manifest และไม่ใช่หลักฐานจากทนาย. Passport/READY expiry,
runtime, IAM, migration, health และ recovery gates ยังบังคับเหมือนเดิมทุกข้อ.

### Binary ขั้นต่ำต่อ schema ของ billing policy (add-on F-09)

`parseBillingPolicy` ปฏิเสธ key ที่ไม่รู้จัก และ policy ที่ parse ไม่ผ่านทำให้ระบบถือว่าไม่มี policy จึงปิดการซื้อแพ็กเกจของทุกร้านทันที. ดังนั้นเผยแพร่ policy ที่มี key ใหม่ได้เฉพาะเมื่อ binary ที่อ่าน key นั้นขึ้นครบทั้ง UAT และ Production แล้ว และหลังเผยแพร่ ห้าม rollback ไป binary ที่ต่ำกว่าขั้นต่ำ เว้นแต่เผยแพร่ policy ที่ถอด key นั้นออกก่อน

| key ใน policy | binary ขั้นต่ำ | หมายเหตุ |
| --- | --- | --- |
| `addOnPriceIds` | image ที่มี migration `20260929120000_billing_product_foundation` (add-on PR A) | ไม่มี gate ของ add-on (มติ Owner 2026-09-29): การผูก Price ของ offer คือการเปิดขาย offer นั้นเมื่อสินค้าพร้อม |

## 2. Proof ก่อนใช้ GitHub Actions

1. Merge เฉพาะ exact reviewed head ที่ required CI ผ่านครบ. ห้ามลด branch protection หรือข้าม check.
2. รัน focused checks ของสิ่งที่เปลี่ยน. ถ้าแตะ release workflow, security contract, Dockerfile,
   migration tool หรือ evidence ให้รันเพิ่ม:

   ```sh
   node infra/security/sync-production-maintenance-release-pins.mjs --check
   bash infra/docker/production-image-security.spec.sh
   git diff --check
   ```

3. ตรวจว่าไม่มี UAT/Readiness/Production run อื่นของ release เดียวกันที่ queued หรือ running. ห้าม
   dispatch ซ้ำเพื่อหา error. Run ที่ fail ต้องมี root cause และ proof matrix ใหม่ก่อน retry.
4. ถ้า IAM, trust, runtime resource หรือ S3 lifecycle เปลี่ยน ให้ใช้
   `production-promotion-prerequisite-bootstrap.md` และ exact-readback ก่อน UAT/READY. ห้ามแก้ IAM
   ระหว่าง deploy.
   สำหรับ UAT AgentCore ให้ใช้ scoped `--apply-uat-runtime`; mode นี้ต้องพิสูจน์ deploy role,
   ECS AI role, AgentCore execution role, secret metadata, runtime zero-or-one/READY และ artifact
   bucket versioning พร้อมกัน ห้ามซ่อมเฉพาะ policy แรกที่ workflow รายงานแล้ว dispatch ซ้ำ.
5. `main` ต้องมี controller ที่ review แล้ว; candidate ต้องเป็น lowercase full SHA ที่ reachable จาก
   `develop`. สำหรับ cost path ให้ใช้ exact PR head ที่มี successful pull-request CI. Merge SHA ที่ไม่มี
   exact CI อาจถูกต้อง แต่ UAT จะรัน validation ทั้งชุดใหม่. UAT `all` ยังบังคับให้ candidate มี blob
   `.github/workflows/ci.yml` และ `.github/workflows/deploy-uat.yml` ตรงกับ controller บน `main`;
   ถ้าไม่ตรงให้ sync/review source ก่อน dispatch.

## 3. Deploy UAT และออก Passport

ใช้ `main` เป็น controller และ candidate SHA เป็น application source:

```sh
repo=MangmeeDev/mangmeeplus
candidate=<reviewed-lowercase-40-char-sha>

git fetch origin main develop
git merge-base --is-ancestor "$candidate" origin/develop
gh workflow run deploy-uat.yml -R "$repo" --ref main \
  -f release_ref="$candidate" \
  -f target=all \
  -f run_m01_acceptance=false
```

หลัง dispatch ให้บันทึก `UAT_RUN_ID` และตรวจทันที:

- run title เป็น `Deploy <candidate> → UAT/all`
- `head_sha` ของ run เท่ากับ `origin/main` ตอน dispatch
- resolved target เป็น `all`
- exact PR CI ถูก reuse หรือ validation ทั้งชุดจบจริง; อย่าดูแค่ overall conclusion
- release task, deploy, exact digest/health, retirement และ finalization ผ่าน
- มี artifact เดียวชื่อ
  `uat-release-passport-v2-<candidate>-attempt-<attempt>` ที่ยังไม่หมดอายุ
- มี runtime images สามตัว, `release-task` และ `migration-tool` เป็น immutable digest พร้อม
  signature/SBOM ตาม Passport

UAT workflow ยังไม่ส่ง `WORKER_INTERNAL_TOKEN` ให้ `verify-deployment.sh`; จึงต้องพิสูจน์ deep DB
readiness อีกครั้งโดยไม่แสดง secret ก่อนใช้ Passport กับ Production:

```sh
(
  set -euo pipefail; set +x
  export AWS_PROFILE=watchdog-bedrock AWS_REGION=ap-southeast-1
  uat_url="$(aws ssm get-parameter \
    --name /watchdog-bms/uat/ecs-express-api-web-url \
    --query Parameter.Value --output text)"
  [[ "$uat_url" =~ ^https://[a-z0-9-]+\.ecs\.ap-southeast-1\.on\.aws/?$ ]]
  worker_token="$(aws secretsmanager get-secret-value \
    --secret-id watchdog-bms/uat/worker-internal-token \
    --version-stage AWSCURRENT --query SecretString --output text)"
  [[ "$worker_token" =~ ^[0-9a-f]{64}$ ]]
  body="$(printf 'header = "X-Worker-Token: %s"\n' "$worker_token" \
    | curl --config - --proto '=https' --tlsv1.2 --fail-with-body \
      --silent --show-error --max-time 20 \
      "${uat_url%/}/v1/internal/health/readiness")"
  unset worker_token
  jq -e '.service=="api" and .status=="ok" and .db=="ok"
    and (.timestamp|type=="string")' <<<"$body" >/dev/null
  jq -c '{service,status,db,timestamp}' <<<"$body"
)
```

ห้ามใช้ `set -x`, `curl -v`, command-line header, `tee` หรือพิมพ์ secret. ถ้า Privacy/PDPA หรือ
journey ธุรกิจเปลี่ยน ให้รัน acceptance ของ journey นั้นบน exact UAT candidate เพิ่มก่อน READY.
เมื่อ Terms/Privacy artifact SHA-256 pair เปลี่ยนเพราะเนื้อหาสาระเปลี่ยน ต้องพิสูจน์ว่าผู้ใช้ที่เกี่ยวข้อง
ถูกขอ acceptance รุ่นใหม่ตามกติกาและห้าม bypass `legalAcceptanceRequired` เพียงเพื่อให้ smoke test ผ่าน.
การ deploy ซ้ำ, เปลี่ยน internal version/URL, display label, statement version หรือข้อความ/หน้าตา checkbox
โดย artifact hash pair เดิม ต้องไม่ทำให้ผู้ใช้ที่มีหลักฐานครบถูกถามซ้ำ.

## 4. Production Readiness

UAT `all` ที่สำเร็จจะ trigger `production-readiness.yml` อัตโนมัติใน
`maintenance_closed`. ใช้ run อัตโนมัติเพียงหนึ่ง run; ห้าม manual dispatch ซ้อนกับ run ที่ queued
หรือ running. ถ้า controller เปลี่ยนหลัง UAT, auto run ไม่มี artifact, หรือจำเป็นต้องออก READY ใหม่
จาก Passport เดิมที่ยัง valid ให้ dispatch เอง:

```sh
gh workflow run production-readiness.yml -R "$repo" --ref main \
  -f uat_run_id="$UAT_RUN_ID" \
  -f requested_serving_mode=maintenance_closed
```

ตั้งแต่ Readiness เริ่มจน Production จบ ให้ freeze `main`. บันทึก `READY_RUN_ID` และตรวจว่า:

- title เป็น `Production readiness from UAT <UAT_RUN_ID>`
- run อยู่บน exact `origin/main` และ input mode เป็น `maintenance_closed`
- Passport signature/expiry, branch policy, images, IAM, secret metadata, SSM, network, RDS,
  Redis, AgentCore, service health และ migration catalog ผ่าน
- `EXACT_MATCH` ใช้ quick path; `APPEND_ONLY_PENDING` ต้องสร้าง fresh tagged manual snapshot,
  restore clone, ลบ snapshot ก่อน rehearsal และ cleanup DB/secret/task/definition/ENI จน residual เป็นศูนย์
- มี signed artifact
  `production-release-ready-v2-<candidate>-run-<READY_RUN_ID>-attempt-<attempt>`
- `ready.json` มี source, UAT run, controller, requested mode และทุก check ตรงกับ run นี้

ถ้า Readiness fail จะยังไม่มี Production service/DB mutation. แก้ root cause แล้วออก READY ใหม่ได้
โดยไม่ rerun UAT เฉพาะเมื่อ Passport ยัง valid และ source/image/catalog ไม่เปลี่ยน.

`production-readiness.yml` ยังเป็น entry point เต็มรูปแบบสำหรับ standalone READY (controller-only
re-READY, rehearsal, live READY ที่ต้องตรวจก่อน promote) และเป็นเส้นทาง rollback ของ single-dispatch
ในหัวข้อ 5.2 โดยไม่ต้อง revert code. `deploy-production-v2.yml` เรียก workflow ไฟล์เดียวกันนี้เป็น
`workflow_call` เมื่อ dispatch แบบ single จึงได้ readiness job, check ชุดเดียวกัน, signing identity
`production-readiness.yml@refs/heads/main` เดิม และ `ready.json` schema เดิมทุก field.

## 5. Deploy Production แบบปิดลูกค้า

มีสองเส้นทางที่ใช้ validator, signed artifact และ mutation gate ชุดเดียวกันทุกข้อ. ต่างกันเฉพาะว่า
READY ถูกพิสูจน์ใน run แยกหรือใน run เดียวกับ promote:

| เส้นทาง | `readiness_run_id` | READY artifact | ใช้เมื่อ |
| --- | --- | --- | --- |
| 5.1 two-dispatch | ส่งค่า `READY_RUN_ID` | จาก READY run แยก (เก่ากว่า) | live promote ที่ต้องตรวจ READY ก่อน, controller-only re-READY, rollback ของ 5.2 |
| 5.2 single-dispatch | เว้นว่าง | สร้างใน run นี้เอง (`READY_RUN_ID == PROD_RUN_ID`) | เส้นทางปกติหลังผ่าน rehearsal gate |

ทั้งสองเส้นทางบังคับเหมือนกัน: Passport/READY signature + expiry + baseline drift rejection,
stable service identity ที่ mutation boundary, และ READY migration authority ใน durable database
fence. Production ห้าม build/test/sign application image ใหม่ทั้งสองเส้นทาง.

### 5.1 Two-dispatch: READY run แยก แล้ว promote

ก่อน dispatch ตรวจอีกครั้งว่า `origin/main` ยังเท่ากับ READY controller. จากนั้น:

```sh
gh workflow run deploy-production-v2.yml -R "$repo" --ref main \
  -f uat_run_id="$UAT_RUN_ID" \
  -f readiness_run_id="$READY_RUN_ID" \
  -f requested_serving_mode=maintenance_closed
```

บันทึก `PROD_RUN_ID` และตรวจทันทีว่า title เป็น
`Promote READY <READY_RUN_ID> → maintenance_closed` และ `head_sha` เท่ากับ READY controller.
Workflow จะตรวจ Passport/READY/current baseline ซ้ำก่อนรับ deploy authority, ใช้ image digest เดิม,
apply เฉพาะ pending migration ที่ READY อนุญาต, rollout, ตรวจ deep DB readiness, พิสูจน์ global
maintenance และ finalization. เพราะ READY มาจาก run เก่ากว่า เส้นทางนี้ยังรัน read-only recheck
ทั้งสามขั้น (image availability + runtime baseline, clone policy, service/IAM/migration baseline)
ก่อนรับ deploy authority.

### 5.2 Single-dispatch: พิสูจน์ READY แล้ว promote ใน run เดียว

เว้น `readiness_run_id` ว่างไว้. `deploy-production-v2.yml` จะรัน readiness job จาก
`production-readiness.yml` เป็น job แรกของ run เดียวกัน แล้ว promote job ใช้ READY artifact
ของ run นั้น:

```sh
gh workflow run deploy-production-v2.yml -R "$repo" --ref main \
  -f uat_run_id="$UAT_RUN_ID" \
  -f requested_serving_mode=maintenance_closed
```

live ด้วย owner override ใช้ dispatch เดียวกันโดยเพิ่ม `-f owner_legal_override_ref="$OWNER_OVERRIDE_REF"`;
actor ต้องเป็น `MangmeeDev` และ inline readiness บังคับ owner/legal contract เดียวกับหัวข้อ D ทุกข้อ.

กติกาบังคับของเส้นทางนี้:

- **Rehearsal gate**: การใช้ single-dispatch ครั้งแรกหลัง controller เปลี่ยนต้องเป็น
  `maintenance_closed` บน candidate จริงและต้องจบสำเร็จ ก่อนใช้ `live` กับเส้นทางนี้.
- title จะเป็น `Promote READY inline → <mode>`; ไม่มี `READY_RUN_ID` แยก. บันทึกใน ledger ว่า
  `READY_RUN_ID = PROD_RUN_ID` และเก็บ digest ของ artifact
  `production-release-ready-v2-<candidate>-run-<PROD_RUN_ID>-attempt-<attempt>`.
- ตรวจให้ครบทั้ง readiness job และ promote job; readiness fail = promote ไม่รัน และไม่มี
  Production service/DB mutation.
- read-only recheck ทั้งสามขั้นของ 5.1 ถูกข้าม เพราะ inline readiness เพิ่งอ่าน ground ชุดเดียวกัน
  ใน run นี้เมื่อไม่กี่นาทีก่อน. mutation-boundary gate ไม่ถูกข้ามข้อใดเลย.
- Rollback: กลับไปใช้ 5.1 ได้ทันทีโดยส่ง `readiness_run_id` ไม่ต้อง revert commit.
- ห้าม dispatch single-dispatch ขณะที่ auto readiness run ของ `UAT_RUN_ID` เดียวกันยัง non-terminal
  (Protocol ข้อ 2); readiness concurrency group เป็นตัว UAT run จึงจะรอคิวแทนที่จะรันซ้อน.

เรียกว่าสำเร็จได้เมื่อทุกข้อต่อไปนี้จริง:

- workflow conclusion เป็น `success`
- มี signed artifact `production-release-result-v2-<candidate>-attempt-<attempt>` เพียงหนึ่งชุด
- `result.json`: `state=="PROMOTED_CLOSED"`, source/UAT/READY/Production/controller ตรงทั้งหมด,
  `requestedServingMode=="maintenance_closed"` และ `effectiveTarget=="all"`
  (เส้นทาง 5.2 ต้องได้ `readinessRunId == productionRunId == PROD_RUN_ID`)
- `maintenance-proof.json`: `deploymentState=="DEPLOYED_NOT_LAUNCHED"`, `target=="all"`, services
  สามตัวเป็น exact source/digest และ `maintenance_only`
- secret-safe SYSTEM_ADMIN acceptance ผ่าน: BFF login `200`, redirect `/system/platform-access`,
  `/api/v1/auth/me` เป็น seed user + `SYSTEM_ADMIN` + `system.launch_gate.manage`, platform access เป็น
  `CLOSED`, `canOpen=false`, page `200`, logout `204` และ post-logout `/me` เป็น `401`
- customer traffic ยังปิด; ห้ามเปลี่ยน Cloudflare หรือเปิด launch gate ในขั้นนี้

อย่าเก็บรหัสผ่าน, token, cookie jar หรือ response ที่มีข้อมูลลับลง log/artifact. อ่าน seed password จาก
Secrets Manager ผ่าน stdin/in-memory เท่านั้น และลบ cookie jar หลังทดสอบ.

## 6. Failure และ retry

- ห้าม rerun แบบเดา. เก็บ failed run id, attempt, controller SHA, source SHA, step แรกที่ fail,
  controller evidence และ durable operation/task identity ก่อน.
- Failure ก่อน Production mutation: แก้ root cause, rerun local/provider proofs แล้วออก READY ใหม่เมื่อ
  controller เปลี่ยน.
- Failure หลังปิดหรือเริ่ม durable operation: ห้าม dispatch Production ซ้ำจน controller evidence และ
  database/platform state พิสูจน์ terminal state. ใช้ `recover-release-intent.yml` เฉพาะ mode/identity
  ที่ evidence ระบุ (`PRE_INTENT`, intent UUID, `ORPHAN` หรือ `BOOTSTRAP_CLOSED`).
- UAT recovery checkpoint ที่ไม่เปลี่ยน code อาจ reuse PostgreSQL recovery proof `32002605508` ได้โดย
  `recover-release-intent.yml` เท่านั้น: exact checkpoint CI ต้องสำเร็จและ skip `Typecheck and Test`,
  proof SHA ต้องเป็น ancestor และ Git diff ของ `apps/api/prisma` พร้อม package/lock/workspace/tsconfig
  inputs ต้องว่างทุก byte. เงื่อนไขใดไม่ตรงให้ fail closed; ข้อยกเว้นนี้ใช้กับ Production ไม่ได้.
- ถ้า target=`all` fail ก่อนบาง service สร้าง intent ให้ recover exact intent ที่มีอยู่ทุกตัวก่อน.
  Parent terminalize เป็น `FAILED_CONFIRMED` ได้เมื่อไม่มี OPEN/cleanup ค้าง, ทุก intent ที่มีถูก revalidate
  จาก platform+SSM สองรอบและมี `recovererControllerJson`, และ service ที่ขาดไม่มี intent เลย เพราะ
  `deploy.sh` บันทึก intent ก่อน ECS mutation เสมอ. ห้ามใช้ binder-BOUND อย่างเดียวเป็น recovery proof.
- `BOOTSTRAP_CLOSED` ใช้ได้เฉพาะ failed Production V2 ที่ไม่มี api-web intent และมี exact failed-run
  artifact. แบบเดิมรองรับ zero intents; แบบ partial-closed รองรับเฉพาะ non-api intents ที่ทุกตัวเป็น
  `BOUND`, ไม่มี cleanup ค้าง และ evidence ตรงกับ append-only rollout history ใน artifact ทุก byte.
  ทั้งสองแบบต้อง live-read สองรอบว่าบริการทั้งสามเป็น candidate เดียวกันและ `maintenance_only` ก่อน
  terminalize parent เป็น `RECONCILED_FAILED_CONFIRMED`. ต้องส่ง `failed_promotion_run_id`, held
  candidate, reviewed recovery SHA และ parent operation UUID; recovery ไม่ถือเป็น promotion สำเร็จ.
- Recovery สำเร็จไม่ใช่ promotion สำเร็จ. หลัง recovery ให้ออก READY ใหม่บน current `main`, freeze
  `main` แล้ว dispatch Production ใหม่หนึ่งครั้ง.
- HTTP checks แบบ read-only ของ UAT CI reuse, branch protection, runtime health, deep DB readiness
  และ maintenance ingress ใช้ bounded transport/provider retry เท่านั้น: สูงสุดสามครั้ง ครั้งละ
  20 วินาที ภายในเพดาน 70 วินาที. HTTP/JSON/maintenance marker ที่ผิด contract ยัง fail closed และ
  ห้ามนำ retry contract นี้ไปครอบคำสั่ง mutation.
- ถ้า source/image/migration catalog เปลี่ยน ให้เริ่มจาก UAT และ Passport ใหม่เสมอ.

### ปัญหาที่เกิดจริงและกติกาป้องกันถาวร

| ปัญหา | Root cause | สิ่งที่บังคับใช้ต่อไป |
| --- | --- | --- |
| UAT เสียเวลารัน CI ซ้ำ | ใช้ merge SHA ที่ไม่มี successful PR CI ตรง exact head | ใช้ reviewed PR-head SHA เป็น candidate และพิสูจน์ CI reuse ก่อน fan-out |
| Readiness ซ้อน/queued ค้าง หรือ input ไม่ครบ | auto readiness กับ manual dispatch ชนกัน; เคย dispatch live โดยขาด owner override | ตรวจ zero active runs, รอ auto run terminal ก่อน manual live, ตรวจ title/head/input ทันที และห้ามสร้าง run ที่สองขณะ run แรกยัง non-terminal |
| Readiness ล้มด้วย `unbound variable` ทั้งที่ `bash -n` ผ่าน | same-line `local` อ้างตัวแปรก่อน assignment ภายใต้ `set -u` | shell gate ต้อง execute critical function/path ด้วย fixture ไม่ใช้ syntax/grep เป็น proof เพียงอย่างเดียว |
| Reader bootstrap รายงาน cleanup ว่างแต่มี ACTIVE task definition | เข้าใจผิดว่า ECS `family-prefix` รับ arbitrary prefix ทั้งที่ provider ต้องการ full family | global ACTIVE list ต้อง filter ด้วย exact anchored local ARN; provider-faithful fixture และ live stable-empty readback |
| api-web rollout rollback หลัง workers/AI ผ่าน | customer CLOSED guard คืน `503` ให้ authenticated `/v1/internal/*` machine traffic จน rollback alarm ทำงาน | internal route bypass เฉพาะ customer gate แต่ยังบังคับ machine credential; regression ต้องครอบ closed-mode deep readiness ก่อน rollout |
| Signed `PROMOTED_LIVE` ผ่านแต่ลูกค้ายังเห็น maintenance | durable PlatformAccess ยังเป็น `CLOSED` | ขั้น E เป็น terminal release boundary; ต้องเปิดด้วย SYSTEM_ADMIN, public readback, logout และ post-logout proof |
| GitHub run เป็น ghost shell queued และ cancel `500` | enable→dispatch ชิดเกินไปที่ control plane; run ยังไม่มี job graph | คง workflow active, ห้าม enable แล้ว dispatch ทันที, ตรวจ jobs/check-runs และห้าม dispatch duplicate จน run เดิม terminal หรือ platform incident ถูกแยกชัด |

## 7. หลักฐานอ้างอิงรอบที่ผ่านจริง

รอบ 2026-08-14 พิสูจน์เส้นทางนี้ end-to-end โดยคงลูกค้าไว้ใน maintenance:

- candidate source: `cacdc4a91aa6bb3e5512f529991bd42b6a3f2580`
- final controller/main: `854cc362f25fabc2d4346813d6351631ff4f4eae`
- UAT/Passport: run `31723608941`
- exact-main CI: run `31748250413`
- `BOOTSTRAP_CLOSED` recovery: run `31749393268`
- Production READY: run `31749841233`, artifact digest
  `sha256:4ee0f65d735a410b700036a1144a4f9ce7a273a52c87dae801166f64e7c3f3c2`
- Production V2: run `31750329856`, result artifact digest
  `sha256:4b1778938b06c895a0ce7687ef7845535d6ba9198d7261eeecf3a86dbfd3432e`
- final state: `PROMOTED_CLOSED`, `DEPLOYED_NOT_LAUNCHED`, target `all`; secret-safe
  SYSTEM_ADMIN acceptance ผ่านและ customer launch ยังปิด

รอบ 2026-08-15 พิสูจน์ UAT redeploy stability เพิ่มเติมก่อน promote Production:

- candidate source: `c1fd8def8372730e8baac340b989f75723607bf1`
- UAT/Passport: run `31853053851`, artifact digest
  `sha256:da870dfc357fe5d2364189be71ab416773cd3aecbada71e06745cd54bcc566a6`
- deep DB readiness ได้ `service=api`, `status=ok`, `db=ok`
- disposable OWNER ที่มีหลักฐาน Terms/Privacy hash pair เดิมยังได้ `required=false` และ `acceptedAt`
  เดิมหลัง redeploy, reset/change-password/relogin; จากนั้น archive และ read back fixture สำเร็จ
- หลักฐานนี้ยังไม่ใช่ Production promotion; Production ต้องผ่าน READY และ deploy แบบ
  `maintenance_closed` ตามขั้นตอนด้านบน

Run IDs เหล่านี้เป็น historical evidence ไม่ใช่ input สำหรับ release ใหม่.

รอบ live launch 2026-08-16 พิสูจน์ flow ครบถึง customer `OPEN`:

- candidate/controller: `3c8de8777ce1f85f7a3c1c0518c81154ab6eedf1` /
  `d0604d79dd5d9b97e8b36b213cbe495b39893e69`
- UAT/Passport: run `31901904745`, digest
  `sha256:5084fe1990a06155c63258ec2642ee4269dda4835cdb93f5de0bb491e911cba7`
- live READY: run `31903027707`, owner ref `OWNER-DIRECTIVE-2026-08-15-LIVE`, digest
  `sha256:c3fa10968f145706ace6579f6dc94513a6bb57269d5f136a199063e8d288fb48`
- Production V2: run `31903336753`, signed `PROMOTED_LIVE`, target `all`, result digest
  `sha256:473121865a68047431e481d4bf1b847d9276e86d55b948bb42fbfc32f4e54ebe`
- final acceptance: PlatformAccess `CLOSED→OPEN`, serving mode `live`, SYSTEM_ADMIN identity/permission,
  public login, system page, logout/post-logout ผ่าน; services ทั้งสาม `ACTIVE`, no current deployment,
  alarms `OK`; ไม่มี secret ถูก log หรือเก็บค้าง
