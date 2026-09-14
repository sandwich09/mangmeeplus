# Cloud Environment Operations — start, stop, inspect, and what it costs

สร้าง 2026-08-07; ตรวจ live ล่าสุด 2026-08-15 | ทุกตัวเลขและสถานะในเอกสารนี้ **อ่านจาก AWS จริง** ไม่ได้อ่านจากโค้ด
บริบทเต็มของเหตุการณ์ที่ทำให้เกิดเอกสารนี้: `docs/agent-memory/aws-cost-spike-2026-08.md`

เอกสารนี้มีไว้ให้ agent ตัวถัดไป **ไม่ต้องไล่โค้ดซ้ำ** เพื่อตอบคำถามว่า "ตอนนี้อะไรรันอยู่ ปิดยังไง
เปิดยังไง ดูตรงไหน และอะไรที่หลอกตา" ถ้าตัวเลขในเอกสารขัดกับ AWS ให้เชื่อ AWS แล้วมาแก้เอกสาร

Account `311414082667`, region `ap-southeast-1` ทั้งหมด — ไม่มี resource ในภูมิภาคอื่นเลย (สแกนแล้ว 7 region)

---

## Isolated AWS rehearsal completed — 2026-09-14

Later owner-requested UAT power resume: both retained Kamal hosts are running again (API
`i-0eb581c5ac3b3d7ba` at `13.212.80.73`, AI/workers `i-011918b0d49534d1c` at `13.213.14.149`).
Verified EC2 identity and preserved SSH keys before updating private enrollment; private ALB targets
remain `10.92.0.10`/`10.92.0.42`. Dev remains stopped. The stopped-state read below is historical.
Owner approved permanent TCP22 ingress `27.130.60.231/32` for both UAT groups only, preserving
`27.130.53.193/32`: API `sg-021fe21a46c0fcb88` rule `sgr-0e4dfb75cc6543bff`, AI
`sg-089ddbf86bd4251a1` rule `sgr-0d133747833e0c6e0`. Exact `DescribeSecurityGroups` readback confirms
both /32 rules on both groups; no broader/IAM access change. Account-scoped non-root operator used.
This manual ingress is owner-approved drift; do not remove it as temporary rehearsal access or
overwrite it with the older CloudFormation allowlist without preserving the approved rule.

Substitute artifact-preview500 was reproduced in the exact serving API image: PDF.js optional
`@napi-rs/canvas` was stripped by `--no-optional`, causing `DOMMatrix is not defined`; bank PDF text
extraction silently returned `unreadable` for the same omission. It is image packaging, not a missing
running host. [Hotfix/audit and release ledger](../agent-memory/runtime-dependency-hotfix-20260914.md).

The earlier hotfix and shared HEIC/HEIF upload-source consistency were deployed: operation
`20260914T165647Z-f9ecf83a`, main source `038eb55409cf18db587c4e93b93d91492a20bf2e`, terminal
`ACCEPTED_LINE_DEFERRED`,298.538s, all config/readiness checks and KMS signature verified, customer
`OPEN`. Existing previously failing Drtb paper-form preview renders its PDF page after fresh reload;
the original The sun coffee item was not re-tested with the Drtb account. API/DB, AI, Workers/Redis/
internal API passed; new-container bounded logs show no missing-module/DOMMatrix/5xx/timeout pattern.
AgentCore is now `kamal_uat_a` version5. Both UAT hosts retain the enrolled addresses above, Dev is
stopped, and Production is unchanged. PR561/develop and PR562/main passed full exact-head CI before
merge; owner explicitly authorized admin merge for main's missing reviewer approval only. See the
linked release ledger for exact immutable image digests and signed artifact hash.

Previous serving UAT loading hotfix: operation `20260914T182800Z-e3b8bc63`, main source
`f06c9ac8572e5fbbf1ee3bb7b0a7fd8d558a17b9`, accepted 2026-09-14T18:34:03.090095Z,
`ACCEPTED_LINE_DEFERRED`,364.651s, all eleven phases PASSED and KMS signature verified, customer
`OPEN`. Exact API/DB, AI and Workers/Redis/internal API configs/readiness passed. AgentCore
`kamal_uat_b` version6. Fresh Chrome Drtb reload shows route loading and preview loading with
duplicate row actions disabled, then readable PDF page and enabled print. The earlier PDF/HEIC
fixes remain included. Both UAT hosts retain enrolled addresses; Dev remains stopped and Production
unchanged. PR565/develop CI34876912709 and PR566/main CI34878949174 passed full actual checks
before owner-authorized admin merges. [Loading scope, exact digests and signed evidence](../agent-memory/action-loading-hotfix-20260915.md).
Login/logout is NOT_REQUIRED_BY_OWNER, live LINE DEFERRED_BY_OWNER under retained UAT smoke
authorization; CI LINE fixture acceptance is separate. Earlier serving-operation entries below
are historical, not the currently deployed source.

Latest serving UAT preview-cover/performance hotfix: operation `20260914T192255Z-e036fe7a`, main
source `5b2fd63bf82a2917bb47dd0c9a75e2d50edf324c`, finished2026-09-14T19:30:05.252048Z,
`ACCEPTED_LINE_DEFERRED`,429.541s; all11 phases PASSED, KMS signature verified, customer `OPEN`.
Exact API/DB, AI and workers/Redis/internal API source/config/readiness passed; AgentCore now
`kamal_uat_a` version7. Fresh Drtb View shows an immediate centered document-area cover, disabled
print, then a readable page and enabled print; early-close prevents late response reopening.
The PDF.js RGB-tail offset patch removes repeated prior-chunk work: paired isolated serving-image
synthetic pipeline median5.688s→1.609s (~72% faster), with identical page size/encoding quality.
No source/checksum/tenant permission change. PR569/develop CI34884275830 and PR570/main CI34884441376
passed full actual checks before owner-authorized admin merges; main reviewer waiver only.
Both UAT hosts retain enrolled addresses and permanent SSH rules, Dev is stopped and Production
unchanged. [Exact digests, signed artifact and verification](../agent-memory/preview-cover-performance-hotfix-20260915.md).
Login/logout and live LINE remain covered only by the retained UAT smoke exception above.
Old zero-phase `RUNNING` shell `20260911T164143Z-49739d4d` has two historical snapshot copies,
unchanged since Sep11 with no active lock or mutation phase; targeted process check finds no old
controller. Do not count stale receipt labels/snapshot duplicates as live queued/running operations,
or rewrite/delete historical evidence; verify active lock, process and mutation evidence instead.

Latest verified state at **00:41:22.152660 UTC**: Dev `i-0883f1ff88440ca07` and both UAT Kamal hosts
are **stopped**. Owner approved exact temporary SSH access for this rehearsal; rule
`sgr-0a12dbd8f66e96575` was removed and absence verified. Preserve the original allowlist.
The last Dev public IP47.129.159.150 is historical and must be re-enrolled after any restart.
Production services and the existing bastion were not changed. Earlier pending-approval entries
below are historical. No IAM policy was changed.

Shared core operation `20260914T003123Z-1f9c690a` passed on main00cbaa8b, then powered off Dev
immediately. Main-to-core-proof507.797s; command including fixture setup/shutdown569.800s. This is
not Production acceptance: synthetic credentials/data, single Dev host, customer gate CLOSED, no
AgentCore update or real Production topology/provider/customer proof. Original failed Redis fixture
setup is retained: official entrypoint UID999 could not read owner1000 mode0600 config. Correct
fixture uses non-root UID1000 plus private writable data; TLS PONG/SAVE and clean core run passed.
Private fixtures/app containers remain on the stopped volume; restarting Dev may restart them.
[Full timing, scope and evidence](../agent-memory/kamal-prod-simulation-2026-09-13.md).

## Production configuration readback — 2026-09-13

Read-only preparation used the existing non-root reader to capture all three Production ECS Express
`activeConfigurations`, beginning 14:40:53 UTC. All advertise source
`fc2838c4cb691033f41595c0d43587f10377d33c`; this is configuration evidence, not running-container or
customer acceptance proof. All 12 distinct secret references resolved at their current versions;
metadata/versions remained unchanged on the final read. New main `00cbaa8b` builds and its three
service config schemas passed against this baseline plus tracked Production overrides, in local
network-disabled validation containers. No Production resource or traffic was changed.

No Production Kamal target is enrolled locally. The prepared command/example is not infrastructure
or cutover completion. [Scope, checks and evidence](../agent-memory/kamal-prod-preparation-2026-09-13.md).

