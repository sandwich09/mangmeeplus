# Implementation index: ลงมือแก้ AI มั่งมี v2.4

วันที่: 2026-09-27\
สถานะ: **Built-in capabilities default ON; public lookup deferred; deployment and real-provider quality unverified**\
Implementation baseline: `8b05ed33` (isolated `codex/mangmee-ai-reliability-implementation-20260927`); original dirty checkout untouched\
Parent: [plan](mangmee-ai-understanding-and-advisor-reliability-plan-2026-09-26.md), [spec](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md)

## 1. วิธีเริ่มงานและนิยามว่า “ครบ”

ใช้เอกสารนี้เป็น implementation entry point ไม่ต้องออกแบบสามช่องว่างเดิมใหม่: full input/evidence, durable multipart delivery และ reimbursement DRAFT writer มี wire/schema/transaction/state/test contract แล้วใน appendices ด้านล่าง Implementation เดิมครอบคลุม 17 capabilities และ 15 W packages; owner update 2026-09-27 พัก C09/W09 public lookup เพิ่ม ทำให้ rollout ปัจจุบันเหลือ 16 capabilities; C13/W10/เคสเสียง E18/E19 ยังพัก Financial Profile/Services Needs ยังไม่รวม

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

Owner update 2026-09-27 supersedes the earlier OFF rollout defaults: no manual secret/flag setup for built-in AI capabilities; public lookup remains deferred. See the parent spec owner update. Exact configuration additions ใน `packages/config/src/index.ts`/AppConfigService (API และ Gateway parsers ใช้ enum/default เดียวกัน):

| Config | Default / activation rule |
|---|---|
| `LINE_AI_RELIABILITY_V2_MODE` | `on` enum off/shadow/on; explicit off/shadow do not admit v2; shadow has no paid comparison execution |
| `LINE_AI_RELIABILITY_V2_COMPANY_IDS` | empty = no cohort restriction; nonempty exact validated company IDs restrict admission; matching reader/profile and current permissions remain required |
| `LINE_AI_DELIVERY_PLAN_V2_ENABLED` / `LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS` | true / empty = unrestricted authorized company cohort; readers/recoveryไม่ปิดตามnewwriteflag |
| `LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS` | empty = no extra cohort restriction; nonempty validated IDs restrict stateless/general channels; primary-channel/current admission still mandatory, no private context inferred |
| `LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED` | true; ยังต้องผ่าน operation permission/quiesce/preview/confirm policy |
| `LINE_AI_DOCUMENT_QA_ENABLED` | true; QA reader/model/profile/storage/current access still required |
| `LINE_AI_APPROVED_KNOWLEDGE_ENABLED` | true; approved manifest digest/content must load and validate; DRAFT cards remain unusable; basic capability help works |
| `LINE_AI_PUBLIC_LOOKUP_ENABLED` | false; approvedconfiguredprovider/model/region+tariff+sourcepolicyบังคับ ไม่เปิดจากflagอย่างเดียว |
| `LINE_AI_PREFERENCES_ENABLED` | true; current owner/CAS/migration/notice remain required |

Existing `LINE_AI_DRAFT_EDIT_ENABLED` (API/Gateway/AgentCore) and `LINE_AI_TERMINAL_OUTCOME_REPLAY_ENABLED` also default true. Other reimbursementsemanticmode, intake/advisor/orchestration/native/ledger gates keep their current deployment policy; model/provider credentials and approvals are not feature toggles. Runtimeeffective manifestประกาศintersectionของactualflags+contract+profile; disagreement=`schema_unsupported`/temporarily_unavailableเฉพาะcapability Privatev2 admissionrequiresdeliveryv2writesready ไม่เปิดsenderก่อนallreaders. Public/stateless generalใช้verifiedadmissionscopeตามdeliveryappendix ไม่สร้างcompanyจากallowlistหรือโหลดprivatecontextเพื่อผ่านflag

Rollbackลำดับ: stopnewadmission/feature → keepcompatibleworkers/replayers → drainหรือterminallyclassifystoredjobs/UNKNOWN → ปิดnewreadpathหลังไม่มีactiveversion ห้ามrevertoldbinaryที่อ่านv2outcomeไม่ได้หรือลบcommittedproof การปิดfeatureไม่ย้อนbusinesscommit; draft update retainedpermission policyตามbusinessappendix

