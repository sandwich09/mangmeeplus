# Billing controls 1–8 — impact / bug / gap register

วันที่ 2026-09-11. Scope: code/docs/local tests ทั้ง mangmeeplus และ mangmee_web. ไม่มีcloud inspection/deploy/live mutation. ใช้ [spec](../specs/mangmee-billing-controls-spec-th.md) และ [plan/CT matrix](../plans/mangmee-billing-controls-plan-th.md). สถานะ **DESIGN CLOSED** หมายถึงมีข้อกำหนด/ทางแก้และtesttargetแล้ว ไม่ใช่runtimeแก้เสร็จ. Current repair evidenceแยกใน [ผลตรวจ](../evidence/billing-controls-2026-09-11/README.md).

**Developer-readiness follow-up:** [DG01–DG08 / F01–F24](billing-developer-readiness-2026-09-11.md) เพิ่มการตรวจจุดต่อและระบุdecision blockersที่ยังเปิด; อ่านร่วมกับCGเดิม. เอกสารมีdesignครบหัวข้อไม่เท่ากับdevทำทุกflowจบได้โดยไม่มีมติหรือไม่มีbug. Currentcode tableในUIแก้stale descriptionsแล้ว; no newruntimeacceptance.

| Gap | Evidence / impact | Resolution และทางไม่ตัน | Verification / status |
|---|---|---|---|
| CG01 session expiredทำsystemdeep linkหาย | `apps/web/app/system/layout.tsx` ใช้ `/system/platform-access` สำหรับsignedout/password/legal แม้proxyมีtrustedrequestpathแล้ว | reuse sanitizer+systemsubtreefallback; รักษาroute/queryผ่านทั้ง3gate | 26 auth focused + BC01 browser desktop/mobile PASS; FIXED LOCAL. Password/legalใช้helperเดียว; ไม่อ้างnewdedicatedbrowsercaseของ2gateนั้น |
| CG02 plan-termreadfailedไม่มีretry | `PartnerDetailPage.tsx` PlanTermSectionแสดงerrorอย่างเดียว | retryread+loading; ไม่submitmutations; partnernavยังอยู่ | BC02 read500→retry→realread PASS; FIXED LOCAL |
| CG03 manualrenewresponseหายอาจเพิ่มวันซ้ำ | existingrenewAPIreplaysตามrequestId แต่web`renewPartnerPlanTerm`ไม่คงlogicalintent; retryใหม่อาจได้requestIdใหม่ | C03durableintent/lookupและidempotencyเชื่อมUIถึงAPIก่อนนับsafe repair; UNKNOWNหาoperationเดิมแทนnewrequest. Manualrenewไม่เป็นStripeinvoiceapply | CT08–10; OPEN RUNTIME, mappedBC-S1/S3 |
| CG04 delegatedbillingroleเข้าหน้าไม่ได้/เปิดกว้างเกิน | `/system` roleSYSTEM_ADMIN; plan-termใช้`system.partner_company.update`รวมการแก้company | C04exactcapabilityscope+shell/menu/APIตามroute; supportเห็นขั้นต่ำและส่งcaseFinance | CT13–15; DESIGN CLOSED / runtimepending |
| CG05 staleหรือunapprovedvalueถูกเข้าใจว่าใช้แล้ว | currenttermadminแก้เฉพาะterm; ไม่มีpublishedpolicydesired/observedcohortmodelทั้ง8control | immutableversion+preview+approval/effectiveAt; pending/blocked→settings/owner | CT16–19; DESIGN CLOSED / runtimepending |
| CG06 staticmarketingกับLINEราคาต่างrevision | mangmee_webstaticbundleฝังoffers; LINEcards/runtimeclientต้องalign | publicapprovedcatalogconsumer+cachefreshness/sourceversion; stalebuydeny/refresh/support | CT18–19, relatedmarketingparity; DESIGN CLOSED / runtimepending |
| CG07 kill switchผิดขอบเขตทำลูกค้าจ่ายแล้วเข้าไม่ได้ | checkout, recurringcollection, ERPfeature, platformOPENมีคนละความหมาย | actionflagsแยก+environmentceiling; salesstopไม่หยุดpaidapply/ingress/recovery; collectionแยกprovidercommand | CT20–23; DESIGN CLOSED / runtimepending |
| CG08 event/commandค้างหรือซ้ำหลังworkerล้ม | provider/localไม่ใช่transactionเดียวกัน; responseหาย/leaseหมด/out-of-order | durableop+fence+boundedretry+unknownreconcile; statusURL/issueไม่มีendlessspinner | CT08–12/24–25; DESIGN CLOSED / runtimepending |
| CG09 supportปิดcaseแล้วเข้าใจว่าเงินหรือสิทธิ์สำเร็จ | issue/paid/apply/access/documentเป็นคนละstate | closureต้องevidence/disposition; paidheldแสดงhold/supportไม่repay; reopenepisode | CT01/05–07; DESIGN CLOSED / runtimepending |
| CG10 reconcileฝั่งเดียว/partialfalsegreen | missedwebhook/providerdashboardmutationและpaginationfault | bidirectionalcoverage/checkpoints/429/faileditemsonly; unmappedcaseให้ผู้รับผิดชอบ | CT24–27; DESIGN CLOSED / runtimepending |
| CG11 approval/overrideถาวรจากsnapshotเก่า | permission/baselineเปลี่ยนระหว่างpreviewqueue; workerexpiryล้ม | hash+expiry+separateapprover+executeauth; readtimeoverrideexpiry+latestbaseline; holdชนะgrant | CT11/15/28–30; DESIGN CLOSED / runtimepending |
| CG12 notification/outbounddocumentล้มกลายเป็นทางตัน | LINEblocked/noemail/bounce/recipientเปลี่ยน/responseไม่ชัด | in-appอ่านผล; deliveryreference/UNKNOWN; recipientrepair+retryตามpermission; accessไม่พึ่งdelivery | CT07/12/27/32; DESIGN CLOSED / runtimepending |
| CG13 rollbackหน้าเว็บดูเหมือนย้อนเงินได้ทันที | providercollection/refundอาจsettledไปแล้ว | previewcompensatingaction/per-itemobservedstate; unsupported→assignedcase ไม่greenจากpointerrollback | CT22/26/30; DESIGN CLOSED / runtimepending |
| CG14 settingsที่providerAPIอ่านไม่ได้/secretconfigขาด | ไม่มีสิทธิ์อ้างตรวจDashboardsettingผ่านAPIที่ไม่มี | manualverification-required+owner+verifiedlink+กลับมาrecheck; secretprovider ไม่แสดงkeys | CT27; DESIGN CLOSED / runtimepending |
| CG15 routineconfigยังต้องแก้ไฟล์/deploy | initialdeploymentconfig≠runtimepolicy; staticcatalogและconsumercacheยังไม่เป็นsharedrevision | DBcommandสำหรับschemaที่รองรับ; no-deploytestsamePID/startupconfig; newcode/schemaยังrelease | CT19–23; DESIGN CLOSED / runtimepending |
| CG16 หลักฐานmanualpaymentถูกเรียกStripeE2E | testdriverเรียกexistingadminrenew; Stripeledger/adaptersยังไม่implemented | ระบุ4ชั้นexistingruntime/localproviderfixture/sandbox/native; ห้ามนับCTผ่านจากเก่า565/25/22 | evidence+plan; CLAIM GAP CLOSED, runtimeproviderpending |
| CG17 manualpackageapprovalกับpaidflowปะปน | package-change request/approvalเดิมแก้planโดยAdmin ไม่ใช่paymentreceipt | C01timelineระบุmanualgrant actor/reason/source; paidapplyยึดinvoice/ledger; B09legacyexceptionต้องกำหนด | CT01/10/28; DESIGN CLOSED / runtimepending |
| CG18 Partner siblingReactkeyซ้ำ | BCfirst runพบwarning; PlanTermSectionและAiUsageBudgetSectionใช้companyIdเดียวในparentเดียว | prefixplan-termkeyรักษาcompanyremountและไม่ชนAIsection | BC01consoleassertdesktop/mobile PASS; FIXED LOCAL |
| CG19 LINEcredentialwebsave≠webhookruntime | SystemHeaderซ่อนLINEsettingsพร้อมcomment: DBcredentialsaveไม่เปลี่ยนsecretที่webhookอ่านจากenv/AWS | C07ห้ามgreenจากDBsave; implementsecretversionresolver/invalidationในทุกsign/verifyconsumerก่อนรองรับwebrotation; interimแสดงmanualverification/ownerworkflow | CT27 + LINEsignature/rotationtests; DESIGN CLOSED / runtimepending |

