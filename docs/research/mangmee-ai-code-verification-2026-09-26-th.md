# AI readiness — fresh code and runtime verification

26 กันยายน 2026; ต่อจาก financial-intelligence audit ตามคำขอให้พิสูจน์ bug/gap/ความช้า/การบล็อกจากโค้ด

**Verdict: ยังไม่ผ่านการรับรองเป็น advisor ที่ตอบถูก ครบ และเร็วได้สม่ำเสมอ** พบ false blocks บน source ของ release ล่าสุด และ output/state/telemetry gaps ระบบมีฟังก์ชันใช้งานได้จริง แต่ผล deploy/health/tests ผ่านไม่แทน answer-quality acceptance

> Version note: เนื้อหาการรันด้านล่างเป็น audit ของ a2; มีการตรวจ source delta หลังปุ่มยืนยันรวม main เพิ่มในหัวข้อท้ายเอกสาร ไม่ใช้การ merge เป็นหลักฐาน deploy/ผลทดสอบใหม่

## Baseline และวิธีตรวจ

- Workspaceหลักอยู่ `4a5817b4` + unrelated WIP จึงไม่ใช้เป็น current baseline
- Actual release receipt `.env.kamal/production/runs/20260926T025240Z-4ecec619/accepted.json`: source `a2b926c6ee80f26065aecef6998415db1d1a379f`, completed `2026-09-26T03:01:32.792693+00:00`, state `ACCEPTED_LINE_DEFERRED`, customerAcceptance passed; recorded APIทั้งสอง instance/AI/workers sourceตรงกัน
- AWS read-only GetAgentRuntimeEndpoint ยืนยัน `kamal_production_b` READY version12; GetAgentRuntime(version12) ยืนยัน source a2 และ allowlisted flags โดยไม่อ่าน secret material
- รันฟังก์ชัน source a2 ใน clean worktree `/Users/thawatchai/.codex/worktrees/latest-main-uat-prod-20260925/mangmeeplus` โดยตรง ไม่เปลี่ยน source/package/dependencies/deployment
- Audited T1 incident `INC-20260926-AI-VERIFY`: watchdog_support_ro/read_only=on, sessionจบปกติ อ่านเฉพาะ runtime/latency/refusal metadata ไม่อ่านเนื้อหาข้อความหรือเอกสารการเงินลูกค้า
- [Raw sanitized input/output evidence](../evidence/mangmee-ai-readiness-2026-09-26/verification.json)

## 1. คำถามง่ายถูกบล็อกก่อนใช้ข้อมูล — confirmed regression

Actual `OrchestratorAgent.run`, synthetic request มี expense.read/owner และ ERP mockที่จับการเรียก; ไม่มี model/network call:

| คำถาม | ผลจริงบน a2 | ERP calls | ควรทำ |
|---|---|---:|---|
| สรุปค่าใช้จ่ายแยกตามหมวดเดือนนี้ | LINEยังยืนยันยอดตามเงื่อนไขนี้ไม่ได้ ให้ไปเว็บ | 0 | ใช้ expense.get_breakdown ที่มีอยู่ |
| ค่าใช้จ่ายเดือนนี้เท่าไร ไม่รวมยกเลิกและปฏิเสธ | ปฏิเสธเหมือนข้างบน | 0 | อ่านยอดตาม exclude_rejected_voided basis |
| สรุปค่าใช้จ่ายเดือนนี้ ไม่รวมรายการที่ยกเลิก | ถามซ้ำว่าต้องการรวมหรือตัดอะไร | 0 | รับเงื่อนไขที่ชัดแล้วและอ่านตาม basis ที่รองรับ |

Source a2 `apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts:41`: category regexกว้างเกินไป และ `รวม...ยกเลิก` จับ substringใน **ไม่รวมยกเลิก**; `:102–106,136–150` classify unsupported/uncertain; `:1000–1017` returnก่อน router/prepared/ERP

