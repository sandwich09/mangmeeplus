# Production A5/U5 Promotion Ceremony — orchestration map

เป้า: ขึ้น production ทาง A (promotion เต็ม) ให้จบ | สร้าง 2026-08-08
คู่กับ `feature-entitlement-u5-production-handoff.md`, `production-u5-live-prerequisites.md`

**อ่านก่อนเริ่ม:** ceremony นี้มี owner approval หน้าต่าง **1800 วินาที (30 นาที)** และ evidence
ทุกชิ้นผูกกับ `parent_production_run_id` ของ deploy-production run **ที่กำลังรันอยู่** แปลว่า
Phase 3 ทั้งหมดต้องทำ **ระหว่างที่ deploy-production run ค้างรอ** ที่ step "Wait for U5 authority"
ทำต่อเนื่องจนจบ พลาดแล้วเริ่ม deploy ใหม่ทั้งรอบ

ทุก A5/U5 workflow ต้อง dispatch **จาก `main` เท่านั้น** (`GITHUB_REF = refs/heads/main` และ
`GITHUB_SHA = rev-parse refs/heads/main` ปัจจุบัน — controller ต้องเป็น main ล่าสุด)

---

## สิ่งที่คุณ (เจ้าของ) ต้องทำเอง — agent แทนไม่ได้

