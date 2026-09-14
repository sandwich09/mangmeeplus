# แผนสิทธิ์แพ็กเกจ 7 เมนู / รายเดือนและรายปี / Enterprise lock

> **Implementation update 2026-09-14 — IN PROGRESS:** actual Next/Nest/PostgreSQL/Chromium + isolated marketing ผ่าน158กลุ่มกับ Stripe/Postmark/LINE จำลอง รวมAdminกู้สิทธิ์จากใบเสร็จเดิมที่เลือกและตรวจeventตกหล่น. สมัครเว็บ8และยืนยันอีเมล6เป็นหลักฐานแยก ไม่รวมใน158. API/web typechecks, billing/DTO29, PostgreSQL35ผ่าน. Root CI34801493799(7ca2d7a8)ผ่าน; รอบ34803284452(6da65148)ติดจังหวะlegal redirectในsignup fixture ซึ่งแก้และรันsignup8ผ่านแล้ว รอCIใหม่ของโค้ดรอบนี้. Marketing CI34802725764(0cd88eb)ผ่าน. Controls/fullsignup/fullLINE/mailยังมีงานค้าง; email password recoveryรอOwner. Receipt-only HIDDEN/Enterprise Coming soon; ยังไม่merge/deploy. ดู[หลักฐาน](../evidence/billing-integration-2026-09-13/README.md).


> **Owner amendment 2026-09-13:** [มติล่าสุด](../specs/mangmee-billing-pack-amendment-2026-09-12.md): ซื้อเริ่ม/จ่ายทันที, VAT OFF ปรับผ่าน Admin, upgrade จ่ายส่วนต่างเริ่มทันที/วันสิ้นรอบเดิม, downgrade สิ้นรอบที่จ่ายแล้ว, รายปีได้โควตา 12 เท่าทันที; ใช้หมดซื้อแพ็กเกจเต็มเพิ่ม ซื้อเฉพาะใบเป็น HIDDEN ตามมติล่าสุด: ซ่อนไว้ทุกช่องทางและยังไม่เปิดขาย. ซื้อแพ็กเกจเดิมซ้ำเพิ่มโควตาทันทีและต่ออายุจากวันหมดอายุเดิม; ยังไม่เปิดขายก่อน readiness. ไม่มี deploy; full paid E2E ยัง IN PROGRESS.

> **ขอบเขต merge 2026-09-11: เอกสารเท่านั้น** — ผล runtime repair/test ที่อ้างเป็นหลักฐานจาก branch งานแยก ยังไม่ใช่การนำโค้ดนั้นเข้า main/develop. ดู [สถานะส่งมอบเอกสาร](../agent-memory/billing-spec-docs-merge-2026-09-11.md).

สถานะ: **SPEC/PLAN UPDATED; full package E2E NOT RUN; Stripe runtime NOT IMPLEMENTED**. [Spec หลักของ amendment](../specs/mangmee-package-entitlements-spec-th.md) คือ requirement ตาม Owner 2026-09-11. ต่อจาก S0–S5/L0–L5/C01–C08 เดิม ไม่เริ่ม billing engine อีกชุด. [หลักฐานรอบนี้](../evidence/package-entitlements-2026-09-11/README.md) แยก focused/current-marketing regression จาก future paid E2E.

## 1. ลำดับส่งมอบและ impact

| ขั้น | งานและจุดกระทบ | Exit |
|---|---|---|
| PE-S0 Contract/docs | sync 2 repos, catalog month/year, trial preset7, Enterprise lock, decision deltas; แก้คำอธิบาย modulePackage เก่าที่ไม่ตรงโค้ด | เอกสารมีราคา/limits/feature mappingตรงกัน; executable source checks แยกจาก runtime |
| PE-S1 Schema/config | extend S1 DTO/catalog/quote/attempt/invoice/policy with interval+snapshot; composite uniqueness; 6 available-in-future paid Price mappings, 2 locked Enterprise previews; no trial Price | PostgreSQL migration/rollback/duplicate variant check, mode/account isolation, missing mapping fail closed |
| PE-S2 Apply/limits | S3 shared transaction; paid-through provider period; exact package grant provenance; branch/seat concurrency; paid receipt grant ledger linked to existing admission/compensation; preserve legacy monthly behavior | protected actions/roles/usage/other company assertions; no reset or blanket overwrite |
| PE-S3 UX/entries | S2/S4 U01–U12, 2-repo month/year review, trial7/15, LINE rich-menu/webhook/LIFF, coming-soon tax states | mobile/desktop journey and all denied paths have authorized exit; no direct payment bypass |
| PE-S4 Control/provider | C05/C06 revisioned variant readiness, Portal allowlist, stale sessions/legacy mapping drift/repair; B01/B05/B06 behavior-specific approval | supported web config changes observed without restart; Enterprise remains locked under generic enable |
| PE-S5 Acceptance | local simulated adapter → real API/PG/browser; Stripe sandbox + native LINE acceptance; PE01–PE36 plus original applicable suites | exact evidence per case/mode, 0 unexplained skipped/flaky; no LIVE claim from local proof |

