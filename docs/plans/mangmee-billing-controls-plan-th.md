# Billing controls 1–8 — implementation และ browser E2E plan

> **Implementation update 2026-09-14 — IN PROGRESS:** ซื้อครั้งแรก/ซื้อซ้ำ, upgrade ทุกช่วงที่จ่ายสะสม, downgrade สิ้นรอบ/เลือกสาขาและสมาชิก/ซ่อม invoice เดิม, cancel/resume/restart, financial observations, Admin company/timeline/scopes/case ownership และกู้คืน LINE/Postmark รายการเดิม, ฉบับร่างการตั้งค่า และ policy/gate/VAT มี actual Next/Nest/PostgreSQL/Chromium + marketing ผ่าน133กลุ่มกับ Stripe/Postmark/LINE จำลอง. Focused Admin42 (รวมแก้ copy gate หลังเปลี่ยน policy), downgrade17 และ regression/PG มีส่วนทับซ้อน. ดู [หลักฐานและข้อจำกัด](../evidence/billing-integration-2026-09-13/README.md). Controls/Postmark operations/full signup/full LINE/native/CI/merge ยังไม่ครบ. Receipt-only HIDDEN; ไม่มี deploy.


> **Owner amendment 2026-09-13:** [มติล่าสุด](../specs/mangmee-billing-pack-amendment-2026-09-12.md): ซื้อเริ่ม/จ่ายทันที, VAT OFF ปรับผ่าน Admin, upgrade จ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม, downgrade สิ้นรอบที่จ่ายแล้ว, รายปีได้โควตา 12 เท่าทันที; ใช้หมดซื้อแพ็กเกจเต็มเพิ่ม ซื้อเฉพาะใบเป็น HIDDEN ตามมติล่าสุด: ซ่อนไว้ทุกช่องทางและยังไม่เปิดขาย. ซื้อแพ็กเกจเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิม; ยังไม่เปิดขายก่อน readiness. ไม่มี deploy; full paid E2E ยัง IN PROGRESS.

> **Package amendment 2026-09-11:** [สิทธิ์/ราคา/7เมนู default](../specs/mangmee-package-entitlements-spec-th.md) และ [PE-S0–S5 / PE01–PE36](mangmee-package-entitlements-plan-th.md) เป็นข้อกำหนดล่าสุด: สมัครอย่างเดียวได้ starter7เมนู + FREE_TRIAL_15 (1สาขา/ผู้ใช้รวม2คน/15ใบต่อเดือน/30วัน) ไม่ผูกบัตร; paid รองรับ month/year ตามรูป; มติ2026-09-13ให้ annual quota12เท่าทันทีและซื้อแพ็กเกจเต็มซ้ำต่ออายุจากวันเดิม. Trial/manualคงโควตารายเดือนเดิม. ENTERPRISE_1999 ทั้งเดือน/ปี + ภ.ง.ด.53/50ทวิ Coming soon ห้ามจ่าย; ไม่กระทบ PRO_999. B01/B02/B09 ตัดสินแล้วเฉพาะขอบเขตนี้; นโยบายอื่นคงเดิม. Full spec/native provider acceptance ยังไม่ครบ; local simulated browser/HTTP checkpoint ดูหลักฐาน integration ล่าสุด ไม่ใช้แทน native provider acceptance.

สถานะ 2026-09-11: **DESIGN/PLAN COMPLETE; C01–C08 runtime acceptance NOT RUN**. อ่านคู่กับ [control spec](../specs/mangmee-billing-controls-spec-th.md), [impact register](../research/billing-controls-impact-2026-09-11.md), [Stripe implementation plan](mangmee-stripe-billing-implementation-and-test-plan-th.md) และ [web/LINE UI plan](mangmee-line-web-billing-ui-plan-th.md). การรับรองด้านล่างเป็น exit criteria ของ implementation ไม่ใช่ผลทดสอบที่เกิดแล้ว.

**Readiness clarification:** “ครบ” หมายถึงบันทึก design coverage ทั้ง 8 ข้อ ไม่ใช่ทุก business/auth decision พร้อมแล้ว. อ่าน [developer readiness / F01–F24](../research/billing-developer-readiness-2026-09-11.md) และทำ preflight §6 ก่อนเริ่ม slice; เพิ่ม DA01–DA08 เพื่อปิดจุดต่อที่ตรวจพบรอบนี้. ไม่มี runtime/provider testใหม่จากงานตรวจเอกสารนี้.

## 1. ลำดับทำงานและขอบเขต

