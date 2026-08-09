# Production Go-Live + Support Access Plan

สร้าง 2026-08-08 | สถานะ **DRAFT — รออนุมัติเจ้าของระบบ**

เอกสารนี้ตอบสองคำถาม:

1. **จะขึ้น production ยังไง** — อะไรที่ยังบล็อกอยู่จริง ๆ และลำดับที่ปลอดภัย
2. **เจอ issue บน prod แล้วจะ support ยังไง** — query ได้, มี view user / execute user, และเส้นทาง
   emergency ที่ไม่ทำลาย evidence chain ที่มีอยู่

ทุกอย่างในหัวข้อ §1 อ่านจากเอกสารที่บันทึกสถานะ AWS จริงเมื่อ 2026-08-07
(`docs/runbooks/cloud-environment-operations.md`, `docs/agent-memory/production-u5-live-prerequisites.md`)
และจากโค้ดใน repo **ไม่ได้อ่านจาก AWS สดในวันที่เขียน** — session ที่เขียนไม่มี AWS credentials
ก่อนลงมือทำจริงต้อง re-verify ตาม §3 W0

---

## 0. TL;DR

- Production **ยังขึ้นไม่ได้วันนี้** ติด 3 hard blocker: Redis ถูกลบไปแล้วแต่ secret ยังชี้ที่เดิม,
  RDS ไม่ผ่าน M-17 baseline, และ `LOG_KMS_KEY_ID`/`SECURITY_ALERT_TOPIC_ARN` ยังไม่มี
  → `deploy.sh` fail ก่อน rollout
- ทางที่ **ยังไม่มีเลย** คือ support path: repo มี `watchdog_a5_prod_ro` แต่เป็น
  **fixed-query evidence tool ไม่ใช่ ad-hoc query** และ runbook ระบุช่องว่างนี้เองไว้แล้วที่ OPEN-4
- ข้อเสนอ: DB role แยกใหม่ 2 ตัว (`watchdog_support_ro` / `watchdog_support_rw`)
  เข้าผ่าน SSM interactive shell บน bastion (ได้ transcript ฟรี) **ห้าม reuse role ของ A5**
- ข้อควรระวังที่จะกัดจริงเรียงตามโอกาสเจอ: connection pool ระเบิดที่ `db.t4g.micro`,
  canary bake ถูก rollback เพราะ curl ของเราเอง, migration ล็อกตาราง, CloudWatch bill

---

## 1. สถานะจริง ณ 2026-08-07

| สิ่งที่ต้องมี | สถานะ | หลักฐาน |
| --- | --- | --- |
| ECS prod cluster + 3 service | ACTIVE แต่ **capacity 0 ทั้งหมด** — ไม่เคย deploy จริง | runbook §1 |
| Production RDS | `db.t4g.micro` 20 GB, encrypted, ไม่ public — แต่ **single-AZ, backup 7 วัน, deletion protection ปิด** | U5 prereq memory |
| Production Redis | **ถูกลบไปแล้ว 2026-08-07** secret `watchdog-bms/production/redis-url` ยังชี้ endpoint เดิม | runbook §1, §3 |
| ALB | `ecs-express-gateway-alb-ff8c07dd` — **ใช้ร่วมกับ UAT** | runbook §1 |
| Bastion | EC2 `i-0f3b3881690dcf874` `t3.nano` เปิดค้าง **มี public IP** | runbook §1 |
| NAT gateway | ลบไปแล้ว — private subnet เหลือ route `local` อย่างเดียว | runbook §1 |
| VPC endpoint | **ไม่มีสักตัว** | runbook §1 |
| SNS topic สำหรับ alert | **ไม่มี** ใน ap-southeast-1 | U5 prereq memory |
| Prod bootstrap script | **ไม่มี** มีแต่ของ UAT (`infra/uat/bootstrap-data.sh`) | runbook §3 |
| Prod A5 private network | `bootstrap-production-a5-private-network.sh` **ไม่เคยถูกรัน** (SSM param เป็น `ParameterNotFound`) | runbook §7 ข้อ 6 |
| Migration | 122 migrations ใน `apps/api/prisma/migrations/` — prod DB ยังว่าง | นับจาก repo |

**สรุป:** นี่คือ first-ever production launch ไม่ใช่ upgrade ข้อดีคือไม่มีข้อมูลลูกค้าให้ทำพัง
ข้อเสียคือทุกอย่างที่ไม่เคยรันจริงจะรันครั้งแรกพร้อมกัน

---

## 2. Blockers

### 2.1 Hard blockers — deploy จะ fail หรือ container ขึ้นไม่ได้

| # | Blocker | ทำไมถึงบล็อก | ต้องทำ |
| --- | --- | --- | --- |
| B1 | Redis secret ชี้ endpoint ที่ถูกลบ | `deploy.sh` ฉีดค่านี้เข้า api-web และ workers → container ขึ้นมาแล้วต่อไม่ติด | สร้าง Redis **ก้อนว่าง** ใหม่ (ห้าม restore snapshot ก้อนเดิมที่เต็ม) แล้วอัปเดต secret |
| B2 | Redis ต้องเป็น replication group ไม่ใช่ standalone | `verify-production-security-baseline.sh` อ่าน `describe-replication-groups` และ fail closed | ต้องครบ: `atRestEncryptionEnabled`, `transitEncryptionEnabled`, `authTokenEnabled`, `automaticFailover=enabled`, `nodeCount>=2`, `snapshotRetentionDays>=35` |
| B3 | `LOG_KMS_KEY_ID` + `SECURITY_ALERT_TOPIC_ARN` ไม่มี | production deploy **fail ก่อน rollout** ถ้าไม่ตั้ง (`p1-production-security-operations.md` §M-16) | สร้าง KMS key + SNS topic ที่มี **human subscriber จริง** |
| B4 | RDS ไม่ผ่าน M-17 | verifier ต้องการ Multi-AZ + deletion protection + backup 35 วัน | `modify-db-instance` — Multi-AZ เปลี่ยนได้แบบ online แต่มี failover window |
| B5 | ไม่มี prod bootstrap script | ทุกอย่างจะทำมือแล้วไม่มีใครทำซ้ำได้ | เขียน `infra/production/bootstrap-data.sh` โดย fork จาก UAT — **นี่คือ deliverable ไม่ใช่ขั้นตอน** |

### 2.2 Security baseline gates (fail-closed — verifier ปฏิเสธเองไม่ต้องรอคน)

จาก `infra/security/verify-production-security-baseline.sh`:

- **Redis**: 6 field ตามข้อ B2
- **RDS**: `StorageEncrypted`, `MultiAZ`, `DeletionProtection`, `BackupRetentionPeriod`
- **Log group production ทุกตัว**: `retentionInDays` 14, `kmsKeyArn` ต้องเป็น customer key, ต้องมี metric filter,
  ต้องมี alarm ที่ route ไป SNS