Fresh 15:17–15:20 UTC rehearsal inspection: both UAT Kamal hosts and Dev are **stopped**, with no
assigned public IP; the old addresses below must not be reused. The bastion remains running.
Production RDS is available on PostgreSQL **18.3**, `db.t4g.small`, Multi-AZ, private/encrypted,
35-day backups and deletion protection. Complete ECS config/12 secret-version metadata matches the
earlier baseline. Existing reader credentials deny even the Dev start dry-run, CF/IAM discovery and
Redis discovery. Owner subsequently restored root Console and authorized its use for isolated testing,
requiring immediate simulation-host shutdown. Root readback confirms Production Redis **7.1.0**, two
`cache.t4g.micro` nodes, Multi-AZ/failover, TLS, at-rest encryption and auth. The Dev SSH allowlist has
the previous workstation address; an exact temporary /32 approval is pending. No host or IAM state
changed. [Simulation evidence and pending access](../agent-memory/kamal-prod-simulation-2026-09-13.md).

Actual Production DB support read at **16:05:09 UTC**, using existing `watchdog_support_ro` IAM auth,
verified TLS and a read-only transaction: PostgreSQL18.3, **182 applied migrations, 0 unfinished**.
Ordered migration names/SQL checksums exactly match source `fc2838c4...`; main `00cbaa8b...` contains
188. Its six pending migrations require normal mode before any hotfix-only promotion. No data or DDL
was changed. Support session `root-l5tdyxu2594req3e72dhhl6lze` is verified **Terminated**. The local
PostgreSQL18.3/TLS rehearsal passed the actual normal upgrade and subsequent hotfix, but does not
establish AWS deployment timing, managed Redis parity, multi-AZ readiness or customer acceptance.

## UAT Kamal update — 2026-09-11 20:28 UTC

Owner-authorized UAT Kamal proof is separate from the ECS V2 Production protocol. Production remains
on ECS and was not changed. Dev instance `i-0883f1ff88440ca07` remains stopped. Existing UAT ECS
services are parked at0/0; UAT traffic uses stack `mangmee-kamal-uat` (VPC `vpc-061922f7174f90a70`).

- API: `i-0eb581c5ac3b3d7ba`, public `52.77.223.9`, private `10.92.0.10`.
- AI/workers: `i-011918b0d49534d1c`, public `47.129.248.19`, private `10.92.0.42`.
- UAT origin: `https://uat.mangmeeplus.com`; existing ALB private targets unchanged.
- Current serving main `6b95e505` passed two complete smoke deployments `20260911T170623Z-c8d84820`
  and `20260911T171058Z-8c83ebfc`, verified KMS signatures and full config/readiness/OPEN. Full times
  4m14.836s and4m25.786s; AgentCore `kamal_uat_b` version4. See the linked task memory/report.
- Latest serving operation `20260911T201637Z-cb364f03` rebuilt the same main with an initially empty
  isolated BuildKit/dependency store and passed full config/readiness/OPEN plus KMS signature once,
  without error or retry. Deploy command 11m14.699s; including operator checks/builder setup
  11m32.827s; including isolated-builder cleanup 11m39.039s. Existing UAT hosts/images were retained;
  this is cold build cache, not new hosts. AgentCore remains `kamal_uat_b` version4; dev was freshly
  confirmed stopped. [Full cold-cache evidence](../research/kamal-uat-cold-cache-proof-2026-09-12.md).
- UserData-only bootstrap correction completed15:48:07.379Z after49.251476s. EBS instances restarted
  in place; public IPs changed. Enrollment was updated only after AWS identity and original SSH host
  keys matched. Existing containers preserve old `KAMAL_HOST` metadata; do not rewrite it for rollback.
- Actualtemplate equals the reviewedv2 with corrected HOME ownership and pinnedproxyv0.9.2. Both
  actual `cloud-init schema` checks pass. Fresh OS boot of the new script has not been exercised.
- Read-only operation `20260911T155433Z-2e90e0bd` proved all3 original container IDs/image/full config,
  proxy routes and deep health after restart; source `120256910c9a320409e9cfabfe3ec5ae377c4e18`.
- Bootstrap is initial environment setup, never part of `infra/kamal/deploy-uat` or `deploy-prod`.
  Do not rerun bootstrap on serving hosts. See `docs/agent-memory/kamal-stability-2026-09-11.md` for
  the subsequent application update/rollback/restore ledger. The older inventory below is historical.

## 1. อะไรรันอยู่ (live read-back 2026-08-15)

| Resource | ตัวตน | สถานะ |
| --- | --- | --- |
| ECS cluster | `watchdog-bms-prod`, `watchdog-bms-uat` | ทั้งคู่ ACTIVE |
| prod services | `watchdog-bms-api-web-pub`, `watchdog-bms-ai-gateway-v2`, `watchdog-bms-workers` | **ACTIVE, capacity 1/2 และมี task รันครบ 3 ตัว**; source `748f1fa…`; serving mode `maintenance_only` ทั้งหมด |
| uat services | `watchdog-bms-uat-api-web` (2 vCPU/6 GB), `-ai-gateway` (1/2), `-workers` (0.5/1) | **ACTIVE, capacity 1/2 และมี task รันครบ 3 ตัว**; serving mode `live` |
| RDS UAT | `watchdog-bms-uat-db` — `db.t4g.micro`, 20 GB, Single-AZ, backup 1 วัน | encrypted, `PubliclyAccessible: false` |
| RDS Production | `watchdog-bms-prod-db` — `db.t4g.small`, 20 GB, Multi-AZ, backup 35 วัน, deletion protection | encrypted, `PubliclyAccessible: false` |
| ElastiCache UAT | `watchdog-bms-uat-redis` — standalone `cache.t4g.micro`, engine 7.1 | pg `watchdog-bms-uat-redis7`, **ไม่ได้เข้ารหัส/ไม่มี auth** |
| ElastiCache Production | replication group `watchdog-bms-prod-redis` — 2× `cache.t4g.micro` | available, encrypted at rest/in transit, auth, automatic failover, snapshot 35 วัน |
| ALB | `ecs-express-gateway-alb-ff8c07dd` | ใช้ร่วมกันทั้ง prod และ uat, 3 ENI/EIP |
| EC2 | `i-0f3b3881690dcf874` `watchdog-bms-ssm-bastion` `t3.nano` | เปิดค้าง มี public IP |
| ECR | `watchdog-bms-api` / `-ai-gateway` / `-workers` / `-web` | lifecycle เก็บ 20 images; `watchdog-bms-migration-tool` ยังไม่มี policy |
| AgentCore | runtime `watchdog_orchestrator` | READY |
| App Runner | 2 service legacy | PAUSED — pause หยุดคิดเงินจริง ($11.95 → $0) |

**ถูกลบไปเมื่อ 2026-08-07:** NAT gateway `nat-06303bcc18968c82d` และ Production Redis ก้อนเดิม;
Production Redis ถูกสร้างใหม่เป็น replication group ตาม M-17 เมื่อ 2026-08-08

Network: subnet public 3 อัน (main route table → IGW) และ private 2 อัน (`rtb-07f3ced2ad683cd23`) ซึ่งตอนนี้
เหลือ route `local` อย่างเดียวหลังลบ NAT — ในนั้นมีแค่ ENI ของ UAT RDS กับ UAT Redis ซึ่งไม่ออกอินเทอร์เน็ต
Fargate ปกติรันใน **public subnet** ออกทาง IGW ไม่ใช่ NAT แต่ production A5 สร้าง interface endpoint
ECR API/DKR, Logs และ Secrets Manager พร้อม `PrivateDnsEnabled=true` ใน VPC เดียวกันเมื่อ 2026-08-10
จึงทำให้ชื่อ AWS service เหล่านี้ของ UAT วิ่งเข้า private endpoint ด้วย ไม่ได้ออก IGW. Endpoint SG และ policy
ต้อง allowlist execution role พร้อม SG ของทุก runtime ที่ยังใช้ VPC นี้: UAT ใช้
`watchdog-bms-uat-app-egress-sg`/`watchdog-bms-uat-ai-egress-sg`; production ใช้
`watchdog-bms-prod-app-egress-sg`/`watchdog-bms-prod-ai-egress-sg`. ถ้าขาด role, policy หรือ SG จุดใด
task จะ timeout ก่อนเริ่ม container แม้ public route ปกติ. Task production เก่าที่ยังรันอยู่ไม่ใช่หลักฐานว่า
พร้อม deploy เพราะมัน pull image/secret ก่อนสร้าง endpoint เหล่านี้

---

## 2. เครื่องมือหลอกตาตรงไหน — อ่านก่อนเชื่อ output