Current next C05 increment: paginated inspection of the five existing configuration impact categories, bound to the original request/account/mode and real platform read authority. Freeze an exact-record fingerprint as well as counts; reject publication after same-count identity/state replacement, and give legacy/stale previews a route back to saved inputs. Implement shared query/DTO/UI and HTTP/browser pagination/forgery/stale/approval tests before claiming this increment complete. Scheduling/cohort/capacity-rollout work remains outstanding.

ต่อยอด system partner, shared permissions, plan-term, audit, durable command/worker และ reconciler เดิมตามความหมายที่ตรงกัน. ไม่สร้าง billing console แยก application. Spec ก่อนโค้ด; initial implementation ต้องมี release ตามปกติ แต่ supported settings/repair หลังจากนั้นเปลี่ยนผ่านเว็บได้โดยไม่ deploy. ห้ามใช้ production/customer gate จริงทดสอบแผนนี้.

| Slice / dependency | งานและเจ้าของ implementation | Exit evidence |
|---|---|---|
| BC-S0 — ก่อนทุก control | Product กำหนด capability/action map, B01–B10 ที่ action นั้นต้องใช้, exact DTO/state/error codes. Backend แยก billing source จาก manual term grants; web ทำ safe navigation/read recovery | route/permission matrix + schema validation; action ที่นโยบายไม่พร้อมต้องมี blocked reason/assigned case |
| BC-S1 — C04 + C08 foundation | Backend/contracts: permission catalog/seeds, scoped shell/API, immutable revision/audit, command receipt/lookup, preview hash, actor/approval version, reason, lease/fence, bounded retry. Finance/Product กำหนด approval thresholds | negative API + two-actor browser tests; restart/response-loss integration ไม่ทำ side effect ซ้ำ |
| BC-S2 — C01 + C02 | Backend/Web: company snapshot/timeline provenance, issue dedupe/assignment/SLA configuration, filter/cursor, links to operation. ใช้ Stripe ledger/attempt implementation จากแผนหลักก่อนแสดง paid | browser reads real persisted state, partial/outage ไม่แสดง0; issue resolved ต้องมี observed evidence |
| BC-S3 — C03 + C07 | Backend/Ops: reconcilerทั้งสองทิศ, dry-run preview, retry apply/delivery, bounded bulk, unknown recovery, provider config checks + manual checklist ที่ APIอ่านไม่ได้ | duplicate/out-of-order/provider timeout/429 และ partial batch ผ่าน real DB/worker; reload/new device หา operation เดิมได้ |
| BC-S4 — C05 + C06 | Product/Finance/Backend: typed policies + price mapping, effective cohorts, preview/approval/schedule, authoritative gates; Web + mangmee_web + LINE consumer อ่าน revisionเดียวกัน | settingsเปลี่ยนผ่าน UIและมีผลต่อทุกconsumerโดยprocessไม่restart; checkout denyเมื่อgateปิดและpaid applyยังทำงาน |
| BC-S5 — C08 exceptions + ปิด loop | Backend/Ops/Web: temporary override/revoke/expiry, compensation, approve/revoke race, drift remediation, incident owner/escalation/runbook | overrideหมดอายุขณะworkerหยุดยังไม่มีaccessเกินสิทธิ์; rollbackไม่ย้อนเงินจริงโดยเดา; case→action→observed state→resolved→customer return |

C01–C08 ต้องส่งเป็น vertical slices ที่ทดสอบได้. ห้ามสร้างปุ่มที่มีแต่ mock success หรือ disabledโดยไม่มีเหตุผล/ทางต่อแล้วนับว่าครบ. ทุก slice ส่ง UI + shared contracts + permission check + mutation/read model + error/recovery + audit + E2E พร้อมกัน. UI ของงานที่รอ dependency แสดง readiness/owner ตามจริง.

## 2. Acceptance matrix ที่ต้องรันเมื่อ implementation พร้อม

ชื่อ CT เป็น full acceptance targets. **ยังไม่ยืนยันแต่ละ CT ครบทุกเงื่อนไข**; vertical-slice evidence ที่ผ่านแล้วให้อ้าง implementation checkpoint และรายงานย่อยด้านบน ไม่ถือว่าทั้ง matrix ยังไม่เคยทดสอบหรือผ่านครบแล้ว. ใช้ provider fixture เฉพาะ adapter/SDK, ไม่ intercept control API เพื่อทำให้ผลผ่าน. หนึ่งแถวอาจแยกหลาย test ตาม parameterization; ต้องรายงานจำนวน test จริง ไม่ตีความจำนวนแถวเป็น pass count.