Do not rename plan tier keys or map paid tiers to `standard/full` feature preset. No backfill of existing entitlement/usage/term based on marketing labels. No package.json or production runtime/config changes are required to deliver this documentation amendment.

Business deltas 2026-09-13: B01 no-card signup and immediate paid conversion/no trial carry approved. B02 annual allowance ×12 upfront, no paid monthly reset, repeat purchase is a full package only; same-package repurchase grants full units now and appends the full interval to the existing paid expiry. B05 upgrade prorated immediately, downgrade at paid period end; mid-period interval switch remains closed. B06 VAT OFF, future inclusive/exclusive configured via approved Admin revision. B09 **Enterprise sale locked**; legacy/custom exceptions need separate decision and cannot bypass lock. B03/B04/B07/B08/B10 unaffected. Feature locks cannot be removed by a generic price/policy enable.

## 2. Acceptance matrix PE01–PE36

**All rows below are implementation acceptance targets, initially NOT RUN in full.** Some underlying source/use-case/marketing behavior is checked separately in this round's evidence; never promote a row to end-to-end PASS from a focused test.

Parameterization: all applicable paid rows run `STARTER_249/BASIC_499/PRO_999 × month/year × web/LINE` (12 variants). All entry/negative cases also exercise Enterprise month/year, unauthenticated/OWNER/employee/revoked actor and company A/B where relevant. 36 rows are scenario groups, not 36 actual executable passes. Existing F01–F24 remain the journey inventory; these rows extend them rather than claim 36 new product journeys.

