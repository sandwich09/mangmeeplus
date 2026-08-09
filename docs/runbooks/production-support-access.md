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

- [~] **Bastion**: `postgresql` (psql 16.14), `jq`, `awscli`, `python3` **มีครบแล้ว** (ตรวจ 2026-08-08);
      RDS CA bundle **ติดตั้งแล้วที่ `/opt/rds-ca/ap-southeast-1-bundle.pem`** (regional bundle,
      3 certs, `sha256 3c696020a3b7c6721085d182211c28024ab01873ade35dcc7eeebb89c20ee979`, ไฟล์ 0644
      **ไดเรกทอรีต้องเป็น 0755** ไม่ใช่ 0700 — ดูหัวข้อบั๊กท้ายเอกสาร)
      — **ไม่ใช่** `global-bundle.pem` ตามที่เขียนไว้เดิม ทั้งสองสคริปต์ default มาที่ path นี้แล้ว
      ถ้าย้าย DB ข้าม region ต้องโหลด bundle ของ region ใหม่
      `arm-support-execute.sh` **ติดตั้งแล้ว** ที่ `/opt/watchdog/arm-support-execute.sh`
      (0750 root:root, `sha256 a372df66a819310dd91b4fab31868faef94b6eb362bbc519efabc31ca2781b56`,
      ตรวจ `bash -n` ก่อนติดตั้ง) — รัน `status` จริงบน production ได้ผล `DISARMED` exit 0
      ซึ่งพิสูจน์พร้อมกันว่า: การแตก URI เป็น `PG*` ใช้ได้, CA bundle ที่ path ใหม่ผ่าน `verify-full`,
      `role_is_armed` อ่านค่าจริงจาก `pg_roles` ได้ (ไม่ใช่เดา) และ `ssm:GetParameter` ที่เพิ่งให้ทำงาน
      > **ติดตั้งซ้ำเมื่อแก้สคริปต์:** ไฟล์บน bastion เป็นสำเนา ไม่ได้ผูกกับ repo
      > ถ้าแก้ใน repo แล้วไม่ copy ใหม่ bastion จะยังรันของเก่าเงียบ ๆ เทียบ sha256 ทุกครั้ง
- [ ] **Bastion SG**: **ไม่มี inbound rule แม้แต่ข้อเดียว** — ตรวจซ้ำหลังตั้ง SSM ทำงานด้วย outbound เท่านั้น
- [ ] **Bastion**: บังคับ IMDSv2, เปิด SSM Patch Manager
- [~] **Bastion instance profile**: `rds-db:connect` สำหรับทั้งสอง db user **ให้แล้ว 2026-08-08**
      (statement `ConnectAsSupportDatabaseRoles` ใน inline policy
      `watchdog-bms-bastion-read-support-secrets`, ระบุชื่อ db user ตรง ๆ ไม่มี wildcard)
      `ssm:GetParameter`/`PutParameter`/`DeleteParameter` บน `/watchdog-bms/production/support-rw-armed`
      และ `sns:Publish` บน alert topic **ให้แล้ว 2026-08-08** เช่นกัน (statement
      `RecordArmStateForSupportExecute` และ `AnnounceSupportExecuteArming`)
      > **`rds:DescribeDBInstances` ไม่ได้อยู่ฝั่ง bastion** — เดิมเอกสารนี้เขียนไว้ผิดคอลัมน์
      > ไล่ดู `aws_cmd` ทุกจุดแล้ว: `arm-support-execute.sh` (รันบน bastion) เรียกแค่
      > secretsmanager / sns / ssm / sts ส่วน `rds describe-db-instances` ถูกเรียกโดย
      > `connect-production.sh` ซึ่งรันบน **workstation** จึงเป็นสิทธิ์ของคนใช้งาน ไม่ใช่ของ instance profile
      > **IAM propagation ช้ากว่าที่คิด:** หลัง `put-role-policy` การเชื่อมยังล้มด้วย
      > `pam_authenticate failed: Permission denied` อยู่ ~9 นาที แล้วผ่านเอง อย่าเพิ่งสรุปว่า
      > policy ผิดแล้วไปแก้อย่างอื่น — ให้ retry เป็นระยะก่อน
