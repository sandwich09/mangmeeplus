# Agent Memory: production go-live and support access

Status: **D1–D9 RESOLVED ทั้งหมด 2026-08-08** (เจ้าของอนุมัติตามข้อเสนอทุกข้อ, D2 = อีเมลอย่างเดียว
ไม่เพิ่ม SMS) · W3 support access **เขียนและทดสอบแล้ว** · ยังไม่แตะ AWS · ก้อนถัดไปคือ
`infra/production/bootstrap-data.sh` (Redis two-node)
Owner: Platform/security release owner (ยังไม่ระบุตัวบุคคล — ตรงกับ OPEN-1)
Scope: แผนขึ้น production ครั้งแรก + ออกแบบ support access path (view/execute DB role,
emergency ladder) + รวมข้อควรระวังทั้งจาก repo และจาก industry research

## Decisions

- Production คือ first-ever launch ไม่ใช่ upgrade — prod service ทั้งสามอยู่ที่ capacity 0
  และไม่เคย deploy จริง ทำให้ไม่มีข้อมูลลูกค้าให้เสียหาย แต่ทุกเส้นทางจะรันครั้งแรกพร้อมกัน
- **ห้าม reuse `watchdog_a5_prod_ro` เป็น support role** role นั้นผูกกับ fixed query catalog
  ที่ประกอบ `queryCatalogHash` ใน signed evidence การเพิ่มสิทธิ์จะทำให้ evidence chain ของ
  A5/U5 พังเงียบ ๆ จึงเสนอ role ใหม่แยกสองตัว
- Support view role ใช้ `pg_read_all_data` (PG14+) ไม่ใช่ `GRANT SELECT ON ALL TABLES` +
  `ALTER DEFAULT PRIVILEGES` เพราะ default privileges ผูกกับ role ที่สร้าง object และระบบนี้มี
  122 migration แล้วจะมีอีก — fixed list จะขาดตารางใหม่แบบเงียบ ๆ
- View role ต้อง `INHERIT` (ต่างจาก A5 ที่จงใจ `NOINHERIT`) เพราะ `pg_read_all_data`
  ต้อง inherit ถึงทำงาน
- Execute role เป็น `NOLOGIN` เป็น default ต้องมีคนที่สอง arm ให้ และห้ามแตะ
  `_prisma_migrations` (จะทำให้ `verify-applied-migration-catalog.ts` เพี้ยน) กับห้าม
  UPDATE/DELETE `AuditLog`
- **T2 EXECUTE ต้องใช้ SSM interactive shell บน bastion เท่านั้น** ไม่ใช่ port-forward เพราะ
  `AWS-StartPortForwardingSessionToRemoteHost` ไม่บันทึก traffic ในอุโมงค์ — จะไม่มี SQL transcript
- ไม่เสนอ ECS Exec เป็นทาง support: `infra/docker/production-image-security.spec.sh`
  assert `enableExecuteCommand == false` การเปิดจะทำให้ security spec แดง
- pgaudit ใช้ได้แค่ `ddl` เพราะ `write`/`read` จะ log ทุก statement ของ application ด้วย
  และระบบนี้เพิ่งโดน CloudWatch $179 จาก log ingest มาแล้ว

## Open questions (D1–D9 ในแผน)

คำอธิบายละเอียดทุกข้อ + ข้อดีข้อเสีย + ข้อเสนอ อยู่ใน
`docs/plans/production-golive-decisions-explained-th.md` (เขียน 2026-08-08 ตามที่เจ้าของขอ)

**ตอบแล้ว 2026-08-08:**

- **D2 — RESOLVED:** เจ้าของระบบ (thawatchai) เป็นปลายทาง alert เอง
  ยังค้าง: จะเพิ่มช่องทางปลุก (SMS) สำหรับ CRITICAL ไหม — อีเมลอย่างเดียวไม่ปลุกตอนตีสอง
  และ **ห้ามใช้ LINE เป็นช่องทางหลัก** เพราะพึ่งระบบตัวเองที่กำลังเฝ้าอยู่
- **D9 — RESOLVED (= ปิด OPEN-3):** มีแค่ local/UAT/prod → **UAT คือ staging rung**
  ไม่ต้องสร้าง env ที่สี่ และ `deploy-production.yml` บังคับอยู่แล้วผ่านขั้นตอน
  "Verify signed UAT production acceptance" + artifact `uat-accepted-release-<sha>`
  **ข้อจำกัดที่ต้องจำ:** UAT พิสูจน์ความถูกต้องได้ แต่พิสูจน์ migration timing และ
  query plan ที่ data volume จริงไม่ได้ → ต้องใช้ restored clone
