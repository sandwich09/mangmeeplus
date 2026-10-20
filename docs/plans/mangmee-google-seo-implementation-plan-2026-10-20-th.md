# แผนปรับใช้ SEO สำหรับมั่งมีพลัส

สถานะ: เตรียมพร้อมสำหรับ implementation; บันทึกทิศทาง root public homepage และ guideline ผู้ใช้ไทยแล้ว ยังไม่แก้หรือเผยแพร่เว็บไซต์

อ้างอิง: [งานวิจัยและหลักฐาน 20 ตุลาคม 2026](../research/mangmee-google-seo-evidence-2026-10-20-th.md), [guideline ไทยและแนวโน้ม 2027–2028](../research/mangmee-thai-main-website-guideline-2026-10-20-th.md)

## ผลลัพธ์และขอบเขต

ผู้ใช้หลักคือเจ้าของ SME ฝ่ายบัญชี และพนักงานที่จัดการใบเสร็จ/ค่าใช้จ่าย Journey คือค้นชื่อหรือปัญหา → เข้าใจผลิตภัณฑ์จากหน้าเว็บหลักสาธารณะ → ดูตัวอย่างและข้อจำกัด → เลือกเริ่มใช้งานผ่าน LINE → ใช้ signup/billing flow เดิมตามสิทธิ์ ลูกค้าเดิมมีทางเข้าสู่ระบบแยกชัดเจน

เป้าหมายการค้น: อันดับ organic แรกสำหรับ `มั่งมีพลัส` และ `MangmeePlus` ในบริบทที่วัด และเพิ่ม traffic ที่เกี่ยวข้องกับ receipt/expense/LINE พร้อม conversion ที่ตรวจได้ ไม่ตั้งสัญญาว่าจะได้อันดับในวันที่กำหนด

แผนยังยึด **homepage-only** ตามการตัดสินใจเดิม แต่คำสั่งต่อเนื่องวันที่ 20 ตุลาคมให้บันทึกทิศทาง **`mangmeeplus.com/` เป็นหน้า public หลัก และ `/login` เป็นทางเข้าระบบ** แทนข้อเสนอแรกที่คง official เป็นปลายทางถาวร สถานะ live ที่ตรวจใน baseline ยังเป็น `official.mangmeeplus.com` และยังไม่มีการย้ายจริง

คง ERP/API/auth/deep links บน origin เดิม ไม่เปิดข้อมูลลูกค้าเพื่อ SEO ไม่เพิ่ม CMS/dependency/framework เพียงเพื่อทำงานนี้ เตรียม permanent redirect ของ official และ mapping หน้า receipt ที่เลิกใช้หลัง target พร้อม ไม่จำเป็นต้องย้าย ERP ไป `app.` เพื่อให้หน้าแรกเป็น public

ก่อนแก้ routing ต้องมี spec การย้าย URL ที่ครอบคลุมทั้ง `apps/web/app/page.tsx` และ exact-root redirect ใน `infra/cloudflare/mangmee-host-proxy.worker.js`, static asset namespace, public cache/session, canonical/JSON-LD/sitemap และเส้นทาง OAuth เดิม Worker มีการแก้ไขจากงานอื่นอยู่แล้ว ต้องผสานตาม diff จริง

แยกช่วงย้าย URL จากการเปลี่ยนเนื้อหา/ดีไซน์ครั้งใหญ่ ตาม [Google site-move guidance](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes) เพื่อแยกสาเหตุ regression และความผันผวนของ Search การแก้ claim ที่ไม่จริงทำได้ทันที ไม่ต้องรอเพื่อรักษา baseline

## งานเรียงลำดับ

