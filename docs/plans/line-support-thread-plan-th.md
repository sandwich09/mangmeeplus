# Plan: แชทในเคสคำขอคุยกับเจ้าหน้าที่ (support thread v3)

Status: implemented locally 2026-09-20 (uncommitted); verification evidence below. Not deployed.
Spec: [line-support-request-spec-th §สัญญา v3](../specs/line-support-request-spec-th.md)
Memory: [line-support-thread-2026-09-20](../agent-memory/line-support-thread-2026-09-20.md)

## เป้าหมาย

Owner 2026-09-20: หน้า `/system/support-requests` ต้องดูเคสเป็นแชทแบบ module CRM inbox — เห็นทุกข้อความและกดดูรูปที่ลูกค้าส่งมาได้ ตั้งแต่ลูกค้าส่งขอความช่วยเหลือจนปิดเคส ปัจจุบันแถวเคสเก็บแค่ข้อความล่าสุด 200 ตัวอักษร + คำตอบล่าสุด 1 ข้อความ และ §3 v2 ไม่เก็บรูปเลย (แสดงเพียง "📷 ส่งรูปมา")

## ขอบเขตและสิ่งที่ไม่ทำ

- ทำ: ตารางเธรด + blob (additive migration), เขียนเธรดทุกจุดที่มีอยู่แล้ว (กดปุ่ม/LIFF/ข้อความตาม/รูป/ตอบจาก inbox/ตอบจากหน้า partner), endpoint อ่านเธรด + stream รูป, หน้าต่างแชทบน inbox
- ไม่ทำ: ไม่แตะ `signup-admin-queue.use-case.ts` (REQUEST_INFO ยังแสดงจาก signup relation ตามสัญญาข้อ 5 และไฟล์นั้นมีงานค้างของ owner อยู่), ไม่เปลี่ยนกติกา marker/pause ของรูป, ไม่มี sweep ใหม่ (cascade), ไม่มี dependency ใหม่, ไม่แก้ `package.json`, ไม่ย้าย inbox เป็น 2 pane แบบ CRM (modal เธรดพอสำหรับตารางที่มี 5 คอลัมน์)

## ขั้นตอน

1. [x] Spec v3 ข้อ 9–12 + §3 ปรับ
2. [x] Prisma: `LineSupportMessage`, `LineSupportMessageBlob`, relation บน `LineSupportRequest`; migration `20260920120000_line_support_thread`
3. [x] Contracts: `SupportRequestMessageDto`, `SupportRequestThreadDto`
4. [x] API เขียนเธรด: webhook (tap nested create, follow-up text เต็มประโยค, media claim→download→blob/mediaError), LIFF support use case (nested create), inbox reply (upsert ตาม operationId + สถานะส่ง), partner message (append หลัง transaction)
5. [x] API อ่าน: `GET :id/thread`, `GET :id/messages/:messageId/content` (StreamableFile, no-store)
6. [x] Web: `SupportThreadModal` (bubbles/รูป/composer/poll 10s/ปุ่มจัดการเคสชุดเดิม), ปุ่ม "เปิดแชท" ทุกแถว, "ตอบใน LINE" เปิดแชทแทน prompt (retry เดิมยังใช้ confirm)
7. [x] Tests: unit (admin use case, signup webhook harness), pg spec (เธรดจริง + blob + content), web render spec
8. [x] Verify: prisma validate/generate, migrate deploy บน Postgres ชั่วคราว, tsc api/web, node tests

## หลักฐานการตรวจ

| Check | ผล |
|---|---|
| `prisma validate` / `prisma generate` | ผ่าน |
| `prisma migrate deploy` บน Postgres ชั่วคราว + `migrate diff` | migration ใหม่ apply ได้ ไม่มี drift ที่ตารางใหม่ (drift เดิมของตารางอื่นไม่เกี่ยวกับงานนี้) |
| `tsc --noEmit` api (heap 8GB) / web `typecheck` | ผ่านทั้งคู่ |
| API unit specs ที่แตะ (admin use case, partner tools, signup webhook, main webhook, intake dispatch, notify, public signup, admin queue) | ผ่านทั้งหมด |
| `line-support-request.pg.spec.ts` บน Postgres ชั่วคราว | 20/20 |
| Web specs ของ feature (render + logic + qa) | ผ่านทั้งหมด |
| Playwright e2e / เปิดดูจริงใน browser | ยังไม่ได้รัน (ต้องมี stack เต็ม) — ปุ่มเดิมในแถวและ prompt ปิดเคสไม่เปลี่ยน |

รายละเอียดคำสั่งและตัวเลขอยู่ใน memory