- [x] **SSM session logging** เปิดแล้ว 2026-08-09 ผ่าน document `SSM-SessionManagerRunShell`
      → S3 `watchdog-bms-prod-…/ssm-session-logs/production` (AES256) + CloudWatch
      `/aws/ssm/session-logs/watchdog-bms-production` (**KMS**, retention 90 วัน)
      idle timeout 20 นาที, max session 4 ชม.
      พิสูจน์ด้วย session จริง: transcript ขึ้นครบทั้งสองที่ พร้อมข้อความ error ที่ถูกปฏิเสธ
      > **`cloudWatchEncryptionEnabled` ต้องเป็น `false`** — ตั้ง `true` แล้ว SSM ปฏิเสธทุก session
      > ด้วย *"encryption is not set up on the selected CloudWatch Logs log group"* **ทั้งที่ log group
      > มี KMS key จริงและ key อยู่สถานะ Enabled** ผลคือเปิด bastion ไม่ได้เลยจนกว่าจะปิด flag นี้
      > ข้อมูลยังเข้ารหัสอยู่ดีเพราะ log group เป็นคนเข้ารหัส flag นี้เป็นแค่ด่านตรวจของ SSM
- [x] **RDS**: เปิด IAM database authentication บน `watchdog-bms-prod-db` (ทำแล้วใน W1 modify-db-instance)
- [x] **RDS SG อนุญาต 5432 จาก bastion SG** — เปิดแล้ว 2026-08-08 ด้วย `--source-group` (SG-to-SG
      ไม่ใช่ CIDR) นี่คือ setup ถาวรที่ตั้งใจ ไม่ใช่ workaround: bastion คือทางเข้า DB ที่ออกแบบไว้
      สำหรับ support path ทั้งหมด (T1/T2) การป้องกันมาจากสามชั้นที่ยังอยู่ครบ — bastion ไม่มี
      inbound port (เข้าได้ทาง SSM เท่านั้น คุมด้วย IAM), RDS ยังไม่ public, และ rule จำกัดที่
      bastion SG เท่านั้น **ห้ามปิด** เว้นแต่จะเปลี่ยนดีไซน์ support path ทั้งชุด
      - เปิด: `aws ec2 authorize-security-group-ingress --group-id <RDS_SG> --protocol tcp --port 5432 --source-group <BASTION_SG> --region ap-southeast-1`
      - ปิด (ถ้าจำเป็นจริง): `revoke-security-group-ingress` ด้วย argument เดียวกัน
- [x] **RDS parameter group**: ทำแล้ว 2026-08-09 — custom group `watchdog-bms-prod-pg18`
      (default group แก้ไม่ได้) ผูกกับ instance แล้ว reboot `--force-failover` ใช้เวลา **80 วินาที**
      เว็บตอบ 200 ทันทีหลังจบ
      > **RDS ไม่ให้ตั้ง `log_line_prefix` ตามใจ** มีแค่ 2 ค่าที่อนุญาต ตัวที่มี `%a` คือ
      > `%m:%r:%u@%d:[%p]:%l:%e:%s:%v:%x:%c:%q%a:` ซึ่งแถม SQLSTATE, transaction id, session id
      > และ timestamp ระดับมิลลิวินาทีมาด้วย ยืนยันด้วย `SHOW log_line_prefix` หลัง reboot
- [x] **DB roles**: รันแล้ว 2026-08-08 บน production — `COMMIT` พร้อม
      `NOTICE: support roles verified: ro(login=t, armed_rw=f)` (verification block ผ่านครบ)
      พิสูจน์ปลายทางจริงด้วย RDS IAM token จาก bastion: `current_user=watchdog_support_ro`,
      `default_transaction_read_only=on`, อ่าน `_prisma_migrations` ได้ 121 แถว,
      `CREATE TABLE` และ `DELETE FROM "AuditLog"` ถูกปฏิเสธด้วย
      `cannot execute ... in a read-only transaction`
      - คำสั่ง (idempotent — รันซ้ำได้ ใช้แก้ drift):
        `psql "$WRITER_URL" -v ON_ERROR_STOP=1 -f infra/production/bootstrap-support-roles.sql`
      - **ต้องทำหลัง deploy ครั้งแรกเท่านั้น** — สคริปต์อ้าง `_prisma_migrations` และ `AuditLog`
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

> ⚠️ **ยังไม่จริง ณ 2026-08-08 — session ยังไม่ถูกบันทึก** ตรวจแล้วว่า Session Manager ยังไม่มี
> document `SSM-SessionManagerRunShell` แปลว่าใช้ค่า default ซึ่ง **ไม่ส่ง transcript ไป S3
> หรือ CloudWatch เลย** และ RDS ยังใช้ parameter group `default.postgres18` ที่ `log_line_prefix`
> เป็น `%t:%r:%u@%d:[%p]:` — **ไม่มี `%a`** ดังนั้น `application_name` ที่เราอุตส่าห์ใส่
> incident/operator ลงไปจะไม่ปรากฏใน log ฝั่ง server เลย
>
> **ผลรวม: ตอนนี้ตอบคำถาม "ใครอ่านข้อมูลลูกค้ารายไหนเมื่อวันที่ 8" ไม่ได้**
> จนกว่าจะทำสองข้อใน §1 ให้ครบ ให้ถือว่า T1/T2 เป็น trust-based ไม่ใช่ audited
> (แก้ `log_line_prefix` ต้องสร้าง custom parameter group เพราะ default group แก้ไม่ได้
> และการเปลี่ยน group ต้อง reboot ซึ่งบน Multi-AZ = failover ~1–2 นาที **วางแผนก่อน อย่าทำสด**)