- **D7 — บางส่วน:** เจ้าของแจ้งว่าจะสร้าง support user
  **คำเตือนที่บันทึกไว้:** อย่าสร้าง app-level support account ที่มองข้ามบริษัท —
  RBAC ระบบนี้เป็น company-scoped การมี account ถาวรที่เห็นทุก tenant เป็นปัญหา PDPA
  ที่ใหญ่กว่าการอ่าน DB ตรง ๆ ถ้าจำเป็นในอนาคตต้องเป็น time-boxed impersonation
  ที่ลูกค้าอนุญาต + audit ซึ่งเป็นงานคนละก้อนที่ต้องมี spec แยก

**ยังรอตอบ:** D1, D3, D4, D5, D6, D8 (ข้อเสนอของแต่ละข้ออยู่ในเอกสาร explained)

**ข้อค้นพบเพิ่มระหว่างเขียนคำอธิบาย:**

- **gp2 → gp3 คือของฟรี** ที่ 20 GB: gp2 ให้ 100 IOPS (ขั้นต่ำ) ส่วน gp3 ให้ **3,000 IOPS**
  คงที่ และ **ราคาถูกกว่าราว 20%** — ควรทำไม่ว่าจะตัดสิน D1 ยังไง
- **CPU credit ของ t4g ไม่ถูกส่งเข้า CloudWatch** (bug ที่ AWS รับทราบ) → มองไม่เห็นว่า
  แต้มกำลังหมดจนกว่าจะช้าไปแล้ว ทำให้ burstable อันตรายกว่าที่ตัวเลขบอก
- **D5 ผูกกับ H-14 โดยตรง** — H-14 ต้องย้าย service ไป private subnet ซึ่งต้องมี NAT
  หรือ VPC endpoint อยู่แล้ว ถ้าทำ H-14 เมื่อไหร่ ทาง (ข) ของ D5 จะแทบฟรี
- **ช่องว่างจริงของทาง (ก) ใน D5 คือความผิดพลาดของคน** ไม่ใช่ตัว SG — ทางปิดคือ
  alarm บน `AuthorizeSecurityGroupIngress` ของ SG นั้น
- **pgaudit ต่อ role ต้องเป็น superuser** ซึ่ง RDS ไม่ให้ master user เป็น
  **ยังยืนยันไม่ได้ว่า `rds_superuser` ทำได้ไหม — ต้องทดสอบบน UAT ก่อน** อย่าวางแผนโดยสมมติว่าได้

## Artifacts

- `docs/plans/production-golive-and-support-access-plan.md` (เอกสารหลัก)
- อ่านประกอบ: `docs/runbooks/cloud-environment-operations.md`,
  `docs/runbooks/p1-production-security-operations.md`,
  `docs/runbooks/feature-launch-control.md` §7 (OPEN-1/4/8/10/11),
  `docs/agent-memory/production-u5-live-prerequisites.md`,
  `infra/security/verify-production-security-baseline.sh`,
  `apps/api/prisma/bootstrap-a5-readonly.ts`,
  `infra/prod-ecs-express/run-release-task.sh`

## Verification

- ไม่ได้รัน AWS CLI: session นี้ไม่มี credentials (`NoCredentials`) สถานะ infra ทั้งหมดใน
  แผนอ้างจากเอกสารที่บันทึกไว้ 2026-08-07 **ต้อง re-verify ตาม W0 ก่อนลงมือ**
- ข้อเท็จจริงจาก repo ที่ยืนยันด้วยการอ่านไฟล์: role/สิทธิ์ของ A5, gate ใน
  `verify-production-security-baseline.sh`, คำสั่ง release task, จำนวน 122 migration,
  `enableExecuteCommand == false`, ไม่มี `connection_limit` ใน `.env.example`
- **`DATABASE_URL` มาจาก secret `watchdog-bms/${DEPLOY_ENV}/database-url` และ `deploy.sh`
  ฉีดเข้าแค่ api-web (บรรทัด ~1150) กับ workers (~1550)** ai-gateway ไม่ได้รับ ถูกต้องตาม
  สถาปัตยกรรม → การตั้ง `connection_limit` เป็นการ **แก้ค่า secret อย่างเดียว ไม่ต้องแก้โค้ด**
