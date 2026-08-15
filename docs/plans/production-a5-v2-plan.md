# Production A5 V2 Implementation Plan

Status: COMPLETE through repeatable `PROMOTED_CLOSED`; use the operator runbook for future releases
Spec: `docs/specs/production-a5-v2-spec.md`
Matrix: `docs/plans/production-a5-v2-readiness-matrix.md`
Memory: `docs/agent-memory/production-a5-v2.md`
Runbook: `docs/runbooks/uat-production-v2-deployment.md`

## Delivery rule

ใช้ consolidation PR เดียวหลัง root-cause implementation และ proof matrix ผ่านครบ ห้ามเริ่ม PR
ถัดไปเพื่อแก้ blocker ทีละจุด และห้าม dispatch CI/UAT/Readiness/Production เพื่อค้นหา error.
Actions เริ่มได้เมื่อ local/offline aggregate, exact image proof, IAM/provider read-only proof,
non-business-mutating canary และ independent review ผ่านเท่านั้น จากนั้นใช้เส้นทางเดียว
PR/CI หนึ่งรอบ → UAT all หนึ่งรอบ → fresh Passport → bootstrap/Readiness → Production.

Implementation ใช้ GitHub-hosted runners, pinned actions, GitHub OIDC และ AWS roles ที่มี
อยู่จริงเท่านั้น ไม่มี workstation ceremony, local upload/signature หรือ root AWS credential

ประมาณการงานรวม 16–25 ชั่วโมง หรือ 1.5–2 วันทำงาน บวกเวลารอ cloud สำหรับ first A5
green 45–90 นาที ตัวเลขเป็น planning budget จาก run history ณ 2026-08-12 ไม่ใช่คำรับรอง
provider latency

## Phase 0 — Freeze V1 and lock contracts

Estimate: 1–2 ชั่วโมง (docs/review; no cloud)

- [x] เขียน V2 spec, readiness matrix, plan และ task memory
- [x] audit เครื่องมือ, GitHub policy, AWS roles/network/secrets/RDS/Redis แบบ read-only
- [ ] owner review release states, timing budgets และ one-click promotion boundary
- [x] mark V1 A5/U5 ceremony execution-frozen; เก็บไว้เป็น historical implementation map
- [x] record freeze: ห้าม merge/dispatch V1 ceremony จน V2 contract พร้อมและได้รับ approval
- [x] บันทึก static invariants และ explicit forbidden paths ใน V2 spec

Exit: ทุกคนใช้คำเดียวกันว่า `UAT_ACCEPTED`, `PROD_READY`, `PROMOTED_CLOSED`,
`PROMOTED_LIVE`; ไม่มี workflow mutation

## Phase 0A — Stabilization audit and root-cause closure

Estimate: 6–10 ชั่วโมง engineering + local image build; no GitHub Actions

- [x] freeze workflow dispatch และบันทึก owner cost boundary ใน agent memory
- [x] audit ทุก one-shot task จาก image/filesystem/binary → IAM → network/secret/DB → cleanup
- [x] ยืนยัน `/tmp` EACCES และ runtime `pnpm` absence กับ exact Alpine image shape
- [x] เทียบ bootstrap/clone actions กับ official ECS/RDS authorization resource types
- [ ] เพิ่ม Dockerfile `/tmp` volume contract และเปลี่ยน child commands เป็น direct binaries
- [ ] แก้ bootstrap definition reconciliation ก่อน self-revoke และ lost-response boundary
- [ ] แก้ clone restore resource set และ Fargate `ListTasks` authorization
- [ ] เพิ่ม exact-image offline verifier และ aggregate ที่ครอบ readonly/apply runners
- [ ] พิสูจน์ IAM simulation, DB class orderability/quota, branch-policy token capability,
  AgentCore/ClamAV prerequisites และ provider canary โดยไม่แตะ business data
- [ ] independent adversarial review ของ combined diff และ matrix

Exit: authoritative matrix ทุกแถวที่อยู่ก่อน Actions เป็น `PASS`; ไม่มี deterministic P0/P1 ที่
ควบคุมได้ค้างอยู่ และยังไม่มี workflow dispatch

## Phase 1 — UAT Release Passport V2

