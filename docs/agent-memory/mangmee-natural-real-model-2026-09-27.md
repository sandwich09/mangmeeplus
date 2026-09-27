# Agent Memory: Natural Thai real-model and outgoing LINE checks

Status: Testing and scoped defect repair complete; conversational acceptance FAILED. Reviewed patch/evidence delivery tracked in PR832 and develop synchronization; no native LINE/production readiness claimed.
Owner: Current thread; product owner authorized testing on 2026-09-27.
Scope: NAT-01–12 / 60 natural Thai messages from the human review packet, real configured model, actual compiled API/Gateway/domain tools and isolated synthetic data, outgoing LINE content/cards/buttons/links.

Decisions:
- Owner said “โอเค ตรวแล้วคุณดำเนินการทดสอบต่อได้เลย ถ้าการทดสอบต่อไลน์จริงไม่ได้ ให้ดูถึงแค่ output ที่ออกไปถึง web hook ว่า เนื้อหา card ลิ้งค์ ถูกไหม”. This records review of the presented NAT questions and authorization to proceed. It does not certify model answers, all original 225 cases, receipt labels, or the draft knowledge pack.
- Native LINE delivery may be replaced by an explicit outgoing HTTP sink. Sink acceptance is never native delivery or customer latency evidence.
- Preserve the old corpus and its historical hashes. Bind NAT separately, with source-derived facts and semantic review where exact tool calls are not unique. Missing preconditions remain visible.
- Public lookup, voice, financial profiles and service recommendations remain deferred. No deployment or customer gate changes are part of this test.
- Reuse the committed runtime runner and Ponytail full workflow; no new dependency or package metadata changes.
- Read cloud/deployment runbooks before initial AWS read-only access. Non-root watchdog-bedrock identity confirmed; configured global Sonnet 4.6 profile is ACTIVE. Existing approval record is docs/security-evidence/p1-ai-processor-lawful-basis-register.md, DPO-2026-07-23-bedrock-global. Only synthetic test data goes to the provider.

Open questions: None blocking initial isolated diagnostic run. Knowledge/asset certification and diverse real-shop receipts remain separate acceptance gaps.

Artifacts:
- docs/research/mangmee-ai-human-review-2026-09-27-th.md
- scripts/line-ai-reliability-runtime.ts
- scripts/line-ai-natural-conversation-corpus.ts / .spec.ts: 12 conversations, 60 exact questions, actual synthetic ERP rows.
- scripts/line-ai-natural-wire-report.ts / .spec.ts: offline actual wire/card/action/link review.
- Local raw diagnostic artifacts: /tmp/mangmee-natural-20260927/ (synthetic data only; baseline runs remain separate).

Verification:
- Initial worktree clean at b4afff053f9f0f89662e9e64bedaeaa5fb3772b9; working branch codex/mangmee-natural-real-model-20260927.
- AWS STS confirmed non-root account identity; ListInferenceProfiles returned global.anthropic.claude-sonnet-4-6 ACTIVE. These checks do not prove successful inference.
- Restarted only task-owned local PostgreSQL (15439) and Redis (16389); customer/UAT/Production services unchanged.

Next: Bind NAT, capture actual outgoing wire, freeze code/fixtures, run real provider, review content/facts/effects/timing and record failures without weakening expectations.

## 2026-09-27 real-provider diagnostic baseline

