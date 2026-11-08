# LINE AI workflow baseline (M4), measured 2026-11-05 and 2026-11-06

Plan: `docs/plans/line-ai-workflow-first-plan.md` M4. Measurement rules: `docs/specs/line-ai-measurement-and-eval-spec.md`.

## What was run
- **Product code.** Main `efd65cbf5`: Phase A and the multi-message claim fix round 2, before Phase B and before P7.
- **Harness fixes.** Two harness-only fixes sat on top, both later on develop:
  - free-shop replay permissions, `15cfbb30e`;
  - the free draft creator's runtime role, `3985d7cfb`.
- **Model.** Bedrock `global.anthropic.claude-sonnet-4-6` in ap-southeast-1, production AI env, through a local gateway.
- **Corpora:**
  - visible tuning workflow: 115 conversations, 322 turns;
  - held-out workflow: 202 conversations, 578 turns, kept outside the repo;
  - retained advisor held-out: 43 conversations, 71 turns.
- **Spend.** 821 THB for every real-model eval run in this programme to date, smoke runs included, inside the owner's 2,300 THB cap. The baseline runs themselves came to about 660 THB.

### Method notes, so the next run is cheaper
- **Fresh processes.** The in-process runtime grows about 75 MB per conversation, and one process hit the 4 GB heap at 53 conversations. Runs went in fresh processes of 25 conversations that resume one progress file, so spend and the cap stay cumulative.
- **Bangkok midnight.** A run cannot cross Bangkok midnight (`REPLAY_FIXTURE_BUSINESS_DATE_CHANGED`). The two workflow corpora were therefore measured in two parts: 75 + 40 tuning and 53 + 149 held-out conversations. Each part was scored with its own date, and the counts were added.
- **A quiet machine.** The first advisor run overlapped a landing chain and a memory-starved runner, and 34 of its 40 failures were "ระบบตอบช้ากว่าปกติ" timeouts. It was discarded and re-run. Do not run journeys or landing chains during a measurement run.
- **Held-out labels.** Before the first held-out run, four held-out refusal labels changed from `permission` to the new unscored `record`, and one conversation needed the 24-turn replay limit. No scored field changed.

## Results

| Metric (spec §W) | Tuning (115) | Held-out (202) | Target |
|---|---|---|---|
| W1 classifier label | 0/58 | 0/92 | ≥ 95% (no classifier yet) |
| W2 workflow started right | 12/79 (15.2%) | 40/240 (16.7%) | ≥ 95% |
| W3 completable tasks finished | 39/72 (54.2%) | 59/160 (36.9%) | ≥ 95% |
| W6 wrong applied / wrong preview | 8 / 15 | 20 / 96 | 0 |
| W7 typed starts with ≤ 1 model call | 9/107 | 68/157 | ≥ 95% |
| Answer checks (knowledge, due date, refusal, free) | 34/109 | 30/86 | — |
| W8 p50 / p95, ms | 8,182 / 17,855 and 5,089 / 11,775 | 6,964 / 16,696 and 5,771 / 13,449 | AC14 |
| W12 machine-token turns | 0/322 | 0/578 | 0 |
| W13 provider cost | 260.51 THB | 199.34 THB | Phase B: ≥ 70% lower for typed workflows |

**Retained advisor held-out:** 64/71 (90.1%), 52.79 THB. At the programme close it was 91.5%. Latency p95 was 5.5 s on the fast lane and 11.9 s on the full lane, with nothing over 15 s.
- 3 of the 7 failures are out-of-package questions. The reply is the approved plain-words sentence for unsold modules ("งานนี้ยังทำไม่ได้…", `a28938740`), while the old gold still requires "แพ็กเกจ" or "ยังไม่มี". The gold wording is stale.
- The other 4 are read and fact misses.

## Findings
1. **Typed workflow starts fail, as expected before Phase B.** The real router gives no workflow label, so the old agent answers in general text and no card is delivered. Most `wrongPreview` counts are "no preview at all". Button presses that depend on such a card cannot find it: the button baseline is 3/45 and 10/200.
2. **Tier 2 acts on the wrong record after the user names it.** This is a real product bug. Each case needed a confirm press on a card that showed the wrong record. The classes:
   - a claim rejected or cancelled by amount;
   - a draft deleted by document number;
   - a confirmed expense voided by document number;
   - a voucher built with an extra bill.

   The model's chosen id is trusted over the document number, amount or round label the user typed. Tuning example: "ไม่อนุมัติใบเบิกของสมชาย" / "ยอด 1,877 บาท" rejected the 2,721 THB claim.
   - Fixes: claim amounts in `wfp-r3`; every action preview in `wfp-r5`.