- **M-16 closure ไม่นับ** ถ้าปลายทาง alert ไม่มีเจ้าของที่เป็นคนจริง หรือไม่ได้เห็นการส่งถึงจริง

### 2.3 Checklist items ที่ยังเปิดอยู่และแตะ production

จาก `docs/security-remediation-checklist-merged-2026-07-17.md` ช่อง "Live closure" ที่ยังไม่ติ๊ก:
**H-14** (private ingress cutover), **M-01** (actor delegation), **M-16** (alert chain),
**M-17** (RDS/Redis + restore drill), **M-18** (supply chain) และอีกหลายรายการ

ต้องตัดสินใจอย่างชัดเจนว่ารายการไหน **บล็อก launch** และรายการไหน **ตามหลัง launch ได้**
อย่าปล่อยให้คลุมเครือ — ตอน incident จะไม่มีใครรู้ว่าอะไรคือ baseline

### 2.4 ช่องว่างที่ repo ระบุเอง (ไม่ใช่ผมคิดขึ้นเอง)

`docs/runbooks/feature-launch-control.md` §7:

| Id | ช่องว่าง | ผลต่อ support |
| --- | --- | --- |
| OPEN-1 | ไม่มี platform-admin identity มีแต่ company-scoped RBAC | on-call ไม่มีตัวตนในระบบ |
| **OPEN-4** | **ไม่มี "normal scoped support path"** ที่ให้ on-call หาว่า tenant ไหนคือแถวที่ค้าง | นี่คือสิ่งที่ §4 แก้ |
| OPEN-8 | health view ไม่มี transport/authn | support เข้าไม่ถึงแม้จะสร้างแล้ว |
| OPEN-10 | launch alert ยังไม่รู้จะ route ไป rotation ไหน | page ผิดคน |
| OPEN-11 | ไม่มีคนที่มีอำนาจกด Resume/Reissue | งานที่ค้างหลัง emergency close ไม่มีใครกู้ได้ |

---

## 3. แผน Go-Live

แต่ละ wave จบด้วยหลักฐานที่ตรวจได้ ไม่ใช่ "รู้สึกว่าโอเค" **ห้ามข้าม W0**

### W0 — Re-verify สถานะจริง (ครึ่งวัน)

ตัวเลขใน §1 อายุหลายวันแล้ว AWS เปลี่ยนได้ ยืนยันใหม่ก่อนทำอะไร:

```bash
aws ecs describe-express-gateway-service --service <prod-service-arn>
aws rds describe-db-instances --db-instance-identifier watchdog-bms-prod-db \
  --query 'DBInstances[0].{multiAZ:MultiAZ,backup:BackupRetentionPeriod,delProt:DeletionProtection}'
aws elasticache describe-replication-groups --region ap-southeast-1
aws secretsmanager list-secrets --query 'SecretList[?starts_with(Name,`watchdog-bms/production/`)].Name'
```

> `aws ecs describe-services` ใช้กับ Express Mode **ไม่ได้** มันคืน `desiredCount: 0` ให้ทุก service
> ไม่ว่าจริง ๆ จะรันอยู่หรือไม่ ใช้ `describe-express-gateway-service` เท่านั้น (runbook §2)

### W1 — Data plane (1–2 วัน)

1. เขียน `infra/production/bootstrap-data.sh` (fork จาก `infra/uat/bootstrap-data.sh` แต่เป็น
   two-node replication group + snapshot 35 วัน) — **commit ก่อนรัน**
2. สร้าง Redis ก้อนใหม่ อัปเดต secret
   - `delete-secret` ต้องใส่ `--force-delete-without-recovery` ไม่งั้นชื่อถูกจอง 7–30 วัน
   - secret ใหม่ได้ **ARN ใหม่** ซึ่ง `deploy.sh` ฝังไว้ใน `valueFrom` → ต้อง **deploy** ไม่ใช่แค่ปรับ capacity
3. `maxmemory-policy = noeviction` ผ่าน custom parameter group (`default.redis7` แก้ไม่ได้)
4. **RDS ตามมติ D1 + D3** — ทำเป็นคำสั่งเดียวเพื่อจ่าย maintenance window ครั้งเดียว
   ไม่ใช่สี่ครั้ง (`--apply-immediately` ใช้ได้เพราะยังไม่มี user):

   ```sh
   aws rds modify-db-instance --db-instance-identifier watchdog-bms-prod-db \
     --db-instance-class db.t4g.small \
     --storage-type gp3 \
     --multi-az \
     --backup-retention-period 35 \
     --deletion-protection \
     --enable-iam-database-authentication \
     --apply-immediately --region ap-southeast-1
   ```

   - `gp3` ที่ 20 GB ให้ **3,000 IOPS** แทน 100 ของ gp2 และ **ถูกกว่าราว 20%** — ทำก่อนอย่างอื่นได้เลย
   - `--enable-iam-database-authentication` จำเป็นสำหรับ support role ใน W3 (ดู §4.3)
   - ระหว่างเปลี่ยน instance class + เปิด Multi-AZ จะมี **downtime/failover จริง** — ทำตอนยังไม่มี user
   - ยืนยันหลังเสร็จ:
     ```sh
     aws rds describe-db-instances --db-instance-identifier watchdog-bms-prod-db \
       --query 'DBInstances[0].{class:DBInstanceClass,storage:StorageType,iops:Iops,multiAZ:MultiAZ,backup:BackupRetentionPeriod,delProt:DeletionProtection,iam:IAMDatabaseAuthenticationEnabled,status:DBInstanceStatus}'
     ```

5. **`connection_limit` ตามมติ D1** — `DATABASE_URL` มาจาก secret `watchdog-bms/production/database-url`
   ซึ่ง `deploy.sh` ฉีดเข้า **api-web และ workers** (ai-gateway ไม่ได้รับ ถูกต้องตามสถาปัตยกรรม)
   จึงเป็นการ **แก้ค่าใน secret อย่างเดียว ไม่ต้องแก้โค้ด**:

   ```
   postgresql://USER:PASS@HOST:5432/DB?schema=public&connection_limit=10
   ```

   งบ connection ที่จุดพีคด้วยค่านี้:

   | ผู้ใช้ | จำนวน |
   | --- | --- |
   | api-web 2 task × 10 | 20 |
   | workers 2 task × 10 | 20 |
   | release task (เฉพาะตอน deploy) | 10 |
   | A5 evidence (ตายตัวในโค้ด) | 8 |
   | support ro / rw | 4 / 2 |
   | RDS สำรองให้ `rds_superuser` | ~3 |
   | **รวม** | **~67** |

   ปลอดภัยทั้งบน `t4g.micro` (~112) และ `t4g.small` (~225) — เลือกค่าที่รอดแม้ upgrade ล่าช้า
   **ทบทวนใหม่ทุกครั้งที่เปลี่ยนจำนวน task หรือขนาดเครื่อง**

   > เหตุผลที่ต้องระบุค่าเอง: Prisma คำนวณ pool จาก `จำนวน CPU × 2 + 1` และ **บน Fargate มันอ่าน
   > CPU ของเครื่องแม่ ไม่ใช่ของ container** → pool จริงใหญ่กว่าที่คาดหลายเท่าและชนเพดานแบบ
   > error ที่ดูไม่เกี่ยวกัน

