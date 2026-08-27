# Agent Memory: line-login-p12-delivery

Status: P12-0 implemented (inventory + channel-aware lookups) — pending review/merge; P12-1..P12-3 not started
Owner: MangmeeDev
Scope: P12 LINE Login/Link/QR full journey ตาม [spec รวม](../specs/mangmee-line-login-link-journey-spec-th.md) + [four-lane P12](../plans/mangmee-four-lane-gap-closure-plan-th.md#p12--line-loginlinkqr); เป้าหมาย Owner = "พร้อมทั้งหมด": ปุ่ม LINE login (mobile redirect), desktop QR, deep-link handoff จากแชต
Decisions:
- 2026-08-27 Owner: Messaging API / LINE Login / LIFF อยู่ LINE **Provider เดียวกันทั้งหมด** (ยืนยันในแชต; console evidence + ชื่อ Admin เก็บตอน activation gate ตาม P12.1) → migration เดินสาย AUTO_REUSE/BACKFILL ได้ ไม่ต้องบังคับ re-link ทั้งระบบ
- ลำดับส่งมอบ: P12-0 → P12-1 (mobile OAuth+PKCE) → P12-2 (unlinked link flow) → P12-3a (desktop QR) → P12-3b (deep-link handoff + alert rail ทีหลัง)
- Q1/Q3/Q4 ของ deep-link handoff ยังไม่ตัดสิน — ข้อเสนอบนโต๊ะ (provider='line' / TTL 15 นาที / assistant ก่อน alert rail) รอ Owner ยืนยันตอน P12-3b เข้าคิว; Q2 = การวัด link-preview ก่อน rollout
- P12-0 design: inventory เป็น read-only (ไม่ mutate); backfill/dedupe พร้อม batch id + checksums เป็น slice ถัดไป; lookup ใช้ canonical-first + channel-agnostic fallback log warn (shape เดียวกับ webhook/notification resolver เดิม); production fail-closed เมื่อ LINE channel config หาย (ห้าม 'unknown')
Open questions:
- ชื่อ Admin ของ LINE Provider + console evidence (ต้องมีก่อน activation gate)
- Q1–Q4 handoff (ตอนเข้าคิว P12-3b)
- Callback URL ต่อ env (dev tunnel / UAT / prod) ต้องจดใน LINE console ก่อน P12-1 live verification
Artifacts:
- Branch: `codex/p12-line-identity-inventory` (จาก origin/develop 9ac72815)
- Inventory: `apps/api/src/scripts/line-identity-inventory.logic.ts` (+`.spec.ts`) + runner `apps/api/src/scripts/line-identity-inventory.ts` (read-only; exit 0/1/2; `--dispositions` = JSON array ของ ExternalIdentity ids ที่รีวิวแล้ว)
- Lookup fixes: `exchange-line-token.use-case.ts`, `link-line-identity.use-case.ts` (canonical-first + fallback warn + prod fail-closed)
- Spec updates: `auth-endpoints.spec.ts` (exchange block), `line-linking.spec.ts`
Verification: (บันทึกผลเมื่อรัน) `pnpm exec tsx --test src/scripts/line-identity-inventory.logic.spec.ts src/modules/auth/line-linking.spec.ts src/modules/auth/auth-endpoints.spec.ts` + `pnpm exec tsc --noEmit` ใน apps/api
Next: merge เข้า develop → รัน inventory กับ UAT DB (ผ่าน SSM tunnel ตาม runbook) เก็บ baseline classification → เริ่ม P12-1 (OAuth+PKCE + BFF route `/api/auth/line-login` + เปลี่ยน SHOW_LINE_LOGIN เป็น env flag)
