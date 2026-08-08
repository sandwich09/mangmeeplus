# Production Support Access — query prod, view/execute, break-glass

สร้าง 2026-08-08 | สถานะ **พร้อมใช้หลังทำ §1 ครบ** | ออกแบบใน `docs/plans/production-golive-and-support-access-plan.md` §4

เอกสารนี้เปิดอ่านตอนเกิดเหตุจริง **§3 คือส่วนที่ต้องอ่านตอนตีสาม** ส่วนที่เหลืออ่านตอนว่าง

มติที่เอกสารนี้ทำตาม (D5–D8, อนุมัติ 2026-08-08): bastion อยู่ public subnet + **zero inbound**,
เปิดค้าง, **ไม่เปิด port-forward** ทุกอย่างเป็น interactive shell เพื่อให้มี transcript

---

## 0. ไต่บันไดตามลำดับ — อย่าเริ่มที่ psql

| Tier | ใช้เมื่อ | เครื่องมือ | ใครทำได้ |
| --- | --- | --- | --- |
| **T0** | ทุกเคส เริ่มที่นี่เสมอ | CloudWatch Logs Insights, `/v1/health`, ECS deployment status | ทุกคนที่ on-call |
| **T0.5** | รู้แล้วว่า feature เดียวพัง | **Emergency CLOSE** (`feature-launch-control.md` R3) | OC คนเดียว ไม่ต้องรออนุมัติ |
| **T1** | ต้องรู้ว่า data จริงเป็นยังไง | `connect-production.sh view` | คนที่มี `ssm:StartSession` บน bastion |
| **T2** | ต้องแก้ data เพื่อกู้ระบบ | `connect-production.sh execute` | ต้องมี **คนที่สอง** arm ให้ก่อน |

**ห้ามข้าม T1 ไป T2** ถ้ายังตอบไม่ได้ว่าจะแก้แถวไหนเป็นค่าอะไร
**T0.5 เร็วและปลอดภัยกว่า T2 เสมอ** ถ้าปิด feature แล้วเลือดหยุด ให้ปิดก่อนแล้วค่อยสืบ

---

## 1. ต้องทำครบก่อนถึงจะใช้ได้ (one-time)

- [ ] **Bastion**: ติดตั้ง `postgresql`, `jq`, `awscli`; วาง RDS CA bundle ที่ `/opt/rds-ca/global-bundle.pem`;
      คัดลอก `infra/production/arm-support-execute.sh` ไป `/opt/watchdog/` (chmod 0750, เจ้าของ root)
- [ ] **Bastion SG**: **ไม่มี inbound rule แม้แต่ข้อเดียว** — ตรวจซ้ำหลังตั้ง SSM ทำงานด้วย outbound เท่านั้น
- [ ] **Bastion**: บังคับ IMDSv2, เปิด SSM Patch Manager
- [ ] **Bastion instance profile**: `rds-db:connect` สำหรับ `watchdog_support_ro` และ `watchdog_support_rw`,
      `rds:DescribeDBInstances`, `ssm:GetParameter`/`PutParameter`/`DeleteParameter` บน
      `/watchdog-bms/production/support-rw-armed`, `sns:Publish` บน alert topic
- [ ] **SSM session logging** → S3 (KMS-encrypted) + CloudWatch **ตั้งก่อนใช้งานครั้งแรก**
      session ที่ไม่ถูกบันทึกคือ session ที่ตอบคำถามภายหลังไม่ได้
- [ ] **RDS**: เปิด IAM database authentication บน `watchdog-bms-prod-db`
- [ ] **RDS parameter group**: ใส่ `%a` (application_name) ลง `log_line_prefix`
- [ ] **DB roles**: `psql "$WRITER_URL" -v ON_ERROR_STOP=1 -f infra/production/bootstrap-support-roles.sql`
      **ต้องทำหลัง deploy ครั้งแรกเท่านั้น** — สคริปต์อ้าง `_prisma_migrations` และ `AuditLog`
      ตรง ๆ ถ้า schema ยังว่างจะหยุดที่ `relation "_prisma_migrations" does not exist`
      (ยืนยันด้วยการทดสอบจริงบน PostgreSQL 16 เมื่อ 2026-08-08) การล้มแบบนี้ถูกต้องแล้ว
      ทั้งไฟล์อยู่ใน transaction เดียว จึงไม่มี role ครึ่ง ๆ ค้าง