Compatibilitymatrixขั้นต่ำ: oldAPI/oldGateway, oldAPI/newGateway, newAPI/oldGateway, new/new, runtimeworkerold/new, flagAPI/Gatewayskew; rawpayloadversion/transports/providerprofile/outputparser mustnotmismatch Inflightv1ใช้v1profileparser/retryidentityจนterminal ไม่reinterpretด้วยv2defaults

## 7. Evidence bundle และ exit conditions

ทุก sliceส่ง `commit`, baseline/config/model/prompt/schema/profile/tariff/manifestdigests, changedfiles, migrations/flags, scenarioIDs, fixturehashes, commands+exit/results, sourceeffectsandnegativecontrols, unresolvedfindingsและrollbackstate ไม่มีrawcustomertext/token/receiptsecretในevidence

Status progression `planned → implemented → locally_verified → integration_verified → candidate_accepted → released`; design documentไม่ข้ามprogression Missingservicecredential/vendorreview/privacynoticeเป็น **activation gate** พร้อมflagoffbehaviorแล้ว ไม่ใช่unknowncodingdesign ส่วน latency/semanticqualityที่ยังไม่ถึงเป้าต้องแก้implementationหรือboundedpolicyแล้วrerunตามfrozenoracle ไม่ลดtestthresholdให้ผ่าน

รับงาน R1: allR1slices+fixedCI/DIของR1ผ่านGที่เกี่ยวข้อง รับงานfullactivev2.4: R1+R2+R3ครบ ไม่มีการใช้ “coreเสร็จ” ปิดใบเบิก/publiclookup/Q&A/preferencesแทนผู้ใช้ คำว่าใกล้ChatGPTต้องอิงblindtaskcomparisonในscopeจริง ไม่อ้างผลิตภัณฑ์ทั่วไปเท่ากันจากแค่เลือกmodelเดียว

Machine-readable coverage: [implementation readiness map](../evidence/mangmee-ai-readiness-2026-09-26/implementation-readiness-map-2026-09-27.json) ใช้ตรวจmissingC/W/CI/DIและdependencycyclesได้ เป็นplanningcoverageหลักฐานไม่ใช่testpass


## 8. Implementation candidate closure — 2026-09-27

The active R1/R2/R3 implementation is closed for final candidate verification; release activation is not accepted. The task uses a dedicated local PostgreSQL database and Redis; no cloud state, live provider or native LINE acceptance has been inferred from these tests. That initial candidate used OFF defaults. The later owner update above enables built-in defaults and leaves public lookup off; the historical test evidence is unchanged. `AI_BUDGET_V2_SUPPORTED=true` now advertises the implemented protocol; it does not enable issuance or satisfy provider/model quality acceptance. Two compiled Nest apps have exercised the authenticated capability, intake ordinal0, narrowed answer ordinal1, PostgreSQL reserve/settle and no-redispatch replay with an explicitly synthetic provider. The exact frozen commit/config and final registered run belong to the task memory and candidate evidence; local code closure does not substitute for those checks. See [task memory](../agent-memory/mangmee-ai-reliability-implementation-2026-09-27.md) for commands/logs and parent-owned evidence.

The 22 concrete implementation seams below record implementation closure and the remaining external acceptance gates. “Local tests” means deterministic or isolated PostgreSQL evidence only; it does not close model quality, native LINE, content approval or deployment gates.