- `bash -n` ผ่านทั้ง `arm-support-execute.sh` และ `connect-production.sh`; shellcheck ไม่มีในเครื่อง
- **`bootstrap-support-roles.sql` รันจริงบน PostgreSQL 16** ใน database ชั่วคราว
  `support_role_check` (สร้างแล้วลบทิ้ง ไม่แตะ `watchdog_bms` ของ dev) — ตารางผลครบอยู่ใน
  แผน §8 ครอบ idempotency, การไม่ disarm ตอนรันซ้ำ, สิทธิ์ทั้ง ro/rw, และ **การพิสูจน์ว่า
  ตารางที่ migration สร้างใหม่ถูกครอบโดย `pg_read_all_data` โดยไม่ต้องรันสคริปต์ซ้ำ**

## บั๊กที่เจอจากการรันจริง (จะไม่เจอถ้าตรวจแค่ syntax)

1. **`has_database_privilege()` รวมสิทธิ์ของ PUBLIC** PostgreSQL grant `TEMPORARY` ให้ PUBLIC
   ทุก database → assertion เดิมเป็นจริงกับ role ที่ไม่เกี่ยวข้องเลย ต้องอ่าน
   `pg_database.datacl` ผ่าน `aclexplode()` เพื่อดูเฉพาะ **direct grant**
   และ **ห้าม revoke TEMP จาก PUBLIC** เพราะจะกระทบสิทธิ์ของแอปเอง
2. **`VAR="$(...)" cmd "$VAR"` ใน bash** ขยาย `$VAR` จาก environment เดิมก่อน assignment มีผล
   → ให้ psql อ่าน `PGDATABASE` จาก environment เอง ซึ่งกัน credential โผล่ใน process table ด้วย
3. **`DROP ROLE` จะ fail ถ้ายังมี `ALTER DEFAULT PRIVILEGES` ค้าง** ต้องยกเลิกก่อนเสมอ

## W1 bootstrap-data.sh — decisions ที่ต่างจาก UAT

- **`put-secret-value` ไม่ใช่ delete+create** สำหรับ `redis-url` — secret ARN ถูกฝังใน
  `valueFrom` ของทุก task definition ARN ใหม่จะทำให้ Redis หายจาก container เงียบ ๆ จนกว่าจะ
  deploy เต็มรอบ และ delete ยังจองชื่อไว้ 7–30 วันถ้าไม่ใส่ `--force-delete-without-recovery`
  (runbook เดิมบันทึกวิธี delete+create ไว้จากเคส UAT — production ไม่ควรทำแบบนั้น)
- **`--engine redis` ระบุชัด** ElastiCache เริ่ม default เป็น Valkey และ verifier assert
  `engine == "redis"` เป๊ะ
- **ต้องมีทั้ง `--automatic-failover-enabled` และ `--multi-az-enabled`** failover อย่างเดียว
  ไม่ผ่านถ้า group อยู่ AZ เดียว → สคริปต์เช็คก่อนว่า private subnet กระจาย ≥2 AZ จริง
- **`--num-cache-clusters 2`** → 1 node group 2 member → `nodeCount` ที่ verifier นับได้ = 2
- **RDS อยู่หลัง `CONFIRM_PRODUCTION_RDS_HARDENING=APPLY`** เพราะทำให้เกิด failover จริง
  default คือ verify แล้วรายงานว่าขาดอะไร ไม่ fail — Redis ทำงานต่อได้โดยไม่ต้องรอ decision
- **verify ปิดท้ายด้วยเงื่อนไขเดียวกับ `verify-production-security-baseline.sh`** ไม่ใช่แค่
  "คำสั่ง AWS ไม่ error" — สคริปต์ที่บอกว่าสำเร็จแปลว่า baseline verifier จะเห็นด้วย

## สิ่งที่อ่านจาก AWS จริงเมื่อ 2026-08-08 (ผ่านเจ้าของ, agent ไม่มี credentials)

- **ไม่มี production Redis เหลืออยู่** `describe-cache-clusters` เห็นแค่ `watchdog-bms-uat-redis`
  (available, engine redis) คำสั่งนี้แสดง node ที่เป็นสมาชิก replication group ด้วย จึงสรุปได้
  → `bootstrap-data.sh` ไม่ต้องลบอะไรก่อน สร้างอย่างเดียว
