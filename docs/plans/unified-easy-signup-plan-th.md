# แผน implement สมัครและเข้าสู่ระบบด้วย email OTP

สถานะ 2026-09-16: IMPLEMENTING. Spec: [unified-easy-signup-spec-th.md](../specs/unified-easy-signup-spec-th.md). Owner อนุมัติ review แล้วเริ่ม implementation. Baseline `7ef09d8e` รวม optional-email OTP + completed billing; branch `codex/email-passwordless-signup-20260916` แยกจากงานอื่น.

## ลำดับงานและเกณฑ์จบ

- [x] E0 ตรวจ actual auth/session/onboarding/signup source/LINE cap/BFF; แก้ spec และบันทึก E01–E17.
- [x] E1 เพิ่ม additive public challenge/opt-in schema, OTP crypto/rate/delivery, atomic confirm+session; test replay/expiry/attempt/snapshot/rollback.
- [x] E2 เพิ่ม email-first request/admission/source transitions, shared cap+duplicates, existing onboarding email owner, admin approval/status/resume; verify one company/trial and review boundaries.
- [x] E3 BFF HttpOnly browser binding, email/login/signup/status UI, opt-in/backup/LINE return และ marketing consistency; loading/error/retry/390px/keyboard.
- [x] E4 isolated PG + HTTP/browser Postmark simulated journey; legacy and cross-channel regressions/typechecks. Fix found gaps before claiming passed.
- [ ] E5 exact-source evidence/memory; stage only own changes; paid CI only after local candidate passes. Integrate with latest dependency, wait required CI before approved admin merge develop/main; never deploy.

## การตรวจผล

ใช้ test tools/dependencies เดิม ไม่แก้ package.json นอกจาก dependency change (ไม่มีแผนเพิ่ม). PG fixture ต้อง isolated และใช้ migrations ของ candidate. Unit tests ไม่แทน transaction/race evidence. API/browser หลักฐานต้องแยกจำลอง provider จาก native. No live mail/payment/cloud actions. จำนวน checks ไม่ใช่เปอร์เซ็นต์ความพร้อม production.

Run focused OTP/domain tests then API/web typechecks and integration tests of changed flows. เพิ่ม required suite coverage registration ตาม pattern เดิม. ไม่ rerun full suite/CI ซ้ำถ้าไม่มีการเปลี่ยนหรือพบข้อกังวลใหม่.

## สถานะ dependency / impact

Optional-email/postmark task มี CI/release work แยก;ไม่แก้ใน worktree นั้น. Shared source changes ต้องตรวจ E01–E17 และ compatibility กับ verified-email-before-payment. UI ไม่กล่าวว่า verified email ของบัญชีเก่าทำ passwordless ได้จน opt-in สำเร็จ. Existing official-site rows ไม่ถูก auto-approve.

## Evidence

Local checkpoint: API suite/typecheck passed; web 1731/1731; public PG16/16; legacy email/billing-recipient PG22/22; six real browser groups passed including marketing and admin crash recovery. Safe return-path follow-up passes; integrated dependency is3e2f4157. Current web1732/1732; billing plan-adjustment23 HTTP/PG groups pass. See [evidence](../evidence/email-passwordless-signup-2026-09-16.md). Required CI/merge remain E5. Update [memory](../agent-memory/email-passwordless-signup-2026-09-16.md) พร้อม commands/results/remaining before handoff.
