# Production A5 V2 Readiness Matrix

Status: V2 implemented locally; live bootstrap/readiness/A5/promotion evidence pending approval
Audit date: 2026-08-12
Spec: `docs/specs/production-a5-v2-spec.md`

## Status legend

- `PASS`: ตรวจสดหรือมี evidence ปัจจุบันแล้ว
- `MISSING`: resource/secret ที่ต้องมีไม่มีอยู่
- `UNPROVEN`: มี implementation/resource แต่ยังไม่เคยผ่าน end-to-end
- `BLOCKED`: policy/evidence ปัจจุบันตั้งใจบล็อก
- `NOT_IMPLEMENTED`: contract/workflow V2 ยังไม่มี
- `IMPLEMENTED_LOCAL`: code/contract tests ผ่าน แต่ยังไม่อ้างว่า cloud state ผ่าน
- `NOT_REQUIRED`: V2 ออกแบบไม่ให้เป็น prerequisite
- `DECISION`: ต้องใช้ owner/human decision จริง

## Readiness matrix

| ID | Boundary/predicate | Source/tool ที่ใช้จริง | เมื่อใด | Budget | Status 2026-08-12 | Blocks |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | source เป็น full SHA และ reachable จาก protected history | Git/GitHub API | UAT passport | <10s | PASS สำหรับ current accepted runs | passport |
| G2 | required CI contexts ผ่านสำหรับ exact source | GitHub Checks API, branch protection | ก่อน UAT passport | reuse existing CI | PASS เป็น policy; exact implementation commit ยังต้องผ่าน PR checks | passport |
| G3 | UAT resolved target=`all` และ deploy/health/finalize ผ่าน | `deploy-uat.yml`, UAT active readback | passport | observed 15–20m | PASS ใน run `31503285465` | passport |
| G4 | V2 passport รวมสาม runtime images + release-task + migration-tool | signed artifact + validator | หลัง UAT | <=2m critical-path target | IMPLEMENTED_LOCAL | all V2 readiness |
| G5 | passport ไม่หมดอายุและ artifact unique ต่อ run/attempt | GitHub artifact API | readiness | <10s | IMPLEMENTED_LOCAL | readiness |
| I1 | runtime image digests immutable อยู่ใน ECR | AWS ECR API | UAT/readiness | 10–20s | PASS สำหรับ current runtime repos | readiness |
| I2 | image keyless signature/provenance verify | pinned Cosign action/binary บน runner | UAT/readiness | 10–30s parallel | PASS ใน current UAT path | readiness |
| I3 | SBOM/scan result อยู่ใน passport | UAT publisher evidence | UAT | parallelกับ build | IMPLEMENTED_LOCAL | readiness |
| I4 | release-task สร้าง/เซ็นใน UAT และ digest อยู่ passport | UAT buildx/ECR/Cosign | UAT | ~1–2m parallel | IMPLEMENTED_LOCAL; image-content checks รวม V2 commands | promotion |
| I5 | migration-tool สร้าง/เซ็นในทุก Production-eligible resolved-all UAT | UAT buildx/ECR/Cosign | UAT | ~2–6m job, parallel; <=2m critical-path target | IMPLEMENTED_LOCAL; UAT publisher policy ต้อง administrator apply | migration readiness |
| C1 | controller มาจาก `github.workflow_sha` protected main | GitHub checkout/blob identity | ทุก workflow | <10s | IMPLEMENTED_LOCAL | all V2 stages |
| C2 | candidate controller/security bytes ไม่ถูก execute | static contract spec | PR/CI | <30s | IMPLEMENTED_LOCAL | all V2 stages |
| C3 | V2 ใช้ signed artifact/hash binding; legacy exact maintenance pins sync ด้วย script เดียว | static contract spec | PR/CI | <30s | IMPLEMENTED_LOCAL; V1 pins ยังมีเพื่อ compatibility | maintainability |
| C4 | actions ทุกตัว pin immutable SHA | workflow static test | PR/CI | <30s | PASS ใน current critical workflows | supply chain |
| H1 | main branch protection 6 required contexts, strict, review policy | GitHub API | readiness daily/readback | <10s | PASS | readiness |
| H2 | production environment มี branch policy | GitHub API | readiness | <10s | PASS; ไม่มี environment reviewer | policy decision only |
| H3 | workflow permissions read by default; OIDC job-scoped | GitHub API/YAML | CI/readiness | <10s | PASS | security |
| H4 | human confirms promotion timing | workflow dispatch/environment approval | หลัง READY | human | DECISION; spec keeps one explicit promotion action | promotion |
| A1 | AWS account `311414082667`, region `ap-southeast-1` | STS | readiness | <5s | PASS | readiness |
| A2 | Production deploy/security-readonly roles exact policy | IAM readback vs templates | readiness | 10–20s | deploy role PASS; updated security-readonly template ต้อง administrator apply | readiness/promotion |
| A3 | durable A5 reader/clone roles exact; one-time bootstrap controller self-revokes | IAM readback vs templates | readiness/bootstrap | 20–40s | templates/tests IMPLEMENTED_LOCAL; temporary role ต้อง administrator apply | A5 |
| A4 | A5 endpoint-only network: ECR API/DKR, Logs, Secrets, S3 | SSM + EC2 endpoint validators | readiness | 20–40s | PASS | A5 |
| A5 | clone/reader SG exact and private | EC2 validators | readiness | 10–20s | PASS | A5 |
| A6 | A5 SSM parameter inventories complete | SSM | readiness | 10–20s | PASS: network 16, clone 8, reader 10 | A5 |
| A7 | migration ECR immutable, scan-on-push | ECR API | readiness | <10s | PASS | A5 |
| A8 | A5 log groups exist and retention set | CloudWatch Logs API | readiness | <10s | PASS: four groups, retention 7d | A5 audit |
| S1 | Production runtime secrets required by API/AI/workers exist | Secrets Manager metadata only | readiness | 10–20s | PASS | promotion |
| S2 | A5 readonly DB URL secret exists | Secrets Manager metadata | readiness | <5s | MISSING: `watchdog-bms/production/a5-readonly-database-url` | all Production DB readiness |
| S3 | readonly PG role privilege proof exact | isolated bootstrap/readback task | one-time + readiness | 5–10m bootstrap; <1m readback | IMPLEMENTED_LOCAL; live proof blocked by S2/bootstrap | all Production DB readiness |
| D1 | RDS available, PostgreSQL 18.3, private/encrypted/Multi-AZ/backup35/del-protection | RDS API | readiness | 10–20s | PASS | readiness |
| D2 | Redis available, encrypted/auth/failover/2 nodes/snapshot35 | ElastiCache API | readiness | 10–20s | PASS | readiness |
| D3 | applied migration ledger exact/pending/drift classification | readonly ECS task + `_prisma_migrations` | readiness | 30–90s | IMPLEMENTED_LOCAL; live blocked by S2/S3 | target/A5 decision |
| D4 | no pending migration selects quick path | signed classification | readiness | included in 1–2m | IMPLEMENTED_LOCAL; live unproven | READY |
| D5 | pending suffix selects exact UAT migration-tool + target all; destructive SQL rejected | signed classification + shared A5 scanner | readiness | <10s after D3 | IMPLEMENTED_LOCAL | A5 |
| D6 | clone restore private/encrypted from recent snapshot | RDS/Fargate A5 | conditional | normal estimate 12–20m; poll sleep ceiling 29m45s | IMPLEMENTED_LOCAL; provider state/terminal tests pass, live first-green still pending | READY with migration |
| D7 | migration rehearsal/invariants/compatibility pass | exact migration-tool task | conditional | normal estimate 2–5m; task poll sleep ceiling 32m | IMPLEMENTED_LOCAL; exact UAT image and result reconstruction tests pass, live first-green still pending | READY with migration |
| D8 | clone/secret/task/ENI cleanup `DESTROYED`, residual=0 | RDS/ECS/EC2 readback | conditional | normal estimate 5–10m; successful-path poll sleep ceiling 20m20s | IMPLEMENTED_LOCAL; computed residual/ambiguous-response cleanup contracts pass, live first-green still pending | READY with migration |
| P1 | all Production services stable singleton/capacity 1/2 | ECS Express readback | readiness/recheck | 10–20s | PASS | READY/promotion |
| P2 | active full SHA/digest/config readable for all services | ECS revision/task definition readback | readiness | 10–20s | PASS | classifier/baseline |
| P3 | baseline is converged or target fail-safe all | Git ancestry + service SHA map | readiness | <10s | current split baseline; first V2 target must be `all` | target |
| P4 | no conflicting release/migration operation | durable release operation + DB advisory fence | mutation boundary | 10–30s | IMPLEMENTED_LOCAL | promotion |
| P5 | `PRODUCTION_RELEASE_READY_V2` signed and attempt-specific | readiness workflow/Cosign | before promotion | quick 1–2m or A5 45–90m | IMPLEMENTED_LOCAL | promotion |
| P6 | baseline still equals READY immediately before mutation | ECS/RDS cheap readback | promotion | <30s | IMPLEMENTED_LOCAL | mutation |
| M1 | mode typed/bound: automatic readiness=`maintenance_closed`; `live` requires explicit attempt | typed workflow input + certificate | readiness/promotion | <1s | IMPLEMENTED_LOCAL | promotion |
| M2 | first OPEN→CLOSED closes ingress/background and drains URLs 900s | maintenance verifier + drain evidence | first close | 15m fixed | implementation exists in progress; live proof pending | closed claim |
| M3 | CLOSED→CLOSED proves continuous closure and skips repeat drain | signed READY baseline + current probes | later release | <1m | IMPLEMENTED_LOCAL | fast closed promotion |
| M4 | `admin_onboard` switch journey matches maintenance spec | auth/route contract + browser test | before first closed deploy | 5–10m test | implementation in PR history; final production proof pending | operator access |
| L1 | residual-processing privacy/security/contact remains valid while closed | minimum privacy controls/evidence | readiness closed | human/policy | PARTIAL; must not be treated as exemption | closed deploy policy |
| L2 | legal release bundle, DPO, processors, retention/deletion, counsel ready | legal evidence validator | readiness live | human/external | BLOCKED; five protected legal variables missing | customer live opening |
| L3 | live opening approval is separate from technical deploy | signed launch decision | CLOSED→LIVE | human | DECISION | live opening |
| V1 | exact digest/source/mode/health/readiness after rollout | ECS + HTTP/internal probes | promotion | <1m after rollout | current verifier exists | finalize |
| V2 | durable release operation finalized/retired | release-task | promotion | observed ~2–4m total fence | current path exists | success |
| V3 | result artifact signed and retained | `PRODUCTION_RELEASE_RESULT_V2` | promotion | <30s | IMPLEMENTED_LOCAL | audit |
| T1 | local `cosign`, `psql`, `actionlint`, `yq`, `shellcheck` installed | workstation | never | 0 | NOT_REQUIRED by V2 | nothing |
| T2 | GitHub-hosted runner has pinned build/sign/AWS tooling | pinned actions/download verification | UAT/readiness | included in jobs | available today | workflows |

