# Product Requirements: สินค้าและบริการสำหรับ CRM (Products & Services Catalog V2)

## 1. สถานะเอกสาร

- สถานะ: Proposed for Product / UX / Architecture review
- วันที่จัดทำ: 2026-07-13
- หน้าที่อ้างอิง: `/companies/:companyId/settings/crm-catalog`
- ขอบเขต: หน้ารายการ, เพิ่ม, แก้ไข, เผยแพร่, เก็บถาวร, Import/Export, สิทธิ์, Audit และการเชื่อมต่อ CRM AI / Booking / Sales Documents
- เอกสารฐานที่มีอยู่: [CRM Product and Service Catalog Spec](./crm-product-service-catalog-spec.md)
- หลักการ: เอกสารนี้เป็น Requirement สำหรับการยกระดับ UX และขยาย Catalog ระยะถัดไป ไม่ได้หมายความว่าความสามารถทุกข้อถูกพัฒนาแล้ว

## 2. Executive decision

หน้า **สินค้าและบริการ** ต้องเป็นแหล่งข้อมูลกลางระดับบริษัทสำหรับสิ่งที่ธุรกิจขาย ไม่ใช่เพียงตารางตั้งค่า โดยข้อมูลชุดเดียวกันต้องถูกใช้สอดคล้องกันใน:

- พนักงานค้นหาและเลือกสินค้า/บริการ
- CRM AI ตอบคำถามลูกค้าโดยไม่แต่งข้อมูลเอง
- การจองใช้ชื่อและระยะเวลามาตรฐานที่ถูกต้อง
- Deal / Quotation / Invoice เลือกรายการจาก Catalog และเก็บ Snapshot ณ เวลาทำรายการ
- รายงานวัดยอดขาย ความสนใจ และคุณภาพข้อมูลของแต่ละสินค้า/บริการได้

การออกแบบต้องเริ่มแบบง่ายสำหรับ SME แต่ไม่ปิดทางการเติบโตไปสู่หลายราคา หลายสาขา Variant, Package และ Recurring Service ในอนาคต

## 3. เป้าหมายผลิตภัณฑ์

### 3.1 เป้าหมายหลัก

1. Owner/Admin เพิ่มหรือแก้สินค้า/บริการทั่วไปได้ภายใน 1 นาทีโดยไม่ต้องเข้าใจศัพท์ระบบ
2. พนักงานค้นหารายการที่ต้องการได้ภายใน 10 วินาที แม้ Catalog มีหลายพันรายการ
3. ลูกค้าได้รับชื่อ รายละเอียด ราคา และระยะเวลาที่ตรงกัน ไม่ว่าจะถามพนักงานหรือ CRM AI
4. รายการที่ไม่พร้อมขายหรือเป็นข้อมูลภายในต้องไม่รั่วไปถึงลูกค้าหรือ AI
5. การเปลี่ยนข้อมูล Master ภายหลังต้องไม่แก้ประวัติ Booking, Deal, Quotation หรือ Invoice เก่า
6. ระบบรองรับ Catalog ระดับบริษัทในปัจจุบัน และขยายเป็นรายสาขา/Price Book ได้โดยไม่สร้าง Catalog ซ้ำ

### 3.2 Outcome metrics หลังเปิดใช้

| Metric | Target เริ่มต้น |
|---|---:|
| รายการที่เผยแพร่และผ่าน Customer-ready validation | >= 95% |
| Booking ที่เลือกบริการจาก Catalog | >= 90% |
| CRM AI ใช้รายการ Archived/Internal ตอบลูกค้า | 0 ครั้ง |
| เอกสารเก่าที่ราคา/คำอธิบายเปลี่ยนตาม Master | 0 รายการ |
| เวลา Median ในการเพิ่มรายการพื้นฐาน | <= 60 วินาที |
| เวลา Median ในการค้นหาและเปิดรายการ | <= 10 วินาที |
| Search ที่ไม่พบผลลัพธ์ | เก็บเป็น Insight เพื่อตรวจคำค้น/รายการที่ขาด |

ตัวเลขเป้าหมายต้องปรับหลังมี Baseline จริง 30 วันแรก

## 4. Current-state assessment จากระบบปัจจุบัน

### 4.1 สิ่งที่มีแล้วและควรรักษา

- ใช้ `Product` ชุดเดียวกับ Inventory; `kind = SERVICE` หมายถึงบริการ ไม่สร้าง CRM Product ซ้ำอีกชุด
- Catalog เป็นข้อมูลระดับ Company และใช้ร่วมทุกสาขา
- ประเภทปัจจุบัน: `STOCKABLE`, `NON_STOCK`, `SERVICE`
- ฟิลด์ปัจจุบัน: SKU, ชื่อ, รายละเอียด, หมวดหมู่, หน่วย, ประเภท, จุดสั่งซื้อ, ราคาขาย, ระยะเวลาบริการ, ลูกค้าเห็น และสถานะ
- สถานะปัจจุบัน: `ACTIVE`, `ARCHIVED`; การเผยแพร่ลูกค้าใช้ `customerVisible`
- `customerVisible` มีค่าเริ่มต้นเป็น `false`
- เฉพาะรายการ `ACTIVE + customerVisible` เท่านั้นที่ส่งไป CRM AI; Booking เลือกเฉพาะ `SERVICE` ที่เข้าเงื่อนไขเดียวกัน
- ใช้สิทธิ์ `inventory.product.read` และ `inventory.product.manage`; เปิด Catalog ได้เมื่อบริษัทมี Feature CRM หรือ Inventory
- Create / Update / Archive มี Audit และ Outbox event แล้ว
- Booking เก็บ `serviceName` เป็น Snapshot จึงไม่ควรถูกเปลี่ยนย้อนหลังเมื่อแก้ชื่อใน Catalog
- Accounting document line รองรับ Snapshot ของ Product ID, SKU, Description, Unit, Price, Discount และภาษี

### 4.2 Gap ที่ต้องแก้ก่อนถือว่า Production-ready

