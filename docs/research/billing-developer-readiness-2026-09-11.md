# Developer readiness review — web / LINE / Stripe / billing controls

วันที่ 2026-09-11. **ผล: CONDITIONAL READY TO START; ไม่ใช่ READY TO FINISH ALL FLOWS หรือ provider acceptance.** ตรวจ docs, runtime boundaries และ test evidenceที่มี; เติม technical handoffใน [control spec §7](../specs/mangmee-billing-controls-spec-th.md) และ [plan §6 / DA01–DA08](../plans/mangmee-billing-controls-plan-th.md). Scopeรอบนี้เป็นเอกสาร ไม่มีcode/deploy/provider mutation/testpaymentใหม่.

เอกสารเดิมมี architecture, customer/operator journeys, invariant, route/error/recovery และ test matrixมากพอเริ่มงานพื้นฐาน. แต่คำว่า “designครบ8ข้อ” ไม่ได้แปลว่าไม่มีมติที่ขาด หรือทุกflowถูกรันจริงแล้ว. หากส่งให้developerทำทั้งระบบโดยห้ามถามเพิ่ม จะติด E0, B01–B10, privileged authorization/approval setup และprovider readinessแน่นอน. ไม่ให้developerเลือกการเก็บเงิน/ภาษี/สิทธิ์แทนOwnerจากค่าตัวอย่าง.

## 1. สิ่งที่เริ่มได้และจุดที่ต้องมีคำตอบ

| Dependency | เริ่มทำได้ | ก่อนทำ behaviorนั้นให้จบต้องมี |
|---|---|---|
| Existing account→billing foundation | migrations/sharedcontracts, adapterinterfaces/fixtures, account/companymapping, paid/apply states, read-onlyUI, local fault harness | provider SDK/API-version pinned, real schema/constraints/worker และ contracttests; ไม่มีขั้นใดมีแล้วเพราะมีเอกสาร |
| E0 สมัครเว็บง่ายเท่าLINE | reuse existing approved signup/claim pathเพื่อเดินbillingของบัญชีที่provisionแล้ว; พัฒนาPostmarkdeliveryตามspec | เลือกemail proof+returninglogin+recovery, admission/autoreview/caps; [easy signup](../specs/unified-easy-signup-spec-th.md) ยังBRAINSTORM. Postmarkไม่เลือกOTP/linkให้ |
| B01–B02 conversion/quota | model/validation/UIconfigและTEST_ONLYfixtures | วันเริ่มคิดเงิน/วันtrialเหลือ/กลางเดือนและusageตามมติที่ครบสำหรับofferนั้น |
| B03–B05 failure/cancel/changeplan | recoveryqueue, currentstatus, simulatedpolicytests | grace/accessสิ้นสุด, cancel-renewalrace, effectiveplan/proration/overlimit. ห้ามเปิดofferที่ไม่มีทางแก้บัตร/หยุดต่ออายุตามpolicy |
| B06–B08 documents/refund/debt | providerdocumentmapping, reconciliation, scopedcase/approvalUI | seller/taxdisplay/correction, refund/dispute/accessและหนี้เก่ามีผลอย่างไร; Invoice/ReceiptเลือกStripeแล้ว แต่รายละเอียดธุรกิจไม่ได้เลือกครบ |
| B09–B10 legacy/margin | auditedimportpreview, nooverwritelegacy, usage/costreadmodels | ข้อยกเว้นเดิม/ราคา/cohort/salesreadiness และcapacityรับเรื่อง. ไม่โยนลูกค้าmanualเดิมเข้าautocollection |
| Privileged control operators | capabilitycatalog, scopedroutes, approvalmodel, denied/recoverycases | designatedgrants/company/accountscope, separateapproverพร้อมใช้งาน, auth/reauth proofที่รองรับจริง. Specยังไม่ได้ตัดสินว่าpassword/SSO/step-upใดเป็นpolicyสำหรับงานเสี่ยง |
| Provider/environment setup | fakeadapter+localbrowser/API/PG proofโดยไม่deploy | testaccount+approvedPrice/Portalconfig, webhookforwarding/secret, LINEchannel/LIFF, Postmarksender/stream; health/observedversionจริง. Credentialsไม่ควรอยู่ในspecหรือchat |