6. ต้อง **deploy ใหม่** หลังแก้ secret — ปรับ capacity อย่างเดียวไม่พอ เพราะ ECS อ่านค่า secret
   ตอนสร้าง task เท่านั้น

### W2 — Observability + alert chain (1 วัน)

1. KMS key สำหรับ log + SNS topic
2. Subscribe **คนจริงที่มีชื่อ** ไม่ใช่ alias/mailing list ที่ไม่มีใครอ่าน
3. ยิง synthetic high-risk event ให้เห็นครบ chain: log event → alarm transition → delivery →
   acknowledgement จาก on-call ที่ระบุชื่อ
4. เพิ่ม CloudWatch alarm บน **`IncomingBytes`** ทุก log group — runbook §7 ข้อ 8 ระบุว่าถ้ามีตั้งแต่แรก
   เหตุการณ์ 6 ส.ค. จะจบที่ $7 แทน $179
5. เพิ่ม ECR lifecycle policy (ยังไม่มีสักตัว)

### W3 — Support path (1–2 วัน) — ทำ **ก่อน** เปิดให้ user ใช้

รายละเอียดใน §4 ทั้งหมด สิ่งที่ต้องเสร็จ:
- DB role `watchdog_support_ro` + `watchdog_support_rw`
- Bastion เข้าถึง RDS ได้ + มี `psql`
- SSM session logging ไป S3 (KMS) + CloudWatch
- ซ้อมจริง 1 รอบบน UAT ก่อน แล้วซ้อมบน prod หลัง W4

> **อย่าเลื่อน wave นี้ไปหลัง launch** ถ้า launch แล้วเจอปัญหาแต่ยัง query ไม่ได้
> ทางออกเดียวที่เหลือคือ deploy ใหม่ ซึ่งกินหนึ่ง canary window เต็ม ๆ

### W4 — Dry-run บน production (1 วัน) — ยังไม่มี user

1. `Production Deploy` → `target=api-web` เท่านั้น จาก `main`
2. Release task รัน 122 migration ครั้งแรก — **จับเวลา** (ดู §5.2 R3)
3. ยืนยันด้วย digest จริง ไม่ใช่แค่สถานะ workflow:
   ```bash
   aws ecs describe-tasks --cluster watchdog-bms-prod --tasks <arn> \
     --query 'tasks[0].[group,containers[0].image]' --output text
   ```
4. `GET /v1/health` เท่านั้น **ห้าม curl route อื่นระหว่าง bake** (ดู §5.3 A1)
5. Restore drill ตาม `p1-production-security-operations.md` — restore ลง isolated subnet
   วัด RTO/RPO จริง แล้วทำลายทิ้ง

### W5 — Launch

1. `target=all` (api-web → ai-gateway + workers)
2. Feature launch gate: เปิดทีละแถวตาม R1/R2 ใน `feature-launch-control.md`
   **`cap.wht50bis/*` ทุกแถวยังต้อง CLOSED** จนกว่า specialist evidence จะครบ
3. เปิดให้ user จริงเป็นกลุ่มเล็กก่อน — ไม่ใช่เพราะ canary (canary ที่นี่หมายถึง build ไม่ใช่ cohort)
   แต่เพราะข้อจำกัด capacity ใน §5.2
4. เฝ้า 48 ชม.: RDS connections, RDS CPU credit balance, Redis memory, DLQ depth,
   CloudWatch `IncomingBytes`, ค่า ALB 5xx

### Rollback

| สถานการณ์ | ทำอะไร |
| --- | --- |
| Deploy ล้มระหว่าง bake | ECS rollback เองอัตโนมัติ — ยืนยันว่า `activeConfigurations` เหลือ image เดิมตัวเดียว |
| Code เสียหลัง bake ผ่าน | `Production Deploy` ด้วย release ก่อนหน้า **เลือก target เดียว** เพื่อจ่าย canary window ครั้งเดียว |
| Feature เดียวเสีย | Emergency CLOSE แถวนั้น (R3) — OC ทำคนเดียวได้ ไม่ต้องรอ approval ที่สอง |
| Migration เสีย | **Code rollback ไม่ใช่ data rollback** — ดู §5.2 R4 |

---

## 4. Support Access Design

### 4.1 หลักการ

1. **ไต่บันไดจากเบาไปหนัก** อย่าเปิด psql เป็นอย่างแรก
2. **ทุก tier ต้องมี transcript** ที่ระบุได้ว่าใครทำอะไรตอนไหนกับ incident ไหน — PDPA
   กำหนดให้ data controller มี access control และ record ของการเข้าถึงข้อมูลส่วนบุคคล
3. **ห้าม reuse `watchdog_a5_prod_ro`** — role นั้นผูกกับ fixed query catalog ที่มี
   `queryCatalogHash` ประกอบ signed evidence การเพิ่ม SELECT ให้มันจะทำให้ evidence chain
   ของ A5/U5 พังเงียบ ๆ และ `verify-production-security-baseline.sh` จะเริ่มโกหก
4. **DDL ไม่ผ่านช่องนี้** schema เปลี่ยนได้ทางเดียวคือ release task (ดู §5.2 R4)

### 4.2 บันได 3 ชั้น

| Tier | ใช้เมื่อ | เห็นอะไร | ใครทำได้ | เวลา |
| --- | --- | --- | --- | --- |
| **T0** — ไม่แตะ DB | ปัญหาแรกที่รายงานเข้ามาทุกครั้ง | CloudWatch Logs Insights, `/v1/health`, ECS deployment status, feature launch health view | on-call ทุกคน | ทันที |
| **T1** — VIEW | ต้องรู้ว่า data จริงเป็นยังไง | อ่านได้ทุกตาราง รวม PII | on-call ที่ได้รับมอบหมาย | ~2 นาที |
| **T2** — EXECUTE | ต้องแก้ data เพื่อกู้ระบบ | เขียนได้ แต่ไม่ใช่ทุกอย่าง | ต้องมีคนที่สอง arm ให้ | ~5 นาที |

**กฎ:** ห้ามข้าม T1 ไป T2 ถ้ายังตอบไม่ได้ว่าจะแก้แถวไหนเป็นค่าอะไร

### 4.3 Database roles

รันด้วย writer role ตอน bootstrap เก็บใน `infra/production/bootstrap-support-roles.sql`
(commit ก่อนรัน — เหมือน pattern ของ A5)

#### VIEW — `watchdog_support_ro`

