# Agent Memory: line-login-p12-delivery

Status: P12-0 + P12-1 **LIVE บน UAT** (2026-08-28: PR #318/#320/#321/#322 → develop; #328 → main; flag PR #333/#334; UAT run 33190617504 success; live-verified: availability true, authorize redirect + PKCE S256 + txn cookie ถูกต้อง); P12-2 (link-after-password) in progress; P12-3 not started
หมายเหตุ 2026-08-29: หน้า settings/security ถูก feature-disabled (owner 2026-08-05) และไม่มี UI เชื่อม LINE — ข้อความ link-required ของ P12-1 ชี้ทางผิด → P12-2 แทนที่ด้วย flow จริง (password ครั้งเดียว → OAuth รอบสั้น → endpoint ใหม่ `POST auth/line/link/oauth` ที่ใช้ LinkLineIdentityUseCase + nonce; ไม่มี pending-token table)
Owner: MangmeeDev
Scope: P12 LINE Login/Link/QR full journey ตาม [spec รวม](../specs/mangmee-line-login-link-journey-spec-th.md) + [four-lane P12](../plans/mangmee-four-lane-gap-closure-plan-th.md#p12--line-loginlinkqr); เป้าหมาย Owner = "พร้อมทั้งหมด": ปุ่ม LINE login (mobile redirect), desktop QR, deep-link handoff จากแชต
Decisions:
- 2026-08-27 Owner: Messaging API / LINE Login / LIFF อยู่ LINE **Provider เดียวกันทั้งหมด** (ยืนยันในแชต; console evidence + ชื่อ Admin เก็บตอน activation gate ตาม P12.1) → migration เดินสาย AUTO_REUSE/BACKFILL ได้ ไม่ต้องบังคับ re-link ทั้งระบบ
- ลำดับส่งมอบ: P12-0 → P12-1 (mobile OAuth+PKCE) → P12-2 (unlinked link flow) → P12-3a (desktop QR) → P12-3b (deep-link handoff + alert rail ทีหลัง)
- Q1/Q3/Q4 ของ deep-link handoff ยังไม่ตัดสิน — ข้อเสนอบนโต๊ะ (provider='line' / TTL 15 นาที / assistant ก่อน alert rail) รอ Owner ยืนยันตอน P12-3b เข้าคิว; Q2 = การวัด link-preview ก่อน rollout
- P12-0 design: inventory เป็น read-only (ไม่ mutate); backfill/dedupe พร้อม batch id + checksums เป็น slice ถัดไป; lookup ใช้ canonical-first + channel-agnostic fallback log warn (shape เดียวกับ webhook/notification resolver เดิม); production fail-closed เมื่อ LINE channel config หาย (ห้าม 'unknown')
- P12-1 design (2026-08-28): browser → BFF `GET /api/auth/line-login/start` (mint state/nonce/PKCE ใน HttpOnly txn cookie 10 นาที path-scoped) → LINE authorize → BFF `GET /api/auth/line-login/callback` (ตรวจ state, เคลียร์ txn ทุกทาง) → API `POST /v1/auth/line/login/callback` (แลก code ฝั่ง server ด้วย channel secret, verify id_token พร้อม nonce, เข้า ExchangeLineTokenUseCase เดิม) → BFF ตั้ง session cookies ชุดเดียวกับ password login → redirect '/' ให้ session gate เดิม route ต่อ; unlinked → `/login?line=link-required` (P12-2 ทำ flow เชื่อมต่อ)
- เปิดใช้ด้วย `LINE_WEB_LOGIN_ENABLED` (default OFF ทุก env): ปุ่มบนหน้า login เป็น server-driven ผ่าน login-channels + `/api/auth/line-login/availability`; ปิด flag = ปุ่มหาย + endpoint 403 (rollback ทันที)
- Gate decision (Fable, 2026-08-28): เพิ่ม `/v1/auth/line/login/callback` เข้า `CLOSED_PUBLIC_PATHS` — LINE login มี posture เท่า password login ทุกสถานะ platform gate (ตอน CLOSED ผู้ใช้ธรรมดายังถูกกันที่ business routes เหมือนเดิม — SYSTEM_ADMIN เท่านั้น)
- Env invariant: `WEB_BASE_URL` (API env) ต้องเท่ากับ public web origin — API ใช้ประกอบ redirect_uri ตอนแลก code; ถ้าไม่ตรงกับที่ BFF ใช้ (forwarded host) LINE จะปฏิเสธการแลก code; sealed `POST auth/line/exchange` ยังคง 403 (จะเปิดตอน LIFF surface ใน P12-2)
- `line/exchange` (LIFF surface) ยัง sealed ตามเดิม — เปิดพร้อม P12-2 เมื่อมี surface ใช้จริง
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
