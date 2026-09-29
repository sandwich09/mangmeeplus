# Agent Memory: admin AI tab rework (2026-09-29)

Status: PR 1 merged to develop (#894, 2706733f). PR 2 (admin tab) open for review, not merged, not deployed.
Owner: Claude (controller-delegated), Owner decisions 2026-09-29.
Scope:
- PR 1: remove `AI_BUDGET_SPLIT_ACTIVATION_ENABLED` ("สวิตช์เป็นเปิด", "no switches, always on").
- PR 2: make the System Admin company tab "AI และโควตา" (now "เครดิต AI และอ่านรูป") consistent with
  the credit + receipt-image model, and answer "เงื่อนไขไหนใช้ได้หรือไม่ได้".

Decisions:
- PR 1: the switch is deleted, not defaulted on. SPLIT is savable whenever the ADR 0013 §8 money
  rules hold. `splitActivationEnabled` is dropped from `PartnerAiBudgetPolicyDto` (an older web reads
  `=== false`, so an absent field already means "not blocked"). The Thai text for
  `partner_ai_budget_split_not_enabled` is removed with the code.
- PR 1: `infra/kamal/config.json` drops the key in both stages. The running ECS baseline still
  carries `AI_BUDGET_SPLIT_ACTIVATION_ENABLED=true`; the api schema is a plain `z.object`, so the
  captured leftover key is stripped at parse (listed in `keysOutsideSchema`, not an error). No `null`
  delete entry was added: it would fail a release whose baseline no longer has the key.
- PR 1: legacy `deploy.sh` no longer reads, validates, forces or writes the key; the serving-mode
  spec now fails if the key comes back. `deploy.sh` is pinned, so the maintenance pins were re-synced
  in the same commit (validator + `deploy-production.yml`).
- PR 2, chat credit editing: SHARED `chatMonthlyBudgetSatang` is now "the chat credit an admin set
  for this shop", written through the EXISTING writer (`PUT …/ai-model` with `budgetPolicy`
  `{ mode: 'SHARED', chat, ocr: null, effectiveMonthKey: this month }` + `expectedBudgetRevision`).
  No new write path; the writer already accepted it. Precedence in the one resolver: admin value >
  live sales deal > default 80 (`policy.chatSource`). SPLIT was rejected as the vehicle: it needs the
  shop's own model, an OCR money cap, and "next month only" once the shop spent this month.
- PR 2, TOTAL decoupled: `monthlyBudgetSatang` is only the safety ceiling (฿2,000 platform default).
  The resolver no longer turns a TOTAL override into the chat cap.
- PR 2, data: migration `20260929200000_admin_chat_credit_explicit` is ONE idempotent UPDATE on SHARED
  rows: `chat := monthlyBudgetSatang` where they differ. Override set → chat = override (same credit,
  still beats deals). No override → chat := NULL (clears unused SHARED leftovers, which were never
  enforced). SPLIT rows and the TOTAL values are untouched; `updatedAt` is not bumped. Old binaries
  ignore SHARED chat, so rollback reads the same credit. The controller's readback earlier today: 6 config
  rows, all SHARED, 5 overrides (1 × ฿20, 4 × ฿80), 0 SHARED chat values, so 5 rows change (credit unchanged).
- PR 2, old v2/v3 deals (`creditScope = TOTAL`): apply writes the chat credit beside the TOTAL on a
  SHARED row; the deal return clears both. Same behaviour as before the decoupling.
- PR 2, reads added to `GET …/ai-usage` (same RepeatableRead snapshot, same permission):
  `budget.policy.chatSource`, `budget.chatCredit { deal, cutoverAt }`, `ocr.receiptImages` (basis
  PACKAGE_LOTS / MONTHLY / NONE, tierKey, enforced, active, package, additional, totalRemaining),
  built from `receiptLots` (the admission projection) and the monthly base-admission count.
- PR 2, UI: four cards: status list "เงื่อนไขที่ใช้กับร้านนี้ตอนนี้" (ใช้ได้ / ควรตรวจ / หยุดอยู่),
  "เครดิต AI" (chat credit + editor; SPLIT panel under "ตั้งค่าขั้นสูง"; held credit),
  "จำนวนอ่านรูปใบเสร็จ" (lots/monthly tiles, OCR count, OCR on/off + monthly limit, enforcement choice
  only for MONTHLY basis), "เพดานความปลอดภัยค่า AI ต่อเดือน (ทุกช่องทางรวม)". The usage breakdown
  moved into a collapsed "รายละเอียดค่าใช้ AI เดือนนี้". The retired phrase "เครดิตรวม" is replaced by
  "เพดานความปลอดภัย" across the admin surfaces, including the platform page (`/system/ai-budget`).

Open questions: none blocking.
Findings to tell the Owner:
- In that readback, 4 shops (3 paid BASIC, 1 trial) have a per-shop safety ceiling of ฿80, and 1 legacy shop has
  ฿20. Those ceilings also cap OCR spend, so a busy paid shop can stop reading receipts before its
  package runs out. The new status list flags it; clearing the ceiling is an admin decision.
- 1 paid BASIC shop (50 images) has an OCR monthly limit of 30, which stops reading at 30. The status
  list warns about it.
Artifacts:
- PR 1 #894 (merged). PR 2 branch `claude/admin-ai-tab-rework-20260929`
  (worktree `/private/tmp/mangmee-ai-tab-20260929`).
- Spec: `docs/specs/chat-credit-and-receipt-addons-spec-th.md` §18.8 (A41 to A43). The 80-credit spec rule 2 has a
  dated replacement note.
Verification (PR 1):
- `packages/config` tests: 149/149.
- API: set/get partner AI use-case specs 76 pass, 3 skipped (need Postgres).
- Web: ai-budget.logic, api-error-coverage, api-error-message, action-loading, partner QA and logic specs 169/169.
- Infra: production-serving-mode, validate-production-maintenance-release, sync pins (and `--check`),
  h15-trust-boundary, release-safety, production-image-security specs, Kamal unittest (82) all pass.
- W00 capability manifest regenerated (`packages/config/src/index.ts` is hashed) and re-verified.
- API + web typecheck (native tsc script): rc 0.
Verification (PR 2): see the PR body. It covers typecheck, focused API and web specs, PostgreSQL specs on the
throwaway `aitab-pg` (removed afterwards), the migration fixture check and whole-chain acceptance.
No local browser run: the coordinator ships PR 2 to UAT for the Owner's single sign-in.
Next: review PR 2 → UAT with the Owner → production per the runbook.
