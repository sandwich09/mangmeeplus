# UAT / Production Runtime Configuration Remediation Plan

Status: **PARTIAL LIVE — Production alarms installed/verified; UAT Redis and alarms await exact non-root authority**

Evidence cut-off: 2026-08-15, account `311414082667`, region `ap-southeast-1`

Companion memory: `docs/agent-memory/uat-production-runtime-config-remediation.md`

## Goal

ปิดเฉพาะช่องว่างที่พิสูจน์ได้จริงเกี่ยวกับ Redis/memory, cache, logs, audit retention,
database observability และ cost controls ของ UAT/Production โดยไม่สร้าง feature หรือ config
ที่ยังไม่มีผู้ใช้จริง และไม่เปลี่ยน Production ออกจาก `maintenance_only` โดยอัตโนมัติ

## Evidence rules

สถานะในแผนนี้ใช้หลักฐานตามลำดับต่อไปนี้:

1. AWS live read-back หรือ aggregate query แบบ read-only
2. CloudTrail สำหรับเหตุการณ์สร้าง/แก้ resource
3. signed release/readiness artifact ที่ผูกกับ source SHA
4. code/config/test ใน repository
5. เอกสารเดิมใช้เป็นบริบทเท่านั้นเมื่อขัดกับข้อ 1–4

ไม่อ่านหรือบันทึก secret value, token, raw audit metadata หรือข้อมูลลูกค้า การ query UAT DB ใช้
`BEGIN TRANSACTION READ ONLY` และคืนเฉพาะ count/time range/relation size

## Proven current state

