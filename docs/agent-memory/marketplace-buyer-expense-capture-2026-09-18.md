# Agent Memory: marketplace buyer expense capture — implementation 2026-09-18

Status: W00 decisions v1 committed (contract appendix); W01 delivered 2026-09-18 (schema/contracts/config/API/guards/pg); W02-web delivered 2026-09-19 (multi-file intake, group page shell, replace/append contract, read-status recovery)
Owner: controller session (Fable 5.1) directs; Opus 5 implements per wave; product owner decides policy (appendix §15)
Scope: implement spec v0.11 / plan v0.11 W01–W08 (machine-verifiable parts) on one branch `codex/marketplace-buyer-expense-capture-20260918`; one PR to `develop`, one to `main` after CI; no deploy
Decisions:
- D01 = capture group as separate aggregate, no capture-only `ExpenseRecord`; derived sources are ordinary expenses with lineage columns + server-set `payerUserId` (appendix §2)
- D02 = original ≤ 10,485,760 bytes all lanes; API preprocessing (pdf-lib/pdfjs+canvas/sharp) into chunks ≤ 4,000,000 bytes/≤ 3 pages, oversize pages rasterised/tiled; gateway `capture-read`/`capture-extract` v1; durable `ExpenseCaptureReadJob` claimed by a BullMQ scan worker → internal drain; OCR count once per file, money per provider call (appendix §4)
- D06/D07/D09 per appendix §5/§6/§8; D03/D04/D08 defaults proposed, owner confirmation pending (§15)
- Lanes: web single image unchanged; web single PDF = expense at init + async job; multi-file/append/personal-items = group; LINE image unchanged + §17.6/§18.4 copy; LINE file = group + async + auto-handoff for single expense document (appendix §3)
Open questions: appendix §15 items 1–5 (discount/shipping policy default, flag ON both envs, 90-day retention for no-handoff groups, certificate wording, Bedrock replay budget)
Artifacts:
- docs base commit e6e41700 (owner working copy of spec/plan/research)
- `docs/specs/marketplace-buyer-expense-capture-contract-appendix-th.md` (+ §16 implementation notes W01, §17 W02-web)
- W02-web code: `apps/web/src/features/expenses/{expense-capture-upload.logic.ts,expense-capture-status.logic.ts,capture/ExpenseCaptureGroupPage.tsx}`, `apps/web/app/(workspace)/companies/[companyId]/expenses/capture/[groupId]/page.tsx`, `apps/api/src/modules/expenses/application/use-cases/expense-capture-read-status.use-case.ts`, replace/append in `expense-upload.use-case.ts`
- W01 code: `apps/api/prisma/migrations/20260918120000_expense_capture_foundation/`, `packages/contracts/src/expense-capture.ts`, `apps/api/src/modules/expenses/{infrastructure/prisma-expense-capture.repository.ts,domain/logic/expense-capture.logic.ts,application/use-cases/expense-capture-group.use-case.ts,presentation/http/expense-capture.{controller,dtos}.ts,expense-capture.pg.spec.ts}`
Verification: (per wave, recorded below)
Next: W02-LINE ∥ W03 on top of W01/W02-web; W04 (group page facts + allocation, `CaptureFactsSection`/`CaptureAllocationSection` slots are waiting); W05+W07; W06; W08; gate; PRs

## Wave log

| Wave | Agent | Status | Verification | Notes |
|---|---|---|---|---|
| W00 | controller | done 2026-09-18 | docs only | 6 read-only explorer reports consolidated into the appendix |
| W01 | Opus 5 | done 2026-09-18 | contracts build+test 324 pass; config build+test 144 pass; api full test 0 fail (~10.6k assertions, dot reporter); api `tsc --noEmit` clean; web test 1780 pass; web lint clean; ai-gateway test 1209 pass; whole-chain runner rc=0 (1536 + 387 pass); `pnpm test:harness` 17 pass; `expense-capture.pg.spec.ts` 7 pass against a throwaway Postgres; `production-serving-mode.spec.sh` PASS; pins `--check` status=current; `git diff --check` clean | 6 tables / 12 enums / 4 `ExpenseRecord` lineage columns in one additive migration; 9 endpoints under `companies/:companyId/expenses`; resolver+picker+evidence+duplicate sibling rules; `EXPENSE_CAPTURE_GROUP_INTAKE_ENABLED` wired through deploy.sh/kamal/pins. Deviations recorded in appendix §16 (plain unique index instead of raw partial, `note` column, two extra indexes, `complete` still allowed with the flag off). NOT done here: job runner, preprocessing, gateway routes, allocation, handoff, web/LINE. |
| W02-web | Opus 5 | done 2026-09-19 | contracts build + test 324 pass; web full test 1822 pass (0 fail) + `tsc --noEmit` clean; api full test 0 fail + `tsc --noEmit` clean; whole-chain runner rc=0; `pnpm test:harness` pass; pins `--check` status=current; `git diff --check` clean | Multi-file intake (`UploadPanel` → one capture group, per-file state machine + sessionStorage manifest + resume), group page `/expenses/capture/{groupId}` (shell + 3 s read-status polling + W04 slots), replace/append contract on `…/receipt-uploads/{a}/complete` (expectedUpdatedAt / expectedPrimaryAttachmentId / operationId + §16.4 matrix + stale provenance), `GET …/read-status` for both owners, §17.6 copy (no reread CTA on a terminal failure, `upload_pdf_too_large` retired). Deviations in appendix §17. NOT done here: LINE lane (W02-LINE), the reader itself (W03), facts/allocation on the group page (W04). |