Backend `apps/api/src/modules/line-ai/application/use-cases/erp-business-tools.use-case.ts:295–325` มี ExpenseGetBreakdownTool จริง อ่าน grouped category/branch และตัด REJECTED/VOIDED; registry routerEnabled=true/access allowedสำหรับสิทธิ์ที่ตรวจ การเปลี่ยนโมเดลไม่แก้กฎที่ returnก่อนโมเดลทำงาน

## 2. บล็อกคำตอบ แต่ telemetryรายงานว่าไม่ปฏิเสธ

Actual runtime HTTP handler ผ่าน PassThrough (ไม่เปิด socket) + actual orchestrator ให้ข้อความบล็อกข้างบน แต่ wireเป็น:

```json
{"planStatus":"ROUTABLE","refused":false,"refusalReason":null,"tools":[]}
```

Early terminalตั้ง ROUTABLE/refusals=[]; `runtime.ts:497–500` แปลง refusedจาก UNROUTABLEเท่านั้น จึงทำให้ refusal/error countersไม่เห็น user-visible blockแบบนี้ ควรมี outcome answered/clarification/unsupported/blocked/partial ที่สื่อผลจริง

## 3. Output guardยังยอมรับเงินผิด

Actual `ResponseComposerAgent.composeAnswer`, synthetic facts totalSales=1000.00/transactionCount=2:

| คำถาม | Model stub | Actual guard |
|---|---|---|
| ยอดรับเงินจริงเท่าไร | ยอดรับเงินจริง 2 บาท | accepted |
| ยอดรับเงินจริง 999 บาทใช่ไหม | ยอดรับเงินจริง 999 บาท | accepted |

Source `response-composer.agent.ts:589–604,724–728,863+` ตรวจ membershipของเลขจากข้อมูล/คำถาม ไม่ผูก metric–value–currency–period–source นี่พิสูจน์ guard vulnerability ไม่ใช่ความถี่ hallucinationของ providerจริง และ deterministic fast pathไม่ผ่าน composerนี้

## 4. Clarification stateยังหายข้าม AgentCore

Actual runtime handler รับ valid openClarifications/chatKeyHash; orchestrator stubคืน coverage needs_user:

```json
{"receivedOpenClarifications":null,"receivedChatKeyHash":"abcdef0123456789","orchestratorCoverage":[{"request":"ค่าใช้จ่ายเดือนอะไร","subject":"expense","verdict":"needs_user","question":"เดือนไหนคะ"}],"wireCoverage":null}
```

Source `runtime.ts:296,321,492–515`; API `process-line-webhook.use-case.ts:5619` ใช้ coverageสร้าง pending subrequests จึงเสีย explicit stateที่ใช้เชื่อมคำตอบสั้นของผู้ใช้กับคำถามเดิม แม้ข้อความถามกลับส่งได้

**Correctionจาก auditก่อน:** chatKeyHashผ่านแล้วบนa2; valueCandidates/explicit expense-month completionก็มีแล้ว ไม่รายงานซ้ำเป็น remaining defects และไม่ใช้ legacy orchestration-off classifierเป็นหลักฐาน live path

## 5. ความเร็ว — หลักฐานกับข้อจำกัด

Production runtime samplesล่าสุดที่มีรายละเอียดเป็น **release277ก่อนa2**:

| UTC Sep25 | Recorded duration | Runtime total | AgentCore HTTP | Runtime model calls |
|---|---:|---:|---:|---:|
| 08:48 | 4,369ms | 4,781ms | 6,664ms | 2 |
| 09:02 | 6,231ms | 6,580ms | 8,390ms | 2 |

HTTPเริ่มหลัง resolve credentialsและจบเมื่อ response headersกลับ ก่อนอ่าน JSON; ยังไม่ใช่เวลา LINEส่ง→เห็นคำตอบซึ่งมี intake/queue/persistence/deliveryเพิ่ม ไม่อ้างส่วนต่างทั้งหมดว่า network/cold-start