| ID | Flow / scenario | Required assertion / recovery |
|---|---|---|
| PE01 | Web signup → provision → first company (F01/F02) | no card/Stripe call; FREE_TRIAL_15 + starter17keys/7menus +1/2/15/30days; first permitted expense action; lead modal alone never counts as provision |
| PE02 | LINE signup → provision → first receipt → web (F04/F05) | same preset/term, identity/company correct, syntax email not mailbox proof, no password/payment gate added |
| PE03 | Pending/reject/resend/repeated signup/link another login (F03/F05) | no premature grant, no duplicated trial/company, pending status/support exit; existing paid/custom state preserved on retry |
| PE04 | Seven menus / role / direct URL (F07/F13) | OWNER sees7 configured menu entries; employee permission-filtered; nonstarter keys explicit false, dashboard+notifications share key, parent/children not inferred from tier name |
| PE05 | Trial OCR 1–15 then16 / legacy warmup10 (F13) | same counted total across web+LINE; 15 usable saved results then hard limit; default15 immediate, custom override shown; fixture proves enforcement is ON |
| PE06 | OCR fail/replay/reread/notification fail (F13/F19) | failed attempt released once; replay/lost response no duplicate count/write; deliberate new reread follows existing policy; notification-only failure keeps successful count |
| PE07 | Concurrent last slot + midnight compensation (F13/F23) | one succeeds at capacity, exact old-month release, bank/nonreceipt route isolation, no negative/double-decrement usage; AI budget distinct refusal |
| PE08 | Trial expiry vs calendar reset (F13/F14) | 30-day term unaffected by new month, no renewed trial from login/payment query; recovery page accessible, protected writes refused after expiry |
| PE09 | Catalog from marketing/app/LINE (F01/F08/F21) | exact monthly+annual totals/limits, savings498/998/1998/3998 on same tax basis; variant keys include interval; current paid-disabled honest |
| PE10 | Toggle month/year and review (F08) | quoted payable total/interval/renewal date/consent match; annual quota is granted upfront; membership expiry unchanged; stale quote needs review and selection survives safe login |
| PE11 | Tamper price/interval/quantity/company/mode (F08/F09) | server rejects unsupported interval/count/Price/customerId/amount; no provider mutation, no cross-company invoice |
| PE12 | First purchase12 variants → protected business action (F09/F12) | signed verified invoice → atomic paid apply once → correct tier7menus/limits/service period in web+LINE; no need return/email/payout |
| PE13 | Checkout 3DS success/cancel/decline/browser back (F09) | truthful pending/failure, no grant before verified+applied, existing payable action/status/support instead of duplicate purchase |
| PE14 | Close browser/no-return/expired cookie (F06/F12) | webhook/reconcile applies, login/LINE returns exact company+attempt, safe legal/password gates, access projection refreshed |
| PE15 | Web+LINE/two tabs/different command keys (F10) | one collectible base attempt/subscription, stable intent through unknown response; unique price variant does not permit parallel subscriptions |
| PE16 | Delayed/duplicate/reordered/wrong signed events (F11) | durable inbox/mapping/quarantine, retry processing, forged success query no authority, old invoice no rollback of newer rights |
| PE17 | Apply crash/hold/actor revoked (F12/F20) | transaction rollback or exactly-once replay; paid+held reference, service fulfillment separate from human auth; no hold/role override |
| PE18 | Limits before/after purchase (F13) | aggregate caps, OWNER seat counted, room for new branch/user correct; concurrent create/reactivate cannot exceed; other company unchanged |
| PE19 | Immediate prorated upgrade (F16) | Basic→Pro half month adds25, half year adds300; prior usage retained, same period end; preview timestamp matches payment, no grant before verified payment, no unpaid-time credit |
| PE20 | Annual upfront quota and full-package repurchase (F13/F14) | Starter360/Basic600/Pro1200 immediately; may exceed monthly equivalent early; next calendar month grants nothing; exhausted→full-package repurchase→OCR succeeds; expiry/next charge follow approved append-to-paid-expiry policy; failed/duplicate payment no extra grant |
| PE21 | Annual renewal / leap-year / month-end (F14) | exact provider service period, not30/365days; one apply per renewal; app clock and provider clock advanced separately and evidence captured |
| PE22 | Monthly↔annual plan change (F16) | approved quote/proration/anchor only; replace base item no append; mid-period interval switch disabled UI/API/Portal until anchor/credit policy exists; status/card/support still usable |
| PE23 | Downgrade over limits / cancel pending change (F15/F16) | no deletion/regrant, clear effective date/overage/manage path, pending change version fence, no unintended midyear refund |
| PE24 | Renewal fail/grace/old debt/rejoin (F14/F15) | annual/monthly policy correct at paid-through; retry same invoice; missing business policy blocks enabling flow, not fake paid grant |
| PE25 | Cancel/undo/refund/dispute (F15/F17) | financial/access axes separate, full/partial/failure transitions audited, annual remaining value uses approved policy, no automatic resubscribe |
| PE26 | Enterprise pricing both intervals (F01/F08) | Coming soon, disabled semantic button/no href; tab/Enter/touch cannot pay; prices only preview; PRO999 unaffected; return/trial/other offer available |
| PE27 | Enterprise forged quote/API/handoff/old LINE card (F08/F09) | ENTERPRISE_COMING_SOON; no provider call or collectible attempt; support request cannot convert to payment; interval tampering cannot bypass |
| PE28 | Portal/Payment Link/config bypass (F16/F21/F23) | explicit Portal product-price allowlist excludes Enterprise; inventory legacy links; generic sales-enable cannot unlock either variant; report drift |
| PE29 | Enterprise old session expiry/paid race (F11/F20) | expire open through durable command; reconcile completed; paid+held issue handled, financial record retained, no unsupported tax grant |
| PE30 | ภ.ง.ด.53/50ทวิ feature lock (F07/F13) | SYSTEM issuance/official filing paths disabled regardless of tier/limit override; existing3 cap.wht50bis routes stayCLOSED; no whole-tax shutdown; source payment/external handoff/manual review/ordinary expense documents still work per spec§6.1 |
| PE31 | Invoice/Receipt and Postmark/LINE outbox (F18/F19) | actual authorized Stripe documents show annual/monthly totals; no fake full-Thai-tax-invoice label, no duplicate receipt via Postmark; delivery failure not access failure |
| PE32 | Company switch/employee/revoked/forwarded group link (F05/F07) | no privilege escalation, no staleA response inB, no bearer/payment docs in group, pending intent retained only for authorized company |
| PE33 | Operator price/policy publish/rollback via web (F20/F21) | same API/worker PIDs, desired=observed revision across app/marketing/LINE within control target; historical accepted snapshots intact; Enterprise still locked |
| PE34 | Provider/catalog outage/429/offline/stale caches (F10/F23) | fail-closed new purchase, bounded retry/status/support; paid ingest/apply/recovery continues; no client price fallback |
| PE35 | Restore/legacy/custom feature override (F22/F24) | dedupe/provenance survives recovery; signup retry no reset; no auto-migrate manual terms to Stripe; tax lock does not erase existing data |
| PE36 | Full navigation desktop390/nativeLINE (F01–F24) | marketing→signup→trial→review→payment→business→history→Portal→return and all negative exits; auth/legal/reload work, screen reader/keyboard usable, no horizontal overflow |

