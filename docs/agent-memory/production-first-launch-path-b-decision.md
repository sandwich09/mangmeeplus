# Agent Memory: production first launch via path B (partial-incident)

Status: DECIDED 2026-08-08 — เจ้าของเลือกทาง B หลังทาง A (U5 promotion ceremony) เจอ dormant bug
หนาแน่นในเส้นที่ไม่เคยรันจริง
Owner: thawatchai (repo owner)

## มติ

ขึ้น production ครั้งแรกผ่าน **partial-incident mode** ของ `deploy-production.yml` ทีละ service
(`api-web` → `ai-gateway` → `workers`) แทน promotion mode (`target=all` + U5/A5 ceremony)

## ทำไมไม่ใช้ทาง A (promotion ceremony)

ทาง A ถูกออกแบบครบและมี spec test แต่ **โค้ด path ไม่เคยรันจริงกับ AWS** (A5 network SSM param เป็น
`ParameterNotFound` มาตลอด) การรัน `bootstrap-production-a5-private-network.sh --apply` เป็นครั้งแรก
เจอบั๊ก 4 ตัวติดกันภายใน ~30 นาที:

1. jq operator precedence — `.SecurityGroups|length==1 and .[0]...|length` → `boolean has no length`
   (แก้แล้ว, PR #4 `0cb42ee`)
2. `local a="$1" b="${a}"` forward-reference under `set -u` → `unbound variable`
   (แก้แล้ว, PR #4 `1d5f2f7`)
3. (เข้าใจผิดชั่วคราว — validator ผ่านจริง)
4. **AWS merge สองกฎ 443 (group + prefix) เป็น IpPermission เดียว** แต่ `normalize()` ใน
   `validate-production-a5-clone-security-groups.sh` + spec fixture คาดเป็น 2 element แยก →
   validator ปฏิเสธ SG ที่ bootstrap สร้างเอง **ยังไม่แก้** — เป็น mismatch ระหว่าง AWS behavior
   กับ evidence-chain logic ที่แก้แล้วกระทบ signed evidence + spec ไม่ควรแก้ระหว่าง ceremony

ตัวที่ 4 ต่างจาก 1–3: ไม่ใช่ crash แต่เป็น security-validator logic ที่ไม่ตรง AWS จริง และยังเหลือ
ขั้น IAM/clone/shadow/approval ที่ยังไม่แตะ คาดว่ามี dormant bug อีก การ debug security evidence
chain ทีละบั๊กระหว่างพยายามขึ้น prod ให้ทันเป็นความเสี่ยงที่ไม่คุ้ม

## ทำไมทาง B ได้สิ่งที่ต้องการครบ

เป้าเจ้าของ: **DB query ได้ / เว็บเล่นได้ / ต่อ AI ได้** — ทั้งสามไม่พึ่ง A5/U5 chain เลย
(A5/U5 = shadow-only evidence สำหรับ feature-entitlement governance ของ VAT/WHT statutory
ไม่ใช่ runtime capability) ทาง B deploy **โค้ดตัวเดียวกัน** ผ่าน CI gate เดียวกัน (typecheck/test/
security/SBOM/sign/scan) ต่างแค่ authority path

## สิ่งที่ยอมรับ (recorded risk)

- audit trail บันทึกการขึ้นครั้งแรกเป็น "incident" ไม่ใช่ "governed release" — governance บนกระดาษ
  ไม่กระทบการใช้งาน
- WHT/VAT enforcement flip ยังต้องผ่าน U5 chain แยกก่อนเปิด — ทาง B ไม่ได้เปิดสิ่งเหล่านั้น
- A5 SG 4 ตัวที่สร้างค้าง (ฟรี ไม่มี endpoint) เก็บไว้ใช้ตอนทำ A5 chain รอบหน้าที่มี fix แล้ว

## incident refs ที่ใช้

- `incident_ref`: `INC-2026-0808-first-production-launch`
- `incident_approval_ref`: `approval://owner/thawatchai/2026-08-08-first-launch`
- เหตุผลผูกกลับมาที่เอกสารนี้

## Next

- Merge candidate ไม่ต้อง (develop == main = b6eccc8)
- Deploy 3 service ทีละตัว: api-web → ai-gateway → workers
- migration item11b fix ทำแล้ว → `prisma migrate deploy` ผ่าน
- หลัง deploy: smoke (login/upload/expense/LINE) → support roles → M-01 evidence
- A5 chain (พร้อม 4 fixes) = งานแยก ไม่มี time pressure

## บทเรียน: production ขาด control-plane setup ที่ UAT มี (2026-08-08)

Deploy ล้ม 4 รอบติด แต่ละรอบเป็น **IAM resource ที่ UAT มีแต่ production ไม่มี** เจอทีละตัวตอน
deploy พัง แทนที่จะเทียบทั้งชุดก่อน (เจ้าของทักเรื่องนี้ตรง ๆ ว่า "ทำไมไม่ลอกจาก UAT มาเลย" —
ถูกต้อง และควรทำตั้งแต่แรก):

| รอบ | ตายที่ | ขาดอะไร |
| --- | --- | --- |
| 1 | workflow parse | `actions: read` ใน caller permissions |
| 2 | Verify release image signatures | ECR read บน `-ai-gateway`, `-workers` |
| 3 | RegisterTaskDefinition | `iam:PassRole` (policy บน role เก่ากว่า template) |
| 4 | RunTask | **`watchdog-bms-release-task-role` ไม่มีอยู่จริง** |
| 5 | Deploy immutable manifest | `kms:DescribeKey` (log group encryption) |
| 6 | Deploy immutable manifest | ไม่ใช่ IAM — เป็นบั๊กจริงในโค้ด ดูหัวข้อถัดไป |

**ต้นเหตุเชิงโครงสร้าง:** UAT มี `infra/uat/setup-control-plane.sh` ที่สร้าง role ครบ 8 ตัว
พร้อม trust/policy — **production ไม่มีสคริปต์เทียบเท่า** resource เดิมถูกสร้างด้วยมือจาก repo เก่า
บางตัวหายตอนย้าย repo และไม่มีอะไรตรวจว่าครบ

**สิ่งที่ควรมี (งานตามหลัง):** `infra/production/setup-control-plane.sh` ที่ mirror ของ UAT
(role, trust, policy) + ตรวจ readback ก่อน mutate — เพื่อไม่ให้ต้องไล่เจอทีละ deploy รอบละ ~15 นาที
(ทุกรอบ build image ใหม่หมดก่อนถึง Deploy job)

**ค่าที่ลอกมาจาก UAT ตรง ๆ:**
- release-task trust: `{Service:"ecs-tasks.amazonaws.com", Action:"sts:AssumeRole"}`
  (`setup-control-plane.sh:62`)
- release-task policy: ECS describe (`DescribeExpressGatewayService`,
  `DescribeServiceDeployments`, `ListServiceDeployments`) + SSM Get/PutParameter บน
  `parameter/watchdog-bms/production/ecs-express-*-service-arn`
  (`verify-control-plane-policies.sh:20-21`, เปลี่ยน uat→production)
- **taskRole ไม่ต้องอ่าน DATABASE_URL** — executionRole (`ecsTaskExecutionRole`) เป็นคน resolve
  secret ให้ (ยืนยันจาก `uat-environment.md:179`)

**สถานะ IAM หลังแก้ครบ:** 6 role ที่ production ต้องใช้มีครบและ trust ถูกทั้งหมด
(`ecsTaskExecutionRole`, `ecsInfrastructureRoleForExpressServices`, ecs-express api/ai-gateway/
workers, release-task)

## บทเรียน: UAT ไม่มีทางเจอบั๊กนี้เพราะ threshold อยู่ที่ 100 (2026-08-08)

รอบ 6 ตายที่ `Deploy immutable manifest` ด้วยข้อความ

```
ERROR: recent before-deployment snapshot is paginated; refusing to prepare a non-exhaustive intent
```

**ต้นเหตุ:** AWS CLI **ไม่ auto-paginate** `ecs list-service-deployments` (เรียกเปล่า ๆ ได้ 20 แถว,
`--max-results 100` ได้ 100 แถว — ทั้งสองแบบมี `nextToken` ติดมา) แต่สคริปต์ในโฟลเดอร์
`infra/prod-ecs-express/` **5 จุด** อ่านหน้าเดียวแล้วปฏิเสธถ้าเจอ `nextToken` โดยไม่เคยเดินหน้าถัดไป

จำนวน deployment จริงตอนตรวจ:

| env | api-web deployments | เกิน 100? |
| --- | --- | --- |
| UAT | 93 | ไม่ |
| production | **184** | **ใช่** |

นี่คือเหตุผลที่ CI/UAT ผ่านมาตลอดแต่ production พังทันที — guard จะทำงานก็ต่อเมื่อเกิน 100 เท่านั้น
และ **UAT กำลังจะชนเพดานเดียวกันในอีกประมาณ 7 deploy**

**5 จุดที่เป็นบั๊กเดียวกัน:**

| จุด | ไฟล์ | เดิมทำอะไรเมื่อ paginated | อยู่บนเส้นทาง prod deploy |
| --- | --- | --- | --- |
| 1 | `deploy.sh` (before-set ของ intent) | `exit 1` | ใช่ (ตายรอบ 6) |
| 2 | `verify-express-noop.sh` | `return 75` | ใช่ (เฉพาะ no-op) |
| 3 | `lib-wait-for-service-url.sh` ×2 | jq `.nextToken == null` → `return 1` | ใช่ (หลัง deploy สำเร็จ) |
| 4 | `active-launch-builds.sh` | สอง read ไม่ตรงกัน → defer | ใช่ (ขั้น retire) |
| 5 | `verify-serving-api-build.sh` | `return 75` | ไม่ (เส้น F2/A5) |

**ข้อผูกพันที่สำคัญ:** จุด 1 เขียน before-set ลง intent แล้วจุด 2 เอาไปเทียบ **byte-for-byte** —
ถ้าแก้จุด 1 ให้ครบ 184 แต่จุด 2 ยังอ่าน 100 การเทียบจะไม่ตรงและกลายเป็นบั๊กใหม่ทันที
ทั้งสองจุดจึงต้องแก้พร้อมกัน

**วิธีแก้:** helper กลางตัวเดียว `infra/prod-ecs-express/list-service-deployments-all.sh`
เดินทุกหน้าแล้วคืน object รูปเดิมที่ `nextToken` เป็น null เสมอ (รองรับ `--query` แบบ per-page)
ทุกจุดเรียกผ่าน helper นี้ — guard `.nextToken == null` เดิม **คงไว้ทั้งหมด** เปลี่ยนสถานะจาก
"กำแพง" เป็น "tripwire" ที่จะดังก็ต่อเมื่อ helper เองพัง มี page cap
(`LIST_DEPLOYMENTS_MAX_PAGES`, ค่าเริ่มต้น 50 = 5000 deployment) กัน pagination ที่ไม่รู้จบ → exit 75

**หลักฐาน:**
- helper กับ production จริง: 184 รายการ, unique 184, `nextToken: null`, ทั้งรูปแบบธรรมดาและ `--query`
- อ่านสองครั้งได้ byte-identical (35185 bytes) — เงื่อนไขที่จุด 3 กับ 4 ต้องใช้
- `release-safety.spec.sh` ผ่าน, `production-image-security.spec.sh` ผ่าน
- spec case เดิมที่ยืนยัน "paginated → ปฏิเสธ" ถูกแทนด้วยสองกรณี: **หลายหน้าที่จบ → merge แล้วรับ**
  และ **pagination ที่ไม่จบ → ปฏิเสธ 75**

**สิ่งที่ยังไม่แก้ (จงใจ):** `bind-express-deployment.sh` อ่านหน้าเดียว (20 แถว) ไม่มี guard —
ปลอดภัยเพราะ ECS คืน deployment ใหม่สุดก่อน (ยืนยันกับข้อมูลจริงแล้ว) และตัวมันกรองด้วย
target revision + request window อยู่แล้ว การแก้จะขยาย diff โดยไม่เพิ่มความถูกต้อง

## รอบ 7: deadlock ระหว่างเครื่องมือกู้สองตัว (2026-08-08)

รอบ 6 ตายที่ pagination guard ซึ่งอยู่ **ก่อน** `prepare_release_operation_intent` จึงเปิด parent
operation `19aa6849` ไว้แล้วตายโดยไม่เคยสร้าง api-web intent

`holdRemoteReleaseOperation` ตั้ง lease **90 นาที** (`ROLLOUT_HOLD_SECONDS = 5400` ไม่ใช่
`LEASE_SECONDS = 60` ที่ผมอ่านผิดตอนแรก) จึงต้องรอถึง 22:03 ก่อนทำอะไรได้

สถานะจริงที่อ่านจาก DB (ผ่าน bastion):

```
19aa6849 | UNKNOWN | release | api-web | lease หมดอายุ | intents = 0
         | "operator found an expired heartbeat without a terminal outcome"
```

**ทางตันที่เจอ:**

| เครื่องมือ | ผล |
| --- | --- |
| `operation-reconcile` (workstation break-glass) | exit 75 — *"pre-attested api-web but stopped before a durable api-web intent; exact pre-intent recovery is required"* |
| `recover-release-intent.yml` + `intent_id=PRE_INTENT` | ถูกซีล — `RECOVERY_FIX_BASELINE_PRODUCTION` = 40 ศูนย์ |

ทั้งสองชี้หากัน สถานะ UNKNOWN + api-web + intent 0 ตรงเงื่อนไข PRE_INTENT ของ runbook ครบทุกข้อ

**ทางออก:** comment ในไฟล์ระบุเองว่า 40 ศูนย์คือ placeholder *"replaced by the follow-up pin commit
after the reviewed implementation baseline exists"* — จึง pin เป็น `dc9081a5`

**เหตุผลที่ floor ต้องเป็น dc9081a5 ไม่ใช่ commit อื่น:** recovery ต้องพิสูจน์ platform state จาก
exhaustive `ListServiceDeployments` สองครั้งที่ตรงกัน แต่ AWS CLI ไม่ auto-paginate และ production
api-web มี 184 deployment ต่อหน้า 100 แถว **ทุก commit ก่อน dc9081a5 จึงล้มที่การพิสูจน์นั้น
แบบเดียวกับที่ deploy ล้ม** — executor ที่ต่ำกว่า floor นี้ทำงานบน production ไม่ได้จริง ๆ

## รอบ 8: pagination fix ไปชนเพดานที่ผูกกับ page size (2026-08-08)

recovery ผ่านแล้ว (`19aa6849` → `RECONCILED_FAILED_CONFIRMED`) deploy เดินต่อจนถึง
`Deploy immutable manifest` แล้วตายที่

```
release operation failed: mutation intent beforeDeploymentArns must be a bounded array
```

**ต้นเหตุ:** `run-exclusive-release-operation.ts:1153` เดิมเป็น `length > 100` ซึ่ง**บังเอิญตรง**
กับหน้าเดียวที่ producer อ่านได้ ทั้งสองฝั่งจึงไม่มีทางขัดกัน พอ pagination fix ทำให้อ่านครบ 184
ตัวเลข 100 ที่เคยเป็น "เพดานที่ไม่มีวันถึง" กลายเป็นเพดานจริง

แก้เป็น **5000** = เพดานของ pager เอง (`LIST_DEPLOYMENTS_MAX_PAGES=50` × 100) ให้สองค่าขยับด้วยกัน
ไม่ใช่ค่าหนึ่งไปปิดอีกค่าเงียบ ๆ

**บทเรียน:** ตอนแก้ pagination ผมไล่หา call site ของ `list-service-deployments` ครบทั้ง 5 จุด
แต่ไม่ได้ไล่หา **ผู้บริโภคของข้อมูลที่ยาวขึ้น** เพดาน 100 อยู่คนละไฟล์ คนละภาษา (TypeScript)
และไม่ได้อ้างถึง pagination เลย จึงไม่โผล่มาใน grep ใด ๆ

**สิ่งที่ควรทำครั้งหน้าเมื่อแก้อะไรที่ทำให้ข้อมูลยาวขึ้น:** ไล่หาทั้ง producer และ consumer
ของ field นั้นข้ามภาษา ไม่ใช่แค่ call site ของ API

## สถานะเมื่อจบวัน 2026-08-08

**ได้แล้ว:**
- production DB: 121 migrations / 195 tables, query ได้จริงผ่าน T1 VIEW (`watchdog_support_ro`)
- support roles + bastion + RDS CA + IAM ครบ, `arm-support-execute.sh` ติดตั้งและรัน `status` ผ่าน
- recovery path ของ production ปลดล็อกถาวร (floor pin `dc9081a5`) — รอบหน้าใช้เวลาไม่กี่นาที
- บั๊ก 10 ตัวที่แก้และพิสูจน์แล้ว ทั้งหมดอยู่ในโค้ดที่ไม่เคยรัน

**ยังไม่ได้:** api-web ยังไม่ขึ้น (`minTaskCount` ยัง 0, `mangmeeplus.com` ยัง 503),
ai-gateway/workers ยังไม่ deploy

**operation ค้างใหม่:** `fec04e02-4255-48b6-b073-8a21c28a2690` hold หมดอายุ **00:23 น.**
หลังจากนั้นกู้ด้วย PRE_INTENT ได้ทันที — **อย่าส่ง `parent_task_arn`** (ECS ลบ stopped task
ภายใน ~1 ชม. evidence จะเป็น null แล้ว recovery จะปฏิเสธ) และใช้ `recovery_ref` ที่มี
successful push CI บน main แล้วเท่านั้น

## บั๊ก guard ที่ `set -e` เอื้อมไม่ถึง (2026-08-08)

`recover-release-intent.yml` step `Prove optional exact parent release task is stably stopped`
**รายงาน success ทั้งที่ควรปฏิเสธ** แล้วส่ง evidence ที่เป็น null ทั้งก้อนต่อไป

```
{"taskArn":"...","taskDefinitionArn":null,"lastStatus":null,"stoppedAt":null,...}
```

พิสูจน์กลไกแล้ว ไม่ใช่ `jq` ผิด:

| | ผล |
| --- | --- |
| `jq -e` เดี่ยว ๆ | exit 1 ถูกต้อง |
| เรียก function ตรง ๆ | `set -e` หยุดถูกต้อง |
| เรียก function ใน `$( )` | **ไม่หยุด** คำสั่งถัดไปรันต่อ |

`set -e` ไม่เอื้อมเข้าไปใน command-substitution subshell คำสั่ง `jq -e` ที่ล้มจึงแค่ปล่อยให้บรรทัด
ถัดไปทำงาน ตัวที่จับได้จริงคือ recovery task ปลายทาง (*"stopped parent task definition is outside
the exact release family"*) — คำตอบที่ถูกแต่มาถึงผิดที่ หลังจากเสีย build กับ ECS run ไปแล้ว

**สาเหตุที่ evidence เป็น null:** ECS ลบ stopped task ทิ้งภายใน ~1 ชั่วโมง `describe-tasks` คืน
`tasks: []` + `failures: [MISSING]` ซึ่ง `.tasks[0]` เป็น null แล้ว object constructor เติม null ให้ทุก field

**แก้แล้ว:** ทุกจุดคืนค่าล้มเหลวชัดเจน (`|| return 1`, `|| exit 1`) ไม่พึ่ง `set -e` และเพิ่ม
ด่านสุดท้ายที่ปฏิเสธ evidence รูปร่าง null ก่อนส่งต่อ พร้อมข้อความบอกทางออก (ไม่ต้องส่ง
`parent_task_arn`) ทดสอบสามกรณีแล้ว: task หมดอายุ / task ปกติ / task ที่ยังรันอยู่

## รอบ 9 (2026-08-09 เช้า): ผ่าน health แล้ว ตายที่ retire — pagination guard ฝั่ง TypeScript

recovery ของ `fec04e02` ใช้เวลา **3 นาที** (เทียบกับทั้งคืนของรอบก่อน) — recovery path ที่ปลดล็อกไว้
ทำงานตามที่ควร **ข้อควรจำ:** `recovery_ref` ต้องสืบทอดจาก SHA ที่ operation ถือครอง รอบนี้คือ
`8df0b272` ไม่ใช่ `b6eccc8` จึงใช้ `dc9081a5` ที่เคยสำเร็จไม่ได้อีก

deploy เดินไกลที่สุดเท่าที่เคยมี:

| step | ผล |
| --- | --- |
| Deploy immutable manifest | **success** ครั้งแรก (bound 5000 แก้ตรงจุด) |
| Verify active digest and health | **success** — service serve build ใหม่และตอบ health จริง |
| Retire superseded launch builds | failure |

```
release operation failed: service deployment history is paginated and not safe for retirement
```

**pagination guard ตระกูลเดิม แต่อยู่ใน TypeScript** (`run-exclusive-release-operation.ts`) ซึ่งเป็น
ภาษาที่ผมไม่ได้กวาดตอนแก้รอบแรก มี 5 call site `maxResults: 100` และ 4 guard `nextToken != null`
(บรรทัด 1665 / 2001 / 2167 / 3023)

แก้ด้วย `listAllServiceDeployments()` — pager แบบเดียวกับฝั่ง shell เดินทุกหน้าแล้วคืน
`nextToken: null` เสมอ guard เดิมคงไว้ทั้งหมดเป็น tripwire มี page cap 50 หน้า

**บทเรียนซ้ำรอบที่สาม:** ครั้งแรกพลาดเพราะไล่ call site แต่ไม่ไล่ consumer (bound 100)
ครั้งนี้พลาดเพราะไล่แค่ภาษาเดียว **เวลาแก้อะไรที่ทำให้ข้อมูลยาวขึ้น ต้องไล่ทั้ง producer,
consumer และทุกภาษาในเส้นทางเดียวกัน**

**operation ค้างใหม่:** `74c72def-8ab5-41ca-a6b9-4bbfc0630648`
(task `5235ca84a7184cfd8f3ed63d333fb726`, deployment `U3FCkWV9ZGGWCM8DFWVZj`)

## ai-gateway: ชื่อ service ใน deploy.sh ค้างอยู่กับ service ที่ถูกลบไปแล้ว (2026-08-09)

deploy ai-gateway ครั้งแรกตายที่ `Deploy immutable manifest`

```
ERROR: watchdog-bms-ai-gateway has an incomplete active configuration; refusing remote mutation intent
```

**ความจริงบน production:**

| service | `deploy.sh` คาด | ของจริง |
| --- | --- | --- |
| api-web | `watchdog-bms-api-web-pub` | ตรง |
| ai-gateway | `watchdog-bms-ai-gateway` | **`watchdog-bms-ai-gateway-v2`** |
| workers | `watchdog-bms-workers` | ตรง |

`watchdog-bms-ai-gateway` (ไม่มี `-v2`) **ไม่มีอยู่ใน cluster แล้ว** — README บันทึกไว้เองว่าถูกลบ
เมื่อ 2026-07-03 เพราะ control-plane state พัง (`ROLLBACK_FAILED: No rollback candidate`)
แล้วแทนด้วย `-v2`

**ทำไมไม่มีใครเจอ:** ตอนนั้นชี้ SSM ARN ไปที่ `-v2` เรียบร้อย และ README เขียนว่า *"the deploy
script follows the service ARNs stored in SSM"* ซึ่งจริง — แต่จริงเฉพาะตอน **เรียก**
`UpdateExpressGatewayService` ส่วน `service_name` ยังถูกใช้ตรวจ **revision ARN ที่ ECS ตอบกลับ**:

```bash
[[ ! "$revision" =~ ^arn:...:service-revision/${CLUSTER_NAME}/${service_name}/[^/]+$ ]] && refuse
```

revision จริงคือ `.../watchdog-bms-ai-gateway-v2/3977...` ซึ่งไม่แมตช์ `.../watchdog-bms-ai-gateway/`
เพราะหลังชื่อมี `-v2` ไม่ใช่ `/` — **image กับ GIT_SHA ปกติดีทั้งคู่** ตัวที่ผิดคือชื่ออย่างเดียว

และ production ไม่เคย deploy ai-gateway เลยตั้งแต่ย้าย repo จึงไม่มีอะไรมาสะดุดค่านี้

**แก้:** `AI_SERVICE_NAME="watchdog-bms-ai-gateway-v2"` + เขียน README ให้บอกว่าค่านี้ต้องเท่ากับ
service ที่ SSM ชี้ ไม่ใช่แค่ "ตาม SSM แล้วพอ"
