# LINE Login + เชื่อมบัญชี + Web QR Login (Journey รวม) — Spec P12

สถานะ: DRAFT ฉบับรวม — หลอมสามเอกสารเดิมเป็น journey เดียว รอเข้าคิว implement; แผนส่งมอบเขียนตอนเข้าคิว

เอกสารที่หลอมรวม (ยังเป็น source ของรายละเอียดเฉพาะทาง):

- [web-line-login-plan](../plans/web-line-login-plan.md) — 02C "Ready for implementation handoff" (ปุ่ม LINE login + exchange)
- [line-web-deeplink-handoff-spec](line-web-deeplink-handoff-spec.md) — DRAFT ยังไม่ build (`LineWebHandoffToken`/`/l/<token>` ไม่มีในโค้ด); **ขัดกับ plan ข้างบนหนึ่งจุด**: spec นั้นประกาศ non-goal "line/exchange stays deferred (E11)" ขณะที่ plan จะเปิดใช้ — **มติของ spec รวมฉบับนี้: P12 เปิด `line/exchange` เป็นส่วนหนึ่งของ full flow (ยกเลิก E11 deferral) โดยต้องทำ state/nonce/BFF cookie ครบตาม AUTH-01 ก่อน**
- [password-reset-line-flow-spec](password-reset-line-flow-spec.md) — APPROVED และ**ส่วน provider claim ทำแล้ว**: session LINE ไม่ติด `mustChangePassword` gate
- [แผนหลัก §13.5, §13.6 D/E/F/G](../plans/mangmee-brain-2-5-day-priority-plan-th.md) — flow, กฎ QR login 8 ข้อ, migration ผู้ใช้เดิม (AUTO-REUSE/BACKFILL/RELINK/DENY), แผน AUTH-04 (P12.1–12.3)

STOP-SHIP ที่ spec นี้ปิด: AUTH-01, AUTH-03, AUTH-04 (+ AUTH-02 ถูกปิดโดยกติกา credential ชุดเดียวที่บังคับทั้ง P11/P12)

## 1. Current truth (สำรวจ 2026-08-26)

| ข้อเท็จจริง | หลักฐาน |
|---|---|
| `POST /auth/line/exchange` **ปิดตายโดยตั้งใจ**: controller โยน 403 เสมอ ไม่เคยเรียก use case ที่ inject ไว้; `login-channels` ตอบ `line: unavailable (deferred)` แบบ static | `auth.controller.ts:282-292,153`; `login-channel.logic.ts:1-7` |
| `ExchangeLineTokenUseCase` **สร้างเสร็จแล้วแต่ unreachable**: verify ID token → หา identity ACTIVE → ออก token `provider:'line'`; unlinked คืน `{linked:false}` ไม่ throw; **ไม่มี company resolution ในตัว** | `exchange-line-token.use-case.ts:28-74` |
| ปุ่มเว็บ: `SHOW_LINE_LOGIN = false` เป็น const ฮาร์ดโค้ด (ไม่ใช่ env/flag) ผู้บริโภคเดียวที่ :403 | `LoginPage.tsx:24-26,403` |
| BFF session: cookie httpOnly ครบชุด (`watchdog_token` chunked ~9.4KB, refresh path-scoped, csrf) มินต์ได้จาก 3 route เท่านั้น — **ไม่มี route LINE** | `auth-cookies.server.ts:35-110`; `app/api/auth/{login,dev-login,refresh}` |
| `mustChangePassword` gate ข้าม session LINE แล้ว (`provider !== 'line'`) — ตาม password-reset-line-flow | `auth.guard.ts:194-201`; `issue-token.use-case.ts:47` |
| **AUTH-04 ยืนยันในโค้ด**: unique = `(provider, providerChannelId, providerUserId)` แต่ lookup ทั้งสองจุด**ไม่กรอง channel** (`exchange`:42-45, `link`:27-29); channel default `'unknown'` ได้ | `schema.prisma:776-791`; `link-line-identity.use-case.ts:21` |
| Token เชื่อมบัญชีแบบครั้งเดียวมีแบบพิสูจน์แล้ว: hash-store, TTL 15 นาที (พนักงาน)/72 ชม. (owner), atomic claim H-09, compensating release เฉพาะ error ก่อน mutate | `employee-access.logic.ts:7,128-147`; `complete-employee-line-link.use-case.ts:60-96` |
| Multi-company ตอน link: OWNER-only เมื่อ >1 membership (โยง P13) | `link-line-identity.use-case.ts:114-117` |

## 2. Journey ที่ต้องได้ (จาก §13.5 — บังคับทุกข้อ)

