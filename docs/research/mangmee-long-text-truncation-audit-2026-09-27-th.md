# ข้อความยาวและคำตอบถูกตัด — source audit

วันที่: 2026-09-27 • scope: audit/spec/plan เท่านั้น • source ที่ pin: `f932b57766f5dd22c0d28aedd4bc06f210e374ef`

ข้อสรุป: มีช่องว่างจริงทั้งการเก็บบริบทแบบ preview, การรับ model output ที่ชนเพดาน และ renderer บางเส้นทาง ข้อกำหนด context compaction/แบ่งข้อความมีอยู่แล้ว แต่ยังไม่ใช่หลักฐานว่า implementation ครอบคลุมทุก path ปัญหานี้แก้ด้วยการเพิ่มจำนวน tokens อย่างเดียวไม่ได้

## หลักฐานจาก source

เลขบรรทัดต่อไปนี้เป็นของ Git source ที่ pin ไม่ใช่การรับรองว่า working tree หรือ Production ปัจจุบันตรงกันทุกไฟล์

| จุด | หลักฐานที่ f932 | ผล/ข้อจำกัด |
|---|---|---|
| ประวัติข้อความ | `process-line-webhook.use-case.ts:711,5935,6126–6151` เก็บ user preview240 UTF-16 code units; loader ใช้ preview ใน15turn window | เงื่อนไขท้ายข้อความยาวอาจไม่อยู่ใน model context ของ turn ถัดไป ไม่ได้พิสูจน์ว่าข้อความปัจจุบันทุกข้อความถูกตัด240 |
| Prompt ความยาว | `response-composer.agent.ts:51–54` ขอคำตอบราว400characters/ไม่เกิน5listlines; `:580` compose600tokens, `:586` ยาวเกิน1200codeunitsคืนfallback; `:625` polish500tokens | หลายข้อ/คำขอรายละเอียดอาจถูกบีบจากนโยบายตอบสั้นก่อนถึงช่องทาง LINE ต้องผูกความยาวกับ goal coverage |
| รับ truncated output | `response-composer.agent.ts:583–604,628–632` ไม่มี stopReason gate สำหรับ compose/polish; casual `:424,656–663` มี boundary handling | Probe กับ provider stub ยืนยัน compose/polish รับข้อความที่ขาดท้ายและ stopReason=max_tokens ได้ แม้ไม่ได้ผ่านทุก wording |
| Router/OCR บางส่วนมีการป้องกันแล้ว | `intent-router.agent.ts:511–523` แยก ROUTER_OUTPUT_TRUNCATED เมื่อ parse ไม่ได้; OCR controllerมี OCR_OUTPUT_TRUNCATED | Reuse code/error contract ที่มี แต่การ parse ได้ไม่เท่ากับพิสูจน์ว่า output ทุกส่วนครบ; ไม่อ้างว่าทุก lane ไม่มี guard |
| Flex card | `line-business-card.logic.ts:24,75` ตัด card.text1200codepoints; `:603` จำกัด12cards | หากส่งเนื้อหาเกินเข้าฟังก์ชัน จะตัดส่วนเกิน rendererไม่ได้ให้ completeness outcome; ยังไม่ได้พิสูจน์ว่า13cardsผ่าน upstream contract ได้จริง |
| Gateway business delivery | `process-line-webhook.use-case.ts:5651–5672` เรียก single Flex business renderer | ไม่ใช้ตัวช่วย multipartของcompleted-replyในเส้นทางนี้ จึงต้องต่อ preservation ให้ครบก่อนอ้างว่าคำตอบยาวไม่หาย |
| มี path ไม่สูญหายแล้ว | `process-line-webhook.use-case.ts:3081–3087,3100–3142` ตรวจ text limit และส่ง terminalที่เกิน1200เป็น plain textเต็ม | ใช้เป็นฐาน ไม่สร้าง deliveryระบบใหม่ แต่ helperจำกัดจำนวนpartsและไม่ได้ครอบคลุมทุกcaller |
| จุดแบ่งคำ/Unicode | `apps/api/src/modules/expenses/domain/logic/line-expense-draft-conversation.logic.ts:720–733` แบ่ง4800UTF-16units เลือกnewlineก่อน แล้วใช้raw offsetเมื่อไม่มี | การต่อstringกลับได้ครบยังไม่พิสูจน์ว่าแต่ละmessageไม่ผ่าsurrogate/grapheme/จำนวนเงินหรือเงื่อนไขสำคัญ ต้องเพิ่มboundaryvariantsโดยreusehelper |
| Text adapter | `line-reply.adapter.ts:213–214` ใช้ text.slice(0,5000) | Callerที่ไม่ผ่านlengthguardยังมี silent-cut risk; ต้องตรวจทุกproducerก่อนเปลี่ยน adapterเป็นtyped overflow ไม่ถือว่าตัดเลขท้ายแล้วส่งสำเร็จ |
| Shared budget | `packages/contracts/src/ai-budget-bounds.ts:78–85` intake1500output/turn1024maxต่อcall; envelopeเทียบexactbounds | การเพิ่มoutputต้องversion bounds/hold/pricing/receiverร่วมกัน ไม่เพิ่มmaxTokensเฉพาะpromptแล้วข้ามbudget |