- NAT `nat-06303bcc18968c82d` ถูกสั่งลบซ้ำ — `delete-nat-gateway` คืน NatGatewayId แม้ลบไปแล้ว
  จึงเป็น no-op (ยืนยันด้วย `describe-nat-gateways` ว่า state=deleted วันที่ 2026-08-07)
- **`watchdog-bedrock-dev` ไม่มีสิทธิ์ ElastiCache แทบทั้งหมด** รวมถึง `DescribeReplicationGroups`
  → พังทั้งตอนสร้าง **และตอน verify ท้ายสคริปต์** ต้องแนบ policy ก่อนเริ่มขั้น 1
- **error สองแบบต้องแยกให้ออก:** `no identity-based policy allows` = แนบ policy เพิ่มได้ผลทันที ·
  `with an explicit deny` = ต้องแก้ policy เดิม (`create-policy-version --set-as-default`)
  `elasticache:DeleteCacheCluster` เป็นแบบหลังและ **เป็น guardrail ที่ตั้งใจ ห้ามปลด**
- แก้ด้วย `infra/production/bootstrap-principal-policy.template.json` — scope ที่ resource ของ
  production ตามชื่อ, ล็อก region, **ไม่มี action ลบสักตัว** (ตรวจแล้วด้วย grep)
  ต้องแนบผ่าน Console เพราะ user นี้แก้ IAM ของตัวเองไม่ได้

## รันจริงครั้งแรก 2026-08-08 — ผลและบทเรียน

**Redis สำเร็จ** สร้าง parameter group + two-node replication group + `put-secret-value` ครบ
**RDS ถูกปฏิเสธด้วย explicit deny** จาก policy `arn:aws:iam::311414082667:policy/WatchDogAppRunnerNetworkingSLR`
บน `rds:ModifyDBInstance` — เป็น guardrail คนละตัวกับที่ deny `elasticache:DeleteCacheCluster`

- **inline policy ที่เพิ่งแนบไม่ช่วยเลย** เพราะ explicit Deny ชนะ Allow เสมอ ตรงกับที่
  `cloud-environment-operations.md` §7 ข้อ 2 เตือนไว้ — ทางแก้คือ **ทำจาก Console ด้วยสิทธิ์คน**
  ไม่ใช่แก้ policy เพื่อปลด deny (guardrail บน automation principal มีไว้แบบนั้นตั้งใจ)
- **บั๊กในสคริปต์ที่เจอจากการรันจริง:** `modify-db-instance` ที่ fail ทำให้ `set -e` ฆ่าสคริปต์
  **ก่อนถึง verification block** operator จึงไม่ได้เห็นเลยว่า Redis ที่สร้างสำเร็จไปแล้วผ่านเกณฑ์ไหม
  แก้เป็นห่อด้วย `if ... then ... else` แล้วรายงานต่อ ให้ verification ได้รันเสมอ
  บทเรียนทั่วไป: **ขั้นตอนที่ถูกปฏิเสธด้วยสิทธิ์เป็นผลลัพธ์ที่คาดหมายได้ ไม่ใช่ crash**
  โดยเฉพาะเมื่องานก่อนหน้า commit ไปแล้ว

## บั๊กใน `verify-production-security-baseline.sh` ที่เจอและแก้ 2026-08-08

**อาการ:** Redis production ที่ถูกต้องทุกประการกลับ FAIL ที่ `snapshotRetentionDays`

**สาเหตุ:** verifier อ่าน `snapshotRetentionDays` จาก `describe-cache-clusters` ของ node ที่เป็น
`CurrentRole == "primary"` แต่ ElastiCache เก็บค่านี้ไว้ที่ **replication group** แล้วสะท้อนลงเฉพาะ
member ที่เป็น `SnapshottingClusterId` ซึ่ง **default เป็น replica** เพื่อไม่ให้ fork ตอน backup
ไปตกบน node ที่รับ traffic อยู่

อ่านจาก AWS จริง 2026-08-08:
```
RG_retention: 35   Snapshotting: watchdog-bms-prod-redis-002
  -002 (replica) 35      -001 (primary) 0   <- verifier อ่านตัวนี้
```

**ผลที่ตามมาถ้าไม่แก้:** M-17 **ผ่านไม่ได้เลย** สำหรับ two-node group ที่ถูกต้อง ทางเดียวที่จะทำให้
primary รายงานค่าได้คือย้าย snapshotting มาที่ primary ซึ่ง **ทำให้ production แย่ลง** (BGSAVE fork
บน `cache.t4g.micro` เสี่ยง latency spike/OOM) หรือใช้ node เดียวซึ่ง M-17 ห้ามอยู่แล้ว —
**ไม่ยอมลดคุณภาพ production เพื่อให้ check ผ่าน**