นี่คือส่วนที่กิน context ของ agent มากที่สุดถ้าไม่รู้มาก่อน

**`aws ecs describe-services` ใช้กับ Express Mode ไม่ได้** มันคืน `desiredCount: 0`, `runningCount: 0`,
`taskDefinition: null` ให้ทุก service ไม่ว่าจริง ๆ จะรันอยู่หรือไม่ — เคยทำให้สรุปผิดว่า production ล่ม
ใช้ `aws ecs describe-express-gateway-service --service <arn>` แทน แล้วอ่าน `activeConfigurations[0]`

**Express Mode ไม่มี `desiredCount`** capacity อยู่ที่ `activeConfigurations[0].scalingTarget`
(`minTaskCount` / `maxTaskCount`) คำสั่ง `--desired-count` จะได้ `Unknown options` กลับมา

**`update-express-gateway-service` เป็น full replace ไม่ใช่ patch** ต้องส่ง 9 key ครบทุกครั้ง
(`serviceArn`, `executionRoleArn`, `healthCheckPath`, `primaryContainer`, `taskRoleArn`,
`networkConfiguration`, `cpu`, `memory`, `scalingTarget`) ห้ามพิมพ์เอง — ให้ round-trip จาก
`describe-express-gateway-service` แล้วเปลี่ยนเฉพาะฟิลด์ที่ต้องการ ไม่งั้น env/secret หายทั้งชุด

**CI ที่ conclusion เป็น `success` ไม่ได้แปลว่าเทสรัน** commit ที่แตะแต่ docs จะ skip ทุก job
รวมถึง Typecheck and Test แล้วยังจบเป็น success — และ `deploy-uat` ยอมรับ run แบบนั้น
ถ้าจะยืนยันว่าโค้ดถูกเทสจริง ต้องเปิดดู job ไม่ใช่ดูแค่ conclusion

---

## 3. เปิด / ปิด

การ deploy release ใหม่ทั้ง UAT และ Production ใช้ canonical flow ที่
`docs/runbooks/uat-production-v2-deployment.md`. ส่วนนี้อธิบาย cloud operation และ capacity;
ห้ามใช้คำสั่ง Production V1 จากเอกสาร historical.

### UAT — deploy

Deploy ทำผ่าน GitHub workflow เท่านั้น ไม่ใช่จากเครื่อง (`infra/prod-ecs-express/README.md`)
controller ต้องรันจาก `main` ส่วน `release_ref` เป็น SHA เต็มที่ reachable จาก `develop`

```sh
gh workflow run deploy-uat.yml --ref main \
  -f release_ref=<lowercase-40-char-sha> -f target=all -f run_m01_acceptance=false
```

warm all-target คาด 17–19 นาที; run `31468653715` attempt 2 ที่ reuse image แล้วใช้เวลา
14m51s ใน deploy job. ตรวจผลด้วย **digest จริง** ไม่ใช่แค่สถานะ workflow:

```sh
aws ecs describe-tasks --cluster watchdog-bms-uat --tasks <arn> \
  --query 'tasks[0].[group,containers[0].image]' --output text
aws ecr describe-images --repository-name watchdog-bms-workers \
  --image-ids imageDigest=<digest> --query 'imageDetails[0].imageTags'
```

tag จะเป็น `git-<full-sha>` ต้องตรงกับ SHA ที่สั่ง deploy

ก่อน reusable CI/build เริ่ม workflow จะใช้ deploy role เดิมทำ read-only early preflight:
exact-read deploy/release-task policies, ตรวจสาม service ให้ stable/singleton พร้อม canary,
rollback alarm และ circuit breaker เดิม, ตรวจ metadata ของ secret ที่ runtime ต้องใช้ และบังคับ
rollback alarms ทั้งสามเป็น `OK`. ถ้า fail จะหยุดก่อน publish image; exact IAM readback ยังรันซ้ำ
ใน deploy job ก่อน mutation เพื่อกัน policy drift ระหว่าง build. Script ที่ใช้จริงคือ
`infra/uat/verify-deploy-readiness.sh`; ห้ามแก้ให้ต้อง health ผ่าน เพราะ UAT ที่ pause หรือ app เสีย
ต้องยัง deploy ตัวแก้ได้

**Release task network (พิสูจน์ 2026-08-11):** ต้นเหตุของ run `31408125154` attempts 1/2 ไม่ใช่
subnet เสีย แต่เป็น production A5 interface endpoints ด้านบน: private DNS มีผลทั้ง VPC ขณะที่ endpoint
SG/policy เดิมรับเฉพาะ A5 task ทำให้ UAT release task ติดต่อ Secrets Manager ไม่ได้ทุก AZ. หลังเพิ่ม
execution role ของ UAT ลง policy แบบจำกัดเฉพาะ UAT secrets/ECR repos/log groups และเพิ่ม UAT app SG
ใน endpoint SG, release task/migration ผ่าน; AI Gateway ยัง rollback เพราะใช้ AI SG แยก จึงเพิ่ม SG นั้น
ด้วย. Run `31418060978` attempt 3 จาก source `aca76203239feac359988938768ab66132c2018a`
ผ่าน all-target, health/digest verification และ signed UAT acceptance ครบ. `run-release-task.sh` ยังมี
subnet failover เป็น safety net เฉพาะ `TaskFailedToStart` ก่อน container เริ่มและไม่มี exit code เท่านั้น;
ห้าม retry เมื่อ container เริ่มแล้วเพราะอาจทำ mutation ซ้ำ

**Production preflight (พบ 2026-08-11):** production runtime ใช้ execution role
`ecsTaskExecutionRole` และ SG สองตัวด้านบน แต่ endpoint policy/SG ที่แก้ UAT รอบแรกยังไม่รวมสามจุดนี้.
ก่อน rollout production ครั้งแรกต้องเพิ่ม role แบบจำกัดเฉพาะ runtime ECR repositories,
`watchdog-bms/production/*` secrets และ `/ecs/watchdog-bms-prod-*` log groups พร้อม SG สองตัว แล้ว
read-back policy และ endpoint boundary ให้ตรง template; ห้ามใช้ task เก่าที่ยัง ACTIVE เป็นหลักฐานแทน

### UAT — ปิด (จอดที่ศูนย์)

วิธีที่ถูกต้องคือผ่าน deploy script ซึ่งรองรับตั้งแต่ commit `333e711`:

```sh
ECS_EXPRESS_MIN_TASKS=0 ECS_EXPRESS_MAX_TASKS=0 \
  bash infra/uat/deploy-with-runtime-mutex.sh all
```

default คือ `1`/`2` และ **production ปฏิเสธค่าอื่นทันที** เพราะ
`infra/security/collect-production-a5-current-health.sh` เทียบ service จริงกับ literal
`{minTaskCount:1,maxTaskCount:2,AVERAGE_CPU,70}` ตอนเก็บ signed evidence

ถ้าจำเป็นต้องทำตรง ๆ กับ API ให้ round-trip ตามข้อ 2 อย่าพิมพ์ payload เอง

**ไทม์ไลน์หลังสั่งปิด** (วัดจริง): task drain หมดใน ~4 นาที แล้ว ENI กับ public IPv4 ถูกคืนอีก
~6 นาทีหลังจากนั้น service ยังคงเป็น `ACTIVE` พร้อม image และ config เดิม — เปิดกลับคือการปรับ
capacity ไม่ใช่ deploy ใหม่

### UAT — เปิดกลับ

**ตั้งแต่ 2026-09-05 ห้ามใช้ `deploy.sh` จากเครื่องเพื่อเปิดกลับ:** `deploy.sh` รุ่นที่ deploy อยู่ (ตั้งแต่ `71263dd0`)
ปฏิเสธ service rollout ทุกแบบถ้าไม่มี `RELEASE_PARENT_OPERATION_ID`, `RELEASE_TASK_IMAGE` และ
`DEPLOYMENT_EVIDENCE_DIR` จาก release task (พิสูจน์แล้ว: `bash infra/uat/deploy-with-runtime-mutex.sh all`
จาก checkout ที่ `71263dd0` จบด้วย rc=2 พร้อมข้อความนั้น) ให้ใช้ API round-trip ตามข้อ 2 แทน:

```sh
export AWS_PROFILE=watchdog-bedrock AWS_SDK_LOAD_CONFIG=1 AWS_REGION=ap-southeast-1
for arn in $(aws ecs list-services --cluster watchdog-bms-uat --query 'serviceArns[]' --output text); do
  aws ecs describe-express-gateway-service --service "$arn" --output json > before.json
  jq '.service.activeConfigurations[0] as $c | {serviceArn: .service.serviceArn,
        executionRoleArn: $c.executionRoleArn, healthCheckPath: $c.healthCheckPath,
        primaryContainer: $c.primaryContainer, taskRoleArn: $c.taskRoleArn,
        networkConfiguration: $c.networkConfiguration, cpu: $c.cpu, memory: $c.memory,
        scalingTarget: ($c.scalingTarget | .minTaskCount = 1 | .maxTaskCount = 2)}' before.json > payload.json
  aws ecs update-express-gateway-service --cli-input-json file://payload.json >/dev/null
done
```

คัดลอก 9 key จาก describe ทั้งชุด เปลี่ยนเฉพาะ `scalingTarget` (image/env/secrets ต้องเหมือนเดิม byte-for-byte —
ตรวจด้วย jq ก่อนยิง) หลัง update แต่ละ service จะมี **`activeConfigurations` สองตัว** (revision เก่า 0/0 กับใหม่ 1/2)
ประมาณ 3 นาทีจน deployment ของ revision ใหม่จบ (`aws ecs list-service-deployments --service <arn>` เป็น
`SUCCESSFUL`) ต้องรอจน `length(service.activeConfigurations) == 1` ทั้งสาม service **แล้วรัน
`infra/uat/verify-deploy-readiness.sh` จากเครื่อง (read-only, env `DEPLOY_ENV=uat ECS_CLUSTER_NAME=watchdog-bms-uat`)
ให้ผ่านก่อน** ค่อย dispatch `deploy-uat.yml` — สั่งเร็วไปจะล้มที่ preflight ด้วย
`api-web is not a stable singleton UAT service` (run `33946705432`, 2026-09-05) และเสีย dispatch ไปหนึ่งครั้ง
**`run-a5-capacity-mutating.sh` ต้องการ `minTaskCount >= 1`** ต้องเปิดก่อนรัน U5 capacity

### Production

Production release ใหม่ต้องผ่าน signed UAT Passport และ Production READY แล้ว dispatch
`deploy-production-v2.yml` ตาม `uat-production-v2-deployment.md`; ห้ามเรียก `deploy.sh` จาก
workstation เพื่อทำ promotion. ค่า capacity/status ด้านล่างเป็น inventory/diagnostic context เท่านั้น.

ณ 2026-08-15 ทั้งสาม service มี capacity `1/2`, source SHA เดียวกัน `748f1fa…` และมี task รันครบ
แต่จงใจอยู่ใน `maintenance_only`; App Runner legacy ทั้งคู่ยัง PAUSED

> **Production Redis topology/hardening ของ M-17 พิสูจน์แล้ว:** CloudTrail `CreateReplicationGroup` วันที่ 2026-08-08
> บันทึก 2 nodes, Multi-AZ/automatic failover, encryption at rest/in transit, auth token และ snapshot
> retention 35 วันโดยไม่มี error. Production readiness run `31789220329` วันที่ 2026-08-14
> (`sourceCommit=748f1fa87f57e4c7b899e7dfec5bd62ea2d8c916`) ผ่าน
> `productionRuntime=PASS` และ artifact integrity; `production-runtime.json` SHA-256
> `17148172d4157d19333684c3b84d362c3de53e4de053c76e4f4e62bf8798f8f7` อ่านค่าครบตรงกับ
> live cache nodes ที่ `available`. Workstation ยังไม่มี `DescribeReplicationGroups` โดยตั้งใจ;
> ไม่ต้องขยายสิทธิ์หรือ rebuild ก้อนนี้ ให้ใช้ dedicated readiness role เป็น canonical read-back ต่อไป
> แต่ M-17 รวมยังห้ามปิดจน restore/RTO/RPO, post-restore re-erasure และ secret rotation/revocation ผ่าน

---

## 4. ดูตรงไหน

**Production API boot กับอีเมลที่ปิดอยู่ (2026-09-07):** run `34072334980` ล้มก่อน migration เพราะ
`deploy.sh` render `SES_FROM_ADDRESS=""` แต่ `apiConfigSchema` ยอมให้ละ field นี้ได้ ไม่ยอมรับค่าว่าง.
`EMAIL_PROVIDER=disabled` ไม่ข้าม schema validation. Production workflow ต้องส่ง sender ที่ถูกต้อง
ผ่าน `SES_FROM_ADDRESS` (fallback `contact@mangmeeplus.com` เหมือน UAT); ค่านี้ไม่เปิดส่งอีเมลหรือเพิ่ม
สิทธิ์ SES. เมื่อวิเคราะห์ task ที่ exit ก่อน health ให้ดู startup log และตรวจ environment กับ schema
จริงด้วยค่าลับจำลอง ไม่เก็บ runtime secret ลง log. หลักฐาน: `docs/agent-memory/production-disabled-email-env-2026-09-07.md`.

```sh
# service จริง ๆ เป็นยังไง (อย่าใช้ describe-services)
aws ecs describe-express-gateway-service \
  --service arn:aws:ecs:ap-southeast-1:311414082667:service/watchdog-bms-uat/watchdog-bms-uat-workers

# task ที่รันอยู่ + ขนาด
aws ecs describe-tasks --cluster watchdog-bms-uat --tasks <arn> \
  --query 'tasks[].{group:group,cpu:cpu,mem:memory,started:startedAt}'

# มี restart loop ไหม — นับ stream ต่อวัน ปกติคือหลักหน่วย
aws logs describe-log-streams --log-group-name /ecs/watchdog-bms-uat-workers \
  --order-by LastEventTime --descending --max-items 10

# ค่าใช้จ่ายแยก service
aws ce get-cost-and-usage --region us-east-1 \
  --time-period Start=<YYYY-MM-DD>,End=<YYYY-MM-DD> \
  --granularity MONTHLY --metrics UnblendedCost --group-by Type=DIMENSION,Key=SERVICE

# เจาะว่า usage type ไหนกิน
aws ce get-cost-and-usage --region us-east-1 --time-period Start=...,End=... \
  --granularity DAILY --metrics UnblendedCost \
  --filter '{"Dimensions":{"Key":"SERVICE","Values":["AmazonCloudWatch"]}}' \
  --group-by Type=DIMENSION,Key=USAGE_TYPE
```

Cost Explorer คิด **$0.01 ต่อ request** และข้อมูล **ทยอย post ข้าม 24 ชม.** — ยอดที่ query ตอนเช้าอาจ
ต่ำกว่าความจริงมาก (ใน session นี้ตัวเลขเดียวกันขยับจาก $173 เป็น $263 ระหว่าง query สองครั้ง)

### Employee LINE webhook — UAT + Production (ตรวจ live 2026-08-18)

Webhook ของ OA `uat-mangmeeplus` ต้องชี้ไปที่ค่า SSM
`/watchdog-bms/uat/ecs-express-api-web-url` ต่อท้าย `/v1/line/webhook`. อย่าใช้
`https://uat.mangmeeplus.com/v1/line/webhook` จนกว่าจะแก้ POST timeout: custom domain ตอบ
`GET /v1/health` เป็น 200 แต่ LINE provider webhook test ได้ `REQUEST_TIMEOUT`; URL ของ ECS Express
โดยตรงได้ `success=true`, `statusCode=200`, `reason=OK` และถูกตั้งเป็น live endpoint แล้ว.

หลังเปลี่ยนหรือ deploy UAT ให้ read-back endpoint และรัน provider test เสมอ; health GET อย่างเดียว
ไม่พิสูจน์ webhook POST. อ่าน access token จาก Secrets Manager แบบไม่พิมพ์ค่า แล้วใช้ Messaging API
`GET/PUT /v2/bot/channel/webhook/endpoint` และ `POST /v2/bot/channel/webhook/test`. หลักฐาน acceptance
และเหตุการณ์ synthetic ที่จบ `completed` อยู่ใน `docs/agent-memory/uat-ai-not-responding.md`.

Production เคยชี้ `https://mangmeeplus.com/v1/line/webhook` และ LINE provider test ได้
`REQUEST_TIMEOUT` แบบเดียวกัน ขณะที่ ECS Express origin โดยตรงผ่าน. หลัง owner อนุมัติ live endpoint
ของ OA `มั่งมี Plus` ถูกเปลี่ยนเป็นค่า SSM
`/watchdog-bms/production/ecs-express-api-web-url` ต่อท้าย `/v1/line/webhook`; exact read-back ได้
`active=true` และ configured-endpoint test ได้ `success=true`, `statusCode=200`, `reason=OK`.
การแก้นี้ไม่ใช่ ECS deploy และไม่เปลี่ยน customer gate. ห้ามยิง synthetic business message ใน
Production เพื่อพิสูจน์ต่อเอง; ให้ใช้ข้อความจริงของพนักงานที่ได้รับอนุญาต.