| Gap | ผลกระทบ | Priority |
|---|---|---|
| หน้ารายการขอข้อมูล 50 รายการแต่ไม่มี Pagination/Total | รายการลำดับถัดไปหายจากหน้าจอโดยผู้ใช้ไม่รู้ | P0 |
| Toolbar แบบ Flex ทำให้ช่องค้นหายุบเป็นแถบแคบตามภาพ | ใช้งานจริงบน Desktop/Responsive ยาก | P0 |
| UI เป็น Inventory legacy reuse และยังไม่ใช้ Mangmee page/card/table pattern เต็มรูปแบบ | ภาพรวมไม่สอดคล้องระบบ | P0 |
| ภาษาไทย/อังกฤษถูก Hardcode คู่กัน และประเภทแสดง Raw enum | ปุ่ม EN ไม่เปลี่ยนทั้งหน้าและอ่านยาก | P0 |
| ไม่มีตัวกรอง “เผยแพร่ให้ลูกค้า/AI” ทั้งที่ API รองรับ | ผู้ดูแลตรวจข้อมูลที่เปิดเผยอยู่ได้ยาก | P0 |
| ไม่มี Archive/Restore, Duplicate, Bulk action ในหน้า Catalog | ดูแล Catalog จำนวนมากช้าและเสี่ยง | P0/P1 |
| ไม่มี Label, Cancel, Unsaved guard, Saving state และ Confirmation | Accessibility ต่ำและเสี่ยงบันทึกซ้ำ/เสียข้อมูล | P0 |
| ฟิลด์จุดสั่งซื้อยังแสดงกับ Service | ผู้ใช้ไม่เข้าใจว่าต้องกรอกหรือไม่ | P0 |
| “ไม่กำหนดระยะเวลาจอง” ไม่บอกว่า Runtime fallback เป็น 60 นาที | เวลา Booking อาจไม่ตรงความคาดหวัง | P0 |
| ใช้ Description เดียวทั้งภายในและ CRM AI | เสี่ยงส่งข้อความภายในให้ลูกค้า | P0/P1 |
| แสดงราคาเป็น “บาท” แบบ Hardcode | ไม่พร้อมรองรับ Currency ของบริษัท | P1 |
| Publication เป็น Checkbox เดียว ไม่มี Preview/Readiness check | เผยแพร่ข้อมูลไม่ครบหรือผิดได้ง่าย | P0 |
| ERP Core โหลด Published Catalog ได้ 100 รายการ แต่ AI Gateway ใช้สูงสุด 50 รายการแรก | พนักงาน/Booking อาจเห็นบริการที่ AI หาไม่เจอ | P0 |
| Booking เก็บชื่อบริการแต่ยังไม่มี `catalogProductId` | วิเคราะห์การใช้งานต่อสินค้าไม่ได้แม่นเมื่อมีการเปลี่ยนชื่อ | P1 |
| Accounting line รองรับ Snapshot แต่ Product ID ยังเชื่อมแบบหลวมและ Flow สร้าง/แก้ Line ยังไม่ครบ | ยังไม่ควรอ้างว่าเลือก Catalog แล้วออก Quotation ได้ครบวงจร | P1 |
| ไม่มี Import/Export, Category/Unit master, Image, Tax default, Alias | ดูแลข้อมูลจำนวนมากและตอบลูกค้าไม่ครอบคลุม | P1 |
| ไม่มี Price version/Price book/Branch availability | ไม่รองรับราคาต่างกลุ่มหรือต่างสาขา | P2 |

## 5. Product principles

1. **One source of truth** — CRM และ Inventory ใช้ Product เดียวกัน แต่แสดงฟิลด์ตาม Context และ Permission
2. **Customer-safe by default** — รายการใหม่ยังไม่เผยแพร่ และข้อมูลภายในไม่ถูกส่งให้ AI
3. **Simple first, advanced on demand** — ฟอร์มพื้นฐานสั้น; ฟิลด์ขั้นสูงใช้ Progressive disclosure
4. **History is immutable** — Master เปลี่ยนได้ แต่ Booking/Line item ที่เกิดแล้วเก็บ Snapshot เดิม
5. **Archive, do not hard delete** — รายการที่เคยถูกใช้ต้องเก็บเพื่อ Audit และรายงาน
6. **No false availability** — การมีสินค้าใน Catalog ไม่ได้แปลว่ามี Stock หรือ Slot ว่าง
7. **Company scope must be explicit** — ก่อนมี Branch-specific model ต้องแสดงว่า “ใช้ร่วมทุกสาขา” และไม่ให้ Branch switcher สื่อผิด
8. **Thai-first, locale-correct** — หน้าจอใช้ภาษาตาม Locale ไม่แสดงไทย/อังกฤษซ้ำทุก Label
9. **Permission follows impact** — การแก้ Master, ราคา, Publication, Archive, Import และ Export ต้องแยกความเสี่ยงได้
10. **AI uses bounded, verified data** — ERP Core เลือกข้อมูล Customer-safe ก่อนส่งให้ AI Gateway และตรวจ ID ซ้ำก่อน Mutation

## 6. ผู้ใช้งานและงานที่ต้องทำ

| Persona | งานหลัก | สิ่งที่ต้องเห็น/ทำได้ |
|---|---|---|
| Owner / Admin | ตั้งค่า Catalog ทั้งบริษัท | ดู/เพิ่ม/แก้/เผยแพร่/เก็บถาวร/นำเข้า/ส่งออก/ประวัติ |
| Manager | ควบคุมความพร้อมขาย | ดูและแก้ตามสิทธิ์, ตรวจข้อมูลไม่ครบ, อนุมัติ Publication ใน Phase ที่มี Approval |
| Sales / CRM Staff | เลือกสิ่งที่ขายและตอบลูกค้า | ค้นหา/ดูรายการ Customer-ready; ไม่เห็นต้นทุนหรือข้อมูลภายในที่ไม่จำเป็น |
| Booking Staff | เลือกบริการและระยะเวลา | เห็นเฉพาะบริการที่ Active, Published และ Bookable |
| Inventory Staff | ดูแล Stockable product | แก้ข้อมูล Inventory ตามสิทธิ์ โดยไม่เปลี่ยนข้อความลูกค้าหรือราคาโดยไม่ตั้งใจ |
| Finance / Accountant | ใช้ข้อมูลในเอกสาร | อ่าน Tax/Price defaults และตรวจ Snapshot; ไม่จำเป็นต้องแก้ Customer content |
| Auditor Read-only | ตรวจย้อนหลัง | อ่านรายการ, สถานะ, Revision/Audit และรายการอ้างอิงโดยไม่มี Mutation action |
| End customer | รับข้อมูลผ่านพนักงาน/LINE | ได้ข้อมูลที่เผยแพร่ ถูกต้อง ชัดเจน และไม่เห็น Internal data |

## 7. Information architecture

```text
ตั้งค่า CRM
└── สินค้าและบริการ
    ├── รายการทั้งหมด
    │   ├── เผยแพร่ให้ลูกค้า
    │   ├── ใช้ภายใน
    │   ├── ต้องตรวจสอบข้อมูล
    │   └── เก็บถาวร
    ├── เพิ่มสินค้า/บริการ
    ├── Import / Export
    └── รายละเอียดรายการ
        ├── ข้อมูลพื้นฐาน
        ├── ข้อมูลสำหรับลูกค้าและ AI
        ├── ราคาและภาษี
        ├── การจองหรือสต็อกตามประเภท
        ├── การใช้งาน/รายการอ้างอิง
        └── ประวัติการเปลี่ยนแปลง
```

ใน P0 สามารถคง Route ปัจจุบันและใช้หน้า List/Create/Detail เดิมได้ แต่ควรแยก Component สำหรับ CRM Catalog ออกจาก `InventoryPages.tsx` เพื่อให้ UX เฉพาะ CRM ชัดเจนโดยยังใช้ API/Model ร่วมกัน

## 8. Screen requirement: หน้ารายการ

### 8.1 Page header