- [ ] **Alarm** เมื่อมีคนเปิด SSM session บน bastion → alert topic
- [ ] **Alarm** เมื่อมี `AuthorizeSecurityGroupIngress` บน bastion SG → alert topic
      **ข้อนี้คือสิ่งที่ปิดช่องว่างหลักของ D5 ทาง (ก)** อย่าข้าม
- [ ] **ซ้อมทั้ง T1 และ T2 บน UAT ให้จบหนึ่งรอบ** ก่อนแตะ production

> **ยังค้าง (ยอมรับความเสี่ยงชั่วคราว):** `arm-support-execute.sh` ต้องการ writer credential
> ถ้ารันจาก bastion แปลว่า instance profile ต้องอ่าน secret `watchdog-bms/production/database-url` ได้
> ซึ่งทำให้ **ใครที่เปิด session ได้ก็ข้ามการ arm ได้ทั้งหมด** ทางแก้จริงคือย้ายไปเป็น one-off
> ECS task ที่มี task role ของตัวเอง แบบเดียวกับ mode ต่าง ๆ ใน `run-release-task.sh`
> จนกว่าจะทำ ให้ scope secret permission ไว้ที่ secret เดียวนั้นเท่านั้น และถือว่าการแยก
> "คนดู" กับ "คนเขียน" ยังเป็นข้อตกลง ไม่ใช่การบังคับด้วยระบบ

---

## 2. T0 — ตอบให้ได้ก่อนโดยไม่แตะ database

```bash
# service รันอยู่จริงไหม (ห้ามใช้ describe-services กับ Express Mode — มันคืน 0 ให้ทุกตัวเสมอ)
aws ecs describe-express-gateway-service --service <prod-service-arn>

# deploy ล่าสุดสำเร็จหรือ rollback
aws ecs list-service-deployments --cluster watchdog-bms-prod --service <name>

curl -sS https://<prod-host>/v1/health
```

CloudWatch Logs Insights — หา error ที่พุ่งขึ้น:

```
fields @timestamp, @message
| filter level = "error"
| stats count() by bin(5m), errorCode
| sort @timestamp desc
```

**ถ้ากำลัง deploy อยู่ ห้าม curl route อื่นนอกจาก `/v1/health`** — canary rollback alarm
นับ 4xx/5xx รวม smoke test ของเราเอง แล้วจะ rollback เงียบ ๆ

---

## 3. ตอนเกิดเหตุจริง

### 3.1 T1 VIEW — อ่านอย่างเดียว

```bash
infra/support/connect-production.sh view INC-2026-0808-01
```

จะได้ `psql` บน bastion ในฐานะ `watchdog_support_ro` server บังคับ read-only —
พิมพ์ `UPDATE` ผิดก็เขียนไม่ได้ `statement_timeout` 15 วินาที `lock_timeout` 2 วินาที

**session นี้ถูกบันทึกทั้งหมด อ่านเฉพาะเท่าที่เคสต้องการ** การ `SELECT *` ทั้งตารางลูกค้า
เพราะขี้เกียจเขียน `WHERE` จะปรากฏใน transcript ตลอดไป

query ที่ใช้บ่อย:

```sql
-- migration ลงครบไหม (support อ่านได้ แต่เขียนไม่ได้)
SELECT migration_name, finished_at, rolled_back_at
  FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10;

-- connection ใกล้เต็มหรือยัง (ดู D1 — นี่คือความเสี่ยงอันดับหนึ่ง)
SELECT current_setting('max_connections')::int AS max,
       count(*) AS used,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_in_txn
  FROM pg_stat_activity;

-- query ไหนค้างและบล็อกใครอยู่
SELECT pid, usename, state, wait_event_type, now() - query_start AS runtime, left(query, 120)
  FROM pg_stat_activity
 WHERE state <> 'idle' AND now() - query_start > interval '5 seconds'
 ORDER BY runtime DESC;
```