```sql
CREATE ROLE watchdog_support_ro LOGIN CONNECTION LIMIT 4;

-- IAM auth: token อายุ 15 นาที ไม่มี password เก็บที่ไหนเลย และ CloudTrail บันทึก rds-db:connect
GRANT rds_iam TO watchdog_support_ro;

-- pg_read_all_data (PG14+) แทนการ GRANT SELECT ทีละตาราง
GRANT pg_read_all_data TO watchdog_support_ro;

ALTER ROLE watchdog_support_ro SET default_transaction_read_only = on;
ALTER ROLE watchdog_support_ro SET statement_timeout = '15s';
ALTER ROLE watchdog_support_ro SET lock_timeout = '2s';
ALTER ROLE watchdog_support_ro SET idle_in_transaction_session_timeout = '60s';
```

**ทำไม `pg_read_all_data` ไม่ใช่ `GRANT SELECT ON ALL TABLES`:** `ALTER DEFAULT PRIVILEGES`
ผูกกับ role ที่ *สร้าง* object ทุกครั้งที่ migration สร้างตารางใหม่ด้วย role ที่ไม่ได้ตั้ง default
ไว้ ตารางนั้นจะหายไปจาก support user เงียบ ๆ ระบบนี้มี 122 migration และจะมีอีกเรื่อย ๆ —
fixed list จะพังแน่นอน ไม่ใช่อาจจะ

**หมายเหตุ:** role นี้ต้อง `INHERIT` (ค่า default) ต่างจาก A5 ที่จงใจใช้ `NOINHERIT` เพราะ
`pg_read_all_data` เป็นสิทธิ์ที่ต้อง inherit ถึงจะทำงาน

#### EXECUTE — `watchdog_support_rw`

```sql
CREATE ROLE watchdog_support_rw NOLOGIN CONNECTION LIMIT 2;   -- ปิดไว้เป็น default
GRANT rds_iam TO watchdog_support_rw;
GRANT pg_read_all_data TO watchdog_support_rw;

GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO watchdog_support_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE <migration_owner> IN SCHEMA public
  GRANT INSERT, UPDATE, DELETE ON TABLES TO watchdog_support_rw;

-- สองตารางนี้ห้ามแตะเด็ดขาด
REVOKE ALL ON TABLE "_prisma_migrations" FROM watchdog_support_rw;
REVOKE UPDATE, DELETE ON TABLE "AuditLog" FROM watchdog_support_rw;

ALTER ROLE watchdog_support_rw SET statement_timeout = '30s';
ALTER ROLE watchdog_support_rw SET lock_timeout = '2s';
ALTER ROLE watchdog_support_rw SET idle_in_transaction_session_timeout = '60s';
```

สิ่งที่ role นี้ **ทำไม่ได้โดยตั้งใจ**: DDL, TRUNCATE, สร้าง/ลบ role, เป็นเจ้าของ object,
แก้ `_prisma_migrations` (แก้แล้วจะทำให้ `verify-applied-migration-catalog.ts` เพี้ยน),
ลบหรือแก้ `AuditLog` (append-only)

#### Arm / disarm

```sql
-- arm: ทำโดยคนที่สอง (PSO) พร้อม incident ref
ALTER ROLE watchdog_support_rw LOGIN;
-- disarm: บังคับทำภายใน 60 นาที
ALTER ROLE watchdog_support_rw NOLOGIN;
```

ตั้ง CloudWatch alarm บน RDS log ที่จับ `ALTER ROLE watchdog_support_rw LOGIN` ให้ยิงเข้า
`SECURITY_ALERT_TOPIC_ARN` ทันที — ถ้ามีการ arm โดยไม่มี incident ต้องมีคนรู้ภายในนาที
และตั้ง reminder disarm อัตโนมัติ (EventBridge → Lambda หรือ scheduled task) อย่าพึ่งความจำ

> `VALID UNTIL` **ใช้กับ role ที่ auth ด้วย IAM ไม่ได้** — มันบังคับอายุของ password เท่านั้น
> ถ้าอยากได้ hard expiry จริงต้องคุมที่ IAM policy (`rds-db:connect`) หรือ disarm ด้วย automation

### 4.4 เส้นทาง network

```
operator laptop ──AWS SSM──> bastion (private, ไม่มี inbound rule) ──5432──> RDS (private)
```

ต้องทำ:
1. **ถอด public IP ออกจาก bastion** — SSM ทำงานผ่าน outbound TLS ไม่ต้องมี inbound เลย
   แต่ถ้าอยู่ public subnet และไม่มี NAT มันต้องมี public IP เพื่อออกเน็ต → เลือกหนึ่ง:
   - **(ก) ถูกที่สุด:** เก็บ public IP ไว้ แต่ SG **ไม่มี inbound rule สักข้อ** + IMDSv2 บังคับ
   - **(ข) สะอาดที่สุด:** ย้ายเข้า private subnet + สร้าง VPC interface endpoint 3 ตัว
     (`ssm`, `ssmmessages`, `ec2messages`) ≈ $7.3/endpoint/AZ/เดือน → **~$44/เดือน**
     สำหรับ 3 endpoint × 2 AZ ซึ่งใกล้เคียงค่า NAT ที่เพิ่งลบไป ($47.55)
2. SG rule: RDS SG อนุญาต 5432 จาก **bastion SG** (ไม่ใช่ CIDR)
3. ติดตั้ง `postgresql` client บน bastion (t3.nano 0.5 GB พอสำหรับ psql)
4. **Bastion ควรดับไว้เป็น default** แล้ว `aws ec2 start-instances` ตอนต้องใช้ —
   ประหยัด ~$7/เดือน และลด attack surface แต่เพิ่ม ~60 วินาทีตอน incident **ให้เจ้าของเลือก**

### 4.5 Audit — จุดที่พลาดง่ายที่สุด

**SSM port-forwarding ไม่บันทึก traffic ที่วิ่งในอุโมงค์** มันบันทึกแค่ว่า session เริ่ม/จบเมื่อไหร่
ถ้าใช้ port-forward + psql/DBeaver บนเครื่องตัวเอง จะ **ไม่มี transcript ของ SQL เลย**

ดังนั้น:

| Lane | วิธี | ได้ transcript ไหม | ใช้กับ |
| --- | --- | --- | --- |
| **บังคับ** | `aws ssm start-session` แบบ interactive shell แล้วรัน `psql` **บน bastion** | ได้ครบทุก keystroke + output → S3 (KMS) + CloudWatch | T2 EXECUTE **เท่านั้นที่ยอมรับ** |
| **อนุญาตแบบมีเงื่อนไข** | port-forward + client บนเครื่องตัวเอง | **ไม่ได้** | T1 VIEW เท่านั้น และต้องพึ่ง pgaudit + `application_name` แทน |

เปิด SSM session logging (S3 + CloudWatch, KMS-encrypted) ก่อนใช้งานจริง

**บังคับ `application_name`** ทุก connection:
```
psql "host=... dbname=... user=watchdog_support_ro application_name=support:<INCIDENT>:<operator>"
```
แล้วใส่ `%a` เข้า `log_line_prefix` ใน parameter group เพื่อให้ทุกบรรทัด log ระบุ incident ได้