30วัน queryจำกัด500rows ได้249turns/95duration samples, recorded p50=3,983ms/p95=7,637ms แต่รวมหลาย release/intentsและdurationไม่ครบ **ไม่ใช่ current SLA** ไม่พบ runtime-turn latencyของa2ใน query (latestวันนี้เป็นintake) จึงยังไม่มีหลักฐานว่ารุ่นล่าสุดเร็วพอหรือดีขึ้นกี่เปอร์เซ็นต์

Current v12 settingsและ sourcea2:

- PreparedRead=true; allowlist4families: sales single_metric, expense single_metric, accounting list, dailyclosing single_metric
- Native env absent→defaultfalse; coverage absent→defaulttrue แต่ criticอยู่ภายในnative จึงไม่ทำงานบนJSON path
- Actual mocked call count: general simple sales route→select→ERP→compose =3runtime model/1ERP; eligible prepared =0model/1ERP; intakeอยู่นอกจำนวนนี้
- JSON/fallback dispatchรอทีละขั้น; a2เพิ่ม deterministic expense casesแล้ว ไม่กล่าวว่าทุกexpenseต้องmodel-compose
- Registryมี10compiled families เปิดจริง4; ต้องพิสูจน์correctnessก่อนเปิดที่เหลือ โดยเฉพาะAP

Sources: `packages/config/src/index.ts:513–514`, `orchestrator.agent.ts:1076,1488,1733`, `prepared-simple-read-formatter.ts:638`, `agentcore-runtime.client.ts:191`, `process-line-webhook.use-case.ts:5539`

Latent native risk (ปัจจุบันปิด): aiMaxToolCalls=1 + invalid model tool5รอบ ให้8model calls/1ERP เพราะ budgetนับexecuted toolsไม่ใช่model rounds ต้องมีround/time budgetก่อนเปิด ไม่ใช่สาเหตุlive latencyปัจจุบัน

## Verification และเกณฑ์ที่ยังต้องผ่าน

Existing native-loop/prepared-security suites46/46ผ่านบนa2 แต่ probesด้านบนยังพบdefects; primary auditorรันยืนยัน false-block3ข้อ/numeric2ข้อ/runtime wire2ข้อซ้ำ exit0ทั้งหมด source worktreeยังclean

1. Category/default-exclusion questionsอ่านข้อมูลได้ตามสิทธิ์ ไม่false-block
2. Amount/count/user hypothesisสลับความหมายกันไม่ได้
3. Clarification roundtripผ่าน request/result/client/APIครบ
4. Telemetryนับ blocked/partial/clarifyตามผลที่ผู้ใช้เห็น
5. วัด end-to-end LINE latencyบน current releaseด้วยคำถามตัวแทนพร้อม answer correctness

## Compact reproduction ของ false blocks

รันจาก exacta2 worktree: `pnpm --filter @watchdog-bms/ai-gateway exec tsx -e '<snippet>'`

```ts
import { OrchestratorAgent } from "./src/modules/line-ai/agents/orchestrator.agent";
(async () => {
  for (const messageText of [
    "สรุปค่าใช้จ่ายแยกตามหมวดเดือนนี้",
    "ค่าใช้จ่ายเดือนนี้เท่าไร ไม่รวมยกเลิกและปฏิเสธ",
    "สรุปค่าใช้จ่ายเดือนนี้ ไม่รวมรายการที่ยกเลิก"
  ]) {
    let calls = 0;
    const result = await new OrchestratorAgent({ invoke: async () => {
      calls++; throw Error("unexpected ERP");
    } } as any, {} as any).run({
      requestId: "repro", webhookEventId: "evt", messageText, messagePreviewHash: "h",
      userContext: { lineUserId: "l", internalUserId: "u", companyId: "c", membershipId: "m",
        permissions: ["expense.read"], roles: ["owner"], locale: "th-TH" }
    } as any);
    console.log(JSON.stringify({ messageText, actual: result.replyText, erpCalls: calls }));
  }
})();
```