```text
กด "เข้าสู่ระบบด้วย LINE" → LINE OAuth/LIFF พร้อม state+nonce → callback ตรวจ issuer/audience/expiry/state
→ exchange เฉพาะ identity linked+active → BFF ตั้ง HttpOnly cookie (route ใหม่ /api/auth/line-login)
→ 0 บริษัท: อธิบายวิธีขอสิทธิ์ · 1 บริษัท: เข้า landing · หลายบริษัท: เลือกบริษัทพร้อมชื่อบทบาท
```

- Unlinked → **ห้ามออก session/ข้อมูลบริษัท**: หน้า "เข้าสู่ระบบและเชื่อม LINE" (Thai) → password ถูกต้องแล้ว link ต่ออัตโนมัติ (plan :27 คำต่อคำ) หรือ "สมัครใช้งาน" → P10/P11 พร้อม signed continuation
- Audit เท่ากับ password login + `method: line` (plan :32)
- Gate ผ่าน (plan :38 คำต่อคำ): "linked user ได้ first-party session ที่ permission/audit/revocation เหมือน password ทุกประการ; unlinked ไม่มีวันได้ session หรือข้อมูลธุรกิจ"

## 3. Web QR Login (desktop) — กฎ 8 ข้อของ §13.6E ยกมาบังคับทั้งชุด

QR = opaque public code TTL สั้น single-use bind browser/intent; secret อยู่ใน HttpOnly cookie ฝั่ง desktop; polling จำกัดอัตรา; `returnTo` allowlist กัน open redirect; expire/cancel/provider error สลับกลับ password form อัตโนมัติ**โดยไม่กรอก/กดแทนผู้ใช้**; disabled/suspended/no-membership fail closed; refresh/back/replay ไม่มินต์ session ซ้ำ — mermaid flow ตาม §13.6E

## 4. Canonical identity scope + migration ผู้ใช้เดิม (ปิด AUTH-04 — ยก P12.1–12.3 เป็นข้อกำหนด)

1. **P12.1**: `LINE_MESSAGING_CHANNEL_ID` = canonical `providerChannelId`; Login channel ใช้ตรวจ audience เท่านั้น; production fail closed เมื่อ config หาย ห้าม fallback `'unknown'`; ยืนยัน Messaging/Login/LIFF อยู่ Provider เดียวกัน (หลักฐาน deployment)
2. **P12.2**: inventory/dry-run read-only ซ้ำได้ — จัดกลุ่ม `AUTO_REUSE / BACKFILL / CONFLICT / DENY_REVIEW` ด้วย masked identifier; non-zero exit เมื่อมี conflict ไร้ disposition
3. **P12.3 + ตาราง §13.6F**: AUTO-REUSE (Provider เดียว identity ACTIVE unique) ไม่แตะบัญชี; BACKFILL idempotent เฉพาะ row เก่า/ว่างไร้ conflict; RELINK-REQUIRED ห้าม match ด้วยชื่อ/รูป/email/เบอร์; DENY/REVIEW fail closed; rollout: dry-run → shadow check (`sub` resolve ถูกคนโดยยังไม่ออก session) → cohort ภายใน → ผู้ใช้เดิมตัวอย่าง → Controlled Beta; rollback ไม่ทำ OA chat เดิมหยุด
4. แก้ lookup ทั้งสองจุดให้กรอง canonical channel (พร้อม fallback ชั่วคราวช่วง migration ที่ log warn — ถอดเมื่อ backfill จบ)

## 5. LIFF fallback + deep-link handoff

- LIFF = UI/auth bridge ของเรา; password ไป Mangmee API เท่านั้น (กฎ §13.6C ทุกข้อ)
- Signed short-lived handoff (จาก claim → LINE) ใช้ดีไซน์ `line-web-deeplink-handoff-spec` (single-use, TTL 15 นาที, bind company+path, re-tap ≠ success เพราะ session คือ side effect ใหม่ — :140) — เปิดคำถาม Q1–Q4 ของ spec นั้นให้ Owner ตอบตอนเข้าคิว

## 6. Gates/tests (ยกจาก §15 แถว "OA/LIFF Linking", "Web QR Login/Fallback", "Existing LINE user migration" — ทั้งสามแถวคำต่อคำเป็นเกณฑ์ผ่าน)

## 7. คำถาม Owner (ตอนเข้าคิว)

1. เส้นทางรับ ID token ฝั่งเว็บ: LIFF หรือ OAuth redirect (plan เปิดไว้ — "เลือก path เล็กสุดที่เข้ากับ config LIFF เดิม")
2. Q1–Q4 ของ deep-link handoff spec (provider claim ของ handoff session, link-preview burn, TTL, alert rail)
3. ยืนยันหลักฐาน LINE Developers Console: Messaging/Login/LIFF Provider เดียวกัน (ใครเป็น Admin ของ Provider — คำถาม §11 ข้อ 17 เดิม)