**session นี้ (ควรจะ) ถูกบันทึกทั้งหมด อ่านเฉพาะเท่าที่เคสต้องการ** การ `SELECT *` ทั้งตารางลูกค้า
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

## บทเรียนจากการติดตั้งจริง (2026-08-08)

**`PGDATABASE` ไม่ขยาย URI** — เดิม `arm-support-execute.sh` เขียนว่า libpq ถือว่า dbname ที่เป็น URI
เป็น conninfo เต็ม ซึ่ง **ไม่จริงสำหรับ environment variable** ทดสอบบน psql 16 บน bastion:

| วิธี | ผล |
| --- | --- |
| `PGDATABASE=postgres://…` | ไปที่ `/var/run/postgresql/.s.PGSQL.5432` — ไม่สนใจ URI |
| `psql "postgres://…"` (positional) | ต่อไป host ที่ระบุจริง |

เฉพาะ dbname ที่เป็น **parameter** เท่านั้นที่ได้รับการขยาย ไม่ใช่ตัวแปรสภาพแวดล้อม แต่การส่งเป็น
argument ก็ทำให้ credential โผล่ใน process table ซึ่งเป็นสิ่งที่ดีไซน์เดิมตั้งใจเลี่ยง
**ทางแก้:** แตก URI เป็น `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE` ด้วย
`python3 urllib.parse` (จัดการ percent-decoding ให้ถูก) แล้ว `eval` ค่าที่ `shlex.quote` แล้ว —
credential อยู่ใน environment ไม่แตะ command line

ถ้าไม่เจอตอนนี้ จะไปเจอตอนตี 2 กลาง incident ซึ่งเป็นเวลาที่แย่ที่สุด

**`sslmode=verify-full` ต้องมี trust anchor** — OS trust store ของ Amazon Linux 2023 ไม่มี Amazon RDS
root CA จึงได้ `SSL error: certificate verify failed` **ห้ามแก้ด้วยการลด sslmode** ให้ติดตั้ง bundle
แล้วชี้ `PGSSLROOTCERT`/`sslrootcert` มาที่ไฟล์นั้น

## บั๊กที่เจอจาก audit เส้น T2 (2026-08-08) — ทั้งหมดอยู่ในโค้ดที่ไม่เคยรัน

**1. `role_is_armed()` fail open — ร้ายแรงที่สุด**

เดิมเขียนว่า `[ "$(run_sql "SELECT rolcanlogin ...")" = "t" ]` ซึ่งคืน false ทั้งกรณีที่ role
เป็น NOLOGIN จริง **และ** กรณีที่ psql รันไม่ได้เลย (DB ล่ม / token หมดอายุ / ไม่มีสิทธิ์)

ผลที่ `disarm`: เข้าเงื่อนไข `if ! role_is_armed` → พิมพ์ *"already disarmed"* → ลบ SSM state
parameter → `exit 0` **โดยไม่เคยรัน `ALTER ROLE ... NOLOGIN`** แปลว่าสิทธิ์เขียน production
ยังเปิดอยู่ แต่ทุกอย่างรายงานว่าปิดแล้ว และ `status` ก็ตอบ `DISARMED` ด้วยเหตุผลเดียวกัน

แก้เป็น fail closed: query ล้ม / role ไม่มี / ค่าประหลาด → `exit 3` พร้อมข้อความ ไม่เดา

**2. arm สำเร็จได้ทั้งที่ alert ส่งไม่ออก**

`notify` ล้ม (เช่นไม่มี `sns:Publish`) ตอนนั้น `set -e` จะ abort **หลัง** `ALTER ROLE ... LOGIN`
และหลังเขียน SSM param แล้ว → สิทธิ์เขียนเปิดค้างโดยไม่มีใครรู้ ซึ่งทำลายเหตุผลทั้งหมดของ
second-person control แก้ให้ rollback (NOLOGIN + ลบ param) แล้ว exit 1 เมื่อส่ง alert ไม่ได้

**3. deadline เป็นแค่ของประดับ**