## 3. วิธีรัน E2E โดยจำลองได้และไม่ต้อง deploy ซ้ำเพื่อเปลี่ยน config

1. Build/start initial local API/web/worker once, loopback PostgreSQL/Redis only. Record PID/source revision. Use isolated fixture companies and real production use cases/HTTP/BFF/browser; stub only external identity/mail/OCR/Stripe seams. Block external messages and live account access.
2. Create web and LINE users through the appropriate signup path; simulate LINE ID proof at verifier seam, not by writing a paid term mid-flow. Assert stored starter entitlements, active membership, FREE_TRIAL_15 and first permitted receipt result. Keep separate known legacy/admin fixtures for recovery tests.
3. Publish TEST_ONLY monthly/yearly catalog and permitted variant config through authorized operator UI once controls exist. Enterprise remains locked. For unresolved business rules use conspicuously TEST_ONLY values rejected by LIVE activation. Record before/after observed revisions and same PIDs; newly coded schema/provider adapter still needs initial build.
4. Run actual quote/Checkout endpoint → simulated provider response → **raw signed webhook** → inbox/worker/apply → browser refresh/LINE action. Inspect durable invoice/applied marker/ledger, usage and protected APIs. Fault injection at network/commit/delivery seams must not call admin renew as a substitute for invoice apply.
5. Advance provider and app clocks independently for monthly/annual renewal, paid grant expiry and legacy Bangkok quota rollover. Assert annual paid balances do not reset on calendar boundaries; test full-package repurchase expiry/next charge against the confirmed policy. Test helper inaccessible from production/public runtime; don't wait a year, alter host clock, or pass client-controlled quota dates. In real Stripe sandbox use supported Test Clocks and exact current API version, wait for advance completion and inspect provider invoice lines.
6. Run PE26–PE30 negative enterprise/tax matrix even when sales closed. Capture denied HTTP codes, **zero provider calls**, no new collectible attempt/invoice/grant and visible alternative path. Include stale-session race independently from “creating a new session is blocked”.
7. Run original applicable T01–T42/G/LB01–LB20/CT01–CT32/DA01–DA08 cases, then native LINE iOS+Android and real Stripe card/3DS/Portal/documents acceptance. Browser-simulated LINE is labelled as such. A config change should not need deployment for already-supported fields; failed source/schema readiness is not a permission to force-enable.
8. Save per-case source/config revisions, exact command, scenario variants, provider fake/real label, before/after assertions, screenshots, retry reasons and cleaned fixture counts. No skipped test counts as PASS; paid/runtime work remains NOT RUN until this executable path exists.

## 4. Current gaps and delivery boundary

Existing signup calls the correct starter preset and FREE_TRIAL_15; older P26 “modulePackage display-only / DEFAULT_ENABLED for every signup” text is stale and corrected with this amendment. Existing admin term presets match all limits in the poster; this proves neither Stripe auto-apply nor annual price mapping. Starter has7 menus despite6parents, so a test that asserts7parents is a false defect.