- Title ตาม Locale: `สินค้าและบริการ` หรือ `Products & Services`
- Helper text: “ข้อมูลกลางที่พนักงาน CRM AI การจอง และเอกสารขายใช้ร่วมกัน”
- Scope chip: `ใช้ร่วมทุกสาขา` จนกว่าจะมี Branch-specific availability/pricing จริง
- Primary CTA: `เพิ่มสินค้า / บริการ`
- Secondary actions: `นำเข้า`, `ส่งออก`; บนจอเล็กอยู่ในเมนู `เพิ่มเติม`
- ผู้ใช้ Read-only ต้องไม่เห็น CTA ที่ทำไม่ได้ และแสดงข้อความ `คุณมีสิทธิ์ดูอย่างเดียว`

### 8.2 Summary / readiness strip

แสดงตัวเลขแบบ Compact และกดกรองได้:

- ทั้งหมดที่ Active
- เผยแพร่ให้ลูกค้าและ AI
- บริการที่จองได้
- ต้องตรวจสอบข้อมูล
- เก็บถาวร

ไม่ควรใช้ Dashboard card ขนาดใหญ่ เพราะหน้าที่หลักยังเป็นการค้นหาและจัดการรายการ

### 8.3 Search and filters

| Control | Requirement |
|---|---|
| Search | ค้นหา SKU, ชื่อ, Barcode และ Alias; Debounce 300–500 ms; Enter ใช้ได้; มีปุ่มล้าง |
| ประเภท | ทั้งหมด, สินค้าในสต็อก, สินค้าไม่ตัดสต็อก, บริการ |
| การเผยแพร่ | ทั้งหมด, เผยแพร่, ใช้ภายใน, ต้องตรวจข้อมูล |
| สถานะ | ใช้งาน, เก็บถาวร, ทั้งหมด |
| หมวดหมู่ | Multi-select เมื่อมี Category master; P0 ใช้ค่าที่มีอยู่ |
| สาขา | ยังไม่แสดงเป็น Filter จนมี Branch mapping จริง; แสดง Scope chip แทน |
| Clear | `ล้างตัวกรองทั้งหมด` และแสดง Active filter chips |

กฎ UX:

- ใช้ Responsive CSS grid ไม่ใช้ Flex ที่ทำให้ Search ถูกบีบ
- Query, Sort, Page และ Filter ต้องอยู่ใน URL เพื่อรองรับ Back/Forward, Refresh และแชร์ Link
- เปลี่ยน Filter แล้วกลับ Page 1
- ค่าเริ่มต้นคือ Active ทั้งหมด เรียง `updatedAt desc`

### 8.4 Table / card list

Desktop columns:

1. ชื่อ + Thumbnail + SKU
2. ประเภท + หมวดหมู่
3. ราคามาตรฐาน / หน่วย
4. ระยะเวลา (เฉพาะ Service)
5. ลูกค้าและ AI เห็นหรือไม่
6. ความพร้อมใช้งาน
7. อัปเดตล่าสุด
8. เมนู Action

กฎการแสดงผล:

- ใช้ชื่อประเภทที่แปลแล้ว ห้ามแสดง `STOCKABLE`, `NON_STOCK`, `SERVICE` ตรง ๆ
- ราคาใช้ Currency ของบริษัทและ Locale formatter; ไม่ Hardcode คำว่า `บาท`
- แยก Badge อย่างชัดเจน:
  - `เผยแพร่` = Active + Customer visible
  - `ใช้ภายใน` = Active + Not customer visible
  - `เก็บถาวร` = Archived
  - `ข้อมูลไม่ครบ` = Readiness validation ไม่ผ่าน
- Service แสดง `90 นาที`; Product ไม่แสดงช่องระยะเวลา
- Row click เปิด Detail; Action menu ต้องกดแยกได้และรองรับ Keyboard
- Mobile ใช้ Card list หรือ Table ที่ Horizontal scroll ภายใน Card โดยไม่ดันทั้งหน้า

### 8.5 Sorting and pagination

- Sort อย่างน้อย: ชื่อ, SKU, ราคา, สถานะ, อัปเดตล่าสุด
- Server-side pagination: 25, 50, 100 รายการต่อหน้า
- แสดง `รายการ 51–100 จาก 2,486 รายการ`
- ระหว่างเปลี่ยน Page แสดง Skeleton แต่รักษาความสูงเพื่อลด Layout shift
- ห้ามเงียบหรือซ่อนผลลัพธ์ที่เกิน 50 รายการ

### 8.6 Row and bulk actions

Row actions ตามสิทธิ์:

- ดูรายละเอียด
- แก้ไข
- ทำสำเนา
- เผยแพร่ / ยกเลิกเผยแพร่
- เก็บถาวร
- คืนค่าจาก Archive
- ดูประวัติ

Bulk actions ระยะ P1:

- เผยแพร่
- ยกเลิกเผยแพร่
- เปลี่ยนหมวดหมู่
- เก็บถาวร
- ส่งออกเฉพาะรายการที่เลือก

ทุก Bulk mutation ต้องแสดงจำนวนรายการ ผลกระทบ และสรุป Success/Failed รายแถว ห้ามใช้ All-or-nothing เมื่อบางรายการไม่ผ่าน validation

### 8.7 Shared states

| State | ข้อความ/Action |
|---|---|
| First-use empty | “ยังไม่มีสินค้าและบริการ” + `เพิ่มรายการแรก` + `นำเข้าจากไฟล์` |
| Filter no-result | “ไม่พบรายการตามคำค้นหรือตัวกรอง” + `ล้างตัวกรอง` |
| Loading | Skeleton ของ Toolbar และ 5–8 Rows |
| Error | ข้อความธุรกิจ + Request ID แบบย่อ + `ลองใหม่` |
| Forbidden | หน้า 403 มาตรฐาน ไม่รอให้ Table API ล้มเงียบ ๆ |
| Read-only | Banner/Caption ชัดเจนและไม่มี Mutation action |
| Large catalog / AI capacity issue | Warning ที่บอกว่ารายการใดอาจยังไม่ถูกใช้โดย AI พร้อมทางแก้; P0 ต้องไม่ปล่อยให้เกิดความไม่เท่าเทียมแบบเงียบ |

## 9. Screen requirement: เพิ่มและแก้ไขรายการ

### 9.1 Form pattern

- ใช้ Full-page form หรือ Drawer ขนาดใหญ่ ไม่ใช้ Modal เล็กสำหรับข้อมูลหลาย Section
- มี Field label, Helper text, Required marker และ Inline error; Placeholder ไม่ใช่ Label
- Sticky action bar: `ยกเลิก`, `บันทึกแบบไม่เผยแพร่`, `บันทึกและเผยแพร่`
- แสดง Saving state และป้องกัน Double submit
- มี Unsaved-change guard เมื่อออกจากหน้า
- Error จาก API เช่น `sale_price_invalid` ต้องแปลเป็นข้อความที่แก้ไขได้
- เมื่อ Save ล้มเหลวต้องเก็บค่าที่กรอกไว้ทั้งหมด

### 9.2 Form sections

#### A. ข้อมูลพื้นฐาน