3. **A typed answer to an open workflow picker creates a new expense draft.** No model is involved. For example, after the delete picker, "ใบเลขที่ ทดสอบ-0003" created a draft instead of selecting that bill. The fix is `wfp-r4`: the open picker is pending work, its listed targets are matched first, and nothing is created from that text.
4. **A combined claim answer** ("ไม่มีใบเสร็จ หมวดค่าเดินทาง เหตุผล…") was not captured, so the claim never reached a confirm card. Fixed in `wfp-r3`.
5. **Q5 follow-ups** ("ไม่เข้าใจ", "ยกตัวอย่าง") lose the card. P7.1/P7.2 landed after this baseline, and P7.4 measures them in the post-Phase-B run.

## Next (as planned on 2026-11-06 morning)
- Land Phase B B3/B4 with `wfp-r3`–`r5`.
- B5: tune T/M on the tuning corpus.
- Then one held-out run for MA3/MA6, and the advisor held-out for W11.
- Compare against this baseline: W2, W3, W6 = 0, W7 and W13.

## After Phase B, measured 2026-11-06

### What was run
- **Tuning.** Main `61fbf2245`: Phase B B1–B4 with `wfp-r3`–`r6`, before `wfp-r7` and B5. Spend 158.78 THB.
- **Held-out and advisor.** Main `921face4f`: B1–B5, with T 0.70 / M 0.10 and `wfp-r3`–`r7`. One Bangkok day, chunks of 25.
  - Held-out: 157.33 THB.
  - Advisor held-out: 51.06 THB.
- **Programme spend.** About 1,189 THB for all real-model eval runs so far, inside the 2,300 THB cap.

### Results

| Metric | Tuning before → after | Held-out before → after | Target |
|---|---|---|---|
| W1 classifier label | 0/58 → 55/58 (94.8%) | 0/92 → 74/92 (80.4%) | ≥ 95% |
| W2 workflow started right | 12/79 → 43/79 | 40/240 → 85/240 (35.4%) | ≥ 95% |
| W3 completable tasks finished | 39/72 → 40/72 | 59/160 → 61/160 (38.1%) | ≥ 95% |
| W6 wrong applied / wrong preview | 8 / 15 → **0** / 16 | 20 / 96 → **0** / 93 | 0 |
| W7 typed starts with ≤ 1 model call | 9/107 → 38/107 | 68/157 → 90/157 | ≥ 95% |
| W9 / W14 classifier invalid / timeouts | 0 / 0 of 191 calls | 0 / 1 of 182 calls | 0 |
| W8 p50 / p95, ms | p95 17,855 → 13,360 (p50 5,663) | p95 16,696 → 13,020 (p50 3,023) | AC14 |
| W12 machine-token turns | 0 | 0/578 | 0 |
| W13 provider cost | 260.51 → 149.08 THB (−43%) | 199.34 → 88.89 THB (−55%) | ≥ 70% lower, typed workflows |

**Advisor held-out (W11):** 52/71 (73.2%), against 64/71 before. The target is ≥ 90%, so it **fails**.

### Findings
1. **The safety goal held.** No conversation in either corpus applied a change to a record other than the gold one.
   - Before: 8 in tuning and 20 in held-out.
   - The fixes were the named-record guard (`wfp-r3`, `wfp-r5`) and the open-picker rule (`wfp-r4`).
2. **Workflow tasks still almost never finish by chat.** In both corpora the W3 count is made of how-to, read and small-talk tasks. The classifier starts the workflow (W2 doubled), then the typed exchange stalls. Classes, with fixes in `wfp-r8`:
   - **The trap.** An open picker re-shows itself for every later message, so a question or a change of topic cannot leave it. Only "?" was let through, and Thai questions rarely use it.
   - **Filler words.** A typed answer naming the right document number still fails when it carries polite or pointing words ("…ที่ให้เลือกเมื่อกี้นะคะ"). Every leftover word had to match the row's vendor.
   - **Names and ordinals.** Requester names ("ของสมชาย") and spoken ordinals ("อันแรก") are not read.
   - **Long lists.** On a list too long to page in chat, a typed document number never continues.
3. **Count questions open the approval picker.** "How many claims are waiting, and for how much" is labelled `approvals` and shows the picker, with no count or total.
   - For someone who cannot approve, the picker says no claim awaits them, which is false when claims await others.
   - This, with the trap, causes 5 of the advisor regressions. Fix in `wfp-r8`: count and total questions skip Tier 1.
4. **Bedrock throttling.** Five advisor turns were `PROVIDER_THROTTLED` on the intake route, after the existing two retries. The user saw the "ระบบตอบช้า" reply.
   - **Timing.** Throttled calls appeared only in this 04:22–05:39 window: 8 in the held-out run and 5 failed advisor turns. Every earlier run at the same sequential pace had none: tuning before and after, both baseline held-out parts, and the baseline advisor run. That points to a provider capacity window, not this account's quota.
   - **Shared quota.** The eval profile is an IAM user in the Production account, so real-model evals share Production's Bedrock quota. Before the Phase B release, read the Sonnet 4.6 quotas (this needs the owner's MFA session), because Phase B adds one classifier call per typed message.