| งาน | ผู้รับผิดชอบตามหน้าที่ | สิ่งที่จะส่งมอบ | เกณฑ์ตรวจรับ |
|---|---|---|---|
| R0 Root homepage migration spec | ผู้ดูแลเว็บ/ระบบ | URL/asset/redirect mapping และ regression scope โดยรักษา auth/ERP | target public พร้อม; canonical ชัด; ไม่มี loop; OAuth/deep links/cache boundary ชัด |
| S0 Baseline | ผู้ดูแล SEO/analytics | GSC exports ตามคำค้น ประเทศ อุปกรณ์ และวันที่ครบ; บันทึก conversion ที่มีอยู่ | ระบุ filters/ช่วงวันที่/ข้อจำกัดครบ ไม่เอา all-query rank มาอ้าง brand rank |
| S1 Homepage identity และ claim audit | ผู้ดูแลผลิตภัณฑ์ + ผู้แก้เว็บ | ข้อความชื่อเต็ม/ผู้พัฒนา/flow/ข้อจำกัดที่ตรง release | ทุกคำอ้าง capability มี spec + acceptance ของสิ่งที่เปิดให้ลูกค้าใช้จริง |
| S2 หลักฐานผลิตภัณฑ์ | ผู้ดูแลผลิตภัณฑ์/เนื้อหา | demo จริง 1 flow และผลทดสอบ receipt ที่มีวิธีวัด | เปิดตามขั้นตอนได้; ข้อมูลตัวอย่างปลอดภัย; ผลเลขทำซ้ำได้ |
| S3 References | เจ้าของแบรนด์/การตลาด | รายการ official profiles และคู่ค้าหรือลูกค้าที่มีหลักฐานความสัมพันธ์ | ใช้ URL ที่ยืนยันแล้ว; คำบรรยาย/ลิงก์ตรงเว็บ; ไม่ใช้ link spam |
| S4 Technical validation | ผู้แก้เว็บ | initial/template/rendered parity, schema, links, lab performance | ไม่ทำ regression; ใช้ผลวัดจริงระบุปัญหา ไม่อ้าง field pass เมื่อข้อมูลไม่พอ |
| S5 Observe and iterate | ผู้ดูแล SEO | change log และรายงานหลัง crawl/ช่วง 28 วันเท่ากัน | แยกสิ่งที่เห็นจริง สมมติฐาน และสิ่งที่ข้อมูลยังไม่พอ |

S0–S2 และต้นแบบตาม guideline เตรียมได้ก่อน; R0 ต้องเสร็จก่อนแตะ routing; S3 ทำหลังมีเนื้อหาที่น่าอ้างอิง; S4 ตรวจทุกครั้งก่อนเผยแพร่; S5 ทบทวนรายสัปดาห์โดยคนและสรุปที่ 30/60/90 วัน ไม่มี automation ถูกตั้งไว้

## ข้อความร่างสำหรับหน้าแรก

ข้อความต่อไปนี้เป็นร่างเพื่อทดสอบกับ source/flow จริงก่อนเผยแพร่ ไม่ใช่คำอ้างผล ranking

**Title เดิมที่ยังใช้เป็น baseline ได้**

> มั่งมีพลัส (MangmeePlus) | AI อ่านใบเสร็จและลงบัญชีผ่าน LINE

ไม่จำเป็นต้องเปลี่ยน title ในชุดแรก หากจะทดลอง title ภายหลัง ให้เทียบกับ candidate ที่ขอบเขตชัดกว่า:

> มั่งมีพลัส (MangmeePlus) | AI อ่านใบเสร็จและบันทึกค่าใช้จ่ายผ่าน LINE

**H1 candidate**

> มั่งมีพลัส — อ่านใบเสร็จและบันทึกค่าใช้จ่ายผ่าน LINE

ร่างนี้เป็น candidate จากรอบ SEO เดิม; สำหรับต้นแบบเว็บหลักรอบใหม่ให้เริ่มจากชุด A/B ใน [guideline](../research/mangmee-thai-main-website-guideline-2026-10-20-th.md) ซึ่งแสดงชื่อสินค้าใกล้ H1 และทดสอบข้อความ “ส่งใบเสร็จผ่าน LINE ให้ AI ช่วยอ่านข้อมูล” ไม่เลือกหัวเรื่องจาก keyword density

**ข้อความอธิบาย**

> ถ่ายรูปใบเสร็จส่งผ่าน LINE ให้ AI ช่วยอ่านข้อมูลและเตรียมรายการค่าใช้จ่าย ผู้มีสิทธิ์ตรวจและแก้ไขก่อนยืนยัน พร้อมเก็บภาพต้นฉบับไว้ตรวจย้อนหลัง

**ข้อความระบุตัวตน**

> มั่งมีพลัส (MangmeePlus) เป็นซอฟต์แวร์ช่วยจัดการใบเสร็จและค่าใช้จ่าย พัฒนาและดูแลโดย บริษัท มั่งมียั่งยืน จำกัด

**ข้อความจำกัดขอบเขต**