| # / scope | Implemented paths and local evidence | Remaining implementation / acceptance |
|---|---|---|
| 1 W00 capability/data manifest | Generated 71-operation/18-family/9-route manifest from actual registry, handler instance and Nest DI; 4 parity tests; three unwired aliases hidden from callable catalogs | Final source generation is part of the frozen candidate checks; deployed entitlement/provider identity remains runtime evidence |
| 2 W01 raw input contract | Strict InputEvidenceV2 across API/Gateway/AgentCore; whole-buffer admission and exact UTF-16 span/hash validation | Local old/new API/Gateway/AgentCore hop checks pass; deployed-artifact identity acceptance remains gated |
| 3 W01 deterministic value evidence | Canonical ValueCandidatesV2, exhaustive 128/64/32 limits, exact-decimal IDs, whole-result overflow; 122 legacy+v2 tests | API write adapters consume exact candidates/source proofs; malformed v2 fails before writes. Live provider numeric extraction remains in G4/G7 |
| 4 W02 private owner/context | Full owner/epoch/CAS, taskRef resume with retained slots, side-question independence; exact select/replace/supplement pending-media CAS and PG proof | Retained-clause selection is verified through every hop; source/task PostgreSQL tests preserve original text and reject stale owners/dependencies. Role/scope/status/entitlement changes now invalidate context in the same transaction |
| 5 W03 semantic inventory | Exact spans and indexed coverage; typed writeIntent preserves mixed operation; existing API write plus independent answer delivered together; taskRef validates current offered revision | Multiple writes pause with exact task controls; only the selected original clause resumes, with stable per-action idempotency and remaining clauses visible. Gateway receives only selected historical clause/candidates while live grant/input authority remains current; provider corpus acceptance remains gated |
| 6 W04 general/style | Stateless public-general endpoint; private pure-general dispatch before ERP prefetch, original input/style forwarding, no task-slot replacement; focused zero-ERP test | Real provider style/depth/advisor acceptance and paired quality gates |
| 7 W05 facts/queries | Date/branch/Decimal/snapshot adapters and isolated PG checks; typed facts reach grounded composition | Root cross-family/web/export parity audit now has Decimal/status/currency/read-evidence and actual PG checks; real provider per-claim grounding remains an activation gate |
| 8 W06A bounded execution | Same global grant/serial calls/one repair; real usecase→orchestrator→API client→provider wrapper integration; mixed branch accepts all required delivery before completion | Actual provider timing/quality and live retry failure acceptance |
| 9 W06B existing adapters | Banking/query adapters, actual DI manifest, typed facts and permission checks | Shared report/Decimal/date/status consumer parity is implemented and locally tested; deployed source identity remains gated |
| 10 W06C domain/web writer | Durable draft actions, idempotent create, revision update, exact preview confirmation; domain PG race + web tests | Local domain/adapter create/update/cancel/idempotency/CAS/source-revocation coverage exists; browser and native acceptance remain gated |
| 11 W06C LINE adapter | API-owned opaque options, exact field proof/proposal, current display options, generic receipt-media staging, typed mixed write admission, preview/accepted confirmation, real PG adapter test | Actual PostgreSQL two-action journey creates distinct100/999 requests only after each accepted preview and confirmation; sibling provenance/multiwrite collision/stale completion are rejected. Browser/native acceptance remains gated |
| 12 W07A receipt grounding | Capture full-page splitting/source offsets, exact field attachment/page/span/role, source-bound row IDs and independent API validation; local tests | Original single-receipt strict attachment/page/role/span evidence implemented: API55 and Gateway controller110 pass; reviewed real assets/provider quality still gated |
| 13 W07B job/reader | Durable question-only job, original budget transfer, lease/source/owner checks, raster reader; Original-authority/per-clause question digest, exact offered question coverage, actual PG job and issuer checks | Native provider fixtures and optional PDF adapter feasibility; no native PDF support claimed |
| 14 W07B media/transport | Pre-capture question route, generic ACTIVE attachment, same-file/page follow-up, explicit selected-file set, foreground/async recovery and cancel controls; 16 QA/task bridge tests + actual PG context and pending-media checks; durable job/task binding survives recovery, cancellation fences sources | Native LINE/background timing acceptance; independent non-file clauses remain visibly pending within the two-call QA task limit |
| 15 W08 approved help | Bounded 12-card pack, immutable source/body hashes, same-call selection, render-time rights; focused tests | Pack is DRAFT; immutable help rendering prevents invented product buttons. Source/content approval plus Recall@5 and actual mixed-help quality remain activation gates |
| 16 W09 public lookup | Implementation retained; default OFF per owner update 2026-09-27 | Deferred from current rollout; keep disabled negative controls, no paid public lookup |
| 17 W11 authority/budget | API durable issuer/reservation atomic cursor/profile/repair, tariff pin, transfer, old/new controls; real PG tests | Compiled two-app protocol and broad local regressions pass; actual rendered-model capacity measurements and activation approval remain gated |
| 18 W11 provider completion | Completion/argument checks, usage on failure, exact rendered bounds/echo, post-reserve deadlines; wrapper tests | Real provider completion/refusal/timeout/usage/SDK retry acceptance and supported model review |
| 19 W12 preferences | Explicit list/set/delete/expiry with full owner/CAS and fixed style keys | Explicit expiry/delete/replay and current-owner PostgreSQL checks exist; deployed privacy UX remains gated. No implicit financial profile |
| 20 W13 durable delivery | Immutable full text/batches/control receipts, UNKNOWN/CAS/exact retries, frozen ledger and capture outbox; PG + fake transport | Producer/source proofs, cancel/partial/recovery and exact-batch tests exist. Bounded semantic completion now survives accepted-delivery/task-CAS crashes; native LINE remains gated |
| 21 W14 evaluation | Freeze/provenance/effect/trace/blind/base-family gates; actual compiled Nest/PG runtime collector and local LINE sink; focused tests | Concrete176-row Prisma snapshots validate actual resolver63 permissions/two branches/OA/legal gates;150+75 draft cases carry95 independent canonical fact expectations. Complete first turns no longer have artificial clarification oracles; frozen corpus digest is `d1ca872dba0849ed7a8caa85597300c1719cc501c40ff23d0efb65950a986739`. Human labels and paired provider/native runs remain separate activation gates |
| 22 W15 candidate/readiness | Isolated branch/migrations/baseline and explicit off gates; this closure map | All active slices and CI/DI findings have local implementation evidence; final frozen manifest, registered checks, compiled smoke and authorized Git integration remain candidate actions. Deploy remains out of scope |

