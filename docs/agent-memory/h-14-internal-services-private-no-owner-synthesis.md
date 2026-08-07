# Agent Memory: H-14 — ทำ internal services private และห้าม synthesize OWNER จาก path

Status: Code/test done + reviewed + committed 2026-07-19; Live closure (network cutover + secret rotation) DEFERRED to batch deploy (ดู runbook)
Owner: Claude (security remediation session)
Scope: internal worker controllers + synthesized worker RequestContext (apps/api), shared worker-token guard, ECS Express private-ingress deploy path + runbook

## สองส่วนของ H-14

1. **ห้าม synthesize OWNER จาก caller-supplied path** — code fix (ปิดในรอบนี้)
2. **ทำ internal services private** — network/infra (prep พร้อม, live cutover เลื่อนไป deploy window)

## Decisions (code)

- **`systemWorkerContext()`** (`auth/domain/logic/system-worker-context.ts`): RequestContext สำหรับ worker ที่ไม่มี human actor — `roles: []`, `authProvider: 'system'`, permissions เท่าที่ job ต้องใช้จริง. แทน `roles: ['OWNER']` 3 จุด:
  - `dashboard-notifications/.../internal.controller.ts` `makeWorkerCtx`
  - `dashboard-notifications/.../notification-sweeps.use-cases.ts` `workerContext`
  - `workflow/.../workflow-scan-candidates.use-case.ts` `systemCtx`
- **ทำไม roles:[] ปลอดภัย**: subagent trace ยืนยัน ไม่มี code ที่ reachable จาก 3 จุดนี้อ่าน `ctx.roles` เลย — ทุก use-case downstream (generate-snapshot, CreateDailyOwnerSummary + providers, GetStockReport) อ่านแค่ `ctx.permissions`/`companyId`/`scopes`. `OwnRecordPolicy` (อ่าน roles) มี **zero injectors** (dead wiring). precedent: line-ai ERP tools เรียก use-case เดียวกันด้วย `roles: []` ใน prod อยู่แล้ว (`erp-tools.use-case.ts toCtx`)
- **`WORKER_NOTIFICATION_PERMISSIONS`** export จาก notification-sweeps ใช้ร่วมกับ internal.controller (เดิม duplicate literal 2 ที่)
- **`assertWorkerToken()`** (`common/security/worker-token.ts`): wrap `timingSafeStringEqual` (constant-time) — รวม 6 internal controllers ที่เดิมกระจาย: 4 ตัวใช้ `token !== expected` (timing-unsafe), 2 ตัว (crm, crm-ai) ใช้ timingSafeStringEqual อยู่แล้ว. fail closed เมื่อ secret ไม่ตั้ง หรือ token ว่าง
- **Company validation** (`InternalNotificationController.assertActiveCompany`): path `companyId` เป็น caller-supplied → `company.findFirst {id, status:'ACTIVE'}` ก่อนรันทุก per-company job; ไม่เจอ → 404. จำกัด blast radius ของ token ที่หลุด ไม่ให้ probe/act ต่อ tenant id ใด ๆ ที่ไม่ ACTIVE. assertWorkerToken รันก่อน DB query เสมอ (bad token ไม่แตะ DB)
- **`authProvider: 'system'`** เพิ่มใน union ทั้ง `apps/api/.../request-context.model.ts` และ `packages/contracts/src/index.ts` (sync กัน). ตรวจแล้วไม่มี guard ไหน relax เมื่อ authProvider==='system' (expense-draft block เฉพาะ 'line'); 'system' ไม่ได้สิทธิ์โดยนัย
- **ai-draft `generate` / line-ai `internal-tools invoke`** ไม่ใช่ synthesis site — ทั้งคู่ re-resolve permission จริงจาก DB (`resolveAccess`) และ scope companyId ด้วย request/identity lookup อยู่แล้ว (pattern ที่ถูกต้อง ไม่แตะ)
- **`assertActiveCompany()` shared helper** (`common/security/active-company.ts`): ใช้ทั้ง notification `:companyId` routes (4) และ workflow `events/ingest` (พบใน review — body.companyId เป็น caller-supplied เหมือนกัน; `events/ingest` ไม่มี in-repo caller จริง flow จริงคือ outbox→`outbox/drain`→use case ตรง ไม่ผ่าน controller guard จึงไม่กระทบ). token check รันก่อน DB เสมอ (ไม่เป็น existence oracle)
- **Least-privilege trim** (`WORKER_NOTIFICATION_PERMISSIONS`): ตัด `notification.read` + `notification.rule.manage` (write perm) — review ยืนยันไม่มี worker path ไหน gate ด้วยสองตัวนี้ (มีแค่ generate-snapshot gate ด้วย dashboard perm + inventory provider degrade ด้วย inventory read); เหลือ 4 ตัว snapshot behavior เดิมทุกอย่าง
- **Follow-up 2026-08-04** (ดู `dashboard-snapshot-entitlement-gate.md`): `WORKER_NOTIFICATION_PERMISSIONS` เหลือ 2 ตัว (`dashboard.read`, `dashboard.snapshot.generate`) — ตัด `inventory.report.read`/`inventory.product.read` ทิ้ง. เหตุผลเดิม ("inventory provider degrade ด้วย inventory read") ใช้ไม่ได้แล้ว: snapshot เป็น company-level data จึงตัดสินจาก feature entitlement ของบริษัท ไม่ใช่ permission ของ context ที่สั่ง generate
- **`authSubject` provenance**: `systemWorkerContext` รับ optional `authSubject` (default 'worker'); workflow-scan ส่ง `'workflow-scan'` เพื่อคง provenance เดิม (audit/trace แยก subsystem ได้)
- **deploy.sh guard**: `api-web` และ `all` targets **refuse** เมื่อ `ECS_EXPRESS_SUBNET_MODE=private` — กัน operator เผลอ push private subnets เข้า service api-web ที่ subnet type immutable (จะ wedge control plane แบบเดียวกับ ai-gateway service เก่าที่ตาย)