Missing implementation tracked in PE-S1–S5: shared billing catalog/interval DTO and provider mappings, live-capable quote/payment worker, package provenance apply, annual UX/consent, offer-specific lock in all provider/control entry points, tax readiness integration per inventoried spec§6.1, native/sandbox acceptance. E0 easy web auth and unapproved financial policy values remain dependencies for their own paths; safe closed-state E2E is mandatory meanwhile. These are not silently declared fixed by doc consistency checks.


## 5. Access parity AP01–AP24 — admin/user/LINE extension

Source: package spec§9 and [audit](../research/package-access-admin-web-line-audit-2026-09-11.md). **End-to-end status of every row initially NOT RUN**; focused regression evidence only partially covers rows and is reported separately. These24 scenario groups expand existing PE coverage, not24 new product journeys or executed passes.

| ID | Scope | Required end-to-end proof |
|---|---|---|
| AP01 | Admin authorization | SYSTEM_ADMIN vs delegated billing vs OWNER/employee; direct console/API no escalation, safe denied exit |
| AP02 | Preset/child settings | starter7menus/17keys preview→save→reload; unsaved toggle no effect; individual child-off removes corresponding actions |
| AP03 | Admin CAS/retry | command/body/key retained through lost response; two admins/paid-worker race no overwrite/duplicate grant; actionable conflict |
| AP04 | Dependencies/normalization | cascade confirmation, foundation invariant, pending normalization, launch CLOSED refuse atomically; recoverable UI |
| AP05 | Plan vs feature vs role | tier/interval/limit change cannot assignrole, openEnterprise/tax or overwriteexplicitoverride; current effective read model honest |
| AP06 | Disable/re-enable/retained work | newroot blocked; authorized pre-cutoff reimbursement/payment/externalWHT completes; no data deletion or automatic replay on reopen |
| AP07 | Role/membership lifecycle | disabled role stays ineffective after membership reactivation; ACTIVE roles only, no dormant OWNER/SYSTEM_ADMIN grant; no last-owner bypass |
| AP08 | Same-process propagation | admin save observed in fresh web/LINE/tool calls and menu without restart; old tabs/quotes usecurrentrevision and deniedwritesstayblocked |
| AP09 | Dashboard | widgets/counts/drilldown honor module+role+branch/own scope, no cross-company aggregate leak |
| AP10 | Expenses | list/detail/upload/manual/evidence/signature actions each guardparent/child/role; direct URL and APInegative; no quota bypass |
| AP11 | Reimbursements | create/own/read/approve/finance distinguished; retained-work allowedonlyforsourceeligible records; no self-approval escalation |
| AP12 | Employee/roles | branch/own scope, roleassignment authority, disabled roles, last-owner, concurrent seatadmission; feature purchase never grants roles |
| AP13 | Company settings | foundation routes usable, branchlimit count/concurrentreactivation, scopedcompanyselection, securityforms permissionchecked |
| AP14 | Notifications | company/recipient/unread counts + target deeplink access; stale notification does not bypass newly closedfeature |
| AP15 | User transitions | expired/held/paid-applying/overlimit and 401/403/429/offline have truthful action; replayquery/cookie cannot unlock |
| AP16 | Feature variants | trial/paid3tiers×month/year share7menus pluslimits; overrides/provenance/legacy explicit; Enterprise and SYSTEMtax output locked |
| AP17 | AI help and follow-up | TH/EN whatcanIdo/how/nextstep advertiseonlyusablecapabilities; servicesoverview distinguishedfromemployeeauthority; disabled/modeloffselfhelp no LLM |
| AP18 | Social/knowledge/companyQ&A | greetings/generaldiscussion not companyfacts; dataquestion usescheckedsource andown/branchscope; AIbudgetdistinctfromreceiptquota |
| AP19 | Tool execution | forgedroles/company/tool/delegation and unsupportedtool/module refused before data; local/AgentCore parity and currentDBreauthorization |
| AP20 | Historical reply | admin closes sales while CRM permission remains; old salesresult omitted from text/media router+gateway history; active/legacy without current source proof also omitted by AP21; user question retained |
| AP21 | Scope/history/replay | branch narrowed/employeechanged/oldsource inaccessible: cachedreply/sourceRefs/preparedplan cannot leak; no unproven history fact reuse |
| AP22 | Revoke during model/delivery | role/feature/company/link/opt-out changes between tool result and live/queued push suppress stalefacts/deeplinks with durable outcome |
| AP23 | Media/draft/final action | receipt/PDF/caption/re-read perchildpermission/quota; prompts/images cannot grant capability or confirmfinancialaction; queuedretry doesnotdoublewrite |
| AP24 | LINE identity/return | staff vs customer/group/forwardedlink, A/Bcompanyswitch, unlink/relink, nativewebreturn and expiredsupport all preservecurrentactor/scope |