**2026-09-29 note (Owner decision, "ลบทิ้งเลย"):** strict receipt evidence (W07A receipt grounding: `requireEvidenceV2` / `receiptEvidence` on receipt OCR, and `evidenceSource` / `fieldEvidenceVersion` on capture windows) was removed from the code. It was never tested against real receipts; its rules were too narrow for common Thai receipts; one failed field discarded the whole read; and a failed read cost about 60 s and 3 paid model calls. Receipt photos and PDF/file reads now use the normal read with its value cross-check. See `docs/agent-memory/web-receipt-evidence-v2-2026-09-29.md`.

Latest local evidence includes the registered PostgreSQL runner with both required database variables bound to the same isolated database (**59 tests, zero skips** at the prior final checkpoint), all Gateway package consumers (**1,367 tests, zero skips**), actual Redis Streams (**37 tests, zero skips**), and cross-family API/web/report checks. The retained-source financial extension additionally passes actual PostgreSQL selection→preview→accepted LINE plan→confirmation→second selection→distinct confirmation with amounts100/999, plus11 Gateway semantic/dispatch tests and74 intake/AgentCore hop tests. Provider and transport responses in these local fixtures are explicitly synthetic. The default API package's three old consumer mocks were corrected and focused25 tests pass; its full rerun and the final registered counts are recorded by the parent in task memory. Counts overlap and must not be summed. PUBLIC_GENERAL raw evidence follows public admission directly without private context; legacy pending-media hashes remain unchanged when v2 is off. No real-provider, human-review or native LINE quality claim follows from these checks.

Final Astra review classification (before the frozen candidate run):