### 3.2 T2 EXECUTE — เขียน

**คนที่สอง** arm ให้ก่อน (คนละคนกับคนที่จะเขียน):

```bash
infra/support/connect-production.sh arm INC-2026-0808-01 60
```

การ arm จะยิง alert ทันที ถ้าคุณไม่ได้สั่ง ให้ถือเป็น security event และ disarm เดี๋ยวนั้น

จากนั้นคนแก้:

```bash
infra/support/connect-production.sh execute INC-2026-0808-01
```

**กฎเหล็ก ไม่มีข้อยกเว้น:**

```sql
BEGIN;
UPDATE "Expense" SET status = 'CONFIRMED' WHERE id = '...';
-- ดู row count ก่อน ถ้าไม่ใช่จำนวนที่คาด ให้ ROLLBACK;
COMMIT;
```

1. `BEGIN;` ก่อนเสมอ ตรวจ row count แล้วค่อย `COMMIT`
   `lock_timeout` กันการล็อกค้างได้ แต่**กัน `UPDATE` ที่ลืม `WHERE` ไม่ได้**
2. **ถ้าแก้ผ่าน API/UI ได้ ให้หยุดแล้วไปทำที่นั่น** — API มี permission check, ABAC, business rule
   และ audit ที่ SQL ตรง ๆ ข้ามหมด
3. **ห้ามแตะ `_prisma_migrations`** (ระบบบล็อกไว้แล้ว) และห้ามทำ DDL
   schema เปลี่ยนได้ทางเดียวคือ release task
4. ทุก data fix ที่เกิดจาก bug **ต้องมี code fix ตามมา** ไม่งั้นจะกลับมาอีก

disarm ทันทีที่ยืนยันว่าแก้ได้แล้ว **อย่ารอครบ 60 นาที**:

```bash
infra/support/connect-production.sh disarm    # ปิด login + kill session ที่ค้าง
infra/support/connect-production.sh status    # ยืนยันว่าเป็น DISARMED
```

### 3.3 หลังจบทุกครั้ง

- [ ] ยืนยัน `status` = `DISARMED`
- [ ] เขียน `docs/agent-memory/<incident>.md` **ภายใน 24 ชั่วโมง** — อะไรพัง, แก้อะไรไปบ้าง
      (SQL จริง), ทำไมแก้ที่ DB แทน API, code fix ที่ต้องตามมาคืออะไร
- [ ] ถ้าใช้ T2 → ทบทวนทุกครั้ง ไม่มีข้อยกเว้น
- [ ] ถ้าเกิดจาก bug → เปิดงาน code fix ทันที ไม่ใช่ "ไว้ก่อน"

---

## 4. เมื่อบางอย่างไม่เป็นไปตามคาด

| อาการ | สาเหตุที่พบบ่อย |
| --- | --- |
| `no running instance tagged Name=watchdog-bms-ssm-bastion` | bastion ถูกดับ — `aws ec2 start-instances` แล้วรอ ~90 วินาทีให้ SSM agent ลงทะเบียน |
| `TargetNotConnected` | เครื่องรันแต่ SSM agent ยังไม่ขึ้น หรือ instance profile ขาด `AmazonSSMManagedInstanceCore` |
| `PAM authentication failed for user watchdog_support_rw` | ยังไม่ได้ arm — ให้คนที่สองรัน `arm` |
| token หมดอายุกลางทาง | IAM auth token อายุ 15 นาที ออกแล้วเข้าใหม่ |
| `canceling statement due to statement timeout` | ทำงานตามที่ออกแบบ — เขียน query ให้แคบลง อย่าไปเพิ่ม timeout |
| `canceling statement due to lock timeout` | มีคนถือ lock อยู่ — หาด้วย query ใน §3.1 อย่ารีบ `pg_terminate_backend` |
| SELECT ตารางใหม่ไม่ได้ | ไม่ควรเกิด (`pg_read_all_data` ครอบตารางใหม่อัตโนมัติ) ถ้าเกิดแปลว่า migration สร้างตารางใน schema อื่น — รายงานเป็นบั๊ก |