| Area | หลักฐานจริง | Verdict |
| --- | --- | --- |
| Production Redis | CloudTrail `CreateReplicationGroup` 2026-08-08: Redis 7.1, 2 nodes, Multi-AZ/failover, encryption at rest/in transit, auth, snapshot 35 วัน; successful readiness run `31789220329` ยืนยันค่าเดียวกันและผูก source `748f1fa…`; live nodes `available` | **CLOSED เฉพาะ topology/hardening — M-17 รวมยังเปิดเรื่อง restore/rotation** |
| UAT Redis confidentiality | live `watchdog-bms-uat-redis`: standalone 1 node, `AtRest=false`, `Transit=false`, `Auth=false`; secret ใช้ scheme `redis://` | **OPEN P0** |
| Redis memory | 2026-08-15: UAT ~18.3 MB / 4.54%, Prod node 1 ~17.3 MB / 4.30%, node 2 ~17.1 MB / 4.24%; eviction ทุก node = 0; parameter-group change ใน CloudTrail ตั้ง `maxmemory-policy=noeviction` สำเร็จ | **HEALTHY NOW**, แต่ Production alarm ใช้ dimension ผิด |
| BullMQ retention | ทุก queue ผ่าน `apps/workers/src/common/queue.ts`: completed 48, failed 100, DLQ 500; worker fatal logging ถูกจำกัดขนาดแล้ว | **CLOSED IN CODE** |
| CloudWatch retention | UAT app/release 3 วัน; Production app/support 14 วัน; Production app groups ใช้ KMS | **CLOSED** |
| Log-ingest guard | Production มี alarm `IncomingBytes` 3 กลุ่มที่ 512 MiB/ชั่วโมงและส่ง SNS; UAT ไม่มี (`describe-alarms` ได้ `[]`) | **OPEN P0 — UAT only** |
| Redis memory alarm | `watchdog-bms-prod-redis-memory-high` เป็น `OK` เพราะ missing data ถูกนับ non-breaching; query 24 ชั่วโมงด้วย `ReplicationGroupId` ได้ 0 datapoints ขณะที่ metric จริงออกด้วย `CacheClusterId`/`CacheNodeId` | **OPEN P0 — alarm เดิมไม่ทำงาน** |
| Historical log spike | `/ecs/watchdog-bms-uat-workers` รับ 280.4 GB ระหว่าง 1–14 ส.ค.; 214.1 GB วันที่ 6 ส.ค. แต่ 24 ชั่วโมงล่าสุดเหลือ ~3.0 MB | **INCIDENT STOPPED**; control gap ยังเปิด |
| RDS capacity alarms | ทั้ง UAT/Prod เหลือ storage ~18.25 GB; free memory UAT ~151 MB, Prod ~758 MB; ไม่มี `FreeStorageSpace`/`FreeableMemory` alarm ทั้งคู่ | **OPEN P1** |
| RDS diagnostics | Production/UAT ไม่มี Performance Insights, enhanced monitoring, log exports หรือ storage autoscaling | **OPEN P2**, ไม่ใช่ capacity incident ปัจจุบัน |
| Database audit | `AuditLog` เป็น PostgreSQL table แบบถาวร; UAT มี 3,899 rows, 3.43 MB รวม index, ช่วง 2026-07-21 ถึง 2026-08-14; ไม่พบ production purge path | **OPEN P1 — policy/enforcement gap, ไม่ใช่พื้นที่ใกล้เต็ม** |
| Audit retention config | broad spec เคยระบุ `AUDIT_RETENTION_DAYS=2555` แต่ active config/deploy ไม่มีค่านี้; repository remediation ลบคำอ้างที่ไม่ enforce แล้ว ขณะที่ retention register `RET-10` ยัง `[DECIDE]/[TEST]` | **OPEN — ต้องตัดสินใจด้านกฎหมายก่อนลบ** |
| Permission cache | `PERMISSION_CACHE_TTL_SECONDS=60` อยู่ใน config/example/compose แต่ service มีเพียง TODO และ query DB ทุกครั้ง | **CONFIG DRIFT — ไม่มี cache จริง** |
| Other generic cache config | `CACHE_TTL_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`, `RATE_LIMIT_REDIS_PREFIX`, `QUEUE_REDIS_PREFIX` มีเฉพาะ broad spec; runtime ใช้ TTL/prefix เฉพาะ use case ใน code | **SPEC DRIFT** |
| Cost budget | มี `WatchDog-BMS Monthly Cost Budget` $100, actual 85/100% และ forecast 100% พร้อม email subscriber อย่างละ 1; actual เดือน ส.ค. ถึงวันที่ 14 = $387.397, forecast = $787.792 | **ACTIVE BUT MIS-CALIBRATED** |
| Cost anomaly detection | IAM ปัจจุบันอ่าน `ce:GetAnomalyMonitors` ไม่ได้; CloudTrail ไม่พบ create event ในช่วงที่ค้น | **UNKNOWN — ห้ามสรุปว่าไม่มี** |
| Cost allocation | Cost Explorer group by `Environment` รวมค่าใช้จ่ายทั้งหมด $387.397 ไว้ในช่องไม่มีค่า tag; current IAM อ่าน resource/cost-allocation tags ไม่ได้ | **OPEN P1** |
| ECR lifecycle | runtime repos API/AI/workers/web เก็บ 20 images; `watchdog-bms-migration-tool` ไม่มี policy | **OPEN P2** |
| Environment isolation | RDS, Redis, S3 bucket, Secrets Manager/SSM paths แยก UAT/Prod; ALB, VPC/endpoints, ECR repos และ bastion ใช้ร่วมกัน | **INTENTIONAL**, ต้อง tag shared ให้ชัด |
| Production serving mode | ทั้ง 3 services รันที่ capacity 1/2 แต่เป็น `maintenance_only`; queue และ LINE ledger ปิด | **INTENTIONAL — ไม่ใช่ remediation item** |

## Root causes

1. UAT Redis ถูกสร้างก่อน bootstrap รองรับ encrypted replication group และ encryption เปิดย้อนหลังไม่ได้
2. วิธี migration เดิมลบ node/secret ก่อนสร้างตัวใหม่ ทำให้ rollback ยากและเปลี่ยน secret ARN โดยไม่จำเป็น
3. Production alarms ถูกเพิ่มหลังเหตุการณ์ แต่ UAT ไม่มี control แบบเดียวกัน จึงตรวจ cost spike ช้า
4. broad environment spec เก็บค่า “อนาคต” ไว้เป็น required แม้ runtime ไม่ได้ใช้ ทำให้ config ดูพร้อมเกินจริง
5. Audit retention เป็นข้อกำหนดด้านข้อมูล/กฎหมาย แต่ถูกเขียนเหมือนเป็น env default โดยยังไม่มี trigger,
   legal hold, end action หรือ deletion test
