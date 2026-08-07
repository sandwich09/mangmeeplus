# Prompt: ออกแบบ UX/UI สินค้าและบริการสำหรับ CRM

ใช้ Prompt นี้ร่วมกับภาพหน้าปัจจุบัน โดยให้ภาพเป็น Reference ของ Workspace shell, Sidebar และ Header เท่านั้น ไม่ใช่ข้อจำกัดของ Layout เนื้อหาหน้าใหม่

```text
คุณคือ Senior Product Designer และ UX Architect ที่เชี่ยวชาญระบบ CRM/ERP สำหรับ SME ไทย

งานของคุณคือออกแบบ High-fidelity UX/UI ใหม่สำหรับหน้า “สินค้าและบริการ” ของระบบมั่งมี ให้สวยงาม ทันสมัย เข้าใจง่าย และพร้อมส่งต่อให้นักพัฒนา โดยต้องรักษา Business rules และข้อจำกัดของระบบจริง ห้ามออกแบบเป็นร้านค้าออนไลน์หรือ Marketplace

## 1. Product context

หน้านี้คือ Catalog กลางระดับบริษัทสำหรับสิ่งที่ธุรกิจขาย ข้อมูลชุดเดียวถูกใช้โดย:

- Owner/Admin สำหรับตั้งค่าสินค้าและบริการ
- พนักงานสำหรับค้นหาและตอบลูกค้า
- CRM AI สำหรับตอบชื่อ รายละเอียด ราคา และระยะเวลาจากข้อมูลที่อนุญาตเท่านั้น
- หน้าจองสำหรับเลือกบริการและระยะเวลามาตรฐาน
- Inventory ใช้ Product master ชุดเดียวกัน แต่ CRM Catalog ไม่ต้องแสดงงานคลังที่ไม่เกี่ยวข้อง

เป้าหมาย UX:

- เพิ่มหรือแก้รายการพื้นฐานได้ภายใน 1 นาที
- ค้นหารายการได้ภายใน 10 วินาที
- เห็นชัดว่ารายการใดเผยแพร่ให้ลูกค้า/AI รายการใดใช้ภายใน และรายการใดเก็บถาวร
- ป้องกันการเผยแพร่ข้อมูลไม่ครบหรือข้อมูลภายในโดยไม่ตั้งใจ
- ใช้งานได้ดีทั้ง Desktop, Tablet และ Mobile

## 2. Hard system constraints — ห้ามออกแบบขัดกับเงื่อนไขนี้

- ใช้ Product master ชุดเดียวร่วมกับ Inventory และ CRM ห้ามสร้าง CRM Product อีกชุด
- Catalog เป็นระดับบริษัทและใช้ร่วมทุกสาขา ต้องแสดง Chip “ใช้ร่วมทุกสาขา”
- ยังไม่มีราคา การเปิดขาย หรือระยะเวลาบริการแยกรายสาขา
- ประเภทมี 3 แบบเท่านั้น:
  1. สินค้าในสต็อก
  2. สินค้าไม่ตัดสต็อก
  3. บริการ
- สถานะข้อมูลจริงมี 2 แบบ: ใช้งาน และเก็บถาวร
- การเผยแพร่เป็นคนละเรื่องกับสถานะ: รายการใหม่ต้องไม่เผยแพร่โดยค่าเริ่มต้น
- CRM AI เห็นได้เฉพาะรายการ “ใช้งาน + เผยแพร่”
- หน้าจองเลือกได้เฉพาะ “บริการ + ใช้งาน + เผยแพร่”
- ระยะเวลาบริการรองรับ 60–180 นาที เพิ่มทีละ 30 นาที
- การเผยแพร่สินค้า: CRM AI ใช้ตอบคำถาม แต่ไม่เข้า Booking selector
- การเผยแพร่บริการ: CRM AI ใช้ตอบคำถามและเข้า Booking selector
- การมีสินค้าใน Catalog ไม่ได้แปลว่ามี Stock หรือพร้อมขายทุกสาขา ห้ามแสดงคำยืนยัน Availability ที่ระบบไม่ได้ตรวจจริง
- เก็บถาวรคือ Soft archive ไม่ใช่ลบถาวร และต้องไม่เปลี่ยน Booking/เอกสารเก่า
- สิทธิ์มี Read และ Manage; ผู้ใช้ Read-only ต้องดูได้แต่ไม่มี Action ที่แก้ข้อมูล

## 3. Scope ที่ต้องออกแบบ

ออกแบบ 3 หน้าหลักภายใน Workspace shell เดิม:

1. หน้ารายการ
   Route: `/companies/:companyId/settings/crm-catalog`
2. หน้าเพิ่มสินค้า/บริการ
   Route: `/companies/:companyId/settings/crm-catalog/new`
3. หน้ารายละเอียด/แก้ไข
   Route: `/companies/:companyId/settings/crm-catalog/:productId`

ต้องส่งมอบทั้ง Desktop 1440px, Tablet 834px และ Mobile 390px

## 4. Visual direction

- Thai-first modern SME CRM: สะอาด อบอุ่น น่าเชื่อถือ เป็นมิตร และดูเป็น Business tool
- คง Sidebar, Top header, Company switcher และตำแหน่ง Content area จากภาพ Reference
- ใช้ Mangmee design language:
  - Primary brand green: #12B76A / dark green #027A48
  - Neutral text/surface: #101828 ถึง #F9FAFB
  - White cards, border เทาอ่อน, radius ประมาณ 16px, shadow เบา
  - Input และ Button radius ประมาณ 11–12px
  - Primary CTA สีเขียว ไม่ใช้สีน้ำเงินเป็นสีหลัก
  - ใช้ Line icons ที่เรียบง่ายและสอดคล้องกัน
- Typography ต้องรองรับภาษาไทย อ่านง่าย น้ำหนักชัดเจน และไม่แน่นเกินไป
- ความหนาแน่นระดับ Business application: สแกนข้อมูลได้เร็ว แต่ไม่เป็น Dashboard ที่เต็มไปด้วย Card ขนาดใหญ่

ห้ามใช้:

- Heavy gradient, glassmorphism, neon หรือภาพลักษณ์ Crypto/Fintech
- Hero banner ขนาดใหญ่
- KPI cards ขนาดใหญ่เกินความจำเป็น
- Emoji เป็น Primary icon
- ปุ่มหลักสีน้ำเงิน
- UI แบบ E-commerce storefront, Product gallery หรือ Checkout

## 5. หน้ารายการ

### 5.1 Header

- Breadcrumb: “ตั้งค่า CRM / สินค้าและบริการ”
- Title: “สินค้าและบริการ”
- Description: “ข้อมูลกลางที่พนักงาน CRM AI และการจองใช้ร่วมกัน”
- Scope chip: “ใช้ร่วมทุกสาขา”
- Primary CTA: “+ เพิ่มสินค้า / บริการ”

### 5.2 Compact summary filters

แสดงเป็น Chips หรือ Small summary cards ที่กดกรองได้:

- ใช้งานทั้งหมด
- เผยแพร่แล้ว
- บริการ
- ต้องตรวจสอบข้อมูล
- เก็บถาวร

ต้องมีขนาด Compact และไม่แย่งพื้นที่จาก Search/Table

### 5.3 Search and filters

ใช้ Responsive grid ที่ไม่ทำให้ช่องค้นหายุบ:

- Search กว้างที่สุด: ค้นหาชื่อ SKU หรือ Barcode
- ประเภท: ทั้งหมด / สินค้าในสต็อก / สินค้าไม่ตัดสต็อก / บริการ
- การเผยแพร่: ทั้งหมด / เผยแพร่ / ใช้ภายใน
- สถานะ: ใช้งาน / เก็บถาวร / ทั้งหมด
- ปุ่ม “ล้างตัวกรอง” เมื่อมี Filter
- แสดง Active filter chips และจำนวนผลลัพธ์

ไม่ต้องใส่ Category filter ใน Primary P0 design เพราะ Backend ปัจจุบันยังไม่รองรับ Filter นี้ครบวงจร

### 5.4 Desktop table

Columns:

1. ชื่อรายการ + SKU + หมวดหมู่ข้อความรอง
2. ประเภทเป็น Badge ที่แปลแล้ว
3. หน่วย
4. ราคามาตรฐานตาม Currency ของบริษัท
5. ระยะเวลา เฉพาะบริการ
6. การเผยแพร่
7. สถานะ
8. อัปเดตล่าสุด
9. Action menu

กฎการแสดงผล:

- ห้ามแสดง Raw enum เช่น SERVICE หรือ STOCKABLE
- Badge ที่แนะนำ:
  - “เผยแพร่” สีเขียว
  - “ใช้ภายใน” สีเทา/น้ำเงินเทา
  - “ข้อมูลไม่ครบ” สีเหลือง
  - “เก็บถาวร” สีเทา
- Row click เปิด Detail
- Actions ตามสิทธิ์: ดูรายละเอียด, แก้ไข, เผยแพร่/ยกเลิกเผยแพร่, เก็บถาวร
- Archived state สามารถออกแบบ Action “คืนค่า” เป็น Target P0 ได้ แต่ต้อง Annotate ว่าต้องเพิ่ม Backend endpoint
- ไม่มี Permanent delete

### 5.5 Pagination

- Server-side pagination 25 / 50 / 100 รายการ
- ข้อความตัวอย่าง: “แสดง 1–25 จาก 248 รายการ”
- มี Previous/Next และเลขหน้าแบบไม่รก
- ห้ามซ่อนรายการเกิน 50 รายการแบบเงียบ

### 5.6 Mobile list

- เปลี่ยนแต่ละ Row เป็น Card
- แสดงชื่อ, SKU, ประเภท, ราคา/หน่วย, ระยะเวลาบริการ, Publication และ Status
- Action อยู่ใน Kebab menu
- ห้ามบีบ Desktop table ลงมือถือ
- ห้ามเกิด Horizontal page scroll

## 6. หน้าเพิ่มและหน้าแก้ไข

ใช้ Full-page form ไม่ใช้ Modal เล็ก แบ่งข้อมูลเป็น Cards ที่เข้าใจง่าย

### Card A — ข้อมูลพื้นฐาน

- ประเภทสินค้า/บริการ ต้องเลือกก่อน
- SKU
- ชื่อ
- หมวดหมู่แบบข้อความ
- หน่วยขาย

Behavior ตามประเภท:

- สินค้าในสต็อก: แสดง “จุดสั่งซื้อ”
- สินค้าไม่ตัดสต็อก: ไม่แสดงจุดสั่งซื้อ
- บริการ: ไม่แสดงจุดสั่งซื้อ แต่แสดงระยะเวลามาตรฐาน

### Card B — ข้อมูลสำหรับลูกค้าและ CRM AI

- รายละเอียดสินค้า/บริการ
- ราคามาตรฐาน
- Helper text ชัดเจนว่า Description นี้อาจถูก CRM AI ใช้ตอบลูกค้า
- Preview panel: ตัวอย่างข้อมูลที่พนักงาน/AI จะเห็น

P0 ยังมี Description ช่องเดียว จึงต้องใช้คำว่า “รายละเอียดสำหรับลูกค้าและ AI” และห้ามเพิ่ม Internal note ใน Primary design

### Card C — การตั้งค่าบริการ

แสดงเฉพาะเมื่อประเภทเป็นบริการ:

- ระยะเวลามาตรฐาน: 60 / 90 / 120 / 150 / 180 นาที
- Helper text: “ใช้กำหนดเวลาจองมาตรฐาน”
- หากอนุญาตไม่กำหนด ต้องแจ้งชัดว่าระบบใช้ Default 60 นาที

### Card D — การเผยแพร่

- ใช้ Control ที่ชัดกว่าคำว่า “ลูกค้าเห็น”
- Label: “เผยแพร่ให้ลูกค้าและ CRM AI”
- Product explanation: “CRM AI ใช้ข้อมูลนี้ตอบลูกค้า แต่ไม่แสดงในหน้าจอง”
- Service explanation: “CRM AI ใช้ตอบลูกค้าและบริการนี้จะแสดงในหน้าจอง”
- แสดง Readiness checklist ก่อน Publish:
  - มี SKU
  - มีชื่อและหน่วย
  - มีรายละเอียดสำหรับลูกค้า
  - Service มีระยะเวลาถูกต้อง
  - ราคาไม่ติดลบ
- มี Preview ก่อนยืนยัน Publish

### Action bar

- “ยกเลิก”
- “บันทึกแบบไม่เผยแพร่”
- “บันทึกและเผยแพร่” เป็น Primary CTA
- Sticky ด้านล่างเมื่อหน้า Form ยาว
- มี Saving state และป้องกันกดซ้ำ
- เมื่อออกจากหน้าที่ยังไม่บันทึก แสดง Unsaved-change confirmation

### Edit/detail additions

- Header แสดง Back, ชื่อ, SKU, Type badge, Publication badge และ Status badge
- Read-only mode แสดง Banner “คุณมีสิทธิ์ดูอย่างเดียว” และซ่อน Mutation actions
- Archived mode แสดง Banner ว่ารายการนี้ไม่ถูกใช้กับลูกค้า/การจองใหม่
- Action เก็บถาวรต้องใช้ Confirmation ที่อธิบายว่าไม่กระทบประวัติเก่า

## 7. States ที่ต้องออกแบบให้ครบ

สร้าง Component state หรือ Frame แยกสำหรับ:

1. Initial loading skeleton
2. Empty catalog พร้อม CTA “เพิ่มรายการแรก”
3. No search results พร้อม “ล้างตัวกรอง”
4. API error พร้อม “ลองใหม่”
5. Permission denied
6. Read-only
7. Inline validation error
8. Saving/disabled
9. Save success toast
10. Unsaved-change confirmation
11. Publish confirmation
12. Archive confirmation
13. Archived detail
14. Warning เมื่อรายการที่เผยแพร่ใกล้หรือเกินขีดจำกัด CRM AI 50 รายการ โดยห้ามปล่อยให้เกิดความต่างแบบเงียบ

## 8. Responsive behavior

- Desktop >= 1024px:
  - Full table
  - Form 2 columnsได้
  - Preview panel อยู่ด้านขวาแบบ Sticky
- Tablet 768–1023px:
  - Filters 2 columns
  - Form และ Preview เรียงต่อกัน
- Mobile < 768px:
  - Padding 16px
  - One-column form
  - Card list แทน Table
  - Sticky bottom action bar
  - Touch targets อย่างน้อย 44px
- Wide content Scroll ได้เฉพาะภายใน Card ห้ามทำให้ทั้งหน้ากว้างเกิน Viewport

## 9. Accessibility and language

- ทุก Field มี Visible label, Required marker, Helper text และ Inline error
- มี Keyboard focus state ที่เห็นชัด
- Badge ต้องมีข้อความ ไม่ใช้สีอย่างเดียว
- รองรับ TH/EN จาก Locale toggle จริง
- ในแต่ละ Locale แสดงภาษาเดียว ห้าม Hardcode “ไทย / English” ซ้ำในทุก Label
- แปล Enum เป็นภาษาคนเสมอ
- ใช้ข้อความธุรกิจที่ชัด เช่น “เผยแพร่ให้ลูกค้าและ CRM AI” แทน “ลูกค้าเห็น”

## 10. Future-only — ห้ามใส่เป็นความสามารถที่ใช้งานได้ใน Primary P0 mockup

หากต้องการเสนอ ให้แยกเป็น Future annotation เท่านั้น:

- Import/Export และ Bulk action
- รูปภาพ/Gallery
- ชื่อหรือ Description หลายภาษาใน Master data
- Internal note แยกจาก Public description
- Tax default, Cost, Margin
- Category/Unit master
- Branch-specific availability หรือราคา
- Price books, Customer-tier pricing, Promotion
- Variant, Bundle, Package, Add-on
- Recurring/Tiered/Usage-based pricing
- Sales order, Stock reservation, Fulfillment, POS, Storefront หรือ Checkout

## 11. Realistic sample data

ใช้ข้อมูลตัวอย่างภาษาไทยที่ดูเป็นธุรกิจจริง เช่น:

- SVC-MASSAGE-THAI — นวดไทย — บริการ — 500 บาท/ครั้ง — 90 นาที — เผยแพร่
- SVC-AROMA-120 — นวดอโรมา — บริการ — 1,200 บาท/ครั้ง — 120 นาที — ใช้ภายใน
- PRD-OIL-001 — น้ำมันนวดอโรม่า — สินค้าในสต็อก — 290 บาท/ขวด — เผยแพร่
- PRD-GIFT-001 — บัตรของขวัญ 1,000 บาท — สินค้าไม่ตัดสต็อก — 1,000 บาท/ใบ — ใช้ภายใน
- SVC-SPA-OLD — แพ็กเกจสปาเดิม — บริการ — เก็บถาวร

ห้ามใช้ Lorem ipsum และห้ามแสดง Mock analytics เหมือนเป็นข้อมูล Production จริง

## 12. Expected deliverables

ส่งมอบ:

1. High-fidelity mockup ของ List, Create และ Detail/Edit
2. Desktop, Tablet และ Mobile ของ Core journey
3. Component variants สำหรับ Search, Filter, Badge, Table/Card row, Form field, Preview, Action bar, Toast และ Dialog
4. Loading, Empty, Error, Read-only, Archived และ Permission states
5. Interaction annotations สำหรับ Search/filter, Publish, Archive, Save, Unsaved change และ Responsive behavior
6. Design rationale สั้น ๆ ว่าการจัดลำดับข้อมูลช่วย Owner/Admin ทำงานเร็วขึ้นอย่างไร

ให้เริ่มจาก Information architecture และ Desktop happy path ก่อน จากนั้นแตก Tablet/Mobile และ State variants โดยรักษา Design system และ Business rules ข้างต้นอย่างเคร่งครัด
```

## หมายเหตุสำหรับผู้ส่ง Prompt

- แนบภาพหน้าปัจจุบันไปพร้อม Prompt เพื่อให้ AI รักษา Sidebar/Header เดิม
- หากต้องการแบบที่นำไปเขียนโค้ดทันที ให้กำชับว่า Primary mockup ต้องมีเฉพาะ P0; Future-only ใช้ Annotation แยก
- Requirement ฉบับเต็มอยู่ที่ `docs/specs/crm-product-service-catalog-v2-product-requirements-th.md`