**การลบ support role ทีหลัง**: ต้องยกเลิก `ALTER DEFAULT PRIVILEGES` ก่อน ไม่งั้น `DROP ROLE`
จะ fail เพราะมี dependency ค้าง (ยืนยันด้วยการทดสอบจริงบน PostgreSQL 16 เมื่อ 2026-08-08)

---

## 5. หลักฐานที่ระบบนี้ทิ้งไว้ (ตอบผู้ตรวจสอบ / PDPA)

| คำถาม | ดูที่ไหน |
| --- | --- |
| ใครเข้า production ตอนไหน | CloudTrail `StartSession` + SSM session history |
| พิมพ์ SQL อะไรบ้าง | SSM session transcript ใน S3 (KMS) และ CloudWatch |
| เข้าถึงด้วยเหตุผลอะไร | `incident_ref` ใน `application_name` และใน alert ตอน arm |
| ใครอนุมัติให้เขียนได้ | alert ตอน arm (ระบุ operator ARN) + SSM parameter |
| แก้อะไรไปบ้าง | transcript + `docs/agent-memory/<incident>.md` |

⚠️ **transcript มี PII ของลูกค้าอยู่ข้างใน** bucket ที่เก็บต้องเข้ารหัสด้วย KMS, มี retention policy
ชัดเจน และจำกัดคนเข้าถึง **เท่ากับหรือแคบกว่า** คนที่เข้า database ได้ ไม่งั้นเราแค่ย้ายปัญหาจาก DB ไป S3

---

## 6. สิ่งที่ระบบนี้จงใจไม่ให้ทำ

| ทำไม่ได้ | เหตุผล |
| --- | --- |
| Port-forward + DBeaver/TablePlus | SSM ไม่บันทึก traffic ในอุโมงค์ → ไม่มี transcript (มติ D8) |
| `aws ecs execute-command` เข้า container | `production-image-security.spec.sh` assert `enableExecuteCommand == false` |
| DDL / `CREATE TABLE` / `TRUNCATE` | schema เปลี่ยนได้ทางเดียวคือ release task |
| เขียน `_prisma_migrations` | ทำให้ `verify-applied-migration-catalog.ts` เพี้ยนและ deploy หยุดในอนาคต |
| แก้/ลบ `AuditLog` | append-only — session ต้องบันทึกได้ แต่ลบสิ่งที่ตัวเองทำไม่ได้ |
| app-level support account ที่ข้ามบริษัท | RBAC เป็น company-scoped; account ถาวรที่เห็นทุก tenant คือปัญหา PDPA ที่ใหญ่กว่าเดิม (มติ D7) |

---

## 7. ยังต้องทำต่อ

- [ ] ย้าย `arm-support-execute.sh` ไปเป็น mode ของ `run-release-task.sh` เพื่อให้ bastion
      ไม่ต้องถือ writer credential — **ปิดช่องว่างที่ระบุไว้ท้าย §1**
- [ ] Auto-disarm ด้วย EventBridge Scheduler → Lambda (ตอนนี้พึ่ง alert + คนกด disarm)
      `VALID UNTIL` ใช้ไม่ได้เพราะบังคับอายุ password เท่านั้น ไม่ใช่ IAM auth
- [ ] ทดสอบว่า `rds_superuser` ตั้ง `pgaudit.log` ต่อ role ได้ไหม — ถ้าได้จะเป็น audit ชั้นที่สอง
      โดยไม่ระเบิดค่า CloudWatch (ตั้งระดับ parameter group จะ log ทุก query ของแอปด้วย)
- [ ] ทบทวนความเหมาะสมของ `connection_limit` 4/2 หลังใช้จริงหนึ่งเดือน
