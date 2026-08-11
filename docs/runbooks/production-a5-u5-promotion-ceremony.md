# Production A5/U5 Promotion Ceremony — orchestration map

> **EXECUTION FROZEN — 2026-08-12:** เอกสารนี้เป็นแผนที่ implementation V1 สำหรับอ้างอิง
> และห้ามใช้ dispatch Production ceremony ใหม่จน A5 V2 ผ่าน independent review และ live
> readiness proof
> เพราะ V1 มี parent/child dependency และ reader-bootstrap ordering ที่ทำให้ค้น blocker กลาง
> deploy ซ้ำ ๆ ใช้ `docs/specs/production-a5-v2-spec.md`,
> `docs/plans/production-a5-v2-readiness-matrix.md` และ
> `docs/plans/production-a5-v2-plan.md` เป็น source of truth สำหรับงานถัดไป การ freeze นี้ไม่
> หมายความว่า local implementation อนุญาตให้ mutate Production; ยังคงหยุดจน V2 live exit
> gates ผ่าน

เป้า: ขึ้น production ทาง A (promotion เต็ม) ให้จบ | สร้าง 2026-08-08
คู่กับ `feature-entitlement-u5-production-handoff.md`, `production-u5-live-prerequisites.md`

**อ่านก่อนเริ่ม:** ceremony นี้มีทั้ง owner approval และ reimbursement quiesce window อย่างละ
**1800 วินาที (30 นาที)** Evidence ทุกชิ้นผูกกับ `parent_production_run_id` ของ
deploy-production run **ที่กำลังรันอยู่** ตัว parent จะ verify signed UAT acceptance แล้ว restore
bridge image ผ่าน publisher role โดยยอมรับเฉพาะ digest เดิมแบบ byte-for-byte, รอ clone ก่อนแตะ runtime, deploy bridge
หลัง clone ผ่าน, แล้วหยุดรอ evidence ของแต่ละ stage ตามลำดับ ทำต่อเนื่องจนจบ; ถ้า window หมด
ให้หยุดโดยคง quiesce และเริ่ม parent/evidence chain ใหม่ ห้ามข้าม predicate

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
| O5 | จัดทำและให้ผู้รับผิดชอบจริง review **legal release evidence bundle** ตาม `legal-release-evidence-bundle.md`, สร้าง legal-reader OIDC role และตั้ง protected variables ทั้ง 5 ค่า | agent ห้ามสร้างหลักฐานทดแทน เปลี่ยน `BLOCKED` เป็น `VERIFIED` หรืออนุมัติแทนผู้ตรวจจริง |

**O1 คือ blocker ตัวแรกสุด** — bootstrap A5 network/preflight บางส่วนอ่าน branch protection ผ่าน token นี้
ถ้าไม่มี ทำ Phase 1 ไม่ได้

---

## Phase 0 — Prerequisites (ทำก่อน ไม่มี time pressure)

- [ ] **GitHub Actions billing/runners**: ใน `Settings → Billing & plans` ยืนยันว่า payment
      ใช้งานได้และ Actions spending limit ยังไม่เต็มก่อนเริ่ม parent/evidence chain ที่มีอายุจำกัด.
      ถ้า job จบภายในไม่กี่วินาทีโดย `steps: []`, `runner_id: 0` ให้เปิด check-run annotations;
      ข้อความ `recent account payments have failed or your spending limit needs to be increased`
      คือ account-level billing gate — ไม่มี code/AWS mutation และการ rerun จะไม่ช่วยจนแก้ billing.
- [ ] **O1**: สร้าง `PRODUCTION_POLICY_READ_TOKEN` → env `production`
- [ ] **O2**: ยืนยันมี independent reviewer พร้อม
- [ ] **O5**: `legal-release-evidence.json` เป็น `VERIFIED`, หลักฐานจริงครบ 5 รายการและยังไม่หมดอายุ,
      bundle อยู่ที่ immutable/versioned S3 object, legal-reader role จำกัดสิทธิ์เฉพาะ object version นั้น
      และ env `production` มี `LEGAL_RELEASE_EVIDENCE_READER_ROLE_ARN`,
      `LEGAL_RELEASE_EVIDENCE_SHA256`, `LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_URI`,
      `LEGAL_RELEASE_EVIDENCE_BUNDLE_S3_VERSION_ID`, `LEGAL_RELEASE_EVIDENCE_BUNDLE_SHA256`
