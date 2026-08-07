# H-14 Private Ingress Cutover Runbook

สถานะ: เตรียมไว้ (code + deploy script พร้อม; ยังไม่ cutover)
อ้างอิง: `docs/security-remediation-checklist-merged-2026-07-17.md` → H-14

## เป้าหมาย

- `workers` และ `ai-gateway` ต้องไม่มี public endpoint (ตอนนี้ 3/3 services เป็น PUBLIC ingress บน public subnets — live read 2026-07-18)
- `api-web` ยังต้อง public (เสิร์ฟ web + LINE webhook + Cloudflare origin) — routes `/v1/internal/*` ป้องกันด้วย in-app token ที่ hardening แล้วใน H-14 code fix (constant-time compare, no OWNER synthesis, company validation)
- rotate `WORKER_INTERNAL_TOKEN` และ `AI_GATEWAY_INTERNAL_SECRET` หลัง network cutover

## สิ่งที่มีอยู่แล้ว (ยืนยัน live 2026-07-18)

- Private subnets `watchdog-bms-prod-app-private-a/b` (172.31.48.0/24, 172.31.49.0/24) มีอยู่ + route `0.0.0.0/0 → nat-06303bcc18968c82d` (NAT available)
- deploy.sh รองรับ `ECS_EXPRESS_SUBNET_MODE=private`: สร้าง service แยกชื่อ `-priv` + ARN param แยก (subnet type ของ ECS Express เปลี่ยนบน service เดิมไม่ได้) และรอ ingress `accessType=PRIVATE`
- ใน private mode script จะ **ไม่** flip shared params (`ai-gateway-internal-url` ฯลฯ) — flip มือหลัง verify เท่านั้น
- `deploy.sh api-web` และ `deploy.sh all` **refuse** เมื่อ `ECS_EXPRESS_SUBNET_MODE=private` (กัน push private subnet เข้า service api-web ที่ subnet type immutable) — ใน private mode ต้อง deploy `workers`/`ai-gateway` เป็น target เดี่ยวเท่านั้น

## คำเตือนสำคัญ (จาก review)

- **อย่าใส่ `ECS_EXPRESS_SUBNET_MODE=private` ใน `.env`** — deploy.sh `source .env` (set -a) จะทำให้ทุก deploy รวมถึง default `all` เป็น private แล้วโดน guard reject (หรือถ้าลบ guard จะ wedge api-web). ใช้ prefix ต่อคำสั่งเท่านั้น: `ECS_EXPRESS_SUBNET_MODE=private bash deploy.sh workers`
- **Mode เป็น ephemeral (env var ไม่ persist)**: หลัง cutover + retire public service เก่าแล้ว การรัน `deploy.sh ai-gateway`/`workers` แบบ default (public) จะ (ก) fail บน stale public ARN param ที่ชี้ service ที่ลบไปแล้ว หรือ (ข) resurrect public service + flip `ai-gateway-internal-url` กลับเป็น public. **หลัง retire ต้อง**: ลบ stale ARN params (`ecs-express-ai-gateway-service-arn`, `ecs-express-workers-service-arn`) และตั้ง private mode เป็น default ของ deploy environment (เช่น wrapper script/CI var) เพื่อไม่ให้ default deploy un-do cutover
- **`accessType=PRIVATE` enum ยังไม่ยืนยัน**: ECS Express อาจสะกดต่าง (เช่น `INTERNAL`/`VPC`). ถ้า deploy แรก wait loop ครบ 90×20s แล้ว fail — ดู ingressPaths ที่ script dump ออกมา (เพิ่มใน `wait_for_service_url`), แก้ `access_type` literal ใน deploy.sh ให้ตรง แล้ว rerun (service ถูกสร้าง + ARN param เก็บแล้ว rerun จะไป update path)

## ขั้นตอน (ทำ workers ก่อน — เสี่ยงต่ำสุด เพราะไม่มี inbound consumer จริง)

### Phase 1 — workers

1. `ECS_EXPRESS_SUBNET_MODE=private AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 bash infra/prod-ecs-express/deploy.sh workers`
   - ถ้า wait loop พิมพ์ ingressPaths ที่ accessType ไม่ใช่ `PRIVATE` (enum จริงอาจต่างจากที่คาด) — หยุด, จด value จริง, แก้ `access_type` ใน deploy.sh ให้ตรง แล้ว rerun
