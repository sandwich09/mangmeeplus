# ผลตรวจบั๊ก ช่องว่าง และผลกระทบระบบผู้บริหารมั่งมี

คำที่แสดงบนหน้าจอล่าสุด: [ใช้คำที่คนทั่วไปเข้าใจ](../specs/mangmee-executive-plain-language-spec-th.md) — เมนู “รายรับ”, แท็บ “ลูกค้าที่สร้างรายรับสูง”; identifiers/สูตรเดิมคงไว้

## สถานะล่าสุดหลัง Owner พักการลบข้อมูล

**ยังไม่มี G01–G35 ข้อใดปิดด้วย implementation และ regression evidence** การเขียนวิธีแก้ไว้ในสเปกไม่ใช่การแก้ในระบบ

| สถานะ | จำนวน | ขอบเขต |
|---|---:|---|
| OPEN_NOT_IMPLEMENTED | 22 | G01–05, G11–24, G26–27, G35: รายงาน/สิทธิ์/บัญชี/ข้อมูล/เดโม ยังต้องแก้และตรวจเมื่อเริ่ม implementation |
| DEFERRED_DELETION | 13 | G06–10, G25, G28–34: พักตาม Owner; ไม่ใช่ FIXED หรือ CLOSED |
| CLOSED_VERIFIED | 0 | ยังไม่มีหลักฐานปิด bug/gap ใน application |

G35 ยังคงเปิดสำหรับ pagination/HTTP/account activation; ส่วน retention forms พักไว้
G25 พักเฉพาะ case PII; หลัก least privilege และการไม่เปิดข้อมูลธุรกิจ/PII ในรายงานยังเป็นเกณฑ์ปัจจุบัน
G31 พักการออกแบบ retained facts หลัง purge; รายงานยังต้องไม่ทิ้ง cash facts เดิมจาก join ที่ทำข้อมูลหาย
งานซ่อนฟีเจอร์ในเดโมเป็นการเปลี่ยน scope และตรวจ presentation แยก ไม่ใช่การแก้ data-rights guard หรือปิด G25 ในระบบจริง
รายละเอียด/impact ของการลบด้านล่างเก็บเป็น backlog อ้างอิง ไม่มีงาน executor ใน release scope ปัจจุบัน

วันที่: 2026-10-01
สถานะ: **SOURCE AUDIT และ DESIGN REVIEW — ไม่มี application code เปลี่ยน ไม่มี live API mutation**
ขอบเขต: EX-01–08, มติ B1–B8, เดโม v2, source ปัจจุบันใน working tree และโมดูลที่ต้องพึ่งพา

ผลหลัก: หน้าจอจำลองใช้คุย UX ได้ แต่ยังต่อเข้าระบบเดิมตรง ๆ ไม่ได้ ต้องเพิ่ม platform reader,
แหล่งข้อมูล cash/activity ที่มีความหมายตรงรายงาน, account lifecycle; hold guard ของ data-rights พักไว้ตามมติล่าสุด
บั๊ก/ข้อจำกัดที่ตรวจพบด้านล่างยังไม่ได้แก้โค้ดตามคำขอผู้ใช้

- [สเปก BE](../specs/mangmee-executive-business-backend-spec-th.md)
- [ชุดจำลอง E2E](../qa/mangmee-executive-business-e2e-simulation-2026-10-01-th.md)
- [แผน implementation ภายหลัง](../plans/mangmee-executive-business-backend-plan-th.md)

## 1. ระดับความเชื่อมั่นและขอบเขตตรวจ

- **BUG**: source มีพฤติกรรมที่ขัด requirement หรือมี failure path ชัดเจน; ระบุวิธีเกิดและหลักฐาน
- **GAP**: capability/contract/data ที่ฟีเจอร์ใหม่ต้องใช้ยังไม่มี ไม่กล่าวหาว่าฟีเจอร์เดิมเสีย
- **DEMO**: ข้อจำกัดของ fixture/local state ที่ห้ามยกเป็น implementation
- **RISK**: failure ที่ต้องกันเมื่อเชื่อมกัน ยังไม่ได้พิสูจน์ว่าเกิดกับข้อมูลจริง
- P0 = ปิด gate ก่อนเปิด destructive/security flow; P1 = ต้องแก้ก่อนรับ integration; P2 = ความครบ/การปฏิบัติการ

อ่าน source ที่ checkout นี้รวม uncommitted changes ตามเวลาตรวจ ไม่ได้พิสูจน์สิ่งที่ deploy อยู่
ไม่มีการอ่าน cloud inventory, ต่อ production/UAT DB, สร้าง account, ส่ง email หรือเรียก provider
ค้น endpoint/role ใหม่ไม่พบใน route/registry ที่ตรวจ; ผลนี้ไม่ใช่ HTTP 404 จาก server ที่รันจริง

## 2. หลักฐาน source ที่ตรวจ

