# Agent Memory: approved-product-help-refresh-2026-10-04

Status: source review and local checks complete; uncommitted; full whole-chain and model-backed release gates remain open.
Owner: Codex (GPT-6), implementation lane; controller reviews, commits and runs full verification.
Scope: existing product-help pack, all six expenses-guide cards and both reimbursement-guide cards; source review, immutable version refresh and focused regressions. No new cards or product actions.
Decisions:
- Follow ponytail full mode. The owner decision in `mangmee-ai-expense-advisor-2026-09-27.md` says: “Product-help 12 cards may go live on AI-only source review (\"ได้\").” This authorizes repository AI source review, not a claim of model-backed evaluation.
- Accounting/tax knowledge spec §13 requires review for every release changing flow/copy; §14 includes schema/citation/effective-date checks, domain review, fixtures and blind eval/regression. Four-lane plan P23-0 says “Pack publish เป็น immutable version”; bump pack and all eight cards whose source hash changes. Retain the four other card versions and existing effective dates/review deadline.
- Advisor expense spec §10 requires final tuning/held-out real-model acceptance on the merge commit. No model/network call is authorized here; that release gate remains open for the controller/owner. Historical evaluation is not evidence for this refresh.
- `expense.draft`: replace the misleading post-confirmation restriction with conditional correction by an authorized user, return to review with the same document number, and blocker guidance. Reuse the contracts button label. All claims/payment/withholding limits remain in their guide; no existing card makes an inconsistent promise about those actions.
- `expense.vat-display`: replace English tax words in title, summary, question and body with plain Thai without changing the recorded-tax versus reclaimable-tax distinction.
Open questions: controller/owner must decide how to satisfy the still-open model-backed release gate with the evaluation budget exhausted; source approval is separate.
Artifacts:
- `apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts`
- `apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.spec.ts`
- `docs/specs/mangmee-accounting-tax-knowledge-spec-th.md` §7.1 refresh record.
- Reviewed current guides and the expense-correction, expense-withholding-ux and claim-self-approval-and-words memories dated 2026-10-04. Guide anchors below support every semantic clause, in order; no new cards are needed to correct a currently false answer.

| Card | Body review and supporting guide anchor |
| --- | --- |
| expense.start | Unchanged. Select branch; upload/manual only through enabled channels and actual permissions; save draft; check seller/document/date/money/attachments; draft does not confirm or pay. Expenses `#overview` introduction, steps, status table and two-status note. |
| expense.status | Unchanged. Document review and payment are separate; confirmed may be unpaid and paid may be incompletely reviewed. Expenses `#overview` two-status note supports all clauses verbatim. |
| expense.find | Unchanged. Select period/filter status; search seller/document number; open detail. Expenses `#list` filters/search and daily/monthly views, plus `#detail` opening instruction. |
| expense.draft | Body changed. Draft remains editable and needs checking before confirmation (`#overview` steps/status table); post-confirmation correction is conditional on rights and document eligibility, returns to review with the same number, and otherwise shows reason/contact (`#overview` correctionHelp and confirmed row; also `#detail` correction items). No promise that the reader may edit, that all confirmed documents may reopen, or that cancellation is necessary. |
| expense.vat-display | Body/title/question changed only to Thai tax words. Recorded tax is not reclaimable tax; check documents and tax conditions first. Expenses `#list` five-card summary, corroborated by `#manual` tax warning and `#faq` tax answer. |
| expense.export | Unchanged. Check before confirmation; export confirmed records/evidence on web with rights for accountant review/booking (`#overview` steps, `#evidence` workflow). Asking for help itself sends nothing: deterministic renderApprovedKnowledge only constructs an answer/citation. |
| reimbursement.meaning | Unchanged. Personal advance reimbursed by company; system request differs from printed signing document; draft/printed document does not prove approval/payment. Reimbursements `#quick-start` requester and distinction note. No self-approval or duplicate-payment promise. |
| reimbursement.roles | Unchanged. Tabs/work differ by roles/permissions; ask administrator to check rights; a new request does not grant access. Reimbursements `#tabs` table and visibility note. Finance work is conditional in the following note; card does not say every company requires finance or that roles grant self-approval. |

- Product rules checked without expanding cards: posted/issued/locked/live-claim documents and payment-total correction blockers are explained in expense `#detail`; withholding choice/50 ทวิ persistence and both date ceilings from the brief/task memories are not contradicted by any card. Claims `#policy`, `#duplicate`, `#faq` describe self-approval policy and reasoned clearing under payment-block policy; cross-requester matching, frozen assignments and the solo-at-submit exception were checked against the claims task memory. No card purports to describe those actions or authorize them. This is source review, not database/browser behaviour evidence.
- Not changed: the current reimbursement guide payout step says to enter a payment date, but does not mention the future payout-date restriction. Its “วันที่…ต้องไม่เกินวันนี้” sentence refers to expense lines, not payouts. No pack card teaches payout-date entry; do not attribute the new payout limit to a nonexistent guide sentence. Withholding choice/50 ทวิ revisit details similarly have no card claiming to teach them; their current guide does not contain those newly named controls.
- Source hashes: expenses `08dbb27a0465a294b243976f814717518938888e9af979e6ae0424002a1212d5` → `6fad431f54f3eb4e4469f496ff43e4438c45f707ca6fd437eec60d90fd9397d3`; reimbursements `013078416e268b89892e90c3dba2a1ae505e9f487b3f7a98f49efd634d6c4432` → `0fe02feeb799815999498239690f5f861f790ba3c998cbc4433990a644a4ae38`.
- Pack v2 hash: `42275c4cc8ee0a0f850946e222d7701dc3a69c725075afaa87197095cf8e605f`. Existing hash helpers recompute the eight v2 card hashes from the complete source/body/metadata; the four other v1 cards retain their hashes.

| Refreshed card | SHA-256 content hash |
| --- | --- |
| expense.start | bea648bd9a69014afb029e5ff1ce1217dba5cc0ed570cbf43ce604c5c6904ddb |
| expense.status | 865e6146d8c06c04c84fb51047429eb6fcf937f695906775953f98d042109de3 |
| expense.find | 3a952cc6595b431ae724051a8ba9e423b7e789d7f67d9a5cd71d39d770ec54fd |
| expense.draft | 46a125c394239b953af90bdf943dfcaa7551b815b31355933935a65bb14ae41b |
| expense.vat-display | cc762b6a8b7fe5be40ea170a0a9d21ea72712d43c13fa87d7429e29a45079e6a |
| expense.export | b0e99f0d1888dbab5f924a54f61e8a4a06c75003d83022bd3c3f8fc0d1e79473 |
| reimbursement.meaning | ead23ba3d5eabbd130470d81d4b03276470a32e36980ede77388ce0b6e339d03 |
| reimbursement.roles | 8971c14ba90de8d74da01d6fcd3e8ea33f3591820b6649b61c231d8ca5ab51fc |

Verification:
- Baseline: `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test --test-reporter=spec src/modules/line-ai/agents/approved-knowledge.spec.ts`: exit 1, 9 pass/1 fail/0 skip; expenses guide source hash mismatch reproduced before any production change.
- Same command after adding two tests and updating the integrity expectation, before production edits: exit 1, 9 pass/3 fail/0 skip. Changed integrity test fails old reviewer; new correction test fails missing conditional correction; new Thai test fails the English tax title. After production refresh: exit 0, 12 pass/0 fail/0 skip. Each of the three new/changed tests is red on original production and green on refreshed production.
- `pnpm --filter @watchdog-bms/api exec node --import tsx --test --test-reporter=spec src/modules/line-ai/line-ai-capability-manifest.spec.ts`: exit 0, 4 pass/0 fail/0 skip. No drift; no manifest regeneration.
- `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx --test --test-reporter=spec src/modules/line-ai/agents/orchestrator.agent.spec.ts`: exit 0, 89 pass/0 fail/0 skip; includes exact-body/citation/no-compose rendering, rights recheck and mixed read/help. Providers are test doubles, no model calls.
- `/private/tmp/claude-501/-Users-thawatchai-Project-MangmeeYungYuen-mangmeeplus/6fadd91a-5682-4234-a498-2e23f77e8587/scratchpad/codex/heavy.sh pnpm --filter @watchdog-bms/ai-gateway typecheck`: exit 0, no diagnostics.
- `shasum -a 256 apps/web/src/features/user-guide/expenses-guide.content.ts apps/web/src/features/user-guide/reimbursement-guide.content.ts`: exit 0; exact source hashes above. `pnpm --filter @watchdog-bms/ai-gateway exec node --import tsx -e` importing the pack and printing versions/hashes/body byte sizes: exit 0; all bodies 405–883 bytes, under 4096; validateKnowledgePack also checks metadata bound and every card/pack hash in the green spec.
- Old-text scan: `rg -n -F` with the old correction tail, tax title, tax question and tax body prefix over apps/api, apps/ai-gateway, apps/web, e2e and scripts (`*spec*`, `*e2e*`, `*json`, `*prompt*` globs): exit 1, no stale expectations/fixtures. Pack/id/stamp scan: no additional executable/golden pin. The 2026-09-27 human-review research document is an intentionally historical DRAFT/UNREVIEWED snapshot with old hashes; preserve it rather than rewrite historical approval evidence. Owner's later AI source-review decision supersedes its human-review requirement for these cards only.
- `git diff --check`: exit 0 after adding the complete review/verification record; final handoff check repeated after the last note correction.
- Not checked: exact `node scripts/run-line-ai-whole-chain-acceptance.mjs`, because its catalog invokes the explicitly forbidden tsx CLI, which opens a socket in this sandbox. Did not run/retry it or alter the runner. Other whole-chain suites, real-PostgreSQL, browser, servers and real-model evaluation not checked; prohibited in this lane. The focused checks do not establish full-chain/model acceptance.
Next:
- Controller runs `node scripts/run-line-ai-whole-chain-acceptance.mjs` on the reviewed diff and records every suite result before acceptance.
- Controller asks owner about the unmet blind/model-backed merge/release gate with the spent evaluation budget; no model call was made and no evaluation or deployment acceptance is claimed.
- Review and commit these four files. No package, schema, migration, paid-invoice.ts, billing-schedule.ts, environment switch or git write operation.
- Controller review (2026-10-04): the `expense.vat-display` wording change ("VAT" → "ภาษีมูลค่าเพิ่ม" in title, question and body) was NOT taken — it was not needed for truth, shop users say and type "VAT", and it would change the card's selection metadata with no model-backed check available. That card keeps its original text (version 2 only because its source file hash moved); the "all cards in plain Thai" test was removed with it. The hash recorded above for `expense.vat-display` and the pack hash are superseded; the code computes them. Only `expense.draft` changes what a reader is told. The whole-chain acceptance was run by the controller.
