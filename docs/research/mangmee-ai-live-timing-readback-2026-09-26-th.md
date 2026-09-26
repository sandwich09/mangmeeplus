# ตรวจระบบเก็บเวลาที่มีอยู่ — Production และ UAT

วันที่: 2026-09-26 • read-only AWS/DB inspection • [sanitized evidence](../evidence/mangmee-ai-readiness-2026-09-26/live-timing-readback.json)

## ข้อสรุปและการแก้ข้อมูลก่อนหน้า

**มีทั้งแผน ระบบ instrumentation และผลวัดจริงเดิมแล้ว** งานต่อไปต้องตรวจ coverage/ความต่อเนื่อง/การเข้าถึงและการรวมรายงานของระบบเดิม ไม่เริ่มสร้าง timing framework ซ้ำ ข้อความก่อนหน้าที่เสนอ“เพิ่มการเก็บเวลา”กว้างเกินไป; การยังไม่มี current-release end-to-end proof ไม่เท่ากับไม่มีการเก็บเวลา

แหล่งเดิมคือ [latency plan](../plans/line-ai-latency-and-autonomy-lanes-plan.md) Phase0–1, [spec](../specs/line-ai-latency-and-autonomy-lanes-spec.md) และ [hosted baseline2026-09-03](../agent-memory/line-ai-hosted-baseline-2026-09-03.md) ซึ่งอ่าน CloudWatch จริงทั้ง Production/UAT หน้าต่าง2026-08-27ถึง09-03 รายงาน Production business n11: estimated end-to-end p50=11.690s/p95=13.392s; UAT business p50=12.544s ผลเดิมรวมbuffer+queue+instrumentedstages ไม่ใช่device-visible benchmarkหรือSLOปัจจุบัน

## ผลที่อ่านสดครั้งนี้

| ประเด็น | Production | UAT |
|---|---|---|
| Infrastructure | EC2 application4เครื่องrunning; RDSavailable; publichealthok | EC2 application2เครื่องstopped; RDSavailable; ไม่เปิดเครื่องเพื่อaudit |
| AgentCore endpoint | kamal_production_b v12 READY | kamal_uat_b v33 READY |
| Runtime source | a2b926c6 | a2b926c6 |
| Prepared configuration | true;4families;fusedshadowtrue | true;4families;fusedshadowtrue |
| AiTurn72ชั่วโมง | 18แถว;runtime timing5แถว;อีก13ไม่มีdurationMs | 12แถว;runtime timing6แถว;อีก6ไม่มีdurationMs |
| Sourceของtimingที่พบ | ทั้ง5จาก641a71af/277722ff;ล่าสุด25ก.ย.09:02UTC ยังไม่มีa2timingในwindowนี้ | ทั้ง6จากa2;26ก.ย.02:25–02:29UTC |
| ขอบเขตคำตอบจากข้อมูล | ยืนยันpersistedruntimeinstrumentationเดิม;ยังวัดa2end-to-endไม่ได้ | AgentCoreHTTP4.040–10.949s,model1–3calls;เป็นruntimehop ไม่รวมintake/buffer/LINEทั้งหมด |

Runtime sourceเป็นการอ่านendpointจริง ไม่ใช่การรับรองsourceของAPI/workerทุกcontainer ค่าpreparedเปิดไม่พิสูจน์servedhit-rate ต้องรู้eligiblecasesและfallbackreasonด้วย ตัวอย่างUAT6แถวมีcompleted4/refused2 จึงไม่ใช้ทั้งหมดเป็นคำตอบที่ถูกหรือใช้รับรองp95

ProductionยังมีAiUsageEventใน24ชั่วโมง: intake9calls, receipt extract14calls, image-reread6calls พร้อมAiTurnล่าสุด26ก.ย.14:48UTC จึงไม่ควรตีความว่าไม่มีAIใช้งานเพียงเพราะไม่มีruntime-turn timingของa2 เส้นทางintake/mediaกับruntime-turnบันทึกต่างกัน

