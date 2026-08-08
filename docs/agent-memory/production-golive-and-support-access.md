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

## Next

- เจ้าของรันตาม `docs/runbooks/production-golive-aws-commands.md` ขั้น 0 → 8
- ปิดช่องว่าง: ย้าย `arm-support-execute.sh` เป็น mode ของ `run-release-task.sh` เพื่อให้
  bastion ไม่ต้องถือ writer credential — ตราบใดที่ยังไม่ทำ การแยก "คนดู" กับ "คนเขียน"
  เป็นข้อตกลง ไม่ใช่การบังคับด้วยระบบ
- ซ้อม support path บน UAT ให้จบหนึ่งรอบ ห้ามซ้อมครั้งแรกตอน incident จริง
- `bootstrap-support-roles.sql` ทดสอบบน PostgreSQL 16 แล้ว แต่ **ยังไม่เคยรันบน RDS** —
  `rds_iam` guard จะทำงานจริงครั้งแรกตอนขั้น 7.4