## Human-only boundaries

Automation ตรวจความจริงทางเทคนิคได้ แต่แทนสิ่งต่อไปนี้ไม่ได้:

- independent PR approval ตาม branch protection
- owner ตัดสินใจว่า READY release จะ promote เมื่อใด
- counsel/privacy owner รับรอง customer-live legal evidence
- owner ตัดสินใจเปิด CLOSED → LIVE

สิ่งเหล่านี้ต้องเป็น reference ที่ตรวจย้อนกลับได้ ไม่ใช่ free-form string ที่ workflow เชื่อทันที

## Clone timing envelope

Standalone clone และ conditional clone ใน Production Readiness ใช้ runner/controller เดียวกัน.
ทั้งสอง workflow ให้ job ceiling `150m` เพื่อไม่ให้ GitHub ตัด post-run evidence หรือ cleanup เพราะ
action/API latency; ceiling นี้ **ไม่เพิ่ม wait, retry หรือเวลา happy path**. ทันทีหน้าสั่ง restore
workflow จะ assume clone role ใหม่เป็น session `7200s` และ runner มี fixed sleep model ดังนี้:

- forward path สูงสุดตาม poll/backoff ที่กำหนด `4932s` (`82m12s`)
- successful cleanup ที่กันไว้ `1220s` (`20m20s`)
- รวมภายใน refreshed credential `6152s` (`102m32s`) เหลือ `1048s` (`17m28s`) สำหรับ
  AWS/API/action overhead ก่อน credential หมด