5. **W1 on held-out is 80.4%.** Half of the misses read the create phrasing "เปิดใบเบิก…" as `open`. One classifier prompt example in `wfp-r8`.
6. **Stale advisor gold.** It now covers four out-of-package rows, unchanged from the baseline note.

### Held-out caveat
The `wfp-r8` classes were found or confirmed on this held-out run, and the tuning corpus shows the same classes. The next run on this held-out set therefore measures progress but is not blind for those classes. MA3/MA6 acceptance needs a fresh held-out set written by a separate lane.

## Rounds 8 and 9, measured 2026-11-06

### What was run
- **Round 8, tuning.** Main `4fd63d67d`: the picker takes only answers that name a record, and count questions are reads. Tuning 166.74 THB, advisor held-out 60.00 THB.
- **Round 9 and cards round 1, tuning.** Main `266126123`. Tuning 165.26 THB, advisor held-out 57.04 THB.
  - Round 9: a claim cancel asks for the reason, a workflow confirm shows its evidence choices, the pay example, and the receipt-blocked submit names its fix.
  - Cards round 1: claim cards say ใบเบิก / ผู้เบิก, and every confirmation card declines with "ไม่ทำ".
  - Harness fix `a6ee4843d` (the first three items below) is included.
- **Programme spend.** 1,643 THB for all real-model eval runs so far, proofs included, inside the 2,300 THB cap.

### The harness, not the product, failed these tasks
Round 8 already applied the gold record for delete, void, reject, mark-ready and voucher. The scorer still failed them for five harness reasons:
1. **Every action card was unverified.** Delivery sends the card's canonical text as `altText`. The verifier compared `altText` only, although the contents digest was equal. It now binds on the digest and accepts either text.
2. **Deleting a draft deletes its line.** The scorer counted that line as a wrong change. Claim approval also projects an expense of the claim and moves it to `READY_FOR_PAYMENT`, which counted as wrong too. Both now score as the gold record.
3. **Seeded claims could never be submitted or approved.** They had no receipt, no reason and no payout method. The workflow seed now has a policy that allows a no-receipt reason, gives every claim one, and gives drafts the cash payout method.
   - That policy also makes claim creation ask "ไม่มีใบเสร็จเพราะอะไรคะ" after "ไม่มีใบเสร็จ". That is correct for a shop with this policy, so the two tuning claim-create tasks now need one more turn than their gold.
4. **Declined tasks had no `previewTurn`.** This affected 19 tuning decline tasks. Each correct declined card counted as an extra wrong preview. The gold now names that turn, and the validator requires it. Both held-out sets already comply.
5. **Ready-to-confirm seed receipts had no image and an unresolved document type**, so a chat confirm always stopped at the evidence choice. They now carry the reviewer's settled type and the saved original-paper assessment. The tuning confirm press uses the card's real label "ตรวจแล้ว ยืนยัน".

### Results on the tuning corpus (115 conversations)

| Metric | After round 8 (scored) | After round 9 (decline turns fixed) |
|---|---|---|
| W1 classifier label | 49/58 | 50/58 |
| W3 completable tasks | 40/72 | **56/72 (77.8%)** |
| Workflow tasks finished | 1/32 | 17/32 |
| W6 wrong applied | 1 (harness) | 2 (one real bug: a new draft and its line, below) |
| W9 / W14 | 0 / 0 of 190 | 0 / 0 of 187 |
| W8 p50 / p95, ms | 5,854 / 13,248 | 4,571 / 13,101 |

- **W1 count questions.** Seven W1 "misses" are count questions that round 8 routes to a read without the classifier. All of their read tasks pass.
- **Finishing in every case:** approvals, reject, cancel, submit, delete, void, mark-ready and voucher, both confirm and decline.

### Still open on the tuning corpus
- **Action how-tos have no "ให้น้องทำให้".** This covers all 8 `M3-button-*` conversations. They answer through the reviewed-help route, which never receives the workflow action id. Fix: cards round 2.
- **Record payment.** The card was prepared without asking the method (§6.1 lists "วิธีจ่าย"). The method answer "จ่ายเงินสด 1,000 บาท วันนี้" was then saved as a **new expense draft**, a real wrong change. Fix: round 10.
- **Count and total on the approvals picker.** "มีใบเบิกรออนุมัติไหม" opens the picker, which never states the count or the total. Fix: round 10.

### Advisor held-out (W11)
60/71 (84.5%) after both rounds, against 64/71 before Phase B. The misses:
- 4 are the stale out-of-package gold;
- 1 is the approvals question above;
- 2 (round 9 run) were `PROVIDER_THROTTLED` on the intake route, which the user saw as "ระบบตอบไม่ได้ตอนนี้";
- the rest are model read misses: a dropped `limit 5`, an extra `PAID` filter, and the CE-year date read.

### Bedrock throttling recurs
The round 9 advisor run had 16 throttled calls between about 09:08 and 09:20; two reached the user and retries recovered the rest. The earlier window was 04:22–05:39. The tuning runs, at the same pace, had none.