| ID / control | Browser journey + fault | Assertions / ทางออก |
|---|---|---|
| CT01 C01 | Overview→company→invoice→กลับfiltered list; paid/apply pending/access held | แยก5แกน, tenant/envถูก, ปุ่มดูoperation/hold/support, ไม่ชวนจ่ายซ้ำ |
| CT02 C01 | อ่านบริษัทไม่มีinvoice, stale snapshot, provider partial outage | emptyต่างจากerror; timestamp/refresh/reference; ข้อมูลเก่าไม่authorizeเงิน |
| CT03 C01 | pagination/filter+company switchขณะfetchช้า | ไม่ข้าม/ตกหล่นรายการ, selection/previewเก่าล้าง, late responseไม่เขียนบริษัทใหม่ |
| CT04 C01/C04 | expired/revoked cookie, password/legal gate, back/refresh/deep link | safe target/queryกลับครบ; forbiddenมีทางกลับ, ไม่leakการเงิน |
| CT05 C02 | สองworkerสร้างissueเดิม→assign→work→verify→resolve | dedupe+episodeหนึ่ง; assignee/age/evidence/audit; closureไม่ทำpaid |
| CT06 C02 | สองoperatorassign/resolveพร้อมกัน, assigneeถูกถอนสิทธิ์ | CAS conflict→refresh; backup/unassigned queue; reopenเมื่อinvariantเสียใหม่ |
| CT07 C02 | ไม่มีrecipient/LINE block/email bounce/alertส่งไม่ได้ | issueยังมองเห็นในเว็บ/escalation; ไม่หาย/ไม่คืนaccessจากข้อความ |
| CT08 C03 | preview→double click→สองtabsubmitคำสั่งเดียว | logical side effectครั้งเดียว; samekeyต่างpayload409; UIชี้operationเดิม |
| CT09 C03 | providerรับแล้วresponseหาย; BFF timeout; ปิดbrowserก่อนรับoperationId | serverlookupจากintent/companyพบงานเดิม; UNKNOWN→reconcile→success; ห้ามkeyใหม่/chargeซ้ำ |
| CT10 C03 | paid retry applyหลังDBfail/leaseหมด/workerrestart | invoice+periodapplyครั้งเดียว; fenceกันworkerเก่า; backoff/cap+caseเมื่อexhausted |
| CT11 C03 | company/source/policyเปลี่ยนหลังpreview, permissionถอนก่อนexecute | stale/blocked; reviewใหม่ก่อนดำเนินการ; oldapprovalใช้ไม่ได้ |
| CT12 C03 | notificationtimeoutหลังproviderส่งแล้ว→retry | providerreference/statusตามที่รองรับ; ไม่รับประกันexactly-onceเกินprovider; paymentไม่เปลี่ยน |
| CT13 C04 | Support/Finance/Ops/Policy-adminเข้าpage+directAPI | grants/scopesตามmatrix; billing.readไม่เปิดplatformadminอื่น; OWNERไม่เป็นFinance |
| CT14 C04 | เปลี่ยนcompany/account/mode/providerid/operationidในURLหรือbody | serverderive+scopecheck; generic404/403; no cross-tenantread/write |
| CT15 C04/C08 | initiatorapproveตัวเอง, approverถูกถอนสิทธิ์, approvalหมดอายุ | denied/reviewrequired; มีคิวให้ผู้มีสิทธิ์; retryไม่คืนสิทธิ์เดิม |
| CT16 C05 | draft→validation→impact→approve→schedule→effective | typedvalues, timezone/version/audit; ทั้งnew/existingcohortตามมติ; desired≠observedระหว่างรอ |
| CT17 C05 | แก้ราคา/limitโดยมีexistinginvoice/subscription/overquota | ไม่rewriteinvoiceเก่า/ลบข้อมูล; previewgrandfathering/consent; blockedvalueมีทางแก้draft |
| CT18 C05 | สองadminpublish, membership/cohortเปลี่ยน, cacheยังเก่า | conflict/stalepreview, activeversionเดียว; oldcatalogซื้อไม่ได้; refreshทางกลับ |
| CT19 C05/C06 | webpublishpolicy/gate→customerweb+marketing+LINEอ่าน→rollbackผ่านweb | sameprocess/startupconfigก่อนหลัง; observedrevisionตรงใน30วินาที(testtarget); compensationตามจริง |
| CT20 C06 | ปิดnew salesขณะหน้าcheckoutเปิดค้าง→submit | authoritativebackenddeny; ingress/reconcile/paid apply/history/recoveryยังทำงาน |
| CT21 C06 | แยกportal actions/plan changes/notifications/cohort toggles | ปิดเฉพาะactionที่เลือก; TEST ceilingข้ามเป็นLIVEไม่ได้; staleUIมีเหตุผล/ทางไปstatus |
| CT22 C06 | pause/resumecollectionที่มีexistinginvoiceและresumeAt | previewinvoicebehavior; providerobserved≠localgate; ไม่อ้างหยุดเก็บจากปิดขายใหม่ |
| CT23 C06 | provider/DB/workerunhealthyระหว่างเปิดกลับ | blocked/pending+incident; ไม่มีgreenจาก202; recoveryงานจ่ายแล้วไม่ถูกปิดตามcheckout |
| CT24 C07 | providerมีpaidinvoiceแต่localไม่มีevent / localpendingแต่providerterminal | bidirectionalrunหาmissingทั้งสองฝั่ง; mapidentityก่อนrepair; issueunmappedไม่grantผิดคน |
| CT24a C07 original-event recovery | local DEAD/RETRY event, source change, worker race, operator revoked, unavailable provider | scoped/redacted list→case→preview→durable command→actual shared reconciler→observed result→original event/back; preserve attempt history and quota; stale/active lease/wrong mode/delegated scope denied; exact event case resolves only after verified completion; PostgreSQL/HTTP/mobile browser proof required, not equivalent to full CT24 |
| CT25 C07 | 429/page2ล้ม/workercrashกลางbulk | checkpoint/coverage/lease; resumeonlyunfinished; partialresultsไม่รวมเป็นmatched |
| CT26 C07 | refund/dispute/cancelจากproviderdashboardขณะlocalpreviewค้าง | observedstateชนะstalecommand; reconcileไม่overwritehumanmoneyaction; review/compensate |
| CT27 C07 | configdrift/credentialrotation/settingอ่านAPIไม่ได้ | approved≠observed, readinessblocked; manualverificationtaskกลับมาcheckได้; secretไม่อยู่response/log |
| CT28 C08 | temporarygrant→baselineเปลี่ยน→expiryขณะworkerหยุด | readtimeexpiry; latestbaselineมีผล; companysecurityholdชนะoverride |
| CT29 C08 | revokeoverride/approvalหลังqueue; approve/executeพร้อมกัน | conditionaltransition+execute reauthorization; immutableauditผู้ทำก่อนหลัง/reason |
| CT30 C08 | rollbackหลังpartialprovider successหรือrefund settledแล้ว | per-itemcompensation/unsupportedreason; ไม่บอกเงินย้อนแล้วจากDBpointer |
| CT31 ทุกcontrol | 390px+desktop+keyboard, slowload/offline/401/403/404/429/503 | ทุกปุ่มactionหรือdisabledreason+next; finitepoll+refresh; no rawstack/secrets/emptydeadend |
| CT32 ทุกcontrol | case→preview→approval→run→observed→resolve→freshweb/LINE | companyเดิมเข้าถึงสิทธิ์ที่ควรได้; deniedholdมีsupport; ออกกลับStripe/LINEไม่สลับบัญชี |