> AI ช่วยเตรียมข้อมูลและลดงานคีย์ ผู้ใช้งานยังต้องตรวจความถูกต้อง การใช้ข้อมูลเพื่อจัดทำบัญชีหรือยื่นภาษีต้องตรวจตามเอกสารและหน้าที่ของผู้รับผิดชอบ

จัดเนื้อหาไว้ในส่วนเดิม:

| ส่วน | เนื้อหาที่ต้องมีจริง |
|---|---|
| แนะนำผลิตภัณฑ์ | ชื่อเต็ม ประเภทซอฟต์แวร์ ผู้ใช้เป้าหมาย ผู้พัฒนา และ CTA เดิม |
| วิธีใช้ | ภาพใบเสร็จตัวอย่าง → ข้อมูลที่ AI อ่าน → การแก้ข้อผิดพลาด → สถานะก่อน/หลังยืนยัน |
| ความสามารถ | สิ่งที่เปิดใช้จริงตามแพ็กเกจ/สิทธิ์ พร้อมตัวอย่างของ receipt/expense/reimbursement |
| หลักฐานผลลัพธ์ | วิธีทดสอบ ระยะเวลา จำนวนตัวอย่าง ผลที่ผ่านและไม่ผ่าน ไม่ใช้ testimonial สมมติ |
| ราคา | รอบจ่าย โควตา ข้อจำกัด และสถานะขายจาก approved catalog; ไม่ใส่ promotion หมดอายุลง title/schema |
| FAQ และติดต่อ | ตอบปัญหาจริง ระบุตัวตนผู้พัฒนา contact/profile ที่ยืนยันแล้ว; FAQ มีไว้ช่วยคนอ่าน |

ไม่เติมชื่อแบรนด์ทุกหัวข้อหรือกำหนด keyword density; ชื่อควรชัดเจนและอ่านธรรมชาติ

## Claim audit ก่อนนำข้อความไปใช้

หน้า live ที่อ่านมีทั้งคำอธิบาย “สร้างฉบับร่างให้คนตรวจ” และข้อความสั้น “ลงบัญชีให้ทันที”, “อ่าน VAT ถูกต้อง”, “ดึง…ออกมาให้ครบ” รวมถึง Enterprise claim เรื่อง ภ.ง.ด.53/50 ทวิ ต้องตรวจแต่ละประโยคกับสิ่งที่เปิดใช้จริงก่อนขยาย SEO

- ห้ามสรุปว่าฟีเจอร์ขายได้เพียงเพราะมี route/controller หรือ feature key; entitlement, permission และ readiness เป็นคนละเงื่อนไข ตาม [package spec](../specs/mangmee-package-entitlements-spec-th.md)
- [readback วันที่ 6 ตุลาคม](../agent-memory/mangmee-ai-live-feature-structure-2026-10-06.md) เป็นข้อมูลประวัติ ไม่ใช่หลักฐานแทน current release ต้องตรวจใหม่หากจะประกาศ capability เพิ่ม
- ความแม่นยำ/เวลาที่ประหยัด/ROI ต้องมีชุดทดสอบจริงและนิยามตัวหาร ไม่ใส่ `99%`, `เร็วขึ้น 80%` หรือ “ถูกต้องทุกใบ” โดยไม่มีหลักฐาน
- ตัวอย่างหน้าจอที่สร้างขึ้นต้องติดป้าย “ตัวอย่าง”; ลูกค้าจริงต้องได้รับอนุญาตและลบข้อมูลที่ไม่จำเป็น

## ชุดหลักฐานที่เตรียมทำได้

เริ่มจาก demo 1 flow ที่ขายจริง และ pilot 30 ใบที่ครอบคลุมใบไทย/อังกฤษ ภาพชัด/เอียง/ยับ และมี/ไม่มี VAT จำนวน 30 เป็นขอบเขตงานเริ่มต้น ไม่ใช่ขนาดตัวอย่างที่รับรองความแม่นยำทั้งระบบ

เก็บ input ที่ได้รับอนุญาต, ground truth ที่คนตรวจ, วันที่และรุ่นระบบ, output ก่อนคนแก้, เวลาเริ่ม–จบ, จำนวนฟิลด์ที่ถูก/ต้องแก้/อ่านไม่ได้ ใช้ definition เดิมทุกใบ เช่นวันที่ normalized ตรงเอกสาร และยอดตรงหน่วยสตางค์ แยก “อ่านไม่ออก” ออกจาก “ไม่มี field นี้ในเอกสาร”