| Evidence | Source และตำแหน่งสำคัญ | สิ่งที่ยืนยัน |
|---|---|---|
| E01 | [SystemLayout](../../apps/web/app/system/layout.tsx), [session gate](../../apps/web/src/common/auth/session-gate.logic.ts), [users redirect](../../apps/web/app/system/users/page.tsx) | shell รองรับ SYSTEM_ADMIN/billing subtree; users redirect partners |
| E02 | [AuthGuard](../../apps/api/src/modules/auth/presentation/auth.guard.ts), [context resolver](../../apps/api/src/modules/auth/application/use-cases/resolve-request-context.use-case.ts), [permission resolver](../../apps/api/src/modules/access-control/infrastructure/prisma-permission-resolver.repository.ts) | session recheck, header/route conflict, platform closed, oldest active membership fallback |
| E03 | [permission registry](../../apps/api/src/modules/auth/permission-registry.ts), [deny-by-default](../../apps/api/src/common/security/deny-by-default.guard.ts), [sales context](../../apps/api/src/modules/sales-console/application/sales-context.ts) | existing platform roles/explicit permissions; sales ตรวจ platform tenant เพิ่มเติม |
| E04 | [Prisma schema](../../apps/api/prisma/schema.prisma) Company306, User575, AuthSession635, DataRightsCase712 | ไม่มี executive role endpoint/hold columns/classification/entity ที่ครบตามรายงาน; global identity |
| E05 | [signup contract](../../packages/contracts/src/external-signup.ts), [normalizer](../../apps/api/src/modules/external-signup/domain/line-signup.logic.ts), [submit](../../apps/api/src/modules/external-signup/application/submit-company-signup.use-case.ts) | canonical WEBSITE/IG/TIKTOK/FACEBOOK/SALES/OTHER; seller conditional |
| E06 | [company detail](../../apps/api/src/modules/system-partner-management/application/use-cases/get-partner-detail.use-case.ts), [directory](../../apps/api/src/modules/system-partner-management/application/use-cases/list-partners.use-case.ts) | original signup join; partner metadata allowlist; no test/internal exclusion in directory |
| E07 | [sales reports](../../apps/api/src/modules/sales-console/application/sales-reports.service.ts), [sales logic](../../apps/api/src/modules/sales-console/domain/sales-attribution.logic.ts) | 5000row cap ไม่มี completeness marker; source/grain/flag/refund rules |
| E08 | [BillingInvoice schema](../../apps/api/prisma/schema.prisma), [paid invoice](../../apps/api/src/modules/billing/domain/paid-invoice.ts), [checkout paid invoice](../../apps/api/src/modules/billing/domain/paid-checkout-invoice.ts), [reconciler](../../apps/api/src/modules/billing/application/billing-reconciler.service.ts) | cash paidAt ไม่ durable ครบทุก path; invoice totals/service periods ไม่เท่า cash events |
| E09 | [financial observation](../../apps/api/src/modules/billing/application/billing-financial.ts), [refund source](../../apps/api/src/modules/billing/application/billing-refund-source.ts), [billing admin](../../apps/api/src/modules/billing/application/billing-admin.service.ts) | cumulative refunds, provider validation, separate billing capabilities/company scopes |
| E10 | [AI meter](../../apps/api/src/modules/line-ai/application/company-ai-usage-meter.ts), [partner AI usage](../../apps/api/src/modules/system-partner-management/application/use-cases/get-partner-ai-usage.use-case.ts), schema AiUsageEvent3910/OcrUsage4066/AiTurn1656 | callCount increments model rows; ok/cost adjustment/admission/turn outcome different grains |
| E11 | [data-rights controller](../../apps/api/src/modules/data-rights/data-rights.controller.ts), [service](../../apps/api/src/modules/data-rights/data-rights.service.ts) approve532/startExecution562/assertOperator937 | required intake; role+manage; actor segregation; no hold guard or purge executor |
| E12 | [data-rights contract](../../packages/contracts/src/data-rights.ts), [FE API](../../apps/web/src/features/system-data-rights/data-rights.api.ts), [validation options](../../apps/api/src/common/pipes/validation-pipe.options.ts) |12categories, scope matrix, evidence, strict DTO unknown fields; frontend DTO ไม่มี hold |
| E13 | [data-rights service tests](../../apps/api/src/modules/data-rights/data-rights.service.spec.ts), [controller tests](../../apps/api/src/modules/data-rights/data-rights.controller.spec.ts) | ผ่าน 58focusedtests รวมชุดข้างเคียง; test approve→execute ทันทีแสดง absenceofhold |
| E14 | [lifecycle transition](../../apps/api/src/modules/system-partner-management/application/use-cases/partner-lifecycle-transition.use-case.ts), [plan term limit](../../apps/api/src/modules/system-partner-management/application/plan-term-limit.ts) | archive update ไม่ใช่ full offboarding; seat/platform relation ต้องแยก |
| E15 | [P31 spec](../specs/mangmee-company-data-lifecycle-deletion-spec-th.md), [object inventory logic](../../apps/api/src/modules/data-model-core/domain/logic/object-version-inventory.logic.ts) | existing inventory primitives; P31 บางข้อเป็น historicalproposal ไม่ใช่ปัจจุบันที่ตรวจครบ |
| E16 | schema static model inventory 2026-10-01 (อ่านในเครื่อง) |201models มี field companyId;27 ไม่มี direct Company relation; ไม่เท่ากับ 27orphan |
| E17 | `executive-preview.tsx`, `check-demo.cjs` ตาม [task memory](../agent-memory/executive-business-demo.md) | localfixture/filter/form/role/hold logic; ไม่มี API call |
| E18 | [system admin E2E](../../e2e/system-admin.spec.ts), [sales E2E](../../e2e/sales-console.spec.ts) | มี browser paths เดิมให้ต่อ regression; รอบนี้ไม่ได้รัน E2E ที่แตะ server |

## 3. รายการบั๊กและช่องว่าง