- ประเภท: สินค้าในสต็อก / สินค้าไม่ตัดสต็อก / บริการ
- SKU: Unique ภายในบริษัท; Trim และ Uppercase ตามกฎปัจจุบัน
- ชื่อหลัก
- หมวดหมู่
- หน่วยขาย
- รูปภาพหลัก (P1)

ประเภทต้องถูกเลือกก่อนเพื่อแสดงฟิลด์ที่เกี่ยวข้องเท่านั้น

#### B. ข้อมูลสำหรับลูกค้าและ CRM AI

- ชื่อที่แสดงกับลูกค้า (P1; P0 fallback จากชื่อหลัก)
- รายละเอียดสาธารณะ / Customer-safe description
- คำเรียกอื่นหรือ Alias ไทย/อังกฤษ (P1)
- จุดเด่น / สิ่งที่รวม / สิ่งที่ไม่รวม / เงื่อนไขสำคัญ (P1)
- FAQ เฉพาะรายการ (P2)
- Preview ว่า Customer/AI จะเห็นข้อมูลใด

Internal note ต้องเป็นคนละฟิลด์และห้ามเข้าชุดข้อมูลที่ส่งให้ AI

#### C. ราคาและภาษี

- ราคามาตรฐาน
- Currency ของบริษัท; P0 เป็นค่าระดับบริษัทและ Read-only
- Price display mode (P1): `แสดงราคาชัดเจน`, `เริ่มต้นที่`, `ติดต่อสอบถาม`
- Tax category / VAT default (P1)
- Tax behavior (P1): ราคารวมภาษี / ยังไม่รวมภาษี / ไม่อยู่ในขอบเขต
- Discount/override policy เป็น Link ไปหน้าตั้งค่านโยบาย ไม่ทำซ้ำใน Product form

ราคานี้เป็นค่าเริ่มต้นสำหรับรายการใหม่ ไม่ใช่คำสั่งให้แก้ราคาในเอกสารเดิม

#### D. ตั้งค่าตามประเภท

Service:

- ระยะเวลามาตรฐาน
- P0 รองรับ 60–180 นาที เพิ่มทีละ 30 นาทีตาม Backend ปัจจุบัน
- หากไม่กำหนด ต้องแสดงชัดว่า Runtime ใช้ค่า Default 60 นาที หรือบังคับเลือกก่อน Publish เพื่อไม่ให้เกิดความกำกวม
- `Bookable` แยกจาก `Customer visible` ใน P1 เพื่อรองรับบริการที่ลูกค้าเห็นแต่ยังไม่เปิดจองออนไลน์
- Branch/Staff/Buffer/Capacity เป็น Link ไป Booking settings ใน Phase ที่รองรับ ไม่ควรซ้ำ Master data

Stockable product:

- จุดสั่งซื้อและข้อมูล Stock แสดงเฉพาะผู้มีสิทธิ์ Inventory
- Customer-visible ไม่ได้แปลว่ามีของ; Preview ต้องไม่แสดง Stock claim หากไม่ได้อ่าน Inventory แบบ Real-time

Non-stock product:

- ซ่อน Reorder point และ Stock controls

#### E. การเผยแพร่

- เปลี่ยนข้อความจาก `ลูกค้าเห็น` เป็น `เผยแพร่ให้ลูกค้าและ CRM AI`
- อธิบายผลแบบ Dynamic:
  - Product: AI ใช้ตอบคำถาม แต่ไม่แสดงใน Booking selector
  - Service: AI ใช้ตอบคำถาม และแสดงใน Booking เมื่อ Bookable
- แสดง Customer-ready checklist ก่อน Publish
- Duplicate item ต้องเริ่มแบบ Unpublished เสมอ
- Restore จาก Archive ต้องกลับเป็น Active + Unpublished เพื่อให้ผู้ดูแลตรวจอีกครั้งก่อนเผยแพร่

#### F. การใช้งานและประวัติ

- แสดงจำนวน Booking, Deal/Quotation/Invoice line และวันที่ใช้ล่าสุดเมื่อมี Read model รองรับ
- แสดง Created by/at, Updated by/at, Published by/at, Archived by/at
- Audit timeline แสดง Field สำคัญแบบ Before/After โดย Mask ข้อมูลที่ผู้ใช้ไม่มีสิทธิ์

### 9.3 Readiness validation ก่อน Publish

Must pass:

- SKU, ประเภท, ชื่อ และหน่วยมีค่า
- Customer-facing name และ description ไม่ว่าง
- Service มีระยะเวลาที่ถูกต้อง หรือ Policy ระบุ Default อย่างชัดเจน
- Price display mode ถูกเลือก; ถ้าเป็น Exact/Starting at ต้องมีราคาที่ไม่ติดลบ
- ไม่มี Duplicate SKU ในบริษัท
- สถานะเป็น Active
- ข้อมูลไม่มี Internal-only marker หรือข้อความต้องห้ามตาม Content policy ของบริษัท (เมื่อมี)

Should warn but may allow with Permission:

- ไม่มีรูปภาพ
- ไม่มี Alias
- ไม่มี Tax category
- ไม่มี Category

## 10. Data requirements

### 10.1 P0 — ใช้ Model ปัจจุบันให้ถูกต้อง

| Field | Required | Validation | Customer/AI visible |
|---|---|---|---|
| `id` | System | Company-scoped CUID | No |
| `companyId` | System | Derived from session/route; ห้ามรับข้าม Tenant | No |
| `sku` | Yes | Unique `(companyId, sku)`, Trim, Uppercase | Yes |
| `name` | Yes | Trim, non-empty | Yes (ชั่วคราวจนมี public name) |
| `description` | Publish required | Customer-safe; P0 ต้องถือเป็น Public data | Yes |
| `category` | No | Trim; P1 เปลี่ยนเป็น Master/ref | Yes |
| `unit` | Yes | Trim, non-empty | Yes |
| `kind` | Yes | Stockable / Non-stock / Service | Yes |
| `reorderPoint` | Stockable only | Decimal >= 0 | No |
| `salePrice` | Conditional | Decimal >= 0, 2 decimal places ตาม API ปัจจุบัน | Yes |
| `bookingDurationMinutes` | Service | 60–180, step 30 ใน P0 | Yes |
| `customerVisible` | Yes | Boolean, default false | Controls publication |
| `status` | Yes | Active / Archived | Controls availability |
| Created/Updated metadata | System | Server generated | Internal only |

### 10.2 P1 — Sales-ready customer-safe Catalog

เพิ่มแบบ Additive โดยไม่ทำลาย Contract เดิม:

| Field/Entity | Purpose |
|---|---|
| `publicName` / Localized text | ชื่อที่ลูกค้าเห็น แยกจากชื่อภายใน |
| `publicDescription` | เนื้อหาที่อนุญาตให้ CRM AI ใช้ |
| `internalNote` | ข้อมูลพนักงานเท่านั้น; ห้ามส่ง AI |
| `aliases[]` | ชื่อเล่น คำสะกด หรือคำค้นไทย/อังกฤษ |
| `imageAssetId` | รูปหลักที่ผ่าน Attachment policy |
| `priceDisplayMode` | Exact / Starting at / Contact us |
| `currency` | เริ่มจาก Company currency และรองรับ Price entity ภายหลัง |
| `taxCategory` / `taxBehavior` | Default สำหรับ Line item ใหม่ |
| `bookable` | แยกการเปิดจองออกจากการเปิดเผยข้อมูล |
| `catalogReadiness` | Computed state + รายการ Validation issue |
| `publishedAt/by` | Audit Publication |
| `archivedAt/by` | Audit Archive |
| Booking `catalogProductId` + public snapshots | ผูก Usage analytics กับ Master โดยยังรักษาชื่อ/ราคา/ระยะเวลาประวัติเดิม |
| Category master | ลดค่าซ้ำ/สะกดไม่ตรงและรองรับ Translation |
| Unit master | มาตรฐานหน่วยและ Decimal precision |
| Import batch | เก็บ Source, Mapping, Counts, Errors และ Actor |

### 10.3 P2 — Advanced commercial Catalog

โครงสร้างเป้าหมาย:

```text
Product/Service
  └── Variant / Sellable SKU
        ├── Price / Price Book Entry (effective-dated)
        ├── Branch / Channel availability
        ├── Bundle components / Add-ons
        └── Line Item Snapshot in Deal / Quote / Invoice / Booking
```

ความสามารถ:

- Product family และ Variant attributes
- Standard / Branch / Customer-segment / Channel price books
- Price version, Effective from/to และ Future price
- One-time / Recurring / Tiered / Volume / Package / Usage-based pricing
- Bundle, Optional add-on, Cross-sell, Upsell, Substitute
- Approval ก่อน Publish หรือ Price change ตาม Threshold
- Multi-currency และ Localized content

## 11. Lifecycle และ business rules

### 11.1 Presentation state ใน P0

ยังไม่ต้องเพิ่ม Enum ใหม่ทันที ให้แปลงจากสถานะเดิมอย่างซื่อสัตย์:

| `status` | `customerVisible` | สถานะบน UI | ใช้ใน AI | ใช้ใน Booking |
|---|---:|---|---:|---:|
| ACTIVE | false | ใช้ภายใน | No | No |
| ACTIVE | true | เผยแพร่ | Yes | Yes เฉพาะ SERVICE |
| ARCHIVED | false/true | เก็บถาวร | No | No |

`ข้อมูลไม่ครบ` เป็น Readiness flag ไม่ใช่ Lifecycle state

### 11.2 Target lifecycle ใน P2

`DRAFT -> ACTIVE_INTERNAL -> PUBLISHED -> UNDER_REVISION -> ARCHIVED`

- Revision ของข้อมูลที่ลูกค้าเห็นต้องไม่เปลี่ยน Production content จน Publish
- Archived item อ่านย้อนหลังได้เสมอ
- ห้าม Hard delete รายการที่เคยถูกอ้างอิง

### 11.3 Core business rules

- **BR-01 Tenant:** ทุก Query/Mutation ต้องบังคับ `companyId` จาก authenticated context
- **BR-02 SKU:** SKU ไม่ซ้ำภายในบริษัทและแก้ไม่ได้หลังถูกใช้งาน; Duplicate ต้องขอ SKU ใหม่
- **BR-03 Publication:** รายการใหม่/Import/Clone ไม่เผยแพร่โดย Default
- **BR-04 Customer-safe:** เฉพาะ Public fields ของ Active + Published เท่านั้นที่ส่งให้ AI
- **BR-05 Service booking:** Booking ใช้ Catalog item ID ที่ตรวจซ้ำกับ Company, Status, Publication และ Kind ก่อนสร้างรายการ
- **BR-06 Duration:** ระยะเวลาจาก Catalog เป็น Canonical; AI ห้ามกำหนดเอง
- **BR-07 Availability:** Catalog presence ไม่ใช่ Stock/Slot availability; ต้อง Query ระบบเจ้าของข้อมูลก่อนยืนยัน
- **BR-08 Archive:** Archive หยุดการเลือกใหม่และหยุดส่งให้ AI แต่ไม่ยกเลิก Booking/Document เดิม
- **BR-09 Rename:** Rename ไม่แก้ `serviceName` Snapshot ใน Booking เดิม
- **BR-10 Price:** เปลี่ยน Standard price ไม่แก้ Line item เดิม; เอกสารเก็บราคา/ส่วนลด/ภาษี Snapshot
- **BR-11 Price override:** Override ใน Deal/Quote ใช้ Permission และ Discount policy ของเอกสาร ไม่แก้ Master product
- **BR-12 Tax:** Product เก็บ Default เท่านั้น; Line item ต้อง Snapshot Tax ที่ใช้จริง
- **BR-13 Restore:** Restore กลับเป็น Unpublished เพื่อหลีกเลี่ยงการเปิดข้อมูลเก่าโดยอัตโนมัติ
- **BR-14 Branch:** จนมี Mapping จริง ทุกสาขาใช้ Catalog เดียวและ UI ต้องไม่แสร้งว่ากรองตามสาขาแล้ว
- **BR-15 Concurrency:** Update ต้องตรวจ `updatedAt/version`; ถ้าถูกแก้โดยผู้อื่น ให้ผู้ใช้ Review ก่อน Overwrite
- **BR-16 Money:** ใช้ Decimal และ Currency code ห้ามคำนวณด้วย Floating point

## 12. CRM AI requirements

### 12.1 Safety contract

- ERP Core เป็นผู้ Query และคัด Customer-safe catalog; AI Gateway ห้ามอ่าน Database โดยตรง
- Payload ห้ามมี Internal note, Cost, Reorder point, Supplier data หรือ Margin
- AI ตอบชื่อ ราคา หน่วย ระยะเวลา และเงื่อนไขจาก Payload เท่านั้น
- หากไม่มีราคา ให้ตอบตาม `priceDisplayMode`; ห้ามเดาหรือคำนวณเอง
- หากไม่มีรายการตรง ให้ถามเพื่อ Clarify หรือส่งต่อพนักงาน ไม่สร้างชื่อ/SKU ใหม่
- ก่อน Auto-book API ต้อง Revalidate Catalog item ID และใช้ชื่อ/ระยะเวลาจาก Record ปัจจุบัน
- การมี Product ไม่อนุญาตให้ AI บอกว่า “มีของ” หรือ “ว่าง” โดยไม่มี Real-time check

### 12.2 Catalog capacity / retrieval

P0 ต้องทำให้ขีดจำกัดสอดคล้องกันระหว่าง Settings, Booking, ERP Core และ AI Gateway หรือแสดง Blocking warning อย่างซื่อสัตย์

P1 เป้าหมายคือ:

1. ERP Core รับ Customer query
2. ค้นหา Candidate ด้วย SKU, Name, Alias, Category และข้อความสาธารณะภายใน Tenant
3. ส่งเฉพาะ Top-N ที่เกี่ยวข้องไป AI Gateway
4. ถ้า Candidate ไม่ชัด ให้ AI ขอข้อมูลเพิ่ม
5. Revalidate ID ก่อนตอบราคา/ทำ Booking