**pgaudit:** เปิดที่ระดับ parameter group ได้ แต่ **`pgaudit.log='write'` หรือ `'read'` จะ log
ทุก statement ของ application ด้วย** ซึ่งจะระเบิดค่า CloudWatch แน่นอน — ระบบนี้เพิ่งโดน $179
จาก log ingest มาแล้ว ให้ใช้ `pgaudit.log='ddl'` (volume ต่ำ) เป็น backstop และพึ่ง SSM
transcript เป็น audit trail หลัก

**PDPA:** transcript ของ T1/T2 **มี PII ของลูกค้าอยู่ข้างใน** ดังนั้น bucket ที่เก็บต้อง
KMS-encrypted, มี retention policy ชัดเจน, และจำกัดคนเข้าถึงเท่ากับหรือแคบกว่าคนที่เข้า DB ได้
ไม่งั้นเราแค่ย้ายปัญหาจาก DB ไป S3

### 4.6 บันไดเวลาเกิด emergency

```
0 นาที   T0: อ่าน log + health + deployment status
          └─ ตอบได้ → จบ

3 นาที   ถ้าเป็น feature เดียวพัง → Emergency CLOSE แถวนั้น (R3)
          OC ทำคนเดียวได้ ไม่ต้องรอใคร นี่คือทางที่เร็วและปลอดภัยที่สุดที่มีอยู่แล้ว

5 นาที   T1 VIEW: psql บน bastion อ่านอย่างเดียว
          └─ ระบุแถว/ค่าที่ต้องแก้ให้ได้ก่อน ห้ามเดา

10 นาที  T2 EXECUTE: คนที่สอง arm ให้ + incident ref
          BEGIN; <statement>; -- ตรวจ row count ก่อน COMMIT เสมอ

หลังจบ   disarm ภายใน 60 นาที + เขียน docs/agent-memory/<incident>.md
          + ทบทวนทุกครั้งที่ใช้ T2 ไม่มีข้อยกเว้น
```

**กฎเหล็กของ T2:**
- เขียน `BEGIN;` ก่อนเสมอ ตรวจ row count แล้วค่อย `COMMIT` — `lock_timeout=2s` ช่วยกัน
  การล็อกตารางค้าง แต่ไม่ช่วยกัน `UPDATE` ที่ลืม `WHERE`
- ห้ามแก้ผ่าน T2 ถ้าแก้ผ่าน API/UI ได้ — API มี permission check, ABAC, audit และ business rule
  ที่ SQL ตรง ๆ ข้ามหมด
- ทุก data fix ที่เกิดจาก bug **ต้องมี follow-up เป็น code fix** ไม่งั้นจะกลับมาอีก

---

## 5. ข้อควรระวังทั้งหมด

### 5.1 เฉพาะระบบนี้ (จาก repo + runbook)

| # | เรื่อง | รายละเอียด |
| --- | --- | --- |
| S1 | `describe-services` โกหก | Express Mode คืน `desiredCount:0`, `runningCount:0`, `taskDefinition:null` ให้ทุก service เสมอ เคยทำให้สรุปผิดว่า production ล่ม |
| S2 | `update-express-gateway-service` เป็น full replace | ต้องส่งครบ 9 key ทุกครั้ง ห้ามพิมพ์เอง — round-trip จาก `describe` เท่านั้น ไม่งั้น env/secret หายทั้งชุด |
| S3 | CI `success` ≠ เทสรัน | commit ที่แตะแต่ docs skip ทุก job รวม Typecheck and Test แล้วยังจบ success ต้องเปิดดู job |
| S4 | Production ปฏิเสธ capacity อื่นนอกจาก 1/2 | `collect-production-a5-current-health.sh` เทียบกับ literal `{minTaskCount:1,maxTaskCount:2,AVERAGE_CPU,70}` — จะ scale ต้องแก้ทั้งคู่ |
| S5 | ALB ใช้ร่วมกับ UAT | UAT ที่ misbehave กระทบ prod ได้ผ่าน LCU/connection — แยก ALB ถ้าเริ่มมี traffic จริง |
| S6 | Rate limit เป็น in-process ต่อ task | มี 2 task = limit จริง 2 เท่าของที่ตั้ง และ 429 **นับเข้า canary rollback alarm** ห้าม load test ระหว่าง bake |
| S7 | Queue สร้างได้ที่เดียว | `apps/workers/src/common/queue.ts` เท่านั้น — `queue.spec.ts` บังคับไว้ เพิ่มคิวใหม่แล้วเรียก `new Queue(` เองเทสจะแดง (เคยลืม retention จน Redis 400 MB มี 270k key) |
| S8 | `maxmemory-policy` ต้องเป็น `noeviction` | `volatile-lru` จะลบ rate-limit counter กับ actor-delegation replay store ทิ้งเงียบ ๆ ก่อนแล้วค่อย OOM อยู่ดี — ทิ้ง security state ก่อน job |
| S9 | Redis เติมกลับ ~17 key/นาที | จากศูนย์ถึงระดับที่เคยเต็มใช้เวลาราว 11 วัน ตั้ง alarm บน memory ก่อนถึงจุดนั้น |
| S10 | explicit Deny ชนะ Allow เสมอ | แนบ policy ใหม่ไม่ได้ลบ Deny เดิม ต้อง `create-policy-version --set-as-default` |
| S11 | ลบ NAT จาก Console ไม่ปลด EIP | EIP ค้างคิดเงิน $3.65/เดือน + route `0.0.0.0/0` เป็น blackhole ค้างใน route table |
| S12 | workflow ทุกตัวเป็น `workflow_dispatch` | ไม่มี cron ไม่มีอะไรสร้าง resource เองตามเวลา — ทั้งดีและแปลว่าไม่มี automated health check |
| S13 | Fargate อยู่ public subnet ทั้งหมด | ออกทาง IGW ไม่ใช่ NAT ถ้าจะใช้ private mode หรือรัน A5 clone/audit **ต้องสร้าง NAT คืนก่อน** |
| S14 | `CLAMAV_HOST` ไม่มี default โดยตั้งใจ | attachment scan fail closed (`CLAMAV_NOT_CONFIGURED`) placeholder จะทำให้ upload พังแบบดูเหมือนตั้งค่าแล้ว |
| S15 | `WORKFLOW_WEBHOOK_ALLOWED_HOSTS` ห้ามว่าง | production ปฏิเสธค่าว่าง ใช้ `none` ถ้าตั้งใจ deny-all — ค่าว่างแปลว่า "key หาย" |

### 5.2 Database และ migration