| ID | ระดับ/ชนิด | Trigger และสิ่งที่พบ | ผลกระทบ | แนวแก้ใน spec / ผู้รับผิดชอบ | สถานะล่าสุด |
|---|---|---|---|---|---|
| G01 | P1 GAP | เปิด EX-01–04 แต่ยังไม่มี executive routes/contracts/aggregate service ในแอป (E01/E03/E17) | fixture ผ่านไม่แปลว่ามีรายงานจริง | BE§11/16; executive module+FE | OPEN_NOT_IMPLEMENTED |
| G02 | P1 GAP | reader ไม่มี SYSTEM_ADMIN เข้า /system/executive ถูก shell ปฏิเสธ (E01) | ผู้บริหารอ่านอย่างเดียวเข้าไม่ได้ | §17; auth/shell ไม่แก้ด้วย grantadmin | OPEN_NOT_IMPLEMENTED |
| G03 | P1 RISK | user มี tenantmembership เก่ากว่า platform membership; resolver/landing เลือก company เดิม (E02) | redirect ผิด/403/context ผิด | §17.2; explicit platform context+returnpath | OPEN_NOT_IMPLEMENTED |
| G04 | P0 RISK | เพิ่ม permissionstring แล้วตรวจเพียงชื่อ role จาก tenant custom role (E02/E03) | ขยายอ่านข้าม tenant | §17.1; verify role provenance+platform membership | OPEN_NOT_IMPLEMENTED |
| G05 | P1 GAP | ฟอร์มบัญชีมี name/email แต่ไม่มี activation/enrollment/sessionpolicy (E04/E17) | บันทึกแล้ว login ไม่ได้ หรือปิดสิทธิ์แล้วกระทบ tenant งานอื่น | §17.3/Q01; identity | OPEN_NOT_IMPLEMENTED |
| G06 | P1 GAP | ส่ง demo request company/reference/reason ตรง CreateCaseDto (E11/E12/E17) |400missingcommandId/requestKey/caseType/source/dueAt; extrafields ถูก reject | §18.1; FE/BEadapter ที่ไม่ทิ้งเหตุผล | DEFERRED_DELETION |
| G07 | P0 DEMO | ปุ่มจำลอง approve เปลี่ยน RECEIVED→APPROVED ทันที (E11/E17) | ข้าม identity/authority/12decision และ actorchecks หากยกไปใช้จริง | §18.2; reusefull workflow | DEFERRED_DELETION |
| G08 | P0 BUG เทียบมติใหม่ | startExecution หลัง approve ทันทีผ่านเมื่อ actor ต่างกันและ retention ครบ; ไม่มี 14dayguard/columns (E11/E13) | workflow เริ่ม execution ก่อนกำหนดได้; ตัวนี้ยังไม่ลบจริง | §18.3; data-rights guard+workers ก่อนเปิด executor | DEFERRED_DELETION |
| G09 | P1 GAP | P31 กำหนด single admin แต่ code ห้าม creatorapprove/approverexecute/executorverify (E11/E15) | เจ้าของคนเดียวเดินเคสไม่ครบ;4executives ไม่แก้ policy | Q06; policydecision แล้วทดสอบสอง mode | DEFERRED_DELETION |
| G10 | P0 GAP | evidenceURI+hash รูปแบบถูกถูกยอมรับแต่ไม่มี resolve หลักฐานจริง; P31 E3 ยังปะปน proof ก่อน/หลัง execute (E11/E12/E15) | closingcase ไม่พิสูจน์ purge/provider completion; ถ้าบังคับผลลบก่อน execute จะวนติด guard | §18.3/19; แยก preflight จาก machine-producedexecution evidence | DEFERRED_DELETION |
| G11 | P1 GAP | สรุป monthlycash จาก invoicecreatedAt/periodStart/financialObservedAt (E08) | เงินเข้าผิดเดือน/ช้าแล้วไปเดือนใหม่ | §14; billing effective movements | OPEN_NOT_IMPLEMENTED |
| G12 | P1 GAP | refund หลายเดือนใช้ cumulativerefundedSatang และ joincreditnote อีก (E09) | ย้อนลดผิดเดือน/หักซ้ำ/ยอด net ผิด | §14.2; unique native movement id | OPEN_NOT_IMPLEMENTED |
| G13 | P1 GAP | ใช้ partnerdirectory เป็น population โดยตรง ไม่มี CUSTOMER/TEST/INTERNALsource (E04/E06) | บริษัทภายใน/ทดสอบปน KPI;exclude จากชื่อก็ผิด | §12.2/Q02 | OPEN_NOT_IMPLEMENTED |
| G14 | P1 GAP | entity ใน fixture มีบริษัท/ห้าง/บุคคลแต่ Company ไม่มี canonicalfield ชุดนี้ (E04/E17) | grouping เดาจากชื่อ/เลขภาษีผิด | §15/Q05; companyidentity | OPEN_NOT_IMPLEMENTED |
| G15 | P1 GAP | businessCategory ใช้ privacytripwire ไม่ใช่ industry; mappingbusinessType ยังไม่ตกลง (E04) | segmentation ผิดและอาจกระทบ privacyrule หาก reuse ผิด | §15/Q05; explicitmapping | OPEN_NOT_IMPLEMENTED |
| G16 | P1 GAP | นับ AiUsageEvent.callCount/OCRadmission เป็นใช้งานสำเร็จ (E10) | errors/retries/internalcalls กลายเป็น active customer | §13.3; activitytaxonomy/dedup | OPEN_NOT_IMPLEMENTED |
| G17 | P1 GAP | นับ members เป็น activeusers/sessionupdatedAt เป็น login (E04/E10) | engagement/firstuse ผิด;หลาย tenant นำ login เดียวไปนับทุกบริษัท | §13.1/Q03; actor/timeproof | OPEN_NOT_IMPLEMENTED |
| G18 | P1 RISK | joininvoices×signup×activity แล้ว sum/count, หรือ sumdistinctusers ข้ามบริษัท (E04/E08/E10) | ตัวเลขคูณ/คนซ้ำ | §13.1/20.2; aggregate แต่ละ grain ก่อน join | OPEN_NOT_IMPLEMENTED |
| G19 | P1 BUG มีเงื่อนไข | SalesReportsService.summary take5000 ไม่มี marker เมื่อเกิน cap (E07) | รายงานเซลล์หรือ exec ที่ reuse ตัดยอดเงียบเมื่อ 5001rows ขึ้นไป | §14.3; completeaggregate หรือ explicitincomplete;ไม่จำเป็นต้องมีข้อมูลจริงถึงเกณฑ์แล้ว | OPEN_NOT_IMPLEMENTED |
| G20 | P1 RISK | GetPartnerDetail คืน referralSales:null เมื่อ profile หาย; demoNONE ถ้ามี channel แต่ seller ว่าง (E06/E17) | attribution ที่เคยมีถูกอ่านเป็นไม่มี | §15; taggedunknown/unresolved | OPEN_NOT_IMPLEMENTED |
| G21 | P1 DEMO | creditedfixturessumamount โดยไม่ใช้ flags/refundrule;fee คำนวณ 3%ทุกบริษัท (E17) | ยก fixtureformula ไปจริงจะผิดการเงิน/เครดิต | §14;ใช้ verifiedfees และ salesdomain | OPEN_NOT_IMPLEMENTED |
| G22 | P1 DEMO | directory มี entity/usage/service เดิม แล้วกด cohort/industrydrilldown; drill เปลี่ยนเพียง key/query (E17) | hiddenlistfilters ตัดบริษัทจน cardcount กับ list ไม่ตรง | §12.4; explicitchips/reset เมื่อ drilldown | OPEN_NOT_IMPLEMENTED |
| G23 | P1 GAP | overview/list/pages อ่านคนละเวลาและ sorttie ไม่มี snapshot (E17) | page ซ้ำ/หาย/total เปลี่ยนใต้ filter เดิม | §12.3;consistent snapshot+cursorbinding | OPEN_NOT_IMPLEMENTED |
| G24 | P1 DEMO | receiptTrend bar=Math.max(2,value/max*100); fixtures ไม่มี refund-onlynegative (E17) | negativecash วาดแท่งบวกเล็กผิดความหมาย | §14.2;FEnegativebaselineacceptance | OPEN_NOT_IMPLEMENTED |
| G25 | P1 DEMO | reader ซ่อน mutation แต่ยังเห็น case reference/reason ใน localdetails (E17) | read-onlyreport อาจเปิด requesterPII/evidence โดยไม่ได้สิทธิ์ | §17.1/Q06;summaryprojection และ separatepermissions | DEFERRED_DELETION |
| G26 | P1 GAP | account status boolean/in-memory duplicate check ไม่มี version/DBraceguard (E17/E04) | doublecreate/lostupdate/last manager lockout | §16.3/17.3;transaction+identitypolicy | OPEN_NOT_IMPLEMENTED |
| G27 | P1 RISK | refresh/query เปลี่ยนแล้ว oldresponse กลับหลัง;permission ถอนแต่ cachedpayload ยังอยู่ | KPI ผิด context/ข้อมูลยังเปิดได้ | §12.3/16.3;requestgeneration+revalidation+invalidation | OPEN_NOT_IMPLEMENTED |
| G28 | P0 RISK | archivecompany แล้วคิดว่า session/LINE/billing/jobs หยุดและข้อมูลถูกลบครบ (E14) | writer/collection ยังทำงานหรือ state ไม่ตรง | §19;fullinventory+fence;ไม่กล่าวว่า HTTPguard เดิมเปิดทุก route | DEFERRED_DELETION |
| G29 | P0 RISK | purgeCompany ก่อน inventory objectversions/indirectFK/globaluser (E04/E15/E16) | FKrollback/orphan/ข้าม scope/locator หาย | §19;manifest+scopedexecutors;ห้าม massCASCADE | DEFERRED_DELETION |
| G30 | P0 RISK | TTL/storage lifecycle/cleanup/worker ลบก่อนครบ hold หรือ restore นำข้อมูลกลับ (E15) | ผิดกฎ all-data14 วัน/erasure กลับมา | §19/Q07/Q08;hold guard ของทุก producer+restoremanifest;cloudconfig ยังไม่ตรวจ | DEFERRED_DELETION |
| G31 | P1 GAP | company ถูกลบแต่ BillingAccount/SalesAttribution ยังอยู่;reportinnerjoinCompany (E04/E08/E16) | เงินประวัติหาย หรือเก็บ PII เกิน retention | §12.2/19/Q08;retained fact projection | DEFERRED_DELETION |
| G32 | P1 GAP | demo ไม่แยก dueAt/holdEndsAt/retentionUntil หรือ scopeedit/cancelrace (E11/E17) | เวลานับผิด/ลบ scope ที่ยังไม่อนุมัติ | §18.3/Q07;3clocks+scope hash+atomictransition | DEFERRED_DELETION |
| G33 | P1 DEMO | localcreateRequest ไม่มี overlapguard และไม่มี EMAILidentityproof (E11/E17) | หลาย case ซ้อน scope/อนุมาน email เป็น verified | §18.1;reuse existing overlap locks | DEFERRED_DELETION |
| G34 | P2 GAP | P31inventory เลข 194/20orphan และข้อสรุป config/กฎหมายจากรอบเก่า (E15/E16) | สเปก executor ขาด model ใหม่หรือพึ่งข้อสรุปที่ยังไม่ยืนยัน | §4 ด้านล่าง;refreshinventory/legalreview ก่อน implementation | DEFERRED_DELETION |
| G35 | P2 GAP | demo ไม่มี paginationserver/actualHTTPstates/accountactivation/full retention forms | browserfixture ผ่านแต่ validation จริงไม่ครบ | QAtracecatalog+actual integration stage;ไม่ใช้ demoPASS เป็น releasegate | OPEN_NOT_IMPLEMENTED |