โปรไฟล์ local แยกชัดเจน: `thawatchai` คือ AWS root ส่วน `watchdog-bedrock` และ
`watchdog-bedrock-dev` คือ IAM user `watchdog-bedrock-dev`. จาก audit 2026-08-12 ไม่มี platform
หรือ bootstrap role ที่ user นี้ assume ได้; GitHub OIDC roles ทั้งหมดก็ไม่มีสิทธิ์แก้ IAM. User
อ่าน `GetRole` และเขียน `PutRolePolicy/CreateRole` บางส่วนได้จาก policy เก่า แต่ขาด
`GetRolePolicy`, `UpdateRole` และ `UpdateAssumeRolePolicy` สำหรับ promotion roles จึงห้ามใช้ root
สร้าง boundary หรือแก้ target roles. ต้องให้ owner/provider จัด non-root platform-admin session
ชั่วคราว แล้วใช้ temporary non-root boundary ที่สร้างและถอดได้ตาม
`docs/runbooks/production-promotion-prerequisite-bootstrap.md`; Readiness จะ exact-readback ซ้ำ
ก่อนออก READY. ถ้าโดน AccessDenied แล้วอยากรู้ว่า policy ไหนบล็อก ใช้ Policy Simulator แบบ
read-only ได้

Audit promotion prerequisite วันที่ 2026-08-12 พบ drift ที่ทำนายได้ก่อน rollout: deploy role
ยังมี `MaxSessionDuration=3600`, workers cleanup policy ยังไม่มี, A5 execution trust/policies บางตัว
ยังเป็น contract เก่า, API/AI runtime task policy ยังเป็น generated contract รุ่นเก่า และ Production
S3 lifecycle ขาด `NoncurrentVersionExpiration` ใน rule `expire-uncompleted-uploads`. Readiness V2
จึงต้อง exact-read ทั้ง IAM/runtime roles, secret metadata, SSM pointers, cluster/network,
S3/log/KMS/SNS และ fail ก่อนออก READY; ห้ามไปค้นทีละ error ระหว่าง deploy. การซ่อม drift ทั้งหมด
ใช้ consolidated non-root ceremony เดียวตาม runbook ด้านบน แล้วลบ temporary authority.

Live RDS source ที่ยืนยันใน audit เดียวกันคือ `watchdog-bms-prod-db`, DB name `watchdog_bms`,
master username `watchdog`, port `5432`; clone runner ต้อง derive `PGDATABASE`, `PGHOST` และ
`PGPORT` จาก `DescribeDBInstances` ของ clone ห้าม hardcode หรืออ่านจาก workstation.

> **A5 security-group read-back:** `describe-security-groups` อาจ canonicalize กฎ egress
> TCP/443 ที่มี endpoint security group และ S3 prefix list เป็น `IpPermission` เดียว แม้ส่งคำสั่ง
> authorize แยกกันสองครั้ง ให้ตรวจ resource targets ทั้งสองแบบ semantic; อย่าเทียบจำนวน
> `IpPermissions` ว่าต้องเป็นสอง object

### UAT DB จากเครื่อง dev (เพิ่ม 2026-08-10)

UAT RDS ไม่ public — เข้าโดย port-forward ผ่าน SSM bastion `watchdog-bms-ssm-bastion`
ต้องมี `session-manager-plugin` (`brew install --cask session-manager-plugin`) และ psql
(`brew install libpq` ได้ client อย่างเดียว keg-only ที่ `/opt/homebrew/opt/libpq/bin/psql`)

**แท็บที่ 1 — เปิดอุโมงค์ค้างไว้** (Ctrl-C ปิด):

```sh
infra/uat/db-port-forward.sh                        # 127.0.0.1:55432 → UAT RDS:5432
```

**แท็บที่ 2 — ใช้งาน** อุโมงค์ต้องเปิดอยู่:

```sh
psql "$(infra/uat/db-port-forward.sh --url)"        # URL จาก secret ชี้อุโมงค์ให้แล้ว
infra/uat/db-port-forward.sh --fields               # host/port/db/user/password สำหรับ DBeaver
```

`--url` แก้ URL ที่เก็บใน secret สองจุดเพราะ libpq ไม่รับของ Prisma: ตัด `schema=public`
(psql ตอบ `invalid URI query parameter: "schema"`) และลด `verify-full` เป็น `require`
เพราะ cert ของ RDS ไม่ match ชื่อ `127.0.0.1` — ยังเป็น TLS อยู่ แค่ไม่ตรวจชื่อโฮสต์

DBeaver ต้องชี้ **Host `127.0.0.1` Port `55432`** ไม่ใช่ RDS host ที่ `--fields` พิมพ์ออกมา
(ช่องนั้นมีไว้ดูว่าอุโมงค์ปลายทางไปไหน) ส่วน database/user/password ใช้ตามที่พิมพ์ได้ตรง ๆ

script ตรวจ SG ให้ก่อนเปิด: ถ้า UAT DB SG ยังไม่รับ bastion SG บน 5432 จะพิมพ์คำสั่ง
`authorize-security-group-ingress` ให้ copy ไปรัน (รูปแบบเดียวกับ production support path)

**ล้าง LINE link รายบัญชีเพื่อเทสซ้ำ** — survey ก่อนเสมอ แล้วค่อย `--apply`:

```sh
# 1. หาว่ามีบัญชี LINE ไหน link อยู่
psql "$(infra/uat/db-port-forward.sh --url)" -c 'SELECT ei."providerUserId", ei.status, u.email FROM "ExternalIdentity" ei JOIN "User" u ON u.id = ei."userId" WHERE ei.provider = $$LINE$$ ORDER BY ei."linkedAt" DESC;'

# 2. ดูว่าจะโดนอะไรบ้าง (ไม่ลบ)
scripts/heal/line-link-reset.sh "$(infra/uat/db-port-forward.sh --url)" <LINE_USER_ID>

# 3. ลบจริงใน transaction เดียว
scripts/heal/line-link-reset.sh "$(infra/uat/db-port-forward.sh --url)" <LINE_USER_ID> --apply
```

ลบเฉพาะ `ExternalIdentity` (provider=LINE), `LineCompanyContext`, `LineWebhookEventLog`
ของ LINE id นั้น — webhook log จับคู่ด้วย sha256 hex 16 ตัวแรก ตรงกับ `hashMessagePreview()`
**ไม่แตะ** `EmployeeLineLinkToken` (ผูกกับ membership ไม่ใช่บัญชี LINE — ออก QR ใหม่แทน)
และ identity ฝั่ง CRM ลูกค้า; ปฏิเสธ URL ที่มีคำว่า `prod` ทันที

### CloudWatch log retention — policy ปัจจุบัน (อัปเดต 2026-08-09)

| ขอบเขต | Log group/prefix | เก็บไว้ |
| --- | --- | ---: |
| UAT | `watchdog-bms-uat-*` | **3 วัน** |
| Production | `watchdog-bms-prod-*` | **14 วัน** |
| Production support session | `/aws/ssm/session-logs/watchdog-bms-production` | **14 วัน** |
| กลุ่ม production เดิม | กลุ่ม legacy ที่ชื่ออยู่ใต้ `watchdog-bms-*` และ App Runner production เดิม | **14 วัน** |

ตารางนี้คือ policy ที่ต้องถือเป็นค่าปัจจุบันสำหรับ CloudWatch logs; ไม่ใช่ retention ของ AI data,
database backup หรือ GitHub artifact ซึ่งมีนโยบายแยกกัน ไฟล์นี้แก้จากค่าที่เคยระบุ UAT 30 วัน,
production 90 วัน และบางกลุ่มไม่จำกัดเวลา

AWS read-back วันที่ 2026-08-09 ยืนยันแล้วว่า log group ที่ใช้งาน 14 กลุ่มตรงตาม policy:
กลุ่ม UAT ที่มีอยู่ 3 กลุ่มเป็น 3 วัน และกลุ่ม production/legacy/support ที่มีอยู่ 11 กลุ่มเป็น
14 วัน ส่วน `/probe/invalid/xyz-does-not-matter-if-denied` เป็นกลุ่มทดสอบที่ยัง `None`
โดยตั้งใจและไม่อยู่ใน service log retention baseline