## Decisions (infra — prep only)

- Live read 2026-07-18: 3/3 services (api-web, ai-gateway, workers) เป็น PUBLIC ingress บน public subnets, SG egress `0.0.0.0/0`
- Private subnets `watchdog-bms-prod-app-private-a/b` + NAT มีอยู่แล้ว
- `deploy.sh` เพิ่ม path `ECS_EXPRESS_SUBNET_MODE=private`: subnet type ของ ECS Express เปลี่ยนบน service เดิมไม่ได้ → สร้าง service ใหม่ชื่อ `-priv` + ARN param แยก, รอ ingress `accessType=PRIVATE`, **ไม่ flip shared SSM params** (flip มือหลัง verify reachability) — กัน bricking running api-web
- `service_url`/`wait_for_service_url` รับ access_type param; wait loop dump ingressPaths จริงถ้า ACTIVE แต่ไม่เจอ endpoint ตาม accessType ที่คาด (กัน spin 30 นาทีเงียบ ๆ — enum จริงอาจต่าง)
- api-web ยัง public โดยตั้งใจ (web + LINE webhook + Cloudflare origin); `/v1/internal/*` ป้องกันด้วย in-app token ที่ hardening แล้ว
- Runbook: `docs/runbooks/h-14-private-ingress-cutover-runbook.md` (workers ก่อน → ai-gateway + verify api-web→priv reachability ก่อน flip → rotate WORKER_INTERNAL_TOKEN + AI_GATEWAY_INTERNAL_SECRET → egress allowlist เป็น follow-up)

## Review (5 background agents → CONFIRMED fixed 3, latent/accepted rest)

- **E1 workflow `events/ingest` unvalidated body companyId** (2 agents, MEDIUM) → เพิ่ม `assertActiveCompany`
- **Permission over-grant** (`notification.rule.manage`/`notification.read`) → trim least-privilege
- **deploy.sh private mode รั่วไป api-web/all** (2 agents, MEDIUM — จะ push private subnet เข้า service immutable) → guard refuse
- **authSubject 'workflow-scan' หาย** (provenance) → optional authSubject param
- REFUTED/clean: constant-time compare ถูก, authProvider:'system' ไม่เพิ่ม trust (forge ไม่ได้, JWT path ไม่แตะ, web `==='line'` gate ปฏิบัติเหมือน 'dev' เดิม), roles:[] ไม่ regress (ทุก path gate ด้วย permission), ไม่มี dead import, ไม่มี handler ไหนหลุด auth, deploy.sh public-mode byte-identical

## Residual / accepted

