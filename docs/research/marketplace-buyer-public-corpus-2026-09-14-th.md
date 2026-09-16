# ตัวอย่างบิลและหลักฐานซื้อ marketplace: ชุดตั้งต้น 45 เคส

Status: Public reference collection complete; not an authenticated receipt set or an OCR evaluation set.
Reviewed: 2026-09-14
Related: [Solution spec](../specs/marketplace-buyer-expense-capture-spec-th.md) · [Implementation plan](../plans/marketplace-buyer-expense-capture-plan-th.md) · [ข้อมูลรายการ JSON](marketplace-buyer-public-corpus-2026-09-14.json)

## 1. ได้อะไรและนับอย่างไร

ตรวจภาพ/หน้าบิลสาธารณะด้วยสายตา **45 purchase/order cases: Shopee 15, Lazada 15, TikTok Shop 15** พร้อมตัวอย่างเสริมคืนเงินและ checkout 9 เคส ใช้ค้นหารูปแบบและข้อผิดพลาดเพื่อเขียน spec

| แพลตฟอร์ม | เคสหลัก | ไทย | ประเทศอื่น |
|---|---:|---:|---|
| Shopee | 15 | 8 | MY 5, ID 1, SG 1 |
| Lazada | 15 | 9 | VN 2, SG 2, MY 2 |
| TikTok Shop | 15 | 4 | VN 7, ID 2, PH 1, MY 1 |
| รวม | 45 | 21 | 24 |

คำว่า “45” หมายถึงเคสการซื้อ/order ที่ปรากฏในหลักฐานสาธารณะ **ไม่ใช่ใบเสร็จรับเงินที่พิสูจน์ความแท้แล้ว 45 ใบ ไม่ใช่ทั้งหมดเป็นเอกสารภาษี และไม่ใช่ 15 ใบไทยต่อแพลตฟอร์ม** มีทั้งภาพจากผู้ซื้อ เอกสารที่ผู้ใช้อัปโหลด ภาพในข่าว/บทความสอนใช้ และตัวอย่าง order ที่ร้านค้าเผยแพร่ ระบุบริบทใน JSON ทุกแถว

- หน้า/ภาพต่อของการซื้อเดียวกันนับหนึ่ง เช่น S06 มี order กับใบเสร็จภายหลัง และ S07/S11/S15/L15 มีหลายหน้า
- T08/T09 เป็นคนละ order ในภาพประวัติเดียวกัน; T12/T13 เช่นกัน จึงมี 45 เคสจาก 43 หน้าแหล่งอ้างอิง ไม่อ้างว่าเป็น 45 ไฟล์คนละใบ
- order รอชำระ/ยกเลิกยังนับเป็นกรณี purchase/order เพื่อทดสอบการไม่สร้างรายจ่ายผิด; refund-only และ checkout-only แยกนอกโควตา
- ไม่สร้าง mock receipt เพื่อเพิ่มจำนวน ไม่ใช้คำบรรยาย image search แทนการดูภาพ และไม่ยืนยันธุรกรรม/ผู้โพสต์จากภาพอย่างเดียว
- เปิด public viewer ของเอกสารที่เว็บให้ดูหลังโฆษณาตามปกติ ไม่ซื้อเอกสาร ไม่ login ไม่ข้าม paywall และไม่เข้าบัญชี marketplace ของผู้ใช้
- เก็บเฉพาะ URL ตำแหน่งภาพ และข้อสังเกตที่เขียนเอง ไม่คัดลอกชื่อ ที่อยู่ โทรศัพท์ เลขผู้เสียภาษีผู้ซื้อ หรือไฟล์บิลดิบเข้า repo; URL เอกสารต้นทางอาจมีเลขอ้างอิงสาธารณะอยู่แล้ว

ข้อมูลนี้ใช้เป็น reference catalog สำหรับออกแบบ ยังไม่ได้รัน OCR/extractor หรือทำ golden labels ที่คนตรวจรับ ไม่ใช้เป็น training set/redistribution set โดยถือว่าการเผยแพร่สาธารณะเท่ากับได้รับสิทธิ์ ก่อนทำ benchmark ต้องจัดชุดที่ได้รับสิทธิ์ ปิดข้อมูลส่วนบุคคล และเก็บเวอร์ชันที่ตรวจย้อนกลับได้

## 2. รายการที่ตรวจ

ตัวเลขเป็นสกุลของแต่ละประเทศตามคอลัมน์; TH=THB, MY=MYR, SG=SGD, ID=IDR, VN=VND, PH=PHP ข้อสังเกตมีทั้งสิ่งที่อ่านได้และสิ่งที่ต้องคง unknown ไม่ได้หมายความว่าทุกตัวเลขพร้อมลงบัญชี

### Shopee

