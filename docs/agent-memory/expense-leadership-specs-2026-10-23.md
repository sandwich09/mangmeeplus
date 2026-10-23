# Agent Memory: expense-leadership-specs-2026-10-23

Status: Docs-first spec round DONE (2026-10-24). No code written. Landed on develop + main as docs only (no PR, owner rule).
Owner: platform (owner decides order and business questions)
Scope: Owner 2026-10-23: "จากนี้ทำ spec อย่างละเอียด พร้อม coding ได้เลย ตรวจ impact gap bug ให้ครบและบันทึกไว้ ยังไม่ต้องโค้ดจริง … merge develop+main ไว้ได้เลย ห้ามเปิด pr", then "ให้ codex astra effort Ultra ช่วยรีวิวด้วย … ไม่จำเป็นต้องเชื่อหมด ต้องมีหลักฐานพิสูจน์ได้เท่านั้น ระวังหลักฐานหรือข้อมูลเดิม งานวิจัยหรือข้อมูลล้าสมัย". Source backlog: `docs/research/expense-leadership-verified-backlog-2026-10-23-th.md` (items 1–25).

## Process
- 9 spec lanes (Claude subagents) wrote spec + plan + memory per backlog item from main 6c54ba208.
- Independent review: Codex CLI `gpt-6-astra`, `model_reasoning_effort="ultra"`, `--search`, read-only sandbox, max 3 concurrent. Full-review rounds capped at 4 per spec, then focused blocker checks.
- Every Codex finding was verified by the controller against the code line it cites (and primary web sources for external facts) before it went back to the author lane. Unverifiable items were not accepted as fact (e.g. an "OpenAI verification API" claim). One controller summary error (Postmark blocked messages) was caught by the author against the primary source.
- Review transcripts (not in git): `codex-review/review-*.md` in the controller session scratch (local only); memory files cite them by that short name.

## Specs and final state (2026-10-24)
| Backlog | Spec / plan / memory | Reviews | Status |
|---|---|---|---|
| 1–6 ops | `docs/plans/ops-followups-2026-10-23-plan.md`, `docs/agent-memory/ops-followups-2026-10-23.md` | 1 + fixes | PLANNED (owner actions) |
| 7 e-WHT 1% | `docs/specs/e-withholding-tax-payment-spec.md` + plan + memory | 4 + focused | READY; owner Q1–Q4 first |
| 8 receipt authenticity | `docs/specs/receipt-authenticity-signals-spec.md` + plan + memory | 4 | READY (MC1–MC13) |
| 9 cash advance | `docs/specs/cash-advance-and-clearing-spec.md` + plan | 3 + focused | READY; Phase 3 waits for budget Phase 0.3 |
| 10 budgets/limits | `docs/specs/expense-budget-and-limits-spec.md` + plan (memory shared: `cash-advance-and-budgets.md`) | 3 + focused | DRAFT — blocked on F2 (staged signed category correction) review before Phase 0.3; 0.1–0.2 can start |
| 11 bulk payment | `docs/specs/bulk-payment-file-export-spec.md` + plan + memory | 3 | READY (M1–M9) |
| 12 e-Tax email intake | `docs/specs/e-tax-invoice-email-intake-spec.md` + plan + memory | 4 + focused | DRAFT — blocked on BL2 (OCR unit recovery on early exits) review before P2.4; P1 scanner fix can ship first (BL1 closed) |
| 13 accounting-software export | `docs/specs/accounting-software-export-spec.md` + plan (memory: `accountant-exports.md`) | 3 + focused | READY; starts after cleanup Phase 1 |
| 25 accountant export cleanup | `docs/specs/accountant-export-cleanup-spec.md` + plan; amendment in `docs/specs/expense-receipt-upload-spec.md` | 3 + focused | DRAFT — blocked on RC-F2 review before Phase 1.4; Phase S and 1.1–1.3 can start |
| 14 proactive summary | `docs/specs/proactive-expense-summary-spec.md` + plan + memory | 3 | READY (M1–M9) |
| 15 unsold features | `docs/research/unsold-features-packaging-decision-2026-10-23-th.md` | 3 | Decision memo D1–D6 for the owner |
| 16–18 LINE AI | `docs/specs/line-ai-workflow-first-spec.md`, `docs/specs/line-ai-measurement-and-eval-spec.md`, plan + memory | 4 + focused | DRAFT — blocked on R4-F2 (ordered dispatch) review before Phase A2; A9, A10, A6c, A7, M1–M3 can start |

## Current-code bugs found (to fix independently of the features)
Security (verified by the controller in code):
- `complete-attachment-upload.use-case.ts:88` — completes any same-company pending upload; no uploader/branch check (authenticity B4).
- `attachment.logic.ts:217-218` — PDF active-content scan matches literal names only; `#xx`-escaped names pass (e-Tax B1).
- `delete-attachment.use-case.ts:28,69` — no branch-scope check before `markDeleted` (authenticity B8).
- `expense-extraction.use-case.ts:92,216` — receipt extraction returns fields without branch/read scope (exports B26, Phase S).
- LINE substitute continuation: a typed "1/2/yes" reaches `prepare.execute` without a signed card (LINE B7; needs a failing test first).
Money/tax (from spec lanes + review, cited in each spec §13):
- e-WHT payments would be filed again on ภ.ง.ด.3/53 (no e-WHT concept).
- Unusable-but-complete AI output is charged to the customer: settlement runs before parsing (LINE B6).
- ภ.ง.ด. papers download while unknown-payee / missing-tax-ID payments are missing (e-WHT B11/B12).
- LINE totals double-count a linked source receipt and its claim projection (budget B7); LINE WHT month summary double-counts partly certified documents (e-WHT B13).
- Currency mixing in the income-expense ledger, the PND accountant export and the home page.
- e-Tax PDF/A-3 with embedded XML is refused at upload with a HIGH security alert (e-Tax B1 context).
- LINE substitute flow writes the expense category before confirmation (LINE B8).

## Owner questions (each spec's §17 has the recommended answer)
e-WHT Q1–Q4; authenticity Q1–Q3; advance Q1–Q3; budget Q1–Q4; bulk payment Q1–Q5; e-Tax Q1–Q8; export cleanup Q1; software export Q1–Q4; summary Q1–Q7; LINE AI Q1–Q3 + MC1 and eval budget; unsold features D1–D6; ops: homepage release go, ALB text change, UAT EIP cost, key rotation, help-pack review.

Next: owner sets the order; recommended first = the four security fixes and the AI-charging fix (each ships alone), then e-WHT after Q1–Q4.