เพิ่ม backend/integration รอบเงิน: signed raw-body webhook, replay/out-of-order/refund/dispute, customer mapping, provider API-version fixtures, idempotency lifetimeหลังprovider keyหมดอายุ, currency/minor units/rounding, clock skew/period boundaries, local DB deadlock/retry. Browserทดสอบนาฬิกาด้วย injected server clockในlocaladapter; page.clockอย่างเดียวไม่พิสูจน์worker/backend expiry. ใช้รายการ billing/LINE/UI casesเดิมร่วมด้วย ไม่แทนด้วย32แถวนี้.

## 3. รันบนเครื่องและพิสูจน์ no-deploy

1. ใช้ loopback PostgreSQL/Redis, isolated API/web ports/dist, disposable companies/users และ provider fixtures; guardปฏิเสธremoteURL. Fixturesetup/cleanupไม่เป็นหลักฐานuserflow.
2. หลังBC-S1กำหนดtarget suite `e2e/billing-controls.spec.ts` และproviderfixtureadapterในexistingbackendtestboundary. **ไฟล์targetนี้ยังไม่มี**; ไม่ใส่คำสั่งที่รันไม่ได้เป็นPASS. ห้ามลงdependencyหรือแก้package.jsonเพื่อเพิ่มชื่อscriptเฉยๆ.
3. เปิดAdminและcustomerคนละcontext. ทำทุกcontrolmutationผ่านweb→realBFF/API→DB/worker. Read-only DB assertionsตรวจuniqueoperations/audit/entitlements/negativeeffects. Snapshotprocessidentity/startupconfig/providerattemptsก่อนหลัง; ใช้serverrevisionพิสูจน์consumerอ่านค่าที่แก้.
4. ฉีดfaultที่provider/outboundหรือone-shot read failureสำหรับทดสอบreadrecoveryเท่านั้น. ห้ามเติมpaidในcontrolresponseให้UIดูสำเร็จ. จำลองLINE SDK/proofได้แต่ต้องเรียกจริงhandoffBFF/API/DB; nativeLINEจัดเป็นprovider/deviceevidenceแยก.
5. เก็บtestreport/traceเมื่อfail/screenshots/command/sourcehash/cleanupcount; mappingCT→ชื่อtestจริง→pass/fail/notrun. แยก local simulated/provider sandbox/native/live; “ครบ”เมื่อexpectedtestsไม่มีmissingหรือskippedโดยไม่อธิบาย.
6. ตามข้อกำหนดผู้ใช้ งานนี้ไม่ deploy. หลังimplementation หากใช้Stripe sandboxกับlocalhost ให้ใช้forwardingตามdeveloperreferenceและtestcredentialsที่authorized; ไม่ใช้productioncustomerทดสอบ.

