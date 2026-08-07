# สรุปแผนปรับหน้าจอให้รองรับมือถือ (Mobile Responsive Uplift) — ภาษาไทย

วันที่: 2026-08-04 · เอกสารหลัก (อังกฤษ): `docs/plans/mobile-responsive-uplift-plan.md` · เอกสารสั่งงาน Codex: `docs/plans/mobile-responsive-uplift-codex-handoff.md`

## สิ่งที่ตรวจพบ (audit ทั้งแอป ~80 หน้า)

ข่าวดี: โครงหลักมี mobile drawer + hamburger อยู่แล้ว และหลายหน้า (Inbox, Dashboard, Settings, วิซาร์ดพนักงาน, Expense detail, Bookings) ออกแบบ mobile ไว้ดีอยู่แล้ว — เราจะใช้เป็นต้นแบบ ไม่แตะ

ปัญหาเรียงตามความรุนแรง:

1. **ข้อมูลหายเงียบ ๆ 9 จุด** — ตารางกว้างที่ไม่มีตัวเลื่อน ถูก `overflow-x: clip` ตัดทิ้ง มองไม่เห็นและเลื่อนไม่ได้เลย: งบทดลอง + บัญชีแยกประเภท (journal), หน้า accounting/sales-documents, tax, inventory ×4
2. **บั๊กของ shell** — JS ใช้ breakpoint 768 แต่ CSS ใช้ 1024 (มี dead zone), header 68px แต่ drawer เว้น 64px (เหลื่อม 4px), เปิด drawer แล้วหน้าหลังยังเลื่อนได้, backdrop อยู่ใต้ header, `100vh` ทำจอเด้งบน Safari, SystemHeader ไม่มี mobile เลย
3. **iOS ซูมเองทุกช่องกรอก** — input ใช้ font 14px (ต้อง ≥16px) กระทบทั้งแอปผ่าน `.mangmee-input` / ThemedSelect (29 ไฟล์)
4. **"ภาษีการลากจอ"** — คิวงานหลัก (เบิกจ่าย ×3, รายจ่าย, เอกสารบัญชี) เป็นตารางกว้าง 2–2.6 เท่าของจอ ปุ่มดำเนินการอยู่คอลัมน์สุดท้าย = หลุดจอตลอด
5. **ปุ่มเล็กกว่ามาตรฐานสัมผัส 44px** เกือบทุก control กลาง + popover ล้นขอบจอขวา (PopoverPanel ไม่ clamp)

## แนวทางออกแบบ (ไม่ให้เว็บเดสก์ท็อปเพี้ยน)

- **กติกาเหล็ก: desktop ต้องเหมือนเดิมทุกพิกเซล** — ทุกการแก้เขียนแบบ mobile-first แล้วคืนค่าเดิมที่ breakpoint เดิม (เช่น `h-11 sm:h-10`) ยกเว้นบั๊ก shell 3 จุดที่ติดป้าย `[desktop-visible]` ชัดเจน มีชุดทดสอบ desktop + screenshot baseline เป็นตัวจับ
- **ตาราง 2 ชั้น**: ชั้นแรก — ทุกตารางต้องเลื่อนได้เสมอ (class กลาง `.mangmee-table-scroll`); ชั้นสอง — เฉพาะ 5 คิวงานหลักได้ **การ์ดแบบมือถือ** (`md:hidden`) ที่เอาปุ่มดำเนินการมาไว้ใกล้มือ ส่วนตาราง desktop คง DOM เดิมไม่แตะ
- **ฟอร์ม/overlay แบบ native**: input 16px (เลิกซูมเอง), Modal เป็น bottom-sheet บนมือถือ, popover clamp ขอบจอ, ปุ่ม ≥44px บนมือถือ
- **แก้ shell ครั้งเดียวจบ**: `--app-header-h`, breakpoint เดียว (1024) ผ่าน hook `useMediaQuery` ใหม่, scroll-lock, z-index, `100dvh`, safe-area
- **ไม่ชุบชีวิต component ตาย** (`DataTable` ฯลฯ ไม่มีใครใช้) — แก้ที่ class ที่ทุกตารางใช้จริง ตามหลัก ponytail

