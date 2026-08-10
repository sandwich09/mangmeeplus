# Cloud Environment Operations — start, stop, inspect, and what it costs

สร้าง 2026-08-07; ตรวจ live เพิ่ม 2026-08-10 | ทุกตัวเลขและสถานะในเอกสารนี้ **อ่านจาก AWS จริง** ไม่ได้อ่านจากโค้ด
บริบทเต็มของเหตุการณ์ที่ทำให้เกิดเอกสารนี้: `docs/agent-memory/aws-cost-spike-2026-08.md`

เอกสารนี้มีไว้ให้ agent ตัวถัดไป **ไม่ต้องไล่โค้ดซ้ำ** เพื่อตอบคำถามว่า "ตอนนี้อะไรรันอยู่ ปิดยังไง
เปิดยังไง ดูตรงไหน และอะไรที่หลอกตา" ถ้าตัวเลขในเอกสารขัดกับ AWS ให้เชื่อ AWS แล้วมาแก้เอกสาร

Account `311414082667`, region `ap-southeast-1` ทั้งหมด — ไม่มี resource ในภูมิภาคอื่นเลย (สแกนแล้ว 7 region)

---

## 1. อะไรรันอยู่ (2026-08-07)

| Resource | ตัวตน | สถานะ |
| --- | --- | --- |
| ECS cluster | `watchdog-bms-prod`, `watchdog-bms-uat` | ทั้งคู่ ACTIVE |
| prod services | `watchdog-bms-api-web-pub`, `watchdog-bms-ai-gateway-v2`, `watchdog-bms-workers` | **ACTIVE, capacity 1/2 และมี task รันครบ 3 ตัว**; api-web/AI ใช้ `eb515b9…`, workers ใช้ `0bdbe50…` ณ 2026-08-10 |
| uat services | `watchdog-bms-uat-api-web` (2 vCPU/6 GB), `-ai-gateway` (1/2), `-workers` (0.5/1) | **จอดที่ 0/0** |
| RDS | `watchdog-bms-prod-db`, `watchdog-bms-uat-db` — `db.t4g.micro`, 20 GB | encrypted, `PubliclyAccessible: false` |
| ElastiCache | `watchdog-bms-uat-redis` — `cache.t4g.micro`, engine 7.1.0 | pg `watchdog-bms-uat-redis7`, **ไม่ได้เข้ารหัส** |
| ALB | `ecs-express-gateway-alb-ff8c07dd` | ใช้ร่วมกันทั้ง prod และ uat, 3 ENI/EIP |
| EC2 | `i-0f3b3881690dcf874` `watchdog-bms-ssm-bastion` `t3.nano` | เปิดค้าง มี public IP |
| ECR | `watchdog-bms-api` / `-ai-gateway` / `-workers` / `-web` | ไม่มี lifecycle policy สักตัว |
| AgentCore | runtime `watchdog_orchestrator` | READY |
| App Runner | 2 service legacy | PAUSED — pause หยุดคิดเงินจริง ($11.95 → $0) |

**ถูกลบไปเมื่อ 2026-08-07:** NAT gateway `nat-06303bcc18968c82d` และ ElastiCache `watchdog-bms-prod-redis`

Network: subnet public 3 อัน (main route table → IGW) และ private 2 อัน (`rtb-07f3ced2ad683cd23`) ซึ่งตอนนี้
เหลือ route `local` อย่างเดียวหลังลบ NAT — ในนั้นมีแค่ ENI ของ UAT RDS กับ UAT Redis ซึ่งไม่ออกอินเทอร์เน็ต
Fargate ทุกตัวรันใน **public subnet** ออกทาง IGW ไม่ใช่ NAT **ไม่มี VPC endpoint สักตัว**

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

### UAT — deploy

Deploy ทำผ่าน GitHub workflow เท่านั้น ไม่ใช่จากเครื่อง (`infra/prod-ecs-express/README.md`)
controller ต้องรันจาก `main` ส่วน `release_ref` เป็น SHA เต็มที่ reachable จาก `develop`

```sh
gh workflow run deploy-uat.yml --ref main \
  -f release_ref=<lowercase-40-char-sha> -f target=all -f run_m01_acceptance=false
```

ใช้เวลา ~30 นาที ตรวจผลด้วย **digest จริง** ไม่ใช่แค่สถานะ workflow:

```sh
aws ecs describe-tasks --cluster watchdog-bms-uat --tasks <arn> \
  --query 'tasks[0].[group,containers[0].image]' --output text
aws ecr describe-images --repository-name watchdog-bms-workers \
  --image-ids imageDigest=<digest> --query 'imageDetails[0].imageTags'
```

tag จะเป็น `git-<full-sha>` ต้องตรงกับ SHA ที่สั่ง deploy

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

ณ 2026-08-10 ทั้งสาม service มี capacity `1/2` และมี task รันครบ แต่เป็นคนละ source SHA เพราะ
ถูกเปิดด้วย single-service incident deploy หลายรอบ; App Runner legacy ทั้งคู่ยัง PAUSED

