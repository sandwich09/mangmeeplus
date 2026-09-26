# Implementation index: ลงมือแก้ AI มั่งมี v2.4

วันที่: 2026-09-27\
สถานะ: **Design specified; ทุก implementation slice ยัง planned**\
Baseline: `f932b57766f5dd22c0d28aedd4bc06f210e374ef`; working checkout มีงานอื่นอยู่ ต้อง reconcile ก่อนเริ่ม implement\
Parent: [plan](mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md), [spec](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md)

## 1. วิธีเริ่มงานและนิยามว่า “ครบ”

ใช้เอกสารนี้เป็น implementation entry point ไม่ต้องออกแบบสามช่องว่างเดิมใหม่: full input/evidence, durable multipart delivery และ reimbursement DRAFT writer มี wire/schema/transaction/state/test contract แล้วใน appendices ด้านล่าง รวม active scope R1/R2/R3 ทั้ง 17 capabilities และ 15 W packages; C13/W10/เคสเสียง E18/E19 ยังพัก Financial Profile/Services Needs ยังไม่รวม

“ครบ” ในที่นี้หมายถึง **ขอบเขตที่ตกลงและข้อบกพร่องที่ตรวจพบมีเจ้าของงานและเกณฑ์ตรวจทั้งหมด** ไม่ได้หมายถึงพิสูจน์ว่าไม่มีบัคอื่นซ่อนอยู่ ข้อค้นพบใหม่จาก implementation/E2E ต้องเพิ่มใน issue map โดยไม่ลบทิ้งหรือเปลี่ยน oracle เพื่อให้ผ่าน สถานะของทุกรายการเริ่ม `planned`; ปิดเป็น `verified` ได้เมื่อมี exact commit/config และหลักฐานตามระดับที่กำหนด

| Contract | รายละเอียดที่ล็อก | เจ้าของการแก้ |
|---|---|---|
| [Core capability contract](../specs/mangmee-ai-core-capability-contract-2026-09-27.md) | owner/CAS/lifecycle, actual capability, meaning/queries/facts, bank adapters, receipt/Q&A, help/public/preference | W00–W09/W12 |
| [Input/provider/budget contract](../specs/mangmee-ai-input-provider-budget-contract-2026-09-27.md) | raw input/spans/candidates, versioned budget grant/reservation, provider completion/usage/deadline | W01/W03/W11/W13 |
| [Delivery contract](../specs/mangmee-ai-reliability-delivery-contract-2026-09-27.md) | canonical answer, LINE batches, controls, source proof, replay/cancel/UNKNOWN/outbox | W01/W13 |
| [Business document write contract](../specs/mangmee-ai-business-document-write-contract-2026-09-27.md) | รายจ่าย/ใบทดแทน/ใบเบิก create/update, fields, preview, idempotency/CAS/commit | W03/W06C/W07A/W13 |

Path ในตารางเป็น repo-relative code seam ให้เปิดจาก repo root; suffix `NEW` หมายถึง planned file/table ไม่อ้างว่ามีอยู่แล้ว Names ของ private helper เปลี่ยนได้เพื่อใช้ existing pattern แต่ wire/authority/state/acceptance ห้ามลดลงโดยไม่แก้ spec

## 2. Execution order และขอบเขต PR