- รวม historical pre-run allowance `600s` และ post-run allowance `300s` เป็น `7052s`
  (`117m32s`) จึงเหลือ `1948s` (`32m28s`) ก่อน job ceiling `150m`

ค่าปกติที่คาดคือประมาณ `30–45m`; conservative planning range `55–75m` ยังเป็น estimate เพราะ
ยังไม่มี clone run ที่ผ่าน live จนจบ. Failure paths ที่ response ของ Restore, Modify,
RegisterTaskDefinition หรือ RunTask หายมี modeled maxima ตามลำดับ `1520s`, `3125s`, `3760s`,
`4246s`; ทุกเส้นเรียก cleanup เพียงหนึ่งครั้งและต่ำกว่า session `7200s`. ตัวเลขนี้เป็น
poll/backoff contract ไม่ใช่การรับรอง latency ของ AWS; live first-green ยังเป็นหลักฐานที่ต้องเก็บ.

## Production promotion timing envelope

`release-prepare` ใช้ deadline เดียว `35m` ตั้งแต่ก่อนเรียก runner; การรอ detached task,
การลอง subnet ถัดไป และ task ใหม่ใช้ budget ก้อนเดียวกัน ไม่ได้เริ่ม `35m` ใหม่. ทุก
`DescribeTasks` กำหนด connect timeout `5s`, read timeout `10s`, standard retry สูงสุด 2 attempts
และ controller จะหยุด process เมื่อถึง absolute deadline. Production service poll ถูกจำกัดที่
`75 x 20s = 25m` ต่อ wave; all-target มี internal/background wave แล้วจึง api-web รวมสูงสุด
`50m` ต่อ rollout.

