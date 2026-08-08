# Production Promotion Readiness Audit

ตรวจ 2026-08-08 (หลัง W1/W2 เสร็จ, PR #1 merge แล้ว, deploy ครั้งแรกจบที่ startup failure)
คู่กับ: `production-golive-and-support-access-plan.md` (แผนหลัก) และ
`docs/runbooks/production-golive-aws-commands.md` (คำสั่ง)

ทุกข้อระบุว่า **ต้องทำก่อน promote** หรือ **ตามหลังได้** — ไม่มีข้อไหนคลุมเครือโดยตั้งใจ
ข้อที่ตรวจสดไม่ได้จาก session นี้ (ไม่มี AWS credentials) มีคำสั่งให้เจ้าของรันใน §8

---

## 0. สรุป

**เสร็จแล้ว:** data plane ผ่าน M-17 baseline ทั้งคู่ (Redis two-node encrypted, RDS
small/gp3/Multi-AZ/backup35/delProt/IAM) · M-16 เกือบปิด (KMS + SNS + อีเมลยืนยัน + ทดสอบส่งจริง) ·
alarm 6 ตัว · ECR lifecycle · GitHub variables ครบ (parity check exit 0) · `connection_limit=10`

**Blocker เรียงตามลำดับที่ต้องเจอ:**

1. **Startup failure ของ `deploy-production.yml`** — workflow ไม่เริ่มรันเลย สาเหตุอ่านได้จาก
   หน้า run ใน UI เท่านั้น (annotation ไม่ออกทาง API) — บล็อกทุกเส้นทาง
2. **เส้นทาง deploy มีแค่ 2 โหมด ไม่มี "deploy ธรรมดา"** — ต้องเลือกทาง (§1)
3. **สถานะ migration ของ prod DB ไม่เคยถูกตรวจ** — มีความเสี่ยง checksum drift จริง (§6.1)
4. รายการต่อด้านใน §2–§7

---

## 1. ทางแยกที่ต้องตัดสินก่อนทุกอย่าง — เส้นทางขึ้น production

`validate-production-release-intent.sh` มีสองโหมดเท่านั้น และ **`target` เป็นตัวเลือกโหมด**:

| | `target=all` → **promotion** | `target=<เดี่ยว>` → **partial-incident** |
| --- | --- | --- |
| ต้องส่ง | `promote_from_run_id` (UAT producer run) + bridge 4 ตัว | `direct_partial_incident=true` + `incident_ref` (`INC-...`) + `incident_approval_ref` (`approval://...`) |
| UAT acceptance artifact | บังคับ (SHA เดียวกัน) | ไม่ใช้ — build ใหม่ผ่าน ci.yml เต็ม |
| U5/A5 ceremony | **บังคับทั้ง chain** | ข้าม |
| ความหมายใน audit trail | release ปกติ | **incident** |

### ทาง A — promotion เต็มรูปแบบ (ตามที่ระบบออกแบบ)

สิ่งที่ยังขาดทั้งหมด (ตรวจแล้วรายตัว):

- [ ] A5 private network — `bootstrap-production-a5-private-network.sh` ไม่เคยรัน
      (SSM param `ParameterNotFound`) — **ไม่ใช่ NAT**: สคริปต์สร้างเครือข่ายแบบ **endpoint-only
      โดยออกแบบ** (PrivateLink ECR/Logs/Secrets + S3 gateway prefix list, "no CIDR egress")
      ค่า interface endpoint ~$7.3/ตัว/AZ/เดือน ≈ **$44–58/เดือนแบบ recurring** หรือสร้างเฉพาะ
      ช่วงทำ ceremony แล้วลบ (คิดเงินรายชั่วโมง) — runbook §7 ข้อ 6 ที่พูดถึง NAT
      ใช้กับ private mode ของ service ทั่วไป (H-14) ไม่ใช่ A5
- [ ] A5 IAM roles (`bootstrap-production-a5-readonly.sh`)
- [ ] A5 DB reader + secret `a5-readonly-database-url` — **ยังไม่มีใน production** (ยืนยันจาก parity check)
- [ ] H2A isolated-clone rehearsal run (`production-a5-clone.yml`) — ต้อง restore snapshot เข้า
      subnet แยก ⇒ **อันเดียวกับ restore drill ของ M-17 — ทำครั้งเดียวได้สองอย่าง**
- [ ] A5 PRE_MUTATION evidence (`production-a5.yml`)
- [ ] U5 shadow aggregate PRE_AUTHORIZATION (`u5-shadow-evidence.yml`)
- [ ] Owner approval (`u5-owner-approval.yml`) — อายุ **1800 วินาที** ต้อง orchestrate ให้ทัน
- [ ] `PRODUCTION_POLICY_READ_TOKEN` fine-grained token — open question ใน
      `production-u5-live-prerequisites.md` ยังไม่เคยสร้าง
- [ ] UAT deploy + acceptance ของ SHA ที่จะ promote (§ด้านล่าง)

ประเมินตรง ๆ: **หลายวัน** และลากการตัดสินใจเรื่อง network (D5/H-14) เข้ามาด้วย

### ทาง B — partial-incident ทีละ service (ทำได้ทันทีหลังแก้ startup failure)

- ได้: build ใหม่จาก SHA ปัจจุบันผ่าน CI gate เต็ม ไม่ต้องมี U5 chain
- เสีย: ต้องรัน 3 รอบ (api-web → ai-gateway → workers) จ่าย canary ทีละรอบ และ
  **audit trail บันทึกการขึ้นครั้งแรกเป็น incident** — ยืมเส้นทางกู้ระบบมาใช้กับงานปกติ
- ถ้าเลือก: ต้องบันทึกมติพร้อมเหตุผล + ใช้ `incident_ref`/`approval_ref` ที่ชี้กลับมาที่เอกสารมตินั้นจริง

### ทาง C — แก้ workflow เพิ่มโหมด first-launch

- สะอาดที่สุดเชิงความหมาย แต่เป็นการ **แก้ไฟล์ security-critical** ต้องผ่าน PR + คนที่สอง review
  + บันทึกเหตุผล — ห้ามทำเงียบ ๆ

**ข้อเท็จจริงประกอบ:** UAT run ล่าสุด (31207038953) deploy `d3e08f4` และมี artifact acceptance ครบ
`d3e08f4` reachable จาก main ⇒ ในทาง A สามารถ promote `d3e08f4` ด้วย artifact เดิมโดยไม่ต้องรัน UAT
ใหม่ — แต่จะไม่ได้ nanoid fix (build-time เท่านั้น ผลต่ำ) และไม่ได้ 4 commit ล่าสุด
ถ้าจะ promote โค้ดปัจจุบัน ต้อง deploy UAT ด้วย `a1dd5ba` (develop head ซึ่ง reachable จาก main
ผ่าน merge) ก่อน

---

## 2. ความปลอดภัย

| รายการ | สถานะ | ก่อน promote? |
| --- | --- | --- |
| Startup failure ของ deploy workflow | ❌ ไม่รู้สาเหตุ — อ่านจาก UI | 🔴 บล็อกทุกทาง |
| M-16 log/alert | KMS+SNS+อีเมล+ทดสอบส่ง ✅ · retention/filter/alarm ต่อ log group เกิดตอน deploy | 🟠 ปิดสมบูรณ์ได้หลัง deploy แรก (เก็บ acknowledgement evidence) |
| M-17 Redis/RDS | PASS ทั้งคู่ ✅ | ✅ แล้ว |
| M-17 restore drill | ยังไม่ทำ | 🟠 ทำใน W4 — **ถ้าเลือกทาง A มันคืองานเดียวกับ clone rehearsal** |
| M-17 secret rotation | ยังไม่ทำ | 🟢 ตามหลังได้ |
| **M-01 actor delegation** | โค้ด+เทสครบ · live evidence ยังไม่มี | 🟠 **ยกระดับจาก D4 เดิม** — เจ้าของเปิด `CRM_AUTO_REPLY_ENABLED=true` + `strands-local` ⇒ AI ทำงานวันแรก ต้องเก็บ evidence (substitution/replay/cross-company/audience/Redis-down) ทันทีหลัง deploy |
| H-14 private cutover | โค้ดปิดครึ่งอันตรายแล้ว · network ยังไม่ย้าย | 🟡 ตามเงื่อนไข D4: หมุน `WORKER_INTERNAL_TOKEN`+`AI_GATEWAY_INTERNAL_SECRET` ก่อน launch + กำหนดวัน cutover |
| M-18 supply chain | CI ทำ SBOM/sign/scan ทุก run | 🟢 ปิดตัวเองตอน deploy จริงครั้งแรก |
| Bastion hardening (§1 ของ support runbook) | **ยังไม่ verify สักข้อ** — SG zero-inbound, IMDSv2, SSM session logging | 🔴 ก่อนใช้ support path และควรก่อน deploy (bastion เปิดค้างอยู่ + มี public IP) |
| Support DB roles | SQL พร้อม+ทดสอบแล้ว · **ต้องรอยืนยัน schema บน prod ก่อน** (§6.1) | 🟠 หลังยืนยัน migration state |
| arm-support-execute ถือ writer credential บน bastion | ช่องว่างที่บันทึกไว้ | 🟢 follow-up (ย้ายเป็น release-task mode) |
| UAT Redis ตัวเก่า (ไม่เข้ารหัส) ยังไม่ถูกแทน | จอดที่ 0 นาฬิกาหยุดเดิน | 🟡 **ต้องทำตอนเปิด UAT รอบ acceptance** — เปิดกลับมาเมื่อไหร่ security state วิ่งเข้าก้อนที่ไม่เข้ารหัสทันที และการแทนต้อง deploy (secret ARN ใหม่) ซึ่งคือ deploy ที่กำลังจะทำอยู่แล้ว |
| ClamAV rollback window | image เก่าเกิน 7 วันสตาร์ทไม่ขึ้น (`--fail-if-cvd-older-than=7`) | บันทึกแล้ว — แผน rollback ต้อง build ใหม่จาก commit เก่า ไม่ใช่ deploy digest เดิม |

## 3. การใช้งานจริง

| รายการ | ต้องทำ | เมื่อไหร่ |
| --- | --- | --- |
| **DNS/Cloudflare** | ยืนยันว่า `mangmeeplus.com` ชี้ที่ไหนตอนนี้ และหลัง deploy ต้องชี้ URL ของ `watchdog-bms-api-web-pub` — ตรวจ TLS chain ครบทุก listener | ก่อนประกาศใช้งาน |
| **LINE Messaging webhook** | channel `2010514513` webhook URL → endpoint production | หลัง deploy ก่อนเปิดใช้ |
| **LIFF endpoint** | LIFF `2010515251-rvdZJ8la` endpoint ต้องเป็น `https://mangmeeplus.com/v1/auth/line/link-page` — เคยพัง 400 เพราะชี้ host `on.aws` เก่า (บันทึกใน `owner-member-line-link-qr-handoff.md`) | หลัง deploy |
| LIFF + OA provider เดียวกัน | เงื่อนไข B9 identity join | ยืนยันครั้งเดียว |
| Seed admin | secret `seed-system-admin-password` มีแล้ว — ทดสอบ first-login change-password flow | smoke แรก |
| Per-channel AI toggle | `CRM_AUTO_REPLY_ENABLED=true` เป็นแค่ครึ่งเดียว — ต้องเปิด toggle ใน ตั้งค่า LINE OA (สิทธิ์ `crm.channel.manage`) ต่อ channel | ตอนพร้อมให้ AI ตอบจริง |
| Smoke หลัง deploy | login (รหัสผ่าน+LINE) · **upload ใบเสร็จ 1 ใบ (พิสูจน์ clamd + S3)** · สร้าง expense · webhook รับข้อความ · notification ส่งออก | ทันทีหลัง bake ผ่าน |

## 4. การรับโหลด

| รายการ | สถานะ / ต้องทำ |
| --- | --- |
| CPU credit | เริ่มจากศูนย์เมื่อ 11:36 วันนี้ สะสม ~16/ชม. เต็ม (576) ราว **เที่ยงวันพรุ่งนี้ 2026-08-09** — deploy ได้ (migration บน DB ว่างไม่กิน CPU) แต่ **ห้ามเปิด user จริง/load test ก่อนเต็ม** |
| Load test | **ไม่เคยมีเลย และ repo ไม่มี tooling** (ไม่มี k6/artillery) — แนะนำยิงที่ UAT (spec เท่ากัน) ตอนเปิดรอบ acceptance ไม่ใช่ที่ prod · **ห้ามยิงระหว่าง canary bake** (429 นับเข้า rollback alarm) |
| Connection budget | 67 peak / 225 max ✅ (`connection_limit=10` ตั้งแล้ว) |
| Rate limit | in-process ต่อ task — 2 task = เพดานจริง ×2 ของค่าที่ตั้ง |
| Capacity | ถูกตรึง 1/2 (AVERAGE_CPU 70) โดย literal ใน `collect-production-a5-current-health.sh` — จะ scale เกินนี้ต้องแก้สองที่พร้อมกัน |
| Redis | fill rate ที่วัดจริง ~17 key/นาที · alarm 75% มีแล้ว · `noeviction` = เต็มแล้ว write error ไม่ใช่ลบเงียบ |

## 5. การตรวจ log

| รายการ | สถานะ |
| --- | --- |
| Retention 90 วัน + KMS + metric filter + HIGH/CRITICAL alarm ต่อ log group | เกิดอัตโนมัติตอน deploy (deploy.sh §613–640) — ตัวแปรพร้อมแล้ว ✅ |
| Log-ingest alarm | มีครบ 3 log group (512 MB/ชม./ตัว) — **service ที่ 4 ต้องเพิ่มมือ** (SEARCH ใช้กับ alarm ไม่ได้) |
| Alarm ที่ **ยังขาดและควรเพิ่มก่อน launch** | `RDS FreeStorageSpace` (มีแค่ 20 GB!), `RDS FreeableMemory`, ALB target 5xx แบบ steady-state (ตัวที่มีคือ canary rollback alarm ซึ่งเกิดเฉพาะตอน deploy) — คำสั่งใน §8.4 |
| Logs Insights query สำหรับ incident | อยู่ใน `production-support-access.md` §2 ✅ |
| Dashboard | ไม่มี — optional ไม่บล็อก |

## 6. การหา issue ใน DB

### 6.1 ⚠️ ความเสี่ยงที่ยังไม่ถูกตรวจ: migration state ของ prod DB

ข้อเท็จจริงประกอบกัน:

1. AWS resource ทั้งหมดมาจาก **repo เก่า** (`sandwich09/WatchDog-BMS`) ซึ่ง deploy production
   จริงช่วง 2026-07-03–10 ⇒ **prod DB น่าจะมี schema + แถว `_prisma_migrations` อยู่แล้ว**
   ("production ยังไม่เคย deploy" หมายถึง repo ใหม่เท่านั้น)
2. `migration-drift-diagnosis.md` บันทึก drift จริง: **5 checksum mismatch + 1 orphan row**
   บน dev DB — แก้แล้วและ **fix landed in repo** (ไฟล์ migration ถูกแตะ) แต่ **prod ไม่เคยถูกตรวจ**
3. `verify-applied-migration-catalog.ts` เทียบ **ชื่อ + sha256 ของไฟล์** กับแถวที่ applied
   และ release task รัน `prisma migrate deploy` ก่อน deploy ทุกครั้ง

⇒ ถ้า prod มีแถว applied ที่ checksum ไม่ตรงกับไฟล์ชุดที่แก้แล้ว **release จะล้มกลางทาง**
หลังเสียเวลา build ไปแล้ว ตรวจก่อนด้วยคำสั่งใน §8.3 — ผลสามแบบ:

- ตาราง `_prisma_migrations` ไม่มี ⇒ DB ว่างจริง migration รันสดทั้ง 122 ตัว — ง่ายสุด
- มีและ checksum ตรงหมด ⇒ ผ่าน
- มีและ mismatch ⇒ ต้องทำ reconciliation แบบเดียวกับที่ทำบน dev (มี playbook ใน
  `migration-drift-diagnosis.md`) **ก่อน** deploy — ห้ามแก้แถวมือโดยไม่บันทึก

### 6.2 เครื่องมือวินิจฉัยที่ควรมี

| เครื่องมือ | สถานะ | ทำ |
| --- | --- | --- |
| Performance Insights | ไม่รู้สถานะ | เปิด (free tier 7 วัน) — §8.2 |
| `pg_stat_statements` | ยังไม่มี | `CREATE EXTENSION` หลัง deploy ผ่าน support role ไม่ได้ (DDL ถูกกัน) — ใช้ writer ตอน bootstrap support roles รอบเดียวกัน |
| `log_min_duration_statement` | default (ปิด) | ตั้ง ~2000ms ผ่าน custom parameter group — **อย่าตั้งต่ำ** ระวังค่า log ingest |
| Support path T0/T1/T2 | สคริปต์+runbook พร้อม · bastion ยังไม่ hardening · ยังไม่ซ้อม | ทำตาม §1 ของ support runbook แล้ว**ซ้อมบน UAT ให้จบหนึ่งรอบ** |

## 7. ค่าใช้จ่าย

ประมาณการรายเดือนหลัง production รันจริง (min 1 task ทุก service) — อ้างอิงตัวเลขที่วัดจริงจาก
runbook ที่ทำได้: จอด UAT (Fargate 3 service + 3 public IP spec เดียวกัน) ประหยัด ~$113/เดือน

| รายการ | ประมาณ/เดือน |
| --- | --- |
| Fargate 3 service + public IP (spec เดิม 2/6, 1/2, 0.5/1) | ~$113 (×~2 ถ้าวิ่งที่ max 2 task) |
| RDS prod `t4g.small` **Multi-AZ** + gp3 20GB×2 + backup 35 วัน | ~$55–65 |
| Redis prod 2× `cache.t4g.micro` + snapshot | ~$26–28 |
| RDS UAT (micro, single) | ~$13.5 |
| Redis UAT (ตัวเก่า จนกว่าจะแทน) | ~$13 |
| ALB + EIP | ~$30 |
| Secrets Manager (~34 ตัว) | ~$9–13 |
| Bastion (เปิดค้าง — มติ D6) | ~$7.4 |
| KMS + ECR + SNS + alarms | ~$3 |
| Bedrock (baseline เดิม) | ~$3–5 → **โตตามการใช้ AI จริง เพราะเปิด autonomy วันแรก** |
| CloudWatch logs/metrics | ตัวแปรใหญ่สุด — alarm 512MB/ชม. คุมไว้แล้ว |
| **รวมคร่าว ๆ** | **~$270–320/เดือน** (จาก ~$47 ตอนจอดทุกอย่าง) |

**เรื่อง NAT (มติแนวทาง 2026-08-08):** เจ้าของเห็นว่า NAT Gateway ไม่คุ้ม — สรุปแนวทางที่ตกลง:

- **Launch: $0** — ทุก service อยู่ public subnet ออกทาง IGW เหมือน UAT (NAT ไม่เกี่ยวข้องกับการขึ้น production เลย)
- **H-14 cutover: ใช้ NAT instance (`t4g.nano`, ~$4–5/เดือน) แทน NAT Gateway ($43.90 + $0.045/GB)**
  traffic จริงคือ JSON ไป LINE API — แบนด์วิดท์ nano เหลือเฟือ · trade-off ที่ยอมรับ: ไม่ HA
  (ตายแล้ว workers ส่ง LINE ไม่ได้จน restart), patch ผ่าน SSM Patch Manager ·
  หักค่า public IPv4 ที่ประหยัดได้ (~$7.3/เดือนจาก 2 task ที่ย้ายเข้า private) ≈ **cost-neutral**
  · อัปเกรดเป็น NAT Gateway ทีหลังได้ด้วยการสลับ route เดียว
- **ทำคู่กันตอน cutover: S3 gateway endpoint (ฟรี)** — ECR layer pulls ไม่ต้องวิ่งผ่าน NAT
- **A5 (ถ้าทาง A): interface endpoints สร้างเฉพาะช่วง ceremony แล้วลบ** (คิดรายชั่วโมง)
  ไม่จ่าย recurring
- IPv6 + egress-only gateway = ฟรี แต่ต้องพิสูจน์ก่อนว่า LINE API รองรับ IPv6 — ตัวเลือกไว้ทดสอบ
  ตอนทำจริง ห้ามวางแผนบนสมมติฐานนี้

**ยังไม่ได้ทำและควรทำก่อน launch:**

- [ ] AWS Budget รายเดือน + alert ที่ 80%/100% เข้า SNS topic เดิม — §8.5
- [ ] Cost Anomaly Detection — ตาข่ายที่ครอบ service ใหม่อัตโนมัติ (ต่างจาก per-log-group alarm)
- [ ] จอด UAT กลับที่ 0 ทันทีหลังจบรอบ acceptance (~$3.7/วันตอนเปิด)

กับดักที่บันทึกไว้แล้วแต่ต้องจำตอนอ่านบิล: Cost Explorer โพสต์ข้าม 24 ชม. + คิด $0.01/query ·
CloudWatch คิดจาก raw ingest (storedBytes หลอก ~20 เท่า) · `imageSizeInBytes` ของ ECR นับ layer ซ้ำ

---

## 8. คำสั่งตรวจสดที่ต้องรัน (session นี้ไม่มี AWS credentials)

### 8.1 Bastion (ก่อนใช้ support path / ก่อน deploy)

```sh
BASTION=$(aws ec2 describe-instances --region ap-southeast-1 \
  --filters 'Name=tag:Name,Values=watchdog-bms-ssm-bastion' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[].Instances[].InstanceId' --output text)
BSG=$(aws ec2 describe-instances --instance-ids "$BASTION" --region ap-southeast-1 \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
# ต้องได้ [] เท่านั้น
aws ec2 describe-security-groups --group-ids "$BSG" --region ap-southeast-1 \
  --query 'SecurityGroups[0].IpPermissions'
# IMDSv2 ต้องเป็น required
aws ec2 describe-instances --instance-ids "$BASTION" --region ap-southeast-1 \
  --query 'Reservations[0].Instances[0].MetadataOptions.HttpTokens'
```

### 8.2 RDS วินิจฉัย

```sh
aws rds describe-db-instances --db-instance-identifier watchdog-bms-prod-db --region ap-southeast-1 \
  --query 'DBInstances[0].{pi:PerformanceInsightsEnabled,paramGroup:DBParameterGroups[0].DBParameterGroupName,storage:StorageType,class:DBInstanceClass}'
# ถ้า pi=false: เปิดฟรี 7 วัน retention
aws rds modify-db-instance --db-instance-identifier watchdog-bms-prod-db \
  --enable-performance-insights --performance-insights-retention-period 7 \
  --apply-immediately --region ap-southeast-1
```

### 8.3 ⚠️ Migration state (ผ่าน bastion — สำคัญสุดใน section นี้)

```sh
aws ssm start-session --target "$BASTION" --region ap-southeast-1
# บนเครื่อง bastion (ต้องมี psql + สิทธิ์อ่าน secret database-url):
# WRITER="$(aws secretsmanager get-secret-value --secret-id watchdog-bms/production/database-url \
#   --query SecretString --output text --region ap-southeast-1)"
# PGDATABASE="$WRITER" psql -qtAX -c "SELECT to_regclass('public.\"_prisma_migrations\"') IS NOT NULL;"
# ถ้า t:
# PGDATABASE="$WRITER" psql -c "SELECT count(*), min(started_at), max(finished_at) FROM \"_prisma_migrations\";"
# PGDATABASE="$WRITER" psql -qtAX -c "SELECT migration_name||' '||checksum FROM \"_prisma_migrations\" ORDER BY started_at;" > /tmp/prod-migrations.txt
# เอาผลมาเทียบกับ repo (ในเครื่อง dev):
#   for d in apps/api/prisma/migrations/*/; do printf '%s %s\n' "$(basename $d)" "$(shasum -a 256 $d/migration.sql | cut -d' ' -f1)"; done
```

### 8.4 Alarm ที่ขาด

```sh
T=arn:aws:sns:ap-southeast-1:311414082667:watchdog-bms-production-security-alerts
aws cloudwatch put-metric-alarm --region ap-southeast-1 \
  --alarm-name watchdog-bms-prod-db-storage-low \
  --namespace AWS/RDS --metric-name FreeStorageSpace --statistic Minimum \
  --dimensions Name=DBInstanceIdentifier,Value=watchdog-bms-prod-db \
  --period 300 --evaluation-periods 2 --threshold 4000000000 \
  --comparison-operator LessThanThreshold --treat-missing-data notBreaching --alarm-actions "$T"
aws cloudwatch put-metric-alarm --region ap-southeast-1 \
  --alarm-name watchdog-bms-prod-db-memory-low \
  --namespace AWS/RDS --metric-name FreeableMemory --statistic Minimum \
  --dimensions Name=DBInstanceIdentifier,Value=watchdog-bms-prod-db \
  --period 300 --evaluation-periods 3 --threshold 200000000 \
  --comparison-operator LessThanThreshold --treat-missing-data notBreaching --alarm-actions "$T"
```

(ALB 5xx steady-state: ใส่ได้หลัง deploy แรก เพราะต้องรู้ target group ARN จริง)

### 8.5 งบ

```sh
aws budgets create-budget --account-id 311414082667 --budget '{
  "BudgetName": "watchdog-bms-monthly",
  "BudgetLimit": {"Amount": "350", "Unit": "USD"},
  "TimeUnit": "MONTHLY", "BudgetType": "COST"}' \
 --notifications-with-subscribers '[
  {"Notification":{"NotificationType":"ACTUAL","ComparisonOperator":"GREATER_THAN","Threshold":80},
   "Subscribers":[{"SubscriptionType":"EMAIL","Address":"thawatchai.phuchana@gmail.com"}]},
  {"Notification":{"NotificationType":"FORECASTED","ComparisonOperator":"GREATER_THAN","Threshold":100},
   "Subscribers":[{"SubscriptionType":"EMAIL","Address":"thawatchai.phuchana@gmail.com"}]}]'
```

### 8.6 DNS / โดเมน

```sh
dig +short mangmeeplus.com A
dig +short mangmeeplus.com CNAME
curl -sI https://mangmeeplus.com | head -5   # ดูว่าตอนนี้เสิร์ฟจากไหน (Cloudflare? 5xx? parked?)
```

---

## 9. ลำดับที่แนะนำ

1. อ่านข้อความ startup failure จากหน้า run แล้วแก้ (บล็อกทุกทาง)
2. **ตัดสินทาง A/B/C** — ถ้า B/C ต้องบันทึกมติ
3. รัน §8.1–8.3 (bastion + PI + **migration state**) — ผล 8.3 กำหนดว่างานก่อน deploy มีแค่ไหน
4. เพิ่ม alarm §8.4 + Budget §8.5
5. ถ้าทางที่เลือกต้องผ่าน UAT: เปิด UAT รอบ acceptance **พร้อมแทน Redis เก่า** ในรอบเดียว
   (+ยิง load test ที่ UAT ถ้าจะทำ) แล้วจอดกลับที่ 0
6. Deploy ตามทางที่เลือก → smoke §3 → support roles + `pg_stat_statements` → M-01 evidence
   → restore drill (หรือรวมกับ clone rehearsal ถ้าทาง A)
7. รอ CPU credit เต็ม (~เที่ยง 2026-08-09) ก่อนเปิด user จริง