ทุก G มี expected behavior และ regression scenario ใน QA catalog
BUG ไม่ได้แปลว่าพบ exploit/incident ใน production; ไม่มี live reproduction ในงานนี้

## 4. Inventory ข้างเคียงสำหรับ deletion ที่ต้องตรวจใหม่

static schema survey วันที่ 2026-10-01 พบ 201models ที่ประกาศ field companyId
และ 27models ไม่มี **direct** relation ชนิด Company; ไม่ถือทั้งหมดเป็น orphan เพราะบาง model ผูกผ่าน parent
ไม่มีการตรวจ deployedschema/migrations/จำนวน row จริงในรอบนี้

| กลุ่ม | Models ที่พบ | สิ่งที่ executor ต้องพิสูจน์ |
|---|---|---|
| Retained control/financial references | LegalDocumentActionRecord, DataRightsCase, SalesAttribution, BillingOperatorScope, BillingAccount, BillingQuote, BillingIssue, BillingOperation | retentionbasis แยกรายหมวด; อย่าเพิ่ม cascade เพื่อให้ delete ผ่าน |
| LINE/access/activity residues | LineWebHandoffToken, LineWebhookEventLog, LineTurnOutcome, LineCompanyContext, LineSupportRequest, LineIntakePendingMedia, LineIntakeState | company/user/globalscope, inflightdelivery, tokeninvalidation, minimization |
| Attachment/derived relationships | AttachmentBlob, AttachmentLink, ProductBarcode, NotificationRecipient, NotificationDelivery, ExpenseCaptureFile, ReimbursementInternalNote, CrmDataSubjectRequest, WorkflowRuleVersion | parentrelation และ indirectcascade/restrict; ต้องดูทุก edge ไม่ตัดสินจาก companyId ลำพัง |
| Other tenant records | Role, CrmBookingProposal, CrmChannelAutoReplyUsage | tenant custom roles vs platform role; automation/usagebackfill/cleanup |

การเพิ่ม models ตั้งแต่ P31 เดิม เช่น ExpenseCaptureFile/ReimbursementInternalNote/SalesAttribution
ทำให้ต้องจัด inventory ใหม่ด้วย source ปัจจุบัน ไม่แก้ตัวเลขเก่าแล้วอ้างว่าตรวจ purge ครบ
ข้ออ้าง retention law/backup maximum ใน P31 เก่าไม่ถูกนำมาเป็น legaldecision ใน BE รอบนี้

## 5. Impact matrix ของโมดูลข้างเคียง

