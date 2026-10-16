# Agent Memory: sold-features-ux-program

Status: ROUND 3 handed over on 2026-10-14 afternoon: read `docs/agent-memory/sold-ux-handover-2026-10-14.md` first (where every branch stands, what is on the trial web, what is owed).

Owner: thawatchai. His order, 2026-10-13: after the payment-document work is landed, "ให้ดูตามไฟล์ไกด์ไลน์ที่ส่งให้ research คิดวิเคราะห์และกลับมา apply UX/UI ทุกฟีเจอร์ที่เราเปิดขายเท่านั้น ปรับได้หมด จัดลำดับความสำคัญได้เลย อันไหนควรมีอะไรไม่ควรมี หรือมีไว้เหมือนเดิมแต่ลดความสำคัญลงหรือเพิ่มความสำคัญ … ให้แบ่ง agent ช่วยเหมือนเดิม ทุกฟีเจอร์ ฟังก์ชั่น หน้าจอที่เปิดขายในแพ๊กเท่านั้น".

Scope: sold customer screens only (see the plan). Looks and words; no rule, permission or API change without his word.

Decisions (controller's, each can be overturned by the owner):
- One neutral voice in the web app: no `ค่ะ`/`ครับ`/`นะคะ` in buttons, labels, errors, toasts, dialogs. His guideline's own examples carry none. The LINE assistant keeps its voice.
- The customer's business is `ร้าน` on every sold screen.
- Draft is `ร่าง`; the button is `บันทึกร่าง`.
- `ปิด` closes a window, `ยกเลิก` abandons typed work, voiding is `ยกเลิก…` + object with the safe button `ไม่ยกเลิก`.
- Button order: back-out first, action last (right on a row, on top when stacked on a phone). The app already put the action last in 50+ dialogs; stacking order on phones is new.
- Buttons 44 px on phones and 40 px from 640 px in every variant and dialog; weight 800 is no longer requested (no such face is shipped).

Decisions added during the round (controller's; the owner can overturn each):
- A claim is `ใบเบิก`, signing on screen is `เซ็น`/`ลายเซ็น`, paying is `จ่าย`, the settings menu is `ตั้งค่าร้าน`; the glossary in the standard holds the full list.
- The API's own Thai error sentences for the sold areas and the role-ability names were reworded too (words only), because the web shows them.
- The three expense-page specs protected during the payment-document work were opened for wording only.
- Category table on a phone is stacked rows (it scrolled sideways by his 2026-09-30 choice); a claim line has no preselected category; a draft claim needs a receiving choice when there is no default account; the substitute-receipt hub no longer cancels (the certificate page does); LINE comes first on the phone sign-in page with a link `เปิดร้านใหม่`; the sign-in page's left panel has new lines.
- Not done on purpose: package-purchase screens (frozen), `แดชบอร์ด`, the 44 px prominent pager, Thai file-type names, and every word shared with LINE, prints and bell notices.

Open questions: none blocking. About 60 proposals that need the owner (rule, tax, permission, API) are in the Thai list sent to him at the end of the round; nothing of them is built.

Artifacts:
- Standard: `docs/guidelines/thai-ux-standard.md`. Plan: `docs/plans/sold-features-ux-program-plan.md`.
- Research (40 checkable rules with sources, measurements on the app's fonts, a Thai wording standard): `docs/research/thai-ux-guideline-research-2026-10-13.md`. The screen inventory (routes, components, dialogs, shared layer, word variants, test pins, lane split) was a working map in the controller's scratch folder; its lasting findings are listed below.
- Lanes: L1 entry and purchase · L2 shell, home, settings · L3 recording expenses · L4 expense page, withholding, payment documents, counterparties · L5 substitute receipts, employees and roles · L6 reimbursements · F foundation (global CSS, shared components, dictionary, error text, contracts words).

Findings from the inventory worth keeping:
- Two button systems (`Button` component: sign-in and shared confirm dialogs; `.mangmee-btn` classes: the workspace), a third look in employee pages, about 198 hand-styled buttons (billing worst).
- No global Thai wrapping rule; 85 `break-all`; weight 800 requested 236 times with no 800 face; default Tailwind line-heights for `text-xs`/`text-sm` are below what Thai marks need.
- Sold but hard to reach: "ลายเซ็นของฉัน" has no menu row; "ความปลอดภัยบัญชี" redirects to the dashboard; notification settings exist but no sold package turns them on.
- Thin or off-theme sold screens: ภ.ง.ด.53 (native select, `window.confirm`), the LINE draft-claim page (indigo and black buttons; hash-pinned by the LINE manifest), notification centre and dashboard (own headers), AI suggestions (private modal), category delete (hand-rolled overlay).
- Pins: about 100 web spec files assert on source text or markup; three user-guide content files are SHA-256 pinned in the AI gateway; `menu-entitlements.ts`, `feature-entitlements.ts` and `ReimbursementDraftActionPage.tsx` are hashed by the LINE capability manifest.

Verification (2026-10-13, local; PR CI on GitHub is in startup_failure): the whole CI-equivalent run on the final tree is green: contracts 409, web 3,953, loading audit 0 gaps, API suite, harness 33, LINE whole-chain (all eight groups), m01 97, p1 29, AI gateway 1,590, both type checks, DI metadata, maintenance pins and their two specs, prisma validate and migration review (no migration in this programme). Real-PostgreSQL specs run by hand on a throwaway database: payment 158, void 72, substitute payment 10, substitute edit 31, substitute funding 7, claim draft-submit race 122. Screens walked by the controller at 390 and 1280 as the test owner: home, menu, expense list, an expense, claims hub, a claim, payment documents, 50 ทวิ list, substitute receipts, counterparties, settings pages, employees and roles, ภ.ง.ด.53, upload and manual entry, a guide. Lanes walked their own screens as owner, finance, manager and plain employee. Not run: the Playwright e2e files (31 were text-edited to the new labels); CI runs only two of them.

## Round 2, the owner's decisions (2026-10-13)

Plan and status: `docs/plans/sold-ux-owner-decisions-2026-10-13-plan.md`. Spec of the tax page: `docs/specs/withholding-returns-pnd3-combined-page-spec.md`.

Decisions (owner's unless marked):
- Every proposal of groups ก and ข as answered in the plan table; groups ค, ง, จ are to be asked again now.
- ภ.ง.ด.3: the filled official paper first ("ตามคำแนะนำ"); a file for online filing is a later job.
- "ให้คุณทดสอบผ่านหน้าจอจริงบน local ด้วยนะ": the controller presses the real screens itself as each kind of person, at 1556 and 390, before calling an item done. Lane reports, suites and review agents do not replace it.
- Controller's, can be overturned: LINE keeps `แดชบอร์ด` while the web says `หน้าแรก`; package contents say `ออก ภ.ง.ด.3 และ ภ.ง.ด.53 ในระบบ` on every surface; a declined claim reads `ไม่อนุมัติ` (also the claim status table in contracts, which the bell's finished rows read); `จำนวนราย` on both returns counts payee rows.

Rules added on the server in this round (each test-first):
- An expense with no seller name may take the name its certificate prints, even after the certificate is issued or paid; any other printed change still needs the certificate cancelled (`substitute-expense-edit.ts`, real-database spec). Found by pressing: the wizard's quick record keeps no seller name and the journey ended in an expense that could neither be confirmed nor named.
- A requester may cancel a declined or sent-back claim directly; a duplicate announcement does not reach a declined claim.
- The owner's way out for a payment document whose authors are switched off; a switched-off member cannot sign in (`company_membership_disabled`).
- Withholding routes take the form type; an unknown payee kind goes to neither form; downloading a filed return leaves it filed.

Lessons:
- Pressing found eleven defects that 4,100 web tests, the API suites and four screen reviews had passed (list in the plan's status section). Two were dead ends in a main journey.
- A lane's "unfinished because the server refuses" is a finding, not a footnote: press it, then decide the rule.
- A word that lives in contracts (status tables) is not reached by a web wording round: grep contracts for the old word too.
- `perl -pi` with a `$/` in the replacement breaks the line (it is perl's record separator): use a small Python edit for regex-heavy replacements.

Verification (2026-10-13 evening, local): whole CI-equivalent run on the served head and the seven real-database specs: see the last `landing/*.summary` and `*.realpg` noted in the controller's state file; numbers in the final report to the owner.

Next (round 2):
- Owner's third trial list (proved on the screens by an agent), then the e2e files on a seeded stack.
- Ask groups ค, ง, จ again; the open points of the final report.
- On his word only: push and PR, any release.

## Round 3, the evening answers and the new way of working (2026-10-13 night to 2026-10-14)

Plan: `docs/plans/sold-ux-owner-answers-2026-10-13-evening-plan.md`. Method: `docs/runbooks/local-proof-stack-and-merge-gate.md`. Specs (drafts for the owner): `docs/specs/withholding-returns-complete-spec.md`, `docs/specs/expense-input-vat-right-spec.md`. Plan draft: `docs/plans/purchase-screens-ux-plan.md`.

Owner's orders of the night: build browser journey tests and a wipeable proof stack apart from his trial shop, make the loop faster, send to Codex whatever Codex can do; then twenty answers (plan above), "เอาตามแนะนำ" for the bell and LINE words of answer 13.

Done and on the trial web (gate green on the served head each time):
- Batch A: answers 1, 2, 5, 10 (test and payee ordering), 11, 12, 13 (screens, bell, LINE), 14, 15, 16, 20.
- Withholding slice 1 (income types by route; only the prize to a person newly selectable at 5%) and slice 2a (a download freezes the paper, a filed paper is kept and served from its stored file). Migrations: `20261013120000_wht_filing_routes`, `20261013120100_wht_income_routes_catalog`, `20261014100000_wht_frozen_filings`, all additive.
- The filled ภ.ง.ด.53 re-placed by measurement; ภ.ง.ด.3 splits name and surname; the withholding page lists every fault at once and knows a paper that changed after download.
- Seed data consistent with what the app can produce; the toolkit in `scripts/local-proof/`, whose whole gate was run for real on 2026-10-14 and now owns both stacks on this machine (first run was red: the verification handed a database to the whole API suite, so its skip-unless-reachable database specs ran at once and raced; the suite now gets none, and the database specs run one file at a time).
- Three small things a walker met: the account name on the employee list beside the shop's own name for a person, the reason on a sent-back claim's row, a notice and a Thai file name for the 50 ทวิ download.
- Twelve journeys in `e2e/journeys/` (no receipt, withholding forms, claim sent back then paid, payment document between two people and sent back, staff receipt from a phone, evidence and settings, a paid expense reopened).

Waiting for the owner: question set 2 (ภ1–ภ9, ส1–ส8: establishments, additional filing, rates, online file, the input-VAT right) and set 3 (พ1–พ5: purchase screens). Slice 2 (who pays), slice 3 (additional filing), slice 4 (online file), batch C and batch D start from those answers.

Lessons of the night:
- The proof stack caught a build that passed every unit test and the type check and could not start (source importing from the seed folder). The gate's start step is the only thing that proves the built API boots.
- Journey steps written by Codex by reading pass first time about two times in three; a prover with a browser settles the rest in minutes and sorts wrong tests from real defects (one real defect in three failures).
- Codex lanes do not notify the controller: wait on their result files.
- A merge into the served branch changes the owner's trial web at once and its API only after a rebuild: do not merge under a walker; merge, then run the gate.

Next:
- Owner looks at the trial web and answers the proposals list.
- On his word only: push and PR (for `main` use the merge-tree method of the payment-document landing; `api-error-message.ts` has two edited lines beside frozen billing lines), a billing UX round, the cross-channel word sweep (LINE, prints, notices), any proposal.
- Before a PR: run the e2e files that were edited, on a seeded stack.