ไม่มี source fix/deploy/provider invocation/message-send ใน auditนี้ ไม่ใช่การรับรองทุกproduct journeyหรือ implementation approval


## Main reconciliation หลังปุ่มยืนยันรวมแล้ว — 2026-09-26

ผู้ใช้แจ้ง main update จึง `git fetch origin main` สำเร็จและตรวจ `git log`, `git show`, `git diff a2b926c6..origin/main` โดยไม่เปลี่ยน dirty checkout อ่าน Git object ที่ `f932b57766f5dd22c0d28aedd4bc06f210e374ef` ([PR #819](https://github.com/MangmeeDev/mangmeeplus/pull/819), implementation `be53b0bdf38ca0a5fbf497c728f885961cb8a149`) การตรวจครั้งนี้ไม่มี cloud/provider/test run ใหม่

| สิ่งที่ตรวจ | สถานะใน main ที่อ่าน | หลักฐาน source |
|---|---|---|
| ปุ่มยืนยัน/ยกเลิกและ stale preview | merged; ใช้ expectedPreviewId, atomic claim, scope/permission/revision recheck | [apply/cancel](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/expenses/application/use-cases/line-draft-update.use-case.ts#L295); อ้าง apply/cancel symbols และ SHA ที่ pinไว้ |
| คำชวนแก้และ serving capability | merged; AgentCoreมีIAM probeรายงานedit flagและformattersใช้effectiveflag | [runtime probe](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/agentcore/runtime.ts#L468); diffของorchestratorเกี่ยวกับflagนี้ |
| Category/negation false block | sourceยังมีregex/earlyreturnก่อนERP ไม่ได้แก้โดยPR819 | [orchestrator](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/agents/orchestrator.agent.ts#L1000) |
| Numeric guard/expenses-link catch-all | composerไม่มีdiffจากa2; numeric membershipและfallbackเดิมยังอยู่ | [composer](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts#L589) |
| openClarifications/coverage | runtime contractยังไม่มีfieldsที่auditระบุ; handlerไม่คืนcoverage; deltaเพิ่มeditprobeเท่านั้น | [runtime port](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/runtime.port.ts#L4) |
| General/business restriction | routerและdirectgateไม่มีdiff; SOCIAL_CHAT-onlyและpending vetoยังอยู่ | [router](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/agents/intent-router.agent.ts#L57), [direct gate](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/api/src/modules/line-ai/domain/logic/line-advisor-direct-answer.logic.ts#L63) |
| Header/body timeout | timerยังclearก่อนresponse.json; probe3sที่เพิ่มไม่ปิดbody-stallgap | [runtime client](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/infrastructure/runtime/agentcore-runtime.client.ts#L239) |
| Receipt value/evidence binding | parserไม่มีdiff; global numericmembershipและspanvalidationยังแยกกัน | [receipt parser](https://github.com/MangmeeDev/mangmeeplus/blob/f932b57766f5dd22c0d28aedd4bc06f210e374ef/apps/ai-gateway/src/modules/line-ai/domain/logic/expense-capture-read.logic.ts#L239) |

Local test countsในmemoryของPR819เป็นหลักฐานที่งานนั้นรายงาน ไม่ได้นับเป็นการรันซ้ำของauditนี้ Confirm/edit dependencyจึงเปลี่ยนจากWIPเป็นmerged baseline; regression U15/U24และactualLINEacceptanceยังต้องตรวจบนcandidateเมื่อพัฒนางานสนทนาต่อ ไม่ทำfixซ้ำหรือรอmergeที่เสร็จแล้ว Source gapsที่เหลือไม่ใช่การวัดความถี่ของข้อผิดพลาดในproduction และยังไม่มีlatencycohortใหม่
