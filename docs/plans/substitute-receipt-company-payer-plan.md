# Plan: ใบรับรองแทนใบเสร็จ บริษัทจ่ายเต็ม / พนักงานจ่ายเต็ม

Status: Implemented and locally verified; ready for user review. No deployment.
Date: 2026-09-09
Spec: [[specs/substitute-receipt-company-payer-spec]]
Memory: [[agent-memory/substitute-receipt-company-payer-2026-09-09]]

## ขอบเขตที่ผู้ใช้ยืนยันล่าสุด

ทำเฉพาะใบรับรองแทนใบเสร็จรับเงิน บริษัทจ่ายเต็มจำนวนหรือพนักงานหนึ่งคนจ่ายเต็มจำนวน ผู้ใช้ทักว่าไม่ได้ให้ทำใบเบิก จึงนำการแก้ module/หน้า/API/schema ของ Reimbursement และปุ่มพาไปสร้างใบเบิกออกทั้งหมด ข้อค้นพบเรื่องการเบิกคืนในรายงานก่อนหน้าเป็น backlog ของงานแยก ไม่ใช่ acceptance ของงานนี้

ใช้ Ponytail full, architecture/permissions/Decimal/locks/signature/renderer เดิม ไม่เพิ่ม dependency หรือแก้ package.json ไม่ deploy หรือแก้ข้อมูลจริง

## งานที่ทำแล้ว

- [x] Product: สเปกปัจจุบันกำหนดสองแหล่งเงินแบบเต็มจำนวน ผู้ลงนามเป็นบุคคล และไม่ถือว่าใบรับรองพนักงานจ่ายคือบริษัทจ่ายคืนแล้ว
- [x] Snapshot: ใช้ชื่อจดทะเบียนที่บันทึกจริงก่อน display name; fallback แจ้งชัด; certify ใช้ snapshot ที่ตรวจแล้ว ไม่อ่านข้อมูลชุดใหม่ใต้ checksum เดิม; ตรวจ revision/status ใน transaction
- [x] Signer UX: เลือกตำแหน่งของตน/คำแนะนำ/ระบุเองใน wizard และหน้า review; ตำแหน่งใหม่พิมพ์ literal; เปลี่ยนตำแหน่งทำให้ preview/ack เก่าหมดอายุ
- [x] Contracts/data: evidence เพิ่ม nullable fundingSource และ correction fields; prepare ใหม่บังคับ source/full-payment acknowledgement; legacy ไม่เดา source
- [x] Financial boundary: COMPANY เพิ่มเต็มยอดครั้งเดียวหรือคงยอดเต็มเดิม; ปฏิเสธยอดบางส่วน; PERSONAL ไม่เพิ่ม payment/ยอดบริษัท; guard การลงจ่ายต้นทางที่ขัดกับใบรับรอง
- [x] Document correction: แก้ชื่อ/ตำแหน่งโดยคงข้อเท็จจริง เงิน ภาษี ผู้จ่าย ผู้อนุมัติ และไฟล์ต้นฉบับ; pending correction ยกเลิก/เริ่มใหม่/retry ได้; supersede ต้นฉบับเมื่อออกใหม่สำเร็จ
- [x] Integration: LINE ต้องระบุแหล่งเงินและเต็มจำนวนชัดเจน; export อ้าง signed snapshot และสายเวอร์ชัน; หน้าเสร็จไม่มีลิงก์สร้างใบเบิก
- [x] Scope audit: ไม่มี diff ใน reimbursement module/pages, materializer, reimbursement model หรือ ReimbursementLine schema
- [x] Local: database ใหม่เฉพาะงานใบรับรอง พร้อมตัวอย่างบริษัท/พนักงานและฉบับแก้ เปิดหน้ารวมใบรับรองให้ตรวจ

## หลักฐานการตรวจ

| การตรวจ | ผล |
|---|---|
| API focused suites: LINE, policy, use-case, renderer, export, repositories, payment/atomic-confirm, real PostgreSQL | 367 ผ่าน, 0 fail, 0 skipped |
| Web: substitute-receipt models/preview/API | 57 ผ่าน, 0 fail, 0 skipped |
| API และ web TypeScript | ผ่าน |
| Prisma generate + migration บน database ใหม่ + local seed | ผ่าน |
| API build | ผ่าน |
| Public API: prepare → preview → certify → approve/issue | COMPANY 100 บาท มี payment 1; PERSONAL 100 บาท บริษัท paid 0 และ payment 0 |
| Public API: company document correction | ออก version ใหม่ ตำแหน่งใหม่ ยอดและ payment เท่าเดิม |
| Browser follow-up: วาดลายเซ็นแล้วเกิดเส้นยาว | ซ่อนกล่องลายเซ็นเดิมตั้งแต่เปิด editor ไม่ยุบระหว่างลาก; เส้นแรก/วาดเพิ่มหลังใช้ภาพ/ล้างแล้ววาดใหม่ ผ่านบน local; model 25 เคสและ web typecheck ผ่าน |
| Browser follow-up: ปุ่มไปกรอกตำแหน่ง | แก้ ref ที่ชี้ช่องพิมพ์ซึ่งยังไม่ mount; กดแล้ว scroll/focus ตัวเลือกหรือช่องระบุเองตามโหมด ผ่านบน local และ web typecheck |
| Browser: mobile-width hub, custom title, unsigned preview, Escape, เปลี่ยนตำแหน่ง | ผ่าน; เปลี่ยนตำแหน่งแล้ว readiness ต้องตรวจเอกสารใหม่ |
| PDF ที่ออกจริงทั้งสองแหล่งเงิน | ดาวน์โหลดผ่าน API และ render Poppler สำเร็จ ตรวจทั้งหน้า ชื่อ/แหล่งเงิน/ตำแหน่งอ่านได้ ไม่ทับกัน |