Phase B adds one classifier call to every typed message, so read the Sonnet 4.6 quotas of the Production account (owner MFA) before the release.

## Round 10 and the blind gate, measured 2026-11-06

### What was run
- **Tuning, round 10 and cards round 2.** Main `b974497b4`. Tuning 147.76 THB.
  - Round 10: a payment asks its method, the answer never becomes a new expense, and the approvals picker states the count and the total.
  - Cards round 2: reviewed-help how-tos offer the one workflow they name.
- **Blind gate.** Blind held-out v2: 164 conversations, written by a separate lane before the round 9–10 seed changes and never shown to a fixing lane.
  - 147 conversations ran within the 240 THB cap (232.92 THB). The other 17 (smalltalk, free shop and unlinked) ran after, for 14.29 THB.
  - Three conversations the controller saw while fixing are left out of the gate decision. That leaves a gate set of 156 completable tasks.
- **Advisor held-out (W11).** 54.24 THB.
- **Harness fixes.**
  - `64ab7aeae` accepts the card link that delivery opens outside LINE, and reads zone-less snapshot times as UTC.
  - `498063d71` counts a voucher submit's expense reservation as part of the gold voucher.

### Tuning (115 conversations)
- **W3: 65/72 (90.3%)**, with wrong applied 0. Workflow tasks finish 25/32.
- **Finishing every time:** record payment and all eight "ให้น้องทำให้" how-to paths.
- **Left:**
  - 4 confirm tasks: the harness link fix above, not yet re-run.
  - 2 claim-create tasks: the policy's no-receipt reason question, with stale gold.
  - 1 advisor answer.

### Blind gate (MA3/MA6): not met
| Metric | Gate set | Gate |
|---|---|---|
| W3 completable tasks | 85/156 (54.5%) | ≥ 95% |
| W6 wrong applied | 4 changes in one conversation (real) | 0 |
| W1 classifier label | 102/136 | — |
| W2 | 69/106 | — |
| W14 timeouts | 1 of 228 calls | — |

**By kind:**
- **Finished every time:**
  - expense void 4/4;
  - claim pay-back 3/3;
  - smalltalk 5/5;
  - the free-shop refusals (R27) 6/6.
- **Mostly:**
  - voucher 15/20;
  - expense delete 9/12;
  - expense submit 4/5;
  - advisor 45/63.
- **Not at all:**
  - claim create 0/10;
  - approve 0/6;
  - reject 0/5;
  - claim cancel 0/3;
  - claim submit 0/3;
  - substitute receipt 0/3.

**The real wrong change.** A typed pick on the claim-edit picker failed with `invalid_provenance`. The next edit instruction then built its preview for **another** draft of the same user, and the press saved it.

**Product causes,** about 46 of the 71 failed tasks:
1. **The claim matcher.** The typed-pick matcher never reads a claim's `reason`, category or requester name, and a typed round vetoes every claim. The claim picker rows also say "ร่าง N" for claims that wait for approval or payment.
2. **A target named in the first message** still opens the full picker.
3. **"ไม่มีใบเบิกรอคุณอนุมัติ"** is told to a user without the approve right, to an approver whose named claim waits on someone else, and to a requester-filtered question. This breaks the house rule that wording must be true in every case.
4. **Claim creation loops** on the category question after "ไม่มีใบเสร็จ …", and a typed category with a polite ending is not taken.
5. **The substitute-receipt picker** ignores the typed pick, and its collector then asks "which expense" forever.
6. **Every refused workflow** is answered with the claim wording "ยังไม่มีสิทธิ์เปิดใบเบิก".
7. **The 50 ทวิ refusal** after a payment without withholding gives no reason.
8. **Classifier confidence.** "ถอนใบเบิก" and paying an approved voucher fall below the threshold.

**Harness, seed and gold causes,** 25 tasks:
- 6 tasks drifted with the seed: the blind set was written before the seed made claims submittable and ready receipts confirmable.
- 7 tasks assume an accountant records payments, but `ROLE_GRANTS` does not give accountants `expense.payment.record`.
- 10 correct replies log no workflow task, so the harness cannot score them:
  - six model-text refusals;
  - two free-shop menu replies, the support request and the package card;
  - two unlinked-user link cards.
- 2 tasks use the creator-only fixture, which has no LINE AI access.

Even with all 25 counted as passes, W3 would be 110/156 (70.5%). The gate fails on product grounds.

### Advisor held-out (W11)
- **Score:** 57/71 (80.3%).
- **Throttling:** five misses were `PROVIDER_THROTTLED` between 05:08 and 05:11 UTC, which the user saw as "ระบบตอบช้ากว่าปกติ", and one was a router schema error. Without these six, the score is 62/71.
- **Other misses:** the four stale out-of-package rows are unchanged.

