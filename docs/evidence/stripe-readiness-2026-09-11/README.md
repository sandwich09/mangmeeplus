# Stripe pre-integration readiness — executed simulation 2026-09-11

ผล: **ยังไม่ผ่าน readiness สำหรับนำกลไกเดิมไปต่อ Stripe โดยตรง**. Browser/API/DB suite ผ่าน 6 / ไม่ผ่าน 2; PostgreSQL recovery probes ผ่าน 1 / ไม่ผ่าน 3. ไม่มี skipped/quarantined หรือการนับ known failure เป็น PASS. พบ product blockers 5 ข้อด้านล่าง; ยังไม่มี Stripe Checkout/webhook runtime จึงไม่ใช่ Stripe payment E2E.

## ขอบเขตที่รันจริง

- Playwright Chromium → Next.js/NestJS ที่ build ใหม่จาก checkout → PostgreSQL จริง; API `127.0.0.1:3021`, web `127.0.0.1:3020`, PostgreSQL `15432`, Redis `6379`. ทดสอบด้วย local seeded identities และบริษัท disposable ใหม่ต่อ case.
- จำลองเฉพาะ “ผลชำระ” ใน test driver: paid เรียก **admin manual-renew API เดิม** 30 วัน; declined ไม่เรียก renew. Driver นี้ไม่มีใน production และไม่ใช่การ implement Stripe authentication/invoice ledger.
- Probes ใช้ production Renew/Lifecycle/Sweep use cases กับ PostgreSQL จริง; inject เฉพาะ exception หรือจังหวะระหว่าง queries. Scope query ของ sweep ให้เลือกเฉพาะบริษัท fixture; notification delivery เป็น no-op.
- Main HEAD `a6608e170f8cffb7edd7ae1ae9388d1e4575dabb`, website HEAD `9cc2ae6e916f53395eaf8542739d2182298d6110`; working trees dirty. ไม่มี runtime fix ในงานนี้. Hash ของ source/test ที่ใช้และผลราย case อยู่ [results-summary.json](results-summary.json).
- Cleanup ตรวจแล้วเหลือบริษัทและ audit ของ fixture `e2e-billing-*` **0 รายการ**; ไม่เปลี่ยน password/reset DB/ลบ seed company. Next.js เปลี่ยน `next-env.d.ts` ระหว่าง build และคืนเฉพาะบรรทัดที่ runner เปลี่ยนแล้ว.

## ผลแยกชั้น

| Case | ผล | สิ่งที่พิสูจน์ / ข้อจำกัด |
|---|---|---|
| BR01 | PASS | หมดอายุ → API ปฏิเสธ; decline/URL `payment=success` ไม่เปิดสิทธิ์; simulated paid driver ต่ออายุแล้วสร้างสาขาจาก **UI จริง** และตรวจ DB พบ record. ข้อมูลเดิม/โควตา 7 ใบ/roles/term ของบริษัท B ไม่เปลี่ยน. ไม่ได้พิสูจน์การรับบัตรหรือการเปลี่ยน paid tier |
| BR02 | PASS | บริษัทที่ term system ปิด กลับ ACTIVE; requestId เดิมที่ส่งทีละคำขอไม่เพิ่มรอบ/audit; browser กลับเข้า business page ได้ |
| BR03 × 3 | PASS | admin DISABLED, SUSPENDED, ARCHIVED คงสถานะและปฏิเสธ business API แม้ driver ต่อ term; เป็น sequential cases ไม่ใช่ concurrent admin-hold test |
| BR04 | PASS | OWNER เรียก admin renew endpoint ไม่ได้; term ไม่เปลี่ยน |
| BR05 / R02 | FAIL | หลังบริษัทถูก disable เพราะ term หมด OWNER เรียก `/v1/plan-term/notice` ได้ 403 `Company is not active.` แทน 200 |
| BR06 / R06 | FAIL | OWNER หลายบริษัทอ่าน notice ด้วย company header ได้ EXPIRED/isOwner=true แต่หน้า `/companies/:id/renew` แสดงข้อความสำหรับผู้ที่ไม่ใช่ OWNER |
| PG00 | PASS | เรียก real manual renew/lifecycle กับ DB จริงแล้ว ACTIVE และ replay ทีละคำขอ renewCount=1; ยืนยันว่า probe rig ทำงาน |
| PG01 / R01 | FAIL | commit term แล้ว activation throw; replay คืนผลโดยไม่ retry activation → บริษัทคง DISABLED |
| PG02 / R05 | FAIL | requestId เดียวเข้าพร้อมกัน โดยทั้งสองอ่านไม่พบ SUCCESS ก่อน transaction → renewCount=2 และ SUCCESS audit=2 แทนอย่างละ 1; **ไม่มี charge เกิดขึ้นใน probe** |
| PG03 / R03 | FAIL | sweep SELECT รายการหมดอายุ → real renewal commit → sweep ใช้แถวเก่าแล้วปิดบริษัท ทั้งที่ termEndsAt อยู่อนาคต |

## Blockers และแนวแก้ก่อน reuse