| # | เรื่อง | รายละเอียด |
| --- | --- | --- |
| **R1** | **`db.t4g.micro` คือความเสี่ยงอันดับหนึ่ง** | 1 GiB RAM → `max_connections ≈ 112` (`LEAST(DBInstanceClassMemory/9531392, 5000)`) และ 20 GB gp2 = **100 IOPS baseline** เป็น burstable ด้วย → CPU credit หมดแล้ว throttle ทั้งระบบ ควร upgrade เป็น `db.t4g.small`/`db.t4g.medium` **ก่อน** เปิดให้ user |
| **R2** | **ไม่มี `connection_limit` ใน `DATABASE_URL` เลย** | Prisma default = `num_physical_cpus * 2 + 1` และ **ใน Fargate มันอ่าน CPU ของ host ไม่ใช่ของ task** → pool ใหญ่กว่าที่คิดมาก งบ connection: api-web ×2 + ai-gateway + workers + release task + A5 (8) + support (4+2) จะชน 112 ง่ายมาก **ต้องตั้ง `?connection_limit=N` ให้ทุก service อย่างชัดเจน** และคำนวณให้เหลือ headroom |
| R3 | 122 migration รันครั้งแรกบน prod | จับเวลาบน clone ที่มี data shape เหมือนจริงก่อน อย่ารู้ตอน W5 ว่ามันใช้ 20 นาที |
| **R4** | **Migration rollback ≠ code rollback** | `prisma migrate deploy` ไม่มี down migration ถ้า migration ผ่านแล้ว code rollback จะเจอ schema ใหม่ + code เก่า **ทุก migration ที่ทำลาย compatibility ต้องแตกเป็น expand → deploy → contract** |
| R5 | `ALTER TABLE` ล็อก ACCESS EXCLUSIVE | เพิ่ม column แบบ `NOT NULL DEFAULT` บนตารางใหญ่จะบล็อกทั้ง read และ write เป็นนาที ใช้ `CREATE INDEX CONCURRENTLY` เสมอ |
| R6 | Prisma advisory lock timeout 10 วินาที **แก้ไม่ได้** | ถ้ามี migration สองตัวชนกันจะ fail ทันที — production deploy serialize อยู่แล้วจึงปลอดภัย แต่ **ห้ามรัน release task มือขนานกับ workflow** |
| R7 | Migration ที่ fail ค้าง `_prisma_migrations` | ต้อง `migrate resolve` แก้มือ **ห้ามลบแถวใน `_prisma_migrations` ตรง ๆ** — `verify-applied-migration-catalog.ts` จะจับได้และ deploy จะหยุด |
| R8 | Read replica ไม่ใช่คำตอบฟรี | long-running query บน replica บล็อก vacuum/cleanup บน primary ได้ และอาจโดน cancel เอง — ถ้าจะเพิ่ม replica ให้ support ต้องมาพร้อม `statement_timeout` ที่เข้มกว่าเดิม |
| R9 | Multi-AZ conversion มี failover | `modify-db-instance --multi-az` เป็น online แต่มีช่วง failover จริง ทำใน W1 ตอนยังไม่มี user |

### 5.3 AWS / ECS / deploy

| # | เรื่อง | รายละเอียด |
| --- | --- | --- |
| **A1** | **curl ของเราเองทำให้ deploy rollback** | canary 5% / bake 3 นาที มี alarm `(4xx เมื่อ >=5/min + 5xx)/total > 1%` บน service ที่ traffic ต่ำ smoke test ที่ได้ 401/404 กลับมาจะ trip alarm → rollback เงียบ ๆ **ระหว่าง bake ดูได้แค่ `list-service-deployments` กับ `GET /v1/health`** |
| A2 | `all` จ่าย canary window หลายรอบ | ตอน incident เลือก target เดียวเสมอ |
| A3 | script รอ ACTIVE+URL ไม่ตรวจ rollback | หลัง deploy ต้องยืนยันเองว่า image ใหม่เป็น entry เดียวใน `service.activeConfigurations` ก่อน smoke test |
| A4 | Subnet IP หมด | Fargate task กิน ENI ต่อ task ตรวจ IP ว่างก่อน scale |
| A5 | ECS Exec (`enableExecuteCommand`) ถูกปิดโดยตั้งใจ | `production-image-security.spec.sh` assert ว่าเป็น `false` **อย่าเสนอ shell เข้า container เป็นทาง support** — จะทำให้ security spec แดง |
| A6 | Deploy role แก้ IAM ไม่ได้โดยตั้งใจ | role/policy ทุกตัวต้องมีอยู่ก่อน การเปลี่ยน IAM เป็น infrastructure operation แยกต่างหาก |
| A7 | Cost Explorer คิด $0.01/request และ post ข้าม 24 ชม. | ยอดที่ query ตอนเช้าต่ำกว่าจริงมาก (เคยขยับ $173 → $263 ระหว่าง query สองครั้ง) |
| A8 | CloudWatch คิดจาก raw ingest แต่ `storedBytes` คือขนาดหลังบีบอัด (~20 เท่า) | **ห้ามประเมินค่า log จาก `describe-log-groups`** |
| A9 | Fargate platform version | ตรวจว่า service ไม่ได้ค้างที่ PV เก่า ก่อน AWS บังคับ migrate |

### 5.4 ค่าใช้จ่าย

Steady state ตอนนี้ ~$47/เดือน (UAT จอดที่ศูนย์) **หลัง production ขึ้นจริงจะเปลี่ยนไปมาก:**

| รายการ | ประมาณการ |
| --- | --- |
| Fargate prod 3 service ที่ min 1 | ~$60–110/เดือน |
| Redis two-node replication group (M-17 บังคับ) | ~$26+/เดือน (จากเดิม 0) |
| RDS Multi-AZ | **×2 จากเดิม** |
| RDS upgrade (ถ้าทำตาม R1) | +$15–40/เดือน |
| VPC endpoint (ถ้าเลือกทาง ข ใน §4.4) | ~$44/เดือน |
| CloudWatch log ingest | **ตัวแปรที่ใหญ่ที่สุด** — ต้องมี `IncomingBytes` alarm ตั้งแต่วันแรก |
| NAT (ถ้าต้องคืนมาเพื่อ private mode / A5) | $47.55/เดือน |

ตั้ง AWS Budget + anomaly alert **ก่อน** W5 ไม่ใช่หลังเจอบิล

### 5.5 จากประสบการณ์ทั่วไป (internet research)

