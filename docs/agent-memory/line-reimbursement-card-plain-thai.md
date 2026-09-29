# Agent Memory: LINE reimbursement card in plain Thai

Status: Implemented on `claude/line-reimbursement-card-plain-thai-20260930`; PR to develop open, not merged, not deployed.
Owner: Claude (coordinator-delegated), 2026-09-30.
Scope: Owner rule 2026-09-27/29 (plain Thai, no ids/enum keys/codes/field paths/JSON, money exact to the satang) on every customer-visible message of `apps/api/src/modules/line-ai/domain/logic/line-reimbursement-draft-card.logic.ts`: preview, confirm card, applied receipt, statuses, refusals, options. Spec: `docs/specs/mangmee-ai-business-document-write-contract-2026-09-27.md` §5.1 (supersedes the "exact values on the card" wording).
Decisions:
- Branch name is a display-only `branchName` on the preview snapshot: one `findBranchName` read per new preview, kept out of the command so a rename never stales a preview. Previews saved before the change omit the branch row.
- The receipt carries the current `requestNo` once the claim has one (it is set at submit). `requestId` stays in the receipt for recovery and is never printed.
- Source bill = certificate or seller document number · shop · date, from the existing source snapshot. Category = Thai label, else "ยังไม่ได้เลือกหมวด" (no key fallback).
- The diff renders from the before/after snapshots, matching lines by lineNo because snapshots have no stable line id. The signature change is said once, by its own sentence. Unknown fieldPaths get a generic sentence.
- Each blocked code maps to one Thai sentence; `activeAction` gets its own sentence; internal paths are dropped. The code stays on the result for logs and audit.
- Postback data, digests, authority and web links are unchanged.
Open questions: none blocking.
Not covered: the web preview page `ReimbursementDraftActionPage.tsx` (W00-hashed) still says "DRAFT", falls back to `categoryKey`, prints ISO dates and "รุ่น {previewRevision}". The LINE applied reply still has no authorized link, which spec §8 asks for (pre-existing).
Artifacts: card logic + spec, `line-reimbursement-draft.use-case.ts` + spec, repository `findBranchName`, adapter claim-line option label, contracts V1 optional `branchName`/`requestNo`, spec §4/§5.1/§6/§8.
Verification (local, after merging develop 826f882c): contracts build; API typecheck (native tsc) rc=0; focused card + use-case + service specs pass; `pnpm --filter @watchdog-bms/api test` 12,065 pass, 0 fail; whole-chain acceptance 3,465 pass, 0 fail, W00 manifest unchanged (no hashed file touched). The machine-token guard, run against the develop builder, flags ids, DRAFT, codes, field paths, snake_case codes and 4-place amounts. No real-model calls.
Next: review and merge the develop PR; ride the next runbook release; read one real LINE claim preview after deploy.