Engineering estimate: 3–4 ชั่วโมง
Runtime impact: migration-tool job ประมาณ 2–6 นาทีแต่ทำ parallel; เป้าหมายเพิ่ม critical path
ไม่เกิน 2 นาที ทำให้ resolved-all UAT อยู่ในช่วง 15–22 นาที

- [x] เพิ่ม schema/validator สำหรับ `UAT_RELEASE_PASSPORT_V2`
- [x] ให้ UAT build/sign `release-task` และ bind digest เข้า passport
- [x] build/sign `migration-tool` ในทุก Production-eligible resolved-`all` UAT เพราะ Production
  อาจค้าง migration แม้ source diff ล่าสุดไม่แตะ Prisma
- [x] รวม three runtime digests, SBOM, provenance, scan, target classification, migration catalog,
  deploy health และ finalization ไว้ใน artifact เดียว
- [x] mint passport เฉพาะ resolved-`all`; selective run อื่นยังเร็วและไม่ mint
- [x] ใช้ controller validator จาก protected main ไม่ใช้ candidate security scripts
- [x] ทดสอบ missing/tampered/duplicate/expired/wrong-run/wrong-attempt ทุก field สำคัญ
- [x] treat requested `auto` as Production-eligible for controller trust checks ก่อนจะรู้ resolved target
- [ ] รัน UAT resolved-`all` ใหม่หลัง stabilization PR และบันทึกเวลา Passport/tool build;
  ห้าม reuse run `31559662937` เพราะ pin migration-tool ที่ไม่มี `/tmp` volume contract

Checks:

- focused passport schema/validator spec
- existing UAT selector/workflow/image security/release safety specs
- YAML parse, shell syntax, `git diff --check`
- one UAT resolved-all run; target 15–22 นาทีและบันทึก migration-tool critical-path impact

Exit: UAT run เดียวให้ exact immutable inputs ทุกชิ้นที่ Production/A5 ต้องใช้ ไม่มี build
candidate image หลังจุดนี้

## Phase 2 — One-time A5 database reader bootstrap

Engineering estimate: 3–4 ชั่วโมง
Runtime estimate: administrator role apply 3–8 นาที + bootstrap task 5–10 นาทีหนึ่งครั้ง;
subsequent readiness readback <1 นาที

- [x] สร้าง workflow ที่รับ exact UAT passport และใช้ one-time bootstrap OIDC role
- [x] รัน fixed bootstrap command ใน isolated task; ห้าม candidate shell injection
- [x] สร้าง/ตรวจ `watchdog_a5_prod_ro` และ readonly DB URL secret
- [x] พิสูจน์ exact grants, role default, no DML/DDL/ownership/escalation ใน task contract/tests
- [x] redact credentials และออก signed `PRODUCTION_A5_BOOTSTRAP_V2`
- [x] self-revoke temporary bootstrap execution/controller authority แม้ attempt fail
- [x] revoked rerun classify exact state tuple ก่อน ECR/cosign และ emit EXISTING ด้วย stable
  metadata-only readback โดยไม่มี AWS mutation
- [x] re-read IAM/network/secret state ใน bootstrap/readiness controller
- [ ] non-root platform administrator ใช้ temporary exact boundary ตาม
  `docs/runbooks/production-promotion-prerequisite-bootstrap.md` เพื่อ apply+readback deploy,
  security, runtime/task/workers/A5 roles และ exact S3 lifecycle ใน ceremony เดียว แล้วลบ
  temporary authority; apply เฉพาะ templates ที่ผ่าน provider/IAM proof แล้ว จากนั้น dispatch
  reader-bootstrap workflowหนึ่งครั้งจาก fresh Passport
- [x] ceremony exact-applies/readbacks UAT deploy policy ก่อน UAT และ bounded-retries durable
  IAM/SSM/lifecycle propagation; readiness bind PG 18.3 snapshot/KMS และ immutable approved
  AgentCore runtime artifact
- [ ] live bootstrap/readback ทำให้ matrix S2/S3 เป็น PASS

Checks:

- fake-AWS/PG fixtures สำหรับ missing, exact, broad privilege, partial bootstrap, rerun
- task-definition validator พิสูจน์ no task role/broad AWS credential
- one live bootstrap + independent readonly query proof; no Production application mutation

