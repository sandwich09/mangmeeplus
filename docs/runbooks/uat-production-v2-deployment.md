# UAT → Production V2 deployment

Status: canonical operator runbook for repeatable UAT and Production deployment

Default Production outcome: `PROMOTED_CLOSED` (`maintenance_closed`)

Workflows: `deploy-uat.yml` → `production-readiness.yml` → `deploy-production-v2.yml`

เอกสารนี้เป็นคำสั่ง deploy ปัจจุบัน แทน ceremony V1 ใน
`production-a5-u5-promotion-ceremony.md`. การ deploy ปกติไม่แก้ Cloudflare และไม่ใช้ AWS root.
อ่าน `cloud-environment-operations.md` ก่อนตรวจหรือเปลี่ยน AWS ทุกครั้ง.

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

การเปิด `live` ไม่อยู่ใน runbook นี้. ต้องมี legal evidence และ owner launch decision แยกต่างหาก.
จนกว่าจะมีคำสั่งนั้น ให้ใช้ `maintenance_closed` เท่านั้น.

Legal release ปัจจุบันใช้ internal append-only id `v3` เพื่อรักษา history แต่แสดงต่อผู้ใช้และใน
เอกสารทนายเป็นฉบับประกาศใช้จริงครั้งแรก `ฉบับที่ 1 (1.0)`. Candidate นี้ deploy UAT และ Production
แบบ `maintenance_closed` ได้ขณะที่ manifest ยังเป็น `BLOCKED`; ห้ามตีความว่า legal gate ผ่าน.
ก่อนเปิด `live` ไฟล์ที่ลงนามต้องผูกกับ exact v3 artifact hashes, evidence bundle/manifest ต้องเป็น
`VERIFIED` และ workflow ต้อง validate bytes จริง. ถ้าทนายส่งกลับหลัง Passport หรือ READY หมดอายุ
ต้องออก Passport/READY สดอีกครั้ง แม้ source/image ไม่เปลี่ยน; ห้ามลด expiry gate เพื่อเปิดระบบ.

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
เมื่อ legal version เปลี่ยน ต้องพิสูจน์ว่าผู้ใช้ที่เกี่ยวข้องถูกขอ acceptance รุ่นใหม่ตามกติกาและห้าม
bypass `legalAcceptanceRequired` เพียงเพื่อให้ smoke test ผ่าน.

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
- `BOOTSTRAP_CLOSED` ใช้ได้เฉพาะ failed Production V2 ที่มี zero intents และ exact failed-run artifact;
  ต้องส่ง `failed_promotion_run_id`, held candidate, reviewed recovery SHA และ parent operation UUID.
- Recovery สำเร็จไม่ใช่ promotion สำเร็จ. หลัง recovery ให้ออก READY ใหม่บน current `main`, freeze
  `main` แล้ว dispatch Production ใหม่หนึ่งครั้ง.
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

Run IDs เหล่านี้เป็น historical evidence ไม่ใช่ input สำหรับ release ใหม่.