Alarm install/read-back วันที่ 2026-08-15 เวลา 01:10 น. (UTC+7): Production มี contract ที่
verify กับ datapoint จริงผ่านแล้วครบ 9 alarms จาก `infra/monitoring/runtime-alarms.sh` ได้แก่
`IncomingBytes` 3 app groups, Redis memory แบบ per-node 2 nodes, RDS storage/memory/connections/
CPU credit และทุก alarm ชี้ไป confirmed SNS subscription. Script SHA-256 ที่ใช้คือ
`12a21225a68a133b953490a7fd66764031ff0190e14333b265006063bb126157`.
SNS accepted a sanitized canary publish with MessageId
`198e9125-6a84-5124-866b-f3dc35bfe21e`. Owner-supplied inbox evidence on 2026-08-15 confirmed
delivery; only screenshot SHA-256 `f524646240c97510a4a500e1bcfecedf064e2549f620081dbd586605d09451bb`
is retained because the image exposes the mailbox and unsubscribe endpoint.

Alarm Redis เดิม `watchdog-bms-prod-redis-memory-high` ที่ใช้ `ReplicationGroupId` และไม่มี datapoint
ถูก retire แล้วเมื่อ 2026-08-15 02:54:25 UTC+7 หลัง valid per-node alarms verify ผ่าน; CloudTrail event
`b7ab5aed-5fda-43e0-ba26-ea15da175ce1` และ post-delete `DescribeAlarms=0` เป็นหลักฐาน.
**UAT ยังไม่มี alarm ชุดใหม่** เพราะ encrypted Redis v2 ยังไม่ถูกสร้าง. เหตุการณ์ UAT workers
วันที่ 6 ส.ค. ingest 214,075,786,774 bytes ในวันเดียว แต่ 24 ชั่วโมงก่อน audit เหลือประมาณ
2,984,094 bytes แปลว่า incident หยุดแล้วแต่ UAT preventive control ยังต้องเพิ่มตาม
`docs/plans/uat-production-runtime-config-remediation-plan.md` Phase 3

---

## 5. Redis / BullMQ — memory

**สร้าง Queue ได้ที่เดียว** `apps/workers/src/common/queue.ts` เท่านั้น มี `defaultJobOptions`
คุม `removeOnComplete: {count: 48}` / `removeOnFail: {count: 100}` และ
`apps/workers/src/common/queue.spec.ts` บังคับว่าห้ามไฟล์อื่นเรียก `new Queue(` — ถ้าเพิ่มคิวใหม่แล้ว
เรียกเอง เทสจะแดง นี่คือผลจากเหตุการณ์ที่ 6 ใน 7 คิวลืมตั้ง retention จน Redis 400 MB มี 270k key

**`maxmemory-policy` ต้องเป็น `noeviction`** UAT ใช้ parameter group `watchdog-bms-uat-redis7` แล้ว
ตั้งแต่ 2026-08-07 (`default.redis7` แก้ไม่ได้ จึงต้องสร้าง custom) วิธีทำอยู่ใน `infra/uat/README.md`

เหตุผลที่ลึกกว่าคำเตือนของ BullMQ: `volatile-lru` ลบเฉพาะ key ที่มี TTL ซึ่งในระบบนี้คือ
**rate-limit counters กับ actor-delegation replay store** ส่วน job record ของ BullMQ ที่ไม่มี TTL
และเป็นตัวที่ทำให้เต็มจริงกลับไม่เคยเป็นเป้า — cache จะทิ้ง security state เงียบ ๆ ก่อนแล้วค่อย OOM อยู่ดี

Live metric วันที่ 2026-08-15 หลังแก้ retention: UAT ใช้ ~18.3 MB (`DatabaseMemoryUsagePercentage`
~4.54%); Production สอง node ใช้ ~17.3/~17.1 MB (~4.30/~4.24%); eviction เป็นศูนย์ทุก node.
UAT เปิดอยู่ที่ capacity 1/2 ในรอบตรวจนี้ จึงต้องจอดกลับเมื่อ acceptance จบ ไม่ใช่อาศัยสมมติฐานว่า
ยังจอดอยู่

**อย่าเชื่อ Redis alarm เดิมแม้ state เป็น `OK`:** `watchdog-bms-prod-redis-memory-high` ใช้
dimension `ReplicationGroupId=watchdog-bms-prod-redis`, แต่ `DatabaseMemoryUsagePercentage` ของก้อนนี้
ออกด้วย `CacheClusterId`/`CacheNodeId`. Query 24 ชั่วโมงด้วย dimension ของ alarm ได้ 0 datapoints และ
state reason ระบุชัดว่า missing 2 จุดถูกนับเป็น non-breaching. ตอนนี้ per-node alarms มี datapointจริง
และตัวเดิมถูก retire แล้วตาม remediation plan Phase 3; ห้ามสร้าง alarm แบบ `ReplicationGroupId` กลับมา

**crash ถูกจำกัดขนาด log แล้ว** `fatalDetail()` ใน `apps/workers/src/common/log.ts` ตัดที่ 2,000 chars
และ `main.ts` ดักทั้ง `unhandledRejection` / `uncaughtException` ก่อน parse config — ถ้าไม่มีตัวนี้
Node จะ inspect error object ทั้งก้อนซึ่งมี Lua script ของ BullMQ แปะมาด้วย (~162 MB ต่อ crash)

---

## 6. ค่าใช้จ่าย

Cost Explorer วันที่ 2026-08-15 สำหรับ 1–14 ส.ค. ได้ pre-tax **$362.08**, tax **$25.32**,
รวม **$387.397**. รายการใหญ่คือ CloudWatch $180.83, ECS $81.32, RDS $30.07, VPC $22.95,
ElastiCache $18.53 และ ELB $8.10. CloudWatch ส่วนใหญ่เป็น incident log ingest วันที่ 5–7 ส.ค.;
ไม่ใช่ steady-state ใหม่ทั้งหมด

AWS Budget มีอยู่แล้วชื่อ `WatchDog-BMS Monthly Cost Budget`, limit $100, actual $387.397,
forecast $787.792 พร้อม email subscriber สำหรับ actual 85%/100% และ forecast 100%. ไม่ต้องสร้างซ้ำ;
ให้ปรับ baseline/threshold หลังแยก tag และมีเดือนที่ไม่มี incident ตาม remediation plan

Platform-admin pass วันที่ 2026-08-15 tag live cost-bearing inventory 49 resources ครบ
`Environment`/`Component`/`ManagedBy`: production 21, shared 16, UAT 12 และ aggregate read-back
มี invalid contract ศูนย์. `Environment` cost-allocation tag เป็น `Active`; `Component` ยังรอ Billing
discover key ก่อน activate. ค่าใช้จ่ายเดิม $387.397 ยังอยู่ช่อง blank เพราะ tag ไม่ย้อนหลัง และต้องรอ
ค่าใช้จ่ายใหม่ post ก่อนยืนยัน Cost Explorer แยกสาม environment ได้จริง.

Cost Anomaly Detection มีอยู่แล้ว: SERVICE monitor หนึ่งตัวและ DAILY confirmed email subscription
หนึ่งตัว ไม่ต้องสร้างซ้ำ. Threshold live เป็น absolute impact >= $100 **AND** percentage impact >= 40%;
จะลด threshold หรือไม่เป็น tuning decision แยกจากการพิสูจน์ว่า control มีอยู่จริง.

Bedrock **ไม่เคยเป็นต้นเหตุ** — $3.20 ทั้งเดือน แม้ IAM user จะชื่อ `watchdog-bedrock-dev`

### กับดักการวัดที่เคยทำให้ประเมินผิด 20–100 เท่า

- **CloudWatch คิดเงินจาก raw ingest แต่ `storedBytes` คือขนาดหลังบีบอัด** (~20 เท่า) log group
  แสดง 7.15 GB แต่ ingest จริง ~152 GB = $179 **ห้ามประเมินค่า log จาก `describe-log-groups`**
- **`imageSizeInBytes` ของ ECR นับ shared layer ซ้ำทุก image** รวมได้ 113 GB แต่บิลจริง $0.52
- **`NatGateway-Hours` กับ `NatGateway-Bytes` แยกกัน** NAT ที่ไม่มี traffic เลยก็ยังจ่าย $43.90/เดือน
  ตรวจว่ามีใครใช้จริงไหมด้วย `-Bytes` ไม่ใช่การมีอยู่ของ gateway

---

## 7. ระวัง

1. **ลบ NAT จาก Console ไม่ปลด Elastic IP ให้** EIP จะกลายเป็น unassociated แต่ยังถูกคิดเงิน $3.65/เดือน
   และเหลือ route `0.0.0.0/0` สถานะ `blackhole` ค้างใน route table — ต้องเก็บเองทั้งสองอย่าง
