# Agent Memory: partner-line-secret-validation

Status: DONE + DEPLOYED prod 2026-07-10 (commit 830eaa81, image ecs-api-web-830eaa81)
Owner: Claude session (troubleshoot partner onboarding E2E)
Scope: กัน Channel Secret ผิดตั้งแต่ connect/rotate + runbook troubleshooting สำหรับ webhook Verify 401

Decisions:
- อาการจริงที่เจอ: partner OA (BB567_API) กด Verify webhook ใน LINE Console ได้ 401 —
  root cause คือ secret ที่เก็บใน channel record ไม่ตรง เพราะ connect เดิม validate แค่
  access token (`GET /v2/bot/info` + token↔channelId) ส่วน secret เช็คแค่ length ≥ 8
- Fix ที่ต้นทาง: `LineMessagingAdapter.verifyChannelSecret(channelId, secret)` — probe
  `POST https://api.line.me/v2/oauth/accessToken` (client_credentials) แล้ว revoke token
  ทันที (กันกิน slot short-lived 30 ตัว) → true / false (LINE ตอบ 400 invalid_client) /
  null (429, 5xx, network)
- Posture: fail-open บน null (LINE ล่มต้องไม่ block connect ที่ถูกต้อง — pattern เดียวกับ
  getTokenChannelId), fail-closed เฉพาะ LINE ปฏิเสธชัด ๆ
- 429 ต้องเป็น null ไม่ใช่ false: rate limit ไม่ใช่การปฏิเสธ credential pair — ถ้า map เป็น
  false จะ block connect ที่ secret ถูก พร้อม error หลอก "Channel Secret does not match"
- ใส่ guard ทั้ง ConnectMessagingChannelUseCase และ RotateMessagingChannelCredentialUseCase
  (rotate คือทางที่ใช้แก้ secret ผิด — ปล่อยผ่านไม่ได้)
- Error message เป็นภาษาอังกฤษตาม precedent ของ endpoint เดิม; UI โชว์ message ตรง ๆ

Open questions: none

Artifacts:
- `apps/api/src/modules/crm-inbox/infrastructure/line-messaging.adapter.ts` (+verifyChannelSecret)
- `apps/api/src/modules/crm-inbox/application/use-cases/messaging-channel.use-case.ts` (connect + rotate guard)
- Specs: `line-messaging.adapter.spec.ts` (+2 tests), `messaging-channel.use-case.spec.ts`
  (+connect reject test, +rotate reject test, fake `okLine.verifyChannelSecret = null` พิสูจน์ fail-open)
- Runbook: `docs/runbooks/partner-onboarding-e2e.md` — step 10 (verify 3 ค่า + label ปุ่มจริง),
  Troubleshooting แถวใหม่ "Verify webhook ได้ 401", verified code paths

Verification:
- `npx tsx --test src/modules/crm-inbox/application/use-cases/messaging-channel.use-case.spec.ts
  src/modules/crm-inbox/infrastructure/line-messaging.adapter.spec.ts` → 28/28 pass
- `npx tsc --noEmit` (apps/api) → clean
- Deploy prod 2026-07-10: `deploy.sh api-web` → service-deployment SUCCESSFUL, PRIMARY rollout
  COMPLETED, activeConfigurations เหลือ image เดียว (`ecs-api-web-830eaa81`), RollbackAlarm OK,
  `GET https://mangmeeplus.com/v1/health` → 200 `{"status":"ok","db":"ok"}`
- ยังไม่ได้ทดสอบกับ LINE จริง — จะพิสูจน์ตอน user rotate credentials ของ BB567_API แล้ว Verify ซ้ำ

Next:
- (deploy เสร็จแล้ว) ให้ user: ดู Credential → เปลี่ยน Credential (secret จาก Basic settings ของ
  BB567_API) → Verify ใน LINE Console (channel เดิมที่ secret ผิดต้อง rotate เอง — probe กันเฉพาะ
  connect/rotate ครั้งใหม่)
- บั๊กแยกอีกตัวที่ยังไม่แก้ (เจอระหว่าง investigate): หน้า System Admin Shared LINE Settings
  save ไม่ได้ทุกคน — `system.shared_line_credential.manage` ไม่อยู่ใน permission-registry
  (spawn เป็น task แยกแล้ว)