- [ ] รัน preflight แบบไม่แตะ production: workflow YAML ทุกไฟล์ parse ได้, production/security
      specs ผ่าน, action ทุกตัว pin ด้วย SHA ที่ fetch ได้จริง และ promoted-run validator fetch
      `refs/heads/main` เข้า local ref ที่ verifier ใช้
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

1. [ ] เริ่ม **deploy-production** (mode promotion) — controller ตรวจ UAT bytes/signatures,
       build final release-task image ล่วงหน้า แล้วค้างที่ "Wait for exact clone rehearsal before
       quiesce" โดยยังไม่เปลี่ยน production
       ```sh
       gh workflow run deploy-production.yml --ref main -f release_ref=<sha> -f target=all \
         -f promote_from_run_id=<uat-run-id> \
         -f bridge_uat_run_id=<...> -f bridge_uat_run_attempt=<...> \
         -f bridge_source_sha=<sha> -f bridge_api_image=<digest>
       ```
       → จด **parent_production_run_id** + attempt จาก run ที่เพิ่งเกิด
2. [ ] **production-a5-clone** (clone rehearsal = restore drill M-17 ในตัว) → จด run id
       ```sh
       gh workflow run production-a5-clone.yml --ref main \
         -f parent_production_run_id=<X> -f parent_production_run_attempt=<A> -f uat_acceptance_run_id=<uat>
       ```
       Parent จะ restore/verify exact UAT-attested digest ก่อน, verify clone, deploy bridge ด้วย
       `REIMBURSEMENT_WRITE_QUIESCE=true`, prove exact revision/tasks และ upload PRE context
3. [ ] **production-a5** stage `PRE_MUTATION` — ใช้ clone run id → จด producer run id
4. [ ] **production-security-preflight** stage `PRE_MUTATION` — ต้องอ้าง exact A5 PRE run
       → จด producer run id
5. [ ] **u5-shadow-evidence** stage `PRE_AUTHORIZATION` — รวม clone+A5 PRE+security+UAT
       → จด aggregate run id
6. [ ] **u5-owner-approval** (**O3 — เจ้าของกดเอง**) — ใช้ pre-aggregate run id
       → parent verify chain/approval, รัน exact reviewed migration ขณะ bridge ยัง quiesced,
       upload `POST_MIGRATION` context แล้วหยุดรอ
7. [ ] **production-a5** stage `POST_MIGRATION` — อ้าง parent และ exact PRE/clone evidence
       → parent verify signed result แล้ว deploy final `all` โดย api-web ยัง `true`, prove exact
       final revision จากนั้น deploy **api-web image เดิม** ด้วย flag `false` เป็น mutation สุดท้าย
8. [ ] หลัง parent upload `POST_DEPLOYMENT` context ให้ dispatch **production-a5** stage
       `POST_DEPLOYMENT`
9. [ ] Dispatch **u5-shadow-evidence** stage `POST_DEPLOYMENT` โดยอ้าง exact A5 PRE,
       POST_MIGRATION, POST_DEPLOYMENT, clone, security และ owner approval
10. [ ] Parent verify `validate-post`, finalizes release operation และจบ success เท่านั้นเมื่อ
        digest/GIT_SHA/health + chain ทั้งเส้นตรงกัน

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

- **สองหน้าต่าง 1800s** — clone อยู่ก่อน quiesce และ final release-task image build ล่วงหน้าเพื่อลด
  downtime; หลัง bridge live ต้อง dispatch PRE chain ต่อทันที และหลัง owner approval ต้อง dispatch
  POST_MIGRATION/POST_DEPLOYMENT ต่อทันที ถ้าหมดเวลาให้ถือว่า fail-closed และคง quiesce
- **ทุก workflow จาก main** — dispatch ผิด branch = fail ที่ guard ทันที
- **evidence ผูก parent run** — ถ้า deploy-production ตาย ต้องเริ่ม chain ใหม่ทั้งเส้น
- Phase 1 (infra) ทำแยกก่อนได้ ไม่มี time pressure — **ทำ Phase 0–2 ให้เสร็จสมบูรณ์ก่อนแตะ Phase 3**