## ระบบเดิมเก็บอะไร และเหตุที่ภาพรวมยังต่อไม่ครบ

1. APIมี `line.ai.api_trace` สำหรับaccepted/buffer/queue/loading และ `line.ai.stage` สำหรับแต่ละช่วง พร้อม `line.ai.turn_summary` Runtimeมี `stageDurationsMs`/modelCallCount/runtimeidentity และAiTurn.observabilityJsonบันทึกส่วนruntimeไว้แล้ว จึงreuseeventcontractsเดิม
2. Sourceที่ใช้deploya2 [native_config](../../infra/kamal/release.py) :183–185เพิ่มCloudWatchawslogsเฉพาะProduction; UATย้ายKamalแล้วจึงไม่ควรคาดว่าค่าจะเข้ากลุ่มECSเดิมโดยอัตโนมัติ Query `line.ai.api_trace` กลุ่ม `/ecs/watchdog-bms-uat-api-web` ย้อน72ชั่วโมงได้0และหมดpagination แต่ยังไม่ใช่proofว่าโค้ดไม่emit เพราะยังไม่ได้อ่านDockerlogsบนเครื่องที่หยุดอยู่
3. Productionมีกลุ่มใหม่ `/ecs/mangmee-kamal-production-{api-web,ai-gateway,workers}` จริง แต่ scoped operator/deploy profiles ถูกAccessDeniedตอนอ่านstreams/events ไม่ได้เปลี่ยนIAMหรือยกระดับสิทธิ์ กลุ่มAgentCoreของทั้งสองenvironmentมีแล้วเช่นกัน แต่การอ่านFilterLogEventsถูกปฏิเสธ; รายงานเก่าที่บอกไม่มีAgentCoreloggroupเป็นhistoricalเท่านั้น
4. `AiTurn.durationMs/observabilityJson` ไม่ใช่fullpipeline: ในข้อมูลที่อ่านมีruntime validation/body/orchestration/total/AgentCoreHTTP แต่ไม่มีAPIbuffer/queue/LINEdelivery จึงต้องjoinกับAPIevents ไม่บวกระยะเวลาที่nestedกันซ้ำ และไม่คำนวณp95จากตัวอย่างไม่ครบ
5. `WatchDog/Runtime` ListMetricsรอบนี้คืนว่าง ไม่พิสูจน์ว่าข้อมูลhistoricไม่มี; genericAPIresponsemetricก็ไม่ใช่LINEend-to-end ต้องตรวจmetricfilters/dashboardกับloggroupsหลังmigrationเมื่อมีสิทธิ์ที่ตรงscope

## ช่องว่างใน source ของ telemetry เดิมที่ต้องเติมเฉพาะจุด

ตรวจmainf932ควบคู่กับlivea2; source findingsเหล่านี้ไม่ใช่การอ่านpayloadทุกturnบนproduction:

- `line.ai.turn_summary` ยังคืน `lane`, `fallbackReason`, `costSatang` เป็นnull จึงต้องต่อactualoutcomeจากruntime/usage seamแทนการเดาจากชื่อtool ดู [summary/persistence](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts) f932:5958,6074
- summaryถูกเรียกหลังGatewaydeliveryบางเส้นทาง; intake-only/earlyfailureไม่ครอบคลุมเหมือนกัน ตัวหารต้องเริ่มจากacceptedwebhook/batchแล้วreconcileterminaloutcomes ไม่ใช้เฉพาะAiTurnที่มีduration
- `ai.usage` มีcall duration/tokens แต่stdoutไม่มีrequest/webhook/sourceidentityครบ ส่วน `ai.turn.complete` มีrequest/identity/aggregate ไม่ได้มีper-callusageทั้งหมด จึงยังjoinwaterfallระดับcallไม่ได้ทุกกรณี ดู [Bedrock provider](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/bedrock.provider.ts) :184 และ [turn use case](../../apps/ai-gateway/src/modules/line-ai/application/use-cases/line-ai-turn.use-case.ts) :150
- OpenAIadapterส่งfailedentryเข้าrequestcollector แต่error/no-usageไม่emitstdout `ai.usage` เหมือนBedrock ต้องครอบคลุมfailuredenominatorตามprovider แม้runtimeที่อ่านสดครั้งนี้ใช้Bedrock ดู [OpenAI provider](../../apps/ai-gateway/src/modules/line-ai/infrastructure/provider/openai.provider.ts) :194
- ไม่พบcommittedscriptที่query+joinhostedtraceครบในscriptsที่ตรวจ; benchmark/replayเดิมมีประโยชน์แต่ไม่ได้วัดLINEdeliveryจริง จึงควรเพิ่มreporting/query layerขั้นต่ำที่ใช้eventเดิมและredactedIDs ไม่สร้างagent/telemetryframeworkอีกชุด
- เอกสารเก่าที่บอกdefault2500ms/onecompiledfamily/default-offทุกenvironmentเป็นcheckpointเก่า: sourcef932default2000ms/cohorts1000-1500-2000/compiled10families; runtimeที่อ่านครั้งนี้preparedtrue4families แต่ยังไม่ได้อ่านeffectiveAPIdebounceconfigปัจจุบัน