## 4. Current runnable proof และข้อจำกัด

ใช้ `e2e/plan-term-billing-readiness.spec.ts` prefix **BC** สำหรับrepairที่มีruntimeอยู่แล้ว: system deep-link recovery, plan-term read retry และexistingAdminrenew→customeraccessผ่านเว็บโดยไม่restart. เป็นmanualtermgrantเดิม ไม่ใช่StripepaymentหรือC01–C08ครบชุด. คำสั่ง/ผลจริงจะบันทึกใน [evidence](../evidence/billing-controls-2026-09-11/README.md).

Previous 565 focused /25 browser /22 marketing เป็นevidenceก่อนงานcontrolนี้ ไม่บวกเป็นผลCT. เงิน/Stripe/Websignup/Postmark/runtimeที่ยังไม่มีใช้สถานะจากแผนหลัก. ไม่มี businessvalueapproval≠หยุดเขียนspec; แต่actionที่ต้องใช้ค่านั้นห้ามเปิดจนข้อมูลครบ.

## 5. Handoff / exit checklist

- [x] C01–C08 ระบุroute/state/permission/action/error/recovery/audit/no-deploy contract.
- [x] บันทึกcurrentcodegapและtargetmitigation; synchronizeทั้งสองrepoผ่านsourceoftruthlinks.
- [ ] BC-S0–S5 runtime/DTO/migrations/worker/provideradaptersครบตามverticalslice.
- [ ] CT01–CT32และrelated money/security/providercasesรันกับimplementationจริง; ไม่มีroutefulfillsuccessมาแทนbackend.
- [ ] ไม่มีปุ่มเงียบ/401loop/UNKNOWN→newcharge/paidheld→repay; negativechecksกับtenant/role/modeผ่าน.
- [ ] Webmutation→DB/worker→web/LINE/catalogเห็นrevisionเดียวกันขณะprocessไม่restart.
- [ ] Sandbox/nativeacceptanceตามแผนหลักและbusinesspolicyพร้อมก่อนpaidlaunch; deploymentเป็นงานแยกตามrunbook.

## 6. Developer preflight และการรับงานที่เริ่มได้จริง

