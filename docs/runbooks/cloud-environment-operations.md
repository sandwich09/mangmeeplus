# Cloud Environment Operations — start, stop, inspect, and what it costs

สร้าง 2026-08-07; ตรวจ live ล่าสุด 2026-08-15 | ทุกตัวเลขและสถานะในเอกสารนี้ **อ่านจาก AWS จริง** ไม่ได้อ่านจากโค้ด
บริบทเต็มของเหตุการณ์ที่ทำให้เกิดเอกสารนี้: `docs/agent-memory/aws-cost-spike-2026-08.md`

เอกสารนี้มีไว้ให้ agent ตัวถัดไป **ไม่ต้องไล่โค้ดซ้ำ** เพื่อตอบคำถามว่า "ตอนนี้อะไรรันอยู่ ปิดยังไง
เปิดยังไง ดูตรงไหน และอะไรที่หลอกตา" ถ้าตัวเลขในเอกสารขัดกับ AWS ให้เชื่อ AWS แล้วมาแก้เอกสาร

Account `311414082667`, region `ap-southeast-1` ทั้งหมด — ไม่มี resource ในภูมิภาคอื่นเลย (สแกนแล้ว 7 region)

---

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
ECS_EXPRESS_MIN_TASKS=0 ECS_EXPRESS_MAX_TASKS=0 DEPLOY_ENV=uat \
  bash infra/prod-ecs-express/deploy.sh all
```

default คือ `1`/`2` และ **production ปฏิเสธค่าอื่นทันที** เพราะ
`infra/security/collect-production-a5-current-health.sh` เทียบ service จริงกับ literal
`{minTaskCount:1,maxTaskCount:2,AVERAGE_CPU,70}` ตอนเก็บ signed evidence

ถ้าจำเป็นต้องทำตรง ๆ กับ API ให้ round-trip ตามข้อ 2 อย่าพิมพ์ payload เอง

**ไทม์ไลน์หลังสั่งปิด** (วัดจริง): task drain หมดใน ~4 นาที แล้ว ENI กับ public IPv4 ถูกคืนอีก
~6 นาทีหลังจากนั้น service ยังคงเป็น `ACTIVE` พร้อม image และ config เดิม — เปิดกลับคือการปรับ
capacity ไม่ใช่ deploy ใหม่

### UAT — เปิดกลับ

รันคำสั่งเดิมโดยไม่ใส่ตัวแปร (ได้ 1/2) หรือใส่ค่าที่ต้องการ
**`run-a5-capacity-mutating.sh` ต้องการ `minTaskCount >= 1`** ต้องเปิดก่อนรัน U5 capacity

### Production

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
`198e9125-6a84-5124-866b-f3dc35bfe21e`; this proves topic acceptance, while mailbox delivery still
requires owner confirmation.

Alarm Redis เดิม `watchdog-bms-prod-redis-memory-high` ที่ใช้ `ReplicationGroupId` ยังอยู่และยัง
ไม่มี datapoint; ห้ามลบด้วย workstation ปัจจุบันเพราะยังไม่มีหลักฐาน `DeleteAlarms` allow.
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
state reason ระบุชัดว่า missing 2 จุดถูกนับเป็น non-breaching. ต้องสร้าง per-node alarms ให้เห็น datapoint
จริงก่อน retire ตัวเดิม ตาม remediation plan Phase 3

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

Cost Explorer group by cost-allocation tag `Environment` ยังรวมยอดทั้งหมดไว้ในช่องไม่มีค่า tag
จึงยังตอบไม่ได้จาก billing ว่า UAT/Production/shared ใช้เท่าไรย้อนหลัง. Current IAM อ่าน
cost-allocation/resource tags และ Cost Anomaly Detection ไม่ได้; ให้ platform admin ทำ read-back/
activation แทนการขยาย workstation IAM

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
