# Agent Memory: goods-receipt void เป็น true reversal

Status: MERGED เข้า `develop` แล้ว 2026-07-28 (PR #48, merge `121d67eb`; commits `b44b22f8` + `1f8295da` + `b6352550`) — ยังไม่ deploy, ยังไม่ live-verify, ยังไม่ heal ข้อมูลเก่า
Scope: `apps/api/src/modules/procurement/**` (goods-receipt.use-case.ts, prisma-procurement.repository.ts) + spec ใหม่ + package.json test list
Reference pattern: `docs/agent-memory/h-04-vendor-bill-void-true-reversal.md`, `ReverseJournalUseCase` (ledger), `voidExpenseTrueReversal` (expenses)
Spec/plan: `docs/specs/procurement-supplier-ap-spec.md` §10 (บรรทัด 861) + §Routes (1045), `docs/plans/procurement-supplier-ap-plan.md` Phase 5 "Implement receipt void policy"

## Bug ที่แก้

`PostGoodsReceiptUseCase` สร้าง `STOCK_IN` movement ต่อ STOCK line และบวก `purchaseOrderLine.receivedQuantity` แต่ `VoidGoodsReceiptUseCase` เรียกแค่ `repo.voidGoodsReceipt` = `goodsReceipt.update` ตั้ง `status='VOIDED'` เฉยๆ ⇒ หลัง post แล้ว void:

- on-hand stock ยังค้างเพิ่ม (ไม่มี movement ย้อน)
- PO line ยังนับว่ารับของแล้ว ⇒ รับซ้ำจำนวนเดิมไม่ได้ (PO ค้างสถานะรับครบทั้งที่ receipt ถูกยกเลิก)

เพิ่ม dead guard loop ใน use case (วน `gr.lines`, `continue` ถ้าไม่ใช่ STOCK แล้วเหลือแต่ comment) ที่ไม่บังคับอะไรเลย และ audit log ซ้ำสองครั้งต่อการ void หนึ่งครั้ง

## Decisions

- **Inline reversal ใน repo tx** (ตามแนว `voidVendorBillTrueReversal`): `voidGoodsReceiptTrueReversal` รันใน `$transaction(..., { isolationLevel: 'Serializable' })` — CAS claim `updateMany({ where: { id, companyId, status: 'POSTED' } })` count!==1 ⇒ Conflict `goods_receipt_changed`; reversing movement + PO rollback + status commit/rollback ด้วยกัน
- **`stockMovement` table เป็น source of truth ไม่ใช่ `line.inventoryMovementId`** (บทเรียนเดียวกับ journal table ใน vendor bill): query movement ของ `referenceType='goods_receipt', referenceId=grId` แล้วย้อนทุกแถว direction `IN` ⇒ post ที่สร้าง movement สำเร็จแต่เขียน pointer ไม่ทันก็ยังถูกย้อนครบ และย้อนตามจำนวนที่ลงจริง
- **movement ที่มี `reversesMovementId` = already-reversed marker** (คู่กับ REVERSAL journal row) ⇒ ไม่สร้างซ้ำ, void ที่ retry ได้ idempotent
- **Negative-stock guard จริงแทน dead loop**: `assertReversibleStock` ใช้ `pg_advisory_xact_lock(hashtext($1))` บน key เดียวกับ inventory (`companyId:productId:locationId`) แล้วรวม IN−OUT จาก movement — ต้องใช้ key format เดิมเป๊ะ ไม่งั้น lock ไม่ชนกับ `PrismaMovementRepository.assertCanCreateOutbound` ⇒ ถ้าย้อนแล้วติดลบ throw Conflict code `inventory_reversal_unavailable` ตรงตาม spec §10 (fail closed ทั้ง void)
- **สร้าง movement ทีละแถวใน tx เดียว** ⇒ read-your-writes ทำให้ line ที่ 2 บนสินค้า/location เดียวกันเห็นยอดที่ line แรกย้อนไปแล้ว (มี unit test คุม)
- **PO rollback ลบทุก line ไม่เฉพาะ STOCK** เพราะ post บวก `acceptedQuantity` ให้ทุก line (service/non-stock ด้วย); clamp `Decimal.max(0, ...)` แล้ว `toFixed(4)` ตาม column `Decimal(18,4)` — ไม่ใช้ `updatePurchaseOrderLineReceived` (float `Number()` + อยู่นอก tx)
- **ไม่จอง movementNumber ให้ reversal** (`ponytail:` comment): inventory ถือว่า optional อยู่แล้ว (`CreateMovementUseCase` ปล่อย null เมื่อไม่มี sequence) และ report/web fallback เป็น id — จองเมื่อ reversal ต้องมีเลขเอกสารของตัวเอง
- **Permission**: `procurement.goods_receipt.void` เป็น authority เดียวของการเขียน inventory ตรงนี้ (แนวเดียวกับ vendor-bill void ที่เขียน ledger journal ใต้ permission ของบิล) — ถ้าไปเรียก `CreateMovementUseCase` แทน ผู้ใช้ที่ void ได้แต่ไม่มี `inventory.movement.create` จะโดน 403 และเสีย atomicity
- **ลบ `voidGoodsReceipt` เดิมทิ้ง** ไม่เก็บไว้เป็น bypass path
- ลบ audit log ที่ซ้ำ; เก็บ `reversalMovements` ลง `metadataJson`; emit outbox `goods_receipt.voided` (spec event list) คู่กับ `goods_receipt.posted`
- **`StockMovement.reversesMovementId` เป็น `@unique`** (migration `20260728120000_stock_movement_single_reversal` มี preflight RAISE ตาม convention ของ repo): marker ระดับ query อย่างเดียวไม่พอ — ฝั่ง vendor-bill มี `@@unique([companyId, sourceType, sourceId, entryType])` คุมที่ DB อยู่แล้ว อันนี้คือคู่ของมัน ปิดเคสที่ path อื่นในอนาคตมา reverse movement เดียวกันโดยไม่ผ่าน filter `referenceId` ของเรา (วันนี้ยัง trigger ไม่ได้เพราะ CAS claim อยู่ต้น txn เดียวกัน)
- **หมายเหตุเรื่อง permission ที่แก้ให้ตรง**: `pack.procurement.ap_manage` ให้ `goods_receipt.post` + `.void` แต่ไม่ให้ `inventory.movement.create` ⇒ ถ้าเรียกผ่าน inventory port จะโดน 403 จริง แต่ path post ก็เจอเงื่อนไขเดียวกันอยู่แล้ว เหตุผลหลักที่เขียน movement ใน txn นี้คือ atomicity ไม่ใช่ permission

## Artifacts

- `prisma-procurement.repository.ts` — `voidGoodsReceiptTrueReversal`, `assertReversibleStock` (แทน `voidGoodsReceipt`)
- `goods-receipt.use-case.ts` — `VoidGoodsReceiptUseCase` เรียก path ใหม่, ลบ dead guard loop + audit ซ้ำ
- `goods-receipt-void-reversal.repository.spec.ts` (7 tests) — ลงทะเบียนใน `apps/api/package.json` test list แล้ว (runner เป็น explicit file list ถ้าไม่ลงทะเบียนจะไม่ถูกรันเงียบๆ)

## Verification

- `npx tsx --test .../goods-receipt-void-reversal.repository.spec.ts` 7/7 + procurement/inventory specs 121/121
- `npm test` (apps/api) **2173/2173 ผ่าน 0 fail** และ `npx tsc --noEmit` **0 error** (ตอน rebase บน develop: 2177/2177 + `npm run test:boot` Nest resolve provider ครบ — guard ตัวนี้คือตัวเดียวที่จับ DI ของ `OutboxAppendService` ที่ inject เพิ่ม เพราะ spec ทั้ง suite `new` เอง ไม่เคยให้ Nest wire)
- **หลัง merge เข้า develop (`7efb398a`)**: `npm test` **2713/2713 ผ่าน**, `tsc` 0 error, `prisma validate` ok, boot-di-smoke ผ่าน — ตัวเลขขึ้นจาก 2177 เพราะมี session อื่น merge เข้ามาระหว่างนั้น; ตรวจบรรทัด `test` script หลัง merge แล้ว spec 260 ไฟล์ ไม่ซ้ำ ของทุก session อยู่ครบ (conflict ตรงนี้ถ้า resolve พลาดจะเงียบ)
### Live verification บน UAT (2026-07-29)

Deploy `8d146a42` เข้า UAT ผ่าน `deploy-uat.yml` (target api-web) — release task รัน migration รวม `20260728120000_stock_movement_single_reversal` สำเร็จ (preflight ไม่ abort ⇒ UAT ไม่มี movement ที่ถูก reverse ซ้ำ), image ที่รันอยู่ยืนยันแล้วเป็น `git-8d146a4286dd...`

ยิงผ่าน public API จริง (`https://uat.mangmeeplus.com/v1`) บน tenant ทดสอบ `ZZ Verify GR Void 2026-07-29` (companyId `cms4z499q000v1u5wjvoa6hzh`):

| ขั้น | ผลลัพธ์ |
| --- | --- |
| post GR `ZZGR-00001` | stock 0→**10**, PO line received 0→**10**, movement `ZZMV-00001` STOCK_IN 10 |
| void GR (201 VOIDED) | stock 10→**0**, PO line received 10→**0**, `postingStatus=reversed` |
| reversal movement | STOCK_OUT 10, `reversesMovementId` ชี้กลับ STOCK_IN เดิม, reason `[VOID ZZGR-00001] live verify reversal`, `movementNumber` = null ตามที่ออกแบบไว้ |
| void ตอนของออกไปหมด (balance 0) | **409 `inventory_reversal_unavailable`** — "stock on hand ... is 0.0000, reversal needs 10.0000" |
| สถานะหลังถูกบล็อก | GR ยัง `POSTED`/`posted`, PO line ยัง 10, balance ยัง 0 — **ไม่มี partial reversal** (txn rollback ครบ) |

- **ต้อง link node_modules + generated prisma เข้า worktree ก่อนวัดผล** (ทั้งคู่ gitignored): ไม่ link แล้ว suite จะได้ 2130/3 fail และ tsc พ่น ~890 error ซึ่งเป็น artifact ของ module resolution ล้วนๆ ไม่ใช่ regression — การกรอง error เฉพาะบรรทัดที่แก้ไม่ใช่การ verify จริง (คำสั่ง link/unlink อยู่ใน user memory `project_worktree_test_baseline`) ลบ link ทิ้งเมื่อเสร็จ เพราะ `pnpm install` ใน worktree จะเขียนทะลุไป main checkout ที่ session อื่นใช้อยู่

## Next

- **Heal ข้อมูลเก่า**: script + ผลสำรวจอยู่ใน [[goods-receipt-void-data-heal]] — local + 8 DB ข้างเคียง 0 rows, UAT/prod ยังไม่ได้ query (ต้องขออนุมัติ)
- **Deploy gate**: branch นี้มี migration `20260728120000_stock_movement_single_reversal` — preflight จะ abort ถ้า environment ไหนมี movement ที่ถูก reverse ซ้ำ (ตั้งใจให้ดัง) เช็ค `migrate status` ที่ UAT/prod ก่อน deploy
- **Live verify UAT ผ่านแล้ว** (ดู section ด้านบน) — เหลือ prod: ยังไม่ deploy
- **ล้าง tenant ทดสอบใน UAT เมื่อไม่ใช้แล้ว**: `ZZ Verify GR Void 2026-07-29` (company `cms4z499q000v1u5wjvoa6hzh`, owner `zz.grvoid.verify`) พร้อม product/location/supplier/PO/GR 3 ใบ + document sequence `ZZPO-/ZZGR-/ZZMV-` ตั้งชื่อขึ้นต้น ZZ ให้กรองออกง่าย
- **`uat-environment.md` ล้าสมัย**: เขียนว่า workflow ยิงจาก `main` แต่ `main` ตามหลัง develop 160 commits (ci.yml ยัง build `infra/prod-app-runner/` ที่ถอดไปแล้ว + ไม่มี NODE_OPTIONS heap) ⇒ ต้องยิงจาก `develop`
- คนละบั๊ก แก้แล้วอีก branch (`claude/clever-feistel-bb12f8`, commit `db01cde1`, ยังไม่ merge): multi-line GR post ที่มี product+location+type ซ้ำกัน จอง movement number ซ้ำ ⇒ ชน `@@unique([companyId, movementNumber])` post ไม่ผ่านทั้งใบ — เขาแก้ด้วยการจองต่อ line (`gr:${id}:${lineId}`) + ย้าย movement เข้า txn ของใบรับ (ทรงเดียวกับ void); รีวิวส่งไปแล้วว่า reservation ไม่มี cancel path ตอน txn fail (bounded เพราะ key deterministic, ช่องเดียวกับ `post:${id}` ที่มีอยู่เดิม)