| # | เรื่อง | ทำไมเกี่ยวกับเรา |
| --- | --- | --- |
| G1 | Break-glass ต้อง time-boxed + logged + review ทุกครั้ง | มาตรฐาน SOC2/ISO/PCI ตรงกันหมด: กำหนดล่วงหน้าว่าใครประกาศ emergency ได้, access หมดอายุเอง, review ทุกการใช้งานไม่มีข้อยกเว้น — §4.3 arm/disarm และ §4.6 ทำตามนี้ |
| G2 | Break-glass ที่ไม่เคยซ้อม = ไม่มี | ต้องซ้อมบน UAT ก่อน (W3) ไม่ใช่ค้นพบตอน 2 ทุ่มวันศุกร์ว่า bastion ไม่มี `psql` |
| G3 | `ALTER DEFAULT PRIVILEGES` ผูกกับ role ที่สร้าง object | นี่คือเหตุผลตรง ๆ ที่ §4.3 ใช้ `pg_read_all_data` |
| G4 | Connection pool exhaustion "ซ่อนตัวจนกว่า traffic จะพุ่ง" แล้วโผล่มาเป็น error ที่ดูไม่เกี่ยวกัน | ตรงกับ R1+R2 เป๊ะ — ระบบนี้มีทั้ง instance เล็กและ pool ที่ไม่ได้ตั้งค่า |
| G5 | DNS/TLS พังตอน 9 โมงเช้าคือ outage แบบ binary | ตรวจ cert chain ครบทุก listener + เจ้าของ renewal + custom domain (Cloudflare proxy ตาม `.env.example`) ก่อน W5 |
| G6 | Email/LINE deliverability พังเงียบ | SPF/DKIM ต้องย้ายตาม MX; LINE OA ต้องอยู่ provider เดียวกับ LIFF Login channel ไม่งั้น B9 identity join พัง (README ระบุไว้แล้ว) |
| G7 | ทดสอบ failure path ไม่ใช่แค่ happy path | invite หมดอายุ, สมัครแล้วไม่ verify, กรอกรหัสผิด, ชนลิมิต — ทดสอบก่อน launch |
| G8 | ตั้ง rate limit ก่อนถึง user 1,000 คนแรก | มีแล้วแต่เป็น in-process (S6) — ต้องเข้าใจว่ามันขยายตามจำนวน task |

---

## 6. สิ่งที่ต้องให้เจ้าของตัดสินใจ

> **คำอธิบายละเอียดทุกข้อพร้อมข้อดีข้อเสียและข้อเสนอ:**
> `docs/plans/production-golive-decisions-explained-th.md`

**ทั้ง 9 ข้อ RESOLVED แล้วเมื่อ 2026-08-08** — เจ้าของอนุมัติตามข้อเสนอทุกข้อ

| # | คำถาม | มติ |
| --- | --- | --- |
| D1 | ขนาด RDS | ✅ **gp2 → gp3** + upgrade เป็น **`db.t4g.small`** + ตั้ง **`connection_limit=10`** ใน `database-url` secret |
| D2 | ปลายทาง alert | ✅ เจ้าของระบบ (thawatchai) เป็นปลายทาง — **อีเมลอย่างเดียว ไม่เพิ่ม SMS** |
| D3 | Redis/RDS/backup | ✅ **ทำครบทั้งสาม** — Redis two-node, RDS Multi-AZ, backup 35 วัน (~$50–70/เดือน) |
| D4 | เส้นแบ่ง checklist | ✅ **บล็อก:** M-16, M-17(Redis+RDS) · **W4:** M-17(restore drill) · **ไม่บล็อก:** M-01 (ปิด AI tool ตอน launch), H-14 (หมุน token + alarm + กำหนดวัน), M-18 (ปิดตัวเอง) |
| D5 | Bastion network | ✅ **ทาง (ก)** public IP + zero inbound + เงื่อนไข 5 ข้อ แล้วย้ายไป (ข) พร้อม H-14 |
| D6 | Bastion power | ✅ **เปิดค้าง** + SSM Patch Manager + alarm เมื่อมีคนเปิด session |
| D7 | สิทธิ์ arm `_rw` | ✅ IAM role + PG role ตาม §4.3 · **ห้ามสร้าง app-level support account ที่ข้ามบริษัท** |
| D8 | Port-forward | ✅ **shell อย่างเดียวทั้ง T1 และ T2** — ไม่เปิด port-forward |
| D9 | staging rung | ✅ **UAT คือ staging rung** ปิด OPEN-3 · migration timing ต้องพิสูจน์จาก restored clone ไม่ใช่ UAT |

### D2 — ผลของการเลือกอีเมลอย่างเดียว (บันทึกความเสี่ยงที่ยอมรับแล้ว)

alert ที่ดังนอกเวลาทำงานจะถูกเห็น **เมื่อเปิดอีเมลครั้งถัดไป** ไม่ใช่ทันที
ยอมรับความเสี่ยงนี้ได้ตราบใดที่ยังไม่มีลูกค้าที่ทำสัญญา SLA ไว้
**ทบทวนข้อนี้ใหม่เมื่อมีลูกค้าจ่ายเงินรายแรก** — ตอนนั้น "รู้ตอนเช้า" จะไม่พออีกต่อไป

ระหว่างนี้ให้ชดเชยด้วยสิ่งที่ทำได้ฟรี:
- เปิด push notification ของแอปอีเมลบนมือถือเฉพาะ sender `no-reply@sns.amazonaws.com`
- ตั้ง filter ให้ CRITICAL ไม่ถูกจัดเข้า tab Promotions/Updates
- ยิง synthetic event ทุกไตรมาสเพื่อยืนยันว่าท่อยังไม่ตาย (subscription ถูกยกเลิกเงียบ ๆ ได้)

### D8 — ผลของการไม่เปิด port-forward

ทีม support จะใช้ GUI client (DBeaver/TablePlus) กับ production **ไม่ได้เลย** ทุกอย่างผ่าน `psql`
บน bastion แลกกับการได้ transcript ครบทุกครั้ง หากในทางปฏิบัติพบว่าช้าเกินไปจริง
ให้เปิดประเด็นใหม่พร้อมตัวอย่างเคสจริง **อย่าเปิด port-forward แบบเงียบ ๆ**
เพราะจะทำให้หลักฐานย้อนหลังทั้งชุดถูกตั้งคำถามพร้อมกัน

---

## 7. Deliverable

### เขียนแล้ว 2026-08-08 (W3 support access)

- [x] `infra/production/bootstrap-support-roles.sql` — §4.3 ทั้งหมด
      **ทดสอบจริงบน PostgreSQL 16 ใน throwaway database แล้ว** ดู §8
- [x] `infra/production/arm-support-execute.sh` — arm/disarm/status + incident ref + SNS alert
      + terminate session ที่ค้างตอน disarm (`bash -n` ผ่าน)
- [x] `infra/support/connect-production.sh` — entry point เดียวจากเครื่อง operator
      (`view`/`execute`/`arm`/`disarm`/`status`, `bash -n` ผ่าน)
- [x] `docs/runbooks/production-support-access.md` — runbook ที่ on-call เปิดตอน incident จริง

### เขียนแล้ว 2026-08-08 (W1 data plane + execution checklist)

- [x] `infra/production/bootstrap-data.sh` — Redis two-node encrypted/auth/failover/35-day snapshots
      + `noeviction` param group + ชี้ `redis-url` secret ใหม่ด้วย `put-secret-value` (**ARN เดิม**)
      + RDS hardening หลัง `CONFIRM_PRODUCTION_RDS_HARDENING=APPLY`
      + verify ปิดท้ายด้วยเงื่อนไขเดียวกับ `verify-production-security-baseline.sh`