Exit: matrix S2/S3 เป็น PASS และไม่ต้องใช้ workstation `psql`/`cosign`

## Phase 3 — Production Readiness V2

Engineering estimate: 4–6 ชั่วโมง
Runtime: quick 1–2 นาที (hard 5 นาที); migration 45–90 นาทีจนมี measured first green

- [x] เพิ่ม `production-readiness.yml` ที่รับ UAT run/passport โดยไม่ต้องมี deploy parent
- [x] automatic readiness bind `maintenance_closed`; live readiness รับเฉพาะ explicit request
  หลัง legal evidence ผ่าน หรือ owner `MangmeeDev` ส่ง approval reference เพื่อสร้าง signed
  `OWNER_OVERRIDE` โดยไม่ปลอม manifest เป็น `VERIFIED`
- [x] common preflight อ่าน GitHub/AWS/IAM/network/secrets/RDS/Redis/service baseline
- [x] รัน readonly migration catalog classification
- [x] quick path ออก READY เมื่อ exact catalog ไม่มี pending migration
- [x] migration path ใช้ exact UAT migration-tool restore→rehearse→delete; classifier ใช้ exact
  applied name/checksum set และ repository-minus-applied pending set โดยไม่สมมติ global lexical prefix
- [x] bind source/controller/images/baseline/ledger/target/mode/policy/A5 evidence เข้า
  `PRODUCTION_RELEASE_READY_V2`
- [x] cleanup always-run; READY only after `DESTROYED` and residual=0
- [x] fail at first named readiness predicate; retry ไม่ต้อง rerun UAT เมื่อ passport valid
- [x] expiry 24h และ baseline drift invalidation
- [x] destructive pending SQL fail-closed ตอน classify, clone และใน Production DB fence
- [ ] live quick readiness และ first-green restore→rehearse→delete หลัง S2/S3 พร้อม

Checks:

- intent/state-machine matrix: quick, pending, drift, expired, baseline change, cleanup failure
- fake AWS fixtures: role/network/secret/service zero/multi/moving states
- readonly ledger test: exact, pending set, edited, unknown, duplicate, failed/unfinished และ
  historical out-of-order/missing-middle ที่ checksum ตรง
- full A5 dry fixtures
- one live quick readiness read-only run
- one live A5 restore→rehearse→delete first green before Phase 4

Exit: Production deploy UI/workflow มองเห็นเฉพาะ READY releases และ first green A5 timing ถูก
บันทึกแยก restore/rehearse/cleanup

## Phase 4 — Simplify Production promotion

Engineering estimate: 3–5 ชั่วโมง
Runtime target: no-DB 8–14 นาที; hard investigation threshold 20 นาที

- [x] production input เหลือ passport/readiness references + requested serving mode
- [x] ไม่มี Production source CI, typecheck, test, runtime image build, SBOM หรือ application signing
- [x] ไม่มี parent/child dispatch race, bridge artifact inputs หรือ discovery failure path ใน V2
- [x] ก่อน mutation recheck READY signature/expiry, active baseline, images, legal mode และ operation lock
- [x] ใช้ exact UAT `release-task`/`migration-tool` digests
- [x] resolve target auto; pending migration/maintenance/split baseline → `all`
- [x] no-op เมื่อ active exact digest/config อยู่แล้ว
- [x] rollout canary/rollback/health/finalization เดิม
- [x] signed result artifact ผูก observed digest/source/mode/health/maintenance proof

Maintenance ordering:

- [x] OPEN→CLOSED: close all ingress/background paths, drain 900s ครั้งแรก, then mutate
- [x] CLOSED→CLOSED: prove continuous closure and no repeat drain
- [x] CLOSED→LIVE: exact-digest config rollout after legal/owner approval
- [x] failed closed-stage promotion recovers to exact candidate closed and reports requested run failed

Checks:

- workflow static spec proves no build/test/typecheck/SBOM/sign steps
- promotion input/READY tamper and baseline-drift tests
- selective target/no-op/split baseline tests
- maintenance transition/recovery/browser journey tests
- existing serving mode, release safety, ECS capacity and verifier suites

Exit: normal promotion never discovers a prerequisite after mutation starts