### Next
- **Fixes.** Rounds `wfp-r11` and `cards-r3` take the eight product causes above.
- **New blind set.** A new lane writes blind held-out v3 whose gold is checked against today's seed and `ROLE_GRANTS`.
- **Budget.** The programme has spent about 2,100 THB of the 2,300 THB cap, so the re-measure needs the owner's approval for more budget.

## Rounds 11–12 and the second blind gate, measured 2026-11-06

### What was run
- **Product:** main `d7b6e2bfe`, rounds 11 (claim pick by the user's own words; edits bind to the picked claim only) and cards round 3.
- **Tuning corpus:** 112 of 115 conversations before the 170 THB cap.
- **Blind set v3:** 226 conversations, 770 turns, 335 tasks (164 workflow, 171 advisor). It was written by a separate lane that never saw the tuning or earlier held-out texts, and run once.
- **Advisor held-out:** 43 conversations, 71 turns.

### Tuning
- **W3:** 65/69 (94.2%), with wrong applied 0.
- **The four failures:**
  - two claim-create golds are stale: the policy rightly asks for the missing-receipt reason;
  - one expense confirm lost its target after a low-confidence choice card;
  - one advisor turn.

### Blind gate v3 (MA3/MA6): not met
| Metric | Result |
|---|---|
| W3 workflow, as scored | 81/164 (49.4%) |
| W3 workflow, gold label corrected | 98/164 (59.8%) |
| W3 advisor tasks | 124/171 |
| W6 wrong applied | 0 |
| W14 timeouts | 0 / 350 calls |
| Spend | 318.18 THB (no cap) |

**Gold and harness causes:**
- **Wrong button label.** 29 presses used "ยืนยัน" where the button is "ตรวจแล้ว ยืนยัน", so the press never reached the button.
  - Re-running those 22 conversations with the real label (19.97 THB) gives expense confirm 17/22.
  - Four of the remaining five are the preview-then-expiry scoring limit; one is the `multi` product cause below.
- **Text refusals not counted.** About 25 refusal tasks ended in a correct refusal said in text, but the product logged no `REFUSED` task, so W3 cannot count them.
- **Free-tier answer turns.** 12 such turns are not recorded as `ANSWERED`.

**Product causes:**
- **Claim create.** A claim amount typed "บ." was not read (`parseManualClaimLine` accepted บาท, ฿, THB and baht only).
- **Side questions.** A side question during collection lost the quick replies, and on the voucher payee step it lost the task.
- **Questions taken as fields.** A question was stored as the voucher payee name. This is a preview only, never applied.
- **Two jobs in one message.** "Confirm this bill, then record its payment" got the utility-bill reply.
- **Named starts.** Claim edit, claim cancel and substitute receipt starts that named one record still showed the picker.
- **Substitute receipt.** The collection could not be put off and looped on "which expense".
- **Refusal links.** A refusal's web link was a quick reply only, or was dropped. Cash-payout claim repayments got an untrue "check the account" sentence.
- **Dead end.** "Too many to search in chat" offered no way out.
- **No-access members.** A member without LINE AI access was refused only after a gateway call.

### Advisor held-out (W11)
- **Result:** 59/71 (83.1%), 56.27 THB, no throttling.
- **Stale gold:** four failures are out-of-package golds that still require the words "แพ็กเกจ" or "ยังไม่มี". Without them the result is 63/71.

### Next
- Round 12 (wfp-r12) and cards round 4 fix the product causes above. Cards round 4 also logs every deterministic workflow refusal as a `REFUSED` task.
- **Blind set v4:**
  - 200 conversations;
  - every press label checked against a literal in `apps/api/src`;
  - overlap with the tuning, v2 and v3 texts is 0.
- Set v4 is the next gate, run once. Tier 1 stays unreleased until it passes.

## Rounds 12–13 and blind sets v4 and v5, measured 2026-11-07

### Blind set v4 (main `cc055ca42`, 225.18 THB)
- **Result:** MA3/MA6 not met. W3 workflow 53/119 (44.5%); advisor tasks 82/87.
- **Wrong applied:** 0. Every preview shown was on the gold record.
- **Biggest cause.** 45 tasks were blocked in company B, the seeded shop with more than 300 records. A record the user named was never looked up, and the reply was "too many to search in chat". Outside those tasks the result is 49/74 (66%).
- **Round 13 fixes:**
  - a bounded lookup for a named record in a big shop;
  - a record typed after a choice card;
  - a day number read as an amount, and the generic error in claim collection;
  - "ของผมเอง" read as a requester name;
  - claim labels that hid the round;
  - the auditor's untrue "nothing to confirm";
  - foreign or expired presses not logged as `REFUSED`;
  - switching jobs during collection.

### Blind set v5 (main `d8c6d10fd`, 167.33 THB)
- **Result:** MA3/MA6 not met. W3 workflow 111/169 (65.7%); 114/169 (67.5%) after the scorer allowance below. Advisor tasks 88/96. W2 145/169. W7 median calls per task: 1.
- **Wrong applied is not 0. The first real wrong writes:**
  - **Particle as reason.** 14 claim drafts were saved with a politeness particle as their reason, left over after the description, amount and date were read. The preview showed it, and the user saved.
  - **An expense nobody asked for.** One expense draft was captured from a message that named a claim by category and round; the round number became the amount. The message before it ("…, I'll say which one") had been classified unclear.
- **Scorer artifact.** A claim's first edit replaces its legacy fallback line `rbl_<id>` by design (`replaceLines`). The scorer counted that as a wrong write in 3 tasks, and now allows the identical replacement.
- **Wrong-target count.** All 29 counted wrong-target previews were binding misses on the new claim drafts, caused by the wrong reason. None was a preview on another existing record.
- **Product causes, with their task counts:**
  - a document number glued to Thai text, which was not matched (21);
  - a particle saved as the claim reason (14);
  - an amount reply that left an open claim collection after a two-amount opener (6);
  - a deferred-target opener that started nothing (4);
  - a correction or ordinal after a choice card, which delivered the internal delivery-plan placeholder text to the customer (4);
  - an opener's payment method lost after the picker (2);
  - a named claim not waiting for this approver, which showed the picker instead of a true refusal (2);
  - an "A หรือ B" side question stored as the payee (1);
  - a model-route package refusal not logged as `REFUSED` (1).
- **Gold dispute.** Two v5 golds expect different question orders for the same voucher record. The product asks for the payee first, and the product is kept.

### Round 14
Round 14 fixes the v5 causes:
- **Particles.** A particle is dropped only when Thai word segmentation (`Intl.Segmenter`) reads it as a word of its own, so real words such as "บังคับ", "หน้า" and "มูลค่า" keep their last syllable.
- **Document numbers.** A typed number matches the whole document number or its last part after a dash, never a shared prefix.
- **Collection and pickers.** Amount replies stay in the open collection; deferred-target openers start the picker; picker rows match category and round; "รอบ N" is never an amount.
- **Delivery.** The placeholder text can no longer reach LINE on any transport.
- **Truthful replies.** Opener slots survive the picker, and a named claim that is not waiting for this user gets a true refusal.

The harness also stops counting a same-actor substitute pause, which writes metadata only, as a business write.

Blind set v6 is ready: 219 conversations, 644 turns, overlap 0 with every earlier set, and 0 unknown press labels. It is the next gate, run once.

## Round 14, blind set v6 and round 15, measured 2026-11-07
**Blind set v6.** The run was on main `db49c5036` (round 14) and cost 242.54 THB. It covered 219 conversations, 644 turns and 215 tasks. MA3/MA6 is **not met**.

| Measure | Result |
|---|---|
| W3 workflow | 82/147 (55.8%) |
| Advisor tasks | 51/68 (57/68 without six scoring artifacts) |
| W1 | 113/137 |
| W2 | 73/147 |
| W7 median | 1 |
| W9 invalid | 0 |
| W14 timeouts | 0 |

- **No real wrong write.** The two wrongApplied effects were a scoring artifact. The rewritten legacy claim line `rbl_` is date-only, while the seed line carries a time on the same day. The oracle now compares `incurredDate` by Bangkok day.
- **One press away from a wrong write.** On cancel, reject and void, a put-off sentence was stored as the reason, and the preview showed it.
- **Causes, by failed workflow tasks:**

  | Cause | Tasks |
  |---|---|
  | A typed "no receipt" sentence on the open receipt question was read as a substitute-receipt request. The author repeated one sentence in 16 conversations. | 16 |
  | Voucher submit, approve and pay could not be started by text. | 12 |
  | A claim named by Thai number words, "ที่ N", "แรก", requester first, or amount. | 11 |
  | A named record followed by trailing words got a one-option choice card; also suffix numbers and plain openers with filler. | 11 |
  | A put-off was stored as a value or not recorded as `DECLINED`. | 9 |
  | A permission refusal was missing for staff approving, or an accountant rejecting or paying. A foreign-card press was not recorded as `REFUSED`. | 5 |
  | A correction after a model read ended in the generic retry sentence. | 1 |

- **Harness artifacts.** Five advisor tasks pressed a message-type quick reply ("เมนูหลัก"), which the replay could not press. The replay now sends that quick reply's text, as LINE does.
- **Round 15** (develop, this commit) covers every cause above. It adds:
  - one shared put-off detector, `isLineWorkflowPutOff`;
  - typed option answers on the receipt question;
  - spoken rounds and ordinals in the claim matcher;
  - direct starts for named records;
  - voucher steps by text;
  - permission refusals before routing;
  - `REFUSED` recording for foreign presses, model refusals and credit refusals;
  - true free-shop wording per request.
- **Controller fixes before landing.**
  - **Voucher wording.** The word "ใบเตรียมจ่าย" itself contains "จ่าย", so voucher steps now need a verb that starts a word. A read such as "ดูใบเตรียมจ่ายเดือนนี้" stays a read.
  - **Negation.** A negated verb ("อย่าลบ…", "ไม่ต้องยกเลิก…") starts nothing.
  - **Combined no-receipt answers.** "ไม่มีใบเสร็จ ร้านไม่ออกให้" keeps the proposal path, so the words land in the missing-receipt reason, not the claim reason.
  - **Put-offs.** Common lead-ins ("เอาไว้ก่อน", "พัก…ไว้") count.
  - **Voucher matching.** Voucher lines also match by the seller's bill number.
- **Next gate.** Blind set v7 has 202 conversations and 581 turns. No sentence repeats in more than two conversations, and presses are used only on postback buttons.

## Blind sets v7 and v8, rounds 16 and 17, measured 2026-11-07 and 2026-11-08
**Blind set v7** ran on main `e4d2216d6` (round 15) and cost 231.12 THB. MA3/MA6 is **not met**.

| Measure | Result |
|---|---|
| W3 workflow | 101/122 (82.8%) after the voucher-pay scoring fix |
| Advisor tasks | 126/142 (88.7%) |
| W6 real wrong writes | 0. The 8 wrongApplied effects were voucher-pay rows the oracle did not link to the gold voucher. |

- **Reply audit.** A controller audit mapped each generic reply to its gateway reason:
  - "ยังเตรียมข้อมูล… ลองส่งข้อความเดิม" (12) was `TOOL_INPUT_NOT_AUTHORIZED`: a read filter the tools did not support;
  - "ระบบตอบช้า" (5) was `PROVIDER_THROTTLED` after two retries;
  - "ยังดึงข้อมูลส่วนนี้ไม่ได้" (3) was `ANSWER_NUMBER_NOT_GROUNDED`;
  - "ยังไม่มีคู่มือ" (3) was `SPECIFIC_PRODUCT_GUIDE_UNAVAILABLE`.

  Beyond those, 70 replies were plain text outside the locked card, 45 were over 400 visible characters, and 91 turns took over 8 s.
- **Round 16** (develop `ef5ce25a1`) fixed several causes:
  - big-shop claims named by category and round;
  - claim verbs after the claim;
  - status questions as reads;
  - named substitute receipts and 50 ทวิ by text;
  - no false "send it again" on unsupported reads;
  - out-of-package data asks;
  - one throttle retry;
  - the oracle's voucher-pay link.

**Blind set v8** ran on main `165be3a66` (round 16) and cost 179.93 THB. It covered 200 conversations, 553 scored turns and 328 tasks. MA3/MA6 is **not met**.

| Measure | Result |
|---|---|
| W3 workflow | 126/151 (83.4%) |
| Advisor tasks | 170/177 (96.0%) |
| W6 wrongApplied | 0 |
| W9 / W14 / W15 | 0 / 0 / 0 |
| Throttled turns | 0 |
| W1 | 44/75. Rule-routed turns counted as misses: 16 workflow starts and 8 reads or how-tos. Round 17 fixes the scorer. |

- **Reply time:**

  | Tier | p50 | p95 | Max |
  |---|---|---|---|
  | T0 | 1.2 s | 1.4 s | |
  | T1 | 2.8 s | 3.0 s | |
  | T2 | 5.7 s | 11.6 s | 15.6 s (2 turns over 15 s) |

- **Reply audit.**
  - 31 generic or confusing replies.
  - 62 plain-text replies.
  - 42 replies over 400 visible characters; substitute-receipt cards ran up to about 1,070.
  - 48 turns over 8 s.
- **Causes, by failed workflow tasks:**

  | Cause | Tasks |
  |---|---|
  | Voucher chains: a typed submit naming status and amount was refused as changed, and a voucher named by a line's expense number got an empty picker. Each failed start blocked the rest of its chain. | 9 |
  | Claim verbs: "ส่งให้ผู้อนุมัติ" was read as approve; "ผ่าน", "ตีกลับ", "ไม่ผ่าน" and "record payment" were not known. A named claim with no known verb dead-ended with only a menu button. | 7 |
  | Expense delete wording went to the low-confidence confirm card; "ใบนี้" lost the previous turn's bill; "ส่งตรวจ" was not known. | 4 |
  | A card pressed from another company recorded `REFUSED` with kind `unknown`. | 2 |
  | Two amounts for one claim item: an amount typed at the receipt question was taken as "no receipt". | 1 |
  | Duplicate vendor names on a voucher (gold expects a refusal; disputed). | 2 |

- **Advisor causes:**
  - reads by requester and category, and one claim's facts by round, which the tools refused;
  - "ช่วยบอก…" opened an approval confirm card;
  - customer invoices, ภ.พ.30 records and bank reconciliation were not refused with the approved package reply. ภ.พ.30 was answered from the 50 ทวิ summary;
  - "who can do this" got the source-changed sentence.
- **Gold artifacts.**
  - The pay method differed across three conversations on the same voucher.
  - One gold reason kept a politeness particle.
  - A put-off was golded on a turn with no open task.
- **Round 17** (three lanes, this commit):
  - **Reads** take requester, category, round, status and approved-unpaid filters, voucher status, and "older than N months". One claim's approval and payment facts come from its own records. Numbers come from tool data only.
  - **Length.** Lists show at most 5 rows, knowledge answers about 350 characters, and the package card names and prices only.
  - **Unsold work** (customer documents, ภ.พ.30 records, reconciliation) gets the approved reply and `REFUSED` when the shop has not bought the feature.
  - **Cards.** Every plain-text reply family moves onto the locked card, with a text fallback when LINE rejects it. The substitute-receipt question card shows the record, the amount, the next question and the count left.
  - **Workflow.**
    - Everyday claim and expense verbs are known.
    - A named record with no verb shows its permitted action buttons.
    - Vouchers match a line's expense number and never show an empty picker.
    - The pay preview shows the method, and asks when there is none.
    - A duplicate vendor name asks which vendor.
    - Foreign presses keep their workflow kind.
  - **Scorer.** W1 credits deterministic routes, and reason comparison ignores trailing particles.
  - **Speed overlap is not built.** Intake settlement finishes inside the gateway call, so an unused parallel intake call cannot yet be guaranteed company-absorbed.
- **Next gate.** Blind set v9.

## Blind set v9 and round 18, measured 2026-11-08
**Blind set v9** ran on main `e3156bb4a` (round 17 and its recheck fixes) and cost 127.34 THB. It covered 220 conversations, 596 turns and 294 tasks. MA3/MA6 is **not met**.

| Measure | Result |
|---|---|
| W3 workflow | 123/176 (69.9%) |
| All tasks | 229/294 (77.9%) |
| W6 wrongApplied | 0 |
| W1 | 14/22 classifier gold turns. The 8 misses never reached the classifier (first cause below). |
| Plain-text replies outside the locked card | 0 |
| Reply length | p50 132, p95 333, max 504 visible characters; 17 over 400 |

- **Reply time:**

  | Tier | p50 | p95 | Max |
  |---|---|---|---|
  | T0 | 1.3 s | 1.7 s | 2.2 s |
  | T1 | 2.9 s | 3.1 s | 3.2 s |
  | T2 | 5.7 s | 11.8 s | 15.1 s (one knowledge answer) |

  30 turns took over 8 s. The slowest ran the classifier, then the intake route, then the turn, in sequence.
- **Causes, by failed tasks (65):**

  | Cause | Tasks |
  |---|---|
  | **Round 17 regression.** The named-record chooser ("เลือกงานสำหรับรายการนี้") ran before the workflow classifier whenever the word list missed the verb: a misspelling, an English verb, the abbreviation คชจ., or the verb at the end. A clear request got a chooser instead of its preview. A read-only member got a web-only record card instead of the permission refusal. A reason or payment method typed next went to the model. | 48 |
  | A confirm-then-pay request in one message: the confirm verb (คอนเฟิร์ม) was not in the word list, so the model's multi chooser answered. | 4 |
  | A typed picker answer naming a row by position took the count of rows ("สามใบ") as an amount. | 1 |
  | A side question at the void-reason question ("…แค่ไหน…") was taken as the reason. | 1 |
  | Two priced items joined by หรือ were read as a question. The model path then drafted the claim and failed provenance: a dead end. | 1 |
  | A claim submit typed after saving: the classifier split between claim and expense submit (0.55/0.35) and asked which. | 1 |
  | **Seed, not product.** The seeded approved voucher has no `sourceHashAtSubmit`, so the web pay precondition answers "changed". Vouchers made in the chat pay normally. | 2 |
  | **Harness, not product.** The claim-edit preview was correct on screen, but `runtimeDeliveredPreviews` records it as `UNVERIFIED_PREVIEW`. | 3 |
  | Open: a vendor named only on the expense lists an unfiltered picker (author gap G2); the approvals picker was not narrowed when the requester's name ran into "ให้…"; a bank-reconciliation request was refused in words, but the reply was recorded as an answer. | 4 |

- **Harness limits.** The corpus author's gaps G3–G8 still hold. W15 is not rebuilt from saved evidence, and rescore puts every turn in Tier 0. The controller's own latency audit computes tiers from the calls each turn made.
- **Round 18** (controller, this commit):
  - The classifier reads every typed request first; the record chooser and the claim-round prompt run only when it finds no workflow.
  - The word list reads คอนเฟิร์ม/confirm as ยืนยัน and คชจ. as ค่าใช้จ่าย. A negation still wins.
  - A number before ใบ/อัน/รายการ counts rows, not money.
  - "แค่ไหน" asks a question. "N บาท หรือ …" states priced alternatives.
  - A requester's name ends before ให้/หน่อย.
  - A claim edit asks what to change, instead of the new-claim details question.
  - The seed gives pending and approved vouchers their source fingerprint.
- **Next:** a recheck of the v9 failures (no longer blind), then blind set v10 as the gate.