6. Resource creation หลายยุคไม่ได้ tag ตั้งแต่ต้น จึงแยกค่าใช้จ่าย UAT/Production/shared ย้อนหลังไม่ได้

## Remediation sequence

### Phase 1 — Correct source of truth (no cloud mutation)

- [x] อัปเดต cloud runbook ให้ Production Redis, ECR lifecycle, alarms, RDS class และ cost evidence ตรงกับ live
- [x] ทำเครื่องหมาย procedure ลบ UAT Redis/secret เดิมว่า superseded; ห้ามใช้ก่อน blue/green tooling พร้อม
- [x] บันทึก Production Redis topology/hardening evidence โดยอ้าง readiness run/hash และ CloudTrail;
      ห้ามปิด M-17 รวมจน restore/re-erasure/secret rotation ผ่าน

Exit: เอกสารไม่มีคำสั่งที่ทำให้ลบ secret ARN หรือ data store ก่อนมี rollback target

### Phase 2 — Replace UAT Redis with encrypted blue/green node (P0)

Repository change first:

- [x] เปลี่ยน bootstrap ให้รองรับ canonical encrypted group ใหม่ `watchdog-bms-uat-redis-v2`
      โดยไม่ชน standalone id เดิม
- [x] เพิ่ม prepare/cutover/rollback helper ที่ใช้ secret version ของ secret เดิม
      `watchdog-bms/uat/redis-url`; **ห้าม delete/recreate secret** เพื่อรักษา ARN
- [x] ขยาย `redis-encryption.spec.sh` และเพิ่ม `redis-blue-green.spec.sh` ให้ตรวจ v2 id,
      `rediss://`, auth, encryption, `noeviction`, secret ARN preservation, rollback และ mutex race
- [x] เพิ่ม sanitized read-back verifier ที่ไม่พิมพ์ URL/auth token และ IAM policy ที่ไม่มี delete cache

AWS execution:

1. จอด UAT ที่ capacity `0/0` และยืนยันว่า task/connection ถูก drain แล้ว เพื่อกัน BullMQ split-brain
2. สร้าง encrypted single-node replication group v2 ใน subnet/SG/parameter group เดิม
3. read-back ให้ครบ: available, one node, at-rest/transit/auth true, parameter group `noeviction`
4. เก็บ current secret version id ไว้เป็น rollback pointer แล้วเพิ่มค่า `rediss://` เป็น version ใหม่ใน ARN เดิม
5. เปิด UAT `1/2`; ตรวจ service health, worker heartbeat, queue scan หนึ่งรอบ, API rate-limit path,
   Redis connections/memory/evictions และไม่มี TLS/auth error
6. soak อย่างน้อย 24 ชั่วโมงหรือหนึ่ง acceptance cycle
7. ลบ standalone node เดิมเมื่อ owner อนุมัติหลังผ่าน soak; ไม่ลบ secret

Rollback: จอด UAT, ย้าย `AWSCURRENT` กลับ secret version เดิม, เปิด UAT ให้เชื่อม standalone เดิม;
ห้ามลบ standalone จนกว่า exit criteria จะผ่าน

Exit:

- live read-back = encryption/auth true, `rediss://`, one node, `noeviction`
- 24-hour `DatabaseMemoryUsagePercentage` อยู่ต่ำกว่า 75%, eviction 0
- queue/rate-limit/LINE ledger smoke ผ่านตาม feature flags ของ UAT
- old node ถูกลบหลัง sign-off เท่านั้น

### Phase 3 — Add bounded alarms (P0/P1)

- [x] ทำ idempotent install/verify/retire script และ mock-AWS spec สำหรับทั้งสอง environment
- [x] เพิ่ม monitoring operator actions ที่จำเป็น: metric datapoint read, Redis node discovery และ
      alarm delete สำหรับ guarded retirement เท่านั้น
- [ ] UAT log-ingest alarm ต่อ app group 3 ตัว: `IncomingBytes`, `Sum`, 1 ชั่วโมง,
      threshold **64 MiB/hour**, missing data = not breaching