Operational TTL/retry/page/bulk defaultsเป็น implementationchoicesที่ทีมกำหนดและทดสอบได้ในpreflight ไม่จำเป็นต้องถามOwnerทุกค่า. Customergrace/refund/tax/signupidentityไม่ใช่implementationdetail; ต้องมีdecisionrecord. การไม่มีpolicyไม่ขวางfoundationแต่ขวางactionที่พึ่งpolicyนั้น.

## 2. Design gaps ที่พบในการตรวจรอบนี้

ตารางนี้เป็นส่วนต่อจาก [CG01–CG19](billing-controls-impact-2026-09-11.md). DESIGN ADDRESSEDหมายถึงเติมข้อกำหนดแล้ว; **ทุก DG ยังรอ implementation/DA tests**. ไม่แก้ตัวเลขหรือsourcehashของevidenceรอบก่อนเพื่อทำเหมือนเคยทดสอบใหม่.

| ID | Bug/gap/impact ถ้าdevทำตามคำอธิบายเดิมอย่างเดียว | Design repair / acceptance |
|---|---|---|
| DG01 | delegatedbillingroleยังต้องผ่านfullPartnerDetailPageซึ่งเรียกmetadata/member/AI APIsที่ไม่ได้grant; เกิดdenialหรือข้อมูลเกินสิทธิ์ | billing-onlycompanyroute/projectionแยก, sharedviewเท่านั้น; §7.1 / DA01 |
| DG02 | คำว่าidempotencyยังไม่กำหนดintentที่หาได้หลังresponseหาย และtransportrequestIdอาจถูกใช้แทนbusinesskey | servermintintent, freezeหลังsubmit, uniqueaccount/mode/intent, header/refreshpreservation, exactpayloadtable; §7.2 / DA02 |
| DG03 | สองคนกดคนละkeyสามารถผ่านtransportdedupeแต่ทำธุรกิจซ้ำ เช่นrefundหรือmanualrepair | resource reservation/sourceCAS+ledgerconstraintsแยกจากidempotency; §7.3 / DA03 |
| DG04 | publishใหม่แล้วinvoiceของราคาเก่าที่ลูกค้ายืนยันไว้ถูกปฏิเสธ หรือสิทธิ์ถูกapplyตามราคาใหม่ | historicalquote/consent/Price mappingsคงอยู่; unsubmittedquoteกับissuedSessionคนละstate; §7.4 / DA04 |
| DG05 | ปิดsales/portalflagแล้วเข้าใจว่าหน้าจ่าย/Portalที่เปิดแล้วถูกยกเลิกทันที | labelขอบเขตgate, expireopenCheckoutเป็นcommandแยก, raceอ่านproviderจริง, Portalexplicitconfig; §7.4 / DA05 |
| DG06 | reauthorizeทุกworkerจากactorเดิมจนpaidapplyหยุดเมื่อpayer/เจ้าหน้าที่ลาออก หรือACTIVEpolicyหายตามroleคนเผยแพร่ | separateoperatorcommand vs automatedfulfillment/serviceidentity; pendingauthต่างจากeffectivepolicy; §7.5 / DA06 |
| DG07 | missingconfigเป็น0/unlimited, TEST_ONLYpolicyถูกใช้LIVE หรือcohortรวมหลายprovideraccount | actionreadiness+typedvalues+fixturemarkerreject+singleaccountcohort; §7.6/preflight / DA07 |
| DG08 | restoreDB/rollingmigrationทำdedupeหรือqueuedversionหาย แล้วcharge/refund/applyซ้ำ | additive version-compatiblequeue, BLOCKED_VERSION, retainfinancialprovenance และreconcileก่อนเปิดmutations; §7.6 / DA08 |

พบเอกสาร UI ส่วน “สิ่งที่มีอยู่ใน code” ค้างก่อนรอบrepair 3แถว: company selection, LIFF expiry recovery และ fixeddashboard redirect. ตรวจเทียบusecases/layoutจริงแล้วแก้ให้ตรงcurrentcode; ป้องกันdeveloperทำซ้ำหรือย้อนการแก้เดิม. เป็นdocument correction ไม่ใช่runtimefixใหม่.