- [x] `docs/runbooks/production-golive-aws-commands.md` — คำสั่งทุกขั้นที่เจ้าของต้องรันบน AWS
      เรียงลำดับ พร้อมคำสั่งยืนยันของแต่ละขั้น

### ยังต้องเขียน

- [ ] ย้าย `arm-support-execute.sh` ไปเป็น mode ของ `run-release-task.sh`
      เพื่อให้ bastion ไม่ต้องถือ writer credential (ช่องว่างที่บันทึกไว้ใน runbook §1)
- [ ] Auto-disarm ด้วย EventBridge Scheduler → Lambda
- [ ] CloudWatch alarm: `IncomingBytes` ทุก log group, RDS connections, RDS CPU credit,
      Redis memory, SSM session start, `AuthorizeSecurityGroupIngress` บน bastion SG
- [ ] ECR lifecycle policy

---

## 8. Verification ที่รันจริงแล้ว

`bootstrap-support-roles.sql` — รันบน PostgreSQL 16 (`docker-postgres-1`) ใน database
`support_role_check` ที่สร้างขึ้นชั่วคราวและลบทิ้งหลังเสร็จ ไม่แตะ `watchdog_bms` ของ dev

| ตรวจ | ผล |
| --- | --- |
| รันสำเร็จ + รันซ้ำได้ (idempotent) | ✅ ทั้งสองรอบ `COMMIT` |
| `watchdog_support_ro` LOGIN, `watchdog_support_rw` NOLOGIN | ✅ `ro(login=t, armed_rw=f)` |
| **รันซ้ำตอน `_rw` ถูก arm อยู่ ต้องไม่ disarm** | ✅ `armed_rw=t` หลังรันซ้ำ |
| `rw` INSERT/UPDATE/DELETE ตารางแอป | ✅ ทำได้ |
| `rw` เขียน `_prisma_migrations` | ✅ ถูกปฏิเสธ |
| `rw` อ่าน `_prisma_migrations` | ✅ อ่านได้ (support ต้องเช็ค migration) |
| `rw` UPDATE `AuditLog` | ✅ ถูกปฏิเสธ |
| `rw` INSERT `AuditLog` (append-only) | ✅ ทำได้ |
| `rw` `CREATE TABLE` | ✅ ถูกปฏิเสธ (`permission denied for schema public`) |
| `rw` `TRUNCATE` | ✅ ถูกปฏิเสธ |
| `ro` เขียนอะไรก็ตาม | ✅ ถูกปฏิเสธ |
| **ตารางใหม่ที่ migration สร้าง — `ro` อ่านได้โดยไม่ต้องรันสคริปต์ซ้ำ** | ✅ `pg_read_all_data` ครอบให้ |
| ตารางใหม่ — `rw` เขียนได้ผ่าน default privileges | ✅ |

**บั๊กที่เจอจากการทดสอบและแก้ไปแล้ว** (จะไม่เจอเลยถ้าไม่รันจริง):

1. `has_database_privilege()` **รวมสิทธิ์ที่ PUBLIC ได้มาโดยอัตโนมัติ** PostgreSQL ให้ `TEMPORARY`
   กับ PUBLIC ทุก database ทำให้ assertion เดิมเป็นจริงสำหรับ role อะไรก็ได้ที่ไม่เกี่ยวข้องเลย —
   เปลี่ยนไปอ่าน `pg_database.datacl` ผ่าน `aclexplode()` เพื่อดูเฉพาะสิทธิ์ที่ **grant ตรง**
2. `arm-support-execute.sh`: `PGDATABASE="$(...)" psql "$PGDATABASE"` — shell ขยาย `$PGDATABASE`
   จาก environment **เดิม** ก่อนที่ assignment จะมีผล ทุกคำสั่ง SQL จะพังทันที
   แก้เป็นให้ psql อ่านจาก environment เอง ซึ่งกันไม่ให้ credential โผล่ใน process table ด้วย

**ข้อค้นพบที่ต้องจำ:** การลบ support role ทีหลังต้องยกเลิก `ALTER DEFAULT PRIVILEGES` ก่อน
ไม่งั้น `DROP ROLE` จะ fail เพราะมี dependency ค้าง

---

## Sources (internet research)

- [Compliance Requirements and Best Practices for Secure Break-Glass Access — hoop.dev](https://hoop.dev/blog/compliance-requirements-and-best-practices-for-secure-break-glass-access)
- [Better Ways to Break Glass: Planning for Emergency Access — Lumos](https://www.lumos.com/blog/planning-for-emergency-access)
- [Creating a Read-Only Postgres User — Crunchy Data](https://www.crunchydata.com/blog/creating-a-read-only-postgres-user)
- [PostgreSQL Documentation: Privileges](https://www.postgresql.org/docs/current/ddl-priv.html)
- [IAM database authentication for PostgreSQL — AWS Docs](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.html)
- [Secure RDS Access Without Bastion Hosts using SSM Session Manager — Trestle](https://trestleiq.com/secure-rds-access-without-bastion-hosts-using-aws-ssm-session-manager/)
- [Shipping RDS IAM Authentication (with a bastion host & SSM) — ramimac](https://ramimac.me/rds-iam-auth)
- [Prisma Migrations in Production: Zero-Downtime Deployments With Expand-Contract — DEV](https://dev.to/whoffagents/prisma-migrations-in-production-zero-downtime-deployments-with-expand-contract-2l1p)
- [Running Prisma migrations safely in production — Juliano Alves](https://julianoalves.me/blog/prisma-migrations-production)
- [Database connections — Prisma Documentation](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections)
- [Usage with AWS ECS Fargate: Connection pool-size for VCPU's — prisma/prisma discussion](https://github.com/prisma/prisma/discussions/9273)
- [RDS PostgreSQL Connection Pool Exhausted — PGFlare](https://www.pgflare.com/knowledge-base/rds-connection-pool-exhausted)
- [Don't add a read replica until you've read this — incident.io](https://incident.io/blog/dont-add-a-read-replica-until-youve-read-this)
- [Avoiding ECS Fargate Pitfalls: A Practical Troubleshooting Handbook — Business Compass](https://knowledge.businesscompassllc.com/avoiding-ecs-fargate-pitfalls-a-practical-troubleshooting-handbook/)
- [Production DNS Change Rollout Checklist — Moments Log](https://www.momentslog.com/development/production-dns-change-rollout-checklist-reduce-downtime-cache-surprises-and-rollback-risk)
- [Guidelines on key compliance requirements for the PDPA in Thailand — Kennedys](https://www.kennedyslaw.com/en/thought-leadership/article/guidelines-on-key-compliance-requirements-for-the-personal-data-protection-act-in-thailand/)
- [Thai PDPA Compliance Guide — OneTrust](https://www.onetrust.com/blog/the-ultimate-guide-to-thai-pdpa-compliance/)