ห้ามใช้ `order by name + slice first N` เป็นพฤติกรรมถาวร เพราะทำให้บางรายการไม่มีโอกาสถูก AI พบ

### 12.3 Preview and quality feedback

- หน้า Detail มี `ดูตัวอย่างข้อมูลที่ AI เห็น`
- แสดง Last published timestamp และ Readiness issues
- เก็บ Metric: คำถามเกี่ยวกับสินค้า, Matched item, No-match, Clarification และ Human handoff
- หน้า Catalog มี Insight “คำที่ลูกค้าถามแต่ยังไม่มีรายการ/คำเรียกตรงกัน” โดยไม่แสดง PII ใน Aggregate

## 13. Booking requirements

- Selector แสดงเฉพาะ Active + Published + Service + Bookable
- ค้นหาได้ด้วย Name/SKU/Alias และแสดง Price + Duration
- เลือก Service แล้วเติม Canonical name และ Standard duration
- หากไม่มี Published service แสดง Empty state พร้อม Link ไป Catalog เฉพาะผู้มีสิทธิ์; ผู้ไม่มีสิทธิ์เห็นข้อความให้ติดต่อ Admin
- Archive/Unpublish ไม่กระทบ Booking เดิม แต่ห้ามใช้กับ Booking ใหม่
- Rename ไม่เปลี่ยน Historical booking
- เปลี่ยน Duration ไม่เปลี่ยน Booking ที่สร้างแล้ว
- Slot check ต้องใช้ Duration ปัจจุบันก่อน Commit และตรวจ Conflict ซ้ำ
- P1 เพิ่ม Nullable `catalogProductId` พร้อม Snapshot ที่จำเป็น เพื่อทำ Usage analytics โดย Booking เก่าที่ยังไม่มี ID ต้องอ่านได้ตามเดิม

## 14. Deal / Quotation / Invoice requirements

เป้าหมายการไหลข้อมูล:

1. ผู้ใช้ค้นหา Product/Service จาก Catalog
2. ระบบสร้าง Line item ของ Record นั้น
3. Line item Snapshot อย่างน้อย: Product ID, SKU, Description, Unit, Quantity, Unit price, Discount, VAT/WHT/Tax category และ Currency
4. API ตรวจว่า Product อยู่ Company เดียวกัน, ยัง Active และผู้ใช้มีสิทธิ์ก่อนสร้าง Line item
5. ผู้ใช้แก้ราคา/ส่วนลดเฉพาะรายการได้ตาม Permission/Policy
6. การแก้ Master ภายหลังไม่เปลี่ยน Line item เดิม
7. Archived product ยังอ่านผ่าน Historical line item ได้ แต่เลือกเพิ่มใหม่ไม่ได้

ข้อสังเกต Architecture ปัจจุบัน: Accounting line รองรับ Snapshot แล้ว แต่ยังต้องออกแบบ End-to-end selector/defaulting และ Document mutation ให้ครบก่อนถือว่า Integration นี้พร้อมใช้งาน

## 15. Import / Export requirements

### 15.1 Import P1

- รองรับ CSV และ XLSX
- มี Template ไทย/อังกฤษพร้อมตัวอย่าง 1 แถว
- ขั้นตอน: Upload -> Map columns -> Validate/Preview -> Confirm -> Result
- Match/Upsert ด้วย SKU ภายใน Company; ผู้ใช้เลือก `สร้างใหม่เท่านั้น` หรือ `สร้างและอัปเดต`
- Preview แสดงจำนวน Create, Update, Skip, Warning, Error
- Error ระบุ Row, Column, Value, Reason และ Suggested fix; ดาวน์โหลด Error file ได้
- Detect Duplicate SKU ทั้งในไฟล์และในระบบ
- Import ไม่ Publish อัตโนมัติ ยกเว้นผู้มี Publish permission เลือกอย่างชัดเจนหลัง Preview
- ทำ Idempotency ตาม File checksum + Import key เพื่อป้องกันกดซ้ำ
- เก็บ Import batch audit และรองรับย้อนดูผลลัพธ์
- Large file ทำ Background job พร้อม Notification เมื่อเสร็จ

### 15.2 Export P1

- Export ผลลัพธ์ที่กรองทั้งหมดหรือเฉพาะที่เลือก
- เลือก Columns ได้ตาม Permission
- ไม่ Export Internal cost/note ให้ผู้ไม่มีสิทธิ์
- ใส่ Timezone, Locale, Filter summary, Exported by/at ใน Metadata
- Large export ใช้ Job + Expiring download link และ Audit

## 16. Permission and audit requirements

### 16.1 P0-compatible permissions

| Permission | ผล |
|---|---|
| `inventory.product.read` | เปิดเมนู/รายการ/รายละเอียด Catalog |
| `inventory.product.manage` | เพิ่ม แก้ เผยแพร่/ยกเลิกเผยแพร่ และ Archive ตามขอบเขตปัจจุบัน |

ทั้งสอง Permission ใช้ได้เมื่อบริษัท Entitled `crm` หรือ `inventory`; การมี CRM อย่างเดียวต้องไม่เปิดเมนู Inventory workspace

### 16.2 Target granular permissions P1/P2

- `catalog.product.read`
- `catalog.product.create`
- `catalog.product.update`
- `catalog.product.publish`
- `catalog.product.archive`
- `catalog.price.manage`
- `catalog.import`
- `catalog.export`
- `catalog.audit.read`
- `sales.line_item.override_price` เป็นสิทธิ์ของ Sales document ไม่ใช่ Catalog

Migration ต้อง Map Role เดิมให้เทียบเท่าพฤติกรรมเดิมและ Fail closed เฉพาะ Action ที่ต้องใช้ Permission ใหม่

### 16.3 Audit events

ต้อง Audit อย่างน้อย:

- Create / Update
- Publish / Unpublish
- Archive / Restore
- Price/Tax change
- Import / Export
- Bulk mutation
- Permission denied

Audit entry ต้องมี Company, Actor, Action, Target, Before/After สำหรับฟิลด์สำคัญ, Request ID, Source UI/API/Import, Timestamp และ Result

## 17. UX, content, accessibility และ responsive

- ใช้ `MangmeePage`, `MangmeeCard`, `mangmee-table`, `mangmee-input` และปุ่ม Semantic ของระบบ
- Primary action ใช้ Brand token ของ Mangmee ไม่ Hardcode Blue แบบหน้าปัจจุบัน
- ใช้ Workspace dictionary และ Locale switch; ห้ามต่อข้อความ `ไทย / EN` ในทุก Label
- Product content รองรับ Translation ใน P1; หากยังไม่มีคำแปลให้ Fallback อย่างโปร่งใส
- Label/Helper/Error เชื่อมด้วย `for`, `aria-describedby`; Focus state มองเห็นได้
- Keyboard ใช้งาน Search, Filter, Row action, Pagination, Form และ Confirmation ได้ครบ
- Color badge ต้องมี Text/Icon ไม่ใช้สีอย่างเดียว
- Touch target อย่างน้อย 44x44 px สำหรับ Action สำคัญ
- ตรวจ Responsive อย่างน้อย 390px, 834px, 1280px และ 1920px
- Numeric input แสดง Format ขณะอ่าน แต่เก็บ/ส่งค่าที่ไม่ปน Separator อย่างถูกต้อง
- วันที่/เวลาใช้ Company timezone; เงินใช้ Currency/Locale formatter

