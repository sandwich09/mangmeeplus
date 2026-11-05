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

## Next
- Land Phase B B3/B4 with `wfp-r3`–`r5`.
- B5: tune T/M on the tuning corpus.
- Then one held-out run for MA3/MA6, and the advisor held-out for W11.
- Compare against this baseline: W2, W3, W6 = 0, W7 and W13.