Provider facts ตรวจofficialซ้ำ: Checkoutexpireใช้กับSessionที่open; PortalSessionผูกconfigurationได้และถ้าไม่ส่งจะใช้default. ข้อสรุปด้านdesignของเรา: การปิดปุ่ม/routeในมั่งมีไม่ใช่หลักฐานว่าproviderflowที่ออกไปแล้วหยุด; ต้องตามobservedstateและทดสอบrace. ไม่สรุปว่าAPIไม่มีความสามารถอื่นจากการอ่านเพียงสองหน้า. [Stripe expire API](https://docs.stripe.com/api/checkout/sessions/expire), [Stripe Portal session API](https://docs.stripe.com/api/customer_portal/sessions/create)

## 3. Known-flow coverage — ตรวจทางเริ่ม ทางจบ และทางกลับ

นี่คือรายการflowที่อยู่ในscopeปัจจุบัน; ไม่ใช่คำอ้างว่าครอบคลุมทุกpermutationที่เป็นไปได้ในอนาคต. Fulltargetruntimeของทุกแถว **NOT RUN** ยกเว้นpartialexistingevidenceที่ระบุในคอลัมน์สุดท้าย. T/LB/CT/DA/EMเป็นtestrequirements ไม่ใช่testcountที่ผ่าน.

| Flow | Start→end / error exit ที่ต้องมี | Source / acceptance / สถานะ |
|---|---|---|
| F01 | marketingcatalog→offerhint→auth→review; stale/gateoff→refresh/support | U01–02, LB08/20, CT19, DA04–05; existingstaticmarketingเท่านั้นที่มีpriorproof |
| F02 | newwebuser/noLINE→emailproof→admission→provision→firstuse→กลับเข้า/กู้บัญชี | E0–E3, EM09; **DECISION OPEN E0**, ไม่ใช้billingpassแทนsignup |
| F03 | existing/legacyclaimuser→pending/expired/resend→บัญชีเดิม | signupspec/P11, EM05/08/18; newPostmarkfullflowNOTRUN |
| F04 | newLINEuser→verifiedidentity→sharedadmission/provision→app | LINEsignup/P10-L, LB01/05; currentLINEentryบางส่วนมีproof, sharednewbillingยังNOTRUN |
| F05 | web↔LINElink/unlink/collision→sameuser/company; proofไม่พอ→review/login | E0–E2, LB04–07/09–10, T30/40; ไม่mergeจากemailข้อความอย่างเดียว |
| F06 | login/password/legal/expiredcookie→safecompany+attemptเดิม | LB11, CT04, DA02; currentBC01/helperมีpartialproof |
| F07 | multicompanies/expired/held/revoked/nonowner→picker/recovery/denyพร้อมทางกลับ | LB02–05/09, T30/33, CT14/32; existingrenew/handoffบางส่วนผ่านก่อนหน้านี้ |
| F08 | reviewbillingprofile/tax/consent→quote→Checkout | U05–07, T02/05/08/31/40, DA04; B01/B02/B06เป็นdependency |
| F09 | card/3DS→paidหรือdeclined/actionrequired/back/expire→status/retryเดิม | T09–11/16–17, LB12–15, DA05; provider/nativeNOTRUN |
| F10 | twotabs/twoowners/สองช่องทาง/unknown→operationเดิม→resolved | T18–20/29, LB07/14, DA02–03; invoice/applyruntimeยังต้องสร้าง |
| F11 | signedwebhook/unmapped/late/duplicate→durableevent→verifiedinvoice | T20–23/32, CT24–25; signatureและmoneymappingต้องทดสอบกับadapterใหม่ |
| F12 | paid→atomicapply→usableweb/LINE; hold→paidheld/support | T03–04/23–24/28/33, LB02/14/16, DA06; manualrenewBC03เป็นpartialproofเท่านั้น |
| F13 | paid/period→usage/quota/reset/overlimit→allowedbusinessหรือreason | T07–08/36, CT17/28; ไม่resetusageเมื่อจ่าย; B02/B05 |
| F14 | renewsuccess/failure→retry/แก้บัตร/graceend/debt→status/recovery | T06–07/11–15/39; B03/B08; Stripecollect≠appmanualcharge |
| F15 | cancel/undo/schedule/renewalrace→effectiveend→rejoinตามpolicy | T34–35/39, LB15–16, CT22; B04/B08; supportexitต้องใช้งานได้ |
| F16 | upgrade/downgrade/proration/oldPrice→invoice/period/limitsถูก | T05/21/31/36, CT16–19, DA04; B05และhistoricalmapping |
| F17 | refund/fullpartial/fail/dispute→observedmoney/access/compensation | T21/37–38, CT26/30, DA03; B07/B08; ไม่เท่ากับcancel |
| F18 | invoice/receiptpending/expiredURL/wrongowner→authorizedopen/support | U09, T26/40, LB17, EM10–11/17; StripecustomerdocumentsยังNOTRUN |
| F19 | Postmark/LINEdelivery→accepted/delivered/bounce/unknown→inapp/retryrecipient | T25, LB20, CT07/12, EM01–08/12–13/16; deliveryไม่สร้างaccess |
| F20 | Adminsummary→issue→assign→preview→approve→run→verify→resolve/reopen | CT01–12/15/31–32, DA01–03/06; current3webrepairsไม่ใช่controlconsolePASS |
| F21 | policy/gatepublish→allconsumerobserved→rollback/partialcompensate | CT16–23/27/30, DA04–05/07; no-deployrevisionproofยังNOTRUN |
| F22 | override/expiry/revoke/actoroffboard→latestbaseline/hold/support | CT11/15/28–29, DA06; timerworkerหยุดยังต้องexpiryที่readtime |
| F23 | outage/429/workercrash/configdrift→retryqueue/reconcile/assignedcase | T15/17/19/22/29/42, CT23–27, DA07–08; nofalsegreen/unknown→newcharge |
| F24 | legacyimport/restore/migration→identityledgercompare→readonlythenrecover | T29/40, CT24/26/30, DA08, EM18; noautocollectoldmanualaccounts |

ใช้ cross-cutting dimensions กับ **ทุก mutating route**: authorized/denied/revoked/foreigncompany/test-live, fresh/stale/duplicate/different-key, before/aftercommit fault, logout/refresh/back/newdevice, desktop390px, providerunavailable/partial. ไม่จำเป็นต้องคูณทุกdimensionจนได้casesซ้ำ; reviewerต้องผูกแต่ละinvariantกับtestจริง และเพิ่มcombinationที่มีraceระหว่างเงิน/สิทธิ์/identity. ไม่มีการติ๊กF01–24PASSจากจำนวนunitรวม.

## 4. หลักฐานและนิยามพร้อมส่ง developer

- [Previous runtime evidence](../evidence/billing-controls-2026-09-11/README.md): auth26, BCbrowser5, typecheck และPIDเดิมก่อนหลังmanualrenew. ผลยังใช้ได้ตามscopeเดิม; ไม่ได้รันใหม่และไม่ครอบคลุมDA01–08.
- รอบนี้ตรวจpresence/links/IDs/decisionmarkersของเอกสารทั้งสองrepoใน [document audit evidence](../evidence/billing-developer-readiness-2026-09-11/README.md). Staticvalidationไม่รับรองimplementationหรือproviderbehavior.
- Developerเริ่มfoundationได้เมื่อรู้slice/dependencies; ก่อนเริ่มdependentconsumerต้องfreezeDTO/schema/operationaldefaults. ก่อนรับว่าflowเสร็จต้องมีrealBFF/API/DB/worker/browserproof ไม่ใช่screensที่ตอบmocksuccess.
- “พร้อมจบทุกflowโดยไม่ต้องถามเพิ่ม” ต้องปิด E0/มติธุรกิจ/securitysetupที่เกี่ยวข้อง และผ่านruntime/provideracceptance. ณ reviewนี้ยังไม่ถึงสถานะนั้น. ช่องว่างที่คงไว้พร้อมowner/exitcriteriaตรงกว่าเรียกทั้งหมดว่าclosed.