2. **explicit Deny ชนะ Allow เสมอ** การแนบ policy ใหม่ไม่ได้ลบ Deny ใน policy เดิม ต้องแก้ policy เดิม
   ด้วย `create-policy-version --set-as-default` ไม่ใช่แค่แก้ไฟล์ในเครื่อง
3. **`elasticache:ModifyCacheCluster` ตรวจสิทธิ์ทั้ง cluster ARN และ parameter-group ARN**
   scope แค่ cluster จะได้ AccessDenied ที่พูดถึง parameter group ทำให้ไล่ผิดทาง
4. **การลบ data store ของ production ควรทำด้วยสิทธิ์คน** guardrail บน user อัตโนมัติมีไว้แบบนั้นตั้งใจ
   ใช้ Console แทนการรื้อ policy
5. **workflow ทุกตัวเป็น `workflow_dispatch` ไม่มี cron** ไม่มีอะไรสร้าง resource เองตามเวลา
6. **`ECS_EXPRESS_SUBNET_MODE` default เป็น `public`** และ `deploy.sh` ยังปฏิเสธ `private` สำหรับ
   api-web ตรง ๆ ส่วน A5 clone/audit ใช้ endpoint-only private network แยกต่างหากและไม่ต้องสร้าง NAT
   คืนแล้ว: `bootstrap-production-a5-private-network.sh` สร้าง ECR API/DKR, Logs,
   Secrets Manager และ S3 endpoints พร้อม narrow SG/route read-back เมื่อ 2026-08-10. เพราะ interface
   endpoint ใช้ private DNS ระดับ VPC bootstrap จึงต้องรักษา execution-role policy และ task SG ของทั้ง
   UAT และ production runtime ใน boundary ด้วย; อย่าลบ allowlist เหล่านี้ขณะ endpoint ยังอยู่
   AWS CLI v2.36.15 ไม่มี waiter `vpc-endpoint-available`; bootstrap จึง poll `State` แบบ bounded
   และรับเฉพาะ `available` โดย fail ทันทีเมื่อเจอ terminal failure state
7. **UAT Redis ตัวที่รันอยู่ยังไม่ได้เข้ารหัส** ทั้ง at-rest, in-transit และไม่มี auth token — secret
   เก็บเป็น `redis://`. ห้ามใช้ขั้นตอนเก่าที่ลบ node และ force-delete secret ก่อนสร้างใหม่;
   helper `infra/uat/redis-blue-green.sh` ทำ blue/green แบบรักษา secret ARN/version rollback และใช้
   mutex ร่วมกับ deploy แล้ว แต่ยังไม่ได้ run กับ AWS; ลบ node เก่าหลัง soak เท่านั้น
8. **Production มี `IncomingBytes` alarm แล้ว แต่ UAT ยังไม่มี**. เพิ่ม UAT per-log-group alarm ก่อน
   acceptance รอบยาว; อย่าใช้ข้อความเก่าว่าไม่มี alarm ทั้ง account

### ECR scan gate — CVE ใหม่ใน base image

`infra/docker/verify-ecr-scan.sh` รันใน CI ทุก build แล้วส่ง finding จาก ECR เข้า
`infra/docker/ecr-scan-blocking-findings.jq` เกตนี้ **fail-closed**: HIGH/CRITICAL ทุกตัวที่ไม่มี waiver
ตรงเป๊ะจะบล็อก deploy และ `coverageComplete` ยังบังคับให้จำนวน finding ที่อ่านได้ตรงกับ severity count
ของ ECR ด้วย (กันกรณี ECR รายงานตัวเลขแต่ไม่ส่งรายละเอียด)

**bump base image ไม่ช่วย เมื่อ Debian ยังไม่มี fix** ฐานคือ `node:22-bookworm-slim` pin ด้วย digest
CVE ที่เจอส่วนใหญ่เป็นแพ็กเกจ Debian (openssl, zlib) ไม่ใช่โค้ดเรา ถ้า security-tracker บอกว่า bookworm
ยังไม่มี fixed version การดึง digest ใหม่ก็ได้แพ็กเกจเวอร์ชันเดิมกลับมา — เสียเวลา build ฟรี
เช็คก่อนเสมอที่ `https://security-tracker.debian.org/tracker/<CVE>` ดูช่อง bookworm ว่าเป็น
`vulnerable` หรือมีเลขเวอร์ชันที่ fix แล้ว

**กติกา waiver** (ดูตัวอย่างจริงในไฟล์ `.jq`): ทุกแถวต้องมี CVE ตรงตัว + `severity` + `package_name` +
`package_version` + anchor ที่คัดลอกจาก description ของ provider แบบคำต่อคำ + epoch หมดอายุ +
approval id ของ Owner ทั้งหมดต้องแมตช์พร้อมกัน — drift ตัวใดตัวหนึ่ง (เวอร์ชันขยับ, severity เปลี่ยน,
provider แก้ข้อความ) กลับไปบล็อกทันที `severity`/`package`/`version` เก็บระดับแถว จึงเพิ่มแถว CRITICAL
ได้โดยไม่ทำให้แถว HIGH เดิมหลวม และแต่ละชุดมี `def` หมดอายุของตัวเอง หมดอายุแยกกันได้
แก้ไฟล์แล้วต้องรัน `bash infra/docker/ecr-scan-blocking-findings.spec.sh` เสมอ

**กระบวนการที่ต้องมี ไม่ใช่ waive ไปเรื่อย ๆ**

1. re-scan ทุกคืนแล้วแจ้งเตือน — ให้รู้ CVE ใหม่ก่อนถึงวัน deploy ไม่ใช่ตอน pipeline แดง
2. คง base pin ไว้ แต่ bump digest เป็นรอบ ๆ เพื่อรับ fix ที่ Debian ปล่อยจริง
3. ใส่ `apt-get upgrade` ตอน build **เฉพาะเมื่อ** Debian มี fixed version แล้วเท่านั้น
4. ถึงวันหมดอายุให้ประเมินใหม่ — ถ้ายังไม่มี fix ต้องขออนุมัติต่ออายุใหม่ ไม่ใช่ยืด epoch เงียบ ๆ

> ⚠️ waiver หนึ่งแถวต้องเพิ่ม **สองไฟล์**: `infra/docker/ecr-scan-blocking-findings.jq` (เกต UAT/CI) และ
> `e0_ecr_waiver_rows` ใน `infra/security/evidence-contracts.jq` (production security preflight) —
> ใส่แค่ไฟล์แรก UAT ผ่านแต่โปรโมต production ถูกปฏิเสธ แก้แล้วรัน
> `bash infra/security/production-security-preflight.spec.sh` ด้วย

#### Waiver ledger

ทุกครั้งที่ออก ต่ออายุ หรือปลด waiver ให้เพิ่มแถวที่นี่ ห้ามแก้ epoch เงียบ ๆ โดยไม่มีแถว

| วันที่ | CVE | expiry เดิม → ใหม่ | approval id | หลักฐาน tracker (อ่านวันนั้น) |
| --- | --- | --- | --- | --- |
| 2026-08-27 | CVE-2026-14456, CVE-2026-54874, CVE-2026-63072, CVE-2026-63076 (HIGH, `openssl 3.0.20-1~deb12u2`) | — → `1788998400` (2026-09-10) | `CHAT-OWNER-DIRECTIVE-2026-08-27-FIX-ALL-UNTIL-DEPLOY-SUCCEEDS` | bookworm ยัง `vulnerable`, base ที่ pull ใหม่ 2026-08-27 ยังเป็น 3.0.20-1~deb12u2 |
| 2026-09-05 | CVE-2026-75803 (CRITICAL, `openssl 3.0.20-1~deb12u2`), CVE-2026-85091 (HIGH, `zlib 1.2.13.dfsg-1`) | — → `1789776000` (2026-09-19) | `CHAT-OWNER-DIRECTIVE-2026-09-05-UAT-DEPLOY-WAIVER` | bookworm openssl + zlib `vulnerable`, digest `node:22-bookworm-slim` ใหม่สุดก็ยังได้แพ็กเกจเดิม |
| 2026-09-05 | CVE-2026-54874, CVE-2026-63072, CVE-2026-63076, CVE-2026-75803, CVE-2026-85091 (ต่ออายุครบทั้ง 5 แถว) | `1788998400` / `1789776000` → `1791158400` (2026-10-05T00:00:00Z) | `CHAT-OWNER-DIRECTIVE-2026-09-05-CVE-WAIVER-RENEWAL-2026-10-05` | security-tracker อ่าน 2026-09-05: bookworm `openssl 3.0.20-1~deb12u2` ยัง `vulnerable` ทั้ง 4 CVE ไม่มี fixed version ของ bookworm (fix เฉพาะ trixie-security `3.5.7-1~deb13u2` และ sid `3.6.4-1`); CVE-2026-85091 **ไม่มี fixed zlib ใน suite ไหนเลย** — bump digest ไม่ช่วย |
| 2026-09-05 | CVE-2026-14456 — **ปลดแถวทิ้ง (retired)** ไม่ต่ออายุ | `1788998400` → ไม่มีแถวแล้ว | (ปลดตามกติกา M-18 ใน `p1-production-security-operations.md`) | ECR ไม่รายงาน finding นี้อีก และ tracker ขึ้น bookworm openssl เป็น `<not-affected> (Vulnerble code introduced later)` |