- Fixed test infrastructure before judging the model: corpus categories needed required accountHintKey; isolated reset needed existing launch gate seed; versioned local MinIO serves actual frozen assets. Setup-only attempts made zero provider calls and are not quality samples.
- Baseline at 64bdcba8: NAT-01 five turns, eight actual Bedrock Sonnet 4.6 provider calls, 579 satang settled. All five failed the intended conversation. First outgoing replies took 7.3–16.2 seconds; these are failure replies, not successful-answer latency.
- Raw provider passthrough trace proves the first Thai typo question is understood, but the provider used endUtf16=34 for a 32-unit input. Strict evidence validation correctly rejected it. Candidate supplies an exact server-generated whole-part reference; strict parser stays unchanged.
- Code audit identified the semantic branch spending a control call despite the prepared simple-read plan and two-call envelope. Candidate bridges to the existing guarded deterministic formatter; does not increase grants or execute writes.
- Real baseline final general turn exhausted admission and delivered a misleading credit fallback without closing the webhook event. Candidate records honest terminal failures; does not enlarge deadlines.
- Baseline turn 2 failed before HTTP with LINE_AI_PROVIDER_UNAVAILABLE. Follow-up subject context, filter equivalence, general-lane deadline feasibility, arithmetic and receipt/card paths still require real testing.
- Unit evidence: router 127/127; prepared path 69/69; compatibility 81/81; Gateway noEmit; report 6/6 with strict TS and local visual review. These do not imply model acceptance.

Next: freeze candidate source, rebuild actual API/Gateway, run all 12 natural conversations once, retain every wire response and failure, and separately review facts, effects, cards and routes. Native LINE, customer latency, diverse real receipt labels and statistical acceptance remain unverified.

## Candidate freeze and full natural run

- Test source frozen at `f9444099ee4ce88cb95d99ef192b1c6bf2fac543`; API SWC build, Gateway TypeScript build and API noEmit passed. Actual Bedrock model/profile unchanged.
- Local actor-delegation signing key was missing from the initial launcher; added a dedicated synthetic key to both test processes. The earlier pre-HTTP requestLineTurn failure was a local setup gap, not proof of a deployed defect.
- Candidate1 exposed a harness race: response_ready cleared payload before the real webhook handler finished dispatch. The next turn replaced the sink recipient owner and rejected the preceding reply. Added an in-flight counter around real execute/executeReceiptUpload calls and safe exception diagnostics; no production authorization change.
- Candidate2 NAT01 first question actually delivered correct 27,230.50 THB / 9 records and Sep1–27 scope in about8.7s. This is one diagnostic success, not aggregate acceptance.
- Candidate2 turn2 exposed a real producer/validator inconsistency: sendMessagesV2 marked PARTIAL without a required limitation item; buildLineDeliveryPlan threw PLAN_INCOMPLETE_COVERAGE. Fixed producer for needs_user coverage and failed QA pages; required pending IDs remain exact, displayed pages use attachment ordinals. 28 focused tests and full API noEmit pass.
- Visually inspected old225 assets are unsuitable for OCR acceptance (receipt PNG has no text; two PDF labels claim2pages but files have1). Preserved them unchanged; new separate NAT-only readable PNG and actual2page PDFs have authored ground truth, hashes and draft labels. The owner has not human-certified these new labels.
- Full60 started using the single frozen candidate, compiled API/Gateway, actual synthetic ERP and actual provider. Public lookup/voice remain off; no UAT/Production changes. Final answer/effect/wire review pending.


## Full primary result and scoped repairs

