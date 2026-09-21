# แผน implement สมัครและเข้าสู่ระบบด้วย email OTP

สถานะ 2026-09-21: งานเดิม merged แล้ว; เพิ่ม urgent UAT hotfix E6 ตาม owner directive ให้ existing account ที่พิสูจน์ exact account email ด้วย public OTP เปิดใช้และ login แบบ atomic. ยังไม่ deploy. Spec: [unified-easy-signup-spec-th.md](../specs/unified-easy-signup-spec-th.md).

## ลำดับงานและเกณฑ์จบ

- [x] E0 ตรวจ actual auth/session/onboarding/signup source/LINE cap/BFF; แก้ spec และบันทึก E01–E18.
- [x] E1 เพิ่ม additive public challenge/opt-in schema, OTP crypto/rate/delivery, atomic confirm+session; test replay/expiry/attempt/snapshot/rollback.
- [x] E2 เพิ่ม email-first request/admission/source transitions, shared cap+duplicates, existing onboarding email owner, admin approval/status/resume; verify one company/trial and review boundaries.
- [x] E3 BFF HttpOnly browser binding, email/login/signup/status UI, opt-in/backup/LINE return และ marketing consistency; loading/error/retry/390px/keyboard.
- [x] E4 isolated PG + HTTP/browser Postmark simulated journey; legacy and cross-channel regressions/typechecks. Fix found gaps before claiming passed.
- [x] E5 exact-source evidence/memory; stage only own changes; paid CI only after local candidate passes. Integrate with latest dependency, wait required CI before approved admin merge develop/main; never deploy.
- [x] E6 แก้ existing-account OTP loop ที่ root: exact unique User.email + current guards → verify/enable/session transactionเดียว; rollback ทั้งหมดเมื่อ audit/session ล้ม; focused PostgreSQL 16/16 + API/Web typecheck ผ่าน; บันทึก UAT diagnosis โดยไม่เก็บอีเมล/OTP. ยังไม่ deploy.

## การตรวจผล

ใช้ test tools/dependencies เดิม ไม่แก้ package.json นอกจาก dependency change (ไม่มีแผนเพิ่ม). PG fixture ต้อง isolated และใช้ migrations ของ candidate. Unit tests ไม่แทน transaction/race evidence. API/browser หลักฐานต้องแยกจำลอง provider จาก native. No live mail/payment/cloud actions. จำนวน checks ไม่ใช่เปอร์เซ็นต์ความพร้อม production.

Run focused OTP/domain tests then API/web typechecks and integration tests of changed flows. เพิ่ม required suite coverage registration ตาม pattern เดิม. ไม่ rerun full suite/CI ซ้ำถ้าไม่มีการเปลี่ยนหรือพบข้อกังวลใหม่.

## สถานะ dependency / impact

Optional-email/postmark task มี CI/release work แยก;ไม่แก้ใน worktree นั้น. Shared source changes ต้องตรวจ E01–E18 และ compatibility กับ verified-email-before-payment. Public OTP ที่ผู้ใช้ขอและกรอกถูกต้องนับเป็น explicit opt-in เฉพาะ exact eligible account email; ไม่ attach contact email, ไม่ auto-approve official-site rows และไม่เปิด SYSTEM_ADMIN.

## Evidence

Local: API suite/typecheck PASS; web1732/1732; public PG16/16; legacy email/billing-recipient PG22/22; six real browser groups PASS including marketing and admin crash recovery. Billing focused23/full256 HTTP/PG groups PASS. Admin API68/web60 and maintenance validator/tamper PASS. Marketing PR4/5 merged develop/main after CI35048055608/35048182393 PASS. Dependency e477e171 integrated in15a29950; focused23 groups pass after preserving its stronger fixture assertion. Core CI35049514012 attempt1 and35049794245 attempt2 SUCCESS; PR583/584 merged. See [evidence](../evidence/email-passwordless-signup-2026-09-16.md). E5 complete: exact-head CI passed before both admin merges; source delivery evidence records the first failed main attempt and the bounded retry. Update [memory](../agent-memory/email-passwordless-signup-2026-09-16.md) พร้อม commands/results/remaining before handoff.

Source delivery: develop2361157b / main670e88ce; identical merged treebcabfc01. Native provider acceptance and deployment remain separate release work.