1. **S0 baseline:** W00/W14 inventory และ reproduce บน main รวม PR819 ที่ตรวจแล้ว เก็บ dirty-work diff/hash และห้าม overwrite เริ่ม implementation ใน checkout ที่ reconcile เสร็จแล้ว Freeze schemas, effective flags/model, source snapshot และ corpora ก่อนวัด baseline A
2. **S1 contract + budget:** W01/W11 แบบ additive readers ก่อน writers; candidate input/rendered-schema feasibility test ก่อนเปิด new text limits No need to wait for R2/R3
3. **S2 truth + ownership:** W02/W05 + W13 foundation ทำ owner/lifecycle, semantic query/basis/money, delivery/source authority พร้อมกัน เป็น dependency ของ semantic and write features
4. **S3 R1 behavior:** W03/W04/W06A/B/W07A ต่อ semantic proposals เข้าของเดิม, remove false blocks, receipt field evidence; ทดสอบทุก lane ที่จะเปิด ไม่เปิด native lane ใหม่เพราะชื่อโมเดลรองรับ
5. **S4 R1 integration:** W13 integration + W14 paired evaluation → W15 release gate เฉพาะ R1; bugfix R1 ไม่รอ new capabilities
6. **S5 R2:** W06C ใบเบิก DRAFT writer, W07B generic Q&A, W08 full approved packs, W09 public lookup; separate flags แต่ใช้ foundation เดียว; W15 ซ้ำครบ R2
7. **S6 R3:** W12 explicit preferences + W15 full active scope; คำรับรอง 17 capabilities ต้องรอ S6

แต่ละ PR ต้องผ่าน contracts + affected API/Gateway/web consumers + migration compatibility ก่อน merge; feature flag OFF ไม่ใช่ข้อยกเว้นให้ schema/security broken เข้า main ไม่รวม unrelated package.json/script/metadata edits Split W13 เป็น foundation และ integrated acceptance เพื่อไม่มี dependency cycle กับ W06C

## 3. Work instructions ต่อ slice