`connect-production.sh execute` เช็คแค่ว่า SSM parameter **มีอยู่** ไม่ได้ดู `disarmBy` เลย
พอเลยเวลา parameter ก็ยังอยู่ → เปิด write session ได้ต่อ มีแต่ `status` ที่บ่น OVERDUE
แก้ให้บังคับจริง + ปฏิเสธเมื่อ incident ไม่ตรงกับที่ arm ไว้ + ปฏิเสธเมื่อไม่มี `disarmBy`
(แปลว่า parameter ไม่ได้มาจาก `arm`)

**4. `application_name` ต่อสตริงเข้า conninfo ตรง ๆ**

`operator` มาจาก ARN ซึ่ง IAM อนุญาต `+=,.@-` ถ้ามี `=` หรือช่องว่างจะไปตัด token แล้วกลายเป็น
keyword ใหม่ของ conninfo แก้ด้วย `tr -cd 'A-Za-z0-9._-'` ก่อนฝัง

> **แง่คิด:** ทั้งสี่ข้อคือโค้ดที่ *อ่านแล้วดูถูก* comment อธิบายเจตนาไว้ดีด้วยซ้ำ แต่ไม่เคยถูกรัน
> เหมือน pagination bug ใน `deploy.sh` และ `PGDATABASE` — รูปแบบเดิมซ้ำ ๆ ทั้งวัน
> **ข้อ §1 ที่ยังเหลือ "ซ้อม T1/T2 บน UAT ให้จบหนึ่งรอบ" จึงไม่ใช่พิธีกรรม** มันคือสิ่งเดียว
> ที่จะจับบั๊กประเภทนี้ได้ก่อนถึงเวลาจริง

## สองบั๊กที่เจอตอนทดสอบ session จริงครั้งแรก (2026-08-09)

ทั้งคู่ **ไม่โผล่เลย** ตอนทดสอบผ่าน `ssm send-command` เพราะ Run Command รันเป็น **root**
ส่วน Session Manager รันเป็น **`ssm-user`** — เป็นคนละ user คนละสิทธิ์

**1. `cloudWatchEncryptionEnabled: true` ทำให้เปิด session ไม่ได้เลย**

```
We couldn't start the session because encryption is not set up on the
selected CloudWatch Logs log group.
```

ทั้งที่ `describe-log-groups` ยืนยันว่า `kmsKeyId` ถูกตั้งและ key `Enabled` ปิด flag เป็น `false`
แล้ว session ทำงานทันที และ transcript ยังขึ้น CloudWatch ครบเหมือนเดิม — เพราะตัวที่เข้ารหัสคือ
log group ไม่ใช่ flag นี้

**ผลกระทบถ้าไม่เจอ:** เปิด logging ตอนดึกแล้วเดินจากไป = ล็อกทางเข้า bastion ทั้งหมดโดยไม่รู้ตัว
จะไปเจอตอนเกิด incident จริงซึ่งเป็นเวลาที่แย่ที่สุด

**2. `/opt/rds-ca` เป็น 0700 → `ssm-user` อ่าน CA ไม่ได้**

```
psql: root certificate file "/opt/rds-ca/ap-southeast-1-bundle.pem" does not exist
```

ไฟล์อยู่ครบและเป็น 0644 แต่**ไดเรกทอรี**เป็น `drwx------` เพราะสคริปต์ติดตั้งของผมมี `umask 077`
ไว้บนสุด (ตั้งใจให้ไฟล์ env ที่มี credential ปลอดภัย) แล้วมันไปมีผลกับ `mkdir` ด้วย
`ssm-user` traverse เข้าไม่ได้ psql เลยรายงานว่าไฟล์ไม่มี

แก้: `chmod 0755 /opt/rds-ca` — CA bundle เป็นของสาธารณะ ไม่ใช่ความลับ
**`/opt/watchdog` ยังเป็น 0700 ตามเดิมโดยตั้งใจ** — arm script ต้องรันผ่าน sudo เท่านั้น

**หลักฐานว่าใช้งานได้จริงหลังแก้ทั้งสอง:**

```
watchdog_support_ro|support:INC-2026-0809-smoke:claude-verify|19
ERROR:  cannot execute CREATE TABLE in a read-only transaction
```

และ DB log บันทึกบรรทัดนี้พร้อม `%a`:

```
…:watchdog_support_ro@watchdog_bms:[2298]:1:25006:…:support:INC-2026-0809-smoke:claude-verify:
ERROR:  cannot execute CREATE TABLE in a read-only transaction
STATEMENT:  CREATE TABLE should_fail(x int);
```

**บทเรียน:** ทดสอบด้วยเส้นทางจริงที่ผู้ใช้จะใช้ ไม่ใช่เส้นทางที่สะดวกกับเรา — `send-command`
กับ `start-session` ต่างกันที่ user ซึ่งเป็นตัวแปรที่ทำให้บั๊กทั้งสองซ่อนอยู่