- [x] สร้าง Production Redis memory alarm แยก node โดยใช้ live `CacheClusterId` + `CacheNodeId=0001`
      ที่ 75%, 5 นาที, 2 periods; พิสูจน์ว่ามี datapoint ก่อน retire alarm `ReplicationGroupId` เดิม
- [ ] UAT Redis memory alarm ใช้ `CacheClusterId` + `CacheNodeId` ที่ 75%, 5 นาที, 2 periods หลัง v2 cutover
- [x] Production RDS `FreeStorageSpace` alarm ที่ 4 GB
- [ ] UAT RDS `FreeStorageSpace` alarm ที่ 4 GB
- [x] Production `FreeableMemory` alarm ที่ 200 MB
- [ ] UAT `FreeableMemory` ใช้ 64 MB ไม่ใช้ 200 MB เพราะ baseline จริง ~151 MB
- [x] Production alarms ใช้ SNS topic ที่มี confirmed subscriber เดิม; alarm names มี environment
      และข้อความไม่มี tenant data
- [ ] ยืนยัน SNS canary delivery ที่ mailbox ก่อนปิด Phase 3 รวม
- [ ] retire `watchdog-bms-prod-redis-memory-high` หลัง non-root operator ได้ exact
      `cloudwatch:DeleteAlarms`; workstation ปัจจุบันไม่มีหลักฐาน allow จึงไม่ลองลบเพื่อหา error

64 MiB/hour สูงกว่าค่า UAT ล่าสุดหลายเท่าแต่ต่ำพอจับเหตุการณ์ 214 GB/day ภายในชั่วโมงแรก
โดยไม่ต้องสร้าง synthetic log volume

Exit: `describe-alarms` เห็นทุก alarm, action count = 1, SNS canary delivery ได้รับการยืนยัน และ
`get-metric-statistics` คืนอย่างน้อยหนึ่ง datapoint ต่อ dimension. ห้ามใช้ state `OK` อย่างเดียว
เพราะ `treat-missing-data=notBreaching` ทำให้ alarm ที่ dimension ผิดดูเป็น `OK` ได้

Live evidence 2026-08-15 01:10 UTC+7: Production install และ verify ผ่านครบ 9 alarms, ทุก
dimension มี datapoint และ SNS subscription confirmed. Script SHA-256
`12a21225a68a133b953490a7fd66764031ff0190e14333b265006063bb126157`. Invalid alarm เดิมยังคงอยู่
จนกว่าจะมี exact delete authority; UAT install ยังไม่เริ่มเพราะ v2 node ยังไม่มีตามลำดับที่กำหนด

### Phase 4 — Decide and enforce audit lifecycle (P1, owner/legal gate)

ก่อน implementation เจ้าของร่วมกับ Privacy/Legal และ Accounting ต้องอนุมัติอย่างน้อย:

- trigger และ period แยก business/accounting approvals, security/access events และ AI usage/billing facts
- legal hold / dispute / investigation exception
- end action: delete, minimize, anonymize หรือ archive
- restored-backup replay และหลักฐานการทำลาย

หลัง decision:

- [ ] แก้ `RET-10` และรายการ `AiUsageEvent` ให้เป็น approved schedule
- [x] ลบ generic `AUDIT_RETENTION_DAYS=2555` ที่ไม่มี runtime ออกจาก active spec; ห้ามเพิ่มกลับจนมี
      approved category-specific policy และ enforcement จริง
- [ ] ทำ daily bounded purge/archive แบบ dry-run report ก่อน และ fail closed เมื่อ legal hold ไม่ชัด
- [ ] เพิ่ม index/query plan, batch limit, metrics และ tests: eligible, not-yet-eligible, held, tenant boundary,
      restored backup
- [ ] Production rollout เริ่มด้วย report-only; mutation เปิดหลัง owner ตรวจจำนวนและ sample แบบ redacted

ข้อมูลปัจจุบันยังไม่ใกล้ capacity limit จึงห้ามข้าม decision gate เพื่อรีบลบ

Exit: approved register + enforced config/policy + deletion/hold test + live report evidence ตรงกัน

