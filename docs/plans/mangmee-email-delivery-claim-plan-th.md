# แผนส่งมอบ Email Delivery และ Claim Account — P11

สถานะ: **PARTIAL — Phase 0 disabled-safe foundation MERGED DEVELOP `d8d9808e` ผ่าน PR #290** (2026-08-27T05:08:55Z); CI `33040896057` SUCCESS บน exact head `6f85339d`. Phase 1–4 และ provider activation ยังไม่เปิด.

Source of truth: [P11 spec](../specs/mangmee-email-delivery-claim-spec-th.md), [ADR-0009](../adr/0009-auth-security-email-delivery.md), [P10 plan](mangmee-external-signup-plan-th.md), [task memory](../agent-memory/p11-email-provider-foundation.md).

## Phase 0 — Provider foundation เท่านั้น

นำ runtime/config/dependency patch จาก `ec03bc6f` ใน [PR272](https://github.com/MangmeeDev/mangmeeplus/pull/272) มาบน develop `21f109d5` แล้ว fast-forward เป็น `11153296` โดยไม่มี path overlap; ไม่ merge stack P9/P10 และไม่เปิด provider. ข้อจำกัด durable secret จาก `384d72a5` ยังคงอยู่.

- [x] SES direct dependency + auth-mailer port/adapters สำหรับ verify/reset/claim.
- [x] Disabled ไม่ส่ง/ไม่ log ทุก environment; console เป็น explicit local-only mode.
- [x] SES missing-config fail-closed, HTTPS ก่อนส่ง, HTML escaping, UTF-8 และ error propagation.
- [x] Local provider/config tests, API/config typecheck, DI boot disabled/complete synthetic SES config โดยไม่ส่ง mail.
- [x] Regenerate เฉพาะ maintenance validator/workflow pins ด้วย generator เดิมและตรวจผ่าน; ไม่ลด guard หรือเปลี่ยน release policy.
- [x] Root/Opus follow-up: require explicit frontend WEB_BASE_URL สำหรับ SES โดยไม่เปลี่ยน general/local-console fallback; เพิ่ม registered regression, regenerate auth-module pin chain และ rerun focused/config/type/build/network-denied boot ก่อน refreeze.
- [x] Root ตรวจ source หลังแก้และรัน full API ซ้ำ: 5325 ผ่าน/5423 ทั้งหมด, skipped98; pretest16/30, skipped14; ไม่มี failure.
- [x] PR #290 merged ที่ `d8d9808e41d15360810ed67e9169ade0cd5605ab` หลัง exact-head CI `33040896057` SUCCESS บน `6f85339d6179a456957a7db77a3fc161047b8647`; ไม่มี provider activation.

Acceptance ตาม spec §1.1 และ [delivery memory](../agent-memory/p11-email-provider-foundation.md). PR272 CI เดิมไม่ใช่หลักฐานผ่าน: run `32979173978` หยุดที่ stale maintenance pins; ใช้ exact-head CI ของ PR290 แทน. ไม่อ้าง browser/inbox/delivery evidence เพราะ phase นี้ไม่มี UI ใหม่หรือส่งจริง.

Current-base evidence 2026-08-27 หลัง explicit-frontend follow-up: auth/reset 44/44 + DI/spec registration 6/6 (รวม 50/50), config 138/138, API/config typecheck, builds, network-denied DI boots 4 cases และ maintenance generator/validator checks ผ่าน. Root full API หลัง follow-up: 5325 ผ่าน/5423 ทั้งหมด (skipped98), pretest16/30 (skipped14), ไม่มี failure. Actual Opus5 max ให้ conditional APPROVE ก่อน follow-up นี้ พร้อม explicit-web-base finding ที่แก้แล้ว; root ตรวจ source หลังแก้และรับเฉพาะ disabled-safe slice. Exact-head CI `33040896057` SUCCESS และ source merged ไม่ใช่ rollout permission.

## Phase 1 — Durable claim send (BLOCKED)

ก่อนสร้าง producer/consumer ต้องตกลง raw-link representation ที่ยังรักษา hash-only: encrypted short-retention delivery envelope หรือ deterministic signed token. ต้องระบุ rotation, retry หลัง rotate, retention/deletion, log redaction และ incident revocation; ห้ามเก็บ plaintext หรือเปลี่ยนชื่อ field หลบ outbox redactor.

หลัง decision จึงกำหนด event key ต่อ signup request/claim generation, email-only drain ที่ไม่ถูก generic workflow drain consume, attempt fence/retry/backoff/DEAD และ permission-checked internal worker route. ไม่มีส่วนนี้ใน Phase 0.

## Phase 2 — Claim token/route (BLOCKED)

รอ claim TTL + resend/revoke authority ตาม P10 §8; จากนั้น hash-only single-use/generation/expiry/replay/concurrency, resend revoke generation เก่า, public claim CSP/no-store/no-referrer และข้อความว่าเป็นรหัส Mangmee ไม่ใช่ LINE. ไม่เลือก TTL จาก reset/verify มาใช้เอง.

- Acceptance เดิมที่ต้องคง: expired/used/unknown claim token ตอบข้อความ public ทั่วไปเดียวกัน และทดสอบเปรียบเทียบทั้งสามกรณี ตาม [canonical plan เดิม:37](https://github.com/MangmeeDev/mangmeeplus/blob/384d72a5720a58efde943831124e85765ebbc5cb/docs/plans/mangmee-email-delivery-claim-plan-th.md#L37). ไม่กำหนด wording, HTTP status, TTL หรือ token policy ใหม่ใน checkpoint นี้.

## Phase 3 — Verified credential/provisioning (BLOCKED)

รอ duplicate email/tax-ID/businessCategory decision ของ P10; ใช้ UserCredential เดิม, transaction attempt fence, verified owner provisioning, session revocation และ P12 LINE handoff โดยไม่เผย temporary password/personal QR.

## Phase 4 — SES operations/live delivery (BLOCKED)

รอ Owner sender domain/DNS owner/region และ signed UAT protocol. ต้องมี sender identity, SPF/DKIM/DMARC, configuration set/event destination, sandbox/production-access, inbox/header evidence, durable bounce/complaint + suppression, retry/DEAD/admin visibility และ P9 alarms ตาม spec ปัจจุบัน. ห้ามเปิด EMAIL_PROVIDER/feature flag จากผล local test เพียงอย่างเดียว.