- **Token-holder ยัง target ACTIVE tenant ใดก็ได้**: company validation จำกัดเป็น ACTIVE เท่านั้น (ปิด probe tenant ที่ไม่มี/ถูก suspend) แต่ token ที่หลุดยังเรียก per-company job ข้าม tenant ได้ — ปิดจริงด้วย network private + secret rotation (live closure) ตาม defense-in-depth ของ checklist ("private ingress + rotate secret + verified actor context"). code fix ปิดส่วน "synthesized OWNER" ครบ
- **Live closure ยังไม่ทำ**: external reachability test, private ingress evidence, rotated credential inventory ต้องทำตอน deploy (เหมือน H-13 precedent ที่แยก code review `[x]` กับ live closure `[ ]`)
- egress allowlist (0.0.0.0/0 → ปลายทางจริง) เป็น follow-up ไม่ block H-14 (มี NAT/VPC endpoint cost + ต้อง inventory ปลายทาง LINE/Bedrock/S3/Typhoon ก่อน)
- **Global sweep/scan/drain + `pdpa-purge`** ไม่มี companyId ให้ validate → token ที่หลุดยัง force-run cross-tenant ได้ (รวม destructive pdpa-purge) — inherent กับ single static token; ปิดจริงด้วย network private + rotate (live closure) + M-01 actor delegation (P1 แยก)
- **Non-ACTIVE company per-company routes → 404**: worker retry/log spam ได้ แต่ practice ปัจจุบัน per-company job kinds **ไม่ถูก enqueue** (มีแค่ 4 sweep jobs; sweeps กรอง ACTIVE อยู่แล้ว); BullMQ default attempts=1 (ไม่ poison loop). Delivery-sweep (`ProcessDueNotificationDeliveriesUseCase`) ยังส่ง queued delivery ของ non-ACTIVE company — เป็น asymmetry ตั้งใจ (sweep = backlog ที่ queue จริงแล้ว ไม่มี caller companyId จึงไม่ใช่ blast-radius) ไม่แก้ใน H-14
- **authProvider:'system' latent web-gate**: use case ที่ block `authProvider==='line'` (expense-draft/substitute-receipt/signature-asset/ai-suggestion-review) จะปล่อย 'system' ผ่านเหมือน 'watchdog'/'dev' เดิม — ปัจจุบัน worker path ไม่แตะ; latent trap ถ้าอนาคต route system ctx เข้า flow เหล่านี้ (ควร allowlist แทน negate 'line' ตอนนั้น)
- **deploy.sh private mode ephemeral (env var)**: หลัง cutover + retire service เก่า, default public-mode deploy จะ fail บน stale ARN param หรือ resurrect public — runbook สั่งให้ตั้ง private mode persistent + เคลียร์ stale ARN หลัง retire; `accessType=PRIVATE` enum ยังไม่ยืนยัน (wait loop dump ingressPaths จริงถ้าไม่ match)
- **web-session.model.ts** union ยัง 3-value (ไม่มี 'system') — ไม่มี runtime path ส่ง system ctx เข้า /auth/me; doc drift เท่านั้น

## Verification

- New specs: `worker-token.spec.ts` 5 (accept/wrong/missing/empty/unset-secret), `internal.controller.spec.ts` 7 (bad-token-before-DB, non-ACTIVE→404, roles:[]+authProvider:'system'+no rule.manage, delivery company-gate, daily-summary system ctx, sweep bad-token, sweep runs), `workflow-internal.controller.spec.ts` 3 (bad-token-before-DB, forged-company→404, ACTIVE ingests) — ลงทะเบียน test list ครบ
- Full API suite **2166/2166**; typecheck api/contracts/web/ai-gateway/workers clean; `bash -n deploy.sh` OK
- `grep "roles: ['OWNER']"` ทั้ง apps/api/src = 0; `grep WORKER_INTERNAL_TOKEN` เหลือแค่ worker-token.ts (จุดเดียว)
- Review 5 background agents (correctness×2 line-by-line+removed-behavior, adversarial-security×2, cleanup+conventions) → CONFIRMED 4 แก้ครบ (E1 ingest, permission trim, deploy.sh guard, authSubject provenance), residual documented

## Next

- Commit แล้ว (ดู git log H-14)
- Live closure: ทำตาม `docs/runbooks/h-14-private-ingress-cutover-runbook.md` ตอน batch deploy — cutover + rotate secret + เก็บ reachability/credential evidence → แล้วค่อยติ๊ก H-14 live-closure sub-box
- เชื่อมกับ [[project_ecs_express_deploy]] [[project_ecs_express_canary_verify]] (subnet type immutable, canary rollback — ห้าม probe ระหว่าง bake)
