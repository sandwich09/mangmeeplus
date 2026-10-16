# Agent Memory: Mangmee advisor fix-up 9

Status: Complete locally (2026-10-16), with baseline-proven sandbox socket failures. One lane, no commit or live operations.
Owner: Codex.
Scope: R1 control-card delivery, R2 attachment/question revisions, R3 payer selection on facts card, R4 paid wording during substitute work, R5 authoritative PDF window coverage.
Decisions:
- Follow existing substitute/company-payer specs and permission-checked use cases; preserve the working receipt journey.
- Control fallback must retain its signed actions even when a completion menu exists; one card covers its own canonical answer.
- Replace only the attached expense's old substitute clarification with freshly sourced current work; never relax stale-source checks.
- Company funding never invents the human certifier; offer self certification and the existing member-selection surface on the facts card.
- Window coverage comes from the runner's extraction window plan, including resumed checkpoints, never model page labels.
- No package.json, feature flag, final-mutation gate, dependency or .live-r8 edits.
Open questions: Supplied g1 artifacts contain final empty expense snapshots and an empty trace, but no raw window checkpoints. Tests reconstruct the reported page-0 mislabelling for both 40/70-row documents; byte-for-byte live checkpoint replay remains unverified. Other-member selection uses the existing authenticated web member selector.
Artifacts:
- R1: registered line-non-receipt-reply.logic.spec.ts table covers all expense/team/voucher actions, substitute prepare/sign/approve/issued/paper, counterparty, package/checkout, payment/50 ทวิ, evidence association/undo and PDF purpose through real builders/validator. Completion menus reproduce the b1/b4 fallback defect.
- R2/R3: registered substitute-receipt.use-case.spec.ts runs real continuation, webhook source binding/retirement, facts/action builders and validator. The old proof stays invalid; the refreshed question accepts the payer press and prepares once. Another expense's question stays open.
- R4: registered line-draft-update.security.spec.ts runs real action/use-case guards and delivery plan for OPEN/PAUSED/PREPARED/PAYER_CERTIFIED, preserving existing paid/receipt coverage.
- R5: registered expense-capture-read-runner.service.spec.ts runs real runner, assembly, eligibility and ReceiptOcrApplyService over storage fakes, writing 40/70 rows, vendor and total; checkpoint resume makes no provider calls.
- Full registered importer list: /private/tmp/fx9-api-test-list.json (155 of 511 API script specs, including transitive imports and real-module DI).
Verification:
- Contracts build PASS; Gateway typecheck PASS; API package typecheck PASS on final code and tests (including relocated registered R1 table).
- Actual full Gateway/contracts package scripts attempted; tsx CLI fails listen EPERM. Identical CLI failures reproduced on original HEAD ae2bf1ce48b616c8144cb82ec23f8f916c7e0f35.
- Full unchanged contracts test-script list via node --import tsx: 419 pass, 0 fail/cancelled.
- Full unchanged Gateway test-script list via node --import tsx: 1670 pass, 0 fail, 46 cancelled (local socket listen EPERM). Identical full list on exact original HEAD: 1670 pass, 0 fail, 46 cancelled, identical cancelled names. /private/tmp/fx9-gateway-base-comparison.json.
- All 155 registered API specs transitively importing changed files via node --import tsx: 5665 pass, 2 fail, 111 skipped. Both failures are local HTTP-server listen EPERM in line-reply.adapter.spec.ts. Identical full list on exact original HEAD: 5660 pass, same 2 failures, 111 skipped. /private/tmp/fx9-api-base-comparison.json.
- Additional original delivery-plan suite plus real Nest DI: 32 pass, 0 fail/cancelled. The full importer run includes the real Nest DI spec too.
- Focused R2–R5 real-module regressions: 4 pass; registered R1 card/reply suite: 25 pass. git diff --check PASS.
- No live/browser run: sandbox has no network/docker. No package.json, dependency, final-mutation gate, flag or live evidence changes.
Next: Handoff saved at /private/tmp/fixup-9-last-message.md; review/apply the uncommitted diff. Live rerun and exact raw checkpoint replay require an environment/evidence outside this sandbox.