| ID | Source | แนวทางและ acceptance ที่ต้องปิด |
|---|---|---|
| R01 | [manual renew](../../../apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.ts) | completion ต้องครอบ lifecycle activation ด้วย transaction หรือ durable continuation; retry งานเดิมโดยไม่บวก period ใหม่. PG01 ต้องผ่าน |
| R02 | [permission resolver](../../../apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts), [AuthGuard](../../../apps/api/src/modules/auth/presentation/auth.guard.ts) | auth/OWNER recovery ต้อง resolve บริษัทที่ term system ปิดได้เฉพาะ recovery scope โดย business routes/admin/security holds ยังปิด. เพิ่ม URL exemption อย่างเดียวไม่พอ. BR05 และ permission negatives ต้องผ่าน |
| R03 | [expiry sweep](../../../apps/api/src/modules/system-partner-management/application/use-cases/plan-term-sweep.use-case.ts), [lifecycle](../../../apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case.ts) | fence term deadline/version/status ตลอดช่วงตัดสินและเปลี่ยน lifecycle; read-check แล้วค่อย write แยกยังเกิด race ได้. PG03 + admin-race acceptance ต้องผ่าน |
| R05 | [manual renew](../../../apps/api/src/modules/system-partner-management/application/use-cases/company-plan-term.use-cases.ts) | claim request/paid apply อย่างทนทานใน DB ภายใต้ concurrency ไม่ใช่ read audit ก่อน transaction อย่างเดียว. PG02 และ invoice-level replay ต้องผ่าน |
| R06 | [expired page](../../../apps/web/src/features/plan-term/CompanyTermExpiredPage.tsx), [notice client](../../../apps/web/src/features/plan-term/plan-term.api.ts) | หน้าเรียก `fetchPlanTermNotice()` โดยไม่ส่ง selected company ID ทั้งที่ helper รองรับ จึงตกไปที่บริษัท default ของ user; ส่ง context จาก route และพิสูจน์ multi-company OWNER/employee cases. BR06 ต้องผ่าน |

R04 marketing PRO/trial coupling เป็น gap เดิมที่ยังไม่ได้ทดสอบ/แก้รอบนี้. การพบ blockers ไม่ได้อนุมัติหรือเปลี่ยน business decisions B01–B10.

## คำสั่งรันซ้ำ

จาก root `mangmeeplus` ใช้ local test stack ตาม [harness handoff](../../../e2e/HANDOFF.md). Credentials ด้านล่างเป็นค่า local fixture ตาม `.env.example`; ไม่โหลด remote environment. ไม่เพิ่ม package.json script.

```sh
DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public' \
REDIS_URL='redis://127.0.0.1:6379' \
API_PORT=3021 WEB_PORT=3020 \
E2E_API_BASE_URL='http://127.0.0.1:3021/v1' \
E2E_WEB_BASE_URL='http://127.0.0.1:3020' \
NEXT_DIST_DIR='.next/billing-readiness-3020' MODEL_PROVIDER=disabled \
PLAYWRIGHT_JSON_OUTPUT_FILE='test-results/stripe-readiness-2026-09-11/results.json' \
corepack pnpm exec playwright test e2e/plan-term-billing-readiness.spec.ts \
  --project=chromium --workers=1 --retries=0 --timeout=90000 \
  --output=test-results/stripe-readiness-2026-09-11 --reporter=list,json
```

Final browser run เริ่ม `2026-09-11T02:56:48.966Z`, ใช้ 28.8 วินาทีรวม bring-up; **exit 1, 6 passed / 2 failed / 0 skipped**. [Suite source](https://github.com/MangmeeDev/mangmeeplus/blob/2d52b4b249c18c61da44aab2e79fbdeda58afcd9/e2e/plan-term-billing-readiness.spec.ts). หลัง runner จบตรวจ/คืนเฉพาะ generated `next-env.d.ts` change ตาม harness; อย่าคืนทับงานผู้อื่น.

```sh
DATABASE_URL='postgresql://watchdog:watchdog_local_password@127.0.0.1:15432/watchdog_bms?schema=public' \
node_modules/.bin/tsx --tsconfig apps/api/tsconfig.json --test --test-reporter=spec \
  docs/evidence/stripe-readiness-2026-09-11/recovery.pg.spec.ts
```

Recovery run: **exit 1, 1 passed / 3 failed / 0 skipped**. [Probe source](recovery.pg.spec.ts), [captured output](recovery-output.txt). Assertions ตรวจผลที่ควรเกิดจริง; test ไม่ได้ตั้ง expected failure เพื่อทำให้ผลรวมเป็นสีเขียว.

## Browser evidence

[ก่อนต่ออายุ](before-renew.png): business access ถูกบล็อกและหน้า recovery โหลดแล้ว; ข้อความ OWNER ที่ผิดเป็น R06 ไม่ใช่ UX acceptance PASS.

![Real browser mutation after simulated manual-renew trigger](after-renew-write.png)

หลัง driver ต่ออายุ: UI สร้าง `AFTERPAY` ผ่าน API จริง, DB มีสาขาใหม่และ `EXISTING` อยู่ครบ. สรุปที่เผยใน docs ตัด auth/config ออกจาก Playwright JSON แล้ว; raw traces ที่มี local auth requests อยู่ใน ignored `test-results/` สำหรับ debug ไม่ใช่ artifact ที่นำไปเผยแพร่.

## สิ่งที่ยังไม่พิสูจน์

Stripe Checkout / raw signature / invoice-company-Price binding / paid-tier entitlement application / Stripe service periods / 3DS / renewal Test Clocks / actual retry-grace / refund-dispute / LINE / mobile / marketing browser / UAT / LIVE ยัง **NOT RUN**. No real payment, external notification, cloud operation, deploy, commit or push.

หลังแก้ blockers ต้องให้สองชุดนี้ผ่านก่อน แล้วแทน payment driver ด้วย integration จริงและรัน [T01–T42](../../plans/mangmee-stripe-billing-implementation-and-test-plan-th.md) ที่เกี่ยวข้อง. ห้ามยกระดับผล manual-renew simulation นี้เป็น Stripe E2E PASS.