| # | สิ่งที่ต้องทำ | ทำไม agent ทำไม่ได้ |
| --- | --- | --- |
| O1 | สร้าง **`PRODUCTION_POLICY_READ_TOKEN`** — fine-grained GitHub token, repo-scoped, **Administration: read-only** เท่านั้น → เก็บเป็น secret ใน environment `production` | ต้องสร้างใน GitHub UI ด้วย identity เจ้าของ; ห้ามใช้ broad personal token |
| O2 | หา **independent reviewer จริง** สำหรับ protected `main` (decision #6) | self-approve ไม่ได้ ห้ามลด/แก้ branch protection |
| O3 | กด **owner approval** ใน `u5-owner-approval.yml` — ผู้อนุมัติต้องเป็น **repo owner** ตัวจริง | chain ตรวจ approver identity |
| O4 | ยืนยัน **synthetic SNS delivery** (decision #1) — ได้เมล + acknowledge | ต้องเป็นคนกดรับจริง |

**O1 คือ blocker ตัวแรกสุด** — bootstrap A5 network/preflight บางส่วนอ่าน branch protection ผ่าน token นี้
ถ้าไม่มี ทำ Phase 1 ไม่ได้

---

## Phase 0 — Prerequisites (ทำก่อน ไม่มี time pressure)

- [ ] **O1**: สร้าง `PRODUCTION_POLICY_READ_TOKEN` → env `production`
- [ ] **O2**: ยืนยันมี independent reviewer พร้อม
- [ ] Decision #4 (VPC endpoint cost) — ตัดสินแล้ว: สร้างชั่วคราวตอน ceremony แล้วลบ
- [ ] main ล่าสุด = develop head ที่จะ promote (ตอนนี้ main มี workflow fix แล้ว; ต้อง merge
      candidate SHA เข้า main ก่อน เพราะ A5 workflow ต้องรันจาก main และ source ต้อง reachable จาก main)

## Phase 1 — Bootstrap A5 infra (agent guide, คุณรัน — ไม่มี time pressure)

ทำจาก CloudShell/เครื่องที่มีสิทธิ์ (identity เจ้าของ ไม่ใช่ automation user):

- [ ] **A5 private network** (endpoint-only, ไม่ใช่ NAT):
      ```sh
      AWS_ACCOUNT_ID=311414082667 bash infra/security/bootstrap-production-a5-private-network.sh          # dry-run ดูก่อน
      AWS_ACCOUNT_ID=311414082667 bash infra/security/bootstrap-production-a5-private-network.sh --apply   # สร้างจริง
      ```
- [ ] **A5 IAM roles + reader execution role**:
      ```sh
      AWS_ACCOUNT_ID=311414082667 bash infra/security/bootstrap-production-a5-readonly.sh          # dry-run
      AWS_ACCOUNT_ID=311414082667 bash infra/security/bootstrap-production-a5-readonly.sh --apply
      ```
- [ ] **A5 DB reader role + secret** `watchdog-bms/production/a5-readonly-database-url`:
      รันผ่าน release-task mode หรือ bootstrap-a5-database-reader (ตรวจ path จริงตอนทำ)
      → สร้าง PG role `watchdog_a5_prod_ro` (bastion secret policy ครอบ secret นี้แล้วจากรอบก่อน)

## Phase 2 — UAT candidate + acceptance (agent guide — ~30–45 นาที background)

- [ ] แทน **UAT Redis เก่า** (ไม่เข้ารหัส) ตาม `infra/uat/README.md` — ทำในรอบเดียวกัน
- [ ] Deploy UAT **all-target** ด้วย candidate SHA:
      ```sh
      gh workflow run deploy-uat.yml --ref main -f release_ref=<candidate-full-sha> -f target=all -f run_m01_acceptance=false
      ```
- [ ] เก็บ **UAT producer run id** (`uat_acceptance_run_id`) — ต้องเป็น all-target ที่ success
- [ ] ยืนยัน digest จริง (ตาม cloud-environment-operations.md §3)

## Phase 3 — Evidence chain (⏱️ TIME-SENSITIVE — ทำต่อเนื่อง)

ลำดับบังคับ แต่ละขั้นป้อน run id ให้ขั้นถัดไป **ทุกอันจาก `main`**:

1. [ ] เริ่ม **deploy-production** (mode promotion) — จะค้างรอที่ "Wait for U5 authority" 1800s
       ```sh
       gh workflow run deploy-production.yml --ref main -f release_ref=<sha> -f target=all \
         -f promote_from_run_id=<uat-run-id> \
         -f bridge_uat_run_id=<...> -f bridge_uat_run_attempt=<...> \
         -f bridge_source_sha=<sha> -f bridge_api_image=<digest>
       ```
       → จด **parent_production_run_id** + attempt จาก run ที่เพิ่งเกิด
2. [ ] **production-security-preflight** (stage PRE_MUTATION) → จด producer run id
3. [ ] **production-a5-clone** (clone rehearsal = restore drill M-17 ในตัว) → จด run id
       ```sh
       gh workflow run production-a5-clone.yml --ref main \
         -f parent_production_run_id=<X> -f parent_production_run_attempt=<A> -f uat_acceptance_run_id=<uat>
       ```
4. [ ] **production-a5** (stage PRE_MUTATION) — ใช้ clone_rehearsal_run_id → จด run id
5. [ ] **u5-shadow-evidence** (stage PRE_AUTHORIZATION) — รวม preflight+clone+a5+uat → จด aggregate run id
6. [ ] **u5-owner-approval** (O3 — คุณกด, ผู้อนุมัติ = repo owner) — ใช้ pre_aggregate_run_id
       → ปล่อยให้ deploy-production ที่ค้างอยู่ fetch approval แล้วเดินต่อ
7. [ ] deploy-production เดิน migration (apply 51 ตัว) → canary bake → verify digest/GIT_SHA/health

## Phase 4 — หลัง deploy

- [ ] **ห้าม curl route อื่นนอกจาก /v1/health ระหว่าง bake**
- [ ] Smoke: login, upload ใบเสร็จ (clamd), expense, LINE webhook
- [ ] Bootstrap support roles (`bootstrap-support-roles.sql`) — ตอนนี้ schema พร้อม
- [ ] เก็บ M-01 live evidence (AI เปิดวันแรก)
- [ ] จอด UAT กลับที่ 0
- [ ] อัปเดต LINE webhook + LIFF endpoint → production domain
- [ ] รอ CPU credit เต็ม (~เที่ยง 2026-08-09) ก่อนเปิด user จริง

---

## ความเสี่ยงหลักของ ceremony นี้

- **หน้าต่าง 1800s** — Phase 3 ต้องทำต่อเนื่อง ถ้าขั้น 2–5 รวมกันเกิน 30 นาที approval จะหมดอายุ
  แล้ว deploy-production timeout → เริ่ม Phase 3 ใหม่ทั้งหมด **เตรียม run id ให้พร้อมก่อนกด**
- **ทุก workflow จาก main** — dispatch ผิด branch = fail ที่ guard ทันที
- **evidence ผูก parent run** — ถ้า deploy-production ตาย ต้องเริ่ม chain ใหม่ทั้งเส้น
- Phase 1 (infra) ทำแยกก่อนได้ ไม่มี time pressure — **ทำ Phase 0–2 ให้เสร็จสมบูรณ์ก่อนแตะ Phase 3**