## งานต่อที่ถูกต้อง

- **คง instrumentation เดิม:** ตรวจservingversion→logdestination→fieldcoverage→correlation→report ก่อนเพิ่มfieldใด ๆ ปรับbacklogจาก“เพิ่มระบบเก็บเวลา”เป็น“ตรวจและต่อระบบเดิมให้ครบ”
- **Production:** ต้องมีread-onlyaccessที่อนุมัติสำหรับloggroupsใหม่และruntimegroups เพื่ออ่านapi_trace/stage/summary/preparedoutcomes; ไม่ใช้การแก้AIcodeหรือเปิดproviderแทนปัญหาreadaccess
- **UAT:** เมื่อenvironmentเปิดตามงานที่ได้รับอนุญาต ให้ตรวจlocalDockerlogdriver/retentionจริงและตัดสินใจใช้centralcollectorเดิมให้ครอบคลุมKamal ไม่จำเป็นต้องเปิดเครื่องเพื่อยืนยันว่ามีDBtimingอยู่แล้ว
- **รายงาน:** แยกenvironment/source/lane/eligibleoutcome/intake-versus-runtime/media/failedattempt; joinด้วยcorrelationเดิม และรายงานcoverageก่อนp50/p95 ใช้baseline09-03เป็นhistoricalcomparison ไม่แทนcurrentcandidate
- **ปรับความเร็วหลังมีevidence:** ดูpreparedfallbackreason/modelcalls/intakeoutput/queue/mediaก่อนเลือกแก้ ไม่เริ่มทดลองdebounceใหม่โดยไม่ตรวจexistingconfig/cohortdata และไม่เปลี่ยนโมเดลจากเพียงชื่อรุ่น

## วิธีตรวจและข้อจำกัด

AWSaccount/regionยืนยันก่อนอ่าน;ใช้read-onlySTS/EC2/RDS/AgentCore/CloudWatchmetadataและhealth ไม่มีdeploy/restart/flag/IAMchange ไม่มีproviderinvocation/ข้อความหรือเอกสารลูกค้า

Productionใช้auditedT1 `INC-20260926-AI-TIMING`, user watchdog_support_ro, read_only=on, statementtimeout15s UATใช้tunnelตามrunbookพร้อมconnectiondefault_read_onlyและBEGIN READ ONLY ตรวจread_only=onก่อนqueries credentialsไม่ถูกแสดงหรือบันทึก ทั้งสองsessionปิดและDescribeSessionsยืนยันownedactive=0

ข้อจำกัดที่ยังเหลือคืออ่านapplication/runtimeCloudWatchชุดใหม่ไม่ได้และUAThostหยุดอยู่ จึงไม่อ้างfullwaterfall/currentp95/devicevisibleperformance ผลนี้ยืนยันว่าของเดิมมีและบางส่วนทำงานจริง พร้อมระบุจุดที่ต้องต่อให้ครบ