| Slice / release | Code seams และงานที่ต้องทำ | ผลที่ผู้ใช้ได้ / impact ที่ต้องตรวจ | รับงานด้วย |
|---|---|---|---|
| W00 / all | `packages/contracts/src/ai-tools.ts`; API `internal-tools.controller.ts`, module DI/exports, intake routes/config. Generate manifest from parity test; fixture full sold/enabled families; classify wired/unwired/web/deferred + exact fields | help/planner ไม่เสนอเสียงหรือ operation ที่เรียกไม่ได้; ไม่มี enabled family หลุดเพียงเพราะไม่อยู่ toolMap | G1, E14, baseline manifest+DI trace; every operation accounted |
| W01 / R1 | `packages/contracts/src/{line-ai,line-ai-prepared-plan,line-ai-advisor-answer}.ts`; API `ai-gateway.client.ts`; Gateway runtime port/client/HTTP/handler. Strict v2 parse and bidirectional roundtrip for input/context/coverage/authority | ไม่หายตอนข้าม process, old/new version fail with reason; capture/CRM consumersยังรับ v1ตามpolicy | G1/G2, E01/E10/E20; every hop field-preservation fixture |
| W02 / R1 | Prisma `AiConversation`/`LineIntakePendingMedia`; API context load/store in webhook/intake plus owner-bound repository NEW; opt-out/unlink/member lifecycle hooks | follow-upรู้เรื่อง, A→Bภาพถูกใบ, no cross-OA leak or stale resurrection; cleanupไม่ลบreceipt/previewauthority | G3 actualPG CAS+lifecycle, E02–E06/E12; migration upgrade/rollback |
| W03 / R1 | Gateway semantic intake/intent-router/orchestrator; API `line-intake-dispatch.use-case.ts`, raw message buffer and recovery; business appendix field proposals | typo/short Thai/negation/mixed question+write/return previous task; no keyword-only vetoหรือถามซ้ำ | G2/G4, U01–U06/U25/N04/E03/E08; provider replay+effect oracles |
| W04 / R1 | Gateway `mangmee-persona.ts`, composer/direct-answer; API `line-advisor-direct-answer.logic.ts`, help/route renderers | general answer without ERP, appropriate detail/format; proper reason/handoff destination, stops whendone | G4, U07/U08/U22/U23/N01–N03; zero ERP/private-prefetch assertions |
| W05 / R1 | API `erp-{core-detail,procurement-ledger,report,business}-tools.use-case.ts`; owning domain repositories/calculators; Gateway `business-read-result-semantics.ts`/prepared formatter/composer | exact date/branch/dataset/money, aggregate completeness, evidence; web/report/export parity where sharingsource | G3/G5, CI01–CI06, E10/E11/E14/N03; realaggregateunderconcurrentwrite |
| W06A / R1 | Gateway prepared plan/JSON/native orchestrator and existing runtime; API validated execution/recovery | subrequestsครบ, bounded retry, repeat same tool withdifferentperiodได้; no denied-work workaround | G2/G4, E08–E11/E23; fingerprint/recovery/coverage matrix |
| W06B / R1 | Existing ERP tool adapters/contracts/registry/DI, banking module exports; requested filter+lookup support in W05 contract | first four supported user journeys plus actual bankreconciliation/balancebasis; no silent filterdrop | G1/G3/G5, E11/E14; handlerDI+realquery+permissions allopenedfamilies |
| W06C / R2 | Reimbursement domain use cases/repository, `ReimbursementDraftAction` NEW; API LINE draft preview/apply adapters, contracts, confirmation renderer | create/update **DRAFT** inLINE withsamepermissionsasweb, idempotentcreate, CASupdate; no submit/approve/pay extension | G3/G6, J4/E07/E09/E14; exactpreview/commit receipt+lostresponse race |
| W07A / R1 | `expense-capture-read.logic.ts`, `expense-capture-facts.logic.ts`, `receipt-ocr-apply.service.ts`; read job/context/notifier | TOTAL vs CASH evidence, humanoverridewins, mediaA/B andpagecoverage; no duplicate capture orunauthorizedpush | G3/G6/G7, U17–U20/E12; actualreaderfixture+domain/worker race |
| W07B / R2 | API pre-capture media dispatch; AttachmentObject/Blob/Link owner checks; `LineDocumentQaJob` NEW and reader adapter | explain image/specificPDFpages, reusefilefollowup, zeroexpense effect, bounded durablejob | G3/G7, E01/E13; MIME/limits/password/pages/cancel/access+providerfixture |
| W08 / R2 | P23 registry/contracts/content pack loader NEW whereabsent; intake selector + help/citationrendering | producthelpตรงrelease/สิทธิ์ andsemanticparaphrases; notmarketing/docsdump | G4/G7, E14; Recall@5≥0.95 + zero invalidsteps; expired/wrongrolecontrols |
| W09 / R2 | API `public.lookup` adapter NEW + registry; Gateway source binding; W11 externalunits tariff | currentpublicfacts searchable withactualcitations; private recordsstaylocal | G4/G7, E15–E17; querycanaries/injection/URL/freshness/cost/sourcefailures |
| W11 / all | `ai-budget-bounds.ts`, API budget controller/reservation, provider port/OpenAI/Bedrock adapters/runtime inputlimits | no malformed/incomplete success, fullinput budget fits, fairactualhold/settlement, preserveotherworkloadlimits | G2/G3/G8, E01/E08/E20; old/new profiles, tariffchange, repairglobalcalls, actualrenderhash |
| W12 / R3 | AiConversation preferencefields + bound service commands/cache/rendering NEW | explicitly remember/list/change/forget3stylekeys; no sensitiveautoprofile | G3/G4, E21/E22; expiry/delete/replay/off/on/DBfailure/privacytext |
| W13 foundation / R1 | existing line reply adapter/ledger/outcome/outbox + `LineDeliveryPlan` NEW; buffer/deadline/abort/accessproof/recovery | durablefullanswer, no half-confirm, no duplicatecommit, accurateUNKNOWN/cancel; stillprivate | G2/G3/G6, E05/E07/E20/E23; exactwire replay/providerfake accepted/lostresponse |
| W13 integration / each | every producer and reopenedlane; worker/notifier + timing trace integration | message acceptedจริง, canonicalcoverageครบ, currentpermission beforeasyncsend; speeddoesnotcutmeaning | G6/G8/G9, allJ1–J4ofrelease; p50/p95/p99 inclfailedattempts |
| W14 / all | existing operator-language/latency/substitute corpora, replay runner/trace exporters | failuresreproducible; qualityjudgedbymeaning/source/effect not wordmatching; noheldoutleakage | G4/G8, E24; frozenfixture IDs/hashes/oracles+blindcomparison |
| W15 / each | release manifest, existing UAT/prod runbooks, customer acceptance | shippedcandidate equals testedcandidate, observablecanary/rollback; stageclaimshonest | G9; exactrunIDs/signedresult/customerOPEN; no deployinthisdocwork |

