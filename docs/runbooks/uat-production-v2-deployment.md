# UAT → Production V2 deployment

Status: canonical operator runbook for repeatable UAT and Production deployment

Default Production outcome: `PROMOTED_CLOSED` (`maintenance_closed`)

Workflows: `deploy-uat.yml` → `production-readiness.yml` → `deploy-production-v2.yml`

เอกสารนี้เป็นคำสั่ง deploy ปัจจุบัน แทน ceremony V1 ใน
`production-a5-u5-promotion-ceremony.md`. การ deploy ปกติไม่แก้ Cloudflare และไม่ใช้ AWS root.
อ่าน `cloud-environment-operations.md` ก่อนตรวจหรือเปลี่ยน AWS ทุกครั้ง.

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

4. ผ่านเมื่อ signed result เป็น `PROMOTED_LIVE`, service ทั้งสามเป็น exact UAT digest + `live`,
   deep DB readiness ผ่าน, public login/customer journey ผ่าน และไม่มี clone residue. เก็บ override
   reference ไว้กับ release record; เมื่อไฟล์จากทนายกลับมาให้สร้าง verified bundle ตาม runbook แยก.

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
- `EXACT_MATCH` ใช้ quick path; `APPEND_ONLY_PENDING` ต้อง clone/rehearse/cleanup จน residual เป็นศูนย์
- มี signed artifact
  `production-release-ready-v2-<candidate>-run-<READY_RUN_ID>-attempt-<attempt>`
- `ready.json` มี source, UAT run, controller, requested mode และทุก check ตรงกับ run นี้

ถ้า Readiness fail จะยังไม่มี Production service/DB mutation. แก้ root cause แล้วออก READY ใหม่ได้
โดยไม่ rerun UAT เฉพาะเมื่อ Passport ยัง valid และ source/image/catalog ไม่เปลี่ยน.

## 5. Deploy Production แบบปิดลูกค้า

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
maintenance และ finalization. Production ห้าม build/test/sign application image ใหม่.

เรียกว่าสำเร็จได้เมื่อทุกข้อต่อไปนี้จริง:

- workflow conclusion เป็น `success`
- มี signed artifact `production-release-result-v2-<candidate>-attempt-<attempt>` เพียงหนึ่งชุด
- `result.json`: `state=="PROMOTED_CLOSED"`, source/UAT/READY/Production/controller ตรงทั้งหมด,
  `requestedServingMode=="maintenance_closed"` และ `effectiveTarget=="all"`
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