| Module | Read dependency | การเปลี่ยนที่คาดว่าจำเป็น | สิ่งที่ต้องคงเดิม / Regression |
|---|---|---|---|
| Auth/session/login/BFF | identity,roles,session | platform reader context,landing,revoke/cache | login/refresh/logout/legalgates/tenantselection เดิมยังทำงาน;ไม่มี authbypass |
| Access control/employee access | active system-role provenance | registry/grants/profileallowlist | tenant custom role ไม่ grantplatform;ผู้บริหารไม่เข้า employeeprovisioning |
| Admin shell/shared theme | menu/capabilities/controls | limited executive subtree+actions | billingdelegates ยังเข้าบิลได้เฉพาะ scope;existingdropdown/input ไม่เปลี่ยนธีม |
| Partner management/company identity | lifecycle,profile,address,businessType | classification/entitysource/mapping ถ้าตกลง | ไม่แก้ privacycategory/financialidentity จากหน้ารายงาน |
| External signup/provisioning | originaldiscovery/source/referrer | query/reconcile provenance;ไม่เพิ่ม signup fields จาก B6 | SALES-onlyreferral, OTHERtext, returnexisting ไม่เปลี่ยน acquisition |
| Sales/deals/referral | credited activation/referrer/flags | complete aggregation adapter;fixcap เมื่อรับงาน | no renewalcredit/no payrollPII/no flagclearing จาก report |
| Billing/renewal/addons | verifiedcash/refund/fees/service | durable movement projection/backfill/coverage | paymentapply/reconcile/lease/idempotency ไม่เปลี่ยนจาก reportread |
| Billing scopes/refund/settlement | financial read boundary | narrow executive projection | executive ไม่ได้ refund/document/providerpermission โดยปริยาย |
| AI gateway/metering/budget | costfacts,successful turn evidence | taxonomyadapter+coverage | budgets/callcost/quota ไม่ถูกแก้เพื่อตรง activitycounter;Gateway ไม่ queryERPDB |
| Accounting/expenses | domaincommits/documentidentity | activityproducer ถ้าตกลง | ไม่มี financial record payload;ไม่ double count derived document/LINEretry |
| Procurement/inventory/CRM/reports | committedaction/readcompletion ถ้ารวม Q03 | eventcoverage และ backgroundactorfilter | corepermission/ledger/CRMprivacy ไม่ถูกข้าม |
| Notifications/email | approved account activation/outbox | enrollmentdelivery ถ้า Q01 เลือก invite | ไม่มี email จาก demo;deliveryfailure ไม่กลายเป็น success/duplicateaccount |
| Legal acceptance/account recovery | currentacceptance/credentialpolicy | executivecapacity/returnpathreview | ไม่มี skipterms/recoveryproof เพราะ role ใหม่ |
| Data-rights/P31 | existingcases/decisions/evidence | hold,scopedread,policy,execution readiness | identity/authority/retention/segregation ไม่ถูกลดโดย demo |
| Attachments/object storage | inventories/blobversions | hold-awaredeletion/exactversionmanifest ภายหลัง | ห้ามลบ locators ก่อน inventory;storageaccesschecks ยังอยู่ |
| LINE/webhook/workers/outbox/cache | queue/inflight/source versions | erasefence/cacheinvalidation | no resurrection/retryafterpurge;ระหว่าง hold ตาม Q07 |
| Backups/restore/processors | manifests/evidence | restore suppression/processorconfirmation ภายหลัง | ไม่อ้าง TTL เป็น proof;อ่าน cloudrunbook ก่อน liveinspection |
| Analytics/read snapshots/exports | company-levelprojections | snapshotlifecycle/erasure invalidations | report ไม่เป็นที่เก็บ PII ถาวร; executive export เข้า design scope ตาม Excel spec ใหม่ แต่ยังไม่ implement |
| Audit/operations | immutablecommand/accessmetadata | metrics/reconciliation/replaytrace | ไม่มี tokens/rawPII;retention ตาม Q08 ไม่เก็บทุกอย่างตลอดไป |

## 6. หลักฐานที่รันจริงในรอบนี้

1. `node /Users/thawatchai/.codex/visualizations/2026/09/30/01a0f012-a7a3-7733-a08a-a31db64bc2a7/check-demo.cjs`
   →PASS: fixtures, source/seller, cohorts, account local validation, request local states,
   read-only/loading/error, themedcontrols, viewport1440/1024/768/390/320, darkOS, no pageerrors
2. focused tests เดิม 5 ไฟล์ผ่าน **58 tests,0fail,0skip**:

```sh
pnpm --filter @watchdog-bms/api exec tsx --test --test-reporter=spec \
  src/modules/data-rights/data-rights.service.spec.ts \
  src/modules/data-rights/data-rights.controller.spec.ts \
  src/modules/sales-console/domain/sales-attribution.logic.spec.ts \
  src/modules/external-signup/domain/line-signup.logic.spec.ts \
  src/modules/billing/application/billing-financial.spec.ts
```

tests ใช้ fixtures/mocks เดิม ไม่ใช่ DBintegration/HTTPE2E ไม่สร้าง testcode ใหม่
จุดน่าสังเกต: test เดิมอนุมัติแล้ว startExecution ทันทีผ่าน จึงเป็นหลักฐาน behavior เดิมและช่องว่าง G08
การที่ test นี้ผ่านไม่ได้ยืนยันมติ 14 วันใหม่
3. อ่าน schema+symbol/route/contract และเทียบ FEsource แบบ static;ผล simulation อยู่ QA แยก
4. ตรวจเอกสาร/links/IDs/traceability ตาม taskmemory ก่อน handoff

## 7. ข้อจำกัดและสถานะถัดไป

ไม่มี finite suite ที่พิสูจน์ทุกค่าที่เป็นไปได้ของระบบ จึงใช้ equivalence classes, boundary values,
state transitions, permission matrix, replay/races, failure injection และ cross-modulejourneys
รายการนี้ครอบคลุม known flows ของสเปกและเดโม พร้อมระบุส่วนที่ยังไม่มี source หรือรอมติ
ยังไม่รันเงินจริง/provider/DBrace/erasure/restore หรือ loadtest;ต้องทำใน isolatedtestenvironment หลัง implementation
งานถัดไปคือปิด Q01–Q09 ตามลำดับ stage ไม่เขียนโค้ดในรอบ spec นี้

## 7. หลักฐานหลังพักและซ่อน deletion

2026-10-01: `check-demo.cjs` PASS หลังแก้เฉพาะ local preview — HIDE-01–04 ทั้ง admin/reader, company history, saved route event และ initial state; report/account/theme regression ผ่าน, ไม่มี page errors. ตรวจภาพประวัติบริษัทและมือถือแล้ว
ไม่มี application/API/schema เปลี่ยน และไม่รัน BE 58 tests ซ้ำเพราะไม่มี BE เปลี่ยน; ผลเดิมด้านบนเป็น baseline. Closure count ยังคง 0; deferred 13 ไม่ได้แก้ root cause ในระบบ


## 8. ส่วนเพิ่มกราฟการใช้และ Pareto

ดู [A01–A05 และผลตรวจ](../specs/mangmee-executive-usage-pareto-spec-th.md): receipt upload coverage/dedup, population, cash concentration, chart/list consistency และ metric/PII separation
G22 reset hidden filters แก้ใน local demo พร้อม browser evidence รอบนี้ และ partial active count แสดง “อย่างน้อย” แล้ว; application G22/G35 ยัง OPEN เพราะไม่ได้ implement จริง
G01–G35 ยังคง22 OPEN/13 DEFERRED/0 CLOSEDใน application; A01–A05 เป็นรายการต่อยอดแยก. ไม่ถือ fixture72หรือการยืนยันความหมาย Top spender เป็นการปิด source/policy gaps

## Navigation/comparison impact เพิ่มเติม