คำสั่ง API จาก `apps/api` (ต้องมี local PostgreSQL และ env ของ harness):

```sh
pnpm exec tsx --test src/modules/expenses/application/use-cases/line-substitute-receipt-continuation.use-case.spec.ts src/modules/expenses/application/use-cases/substitute-receipt*.spec.ts src/modules/expenses/domain/logic/substitute-receipt.logic.spec.ts src/modules/expenses/domain/logic/expense-export.logic.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.substitute*.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.payment.spec.ts src/modules/expenses/infrastructure/prisma-expense.repository.atomic-confirm.spec.ts src/modules/expenses/infrastructure/substitute-funding.pg.spec.ts
```

คำสั่ง web จาก `apps/web`:

```sh
pnpm exec tsx --test src/features/expenses/substitute-receipt-*.spec.ts src/features/expenses/expenses.api.spec.ts
```

ข้อจำกัด: ยังไม่ได้รัน browser E2E ทั้ง repository หรือยืนยัน UAT/Production; PDF iframe ใน Codex in-app browser timeout แม้ไฟล์ PDF ที่ API ส่งและการ render จริงผ่าน จึงไม่นับ native PDF embedding ว่าผ่านใน browser นี้ ไม่ขยายไปแก้ตัวดูเอกสารส่วนกลางในงานนี้

## Local UX follow-up: ตรวจเอกสารเป็นขั้นท้าย

- [x] ตำแหน่ง → ลายเซ็น → ตรวจเอกสาร → รับรอง/ยืนยัน ทั้ง wizard ผู้จ่าย/ผู้อนุมัติและหน้า review เดิม
- [x] หมายเลข ลำดับ readiness และคำอธิบายไทย/อังกฤษตรงกับหน้าจอ; ปุ่มตรวจเด่นเมื่อยังไม่ตรวจ
- [x] คง preview/version/checksum gate; local browser พิสูจน์ไม่เปิดตรวจ = ยังลงนามไม่ได้, เปิดสำเร็จ = พร้อม, แก้ตำแหน่ง = ต้องตรวจใหม่
- [x] Focused wizard/preview 33 เคสและ web typecheck ผ่าน ไม่มีการ submit ลายเซ็นหรือออกเอกสารในการตรวจ UI รอบนี้

## จุดตรวจของผู้ใช้

[หน้ารวมใบรับรอง local](http://127.0.0.1:3000/companies/seed-local-company/expenses/substitute-receipts)

ใช้ Dev sign-in (local seed OWNER) หรือบัญชีทดสอบ Owner / Owner@12345 หากต้องเข้าสู่ระบบใหม่ ข้อมูลบริษัทและลายเซ็นใน local เป็นข้อมูลจำลองทั้งหมด ไม่มีการส่งไป live


## Local follow-up: selecting and changing the payment certifier (2026-09-09)

- Spec clarified that preparer and certifier may differ; fresh drafts require an explicit member selection. Previously selected eligible drafts/LINE values remain supported.
- Implemented consistent certifier labels/help and a visible current certifier/change action before signing. The action opens and focuses the existing cancellation reason; mutation still requires the existing reason/version/permission/source checks. A revised draft retains the previous factual fields and requires selecting its certifier and acknowledging full payment again.
- New snapshots capture the document role label. Old snapshots keep their original role label and existing artifacts are not rewritten. No API endpoint, permission, database or reimbursement changes in this follow-up.
- Integration: browser tested fresh blank selection, shortcut focus, cancellation, revision with retained facts, selecting a different employee, preparation and the resulting waiting screen. Public API confirms creator and certifier differ, creator preview is forbidden, and company paidAmount/payment count remain zero.
- Verification: API 58/58; web 33/33; web typecheck, API typecheck using the configured 8 GB script, API build and scoped whitespace checks passed. Detailed commands/logs and fixture IDs are recorded in task memory.