รายงานเป็น `ถูก x จาก y ฟิลด์ในตัวอย่าง n ใบ` แยกชนิดเอกสาร ถ้าทดสอบเวลา manual เทียบ AI ให้ใช้คน/งาน/กติกาเดียวกันและระบุการเรียนรู้จากรอบก่อน เผยแพร่ทั้งข้อจำกัดและตัวอย่างที่ต้องแก้ ไม่อ้างผล pilot เป็น population guarantee

## จุดแก้ใน source ที่ถูกต้อง

| ตำแหน่ง | ขอบเขตแก้ |
|---|---|
| `../mangmee_web/index.html` | outer metadata + JSON-LD + noscript และ JSON-encoded `__bundler/template`; แก้ทั้งข้อความจริงและ source ที่สร้างหน้า |
| `../mangmee_web/sitemap.xml` | lastmod ตามวันที่ significant content update จริง; ยังคง URL เดียวในชุดแรก |
| `../mangmee_web/_redirects` | ตรวจ 301 ที่ตั้งใจคงไว้; ไม่ลบเพื่อหวัง SEO โดยไม่มีแผนหน้าใหม่ |
| `../mangmee_web/robots.txt` | รักษา public crawl; ไม่ใช้ disallow แทน noindex ของระบบหลังบ้าน |
| `../mangmee_web/scripts/billing-catalog.spec.mjs` | ใช้ regression check เดิมเมื่อแตะ copy/CTA/template ของ marketing |
| `../mangmee_web/docs/agent-memory/` | บันทึก changed claims, source commit, preview/live verification และ publication state |

อย่าแก้ `apps/web/app/layout.tsx` ของ ERP เพื่อเปลี่ยน title ของ official งาน root public homepage ต้องเลือกกลไก routing ตาม R0 และแยก metadata/indexing ของ public กับ authenticated paths อย่างชัดเจน ไม่แก้ `package.json`

Structured data: คง WebSite/Organization/SoftwareApplication entities เดิมในการแก้ copy ถ้าย้าย canonical ต้องทำ URL และ `@id` mapping ให้สอดคล้องทั้ง graph ไม่คง official URL ที่ขัดกับปลายทางใหม่ ข้อมูลบริษัทต้องตรงผู้ประกอบการจริง ส่วน product name เป็นมั่งมีพลัส เพิ่ม sameAs เมื่อ verified profile หมายถึง entity เดียวกันเท่านั้น ไม่ใส่ reviewer/ratings/reviews ที่สร้างขึ้นเอง

## การวัดผลและข้อจำกัด attribution