## Impact ownership / dependencies

- Backend/contracts: auth/session, permissioncatalog, systempartners, billingaccount/attempt/ledger, CompanyPlanTerm/entitlements, lifecyclehold, audit, worker/outbox/reconciler. SharedDTOไม่ให้clientคำนวณสิทธิ์จากStripecheckoutsuccessquery.
- Appweb: systemlayout/header/navigation, partnerdetail, newbillingroutes, BFFauth, status/error/approval/preview. Query/tabcompanyต้องsafe; อย่าสร้างtargetroutesในdocsแล้วอ้างว่ามีหน้าlive.
- LINE: rich menu/postback → selectedcompany → billing/status/renewalroute; actualwebhookตรวจsignature/idempotency; SDKhandoffมีexplicitgestureและexpired/revokedcompanyhandlingจากงานก่อน. การปิดgateไม่ทำrichmenuเก่าพาผู้ใช้เข้าทางตัน: APIคืนreason+status/support. Notifyfailไม่ใช่unpaid.
- mangmee_web: approvedcatalog/pricing/CTAavailability/sourceversion และqueryintentsส่งservermapping; Postmarkเป็นtransactionalemailtargetตามเอกสารเดิม, ไม่ใช่ระบบtaxinvoiceของลูกค้า. LINEและwebsignupผูกidentity/billingcompanyเดียวตามunifiedsignupdesign.
- Finance/Product: B01–B10, approvallimits, refunds/disputes/debt/receipts/documentpolicyและreconciliationtoleranceต้องมีมติ. ไม่ตั้งtax/legalvalueจากชื่อStripeReceipt; providerbillingdocumentsกับใบกำกับตามข้อกำหนดบริษัทใช้policyที่อนุมัติ.
- Operations/Support: issueowner/backup, retrycaps/alerts, APIcredentialrotation/manualverification, retention/redaction และincidentstatus. Livegate/deployทำตามmandatoryrunbookในงานimplementationแยก.

## “ไม่ใช่ทางตัน” ที่รับรองได้เมื่อ implementation ผ่าน

ทุกstateต้องมี nextactionที่actorมีสิทธิ์: อ่านสถานะเดิม/แก้input/refreshpreview/รอโดยมีretryAt+owner/ขอผู้อนุมัติ/กลับบริษัทหรือรายการ/แก้recipient/ติดต่อsupportด้วยreference. Securitydenyยังdeny; providerdownยังpending; เงินที่settledแล้วอาจต้องcompensation. ไม่ทำปุ่มforcepaidหรือข้ามholdเพื่อให้testจบสีเขียว.

Currentturnปิดdesigncoverageทั้ง8และซ่อมCG01–02/18ที่มีruntimeเดิม. CG03–15/17/19เป็นงานimplementationตามBC-S0–S5ที่ตรวจพบและมีdependency/testtargetครบ; ต้องคงopenruntimeจนมีcodeและevidence. Userขอspec+planไม่ใช่อนุมัติราคา/ภาษีหรือสั่งdeploy.