[UX spec](../specs/mangmee-executive-navigation-comparison-spec-th.md) เพิ่มpage-specific readsและcomparativeprojectionในแผน. UXเลื่อนยาวแก้ในเดโมและตรวจภาพแล้ว; monthly comparisonยังไม่มีครบdata sourceและแสดงunavailable. Scope/snapshot/coverage/permissionและper-companydenominatorต้องตรวจจริงเมื่อimplement ไม่ปิดG01/G13/G16/G23/G27/G35จากการจัดหน้าใหม่


## Export Excel design extension — 2026-10-01

[Excel spec](../specs/mangmee-executive-excel-export-spec-th.md) เพิ่ม export จากหน้าที่กำลังดูพร้อม snapshot/filter และ all-page semantics; บริษัท/detail/comparison ใช้ context ต่างกันอย่าง explicit
พบ shared `common/export/xlsx.logic.ts` เป็น single-sheet writer จึงยังไม่รองรับ multi-sheet/styles/date/auto-filter ตาม spec ใหม่; billing history CSV เป็น bounded page ไม่ใช้แทน executive all-row export
XG01 capability/default grants, XG02 snapshot-bound query, XG03 writer compatibility, XG04 bounded delivery/audit เป็น DESIGN_ONLY/NOT_IMPLEMENTED ทั้งหมด
ต้องตรวจ auth/platform scope, export revoke, source coverage, workbook typed cells/formula-like text และ regression tax/expense exports ก่อนส่งมอบจริง
ไม่มีการปิด G เดิม:22OPEN/13DEFERRED; featureลบยังhidden/deferred. Local demo ไม่สร้างไฟล์จริงและไม่พิสูจน์ XLSX/API integration


### Owner template amendment — Excel Dashboard v4