Execution order: reproduce and repair confirmed shared-boundary defects with regression first; run existing admin/permission/menu/internal-tool/response-composer/AgentCore/queue suites; record pending record-lineage/delivery-race gaps without declaring them fixed. Then build the real local browser+API+PG+webhook cross-layer harness and run AP01–AP24 before enabling corresponding paid slice. No new policy value, live gate/role or external LINE message is authorized by these tests.


Access follow-up slices: **AP-S0** AX01history feature filter + AX02ACTIVErole projection: bounded repair with before/after regression. **AP-S1** authorizationContext/source-lineage contract and migration/reuse guards for AP21 (spec§9.5). **AP-S2** final dispatch/replay recipient-access fence for AP22; no mutation replay, define send/revoke linearization. **AP-S3** actual admin→user→LINE browser/API/PG acceptance AP01–AP24 plus native device tests. AP-S1/S2/S3 remain NOT IMPLEMENTED/NOT RUN as complete slices; current unit passes are not closure evidence for them.

AP-S1 reader-first correction (2026-09-14, locally verified in the1218-test LINE module run): omit all stored assistant-derived previews from text/media model input, including rows without tool metadata and rows whose permissions/features still pass. Preserve user questions/window/company/actor boundaries and only a fixed capability-help routing hint regenerated against current access. Exercise real text and media handlers, no-tools/unknown-tools/permission-preserved and feature-off cases, and confirm the current gateway still receives fresh access/tool inputs. No schema rewrite or cached-source authorization shortcut. Full delayed delivery/source replay and AP-S3 acceptance remain separate pending work.

AP-S2 first live/queue actor fences (locally verified in the1218-test LINE module run): exact current LINE recipient and selected-company/support-pause checks before model and before push; compare canonical pre-model/final access including null versus explicit-empty entitlements/scopes. Test role, membership, company, feature, branch, unlink, opt-out, account-disable and handoff-delay changes; unchanged/reordered access still delivers. Keep recorded ERP results; terminate unauthorized queued delivery. The live text/media seam also rechecks after handoff preparation and before reply-token push fallback, preserves support-pause menu actions, and replaces group private output with a public private-chat instruction. Do not claim source-record/replay/UNKNOWN safety from this narrower proof.

AP-S2 source proof implemented/locally verified: bounded request/actor/company/tool inputs and result hashes reuse the registered ERP read implementations. Internal producer awaits proof storage; live/queue reread before dispatch; stored outcomes preserve original actor/private recipient/channel/request/evidence and current reads precede replay.41-file module1269testsPASS/0skips, final focused PostgreSQL29PASS/catalog4PASS and API/web typechecksPASS, including21 actual PostgreSQL source/live/replay tests,8 actor tests and2 quota races. Wrong source, legacy/missing proof, wrong actor/chat/channel and stale claims suppress old facts without replaying ERP mutations. Unverifiable capture outputs use a static web/new-question recovery path. Additive local migrations only; full billing browser/HTTP/isolated marketing129groupsPASS. Still open: source-derived intake/draft/live-capture coverage, queue UNKNOWN durable exact-payload recovery and full AP-S3. No native/provider acceptance or deployment claim.

## 6. Annual/full-package amendment acceptance Q01–Q10 (2026-09-13)

Full HTTP/browser/provider rows remain NOT RUN until linked evidence exists; focused grant tests are supporting evidence only.