**สิ่งที่แก้:** บรรทัดเดียว `snapshotRetentionDays:$cluster.SnapshotRetentionLimit`
→ `$rg.SnapshotRetentionLimit` (schema/คีย์/assertion `>= 35` เหมือนเดิมทุกอย่าง)
ยังอ่าน primary cluster ต่อไปเพราะ `engine` กับ `primaryClusterId` ต้องมาจาก node จริง

**ยืนยัน:**
- `production-security-preflight.spec.sh` ผ่าน (spec ทดสอบที่ observation JSON ไม่ใช่แหล่งที่มา
  การเปลี่ยนแหล่งอ่านโดยไม่แตะ schema จึงไม่กระทบ)
- จำลอง observation ด้วยข้อมูล production จริง: เดิม FAIL → หลังแก้ PASS
- **ยัง fail closed:** ใส่ RG retention 7 และ 0 ยังได้ FAIL ทั้งคู่ ไม่ใช่การทำให้ผ่านมั่ว
- แก้ `infra/production/bootstrap-data.sh` ให้อ่านที่เดียวกันด้วย ทั้งส่วนซ่อมและส่วน verify

**บทเรียนทั่วไป:** เมื่อ check ล้มกับ resource ที่ดูถูกต้อง ให้สงสัยว่า check อ่านผิดที่ก่อน —
และห้ามแก้ด้วยการเปลี่ยน production ให้เข้ากับ check

## W1 ปิดจ๊อบแล้ว 2026-08-08 — data plane ผ่านทั้งหมด

```
[prod-bootstrap] PASS redis: encrypted, authenticated, failover enabled, 2 nodes, 35-day snapshots
[prod-bootstrap] PASS rds: encrypted, Multi-AZ, deletion-protected, 35-day backups
```

- **B1 ปิด** — `watchdog-bms/production/redis-url` ชี้ endpoint ใหม่ (ARN เดิม ผ่าน `put-secret-value`)
- **B2 ปิด** — `watchdog-bms-prod-redis` two-node, encrypted at-rest/in-transit, auth token,
  automatic failover, snapshot 35 วัน, parameter group `noeviction`
  members: `-001` primary, `-002` replica (เป็น `SnapshottingClusterId`)
- **B4 ปิด** — RDS `db.t4g.small` + `gp3` (3000 IOPS / 125 MiB/s baseline) + Multi-AZ +
  backup 35 + deletion protection + IAM database auth
- **ครึ่ง M-17 ที่ fail-closed ผ่านแล้ว** เหลือ restore drill (W4) และ secret rotation (ตามหลังได้)

**ยังบล็อก deploy:** M-16 (`LOG_KMS_KEY_ID` + `SECURITY_ALERT_TOPIC_ARN`) และยังไม่ได้ตั้ง
`connection_limit` ใน `database-url`

**อย่าลืมลบสิทธิ์ bootstrap ทิ้ง** — `aws iam delete-user-policy --user-name watchdog-bedrock-dev
--policy-name watchdog-bms-production-data-bootstrap` (สิทธิ์ชั่วคราวไม่ควรค้าง)

## CPU credit หลังเปลี่ยน instance class — จังหวะที่กระทบแผน launch

วัดจริง 2026-08-08 หลังเปลี่ยน `db.t4g.micro` → `db.t4g.small`:

```
09:26-11:26  288.0   เครื่องเก่า micro นิ่ง เต็มเพดาน (max ของ micro = 288)
11:36         0.23   เครื่องใหม่ small เริ่มนับใหม่จากศูนย์
12:16        11.08   ไต่ขึ้น ~16 credit/ชม. (ทฤษฎี 24 ลบ background + Multi-AZ replication)
```

- **เปลี่ยน instance class = credit เริ่มใหม่จากศูนย์ ไม่ยกยอดเก่ามา** เพดานเต็มของ
  `t4g.small` คือ 576 ใช้เวลาสะสม ~24 ชม.
- alarm `db-cpu-credits-low` (threshold 50) จะอยู่สถานะ ALARM ~2.5 ชม. หลังเปลี่ยน
  **เป็นพฤติกรรมที่ถูกต้อง ไม่ใช่ false positive และห้ามลด threshold เพื่อปิดเสียง**