- Primary f9444099 ran2026-09-27T04:03:43.800Z–04:18:40.696Z: planned60, observed56; NAT06T2–5 stopped after firstPDF timeout.58sinkreceipts/83textmessages; allrepoenvelopes valid;12URLoccurrences/4uniqueroutes validcompany/source;0Flex/actions/postbacks. No full conversation passed. Full semantic reviews are in docs/research/mangmee-natural-model-evidence-2026-09-27/.
- Recorded real financial defect: read-only PDF entered legacy capture and created ExpenseRecord before storage PUT. Independently, harness omitted configuredlocalS3egress. d8ec4acd fixes local-only egress;063b7f2a adds v2 typedwriteguard and pending retention with actualpagecount, plus dedups exact PARTIAL questions. Retest all5PDFturns had0financialwrites but QAblocked and current-file state moved back to original afterreplacement.
- Image defect: first pre-capture QA helper passed metadata without bytes, then reusedroute so legacyimageintake neverran. e9d86738 forwardsPNG/JPEGbytes, usesexistingIMAGE/line-intake-image/2 grant and existingOCRadmission/retrycallback. Realretest intake correctlyextracted5receiptfields but genericread-kind preventsQA/resultdelivery; followupcontext stillmissing. Noexpensewrite/preview.
- a9763631 fixes deterministic QA hashcontract mismatch: truncated32hex budgetattempthelper was used where evidence requires64hex SHA256; use fullhash locally without changingglobalreservationhelper or parser. PNG/JPEG-only forwarding tightened, PDF metadata preserved. Finalsource-built NAT05+06retest running, separate fromprimary.
- Focused verification: router128,prepared69+compat81,terminalgeneral6,PARTIAL28,PDF/dedup39+webhookcompat353; finalimage+QA API63,contracts8,GatewayQA4, earlierintake/Bedrock65. API/GatewaynoEmit passed inrespectivechanges. No newdependency/package.json edits.
- Final report records remaining context/currentattachment/semanticfiledispatch, budgetrouteeligibility/generaldeadline, entityresolution, draft/control/preference and truthfulbasis blockers. Direct-provider sameimage/model correctlyreadsall5fields; not end-to-endacceptance. Humanreceipt/knowledgecertification/nativeLINE remainunverified.

Next: finish finalmediaretest, freezeevidence, reviewandmerge scoped fixes/testartifacts to main+develop under standing authorization. No deployment/customer-gate change.


## Final tested candidate and independent review

- a9763631 final NAT05+06 run04:40:55.546Z–04:43:54.999Z planned10/observed6. PNGintake readsactualfivefields but no user-facinganswer/preview; PDF firstturn reachesrealreader(27.702s) yetQA_RESULT_INVALID, fallbackwithdelivery_pending, thenREPLAY_TERMINAL_TIMEOUT and4laterturnsnotrun. No ExpenseRecord/Reimbursement mutation in capturedmediaeffects. No readinessacceptance.
- Final corpus/report/runtime/runner31pass/1PGseed-opt-in-skip; previousactualPGseedcheckpassed. API63/63+contracts8/8+GatewayQA4/4+API noEmit allpass. Exact tests/results/logpaths in taskreport.
- Astra independent source review b4afff053→a9763631 found no newblocking production/security regression, verified primarycounts/timestamps, approvedsourceforPR with failedreadinessexplicit. Remaining context/filedispatch/readeroutput/delivery/task/entity/preference/budget gaps stayopen.
- Published synthetic evidence JSON/manifest/HTML parse and reportlinksresolve; no connectioncredentialkeys retained. Native LINE, auth/LIFFlinks, cardclicks, humanassetlabels and statisticalspeedacceptance notdone.

Next: commit/pushreviewedevidence, adminmerge main+develop underexistingownerinstruction, recordPRs/exactmergeSHAs; stoponlytask-ownedlocaltestprocesses. No deploy.


## Delivery handoff

- Main PR: https://github.com/MangmeeDev/mangmeeplus/pull/832; reviewed source candidatea9763631, subsequent changes onlyevidence/docs. Develop synchronization preserves samefinaltree; finalmergeIDs recorded in userhandoff.
- Final independent media review:6/10observed,9textmessages/8sinkreceipts,0cards/actions/links;0financialwrites. Readerparserrejects7/13spanclaims(6page1facts+1page2evidence). Failure notice ACCEPTED bysink whileeventpending. Remainingcause of pendingbranch notproven; notclaimedfixed.
- TasktestGateway stopped; task-ownedPostgres/Redis/MinIO stoppedafterevidencecapture. Originalusercheckout baseline trackedcontent hash andall32baselineuntrackedfilehashes unchanged. No cloudservice/deploy/customer-gate action.
- Next product work: P0blockers in resultsreport; rerun frozenwholeconversations afterfixes, then humanlabels/knowledge/nativeLINE and statisticalspeedacceptance. Tests/exactmockedcontracts alone cannotclose W14.