Ownerระบุ `outputs/company-infographic-20261001/company-receipts-dashboard-v4.xlsx` เป็นแม่แบบตาม [Excel spec §8](../specs/mangmee-executive-excel-export-spec-th.md#8-แม่แบบและหลักฐานตรวจอ่าน-2026-10-01)
มตินี้แทนsummary-only/optional-company/values-only: ค่าเริ่มต้นเป็นDashboardเขียว–ทอง + nativecharts/สูตร + รายบริษัทที่เป็นsource, 2ชีตหลัก; ตารางคำนวณใต้Dashboardและmetadataในsource
ต้องแยกsource28ก.ย.ของแม่แบบจากfictional30ก.ย.ของเดโม; ไม่ยกสูตรblank=0หรือreceiptทุกสถานะมาเปลี่ยนBE Q03โดยปริยาย
API13รับtemplateKeyแทนincludeCompanies; serverเลือกversion/hash. XG03ต้องตรวจnativechart/formula/cache/renderเพิ่ม; writerเดิมsingle-sheetยังทำไม่ได้
EXL13–14เพิ่มintegrationacceptance; baseline188/47deferredไม่เปลี่ยนและไม่มีgapimplementationปิดจากการอ่านแม่แบบ. ไม่แก้ไฟล์อ้างอิงและไม่สร้างXLSXใหม่รอบนี้

Contact amendment: Q-EXL-CONTACT RESOLVED — User.email/phoneNumber ล่าสุดของบัญชีเจ้าของในระบบมั่งมี. Owner join/unique-versus-multiple/ไม่มีเจ้าของ, User status, verification, coverage แยก field และเวลา snapshot กำหนดใน Excel spec §9.2. ต้องตรวจ active membership/canonical OWNER, ห้าม join คูณแถวบริษัท/KPI, เลือก first member หรือ fallback Company/signup/Gmail/Sheet หลังล้าง contact. กระทบ executive read projection/snapshot/FE/detail/export เท่านั้น; auth/account-profile/signup เป็น read sources ไม่เพิ่ม sync หรือ backfill. v5 ที่ใช้ Sheet ไม่ผ่าน source acceptance นี้; 64/61 ไม่ใช่ system coverage. Q ด้านความหมายปิดแล้ว แต่ application integration/EXL-15 ยัง NOT_IMPLEMENTED; ไม่ปิด G เดิม

## ผลหลังตรวจทานอิสระ 2026-10-01 (บันทึก 2026-10-02)

ส่วนนี้เพิ่มต่อท้ายโดยไม่แก้เนื้อหาด้านบน เนื้อหาด้านบนเป็นบันทึกของรอบตรวจเดิมและยังอ่านตามเดิมได้
ผู้ตรวจอิสระเทียบเอกสารนี้กับโค้ดที่ `origin/develop` commit `ae13970b0` รายละเอียดอยู่ใน
[ผลตรวจฝั่งหลังบ้าน (RB)](mangmee-executive-spec-review-backend-2026-10-01-th.md) และ [ผลตรวจฝั่งหน้าจอ (RU)](mangmee-executive-spec-review-ui-2026-10-01-th.md)

**จำนวนสถานะใน application ไม่เปลี่ยน: 22 OPEN / 13 DEFERRED / 0 CLOSED** คำว่า “ปิดบนกระดาษ” ด้านล่างหมายถึงสเปกมีกติกาที่ลงมือทำได้แล้ว
ไม่ใช่การแก้ในระบบ และไม่ใช่หลักฐาน regression

### ก. ข้อ G ที่ปิดบนกระดาษแล้ว และปิดด้วยกติกาใด

BE หมายถึง [สเปก BE](../specs/mangmee-executive-business-backend-spec-th.md) ฉบับแก้หลังการตรวจทาน Qxx คือคำถามถึงเจ้าของใน BE §21 ที่ยังรอคำตอบ

| ข้อ G | ปิดบนกระดาษด้วย | ที่มา | สิ่งที่ยังเหลือ |
|---|---|---|---|
| G01 | BE §16.1 ตาราง API01–API15 ชุดเดียว และ §12.4 parameter ชุดเดียว | RB-18, RU-06 | ทำจริง |
| G02 | BE §17.2 กติกาตัวกั้นหน้าเว็บ หน้าแรก เมนู และข้อกำหนดการใช้งาน | RB-24, RU-07 | Q15; ทำจริง |
| G03 | BE §17.2 บัญชีผู้บริหารเป็นบัญชีแยกที่มี membership เดียว ไม่แก้ลำดับเลือกบริบทของ login | RB-07 | Q12 |
| G04 | BE §17.1 กติกาสี่ข้อ: role อยู่ใน `PLATFORM_ROLE_KEYS` และร้านมอบไม่ได้, `assertPlatformTenant` ทุก endpoint, ไม่ตรวจด้วยชื่อ role, ชื่อบทบาทสงวน | RB-34 | บั๊ก RB-34 กำลังแก้ในสายแยก; ทำจริง |
| G05 | BE §17.3 สร้างแบบบัญชีเซลล์ สถานะสี่ค่า ระงับคือปิด membership และยกเลิก session; API08, API10, API14, API15 | RB-06, RB-25, RU-21 | Q10, Q11 |
| G11 | BE §14.1 เวลาของเงินมาจากตัวอ่านยอดเดิมของ billing; ห้ามใช้ `periodStart`/`createdAt`/`financialObservedAt` | RB-02 | Q21; เจ้าของโมดูล billing; งานอ่านย้อนหลัง |
| G12 | BE §14.1 นับหนึ่งครั้งต่อรหัสรายการของผู้ให้บริการ; §14.2 คืนเงินนับในเดือนที่คืน | RB-02, RB-17 | เช่นเดียวกับ G11 |
| G13 | BE §12.2 `Company.reportClassification` แก้ผ่านเส้นทางผู้ดูแลเดิม และงานจัดประเภทครั้งเดียว | RB-04 | Q16 |
| G14 | BE §15 รูปแบบนิติบุคคลไม่อยู่ในรุ่นแรก (ไม่มีข้อมูลในระบบเลย) | RB-14 | Q27 |
| G15 | BE §15 ไม่มี `businessCategory` แล้ว; ใช้ `businessTypeCode` หรือกลุ่มที่ผู้ดูแลใส่ พร้อมสัดส่วนร้านที่มีข้อมูล | RB-14 | Q26; เนื้อหาตารางจับคู่ยังไม่มีผู้เขียน |
| G16 | BE §13.3 นับจากตารางธุรกรรมเดิม; ห้ามใช้ `callCount`, `AiTurn`, `LineWebhookEventLog` | RB-13 | Q17 |
| G17 | BE §13.1 `activeUsers` จากผู้ยืนยันรายจ่ายและผู้สร้างเอกสารขาย; `lastWebEntryAt` แยกจาก `lastLineActivityAt` | RB-20 | ทำจริง |
| G18 | BE §20.2 รวมทีละ grain ก่อน join และแผน BE §4.2 บังคับ test กับ Postgres จริง | RB-29 | ทำจริง |
| G19 | BE §14.3 รายงานผู้บริหารไม่ใช้ `SalesReportsService` เป็นยอดรวมแพลตฟอร์ม | RB-39 | ตัวรายงานทีมขายเองยังตัดที่ 5,000 แถว — อยู่ในไฟล์บั๊ก |
| G20 | BE §15 ค่า `UNRESOLVED` และตัวกรอง `referringSales=UNRESOLVED` | RB-33 | ทำจริง |
| G21 | BE §13.1 ค่าธรรมเนียมจากรายการเคลื่อนไหวจริง; §14.3 ใช้ logic ของโมดูลทีมขาย | RB-17, RB-16 | ต้นแบบยังใช้ค่าสมมติ (เอกสารฝั่งหน้าจอ) |
| G22 | BE §12.4 การกดจากการ์ดส่ง `drilldownFilters` เป็นคำขอใหม่ และจำนวนแถวต้องเท่าค่าบนการ์ด | RB-19, RU-04 | กติกาของหน้าจออยู่ในเอกสารฝั่งหน้าจอ |
| G23 | BE §12.3 ตารางสรุปที่งานตามเวลาสร้าง และ `page`/`pageSize` | RB-08, RU-05 | Q30, Q31 |
| G24 | BE §14.2 (ไม่เปลี่ยน) ยอดติดลบวาดใต้ baseline | — | ต้นแบบยังไม่รองรับ (เอกสารฝั่งหน้าจอ) |
| G26 | BE §16.3 กันซ้ำด้วย unique ของ `username`; คำสั่งระบุสถานะปลายทาง; ไม่มีผู้จัดการคนสุดท้ายเพราะผู้จัดการคือผู้ดูแลระบบคนเดียว | RB-26, RB-05 | Q10 |
| G27 | BE §12.3 ตรวจสิทธิ์ใหม่ทุกคำขอและ `buildChanged`; §16.3 ได้ 403 แล้วล้างข้อมูลที่แสดง | RB-08 | การทิ้ง response เก่าฝั่งหน้าจอเป็นเรื่องของเอกสารฝั่งหน้าจอ |
| G35 | — | — | เป็นงานทดสอบ ปิดได้เมื่อทำจริงเท่านั้น |

รายการต่อยอดในเอกสารอื่นที่มีกติกาในสเปก BE แล้ว: A01–A05 ของสเปก Pareto อยู่ BE §13.4–§13.6, §12.2 และ §16.2;
XG01 (สิทธิ์ส่งออก) อยู่ BE §17.1, XG02 (ชุดข้อมูลของไฟล์) และ XG04 (ขอบเขตและ audit) อยู่ BE §16.4 กับ §20.3
XG03 (ตัวเขียนไฟล์) ยังเปิด: ต้องประเมินตัวเขียนไฟล์กับแม่แบบจริง และเพิ่มการบีบอัด การตัดอักขระควบคุม และค่าที่คำนวณแล้ว

### ข. ข้อ G ที่พัก 13 ข้อ

ยังพักตามมติเจ้าของทั้งหมด มีสามข้อที่ผลตรวจเพิ่มข้อมูล:

- **G09 ไม่ควรถูกพักไปพร้อมกัน** (RB-30): ทางตันของผู้ดูแลคนเดียวเป็นข้อบกพร่องของโมดูล `/system/data-rights` ที่ใช้งานอยู่วันนี้
  ผู้ดูแลคนเดียวอนุมัติเคสที่ตัวเองสร้างไม่ได้ เคสคำขอลบข้อมูลของลูกค้าจึงเดินไม่ผ่านตั้งแต่วันนี้ ย้ายไปอยู่ใน
  [ไฟล์บั๊ก](mangmee-executive-current-code-bugs-2026-10-01-th.md) และคำถาม Q35 สถานะในตารางด้านบนของเอกสารนี้ไม่ถูกแก้
- G08 ยืนยันตามที่เขียน และพบเพิ่มว่า `startExecution` ไม่มีเงื่อนไขเวลาใดเลย รวมถึงช่วงรอหนึ่งวันของสเปกเดิมก็ไม่มี
  ไม่กระทบโดยตรงวันนี้ เพราะคำสั่งนี้เปลี่ยนสถานะเคสเท่านั้น และผู้ดูแลคนเดียวไปไม่ถึงขั้นนี้
- G34: ตัวเลข inventory เก่ากว่าโค้ดปัจจุบันอีกรอบ ดูข้อ ค.

### ค. ข้ออ้างเกี่ยวกับโค้ดในเอกสารนี้ที่ไม่ตรง — ค่าที่ถูก ณ commit `ae13970b0`

| ที่อยู่ในเอกสารนี้ | ที่เขียนไว้ | ที่ถูก | ที่มา |
|---|---|---|---|
| §1 | อ่านจาก checkout ที่มีงานยังไม่ commit | ผู้ตรวจอิสระใช้ commit `ae13970b0` เลขบรรทัดด้านล่างอ้างจาก commit นี้ | RB-31 |
| E04 เลขบรรทัดใน `schema.prisma` | Company 306, User 575, AuthSession 635, DataRightsCase 712 | Company 292, User 561, AuthSession 623, DataRightsCase 700 | RB-31 |
| E10 เลขบรรทัดใน `schema.prisma` | AiUsageEvent 3910, OcrUsage 4066, AiTurn 1656 | AiUsageEvent 4107, AiTurn 1665; ไม่มี model ชื่อ OcrUsage มี `CompanyOcrUsageEvent` ที่ 4315 และ `CompanyOcrMonthlyUsage` ที่ 4337 | RB-31 |
| E16 และ §4 | 201 models มี field `companyId`; 27 ไม่มี direct Company relation | 209 และ 32 จากทั้งหมด 256 models; ที่เพิ่มมารวม `SalesEventTicket`, `AiCreditEntry`, `ReceiptUnitEntry`, `LineDeliveryPlan`, `EmailVerificationToken` | RB-31 |
| G15 และ E04 | `businessCategory` เป็น privacy tripwire ของ `Company` | ไม่มีฟิลด์ชื่อนี้ที่ model ใดแล้ว ถูกยกเลิกตามสเปกประเภทธุรกิจแหล่งเดียว (เจ้าของอนุมัติ 2026-09-23); ร้านใหม่มี `businessTypeCode` ว่างจนเจ้าของร้านตั้งเอง | RB-14 |
| E08, E09, G11, G12 | ไม่กล่าวถึงตัวอ่านยอดจากผู้ให้บริการที่มีอยู่แล้ว จึงอ่านได้ว่าต้องสร้างแหล่งรายการเงินใหม่ทั้งหมด | โมดูล billing มีตัวอ่านยอดจากผู้ให้บริการอยู่แล้ว (`billing-settlement.service.ts`) เก็บหนึ่งแถวต่อรายการ พร้อมเวลาเกิดรายการ ค่าธรรมเนียม และบริษัทที่จับคู่ได้ ผู้ดูแลสั่งสร้างงานทีละช่วงแล้ว worker ทำต่อเอง ที่ยังไม่มีคือการสร้างงานตามเวลา | RB-02 |
| E10 และ G16 | กล่าวถึง turn outcome เป็นอีก grain หนึ่ง โดยไม่บอกว่าแถวถูกลบตามอายุ | แถว `AiTurn` ถูกลบเมื่อเก่ากว่า `AI_DATA_RETENTION_DAYS` (ค่าเริ่มต้น 90 วัน) และถูกลบทั้งชุดเมื่อเปลี่ยนสถานะพนักงาน แก้บทบาท ยกเลิกการผูก LINE หรือปิดผู้ช่วย จึงใช้เป็นประวัติไม่ได้ | RB-13 |
| หัวข้อ “## 7.” | มีสองหัวข้อเลขเดียวกัน และหัวข้อแรกเขียน “ปิด Q01–Q09 ตามลำดับ stage” | Q06–Q08 พักแล้ว งานถัดไปคือคำตอบของ Q10–Q34 ตามแผน BE | RB-32 |
| G19 | รายงานทีมขายตัดที่ 5,000 แถว | ยืนยัน และพบเพิ่มว่าคิวธงของเจ้าของตัดที่ 200 แถวโดยไม่บอกเช่นกัน | RB-39 |

ข้ออ้างที่ตรวจแล้วว่าถูกมีรายการอยู่ในผลตรวจฝั่งหลังบ้าน หัวข้อ 4 (รวมเลขบรรทัด `approve` 532, `startExecution` 562, `assertOperator` 937 ใน E11)

### ง. สิ่งที่ผลตรวจพบเพิ่มและไม่มีรหัส G

- เส้นทาง API05/API06 ที่ใช้ `:companyId` จะได้ 403 ทุกครั้ง และคำสั่งของผู้ดูแลสองตัวในวันนี้มีอาการเดียวกัน (RB-01, RB-40) — BE §16.1 และไฟล์บั๊ก
- ร้านลูกค้ามอบ role ระบบของแพลตฟอร์มให้พนักงานได้ (RB-34), เซลล์ที่ถูกระงับยังเข้าได้ (RB-36), API ประวัติของร้านคืนแถวฝั่งแพลตฟอร์ม (RB-38) — ไฟล์บั๊ก กำลังแก้ในสายแยก
- ผู้แนะนำที่ผู้ดูแลใส่ภายหลังไม่ได้ยอด เป็นพฤติกรรมที่ตั้งใจตามมติเจ้าของ 2026-10-01 (RB-35) — BE §14.3
- ยอดเครดิตเซลล์ต่างจากสเปกทีมขายสี่จุด (RB-37) — Q36 รอเจ้าของ
- ประเด็นข้อมูลส่วนบุคคลของรายงานและไฟล์ส่งออก (RB-10) — BE §20.3 และเงื่อนไขก่อนเปิดใช้ในแผน BE §5

### จ. สิ่งที่ยังเปิดและปิดบนกระดาษไม่ได้

- คำตอบของเจ้าของ Q10–Q36 (BE §21) สเปกเขียนตามคำตอบที่เสนอและติดป้ายไว้ทุกจุด
- ข้อมูลจริงที่การตรวจไม่ได้แตะ: จำนวนบริษัท สัดส่วนร้านที่ไม่มีประเภทธุรกิจ จำนวนร้านที่ผู้ดูแลตั้งแพ็กเกจให้เอง รายชื่อบริษัททดสอบ และรูปแบบภาษีที่ตั้งไว้
- วันจริงที่ migration ของแต่ละแหล่งถูกใช้ในระบบจริง (ใช้เป็นขอบของ “ก่อนเริ่มเก็บข้อมูล”)
- การยืนยันของเจ้าของโมดูล billing ต่อตาราง `purchaseKind` และวิธีสร้างงานอ่านยอดตามเวลา
- การยืนยันว่าการยกเลิกรายจ่ายไม่ล้าง `confirmedAt`
- เนื้อหาตารางจับคู่ประเภทธุรกิจเป็นกลุ่มธุรกิจ
- การตรวจของที่ปรึกษากฎหมายต่อประกาศความเป็นส่วนตัว บันทึกกิจกรรมการประมวลผล และวิธีปฏิบัติกับไฟล์ที่ส่งออก
- ทุกข้อ G ใน application: ยังไม่มีข้อใดปิดด้วย implementation และ regression evidence