## 4. Concrete bug/gap closure map

แต่ละ ID คง source evidence ใน audit เดิม ไม่เปลี่ยน source probe ให้เป็น live defect frequency Columns “ปิดเมื่อ” เป็น required proof; **ยังไม่มีข้อไหนปิดจากการเขียนเอกสารนี้**

| ID | แก้ใน slice / contract | ปิดเมื่อ |
|---|---|---|
| CI01 | W01/W05/W06B; core§5 | periodKey survives registry/sanitizer/delegation/sourceและappliedperiodตรงทุกlane |
| CI02 | W05; core§5 | invalid/leap/partial/reverseddate oracleทุกtool+websharedconsumerผ่าน |
| CI03 | W05; core§5 | A/B/nullbranchfixtureได้populationตรงกัน ไม่joinnullโดยไม่ได้ขอ |
| CI04 | W05; core§5 | realPGconcurrentinsert/updateระหว่างreadไม่ทำtotal/count snapshotผิด |
| CI05 | W05; core§5 | exactDecimalboundaryจนrender/export ไม่มีNumberprecisionloss |
| CI06 | W05/W06B; core§5 | เพิ่มสิทธิ์ledgerไม่เปลี่ยนคำถามsalesเป็นP&L; datasetexplicit |
| CI07 | W02; core§3 | fullowner/CAS/OA/lifecycle andoldwriter testsno leak/resurrection |
| CI08 | W02/W07A; core§3/6 | pendingreplace/supplement persisted beforejob; exactassetread |
| CI09 | W07A/W13; delivery authorization | entitlementerror/currentrevocation parks/blocks; noprivatepush |
| CI10 | W04/W13; core§4 + parent§15.3 | globalAIgatesprovider0; groupgeneralzero privateprefetch |
| CI11 | W07B; core§6 | samePDFquestion route zeroexpense, identity/privacy independentcapture |
| CI12 | W06C/W13; business+delivery | cancelcommit/UNKNOWN/ACCEPTED matrixtruthful, no duplicatewrite |
| CI13 | W01/W11; input appendix | actualrender/repair/globalcallcount/exactprofile withold/newbounds tested |
| CI14 | W07/W13; input+corejobcontract | 15mincapturejob/40calls existingpolicy not195sclient/chatdeadline; resume retainsusedbudget |
| CI15 | W09/W11; core§8 + input | publichostedunits reserved/settledwithpinnedrate; unknownusage notfree |
| CI16 | W14/W15; thisindex | R1 scopedgates notR2claim; laterreleasesmustpassactivecapabilities/effects |
| DI01 | W01/W03; input | wholebatchadmissioninclbusyqueue; 3900+5000 not silentlycap8000 |
| DI02 | W03; input+business | mixedcase/newline/originalspan unchangedlive/recovery; previewnot authority |
| DI03 | W01/W03; input | suffixafter1000 and21stamountcorrect; candidatesoverflowexplicit |
| DI04 | W02/W06/W13; input+delivery | reclaimedledger preservesacceptedcontext/planor failsexplicit; flagoff/on variants |
| DI05 | W11; input | malformedargs/incomplete not tool_use success; Bedrockallvisibleblocks; usagekept |
| DI06 | W01/W11; input | full40779/45734-style actualcatalogrender fitsfrozenallocationorprecallreject |
| DI07 | W13; delivery | canonicalfulltext/structuredoutputs survivecard1200 andcanonical5001; no lostitems |
| DI08 | W13; delivery | altText400 andallchangedfields beforevalidconfirm; slot6 splitwithouttruncation |
| DI09 | W13; delivery | PGlease/fence/restart/multibatchUNKNOWNexactreplay no regeneratedwire |
| DI10 | W07A/W13; delivery | failedpush notskipped/published; retrydoesnotrerunOCR/autohandoff |
| DI11 | W11; input | smallactualhold/largeceiling differentiated; settlement usesreservedtariffversion |
| DI12 | W03/W06; business | vendor201/document61 limitsno silentloss; note501 explicitreject |
| DI13 | W03/W06; business | substitute field+question preserved; semanticproposal validation; fieldoverflownotignored |
| DI14 | W06C/W07/W13; business | LINEdraftwriter andmedia usable withrightpermissions, DRAFT idempotency/CAS+boundconfirm |