Source paths: [composer](../../apps/ai-gateway/src/modules/line-ai/agents/response-composer.agent.ts), [webhook use case](../../apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts), [business renderer](../../apps/api/src/modules/line-ai/domain/logic/line-business-card.logic.ts), [LINE adapter](../../apps/api/src/modules/line-ai/infrastructure/line-reply.adapter.ts), [budget bounds](../../packages/contracts/src/ai-budget-bounds.ts).

## การจำลองที่รันจริง

[JSON evidence](../evidence/mangmee-ai-readiness-2026-09-26/long-text-probes-2026-09-27.json): โหลดcomposerทั้งไฟล์จากGit f932, transpileด้วยTypeScriptเดิม, รันในVMด้วยprovider stub ไม่มีprovider/network/DB/application bootstrap และไม่มีการแก้โค้ดแอป

- `composeAnswer` รับข้อความสังเคราะห์ที่จบ “สาขาลาดพร้าว และ” ทั้งที่ `stopReason=max_tokens`
- `polishLanguage` รับ “ยอดขาย 100 บาท และ” ทั้งที่ `stopReason=max_tokens`
- Negative control ที่จบ “โดย” ถูกsemanticguardอื่นปฏิเสธ: ไม่ใช่ทุกpartialจะผ่าน และ probeแรกที่คาดว่าผ่านกรณีนี้ล้มก่อนปรับfixtureเป็นคำที่guardอนุญาต
- ภาพประกอบเชิงคำนวณ: ข้อความ259codeunitsที่มี “ไม่รวมรายการยกเลิก” หลังตัวที่240 สูญเงื่อนไขเมื่อใช้sliceเดิม เป็นการสาธิตpreview arithmetic ไม่ใช่reproductionบทสนทนาProduction

## ข้อกำหนดและงานต่อ

ใช้ [spec §19.4](../specs/mangmee-ai-understanding-and-advisor-reliability-spec-th.md) และ W01/W02/W04/W06/W11/W13/W14 เดิม: แยก input/context/output/render overflow, ตรวจ stop reason+goal coverage, กำหนด output budget ตามงาน, เก็บ canonical answer และต่อ rendererแบบไม่สูญหายเข้าทุกlane รวมtyped failure/partialและdelivery replay ห้ามแก้ด้วยการลดคำตอบให้สั้นจนทำงานไม่ครบ

LINE กำหนดเพดานข้อความ text5000 โดยนับเป็นUTF-16codeunits และส่งได้สูงสุด5messageobjectsต่อrequest ไม่ใช่จำนวนคำไทย ดู [API reference](https://developers.line.biz/en/reference/messaging-api/#text-message), [character counting](https://developers.line.biz/en/docs/messaging-api/text-character-count/) และ [sending messages](https://developers.line.biz/en/docs/messaging-api/sending-messages/). Token/UTF-8byte/codepoint/graphemeเป็นคนละหน่วย; ใช้หน่วยที่ตรงกับแต่ละboundary

ไม่มีการวัดอัตราตัดข้อความบนProduction ไม่มีliveLINE/providerbenchmark และยังไม่มีapplicationfixจากงานนี้

มีexisting testsที่ `line-intake-dispatch.use-case.spec.ts:4271–4357` สำหรับterminal1300/4900,5partsและreject5001ตามsourceที่pin; รอบนี้อ่านcoverageไม่ได้รันsuiteนั้นใหม่ และไม่ใช้ผลเดิมแทนgatewaybusinesspath ส่วนdocumentQAรอบนี้ผ่าน5files/54local links/fences/whitespaceและ55IDsเดิม(53active)