| ID | Required evidence |
|---|---|
| Q01 | All3 tiers ×month/year catalog/quote show exact cycle units, price, expiry and consent; Enterprise locked |
| Q02 | Annual Pro consumes101+ in first month and1,200 before anniversary, receipt1,201 refused in both web/LINE; calendar change never grants |
| Q03 | Full-package repurchase→Checkout→signed webhook→apply once→receipt succeeds; full catalog price and confirmed expiry/next charge, no receipt-only SKU |
| Q04 | Decline/3DS/UNKNOWN/duplicate/reordered/repurchase policy change mid-quote; no duplicate payment/grant and actionable return |
| Q05 | One remaining receipt with concurrent web/LINE; one admission, one refusal; failed OCR returns exact grant once |
| Q06 | Earliest expiry consumed first; release after expiry does not restore available balance; old LINE retry cannot reuse expired grant |
| Q07 | Immediate upgrade retains used count, prorated delta floor using exact paid period; unpaid invoice/change interval refused |
| Q08 | Downgrade at monthly/annual end only, owner selection/version fence, over-cap recovery without deletion/owner lockout |
| Q09 | Generic sales-enable cannot open DRAFT receipt-only offers; full-package policy preview/approval same processes; test-only cannot activate LIVE |
| Q10 | Permissions/other-company/security hold/grace/renewal/refund/dispute; no grant on unpaid renewal; no package purchase bypass of holds/AI budget |

Receipt-only option (Owner decision): HIDDEN, sales closed. No offer/price/button/placeholder or AI upsell on customer web, marketing, LINE/LIFF/rich menu or live Admin screens. Direct/tampered purchase must fail before provider calls; generic base-sales enable must not expose it. Preserve design only; this optional purchase does not block completing full-package billing. Add hidden-catalog and direct-request negative coverage to Q09.

Local implementation evidence 2026-09-13: [paid grant/formula/legacy OCR checks](../evidence/billing-package-2026-09-13/README.md). Supporting coverage for PE19/PE20/Q02/Q05/Q06; full rows remain NOT RUN because browser/provider/scheduling paths are not complete.

AP-S2 queued UNKNOWN follow-up (next implementation): reserve a durable per-stream/per-entry outcome with bounded lease; retain first exact messages/authorization/completion metadata; stamp UNKNOWN before provider I/O and reuse the same payload/key after response loss. Prove concurrent producers, expired-lease writer, same-webhook sub-request isolation, crash after storage, unknown response, accepted-before-ack, source/actor change and context expiry. No model/ERP rerun once an outcome exists. Reuse original channel provenance and AI-retention cleanup. Do not claim this implemented from the source-read checkpoint.

Queued exact-delivery checkpoint:42-file module1287testsPASS/0skips and API typecheckPASS. Actual isolated PostgreSQL covers24source/live/replay/queue tests,7queued lease/ownership tests,8actor cases and2quota races. UNKNOWN retries the stored payload/key; accepted/ack loss does not resend; source revocation sends only generic recovery. Live ownership precedes outcome storage, busy/timeout notices stay intermediate, and losing finalization preserves the winner. CI includes the new PG file. See line-queued-result.json and exact TAP/source hashes. Full AppModule/browser rerun pending; source-derived intake/draft/live-capture and full AP-S3 still open. No deploy/CI/push/merge.

Runtime receipt-enforcement slice IN PROGRESS: additive nullable CompanyAiConfiguration override; reuse partner OCR CAS/audit/permission form and shared admission; expose effective paid/default/company source in the usage read. Prove Admin true→false→null→true changes web/LINE admissions without restarting, paid exhausted quota cannot be bypassed, bank statements/operational limits unchanged, concurrent/stale save denial, old-client field omission preservation, exact UI saved/draft state and return paths. Dedicated local DB only, no deploy.

Runtime enforcement checkpoint COMPLETE for this slice:139focused testsPASS/0skips, full133actual HTTP/PG/Next/Chromium/marketing groupsPASS and4focused quota browser groupsPASS; contracts build and API/web typechecksPASS. Same bootstrap validation as main.ts, actual stale save→current reload→review/save, persisted return and paid grant control disabled. Clean mobile control inspected. Nullable override migration applied only to dedicated local DB. Existing default not activated globally. Native upload/provider and full AP-S3/control/signup scope remain separate. Evidence: ../evidence/billing-integration-2026-09-13/receipt-quota-result.json.