- **ผลต่อแผน:** migration ครั้งแรกไม่กระทบ (DB ว่าง) แต่ **ห้ามเปิด user จริงหรือ load test
  ในวันเดียวกับที่เปลี่ยน instance class** — จะโดน throttle แล้วเข้าใจผิดว่าโค้ดช้า
- **แก้ความเข้าใจผิดก่อนหน้า:** t4g **ส่ง** `CPUCreditBalance` เข้า CloudWatch จริง
  (เคยบันทึกไว้ว่าไม่ส่งตามรายงาน re:Post) — alarm ได้ข้อมูลและเปลี่ยนสถานะได้ปกติ

## ClamAV บน production — สิ่งที่เข้าใจผิดตอนแรกและข้อจำกัดที่เจอ 2026-08-08

**เข้าใจผิดตอนแรก:** คิดว่า `CLAMAV_HOST` ชี้ไปหา scanner ภายนอกที่ต้องมีอยู่ก่อน จึงเสนอว่าเป็น
blocker **ความจริงคือมันเป็นสวิตช์** — `infra/api-web/start-api-web-runtime.sh:29`
`if [ "${CLAMAV_HOST:-}" = "127.0.0.1" ]` แล้วสตาร์ท clamd ที่ bundle มากับ image เอง
(`Dockerfile.api-web:65-77` ติดตั้ง ClamAV 1.5.3, `TCPAddr 127.0.0.1`, `TCPSocket 3310`)
ตั้งค่าเป็น `127.0.0.1` จึงถูกต้อง ไม่ต้องมี infra เพิ่ม

**ข้อจำกัดที่ตามมาและกระทบแผน rollback โดยตรง:**

- `clamd --fail-if-cvd-older-than=7` → **clamd ปฏิเสธสตาร์ทถ้า signature เก่าเกิน 7 วัน**
  signature ถูก bake ตอน build (freshclam daemon เริ่ม *หลัง* clamd ready แล้ว — บรรทัด 33 → 37 → 51)
  ⇒ **rollback ไป image ที่ build เกิน 7 วัน = container ขึ้นไม่ได้เลย** ไม่ใช่ขึ้นแบบไม่มี scan
  ⇒ ถ้าต้องย้อนเกิน 7 วัน **ต้อง build ใหม่จาก commit เก่า** ไม่ใช่ deploy digest เดิม
  ⇒ ECR lifecycle ที่เก็บ 20 image ไม่ได้แปลว่า rollback ได้ 20 จุด
- clamd ready ใช้เวลาสูงสุด 120 วินาทีก่อนแอปตอบ health ได้ → ตอน canary bake จะดูช้ากว่าปกติ
  **อย่าตีความว่าล้มแล้วไปกด rollback เอง** ดู `list-service-deployments` อย่างเดียว

**การทดสอบในเครื่องบอกอะไรได้/ไม่ได้:** `pnpm security:m14-evidence` บน laptop ผ่าน 19 เช็คแรก
(metadata + content inspection: EICAR in PDF, polyglot, SVG smuggling, PDF /OpenAction, object bomb)
แล้วตายที่ `ECONNREFUSED` เพราะไม่มี clamd ในเครื่อง — **ไม่ใช่สัญญาณว่า production พัง**
แต่เป็นการยืนยัน fail-closed behavior ที่ m14 doc เตือนไว้

## มติที่เปลี่ยนจาก D4 เมื่อ 2026-08-08 (เจ้าของตัดสิน)

| | D4 เดิม | ที่ตั้งจริง |
| --- | --- | --- |
| `CRM_AUTO_REPLY_ENABLED` | `false` | **`true`** |
| `LINE_AI_AGENT_RUNTIME` | `disabled` | **`strands-local`** |
| `CLAMAV_HOST` | ไม่ตั้ง (ตามมติ 2026-07-28) | **`127.0.0.1`** |

**ผลที่ต้องจำ:** เหตุผลเดิมที่ M-01 "ไม่บล็อก" คือจะปิด AI ไว้ก่อนแล้วค่อยเก็บหลักฐาน
เมื่อ AI เปิดตั้งแต่วันแรก **เหตุผลนั้นหายไป** → ต้องเก็บ live evidence ของ M-01
(substitution, replay, cross-company, audience, Redis-unavailable) ให้เร็วที่สุดหลัง deploy
ตัวกันความเสียหายที่ยังทำงาน: `CRM_AI_OUTBOUND_ALLOWED_DOMAINS=mangmeeplus.com`,
`CRM_AI_MIN_CONFIDENCE=0.7` และ per-channel toggle ใน ตั้งค่า LINE OA ที่ต้องเปิดอีกชั้น