ครั้งหน้าหมดอายุ **2026-10-05T00:00:00Z** ถ้าถึงวันนั้นแล้ว Debian ยังไม่มี fix ต้องขอ approval id ใหม่
อีกรอบ (ไม่ใช้ id เดิมซ้ำ) — เกตจะบล็อกทั้ง 5 แถวทันทีที่ `now >= 1791158400`

### โค้ดกับ AWS sync กันแล้ว (2026-08-09)

ก่อนหน้านี้ AWS กับเอกสารตรงกัน (UAT 3 / production 14) แต่ **โค้ดยังเป็น 90/30** และแย่กว่านั้นคือ
`deploy.sh` ไม่ได้แค่ตั้ง default ผิด — มัน **ปฏิเสธนโยบายจริง**:

| จุด | เดิม | ผล |
| --- | --- | --- |
| `deploy.sh:110` | `>= 30` | UAT 3 ถูกปฏิเสธ |
| `deploy.sh:114` | production `= 90` เป๊ะ | production 14 ถูกปฏิเสธ |
| `deploy.sh:624` | เขียน retention ทุก deploy | ทับค่าที่ตั้งด้วยมือทุกครั้ง |

ตั้ง `LOG_RETENTION_DAYS=14` แล้ว deploy production จะ **fail ทั้งรอบ** ไม่ใช่แค่ใช้ค่าเก่า

แก้แล้วให้ pin ทั้งสองฝั่ง: production ต้องเป็น **14 เป๊ะ** UAT ต้องเป็น **3 เป๊ะ** ปฏิเสธทั้งค่าที่ต่ำกว่า
และสูงกว่า เหตุผลที่ pin สองทางไม่ใช่ทางเดียว: `ensure_log_group()` เขียนค่าลง log group ทุกกลุ่ม
ที่มันแตะในทุก deploy ถ้าปล่อยไม่ pin ค่าที่ใครก็ตามใส่มาจะกลายเป็นนโยบายใหม่ในรอบถัดไป
โดยไม่มีใครตัดสินใจ — ซึ่งเป็นสาเหตุที่ทำให้ค่าจริงกับเอกสารหลุดจากกันตั้งแต่แรก

## 8. Delivery links ของใบรับรองแทนใบเสร็จ (`/d/{token}`) — ❌ ยกเลิกแล้ว (D15, 2026-08-20) ไม่ต้องทำ

> **ฟีเจอร์นี้ถูกถอดออกทั้งชุด** ตามมติ owner D15: เอกสารไม่ถูกส่งกลับ LINE เป็นลิงก์อีกต่อไป ผู้ใช้ไป
> โหลดเองที่เว็บ (ซึ่งเขา login อยู่แล้วเพื่อ certify/approve) จึง **ไม่มี prefix `line-delivery/`, ไม่มีสำเนา PDF
> ชั่วคราวบน S3, ไม่ต้องตั้ง lifecycle/noncurrent-version/no-`ListBucket` อะไรทั้งสิ้น** ตัดภาระ ops ก้อนนี้ทิ้ง
> เนื้อหาด้านล่างเก็บไว้เป็นบันทึกของสิ่งที่เคยมีและถูกถอด — ไม่ต้องดำเนินการใด ๆ

Feature branch `codex/line-substitute-receipt-assisted-issuance` ส่งเอกสารเข้า LINE เป็นลิงก์
`{web}/d/{token}` ที่ 302 ไปยัง presigned GET ของ **สำเนาชั่วคราว** ใน bucket แนบไฟล์เดิม
(`S3_BUCKET`) ใต้ prefix `line-delivery/` — key เป็น base64url สุ่ม 43 ตัวอักษร ไม่มี id บริษัท/
เอกสาร/ผู้ใช้/วันที่ปน ต้นฉบับไม่ถูกย้ายหรือลบ

สิ่งที่ระบบ **ไม่ทำเอง** และต้องตั้งที่ AWS ก่อนใช้จริง:

1. **Lifecycle rule บน prefix `line-delivery/`**: expire ที่ **3 วัน** (อายุ token ตายตัว 72 ชม.
   ฝั่งแอปจะปฏิเสธเองหลังหมดอายุ — lifecycle มีไว้ลบ bytes) และเพราะ bucket เปิด versioning
   (`putObject` ของแอป assert VersionId) ต้องตั้ง **NoncurrentVersionExpiration (1 วัน)** ด้วย
   ไม่งั้นการ revoke (ลบ object → เกิด delete marker) จะทิ้ง noncurrent version ที่มีข้อมูลส่วน
   บุคคลค้างไว้ตลอด บวก **AbortIncompleteMultipartUpload** กัน marker สะสม
2. **IAM**: role ที่แจก presigned GET ต้อง **ไม่มี `s3:ListBucket`** บน prefix นี้ (spec §12.3);
   create ใช้ `s3:PutObject`, revoke ใช้ `s3:DeleteObject`
3. Presigned GET อายุ **120 วินาที**, `disposition: inline`, ชื่อไฟล์กลาง `substitute-receipt.pdf`
4. **Local dev**: `LocalStorageAdapter` ไม่มี lifecycle เลย — สำเนาใน `$TMPDIR/watchdog-bms-local-storage/`
   อยู่จนกว่าจะล้าง temp เอง และมัน ignore อายุ presign (คืน path relative บน API origin)
5. **Platform access = CLOSED**: route `/v1/document-delivery/:token` เป็น `@Public()` แต่ไม่อยู่ใน
   `CLOSED_PUBLIC_PATHS` → ช่วงปิดระบบ ลิงก์จะขึ้นหน้า "ลิงก์นี้ใช้ไม่ได้แล้ว" แทนเอกสาร
   (ตั้งใจ fail-closed; ถ้า owner อยากให้ลิงก์รอดช่วงปิดระบบ ให้เพิ่ม path เข้า allowlist นั้น)
6. **Log hygiene**: path ที่มี token ถูก mask เป็น `/v1/document-delivery/:token` ในทุกจุดที่ log
   path (request logger / exception filter / rate-limit security event) — ถ้าเพิ่มจุด log ใหม่
   ที่แตะ `req.path` ต้องผ่าน `maskLoggedPath()` เสมอ token เป็น bearer credential ของเอกสารกฎหมาย

---

## Visitor IP through the api-web container (review R06) — 2026-09-06

Rate limits that are keyed on the visitor (the 20/hour signup-claim bucket, the password-login
failure bucket) depend on one assumption about the ingress chain, recorded here because breaking it
silently collapses every visitor into one key rather than failing loudly:

- prod chain is browser → Cloudflare Worker → **ECS Express gateway** → `web-api-proxy.mjs` →
  Nest (or Next), all inside one container over loopback.
- `trustedClientIp()` honours `x-forwarded-for` only when the TCP peer is the private/loopback tier
  and walks the chain **from the right**, skipping every hop our own tier or Cloudflare appended.
  The first hop that is neither is the answer.
- **The assumption:** the ECS Express gateway appends the peer it actually observed. That appended
  hop is what makes a visitor-supplied `x-forwarded-for` unusable as a self-chosen key — a forged
  value always sits to the LEFT of the observed one and is skipped.
- The claim BFF (`apps/web/app/api/auth/signup-claim/route.ts`) calls the API server-to-server, so
  it forwards the chain verbatim with `forwardedClientHeaders()`. Without it every applicant in the
  country shares the container's loopback address as one bucket.

**If the ingress is ever changed** — a different gateway, a direct-to-ALB path, Cloudflare removed —
re-check that the rightmost hop is still infrastructure-appended before trusting these buckets. The
symptom of a broken assumption is not an error: it is a shared key (everyone throttled together) or
a spoofable one (nobody throttled). `apps/api/src/common/security/trusted-client-ip.spec.ts` holds
the property tests for both directions.

Known gap: `apps/web/app/api/auth/login/route.ts` has the same shape and does NOT forward the chain
yet. It is in the production maintenance pins, so changing it needs a pin re-sync in the same PR.