- เก็บ exact queries `มั่งมีพลัส`, `MangmeePlus`, `มั่งมี plus` แยกกัน ไม่เปลี่ยนเป็น broad regex โดยไม่บันทึก สำหรับ non-brand ให้ใช้กลุ่มจาก query จริงที่เกี่ยวข้องเมื่อมีข้อมูล
- เก็บช่วง 28 วันที่ครบ: official host ก่อนย้าย และ root public URLs หลังย้าย + ประเทศไทย + mobile/desktop แยก; เก็บทั้งราย URL และภาพรวม URL ที่ย้ายเพื่อไม่ตีความ traffic ที่เปลี่ยน host ว่าหายไป หาก sample น้อย ขยายเป็น 56/84 วันและใช้ช่วงเปรียบเทียบที่เท่ากัน
- เก็บเวลาเริ่มใช้ข้อความใหม่จาก crawl/readback และการตลาดอื่นที่เกิดพร้อมกัน
- ตรวจระบบ analytics เดิมก่อนเพิ่มตัวใหม่: organic session, CTA click, signup completion, activation/payment ต้องเป็นคนละเหตุการณ์
- LINE short link เป็น external handoff; ห้ามตีความ outbound click เป็น signup success หรือสันนิษฐานว่า query string จะส่งถึงระบบปลายทาง ต้องตรวจ existing source tracking contract ก่อน
- ถ้าต่อ attribution ไม่ได้ ให้รายงานเฉพาะจำนวนคลิกและข้อจำกัด ไม่ต่อข้อมูลลูกค้าข้ามระบบหรือส่ง PII ให้ analytics เพื่อเติมช่องว่าง
- Google มีเอกสาร [Generative AI performance report](https://support.google.com/webmasters/answer/16984139) ให้ตรวจ availability/data ใน property จริงก่อนอ้างผล AI Search; baseline ที่เก็บรอบนี้ยังไม่ใช่รายงานแยก AI
- ไม่มี backend/API/data model/permission change ใน SEO content batch นี้ หากต้องเพิ่ม event ข้าม ERP/LINE ต้องมี spec/plan แยกตาม boundary เดิม

## เกณฑ์ตรวจรับ implementation

- [ ] Product: copy อธิบาย user journey, คนตรวจ/แก้ และขอบเขตที่ขายจริงครบ; case study/testimonial มีหลักฐานและสิทธิ์ใช้
- [ ] Architecture: source คือ marketing repo; initial/template/rendered title, description, canonical และ entity data สอดคล้อง
- [ ] Technical: canonical public `/`, robots, sitemap 200; official และ retired receipt redirects ตาม mapping ที่อนุมัติ ไม่มี loop; JSON-LD parse ผ่าน; public content ไม่ต้อง login
- [ ] Integration: mobile 390px/desktop 1440px อ่านครบ ไม่มี horizontal overflow; navigation/FAQ/LINE CTA/เข้าสู่ระบบใช้ได้; root migration ต้องตรวจ auth/callback/deep links เพิ่มตาม R0 และไม่เกิด signup/payment จากการทดสอบแบบอ่านอย่างเดียว
- [ ] Comprehension: ต้นแบบผ่านการตรวจความเข้าใจและหางานหลักตาม guideline; เก็บผลจริง ไม่ถือว่าเอกสารหรือต้นแบบที่เสร็จแล้วเท่ากับผู้ใช้เข้าใจ
- [ ] Evidence: สำหรับ logic ที่เพิ่มจริง มี focused runnable check ที่ล้มเมื่อเกิด regression; ใช้ check เดิมก่อนเพิ่ม framework
- [ ] Regression: รัน `node --test scripts/billing-catalog.spec.mjs` ใน marketing repo หากแตะ template/CTA และ `git diff --check`; บันทึกคำสั่ง/ผลจริง
- [ ] Performance: วัด PageSpeed/Lighthouse mobile แยกจาก field; ระบุ run/config และแก้เฉพาะ bottleneck ที่เห็น; ไม่มีข้อมูล CrUX ให้ระบุ insufficient data
- [ ] Search: หลังเผยแพร่ตรวจ URL Inspection/rendered content; request recrawl ครั้งเดียวเมื่อเนื้อหาเปลี่ยนสำคัญ แล้วรอ processing
- [ ] Publication: ใช้ release procedure ของ marketing จริง; ถ้ามี UAT/Production operation ตามขอบเขต runbook ให้ทำตาม [mandatory deployment protocol](../runbooks/uat-production-v2-deployment.md) และบันทึก exact run IDs/acceptance; ห้ามถือ CI success แทน live acceptance
- [ ] Measurement: แยก “เผยแพร่และตรวจผ่าน” ออกจาก “อันดับดีขึ้น” และ “ได้ลูกค้าเพิ่ม”; ยังไม่ปิด SEO outcome จาก technical checks

## งานภายหลังเมื่อมีเหตุผลรองรับ

หน้าเฉพาะ เช่น receipt tutorial หรือ employee expense workflow มีคุณค่าเมื่อมีเนื้อหาลึกและ query intent แยกจาก homepage หากเจ้าของเปลี่ยนนโยบายหน้าเดียวจึงจัดทำ spec/plan: URL จริง 200, self-canonical, substantive unique content, ordinary internal links, sitemap และ redirect mapping ที่ไม่ทับกัน ไม่มี thin pages เพื่อครอบทุก keyword

การย้าย official ไป root อยู่ในทิศทางที่บันทึกแล้ว แต่ต้องทำ R0 ก่อน implementation ไม่ซื้อเครื่องมือเสียเงิน ไม่สร้างบทความจำนวนมาก และไม่เพิ่ม automation เป็นเงื่อนไขเริ่มงาน แนวโน้ม AI Search, agent และ MINI App ใน guideline เป็นข้อมูลเตรียมพร้อม ไม่ใช่การอนุมัติสร้างฟีเจอร์ใหม่