## GitHub production variables ที่ตั้งครบแล้ว 2026-08-08

`BEDROCK_REGION=ap-southeast-1` · `MODEL_PROVIDER=bedrock` · `PUBLIC_DOMAIN_URL=https://mangmeeplus.com`
`LINE_LOGIN_CHANNEL_ID=2010515251` · `LINE_LIFF_ID=2010515251-rvdZJ8la` · `LINE_MESSAGING_CHANNEL_ID=2010514513`
`CLAMAV_HOST=127.0.0.1` · `CRM_AUTO_REPLY_ENABLED=true` · `LINE_AI_AGENT_RUNTIME=strands-local`
`CRM_AI_MIN_CONFIDENCE=0.7` (เจอเพิ่มระหว่างทาง — required, ไม่มี fallback)

**ห้าม copy LINE ID จาก UAT** — `uat-environment.md` ระบุว่า UAT ใช้ **isolated** channel
`2010784350`/`-ruzn5beM`/`2010784371` แยกจาก production โดยตั้งใจ

## Deploy ครั้งแรก 2026-08-08 — startup failure + ค้นพบว่าไม่มีโหมด deploy ธรรมดา

- run 31243639486 (`release_ref=2a78266`, `target=api-web`) จบที่ **startup_failure** —
  workflow ไม่เริ่มรันเลย ข้อความจริงอ่านได้จากหน้า run ใน UI เท่านั้น (annotation API คืนว่าง)
  static ตรวจหมดแล้ว: YAML ผ่าน, job graph ถูก, input 10 ตัวพอดีลิมิต, `ci.yml` ประกาศ
  `workflow_call` ตรง — ผู้ต้องสงสัยที่เหลืออยู่ฝั่ง Settings (environment protection / Actions policy)
- **`validate-production-release-intent.sh` มีแค่ 2 โหมด**: `target=all` = promotion
  (บังคับ UAT producer run + bridge 4 ตัว + U5/A5 ceremony ทั้ง chain) ·
  `target=เดี่ยว` = partial-incident (บังคับ `INC-...` + `approval://...`) —
  **คำสั่ง deploy ที่ให้ไปตอนแรกผิดทั้งสองทาง** ไม่มีโหมด "แค่ release_ref + target"
- UAT run 31207038953 (`d3e08f4`) มี acceptance artifact ครบและ SHA reachable จาก main —
  ใช้ promote ได้โดยไม่รัน UAT ใหม่ ถ้ายอมไม่ได้ 4 commit ล่าสุด; โค้ดปัจจุบันต้อง
  UAT `a1dd5ba` ก่อน

## Audit ก่อน promote (2026-08-08) — `production-promotion-readiness-audit.md`

เจ้าของสั่งหยุดก่อน promote แล้วตรวจรอบด้าน ผลอยู่ใน
`docs/plans/production-promotion-readiness-audit.md` ประเด็นที่ค้นพบใหม่:

- **Migration state ของ prod DB ไม่เคยถูกตรวจ และเสี่ยงจริง**: AWS resource มาจาก repo เก่า
  ที่ deploy production ช่วง 2026-07-03–10 ⇒ DB น่าจะมี `_prisma_migrations` อยู่แล้ว ขณะที่
  `migration-drift-diagnosis.md` บันทึกว่าไฟล์ migration ถูกแก้ (5 checksum mismatch บน dev,
  fix landed in repo) และ `verify-applied-migration-catalog.ts` เทียบชื่อ+sha256 จริง —
  ถ้า prod mismatch, release จะล้มกลางทาง ต้องตรวจผ่าน bastion ก่อน (audit §8.3)
- ทางแยก A (full ceremony — ขาด A5 network/IAM/DB reader/clone rehearsal/policy token,
  หลายวัน) vs B (partial-incident — ทำได้เลยแต่ audit trail เป็น incident ต้องบันทึกมติ)
  vs C (แก้ workflow — security change ต้อง review) — **ยังไม่ตัดสิน**