| ID / แหล่งต้นทาง | ประเทศ / ชนิด | ตำแหน่งและข้อสังเกต |
|---|---|---|
| [S01](https://pantip.com/topic/42645584) | TH · รายละเอียดคำสั่งซื้อ | ภาพ sbzkj1…; ส่วนหัวรายการถูกตัด — หลาย variant ×6; subtotal 3948; shipping 23/-23; coupon -790; total 3158; มี badge คืนเงินบางรายการและเวลาจ่าย |
| [S02](https://pantip.com/topic/36918638) | TH · รายละเอียดคำสั่งซื้อ | ภาพ owy1pn… — 3 แถว จำนวน 1/3/25; 732-199-7=526; 700 Coins เท่ากับ7ในภาพเก่า ห้ามใช้เป็นอัตราปัจจุบัน |
| [S03](https://pantip.com/topic/41028687/desktop) | TH · ใบกำกับ/ใบเสร็จ | ภาพ r0nrep… — ผู้ออก aCommerce; channel shopee; 579=541.12+37.88; ภาพอย่างเดียวไม่ยืนยันลายเซ็น e-tax |
| [S04](https://pantip.com/topic/43855667) | TH · รายละเอียดคำสั่งซื้อ | ภาพ mi4bnr… — ราคาขีดฆ่า232 ราคาสินค้า116 รวม87; รายละเอียดส่วนลดพับอยู่; พบเวลาจ่าย/จัดส่ง ห้ามสร้างคูปอง29เอง |
| [S05](https://www.lemon8-app.com/@choice.chonam/7438290362239943184?region=th) | TH · รายละเอียดคำสั่งซื้อ | ภาพโพสต์ที่2 okX1f… — 33900+29-5000=28929; โค้ดปรากฏเป็น Shopee discount ไม่เดาผู้รับภาระจากคำบรรยายโปรบัตร |
| [S06](https://www.lemon8-app.com/@myhomeiswhite/7326896277181104642?region=th) | TH · order + ใบเสร็จร้าน | ภาพโพสต์ที่2และ3; หนึ่ง purchase case — order45900; ใบเสร็จอย่างย่อ47900 จาก48900-1000; ภาพแจ้งรอ e-tax; ผ่อน10งวด0%; ห้ามบวกสองเอกสารเป็นสองรายจ่าย |
| [S07](https://www.scribd.com/document/910836181/Receipt-241118gexcsjkt) | MY · ใบเสร็จ order | หน้า1ใน viewer หลัง Skip ad; หน้า2ไม่ได้นับเพิ่ม — 3 units; merchandise122.58 +ship7 +shipSST0.42 -shopvoucher35.55 -redeemedcoins1.62=92.83; ไม่ใช่ภาษีไทย |
| [S08](https://www.lemon8-app.com/@nilsaichon/7374077422742209040?region=th) | TH · รายละเอียดคำสั่งซื้อ | ภาพหลักที่3 oUCIgQf… — พัดลม999ขีดฆ่า→339; order289; ส่งแล้วมีคำขอคืนสินค้า; สินค้าแนะนำใต้orderไม่นับ |
| [S09](https://www.lemon8-app.com/@fonnonale/7386213724543091201?region=th) | TH · รายละเอียดคำสั่งซื้อ | ภาพหลักที่2 oMab3iB… — เสื้อ1003ขีดฆ่า→530; order420; มีเวลาจ่ายQR/จัดส่ง; ลูกศรสอนใช้ทับบางfield ไม่ใช่ข้อมูลธุรกรรม |
| [S10](https://www.scribd.com/document/856081766/receipt-250221QRKCA2FW) | MY · ใบเสร็จ order | หน้า1 public viewer หลัง Skip ad — POCO qty1;1529-platformvoucher120=1409 MYR; จ่าย21/02/2025 ต่างจากreceipt27/02/2025; ไม่เห็นshippingไม่เติม0 |
| [S11](https://www.scribd.com/document/772356679/Pakaian) | MY · ใบเสร็จ order | หน้า1–2ใบเดียว; ชื่อไฟล์ไม่ตรงสินค้า — กระเป๋าqty1;88.14+ship4.90+shipSST0.29-Shopee7-shop2=84.33 MYR; SPayLater; tax summary88.14/5.19ซ้ำ ไม่บวกเพิ่ม |
| [S12](https://www.scribd.com/document/892054568/lamp-2) | ID · ใบเสร็จ order | หน้า1 Nota Pesanan — อะไหล่ไฟ3แถว qty2/1/2;46897+ship13000+service1000-shipdiscount10000=50897 IDR; SeaBank |
| [S13](https://www.scribd.com/document/884684782/Receipt-2404219QNMU7C2) | MY · ใบเสร็จ order | หน้า1 public viewer — อะไหล่รถ16.50+ship4.90+shipSST0.29=21.69 MYR; SPayLater; tax summary4.90/0.29/5.19ไม่ใช่รายการเพิ่ม |
| [S14](https://www.scribd.com/document/938015381/7264184643-241211J2GHR7R6) | SG · ใบเสร็จ order | หน้า1 public viewer — Samsung1792.64-sellervoucher178-platformvoucher161.47=1453.17 SGD; ไม่เห็นshipping fieldให้unknown |
| [S15](https://www.scribd.com/document/850271955/invois-shopee) | MY · ใบกำกับภาษี | หน้า1–2 ตารางหลักและtax summary — 29product rows+row30shipping0;579.57+tax57.94-discount26=611.51 MYR; summary637.51ระบุexcluding discount; ชื่อสินค้าจีนซ้ำไม่ใช่แถวซ้ำ |

### Lazada

| ID / แหล่งต้นทาง | ประเทศ / ชนิด | ตำแหน่งและข้อสังเกต |
|---|---|---|
| [L01](https://pantip.com/topic/43051113) | TH · รายละเอียดคำสั่งซื้อ | ภาพ m2sjjf… — 11960+42-1794=10208; labelผ่อน0%อยู่ใกล้สินค้า ไม่ใช่หลักฐานว่าเลือกแผนผ่อนแล้ว |
| [L02](https://pantip.com/topic/39544475) | TH · รายละเอียดคำสั่งซื้อ | ภาพ q3qnjz… — 1260 shipping38; parent discount78 มีchildren40+38 ห้ามหักซ้ำ; ยอดปลายภาพถูกตัด |
| [L03](https://pantip.com/topic/42554372) | TH · order รอชำระ | ภาพ s9rh7d… — TotalVATIncl2330; Paid by QR; ยังมี Transfer2325 และ instantdiscount5; จึงยังไม่ยืนยัน paid |
| [L04](https://pantip.com/topic/41736667) | TH · order ยกเลิก | ภาพ rlhlc5… — CODยกเลิก;2999+41-180-23-80.34=2756.66; เงินคืนสะสมที่ถูกใช้ต่างจากเงินคืนอนาคต |
| [L05](https://aseannow.com/topic/1279488-lazada-at-it-again/) | TH · ใบเสร็จค่าส่ง | ภาพ lazada_pdf.JPG — ใบเสร็จค่าส่ง47; coupon0 storecredit0; ไม่ใช่ใบเสร็จค่าสินค้า |
| [L06](https://pantip.com/topic/41808441) | TH · ใบเสร็จค่าส่ง | ภาพ rnzw5h… — ใบเสร็จค่าส่ง45; referenceorder/package และreceiptnumberเป็นคนละidentity |
| [L07](https://pantip.com/topic/37028542/desktop) | TH · order ยกเลิก | ภาพ oyhu1p… — UIเก่า/พ.ศ.2560;365; สถานะยกเลิก ห้ามสร้างรายจ่ายจ่ายแล้ว |
| [L08](https://pantip.com/topic/37218683) | TH · order COD รอจ่าย | ภาพ qcestn…ในกระทู้/คอมเมนต์ — CODตู้เย็น7740; กำลังเตรียมจัดส่ง; ยังไม่มีหลักฐานรับชำระ |
| [L09](https://pantip.com/topic/36442776) | TH · รายละเอียดคำสั่งซื้อ | ภาพ oprn4l… — desktop order1880; หนึ่งpackage/สินค้า; ส่งแล้ว/รับประกันไม่ใช่หลักฐานรับเงิน |
| [L10](https://voz.vn/t/hoi-choi-cap-va-sac-tat-tan-tat-ve-cong-nghe-thuong-hieu-khuyen-mai.31588/page-4160) | VN · รายละเอียดคำสั่งซื้อ | ภาพscreenshot_20240324_210831_lazada — charger446000+ของแถม0+ship17000-platform42600-ship17000-store20000=383400 VND; เก็บของแถมแถว0 · [ภาพ](https://voz.vn/attachments/screenshot_20240324_210831_lazada-jpg.2401787/) |
| [L11](https://voz.vn/t/shop-tren-shopee-khong-giao-hang.943671/) | VN · รายละเอียดคำสั่งซื้อ | ภาพDBLiz6T.jpg; ชื่อกระทู้Shopeeแต่ภาพLazada — 846747+ship15000-110897-ship15000-4599-coins84675-refundbalance52699=593877 VND ชำระMoMo; badgeคืนเงิน; productname/variantขัดกันห้ามแก้เอง · [ภาพ](https://voz.vn/proxy.php?hash=eba0aa70a3b8c6652409b66ea1ff6bc6&image=https%3A%2F%2Fimgur.com%2FDBLiz6T.jpg) |
| [L12](https://www.scribd.com/document/833606401/220223012601306234) | SG · ใบกำกับภาษี | หน้า1 tax invoice13/01/2023 — สินค้า5.55+ship0.56=ก่อนGST6.11; GSTที่พิมพ์0.48; payment6.59 SGD; sellerต่างจากissuerLazadaSingapore; ไม่คำนวณทับภาษี |
| [L13](https://www.scribd.com/document/911296675/Sg-2025082601-IV-is-000033960451) | SG · ใบกำกับภาษี | หน้า1 tax invoice23/08/2025 — 2variants qty1แต่ละแถว7.18+12.74=19.92; ship1.37+GST1.92=23.21 SGD; แยกsellerกับlegal issuer |
| [L14](https://www.scribd.com/document/431585693/vcmxlcvmxm) | MY · บิลผู้ซื้อ | หน้า1 invoice12/05/2019 — สินค้า180; Subtotal184.80 แต่Total180+Shipping4.80→Net paid184.80 MYR; subtotalรวมส่งแล้ว ห้ามบวกซ้ำ; MOLPAY_MAYBANK_ONLINE |
| [L15](https://www.scribd.com/document/494585881/Invoice-html) | MY · ใบกำกับภาษี | หน้า1–2 invoice12/12/2017; ตารางเงินหน้า2 — EcartServicesMalaysia;65.94+GST3.96=69.90 MYR; ship/surcharge/storecredit0; tax summaryซ้ำ; ตัวเลข65.9/4ตัดบรรทัดต้องอ่านรวม; ภาษีเก่าไม่ใช่กฎไทย |

### TikTok Shop

| ID / แหล่งต้นทาง | ประเทศ / ชนิด | ตำแหน่งและข้อสังเกต |
|---|---|---|
| [T01](https://www.lemon8-app.com/@mrisablaaa_/7510438444531712529?region=id) | ID · สรุป order | ภาพโพสต์ที่2 ocBuE… — 109999+handling795+shipping69500-coupon40000-shippingcoupon60000=80294; จ่ายจริง/วันจ่ายไม่อยู่ในcrop |
| [T02](https://www.lemon8-app.com/@nipppin/7373568254477943312?region=th) | TH · รายละเอียดคำสั่งซื้อ | ภาพหลักที่2 owAAoTEQ… — Sabina SKU1แถม1 qty1;490+45-98-45=392 THB; bannerลด30ไม่หักซ้ำ; 1แถม1ไม่ใช่qty2ในบิล |
| [T03](https://riokupon.com/vn/blog/tra-hang-tiktok-o-dau-quy-trinh-tra-hang-hoan-tien-tiktok-nhu-the-nao/2570) | VN · รายละเอียดคำสั่งซื้อ | ภาพorderส่งแล้ว+panelเลือกเหตุผลคืน — กระเป๋าKate qty1ราคา299000 VND ส่ง18Jul; panelขวาซ้ำสินค้าเดิม ไม่ใช่แถวที่2; ไม่เห็นยอดจ่ายสุดท้าย · [ภาพ](https://img.riokupon.com/upload/images/2024/03/17/a65cc8f93145534f16a693f7caeabf9a.jpg) |
| [T04](https://pantip.com/topic/42088782) | TH · order ยกเลิก | ภาพrwv2qu… — 289 THB; สั่ง17Junยกเลิก18Junเพราะไม่จ่าย; Visaเป็นmethodไม่ใช่หลักฐานเงินออก; overlay26Junไม่ใช่orderdate · [ภาพ](https://f.ptcdn.info/976/080/000/rwv2qu1apa7r6i3YGe51V-s.jpg) |
| [T05](https://x.com/Labxskin/status/2057297198875074708) | TH · รายละเอียดคำสั่งซื้อ | ผู้ขายประกอบภาพ3ส่วนของorderในคำแนะนำรับสิทธิ์ — ตัวอย่างจากผู้ขาย:1499+ship29-coupons137.90-sellercoupons120-shipcoupons29-paymentdiscount1.24=1239.86 THB; PayLater; paymenttime30Mar2026; ความแท้ไม่ยืนยันอิสระ · [ภาพ](https://pbs.twimg.com/media/HIz82A9bAAAxPVc.jpg) |
| [T06](https://x.com/caluagnicole) | PH · รายละเอียดคำสั่งซื้อ | ภาพG3RogJ3…; profileURLไม่ใช่permalinkโพสต์ — Order placed conditioner319+ship83-coupon38.28-shipcoupon65=298.72 PHP; ordertotalไม่ยืนยันpaid · [ภาพ](https://pbs.twimg.com/media/G3RogJ3bgAAa6HX.jpg) |
| [T07](https://id.carousell.com/p/reveline-lipmatte-shade-brown-nude-1405006996/) | ID · รายละเอียดคำสั่งซื้อ | ภาพหลักฐานจากประกาศขายต่อ — Order completed lipmatte qty1ราคา51653 IDR; ปุ่มReceiptเป็นnavigationไม่ใช่ใบเสร็จที่เปิดแล้ว; summaryถูกตัด · [ภาพ](https://media.karousell.com/media/photos/products/2025/11/19/reveline_lipmatte_shade_brown__1763527975_aff6696d_progressive.jpg) |
| [T08](https://danviet.vn/nguoi-dung-ngan-ngam-vi-hang-gia-nhai-tren-tiktok-shop-tiktok-viet-nam-lam-gi-bai-2-20230505221815608-d1091932.html) | VN · order ในประวัติ | ภาพเดียวกับT09; orderบนต่างร้าน/สินค้า/วัน — ไม้ตียุง119000 VND qty1 total119000 ส่ง20Apr; couponbanner70K/55Kเป็นโปรถัดไป · [ภาพ](https://danviet.ex-cdn.com/files/f1/296231569849192448/2023/5/5/tiktok-shop-nguoi-dung-ngan-ngam-vi-hang-gia-tiktok-viet-nam-lam-gi-danvietvn-3-1683299313472419782753.jpg) |
| [T09](https://danviet.vn/nguoi-dung-ngan-ngam-vi-hang-gia-nhai-tren-tiktok-shop-tiktok-viet-nam-lam-gi-bai-2-20230505221815608-d1091932.html) | VN · order ในประวัติ | ภาพเดียวกับT08; orderล่างแยกจากorderบน — ไม้เซลฟี199000 VND qty1 total199000 ส่ง6Mar; สองorderในhistoryห้ามรวมเป็นcheckoutเดียว · [ภาพ](https://danviet.ex-cdn.com/files/f1/296231569849192448/2023/5/5/tiktok-shop-nguoi-dung-ngan-ngam-vi-hang-gia-tiktok-viet-nam-lam-gi-danvietvn-3-1683299313472419782753.jpg) |
| [T10](https://riokupon.com/vn/blog/cach-tra-hang-hoan-tien-tren-tiktok-chi-voi-vai-buoc-don-gian/2595) | VN · order ในประวัติ | orderSunnyVali; orderรองเท้าล่างตัดจึงไม่นับ — กระเป๋าเดินทาง439000 VND qty1 order389000 ส่ง2Oct; badge20Kไม่อธิบายdelta50000ครบ ห้ามเติมส่วนลด30000 · [ภาพ](https://img.riokupon.com/upload/images/2024/03/06/2ade5e7396f1486cb4b22b182f6bc667.jpg) |
| [T11](https://dienmaycholon.com/kinh-nghiem-mua-sam/cach-tra-hang-hoan-tien-tren-tiktok-cuc-nhanh-chong-khi-da-nhan-hang) | VN · รายละเอียดคำสั่งซื้อ | 2panelของorderเดียว — เสื้อขาว57000+เสื้อกั๊กดำ85400 VND qty1ต่อแถว; panelคืนสินค้าขวาซ้ำเสื้อกั๊ก ไม่ใช่แถวที่3; ไม่เห็นordertotal · [ภาพ](https://cdn11.dienmaycholon.vn/filewebdmclnew/public/userupload/files/Knms/dien-thoai-di-dong/chon-yeu-cau-tra-hang-hoan-tien-tick-vao-ly-do-tra-hang-va-nhan-tiep-tuc.jpg) |
| [T12](https://www.thegioididong.com/tin-tuc/cach-yeu-cau-hoan-tien-tren-tiktok-shop-1543353) | VN · order ในประวัติ | ภาพเดียวกับT13; orderต้นไม้บนpanelขวา — ชุดต้นไม้129999 VND qty1 total115399 ส่ง11Aug; panelซ้ายเป็นสินค้าแนะนำไม่นับ · [ภาพ](https://cdn.tgdd.vn/Files/2023/08/18/1543353/hoantientiktok5-280823-144830-800-resize.jpg) |
| [T13](https://www.thegioididong.com/tin-tuc/cach-yeu-cau-hoan-tien-tren-tiktok-shop-1543353) | VN · order ในประวัติ | ภาพเดียวกับT12; orderเสื้อOtisล่างpanelขวา — polo166000 VND qty1 total166000 ส่ง23Oct; overlayสลัวของtutorialไม่ใช่สถานะยังไม่จ่าย/ยกเลิก · [ภาพ](https://cdn.tgdd.vn/Files/2023/08/18/1543353/hoantientiktok5-280823-144830-800-resize.jpg) |
| [T14](https://pantip.com/topic/43214578) | TH · รายละเอียดคำสั่งซื้อ | ภาพsqflelg… — Glad2Glowชุด25g+25g qty1ราคา204 total199 THB; ส่งสำเร็จ; รีวิวรับคูปองเป็นrewardภายหลัง · [ภาพ](https://f.ptcdn.info/840/086/000/sqflelgse8L29nQFyyO4-o.jpg) |
| [T15](https://www.lemon8-app.com/@dearcapika/7584373711755624961?region=my) | MY · รายละเอียดคำสั่งซื้อ | ภาพหลักที่2 o48WADwEDAFRBw9f9gxB0QpDHBtaQERDEIfCA3 — eyeliner17.90 MYR; Order placed total0.10 มีcancel; ไม่มีbreakdownห้ามสร้างvoucher17.80; ภาพแก้ว29.90จากผลค้นหาไม่ใช่ภาพหลักนี้ |

### เคสเสริม ไม่รวมใน 45

| ID / แหล่งต้นทาง | ประเทศ / ชนิด | สิ่งที่ใช้ทดสอบ |
|---|---|---|
| [X-L01](https://pantip.com/topic/41740114) | TH · สถานะ/หลักฐานคืนเงิน | คืน989.55เข้าบัตรตามแพลตฟอร์ม; ผู้โพสต์บอกยังไม่เข้า ต้องแยกplatform reportedกับbank confirmed · [ภาพ](https://f.ptcdn.info/062/079/000/rlln951lwa9A3rb4lLBl5-o.jpg) |
| [X-L02](https://teeratech.com/posts/return-lazada-flash-express/) | TH · สถานะ/หลักฐานคืนเงิน | 45.56จากตรวจสินค้าคืนถึงคืนสำเร็จ; ไม่เพิ่มเป็นสองรายการเงินคืน · [ภาพ](https://teeratech.com/images/2021/07/return-lazada-flash-express-4.jpg) |
| [X-L03](https://www.lemon8-app.com/@kopaipongpong/7375768018070323713?region=th) | TH · สถานะ/หลักฐานคืนเงิน | คืน3425.64เข้าLazadaWalletพร้อมปุ่มถอน ไม่ใช่เข้าธนาคาร; ธุรกรรม-3427.31/+3425.64ต่าง1.67ไม่ทราบสาเหตุ/ยืนยันคู่IDไม่ได้ ห้ามเดาfee |
| [X-L04](https://hocvien.haravan.com/blogs/ban-hang-tren-lazada/doi-tra-hang-lazada) | VN · สถานะ/หลักฐานคืนเงิน | adidasคืน452056 VNDเข้าบัตร; orderปฏิเสธล่างไม่นับรวม · [ภาพ](https://file.hstatic.net/1000192210/file/chinh-sach-tra-hang-lazada_f51d447d772d40a5a11429fbc53e6941.jpg) |
| [X-S01](https://pantip.com/topic/43120003) | TH · สถานะ/หลักฐานคืนเงิน | พัดลม427กับของแถม0; refund531เป็นช่องแก้ไขคำขอที่ยังไม่ส่ง ไม่ใช่เงินคืนสำเร็จ · [ภาพ](https://f.ptcdn.info/348/086/000/m481in2fii9xKeauFm2-o.jpg) |
| [X-S02](https://pantip.com/topic/43050624) | TH · สถานะ/หลักฐานคืนเงิน | ชุดตุ๊กตา56คืนเข้าบัตรตามแพลตฟอร์ม; ไม่ใช่รายจ่ายใหม่ · [ภาพ](https://f.ptcdn.info/948/085/000/m2sawatui4qJwfaPLJz-o.jpg) |
| [X-S03](https://pantip.com/topic/40426643) | TH · หน้าก่อนสั่งซื้อ | 532+ship122-discount35=619; ย่อยร้าน268/200รวมไม่ตรง619; หลักฐานไม่พอ ห้ามสร้างร้าน/feeเพิ่ม; Coins to be earned2ไม่หักยอด · [ภาพ](https://f.ptcdn.info/148/072/000/qmed5eupd6cKqO0mEpH-o.jpg) |
| [X-T01](https://pantip.com/topic/43730383) | TH · สถานะ/หลักฐานคืนเงิน | อาหารแมว224.80 approved; processing/completedเป็นขั้นสีเทาในอนาคต; คาดการณ์KPlus9–11Sepไม่ใช่วันเงินเข้า · [ภาพ](https://f.ptcdn.info/155/089/000/mfdggqiyhPz1Vz0tqY9-o.png) |
| [X-T02](https://www.lemon8-app.com/@_kongfang/7530985704575287824?region=th) | TH · สถานะ/หลักฐานคืนเงิน | คืน194.65เข้าTikTokShopBalance25Jul2025; ไม่ใช่คืนเข้าธนาคารและไม่ใช่รายจ่ายใหม่ |

## 3. สิ่งที่เปลี่ยนจากการดูบิลจริง

| ข้อค้นพบ | หลักฐาน | ข้อกำหนดที่เพิ่มใน spec |
|---|---|---|
| มีคำว่า paid by QR แต่ยังมีปุ่มให้โอน | L03 | แยกวิธีชำระกับสถานะชำระ; ยังไม่เปิด paid-expense/certificate จาก method label |
| บิลร้านกับยอด order ไม่เท่ากันได้ | S06 | เก็บ invoice amount กับ buyer payable คนละ field; delta 2,000 คงรอหลักฐาน ไม่สร้างส่วนลดหรือบิลซื้อเพิ่ม |
| ส่วนลดบางส่วนพับ/ถูกตัด/เป็นโฆษณา | S04/S09/T10/T14/T15 | เห็น order total ไม่ได้แปลว่าแจกส่วนลดรายสินค้าได้; ไม่ให้ผู้ใช้เดาคูปองเพื่อผ่านหน้าจอ |
| subtotal อาจรวมค่าส่งแล้ว | L14 | ใช้ความหมายและสมการของทั้งเอกสาร ไม่แมปชื่อ subtotal เป็นยอดสินค้าทุกกรณี |
| ตารางภาษีแสดงเงินซ้ำและอาจใช้ฐานก่อนส่วนลด | S11/S13/S15/L15 | แยก summary/reference จาก charge; S15 total 611.51 กับ summary 637.51 ไม่บวกกัน |
| แถว / จำนวนชิ้น / ของแถมมีคนละความหมาย | S02/S12/S15/L10/T02/T11 | เก็บ quantity และ variant ต่อแถว; ชื่อซ้ำหรือ panel ซ้ำต้องพิสูจน์ identity ก่อนรวม |
| refund completed บางครั้งเป็นชื่อขั้นอนาคต | X-T01 | อ่าน current step/style กับเวลา ไม่รับทุกคำใน timeline เป็น event สำเร็จ |
| เงินคืนเข้า wallet ยังไม่ได้เข้าธนาคาร | X-L03/X-T02 | แยก refund destination, platform status และ bank settlement |
| history ภาพเดียวมีหลาย order ที่ซื้อคนละวัน | T08/T09/T12/T13 | แยก scope ก่อน grouping; upload batch ไม่เท่ากับ checkout |
| ภาพถูกค้นเจอผิด platform หรือเป็นภาพแนะนำ | L11/T15 | ใช้ภาพและบริบทโพสต์จริง; ชื่อกระทู้หรือคำบรรยาย search เป็นเพียงเบาะแส |
| seller/store กับ legal issuer อาจต่างกัน | S03/L12/L13 | ยืนยันขอบเขตเอกสารตามผู้ออกจริง และแยกใบเสร็จค่าส่ง L05/L06 จากค่าสินค้า |
| BNPL มี payment time ได้แต่ยังไม่บอกใครสำรองจ่ายเงินสดเท่าไร | S06/S11/S13/T05 | เก็บเครื่องมือชำระกับ funding evidence; รุ่นแรกคง review/pause สำหรับ BNPL |

ผลเชิงผลิตภัณฑ์: ใช้ upload/review เดิม แต่เพิ่มการอ่าน “โครงสร้างและความสัมพันธ์” ของหลักฐาน แล้วถามคนเฉพาะ facts ที่ยังขาด ระบบคำนวณตามหลักฐานได้เมื่อขอบเขตชัด; เมื่อไม่ชัดต้องเก็บร่างหรือรับหลักฐานเพิ่มโดยไม่ทำให้รายจ่าย/สิทธิเบิกสำเร็จผิด ๆ

## 4. official กับสิ่งที่อนุมานจากตัวอย่าง

[TikTok Shop Thailand: การออกใบกำกับภาษี/ใบเสร็จสำหรับผู้ซื้อ](https://seller-th.tiktok.com/university/essay?knowledge_id=5469434382845697&lang=th-TH) ระบุผู้ขายเป็นผู้ออกเอกสาร และแพลตฟอร์มช่วยรวบรวมข้อมูลผู้ซื้อ (หน้าอัปเดต 13 มีนาคม 2569 ตรวจเปิดได้ในรอบนี้) จึงรองรับการออกแบบให้แนบใบจากร้านภายหลังและรักษาความสัมพันธ์กับ order เดิม

[Shopee Help: ใบเสร็จคำสั่งซื้อ](https://help.shopee.co.th/portal/4/article/80536) เปิดได้เป็น JavaScript shell ในการตรวจซ้ำ จึงไม่ใช้ยืนยันรายละเอียดข้อความปัจจุบันเพิ่มเติม; [งานค้นคว้าก่อนหน้า](marketplace-buyer-receipt-brainstorm-2026-09-14-th.md#2-ข้อค้นพบจาก-official-และข้อจำกัด) แยกข้อจำกัดของ official indexed developer content ไว้แล้ว ไม่อ้างว่าทดสอบ buyer API ทั้งสามแพลตฟอร์ม

[กรมสรรพากร มาตรา 82/5](https://www.rd.go.th/5206.html) เป็นเหตุให้แยกการตรวจหลักฐานภาษีซื้อออกจากการอ่านยอดตรง/การเตรียมเบิก ไม่ใช้ตัวอย่าง GST/SST ต่างประเทศกำหนดภาษีไทย และไม่อ้างว่าใบรับรองแทนใบเสร็จให้สิทธิภาษีซื้อโดยอัตโนมัติ

กฎการปันส่วน shared discount, ผู้รับภาระคูปอง, coins/wallet ส่วนตัว, BNPL และการจัดการเงินคืนหลังเบิกยังเป็น policy/design decisions ที่ต้องยืนยันตามบริษัทและหลักฐาน ไม่ใช่กฎ official ที่พิสูจน์จาก 45 ภาพ

## 5. ช่องว่างที่ต้องปิดก่อนนำไปทดสอบเพื่อปล่อยใช้

1. **ชุดไทยปัจจุบันที่ครบสายการซื้อ**: หลายร้าน + หลายสินค้า + สรุปชำระรวม + order รายร้าน + หลักฐานผู้จ่าย + ใบเสร็จ/ใบกำกับที่ตามมา ต้องมีทุกแพลตฟอร์ม ขณะนี้ X-S03 เป็น checkout ก่อนสั่งและยอดย่อยไม่ตรง ไม่ใช่ positive multi-store paid bundle
2. **ส่วนบริษัท/ส่วนตัว**: ชุดจริงที่เจ้าของข้อมูลยืนยันจำนวนที่ใช้บริษัท ผู้จ่าย และนโยบายแจกส่วนลด/ค่าส่ง ภาพสาธารณะไม่สามารถบอก business purpose หรือ reimbursement eligibility ได้
3. **เอกสารไม่ครบและใบรับรองแทนใบเสร็จ**: ชุดที่เข้า eligibility จริง มีข้อเท็จจริงจ่ายเงิน เหตุผลไม่มีใบเสร็จ actual signer และ PAPER/DIGITAL ที่ได้รับอนุญาตให้ทดสอบ
4. **การซ้ำและแก้ย้อนหลัง**: order เดียวคนละภาพ/คนละ upload, ใบเสร็จตามมา, คืนบางชิ้น, คืนบางส่วนหลังเบิก, payment/refund wallet และบุคคลที่อัปโหลดต่างจากผู้จ่าย
5. **ขอบเขตและการอ่านไม่ครบ**: ภาพยาว ภาพตัด หลายหน้า สินค้าชื่อซ้ำ/หลาย variant ของแถม และเกิน limit ต้องมี expected unknown/incomplete labels
6. **แยกชุดปรับ prompt กับ held-out evaluation ตาม purchase identity**: ภาพ/หน้าต่างกันของการซื้อเดียวห้ามข้ามชุด; ป้องกัน tutorial สองpanelหรือเว็บที่ repost รูปเดียวทำให้ผลดูดีเกินจริง

วัด exact amount/currency/scope, item completeness, payment/refund state, unknown detection และ false-confident financial readiness แยกจากเวลาที่คนแก้และต้นทุน/latency ของ AI จำนวน 45 เป็นเป้ารวบรวม reference ไม่ใช่เกณฑ์ความแม่นยำหรือหลักฐานว่าครบทุก layout

## 6. ผลต่อหกมุมและทางออกผู้ใช้

| มุม | สิ่งที่ควรได้จาก solution |
|---|---|
| UX อายุ 40+ | ทางเข้ารูปเดิม สรุปยอดบริษัท/ผู้จ่ายที่อ่านง่าย เห็นเฉพาะปัญหาที่ต้องตอบ เพิ่มภาพหรือพักได้ ไม่มีข้อบังคับให้รู้คำว่า voucher allocation |
| BA | นิยาม purchase/evidence/payment/claim ต่างกัน; กติกาและ acceptance ผูก sample ID ได้ |
| SA | capture ไม่ลงบัญชี; lineage และ revision เดียวป้องกันบิลซ้ำทุกทาง; derived source ใช้กฎ expense/claim เดิม |
| AI Engineer | source references ต่อ field แยก extracted/inferred/policy-derived; deterministic reconciliation; ไม่ฝืนให้ครบด้วยค่าที่แต่ง |
| ผู้ประกอบการ | พนักงานไม่กรอกซ้ำ บัญชีเห็นจุดติดขัด วัดเวลาคนทำงานจริงและค่าอ่านต่อเคส; เปิดตามความสามารถที่ทดสอบผ่าน |
| บัญชี | original amount, invoice/tax, เงินจ่าย, เงินคืน, ส่วนบริษัทและยอดเบิกแยกตรวจได้; ใบรับรองใช้เมื่อเข้าเกณฑ์และไม่จ่ายซ้ำ |

ทางหลักยังเป็น **อัปโหลดเดิม → ตรวจสรุป/ส่วนบริษัท/ผู้จ่าย → ตรวจหลักฐานหรือทำใบรับรองเมื่อเข้าเกณฑ์ → ค่าใช้จ่าย/ใบเบิกเดิม** การเก็บร่างเป็นทางออกจริงที่รักษางานไว้ ไม่ใช่ข้อความสำเร็จแทนการอนุมัติหรือจ่ายเงิน