## Phase 5 — End-to-end rehearsal without Production mutation

Engineering estimate: 2–4 ชั่วโมง
Runtime wait: one V2 UAT 15–22 นาที + one A5 45–90 นาที

- [x] run full local/static test set scoped to changed controllers
- [ ] run UAT resolved-all and validate passport bytes/signatures
- [ ] run Production quick readiness read-only
- [ ] run A5 clone readiness against snapshot; require cleanup residual zero
- [x] simulate expired/tampered artifact, role/secret drift, moving baseline and cleanup contract
- [x] simulate promotion controller/static failure paths; no live Production mutation
- [ ] independent human review of trust boundary and failure/recovery ordering
- [ ] record live observed timings in spec/matrix/memory after approved runs

Exit: all predictable prerequisites are PASS and readiness artifacts can be independently verified

## Phase 6 — Controlled Production proof

Owner action required

1. Merge the single reviewed PR after all required checks/approval pass
2. platform administrator runs the one consolidated exact prerequisite ceremony in Phase 2,
   applies and exact-reads the UAT deploy policy plus Production prerequisites, then retires the
   temporary authority; it does not update running services or
   current S3 objects, but it does restore the reviewed lifecycle that expires stale noncurrent
   `pending/` versions, so the owner must approve that retention change explicitly
3. UAT resolved-all exact main SHA → fresh passport; old Passport `31559662937` forbidden
4. one-time A5 reader bootstrap → secret/PG proof + temporary authority self-revoked
5. automatic Production readiness → READY
6. owner confirms one `maintenance_closed` promotion
7. workflow rechecks READY then deploys all (current split baseline)
8. verify custom/raw ingress, admin-onboard control, exact digest, disabled background work,
   health/readiness, operation finalization and signed result
9. keep customer launch CLOSED; opening is a later legal-approved action

Expected wait:

- UAT: 15–22 นาที
- quick readiness: 1–2 นาทีหากไม่มี pending migration
- A5 readiness: 45–90 นาทีหากมี pending migration
- first closed promotion: 8–14 นาที rollout + 15 นาที drain
- subsequent closed promotion: 8–14 นาทีโดยไม่ drain ซ้ำ

Stop conditions:

- passport/READY mismatch or expiry
- IAM/network/secret/RDS/Redis/service drift
- A5 reader not exact or clone cleanup not zero
- active baseline changes after READY
- canary alarm/circuit breaker/health/readiness failure
- any route becomes live while requested mode is closed

## Implementation file boundary

Use existing patterns and keep the diff narrow. Expected areas only:

- `.github/workflows/deploy-uat.yml`
- new `.github/workflows/production-readiness.yml`
- new `.github/workflows/deploy-production-v2.yml`; legacy `deploy-production.yml` เปลี่ยนเฉพาะ
  exact maintenance-contract pin ที่ shared controller ต้องคงตรง
- `.github/workflows/production-a5-clone.yml` only as needed to turn it into a readiness
  implementation detail
- existing `infra/docker/**`, `infra/security/**`, `infra/prod-ecs-express/**` validators/runners
- `docs/specs`, `docs/plans`, `docs/runbooks`, `docs/agent-memory`

Do not edit `package.json` and do not add a dependency unless an existing pinned action/tool cannot
perform the required operation

## Review checklist before merge

- [x] product states and operator journey match the spec
- [x] candidate/controller/runtime authority cannot cross in local contracts
- [x] no Production build/test/typecheck path remains
- [x] no per-release local tool/root credential prerequisite remains; one-time administrator
  provisioning is explicitly separated and least-privilege reviewed
- [x] all known missing resources are checked before deploy mutation
- [x] interface endpoint policies cover and exact-read release preflight plus Production apply
  execution before another Production attempt
- [ ] UAT/Production Cloudflare host proxies forward GET/HEAD without a request body and live
  custom-domain maintenance probes pass
- [x] first current split release resolves target all
- [x] quick and migration readiness both bind exact baseline
- [ ] A5 first green and zero-residual cleanup recorded
- [x] live legal gate remains fail-closed
- [x] retry, expiry, no-op, rollback/recovery and audit evidence contract tests pass
- [x] task memory and old ceremony freeze notice updated