## 5. Checks ที่ต้องเพิ่มและคำสั่งรัน

ทุก G ต้องมี test assertions ตามตาราง ไม่ใช่เพียง testfileexists Existing suitesไม่แทน newcases ดู [acceptance catalog](../qa/mangmee-conversation-acceptance-catalog-2026-09-26-th.md) U/N/E กับ J1–J4เพิ่ม Case ID และ failure injection ลง fixturesเดิม ไม่มี newtestframework/package.jsonscripts

| Gate | Required execution / evidence |
|---|---|
| G1 Contract/capability parity | schema fullroundtrip + tool registry↔DI/handler/permissions/inputs + release/flag matrix. JSONmanifestwithalloperations, hashes และ unsupportedreasons |
| G2 Provider/wire/admission | v1/v2matrix, exact rawbatch/spans, fullrender estimate, incomplete/toolarg/error/abort usage, AgentCore hop preservation. Mocks prove adapterlogiconly |
| G3 PostgreSQL/Redis integration | actualtransactions+uniqueness+CAS+fencedleases; duplicate/concurrentevents; permission/lifecyclechange; crashaftercommitbeforeack. IsolatedsyntheticDB/Redis, no productionwrites |
| G4 Model-backed behavior | ≥150scenarios/50heldoutfamilies+75Thai paraphrasesตามparent; ≥3repeats; semanticargument/completion≥95%, false-refusal/handoff≤2%; criticalerrors0; no fixedregressionfail |
| G5 Source parity | actualAPI/domainrepos aggregatefixtures, branch/date/money/querybasis oracles; web/exportsharedconsumer checks+browserwhenUI/DTOaffected |
| G6 Mutation+delivery | API→Gateway→domain→commit receipt→LINE fake/gateway acceptance; allcreate/update/cancel/retry/postcommit cases; PG/Redisstate inspected, no model-reported successoracle |
| G7 New capabilities | image/PDF realreader&hash/pagegrounding; packretrieval; publiclookup allowedvendor sandbox withcannedsource injection plusrealprimarycitationcheck. No providerapprovalmeans buildtestedbutactivationblocked |
| G8 Quality/performance/cost | benchmark Acurrent/Bintelligence/Cspeed on samecorpus/model/policy; Cquality≥B not merely≥A; allattemptdenominators, p50/p95/p99/within-deadline/firstcompleteanswer/cost, 1/1.5/2sburst andqueuecohorts |
| G9 Browser/nativeLINE/release | nativeLINE recipient seesorderedanswer/fullconfirmdiff, webrecord matchescommitreceipt andpermissions; interrupted/recoveredjourneys; versionmanifest pinned. Deploymentprotocolseparate |

Core focused commands (existing paths; appendices list additional slice commands; **not run as part of docs-only delivery**):