ก่อนเริ่ม consumer UI/worker ให้ Backend + Web อ้าง [control spec §7](../specs/mangmee-billing-controls-spec-th.md#7-developer-handoff--ข้อกำหนดที่ห้ามปล่อยให้แต่ละทีมตีความต่างกัน) และลงรายการต่อไปนี้ใน implementation PR/memory. ทำในlocalได้ ไม่ใช่คำสั่งให้deployหรือส่งmessage.

1. **Dependency map:** ระบุ scope ที่กำลังทำกับ E0/B01–B10/security/approver/provider setup. Foundation, schema, mocks และ read-only UIเริ่มได้; live business behaviorที่ขาดมติคงblocked. TEST_ONLY fixturesไม่เป็นpolicyจริง.
2. **Contract freeze ของ slice:** shared DTO/parser + unknown-field rejection, command type→permission→scope→source version→effect→event/issue→next action. แยก `/system/billing/companies/:id` จาก full partner editorสำหรับdelegatedroles. Backendและfrontendใช้ชนิดเดียวกัน ไม่ใช้typedUIครอบunvalidatedJSON.
3. **Persistence/worker choices:** schema/index/lock order/active operation reservation/ledger constraints และ upgrade/rollbackของqueued schemaVersion. ระบุ lease, retry budget/delays, preview/approval TTL, pagination/bulk limit, escalation owner ในversioned operational config + focused testsก่อนmerge. ไม่มี∞ retryหรือunboundedscanเป็นfallback; operationaldefaultไม่แปลงเป็นcustomergracepolicy.
4. **Provider adapter contract:** pin API version/parser, local account/mode fixtures, approved Price/Portal configmapping; verify signature/raw body; persist unknown/unmapped. Runtime readingconfig/versionต้องครอบ webhook/worker/LINE/Postmarkจริง ไม่เช็คแค่AdminDBsave.
5. **Reproducible local fixture:** local ports, DBmigrations/seed, providerboundaryfaultcontrols, outbounds recorder, clock abstraction และcleanup. ระบุexactcommandเมื่อsuiteมีจริง; `e2e/billing-controls.spec.ts` ยังเป็นtargetไฟล์ ห้ามบอกว่ารันได้แล้ว. Existing BC suite ไม่ใช้แทน.
6. **Route completeness check:** ทุกbutton/link/loading/error/permission branchของsliceมีroute/handlerจริงและauthorizednextaction. Playwrightเดินทั้งcustomerและoperatorกลับบริษัทเดิมได้; directAPInegativechecksต้องแนบด้วย. Secrets/PIIไม่ลงreport/traceที่commit.

### 6.1 Additional acceptance DA01–DA08 — ทั้งหมด NOT RUN

| ID | Case / discovered gap | Required proof |
|---|---|---|
| DA01 | billing-onlyoperatorเปิดcompanybillingและลองfullpartner/platformroutes (DG01) | minimal authorized projectionผ่าน; partner metadata/credentials/AIbudgetและplatformgateยังdenied; ไม่ยิงforbiddenAPIชุดใหญ่ก่อนแสดงbilling |
| DA02 | submit→401/CSRF refresh/response loss→newdevice/expiredpreview (DG02) | intent/key/bodyเดิมตลอด; serverlookupก่อนcreate; sameintent/ต่างpayloadconflict;ไม่มีmutationจากGET/login |
| DA03 | สองoperatorคนละintent/keyทำrefund/apply/policyพร้อมกัน (DG03) | resource reservation+expected version; conflictเปิดงานเดิมตามสิทธิ์; amounts/period/grantsไม่ซ้ำแม้keyต่างกัน |
| DA04 | quote→price publish→existinghostedSessionpaid; oldinvoiceมาทีหลัง (DG04) | unsubmittedquote409; acceptedhistoricalsnapshotตรวจได้และไม่ถูกcurrentcatalogลบ; held/compensationตามpolicy |
| DA05 | stopnewlinks→existingCheckout/Portal→expireชนะ/แพ้paid race (DG05) | newcreationdeny; openexpire observed; completeไม่ถูกอ้างcancel/refund; pendinginvoiceapplyยังจบ; Portalexplicitconfigและunsupportedrevocationclaimไม่ปรากฏ |
| DA06 | payer/operator/publisherถูกถอดสิทธิ์ระหว่างqueueและหลังACTIVE (DG06) | manualmutationrechecks; UNKNOWNreconciledโดยservice; verifiedpaidไม่ค้างเพราะpayerrole; ACTIVEpolicyไม่หายตามคนเผยแพร่; recipientใหม่ต้องมีสิทธิ์ |
| DA07 | missingpolicy/approver/config + TEST_ONLYfixtureหลุดruntime + cross-accountcohort (DG07) | missingreason+owner/next; noNULL→unlimited; live loaderrejectfixture; cohortaccountmismatchdenyก่อนpartialmoneywrite |
| DA08 | migration/restore/oldqueued schema + pausedworker + portalconfigdrift (DG08) | retainledger/dedupe, blockunsupportedversion, recoverstatus; reconcileก่อนfinancialnewwork; noauto-rechargeหลังrestore; process/revisionevidenceตามCT19 |

เริ่มจาก BC-S0/S1 + Stripe S1 และ Postmark M1/M2 ที่ไม่เลือก E0 ใหม่แทนOwner. DA02–03ต้องมาก่อนเสนอ C03 ว่า safe retry; DA04–06ก่อนเปิดnew-salesgateหรือpricepolicy; DA01ก่อนgrantdelegatedoperator; DA07–08เป็นacceptanceร่วมทุกslice. ขั้นตอนนี้ลดจุดเดา แต่ไม่รับรองว่า implementationจะไม่มีbug; ต้องรับงานจากผลทดสอบจริงตาม invariant.

### Runtime progress 2026-09-13 — bounded operator slice

C01/C02/C04 foundation is now implemented in `BillingAdminService`, `/system/billing` controllers and the dedicated web subtree. This is **not C01–C08 completion**. Added explicit company/account/mode operator scopes, fresh active system-role checks, financial response masking, case version checks and audit. Scope expiry/revocation and copied company-role permission strings are covered in the real AppModule/PostgreSQL HTTP harness. First non-browser combined run20groupsPASS; browser extension is in progress. A company summary with25cases links to the fully paginated queue; financial pagination is independent. Resolve, provider financial commands, policy publication, approval/step-up, exports/overrides and operator documents still require the planned next slices.

The next command slice will reuse BillingOperation previews/immutable request hashes/source versions. Operator reconciliation returns a durable operation URL and must show the actual observed result; a202 enqueue response cannot mark a case resolved. New financial actions remain behind their explicit permission, accepted policy, fresh reauthentication and independent approval boundaries. Repeat-customer recovery and provider event processing continue when new-sales gates are closed.

### Configuration implementation checkpoint — 2026-09-13

Implemented scoped C03 reconcile/retry operation previews, durable status/recovery and real browser loop (35 combined groups at its checkpoint). Added C05/C06 platform settings, immutable policy/gate previews, independent approval and atomic publication, emergency close, session+credential-bound password reauthentication, and settings-version quote invalidation. New VAT policies validate issuer account tax ID/default invoice identity, TaxRate and prices. Settings changes preserve existing invoice/renewal contracts. Provider configuration reads happen outside database locks; approval/cancellation share settings CAS. JSONB comparisons use canonical object keys.

Focused configuration browser suite6groupsPASS and combined non-browser suite27groupsPASS; full combined41-group browser run is in progress. API typecheckPASS using repo-standard8GBheap; webPASS. AuthGuard37 and system-shell27 focused testsPASS. Counts overlap; these do not complete all C01–C08 acceptance. Remaining control work: privilege/scope management UI, read-only trial/legacy companies, retained draft/impact lists, collection/refund/override/notification operations and reconciliation/audit/export coverage. Full task still needs customer change/cancel flows, Postmark/signup/LINE coverage and CI/merge; no deployment.


### Collection checkpoint and next restart slice — 2026-09-13

49combinedHTTP/browsergroupsPASS with simulatedStripe;5focusedcollectionworkerfaulttestsPASS;API/webtypechecksPASS. Ordinary/prepaidcancel/resume, immutablecommandreservation/withdrawal/permanentUIlink, source/permission/leasefences and provider-observedrecovery are implemented. Separate nativeStripeTestClockproof confirms cancel_at at purchasedexpiry, resumewithoutcharge, and automatictermination. See integrationevidence/source receipt. This does not complete the full change-plan/operator/LINE matrix.

Next implement explicit restart after expired and terminalStripecollection: samecustomer/newsubscription under a fresh reviewed purchase, old invoice/contract history preserved, no expired quota revival, currentpaid/grace/security/source checks, duplicate/debt/refund/dispute refusal, new paid evidence before switching contract/applying access. Lower-cap restart uses the same explicit branch/seat selection required by downgrade. Never clear old baseSubscriptionId just to bypass a guard. Continue remaining full-scope work and CI/merges;NO DEPLOY.

Next mapped financial-history slice: record verified refund/dispute observations on BillingInvoice, reuse account lease and invoice-bound issue/audit, scan historical one-time and terminated-contract charges as well as the current subscription, expose observed amounts/status to customer and scoped Finance views, and extend repeat debt checks to historical one-time purchases. Prove late refund/dispute with missing/replayed webhook, wrong charge/customer/mode, observer lease loss, exactly one issue/audit for unchanged observation, and preserved existing quota pending manual review. Full provider-to-local discovery and settlement/override actions remain explicit outstanding C07/C08 work.

Next notification slice: consume billing.invoice.applied through the existing durable outbox into deduplicated notification events for current OWNERs, plus Postmark status notices via EmailDeliveryService with stable invoice/user intents. Reuse in-app/LINE delivery records and templates; extend billing-only final-send checks for owner/company/gate/exact LINE channel and bounded retry identity without holding company/invoice locks during provider calls. Verify real AppModule/PG HTTP with synthetic Stripe/Postmark/LINE transports, including missing/unverified recipients, role withdrawal, gate off/on, replay/crash/unknown/suppression, original documents retained and no new entitlement mutation. Add operator-visible delivery outcome/retry after producer/consumer proof. No external real recipients or deployment.

### Next C04 delivery slice — operator company scopes

Implement the C04 scope-management contract above with existing role-management authority, real password proof and immutable BillingOperation. Add scope version/CAS, bounded target directory and scope list, GRANT_SCOPE independent approval and reviewed REVOKE_SCOPE, dedicated web forms/permanent operation link. Cover grant→delegated read→revoke/expiry and role/source races in actual HTTP/PG/browser tests. Preserve company/account/mode and all existing money/receipt ledgers. Existing direct DB test fixtures are not acceptance for this UI. Status: design recorded; implementation and tests pending.

### Next C01 delivery slice — trial/manual visibility and company timeline

Implement the C01 read-model boundary above through existing scoped Admin endpoints and a typed timeline endpoint. Reuse customer state projection and original source records. Verify trial/manual/no-account and paid/grace/held states, mode/scope/financial/audit masking, stable pagination including timestamp ties, company switching and real browser refresh/back paths. Assert no new BillingAccount, receipt grant, invoice or provider call from a read. Keep native provider occurrence time unknown when not recorded. C07 unmatched discovery and C03 delivery actions are separate remaining work.

### C01/C04 checkpoint — 2026-09-14

Implemented C04 operator company-scope management with existing role authority, current-password proof, independent grants and immediate reviewed revocation. Implemented C01 trial/manual/no-account company search, shared current-state projection and scoped timeline with independent stable pagination. Final **101 combined actual HTTP/PG/Next/Chromium/isolated marketing groups PASS** with simulated providers. Focused company/scope/config16 and downgrade17 groups overlap. Source manifest/evidence and both repository notices are updated. Fixed select accessibility labels, clearing invisible selections and duplicate React panel keys; browser back/reload and original cursor-reference assertions now pass. This is not C01–C08/full spec completion; global SLA, remaining C03/C05–C08, mail/signup/LINE/native/CI/merges stay pending. No deployment.

### Next C02 slice — preserve case state and recover ownership

Add issue episode/lastSeenAt/priority/follow-up/backup fields and shared issue-detection logic without new payment state. Reuse current platform-role/operator-scope checks for bounded assignee lookup and commit-time recheck. Add unassigned/overdue queue filters and an explicit unavailable-owner badge with reassignment/return-to-queue paths, reviewed reassignment/backup/priority/follow-up with CAS/audit. Verify repeated detection while assigned, resolved→reopen, cross-company/mode/copied-role refusal, revoke between lookup/commit, competing editors, stale backup and no-worker overdue display in actual HTTP/PG/browser. Do not mark global SLA publication or unimplemented financial-resolution controls complete from this slice.

### Next C03 slice — original delivery recovery

Close the generic company retry path at the final repository mutation for Billing events and prove ordinary notifications still retry. Add a scoped original-delivery read model and permanent Admin links from company/case. Extend existing durable operations with RETRY_NOTIFICATION preview, source hash, concurrent-command exclusion, same-key recovery and final authorization. Reuse the original LINE delivery journal and Postmark intent; do not create a replacement recipient/message or reset attempts. Recheck operator authorization before external I/O for resumed deliveries, and retain a case when blocked. Show queued recovery separately from provider acceptance and confirmed delivery.

First prove the LINE path with real HTTP/PG/browser and simulated transport: configuration repair, same UUID after lost response, competing operators, source/recipient/preferences/gate changes, scope withdrawal after queue, expired key and exhausted attempts, refresh/back/mobile and unchanged money/quota. Then prove Postmark lookup/one reviewed successor generation, suppression/identity/retention/possible-duplicate boundaries under the mail spec. Provider documentation was refreshed on2026-09-14; native delivery acceptance remains separate. Neither this design nor a narrow retry check completes all C03 or mail operations.

Next C05 implementation sequence: (1) add DRAFT/read/edit DTOs using the existing operation table and real platform capabilities; (2) command-key replay and versioned edit receipt/audit; (3) create immutable linked preview through the existing readiness/approval pipeline; (4) web draft save/list/permanent link/edit/conflict/return and current settings display; (5) actual HTTP/PG/browser proof for incomplete mapping, competing edits, lost response, foreign/revoked actor, unchanged settings/ledgers before approval, and independent publication. No new dependency or package.json edit is needed. This section is a concrete next-slice design; implementation has not begun while final Postmark regression is running.

C06 next correction: add one shared effective-gates normalization for the legacy unused portal_change_plan key, reuse it at persisted settings/draft/preview read-and-compare boundaries, reject new enable requests with a supported-action next step, and replace its editable checkbox with the owned-plan-change explanation. Verify legacy true records plus saved draft→preview→approval and current web/LINE plan journeys through actual API/browser, then rerun the combined suite. This is not permission to turn on native Stripe subscription_update or bypass purchased days/quota accounting. Not implemented while C05 full122 regression is running.