## วิธีทำงาน (harness engineer)

Claude เขียน harness + เกตตรวจ / **Codex เป็นคนเขียนโค้ด** / Claude ตรวจทุกเฟสแล้วค่อย commit

| เฟส | งาน | สัญญาณผ่าน |
|---|---|---|
| R0 | สร้างชุดทดสอบก่อนแก้: Playwright project `mobile-chromium` (Pixel 7) + `e2e/responsive.spec.ts` (INV-1 ไม่ล้นจอ, INV-2 ไม่มีตารางถูกตัด, INV-3 drawer ใช้ได้, INV-4 ไม่มี client error) + baseline screenshot desktop 6 หน้า | สเปกรันได้ และ**แดงตรงจุดที่ audit เจอพอดี** |
| R1 | Foundation + shell (globals.css, viewport, hook, drawer/header/backdrop, SystemHeader) | INV-3 เขียว, desktop suite เขียว |
| R2 | Control กลาง (input 16px, ปุ่ม 44px, Modal bottom-sheet, popover clamp) + INV-5 no-zoom, INV-6 popover ไม่ล้น | เขียว + screenshot desktop เทียบ baseline ไม่ต่าง |
| R3 | กวาดเชิงกล: ห่อ 9 ตารางที่ถูกตัด, เติม prefix ให้ grid, `100vh→dvh`, popover fix-px | INV-1/2 เขียว**ทุก route** |
| R4 | การ์ดมือถือ 5 คิวงานหลัก (เบิกจ่าย ×3, รายจ่าย, เอกสารบัญชี) + INV-7 | การ์ดใช้ได้บนมือถือ, DOM ตาราง desktop เหมือนเดิมแบบ byte-identical |
| R5 | รันเต็ม 375/412/desktop + `e2e/RESPONSIVE-RESULTS.md` + ปิดเอกสาร | ทุกอย่างเขียวหรือ quarantine พร้อมเหตุผล |

คำสั่งเริ่ม Codex อยู่หัวเอกสาร handoff (`codex exec -m gpt-5.6-sol …`) — Codex ห้าม commit/`git add` เอง Claude ตรวจและ commit ทีละเฟส

---

## ผลปิดงาน (2026-08-04)

ทำครบทั้ง 6 เฟส (R0–R5) — commit ต่อเฟส: `f6901b0c`, `ab1cb8af`, `6a6ec567`, `feba17ab`, `a6de43c5` + R5 close-out

- **มือถือผ่านทุก invariant ทั้งที่ 412px และ 375px floor** (53/53) — ไม่มีตารางถูกตัด, drawer/scroll-lock/Escape ทำงาน, ไม่มี iOS zoom, popover ไม่ล้นจอ, การ์ด 5 คิวงานหลักใช้ได้จริง
- **Desktop ไม่เพี้ยน**: journal/settings byte-identical, เบิกจ่าย/รายจ่าย layout เดิม (ต่างแค่ข้อมูล seed), accounting ดีขึ้นตามที่อนุมัติ
- Claude gate จับบั๊กของ Codex ได้ 3 จุดระหว่างทาง (SSR flash, min-width ตัดคอลัมน์ desktop, กฎ font ไม่ครอบคลุม) — แก้ก่อน commit ทุกครั้ง
- Full desktop suite แดง 12 ตัว จำแนกครบทุกตัวว่า **ไม่ได้เกิดจากงานนี้** (pre-existing 4, Redis 3, มาจาก merge `develop` กลางคัน 5 — พิสูจน์ NAV ด้วย isolation run) — ดู `e2e/RESPONSIVE-RESULTS.md`
- ประเด็นควร follow-up แยก: spec เก่า 3 ตัวที่ต้องอัปเดตตาม product ปัจจุบัน (SMOKE-02, SET-01, และ roles-matrix "ตั้งค่าบริษัท" — เจ้าของยืนยันแล้วว่าเมนูผูก permission ดังนั้น MANAGER ที่ได้สิทธิ์ tax summary เห็นเมนูได้ = พฤติกรรมที่ตั้งใจ ไม่ใช่บั๊ก) และ failure ฝั่ง merge (REIMB-03/SET-03A/BOOK-04/NAV)