## 18. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | List p95 <= 2 วินาทีที่ 10,000 รายการ; Filter/Search API p95 <= 500 ms ภายใต้ Load ที่ตกลง |
| Pagination | Server-side เสมอ; ไม่มี Unbounded list ใน Web หรือ API |
| Search | Index อย่างน้อย Company + Status + Name/SKU; P1 เพิ่ม Alias/Search index |
| Tenant security | ทุก Repository query มี Company scope และทดสอบ Cross-tenant denial |
| Reliability | Mutation สำคัญรองรับ Idempotency/Double-submit protection และ Transaction ตามขอบเขต |
| Event consistency | Integration ที่ต้องรับประกันใช้ Transactional outbox ใน Transaction เดียวกับ Product mutation; ห้ามพึ่ง Fire-and-forget event เป็น Guarantee |
| Concurrency | Optimistic concurrency หรือ Version check เพื่อไม่ให้ Last writer overwrite แบบเงียบ |
| Audit | Mutation/Import/Export/Denied action ตรวจย้อนหลังได้ |
| Observability | Metrics/Logs แยก List/Search/Publish/Archive/Import/AI retrieval โดยไม่ Log Customer-sensitive content |
| Availability | AI ล่มไม่ทำให้ Catalog หรือ Booking staff flow ล่ม; แสดงสถานะ Degraded อย่างซื่อสัตย์ |
| Compatibility | Contract เปลี่ยนแบบ Additive จน Client เก่าย้ายครบ |
| Backup/retention | Product/Audit/Import metadata ใช้นโยบาย Data retention ของบริษัท; Archive ไม่ใช่ Delete |

## 19. Analytics and insights

### P1 operational insights

- จำนวน Active / Published / Internal / Archived
- รายการข้อมูลไม่ครบ แยกตามสาเหตุ
- รายการไม่มีราคา/ระยะเวลา/รายละเอียด/หมวดหมู่
- จำนวนครั้งที่ถูกเลือกใน Booking หรือ Sales document
- คำค้นในระบบที่ไม่พบผลลัพธ์
- AI match / no-match / clarify rate ต่อรายการหรือหมวดหมู่

### P2 commercial insights

- Revenue, Quantity, Average selling price, Average discount
- Win rate และ Attach rate ต่อ Product/Service
- Top/Low-performing item
- Cross-sell / Bundle performance
- Branch/Channel/Segment comparison
- Recurring revenue, Renewal, Churn เมื่อมี Recurring model

Analytics ต้องคำนวณจาก Line item/Booking facts ไม่ใช้ราคาปัจจุบันใน Master ย้อนกลับไปประมาณประวัติ

## 20. Delivery scope and priority

### P0 — Production-ready Catalog UX และ safety

- Dedicated CRM Catalog UI ตาม Mangmee pattern
- แก้ Toolbar responsive/search width
- Localized labels, enum, error และ Currency formatting
- Search debounce + URL filters: kind, status, publication
- Server pagination, total, sort และ loading/error/empty/forbidden/read-only states
- Dynamic form ตามประเภท; Label/validation/saving/cancel/unsaved guard
- Customer-ready checklist + Preview ก่อน Publish
- Archive/Restore และผลกระทบที่ชัดเจน
- ทำขีดจำกัด Catalog ให้ Settings/Booking/ERP Core/AI สอดคล้อง หรือ Block/Warning อย่างซื่อสัตย์
- Focused frontend/API tests และ Browser E2E create -> publish -> booking/AI eligibility -> unpublish/archive

### P1 — Customer-complete และ Sales-ready

- Public vs Internal content, Alias, Image, Price display mode, Tax defaults, Bookable
- Category/Unit master
- Import/Export + Bulk action
- Granular permissions และ Audit UI
- Product selector + Snapshot defaults ใน Deal/Quotation/Invoice
- Booking catalog ID + historical snapshots สำหรับ Usage analytics
- AI candidate retrieval ที่ Scale เกิน 50/100 รายการ
- Readiness/usage/no-match insights

### P2 — Advanced commercial Catalog

- Price entity + Price books + Effective dates + Approval
- Branch/Channel/Customer-segment pricing and availability
- Variant/Product family/Bundle/Add-on/Related product
- Recurring/Tiered/Usage-based pricing
- Revision workflow, Multi-currency และ Localized content เต็มรูปแบบ

### Out of scope ของ P0

- Online storefront / E-commerce checkout
- Stock reservation หรือ Available-to-promise
- Slot/staff/capacity engine ใหม่
- Subscription billing engine
- Marketplace product sync
- Branch-specific price/availability ที่ยังไม่มี Model
- เปลี่ยน Master Product เป็นข้อมูลย้อนหลังของเอกสารเดิม

## 21. Acceptance criteria

- **AC-01 List completeness:** เมื่อบริษัทมี 125 รายการ ผู้ใช้เปิดดู Page 1–3 และเห็น Total ถูกต้องโดยไม่มีรายการหายเงียบ
- **AC-02 Search/filter:** ผู้ใช้ค้นหา SKU/ชื่อและกรองประเภท/Publication/Status ได้; Refresh/Back รักษา State จาก URL
- **AC-03 Responsive:** Search และ Filters ใช้งานได้ที่ 390px, 834px และ Desktop โดยช่องค้นหาไม่ยุบผิดรูป
- **AC-04 Locale:** เปลี่ยน TH/EN แล้ว Title, Label, Enum, Button, Empty state และ Error เปลี่ยนตาม Locale โดยไม่แสดง Raw enum
- **AC-05 Read-only:** ผู้มี `read` แต่ไม่มี `manage` เปิดดูได้ เห็น Read-only notice และไม่มี Mutation action
- **AC-06 Create draft:** เพิ่มรายการใหม่แล้ว Default เป็น Unpublished และไม่เข้า AI/Booking
- **AC-07 Publish service:** Service ที่ผ่าน Validation และ Publish แล้วเข้า Booking พร้อม Canonical duration และเข้า AI catalog
- **AC-08 Product vs booking:** Published Stockable/Non-stock product เข้า AI แต่ไม่เข้า Service booking selector
- **AC-09 Safe content:** Internal note/Cost/Reorder point ไม่ปรากฏใน AI payload หรือ Customer preview
- **AC-10 Archive:** Archive/Unpublish แล้วหยุดการเลือกใหม่และหยุดส่ง AI แต่ Booking/Line item เก่ายังอ่านค่า Snapshot เดิม
- **AC-11 Price history:** เปลี่ยน Standard price แล้ว Quotation/Invoice line ที่มีอยู่ไม่เปลี่ยนตาม
- **AC-12 Duration history:** เปลี่ยน Service duration แล้ว Booking เดิมไม่เปลี่ยน; Booking ใหม่ใช้ค่าปัจจุบัน
- **AC-13 AI capacity:** Published item ทุกตัวค้นพบได้ด้วย Retrieval ที่รองรับ หรือระบบป้องกัน/แจ้งข้อจำกัดก่อน Publish; ห้ามมีความต่างแบบเงียบระหว่าง Booking กับ AI
- **AC-14 Errors:** Validation/API failure แสดงข้อความธุรกิจที่ชี้วิธีแก้และรักษาค่าฟอร์มไว้
- **AC-15 Concurrency:** เมื่อสองคนแก้ Record เดียวกัน ผู้ใช้คนหลังได้รับ Conflict/Review prompt ไม่ Overwrite เงียบ
- **AC-16 Audit:** Create/Update/Publish/Unpublish/Archive/Restore/Import/Export มี Actor, Time, Result และ Request ID
- **AC-17 Import:** Preview บอก Create/Update/Skip/Error ถูกต้อง; Duplicate และแถวผิดดาวน์โหลด Error file ได้; Import ไม่ Publish โดย Default
- **AC-18 Tenant:** ผู้ใช้บริษัท A ไม่อ่าน/แก้/Import ทับ Product บริษัท B ได้แม้ส่ง ID โดยตรง
- **AC-19 Degraded AI:** AI Provider ล่มแล้วผู้ใช้ยังจัดการ Catalog และสร้าง Booking ด้วยพนักงานได้
- **AC-20 Accessibility:** Core journey ใช้ Keyboard ได้ มี Label/Focus/Error association และ Badge ไม่พึ่งสีอย่างเดียว