2. Verify: CloudWatch `/ecs/watchdog-bms-workers` มี job รันปกติ (repeat jobs ยิง API ผ่าน NAT → public api-web URL ได้ตามเดิม); BullMQ queues drain
3. Scale down + ลบ service public เดิม `watchdog-bms-workers` (deploy principal อาจไม่มีสิทธิ์ delete — ใช้ admin principal)
4. Reachability test: `curl https://<old-workers-public-endpoint>/health` ต้อง fail (NXDOMAIN/timeout) — เก็บ output เป็นหลักฐานปิดงาน

### Phase 2 — ai-gateway

1. `ECS_EXPRESS_SUBNET_MODE=private ... bash infra/prod-ecs-express/deploy.sh ai-gateway` → ได้ `ecs-express-ai-gateway-priv-url`
2. **ก่อน flip**: verify ว่า api-web tasks (public subnets, APP_SG) เข้าถึง private endpoint ได้ — private ingress ของ ECS Express เป็น internal ALB ใน VPC เดียวกัน; ตรวจ SG ของ ALB อนุญาต ingress จาก APP_SG/VPC CIDR; ทดสอบด้วย one-off ECS task (public subnet + APP_SG) รัน `curl <priv-url>/v1/health` คาด 200
3. Flip: `aws ssm put-parameter --name /watchdog-bms/production/ai-gateway-internal-url --value "<priv-url>/v1" --overwrite` แล้ว deploy api-web ใหม่ (`bash deploy.sh api-web`) เพื่อให้ env `AI_GATEWAY_INTERNAL_URL` ชี้ private
   - **ห้าม probe ระหว่าง canary bake** (RollbackAlarm บน ALB 4xx%) — monitor ผ่าน ECS API แล้วค่อย verify ด้วย request เดียว
4. Smoke: LINE AI flow ตอบปกติ (employee OA ถาม stock/summary); ถ้าพัง → rollback = put-parameter กลับเป็น public URL เดิม + redeploy api-web (service public เดิมยังรันอยู่จนกว่าจะ retire)
5. Retire service public เดิม `watchdog-bms-ai-gateway-v2` + reachability test old URL ต้อง fail — เก็บหลักฐาน

### Phase 3 — rotate static secrets (หลัง network cutover สำเร็จ)

ลำดับสำคัญ: secret ถูก inject ตอน task start → rotate แล้วต้อง redeploy ผู้ใช้ secret ทันที (มี mismatch window สั้น ๆ; jobs retry ได้)

1. `WORKER_INTERNAL_TOKEN`: `aws secretsmanager put-secret-value --secret-id watchdog-bms/production/worker-internal-token --secret-string "$(openssl rand -hex 32)"` → redeploy `api-web` + `workers` (คู่กัน)
2. `AI_GATEWAY_INTERNAL_SECRET`: เช่นเดียวกัน → redeploy `api-web` + `ai-gateway` (+ AgentCore env ถ้ายังอ้าง secret ตรง — ดู H-15)
3. บันทึก rotated credential inventory ลง checklist H-14

### Phase 4 (follow-up, ไม่ block H-14) — egress allowlist

- APP_SG / AI SG ยัง egress `0.0.0.0/0`; ตัดให้เหลือปลายทางจริง (LINE API, Bedrock/AgentCore, S3, Secrets Manager, ECR, CloudWatch, Typhoon OCR) ผ่าน VPC endpoints + prefix lists — ต้องทำ inventory ปลายทางก่อน มิฉะนั้น brick OCR/LINE
- มี cost NAT + VPC endpoints — ตัดสินใจร่วมกับ owner

## หลักฐานปิดงาน H-14 (live closure)

- [ ] `curl` old public endpoints ของ workers + ai-gateway → fail (เก็บ output + timestamp)
- [ ] `describe-express-gateway-service` ของ services ใหม่แสดง ingress `PRIVATE` + private subnets
- [ ] Negative tests: `/v1/internal/*` ด้วย token ผิด → 401; company ปลอม → 404 (มี unit coverage แล้ว; ยิงซ้ำบน prod หลัง deploy)
- [ ] Rotated credential inventory (worker token + AI secret + วันที่)