Workflow refresh deploy role `7200s` แยกก่อน durable release, ก่อน closed recovery และก่อน
finalization. Credential envelopes คือ initial close/drain `85m`, release-prepare + rollout +
verification `95m`, recovery `85m` และ finalization `10m`. Job ceiling `360m` **ไม่เพิ่มเวลา
happy path**; conservative failure model รวม controller `30m`, initial close `85m`, prepare
`35m`, rollout `50m`, verification `10m`, recovery `85m`, finalization `10m` และ artifact/action
allowance `15m` เป็น `320m`, เหลือ reserve `40m`. ยังไม่มี first-green Production V2 จึงไม่
อ้าง p95 ที่ไม่มีหลักฐาน; ต้องบันทึกเวลาจริงจาก run แรกแล้วปรับเฉพาะจาก observed evidence.

## Current blocking chain

1. merge/independent approval ของ implementation commit และ required PR checks
2. approved non-root administrator ใช้ consolidated prerequisite ceremony apply+readback IAM/S3
   contracts แล้วลบ temporary authority; จากนั้น bootstrap workflow ต้องสร้าง A5 reader
   secret/PG role และ self-revoke สำเร็จ
3. ใช้ Passport V2 จาก UAT resolved-all run `31559662937` (หมดอายุภายใน
   2026-08-13 10:37:49 BKK) แล้วให้ Production Readiness ได้ first live proof; ถ้ามี pending
   migration ต้องได้ first green restore→rehearse→delete residual=0
4. Production baseline split จึง release แรกต้อง `all` ซึ่ง controller บังคับแล้ว
5. customer live ยังถูก legal evidence บล็อกโดยตั้งใจ; ทำได้เฉพาะ `PROMOTED_CLOSED`

ข้อ 1–3 เป็น external/live evidence ที่ตั้งใจค้างรอ approval ไม่ใช่โค้ดที่ workflow จะค้นพบ
กลาง Production deploy ข้อ 4 เป็น fail-safe target decision และข้อ 5 ไม่บล็อก technical closed
deployment แต่บล็อก `PROMOTED_LIVE`