| Finding IDs | Implemented correction and evidence boundary | Remaining gate |
|---|---|---|
| CI01–CI06 | Registry/input period propagation, civil dates, actual scoped PostgreSQL snapshot aggregation, exact Decimal strings, issued-status/currency/report/export consumers and dataset selection are implemented and locally tested | Real model argument/claim quality; browser acceptance of shared report UI |
| CI07–CI09 | Full owner/OA/epoch/CAS, pending replace/supplement, transactional user/company entitlement lifecycle invalidation, current-source delivery checks and isolated PG races are implemented | Deployed channel/permission transition and native transport acceptance |
| CI10–CI11 | Public admission has no private ERP/context load; global/consent/opt-out gates stop paid work. Same-file/PDF question-only jobs avoid financial mutation; indexed file questions and cancellation are bound to source proof | Compiled final webhook opt-out proof passed; real PDF/provider/native LINE acceptance remains gated |
| CI12–CI15 | Domain preview/commit/UNKNOWN replay, immutable batch delivery, original job budgets, global ordinals/one repair, pinned pricing and hosted-unit settlement are implemented and locally tested | Real provider timing/usage/quality and native LINE receipts |
| CI16 | All22 active seams are represented here; the225-case corpus, full API/PG runtime collector and paired/blind evaluation distinguish implementation from release | Oracle corrections and concrete source seeding are complete; final frozen source run is a candidate check. Human labels, real paired samples and deployment are activation gates |
| DI01–DI06 | Complete buffered raw input, source spans, exhaustive candidate limits, frozen reclaim, strict provider completion/arguments/usage and actual rendered reservation are implemented | Maximal rendered model feasibility and real-provider measurement remain activation requirements |
| DI07–DI11 | Complete multipart canonical text, decision diff/control ordering, exact UNKNOWN retry, capture outbox recovery and pinned small actual holds are implemented with local transport/PG evidence | Native LINE multipart/failure acceptance and real price/usage evidence |
| DI12–DI14 | Field overflow refuses instead of clipping; substitute fields/questions and separate document actions remain explicit; guarded DRAFT writers/media/confirmation use existing domain authority | Selected-source hop and actual two-action PostgreSQL integration pass; browser/native document journey acceptance remains gated |

No known implementation gap remains in the active scope after the final Astra source review. Selected financial tasks retain exact original input, use current authority, preserve sibling source locators, require accepted preview confirmation, and complete only their own indexed clause; dependent work cannot run on an uncommitted preview. Manifest parity, the complete registered runner, actual PostgreSQL/Redis and both compiled source proofs pass; the evidence bundle records exact commands, source commits and limits. Human content approval, labelled receipt assets, real-provider paired quality/cost/latency, native LINE and deployment evidence remain explicitly unaccepted. C13/W10/voice and financial-profile/services roadmap remain deferred.


Final local verification: full API package **8,620 passed, zero failed, 12 reported environment-specific skips**; full Gateway package **1,367 passed, zero skips**; registered whole-chain groups **4/5/80/272/4/66/1,712/461 passed**, zero skips; relevant PostgreSQL **59 passed**, real Redis **37 passed**, and separate replay-reset PostgreSQL safety proof **1 passed**, zero skips. These groups overlap and must not be summed as a unique total. API/Gateway/web and replay TypeScript checks, contracts/config/API/Gateway/AgentCore builds and fresh256-migration replay pass. Runtime reset only clears the dedicated synthetic database on its locked connection; production append-only triggers remain unchanged and are proven active before business execution. The clean-source webhook opt-out proof accepts the expected response withzero provider calls/effects/cost. This does not certify real-model intelligence, native LINE delivery or production latency.


## 9. Owner-requested activation follow-up — 2026-09-27

The follow-up removes manual feature/cohort setup for the existing configured AI service, preserves explicit operational OFF overrides and exact optional cohort restrictions, and keeps public lookup OFF. It also aligns the separately deployed AgentCore draft-edit probe, receipt evidence readers, notifier, buffering and private/public admission. Public payer identity remains available for budget/debounce accounting; it cannot bypass a private company restriction. Bound v2 substitute routing is advertised consistently with its actual execution lane even when the legacy substitute mode is OFF.

The dependency audit found that the deployed model configured in repository deployment scripts (`global.anthropic.claude-sonnet-4-6`) was missing from v2 capacity/tariff negotiation. The follow-up adds that exact model with the existing global-profile approval/reference and provider/model/region checks retained. Bedrock's official model card supports its capacity; integration remains capped at 200,000 context tokens to stay within the reviewed standard-context tariff. This is compatibility evidence, not a measurement of model quality or speed. See [follow-up memory](../agent-memory/mangmee-ai-default-activation-2026-09-27.md) for verification and merge receipts.

Human review starts at the [review packet](../research/mangmee-ai-human-review-2026-09-27-th.md). The existing 225-case corpus and synthetic assets remain DRAFT; no reviewer approval or real-provider result is fabricated. Current rollout excludes C09 public-lookup success cases; a versioned scoped evaluation must preserve disabled-feature negative controls and cannot silently drop failed attempts from its denominator. New defaults do not bypass normal maintenance HTTP/queue controls or the mandatory live release protocol.