### Phase 5 — Remove ghost cache configuration (P2)

- [x] ลบ `PERMISSION_CACHE_TTL_SECONDS` จาก active config, `.env.example` และ local compose
- [x] แก้ broad spec ให้ค่าที่ไม่มี runtime (`CACHE_TTL_SECONDS`, `IDEMPOTENCY_TTL_SECONDS`,
      generic Redis prefixes) เป็น future/non-required หรือเอาออก
- [x] คง rate-limit TTL, LINE ledger TTL และ queue retention ที่เป็น use-case-specific code ไว้
- [x] ไม่สร้าง permission cache จนกว่าจะมี latency/load evidence; direct DB resolution ลด stale-permission risk

Exit: `rg` ไม่พบ config ที่ประกาศว่า active แต่ไม่มี consumer; config tests และ access-control tests ผ่าน

### Phase 6 — Make cost controls actionable (P1/P2)

- [ ] Platform admin tag existing and newly created resources ด้วย `Environment=uat|production|shared`,
      `Component=<name>`, `ManagedBy=mangmeeplus-infra`
- [ ] ALB, VPC endpoints, ECR repos และ bastion ใช้ `Environment=shared`; ห้ามโยน shared cost ให้ Prod เงียบ ๆ
- [ ] Activate `Environment` และ `Component` เป็น cost-allocation tags ใน Billing
- [ ] รอ billing propagation แล้ว verify Cost Explorer ไม่มีค่าใหม่ไหลเข้า blank tag bucket
- [ ] ปรับ budget เดิม ไม่สร้างชื่อซ้ำ: baseline แนะนำ $350/month, actual 80%/100%, forecast 100%; owner
      ปรับตัวเลขอีกครั้งหลังมี 30 วันซึ่งไม่มี incident spike
- [ ] ให้ platform admin ตรวจ Cost Anomaly Detection; ถ้ายังไม่มี ให้สร้าง AWS-services monitor และ
      daily subscription threshold $10
- [ ] ใส่ ECR lifecycle keep-last-20 ให้ `watchdog-bms-migration-tool` เท่ากับ runtime repos
- [ ] จอด UAT หลัง acceptance ทุกครั้ง; ห้ามทำเป็น cron จน workflow รู้ owner/test state

หมายเหตุ: tag ไม่ย้อนค่าใช้จ่ายเก่า เดือนสิงหาคมช่วงก่อน activate จะยังแยกไม่ได้

Exit: budget subscriber confirmed, anomaly state proven, ECR policy read-back ผ่าน และ Cost Explorer
แสดง UAT/Production/shared สำหรับค่าใช้จ่ายใหม่หลัง propagation

### Phase 7 — Final evidence and closure

- [x] รัน focused repository checks ของ repository implementation แต่ละ phase
- [x] เก็บ sanitized pre-mutation AWS read-back พร้อม timestamp/account/region และ command contract
- [x] อัปเดต runbook, retention register, remediation checklist และ companion memory
- [ ] ไม่ mark item complete จาก workflow conclusion อย่างเดียว; ต้องมี live read-back หรือ signed artifact

## Recommended execution order

1. Phase 1 documentation safety
2. Phase 2 UAT Redis blue/green
3. Phase 3 alarms ก่อนเปิด acceptance รอบยาว
4. Phase 6 tags/budget/anomaly เพราะต้องรอ billing propagation
5. Phase 5 config cleanup
6. Phase 4 audit lifecycle หลัง owner/legal decision
7. Phase 7 closure bundle

## Explicit non-actions

- ไม่ rebuild หรือ resize Production Redis ซึ่งผ่าน topology/hardening checks ของ M-17 แล้ว
- ไม่เปิด Production จาก `maintenance_only`
- ไม่เพิ่ม broad IAM ให้ workstation เพื่ออ่าน Production; ใช้ dedicated readiness/support path
- ไม่ query Production DB ด้วย writer secret เพื่อทำรายงานนี้
- ไม่ลบ audit rows ก่อน policy/legal-hold decision
- ไม่สร้าง permission cache เพียงเพราะมี TTL env อยู่