```sh
pnpm --filter @watchdog-bms/contracts exec tsx --test src/line-ai-prepared-plan.spec.ts src/line-ai-advisor-answer.spec.ts
pnpm --filter @watchdog-bms/ai-gateway exec tsx --test src/agentcore/runtime.spec.ts src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.spec.ts src/modules/line-ai/infrastructure/provider/openai.provider.spec.ts src/modules/line-ai/infrastructure/provider/bedrock.provider.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/use-cases/process-line-webhook.use-case.spec.ts src/modules/line-ai/application/use-cases/recover-orphan-line-events.use-case.spec.ts src/modules/line-ai/application/use-cases/erp-core-detail-tools.use-case.spec.ts
pnpm --filter @watchdog-bms/api exec tsx --test src/modules/line-ai/application/company-ai-budget-reservation.pg.spec.ts src/modules/expenses/line-draft-update.pg.spec.ts
pnpm --filter @watchdog-bms/ai-gateway typecheck
pnpm --filter @watchdog-bms/api typecheck
git diff --check
```

BeforePGsuite load isolatedtestdatabase fixture conventions from existing `company-ai-budget-prisma.fixture.ts`/PGspec; do not point `DATABASE_URL` at UAT/prod Existing corpus runner `scripts/run-line-ai-operator-language-eval.ts` onlyprovesrouting/providersemantics: extend replay fixtures withAPI/domain/delivery mode and expected effect oracle forG6, do not report routerpassasfinancialE2E

Plannednewfocusedtest targetsใช้ existingtsx runner: API `line-ai/application/line-conversation-context.pg.spec.ts`, `line-ai/line-delivery-plan.pg.spec.ts`, `reimbursements/line-reimbursement-draft.pg.spec.ts`, `line-ai/application/line-document-qa.pg.spec.ts`, `line-ai/application/line-conversation-preferences.pg.spec.ts`; Gateway `line-ai/agents/approved-knowledge.spec.ts`, API `line-ai/infrastructure/public-lookup.spec.ts` ทดสอบexistingpatternก่อนตั้งnewpathfinalในPR แต่ต้องมี assertions G3/G7ครบ ห้ามสร้างsource-string-onlytestเพื่อแทนDB/effects

## 6. Migrations, flags และ compatibility checklist

Schema inventory: W02conversation+pendingmedia, W13deliverychild, W06Creimbursementaction, W07BQAjob, W12preferencefields; W05เปลี่ยนreadquery/Decimal DTO version ไม่มีfinancialbackfill; W11 เพิ่ม bounded budgetAuthorityJson/CAS บน admitted event/ledger owners และ reservation evidence metadata ตาม input appendix; versioned bounds/grants/tariff ไม่ rewrite legacy usage; approvedknowledge/model/price/capabilitymanifestเป็นversionedartifacts ไม่clonepermissiontables

เปิดทีละoperation familyหลังreader/schema+permissionparity: semantic v2, context v2, fact v2, delivery v2 เป็นR1 coordinatedset; R2 reimbursementdraft/generalQA/knowledge/publicและR3preferencesมีeffectiveflagแยก Confignames finalใช้existingnamespaceในpackages/config ไม่เปิดด้วยenvstringที่ไม่มีparser/default/test ทั้งAPIและGatewaymustnegotiatecontract/configdigests Unknownflag/versionfailclosedเฉพาะoperation ไม่disablegeneralทั้งหมด

Exact configuration additions ใน `packages/config/src/index.ts`/AppConfigService (API และ Gateway parsers ใช้ enum/default เดียวกัน):

| Config | Default / activation rule |
|---|---|
| `LINE_AI_RELIABILITY_V2_MODE` | `off` enum off/shadow/on; shadow เป็น validation ของ existing artifacts ไม่ยิง paid model ซ้ำ ไม่สร้างfinancialstateใหม่ |
| `LINE_AI_RELIABILITY_V2_COMPANY_IDS` | empty comma-separated validated company IDs; private v2 admissionต้องon+allowlisted+matchingreader/profiledigest |
| `LINE_AI_DELIVERY_PLAN_V2_ENABLED` / `LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS` | false/empty ตามdelivery appendix; readers/recoveryไม่ปิดตามnewwriteflag |
| `LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS` | empty validated messaging-channel allowlist for stateless/public v2; no privatecontext/company inferred to qualify |
| `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` | false ตามbusiness appendix; onยังต้องผ่านoperationpermission/quiesce/previewpolicy |
| `LINE_AI_DOCUMENT_QA_ENABLED` | false; onเมื่อQAreader/model/profile/storage/currentaccessผ่านG7 |
| `LINE_AI_APPROVED_KNOWLEDGE_ENABLED` | false; approvedmanifestdigestต้องload/validateสำเร็จ; basic capabilityhelpยังทำงาน |
| `LINE_AI_PUBLIC_LOOKUP_ENABLED` | false; approvedconfiguredprovider/model/region+tariff+sourcepolicyบังคับ ไม่เปิดจากflagอย่างเดียว |
| `LINE_AI_PREFERENCES_ENABLED` | false; owner/cas/migration/noticeพร้อมก่อนR3 |