- clone rehearsal ของทาง A = restore drill ของ M-17 ในตัว (งานเดียวได้สอง)
- Alarm ที่ยังขาด: RDS FreeStorageSpace (20GB), FreeableMemory, ALB 5xx steady-state
- ยังไม่มี AWS Budget / Cost Anomaly Detection · ประมาณการหลัง launch ~$270–320/เดือน
- UAT Redis เก่า (ไม่เข้ารหัส) ต้องถูกแทน**ในรอบเดียวกับ** UAT acceptance run ถัดไป
- ไม่มี load test tooling ใน repo เลย — ถ้าจะทำ ให้ยิงที่ UAT ไม่ใช่ prod
- M-01 ยกระดับความเร่งเพราะ AI เปิดวันแรก (มติเจ้าของเปลี่ยนจาก D4)

## ตรวจ migration state จริงบน production 2026-08-08 — พบ drift 1 ตัว แก้ง่าย

เข้า bastion ผ่าน SSM (identity root ผ่าน CloudShell — automation user `watchdog-bedrock-dev`
เข้าไม่ได้เพราะไม่มี `ssm:StartSession` และ **ไม่ควรมี** ตรงหลัก OPEN-1) แล้ว query DB ผ่าน writer

- **prod DB ไม่ว่าง** — repo เก่า deploy ไว้ (`GIT_SHA=6d66bdc7`, 07-19) `_prisma_migrations` 70 แถว
- เทียบ checksum ครบ 70: **69 ตรง / 1 drift / 0 orphan / 0 failed**
- drift = `20260714120000_item11b_transaction_tax_schema` (prod dirty-deploy draft 07-14 ก่อน
  immutable pipeline) — **schema ถูกแก้แล้ว** โดย `heal_item11b` ที่ prod applied ไว้ เหลือแค่
  ตัวเลข checksum ในตาราง metadata ที่ยังชี้ draft เก่า
- **แก้แล้ว 2026-08-08** ด้วย metadata-only UPDATE (checksum → `1e8e73d2...`) ยืนยัน SELECT ได้ 1 row
  prod DB 70 แถวตรงไฟล์หมด 0 drift — รายละเอียด + คำสั่งเต็มใน
  **`docs/runbooks/production-migration-reconciliation.md`** ทำผ่าน bastion writer **ก่อน** dispatch
  deploy ไม่งั้น `prisma migrate deploy` ปฏิเสธทั้ง batch (51 migration ใหม่) ก่อน rollout
- ตัว drift อื่นที่ diagnosis doc เตือน (company_booking_buffer, crm_product_service_catalog CHECK)
  **ไม่ปรากฏใน prod** เพราะ prod อยู่ 07-19 deploy จาก committed ref — ตรงกับ inference ใน doc

## Infra ที่ตั้งเพิ่มระหว่างตรวจ 2026-08-08

- inline policy `watchdog-bms-operator-ssm` บน `watchdog-bedrock-dev` — `ssm:StartSession` บน
  bastion (แต่ CLI propagation ช้า เข้าจริงผ่าน CloudShell/root)
- inline policy `watchdog-bms-bastion-read-support-secrets` บน **role**
  `watchdog-bms-ssm-bastion-role` — `secretsmanager:GetSecretValue` scope แค่ `database-url`
  กับ `a5-readonly-database-url` (template: `infra/production/bastion-instance-role-policy.template.json`)
- **RDS SG allow 5432 จาก bastion SG** (SG-to-SG) — **เก็บถาวรตามมติเจ้าของ** เป็น support path
  setup ที่ตั้งใจ ไม่ใช่ workaround (บันทึกใน support-access runbook §1)
- `WatchDogAppRunnerNetworkingSLR` deny statement `NeverTouchProductionDataStores` ครอบแค่
  elasticache/rds mutation บน prod resource — **ไม่มี ssm** (เคยเดาผิดว่ามี)

## Next

- เจ้าของรันตาม `docs/runbooks/production-golive-aws-commands.md` ขั้น 0 → 8
- ปิดช่องว่าง: ย้าย `arm-support-execute.sh` เป็น mode ของ `run-release-task.sh` เพื่อให้
  bastion ไม่ต้องถือ writer credential — ตราบใดที่ยังไม่ทำ การแยก "คนดู" กับ "คนเขียน"
  เป็นข้อตกลง ไม่ใช่การบังคับด้วยระบบ
- ซ้อม support path บน UAT ให้จบหนึ่งรอบ ห้ามซ้อมครั้งแรกตอน incident จริง
- `bootstrap-support-roles.sql` ทดสอบบน PostgreSQL 16 แล้ว แต่ **ยังไม่เคยรันบน RDS** —
  `rds_iam` guard จะทำงานจริงครั้งแรกตอนขั้น 7.4