## 22. Test coverage ที่ต้องมี

### Unit / contract

- Readiness/publication rules
- Price/duration/SKU validation
- Derived status labels
- Snapshot mapping
- Permission mapping และ Feature entitlement CRM/Inventory
- AI candidate selection และ capacity boundary

### API integration

- Company-scoped list/search/filter/sort/page
- Create/update/publish/archive/restore + Audit/Outbox
- Read-only/forbidden/cross-tenant
- Concurrent update conflict
- Import validation/idempotency
- AI payload มีเฉพาะ Customer-safe fields

### Web component / integration

- Toolbar responsive และ URL state
- Pagination > 50 records
- Localized enum/errors
- Dynamic form per kind
- Saving/error/unsaved-change/read-only states
- Preview และ Publish validation

### Browser E2E

1. Owner สร้าง Service แบบ Unpublished
2. ยืนยันว่าไม่อยู่ใน Booking/AI eligibility
3. เติมข้อมูลและ Publish
4. ยืนยัน Booking ใช้ Duration ถูกต้อง
5. ยืนยัน Product ที่ไม่ใช่ Service ไม่เข้า Booking
6. Unpublish/Archive และยืนยันว่าหายจาก New selection
7. เปิด Booking/Document เดิมและยืนยัน Snapshot ไม่เปลี่ยน
8. ทดสอบ TH/EN, Read-only, Mobile และ Page > 50

## 23. Open decisions ก่อนพัฒนา P1

1. ต้องการให้รายการไม่มีราคาตอบลูกค้าแบบ `ติดต่อสอบถาม` หรือบังคับมีราคาก่อน Publish?
2. Service ที่ลูกค้าเห็นแต่จองไม่ได้ต้องมี `bookable` แยกทันทีหรือรอ Booking phase ถัดไป?
3. Tax default จะอ้าง Master ของ Accounting/Thai Tax ด้วย Key ใด และใครมีสิทธิ์แก้?
4. Company currency มี Source of truth ใด และรองรับหลาย Currency ใน Phase ไหน?
5. Publication ต้องมี Approval สำหรับทุกบริษัทหรือเปิดเฉพาะบริษัทที่ตั้ง Policy?
6. Category/Unit จะเป็น Company master หรือ System template + Company extension?
7. ราคาแยกตามสาขา/กลุ่มลูกค้า/ช่องทางอย่างใดเป็น Use case แรก?
8. Product images ใช้ Attachment primitive ใด และ Customer-facing retention policy เป็นอย่างไร?
9. ต้องรองรับชื่อ/รายละเอียดไทยและอังกฤษแบบ Field คู่ หรือ Translation entity ที่ขยายภาษาได้?
10. การใช้งานใน Deal/Quotation/Invoice จะเริ่มที่ Quotation ก่อนหรือทำ Shared line-item selector พร้อมกัน?

## 24. External product patterns used

เอกสารอ้างอิงเหล่านี้ใช้เพื่อวางโครงสร้างที่ขยายได้ ไม่ใช่เพื่อคัดลอก UI:

- [Salesforce: Products and Price Books](https://help.salesforce.com/s/articleView?id=sf.products_pricebooks.htm&language=en_US) — แยก Master product จากชุดราคา
- [Salesforce: Manage Price Books](https://help.salesforce.com/s/articleView?id=pricebooks_landing_page.htm&language=en_US&type=5) — Standard และ Custom price books สำหรับกลุ่มลูกค้าหรือบริบทต่างกัน
- [HubSpot: Create and manage products](https://knowledge.hubspot.com/products/create-and-manage-products) — Product library, status, flat/tiered pricing และการจัดการ Catalog
- [HubSpot: Use line items](https://knowledge.hubspot.com/products/edit-products-and-terms-in-the-line-items-editor) — สร้าง Line item เฉพาะ Deal/Quote/Invoice เพื่อปรับราคาและเงื่อนไขโดยไม่แก้ Master
- [Stripe: How products and prices work](https://docs.stripe.com/products-prices/how-products-and-prices-work) — แยกสิ่งที่ขายออกจากวิธีคิดราคา, Tax behavior, Recurring และ Multi-currency
- [Microsoft Dynamics 365: Product families, products, bundles, and properties](https://learn.microsoft.com/en-us/dynamics365/sales/developer/create-manage-product-families-products-bundles-product-properties) — Product family, Variant-like attributes, Bundle และ Publish lifecycle

## 25. Definition of done สำหรับ P0

- Product/UX/Architecture อนุมัติ Requirement และ Open decisions ที่กระทบ P0
- หน้า List/Create/Detail ใช้ Mangmee patterns และ Locale dictionary
- Pagination/Search/Filters/Sort/States/Responsive ผ่าน Acceptance criteria
- Publish/Archive behavior และ AI/Booking eligibility สอดคล้องกัน
- ไม่มี Internal field ใน Customer/AI payload
- มี Focused tests และ Browser E2E ตาม Section 22
- Migration (ถ้ามี), Seed และ API/Web contracts ผ่านใน Environment เป้าหมาย
- Browser smoke บน Route จริงยืนยัน Create -> Publish -> Booking/AI -> Unpublish/Archive
- Docs/spec/plan/checklist และ Agent memory อัปเดตด้วย Evidence จริงหลัง Implement