> **สถานะ Redis ต้องพิสูจน์ใหม่ก่อน full promotion:** เมื่อ 2026-08-07 secret
> `watchdog-bms/production/redis-url` ยังชี้ endpoint ที่ถูกลบ แต่ production tasks กลับมารันได้แล้ว
> ในวันที่ 2026-08-10. IAM user ฝั่ง workstation ไม่มี `elasticache:DescribeReplicationGroups` จึงห้าม
> สรุปว่า M-17 ปิดจากการเห็น task รัน; ให้ `production-security-preflight.yml` กับ dedicated role
> พิสูจน์ topology/encryption/auth/failover/snapshot retention ภายใน promotion ceremony
>
> production **ต้องเป็น replication group** ไม่ใช่ standalone node เพราะ
> `infra/security/verify-production-security-baseline.sh` อ่าน `describe-replication-groups` และ
> fail closed ถ้าไม่ครบ: `atRestEncryptionEnabled`, `transitEncryptionEnabled`, `authTokenEnabled`,
> `automaticFailover == "enabled"`, `nodeCount >= 2`, `snapshotRetentionDays >= 35`
> นี่คือ **M-17** ใน `docs/security-remediation-checklist-merged-2026-07-17.md` ซึ่งยังเปิดอยู่ที่
> ช่อง "Live closure" และกำหนดว่า "ก่อน production release ถัดไป" — ก้อนเดิมที่ลบไป
> (standalone, `SnapshotRetentionLimit: 0`) ไม่เคยผ่านเกณฑ์นี้ การสร้างคืนคือจังหวะปิด M-17

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

IAM user `watchdog-bedrock-dev` ที่ agent ใช้ **อ่าน IAM ของตัวเองไม่ได้** (`iam:List*` ไม่ได้ให้)
ถ้าโดน AccessDenied แล้วอยากรู้ว่า policy ไหนบล็อก ต้องใช้ Policy Simulator ใน Console

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

**อัตราเติมกลับ ~17 key/นาที** เมื่อ UAT รันอยู่ จากศูนย์ถึงระดับที่เคยทำให้เต็มใช้เวลาราว 11 วัน
ตอนนี้ UAT จอดที่ 0 นาฬิกาเรือนนี้จึงหยุดเดิน

**crash ถูกจำกัดขนาด log แล้ว** `fatalDetail()` ใน `apps/workers/src/common/log.ts` ตัดที่ 2,000 chars
และ `main.ts` ดักทั้ง `unhandledRejection` / `uncaughtException` ก่อน parse config — ถ้าไม่มีตัวนี้
Node จะ inspect error object ทั้งก้อนซึ่งมี Lua script ของ BullMQ แปะมาด้วย (~162 MB ต่อ crash)

---

## 6. ค่าใช้จ่าย

Steady state เดือนกรกฎาคม **~$220/เดือน** หลังจัดการทั้งหมดเหลือ **~$47/เดือน**

| ที่ทำ | ประหยัด/เดือน |
| --- | --- |
| จอด UAT ที่ศูนย์ (Fargate + public IP 3 ตัว) | ~$113 |
| ลบ NAT gateway ที่ไม่มีใครใช้ | $47.55 |
| ลบ production Redis | ~$13 |

ที่เหลือคือ RDS 2 ตัว (~$27), UAT Redis (~$13), ALB + EIP 3 ตัว (~$30), Secrets Manager 30 ตัว (~$7.78),
bastion (~$7.43), Bedrock (~$3.20), ECR (~$1.14)

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
6. **`ECS_EXPRESS_SUBNET_MODE` default เป็น `public`** และ `deploy.sh` ปฏิเสธ `private` สำหรับ api-web
   ตรง ๆ — ถ้าจะใช้ private mode หรือรัน A5 clone/audit **ต้องสร้าง NAT คืนก่อน**
   (`/watchdog-bms/production/a5-network/task-subnet-ids` ยังเป็น `ParameterNotFound` แปลว่า
   `bootstrap-production-a5-private-network.sh` ไม่เคยถูกรัน)
7. **UAT Redis ตัวที่รันอยู่ยังไม่ได้เข้ารหัส** ทั้ง at-rest, in-transit และไม่มี auth token — secret
   เก็บเป็น `redis://` ต่างจาก RDS ที่สร้างด้วย `--storage-encrypted` `bootstrap-data.sh` แก้แล้ว
   (สร้างเป็น single-node replication group ที่เข้ารหัสครบ เพราะ `create-cache-cluster` ไม่มี
   at-rest encryption ให้เลย) แต่ **node ที่มีอยู่ต้องถูกแทนที่** เปิดทีหลังไม่ได้ —
   ขั้นตอน migration อยู่ใน `infra/uat/README.md` จุดที่พลาดง่ายคือ `delete-secret` ต้องใส่
   `--force-delete-without-recovery` ไม่งั้นชื่อถูกจองอีก 7–30 วัน และ secret ใหม่ได้ ARN ใหม่
   ซึ่ง `deploy.sh` ฝังไว้ใน `valueFrom` จึงต้อง deploy ไม่ใช่แค่ปรับ capacity กลับ
8. **ไม่มี CloudWatch alarm บน `IncomingBytes`** ถ้ามีตั้งแต่แรก เหตุการณ์ 6 ส.ค. จะจบที่ $7 แทน $179

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