Existing `LINE_AI_DRAFT_EDIT_ENABLED`, reimbursementsemanticmode, intake/advisor/orchestration/native/ledger/replay flagsยังเป็นgatesเดิม ไม่overrideด้วยnewflag. Runtimeeffective manifestประกาศintersectionของactualflags+contract+profile; disagreement=`schema_unsupported`/temporarily_unavailableเฉพาะcapability Privatev2 admissionrequiresdeliveryv2writesready ไม่เปิดsenderก่อนallreaders. Public/stateless generalใช้verifiedadmissionscopeตามdeliveryappendix ไม่สร้างcompanyจากallowlistหรือโหลดprivatecontextเพื่อผ่านflag

Rollbackลำดับ: stopnewadmission/feature → keepcompatibleworkers/replayers → drainหรือterminallyclassifystoredjobs/UNKNOWN → ปิดnewreadpathหลังไม่มีactiveversion ห้ามrevertoldbinaryที่อ่านv2outcomeไม่ได้หรือลบcommittedproof การปิดfeatureไม่ย้อนbusinesscommit; draft update retainedpermission policyตามbusinessappendix

Compatibilitymatrixขั้นต่ำ: oldAPI/oldGateway, oldAPI/newGateway, newAPI/oldGateway, new/new, runtimeworkerold/new, flagAPI/Gatewayskew; rawpayloadversion/transports/providerprofile/outputparser mustnotmismatch Inflightv1ใช้v1profileparser/retryidentityจนterminal ไม่reinterpretด้วยv2defaults

## 7. Evidence bundle และ exit conditions

ทุก sliceส่ง `commit`, baseline/config/model/prompt/schema/profile/tariff/manifestdigests, changedfiles, migrations/flags, scenarioIDs, fixturehashes, commands+exit/results, sourceeffectsandnegativecontrols, unresolvedfindingsและrollbackstate ไม่มีrawcustomertext/token/receiptsecretในevidence

Status progression `planned → implemented → locally_verified → integration_verified → candidate_accepted → released`; design documentไม่ข้ามprogression Missingservicecredential/vendorreview/privacynoticeเป็น **activation gate** พร้อมflagoffbehaviorแล้ว ไม่ใช่unknowncodingdesign ส่วน latency/semanticqualityที่ยังไม่ถึงเป้าต้องแก้implementationหรือboundedpolicyแล้วrerunตามfrozenoracle ไม่ลดtestthresholdให้ผ่าน

รับงาน R1: allR1slices+fixedCI/DIของR1ผ่านGที่เกี่ยวข้อง รับงานfullactivev2.4: R1+R2+R3ครบ ไม่มีการใช้ “coreเสร็จ” ปิดใบเบิก/publiclookup/Q&A/preferencesแทนผู้ใช้ คำว่าใกล้ChatGPTต้องอิงblindtaskcomparisonในscopeจริง ไม่อ้างผลิตภัณฑ์ทั่วไปเท่ากันจากแค่เลือกmodelเดียว

Machine-readable coverage: [implementation readiness map](../evidence/mangmee-ai-readiness-2026-09-26/implementation-readiness-map-2026-09-27.json) ใช้ตรวจmissingC/W/CI/DIและdependencycyclesได้ เป็นplanningcoverageหลักฐานไม่ใช่testpass
